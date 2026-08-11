import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import { TILE_SIZE, TileType } from "./types";
import { type VisibilityMap, VisibilityState } from "./visibility";

export interface RenderModes {
	fogEnabled: boolean; // Alt+1 (Normal = true), Alt+2 (Full vision = false)
	showGrid: boolean; // Alt+3
	showESP: boolean; // Alt+4 (Key & Exit markers visible through walls)
}

export class DungeonRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	public cameraX: number = 0;
	public cameraY: number = 0;
	public modes: RenderModes = {
		fogEnabled: true,
		showGrid: false,
		showESP: false,
	};

	constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
		this.canvas = canvas;
		this.ctx = ctx;
	}

	public updateCamera(player: Player): void {
		const targetX = player.x - this.canvas.width / 2;
		const targetY = player.y - this.canvas.height / 2;

		this.cameraX += (targetX - this.cameraX) * 0.1;
		this.cameraY += (targetY - this.cameraY) * 0.1;
	}

	public render(
		level: DungeonLevel,
		player: Player,
		visMap: VisibilityMap,
	): void {
		const ctx = this.ctx;
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// Dark void background
		ctx.fillStyle = "#020617";
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		ctx.save();
		ctx.translate(-Math.floor(this.cameraX), -Math.floor(this.cameraY));

		const startTileX = Math.max(0, Math.floor(this.cameraX / TILE_SIZE) - 1);
		const endTileX = Math.min(
			level.width,
			Math.ceil((this.cameraX + this.canvas.width) / TILE_SIZE) + 1,
		);
		const startTileY = Math.max(0, Math.floor(this.cameraY / TILE_SIZE) - 1);
		const endTileY = Math.min(
			level.height,
			Math.ceil((this.cameraY + this.canvas.height) / TILE_SIZE) + 1,
		);

		// Render Level Tiles
		for (let y = startTileY; y < endTileY; y++) {
			for (let x = startTileX; x < endTileX; x++) {
				const tile = level.getTile(x, y);
				const vis = visMap.getVisibility(x, y);
				const px = x * TILE_SIZE;
				const py = y * TILE_SIZE;

				// Skip completely unseen tiles if fog enabled (remains black)
				if (this.modes.fogEnabled && vis === VisibilityState.UNSEEN) {
					continue;
				}

				this.drawTile(ctx, tile, px, py, x, y, vis);

				// Draw Fog overlay for REVEALED tiles (memory)
				if (this.modes.fogEnabled && vis === VisibilityState.REVEALED) {
					ctx.fillStyle = "rgba(2, 6, 23, 0.65)";
					ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				}
			}
		}

		// Render Player
		player.render(ctx);

		// Render ESP Markers if Alt+4 mode active
		if (this.modes.showESP) {
			this.renderESP(ctx, level);
		}

		// Render Debug Grid if Alt+3 mode active
		if (this.modes.showGrid) {
			this.renderDebugGrid(ctx, startTileX, endTileX, startTileY, endTileY);
		}

		ctx.restore();
	}

	private drawTile(
		ctx: CanvasRenderingContext2D,
		tile: TileType,
		px: number,
		py: number,
		tx: number,
		ty: number,
		_vis: VisibilityState,
	): void {
		switch (tile) {
			case TileType.WALL:
				ctx.fillStyle = "#1e293b";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.strokeStyle = "#334155";
				ctx.lineWidth = 1;
				ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
				ctx.fillStyle = "#475569";
				ctx.fillRect(px, py, TILE_SIZE, 3);
				break;

			case TileType.FLOOR:
				ctx.fillStyle = (tx + ty) % 2 === 0 ? "#0f172a" : "#131c31";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				break;

			case TileType.EXIT_LOCKED:
				ctx.fillStyle = "#7f1d1d";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.strokeStyle = "#ef4444";
				ctx.lineWidth = 2;
				ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
				ctx.fillStyle = "#facc15";
				ctx.fillRect(px + 12, py + 14, 8, 10);
				break;

			case TileType.EXIT_OPEN:
				ctx.fillStyle = "#065f46";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.fillStyle = "#34d399";
				ctx.fillRect(px + 8, py + 8, TILE_SIZE - 16, TILE_SIZE - 16);
				break;

			default:
				ctx.fillStyle = "#0f172a";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				break;
		}
	}

	private renderESP(ctx: CanvasRenderingContext2D, level: DungeonLevel): void {
		const exitPx = (level.exitTile.x + 0.5) * TILE_SIZE;
		const exitPy = (level.exitTile.y + 0.5) * TILE_SIZE;

		ctx.save();
		ctx.fillStyle = "#ef4444";
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(exitPx, exitPy, 12, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.font = "bold 10px sans-serif";
		ctx.fillStyle = "#ffffff";
		ctx.textAlign = "center";
		ctx.fillText("EXIT", exitPx, exitPy + 4);
		ctx.restore();
	}

	private renderDebugGrid(
		ctx: CanvasRenderingContext2D,
		startX: number,
		endX: number,
		startY: number,
		endY: number,
	): void {
		ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
		ctx.lineWidth = 1;
		ctx.font = "10px monospace";
		ctx.fillStyle = "rgba(56, 189, 248, 0.6)";

		for (let y = startY; y < endY; y++) {
			for (let x = startX; x < endX; x++) {
				const px = x * TILE_SIZE;
				const py = y * TILE_SIZE;
				ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.fillText(`${x},${y}`, px + 2, py + 12);
			}
		}
	}
}
