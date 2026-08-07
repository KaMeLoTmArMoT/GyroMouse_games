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

export type WeaponKind = "projectile" | "raycast";

export type WeaponSpecial =
	| "none"
	| "split"
	| "bore"
	| "acid"
	| "sand"
	| "airburst";

/**
 * Single source of truth for how each weapon behaves. Used by the real
 * `Projectile.update` AND the AI's pure simulation so the two can never drift.
 */
export interface WeaponStats {
	maxSpeed: number;
	gravity: number;
	wind: boolean;
	bouncy: boolean;
	/** Detonation fuse in frames (30fps). 0 = no fuse (impact detonation). */
	fuseFrames: number;
	blastRadius: number;
	baseDamage: number;
	kind: WeaponKind;
	special: WeaponSpecial;
	/** Cluster children */
	childBlastRadius?: number;
	childBaseDamage?: number;
	childCount?: number;
}

export const WEAPON_STATS: Record<WeaponId, WeaponStats> = {
	bazooka: {
		maxSpeed: 18,
		gravity: 0.3,
		wind: true,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 42,
		baseDamage: 45,
		kind: "projectile",
		special: "none",
	},
	grenade: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: false,
		bouncy: true,
		fuseFrames: 90,
		blastRadius: 38,
		baseDamage: 35,
		kind: "projectile",
		special: "none",
	},
	cluster: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: true,
		bouncy: true,
		fuseFrames: 90,
		blastRadius: 30,
		baseDamage: 35,
		kind: "projectile",
		special: "split",
		childBlastRadius: 30,
		childBaseDamage: 35,
		childCount: 5,
	},
	acid_bomb: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: false,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 20,
		baseDamage: 0,
		kind: "projectile",
		special: "acid",
	},
	sand_bomb: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: false,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 0,
		baseDamage: 0,
		kind: "projectile",
		special: "sand",
	},
	drill: {
		maxSpeed: 18,
		gravity: 0.3,
		wind: true,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 35,
		baseDamage: 40,
		kind: "projectile",
		special: "bore",
	},
	mortar: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: true,
		bouncy: false,
		fuseFrames: 75,
		blastRadius: 15,
		baseDamage: 25,
		kind: "projectile",
		special: "airburst",
	},
	dynamite: {
		maxSpeed: 22,
		gravity: 0.45,
		wind: false,
		bouncy: true,
		fuseFrames: 120,
		blastRadius: 65,
		baseDamage: 55,
		kind: "projectile",
		special: "none",
	},
	rifle: {
		maxSpeed: 22,
		gravity: 0,
		wind: false,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 18,
		baseDamage: 30,
		kind: "projectile",
		special: "none",
	},
	shotgun: {
		maxSpeed: 22,
		gravity: 0,
		wind: false,
		bouncy: false,
		fuseFrames: 0,
		blastRadius: 0,
		baseDamage: 40,
		kind: "raycast",
		special: "none",
	},
};

/**
 * Launch speed multiplier (max charge power) per weapon — derived from
 * WEAPON_STATS so projectile physics, the trajectory arc and the AI sim
 * always agree.
 */
export const PROJECTILE_MAX_SPEED: Record<WeaponId, number> =
	Object.fromEntries(
		Object.entries(WEAPON_STATS).map(([id, s]) => [id, s.maxSpeed]),
	) as Record<WeaponId, number>;

/**
 * Gravity (drop) per weapon — derived from WEAPON_STATS. Rifle skips gravity.
 */
export const PROJECTILE_GRAVITY: Record<WeaponId, number> = Object.fromEntries(
	Object.entries(WEAPON_STATS).map(([id, s]) => [id, s.gravity]),
) as Record<WeaponId, number>;

export type AIDifficulty = "easy" | "normal" | "hard";

/**
 * AI search budget — how much brute force the bot is allowed per turn.
 * `thinkingMs` is the hard wall-clock ceiling (deadline), `maxSimulations`
 * the safety cap on individual shot simulations. Easy = fast & imperfect,
 * Hard = near-exhaustive (up to ~5s of thinking allowed).
 */
export interface AISearchBudget {
	thinkingMs: number;
	maxSimulations: number;
	finalists: number; // top positions that get the fine/exhaustive pass
	coarseAngles: number;
	coarsePowers: number;
	refinementIterations: number;
	fineAngles: number;
	finePowers: number;
	/** Aim error (px) added to blast distances — grows with shot distance. */
	aimErrorPx: number;
	aimErrorGrowth: number;
	/** Score noise so low difficulties don't always pick the strict best. */
	scoreNoise: number;
	/** Aim-angle execution noise at fire time (degrees). */
	angleNoise: number;
}

export const AI_BUDGET: Record<AIDifficulty, AISearchBudget> = {
	easy: {
		thinkingMs: 1000,
		maxSimulations: 100_000,
		finalists: 3,
		coarseAngles: 7,
		coarsePowers: 5,
		refinementIterations: 2,
		fineAngles: 9,
		finePowers: 7,
		aimErrorPx: 8,
		aimErrorGrowth: 0.04,
		scoreNoise: 15,
		angleNoise: 10,
	},
	normal: {
		thinkingMs: 3000,
		maxSimulations: 300_000,
		finalists: 5,
		coarseAngles: 11,
		coarsePowers: 7,
		refinementIterations: 3,
		fineAngles: 13,
		finePowers: 9,
		aimErrorPx: 3,
		aimErrorGrowth: 0.012,
		scoreNoise: 5,
		angleNoise: 3,
	},
	hard: {
		thinkingMs: 5000,
		maxSimulations: 1_000_000,
		finalists: 7,
		coarseAngles: 15,
		coarsePowers: 9,
		refinementIterations: 4,
		fineAngles: 17,
		finePowers: 11,
		aimErrorPx: 0,
		aimErrorGrowth: 0,
		scoreNoise: 1,
		angleNoise: 0,
	},
};

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
export type MatchType = "ai" | "pvp" | "bot_vs_bot";

export interface LobbyConfig {
	teamSize: number;
	wormHealth: number;
	gameMode: GameMode;
	mapId: string;
	aiDifficulty: AIDifficulty;
	redAiDifficulty?: AIDifficulty;
	blueAiDifficulty?: AIDifficulty;
	matchType: MatchType;
	enableWind?: boolean;
}

export interface SavedWormState {
	id: string;
	name: string;
	team: "player" | "ai";
	x: number;
	y: number;
	health: number;
	maxHealth: number;
	personality?: AIPersonality;
	isAlive: boolean;
}

export interface MatchSaveData {
	id: string;
	timestamp: number;
	dateString: string;
	lobbyConfig: LobbyConfig;
	worms: SavedWormState[];
	activeWormIndex: number;
	playerWeaponIndex: number;
	teamAmmo: Record<"player" | "ai", TeamAmmo>;
	windX: number;
	turnCount: number;
	terrainData?: {
		gridData: number[];
		waterY: number;
		width: number;
		height: number;
	};
}
