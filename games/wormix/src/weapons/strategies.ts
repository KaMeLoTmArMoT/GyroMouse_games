import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { ShotResult } from "../physics/ballistics";
import type { TerrainManager } from "../terrain/terrainManager";
import {
	CELL_ACID,
	WEAPON_STATS,
	type WeaponId,
	type WeaponStats,
} from "../types";
import {
	type IWeaponStrategy,
	type SimProjectileState,
	type WeaponContext,
	WeaponRegistry,
} from "./weaponStrategy";

export abstract class BaseWeaponStrategy implements IWeaponStrategy {
	abstract readonly id: WeaponId;
	public get stats(): WeaponStats {
		return WEAPON_STATS[this.id];
	}

	public onLaunch(_ctx: WeaponContext): void {}

	public onUpdate(ctx: WeaponContext, _dt: number): boolean {
		const p = ctx.projectile;
		if (this.stats.fuseFrames > 0) {
			p.fuseTimer--;
			if (p.fuseTimer <= 0) {
				return true;
			}
		}
		return false;
	}

	public onImpact(ctx: WeaponContext, _hitX: number, _hitY: number): void {
		this.onDetonate(ctx);
	}

	public onDetonate(ctx: WeaponContext): void {
		const p = ctx.projectile;
		ctx.terrain.explode(p.x, p.y, this.stats.blastRadius);
		ctx.effects.spawnFireball(p.x, p.y, this.stats.blastRadius);
		ctx.effects.spawnShockwave(p.x, p.y, this.stats.blastRadius);
		this.applyBlastDamage(
			ctx,
			p.x,
			p.y,
			this.stats.blastRadius,
			this.stats.baseDamage,
		);
	}

	protected applyBlastDamage(
		ctx: WeaponContext,
		bx: number,
		by: number,
		radius: number,
		damage: number,
	): void {
		ctx.worms.forEach((w) => {
			if (!w.isAlive) return;
			const dist = Math.hypot(w.x - bx, w.y - by);
			if (dist <= radius + 10) {
				const factor = 1 - Math.min(1, dist / (radius + 10));
				const actualDmg = Math.round(damage * factor);
				if (actualDmg > 0) {
					w.takeDamage(actualDmg);
					const knockback = factor * 14;
					const angle = Math.atan2(w.y - by, w.x - bx);
					w.vx += Math.cos(angle) * knockback;
					w.vy += Math.sin(angle) * knockback - 3;
				}
			}
		});

		ctx.mapObjects.forEach((obj) => {
			if (obj.isDestroyed) return;
			const dist = Math.hypot(obj.x - bx, obj.y - by);
			if (dist <= radius + 15) {
				const factor = 1 - Math.min(1, dist / (radius + 15));
				const actualDmg = Math.round(damage * factor);
				if (actualDmg > 0) {
					obj.health -= actualDmg;
				}
			}
		});
	}

	public simUpdate(
		state: SimProjectileState,
		windX: number,
		terrain: TerrainManager,
	): boolean {
		const s = this.stats;
		state.vy += s.gravity;
		if (s.wind) state.vx += windX * 0.05;

		state.x += state.vx;
		state.y += state.vy;

		if (state.fuse > 0) {
			state.fuse--;
			if (state.fuse <= 0) return true;
		}

		if (terrain.isSolidAt(state.x, state.y)) {
			if (s.bouncy) {
				state.vx *= -0.7;
				state.vy *= -0.6;
				state.bounces++;
				if (state.bounces > 6) return true;
			} else {
				return true;
			}
		}

		return false;
	}

	public simImpact(
		state: SimProjectileState,
		_terrain: TerrainManager,
		worms: Worm[],
		shooter: Worm,
		_mapObjects: MapObject[],
		shotResult: ShotResult,
	): void {
		shotResult.endX = state.x;
		shotResult.endY = state.y;
		shotResult.terrainDestruction +=
			Math.PI * this.stats.blastRadius * this.stats.blastRadius;

		worms.forEach((w) => {
			if (!w.isAlive) return;
			const dist = Math.hypot(w.x - state.x, w.y - state.y);
			if (dist <= this.stats.blastRadius + 10) {
				const factor = 1 - Math.min(1, dist / (this.stats.blastRadius + 10));
				const dmg = Math.round(this.stats.baseDamage * factor);
				if (dmg > 0) {
					if (w.team !== shooter.team) shotResult.enemyDamage += dmg;
					else if (w === shooter) shotResult.selfDamage += dmg;
					else shotResult.allyDamage += dmg;
				}
			}
		});
	}
}

export class BazookaStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "bazooka";
}

export class GrenadeStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "grenade";
}

export class ClusterStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "cluster";

	public onDetonate(ctx: WeaponContext): void {
		super.onDetonate(ctx);
		const p = ctx.projectile;
		const childCount = this.stats.childCount ?? 5;
		for (let i = 0; i < childCount; i++) {
			const angle =
				(i / childCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
			const dist = Math.random() * 25 + 15;
			const cx = p.x + Math.cos(angle) * dist;
			const cy = p.y + Math.sin(angle) * dist;
			ctx.terrain.explode(cx, cy, this.stats.childBlastRadius ?? 25);
			ctx.effects.spawnFireball(cx, cy, this.stats.childBlastRadius ?? 25);
			this.applyBlastDamage(
				ctx,
				cx,
				cy,
				this.stats.childBlastRadius ?? 25,
				this.stats.childBaseDamage ?? 25,
			);
		}
	}
}

export class AcidBombStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "acid_bomb";

	public onDetonate(ctx: WeaponContext): void {
		const p = ctx.projectile;
		ctx.terrain.explode(p.x, p.y, this.stats.blastRadius);
		ctx.effects.spawnFireball(p.x, p.y, this.stats.blastRadius);
		ctx.terrain.spawnElementStream(p.x, p.y, CELL_ACID, 18);
		this.applyBlastDamage(ctx, p.x, p.y, this.stats.blastRadius, 15);
	}
}

export class SandBombStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "sand_bomb";

	public onDetonate(ctx: WeaponContext): void {
		const p = ctx.projectile;
		ctx.terrain.depositSand(p.x, 30);
		ctx.effects.spawnShockwave(p.x, p.y, 15);
	}
}

export class DrillStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "drill";

	public onUpdate(ctx: WeaponContext, dt: number): boolean {
		const p = ctx.projectile;
		if (ctx.terrain.isSolidAt(p.x, p.y)) {
			p.drillTime = (p.drillTime ?? 0) + 1;
			ctx.terrain.explode(p.x, p.y, 12);
			if (p.drillTime >= 15) {
				return true;
			}
		}
		return super.onUpdate(ctx, dt);
	}
}

export class MortarStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "mortar";

	public onDetonate(ctx: WeaponContext): void {
		super.onDetonate(ctx);
		const p = ctx.projectile;
		for (let i = 0; i < 6; i++) {
			const angle = Math.PI * 0.2 + (i / 5) * Math.PI * 0.6;
			const sx = p.x + Math.cos(angle) * 30;
			const sy = p.y + Math.sin(angle) * 30;
			ctx.terrain.explode(sx, sy, 18);
			ctx.effects.spawnFireball(sx, sy, 18);
			this.applyBlastDamage(ctx, sx, sy, 18, 20);
		}
	}
}

export class DynamiteStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "dynamite";
}

export class RifleStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "rifle";

	public simUpdate(
		state: SimProjectileState,
		_windX: number,
		terrain: TerrainManager,
	): boolean {
		state.x += state.vx;
		state.y += state.vy;
		return terrain.isSolidAt(state.x, state.y);
	}
}

export class ShotgunStrategy extends BaseWeaponStrategy {
	readonly id: WeaponId = "shotgun";

	public simUpdate(
		state: SimProjectileState,
		_windX: number,
		terrain: TerrainManager,
	): boolean {
		state.x += state.vx;
		state.y += state.vy;
		return terrain.isSolidAt(state.x, state.y);
	}
}

export function registerAllWeaponStrategies(): void {
	const reg = WeaponRegistry.getInstance();
	reg.register(new BazookaStrategy());
	reg.register(new GrenadeStrategy());
	reg.register(new ClusterStrategy());
	reg.register(new AcidBombStrategy());
	reg.register(new SandBombStrategy());
	reg.register(new DrillStrategy());
	reg.register(new MortarStrategy());
	reg.register(new DynamiteStrategy());
	reg.register(new RifleStrategy());
	reg.register(new ShotgunStrategy());
}

// Auto-register strategies
registerAllWeaponStrategies();
