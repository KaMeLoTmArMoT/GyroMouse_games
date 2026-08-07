import type { AITurnPlan } from "../ai/wormAI";
import type { EffectSystem } from "../effects/effects";
import type { CameraController } from "../engine/cameraController";
import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { Projectile } from "../physics/projectile";
import type { TerrainManager } from "../terrain/terrainManager";
import type { LobbyConfig, TeamAmmo, TurnPhase } from "../types";
import { PROJECTILE_MAX_SPEED, WEAPON_STATS } from "../types";
import { type HUD, WEAPON_LIST } from "../ui/hud";

export class MatchRenderer {
	public renderMatch(
		ctx: CanvasRenderingContext2D,
		canvas: HTMLCanvasElement,
		camera: CameraController,
		terrain: TerrainManager,
		worms: Worm[],
		mapObjects: MapObject[],
		projectiles: Projectile[],
		effects: EffectSystem,
		hud: HUD,
		activeWorm: Worm | null,
		activeWeaponIndex: number,
		chargePower: number,
		isCharging: boolean,
		windX: number,
		turnTimer: number,
		repositionTimer: number,
		phase: TurnPhase,
		lobbyConfig: LobbyConfig,
		teamAmmo: Record<"player" | "ai", TeamAmmo>,
		isAiDebugMode: boolean,
		aiPlan: AITurnPlan | null,
		lastAiPlan: AITurnPlan | null,
		aiDebugFrozen: boolean,
	): void {
		camera.updateCamera(phase, projectiles, activeWorm);

		// 1. Screen space: clear + fill dark background
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "#0f172a";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// 2. World space: apply camera zoom + pan
		camera.applyTransform(ctx, canvas.width, canvas.height);

		// Render Terrain & Water
		terrain.draw(ctx);

		// Render Interactive Map Objects (Barrels, Mines, Crates)
		mapObjects.forEach((obj) => obj.draw(ctx));

		// Render Worms
		worms.forEach((w) => w.draw(ctx, w === activeWorm));

		// Render Projectiles
		projectiles.forEach((p) => p.draw(ctx));

		// Render Particles / Effects
		effects.draw(ctx);

		// Trajectory sighting arc (Shown during AIM_FIRE phase or F3 AI Debug Mode)
		if (activeWorm?.isAlive && (phase === "AIM_FIRE" || isAiDebugMode)) {
			try {
				const safeIdx = Math.max(
					0,
					Math.min(WEAPON_LIST.length - 1, activeWeaponIndex),
				);
				const wid = WEAPON_LIST[safeIdx]?.id ?? "bazooka";
				const powerToDraw = isCharging ? chargePower : 0.6;
				const arcWind = WEAPON_LIST[safeIdx]?.affectedByWind ? windX : 0;
				hud.drawTrajectoryArc(ctx, activeWorm, powerToDraw, arcWind, wid);
			} catch (err) {
				console.error("[Wormix] Trajectory Arc Render Error:", err);
			}
		}

		// AI Debug Visualizations (World space: Candidates Heatmap, Target Path, Planned Arc)
		const activePlan = aiPlan || lastAiPlan;
		if (isAiDebugMode && activePlan) {
			try {
				this.renderAiDebugWorld(ctx, terrain, activeWorm, windX, activePlan);
			} catch (err) {
				console.error("[Wormix] AI Debug Render Error:", err);
			}
		}

		// 3. Back to screen space for UI overlay
		ctx.setTransform(1, 0, 0, 1, 0, 0);

		// Update AI Debug DOM Panel
		this.updateAiDebugOverlay(
			activeWorm,
			windX,
			isAiDebugMode,
			aiDebugFrozen,
			aiPlan || lastAiPlan,
		);

		// Calculate Team Total HPs
		const playerHp = worms
			.filter((w) => w.team === "player")
			.reduce((acc, w) => acc + w.health, 0);
		const aiHp = worms
			.filter((w) => w.team === "ai")
			.reduce((acc, w) => acc + w.health, 0);

		// Render Glassmorphism HUD overlay
		try {
			const activeTeam = activeWorm?.team ?? "player";
			hud.draw(
				ctx,
				canvas.width,
				canvas.height,
				phase,
				activeWorm,
				activeWeaponIndex,
				chargePower,
				isCharging,
				windX,
				turnTimer,
				playerHp,
				aiHp,
				true, // pointer mode default
				lobbyConfig.matchType === "pvp",
				teamAmmo[activeTeam as "player" | "ai"] ?? {},
				repositionTimer,
				isAiDebugMode,
			);
		} catch (err) {
			console.error("[Wormix] HUD Render Error:", err);
		}

		// Game Over Overlay
		if (phase === "GAME_OVER") {
			const redAlive = worms.filter(
				(w) => w.team === "player" && w.isAlive,
			).length;
			ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.fillStyle = redAlive > 0 ? "#22c55e" : "#ef4444";
			ctx.font = "bold 36px Outfit, sans-serif";
			ctx.textAlign = "center";
			ctx.fillText(
				redAlive > 0
					? "🏆 RED TEAM VICTORIOUS!"
					: "💀 DEFEAT - BLUE TEAM WINS!",
				canvas.width / 2,
				canvas.height / 2 - 20,
			);

			ctx.fillStyle = "#9ca3af";
			ctx.font = "16px Outfit, sans-serif";
			ctx.fillText(
				"Press ESC to open menu or refresh to replay",
				canvas.width / 2,
				canvas.height / 2 + 30,
			);
		}
	}

	private renderAiDebugWorld(
		ctx: CanvasRenderingContext2D,
		terrain: TerrainManager,
		activeWorm: Worm | null,
		windX: number,
		plan: AITurnPlan,
	): void {
		ctx.save();

		// 1. Position Candidates Heatmap
		if (plan.evals && plan.evals.length > 0) {
			const maxScore = Math.max(...plan.evals.map((e) => e.totalScore));
			const minScore = Math.min(...plan.evals.map((e) => e.totalScore));
			const scoreRange = maxScore - minScore || 1;

			for (const ev of plan.evals) {
				const norm = (ev.totalScore - minScore) / scoreRange;
				const isChosen = Math.abs(ev.x - plan.targetX) < 5;

				ctx.fillStyle = isChosen
					? "rgba(34, 197, 94, 0.85)"
					: norm > 0.65
						? "rgba(56, 189, 248, 0.55)"
						: norm > 0.35
							? "rgba(234, 179, 8, 0.55)"
							: "rgba(239, 68, 68, 0.45)";

				ctx.beginPath();
				ctx.arc(ev.x, ev.y, isChosen ? 14 : 8, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = isChosen ? "#ffffff" : "rgba(255, 255, 255, 0.3)";
				ctx.lineWidth = isChosen ? 2.5 : 1;
				ctx.stroke();

				ctx.font = isChosen
					? "bold 11px Outfit, sans-serif"
					: "9px Outfit, sans-serif";
				ctx.fillStyle = isChosen ? "#ffffff" : "#cbd5e1";
				ctx.textAlign = "center";
				ctx.fillText(`${Math.round(ev.totalScore)}`, ev.x, ev.y - 12);
			}
		}

		// 2. Target Walk Path & Flag Marker
		if (activeWorm) {
			ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.moveTo(activeWorm.x, activeWorm.y);
			ctx.lineTo(plan.targetX, activeWorm.y);
			ctx.stroke();
			ctx.setLineDash([]);

			ctx.font = "16px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("🚩", plan.targetX, activeWorm.y - 18);
		}

		// 3. Planned Trajectory Arc & Target Impact
		if (activeWorm) {
			const planX = plan.targetX;
			const planSurfaceY = terrain.getSurfaceY(planX);
			const planY = planSurfaceY - 12;
			const rad = (plan.targetAngle * Math.PI) / 180;
			const speed = plan.targetPower * PROJECTILE_MAX_SPEED[plan.weaponId];
			let vx = Math.cos(rad) * speed;
			let vy = Math.sin(rad) * speed;
			let px = planX + Math.cos(rad) * 20;
			let py = planY + Math.sin(rad) * 20;
			const hasWind = WEAPON_STATS[plan.weaponId].wind;
			const gravity = WEAPON_STATS[plan.weaponId].gravity;

			ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(px, py);

			for (let step = 0; step < 40; step++) {
				if (hasWind) vx += windX * 0.05;
				if (plan.weaponId !== "rifle") vy += gravity;
				px += vx;
				py += vy;
				ctx.lineTo(px, py);
				if (terrain.isSolidAt(px, py) || py >= terrain.waterY) break;
			}
			ctx.stroke();

			ctx.font = "18px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("🎯", px, py);
		}

		ctx.restore();
	}

	private updateAiDebugOverlay(
		activeWorm: Worm | null,
		windX: number,
		isAiDebugMode: boolean,
		aiDebugFrozen: boolean,
		plan: AITurnPlan | null,
	): void {
		const panelEl = document.getElementById("aiDebugPanel");
		const contentEl = document.getElementById("aiDebugContent");
		const freezeEl = document.getElementById("aiDebugFreezeBadge");
		if (!panelEl || !contentEl || !freezeEl) return;

		panelEl.hidden = !isAiDebugMode;
		if (!isAiDebugMode) return;

		freezeEl.hidden = !aiDebugFrozen;

		if (activeWorm?.team !== "ai") {
			contentEl.innerHTML = `<div>Waiting for AI turn...</div>`;
			return;
		}

		if (!plan) {
			contentEl.innerHTML = `<div>🤖 <b>${activeWorm.name}</b> is searching plan...</div>`;
			return;
		}

		contentEl.innerHTML = `
			<div>🤖 <b>${activeWorm.name}</b> [<code>${plan.personality || "default"}</code>]</div>
			<div>📍 Target X: <b>${Math.round(plan.targetX)}</b> (Current: ${Math.round(activeWorm.x)})</div>
			<div>🚀 Weapon: <b>${plan.weaponId.toUpperCase()}</b> (Angle: ${Math.round(plan.targetAngle)}°, Power: ${Math.round(plan.targetPower * 100)}%)</div>
			<div>💥 Est. Dmg: <b>${plan.enemyDamageEst ?? 0}</b> enemy | <b>${plan.selfDamageEst ?? 0}</b> self</div>
			<div>☠️ Est. Kills: <b>${plan.killsEst ?? 0}</b> | Water KO: <b>${plan.waterKnockoutsEst ?? 0}</b></div>
			<div>⏱️ Sims: <b>${plan.sims ?? 0}</b> | Wind: <b>${windX.toFixed(1)}</b></div>
		`;
	}
}
