import type { ShipState, Vector2 } from "../types/combat";
import { inMountArc, mountPosition } from "./fireControl";
import { limitVelocity } from "./flightBehaviors";
import { clamp, normalizeAngle, vecAdd, vecDot, vecScale, vecSub } from "./math2d";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import { HULL_PROFILES } from "./shipProfiles";

export let ARENA_RADIUS = 1900;
// Legacy telemetry/configuration marker only: no force or speed clamp acts at this radius.
export let ARENA_HARD_PULL_RADIUS = 2200;
export const RADIATION_SHIELD_DECAY = 0.1;
export const RADIATION_HULL_DPS = 30;

export function configureArena(radius: number, hazardMarker = radius * (22 / 19)): void {
  ARENA_RADIUS = radius;
  ARENA_HARD_PULL_RADIUS = hazardMarker;
}

/** At 15% of arena radius beyond the edge, both rates double; depth has no hard cutoff. */
export function radiationIntensity(pos: Vector2): number {
  const excessDist = Math.hypot(...pos) - ARENA_RADIUS;
  return excessDist > 0 ? 1 + (excessDist / (ARENA_RADIUS * 0.15)) ** 2 : 0;
}

/** Environmental exposure bypasses armor only after shields collapse, including mid-step. */
export function applyArenaRadiation(ship: ShipState, dt: number): void {
  if (!ship.isAlive || ship.isDocked || ship.isDebris || dt <= 0) return;
  const intensity = radiationIntensity(ship.pos);
  if (intensity === 0) return;
  const shieldDps = ship.shieldMax * RADIATION_SHIELD_DECAY * intensity;
  const shieldedTime = shieldDps > 0 ? Math.min(dt, ship.shieldCurrent / shieldDps) : 0;
  ship.shieldCurrent = Math.max(0, ship.shieldCurrent - shieldDps * dt);
  ship.hullCurrent = Math.max(
    0,
    ship.hullCurrent - RADIATION_HULL_DPS * intensity * (dt - shieldedTime),
  );
  ship.shieldDelayTimer =
    ship.shieldRechargeDelay ?? HULL_PROFILES[ship.hullClass].shieldRechargeDelay;
}

export function arenaAnticipation(distance: number): number {
  const width = ARENA_RADIUS * 0.25;
  const t = clamp((distance - (ARENA_RADIUS - width)) / width, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Compare a skirting leg followed by an inward return, including turning exposure. */
function returnRouteCost(ship: ShipState, heading: number, ships: ShipState[]) {
  const distance = Math.hypot(...ship.pos);
  const inward: Vector2 = [-ship.pos[0] / distance, -ship.pos[1] / distance];
  const direction: Vector2 = [Math.cos(heading), Math.sin(heading)];
  const inwardSpeed = Math.max(ship.maxSpeed * 0.5, vecDot(direction, inward) * ship.maxSpeed);
  const turnTime = Math.abs(normalizeAngle(heading - ship.heading)) / Math.max(ship.turnRate, 0.01);
  const travelTime = Math.max((distance - ARENA_RADIUS + ship.size * 2) / inwardSpeed, 1);
  const end = vecAdd(ship.pos, vecScale(direction, ship.maxSpeed * travelTime));
  const endDistance = Math.hypot(...end);
  const returnTime = Math.max(0, endDistance - ARENA_RADIUS + ship.size * 2) / ship.maxSpeed;
  const returnDirection = vecScale(end, -1 / Math.max(endDistance, 1));
  const returnTurn =
    returnTime > 0
      ? Math.abs(normalizeAngle(Math.atan2(returnDirection[1], returnDirection[0]) - heading)) /
        Math.max(ship.turnRate, 0.01)
      : 0;
  const duration = turnTime + travelTime + returnTurn + returnTime;
  let shields = ship.shieldCurrent;
  let radiationShields = shields;
  let radiationDamage = 0;
  let damage = 0;
  let elapsed = 0;
  const legs = [
    { start: ship.pos, velocity: [0, 0] as Vector2, duration: turnTime },
    { start: ship.pos, velocity: vecScale(direction, ship.maxSpeed), duration: travelTime },
    { start: end, velocity: [0, 0] as Vector2, duration: returnTurn },
    { start: end, velocity: vecScale(returnDirection, ship.maxSpeed), duration: returnTime },
  ];
  for (const leg of legs) {
    if (leg.duration <= 0) continue;
    const samples = 8;
    const step = leg.duration / samples;
    for (let sample = 1; sample <= samples; sample++) {
      const localTime = step * (sample - 0.5);
      const time = elapsed + localTime;
      const pos = vecAdd(leg.start, vecScale(leg.velocity, localTime));
      const intensity = radiationIntensity(pos);
      const shieldDps = ship.shieldMax * RADIATION_SHIELD_DECAY * intensity;
      const radiationShieldedTime =
        shieldDps > 0 ? Math.min(step, radiationShields / shieldDps) : 0;
      radiationShields = Math.max(0, radiationShields - shieldDps * step);
      radiationDamage += RADIATION_HULL_DPS * intensity * (step - radiationShieldedTime);
      const shieldedTime = shieldDps > 0 ? Math.min(step, shields / shieldDps) : 0;
      shields = Math.max(0, shields - shieldDps * step);
      if (intensity > 0) damage += RADIATION_HULL_DPS * intensity * (step - shieldedTime);
      for (const enemy of ships) {
        if (!enemy.isAlive || enemy.isDocked || enemy.isDebris || enemy.team === ship.team)
          continue;
        const drift = vecScale(enemy.velocity, time);
        const enemyDistance = Math.hypot(...vecSub(pos, vecAdd(enemy.pos, drift)));
        const clearance = shieldEnvelopeRadius(enemy) + shieldEnvelopeRadius(ship);
        // Hull/shield contact can kill light craft outright, regardless of the current gun arc.
        if (isCapitalShip(enemy) && enemyDistance < clearance) damage += ship.hullMax * step;
        const point = vecSub(pos, drift);
        for (const turret of enemy.turrets) {
          if (
            !inMountArc(enemy, turret, point) ||
            Math.hypot(...vecSub(point, mountPosition(enemy, turret))) >
              turret.weapon.range + (turret.weapon.flak?.blastRadius ?? 0)
          )
            continue;
          // Zero-cooldown defense lasers specify continuous DPS; flak uses its real cadence.
          const dps = turret.weapon.damage / (turret.weapon.cooldown || 1);
          const shieldDamage = dps * turret.weapon.shieldMultiplier * step;
          const absorbed = Math.min(shields, shieldDamage);
          shields -= absorbed;
          damage +=
            dps *
            turret.weapon.hullMultiplier *
            step *
            (shieldDamage > 0 ? 1 - absorbed / shieldDamage : 1);
        }
      }
    }
    elapsed += leg.duration;
  }
  // A small path-length cost keeps the direct route preferable when both routes are safe.
  return {
    cost: damage / Math.max(1, ship.hullCurrent) + duration * 0.01,
    damage,
    radiationDamage,
  };
}

/** Threat timestamps are simulation time, so the roll is stable within each five-second window. */
function desperateBreakthrough(ship: ShipState): boolean {
  let seed = 2166136261;
  for (const char of `${ship.id}:${Math.floor((ship.lastThreatTime ?? 0) / 5)}`)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return (seed >>> 0) % 100 < 5;
}

/** Desired thrust only. Actual momentum is changed exclusively by ordinary ship thrusters. */
export function arenaVelocity(ship: ShipState, desired: Vector2, ships: ShipState[] = []): Vector2 {
  const distance = Math.hypot(...ship.pos);
  const anticipation = arenaAnticipation(distance);
  if (anticipation === 0 || ship.maxSpeed <= 0) return desired;
  const outward = vecScale(ship.pos, 1 / distance);
  const radial = vecDot(desired, outward);
  const outwardMotion = Math.max(0, vecDot(ship.velocity, outward));
  if (distance <= ARENA_RADIUS) {
    if (radial <= 0 && outwardMotion === 0) return desired;
    const tangent: Vector2 = [-outward[1], outward[0]];
    const side = Math.sign(vecDot(desired, tangent) || vecDot(ship.velocity, tangent) || 1);
    return limitVelocity(
      vecAdd(
        vecSub(
          desired,
          vecScale(outward, anticipation * (Math.max(0, radial) + outwardMotion * 0.5)),
        ),
        vecScale(tangent, side * anticipation * Math.max(0, radial) * 0.75),
      ),
      ship.maxSpeed,
    );
  }
  const inwardHeading = Math.atan2(-ship.pos[1], -ship.pos[0]);
  let heading = inwardHeading;
  const threats = ships.filter(
    (enemy) => enemy.isAlive && !enemy.isDocked && !enemy.isDebris && enemy.team !== ship.team,
  );
  if (threats.length === 0)
    return [Math.cos(heading) * ship.maxSpeed, Math.sin(heading) * ship.maxSpeed];
  const direct = returnRouteCost(ship, heading, threats);
  let best = direct;
  for (const offset of [
    Math.PI / 6,
    -Math.PI / 6,
    Math.PI / 3,
    -Math.PI / 3,
    Math.PI / 2,
    -Math.PI / 2,
  ]) {
    const candidate = inwardHeading + offset;
    const route = returnRouteCost(ship, candidate, threats);
    if (route.cost < best.cost) {
      heading = candidate;
      best = route;
    }
  }
  if (
    best.radiationDamage >= ship.hullCurrent * 0.95 ||
    (direct.damage >= ship.hullCurrent &&
      best.damage >= ship.hullCurrent &&
      desperateBreakthrough(ship))
  )
    heading = inwardHeading;
  return [Math.cos(heading) * ship.maxSpeed, Math.sin(heading) * ship.maxSpeed];
}
