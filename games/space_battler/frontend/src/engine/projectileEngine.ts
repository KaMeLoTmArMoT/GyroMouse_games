import type { ProjectileState, ShipState, Vector2, WeaponDefinition } from "../types/combat";
import { circleContactFraction, type MapObstacle } from "./battleMaps";
import { sweptHit } from "./fireControl";
import { clamp, normalizeAngle, vecAdd, vecDistance, vecDot, vecScale, vecSub } from "./math2d";
import { activeShieldRadius } from "./shieldGeometry";
import { isHeavyTorpedo, pointDefenseMode } from "./shipProfiles";

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
  private readonly sweepShips: ShipState[] = [];
  // Source-ordered old X/Y and full-tick displacement X/Y, reused between phases.
  private shipSweeps = new Float64Array(0);
  private readonly relativeStart: Vector2 = [0, 0];
  private readonly relativeEnd: Vector2 = [0, 0];

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
    if (this.shipSweeps.length < shipCount * 4)
      this.shipSweeps = new Float64Array(Math.max(shipCount * 4, this.shipSweeps.length * 2));
    const shipSweeps = this.shipSweeps;
    const sweepShips = this.sweepShips;
    sweepShips.length = shipCount;
    for (let i = 0; i < shipCount; i++) {
      const ship = aliveShips[i];
      const old = previousPositions.get(ship.id) ?? ship.pos;
      const offset = i * 4;
      sweepShips[i] = ship;
      shipSweeps[offset] = old[0];
      shipSweeps[offset + 1] = old[1];
      shipSweeps[offset + 2] = ship.pos[0] - old[0];
      shipSweeps[offset + 3] = ship.pos[1] - old[1];
    }
    const active: ProjectileState[] = [];
    const starts = new Map(this.projectiles.map((p) => [p.id, p.pos]));
    for (const p of this.projectiles) {
      if (p.hp <= 0 || p.lifetime <= 0) continue;
      const step = Math.min(dt, p.lifetime);

      // Lost locks acquire the closest hostile within a forward 60-degree seeker arc.
      if (p.weaponType === "missile" && p.targetId) {
        const currentAngle = Math.atan2(p.velocity[1], p.velocity[0]);
        let target = aliveShips.find(
          (s) => s.id === p.targetId && s.isAlive && !s.isDebris && s.team !== p.ownerTeam,
        );
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
      let first = Infinity;
      let victim: ShipState | null = null;
      let victimDistance = Infinity;
      let intercepted: ProjectileState | null = null;
      let blocked = false;
      // Rails share the first-hit sweep; they do not pierce subsequent targets.
      for (let i = 0; i < shipCount; i++) {
        const ship = sweepShips[i];
        if (!ship.isAlive || ship.team === p.ownerTeam) continue;
        const offset = i * 4;
        const r0x = start[0] - shipSweeps[offset];
        const r0y = start[1] - shipSweeps[offset + 1];
        const r1x = end[0] - (shipSweeps[offset] + shipSweeps[offset + 2] * fraction);
        const r1y = end[1] - (shipSweeps[offset + 1] + shipSweeps[offset + 3] * fraction);
        // Damage from earlier projectiles can change the shield envelope in this phase.
        const radius = activeShieldRadius(ship) + (flak?.triggerRadius ?? 0);
        if (
          (r0x > radius && r1x > radius) ||
          (r0x < -radius && r1x < -radius) ||
          (r0y > radius && r1y > radius) ||
          (r0y < -radius && r1y < -radius)
        )
          continue;
        this.relativeStart[0] = r0x;
        this.relativeStart[1] = r0y;
        this.relativeEnd[0] = r1x;
        this.relativeEnd[1] = r1y;
        const t = sweptHit(this.relativeStart, this.relativeEnd, radius);
        if (t !== null) {
          const distToShip = Math.sqrt(r0x * r0x + r0y * r0y);
          const isBetter =
            t < first ||
            (t === first &&
              (ship.id === p.targetId || (victim !== null && distToShip < victimDistance)));
          if (isBetter) {
            first = t;
            victim = ship;
            victimDistance = distToShip;
          }
        }
      }
      if (flak || pointDefenseMode(p.weapon) === "rotary") {
        for (const missile of this.projectiles) {
          if (
            missile.weaponType !== "missile" ||
            missile.ownerTeam === p.ownerTeam ||
            missile.hp <= 0 ||
            missile.lifetime <= 0
          )
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
        const positions = new Map<string, Vector2>();
        for (const ship of aliveShips) {
          const old = previousPositions.get(ship.id) ?? ship.pos;
          positions.set(ship.id, vecAdd(old, vecScale(vecSub(ship.pos, old), elapsed / dt)));
        }
        for (const missile of this.projectiles)
          positions.set(
            missile.id,
            vecAdd(starts.get(missile.id) ?? missile.pos, vecScale(missile.velocity, elapsed)),
          );
        this.detonateFlak(p, aliveShips, positions);
      } else if (intercepted) {
        this.damageProjectile(intercepted, 15, p.ownerTeam, "rotary PD");
        p.hp = 0;
      } else if (victim) {
        this.context.applyShipDamage(
          victim,
          p.damage,
          p.weapon,
          p.ownerTeam,
          p.ownerId,
          p.ownerMountId,
          p.pos,
        );
        p.hp = 0;
      } else if (p.lifetime > 1e-9) {
        active.push(p);
      }
    }
    this.projectiles = active.filter((p) => p.hp > 0);
  }

  private detonateFlak(
    flak: ProjectileState,
    aliveShips: ShipState[],
    positions: Map<string, Vector2>,
  ): void {
    const profile = flak.weapon.flak;
    if (!profile) return;
    for (const ship of aliveShips) {
      if (!ship.isAlive || ship.team === flak.ownerTeam) continue;
      const dist = vecDistance(flak.pos, positions.get(ship.id) ?? ship.pos);
      const shield = activeShieldRadius(ship);
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
      this.context.applyShipDamage(
        ship,
        flak.damage * falloff,
        weapon,
        flak.ownerTeam,
        flak.ownerId,
        flak.ownerMountId,
        flak.pos,
      );
    }

    for (const other of this.projectiles) {
      if (
        other.weaponType !== "missile" ||
        other.ownerTeam === flak.ownerTeam ||
        other.hp <= 0 ||
        other.lifetime <= 0
      )
        continue;
      if (vecDistance(flak.pos, positions.get(other.id) ?? other.pos) <= profile.blastRadius) {
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
