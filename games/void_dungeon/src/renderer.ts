import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import { TILE_SIZE, TileType } from "./types";

export class DungeonRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	public cameraX: number = 0;
	public cameraY: number = 0;
	public debugMode: boolean = false;

	constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
		this.canvas = canvas;
		this.ctx = ctx;
	}

	public updateCamera(player: Player): void {
		// Center camera on player smoothly
		const targetX = player.x - this.canvas.width / 2;
		const targetY = player.y - this.canvas.height / 2;

		this.cameraX += (targetX - this.cameraX) * 0.1;
		this.cameraY += (targetY - this.cameraY) * 0.1;
	}

	public render(level: DungeonLevel, player: Player): void {
		const ctx = this.ctx;
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// Background dark fill
		ctx.fillStyle = "#090d16";
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		ctx.save();
		// Apply camera transformation
		ctx.translate(-Math.floor(this.cameraX), -Math.floor(this.cameraY));

		// Visible viewport tile range
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
				const px = x * TILE_SIZE;
				const py = y * TILE_SIZE;

				this.drawTile(ctx, tile, px, py, x, y);
			}
		}

		// Render Player
		player.render(ctx);

		// Render Debug Grid & Info
		if (this.debugMode) {
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
	): void {
		switch (tile) {
			case TileType.WALL:
				ctx.fillStyle = "#1e293b";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.strokeStyle = "#334155";
				ctx.lineWidth = 1;
				ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
				// Top bevel
				ctx.fillStyle = "#475569";
				ctx.fillRect(px, py, TILE_SIZE, 3);
				break;

			case TileType.FLOOR:
				// Checkerboard subtle pattern
				ctx.fillStyle = (tx + ty) % 2 === 0 ? "#0f172a" : "#131c31";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				break;

			case TileType.EXIT_LOCKED:
				ctx.fillStyle = "#7f1d1d";
				ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
				ctx.strokeStyle = "#ef4444";
				ctx.lineWidth = 2;
				ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
				// Padlock icon
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

	private renderDebugGrid(
		ctx: CanvasRenderingContext2D,
		startX: number,
		endX: number,
		startY: number,
		endY: number,
	): void {
		ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
		ctx.lineWidth = 1;
		ctx.font = "10px monospace";
		ctx.fillStyle = "rgba(56, 189, 248, 0.5)";

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
