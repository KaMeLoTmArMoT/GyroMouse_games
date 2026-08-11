import type { DungeonLevel } from "./level";
import {
	DIR_ANGLES,
	type Direction,
	type PlayerState,
	TILE_SIZE,
} from "./types";

export class Player {
	public x: number; // pixel position X
	public y: number; // pixel position Y
	public speed: number = 140; // pixels per sec
	public radius: number = 11; // collision radius
	public aimDirection: Direction = "S";
	public collectedKeys: Set<string> = new Set();

	constructor(startTileX: number = 2, startTileY: number = 2) {
		this.x = (startTileX + 0.5) * TILE_SIZE;
		this.y = (startTileY + 0.5) * TILE_SIZE;
	}

	public get tileX(): number {
		return Math.floor(this.x / TILE_SIZE);
	}

	public get tileY(): number {
		return Math.floor(this.y / TILE_SIZE);
	}

	public update(
		dt: number,
		moveVec: { dx: number; dy: number },
		aimDir: Direction,
		level: DungeonLevel,
	): void {
		this.aimDirection = aimDir;

		if (moveVec.dx === 0 && moveVec.dy === 0) return;

		const deltaX = moveVec.dx * this.speed * dt;
		const deltaY = moveVec.dy * this.speed * dt;

		// Move on X axis with collision
		const newX = this.x + deltaX;
		if (!level.checkBoundingCollision(newX, this.y, this.radius)) {
			this.x = newX;
		}

		// Move on Y axis with collision
		const newY = this.y + deltaY;
		if (!level.checkBoundingCollision(this.x, newY, this.radius)) {
			this.y = newY;
		}
	}

	public getState(): PlayerState {
		return {
			x: this.x,
			y: this.y,
			tileX: this.tileX,
			tileY: this.tileY,
			aimDirection: this.aimDirection,
			aimAngle: DIR_ANGLES[this.aimDirection],
			collectedKeys: Array.from(this.collectedKeys),
		};
	}

	public setState(state: PlayerState): void {
		this.x = state.x;
		this.y = state.y;
		this.aimDirection = state.aimDirection;
		this.collectedKeys = new Set(state.collectedKeys || []);
	}

	public render(ctx: CanvasRenderingContext2D): void {
		// Player Body (Pixel style character circle / body with highlight)
		ctx.save();

		// Shadow
		ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
		ctx.beginPath();
		ctx.ellipse(
			this.x,
			this.y + 8,
			this.radius,
			this.radius * 0.5,
			0,
			0,
			Math.PI * 2,
		);
		ctx.fill();

		// Outer Ring / Suit
		ctx.fillStyle = "#0284c7";
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#38bdf8";
		ctx.lineWidth = 2;
		ctx.stroke();

		// Inner Core / Helmet
		ctx.fillStyle = "#e0f2fe";
		ctx.beginPath();
		ctx.arc(this.x, this.y - 1, this.radius * 0.45, 0, Math.PI * 2);
		ctx.fill();

		// Aim Indicator Cone / Line
		const angle = DIR_ANGLES[this.aimDirection];
		const coneLength = 36;
		const halfArc = Math.PI / 4; // 90 deg cone = +/- 45 deg

		// Draw aim cone preview line
		ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
		ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
		ctx.lineWidth = 1.5;

		ctx.beginPath();
		ctx.moveTo(this.x, this.y);
		ctx.arc(this.x, this.y, coneLength, angle - halfArc, angle + halfArc);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		// Draw Aim Arrow Head
		const arrowDist = 28;
		const arrowX = this.x + Math.cos(angle) * arrowDist;
		const arrowY = this.y + Math.sin(angle) * arrowDist;

		ctx.fillStyle = "#facc15";
		ctx.beginPath();
		ctx.arc(arrowX, arrowY, 4, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}
}
