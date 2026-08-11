import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import type { RenderModes } from "./renderer";
import type { CrateEntity } from "./types";
import { DIR_ANGLES } from "./types";
import { type VisibilityMap, VisibilityState } from "./visibility";

export class MinimapRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	}

	public render(
		level: DungeonLevel,
		player: Player,
		visMap: VisibilityMap,
		crates: CrateEntity[],
		modes: RenderModes,
	): void {
		const ctx = this.ctx;
		const width = this.canvas.width;
		const height = this.canvas.height;

		ctx.clearRect(0, 0, width, height);

		// Dark background
		ctx.fillStyle = "rgba(2, 6, 23, 0.95)";
		ctx.fillRect(0, 0, width, height);

		const cellW = width / level.width;
		const cellH = height / level.height;

		// 1. Draw Map Tiles
		for (let y = 0; y < level.height; y++) {
			for (let x = 0; x < level.width; x++) {
				const vis = visMap.getVisibility(x, y);
				const tile = level.getTile(x, y);

				if (modes.fogEnabled && vis === VisibilityState.UNSEEN) {
					continue;
				}

				const px = x * cellW;
				const py = y * cellH;

				if (modes.fogEnabled && vis === VisibilityState.REVEALED) {
					ctx.fillStyle = level.isOpaque(x, y) ? "#1e293b" : "#0f172a";
				} else {
					// VISIBLE or Fog Disabled
					if (level.isOpaque(x, y)) {
						ctx.fillStyle = "#475569";
					} else if (tile === 9) {
						// TileType.HOLE
						ctx.fillStyle = "#020617";
					} else {
						// Floor
						ctx.fillStyle = "#0284c7";
					}
				}

				ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
			}
		}

		// 2. Draw Crates on Minimap
		for (const crate of crates) {
			const vis = visMap.getVisibility(crate.tileX, crate.tileY);
			if (
				!modes.fogEnabled ||
				vis === VisibilityState.VISIBLE ||
				vis === VisibilityState.REVEALED
			) {
				const px = (crate.tileX + 0.5) * cellW;
				const py = (crate.tileY + 0.5) * cellH;
				ctx.fillStyle = "#f59e0b";
				ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
			}
		}

		// 3. Draw Uncollected Keys on Minimap
		for (const key of level.entities.keys) {
			if (key.collected) continue;
			const vis = visMap.getVisibility(key.tileX, key.tileY);
			if (
				modes.showESP ||
				!modes.fogEnabled ||
				vis === VisibilityState.VISIBLE ||
				vis === VisibilityState.REVEALED
			) {
				const px = (key.tileX + 0.5) * cellW;
				const py = (key.tileY + 0.5) * cellH;
				ctx.fillStyle =
					key.color === "red"
						? "#ef4444"
						: key.color === "blue"
							? "#38bdf8"
							: "#22c55e";
				ctx.beginPath();
				ctx.arc(px, py, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// 4. Draw Exit Door on Minimap
		const exitVis = visMap.getVisibility(level.exitTile.x, level.exitTile.y);
		if (
			modes.showESP ||
			!modes.fogEnabled ||
			exitVis === VisibilityState.VISIBLE ||
			exitVis === VisibilityState.REVEALED
		) {
			const ePx = (level.exitTile.x + 0.5) * cellW;
			const ePy = (level.exitTile.y + 0.5) * cellH;
			ctx.fillStyle = player.collectedKeys.size >= 3 ? "#34d399" : "#ef4444";
			ctx.fillRect(ePx - 2, ePy - 2, 4, 4);
		}

		// 5. Draw Player Position & Direction Cone
		const playerTileX = player.x / 32;
		const playerTileY = player.y / 32;
		const pPx = playerTileX * cellW;
		const pPy = playerTileY * cellH;

		// Direction Aim Line
		const angle = DIR_ANGLES[player.aimDirection];
		const dirLen = 8;
		ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(pPx, pPy);
		ctx.lineTo(pPx + Math.cos(angle) * dirLen, pPy + Math.sin(angle) * dirLen);
		ctx.stroke();

		// Player Dot
		ctx.fillStyle = "#ffffff";
		ctx.beginPath();
		ctx.arc(pPx, pPy, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#38bdf8";
		ctx.lineWidth = 1;
		ctx.stroke();
	}
}
