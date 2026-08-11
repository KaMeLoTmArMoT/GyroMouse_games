export enum TileType {
	EMPTY = 0,
	WALL = 1,
	FLOOR = 2,
	DOOR_LOCKED = 3,
	DOOR_OPEN = 4,
	EXIT_LOCKED = 5,
	EXIT_OPEN = 6,
	KEY = 7,
	BOX = 8,
	HOLE = 9,
	SPAWN = 10,
}

export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface Vector2D {
	x: number;
	y: number;
}

export interface PlayerState {
	x: number; // pixel position or tile position float
	y: number;
	tileX: number;
	tileY: number;
	aimDirection: Direction;
	aimAngle: number; // in radians
	collectedKeys: string[];
}

export interface GameSaveData {
	seed: string;
	player: PlayerState;
	revealedTiles?: boolean[][];
	levelData?: number[][];
	collectedKeyIds?: string[];
	boxPositions?: { id: string; x: number; y: number }[];
	timestamp: number;
}

export const TILE_SIZE = 32;

export const DIR_ANGLES: Record<Direction, number> = {
	N: -Math.PI / 2,
	NE: -Math.PI / 4,
	E: 0,
	SE: Math.PI / 4,
	S: Math.PI / 2,
	SW: (3 * Math.PI) / 4,
	W: Math.PI,
	NW: (-3 * Math.PI) / 4,
};

export const DIR_VECTORS: Record<Direction, Vector2D> = {
	N: { x: 0, y: -1 },
	NE: { x: 1, y: -1 },
	E: { x: 1, y: 0 },
	SE: { x: 1, y: 1 },
	S: { x: 0, y: 1 },
	SW: { x: -1, y: 1 },
	W: { x: -1, y: 0 },
	NW: { x: -1, y: -1 },
};
