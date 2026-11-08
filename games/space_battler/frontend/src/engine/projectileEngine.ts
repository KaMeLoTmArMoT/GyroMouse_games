import type { ProjectileState, ShipState, Vector2, WeaponDefinition } from "../types/combat";
import { circleContactFraction, type MapObstacle } from "./battleMaps";
import { sweptHit } from "./fireControl";
import { clamp, normalizeAngle, vecAdd, vecDot, vecScale, vecSub } from "./math2d";
import { activeShieldRadius } from "./shieldGeometry";
import { isHeavyTorpedo, pointDefenseMode } from "./shipProfiles";
import { WasmHotLoops } from "./wasmHotLoops";

export type FlakBurstCallback = (pos: Vector2, radius: number, ownerTeam: number) => void;

interface ProjectileContext {
  // Shared damage resolution owns shield havens, layer accounting, telemetry and impact VFX.
  applyShipDamage(
    ship: ShipState,
    damage: number,
    weapon: WeaponDefinition,
    attackerTeam: number,
    attackerId: string,
    mountId: string | undefined,
    origin: Vector2,
  ): void;
  onMissileIntercept(
    projectile: ProjectileState,
    team: number,
    source: string,
    laserSource?: ShipState,
  ): void;
  onDetonate: FlakBurstCallback;
  onFlakAudio(flak: ProjectileState): void;
}

/** Fixed-step ordnance motion and impact resolution, in projectile storage order. */
export class ProjectileEngine {
  projectiles: ProjectileState[] = [];
  private readonly context: ProjectileContext;
  private readonly hotLoops = new WasmHotLoops();
  private readonly activeMissiles: ProjectileState[] = [];
  private readonly shipIndices = new Map<string, number>();

  constructor(context: ProjectileContext) {
    this.context = context;
  }

  updateProjectiles(
    dt: number,
    aliveShips: ShipState[],
    previousPositions: ReadonlyMap<string, Vector2>,
    mapObstacles?: readonly MapObstacle[],
  ): void {
    const shipCount = aliveShips.length;
    const hotLoops = this.hotLoops;
    hotLoops.ensureCapacity(shipCount);
    const shipSweeps = hotLoops.shipSweeps;
    const shipById = new Map<string, ShipState>();
    const shipIndices = this.shipIndices;
    shipIndices.clear();
    for (let i = 0; i < shipCount; i++) {
      const ship = aliveShips[i];
      shipById.set(ship.id, ship);
      shipIndices.set(ship.id, i);
      const old = previousPositions.get(ship.id) ?? ship.pos;
      const offset = i * 5;
      shipSweeps[offset] = old[0];
      shipSweeps[offset + 1] = old[1];
      shipSweeps[offset + 2] = ship.pos[0] - old[0];
      shipSweeps[offset + 3] = ship.pos[1] - old[1];
      hotLoops.shipFlags[i * 2] = ship.team;
      hotLoops.updateShip(i, activeShieldRadius(ship), ship.isAlive);
    }
    const active: ProjectileState[] = [];
    const activeMissiles = this.activeMissiles;
    activeMissiles.length = 0;
    for (const p of this.projectiles)
      if (p.weaponType === "missile" && p.hp > 0 && p.lifetime > 0) activeMissiles.push(p);
    const starts = new Map(this.projectiles.map((p) => [p.id, p.pos]));
    for (const p of this.projectiles) {
      if (p.hp <= 0 || p.lifetime <= 0) continue;
      const step = Math.min(dt, p.lifetime);

      // Lost locks acquire the closest hostile within a forward 60-degree seeker arc.
      if (p.weaponType === "missile" && p.targetId) {
        const currentAngle = Math.atan2(p.velocity[1], p.velocity[0]);
        let target = shipById.get(p.targetId);
        if (target && (!target.isAlive || target.isDebris || target.team === p.ownerTeam))
          target = undefined;
        if (!target) {
          let closest = Infinity;
          for (const candidate of aliveShips) {
            if (!candidate.isAlive || candidate.isDebris || candidate.team === p.ownerTeam)
              continue;
            const delta = vecSub(candidate.pos, p.pos);
            const angle = normalizeAngle(Math.atan2(delta[1], delta[0]) - currentAngle);
            const distance = vecDot(delta, delta);
            if (Math.abs(angle) <= Math.PI / 6 && distance < closest) {
              target = candidate;
              closest = distance;
            }
          }
          if (target) p.targetId = target.id;
        }
        if (target) {
          const toTarget = vecSub(target.pos, p.pos);
          const distSq = toTarget[0] * toTarget[0] + toTarget[1] * toTarget[1];
          if (distSq > 100) {
            const curSpeed = Math.hypot(p.velocity[0], p.velocity[1]);
            if (curSpeed > 1) {
              const desiredAngle = Math.atan2(toTarget[1], toTarget[0]);
              const angleDiff = normalizeAngle(desiredAngle - currentAngle);
              if (!isHeavyTorpedo(p) || Math.abs(angleDiff) < Math.PI / 3) {
                const maxTurn = (isHeavyTorpedo(p) ? 0.8 : 2.5) * step;
                const turn = clamp(angleDiff, -maxTurn, maxTurn);
                const newAngle = currentAngle + turn;
                p.velocity = [Math.cos(newAngle) * curSpeed, Math.sin(newAngle) * curSpeed];
              }
            }
          }
        }
      }

      const start = starts.get(p.id) ?? p.pos;
      const end = vecAdd(start, vecScale(p.velocity, step));
      const flak = p.weapon.flak;
      const fraction = step / dt;
      const victimIndex = hotLoops.findProjectileShipHitWasm(
        shipCount,
        start[0],
        start[1],
        end[0],
        end[1],
        fraction,
        flak?.triggerRadius ?? 0,
        p.ownerTeam,
        shipIndices.get(p.targetId ?? "") ?? -1,
      );
      let first = hotLoops.first;
      let victim: ShipState | null = victimIndex === -1 ? null : aliveShips[victimIndex];
      let intercepted: ProjectileState | null = null;
      let blocked = false;
      if (flak || pointDefenseMode(p.weapon) === "rotary") {
        for (const missile of activeMissiles) {
          if (missile.ownerTeam === p.ownerTeam || missile.hp <= 0 || missile.lifetime <= 0)
            continue;
          const old = starts.get(missile.id) ?? missile.pos;
          const finish = vecAdd(old, vecScale(missile.velocity, Math.min(step, missile.lifetime)));
          const t = sweptHit(vecSub(start, old), vecSub(end, finish), flak?.triggerRadius ?? 5);
          if (t !== null && t < first) {
            first = t;
            victim = null;
            intercepted = missile;
          }
        }
      }
      // Motion is clipped to remaining fuel; no missile can steer or survive beyond it.
      if (mapObstacles) {
        for (const obstacle of mapObstacles) {
          const fraction = step / dt;
          const t = circleContactFraction(
            start[0] - obstacle.previousPos[0],
            start[1] - obstacle.previousPos[1],
            end[0] - start[0] - (obstacle.pos[0] - obstacle.previousPos[0]) * fraction,
            end[1] - start[1] - (obstacle.pos[1] - obstacle.previousPos[1]) * fraction,
            obstacle.radius,
          );
          if (t <= first && Number.isFinite(t)) {
            first = t;
            victim = null;
            intercepted = null;
            blocked = true;
          }
        }
      }
      p.lifetime = Math.max(0, p.lifetime - dt);
      p.pos = vecAdd(start, vecScale(vecSub(end, start), Math.min(first, 1)));
      if (blocked) {
        p.hp = 0;
        p.lifetime = 0;
      } else if (flak && (Number.isFinite(first) || p.lifetime <= 1e-9)) {
        const elapsed = step * Math.min(first, 1);
        this.detonateFlak(p, aliveShips, activeMissiles, shipSweeps, starts, elapsed, dt);
      } else if (intercepted) {
        this.damageProjectile(intercepted, 15, p.ownerTeam, "rotary PD");
        p.hp = 0;
      } else if (victim) {
        const parentId = victim.havenParentId;
        this.context.applyShipDamage(
          victim,
          p.damage,
          p.weapon,
          p.ownerTeam,
          p.ownerId,
          p.ownerMountId,
          p.pos,
        );
        this.refreshDamagedShip(victimIndex, aliveShips, parentId);
        p.hp = 0;
      } else if (p.lifetime > 1e-9) {
        active.push(p);
      }
    }
    this.projectiles = active.filter((p) => p.hp > 0);
  }

  private refreshDamagedShip(
    index: number,
    ships: ShipState[],
    parentId: string | null | undefined,
  ): void {
    const ship = ships[index];
    if (!ship.isAlive) {
      // Destruction refreshes tender amplification, potentially changing other envelopes.
      for (let i = 0; i < ships.length; i++)
        this.hotLoops.updateShip(i, activeShieldRadius(ships[i]), ships[i].isAlive);
      return;
    }
    this.hotLoops.updateShip(index, activeShieldRadius(ship), ship.isAlive);
    // Haven protection can absorb damage on the parent instead of the struck guest.
    const parentIndex = parentId ? this.shipIndices.get(parentId) : undefined;
    if (parentIndex !== undefined) {
      const parent = ships[parentIndex];
      this.hotLoops.updateShip(parentIndex, activeShieldRadius(parent), parent.isAlive);
    }
  }

  private detonateFlak(
    flak: ProjectileState,
    aliveShips: ShipState[],
    activeMissiles: ProjectileState[],
    shipSweeps: Float64Array,
    starts: ReadonlyMap<string, Vector2>,
    elapsed: number,
    dt: number,
  ): void {
    const profile = flak.weapon.flak;
    if (!profile) return;
    const ratio = elapsed / dt;
    for (let i = 0; i < aliveShips.length; i++) {
      const ship = aliveShips[i];
      if (!ship.isAlive || ship.team === flak.ownerTeam) continue;
      const offset = i * 5;
      const dx = flak.pos[0] - (shipSweeps[offset] + shipSweeps[offset + 2] * ratio);
      const dy = flak.pos[1] - (shipSweeps[offset + 1] + shipSweeps[offset + 3] * ratio);
      const shield = activeShieldRadius(ship);
      const bound = Math.max(shield, ship.size) + profile.blastRadius;
      if (dx > bound || dx < -bound || dy > bound || dy < -bound) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const surface = dist >= shield ? dist - shield : Math.max(0, dist - ship.size);
      const falloff = clamp(
        (profile.blastRadius - surface) / (profile.blastRadius - profile.triggerRadius),
        0,
        1,
      );
      if (falloff <= 0) continue;
      const weapon =
        ship.hullClass === "strike_craft"
          ? { ...flak.weapon, shieldMultiplier: 1, armorMultiplier: 1, hullMultiplier: 1 }
          : flak.weapon;
      const parentId = ship.havenParentId;
      this.context.applyShipDamage(
        ship,
        flak.damage * falloff,
        weapon,
        flak.ownerTeam,
        flak.ownerId,
        flak.ownerMountId,
        flak.pos,
      );
      this.refreshDamagedShip(i, aliveShips, parentId);
    }

    for (const other of activeMissiles) {
      if (other.ownerTeam === flak.ownerTeam || other.hp <= 0 || other.lifetime <= 0) continue;
      const old = starts.get(other.id) ?? other.pos;
      const dx = flak.pos[0] - (old[0] + other.velocity[0] * elapsed);
      const dy = flak.pos[1] - (old[1] + other.velocity[1] * elapsed);
      const radius = profile.blastRadius;
      if (dx > radius || dx < -radius || dy > radius || dy < -radius) continue;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        if (!isHeavyTorpedo(other)) {
          // Light missiles retain their stable dispersion cap; armored torpedoes take every hit.
          let dispersion = 2166136261;
          for (let i = 0; i < other.id.length; i++)
            dispersion = Math.imul(dispersion ^ other.id.charCodeAt(i), 16777619);
          dispersion ^= dispersion >>> 16;
          dispersion = Math.imul(dispersion, 0x85ebca6b);
          dispersion ^= dispersion >>> 13;
          dispersion = Math.imul(dispersion, 0xc2b2ae35);
          dispersion ^= dispersion >>> 16;
          if ((dispersion >>> 0) / 0x100000000 >= 0.9) continue;
        }
        this.damageProjectile(other, profile.missileDamage, flak.ownerTeam, "flak burst");
      }
    }

    this.context.onDetonate([...flak.pos], profile.blastRadius, flak.ownerTeam);
    this.context.onFlakAudio(flak);
  }

  damageProjectile(
    projectile: ProjectileState,
    damage: number,
    team: number,
    source: string,
    laserSource?: ShipState,
  ): void {
    if (projectile.hp <= 0 || projectile.lifetime <= 0) return;
    projectile.hp = Math.max(0, projectile.hp - damage);
    if (projectile.hp > 0) return;
    projectile.lifetime = 0;
    this.context.onMissileIntercept(projectile, team, source, laserSource);
  }
}
