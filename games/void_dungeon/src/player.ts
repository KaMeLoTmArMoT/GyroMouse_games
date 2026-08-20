import type { DungeonLevel } from "./level";
import {
	DIR_ANGLES,
	DIR_VECTORS,
	type Direction,
	type PlayerState,
	TILE_SIZE,
	TileType,
} from "./types";

export class Player {
	public x: number; // pixel position X
	public y: number; // pixel position Y
	public speed: number = 140; // pixels per sec
	public radius: number = 11; // collision radius
	public aimDirection: Direction = "S";
	public collectedKeys: Set<string> = new Set();
	public onWin?: () => void;
	public onKeyPickup?: (color: string) => void;

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
		interactPressed: boolean = false,
	): void {
		this.aimDirection = aimDir;

		if (moveVec.dx !== 0 || moveVec.dy !== 0) {
			const deltaX = moveVec.dx * this.speed * dt;
			const deltaY = moveVec.dy * this.speed * dt;

			const newX = this.x + deltaX;
			if (!level.checkBoundingCollision(newX, this.y, this.radius)) {
				this.x = newX;
			} else if (moveVec.dy === 0 && Math.abs(deltaX) > 0.001) {
				// Corner sliding when moving purely horizontally
				const nudge = this.speed * dt * 0.8;
				if (!level.checkBoundingCollision(newX, this.y - 6, this.radius)) {
					this.y -= nudge;
				} else if (!level.checkBoundingCollision(newX, this.y + 6, this.radius)) {
					this.y += nudge;
				}
			}

			const newY = this.y + deltaY;
			if (!level.checkBoundingCollision(this.x, newY, this.radius)) {
				this.y = newY;
			} else if (moveVec.dx === 0 && Math.abs(deltaY) > 0.001) {
				// Corner sliding when moving purely vertically
				const nudge = this.speed * dt * 0.8;
				if (!level.checkBoundingCollision(this.x - 6, newY, this.radius)) {
					this.x -= nudge;
				} else if (!level.checkBoundingCollision(this.x + 6, newY, this.radius)) {
					this.x += nudge;
				}
			}

			// Try pushing crate when moving towards crate
			if (level.crateManager) {
				level.crateManager.tryPushCrate(
					this.tileX,
					this.tileY,
					moveVec.dx,
					moveVec.dy,
					level,
				);
			}
		} else if (interactPressed && level.crateManager) {
			// Try pushing crate in player's current aim direction
			const aimVec = DIR_VECTORS[this.aimDirection];
			level.crateManager.tryPushCrate(
				this.tileX,
				this.tileY,
				aimVec.x,
				aimVec.y,
				level,
			);
		}

		// Check Key Pickups
		for (const key of level.entities.keys) {
			if (key.collected) continue;

			const keyPx = (key.tileX + 0.5) * TILE_SIZE;
			const keyPy = (key.tileY + 0.5) * TILE_SIZE;
			const dist = Math.hypot(this.x - keyPx, this.y - keyPy);

			if (dist <= TILE_SIZE * 0.75) {
				key.collected = true;
				this.collectedKeys.add(key.color);
				level.setTile(key.tileX, key.tileY, TileType.FLOOR);

				if (this.onKeyPickup) this.onKeyPickup(key.color);

				// Unlock Exit Door when all 3 keys collected!
				if (this.collectedKeys.size >= 3) {
					level.setTile(level.exitTile.x, level.exitTile.y, TileType.EXIT_OPEN);
				}
			}
		}

		// Check Win Condition (stepping on open exit door)
		const currentTile = level.getTile(this.tileX, this.tileY);
		if (currentTile === TileType.EXIT_OPEN && this.onWin) {
			this.onWin();
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
		const halfArc = Math.PI / 4;

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
