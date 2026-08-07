import type { Worm } from "../entities/worm";
import {
	PROJECTILE_GRAVITY,
	PROJECTILE_MAX_SPEED,
	type TeamAmmo,
	type TurnPhase,
	type WeaponId,
	type WeaponInfo,
} from "../types";

export const WEAPON_LIST: WeaponInfo[] = [
	{
		id: "bazooka",
		name: "Bazooka",
		icon: "🚀",
		description: "Heavy explosive missile, affected by wind",
		affectedByWind: true,
	},
	{
		id: "grenade",
		name: "Grenade",
		icon: "💣",
		description: "Bounces off terrain, 3s fuse explosion",
		affectedByWind: false,
	},
	{
		id: "cluster",
		name: "Cluster Bomb",
		icon: "💥",
		description: "Splits into 5 mini-bombs on impact",
		affectedByWind: true,
	},
	{
		id: "acid_bomb",
		name: "Acid Bomb",
		icon: "🧪",
		description: "Explosion + releases acid that dissolves terrain",
		affectedByWind: false,
	},
	{
		id: "sand_bomb",
		name: "Sand Bomb",
		icon: "⏳",
		description: "Creates a sand mound on impact",
		affectedByWind: false,
	},
	{
		id: "drill",
		name: "Drill Missile",
		icon: "🔨",
		description: "Bores through terrain up to ~1.5s before exploding",
		affectedByWind: true,
	},
	{
		id: "mortar",
		name: "Mortar",
		icon: "💣",
		description: "Airburst on fuse timer, rains shrapnel downward",
		affectedByWind: true,
	},
	{
		id: "dynamite",
		name: "Dynamite",
		icon: "🧨",
		description: "Short throw, massive blast radius, 4s fuse",
		affectedByWind: false,
	},
	{
		id: "rifle",
		name: "Rifle",
		icon: "🎯",
		description: "Perfectly straight line, no drop, no terrain destruction",
		affectedByWind: false,
	},
	{
		id: "shotgun",
		name: "Shotgun",
		icon: "🔫",
		description: "Raycast along aim direction, double tap",
		affectedByWind: false,
	},
];

export class HUD {
	public showTrajectory: boolean = true;

	public draw(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		phase: TurnPhase,
		activeWorm: Worm | null,
		activeWeaponIndex: number,
		chargePower: number,
		isCharging: boolean,
		windX: number,
		turnTimer: number,
		playerTeamHp: number,
		aiTeamHp: number,
		isPcMode: boolean,
		isPvP: boolean,
		teamAmmo: TeamAmmo = {},
		repositionTimer: number = 0,
		_isAiDebugMode: boolean = false,
		isBotVsBot: boolean = false,
	): void {
		ctx.save();

		// 1. Top Bar: Team Health & Animated Wind Gauge & Turn Timer
		this.drawTopBar(ctx, width, playerTeamHp, aiTeamHp, windX, turnTimer);

		// 2. Center Turn Phase Banner
		this.drawPhaseBanner(
			ctx,
			width,
			phase,
			isPcMode,
			isPvP,
			activeWorm?.team ?? "player",
			repositionTimer,
			isBotVsBot,
		);

		// 3. Power Charge Meter (When holding Space)
		if (isCharging && activeWorm) {
			this.drawPowerMeter(ctx, width, height, chargePower);
		}

		// 5. Weapon Selection Toolbar (Bottom) — show during all active match phases
		if (phase !== "GAME_OVER") {
			this.drawWeaponToolbar(
				ctx,
				width,
				height,
				activeWeaponIndex,
				phase === "WEAPON_SELECT",
				teamAmmo,
			);
		}

		ctx.restore();
	}

	private drawTopBar(
		ctx: CanvasRenderingContext2D,
		width: number,
		playerHp: number,
		aiHp: number,
		windX: number,
		timer: number,
	): void {
		// Red Team (Player) HP
		ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
		ctx.font = "bold 16px Outfit, sans-serif";
		ctx.textAlign = "left";
		ctx.fillText(`🔴 RED TEAM: ${playerHp} HP`, 145, 30);

		// Blue Team (AI) HP
		ctx.fillStyle = "rgba(59, 130, 246, 0.85)";
		ctx.textAlign = "right";
		ctx.fillText(`🔵 BLUE TEAM: ${aiHp} HP`, width - 75, 30);

		// Center Timer & Animated Wind Gauge
		ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.roundRect(width / 2 - 130, 8, 260, 48, 12);
		ctx.fill();
		ctx.stroke();

		// Timer Clock
		ctx.fillStyle = timer <= 10 ? "#ef4444" : "#facc15";
		ctx.font = "bold 20px Outfit, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(`⏱️ ${Math.ceil(timer)}s`, width / 2 - 60, 38);

		// Animated Wind Gauge
		const windSpeed = Math.abs(Math.round(windX * 10));
		const windArrow = windX > 0 ? "➔" : windX < 0 ? "⬅" : "•";
		let windClass = "CALM";
		let windColor = "#38bdf8";
		if (windSpeed > 15) {
			windClass = "STORM";
			windColor = "#ef4444";
		} else if (windSpeed > 8) {
			windClass = "GALE";
			windColor = "#f97316";
		} else if (windSpeed > 3) {
			windClass = "BREEZE";
			windColor = "#38bdf8";
		}

		ctx.fillStyle = windColor;
		ctx.font = "bold 15px Outfit, sans-serif";
		ctx.fillText(
			`${windArrow} ${windSpeed} (${windClass})`,
			width / 2 + 45,
			34,
		);

		// Animated horizontal wind particles inside HUD bar
		const time = Date.now() * 0.003 * (windX || 1);
		ctx.strokeStyle = windColor;
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.5;
		for (let i = 0; i < 3; i++) {
			const px = width / 2 + 10 + ((time * 20 + i * 25) % 65);
			const py = 40 + (i % 2) * 3;
			ctx.beginPath();
			ctx.moveTo(px, py);
			ctx.lineTo(px + (windX > 0 ? 8 : -8), py);
			ctx.stroke();
		}
		ctx.globalAlpha = 1.0;
	}

	private drawPhaseBanner(
		ctx: CanvasRenderingContext2D,
		width: number,
		phase: TurnPhase,
		isPcMode: boolean,
		isPvP: boolean = false,
		activeTeam: "player" | "ai" = "player",
		repositionTimer: number = 0,
		isBotVsBot: boolean = false,
	): void {
		if (phase === "GAME_OVER" || phase === "PROJECTILE_FLIGHT") return;

		let bannerText = "";
		let hintText = "";

		if (isBotVsBot) {
			const teamName = activeTeam === "player" ? "🔴 RED BOT" : "🔵 BLUE BOT";
			if (phase === "MOVE") {
				bannerText = `🤖 ${teamName} — THINKING & MOVING`;
				hintText = "Bot vs Bot Match • Press F3 for AI Debug";
			} else if (phase === "WEAPON_SELECT") {
				bannerText = `🤖 ${teamName} — WEAPON SELECT`;
				hintText = "Bot vs Bot Match • Press F3 for AI Debug";
			} else if (phase === "AIM_FIRE") {
				bannerText = `🤖 ${teamName} — AIM & FIRE`;
				hintText = "Bot vs Bot Match • Press F3 for AI Debug";
			} else if (phase === "REPOSITION") {
				bannerText = `🤖 ${teamName} — RUN FOR COVER!`;
				hintText = `${Math.ceil(repositionTimer)}s — Bot repositioning`;
			}
		} else if (phase === "MOVE") {
			bannerText = isPvP
				? activeTeam === "player"
					? "🔴 RED PLAYER TURN — MOVE"
					: "🔵 BLUE PLAYER TURN — MOVE"
				: "STEP 1: MOVEMENT PHASE";
			hintText = isPcMode
				? "WASD / Arrow Keys to walk/jump • Tab/Q/E to switch worm • Press Enter when ready"
				: "Move via Gyro / Steering • Switch worm on HUD • Tap Ready button";
		} else if (phase === "WEAPON_SELECT") {
			bannerText = "STEP 2: SELECT WEAPON";
			hintText = "Click/Tap weapon in bottom bar or press Number keys 1-0";
		} else if (phase === "AIM_FIRE") {
			bannerText = "STEP 3: AIM & FIRE";
			hintText = isPcMode
				? "Up/Down / Gyro tilt to AIM • Hold SPACE to charge power and release to FIRE"
				: "Tilt Gyro to AIM • Hold & Release FIRE button on HUD";
		} else if (phase === "REPOSITION") {
			bannerText = "RUN FOR COVER!";
			hintText = `${Math.ceil(repositionTimer)}s remaining — Move to safe spot before turn ends`;
		}

		if (!bannerText) return;

		ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
		ctx.strokeStyle = "#38bdf8";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.roundRect(width / 2 - 220, 65, 440, 42, 10);
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = "#facc15";
		ctx.font = "bold 14px Outfit, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(bannerText, width / 2, 82);

		ctx.fillStyle = "#9ca3af";
		ctx.font = "12px Outfit, sans-serif";
		ctx.fillText(hintText, width / 2, 98);
	}

	/** Draw collision-aware dynamic trajectory arc in world space. */
	public drawTrajectoryArc(
		ctx: CanvasRenderingContext2D,
		worm: Worm,
		power: number,
		windX: number,
		weaponId: WeaponId,
		terrain?: any,
	): void {
		if (!this.showTrajectory) return;

		ctx.save();
		const tip = worm.getCannonTip();
		const rad = (worm.aimAngle * Math.PI) / 180;
		const maxSpeed = PROJECTILE_MAX_SPEED[weaponId] ?? 20;
		const speed = Math.max(0.2, power) * maxSpeed;

		let vx = Math.cos(rad) * speed;
		let vy = Math.sin(rad) * speed;
		let px = tip.x;
		let py = tip.y;

		const points: { x: number; y: number }[] = [{ x: px, y: py }];
		const isRifle = weaponId === "rifle";
		const gravity = PROJECTILE_GRAVITY[weaponId] ?? 0.5;

		for (let step = 0; step < 40; step++) {
			if (
				weaponId === "bazooka" ||
				weaponId === "cluster" ||
				weaponId === "drill" ||
				weaponId === "mortar"
			) {
				vx += windX * 0.05;
			}
			if (!isRifle) {
				vy += gravity;
			}
			px += vx;
			py += vy;
			points.push({ x: px, y: py });

			if (terrain?.isSolidAt?.(px, py)) {
				break; // Truncate line cleanly at terrain impact!
			}
		}

		// 1. Black Outline Stroke
		ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
		ctx.lineWidth = 5;
		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(points[i].x, points[i].y);
		}
		ctx.stroke();

		// 2. High-Contrast Dashed Line
		ctx.strokeStyle = isRifle ? "#38bdf8" : "#facc15";
		ctx.lineWidth = 2.5;
		ctx.setLineDash([6, 4]);
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(points[i].x, points[i].y);
		}
		ctx.stroke();
		ctx.setLineDash([]);

		// 3. Glowing Trajectory Dots
		ctx.fillStyle = isRifle ? "#7dd3fc" : "#fef08a";
		for (let i = 1; i < points.length; i += 3) {
			ctx.beginPath();
			ctx.arc(points[i].x, points[i].y, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		// 4. Target Crosshair / Reticle at predicted impact point
		const endP = points[points.length - 1];
		const pulseRadius = 7 + Math.sin(Date.now() * 0.01) * 2;
		ctx.strokeStyle = "#ef4444";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(endP.x, endP.y, pulseRadius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = "#ef4444";
		ctx.beginPath();
		ctx.arc(endP.x, endP.y, 3, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}

	private drawPowerMeter(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		chargePower: number,
	): void {
		const barW = 300;
		const barH = 22;
		const barX = width / 2 - barW / 2;
		const barY = height - 120;

		ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
		ctx.strokeStyle = "#facc15";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(barX - 4, barY - 4, barW + 8, barH + 8, 8);
		ctx.fill();
		ctx.stroke();

		const powerGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
		powerGrad.addColorStop(0, "#22c55e");
		powerGrad.addColorStop(0.6, "#eab308");
		powerGrad.addColorStop(1, "#ef4444");

		ctx.fillStyle = powerGrad;
		ctx.fillRect(barX, barY, barW * chargePower, barH);

		ctx.fillStyle = "#ffffff";
		ctx.font = "bold 13px Outfit, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(
			`POWER: ${Math.round(chargePower * 100)}%`,
			width / 2,
			barY + 16,
		);
	}

	private drawWeaponToolbar(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		activeIndex: number,
		isSelecting: boolean,
		teamAmmo: TeamAmmo = {},
	): void {
		const cardW = 60;
		const cardH = 50;
		const gap = 8;
		const totalW = WEAPON_LIST.length * (cardW + gap) - gap;
		const startX = width / 2 - totalW / 2;
		const startY = height - 70;
		const safeActiveIndex = Math.max(
			0,
			Math.min(WEAPON_LIST.length - 1, activeIndex),
		);

		ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
		ctx.beginPath();
		ctx.roundRect(startX - 12, startY - 8, totalW + 24, cardH + 16, 14);
		ctx.fill();

		WEAPON_LIST.forEach((w, i) => {
			const x = startX + i * (cardW + gap);
			const isSelected = i === safeActiveIndex;
			const ammoCount = teamAmmo[w.id];
			const isInfinite = ammoCount === undefined; // bazooka (absent from map)
			const isDepleted = ammoCount !== undefined && ammoCount <= 0;

			ctx.fillStyle = isSelected
				? "rgba(56, 189, 248, 0.3)"
				: "rgba(255, 255, 255, 0.05)";
			ctx.strokeStyle = isSelected
				? isSelecting
					? "#facc15"
					: "#38bdf8"
				: "rgba(255, 255, 255, 0.15)";
			ctx.lineWidth = isSelected ? 2 : 1;

			ctx.beginPath();
			ctx.roundRect(x, startY, cardW, cardH, 8);
			ctx.fill();
			ctx.stroke();

			// Dim depleted weapons
			if (isDepleted) {
				ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
				ctx.fillRect(x, startY, cardW, cardH);
			}

			ctx.font = "20px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText(w.icon, x + cardW / 2, startY + 28);

			ctx.font = "9px Outfit, sans-serif";
			ctx.fillStyle = isSelected ? "#ffffff" : "#9ca3af";
			ctx.fillText(w.name, x + cardW / 2, startY + 44);

			// Ammo count badge (skip infinite weapons)
			if (!isInfinite) {
				ctx.font = "bold 10px Outfit, sans-serif";
				ctx.fillStyle = isDepleted ? "#ef4444" : "#22c55e";
				ctx.fillText(`×${ammoCount}`, x + cardW / 2, startY + cardH + 12);
			}
		});
	}
}
