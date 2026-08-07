import type { EffectSystem } from "../effects/effects";
import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { ShotResult } from "../physics/ballistics";
import type { Projectile } from "../physics/projectile";
import type { TerrainManager } from "../terrain/terrainManager";
import type { WeaponId, WeaponStats } from "../types";

export interface WeaponContext {
	projectile: Projectile;
	terrain: TerrainManager;
	worms: Worm[];
	mapObjects: MapObject[];
	effects: EffectSystem;
	windX: number;
}

export interface SimProjectileState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	fuse: number;
	alive: boolean;
	bounces: number;
	bores: number;
	specialData?: number;
}

export interface IWeaponStrategy {
	readonly id: WeaponId;
	readonly stats: WeaponStats;

	onLaunch?(ctx: WeaponContext): void;
	onUpdate?(ctx: WeaponContext, dt: number): boolean;
	onImpact?(ctx: WeaponContext, hitX: number, hitY: number): void;
	onDetonate(ctx: WeaponContext): void;

	simUpdate(
		state: SimProjectileState,
		windX: number,
		terrain: TerrainManager,
	): boolean;
	simImpact(
		state: SimProjectileState,
		terrain: TerrainManager,
		worms: Worm[],
		shooter: Worm,
		mapObjects: MapObject[],
		shotResult: ShotResult,
	): void;
}

export class WeaponRegistry {
	private static instance: WeaponRegistry;
	private strategies: Map<WeaponId, IWeaponStrategy> = new Map();

	public static getInstance(): WeaponRegistry {
		if (!WeaponRegistry.instance) {
			WeaponRegistry.instance = new WeaponRegistry();
		}
		return WeaponRegistry.instance;
	}

	public register(strategy: IWeaponStrategy): void {
		this.strategies.set(strategy.id, strategy);
	}

	public get(id: WeaponId): IWeaponStrategy | undefined {
		return this.strategies.get(id);
	}

	public getAll(): IWeaponStrategy[] {
		return Array.from(this.strategies.values());
	}
}
