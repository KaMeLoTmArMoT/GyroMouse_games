import type {
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";
import { clamp, normalizeAngle, rotatePoint, vecAdd, vecDot, vecSub } from "./math2d";
import { navigationContext } from "./navigationContext";
import {
  isHeavyTorpedo,
  pointDefenseMode,
  projectileLifetime,
  projectileMaxHp,
} from "./shipProfiles";

export function mountPosition(ship: ShipState, turret: TurretMountState): Vector2 {
  return vecAdd(ship.pos, rotatePoint(turret.offset, ship.heading));
}

export function fullCircle(turret: TurretMountState): boolean {
  return turret.baseArc[1] - turret.baseArc[0] >= Math.PI * 2 - 1e-6;
}

export function inMountArc(ship: ShipState, turret: TurretMountState, point: Vector2): boolean {
  if (fullCircle(turret)) return true;
  const delta = vecSub(point, mountPosition(ship, turret));
  const bearing = normalizeAngle(Math.atan2(delta[1], delta[0]) - ship.heading);
  const [minArc, maxArc] = turret.baseArc;
  return minArc > maxArc
    ? bearing >= minArc || bearing <= maxArc
    : bearing >= minArc && bearing <= maxArc;
}

export function slewTurret(turret: TurretMountState, desiredLocal: number, dt: number): void {
  const [minArc, maxArc] = turret.baseArc;
  if (minArc > maxArc) {
    // Unwrap the aft sector so bounded slew crosses the stern, never the bow.
    const end = maxArc + Math.PI * 2;
    const unwrap = (angle: number) => {
      const normalized = normalizeAngle(angle);
      return normalized < minArc ? normalized + Math.PI * 2 : normalized;
    };
    const bearing = unwrap(desiredLocal);
    const goal =
      bearing <= end
        ? bearing
        : Math.abs(normalizeAngle(bearing - minArc)) <= Math.abs(normalizeAngle(bearing - end))
          ? minArc
          : end;
    const current = clamp(unwrap(turret.currentLocalAngle), minArc, end);
    const step = turret.trackingSpeed * dt;
    turret.currentLocalAngle = normalizeAngle(current + clamp(goal - current, -step, step));
    return;
  }
  const bearing = normalizeAngle(desiredLocal);
  let goal = bearing;
  if (!fullCircle(turret) && (bearing < minArc || bearing > maxArc)) {
    goal =
      Math.abs(normalizeAngle(bearing - minArc)) <= Math.abs(normalizeAngle(bearing - maxArc))
        ? minArc
        : maxArc;
  }
  // Bounded mounts must traverse inside their sector, never wrap through the forbidden arc.
  const current = fullCircle(turret)
    ? normalizeAngle(turret.currentLocalAngle)
    : clamp(turret.currentLocalAngle, minArc, maxArc);
  const diff = fullCircle(turret) ? normalizeAngle(goal - current) : goal - current;
  const maxStep = turret.trackingSpeed * dt;
  const next = current + clamp(diff, -maxStep, maxStep);
  turret.currentLocalAngle = fullCircle(turret)
    ? normalizeAngle(next)
    : clamp(next, minArc, maxArc);
}

// Projectiles do not inherit shooter velocity, so intercepts use absolute target velocity.
export function interceptTime(relative: Vector2, velocity: Vector2, speed: number): number | null {
  return interceptTimeScalar(relative[0], relative[1], velocity[0], velocity[1], speed);
}

function interceptTimeScalar(
  relativeX: number,
  relativeY: number,
  velocityX: number,
  velocityY: number,
  speed: number,
): number | null {
  const a = velocityX * velocityX + velocityY * velocityY - speed * speed;
  const b = 2 * (relativeX * velocityX + relativeY * velocityY);
  const c = relativeX * relativeX + relativeY * relativeY;
  if (c < 1e-8) return 0;
  if (Math.abs(a) < 1e-8) return b < 0 ? -c / b : null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  return first >= 0 ? (second >= 0 ? Math.min(first, second) : first) : second >= 0 ? second : null;
}

// Earliest contact along a relative swept segment, including initial overlap.
export function sweptHit(start: Vector2, end: Vector2, radius: number): number | null {
  const delta = vecSub(end, start);
  const c = vecDot(start, start) - radius * radius;
  if (c <= 0) return 0;
  const a = vecDot(delta, delta);
  if (a < 1e-10) return null;
  const b = 2 * vecDot(start, delta);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export interface FireSolution {
  kind: "ship" | "missile";
  target: ShipState | ProjectileState;
  aim: Vector2;
  score: number;
}

export function damagedTargetPriority(target: ShipState): number {
  return (
    1.5 * clamp(1 - target.shieldCurrent / Math.max(1, target.shieldMax), 0, 1) +
    2 * clamp(1 - target.armorCurrent / Math.max(1, target.armorMax), 0, 1) +
    4 * clamp(1 - target.hullCurrent / Math.max(1, target.hullMax), 0, 1)
  );
}

export function squadFocusPriority(assignments: number): number {
  return assignments < 3 ? assignments * 0.6 : 1.2 - (assignments - 2) * 4;
}

export function closeToKillTarget(ship: ShipState, target: ShipState): boolean {
  return (
    (ship.hullClass === "dreadnought" ||
      ship.hullClass === "battleship" ||
      ship.hullClass === "cruiser" ||
      ship.hullClass === "missile_frigate") &&
    (target.hullClass === "carrier" ||
      target.hullClass === "dreadnought" ||
      target.hullClass === "battleship" ||
      target.hullClass === "cruiser") &&
    target.shieldCurrent <= 0 &&
    (target.hullClass === "carrier" || target.hullCurrent < target.hullMax * 0.4) &&
    (target.pos[0] - ship.pos[0]) * target.velocity[0] +
      (target.pos[1] - ship.pos[1]) * target.velocity[1] >
      Math.hypot(target.pos[0] - ship.pos[0], target.pos[1] - ship.pos[1]) * target.maxSpeed * 0.5
  );
}

export function capitalFinishPriority(
  ship: ShipState,
  target: ShipState,
  ships: ShipState[],
): number {
  if (
    (ship.hullClass !== "dreadnought" && ship.hullClass !== "battleship") ||
    !closeToKillTarget(ship, target)
  )
    return 0;
  let assignments = 0;
  const context = navigationContext(ships);
  if (context)
    assignments =
      (context.capitalAssignments.get(ship.team)?.get(target.id) ?? 0) -
      Number(ship.navigationTargetId === target.id);
  else
    for (const peer of ships) {
      if (
        peer !== ship &&
        peer.isAlive &&
        !peer.isDocked &&
        !peer.isDebris &&
        peer.team === ship.team &&
        (peer.hullClass === "dreadnought" || peer.hullClass === "battleship") &&
        peer.navigationTargetId === target.id
      )
        assignments++;
    }
  return 3 + Math.min(assignments, 4) * 1.5;
}

export interface MissileLock {
  targetId: string;
  weapon: WeaponDefinition;
}

function missileCapacity(target: ShipState): number {
  switch (target.hullClass) {
    case "strike_craft":
      return 2;
    case "corvette":
      return 6;
    case "cruiser":
      return 14;
    default:
      return Infinity;
  }
}

function missileWeight(target: ShipState, heavy: boolean): number {
  return heavy ? (target.hullClass === "strike_craft" ? 2 : 3) : 1;
}

const defendedContexts = new WeakMap<ShipState[], Map<ShipState, ShipState[]>>();

export function prepareFireControlContext(
  ships: ShipState[],
  cache = true,
): Map<ShipState, ShipState[]> {
  const teams = new Map<number, ShipState[]>();
  const byId = new Map(ships.map((ship) => [ship.id, ship]));
  for (const ship of ships) {
    if (!ship.isAlive) continue;
    if (
      ship.hullClass !== "carrier" &&
      ship.hullClass !== "battleship" &&
      ship.hullClass !== "dreadnought" &&
      ship.hullClass !== "cruiser"
    )
      continue;
    const team = teams.get(ship.team) ?? [];
    team.push(ship);
    teams.set(ship.team, team);
  }
  const defended = new Map<ShipState, ShipState[]>();
  for (const ship of ships) {
    const peers = [ship, ...(teams.get(ship.team) ?? []).filter((peer) => peer.id !== ship.id)];
    const flagship = ship.flagshipId ? byId.get(ship.flagshipId) : undefined;
    if (flagship?.isAlive && flagship.team === ship.team && !peers.includes(flagship))
      peers.push(flagship);
    defended.set(ship, peers);
  }
  if (cache) defendedContexts.set(ships, defended);
  return defended;
}

export function acquireMountTarget(
  ship: ShipState,
  turret: TurretMountState,
  primary: ShipState | null,
  ships: ShipState[],
  projectiles: ProjectileState[],
  missileLocks: MissileLock[] = [],
): FireSolution | null {
  const muzzle = mountPosition(ship, turret);
  const muzzleX = muzzle[0];
  const muzzleY = muzzle[1];
  const weapon = turret.weapon;
  const rangeSq = weapon.range * weapon.range;
  const lifetime = projectileLifetime(weapon);
  const circular = fullCircle(turret);
  const [minArc, maxArc] = turret.baseArc;
  const wrapped = minArc > maxArc;
  const trackingSpeed = Math.max(0.01, turret.trackingSpeed);
  turret.sideTargetId = undefined;
  const defense = pointDefenseMode(weapon);
  let defendedShips: ShipState[] | undefined;
  const defendedFleet = () =>
    (defendedShips ??= (defendedContexts.get(ships) ?? prepareFireControlContext(ships, false)).get(
      ship,
    ) ?? [ship]);
  let bestTarget: ShipState | ProjectileState | undefined;
  let bestKind: FireSolution["kind"] = "ship";
  let bestAimX = 0;
  let bestAimY = 0;
  let bestScore = 0;
  let bestPriority = 0;
  let currentTarget: ShipState | ProjectileState | undefined;
  let currentKind: FireSolution["kind"] = "ship";
  let currentAimX = 0;
  let currentAimY = 0;
  let currentScore = 0;
  let currentFinishScore = 0;
  let currentPriority = 0;
  let finishTarget: ShipState | ProjectileState | undefined;
  let finishKind: FireSolution["kind"] = "ship";
  let finishAimX = 0;
  let finishAimY = 0;
  let finishScore = 0;
  let finishPriority = 0;
  let hasPrimary = false;
  let hasShip = false;
  const better = (
    target: ShipState | ProjectileState,
    score: number,
    priority: number,
    incumbent: ShipState | ProjectileState | undefined,
    incumbentScore: number,
    incumbentPriority: number,
  ) =>
    !incumbent ||
    priority > incumbentPriority ||
    (priority === incumbentPriority &&
      (score > incumbentScore ||
        (score === incumbentScore && target.id.localeCompare(incumbent.id) < 0)));
  const inRange = (target: ShipState | ProjectileState) => {
    const dx = muzzleX - target.pos[0];
    const dy = muzzleY - target.pos[1];
    return dx * dx + dy * dy <= rangeSq;
  };
  const inArc = (x: number, y: number) => {
    if (circular) return true;
    const bearing = normalizeAngle(Math.atan2(y - muzzleY, x - muzzleX) - ship.heading);
    return wrapped
      ? bearing >= minArc || bearing <= maxArc
      : bearing >= minArc && bearing <= maxArc;
  };
  const evaluate = (
    target: ShipState | ProjectileState,
    kind: "ship" | "missile",
    role: number,
    priority = 0,
  ) => {
    // Callers have already checked range and the current-position arc before scoring.
    const dx = target.pos[0] - muzzleX;
    const dy = target.pos[1] - muzzleY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let aimX = target.pos[0];
    let aimY = target.pos[1];
    if (weapon.projectileSpeed > 0) {
      const t = interceptTimeScalar(
        dx,
        dy,
        target.velocity[0],
        target.velocity[1],
        weapon.projectileSpeed,
      );
      if (t === null || t > lifetime) return;
      aimX += target.velocity[0] * t;
      aimY += target.velocity[1] * t;
      if (!inArc(aimX, aimY)) return;
    }
    const local = normalizeAngle(Math.atan2(aimY - muzzleY, aimX - muzzleX) - ship.heading);
    const error = local - turret.currentLocalAngle;
    const turn = Math.abs(circular || wrapped ? normalizeAngle(error) : error) / trackingSpeed;
    const score = role - distance / weapon.range - 0.4 * turn;
    if (better(target, score, priority, bestTarget, bestScore, bestPriority)) {
      bestTarget = target;
      bestKind = kind;
      bestAimX = aimX;
      bestAimY = aimY;
      bestScore = score;
      bestPriority = priority;
    }
    const retained = target.id === turret.currentTargetId && kind === turret.currentTargetKind;
    let bonus = 0;
    if (kind === "ship") {
      hasShip = true;
      hasPrimary ||= target.id === primary?.id;
      const enemy = target as ShipState;
      const salvos =
        (enemy.shieldCurrent / Math.max(0.01, weapon.shieldMultiplier) +
          enemy.armorCurrent / Math.max(0.01, weapon.armorMultiplier) +
          enemy.hullCurrent / Math.max(0.01, weapon.hullMultiplier)) /
        Math.max(1, weapon.damage);
      if (salvos <= 2) bonus = 3;
    }
    const candidateFinishScore = bonus ? score + bonus : score;
    if (better(target, candidateFinishScore, priority, finishTarget, finishScore, finishPriority)) {
      finishTarget = target;
      finishKind = kind;
      finishAimX = aimX;
      finishAimY = aimY;
      finishScore = candidateFinishScore;
      finishPriority = priority;
    }
    if (retained) {
      currentTarget = target;
      currentKind = kind;
      currentAimX = aimX;
      currentAimY = aimY;
      currentScore = score;
      currentFinishScore = candidateFinishScore;
      currentPriority = priority;
    }
  };

  // Preserve projectile order within each target's payloads without rescanning
  // every projectile for every enemy considered by a missile mount.
  const missilesByTarget = new Map<string, ProjectileState[]>();
  if (weapon.weaponType === "missile") {
    for (const missile of projectiles) {
      if (
        missile.weaponType !== "missile" ||
        !(missile.hp > 0) ||
        !(missile.lifetime > 0) ||
        missile.targetId === null
      )
        continue;
      const incoming = missilesByTarget.get(missile.targetId);
      if (incoming) incoming.push(missile);
      else missilesByTarget.set(missile.targetId, [missile]);
    }
  }

  const enemies =
    navigationContext(ships)?.teamEnemies.get(ship.team) ??
    ships.filter((enemy) => enemy.isAlive && enemy.team !== ship.team);
  for (const enemy of enemies) {
    if (!enemy.isAlive || enemy.isDocked || enemy.isDebris) continue;
    if (!inRange(enemy)) continue;
    if (!inArc(enemy.pos[0], enemy.pos[1])) continue;
    if (weapon.weaponType === "missile") {
      let incoming = 0;
      let inFlightDamage = 0;
      let insuranceDamage = 0;
      const incomingMissiles = missilesByTarget.get(enemy.id);
      if (incomingMissiles) {
        for (const missile of incomingMissiles) {
          if (missile.ownerTeam !== enemy.team) {
            incoming += missileWeight(enemy, isHeavyTorpedo(missile));
            inFlightDamage += missile.damage;
            insuranceDamage = Math.max(insuranceDamage, missile.damage);
          }
        }
      }
      for (const lock of missileLocks) {
        if (lock.targetId === enemy.id) {
          incoming += missileWeight(enemy, projectileMaxHp(lock.weapon) >= 120);
          inFlightDamage += lock.weapon.damage;
          insuranceDamage = Math.max(insuranceDamage, lock.weapon.damage);
        }
      }
      // Remove one committed payload from the estimate: exactly one insurance shot
      // may follow the lethal allocation, including reservations at this firing instant.
      const effectiveHealth = enemy.hullCurrent + enemy.armorCurrent + enemy.shieldCurrent;
      if (inFlightDamage - insuranceDamage >= effectiveHealth) continue;
      if (incoming + missileWeight(enemy, projectileMaxHp(weapon) >= 120) > missileCapacity(enemy))
        continue;
    }
    if (
      ship.hullClass === "strike_craft" &&
      enemy.hullClass !== "strike_craft" &&
      (ship.fighterPhase !== "attack" || enemy.id !== primary?.id)
    )
      continue;
    const capital =
      enemy.hullClass === "carrier" ||
      enemy.hullClass === "battleship" ||
      enemy.hullClass === "dreadnought" ||
      enemy.hullClass === "cruiser";
    let role = enemy.id === primary?.id ? 2 : 0;
    if ((turret.isSpinalGimbal || weapon.weaponType === "missile") && capital) role += 3;
    if (
      (weapon.weaponType === "point_defense" || ship.hullClass === "strike_craft") &&
      enemy.hullClass === "strike_craft"
    )
      role += 3;
    role += damagedTargetPriority(enemy);
    if (weapon.weaponType !== "point_defense") role += capitalFinishPriority(ship, enemy, ships);
    let priority = 0;
    if (enemy.hullClass === "strike_craft") {
      const dx = muzzleX - enemy.pos[0];
      const dy = muzzleY - enemy.pos[1];
      if (defense === "flak" && Math.sqrt(dx * dx + dy * dy) < 350) priority = 3;
      if (defense === "rotary") {
        if (enemy.fighterPhase === "attack") priority = 2;
        else {
          for (const defended of defendedFleet()) {
            if (
              (enemy.pos[0] - defended.pos[0]) * (enemy.velocity[0] - defended.velocity[0]) +
                (enemy.pos[1] - defended.pos[1]) * (enemy.velocity[1] - defended.velocity[1]) <
              0
            ) {
              priority = 2;
              break;
            }
          }
        }
      }
    }
    evaluate(enemy, "ship", role, priority);
  }

  const defensiveBeam =
    ship.hullClass === "battleship" && weapon.weaponType === "beam_laser" && !hasShip;
  if (weapon.weaponType === "point_defense" || defensiveBeam) {
    for (const missile of projectiles) {
      if (
        missile.ownerTeam === ship.team ||
        missile.weaponType !== "missile" ||
        missile.hp <= 0 ||
        missile.lifetime <= 0
      )
        continue;
      // Range and current-bearing arc are prerequisites for evaluate(); reject
      // impossible shots before testing trajectories against the defended fleet.
      if (!inRange(missile) || !inArc(missile.pos[0], missile.pos[1])) continue;
      let arrival = Infinity;
      let urgentTorpedo = false;
      for (const defended of defendedFleet()) {
        const rx = missile.pos[0] - defended.pos[0];
        const ry = missile.pos[1] - defended.pos[1];
        const vx = missile.velocity[0] - defended.velocity[0];
        const vy = missile.velocity[1] - defended.velocity[1];
        const t = -(rx * vx + ry * vy) / Math.max(vx * vx + vy * vy, 1e-6);
        if (t < 0 || t > missile.lifetime) continue;
        const closestX = rx + vx * t;
        const closestY = ry + vy * t;
        if (Math.sqrt(closestX * closestX + closestY * closestY) < defended.size + 80) {
          arrival = Math.min(arrival, t);
          if (
            isHeavyTorpedo(missile) &&
            (defended.hullClass === "carrier" ||
              defended.hullClass === "battleship" ||
              defended.hullClass === "dreadnought" ||
              defended.hullClass === "cruiser") &&
            Math.sqrt(rx * rx + ry * ry) < 300
          )
            urgentTorpedo = true;
        }
      }
      if (!Number.isFinite(arrival)) continue;
      let priority = 3;
      if (defense === "flak") priority = isHeavyTorpedo(missile) ? 1 : 2;
      if (defense === "rotary") {
        priority = isHeavyTorpedo(missile) ? 0 : 1;
        if (urgentTorpedo) priority = 3;
      }
      evaluate(missile, "missile", 10 + 2 / (1 + arrival), priority);
    }
  }
  if (!hasPrimary) {
    bestTarget = finishTarget;
    bestKind = finishKind;
    bestAimX = finishAimX;
    bestAimY = finishAimY;
    bestScore = finishScore;
    bestPriority = finishPriority;
    currentScore = currentFinishScore;
  }
  if (!bestTarget) return null;
  const retainCurrent =
    defense !== "laser" &&
    currentTarget &&
    bestPriority === currentPriority &&
    bestScore <= currentScore + 0.2 * Math.max(Math.abs(currentScore), 1);
  const target = retainCurrent ? currentTarget : bestTarget;
  const kind = retainCurrent ? currentKind : bestKind;
  if (kind === "ship" && target.id !== primary?.id) turret.sideTargetId = target.id;
  return {
    kind,
    target,
    aim:
      weapon.projectileSpeed > 0
        ? [retainCurrent ? currentAimX : bestAimX, retainCurrent ? currentAimY : bestAimY]
        : target.pos,
    score: retainCurrent ? currentScore : bestScore,
  };
}
