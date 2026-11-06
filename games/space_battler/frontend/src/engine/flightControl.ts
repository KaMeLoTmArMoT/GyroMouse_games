import type {
  GroupOrder,
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
} from "../types/combat";
import {
  damagedTargetPriority,
  interceptTime,
  mountPosition,
  squadFocusPriority,
} from "./fireControl";
import {
  BroadsideWeaveBlock,
  calculateSeparation,
  clampLateralVelocity,
  type FlightIntent,
  formationVelocity,
  HitAndRunSkirmishBlock,
  LowHealthRetreatBlock,
  limitVelocity,
  OrdnanceAvoidanceBlock,
  StandoffApproachBlock,
  salvoReload,
} from "./flightBehaviors";
import { classifyRange, reduceBroadsideCycle, reduceSkirmishCycle } from "./flightCycles";
import {
  clamp,
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";
import { type CapitalFlightDoctrine, SHIP_DOCTRINES } from "./shipDoctrines";

// Keep simulation callers on the existing API while sharing the underlying behavior blocks.
export { calculateSeparation, calculateSeparation as separation, limitVelocity };

export let ARENA_RADIUS = 1900;
export let ARENA_HARD_PULL_RADIUS = 2200;

export function configureArena(radius: number, hardPullRadius: number): void {
  ARENA_RADIUS = radius;
  ARENA_HARD_PULL_RADIUS = hardPullRadius;
}

function arenaAnticipation(distance: number): number {
  const width = Math.min(550, ARENA_RADIUS);
  const t = clamp((distance - (ARENA_RADIUS - width)) / width, 0, 1);
  return t * t * (3 - 2 * t);
}

// Preserve tangential motion while smoothly replacing outward thrust with inward steering.
export function arenaVelocity(ship: ShipState, desired: Vector2): Vector2 {
  const distance = vecDistance([0, 0], ship.pos);
  if (distance <= ARENA_RADIUS - Math.min(550, ARENA_RADIUS)) return desired;
  const outward = vecScale(ship.pos, 1 / distance);
  const radial = vecDot(desired, outward);
  const outwardMotion = Math.max(0, vecDot(ship.velocity, outward));
  const outwardThrust = Math.max(0, radial);
  const anticipation = arenaAnticipation(distance);
  const tangent: Vector2 = [-outward[1], outward[0]];
  const tangentDirection = vecDot(desired, tangent) || vecDot(ship.velocity, tangent) || 1;
  let corrected = vecSub(
    desired,
    vecScale(outward, anticipation * (outwardThrust + outwardMotion * 0.5)),
  );
  corrected = vecAdd(
    corrected,
    vecScale(tangent, Math.sign(tangentDirection) * anticipation * outwardThrust * 0.75),
  );
  if (distance <= ARENA_RADIUS) return limitVelocity(corrected, ship.maxSpeed);
  const t = clamp((distance - ARENA_RADIUS) / (ARENA_HARD_PULL_RADIUS - ARENA_RADIUS), 0, 1);
  const blend = t * t * (3 - 2 * t);
  return limitVelocity(
    vecSub(
      corrected,
      vecScale(outward, blend * (Math.max(0, vecDot(corrected, outward)) + ship.maxSpeed)),
    ),
    ship.maxSpeed,
  );
}

export const FIGHTER_DISPERSAL_RADIUS = 200;

export function fighterIngressHeading(bearing: number, wingIndex: number): number {
  const flank = [0, 1, -1][wingIndex % 3];
  return normalizeAngle(bearing + (flank * 40 * Math.PI) / 180);
}

// Sample wing density at echelon centers so every wingmate receives the same soft push.
// Short-range hull separation still handles individual craft without breaking the echelon.
export function fighterDispersal(ship: ShipState, ships: ShipState[]): Vector2 {
  if (ship.hullClass !== "strike_craft") return [0, 0];
  const key = (craft: ShipState) => `${craft.groupId}:${craft.wingIndex ?? "unassigned"}`;
  const wings = new Map<string, { sum: Vector2; count: number }>();
  for (const peer of ships) {
    if (!peer.isAlive || peer.team !== ship.team || peer.hullClass !== "strike_craft") continue;
    const wingKey = key(peer);
    const wing = wings.get(wingKey) ?? { sum: [0, 0], count: 0 };
    wing.sum = vecAdd(wing.sum, peer.pos);
    wing.count++;
    wings.set(wingKey, wing);
  }
  const ownKey = key(ship);
  const own = wings.get(ownKey);
  if (!own) return [0, 0];
  const center = vecScale(own.sum, 1 / own.count);
  let repulsion: Vector2 = [0, 0];
  for (const [wingKey, wing] of wings) {
    if (wingKey === ownKey) continue;
    const delta = vecSub(center, vecScale(wing.sum, 1 / wing.count));
    const distance = vecDistance([0, 0], delta);
    if (distance >= FIGHTER_DISPERSAL_RADIUS) continue;
    const away: Vector2 =
      distance > 1e-6 ? vecScale(delta, 1 / distance) : [0, ownKey < wingKey ? -1 : 1];
    const falloff = (1 - distance / FIGHTER_DISPERSAL_RADIUS) ** 2;
    repulsion = vecAdd(repulsion, vecScale(away, ship.maxSpeed * 0.8 * falloff));
  }
  return limitVelocity(repulsion, ship.maxSpeed);
}

// Same world-space chirality for reciprocal opponents; never derived from heading error.
export function orbitVelocity(ship: ShipState, target: ShipState, radius = 300): Vector2 {
  const distance = vecDistance(ship.pos, target.pos);
  const n: Vector2 =
    distance > 1e-6
      ? vecScale(vecSub(target.pos, ship.pos), 1 / distance)
      : [ship.id < target.id ? 1 : -1, 0];
  const error = distance - radius;
  const tangent = ship.maxSpeed * 0.55 * clamp(1 - Math.abs(error) / radius, 0.25, 1);
  const approach = StandoffApproachBlock(ship, target, radius, tangent, {
    radialGain: 0.7,
    deadband: 25,
    reverseSpeedRatio: 0.65,
    forwardSpeedRatio: 0.7,
    standoffThreshold: radius,
    aimBearing: Math.atan2(n[1], n[0]),
    direction: n,
  });
  // Limited feed-forward prevents mutually chasing velocities from saturating both ships.
  return vecAdd(vecScale(target.velocity, 0.35), approach.velocity);
}

export function escortVelocity(
  ship: ShipState,
  target: ShipState | null,
  ships: ShipState[],
): Vector2 {
  let anchor = ships.find((s) => s.isAlive && s.team === ship.team && s.id === ship.flagshipId);
  if (!anchor) {
    const capitals = ships.filter(
      (s) =>
        s.isAlive &&
        s.team === ship.team &&
        (s.hullClass === "battleship" ||
          s.hullClass === "dreadnought" ||
          s.hullClass === "cruiser"),
    );
    capitals.sort(
      (a, b) =>
        ships.filter((s) => s.flagshipId === a.id).length -
          ships.filter((s) => s.flagshipId === b.id).length || a.id.localeCompare(b.id),
    );
    anchor = capitals[0];
    ship.flagshipId = anchor?.id;
  }
  if (!anchor)
    return target
      ? orbitVelocity(ship, target, target.hullClass === "cruiser" ? 230 : 300)
      : [0, 0];
  const index = Number(ship.id.split("_").at(-1)) || 0;
  const side = index % 2 === 0 ? 1 : -1;
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  const sortie = clamp((shieldRatio - 0.4) / 0.3, 0, 1);
  const tether = 380 + sortie * 220;
  const closeOffset: Vector2 = [
    120 - Math.floor(index / 2) * 45,
    side * (150 + Math.floor(index / 2) * 45),
  ];
  // Healthy pickets occupy a forward/lateral screen even when capitals fight at long range.
  const screenOffset = vecScale(
    vecNormalize([1, side * (0.5 + Math.floor(index / 2) * 0.15)]),
    550,
  );
  const station = vecAdd(
    anchor.pos,
    rotatePoint(
      vecAdd(vecScale(closeOffset, 1 - sortie), vecScale(screenOffset, sortie)),
      anchor.heading,
    ),
  );
  const doctrine = SHIP_DOCTRINES[ship.hullClass].flight;
  if (doctrine.kind === "escort") {
    const retreat = LowHealthRetreatBlock(ship, anchor, station, doctrine.retreat);
    if (retreat) return retreat;
  }
  const stationVelocity = formationVelocity(ship, anchor, station);
  if (
    !target ||
    vecDistance(target.pos, anchor.pos) > 600 + sortie * 600 ||
    vecDistance(target.pos, ship.pos) > 600 ||
    vecDistance(ship.pos, anchor.pos) > tether
  )
    return stationVelocity;
  return vecAdd(vecScale(stationVelocity, 0.65), vecScale(orbitVelocity(ship, target), 0.35));
}

export function spinalEscape(
  ship: ShipState,
  ships: ShipState[],
  projectiles: ProjectileState[],
  time: number,
): Vector2 {
  return OrdnanceAvoidanceBlock(ship, projectiles, ships, time);
}

function primaryGun(ship: ShipState, mount: "spinal" | "missile"): TurretMountState | undefined {
  return ship.turrets.find((t) =>
    mount === "spinal" ? t.isSpinalGimbal : t.weapon.weaponType === "missile",
  );
}

function interceptBearing(ship: ShipState, target: ShipState, gun?: TurretMountState): number {
  let aim = vecSub(target.pos, ship.pos);
  if (gun) {
    const intercept = interceptTime(
      vecSub(target.pos, mountPosition(ship, gun)),
      target.velocity,
      gun.weapon.projectileSpeed,
    );
    if (intercept !== null)
      aim = vecSub(vecAdd(target.pos, vecScale(target.velocity, intercept)), ship.pos);
  }
  return Math.atan2(aim[1], aim[0]);
}

function updateBroadsideManeuver(
  ship: ShipState,
  target: ShipState,
  gun: TurretMountState | undefined,
  aimBearing: number,
  doctrine: CapitalFlightDoctrine,
): void {
  const returnTime =
    Math.abs(normalizeAngle(aimBearing - ship.heading)) / Math.max(ship.turnRate, 0.01);
  const delta = vecSub(target.pos, ship.pos);
  const distance = vecDistance(ship.pos, target.pos);
  const relative = vecSub(target.velocity, ship.velocity);
  const bearingRate =
    Math.abs(delta[0] * relative[1] - delta[1] * relative[0]) / Math.max(1, distance * distance);
  const slot = Number(ship.id.split("_").at(-1)) || 0;
  const initialSide = ship.broadsideSide ?? (slot % 2 === 0 ? 1 : -1);
  // Import legacy capital state once, then expose reducer output to existing callers.
  const previous =
    ship.broadsideCycle ??
    (ship.maneuverTargetId
      ? {
          phase: ship.capitalManeuver ?? "bow_acquire",
          targetId: ship.maneuverTargetId,
          side: initialSide,
          lastShot: ship.lastManeuverShot,
        }
      : undefined);
  const cycle = reduceBroadsideCycle(previous, {
    targetId: target.id,
    initialSide,
    lastShot: gun?.lastFiredTime,
    cooldown: gun?.cooldownTimer ?? 0,
    reacquireTime: returnTime + 0.25 + bearingRate * 2,
    alternateAfterShot: doctrine.broadside.alternateAfterShot,
  });
  ship.broadsideCycle = cycle;
  ship.capitalManeuver = cycle.phase;
  ship.maneuverTargetId = cycle.targetId;
  ship.broadsideSide = cycle.side;
  ship.lastManeuverShot = cycle.lastShot;
}

function standoffDistance(
  ship: ShipState,
  gun: TurretMountState | undefined,
  order: GroupOrder,
  doctrine: CapitalFlightDoctrine,
): number {
  const offensiveMounts = ship.turrets.filter((t) => t.weapon.weaponType !== "point_defense");
  const primaryRange =
    gun?.weapon.range ?? Math.max(0, ...offensiveMounts.map((t) => t.weapon.range));
  const secondaryRange =
    Math.max(0, ...offensiveMounts.filter((t) => t !== gun).map((t) => t.weapon.range)) ||
    primaryRange;
  const nominal =
    order.stance === "max_range"
      ? Math.min(primaryRange * 0.85, 1500)
      : order.stance === "brawl"
        ? doctrine.brawlDistance
        : Math.min(secondaryRange * 0.9, doctrine.optimalDistanceLimit);
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  return (
    nominal + (order.stance === "optimal_range" ? 60 * clamp((0.35 - shieldRatio) / 0.35, 0, 1) : 0)
  );
}

function fleetBearing(ship: ShipState, target: ShipState, ships: ShipState[]): number {
  const enemies = ships.filter((peer) => peer.isAlive && peer.team !== ship.team);
  const enemyCenter = enemies.length
    ? vecScale(
        enemies.reduce<Vector2>((sum, peer) => vecAdd(sum, peer.pos), [0, 0]),
        1 / enemies.length,
      )
    : target.pos;
  const delta = vecSub(enemyCenter, ship.pos);
  return Math.atan2(delta[1], delta[0]);
}

export function capitalIntent(
  ship: ShipState,
  target: ShipState,
  ships: ShipState[],
  order: GroupOrder,
  time = 0,
  projectiles: ProjectileState[] = [],
): FlightIntent {
  const flight = SHIP_DOCTRINES[ship.hullClass].flight;
  // Non-capital callers historically used the cruiser movement envelope.
  const doctrine =
    flight.kind === "capital" || flight.kind === "skirmish"
      ? flight
      : (SHIP_DOCTRINES.cruiser.flight as CapitalFlightDoctrine);
  const gun = primaryGun(ship, doctrine.primaryMount);
  const aimBearing = interceptBearing(ship, target, gun);
  if (doctrine.kind === "skirmish") {
    const tubes = ship.turrets.filter((t) => t.weapon.weaponType === "missile");
    const salvo = salvoReload(tubes, ship.skirmishCycle?.lastSalvoShot);
    const slot = Number(ship.id.split("_").at(-1)) || 0;
    const previousPhase = ship.skirmishCycle?.phase;
    ship.skirmishCycle = reduceSkirmishCycle(ship.skirmishCycle, {
      targetId: target.id,
      initialSide: slot % 2 === 0 ? 1 : -1,
      reload: salvo.reloadRatio * salvo.reloadDuration,
      salvoComplete: salvo.salvoComplete,
      lastShot: salvo.lastShot,
      breakoffReload: doctrine.breakoffReload,
      reacquireReload: doctrine.reacquireReload,
    });
    if (
      ship.skirmishCycle.phase === "breakoff" &&
      previousPhase !== "breakoff" &&
      arenaAnticipation(vecDistance([0, 0], ship.pos)) > 0
    ) {
      const bearing = Math.atan2(target.pos[1] - ship.pos[1], target.pos[0] - ship.pos[0]);
      const side = ship.skirmishCycle.side;
      const radial = (angle: number) => vecDot(ship.pos, [Math.cos(angle), Math.sin(angle)]);
      if (
        radial(bearing - side * doctrine.breakoffAngle) <
        radial(bearing + side * doctrine.breakoffAngle)
      )
        ship.skirmishCycle.side = -side;
    }
    let intent = HitAndRunSkirmishBlock(
      ship,
      target,
      doctrine.breakoffAngle,
      ship.maxSpeed * doctrine.breakoffSpeedRatio,
      { doctrine, engagementRange: gun?.weapon.range ?? doctrine.desiredDistance },
    );
    if (ship.skirmishCycle.phase === "breakoff" && intent.rangePhase !== "approach") {
      const corrected = arenaVelocity(ship, intent.velocity);
      if (vecDistance([0, 0], corrected) > 1e-6) {
        const heading = Math.atan2(corrected[1], corrected[0]);
        intent = {
          ...intent,
          heading,
          velocity: vecScale(
            [Math.cos(heading), Math.sin(heading)],
            vecDistance([0, 0], intent.velocity),
          ),
        };
      }
    }
    const velocity = vecAdd(intent.velocity, calculateSeparation(ship, ships));
    const evasiveVelocity = OrdnanceAvoidanceBlock(
      ship,
      projectiles,
      ships,
      time,
      "torpedo",
      velocity,
    );
    if (evasiveVelocity !== velocity) {
      const sep = calculateSeparation(ship, ships);
      const combined = vecAdd(evasiveVelocity, sep);
      return {
        ...intent,
        velocity: vecDistance([0, 0], sep) > 1e-4 ? limitVelocity(combined, ship.maxSpeed) : evasiveVelocity,
        evadingOrdnance: true,
      };
    }
    return {
      ...intent,
      velocity: limitVelocity(
        intent.rangePhase === "approach"
          ? clampLateralVelocity(
              { heading: intent.heading, maxSpeed: ship.maxSpeed },
              velocity,
              doctrine.lateralSpeedRatio,
              intent.rangePhase,
            )
          : velocity,
        ship.maxSpeed,
      ),
    };
  }
  updateBroadsideManeuver(ship, target, gun, aimBearing, doctrine);
  const side = ship.broadsideCycle?.side ?? 1;
  const radius = standoffDistance(ship, gun, order, doctrine);
  const threshold = doctrine.standoffThreshold;
  const standoffThreshold =
    "distance" in threshold ? threshold.distance : radius + threshold.margin;
  const rangePhase = classifyRange(vecDistance(ship.pos, target.pos), standoffThreshold);
  const closing = rangePhase === "approach";
  const boundary = clamp((vecDistance([0, 0], ship.pos) - (ARENA_RADIUS - 200)) / 200, 0, 1);
  const line =
    doctrine.formationWeave &&
    !closing &&
    ships.some((peer) => {
      const peerDoctrine = SHIP_DOCTRINES[peer.hullClass].flight;
      return (
        peer.isAlive &&
        peer.team === ship.team &&
        peer.id !== ship.id &&
        peerDoctrine.kind === "capital" &&
        peerDoctrine.formationWeave
      );
    });
  const slot = Number(ship.id.split("_").at(-1)) || 0;
  const phase = time * 0.35 + slot * 2.1;
  const lateralBias = closing
    ? 0
    : line
      ? ship.maxSpeed * 0.25 * Math.cos(phase)
      : boundary * ship.maxSpeed * 0.6 * side;
  const approach = StandoffApproachBlock(ship, target, radius, lateralBias, {
    ...doctrine.approach,
    standoffThreshold,
    aimBearing,
    reverseScale: doctrine.boundaryRetreatDamping ? 1 - boundary : 1,
    radialBias: line ? ship.maxSpeed * 0.2 * Math.sin(phase) : 0,
  });
  const weaving =
    !approach.closing &&
    (doctrine.broadside.continuous || ship.broadsideCycle?.phase === "broadside_hold");
  const intent = weaving
    ? BroadsideWeaveBlock(ship, target, doctrine.broadside.arcOffset, side, standoffThreshold, {
        bearing:
          doctrine.broadside.bearing === "fleet" ? fleetBearing(ship, target, ships) : aimBearing,
        radialSpeed: approach.radialSpeed,
        lateralBias,
      })
    : approach;
  let velocity = vecAdd(intent.velocity, calculateSeparation(ship, ships));
  if (rangePhase === "engage")
    velocity = clampLateralVelocity(ship, velocity, doctrine.lateralSpeedRatio);
  if (doctrine.avoidTorpedoes)
    velocity = OrdnanceAvoidanceBlock(ship, projectiles, ships, time, "torpedo", velocity);
  if (rangePhase === "approach")
    velocity = clampLateralVelocity(
      { heading: intent.heading, maxSpeed: ship.maxSpeed },
      velocity,
      doctrine.lateralSpeedRatio,
      rangePhase,
    );
  return { ...intent, velocity: limitVelocity(velocity, ship.maxSpeed) };
}

export function dogfightTarget(
  ship: ShipState,
  ships: ShipState[],
  time: number,
): ShipState | null {
  let best: ShipState | null = null;
  let bestScore = -Infinity;
  let current: ShipState | null = null;
  let currentScore = -Infinity;
  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.team === ship.team || enemy.hullClass !== "strike_craft") continue;
    const r = vecSub(enemy.pos, ship.pos);
    const v = vecSub(enemy.velocity, ship.velocity);
    const distance = vecDistance([0, 0], r);
    const t = clamp(-vecDot(r, v) / Math.max(1e-6, vecDot(v, v)), 0, 1.5);
    const approach = vecDistance([0, 0], vecAdd(r, vecScale(v, t)));
    const threat = distance <= 600 || (t > 0 && approach < 120);
    const retained =
      enemy.id === ship.dogfightTargetId &&
      distance <= 720 &&
      time - (ship.lastThreatTime ?? 0) < 1;
    if (!threat && !retained) continue;
    const angle = Math.abs(normalizeAngle(Math.atan2(r[1], r[0]) - ship.heading));
    const assignments = ships.filter(
      (s) =>
        s.isAlive &&
        s.id !== ship.id &&
        s.team === ship.team &&
        s.groupId === ship.groupId &&
        s.dogfightTargetId === enemy.id,
    ).length;
    const score =
      3 * clamp(1 - approach / 600, 0, 1) +
      2 * clamp(1 - angle / (Math.PI / 4), 0, 1) +
      damagedTargetPriority(enemy) +
      squadFocusPriority(assignments) -
      distance / 600;
    if (enemy.id === ship.dogfightTargetId) {
      current = enemy;
      currentScore = score;
      if (threat) ship.lastThreatTime = time;
    }
    if (score > bestScore) {
      best = enemy;
      bestScore = score;
    }
  }
  if (current && bestScore <= currentScore + 0.2 * Math.max(1, Math.abs(currentScore)))
    return current;
  if (best) ship.lastThreatTime = time;
  ship.dogfightTargetId = best?.id;
  return best;
}

export function safeRally(
  target: ShipState,
  heading: number,
  members: ShipState[],
  enemies: ShipState[],
  standoff: number,
): Vector2 {
  const backwards = rotatePoint([-1, 0], heading);
  const footprint = Math.max(...members.map((s) => Math.abs(s.wingSlot ?? 0) * 60 + s.size), 0);
  let distance = standoff;
  for (const enemy of enemies) {
    if (!enemy.isAlive || enemy.team === members[0]?.team) continue;
    for (const mount of enemy.turrets) {
      if (mount.weapon.weaponType !== "point_defense") continue;
      const offset = vecSub(mountPosition(enemy, mount), target.pos);
      const along = vecDot(offset, backwards);
      const crossSq = Math.max(0, vecDot(offset, offset) - along * along);
      const radius = mount.weapon.range + 80 + footprint;
      if (crossSq < radius * radius)
        distance = Math.max(distance, along + Math.sqrt(radius * radius - crossSq));
    }
  }
  return vecAdd(target.pos, vecScale(backwards, distance));
}
