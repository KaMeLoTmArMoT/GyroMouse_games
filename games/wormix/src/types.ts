export type TurnPhase =
	| "MENU"
	| "LOBBY"
	| "EDITOR"
	| "MOVE"
	| "WEAPON_SELECT"
	| "AIM_FIRE"
	| "PROJECTILE_FLIGHT"
	| "REPOSITION"
	| "TURN_RESOLVE"
	| "GAME_OVER";

/** Fixed logical world size for matches — independent of the browser window size. */
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

/** Per-team weapon ammo stock. Bazooka is always infinite (absent from map). */
export type TeamAmmo = Partial<Record<WeaponId, number>>;

export type MaterialType =
	| "bedrock"
	| "stone"
	| "dirt"
	| "grass"
	| "sand"
	| "water"
	| "acid";

export type WeaponId =
	| "bazooka"
	| "grenade"
	| "cluster"
	| "acid_bomb"
	| "sand_bomb"
	| "drill"
	| "mortar"
	| "dynamite"
	| "rifle"
	| "shotgun";

export interface WeaponInfo {
	id: WeaponId;
	name: string;
	icon: string;
	description: string;
	fuseSelectable?: boolean;
	affectedByWind: boolean;
}

/**
 * Launch speed multiplier (max charge power) per weapon.
 * Bazooka & Drill are tuned slower for controlled, flatter arcs.
 */
export const PROJECTILE_MAX_SPEED: Record<WeaponId, number> = {
	bazooka: 18,
	grenade: 22,
	cluster: 22,
	acid_bomb: 22,
	sand_bomb: 22,
	drill: 18,
	mortar: 22,
	dynamite: 22,
	rifle: 22,
	shotgun: 22,
};

/**
 * Gravity (drop) per weapon. Bazooka & Drill drop less for a flatter arc.
 * Rifle skips gravity entirely.
 */
export const PROJECTILE_GRAVITY: Record<WeaponId, number> = {
	bazooka: 0.3,
	grenade: 0.45,
	cluster: 0.45,
	acid_bomb: 0.45,
	sand_bomb: 0.45,
	drill: 0.3,
	mortar: 0.45,
	dynamite: 0.45,
	rifle: 0.45,
	shotgun: 0.45,
};

export type AIDifficulty = "easy" | "normal" | "hard";

export interface Vector2D {
	x: number;
	y: number;
}

export interface Portal {
	id: "orange" | "blue";
	x: number;
	y: number;
	normalX: number;
	normalY: number;
	radius: number;
}

export interface TerrainColumn {
	grassY: number;
	dirtY: number;
	stoneY: number;
	bedrockY: number;
	sandY: number;
	destruction: {
		grass: number;
		dirt: number;
		stone: number;
		sand: number;
	};
}

export interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	color: string;
	size: number;
	isAcid?: boolean;
}

export type MapObjectType = "barrel" | "landmine" | "health_crate";

export interface MapObjectData {
	id: string;
	type: MapObjectType;
	x: number;
	y: number;
	health?: number;
	triggered?: boolean;
	triggerTimer?: number;
}

export interface WaterParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
}

export interface WaterBody {
	id: string;
	x: number;
	y: number;
	width: number;
	waterLevel: number;
}

export const CELL_AIR = 0;
export const CELL_GRASS = 1;
export const CELL_DIRT = 2;
export const CELL_STONE = 3;
export const CELL_BEDROCK = 4;
export const CELL_SAND = 5;
export const CELL_WATER = 6;
export const CELL_ACID = 7;
export const CELL_IRON = 8;

export interface CustomMapData {
	id: string;
	name: string;
	createdAt: number;
	updatedAt?: number;
	width: number;
	height: number;
	terrainHeights: number[];
	terrainMaterials?: string[];
	gridData?: number[];
	spawnPoints: { x: number; y: number; team: "player" | "ai" }[];
	mapObjects: MapObjectData[];
	waterBodies: WaterBody[];
	waterParticles?: { x: number; y: number }[];
	waterY: number;
}

export type AIPersonality =
	| "aggressive"
	| "sniper"
	| "looter"
	| "chaotic"
	| "default";

export interface WeightVector {
	attack: number; // enemy damage weight
	selfRisk: number; // self-damage avoidance
	cover: number; // cover quality at position
	crates: number; // health crate proximity
	chain: number; // barrel chain explosion bonus
}

export type GameMode = "deathmatch" | "rising_water" | "fort_warfare";

export interface LobbyConfig {
	teamSize: number;
	wormHealth: number;
	gameMode: GameMode;
	mapId: string;
	aiDifficulty: AIDifficulty;
	matchType: "ai" | "pvp";
}
