import type { DungeonLevel } from "./level";
import { DIR_ANGLES, type Direction } from "./types";

export interface RayPoint {
	x: number;
	y: number;
}

export enum VisibilityState {
	UNSEEN = 0,
	REVEALED = 1,
	VISIBLE = 2,
}

export class VisibilityMap {
	public width: number;
	public height: number;
	public grid: VisibilityState[][];
	public coneRayEndpoints: RayPoint[] = [];

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.grid = [];
		this.resetAll();
	}

	public resetAll(): void {
		this.grid = [];
		this.coneRayEndpoints = [];
		for (let y = 0; y < this.height; y++) {
			const row: VisibilityState[] = [];
			for (let x = 0; x < this.width; x++) {
				row.push(VisibilityState.UNSEEN);
			}
			this.grid.push(row);
		}
	}

	public getVisibility(x: number, y: number): VisibilityState {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return VisibilityState.UNSEEN;
		}
		return this.grid[y][x];
	}

	public setVisibility(x: number, y: number, state: VisibilityState): void {
		if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
			this.grid[y][x] = state;
		}
	}

	/**
	 * Updates the visibility grid based on player's current position, aim direction, and sonar boost
	 */
	public computeVisibility(
		playerTileX: number,
		playerTileY: number,
		aimDir: Direction,
		level: DungeonLevel,
		sonarActive: boolean = false,
	): void {
		this.coneRayEndpoints = [];

		// Step 1: Transition all currently VISIBLE tiles to REVEALED
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				if (this.grid[y][x] === VisibilityState.VISIBLE) {
					this.grid[y][x] = VisibilityState.REVEALED;
				}
			}
		}

		// Step 2: Immediate omni-directional vision (radius 2.5 tiles)
		const omniRadius = 2.5;
		const minX = Math.max(0, Math.floor(playerTileX - omniRadius));
		const maxX = Math.min(this.width - 1, Math.ceil(playerTileX + omniRadius));
		const minY = Math.max(0, Math.floor(playerTileY - omniRadius));
		const maxY = Math.min(this.height - 1, Math.ceil(playerTileY + omniRadius));

		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const dist = Math.hypot(x - playerTileX, y - playerTileY);
				if (dist <= omniRadius) {
					this.grid[y][x] = VisibilityState.VISIBLE;
				}
			}
		}

		// Step 3: Raycasted Cone Vision (90 degree forward cone, 8 tiles far; sonar expands arc/range)
		const centerAngle = DIR_ANGLES[aimDir];
		const coneArc = sonarActive ? Math.PI : Math.PI / 2; // 90 deg normal, 180 deg sonar
		const maxRange = sonarActive ? 14 : 8; // 8 tiles normal, 14 tiles sonar

		const halfArc = coneArc / 2;
		const numRays = 60; // ray density

		for (let i = 0; i <= numRays; i++) {
			const angle = centerAngle - halfArc + (i / numRays) * coneArc;
			const cosA = Math.cos(angle);
			const sinA = Math.sin(angle);

			// Raycast marching
			let rayDist = 0;
			const step = 0.2; // finer tile step fraction
			let endSampleX = playerTileX + 0.5;
			let endSampleY = playerTileY + 0.5;

			while (rayDist <= maxRange) {
				const sampleX = playerTileX + 0.5 + cosA * rayDist;
				const sampleY = playerTileY + 0.5 + sinA * rayDist;
				endSampleX = sampleX;
				endSampleY = sampleY;

				const tx = Math.floor(sampleX);
				const ty = Math.floor(sampleY);

				if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
					break;
				}

				this.grid[ty][tx] = VisibilityState.VISIBLE;

				// Opaque wall blocks further sight along this ray
				if (level.isOpaque(tx, ty)) {
					break;
				}

				rayDist += step;
			}

			// Save ray endpoint in world pixel coordinates
			this.coneRayEndpoints.push({
				x: endSampleX * 32,
				y: endSampleY * 32,
			});
		}
	}
}
