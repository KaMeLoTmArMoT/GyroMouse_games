import { TILE_SIZE, TileType } from "./types";

export class DungeonLevel {
	public width: number;
	public height: number;
	public grid: TileType[][];
	public spawnTile: { x: number; y: number } = { x: 2, y: 2 };
	public exitTile: { x: number; y: number } = { x: 17, y: 12 };

	constructor(width: number = 20, height: number = 15) {
		this.width = width;
		this.height = height;
		this.grid = [];
		this.initSampleRoom();
	}

	/**
	 * Creates a simple room with outer walls and a couple of internal obstacles for Phase 1 testing
	 */
	public initSampleRoom(): void {
		this.grid = [];
		for (let y = 0; y < this.height; y++) {
			const row: TileType[] = [];
			for (let x = 0; x < this.width; x++) {
				if (
					x === 0 ||
					y === 0 ||
					x === this.width - 1 ||
					y === this.height - 1
				) {
					row.push(TileType.WALL);
				} else {
					row.push(TileType.FLOOR);
				}
			}
			this.grid.push(row);
		}

		// Internal walls / pillar obstacles
		this.setTile(5, 4, TileType.WALL);
		this.setTile(5, 5, TileType.WALL);
		this.setTile(6, 4, TileType.WALL);

		this.setTile(12, 8, TileType.WALL);
		this.setTile(13, 8, TileType.WALL);
		this.setTile(14, 8, TileType.WALL);
		this.setTile(14, 9, TileType.WALL);

		// Exit door
		this.setTile(17, 12, TileType.EXIT_LOCKED);
	}

	public getTile(x: number, y: number): TileType {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return TileType.WALL;
		}
		return this.grid[y][x];
	}

	public setTile(x: number, y: number, type: TileType): void {
		if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
			this.grid[y][x] = type;
		}
	}

	public isWalkable(x: number, y: number): boolean {
		const tile = this.getTile(x, y);
		return (
			tile === TileType.FLOOR ||
			tile === TileType.DOOR_OPEN ||
			tile === TileType.EXIT_OPEN ||
			tile === TileType.SPAWN
		);
	}

	public isOpaque(x: number, y: number): boolean {
		const tile = this.getTile(x, y);
		return (
			tile === TileType.WALL ||
			tile === TileType.DOOR_LOCKED ||
			tile === TileType.EXIT_LOCKED
		);
	}

	/**
	 * Checks if a pixel point bounding box (circle or box) collides with walls
	 */
	public checkBoundingCollision(
		pixelX: number,
		pixelY: number,
		radius: number = 10,
	): boolean {
		const minTileX = Math.floor((pixelX - radius) / TILE_SIZE);
		const maxTileX = Math.floor((pixelX + radius) / TILE_SIZE);
		const minTileY = Math.floor((pixelY - radius) / TILE_SIZE);
		const maxTileY = Math.floor((pixelY + radius) / TILE_SIZE);

		for (let ty = minTileY; ty <= maxTileY; ty++) {
			for (let tx = minTileX; tx <= maxTileX; tx++) {
				if (!this.isWalkable(tx, ty)) {
					// Tile bounding box in pixels
					const tileLeft = tx * TILE_SIZE;
					const tileRight = (tx + 1) * TILE_SIZE;
					const tileTop = ty * TILE_SIZE;
					const tileBottom = (ty + 1) * TILE_SIZE;

					// Nearest point on tile to circle center
					const nearestX = Math.max(tileLeft, Math.min(pixelX, tileRight));
					const nearestY = Math.max(tileTop, Math.min(pixelY, tileBottom));

					const distX = pixelX - nearestX;
					const distY = pixelY - nearestY;

					if (distX * distX + distY * distY < radius * radius) {
						return true;
					}
				}
			}
		}
		return false;
	}
}
