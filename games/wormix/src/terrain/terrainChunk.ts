import type { QuadItem } from "./quadTree";

export class TerrainChunk implements QuadItem {
	public id: string;
	public chunkX: number;
	public chunkY: number;
	public gridX: number;
	public gridY: number;
	public cellWidth: number;
	public cellHeight: number;

	public x: number; // World X
	public y: number; // World Y
	public width: number; // World Width
	public height: number; // World Height

	public isDirty: boolean = true;
	public hasSolid: boolean = false;
	public solidCellCount: number = 0;

	constructor(
		chunkX: number,
		chunkY: number,
		gridX: number,
		gridY: number,
		cellWidth: number,
		cellHeight: number,
		cellScale: number,
	) {
		this.chunkX = chunkX;
		this.chunkY = chunkY;
		this.gridX = gridX;
		this.gridY = gridY;
		this.cellWidth = cellWidth;
		this.cellHeight = cellHeight;
		this.id = `chunk_${chunkX}_${chunkY}`;

		this.x = gridX * cellScale;
		this.y = gridY * cellScale;
		this.width = cellWidth * cellScale;
		this.height = cellHeight * cellScale;
	}

	public markDirty(): void {
		this.isDirty = true;
	}

	public updateSolidCount(count: number): void {
		this.solidCellCount = count;
		this.hasSolid = count > 0;
	}
}
