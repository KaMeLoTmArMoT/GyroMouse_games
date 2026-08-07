import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import type {
	AIDifficulty,
	AIPersonality,
	GameMode,
	MatchType,
	TeamAmmo,
	TurnPhase,
} from "../types";
import { WEAPON_LIST } from "../ui/hud";
import {
	type AIPlanner,
	type AITurnPlan,
	createPlanner,
	WormAI,
} from "./wormAI";

export class AITurnController {
	public aiPlan: AITurnPlan | null = null;
	public lastAiPlan: AITurnPlan | null = null;
	public aiPersonalities: Record<string, AIPersonality> = {};
	public aiPlanner: AIPlanner | null = null;
	public aiThinking: boolean = false;
	public aiFiringPending: boolean = false;
	public aiTargetX: number = 0;
	public aiWalkTimeLeft: number = 0;
	public aiReposTargetX: number | null = null;

	public isAiDebugMode: boolean = false;
	public aiDebugFrozen: boolean = false;

	public resetTurnState(): void {
		this.aiPlan = null;
		this.aiPlanner = null;
		this.aiThinking = false;
		this.aiFiringPending = false;
		this.aiReposTargetX = null;
	}

	public rollPersonalities(
		worms: Worm[],
		redDifficulty: AIDifficulty,
		blueDifficulty: AIDifficulty,
		matchType: MatchType = "ai",
	): void {
		this.aiPersonalities = {};
		for (const w of worms) {
			if (matchType === "bot_vs_bot" || w.team === "ai") {
				const diff = w.team === "player" ? redDifficulty : blueDifficulty;
				const p = WormAI.rollPersonality(diff);
				this.aiPersonalities[w.id] = p;
				w.personality = p;
			}
		}
	}

	public showDecisionOverlay(show: boolean): void {
		const el = document.getElementById("aiDecisionOverlay");
		if (el) el.hidden = !show;
	}

	public forceFinishAiTurn(
		activeWorm: Worm,
		fireWeaponFn: () => void,
		setActiveWeaponIndexFn: (idx: number) => void,
		setChargePowerFn: (p: number) => void,
		setPhaseFn: (p: TurnPhase) => void,
	): void {
		if (this.aiPlanner && !this.aiPlan) {
			this.aiPlanner.step(500);
			this.aiPlan = this.aiPlanner.getPlan();
			this.aiPlanner = null;
			this.aiThinking = false;
			this.showDecisionOverlay(false);
		}
		if (this.aiPlan && !this.aiFiringPending) {
			this.aiFiringPending = true;
			activeWorm.aimAngle = this.aiPlan.targetAngle;
			activeWorm.facingRight =
				Math.cos((this.aiPlan.targetAngle * Math.PI) / 180) >= 0;
			const weaponIdx = WEAPON_LIST.findIndex(
				(w) => w.id === this.aiPlan!.weaponId,
			);
			if (weaponIdx !== -1) setActiveWeaponIndexFn(weaponIdx);
			setChargePowerFn(this.aiPlan.targetPower);
			this.aiPlan = null;
			setPhaseFn("AIM_FIRE");
			fireWeaponFn();
		} else if (!this.aiPlan && !this.aiFiringPending) {
			setPhaseFn("PROJECTILE_FLIGHT");
		}
	}

	public maybeReplanFromHere(
		activeWorm: Worm,
		worms: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
		windX: number,
		difficulty: AIDifficulty,
		teamAmmo: Record<"player" | "ai", TeamAmmo>,
		gameMode: GameMode,
	): void {
		if (!this.aiPlan) return;
		if (Math.abs(activeWorm.x - this.aiTargetX) <= 20) return;
		const planner = createPlanner({
			aiWorm: activeWorm,
			allWorms: worms,
			terrain,
			mapObjects,
			windX,
			difficulty,
			personality: this.aiPersonalities[activeWorm.id] ?? "default",
			availableAmmo: teamAmmo[activeWorm.team],
			gameMode,
			deadlineMs: 80,
			fixedPositionX: activeWorm.x,
		});
		planner.step(80);
		if (planner.isDone) {
			const p = planner.getPlan();
			if (p) {
				this.aiPlan = p;
				this.aiTargetX = activeWorm.x;
			}
		}
	}

	public pickAiRepositionTarget(
		w: Worm,
		worms: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
	): number {
		// 1. If injured, seek crate if reachable and landmine-safe
		if (w.health < w.maxHealth * 0.7) {
			let bestCrateX: number | null = null;
			let minCrateDist = Infinity;
			for (const obj of mapObjects) {
				if (obj.type === "health_crate" && !obj.isDestroyed) {
					const dist = Math.abs(obj.x - w.x);
					if (
						dist < minCrateDist &&
						dist < 400 &&
						WormAI.canWalkTo(terrain, w.x, w.y, obj.x, mapObjects)
					) {
						minCrateDist = dist;
						bestCrateX = obj.x;
					}
				}
			}
			if (bestCrateX !== null) return bestCrateX;
		}

		// 2. Evaluate candidate spots (-180px to +180px) for best line-of-sight cover & mine safety
		const enemies = worms.filter((e) => e.team !== w.team && e.isAlive);
		let bestX = w.x;
		let bestScore = -Infinity;

		for (let offset = -180; offset <= 180; offset += 30) {
			const candX = Math.max(30, Math.min(terrain.width - 30, w.x + offset));
			if (!WormAI.canWalkTo(terrain, w.x, w.y, candX, mapObjects)) continue;

			const groundY = terrain.getLocalGroundY(candX, w.y + 20, 20, 15);
			if (groundY === null || groundY >= terrain.waterY - 15) continue;
			const candY = groundY - 12;

			const cover = WormAI.evaluateCover(candX, candY, terrain, enemies);
			const mineRisk = WormAI.evaluateMineRisk(candX, candY, mapObjects);
			const crateScore = WormAI.evaluateCrates(
				candX,
				candY,
				mapObjects,
				w.health / w.maxHealth,
			);

			const score = cover + crateScore - mineRisk;
			if (score > bestScore) {
				bestScore = score;
				bestX = candX;
			}
		}

		return bestX;
	}
}
