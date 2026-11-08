import type {
  GroupOrder,
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
} from "../types/combat";
import { ARENA_RADIUS, arenaAnticipation, arenaVelocity } from "./arenaBoundary";
import {
  closeToKillTarget,
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
import { antiKitePursuitLimit, distanceSquared, navigationContext } from "./navigationContext";
import { escortCapitalStandoff, isCapitalShip } from "./shieldGeometry";
import { type CapitalFlightDoctrine, SHIP_DOCTRINES } from "./shipDoctrines";

export {
  ARENA_HARD_PULL_RADIUS,
  ARENA_RADIUS,
  arenaVelocity,
  configureArena,
} from "./arenaBoundary";
// Keep simulation callers on the existing API while sharing the underlying behavior blocks.
export { calculateSeparation, calculateSeparation as separation, limitVelocity };

// Individual envelopes leave a slit open only above diameter + 15 units.
export function debrisAvoidanceVelocity(
  ship: ShipState,
  desired: Vector2,
  ships: ShipState[],
): Vector2 {
  const horizon = 2.5;
  const wrecks = ships.filter((peer) => peer.isAlive && peer.isDebris);
  const heavy = ["cruiser", "battleship", "carrier", "dreadnought"].includes(ship.hullClass);
  const groups: ShipState[][] = [];
  const pending = new Set(wrecks);
  for (const wreck of wrecks) {
    if (!pending.delete(wreck)) continue;
    const group = [wreck];
    if (heavy) {
      for (let i = 0; i < group.length; i++) {
        for (const peer of pending) {
          const member = group[i];
          const now = vecDistance(member.pos, peer.pos);
          const projected = vecDistance(
            vecAdd(member.pos, vecScale(member.velocity, horizon)),
            vecAdd(peer.pos, vecScale(peer.velocity, horizon)),
          );
          if (Math.min(now, projected) > member.size + peer.size + ship.size * 2 + 15) continue;
          pending.delete(peer);
          group.push(peer);
        }
      }
    }
    groups.push(group);
  }
  let result = desired;
  let strongest = 0;
  for (const group of groups) {
    const center = vecScale(
      group.reduce((sum, wreck) => vecAdd(sum, wreck.pos), [0, 0]),
      1 / group.length,
    );
    const velocity = vecScale(
      group.reduce((sum, wreck) => vecAdd(sum, wreck.velocity), [0, 0]),
      1 / group.length,
    );
    // Enclose both present and projected extents, including differential wreck drift.
    const radius =
      Math.max(
        ...group.map(
          (wreck) =>
            wreck.size +
            Math.max(
              vecDistance(wreck.pos, center),
              vecDistance(
                vecAdd(wreck.pos, vecScale(wreck.velocity, horizon)),
                vecAdd(center, vecScale(velocity, horizon)),
              ),
            ),
        ),
      ) +
      ship.size +
      7.5;
    const displacement = vecSub(center, ship.pos);
    const distance = Math.hypot(...displacement);
    if (distance < 1e-6) continue;
    const toward = vecScale(displacement, 1 / distance);
    // Check actual momentum as well as intended thrust, so stationary ships evade incoming wrecks.
    for (const motion of [ship.velocity, desired]) {
      const relative = vecSub(velocity, motion);
      const speedSquared = vecDot(relative, relative);
      const time =
        speedSquared > 1e-6 ? clamp(-vecDot(displacement, relative) / speedSquared, 0, horizon) : 0;
      const closest = vecAdd(displacement, vecScale(relative, time));
      const miss = Math.hypot(...closest);
      if (miss >= radius || (time === 0 && distance > radius)) continue;
      const urgency = (1 - miss / radius) * (1 - time / (horizon * 2));
      if (urgency <= strongest) continue;
      strongest = urgency;
      const tangent: Vector2 = [-toward[1], toward[0]];
      const sideOffset = vecDot(closest, tangent);
      const side = Math.abs(sideOffset) > 1e-6 ? -Math.sign(sideOffset) : 1;
      const lateral = Math.min(ship.maxSpeed, (radius - miss + 15) / Math.max(0.5, time));
      const closing = vecDot(vecSub(desired, velocity), toward);
      const safeClosing = Math.max(0, (distance - radius) / horizon);
      result = vecAdd(
        vecSub(desired, vecScale(toward, Math.max(0, closing - safeClosing))),
        vecScale(tangent, side * lateral),
      );
    }
  }
  return strongest > 0 ? limitVelocity(result, ship.maxSpeed) : desired;
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

export function tenderRescueTarget(ship: ShipState, ships: ShipState[]): ShipState | undefined {
  let best: ShipState | undefined;
  let bestScore = -Infinity;
  for (const peer of ships) {
    if (
      !peer.isAlive ||
      peer.isDocked ||
      peer.isDebris ||
      peer.team !== ship.team ||
      peer.id === ship.id ||
      peer.hullClass === "tender" ||
      !(
        peer.shieldCurrent <= 0 ||
        peer.hullCurrent < peer.hullMax ||
        (peer.shieldDelayTimer > 0 && peer.shieldCurrent < peer.shieldMax * 0.4)
      )
    )
      continue;
    const risk = rescueRouteRisk(ship, peer, ships);
    // Dense capital crossfire is a route veto, never a distance veto.
    if (risk >= 1.5) continue;
    const importance =
      peer.hullClass === "dreadnought"
        ? 6
        : peer.hullClass === "battleship"
          ? 5
          : peer.hullClass === "carrier"
            ? 4
            : peer.hullClass === "cruiser"
              ? 3
              : peer.hullClass === "missile_frigate"
                ? 2
                : 1;
    const criticality =
      2 * Number(peer.shieldCurrent <= 0) +
      3 * clamp(1 - peer.hullCurrent / Math.max(1, peer.hullMax), 0, 1);
    const score =
      (importance + criticality) / (1 + vecDistance(ship.pos, peer.pos) / 1200) - risk * 6;
    if (score > bestScore || (score === bestScore && best && peer.id < best.id)) {
      best = peer;
      bestScore = score;
    }
  }
  return best;
}

/** Allocation-free exposure along the rendezvous segment. */
export function rescueRouteRisk(ship: ShipState, target: ShipState, ships: ShipState[]): number {
  const dx = target.pos[0] - ship.pos[0];
  const dy = target.pos[1] - ship.pos[1];
  const lengthSquared = dx * dx + dy * dy;
  let risk = 0;
  for (const enemy of ships) {
    if (
      !enemy.isAlive ||
      enemy.isDocked ||
      enemy.isDebris ||
      enemy.team === ship.team ||
      !isCapitalShip(enemy)
    )
      continue;
    let range = 0;
    for (const turret of enemy.turrets) {
      if (turret.weapon.weaponType !== "point_defense")
        range = Math.max(range, turret.weapon.range);
    }
    if (range <= 0) continue;
    const t = clamp(
      ((enemy.pos[0] - ship.pos[0]) * dx + (enemy.pos[1] - ship.pos[1]) * dy) /
        Math.max(1, lengthSquared),
      0,
      1,
    );
    const distance = Math.hypot(
      enemy.pos[0] - ship.pos[0] - dx * t,
      enemy.pos[1] - ship.pos[1] - dy * t,
    );
    risk += clamp(1 - distance / range, 0, 1);
  }
  return risk;
}

export function supportVelocity(
  ship: ShipState,
  ships: ShipState[],
  rescueTarget = tenderRescueTarget(ship, ships),
): Vector2 {
  const doctrine = SHIP_DOCTRINES[ship.hullClass].flight;
  if (doctrine.kind !== "support") return [0, 0];
  const allies = ships.filter(
    (peer) =>
      peer.isAlive &&
      !peer.isDocked &&
      peer.team === ship.team &&
      peer.id !== ship.id &&
      peer.hullClass !== "tender" &&
      rescueRouteRisk(ship, peer, ships) < 1.5 &&
      (peer.hullClass !== "strike_craft" || peer.shieldCurrent < peer.shieldMax),
  );
  const anchor =
    rescueTarget ??
    allies.sort(
      (a, b) =>
        Number(b.shieldCurrent < b.shieldMax) - Number(a.shieldCurrent < a.shieldMax) ||
        vecDistance(ship.pos, a.pos) - vecDistance(ship.pos, b.pos) ||
        a.id.localeCompare(b.id),
    )[0];
  const enemies = ships
    .filter((peer) => peer.isAlive && peer.team !== ship.team)
    .sort(
      (a, b) =>
        vecDistance(ship.pos, a.pos) - vecDistance(ship.pos, b.pos) || a.id.localeCompare(b.id),
    );
  const threat = enemies[0];
  const isolated = !anchor;
  const damaged = ship.hullCurrent / ship.hullMax < (doctrine.retreat.hullRatio ?? 0);
  if ((isolated || damaged) && threat) {
    const away = vecNormalize(vecSub(ship.pos, threat.pos));
    const retreat = vecScale(away, ship.maxSpeed);
    return anchor
      ? vecAdd(
          vecScale(retreat, 0.75),
          vecScale(vecNormalize(vecSub(anchor.pos, ship.pos)), ship.maxSpeed * 0.25),
        )
      : retreat;
  }
  if (!anchor) return [0, 0];
  const forward = threat
    ? vecNormalize(vecSub(threat.pos, anchor.pos))
    : ([Math.cos(anchor.heading), Math.sin(anchor.heading)] as Vector2);
  const station = vecSub(anchor.pos, vecScale(forward, doctrine.desiredDistance));
  return formationVelocity(ship, anchor, station);
}

export function escortVelocity(
  ship: ShipState,
  target: ShipState | null,
  ships: ShipState[],
): Vector2 {
  if (
    ship.hullClass === "corvette" &&
    ship.shieldCurrent / Math.max(1, ship.shieldMax) >= 0.4 &&
    ship.turrets.some(
      (turret) => turret.weapon.weaponType === "point_defense" && turret.weapon.flak,
    )
  ) {
    let capital: ShipState | undefined;
    let threat: ShipState | undefined;
    let bestDistance = Infinity;
    let threatDistance = Infinity;
    for (const ally of ships) {
      if (
        !ally.isAlive ||
        ally.isDocked ||
        ally.isDebris ||
        ally.team !== ship.team ||
        !["carrier", "battleship", "dreadnought"].includes(ally.hullClass)
      )
        continue;
      const distance = vecDistance(ship.pos, ally.pos);
      if (distance > 1200 || distance > bestDistance) continue;
      for (const enemy of ships) {
        if (
          !enemy.isAlive ||
          enemy.isDocked ||
          enemy.isDebris ||
          enemy.team === ship.team ||
          enemy.hullClass !== "strike_craft"
        )
          continue;
        const proximity = vecDistance(ally.pos, enemy.pos);
        if (proximity > 900) continue;
        if (
          distance < bestDistance ||
          (distance === bestDistance &&
            (proximity < threatDistance ||
              (proximity === threatDistance && enemy.id < (threat?.id ?? "\uffff"))))
        ) {
          capital = ally;
          threat = enemy;
          bestDistance = distance;
          threatDistance = proximity;
        }
      }
    }
    if (capital && threat) {
      // Lead the incoming vector in the capital's frame, while keeping the screen tethered.
      const predicted = vecAdd(
        vecSub(threat.pos, capital.pos),
        vecScale(vecSub(threat.velocity, capital.velocity), 2),
      );
      const bearing =
        vecDistance([0, 0], predicted) > 1e-6
          ? vecNormalize(predicted)
          : vecNormalize(vecSub(threat.pos, capital.pos));
      const direction =
        vecDistance([0, 0], bearing) > 1e-6
          ? bearing
          : ([Math.cos(capital.heading), Math.sin(capital.heading)] as Vector2);
      const radius = clamp(escortCapitalStandoff(ship, capital), 300, 400);
      const station = vecAdd(capital.pos, vecScale(direction, radius));
      return limitVelocity(formationVelocity(ship, capital, station), ship.maxSpeed);
    }
  }
  if (target && !withinPursuitTheater(ship, target, ships)) target = null;
  let anchor = ships.find((s) => s.isAlive && s.team === ship.team && s.id === ship.flagshipId);
  if (!anchor) {
    const capitals = ships.filter(
      (s) =>
        s.isAlive &&
        s.team === ship.team &&
        (s.hullClass === "carrier" ||
          s.hullClass === "battleship" ||
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
  const engagementDistance =
    target?.hullClass === "corvette"
      ? Math.max(300, ...ship.turrets.map((t) => t.weapon.range * 0.8))
      : target?.hullClass === "cruiser"
        ? 230
        : 300;
  if (!anchor) return target ? orbitVelocity(ship, target, engagementDistance) : [0, 0];
  const index = Number(ship.id.split("_").at(-1)) || 0;
  const side = index % 2 === 0 ? 1 : -1;
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  const sortie = clamp((shieldRatio - 0.4) / 0.3, 0, 1);
  const tether = 380 + sortie * 220;
  const closeOffset: Vector2 = [
    Math.max(45, 120 - Math.floor(index / 2) * 45),
    side * (150 + Math.floor(index / 2) * 45),
  ];
  // Healthy pickets occupy a forward/lateral screen even when capitals fight at long range.
  const screenOffset = vecScale(
    vecNormalize([1, side * (0.5 + Math.floor(index / 2) * 0.15)]),
    550,
  );
  // Keep every recovery/screen station forward-lateral, outside both hulls and rear exhaust.
  const offset = vecAdd(vecScale(closeOffset, 1 - sortie), vecScale(screenOffset, sortie));
  const stationOffset = vecScale(
    vecNormalize(offset),
    Math.max(vecDistance([0, 0], offset), escortCapitalStandoff(ship, anchor)),
  );
  const station = vecAdd(anchor.pos, rotatePoint(stationOffset, anchor.heading));
  const doctrine = SHIP_DOCTRINES[ship.hullClass].flight;
  if (doctrine.kind === "escort") {
    const retreat = LowHealthRetreatBlock(ship, anchor, station, doctrine.retreat);
    if (retreat) return retreat;
  }
  const stationVelocity = formationVelocity(ship, anchor, station);
  const pack = corvetteWolfpack(ship, ships);
  if (target && pack.length >= 2 && vecDistance(ship.pos, anchor.pos) <= 900) {
    const radius = isCapitalShip(target)
      ? Math.max(300, escortCapitalStandoff(ship, target))
      : engagementDistance;
    const leader = pack[0];
    const cohesion =
      ship === leader ? ([0, 0] as Vector2) : vecScale(vecSub(leader.pos, ship.pos), 0.25);
    return limitVelocity(vecAdd(orbitVelocity(ship, target, radius), cohesion), ship.maxSpeed);
  }
  if (
    !target ||
    vecDistance(target.pos, anchor.pos) > 600 + sortie * 600 ||
    vecDistance(target.pos, ship.pos) > 600 ||
    vecDistance(ship.pos, anchor.pos) > tether
  )
    return stationVelocity;
  if (vecDistance(ship.pos, target.pos) < engagementDistance)
    return orbitVelocity(ship, target, engagementDistance);
  return vecAdd(
    vecScale(stationVelocity, 0.65),
    vecScale(orbitVelocity(ship, target, engagementDistance), 0.35),
  );
}

export function fleetDefenseAnchor(ship: ShipState, ships: ShipState[]): ShipState | undefined {
  const context = navigationContext(ships);
  if (context) return context.anchors.get(ship);
  return ships
    .filter(
      (peer) =>
        peer.isAlive &&
        !peer.isDocked &&
        !peer.isDebris &&
        peer.team === ship.team &&
        peer.id !== ship.id &&
        isCapitalShip(peer),
    )
    .sort(
      (a, b) =>
        Number(b.id === ship.flagshipId) - Number(a.id === ship.flagshipId) ||
        vecDistance(ship.pos, a.pos) - vecDistance(ship.pos, b.pos) ||
        a.id.localeCompare(b.id),
    )[0];
}

export function withinPursuitTheater(
  ship: ShipState,
  target: ShipState,
  ships: ShipState[],
  hasNonFighterEnemy?: boolean,
): boolean {
  const light = target.hullClass === "strike_craft";
  if (!light) return true;
  if (ship.hullClass === "strike_craft") {
    const distance = vecDistance(ship.pos, target.pos);
    const pursued = fighterPursuits.get(ship) ?? new Set<string>();
    if (distance <= 600) {
      pursued.add(target.id);
      fighterPursuits.set(ship, pursued);
      return true;
    }
    return !ship.dogfightTargetId && !pursued.has(target.id);
  }
  if (ship.hullClass !== "corvette") {
    // Only an all-fighter enemy remnant warrants leaving the tactical battle area.
    const otherHulls =
      hasNonFighterEnemy ??
      ships.some(
        (enemy) =>
          enemy.isAlive &&
          !enemy.isDocked &&
          !enemy.isDebris &&
          enemy.team !== ship.team &&
          enemy.hullClass !== "strike_craft",
      );
    return !otherHulls || distanceSquared(ship, target) <= antiKitePursuitLimit(ship) ** 2;
  }
  const anchor = fleetDefenseAnchor(ship, ships);
  return (
    vecDistance(ship.pos, target.pos) <= 600 &&
    (!anchor || vecDistance(anchor.pos, target.pos) <= antiKitePursuitLimit(anchor))
  );
}

const fighterPursuits = new WeakMap<ShipState, Set<string>>();

export function corvetteWolfpack(ship: ShipState, ships: ShipState[]): ShipState[] {
  if (ship.hullClass !== "corvette") return [];
  const context = navigationContext(ships);
  const cached = context?.packs.get(ship);
  if (cached) return cached;
  const anchor = fleetDefenseAnchor(ship, ships);
  const escorts = ships
    .filter(
      (peer) =>
        peer.isAlive &&
        !peer.isDocked &&
        !peer.isDebris &&
        peer.team === ship.team &&
        peer.hullClass === "corvette" &&
        (!anchor ||
          (fleetDefenseAnchor(peer, ships)?.id === anchor.id &&
            vecDistance(peer.pos, anchor.pos) <= 900)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  // Reserve one local picket per capital; split remaining pilots into balanced pairs/triples.
  const hunters = anchor ? escorts.slice(1) : escorts;
  const index = hunters.indexOf(ship);
  if (index < 0 || hunters.length < 2) return [];
  const groups = Math.ceil(hunters.length / 3);
  let offset = 0;
  for (let group = 0; group < groups; group++) {
    const size = Math.ceil((hunters.length - offset) / (groups - group));
    if (index < offset + size) {
      const pack = hunters.slice(offset, offset + size);
      if (context) for (const peer of pack) context.packs.set(peer, pack);
      return pack;
    }
    offset += size;
  }
  return [];
}

export function fleetReturnVelocity(ship: ShipState, ships: ShipState[]): Vector2 {
  const anchor = fleetDefenseAnchor(ship, ships);
  if (!anchor) return vecScale(vecNormalize(vecScale(ship.pos, -1)), ship.maxSpeed * 0.5);
  const station = vecAdd(
    anchor.pos,
    rotatePoint([-250, ship.id < anchor.id ? -300 : 300], anchor.heading),
  );
  return limitVelocity(formationVelocity(ship, anchor, station), ship.maxSpeed);
}

function damageStandoffWeight(ship: ShipState): number {
  const shield = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  const hull = ship.hullCurrent / Math.max(1, ship.hullMax);
  return shield <= 0 || hull < 0.4 ? 1 : 0;
}

// Predict shared corridors before hull separation must brake a head-on encounter.
function skirmishSpacing(ship: ShipState, ships: ShipState[]): Vector2 {
  let spacing: Vector2 = [0, 0];
  for (const peer of ships) {
    if (!peer.isAlive || peer.id === ship.id || peer.hullClass === "strike_craft") continue;
    const delta = vecSub(peer.pos, ship.pos);
    const distance = vecDistance([0, 0], delta);
    if (distance < 1e-6 || distance > 600) continue;
    const direction = vecScale(delta, 1 / distance);
    const relative = vecSub(peer.velocity, ship.velocity);
    const arrival = clamp(-vecDot(delta, relative) / Math.max(1, vecDot(relative, relative)), 0, 3);
    const clearance = ship.size + peer.size + 100;
    const miss = vecDistance([0, 0], vecAdd(delta, vecScale(relative, arrival)));
    if (peer.team === ship.team) {
      if (distance < clearance * 2)
        spacing = vecSub(
          spacing,
          vecScale(direction, ship.maxSpeed * 0.4 * (1 - distance / (clearance * 2))),
        );
    } else if (arrival > 0 && miss < clearance) {
      // Reciprocal bearings produce opposite world-space offsets: both pass to their right.
      spacing = vecAdd(
        spacing,
        vecScale([-direction[1], direction[0]], ship.maxSpeed * 0.5 * (1 - miss / clearance)),
      );
    }
  }
  return spacing;
}

function defensiveStandoff(
  ship: ShipState,
  ships: ShipState[],
  velocity: Vector2,
  radius: number,
  finishingTarget?: ShipState,
): Vector2 {
  const damaged = damageStandoffWeight(ship) > 0;
  let correctedX = velocity[0];
  let correctedY = velocity[1];
  let changed = false;
  for (const enemy of ships) {
    // Fighter runs already manage their own clearance; capitals must not chase their
    // rapidly changing bearings with full-speed defensive translation.
    if (
      !enemy.isAlive ||
      enemy === finishingTarget ||
      enemy.team === ship.team ||
      enemy.hullClass === "strike_craft" ||
      (!damaged && !isCapitalShip(enemy))
    )
      continue;
    const dx = ship.pos[0] - enemy.pos[0];
    const dy = ship.pos[1] - enemy.pos[1];
    // Prediction uses actual momentum, not the progressively projected desired velocity.
    const dvx = ship.velocity[0] - enemy.velocity[0];
    const dvy = ship.velocity[1] - enemy.velocity[1];
    const longRange = ship.hullClass === "battleship" && enemy.hullClass === "dreadnought";
    const minimum = damaged || longRange ? radius : 500;
    const relativeSpeedBound = Math.abs(dvx) + Math.abs(dvy);
    const bound =
      minimum + (relativeSpeedBound * relativeSpeedBound) / 220 + 0.5 * relativeSpeedBound + 1e-6;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= bound * bound) continue;
    const distance = Math.sqrt(distanceSquared);
    if (distance < 1e-6) continue;
    const inverseDistance = 1 / distance;
    const towardX = (enemy.pos[0] - ship.pos[0]) * inverseDistance;
    const towardY = (enemy.pos[1] - ship.pos[1]) * inverseDistance;
    const closing = Math.max(0, dvx * towardX + dvy * towardY);
    const predictedDistance = distance - closing * (closing / 220 + 0.5);
    if (predictedDistance >= minimum) continue;
    const retreat = clamp((minimum - predictedDistance) * 0.7, 0, ship.maxSpeed * 0.65);
    const inward = correctedX * towardX + correctedY * towardY;
    if (inward > -retreat) {
      correctedX -= towardX * (inward + retreat);
      correctedY -= towardY * (inward + retreat);
      changed = true;
    }
  }
  return changed ? [correctedX, correctedY] : velocity;
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

function interceptBearing(
  ship: ShipState,
  target: ShipState,
  gun: TurretMountState | undefined,
  dx: number,
  dy: number,
): number {
  let aimX = dx;
  let aimY = dy;
  if (gun) {
    const intercept = interceptTime(
      vecSub(target.pos, mountPosition(ship, gun)),
      target.velocity,
      gun.weapon.projectileSpeed,
    );
    if (intercept !== null) {
      aimX = target.pos[0] + target.velocity[0] * intercept - ship.pos[0];
      aimY = target.pos[1] + target.velocity[1] * intercept - ship.pos[1];
    }
  }
  return Math.atan2(aimY, aimX);
}

function updateBroadsideManeuver(
  ship: ShipState,
  target: ShipState,
  gun: TurretMountState | undefined,
  aimBearing: number,
  doctrine: CapitalFlightDoctrine,
  dx: number,
  dy: number,
  distance: number,
): void {
  const returnTime =
    Math.abs(normalizeAngle(aimBearing - ship.heading)) / Math.max(ship.turnRate, 0.01);
  const relativeX = target.velocity[0] - ship.velocity[0];
  const relativeY = target.velocity[1] - ship.velocity[1];
  const bearingRate = Math.abs(dx * relativeY - dy * relativeX) / Math.max(1, distance * distance);
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
  target: ShipState,
  gun: TurretMountState | undefined,
  order: GroupOrder,
  doctrine: CapitalFlightDoctrine,
): number {
  let offensiveRange = 0;
  let secondaryRange = 0;
  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType === "point_defense") continue;
    offensiveRange = Math.max(offensiveRange, turret.weapon.range);
    if (turret !== gun) secondaryRange = Math.max(secondaryRange, turret.weapon.range);
  }
  const primaryRange = gun?.weapon.range ?? (ship.hullClass === "carrier" ? 1140 : offensiveRange);
  secondaryRange ||= primaryRange;
  const nominal =
    order.stance === "max_range"
      ? Math.min(primaryRange * 0.85, 1500)
      : order.stance === "brawl"
        ? doctrine.brawlDistance
        : Math.min(secondaryRange * 0.9, doctrine.optimalDistanceLimit);
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  // Keep both weapon roles in range during defensive broadsides.
  return Math.max(
    nominal +
      (order.stance === "optimal_range" ? 60 * clamp((0.35 - shieldRatio) / 0.35, 0, 1) : 0),
    target.hullClass === "strike_craft" ? 0 : secondaryRange * 0.9 * damageStandoffWeight(ship),
  );
}

function fleetBearing(
  ship: ShipState,
  target: ShipState,
  sumX: number,
  sumY: number,
  count: number,
): number {
  const inverseCount = count ? 1 / count : 0;
  const centerX = count ? sumX * inverseCount : target.pos[0];
  const centerY = count ? sumY * inverseCount : target.pos[1];
  return Math.atan2(centerY - ship.pos[1], centerX - ship.pos[0]);
}

export function carrierStandoffVelocity(ship: ShipState, ships: ShipState[]): Vector2 {
  const enemies = ships.filter(
    (peer) => peer.isAlive && !peer.isDocked && !peer.isDebris && peer.team !== ship.team,
  );
  if (!enemies.length) return [0, 0];
  const capitals = ships.filter(
    (peer) =>
      peer.isAlive &&
      !peer.isDocked &&
      !peer.isDebris &&
      peer.team === ship.team &&
      ["battleship", "dreadnought", "cruiser"].includes(peer.hullClass),
  );
  const center = (peers: ShipState[]) =>
    vecScale(
      peers.reduce<Vector2>((sum, peer) => vecAdd(sum, peer.pos), [0, 0]),
      1 / peers.length,
    );
  const enemyCenter = center(enemies);
  const anchor = capitals.length ? center(capitals) : enemyCenter;
  const forward = vecNormalize(vecSub(enemyCenter, capitals.length ? anchor : ship.pos));
  const direction: Vector2 =
    vecDistance([0, 0], forward) > 1e-6
      ? forward
      : [Math.cos(ship.heading), Math.sin(ship.heading)];
  const station = vecSub(anchor, vecScale(direction, 1400));
  const drift = capitals.length
    ? vecScale(
        capitals.reduce<Vector2>((sum, peer) => vecAdd(sum, peer.velocity), [0, 0]),
        1 / capitals.length,
      )
    : ([0, 0] as Vector2);
  let velocity = vecAdd(drift, vecScale(vecSub(station, ship.pos), 0.6));
  for (const enemy of enemies) {
    if (!isCapitalShip(enemy)) continue;
    const distance = vecDistance(ship.pos, enemy.pos);
    if (distance >= 1500) continue;
    const toward =
      distance > 1e-6 ? vecScale(vecSub(enemy.pos, ship.pos), 1 / distance) : direction;
    const retreatSpeed = Math.min(ship.maxSpeed, Math.max(0, (1400 - distance) * 0.8));
    const closing = vecDot(vecSub(velocity, enemy.velocity), toward);
    if (closing > -retreatSpeed)
      velocity = vecSub(velocity, vecScale(toward, closing + retreatSpeed));
  }
  return limitVelocity(vecAdd(velocity, calculateSeparation(ship, ships)), ship.maxSpeed);
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
  let hasHostileDreadnought = false;
  let hasNonFighterEnemy = false;
  let formationWeaveCount = 0;
  let leader: ShipState | undefined;
  let enemySumX = 0;
  let enemySumY = 0;
  let enemyCount = 0;
  for (const peer of ships) {
    if (!peer.isAlive) continue;
    if (peer.team !== ship.team) {
      // Bearing includes docked/debris enemies; pursuit's presence predicate does not.
      enemySumX += peer.pos[0];
      enemySumY += peer.pos[1];
      enemyCount++;
      hasHostileDreadnought ||= peer.hullClass === "dreadnought";
      hasNonFighterEnemy ||= !peer.isDocked && !peer.isDebris && peer.hullClass !== "strike_craft";
      continue;
    }
    if (
      flight.kind === "skirmish" &&
      peer.hullClass === ship.hullClass &&
      (!leader || peer.id.localeCompare(leader.id) < 0)
    )
      leader = peer;
    const peerDoctrine = SHIP_DOCTRINES[peer.hullClass].flight;
    if (peer.id !== ship.id && peerDoctrine.kind === "capital" && peerDoctrine.formationWeave)
      formationWeaveCount++;
  }
  if (!withinPursuitTheater(ship, target, ships, hasNonFighterEnemy)) {
    ship.navigationTargetId = undefined;
    ship.maneuverTargetId = undefined;
    const velocity = fleetReturnVelocity(ship, ships);
    return { heading: Math.atan2(velocity[1], velocity[0]), velocity, rangePhase: "engage" };
  }
  const dx = target.pos[0] - ship.pos[0];
  const dy = target.pos[1] - ship.pos[1];
  if (ship.hullClass === "carrier") {
    return {
      heading: Math.atan2(dy, dx),
      velocity: carrierStandoffVelocity(ship, ships),
      rangePhase: "engage",
    };
  }
  // Non-capital callers historically used the cruiser movement envelope.
  const doctrine =
    flight.kind === "capital" || flight.kind === "skirmish"
      ? flight
      : (SHIP_DOCTRINES.cruiser.flight as CapitalFlightDoctrine);
  const gun = primaryGun(ship, doctrine.primaryMount);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const aimBearing = interceptBearing(ship, target, gun, dx, dy);
  if (closeToKillTarget(ship, target) && damageStandoffWeight(ship) === 0) {
    const clearance = ship.size + target.size + 120;
    const approach = StandoffApproachBlock(ship, target, clearance, 0, {
      ...doctrine.approach,
      standoffThreshold: clearance + 50,
      aimBearing,
      forwardSpeedRatio: 1,
      dx,
      dy,
      distance,
    });
    let velocity = vecAdd(approach.velocity, calculateSeparation(ship, ships));
    const evasive = OrdnanceAvoidanceBlock(ship, projectiles, ships, time, "torpedo", velocity);
    const evadingOrdnance = evasive !== velocity;
    velocity = evasive;
    return {
      ...approach,
      evadingOrdnance,
      velocity: limitVelocity(
        defensiveStandoff(ship, ships, velocity, clearance, target),
        ship.maxSpeed,
      ),
    };
  }
  if (doctrine.kind === "skirmish") {
    const tubes = ship.turrets.filter((t) => t.weapon.weaponType === "missile");
    const salvo = salvoReload(tubes, ship.skirmishCycle?.lastSalvoShot);
    const slot = Number(ship.id.split("_").at(-1)) || 0;
    const leaderSlot = leader ? Number(leader.id.split("_").at(-1)) || 0 : slot;
    const cooperativeSide = leaderSlot % 2 === 0 ? 1 : -1;
    const previousPhase = ship.skirmishCycle?.phase;
    ship.skirmishCycle = reduceSkirmishCycle(ship.skirmishCycle, {
      targetId: target.id,
      initialSide: cooperativeSide,
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
      const bearing = Math.atan2(dy, dx);
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
      {
        doctrine: {
          ...doctrine,
          desiredDistance: Math.max(
            doctrine.desiredDistance,
            (gun?.weapon.range ?? doctrine.desiredDistance) * 0.9 * damageStandoffWeight(ship),
          ),
        },
        engagementRange: gun?.weapon.range ?? doctrine.desiredDistance,
        ships,
      },
    );
    if (ship.skirmishCycle.phase === "breakoff" && intent.rangePhase !== "approach") {
      const corrected = arenaVelocity(ship, intent.velocity, ships);
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
    const sep = calculateSeparation(ship, ships);
    const velocity = defensiveStandoff(
      ship,
      ships,
      vecAdd(vecAdd(intent.velocity, skirmishSpacing(ship, ships)), sep),
      Math.max(doctrine.desiredDistance, (gun?.weapon.range ?? 0) * 0.9),
    );
    const evasiveVelocity = OrdnanceAvoidanceBlock(
      ship,
      projectiles,
      ships,
      time,
      "torpedo",
      velocity,
    );
    if (evasiveVelocity !== velocity) {
      const combined = vecAdd(evasiveVelocity, sep);
      return {
        ...intent,
        velocity: limitVelocity(
          defensiveStandoff(
            ship,
            ships,
            vecDistance([0, 0], sep) > 1e-4 ? combined : evasiveVelocity,
            Math.max(doctrine.desiredDistance, (gun?.weapon.range ?? 0) * 0.9),
          ),
          ship.maxSpeed,
        ),
        evadingOrdnance: true,
      };
    }
    return {
      ...intent,
      velocity: limitVelocity(
        defensiveStandoff(
          ship,
          ships,
          intent.rangePhase === "approach"
            ? clampLateralVelocity(
                { heading: intent.heading, maxSpeed: ship.maxSpeed },
                velocity,
                doctrine.lateralSpeedRatio,
                intent.rangePhase,
              )
            : velocity,
          Math.max(doctrine.desiredDistance, (gun?.weapon.range ?? 0) * 0.9),
        ),
        ship.maxSpeed,
      ),
    };
  }
  updateBroadsideManeuver(ship, target, gun, aimBearing, doctrine, dx, dy, distance);
  const side = ship.broadsideCycle?.side ?? 1;
  const radius = Math.max(
    standoffDistance(ship, target, gun, order, doctrine),
    ship.hullClass === "battleship" && hasHostileDreadnought ? (gun?.weapon.range ?? 0) * 0.85 : 0,
  );
  const threshold = doctrine.standoffThreshold;
  const standoffThreshold =
    "distance" in threshold ? threshold.distance : radius + threshold.margin;
  const rangePhase = classifyRange(distance, standoffThreshold);
  const closing = rangePhase === "approach";
  const boundary = clamp((vecDistance([0, 0], ship.pos) - (ARENA_RADIUS - 200)) / 200, 0, 1);
  const line = doctrine.formationWeave && !closing && formationWeaveCount > 0;
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
    dx,
    dy,
    distance,
  });
  const weaving =
    !approach.closing &&
    (doctrine.broadside.continuous || ship.broadsideCycle?.phase === "broadside_hold");
  const intent = weaving
    ? BroadsideWeaveBlock(ship, target, doctrine.broadside.arcOffset, side, standoffThreshold, {
        bearing:
          doctrine.broadside.bearing === "fleet"
            ? fleetBearing(ship, target, enemySumX, enemySumY, enemyCount)
            : aimBearing,
        radialSpeed: approach.radialSpeed,
        lateralBias,
        dx,
        dy,
        distance,
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
  return {
    ...intent,
    velocity: limitVelocity(defensiveStandoff(ship, ships, velocity, radius), ship.maxSpeed),
  };
}

export function dogfightTarget(
  ship: ShipState,
  ships: ShipState[],
  time: number,
): ShipState | null {
  const context = navigationContext(ships);
  const previousId = ship.dogfightTargetId;
  let best: ShipState | null = null;
  let bestScore = -Infinity;
  let current: ShipState | null = null;
  let currentScore = -Infinity;
  for (const enemy of context?.hulls.get("strike_craft") ?? ships) {
    if (
      !enemy.isAlive ||
      enemy.isDocked ||
      enemy.isDebris ||
      enemy.team === ship.team ||
      enemy.hullClass !== "strike_craft" ||
      distanceSquared(ship, enemy) > 600 * 600 ||
      !withinPursuitTheater(ship, enemy, ships)
    )
      continue;
    const r = vecSub(enemy.pos, ship.pos);
    const v = vecSub(enemy.velocity, ship.velocity);
    const distance = vecDistance([0, 0], r);
    const t = clamp(-vecDot(r, v) / Math.max(1e-6, vecDot(v, v)), 0, 1.5);
    const approach = vecDistance([0, 0], vecAdd(r, vecScale(v, t)));
    const threat = distance <= 600 || (t > 0 && approach < 120);
    const retained =
      enemy.id === ship.dogfightTargetId &&
      distance <= 600 &&
      time - (ship.lastThreatTime ?? 0) < 1;
    if (!threat && !retained) continue;
    const angle = Math.abs(normalizeAngle(Math.atan2(r[1], r[0]) - ship.heading));
    const assignments = context
      ? context.count(context.dogfightAssignments, ship, enemy.id, previousId)
      : ships.filter(
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
  if (context) {
    context.adjust(context.dogfightAssignments, ship, previousId, -1);
    context.adjust(context.dogfightAssignments, ship, ship.dogfightTargetId, 1);
  }
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
