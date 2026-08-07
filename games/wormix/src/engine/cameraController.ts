import type { Worm } from "../entities/worm";
import type { Projectile } from "../physics/projectile";
import type { TurnPhase } from "../types";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../types";

export class CameraController {
	public scale: number = 1;
	public x: number = WORLD_WIDTH / 2;
	public y: number = WORLD_HEIGHT / 2;

	public readonly MIN_SCALE: number = 0.3;
	public readonly MAX_SCALE: number = 2.5;
	public readonly ZOOM_STEP: number = 1.2;

	public resetToFit(
		canvasWidth: number,
		canvasHeight: number,
		worldWidth: number,
		worldHeight: number,
	): void {
		this.scale = Math.max(
			this.MIN_SCALE,
			Math.min(
				this.MAX_SCALE,
				Math.min(canvasWidth / worldWidth, canvasHeight / worldHeight),
			),
		);
		this.x = worldWidth / 2;
		this.y = worldHeight / 2;
	}

	public zoomIn(): void {
		this.scale = Math.min(this.MAX_SCALE, this.scale * this.ZOOM_STEP);
	}

	public zoomOut(): void {
		this.scale = Math.max(this.MIN_SCALE, this.scale / this.ZOOM_STEP);
	}

	public focusOnWorm(w: Worm | null): void {
		if (w) {
			this.x = w.x;
			this.y = w.y - 30;
		}
	}

	public screenToWorld(
		screenX: number,
		screenY: number,
		canvasWidth: number,
		canvasHeight: number,
	): { x: number; y: number } {
		return {
			x: (screenX - canvasWidth / 2) / this.scale + this.x,
			y: (screenY - canvasHeight / 2) / this.scale + this.y,
		};
	}

	public updateCamera(
		phase: TurnPhase,
		projectiles: Projectile[],
		focusWorm: Worm | null,
	): void {
		let targetX: number | null = null;
		let targetY: number | null = null;

		if (phase === "PROJECTILE_FLIGHT" && projectiles.length > 0) {
			const p = projectiles[0];
			targetX = p.x;
			targetY = p.y;
		} else if (focusWorm) {
			targetX = focusWorm.x;
			targetY = focusWorm.y - 30;
		}

		if (targetX === null || targetY === null) return;

		const k = 0.15;
		this.x += (targetX - this.x) * k;
		this.y += (targetY - this.y) * k;
	}

	public applyTransform(
		ctx: CanvasRenderingContext2D,
		canvasWidth: number,
		canvasHeight: number,
	): void {
		ctx.setTransform(
			this.scale,
			0,
			0,
			this.scale,
			canvasWidth / 2 - this.x * this.scale,
			canvasHeight / 2 - this.y * this.scale,
		);
	}
}
