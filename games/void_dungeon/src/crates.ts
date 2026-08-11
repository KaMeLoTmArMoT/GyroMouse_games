import type { DungeonLevel } from "./level";
import { type CrateEntity, TILE_SIZE, TileType } from "./types";

export class CrateManager {
	public crates: CrateEntity[] = [];
	private slideDuration: number = 0.15; // 150ms per tile slide

	public addCrate(id: string, tileX: number, tileY: number): void {
		this.crates.push({
			id,
			tileX,
			tileY,
			targetTileX: tileX,
			targetTileY: tileY,
			slideProgress: 0,
			isSliding: false,
		});
	}

	public getCrateAt(tileX: number, tileY: number): CrateEntity | undefined {
		return this.crates.find(
			(c) =>
				(c.tileX === tileX && c.tileY === tileY) ||
				(c.isSliding && c.targetTileX === tileX && c.targetTileY === tileY),
		);
	}

	public clear(): void {
		this.crates = [];
	}

	public update(dt: number, level: DungeonLevel): void {
		for (let i = this.crates.length - 1; i >= 0; i--) {
			const crate = this.crates[i];
			if (!crate.isSliding) continue;

			crate.slideProgress += dt / this.slideDuration;

			if (crate.slideProgress >= 1) {
				crate.slideProgress = 1;
				crate.tileX = crate.targetTileX;
				crate.tileY = crate.targetTileY;
				crate.isSliding = false;

				// Check if target tile is HOLE -> Fill hole & consume crate!
				const targetTile = level.getTile(crate.tileX, crate.tileY);
				if (targetTile === TileType.HOLE) {
					level.setTile(crate.tileX, crate.tileY, TileType.FLOOR);
					this.crates.splice(i, 1);
				}
			}
		}
	}

	public tryPushCrate(
		playerTileX: number,
		playerTileY: number,
		dx: number,
		dy: number,
		level: DungeonLevel,
	): boolean {
		if (dx === 0 && dy === 0) return false;

		// Normalize step to 1 tile in primary direction
		const stepX = Math.sign(dx);
		const stepY = Math.sign(dy);

		const crateTileX = playerTileX + stepX;
		const crateTileY = playerTileY + stepY;

		const crate = this.crates.find(
			(c) => c.tileX === crateTileX && c.tileY === crateTileY && !c.isSliding,
		);

		if (!crate) return false;

		const destTileX = crateTileX + stepX;
		const destTileY = crateTileY + stepY;

		// Check if destination is inside map bounds
		if (
			destTileX < 0 ||
			destTileY < 0 ||
			destTileX >= level.width ||
			destTileY >= level.height
		) {
			return false;
		}

		// Check if destination tile is walkable floor or hole
		const destTile = level.getTile(destTileX, destTileY);
		const isValidDestTile =
			destTile === TileType.FLOOR ||
			destTile === TileType.HOLE ||
			destTile === TileType.KEY ||
			destTile === TileType.SPAWN;

		if (!isValidDestTile) return false;

		// Check if destination tile already has another crate
		const destCrate = this.getCrateAt(destTileX, destTileY);
		if (destCrate) return false;

		// Start sliding crate!
		crate.targetTileX = destTileX;
		crate.targetTileY = destTileY;
		crate.slideProgress = 0;
		crate.isSliding = true;

		return true;
	}

	public render(
		ctx: CanvasRenderingContext2D,
		isTileVisible: (tx: number, ty: number) => boolean,
		playerPx: number,
		playerPy: number,
	): void {
		const playerTileX = Math.floor(playerPx / TILE_SIZE);
		const playerTileY = Math.floor(playerPy / TILE_SIZE);

		for (const crate of this.crates) {
			// Calculate current interpolated position
			const interpX =
				crate.tileX + (crate.targetTileX - crate.tileX) * crate.slideProgress;
			const interpY =
				crate.tileY + (crate.targetTileY - crate.tileY) * crate.slideProgress;

			const currentTileX = Math.round(interpX);
			const currentTileY = Math.round(interpY);

			// Render crate if tile is visible
			if (!isTileVisible(currentTileX, currentTileY)) continue;

			const px = interpX * TILE_SIZE;
			const py = interpY * TILE_SIZE;

			ctx.save();

			// Shadow underneath box
			ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
			ctx.fillRect(px + 3, py + 5, TILE_SIZE - 6, TILE_SIZE - 6);

			// Wooden crate body
			ctx.fillStyle = "#854d0e";
			ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

			// Wooden highlight planks
			ctx.fillStyle = "#a16207";
			ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);

			// Diagonal wooden braces
			ctx.strokeStyle = "#713f12";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(px + 4, py + 4);
			ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
			ctx.moveTo(px + TILE_SIZE - 4, py + 4);
			ctx.lineTo(px + 4, py + TILE_SIZE - 4);
			ctx.stroke();

			// Metal corner brackets
			ctx.fillStyle = "#fbbf24";
			ctx.fillRect(px + 2, py + 2, 4, 4);
			ctx.fillRect(px + TILE_SIZE - 6, py + 2, 4, 4);
			ctx.fillRect(px + 2, py + TILE_SIZE - 6, 4, 4);
			ctx.fillRect(px + TILE_SIZE - 6, py + TILE_SIZE - 6, 4, 4);

			// Check if player is orthogonally adjacent for push prompt
			const distTile =
				Math.abs(crate.tileX - playerTileX) +
				Math.abs(crate.tileY - playerTileY);
			if (distTile === 1 && !crate.isSliding) {
				ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
				ctx.strokeStyle = "#fbbf24";
				ctx.lineWidth = 1;
				const boxWidth = 56;
				const boxHeight = 16;
				const promptX = px + TILE_SIZE / 2 - boxWidth / 2;
				const promptY = py - 14;

				ctx.fillRect(promptX, promptY, boxWidth, boxHeight);
				ctx.strokeRect(promptX, promptY, boxWidth, boxHeight);

				ctx.fillStyle = "#fbbf24";
				ctx.font = "bold 9px sans-serif";
				ctx.textAlign = "center";
				ctx.fillText("[SPACE] PUSH", px + TILE_SIZE / 2, promptY + 11);
			}

			ctx.restore();
		}
	}
}
