import type { GroupOrder, ShipState, Vector2 } from "../types/combat";
import { moveCarrierLaunch } from "./carrierHangar";
import { type CrewVeterancy, crewDecisionPeriod } from "./crewVeterancy";
import type { FighterMissionSystem } from "./fighterMissionSystem";
import { friendlyShieldRecoveryDirection } from "./fighterRecovery";
import { capitalFinishPriority, damagedTargetPriority, squadFocusPriority } from "./fireControl";
import {
  clampLateralVelocity,
  emergencySkirmishBreakout,
  mapObstacleAvoidanceVelocity,
} from "./flightBehaviors";
import {
  ARENA_RADIUS,
  arenaVelocity,
  capitalIntent,
  corvetteWolfpack,
  debrisAvoidanceVelocity,
  escortVelocity,
  fleetDefenseAnchor,
  fleetReturnVelocity,
  limitVelocity,
  orbitVelocity,
  rescueRouteRisk,
  separation,
  spinalEscape,
  supportVelocity,
  tenderRescueTarget,
  withinPursuitTheater,
} from "./flightControl";
import type { RangePhase } from "./flightCycles";
import { HARMONIC_RANGE } from "./harmonicShieldSystem";
import {
  clamp,
  normalizeAngle,
  vecAdd,
  vecDistance,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";
import {
  type NavigationContext,
  navigationContext,
  navigationSpatialScale,
  tacticalDensity,
  tacticalSupportRadius,
} from "./navigationContext";
import { obstacleCourseCorrection } from "./obstacleNavigation";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import { SHIP_DOCTRINES } from "./shipDoctrines";
import { CORVETTE_FLAK_THREAT_RADIUS, flakThreatRadius, HULL_PROFILES } from "./shipProfiles";
import type { ClientCombatSimulation } from "./simulation";

// The denial band keeps three hull radii of clearance; threat awareness keeps six.
export const FLAK_DENIAL_RADIUS = CORVETTE_FLAK_THREAT_RADIUS - HULL_PROFILES.corvette.size * 3;
export const FLAK_THREAT_RANGE = CORVETTE_FLAK_THREAT_RADIUS;

export function hostileFlakThreats(ship: ShipState, ships: ShipState[]): ShipState[] {
  const threats: ShipState[] = [];
  const enemies = navigationContext(ships)?.teamEnemies.get(ship.team) ?? ships;
  for (const enemy of enemies) {
    if (
      enemy.hullClass !== "corvette" ||
      !enemy.isAlive ||
      enemy.isDocked ||
      enemy.isDebris ||
      enemy.team === ship.team
    )
      continue;
    const radius = flakThreatRadius(enemy);
    if (radius <= 0) continue;
    const dx = enemy.pos[0] - ship.pos[0];
    const dy = enemy.pos[1] - ship.pos[1];
    if (dx * dx + dy * dy <= radius * radius) threats.push(enemy);
  }
  return threats;
}

const fighterDecisions = new WeakMap<
  ShipState,
  {
    tick: number;
    nextAt: number;
    targetTick?: number;
    target?: ShipState | null;
    wingTargetId?: string | null;
  }
>();

const obstacleDecisions = new WeakMap<ShipState, { tick: number; correction: number }>();

/**
 * After the initial immediate decision, FNV-1a hashes each ship ID and Murmur3
 * mixing produces a stable phase offset. This deterministically spreads tactical
 * decisions across the 60 physics frames per second, avoiding synchronized CPU
 * spikes on frames 0 or 30 while preserving each pilot's decision cadence.
 */
export function fighterTacticalTick(
  ship: ShipState,
  time: number,
  ships: ShipState[],
  tier: CrewVeterancy = "pilot",
): number {
  let state = fighterDecisions.get(ship);
  if (!state) {
    state = { tick: 0, nextAt: time };
    fighterDecisions.set(ship, state);
  }
  if (time + 1e-9 >= state.nextAt) {
    let combat = ship.fighterPhase === "attack" || ship.fighterPhase === "intercept";
    if (!combat) {
      const enemies = navigationContext(ships)?.teamEnemies.get(ship.team) ?? ships;
      const thresholdSq = FLAK_THREAT_RANGE * FLAK_THREAT_RANGE;
      for (const enemy of enemies) {
        if (!enemy.isAlive || enemy.isDocked || enemy.isDebris || enemy.team === ship.team)
          continue;
        const dx = enemy.pos[0] - ship.pos[0];
        const dy = enemy.pos[1] - ship.pos[1];
        if (dx * dx + dy * dy <= thresholdSq) {
          combat = true;
          break;
        }
      }
    }
    const period = crewDecisionPeriod(tier, combat);
    let seed = 2166136261;
    for (const char of ship.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
    seed ^= seed >>> 16;
    const offset = (seed >>> 0) / 4294967296;
    state.tick++;
    state.nextAt = (Math.floor(time / period - offset + 1e-9) + 1 + offset) * period;
  }
  return state.tick;
}

/** Pair-relative clearance remains stable when either hull or haven umbrella changes. */
function shieldClearanceScale(a: ShipState, b: ShipState): number {
  const stockRadius = (ship: ShipState) =>
    shieldEnvelopeRadius({ hullClass: ship.hullClass, size: HULL_PROFILES[ship.hullClass].size });
  return (shieldEnvelopeRadius(a) + shieldEnvelopeRadius(b)) / (stockRadius(a) + stockRadius(b));
}

/** Aim beyond the tangent contact, preserving momentum past the shield flank. */
export function fighterShieldWaypoint(
  ship: ShipState,
  capital: ShipState,
  side: number,
  attack = false,
): Vector2 {
  const clearance = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(ship);
  // The haven is already in clearance; maneuvering margins scale with the craft itself.
  const scale = ship.size / HULL_PROFILES[ship.hullClass].size;
  const radius = clearance + (attack ? 20 : 95) * scale;
  const offset = vecSub(ship.pos, capital.pos);
  const distance = vecDistance([0, 0], offset);
  const outward =
    distance > 1e-6
      ? vecScale(offset, 1 / distance)
      : ([-Math.cos(ship.heading), -Math.sin(ship.heading)] as Vector2);
  const normal: Vector2 = [-outward[1] * side, outward[0] * side];
  if (distance <= radius)
    return vecAdd(
      capital.pos,
      vecAdd(vecScale(outward, radius + 60 * scale), vecScale(normal, 300 * scale)),
    );
  const contact = vecAdd(
    capital.pos,
    vecAdd(
      vecScale(outward, (radius * radius) / distance),
      vecScale(normal, radius * Math.sqrt(1 - (radius / distance) ** 2)),
    ),
  );
  return vecAdd(
    contact,
    vecScale(vecNormalize(vecSub(contact, ship.pos)), Math.max(240 * scale, radius * 1.15)),
  );
}

export function findNavigationTarget(
  ship: ShipState,
  order: GroupOrder,
  aliveShips: ShipState[],
  previousTargetId?: string,
  wingTargetId?: string | null,
): ShipState | null {
  const decision = ship.hullClass === "strike_craft" ? fighterDecisions.get(ship) : undefined;
  if (
    decision &&
    decision.targetTick === decision.tick &&
    decision.wingTargetId === wingTargetId &&
    decision.target &&
    aliveShips.includes(decision.target) &&
    decision.target.isAlive &&
    !decision.target.isDocked &&
    !decision.target.isDebris &&
    withinPursuitTheater(ship, decision.target, aliveShips)
  )
    return decision.target;
  const target = selectNavigationTarget(ship, order, aliveShips, previousTargetId, wingTargetId);
  if (decision) {
    decision.target = target;
    decision.targetTick = decision.tick;
    decision.wingTargetId = wingTargetId;
  }
  return target;
}

function selectNavigationTarget(
  ship: ShipState,
  order: GroupOrder,
  aliveShips: ShipState[],
  previousTargetId?: string,
  wingTargetId?: string | null,
): ShipState | null {
  const fighter = ship.hullClass === "strike_craft";
  const context = navigationContext(aliveShips);
  const enemies = context?.teamEnemies.get(ship.team) ?? aliveShips;
  // Only corvette pursuit needs allied defense anchors; other hulls only inspect enemies.
  const pursuitShips = ship.hullClass === "corvette" ? aliveShips : enemies;
  const combatCapital =
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "battleship" ||
    ship.hullClass === "cruiser";
  const spatialScale = navigationSpatialScale(ship);
  let range = 360 * spatialScale;
  let mainGun: ShipState["turrets"][number] | undefined;
  for (const turret of ship.turrets) {
    range = Math.max(range, turret.weapon.range);
    if (!mainGun && (turret.isSpinalGimbal || turret.weapon.weaponType === "missile"))
      mainGun = turret;
  }
  const rangeSquared = range * range;
  let hasNonFighterEnemy = false;
  if (!fighter && ship.hullClass !== "corvette") {
    for (const enemy of enemies) {
      if (
        enemy.team !== ship.team &&
        enemy.isAlive &&
        !enemy.isDocked &&
        !enemy.isDebris &&
        enemy.hullClass !== "strike_craft"
      ) {
        hasNonFighterEnemy = true;
        break;
      }
    }
  }
  // Global preferences must be known before scoring; this metadata pass retains no candidates.
  let hasSafeTarget = false;
  let hasCapital = false;
  let hasCraft = false;
  let hasCloseCapitalThreat = false;
  for (const enemy of enemies) {
    if (!navigationCandidate(ship, enemy, pursuitShips, hasNonFighterEnemy)) continue;
    const safe = !fighter || safeNavigationTarget(enemy, aliveShips, context);
    if (safe && !hasSafeTarget) {
      hasSafeTarget = true;
      hasCapital = false;
      hasCraft = false;
      hasCloseCapitalThreat = false;
    }
    if (hasSafeTarget && !safe) continue;
    hasCapital ||= isCapitalShip(enemy);
    hasCraft ||= enemy.hullClass === "strike_craft" || enemy.hullClass === "corvette";
    hasCloseCapitalThreat ||=
      combatCapital &&
      closeNavigationThreat(enemy, rangeSquared, navigationDistanceSquared(ship, enemy));
  }
  const previousId = previousTargetId ?? ship.maneuverTargetId;
  const capitalPriority =
    ship.hullClass === "carrier" ||
    ship.hullClass === "battleship" ||
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "missile_frigate" ||
    ship.hullClass === "cruiser" ||
    order.priority === "capitals";
  const preferCapital =
    hasCapital && (capitalPriority || (fighter && order.priority !== "strike_craft"));
  const preferCraft = !capitalPriority && order.priority === "strike_craft" && hasCraft;
  const pack = ship.hullClass === "corvette" ? corvetteWolfpack(ship, aliveShips) : undefined;
  const coordinated =
    ship.hullClass === "corvette" ||
    ship.hullClass === "missile_frigate" ||
    ship.hullClass === "cruiser";
  const hunter = pack?.[0] ?? ship;
  const localEngagementRadius = Math.min(1000 * spatialScale, Math.max(600 * spatialScale, range));
  const packEngagementRadius = tacticalSupportRadius(hunter) * 1.5;
  const localEngagementRadiusSquared = localEngagementRadius ** 2;
  const packEngagementRadiusSquared = packEngagementRadius ** 2;
  let localBest: ShipState | null = null;
  let localRank = Infinity;
  let localDistanceSquared = Infinity;
  let wingTarget: ShipState | null = null;
  let firedTarget: ShipState | null = null;
  let best: ShipState | null = null;
  let bestScore = -Infinity;
  let previous: ShipState | null = null;
  let previousScore = -Infinity;
  let previousDistanceSquared = Infinity;
  const anchor =
    order.priority === "screen_and_defend"
      ? (aliveShips.find((s) => s.id === ship.flagshipId && s.isAlive) ?? ship)
      : ship;
  for (const enemy of enemies) {
    if (!navigationCandidate(ship, enemy, pursuitShips, hasNonFighterEnemy)) continue;
    if (fighter && hasSafeTarget && !safeNavigationTarget(enemy, aliveShips, context)) continue;
    let assignments =
      context?.count(context.navigationAssignments, ship, enemy.id, ship.navigationTargetId) ?? 0;
    if (!context)
      for (const peer of aliveShips) {
        if (
          peer.id !== ship.id &&
          peer.isAlive &&
          !peer.isDocked &&
          !peer.isDebris &&
          peer.team === ship.team &&
          peer.groupId === ship.groupId &&
          peer.navigationTargetId === enemy.id
        )
          assignments++;
      }
    const density = coordinated ? tacticalDensity(enemy, aliveShips) : undefined;
    const defenders = density?.get(enemy.team) ?? 1;
    const isolated = coordinated && (context?.isolated.get(enemy) ?? defenders <= 2);
    const hunterDistanceSquared = navigationDistanceSquared(hunter, enemy);
    const local = hunterDistanceSquared <= localEngagementRadiusSquared;
    const forceWeight =
      coordinated && local ? clamp((density?.get(ship.team) ?? 0) / defenders - 1, -1, 1) * 1.5 : 0;
    const isolationWeight = isolated && local ? 3 : 0;
    if (pack) {
      const distanceSquared = hunterDistanceSquared;
      if (
        distanceSquared <= packEngagementRadiusSquared &&
        withinPursuitTheater(hunter, enemy, aliveShips)
      ) {
        let rank = Infinity;
        if (enemy.hullClass === "corvette") rank = 0;
        else if (pack.length >= 2 && enemy.hullClass === "strike_craft" && isolated) rank = 1;
        else if (enemy.hullClass !== "strike_craft") rank = 2;
        rank += Math.max(0, assignments - 3) * 4 - isolationWeight - forceWeight;
        if (
          rank < Infinity &&
          (rank < localRank ||
            (rank === localRank &&
              (distanceSquared < localDistanceSquared ||
                (distanceSquared === localDistanceSquared &&
                  localBest &&
                  enemy.id.localeCompare(localBest.id) < 0))))
        ) {
          localBest = enemy;
          localRank = rank;
          localDistanceSquared = distanceSquared;
        }
      }
    }
    if (fighter && enemy.id === wingTargetId && !wingTarget) wingTarget = enemy;
    if (preferCapital && !isCapitalShip(enemy) && !(coordinated && isolated && local)) continue;
    if (preferCraft && enemy.hullClass !== "strike_craft" && enemy.hullClass !== "corvette")
      continue;
    const weaponDistanceSquared =
      hunter === ship ? hunterDistanceSquared : navigationDistanceSquared(ship, enemy);
    const weaponDistance = Math.sqrt(weaponDistanceSquared);
    const distance =
      anchor === ship ? weaponDistance : Math.sqrt(navigationDistanceSquared(anchor, enemy));
    const beyondRange = Math.max(0, weaponDistance / range - 1.15);
    const distancePenalty = combatCapital
      ? beyondRange * 6 + (hasCloseCapitalThreat && beyondRange > 0 ? 8 : 0)
      : 0;
    const nearby = clamp(2 - distance / range, 0, 1);
    const finishPriority = capitalFinishPriority(ship, enemy, aliveShips);
    const focusPriority =
      isolationWeight > 0 && assignments < 4 ? assignments * 0.6 : squadFocusPriority(assignments);
    const score =
      (-distance / range) * 2 +
      nearby * damagedTargetPriority(enemy) +
      finishPriority +
      isolationWeight +
      forceWeight +
      // Saturated focus squads must not send a capital through the hostile front line.
      (finishPriority > 0
        ? 0
        : hasCloseCapitalThreat && closeNavigationThreat(enemy, rangeSquared, weaponDistanceSquared)
          ? Math.max(-2, focusPriority) + 2
          : focusPriority) +
      (enemy.id === previousId ? 0.45 : 0) -
      distancePenalty;
    if (!best || score > bestScore) {
      best = enemy;
      bestScore = score;
    }
    if (!previous && enemy.id === previousId) {
      previous = enemy;
      previousScore = score;
      previousDistanceSquared = weaponDistanceSquared;
    }
    if (
      capitalPriority &&
      !firedTarget &&
      enemy.id === mainGun?.currentTargetId &&
      mainGun.sideTargetId !== enemy.id &&
      (!combatCapital || enemy.id === previousId) &&
      (!hasCloseCapitalThreat || weaponDistanceSquared <= rangeSquared) &&
      mainGun.lastFiredTime !== undefined &&
      mainGun.lastFiredTime !==
        (ship.hullClass === "missile_frigate"
          ? ship.skirmishCycle?.lastSalvoShot
          : (ship.broadsideCycle?.lastShot ?? ship.lastManeuverShot))
    )
      firedTarget = enemy;
  }
  if (localBest) return localBest;
  if (wingTarget) return wingTarget;
  if (firedTarget) return firedTarget;
  if (
    combatCapital &&
    previous &&
    !(hasCloseCapitalThreat && previousDistanceSquared > (range * 1.15) ** 2) &&
    bestScore <= previousScore + 0.5 * Math.max(Math.abs(previousScore), 1)
  )
    return previous;
  return best;
}

function navigationDistanceSquared(a: ShipState, b: ShipState): number {
  const dx = a.pos[0] - b.pos[0];
  const dy = a.pos[1] - b.pos[1];
  return dx * dx + dy * dy;
}

function navigationCandidate(
  ship: ShipState,
  enemy: ShipState,
  ships: ShipState[],
  hasNonFighterEnemy: boolean,
): boolean {
  return (
    enemy.isAlive &&
    !enemy.isDocked &&
    !enemy.isDebris &&
    enemy.team !== ship.team &&
    withinPursuitTheater(ship, enemy, ships, hasNonFighterEnemy)
  );
}

function closeNavigationThreat(
  enemy: ShipState,
  rangeSquared: number,
  distanceSquared: number,
): boolean {
  return (
    (enemy.hullClass === "dreadnought" ||
      enemy.hullClass === "battleship" ||
      enemy.hullClass === "cruiser") &&
    distanceSquared <= rangeSquared
  );
}

function safeNavigationTarget(
  enemy: ShipState,
  ships: ShipState[],
  context: NavigationContext | undefined,
): boolean {
  if (context) return context.safe.get(enemy) ?? true;
  let threats = 0;
  for (const flak of ships) {
    if (
      flak.isAlive &&
      !flak.isDocked &&
      !flak.isDebris &&
      flak.team === enemy.team &&
      flak.hullClass === "corvette" &&
      flakThreatRadius(flak) > 0 &&
      navigationDistanceSquared(flak, enemy) <= flakThreatRadius(flak) ** 2 &&
      ++threats >= 2
    )
      return false;
  }
  return true;
}

export function updateShipNavigation(
  ship: ShipState,
  target: ShipState | null,
  aliveShips: ShipState[],
  dt: number,
  context: Pick<
    ClientCombatSimulation,
    "shieldHaven" | "orders" | "timeElapsed" | "projectiles" | "ships"
  > &
    Partial<Pick<ClientCombatSimulation, "mapObstacles">>,
  fighterCycle: FighterMissionSystem["updateCycle"],
): void {
  if (moveCarrierLaunch(ship, aliveShips, dt, context.timeElapsed)) return;
  const brokePursuit = target !== null && !withinPursuitTheater(ship, target, aliveShips);
  if (target && !withinPursuitTheater(ship, target, aliveShips)) {
    target = null;
    ship.navigationTargetId = undefined;
    ship.maneuverTargetId = undefined;
    ship.dogfightTargetId = undefined;
  }
  if (context.shieldHaven.moveGuest(ship, aliveShips, dt, context.mapObstacles)) return;
  let targetHeading = ship.heading;
  let desiredSpeed = 0;
  let thrusterVelocity: Vector2 | null = null;
  let rangePhase: RangePhase | undefined;
  let evadingOrdnance = false;
  let maintainingStandoff = false;
  let thrustMultiplier = 1;
  if (ship.hullClass === "tender") {
    const rescueTarget = tenderRescueTarget(ship, aliveShips);
    if (
      rescueTarget &&
      vecDistance(ship.pos, rescueTarget.pos) > HARMONIC_RANGE * 0.9 &&
      ship.hullCurrent / Math.max(1, ship.hullMax) >= 0.35
    )
      thrustMultiplier = 1.35;
    thrusterVelocity = limitVelocity(
      vecAdd(supportVelocity(ship, aliveShips, rescueTarget), separation(ship, aliveShips)),
      ship.maxSpeed * thrustMultiplier,
    );
    targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
  } else if (ship.hullClass === "corvette") {
    let orbit = escortVelocity(ship, target, aliveShips);
    if (!target && !fleetDefenseAnchor(ship, aliveShips)) {
      // Without a capital to defend, advance the screen instead of waiting at spawn.
      // This is a movement waypoint, not a pursuit lock outside the local combat theater.
      let screenTarget: ShipState | undefined;
      let closestDistance = Infinity;
      const enemies = navigationContext(aliveShips)?.teamEnemies.get(ship.team) ?? aliveShips;
      for (const enemy of enemies) {
        if (!enemy.isAlive || enemy.isDocked || enemy.isDebris || enemy.team === ship.team)
          continue;
        const distance = navigationDistanceSquared(ship, enemy);
        if (distance < closestDistance) {
          screenTarget = enemy;
          closestDistance = distance;
        }
      }
      if (screenTarget) orbit = orbitVelocity(ship, screenTarget);
    }
    const avoid = vecAdd(
      separation(ship, aliveShips),
      spinalEscape(ship, aliveShips, context.projectiles, context.timeElapsed),
    );
    thrusterVelocity = limitVelocity(vecAdd(orbit, avoid), ship.maxSpeed);
    targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
  } else if (target && ship.hullClass === "strike_craft") {
    const maneuver = fighterCycle(ship, target, dt, aliveShips);
    targetHeading = maneuver.heading;
    desiredSpeed = maneuver.speed;
    if (
      ship.fighterPhase === "attack" &&
      ship.turrets.some(
        (turret) =>
          turret.cooldownTimer <= 0 &&
          vecDistance(ship.pos, target.pos) <=
            turret.weapon.range + ship.maxSpeed * (120 / HULL_PROFILES.strike_craft.speed),
      )
    ) {
      // Slew the nose gun independently of the tangential strafe thrust.
      thrusterVelocity = [
        Math.cos(maneuver.heading) * desiredSpeed,
        Math.sin(maneuver.heading) * desiredSpeed,
      ];
      const aim = vecSub(target.pos, ship.pos);
      targetHeading = Math.atan2(aim[1], aim[0]);
    }
  } else if (target) {
    const order = context.orders.get(ship.groupId) ?? {
      groupId: ship.groupId,
      priority: "nearest",
      stance: "optimal_range",
    };
    const intent = capitalIntent(
      ship,
      target,
      aliveShips,
      order,
      context.timeElapsed,
      context.projectiles,
    );
    targetHeading = intent.heading;
    thrusterVelocity = intent.velocity;
    rangePhase = intent.rangePhase;
    evadingOrdnance = intent.evadingOrdnance ?? false;
    // Translational escape must not be clipped by the focused target's bow-ingress envelope.
    maintainingStandoff = ship.hullClass === "carrier";
    if (!maintainingStandoff) {
      let shipMaxRange09 = -Infinity;
      for (const turret of ship.turrets)
        shipMaxRange09 = Math.max(shipMaxRange09, turret.weapon.range * 0.9);
      const damaged = ship.shieldCurrent <= 0 || ship.hullCurrent / Math.max(1, ship.hullMax) < 0.4;
      const enemies = navigationContext(aliveShips)?.teamEnemies.get(ship.team) ?? aliveShips;
      for (const enemy of enemies) {
        if (!enemy.isAlive || enemy.team === ship.team || enemy.hullClass === "strike_craft")
          continue;
        if (!damaged && !isCapitalShip(enemy)) continue;
        const longRange = ship.hullClass === "battleship" && enemy.hullClass === "dreadnought";
        const standoff = 500 * shieldClearanceScale(ship, enemy);
        const distance = damaged || longRange ? Math.max(standoff, shipMaxRange09) : standoff;
        const dx = enemy.pos[0] - ship.pos[0];
        const dy = enemy.pos[1] - ship.pos[1];
        if (
          dx * dx + dy * dy < distance * distance &&
          intent.velocity[0] * dx + intent.velocity[1] * dy < 0
        ) {
          maintainingStandoff = true;
          break;
        }
      }
    }
  } else if (
    brokePursuit ||
    aliveShips.some(
      (enemy) =>
        enemy.team !== ship.team &&
        enemy.isAlive &&
        !enemy.isDocked &&
        enemy.hullClass === "strike_craft",
    )
  ) {
    thrusterVelocity = fleetReturnVelocity(ship, aliveShips);
    targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
  }
  if (
    ship.hullClass !== "tender" &&
    ship.hullClass !== "strike_craft" &&
    ship.shieldCurrent <= 0 &&
    ship.hullCurrent / Math.max(1, ship.hullMax) < 0.4 &&
    !evadingOrdnance
  ) {
    let tender: ShipState | undefined;
    let bestScore = -Infinity;
    for (const peer of aliveShips) {
      if (
        !peer.isAlive ||
        peer.isDocked ||
        peer.isDebris ||
        peer.team !== ship.team ||
        peer.hullClass !== "tender"
      )
        continue;
      const risk = rescueRouteRisk(ship, peer, aliveShips);
      if (risk >= 1.5) continue;
      const dx = ship.pos[0] - peer.pos[0];
      const dy = ship.pos[1] - peer.pos[1];
      const score = 1 / (1 + Math.sqrt(dx * dx + dy * dy) / (HARMONIC_RANGE * 2.4)) - risk;
      if (score > bestScore || (score === bestScore && tender && peer.id < tender.id)) {
        tender = peer;
        bestScore = score;
      }
    }
    if (tender) {
      const dx = tender.pos[0] - ship.pos[0];
      const dy = tender.pos[1] - ship.pos[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      const towardX = distance < 1e-6 ? 0 : dx / distance;
      const towardY = distance < 1e-6 ? 0 : dy / distance;
      const rendezvousSpeed = clamp(
        (distance - HARMONIC_RANGE * 0.8) * 0.6,
        0,
        ship.maxSpeed * 0.6,
      );
      const rendezvousX = tender.velocity[0] + towardX * rendezvousSpeed;
      const rendezvousY = tender.velocity[1] + towardY * rendezvousSpeed;
      const velocity = thrusterVelocity ?? ship.velocity;
      thrusterVelocity = limitVelocity(
        [velocity[0] * 0.3 + rendezvousX * 0.7, velocity[1] * 0.3 + rendezvousY * 0.7],
        ship.maxSpeed,
      );
      // Do not let a breakoff thrust carry the wounded hull out of beam range.
      const outward =
        (thrusterVelocity[0] - tender.velocity[0]) * towardX +
        (thrusterVelocity[1] - tender.velocity[1]) * towardY;
      if (outward < 0)
        thrusterVelocity = [
          thrusterVelocity[0] - towardX * outward,
          thrusterVelocity[1] - towardY * outward,
        ];
      targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
      rangePhase = undefined;
    }
  }
  if (SHIP_DOCTRINES[ship.hullClass].flight.kind === "skirmish") {
    const breakout = emergencySkirmishBreakout(ship, aliveShips, ARENA_RADIUS);
    if (breakout) {
      targetHeading = breakout.heading;
      thrusterVelocity = breakout.velocity;
      rangePhase = undefined;
    }
  }
  let intendedVelocity: Vector2 = thrusterVelocity ?? [
    Math.cos(targetHeading) * desiredSpeed,
    Math.sin(targetHeading) * desiredSpeed,
  ];
  if (ship.hullClass === "strike_craft" && ship.fighterPhase === "egress") {
    const speed = vecDistance([0, 0], intendedVelocity);
    const route = friendlyShieldRecoveryDirection(
      ship,
      vecAdd(
        ship.pos,
        vecScale(
          vecNormalize(intendedVelocity),
          ship.maxSpeed * (900 / HULL_PROFILES.strike_craft.speed),
        ),
      ),
      aliveShips,
      vecNormalize(intendedVelocity),
    );
    thrusterVelocity = vecScale(route, speed);
    intendedVelocity = thrusterVelocity;
    targetHeading = Math.atan2(route[1], route[0]);
  }
  const returningToArena = vecDistance([0, 0], ship.pos) > ARENA_RADIUS;
  const boundaryVelocity = arenaVelocity(ship, intendedVelocity, aliveShips);
  if (boundaryVelocity !== intendedVelocity) {
    intendedVelocity = boundaryVelocity;
    thrusterVelocity = boundaryVelocity;
    if (returningToArena) targetHeading = Math.atan2(boundaryVelocity[1], boundaryVelocity[0]);
  }
  const allShips = context.ships ?? aliveShips;
  const tacticalTick = fighterTacticalTick(ship, context.timeElapsed, aliveShips);
  let obstacleDecision = obstacleDecisions.get(ship);
  if (!obstacleDecision) {
    obstacleDecision = { tick: -1, correction: 0 };
    obstacleDecisions.set(ship, obstacleDecision);
  }
  if (obstacleDecision.tick !== tacticalTick) {
    obstacleDecision.tick = tacticalTick;
    obstacleDecision.correction = obstacleCourseCorrection(
      ship,
      allShips,
      intendedVelocity[0],
      intendedVelocity[1],
      ship.hullClass === "strike_craft" && ship.fighterPhase === "attack" ? target : null,
    );
  }
  let avoidingObstacle = Math.abs(obstacleDecision.correction) > 1e-6;
  if (avoidingObstacle) {
    const course =
      Math.atan2(intendedVelocity[1], intendedVelocity[0]) + obstacleDecision.correction;
    const speed = Math.hypot(intendedVelocity[0], intendedVelocity[1]);
    intendedVelocity[0] = Math.cos(course) * speed;
    intendedVelocity[1] = Math.sin(course) * speed;
    thrusterVelocity = intendedVelocity;
    targetHeading = course;
  }
  const debrisVelocity = debrisAvoidanceVelocity(ship, intendedVelocity, allShips);
  const avoidingDebris = vecDistance(debrisVelocity, intendedVelocity) > 1e-6;
  if (avoidingDebris) {
    thrusterVelocity = debrisVelocity;
    targetHeading = Math.atan2(debrisVelocity[1], debrisVelocity[0]);
  }
  // Map solids take priority over repair rendezvous, cached ship avoidance and debris steering.
  const mapVelocity = mapObstacleAvoidanceVelocity(ship, debrisVelocity, context.mapObstacles);
  if (mapVelocity !== debrisVelocity) {
    avoidingObstacle = true;
    thrusterVelocity = mapVelocity;
    targetHeading = Math.atan2(mapVelocity[1], mapVelocity[0]);
  }
  const angleDiff = normalizeAngle(targetHeading - ship.heading);
  const turnStep = clamp(
    angleDiff,
    -ship.turnRate * thrustMultiplier * dt,
    ship.turnRate * thrustMultiplier * dt,
  );
  ship.heading = normalizeAngle(ship.heading + turnStep);
  const forwardX = Math.cos(ship.heading);
  const forwardY = Math.sin(ship.heading);
  const rightX = -forwardY;
  const rightY = forwardX;
  const currentForwardSpeed = ship.velocity[0] * forwardX + ship.velocity[1] * forwardY;
  const currentLateralSpeed = ship.velocity[0] * rightX + ship.velocity[1] * rightY;
  if (thrusterVelocity)
    desiredSpeed = thrusterVelocity[0] * forwardX + thrusterVelocity[1] * forwardY;
  desiredSpeed = Math.max(desiredSpeed, -ship.maxSpeed * 0.35);
  const lateralDamping = ship.hullClass === "strike_craft" ? 2.5 : 5.0;
  const newLateralSpeed = thrusterVelocity
    ? currentLateralSpeed +
      clamp(
        thrusterVelocity[0] * rightX + thrusterVelocity[1] * rightY - currentLateralSpeed,
        -110 * thrustMultiplier * dt,
        110 * thrustMultiplier * dt,
      )
    : currentLateralSpeed * Math.max(0, 1 - dt * lateralDamping);
  const forwardAccel = (ship.hullClass === "strike_craft" ? 240.0 : 110.0) * thrustMultiplier;
  const speedError = desiredSpeed - currentForwardSpeed;
  const forwardStep = clamp(speedError, -forwardAccel * dt, forwardAccel * dt);
  const newForwardSpeed = currentForwardSpeed + forwardStep;
  let controlledX = forwardX * newForwardSpeed + rightX * newLateralSpeed;
  let controlledY = forwardY * newForwardSpeed + rightY * newLateralSpeed;
  // Wings can cross another capital's shield while intercepting or rejoining.
  // Preserve tangential flight, but bound closing speed by the remaining clearance.
  if (ship.hullClass === "strike_craft") {
    for (const capital of aliveShips) {
      if (!capital.isAlive || !isCapitalShip(capital)) continue;
      const dx = capital.pos[0] - ship.pos[0];
      const dy = capital.pos[1] - ship.pos[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 1e-6) continue;
      const clearance = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(ship) + ship.size * 3;
      const inverseDistance = 1 / distance;
      const towardX = dx * inverseDistance;
      const towardY = dy * inverseDistance;
      const closing =
        (controlledX - capital.velocity[0]) * towardX +
        (controlledY - capital.velocity[1]) * towardY;
      const safeClosing = Math.max(0, (distance - clearance) / 0.5);
      if (closing > safeClosing) {
        const excessClosing = closing - safeClosing;
        controlledX = controlledX - towardX * excessClosing;
        controlledY = controlledY - towardY * excessClosing;
      }
    }
  }
  if (
    rangePhase &&
    !evadingOrdnance &&
    !maintainingStandoff &&
    !avoidingDebris &&
    !avoidingObstacle &&
    !returningToArena
  ) {
    const flight = SHIP_DOCTRINES[ship.hullClass].flight;
    if (flight.kind === "capital" || flight.kind === "skirmish") {
      const controlledVelocity = clampLateralVelocity(
        ship,
        [controlledX, controlledY],
        flight.lateralSpeedRatio,
        rangePhase,
      );
      controlledX = controlledVelocity[0];
      controlledY = controlledVelocity[1];
    }
  }
  const speed = Math.sqrt(controlledX * controlledX + controlledY * controlledY);
  const maxSpeed = ship.maxSpeed * thrustMultiplier;
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    controlledX = controlledX * scale;
    controlledY = controlledY * scale;
  }
  ship.velocity = [controlledX, controlledY];
  ship.pos = [ship.pos[0] + ship.velocity[0] * dt, ship.pos[1] + ship.velocity[1] * dt];
}
