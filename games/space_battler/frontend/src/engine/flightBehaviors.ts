import type { ProjectileState, ShipState, TurretMountState, Vector2 } from "../types/combat";
import { fullCircle, mountPosition } from "./fireControl";
import { classifyRange, type RangePhase } from "./flightCycles";
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
import {
  activeShieldRadius,
  capitalSeparationDistance,
  escortCapitalStandoff,
  isCapitalShip,
  shieldEnvelopeRadius,
} from "./shieldGeometry";
import { sharesShieldHaven } from "./shieldHaven";
import type { RetreatThresholds, SkirmishFlightDoctrine, StandoffSettings } from "./shipDoctrines";

export interface FlightIntent {
  heading: number;
  velocity: Vector2;
  rangePhase: RangePhase;
  evadingOrdnance?: boolean;
}

export function limitVelocity(velocity: Vector2, max: number): Vector2 {
  const speed = vecDistance([0, 0], velocity);
  return speed > max ? vecScale(velocity, max / speed) : velocity;
}

// Use the final heading after turning; approach drift is also bounded by forward speed.
export function clampLateralVelocity(
  ship: Pick<ShipState, "heading" | "maxSpeed">,
  velocity: Vector2,
  ratio: number,
  rangePhase: RangePhase = "engage",
): Vector2 {
  const forward: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
  const right: Vector2 = [-forward[1], forward[0]];
  const forwardSpeed = vecDot(velocity, forward);
  const lateralLimit =
    rangePhase === "approach"
      ? Math.min(ship.maxSpeed * ratio, Math.abs(forwardSpeed) * Math.tan(Math.PI / 18))
      : ship.maxSpeed * ratio;
  return vecAdd(
    vecScale(forward, forwardSpeed),
    vecScale(right, clamp(vecDot(velocity, right), -lateralLimit, lateralLimit)),
  );
}

// Scalar form of havenHullClearance's rotated elliptical support bound.
function havenHullSupport(ship: ShipState, normalX: number, normalY: number): number {
  if (!isCapitalShip(ship)) return ship.size;
  const cos = Math.cos(-ship.heading);
  const sin = Math.sin(-ship.heading);
  const localX = normalX * cos - normalY * sin;
  const localY = normalX * sin + normalY * cos;
  return ship.size * Math.hypot(localX, localY * 0.75);
}

export function calculateSeparation(ship: ShipState, ships: ShipState[]): Vector2 {
  let resultX = 0;
  let resultY = 0;
  const capital = isCapitalShip(ship);
  const hullClass = ship.hullClass;
  const size = ship.size;
  const envelope = Math.max(size, shieldEnvelopeRadius(ship));
  const radius = activeShieldRadius(ship);
  const maxSpeed = ship.maxSpeed;
  const x = ship.pos[0];
  const y = ship.pos[1];
  const vx = ship.velocity[0];
  const vy = ship.velocity[1];
  const hasHeavyPeer =
    capital &&
    ships.some((peer) => peer.isAlive && peer.id !== ship.id && peer.hullClass !== "strike_craft");
  for (const peer of ships) {
    if (!peer.isAlive || peer.id === ship.id) continue;
    if (hasHeavyPeer && peer.hullClass === "strike_craft") continue;
    const weight = capital && hullClass !== "cruiser" && peer.hullClass === "corvette" ? 0.05 : 1;
    const dx = x - peer.pos[0];
    const dy = y - peer.pos[1];
    const dvx = vx - peer.velocity[0];
    const dvy = vy - peer.velocity[1];
    const closingBound = Math.abs(dvx) + Math.abs(dvy);
    const capitalClearance = capitalSeparationDistance(ship, peer);
    const escortClearance = escortCapitalStandoff(ship, peer);
    const clearanceBound = Math.max(
      capitalClearance,
      escortClearance,
      envelope + Math.max(peer.size, shieldEnvelopeRadius(peer)) + 30,
    );
    const marginBound =
      clearanceBound + (closingBound * closingBound) / 440 + closingBound * 0.15 + 90;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= marginBound * marginBound) continue;
    const distance = Math.sqrt(distanceSquared);
    const inverseDistance = 1 / distance;
    const awayX = distance > 1e-6 ? dx * inverseDistance : 0;
    const awayY = distance > 1e-6 ? dy * inverseDistance : ship.id < peer.id ? -1 : 1;
    const closing = Math.max(0, -(dvx * awayX + dvy * awayY));
    const wingmate =
      hullClass === "strike_craft" && peer.hullClass === "strike_craft" && ship.team === peer.team;
    const nested = sharesShieldHaven(ship, peer);
    const escortStandoff = nested ? 0 : escortClearance;
    let clearance: number;
    if (nested) {
      // Haven support uses vecNormalize's division, not separation's reciprocal multiply.
      const normalX = distance > 1e-6 ? dx / distance : awayX;
      const normalY = distance > 1e-6 ? dy / distance : awayY;
      clearance =
        havenHullSupport(ship, normalX, normalY) + havenHullSupport(peer, normalX, normalY);
    } else {
      clearance = Math.max(
        capitalClearance,
        escortStandoff,
        radius + activeShieldRadius(peer) + (wingmate ? 8 : 30),
      );
    }
    const margin = nested ? clearance : clearance + (closing * closing) / 440 + closing * 0.15;
    if (escortStandoff > 0) {
      // Start braking outside the buffer; full outward thrust at its edge prevents
      // station attraction or an attack orbit from settling inside physical clearance.
      const escortMargin = margin + 90;
      if (distance < escortMargin) {
        const strength = weight * maxSpeed * 2 * Math.min(1, (escortMargin - distance) / 90);
        resultX += awayX * strength;
        resultY += awayY * strength;
      }
      continue;
    }
    if (distance < margin) {
      const strength = weight * maxSpeed * 2 * (1 - distance / margin);
      resultX += awayX * strength;
      resultY += awayY * strength;
    }
  }
  return [resultX, resultY];
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
  const rangePhase = classifyRange(distance, settings.standoffThreshold);
  const closing = rangePhase === "approach";
  return {
    rangePhase,
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
    rangePhase: classifyRange(vecDistance(ship.pos, target.pos), weavingDistance),
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

export function salvoReload(
  mounts: TurretMountState[],
  lastSalvoShot = -Infinity,
): SalvoReloadState {
  const reload = mounts.length ? Math.min(...mounts.map((t) => t.cooldownTimer)) : 0;
  const reloadDuration = Math.max(1, ...mounts.map((t) => t.weapon.cooldown));
  return {
    reloadRatio: reload / reloadDuration,
    reloadDuration,
    lastShot: Math.max(...mounts.map((t) => t.lastFiredTime ?? -Infinity)),
    salvoComplete:
      reload > 0 && mounts.every((t) => (t.lastFiredTime ?? -Infinity) > lastSalvoShot),
  };
}

export function HitAndRunSkirmishBlock(
  ship: ShipState,
  target: ShipState,
  breakoffAngle: number,
  breakoffSpeed: number,
  settings: {
    doctrine: SkirmishFlightDoctrine;
    engagementRange: number;
    ships?: ShipState[];
  },
): FlightIntent {
  const { doctrine, engagementRange } = settings;
  target = imminentSkirmishThreat(ship, settings.ships ?? [], target) ?? target;
  const rangePhase = classifyRange(vecDistance(ship.pos, target.pos), engagementRange);
  const delta = vecSub(target.pos, ship.pos);
  const bearing = Math.atan2(delta[1], delta[0]);
  let side = ship.skirmishCycle?.side ?? 1;
  if (settings.ships) {
    const fleetSide = skirmishFleetSide(ship, settings.ships, bearing);
    if (Math.abs(fleetSide) >= 100) side = Math.sign(fleetSide);
  }
  if (rangePhase === "approach" || ship.skirmishCycle?.phase !== "breakoff")
    return StandoffApproachBlock(
      ship,
      target,
      doctrine.desiredDistance,
      rangePhase === "approach" ? 0 : side * ship.maxSpeed * doctrine.lateralSpeedRatio,
      {
        ...doctrine.approach,
        standoffThreshold: engagementRange,
        aimBearing: bearing,
      },
    );
  const heading = normalizeAngle(bearing + side * breakoffAngle);
  return {
    rangePhase,
    heading,
    velocity: vecScale([Math.cos(heading), Math.sin(heading)], breakoffSpeed),
  };
}

// Rank by time to contact, including our intended approach through a stationary front line.
export function imminentSkirmishThreat(
  ship: ShipState,
  ships: ShipState[],
  target?: ShipState,
): ShipState | null {
  const approach = target
    ? vecScale(vecNormalize(vecSub(target.pos, ship.pos)), ship.maxSpeed)
    : ship.velocity;
  let threat: ShipState | null = null;
  let soonest = Infinity;
  for (const enemy of ships) {
    if (
      !enemy.isAlive ||
      enemy.isDocked ||
      enemy.isDebris ||
      enemy.team === ship.team ||
      !["battleship", "dreadnought", "cruiser"].includes(enemy.hullClass)
    )
      continue;
    const distance = vecDistance(ship.pos, enemy.pos);
    if (distance >= 750) continue;
    const toward = vecNormalize(vecSub(enemy.pos, ship.pos));
    const closing = Math.max(
      vecDot(vecSub(ship.velocity, enemy.velocity), toward),
      vecDot(vecSub(approach, enemy.velocity), toward),
    );
    if (closing <= 0) continue;
    const arrival = distance / closing;
    if (arrival < soonest || (arrival === soonest && enemy.id < (threat?.id ?? ""))) {
      threat = enemy;
      soonest = arrival;
    }
  }
  return threat;
}

export function emergencySkirmishBreakout(
  ship: ShipState,
  ships: ShipState[],
  arenaRadius: number,
): FlightIntent | null {
  if (vecDistance([0, 0], ship.pos) <= arenaRadius * 0.85) return null;
  let hostiles = 0;
  let friendlies = 1;
  let pressed = false;
  let away: Vector2 = [0, 0];
  for (const peer of ships) {
    if (peer.id === ship.id || !peer.isAlive || peer.isDocked || peer.isDebris) continue;
    const distance = vecDistance(ship.pos, peer.pos);
    if (distance >= 750) continue;
    if (peer.team === ship.team) {
      friendlies++;
      continue;
    }
    hostiles++;
    pressed ||=
      peer.hullClass === "battleship" ||
      peer.hullClass === "dreadnought" ||
      peer.hullClass === "cruiser";
    away = vecAdd(away, vecScale(vecNormalize(vecSub(ship.pos, peer.pos)), 1 - distance / 750));
  }
  if (!pressed && hostiles <= friendlies) return null;
  const inward = vecScale(vecNormalize(ship.pos), -1);
  // Keep an inward component even when hostile lines lie between us and the center.
  const direction = vecNormalize(vecAdd(inward, vecScale(vecNormalize(away), 0.65)));
  return {
    heading: Math.atan2(direction[1], direction[0]),
    velocity: vecScale(direction, ship.maxSpeed),
    rangePhase: "engage",
  };
}

export function formationVelocity(ship: ShipState, anchor: ShipState, station: Vector2): Vector2 {
  return vecAdd(anchor.velocity, vecScale(vecSub(station, ship.pos), 0.6));
}

// Choose the fleet-facing evasive side without changing radial thrust or speed.
export function skirmishFleetVelocity(
  ship: ShipState,
  desired: Vector2,
  ships: ShipState[],
  bearing = ship.heading,
): Vector2 {
  const nx = -Math.sin(bearing);
  const ny = Math.cos(bearing);
  const lateral = desired[0] * nx + desired[1] * ny;
  const fleetSide = skirmishFleetSide(ship, ships, bearing);
  if (lateral * fleetSide >= 0 || Math.abs(fleetSide) < 100) return desired;
  return [desired[0] - 2 * lateral * nx, desired[1] - 2 * lateral * ny];
}

function skirmishFleetSide(ship: ShipState, ships: ShipState[], bearing: number): number {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const peer of ships) {
    if (
      peer.id === ship.id ||
      !peer.isAlive ||
      peer.isDocked ||
      peer.isDebris ||
      peer.team !== ship.team ||
      !isCapitalShip(peer)
    )
      continue;
    x += peer.pos[0];
    y += peer.pos[1];
    count++;
  }
  if (!count) return 0;
  const nx = -Math.sin(bearing);
  const ny = Math.cos(bearing);
  return (x / count - ship.pos[0]) * nx + (y / count - ship.pos[1]) * ny;
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
  const range = turret.weapon.range + shieldEnvelopeRadius(ship) + 80;
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
    const margin =
      turnBuffer + Math.asin(clamp(shieldEnvelopeRadius(ship) / Math.max(1, distance), 0, 1));
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
  time: number,
): Vector2 {
  const skirmisher = ship.hullClass === "missile_frigate";
  const retained = skirmisher && (ship.escapeUntil ?? 0) > time;
  let closestArrival = Infinity;
  let escapeVelocity: Vector2 | null = null;
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
    if (arrival <= 0 || arrival > Math.min(skirmisher ? 2 : 1.5, missile.lifetime)) continue;
    const closest = vecAdd(relative, vecScale(closing, arrival));
    if (!retained && vecDistance([0, 0], closest) > activeShieldRadius(ship) + 25) continue;
    const direction = vecNormalize(missile.velocity);
    const lateral: Vector2 = [-direction[1], direction[0]];
    const escapeSign = retained
      ? (ship.escapeSide ?? side)
      : Math.sign(vecDot(relative, lateral)) || side;
    if (skirmisher) {
      if (arrival < closestArrival) {
        closestArrival = arrival;
        escapeVelocity = vecScale(lateral, escapeSign * ship.maxSpeed);
        // Finish the jink instead of cancelling as soon as lateral thrust predicts a miss.
        if (!retained) {
          ship.escapeSide = escapeSign;
          ship.escapeUntil = time + Math.min(arrival, 0.75);
        }
      }
    } else {
      velocity = vecAdd(velocity, vecScale(lateral, escapeSign * ship.maxSpeed * 2));
    }
  }
  return escapeVelocity ?? velocity;
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
    return torpedoEscape(
      ship,
      projectiles,
      ship.skirmishCycle?.side ?? ship.broadsideSide ?? 1,
      velocity,
      time,
    );
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
        shieldEnvelopeRadius(ship) +
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
