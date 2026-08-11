import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import { DIR_ANGLES, TILE_SIZE } from "./types";
import { type VisibilityMap, VisibilityState } from "./visibility";

export interface TorchEntity {
	id: string;
	tileX: number;
	tileY: number;
	flickerOffset: number;
	radius: number;
}

export interface DustParticle {
	x: number; // pixel X relative to map
	y: number; // pixel Y relative to map
	vx: number;
	vy: number;
	size: number;
	alpha: number;
	phase: number;
}

export class LightingManager {
	public torches: TorchEntity[] = [];
	public dustParticles: DustParticle[] = [];
	private offscreenCanvas: HTMLCanvasElement;
	private offscreenCtx: CanvasRenderingContext2D;

	constructor() {
		this.offscreenCanvas = document.createElement("canvas");
		this.offscreenCtx = this.offscreenCanvas.getContext(
			"2d",
		) as CanvasRenderingContext2D;
		this.initDustParticles(60);
	}

	public addTorch(id: string, tileX: number, tileY: number): void {
		this.torches.push({
			id,
			tileX,
			tileY,
			flickerOffset: Math.random() * Math.PI * 2,
			radius: 90 + Math.random() * 20,
		});
	}

	public clear(): void {
		this.torches = [];
	}

	private initDustParticles(count: number): void {
		this.dustParticles = [];
		for (let i = 0; i < count; i++) {
			this.dustParticles.push({
				x: Math.random() * 1280,
				y: Math.random() * 960,
				vx: (Math.random() - 0.5) * 8,
				vy: -4 - Math.random() * 8,
				size: 1 + Math.random() * 2,
				alpha: 0.15 + Math.random() * 0.45,
				phase: Math.random() * Math.PI * 2,
			});
		}
	}

	public update(dt: number, levelWidthPx: number, levelHeightPx: number): void {
		// Update Dust Particles
		for (const p of this.dustParticles) {
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.phase += dt * 2;

			// Wrap around boundaries
			if (p.x < 0) p.x = levelWidthPx;
			if (p.x > levelWidthPx) p.x = 0;
			if (p.y < 0) p.y = levelHeightPx;
			if (p.y > levelHeightPx) p.y = 0;
		}
	}

	/**
	 * Renders smooth radial lighting mask overlay over the viewport
	 */
	public renderLightingMask(
		mainCtx: CanvasRenderingContext2D,
		canvasWidth: number,
		canvasHeight: number,
		cameraX: number,
		cameraY: number,
		player: Player,
		_level: DungeonLevel,
		visMap: VisibilityMap,
		fogEnabled: boolean,
		time: number,
		sonarActive: boolean = false,
	): void {
		if (!fogEnabled) return;

		if (
			this.offscreenCanvas.width !== canvasWidth ||
			this.offscreenCanvas.height !== canvasHeight
		) {
			this.offscreenCanvas.width = canvasWidth;
			this.offscreenCanvas.height = canvasHeight;
		}

		const ctx = this.offscreenCtx;
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);

		// Fill offscreen canvas with dark void fog
		ctx.fillStyle = "rgba(2, 6, 23, 0.96)";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		// Cut out light using destination-out composite mode for ultra smooth radial gradients
		ctx.save();
		ctx.globalCompositeOperation = "destination-out";

		const px = player.x - cameraX;
		const py = player.y - cameraY;

		// 1. Soft Omni-directional ambient glow around player (radius ~85px)
		const omniGrad = ctx.createRadialGradient(px, py, 10, px, py, 95);
		omniGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
		omniGrad.addColorStop(0.6, "rgba(0, 0, 0, 0.85)");
		omniGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

		ctx.fillStyle = omniGrad;
		ctx.beginPath();
		ctx.arc(px, py, 95, 0, Math.PI * 2);
		ctx.fill();

		// 2. Smooth Radial Directional Flashlight Cone
		const angle = DIR_ANGLES[player.aimDirection];
		const coneRange = sonarActive ? 420 : 260;
		const coneArc = sonarActive ? Math.PI * 1.1 : Math.PI / 1.8;
		const halfArc = coneArc / 2;

		const coneGrad = ctx.createRadialGradient(px, py, 15, px, py, coneRange);
		coneGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
		coneGrad.addColorStop(0.5, "rgba(0, 0, 0, 0.9)");
		coneGrad.addColorStop(0.85, "rgba(0, 0, 0, 0.5)");
		coneGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

		ctx.fillStyle = coneGrad;
		ctx.beginPath();
		ctx.moveTo(px, py);
		ctx.arc(px, py, coneRange, angle - halfArc, angle + halfArc);
		ctx.closePath();
		ctx.fill();

		// 3. Torch Warm Light Radiance
		for (const torch of this.torches) {
			const vis = visMap.getVisibility(torch.tileX, torch.tileY);
			if (vis === VisibilityState.UNSEEN) continue;

			const tPx = (torch.tileX + 0.5) * TILE_SIZE - cameraX;
			const tPy = (torch.tileY + 0.5) * TILE_SIZE - cameraY;

			const flicker = Math.sin(time * 10 + torch.flickerOffset) * 8;
			const currentRadius = Math.max(40, torch.radius + flicker);

			const torchGrad = ctx.createRadialGradient(
				tPx,
				tPy,
				5,
				tPx,
				tPy,
				currentRadius,
			);
			torchGrad.addColorStop(0, "rgba(0, 0, 0, 0.95)");
			torchGrad.addColorStop(0.6, "rgba(0, 0, 0, 0.6)");
			torchGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

			ctx.fillStyle = torchGrad;
			ctx.beginPath();
			ctx.arc(tPx, tPy, currentRadius, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.restore();

		// Draw soft lighting mask on top of main canvas
		mainCtx.drawImage(this.offscreenCanvas, 0, 0);
	}

	/**
	 * Renders torch entities and flame particles
	 */
	public renderTorches(
		ctx: CanvasRenderingContext2D,
		visMap: VisibilityMap,
		time: number,
	): void {
		for (const torch of this.torches) {
			if (
				visMap.getVisibility(torch.tileX, torch.tileY) ===
				VisibilityState.UNSEEN
			) {
				continue;
			}

			const px = (torch.tileX + 0.5) * TILE_SIZE;
			const py = (torch.tileY + 0.5) * TILE_SIZE;

			ctx.save();
			ctx.translate(px, py);

			// Wall Torch Bracket
			ctx.fillStyle = "#475569";
			ctx.fillRect(-3, -2, 6, 8);
			ctx.fillStyle = "#1e293b";
			ctx.fillRect(-2, 2, 4, 6);

			// Flickering Warm Outer Glow
			const flicker = Math.sin(time * 12 + torch.flickerOffset) * 0.15;
			ctx.fillStyle = `rgba(249, 115, 22, ${0.4 + flicker})`;
			ctx.beginPath();
			ctx.arc(0, -6, 12, 0, Math.PI * 2);
			ctx.fill();

			// Core Flame
			ctx.fillStyle = "#facc15";
			ctx.beginPath();
			ctx.arc(0, -6, 4 + Math.sin(time * 15) * 1, 0, Math.PI * 2);
			ctx.fill();

			// White Hot Flame Tip
			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(0, -7, 2, 0, Math.PI * 2);
			ctx.fill();

			ctx.restore();
		}
	}

	/**
	 * Renders floating dust motes illuminated by vision cone and torch light
	 */
	public renderDustParticles(
		ctx: CanvasRenderingContext2D,
		player: Player,
		visMap: VisibilityMap,
		time: number,
	): void {
		ctx.save();
		const angle = DIR_ANGLES[player.aimDirection];
		const coneArc = Math.PI / 1.8;
		const halfArc = coneArc / 2;

		for (const p of this.dustParticles) {
			const tileX = Math.floor(p.x / TILE_SIZE);
			const tileY = Math.floor(p.y / TILE_SIZE);

			// Only render if tile is explored/revealed
			if (visMap.getVisibility(tileX, tileY) === VisibilityState.UNSEEN) {
				continue;
			}

			// Check if particle is inside player flashlight vision cone
			const dx = p.x - player.x;
			const dy = p.y - player.y;
			const dist = Math.hypot(dx, dy);

			let isIlluminated = false;
			if (dist <= 260) {
				const pAngle = Math.atan2(dy, dx);
				let angleDiff = pAngle - angle;
				while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
				while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

				if (Math.abs(angleDiff) <= halfArc || dist <= 85) {
					isIlluminated = true;
				}
			}

			const alphaScale = isIlluminated ? 1.0 : 0.25;
			const pulseAlpha =
				(p.alpha + Math.sin(time * 3 + p.phase) * 0.15) * alphaScale;

			ctx.fillStyle = isIlluminated
				? `rgba(224, 242, 254, ${pulseAlpha})`
				: `rgba(148, 163, 184, ${pulseAlpha * 0.5})`;

			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}
}
