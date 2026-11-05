import type { ProjectileState, ShipState, TurretMountState, Vector2 } from "../types/combat";
import { fullCircle, mountPosition } from "./fireControl";
import {
  clamp,
  normalizeAngle,
  vecAdd,
  vecDistance,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";
import type { RetreatThresholds, SkirmishFlightDoctrine, StandoffSettings } from "./shipDoctrines";

export interface FlightIntent {
  heading: number;
  velocity: Vector2;
}

export function limitVelocity(velocity: Vector2, max: number): Vector2 {
  const speed = vecDistance([0, 0], velocity);
  return speed > max ? vecScale(velocity, max / speed) : velocity;
}

// Apply after composing steering and separation so collision corrections share the drift cap.
export function clampLateralVelocity(ship: ShipState, velocity: Vector2, ratio: number): Vector2 {
  const forward: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
  const right: Vector2 = [-forward[1], forward[0]];
  return vecAdd(
    vecScale(forward, vecDot(velocity, forward)),
    vecScale(right, clamp(vecDot(velocity, right), -ship.maxSpeed * ratio, ship.maxSpeed * ratio)),
  );
}

export function calculateSeparation(ship: ShipState, ships: ShipState[]): Vector2 {
  let result: Vector2 = [0, 0];
  for (const peer of ships) {
    if (!peer.isAlive || peer.id === ship.id) continue;
    const distance = vecDistance(ship.pos, peer.pos);
    const away: Vector2 =
      distance > 1e-6
        ? vecScale(vecSub(ship.pos, peer.pos), 1 / distance)
        : [0, ship.id < peer.id ? -1 : 1];
    const closing = Math.max(0, -vecDot(vecSub(ship.velocity, peer.velocity), away));
    const wingmate =
      ship.hullClass === "strike_craft" &&
      peer.hullClass === "strike_craft" &&
      ship.team === peer.team;
    const clearance =
      ship.size * (ship.shieldCurrent > 0 ? 1.4 : 1) +
      peer.size * (peer.shieldCurrent > 0 ? 1.4 : 1) +
      (wingmate ? 8 : 30);
    const margin = clearance + (closing * closing) / 440 + closing * 0.15;
    if (distance < margin)
      result = vecAdd(result, vecScale(away, ship.maxSpeed * 2 * (1 - distance / margin)));
  }
  return result;
}

function relativeVelocity(
  ship: ShipState,
  target: ShipState,
  radial: number,
  lateral: number,
  direction?: Vector2,
): Vector2 {
  const n = direction ?? vecNormalize(vecSub(target.pos, ship.pos));
  return vecAdd(vecScale(n, radial), vecScale([-n[1], n[0]], lateral));
}

export function StandoffApproachBlock(
  ship: ShipState,
  target: ShipState,
  desiredDistance: number,
  lateralBias: number,
  settings: StandoffSettings & {
    standoffThreshold: number;
    aimBearing: number;
    reverseScale?: number;
    radialBias?: number;
    direction?: Vector2;
  },
): FlightIntent & { closing: boolean; radialSpeed: number } {
  const delta = vecSub(target.pos, ship.pos);
  const distance = vecDistance(ship.pos, target.pos);
  const error = distance - desiredDistance;
  let radial = clamp(
    settings.radialGain * Math.sign(error) * Math.max(0, Math.abs(error) - settings.deadband),
    -ship.maxSpeed * settings.reverseSpeedRatio,
    ship.maxSpeed * settings.forwardSpeedRatio,
  );
  if (radial < 0) radial *= settings.reverseScale ?? 1;
  radial += settings.radialBias ?? 0;
  const closing = distance > settings.standoffThreshold;
  return {
    heading: normalizeAngle(closing ? Math.atan2(delta[1], delta[0]) : settings.aimBearing),
    velocity: relativeVelocity(ship, target, radial, lateralBias, settings.direction),
    closing,
    radialSpeed: radial,
  };
}

export function BroadsideWeaveBlock(
  ship: ShipState,
  target: ShipState,
  arcOffset: number,
  side: number,
  weavingDistance: number,
  motion: { bearing: number; radialSpeed: number; lateralBias: number },
): FlightIntent {
  const weaving = vecDistance(ship.pos, target.pos) <= weavingDistance;
  const lateral = (weaving ? ship.maxSpeed * 0.3 * side : 0) + motion.lateralBias;
  return {
    heading: normalizeAngle(motion.bearing - (weaving ? side * arcOffset : 0)),
    velocity: relativeVelocity(ship, target, motion.radialSpeed, lateral),
  };
}

export interface SalvoReloadState {
  reloadRatio: number;
  reloadDuration: number;
  lastShot: number;
  salvoComplete: boolean;
}

export function salvoReload(ship: ShipState, mounts: TurretMountState[]): SalvoReloadState {
  const reload = mounts.length ? Math.min(...mounts.map((t) => t.cooldownTimer)) : 0;
  const reloadDuration = Math.max(1, ...mounts.map((t) => t.weapon.cooldown));
  return {
    reloadRatio: reload / reloadDuration,
    reloadDuration,
    lastShot: Math.max(...mounts.map((t) => t.lastFiredTime ?? -Infinity)),
    salvoComplete:
      reload > 0 &&
      mounts.every((t) => (t.lastFiredTime ?? -Infinity) > (ship.lastManeuverShot ?? -Infinity)),
  };
}

export function HitAndRunSkirmishBlock(
  ship: ShipState,
  target: ShipState,
  reloadRatio: number,
  breakoffAngle: number,
  breakoffSpeed: number,
  settings: {
    doctrine: SkirmishFlightDoctrine;
    salvo: SalvoReloadState;
    aimBearing: number;
  },
): FlightIntent {
  const { doctrine, salvo, aimBearing } = settings;
  const slot = Number(ship.id.split("_").at(-1)) || 0;
  ship.broadsideSide ??= slot % 2 === 0 ? 1 : -1;
  ship.maneuverTargetId = target.id;
  if (salvo.salvoComplete || reloadRatio > doctrine.breakoffReload / salvo.reloadDuration) {
    ship.capitalManeuver = "broadside_hold";
    ship.lastManeuverShot = salvo.lastShot;
  }
  if (
    ship.capitalManeuver === "broadside_hold" &&
    reloadRatio < doctrine.reacquireReload / salvo.reloadDuration
  )
    ship.capitalManeuver = "bow_reacquire";
  ship.capitalManeuver ??= "bow_acquire";
  const side = ship.broadsideSide;
  if (ship.capitalManeuver !== "broadside_hold")
    return StandoffApproachBlock(
      ship,
      target,
      doctrine.desiredDistance,
      side * ship.maxSpeed * doctrine.lateralSpeedRatio,
      { ...doctrine.approach, standoffThreshold: Infinity, aimBearing },
    );
  const delta = vecSub(target.pos, ship.pos);
  const bearing = Math.atan2(delta[1], delta[0]);
  const heading = normalizeAngle(bearing + side * breakoffAngle);
  return { heading, velocity: vecScale([Math.cos(heading), Math.sin(heading)], breakoffSpeed) };
}

export function formationVelocity(ship: ShipState, anchor: ShipState, station: Vector2): Vector2 {
  return vecAdd(anchor.velocity, vecScale(vecSub(station, ship.pos), 0.6));
}

export function LowHealthRetreatBlock(
  ship: ShipState,
  anchor: ShipState,
  station: Vector2,
  thresholds: RetreatThresholds,
): Vector2 | null {
  const hullRatio = ship.hullCurrent / Math.max(1, ship.hullMax);
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  if (
    (thresholds.hullRatio !== undefined && hullRatio <= thresholds.hullRatio) ||
    (thresholds.shieldRatio !== undefined && shieldRatio <= thresholds.shieldRatio)
  )
    return formationVelocity(ship, anchor, station);
  return null;
}

// Instant beams can fire again while a capital turns, so include a buffer beyond both arc and range.
function beamEscape(ship: ShipState, enemy: ShipState, turret: TurretMountState): Vector2 {
  const muzzle = mountPosition(enemy, turret);
  const relative = vecSub(ship.pos, muzzle);
  const future = vecAdd(relative, vecScale(vecSub(ship.velocity, enemy.velocity), 0.7));
  const range = turret.weapon.range + ship.size * 1.4 + 80;
  const [minArc, maxArc] = turret.baseArc;
  const center = (minArc + maxArc) / 2;
  const halfArc = (maxArc - minArc) / 2;
  const turnBuffer = 0.12 + Math.min(0.3, enemy.turnRate * 0.4);
  let best: Vector2 = [0, 0];
  let bestDepth = -Infinity;
  for (const point of [relative, future]) {
    const distance = vecDistance([0, 0], point);
    if (distance > range) continue;
    const bearing = Math.atan2(point[1], point[0]);
    const angle = normalizeAngle(bearing - enemy.heading - center);
    const margin = turnBuffer + Math.asin(clamp((ship.size * 1.4) / Math.max(1, distance), 0, 1));
    const angularDepth = halfArc + margin - Math.abs(angle);
    if (!fullCircle(turret) && angularDepth < 0) continue;
    const radialDepth = range - distance;
    const depth = fullCircle(turret) ? radialDepth : Math.min(radialDepth, distance * angularDepth);
    if (depth <= bestDepth) continue;
    bestDepth = depth;
    const outward: Vector2 = distance > 1e-6 ? vecScale(point, 1 / distance) : [1, 0];
    const side = Math.sign(angle) || ((Number(ship.id.split("_").at(-1)) || 0) % 2 ? -1 : 1);
    const direction: Vector2 =
      fullCircle(turret) || radialDepth <= distance * angularDepth
        ? outward
        : [-outward[1] * side, outward[0] * side];
    best = vecScale(direction, ship.maxSpeed * 0.25);
  }
  return best;
}

// Slow flagships bank early across a torpedo's course rather than trying to outrun it.
function torpedoEscape(
  ship: ShipState,
  projectiles: ProjectileState[],
  side: number,
  velocity: Vector2,
): Vector2 {
  for (const missile of projectiles) {
    if (
      missile.ownerTeam === ship.team ||
      missile.weaponType !== "missile" ||
      missile.hp <= 0 ||
      missile.lifetime <= 0
    )
      continue;
    const relative = vecSub(ship.pos, missile.pos);
    const closing = vecSub(ship.velocity, missile.velocity);
    const arrival = -vecDot(relative, closing) / Math.max(1, vecDot(closing, closing));
    if (arrival <= 0 || arrival > Math.min(1.5, missile.lifetime)) continue;
    const closest = vecAdd(relative, vecScale(closing, arrival));
    if (vecDistance([0, 0], closest) > ship.size + 25) continue;
    const direction = vecNormalize(missile.velocity);
    const lateral: Vector2 = [-direction[1], direction[0]];
    const escapeSign = Math.sign(vecDot(relative, lateral)) || side;
    velocity = vecAdd(velocity, vecScale(lateral, escapeSign * ship.maxSpeed * 2));
  }
  return velocity;
}

// Predict the finite gimbal corridor before firing, and also avoid shells already in flight.
export function OrdnanceAvoidanceBlock(
  ship: ShipState,
  projectiles: ProjectileState[],
  ships: ShipState[],
  time: number,
  mode: "corridor" | "torpedo" = "corridor",
  velocity: Vector2 = [0, 0],
): Vector2 {
  if (mode === "torpedo")
    return torpedoEscape(ship, projectiles, ship.broadsideSide ?? 1, velocity);
  let avoidance: Vector2 = [0, 0];
  let beamAvoidance: Vector2 = [0, 0];
  let closestBeam = Infinity;
  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.team === ship.team) continue;
    for (const turret of enemy.turrets) {
      if (
        (ship.hullClass === "corvette" || ship.hullClass === "strike_craft") &&
        (enemy.hullClass === "cruiser" || enemy.hullClass === "battleship") &&
        turret.weapon.weaponType === "beam_laser"
      ) {
        const beam = beamEscape(ship, enemy, turret);
        const distance = vecDistance(ship.pos, mountPosition(enemy, turret));
        if (vecDot(beam, beam) > 0 && distance < closestBeam) {
          closestBeam = distance;
          beamAvoidance = beam;
        }
      }
      if (!turret.isSpinalGimbal) continue;
      const muzzle = mountPosition(enemy, turret);
      const forward: Vector2 = [Math.cos(enemy.heading), Math.sin(enemy.heading)];
      const lateral: Vector2 = [-forward[1], forward[0]];
      const relative = vecSub(ship.pos, muzzle);
      const x = vecDot(relative, forward);
      const arrival =
        Math.max(0, turret.cooldownTimer) + Math.max(0, x) / turret.weapon.projectileSpeed;
      if (arrival > 1.5) continue;
      const predicted = vecAdd(
        relative,
        vecScale(vecSub(ship.velocity, enemy.velocity), clamp(arrival, 0.2, 1.5)),
      );
      const futureX = vecDot(predicted, forward);
      const y = vecDot(relative, lateral);
      const futureY = vecDot(predicted, lateral);
      const lateralDistance = y * futureY < 0 ? 0 : Math.min(Math.abs(y), Math.abs(futureY));
      const width =
        ship.size * 1.4 +
        35 +
        Math.max(x, futureX) * Math.tan(Math.max(...turret.baseArc.map(Math.abs)) + 0.05);
      if (
        Math.max(x, futureX) <= 0 ||
        Math.min(x, futureX) > turret.weapon.range + ship.size ||
        lateralDistance > width + 50
      )
        continue;
      if ((ship.escapeUntil ?? 0) <= time) {
        ship.escapeSide =
          Math.abs(y) > 5
            ? Math.sign(y)
            : (Number(ship.id.split("_").at(-1)) || 0) % 2 === 0
              ? 1
              : -1;
        ship.escapeUntil = time + 1;
      }
      avoidance = vecAdd(avoidance, vecScale(lateral, (ship.escapeSide ?? 1) * ship.maxSpeed * 2));
    }
  }
  for (const p of projectiles) {
    if (
      p.ownerTeam === ship.team ||
      (p.weaponType !== "railgun" &&
        !(ship.hullClass === "strike_craft" && p.weaponType === "missile")) ||
      p.hp <= 0 ||
      p.lifetime <= 0
    )
      continue;
    const relative = vecSub(ship.pos, p.pos);
    const v = vecSub(ship.velocity, p.velocity);
    const t = clamp(-vecDot(relative, v) / Math.max(1, vecDot(v, v)), 0, Math.min(1.5, p.lifetime));
    const closest = vecAdd(relative, vecScale(v, t));
    if (vecDistance([0, 0], closest) > ship.size + 45) continue;
    const direction = vecNormalize(p.velocity);
    const lateral: Vector2 = [-direction[1], direction[0]];
    const side = Math.sign(vecDot(relative, lateral)) || ship.escapeSide || 1;
    avoidance = vecAdd(avoidance, vecScale(lateral, side * ship.maxSpeed * 2));
  }
  return vecAdd(velocity, vecAdd(avoidance, beamAvoidance));
}
