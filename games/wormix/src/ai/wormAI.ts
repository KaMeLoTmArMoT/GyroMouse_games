import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import type {
	AIDifficulty,
	AIPersonality,
	TeamAmmo,
	WeaponId,
	WeightVector,
} from "../types";

export interface AITurnPlan {
	targetAngle: number;
	targetPower: number;
	weaponId: WeaponId;
	walkDir: number; // -1, 0, 1
	targetX: number; // x position to walk toward
}

interface ShotResult {
	angle: number;
	power: number;
	weaponId: WeaponId;
	enemyDamage: number;
	selfDamage: number;
	chainBonus: number;
	terrainDestruction: number;
}

interface PositionEval {
	x: number;
	y: number;
	coverScore: number;
	bestShot: ShotResult | null;
	totalScore: number;
}

// Personality weight presets
const WEIGHTS: Record<AIPersonality, WeightVector> = {
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
	 * Main AI turn evaluation: two-phase (coarse scan → fine eval).
	 * Returns a unified (position + shot) plan.
	 */
	public static evaluateTurn(
		aiWorm: Worm,
		allWorms: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
		windX: number,
		difficulty: AIDifficulty,
		personality: AIPersonality = "default",
		availableAmmo: TeamAmmo = {},
	): AITurnPlan {
		const w = WEIGHTS[personality];
		const enemies = allWorms.filter((e) => e.isAlive && e.team !== aiWorm.team);
		const allies = allWorms.filter(
			(e) => e.isAlive && e.team === aiWorm.team && e !== aiWorm,
		);

		if (enemies.length === 0) {
			return {
				targetAngle: -45,
				targetPower: 0.5,
				weaponId: "bazooka",
				walkDir: 0,
				targetX: aiWorm.x,
			};
		}

		// --- Helper: check if weapon has ammo (bazooka is always available) ---
		const hasAmmo = (wid: WeaponId): boolean => {
			if (wid === "bazooka") return true;
			return (availableAmmo[wid] ?? 0) > 0;
		};

		// --- Generate candidate positions ---
		const positions = WormAI.getCandidatePositions(
			aiWorm,
			terrain,
			mapObjects,
			enemies,
		);

		// --- Coarse scan: quick evaluation per position ---
		const numAngles =
			difficulty === "easy" ? 3 : difficulty === "normal" ? 5 : 7;
		const evals: PositionEval[] = [];

		for (const pos of positions) {
			const coverScore = WormAI.evaluateCover(pos.x, pos.y, terrain, enemies);
			const bestShot = WormAI.coarseBestShot(
				pos.x,
				pos.y,
				aiWorm,
				enemies,
				allies,
				terrain,
				mapObjects,
				windX,
				w,
				numAngles,
				hasAmmo,
			);
			const crateScore = WormAI.evaluateCrates(pos.x, pos.y, mapObjects);
			const noise = WormAI.difficultyNoise(difficulty);

			const totalScore =
				w.attack * (bestShot?.enemyDamage ?? 0) -
				w.selfRisk * (bestShot?.selfDamage ?? 0) +
				w.chain * (bestShot?.chainBonus ?? 0) +
				w.cover * coverScore +
				w.crates * crateScore +
				noise;

			evals.push({ x: pos.x, y: pos.y, coverScore, bestShot, totalScore });
		}

		// --- Difficulty: limit top candidates for fine evaluation ---
		const topCount =
			difficulty === "easy" ? 1 : difficulty === "normal" ? 2 : 3;
		evals.sort((a, b) => b.totalScore - a.totalScore);
		const finalists = evals.slice(0, Math.min(topCount, evals.length));

		// --- Fine evaluation ---
		let bestPlan: {
			pos: PositionEval;
			shot: ShotResult;
			score: number;
		} | null = null;
		const fineAngles =
			difficulty === "easy" ? 4 : difficulty === "normal" ? 6 : 8;
		const allWeaponIds: WeaponId[] = [
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

		for (const fin of finalists) {
			if (!fin.bestShot) continue;

			for (const wid of allWeaponIds) {
				if (!hasAmmo(wid)) continue;
				if (
					difficulty === "easy" &&
					wid !== "bazooka" &&
					wid !== "shotgun" &&
					wid !== "rifle"
				)
					continue;

				const shots = WormAI.simulateWeapon(
					fin.x,
					fin.y,
					wid,
					enemies,
					allies,
					terrain,
					mapObjects,
					windX,
					fineAngles,
				);
				for (const shot of shots) {
					const score =
						w.attack * shot.enemyDamage -
						w.selfRisk * shot.selfDamage +
						w.chain * shot.chainBonus +
						w.cover * fin.coverScore +
						WormAI.difficultyNoise(difficulty);

					if (!bestPlan || score > bestPlan.score) {
						bestPlan = { pos: fin, shot, score };
					}
				}
			}
		}

		// --- Fallback: closest enemy, simple parabolic ---
		if (!bestPlan) {
			let target = enemies[0];
			let minDist = Infinity;
			for (const e of enemies) {
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
			const fallbackWeapon: WeaponId =
				minDist < 100 && hasAmmo("shotgun") ? "shotgun" : "bazooka";
			return {
				targetAngle: Math.max(-175, Math.min(-5, angle)),
				targetPower: 0.5,
				weaponId: fallbackWeapon,
				walkDir: 0,
				targetX: aiWorm.x,
			};
		}

		// --- Choose weapon for close range ---
		let chosenWeapon = bestPlan.shot.weaponId;
		if (bestPlan.pos.x !== undefined) {
			let closestEnemyDist = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - bestPlan.pos.x, e.y - bestPlan.pos.y);
				if (d < closestEnemyDist) closestEnemyDist = d;
			}
			if (
				closestEnemyDist < 100 &&
				chosenWeapon !== "shotgun" &&
				hasAmmo("shotgun")
			) {
				chosenWeapon = "shotgun";
			}
		}

		// --- Difficulty noise on angle ---
		let angleNoise = 0;
		if (difficulty === "easy") angleNoise = (Math.random() - 0.5) * 20;
		if (difficulty === "normal") angleNoise = (Math.random() - 0.5) * 6;

		const finalAngle = Math.max(
			-175,
			Math.min(-5, bestPlan.shot.angle + angleNoise),
		);

		// --- Compute walk direction ---
		const dx = bestPlan.pos.x - aiWorm.x;
		let walkDir = 0;
		if (Math.abs(dx) > 15) walkDir = dx > 0 ? 1 : -1;

		return {
			targetAngle: finalAngle,
			targetPower: Math.min(1.0, Math.max(0.15, bestPlan.shot.power)),
			weaponId: chosenWeapon,
			walkDir,
			targetX: bestPlan.pos.x,
		};
	}

	// =========================================================================
	//  CANDIDATE POSITIONS
	// =========================================================================

	private static getCandidatePositions(
		aiWorm: Worm,
		terrain: TerrainManager,
		mapObjects: MapObject[],
		enemies: Worm[],
	): { x: number; y: number }[] {
		const candidates: { x: number; y: number }[] = [];
		const baseY = aiWorm.y;

		// Stay in place
		candidates.push({ x: aiWorm.x, y: baseY });

		// Walk left / right
		for (const dx of [80, 160, -80, -160]) {
			const nx = aiWorm.x + dx;
			if (nx < 20 || nx > terrain.width - 20) continue;
			const groundY = terrain.getLocalGroundY(nx, baseY + 20, 14, 12);
			if (groundY !== null) {
				const feetY = groundY - 12;
				if (
					!terrain.isSolidAt(nx, feetY - 8) &&
					!terrain.isSolidAt(nx, feetY - 20)
				) {
					candidates.push({ x: nx, y: feetY });
				}
			}
		}

		// Move toward health crate if not at full HP and there's a crate nearby
		if (aiWorm.health < aiWorm.maxHealth * 0.6) {
			const crates = mapObjects.filter(
				(o) => o.type === "health_crate" && !o.isDestroyed,
			);
			if (crates.length > 0) {
				let closest = crates[0];
				let minD = Infinity;
				for (const c of crates) {
					const d = Math.hypot(c.x - aiWorm.x, c.y - aiWorm.y);
					if (d < minD) {
						minD = d;
						closest = c;
					}
				}
				candidates.push({ x: closest.x, y: closest.y });
			}
		}

		// Move toward the closest enemy (aggressive tendency)
		if (enemies.length > 0) {
			let closest = enemies[0];
			let minD = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - aiWorm.x, e.y - aiWorm.y);
				if (d < minD) {
					minD = d;
					closest = e;
				}
			}
			const midX = (aiWorm.x + closest.x) / 2;
			const groundY = terrain.getLocalGroundY(midX, baseY + 20, 14, 12);
			if (groundY !== null) {
				candidates.push({ x: midX, y: groundY - 12 });
			}
		}

		// Away from closest enemy (defensive tendency)
		if (enemies.length > 0) {
			let closest = enemies[0];
			let minD = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - aiWorm.x, e.y - aiWorm.y);
				if (d < minD) {
					minD = d;
					closest = e;
				}
			}
			const awayX = aiWorm.x + (aiWorm.x - closest.x);
			const clampedX = Math.max(30, Math.min(terrain.width - 30, awayX));
			const groundY = terrain.getLocalGroundY(clampedX, baseY + 20, 14, 12);
			if (groundY !== null) {
				candidates.push({ x: clampedX, y: groundY - 12 });
			}
		}

		return candidates;
	}

	// =========================================================================
	//  COVER & CRATE EVALUATION
	// =========================================================================

	private static evaluateCover(
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
			// Cast a ray and count solid hits → cover value
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

	private static evaluateCrates(
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

	// =========================================================================
	//  TRAJECTORY SIMULATION
	// =========================================================================

	private static simulateShot(
		originX: number,
		originY: number,
		angleDeg: number,
		power: number,
		weaponId: WeaponId,
		windX: number,
		terrain: TerrainManager,
		enemies: Worm[],
		allies: Worm[],
		mapObjects: MapObject[],
	): ShotResult {
		const rad = (angleDeg * Math.PI) / 180;
		const maxSpeed = 22.0;
		const speed = power * maxSpeed;
		let vx = Math.cos(rad) * speed;
		let vy = Math.sin(rad) * speed;
		let x = originX + Math.cos(rad) * 20; // barrel tip offset
		let y = originY + Math.sin(rad) * 20;
		const gravity = 0.45;
		const isBouncy =
			weaponId === "grenade" ||
			weaponId === "cluster" ||
			weaponId === "dynamite";
		const hasGravity = weaponId !== "rifle";
		const hasWind =
			weaponId === "bazooka" ||
			weaponId === "cluster" ||
			weaponId === "drill" ||
			weaponId === "mortar";
		let bounces = 0;
		const maxTicks = 180;

		// For cluster: collect all child explosion positions
		const explosionCenters: { x: number; y: number; radius: number }[] = [];

		for (let tick = 0; tick < maxTicks; tick++) {
			// Wind (bazooka, cluster, drill, mortar)
			if (hasWind) vx += windX * 0.05;
			if (hasGravity) vy += gravity;
			x += vx;
			y += vy;

			// Terrain collision
			if (terrain.isSolidAt(x, y)) {
				if (isBouncy && bounces < 3) {
					vy = -vy * 0.6;
					vx *= 0.7;
					bounces++;
				} else {
					break; // impact
				}
			}
			// Water
			if (y >= terrain.waterY) break;
			// Out of bounds
			if (x < -80 || x > terrain.width + 80) break;
		}

		// Detonation point is final (x, y)
		// Cluster: generate child explosions
		if (weaponId === "cluster") {
			for (let c = 0; c < 5; c++) {
				const childAngle = Math.PI / 4 + (c * Math.PI) / 8;
				const childSpeed = 3 + Math.random() * 4;
				let cx = x,
					cy = y;
				const cvx = Math.cos(childAngle) * childSpeed;
				let cvy = -Math.sin(childAngle) * childSpeed;
				for (let t = 0; t < 30; t++) {
					cvy += gravity;
					cx += cvx;
					cy += cvy;
					if (terrain.isSolidAt(cx, cy)) break;
				}
				explosionCenters.push({ x: cx, y: cy, radius: 28 });
			}
		} else {
			const radiusMap: Record<string, number> = {
				bazooka: 42,
				grenade: 38,
				acid_bomb: 30,
				sand_bomb: 25,
				drill: 35,
				mortar: 15,
				dynamite: 65,
				rifle: 18,
				shotgun: 18,
			};
			const radius = radiusMap[weaponId] || 30;
			explosionCenters.push({ x, y, radius });
		}

		// Score damage from all explosions
		let enemyDamage = 0,
			selfDamage = 0,
			chainBonus = 0;

		for (const center of explosionCenters) {
			// Enemy damage
			for (const e of enemies) {
				const dist = Math.hypot(e.x - center.x, e.y - center.y);
				if (dist < center.radius + e.radius) {
					const force = 1 - dist / (center.radius + e.radius);
					enemyDamage += force * 100;
				}
			}
			// Self damage
			for (const a of allies) {
				const dist = Math.hypot(a.x - center.x, a.y - center.y);
				if (dist < center.radius + a.radius) {
					const force = 1 - dist / (center.radius + a.radius);
					selfDamage += force * 100;
				}
			}
			// Barrel chain bonus
			for (const obj of mapObjects) {
				if (obj.type === "barrel" && !obj.isDestroyed) {
					const dist = Math.hypot(obj.x - center.x, obj.y - center.y);
					if (dist < center.radius + 40) chainBonus += 30;
				}
			}
		}

		// Terrain destruction bonus (acids excel at this)
		let terrainDestruction = 0;
		if (weaponId === "acid_bomb") {
			terrainDestruction = 20; // acid always useful for terrain melt
		}

		return {
			angle: angleDeg,
			power,
			weaponId,
			enemyDamage,
			selfDamage,
			chainBonus,
			terrainDestruction,
		};
	}

	// =========================================================================
	//  WEAPON-SPECIFIC SWEEP
	// =========================================================================

	private static simulateWeapon(
		originX: number,
		originY: number,
		weaponId: WeaponId,
		enemies: Worm[],
		allies: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
		windX: number,
		numAngles: number,
	): ShotResult[] {
		const results: ShotResult[] = [];
		let bestPower = 0.5;
		let bestAngle = -45;

		// Quick power estimation using parabolic formula
		if (enemies.length > 0) {
			let closestEnemy = enemies[0];
			let minD = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - originX, e.y - originY);
				if (d < minD) {
					minD = d;
					closestEnemy = e;
				}
			}
			const dx = closestEnemy.x - originX;
			const dy = closestEnemy.y - originY;
			const targetDist = Math.abs(dx);
			bestAngle = dx >= 0 ? -45 : -135;
			const rad = (bestAngle * Math.PI) / 180;
			const denom =
				targetDist * Math.sin(2 * rad) - 2 * dy * Math.cos(rad) * Math.cos(rad);
			if (denom > 0) {
				const requiredSpeed = Math.sqrt(
					(0.45 * targetDist * targetDist) / denom,
				);
				bestPower = Math.min(1.0, Math.max(0.15, requiredSpeed / 22.0));
			}
		}

		// Sweep angles around the estimated best angle
		const spread = weaponId === "shotgun" ? 15 : 40;
		for (let i = 0; i < numAngles; i++) {
			const t = numAngles > 1 ? i / (numAngles - 1) : 0.5;
			const angle = bestAngle - spread + t * spread * 2;
			const clampedAngle = Math.max(-175, Math.min(-5, angle));

			// Try a few power levels around the estimate
			for (const pDelta of [-0.1, 0, 0.1]) {
				const power = Math.min(1.0, Math.max(0.15, bestPower + pDelta));
				const shot = WormAI.simulateShot(
					originX,
					originY,
					clampedAngle,
					power,
					weaponId,
					windX,
					terrain,
					enemies,
					allies,
					mapObjects,
				);
				results.push(shot);
			}
		}

		return results;
	}

	// =========================================================================
	//  COARSE BEST SHOT (for quick scan)
	// =========================================================================

	private static coarseBestShot(
		originX: number,
		originY: number,
		_aiWorm: Worm,
		enemies: Worm[],
		allies: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
		windX: number,
		w: WeightVector,
		numAngles: number,
		hasAmmo: (wid: WeaponId) => boolean,
	): ShotResult | null {
		const weaponsToTry: WeaponId[] = [
			"bazooka",
			"grenade",
			"cluster",
			"acid_bomb",
			"dynamite",
			"mortar",
			"drill",
		];
		let best: ShotResult | null = null;
		let bestScore = -Infinity;

		for (const wid of weaponsToTry) {
			if (!hasAmmo(wid)) continue;
			const shots = WormAI.simulateWeapon(
				originX,
				originY,
				wid,
				enemies,
				allies,
				terrain,
				mapObjects,
				windX,
				numAngles,
			);
			for (const shot of shots) {
				const score =
					w.attack * shot.enemyDamage -
					w.selfRisk * shot.selfDamage +
					w.chain * shot.chainBonus;
				if (score > bestScore) {
					bestScore = score;
					best = shot;
				}
			}
		}

		return best;
	}

	// =========================================================================
	//  NOISE HELPER
	// =========================================================================

	private static difficultyNoise(difficulty: AIDifficulty): number {
		if (difficulty === "easy") return (Math.random() - 0.5) * 30;
		if (difficulty === "normal") return (Math.random() - 0.5) * 10;
		return (Math.random() - 0.5) * 2; // hard
	}
}
