import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import { type ShotResult, simulateShot } from "../physics/ballistics";
import type { TerrainManager } from "../terrain/terrainManager";
import {
	AI_BUDGET,
	type AIDifficulty,
	type AIPersonality,
	type GameMode,
	type TeamAmmo,
	WEAPON_STATS,
	type WeaponId,
} from "../types";

export interface AITurnPlan {
	targetAngle: number;
	targetPower: number;
	weaponId: WeaponId;
	walkDir: number; // -1, 0, 1
	targetX: number; // x position to walk toward
}

/**
 * Frame-sliced AI planner. `step(sliceMs)` runs a bounded chunk of search work
 * so the game keeps rendering while the bot thinks; `isDone` becomes true when
 * the search finishes OR the thinking deadline / simulation cap is reached.
 */
export interface AIPlanner {
	step(sliceMs: number): void;
	isDone: boolean;
	getPlan(): AITurnPlan;
}

export interface PlannerParams {
	aiWorm: Worm;
	allWorms: Worm[];
	terrain: TerrainManager;
	mapObjects: MapObject[];
	windX: number;
	difficulty: AIDifficulty;
	personality: AIPersonality;
	availableAmmo: TeamAmmo;
	gameMode: GameMode;
	deadlineMs: number;
	/** If set, only evaluate shots from this x position (fire-from-here fallback). */
	fixedPositionX?: number;
}

export interface WeightedScore {
	attack: number;
	selfRisk: number;
	cover: number;
	crates: number;
	chain: number;
}

// Personality weight presets
const WEIGHTS: Record<AIPersonality, WeightedScore> = {
	aggressive: {
		attack: 2.0,
		selfRisk: 0.1,
		cover: 0.1,
		crates: 0.3,
		chain: 1.5,
	},
	sniper: { attack: 1.2, selfRisk: 0.8, cover: 1.5, crates: 0.3, chain: 1.0 },
	looter: { attack: 0.8, selfRisk: 0.6, cover: 0.5, crates: 3.0, chain: 0.8 },
	chaotic: { attack: 1.0, selfRisk: 0.2, cover: 0.2, crates: 1.0, chain: 2.0 },
	default: { attack: 1.0, selfRisk: 0.6, cover: 0.5, crates: 0.8, chain: 1.0 },
};

const COARSE_WEAPONS: WeaponId[] = [
	"bazooka",
	"grenade",
	"cluster",
	"acid_bomb",
	"dynamite",
	"mortar",
	"drill",
	"shotgun",
	"rifle",
];
const ALL_WEAPONS: WeaponId[] = [
	"bazooka",
	"grenade",
	"cluster",
	"acid_bomb",
	"sand_bomb",
	"drill",
	"mortar",
	"dynamite",
	"rifle",
	"shotgun",
];

const clampAngle = (a: number): number => Math.max(-175, Math.min(-5, a));
const clampPower = (p: number): number => Math.min(1.0, Math.max(0.15, p));

/** Pure shot scoring — enemy damage, drowning KO, self/ally harm avoidance, tactics. */
function shotScore(
	shot: ShotResult,
	w: WeightedScore,
	windX: number = 0,
	shooterX: number = 0,
	shooterY: number = 0,
	coverScore: number = 0,
): number {
	// Heavily penalize shots blocked right at origin (hitting obstacle/crate/ally directly)
	if (shot.blockedAtLaunch) return -500;

	let score =
		w.attack * shot.enemyDamage -
		w.selfRisk * (shot.selfDamage * 2.5 + shot.allyDamage * 3.0) +
		w.chain * shot.chainBonus +
		w.attack * shot.kills * 70 +
		shot.terrainDestruction * 0.4;

	// 1. Drowning K.O. bonus (knocking enemies into water/void)
	if (shot.waterKnockouts > 0) {
		score += shot.waterKnockouts * 80;
	}

	// 2. Wind adaptation
	const stats = WEAPON_STATS[shot.weaponId];
	if (Math.abs(windX) > 2.0) {
		if (stats.wind) score -= 25;
		else score += 15;
	}

	// 3. Focus-Fire & Low HP finisher
	if (shot.enemyDamage > 0) {
		score += 15;
	}

	// 4. Guerrilla Dynamite tactic
	if (shot.weaponId === "dynamite") {
		const distToEnd = Math.hypot(shot.endX - shooterX, shot.endY - shooterY);
		if (distToEnd < 60 && shot.enemyDamage > 30 && shot.selfDamage < 20) {
			score += 45;
		}
	}

	// 5. Tactical Acid / Sand
	if (shot.weaponId === "acid_bomb" && shot.terrainDestruction > 20) {
		score += 25;
	}
	if (shot.weaponId === "sand_bomb" && coverScore < 0.3) {
		score += 30; // build cover mound when on open ground
	}

	return score;
}

interface PositionEval {
	x: number;
	y: number;
	coverScore: number;
	crateScore: number;
	mineRisk: number;
	elevationScore: number;
	noise: number;
	bestShot: ShotResult | null;
	totalScore: number;
}

interface RefineItem {
	x: number;
	y: number;
	wid: WeaponId;
	seed: ShotResult;
}

interface BestCandidate {
	x: number;
	y: number;
	shot: ShotResult;
	score: number;
}

class AIPlannerImpl implements AIPlanner {
	private readonly params: PlannerParams;
	private readonly budget;
	private readonly w: WeightedScore;
	private readonly enemies: Worm[];
	private readonly allies: Worm[];
	private readonly aimError: number;
	private readonly deadline: number;
	private readonly posEvalMap = new Map<string, PositionEval>();
	private readonly coarseByWeapon = new Map<string, ShotResult>();

	private positions: { x: number; y: number }[] = [];
	private evals: PositionEval[] = [];
	private finalistsSelected: boolean = false;
	private refineQueue: RefineItem[] = [];
	private refineIndex: number = 0;
	private best: BestCandidate | null = null;
	private done: boolean = false;
	private sims: number = 0;

	constructor(params: PlannerParams) {
		this.params = params;
		this.budget = AI_BUDGET[params.difficulty];
		this.w = WEIGHTS[params.personality];
		this.enemies = params.allWorms.filter(
			(e) => e.isAlive && e.team !== params.aiWorm.team,
		);
		this.allies = params.allWorms.filter(
			(w) => w.isAlive && w.team === params.aiWorm.team && w !== params.aiWorm,
		);
		let nearestEnemyDist = 0;
		if (this.enemies.length > 0) {
			let minD = Infinity;
			for (const e of this.enemies) {
				const d = Math.hypot(e.x - params.aiWorm.x, e.y - params.aiWorm.y);
				if (d < minD) minD = d;
			}
			nearestEnemyDist = minD;
		}
		this.aimError =
			this.budget.aimErrorPx + nearestEnemyDist * this.budget.aimErrorGrowth;
		this.deadline = performance.now() + params.deadlineMs;
	}

	public get isDone(): boolean {
		return (
			this.done ||
			this.sims >= this.budget.maxSimulations ||
			performance.now() >= this.deadline
		);
	}

	public step(sliceMs: number): void {
		if (this.isDone) return;
		if (this.positions.length === 0) this.buildPositions();
		const sliceEnd = Math.min(performance.now() + sliceMs, this.deadline);

		while (performance.now() < sliceEnd) {
			if (this.evals.length < this.positions.length) {
				this.coarsePosition(this.positions[this.evals.length]);
			} else if (!this.finalistsSelected) {
				this.selectFinalists();
			} else if (this.refineIndex < this.refineQueue.length) {
				this.refineWeapon(this.refineQueue[this.refineIndex]);
				this.refineIndex++;
			} else {
				this.done = true;
				break;
			}
		}
	}

	public getPlan(): AITurnPlan {
		if (this.best) {
			const dx = this.best.x - this.params.aiWorm.x;
			let walkDir = 0;
			if (Math.abs(dx) > 15) walkDir = dx > 0 ? 1 : -1;
			const angleNoise = (Math.random() - 0.5) * 2 * this.budget.angleNoise;
			return {
				targetAngle: clampAngle(this.best.shot.angle + angleNoise),
				targetPower: clampPower(this.best.shot.power),
				weaponId: this.best.shot.weaponId,
				walkDir,
				targetX: this.best.x,
			};
		}
		return this.fallbackPlan();
	}

	// ---------------------------------------------------------------------
	//  Search phases
	// ---------------------------------------------------------------------

	private buildPositions(): void {
		const { aiWorm, terrain, mapObjects, fixedPositionX } = this.params;
		if (fixedPositionX !== undefined) {
			this.positions = [{ x: fixedPositionX, y: aiWorm.y }];
			return;
		}
		const candidates = WormAI.getCandidatePositions(
			aiWorm,
			terrain,
			mapObjects,
			this.enemies,
		);
		this.positions = [];
		for (const c of candidates) {
			if (
				Math.abs(c.x - aiWorm.x) < 15 ||
				WormAI.canWalkTo(terrain, aiWorm.x, aiWorm.y, c.x)
			) {
				this.positions.push(c);
			}
		}
		if (this.positions.length === 0) {
			this.positions.push({ x: aiWorm.x, y: aiWorm.y });
		}
	}

	private allowed(wid: WeaponId): boolean {
		if (this.params.difficulty === "easy") {
			return wid === "bazooka" || wid === "shotgun" || wid === "rifle";
		}
		return true;
	}

	private hasAmmo(wid: WeaponId): boolean {
		if (wid === "bazooka") return true;
		return (this.params.availableAmmo[wid] ?? 0) > 0;
	}

	private coarsePosition(pos: { x: number; y: number }): void {
		const { terrain, mapObjects, gameMode } = this.params;
		const coverScore = WormAI.evaluateCover(
			pos.x,
			pos.y,
			terrain,
			this.enemies,
		);
		const crateScore = WormAI.evaluateCrates(pos.x, pos.y, mapObjects);
		const mineRisk = WormAI.evaluateMineRisk(pos.x, pos.y, mapObjects);
		const elevationScore =
			gameMode === "rising_water" ? (terrain.height - pos.y) * 0.02 : 0;
		const noise = (Math.random() - 0.5) * 2 * this.budget.scoreNoise;

		let bestShot: ShotResult | null = null;
		let bestShotScore = -Infinity;
		for (const wid of COARSE_WEAPONS) {
			if (!this.allowed(wid) || !this.hasAmmo(wid)) continue;
			const est = WormAI.estimateAnglePower(wid, pos.x, pos.y, this.enemies);
			const sweep = this.sweepWeapon(
				wid,
				pos.x,
				pos.y,
				est,
				this.budget.coarseAngles,
				this.budget.coarsePowers,
			);
			const key = `${pos.x}|${pos.y}|${wid}`;
			for (const shot of sweep) {
				this.sims++;
				const s = shotScore(
					shot,
					this.w,
					this.params.windX,
					pos.x,
					pos.y,
					coverScore,
				);
				if (s > bestShotScore) {
					bestShotScore = s;
					bestShot = shot;
				}
				const prev = this.coarseByWeapon.get(key);
				if (
					!prev ||
					s >
						shotScore(prev, this.w, this.params.windX, pos.x, pos.y, coverScore)
				) {
					this.coarseByWeapon.set(key, shot);
				}
			}
		}

		const allyPenalty = WormAI.evaluateAllyClustering(
			pos.x,
			pos.y,
			this.allies,
			coverScore,
		);
		const positionTerm =
			this.w.cover * coverScore +
			this.w.crates * crateScore -
			mineRisk -
			allyPenalty +
			elevationScore +
			noise;
		const evalRecord: PositionEval = {
			x: pos.x,
			y: pos.y,
			coverScore,
			crateScore,
			mineRisk,
			elevationScore,
			noise,
			bestShot,
			totalScore: bestShot ? bestShotScore + positionTerm : positionTerm,
		};
		this.evals.push(evalRecord);
		this.posEvalMap.set(`${pos.x}|${pos.y}`, evalRecord);
	}

	private selectFinalists(): void {
		this.finalistsSelected = true;
		this.evals.sort((a, b) => b.totalScore - a.totalScore);
		const top = this.evals.slice(
			0,
			Math.min(this.budget.finalists, this.evals.length),
		);
		// Seed the global best with the top coarse shot so a good plan exists
		// immediately (refinement then improves it frame-by-frame).
		const leader = top[0];
		if (
			leader?.bestShot &&
			(!this.best || leader.totalScore > this.best.score)
		) {
			this.best = {
				x: leader.x,
				y: leader.y,
				shot: leader.bestShot,
				score: leader.totalScore,
			};
		}
		this.refineQueue = [];
		for (const ev of top) {
			for (const wid of ALL_WEAPONS) {
				if (!this.allowed(wid) || !this.hasAmmo(wid)) continue;
				const key = `${ev.x}|${ev.y}|${wid}`;
				const seed =
					this.coarseByWeapon.get(key) ??
					WormAI.shotFromEstimate(
						wid,
						ev.x,
						ev.y,
						WormAI.estimateAnglePower(wid, ev.x, ev.y, this.enemies),
						this.params,
						this.aimError,
					);
				this.refineQueue.push({ x: ev.x, y: ev.y, wid, seed });
			}
		}
	}

	private refineWeapon(item: RefineItem): void {
		const { terrain, mapObjects, windX, aiWorm, allWorms } = this.params;
		const ev = this.posEvalMap.get(`${item.x}|${item.y}`);
		const cover = ev ? ev.coverScore : 0;
		let best = item.seed;
		let bestScore = shotScore(best, this.w, windX, item.x, item.y, cover);
		let angle = best.angle;
		let power = best.power;

		for (let it = 0; it < this.budget.refinementIterations; it++) {
			const spreadA = 30 / (it + 1);
			const spreadP = 0.15 / (it + 1);
			const angles: number[] = [];
			for (let i = 0; i < this.budget.fineAngles; i++) {
				const t =
					this.budget.fineAngles > 1 ? i / (this.budget.fineAngles - 1) : 0.5;
				angles.push(angle - spreadA + t * spreadA * 2);
			}
			const powers: number[] = [];
			for (let j = 0; j < this.budget.finePowers; j++) {
				const u =
					this.budget.finePowers > 1 ? j / (this.budget.finePowers - 1) : 0.5;
				powers.push(power - spreadP + u * spreadP * 2);
			}
			for (const a of angles) {
				for (const p of powers) {
					const shot = simulateShot(
						item.wid,
						item.x,
						item.y,
						clampAngle(a),
						clampPower(p),
						windX,
						terrain,
						allWorms,
						aiWorm,
						mapObjects,
						this.aimError,
					);
					this.sims++;
					const s = shotScore(shot, this.w, windX, item.x, item.y, cover);
					if (s > bestScore) {
						bestScore = s;
						best = shot;
						angle = a;
						power = p;
					}
				}
			}
		}

		const positionTerm = ev
			? this.w.cover * ev.coverScore +
				this.w.crates * ev.crateScore -
				ev.mineRisk +
				ev.elevationScore +
				ev.noise
			: 0;
		const total = bestScore + positionTerm;
		if (!this.best || total > this.best.score) {
			this.best = { x: item.x, y: item.y, shot: best, score: total };
		}
	}

	private sweepWeapon(
		wid: WeaponId,
		x: number,
		y: number,
		est: { angle: number; power: number },
		numAngles: number,
		numPowers: number,
	): ShotResult[] {
		const { terrain, mapObjects, windX, aiWorm, allWorms } = this.params;
		const spread = wid === "shotgun" ? 15 : 45;
		const results: ShotResult[] = [];
		for (let i = 0; i < numAngles; i++) {
			const t = numAngles > 1 ? i / (numAngles - 1) : 0.5;
			const angle = clampAngle(est.angle - spread + t * spread * 2);
			for (let j = 0; j < numPowers; j++) {
				const u = numPowers > 1 ? j / (numPowers - 1) : 0.5;
				const power = clampPower(est.power - 0.25 + u * 0.5);
				results.push(
					simulateShot(
						wid,
						x,
						y,
						angle,
						power,
						windX,
						terrain,
						allWorms,
						aiWorm,
						mapObjects,
						this.aimError,
					),
				);
			}
		}
		return results;
	}

	private fallbackPlan(): AITurnPlan {
		const { aiWorm } = this.params;
		if (this.enemies.length === 0) {
			return {
				targetAngle: -45,
				targetPower: 0.5,
				weaponId: "bazooka",
				walkDir: 0,
				targetX: aiWorm.x,
			};
		}
		let target = this.enemies[0];
		let minDist = Infinity;
		for (const e of this.enemies) {
			const d = Math.hypot(e.x - aiWorm.x, e.y - aiWorm.y);
			if (d < minDist) {
				minDist = d;
				target = e;
			}
		}
		const dx = target.x - aiWorm.x;
		const dy = target.y - aiWorm.y;
		const angle =
			(dx >= 0 ? -1 : 1) *
			((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
		const weapon: WeaponId =
			minDist < 100 && this.hasAmmo("shotgun") ? "shotgun" : "bazooka";
		return {
			targetAngle: clampAngle(angle),
			targetPower: 0.5,
			weaponId: weapon,
			walkDir: 0,
			targetX: aiWorm.x,
		};
	}
}

export function createPlanner(
	params: Omit<PlannerParams, "deadlineMs"> & { deadlineMs?: number },
): AIPlanner {
	const budget = AI_BUDGET[params.difficulty];
	const deadlineMs = params.deadlineMs ?? budget.thinkingMs;
	return new AIPlannerImpl({ ...params, deadlineMs });
}

export class WormAI {
	/**
	 * Generate a random personality based on difficulty.
	 * Easy → always 'default', Normal → {default, looter}, Hard → any.
	 */
	public static rollPersonality(difficulty: AIDifficulty): AIPersonality {
		if (difficulty === "easy") return "default";
		if (difficulty === "normal") {
			return Math.random() < 0.4 ? "looter" : "default";
		}
		const pool: AIPersonality[] = [
			"aggressive",
			"sniper",
			"looter",
			"chaotic",
			"default",
		];
		return pool[Math.floor(Math.random() * pool.length)];
	}

	/**
	 * Quick (angle, power) estimate for a weapon aimed at the closest enemy.
	 * Uses the standard ballistic range equation (ignores wind — the sweep
	 * and refinement pass cover wind drift).
	 */
	public static estimateAnglePower(
		wid: WeaponId,
		x: number,
		y: number,
		enemies: Worm[],
	): { angle: number; power: number } {
		if (enemies.length === 0) return { angle: -45, power: 0.5 };
		let closest = enemies[0];
		let minD = Infinity;
		for (const e of enemies) {
			const d = Math.hypot(e.x - x, e.y - y);
			if (d < minD) {
				minD = d;
				closest = e;
			}
		}
		const dx = closest.x - x;
		const dy = closest.y - y;

		if (wid === "shotgun" || wid === "rifle") {
			return {
				angle: clampAngle((Math.atan2(dy, dx) * 180) / Math.PI),
				power: 0.5,
			};
		}

		const targetDist = Math.abs(dx);
		const angle = dx >= 0 ? -45 : -135;
		const rad = (angle * Math.PI) / 180;
		const g = WEAPON_STATS[wid].gravity || 0.45;
		const denom =
			targetDist * Math.sin(2 * rad) - 2 * dy * Math.cos(rad) * Math.cos(rad);
		let power = 0.5;
		if (denom > 0) {
			const requiredSpeed = Math.sqrt((g * targetDist * targetDist) / denom);
			power = Math.min(
				1.0,
				Math.max(0.15, requiredSpeed / WEAPON_STATS[wid].maxSpeed),
			);
		}
		return { angle, power };
	}

	public static shotFromEstimate(
		wid: WeaponId,
		x: number,
		y: number,
		est: { angle: number; power: number },
		params: PlannerParams,
		aimError: number,
	): ShotResult {
		return simulateShot(
			wid,
			x,
			y,
			clampAngle(est.angle),
			clampPower(est.power),
			params.windX,
			params.terrain,
			params.allWorms,
			params.aiWorm,
			params.mapObjects,
			aimError,
		);
	}

	/**
	 * Approximate walkability between two world x positions along the surface.
	 * Rejects walls taller than the walk step-up (10px) and head-blocked spots —
	 * the same limits the real worm.walk() enforces. Used to avoid walking
	 * blindly into cliffs.
	 */
	public static canWalkTo(
		terrain: TerrainManager,
		fromX: number,
		fromY: number,
		toX: number,
	): boolean {
		if (Math.abs(toX - fromX) < 15) return true;
		if (Math.abs(toX - fromX) > 600) return false;
		const dir = toX > fromX ? 1 : -1;
		const step = 3;
		let feetY = fromY + 12;
		let x = fromX;
		const maxSteps = Math.ceil(Math.abs(toX - fromX) / step);
		for (let i = 0; i < maxSteps; i++) {
			x += dir * step;
			if (terrain.isSolidAt(x, feetY - 18)) return false;
			const groundY = terrain.getLocalGroundY(x, feetY, 30, 12);
			if (groundY !== null) {
				if (groundY < feetY - 10) return false;
				feetY = groundY;
			} else {
				feetY += 3; // gap / falling — keep scanning
			}
		}
		return true;
	}

	// =========================================================================
	//  CANDIDATE POSITIONS
	// =========================================================================

	// =========================================================================
	//  CANDIDATE POSITIONS
	// =========================================================================

	public static getCandidatePositions(
		aiWorm: Worm,
		terrain: TerrainManager,
		mapObjects: MapObject[],
		_enemies: Worm[],
	): { x: number; y: number }[] {
		const candidates: { x: number; y: number }[] = [];
		const baseY = aiWorm.y;

		// Stay in place
		candidates.push({ x: aiWorm.x, y: baseY });

		// Dynamic adaptive surface sampling: -240px to +240px in 40px steps
		for (let step = -240; step <= 240; step += 40) {
			if (Math.abs(step) < 20) continue;
			const nx = aiWorm.x + step;
			if (nx < 25 || nx > terrain.width - 25) continue;
			const groundY = terrain.getLocalGroundY(nx, baseY + 20, 20, 15);
			if (groundY !== null) {
				const feetY = groundY - 12;
				if (feetY >= terrain.waterY - 15) continue;
				if (
					!terrain.isSolidAt(nx, feetY - 8) &&
					!terrain.isSolidAt(nx, feetY - 20)
				) {
					candidates.push({ x: nx, y: feetY });
				}
			}
		}

		// Strategic spots: near crates if injured
		if (aiWorm.health < aiWorm.maxHealth * 0.6) {
			const crates = mapObjects.filter(
				(o) => o.type === "health_crate" && !o.isDestroyed,
			);
			for (const c of crates) {
				if (Math.abs(c.x - aiWorm.x) < 300) {
					candidates.push({ x: c.x, y: c.y });
				}
			}
		}

		return candidates;
	}

	// =========================================================================
	//  COVER, CRATES, MINE & ALLY CLUSTERING EVALUATION
	// =========================================================================

	public static evaluateAllyClustering(
		x: number,
		y: number,
		allies: Worm[],
		coverScore: number,
	): number {
		if (allies.length === 0) return 0;
		// If in deep cover (coverScore >= 0.5), grouping is fine (penalty = 0)
		if (coverScore >= 0.5) return 0;
		let penalty = 0;
		for (const ally of allies) {
			if (!ally.isAlive) continue;
			const dist = Math.hypot(ally.x - x, ally.y - y);
			if (dist < 130) {
				penalty += ((130 - dist) / 130) * (1 - coverScore) * 35;
			}
		}
		return penalty;
	}

	public static evaluateCover(
		x: number,
		y: number,
		terrain: TerrainManager,
		enemies: Worm[],
	): number {
		if (enemies.length === 0) return 0;
		let score = 0;
		const numRays = 8;
		for (let i = 0; i < numRays; i++) {
			const angle = (i / numRays) * Math.PI * 2;
			const dx = Math.cos(angle) * 80;
			const dy = Math.sin(angle) * 80;
			const steps = 8;
			let blocked = false;
			for (let s = 1; s <= steps; s++) {
				const px = x + dx * (s / steps);
				const py = y + dy * (s / steps);
				if (terrain.isSolidAt(px, py)) {
					blocked = true;
					break;
				}
			}
			if (blocked) score += 1;
		}
		return score / numRays;
	}

	public static evaluateCrates(
		x: number,
		y: number,
		mapObjects: MapObject[],
	): number {
		let score = 0;
		for (const obj of mapObjects) {
			if (obj.type === "health_crate" && !obj.isDestroyed) {
				const dist = Math.hypot(obj.x - x, obj.y - y);
				if (dist < 100) score += (100 - dist) / 100;
			}
		}
		return score;
	}

	public static evaluateMineRisk(
		x: number,
		y: number,
		mapObjects: MapObject[],
	): number {
		let risk = 0;
		for (const obj of mapObjects) {
			if (obj.type === "landmine" && !obj.isDestroyed) {
				const d = Math.hypot(obj.x - x, obj.y - y);
				if (d < 60) risk += ((60 - d) / 60) * 2;
			}
		}
		return risk;
	}
}
