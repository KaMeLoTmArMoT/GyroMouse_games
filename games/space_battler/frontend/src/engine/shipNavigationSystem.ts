import type { GroupOrder, ShipState, Vector2 } from "../types/combat";
import type { FighterMissionSystem } from "./fighterMissionSystem";
import { damagedTargetPriority, squadFocusPriority } from "./fireControl";
import { clampLateralVelocity } from "./flightBehaviors";
import {
  ARENA_HARD_PULL_RADIUS,
  ARENA_RADIUS,
  arenaVelocity,
  capitalIntent,
  escortVelocity,
  limitVelocity,
  separation,
  spinalEscape,
  supportVelocity,
} from "./flightControl";
import type { RangePhase } from "./flightCycles";
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
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import { SHIP_DOCTRINES } from "./shipDoctrines";
import type { ClientCombatSimulation } from "./simulation";

export function findNavigationTarget(
  ship: ShipState,
  order: GroupOrder,
  aliveShips: ShipState[],
  previousTargetId?: string,
  wingTargetId?: string | null,
): ShipState | null {
  let enemies = aliveShips.filter((s) => s.isAlive && s.team !== ship.team);
  if (enemies.length === 0) return null;
  if (ship.hullClass === "strike_craft") {
    const wingTarget = enemies.find((enemy) => enemy.id === wingTargetId);
    if (wingTarget) return wingTarget;
  }
  if (
    ship.hullClass === "carrier" ||
    ship.hullClass === "battleship" ||
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "missile_frigate" ||
    ship.hullClass === "cruiser" ||
    order.priority === "capitals"
  ) {
    const capitals = enemies.filter(isCapitalShip);
    if (capitals.length > 0) enemies = capitals;
    const mainGun = ship.turrets.find((t) => t.isSpinalGimbal || t.weapon.weaponType === "missile");
    const firedTarget = enemies.find((e) => e.id === mainGun?.currentTargetId);
    if (
      firedTarget &&
      mainGun?.lastFiredTime !== undefined &&
      mainGun.lastFiredTime !==
        (ship.hullClass === "missile_frigate"
          ? ship.skirmishCycle?.lastSalvoShot
          : (ship.broadsideCycle?.lastShot ?? ship.lastManeuverShot))
    )
      return firedTarget;
  } else if (order.priority === "strike_craft") {
    const crafts = enemies.filter(
      (s) => s.hullClass === "strike_craft" || s.hullClass === "corvette",
    );
    if (crafts.length > 0) enemies = crafts;
  } else if (ship.hullClass === "strike_craft") {
    // Fighter wings default to attack runs against capital hulls.
    const capitals = enemies.filter(isCapitalShip);
    if (capitals.length > 0) enemies = capitals;
  }
  const anchor =
    order.priority === "screen_and_defend"
      ? (aliveShips.find((s) => s.id === ship.flagshipId && s.isAlive) ?? ship)
      : ship;
  const range = Math.max(360, ...ship.turrets.map((turret) => turret.weapon.range));
  const score = (enemy: ShipState): number => {
    const distance = vecDistance(anchor.pos, enemy.pos);
    const nearby = clamp(2 - distance / range, 0, 1);
    const assignments = aliveShips.filter(
      (peer) =>
        peer.id !== ship.id &&
        peer.team === ship.team &&
        peer.groupId === ship.groupId &&
        peer.navigationTargetId === enemy.id,
    ).length;
    return (
      (-distance / range) * 2 +
      nearby * damagedTargetPriority(enemy) +
      squadFocusPriority(assignments) +
      (enemy.id === (previousTargetId ?? ship.maneuverTargetId) ? 0.45 : 0)
    );
  };
  return enemies.reduce((best, enemy) => (score(enemy) > score(best) ? enemy : best));
}

export function updateShipNavigation(
  ship: ShipState,
  target: ShipState | null,
  aliveShips: ShipState[],
  dt: number,
  context: Pick<ClientCombatSimulation, "shieldHaven" | "orders" | "timeElapsed" | "projectiles">,
  fighterCycle: FighterMissionSystem["updateCycle"],
): void {
  if (context.shieldHaven.moveGuest(ship, aliveShips, dt)) return;
  let targetHeading = ship.heading;
  let desiredSpeed = 0;
  let thrusterVelocity: Vector2 | null = null;
  let rangePhase: RangePhase | undefined;
  let evadingOrdnance = false;
  let maintainingStandoff = false;
  if (ship.hullClass === "tender") {
    thrusterVelocity = limitVelocity(
      vecAdd(supportVelocity(ship, aliveShips), separation(ship, aliveShips)),
      ship.maxSpeed,
    );
    targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
  } else if (ship.hullClass === "corvette") {
    const orbit = escortVelocity(ship, target, aliveShips);
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
    maintainingStandoff = aliveShips.some((enemy) => {
      if (!enemy.isAlive || enemy.team === ship.team || enemy.hullClass === "strike_craft")
        return false;
      const damaged = ship.shieldCurrent <= 0 || ship.hullCurrent / Math.max(1, ship.hullMax) < 0.4;
      const longRange = ship.hullClass === "battleship" && enemy.hullClass === "dreadnought";
      const distance =
        damaged || longRange
          ? Math.max(500, ...ship.turrets.map((turret) => turret.weapon.range * 0.9))
          : 500;
      return (
        (damaged || isCapitalShip(enemy)) &&
        vecDistance(ship.pos, enemy.pos) < distance &&
        vecDot(intent.velocity, vecSub(enemy.pos, ship.pos)) < 0
      );
    });
  }
  if (thrusterVelocity) {
    thrusterVelocity = arenaVelocity(ship, thrusterVelocity);
  } else if (vecDistance([0, 0], ship.pos) > ARENA_RADIUS) {
    const inward = arenaVelocity(ship, [
      Math.cos(targetHeading) * desiredSpeed,
      Math.sin(targetHeading) * desiredSpeed,
    ]);
    targetHeading = Math.atan2(inward[1], inward[0]);
    desiredSpeed = vecDistance([0, 0], inward);
  }
  const angleDiff = normalizeAngle(targetHeading - ship.heading);
  const turnStep = clamp(angleDiff, -ship.turnRate * dt, ship.turnRate * dt);
  ship.heading = normalizeAngle(ship.heading + turnStep);
  const forwardVector: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
  const rightVector: Vector2 = [-Math.sin(ship.heading), Math.cos(ship.heading)];
  const currentForwardSpeed = vecDot(ship.velocity, forwardVector);
  const currentLateralSpeed = vecDot(ship.velocity, rightVector);
  if (thrusterVelocity) desiredSpeed = vecDot(thrusterVelocity, forwardVector);
  desiredSpeed = Math.max(desiredSpeed, -ship.maxSpeed * 0.35);
  const lateralDamping = ship.hullClass === "strike_craft" ? 2.5 : 5.0;
  const newLateralSpeed = thrusterVelocity
    ? currentLateralSpeed +
      clamp(vecDot(thrusterVelocity, rightVector) - currentLateralSpeed, -110 * dt, 110 * dt)
    : currentLateralSpeed * Math.max(0, 1 - dt * lateralDamping);
  const forwardAccel = ship.hullClass === "strike_craft" ? 240.0 : 110.0;
  const speedError = desiredSpeed - currentForwardSpeed;
  const forwardStep = clamp(speedError, -forwardAccel * dt, forwardAccel * dt);
  const newForwardSpeed = currentForwardSpeed + forwardStep;
  const newVelocity = vecAdd(
    vecScale(forwardVector, newForwardSpeed),
    vecScale(rightVector, newLateralSpeed),
  );
  // Emergency acceleration beyond the soft band; no teleporting or position clamping.
  const containedVelocity =
    vecDistance([0, 0], ship.pos) > ARENA_HARD_PULL_RADIUS
      ? vecSub(newVelocity, vecScale(vecNormalize(ship.pos), 600 * dt))
      : newVelocity;
  let controlledVelocity = containedVelocity;
  // Wings can cross another capital's shield while intercepting or rejoining.
  // Preserve tangential flight, but bound closing speed by the remaining clearance.
  if (ship.hullClass === "strike_craft") {
    for (const capital of aliveShips) {
      if (!capital.isAlive || capital.team === ship.team || !isCapitalShip(capital)) continue;
      const distance = vecDistance(ship.pos, capital.pos);
      if (distance < 1e-6) continue;
      const clearance = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(ship) + 30;
      const toward = vecScale(vecSub(capital.pos, ship.pos), 1 / distance);
      const closing = vecDot(vecSub(controlledVelocity, capital.velocity), toward);
      const safeClosing = Math.max(0, (distance - clearance) / 0.5);
      if (closing > safeClosing)
        controlledVelocity = vecSub(controlledVelocity, vecScale(toward, closing - safeClosing));
    }
  }
  if (rangePhase && !evadingOrdnance && !maintainingStandoff) {
    const flight = SHIP_DOCTRINES[ship.hullClass].flight;
    if (flight.kind === "capital" || flight.kind === "skirmish")
      controlledVelocity = clampLateralVelocity(
        ship,
        controlledVelocity,
        flight.lateralSpeedRatio,
        rangePhase,
      );
  }
  ship.velocity = limitVelocity(controlledVelocity, ship.maxSpeed);
  ship.pos = vecAdd(ship.pos, vecScale(ship.velocity, dt));
}
