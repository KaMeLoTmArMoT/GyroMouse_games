import type { KeyColor } from "./entities";
import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import { TILE_SIZE, TileType } from "./types";

export type EditorTool =
	| TileType
	| "KEY_RED"
	| "KEY_BLUE"
	| "KEY_GREEN"
	| "ERASE";

export class LevelEditor {
	public active: boolean = false;
	public selectedTool: EditorTool = TileType.WALL;
	private isPainting: boolean = false;

	public toggle(): boolean {
		this.active = !this.active;
		this.updateUI();
		return this.active;
	}

	public updateUI(): void {
		const bar = document.getElementById("editor-toolbar");
		if (bar) {
			bar.style.display = this.active ? "flex" : "none";
		}
	}

	public setTool(tool: EditorTool): void {
		this.selectedTool = tool;

		// Highlight active button
		const buttons = document.querySelectorAll(".editor-tool-btn");
		buttons.forEach((btn) => {
			const toolAttr = btn.getAttribute("data-tool");
			btn.classList.toggle("active", toolAttr === String(tool));
		});
	}

	public onPointerDown(
		px: number,
		py: number,
		cameraX: number,
		cameraY: number,
		level: DungeonLevel,
		player: Player,
	): boolean {
		if (!this.active) return false;

		const worldX = px + cameraX;
		const worldY = py + cameraY;

		const tx = Math.floor(worldX / TILE_SIZE);
		const ty = Math.floor(worldY / TILE_SIZE);

		if (tx >= 0 && ty >= 0 && tx < level.width && ty < level.height) {
			this.isPainting = true;
			this.paint(tx, ty, level, player);
			return true;
		}
		return false;
	}

	public onPointerMove(
		px: number,
		py: number,
		cameraX: number,
		cameraY: number,
		level: DungeonLevel,
		player: Player,
	): void {
		if (!this.active || !this.isPainting) return;

		const worldX = px + cameraX;
		const worldY = py + cameraY;

		const tx = Math.floor(worldX / TILE_SIZE);
		const ty = Math.floor(worldY / TILE_SIZE);

		if (tx >= 0 && ty >= 0 && tx < level.width && ty < level.height) {
			this.paint(tx, ty, level, player);
		}
	}

	public onPointerUp(): void {
		this.isPainting = false;
	}

	private paint(
		tx: number,
		ty: number,
		level: DungeonLevel,
		player: Player,
	): void {
		if (this.selectedTool === "ERASE") {
			level.setTile(tx, ty, TileType.FLOOR);
			return;
		}

		if (this.selectedTool === "KEY_RED") {
			level.setTile(tx, ty, TileType.KEY);
			this.addOrUpdateKey(level, tx, ty, "red");
		} else if (this.selectedTool === "KEY_BLUE") {
			level.setTile(tx, ty, TileType.KEY);
			this.addOrUpdateKey(level, tx, ty, "blue");
		} else if (this.selectedTool === "KEY_GREEN") {
			level.setTile(tx, ty, TileType.KEY);
			this.addOrUpdateKey(level, tx, ty, "green");
		} else if (this.selectedTool === TileType.BOX) {
			level.setTile(tx, ty, TileType.FLOOR);
			if (level.crateManager) {
				level.crateManager.addCrate(`crate_${tx}_${ty}`, tx, ty);
			}
		} else if (this.selectedTool === TileType.SPAWN) {
			level.spawnTile = { x: tx, y: ty };
			level.setTile(tx, ty, TileType.FLOOR);
			player.x = (tx + 0.5) * TILE_SIZE;
			player.y = (ty + 0.5) * TILE_SIZE;
		} else if (this.selectedTool === TileType.EXIT_LOCKED) {
			level.exitTile = { x: tx, y: ty };
			level.setTile(tx, ty, TileType.EXIT_LOCKED);
		} else {
			level.setTile(tx, ty, this.selectedTool as TileType);
		}
	}

	private addOrUpdateKey(
		level: DungeonLevel,
		tx: number,
		ty: number,
		color: KeyColor,
	): void {
		const existing = level.entities.keys.find((k) => k.color === color);
		if (existing) {
			existing.tileX = tx;
			existing.tileY = ty;
			existing.collected = false;
		} else {
			level.entities.addKey(`key_${color}`, tx, ty, color);
		}
	}

	public exportJSON(level: DungeonLevel, seed: string): string {
		const data = {
			seed,
			width: level.width,
			height: level.height,
			spawnTile: level.spawnTile,
			exitTile: level.exitTile,
			grid: level.grid,
			keys: level.entities.keys.map((k) => ({
				color: k.color,
				tileX: k.tileX,
				tileY: k.tileY,
			})),
			crates: level.crateManager
				? level.crateManager.crates.map((c) => ({
						id: c.id,
						tileX: c.tileX,
						tileY: c.tileY,
					}))
				: [],
		};
		return JSON.stringify(data, null, 2);
	}

	public importJSON(
		jsonString: string,
		level: DungeonLevel,
		player: Player,
	): boolean {
		try {
			const data = JSON.parse(jsonString);
			if (!data.grid || !data.width || !data.height) return false;

			level.width = data.width;
			level.height = data.height;
			level.grid = data.grid;

			if (data.spawnTile) level.spawnTile = data.spawnTile;
			if (data.exitTile) level.exitTile = data.exitTile;

			level.entities.clear();
			if (data.keys) {
				for (const k of data.keys) {
					level.entities.addKey(`key_${k.color}`, k.tileX, k.tileY, k.color);
				}
			}

			if (level.crateManager) {
				level.crateManager.clear();
				if (data.crates) {
					for (const c of data.crates) {
						level.crateManager.addCrate(c.id, c.tileX, c.tileY);
					}
				}
			}

			player.x = (level.spawnTile.x + 0.5) * TILE_SIZE;
			player.y = (level.spawnTile.y + 0.5) * TILE_SIZE;
			player.collectedKeys.clear();

			return true;
		} catch (_e) {
			return false;
		}
	}

	public renderCursor(
		ctx: CanvasRenderingContext2D,
		cameraX: number,
		cameraY: number,
		mouseX: number,
		mouseY: number,
	): void {
		if (!this.active) return;

		const worldX = mouseX + cameraX;
		const worldY = mouseY + cameraY;

		const tx = Math.floor(worldX / TILE_SIZE);
		const ty = Math.floor(worldY / TILE_SIZE);

		const px = tx * TILE_SIZE;
		const py = ty * TILE_SIZE;

		ctx.save();
		ctx.strokeStyle = "#38bdf8";
		ctx.lineWidth = 2;
		ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

		ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
		ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
		ctx.restore();
	}
}
