import type { CrateManager } from "./crates";
import { EntityManager } from "./entities";
import type { LightingManager } from "./lighting";
import { TILE_SIZE, TileType } from "./types";

export class DungeonLevel {
	public width: number;
	public height: number;
	public grid: TileType[][];
	public spawnTile: { x: number; y: number } = { x: 2, y: 2 };
	public exitTile: { x: number; y: number } = { x: 17, y: 12 };
	public entities: EntityManager = new EntityManager();
	public crateManager?: CrateManager;
	public lightingManager?: LightingManager;

	constructor(width: number = 20, height: number = 15) {
		this.width = width;
		this.height = height;
		this.grid = [];
		this.initSampleRoom();
	}

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

	public fillHole(x: number, y: number): void {
		if (this.getTile(x, y) === TileType.HOLE) {
			this.setTile(x, y, TileType.FLOOR);
		}
	}

	public isWalkable(x: number, y: number): boolean {
		const tile = this.getTile(x, y);
		return (
			tile === TileType.FLOOR ||
			tile === TileType.KEY ||
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
					const tileLeft = tx * TILE_SIZE;
					const tileRight = (tx + 1) * TILE_SIZE;
					const tileTop = ty * TILE_SIZE;
					const tileBottom = (ty + 1) * TILE_SIZE;

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

		// Check collision against crate entities
		if (this.crateManager) {
			for (const crate of this.crateManager.crates) {
				const crateLeft = crate.tileX * TILE_SIZE;
				const crateRight = (crate.tileX + 1) * TILE_SIZE;
				const crateTop = crate.tileY * TILE_SIZE;
				const crateBottom = (crate.tileY + 1) * TILE_SIZE;

				const nearestX = Math.max(crateLeft, Math.min(pixelX, crateRight));
				const nearestY = Math.max(crateTop, Math.min(pixelY, crateBottom));

				const distX = pixelX - nearestX;
				const distY = pixelY - nearestY;

				if (distX * distX + distY * distY < radius * radius) {
					return true;
				}
			}
		}

		return false;
	}
}
