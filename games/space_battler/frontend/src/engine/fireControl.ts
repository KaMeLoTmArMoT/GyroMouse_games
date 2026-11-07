import type {
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";
import {
  clamp,
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDot,
  vecScale,
  vecSub,
} from "./math2d";
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
  const a = vecDot(velocity, velocity) - speed * speed;
  const b = 2 * vecDot(relative, velocity);
  const c = vecDot(relative, relative);
  if (c < 1e-8) return 0;
  if (Math.abs(a) < 1e-8) return b < 0 ? -c / b : null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const roots = [
    (-b - Math.sqrt(discriminant)) / (2 * a),
    (-b + Math.sqrt(discriminant)) / (2 * a),
  ].filter((t) => t >= 0);
  return roots.length ? Math.min(...roots) : null;
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

export function acquireMountTarget(
  ship: ShipState,
  turret: TurretMountState,
  primary: ShipState | null,
  ships: ShipState[],
  projectiles: ProjectileState[],
  missileLocks: MissileLock[] = [],
): FireSolution | null {
  const muzzle = mountPosition(ship, turret);
  const weapon = turret.weapon;
  turret.sideTargetId = undefined;
  const defense = pointDefenseMode(weapon);
  const defendedShips = [
    ship,
    ...ships.filter(
      (s) =>
        s.isAlive &&
        s.team === ship.team &&
        s.id !== ship.id &&
        (s.id === ship.flagshipId ||
          s.hullClass === "carrier" ||
          s.hullClass === "battleship" ||
          s.hullClass === "dreadnought" ||
          s.hullClass === "cruiser"),
    ),
  ];
  const solutions: Array<FireSolution & { priority: number }> = [];
  const evaluate = (
    target: ShipState | ProjectileState,
    kind: "ship" | "missile",
    role: number,
    priority = 0,
  ) => {
    const distance = vecDistance(muzzle, target.pos);
    if (distance > weapon.range || !inMountArc(ship, turret, target.pos)) return;
    let aim = target.pos;
    if (weapon.projectileSpeed > 0) {
      const t = interceptTime(vecSub(target.pos, muzzle), target.velocity, weapon.projectileSpeed);
      const lifetime = projectileLifetime(weapon);
      if (t === null || t > lifetime) return;
      aim = vecAdd(target.pos, vecScale(target.velocity, t));
      if (!inMountArc(ship, turret, aim)) return;
    }
    const direction = vecSub(aim, muzzle);
    const local = normalizeAngle(Math.atan2(direction[1], direction[0]) - ship.heading);
    const error = local - turret.currentLocalAngle;
    const turn =
      Math.abs(
        fullCircle(turret) || turret.baseArc[0] > turret.baseArc[1] ? normalizeAngle(error) : error,
      ) / Math.max(0.01, turret.trackingSpeed);
    solutions.push({
      kind,
      target,
      aim,
      score: role - distance / weapon.range - 0.4 * turn,
      priority,
    });
  };

  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.isDocked || enemy.isDebris || enemy.team === ship.team) continue;
    if (weapon.weaponType === "missile") {
      let incoming = 0;
      let inFlightDamage = 0;
      let insuranceDamage = 0;
      for (const missile of projectiles) {
        if (
          missile.weaponType === "missile" &&
          missile.targetId === enemy.id &&
          missile.ownerTeam !== enemy.team &&
          missile.hp > 0 &&
          missile.lifetime > 0
        ) {
          incoming += missileWeight(enemy, isHeavyTorpedo(missile));
          inFlightDamage += missile.damage;
          insuranceDamage = Math.max(insuranceDamage, missile.damage);
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
    let priority = 0;
    if (enemy.hullClass === "strike_craft") {
      if (defense === "flak" && vecDistance(muzzle, enemy.pos) < 350) priority = 3;
      if (
        defense === "rotary" &&
        (enemy.fighterPhase === "attack" ||
          defendedShips.some(
            (defended) =>
              vecDot(vecSub(enemy.pos, defended.pos), vecSub(enemy.velocity, defended.velocity)) <
              0,
          ))
      )
        priority = 2;
    }
    evaluate(enemy, "ship", role, priority);
  }

  if (
    !solutions.some((solution) => solution.kind === "ship" && solution.target.id === primary?.id)
  ) {
    for (const solution of solutions) {
      if (solution.kind !== "ship") continue;
      const enemy = solution.target as ShipState;
      const salvosToKill =
        (enemy.shieldCurrent / Math.max(0.01, weapon.shieldMultiplier) +
          enemy.armorCurrent / Math.max(0.01, weapon.armorMultiplier) +
          enemy.hullCurrent / Math.max(0.01, weapon.hullMultiplier)) /
        Math.max(1, weapon.damage);
      if (salvosToKill <= 2) solution.score += 3;
    }
  }

  const defensiveBeam =
    ship.hullClass === "battleship" && weapon.weaponType === "beam_laser" && solutions.length === 0;
  if (weapon.weaponType === "point_defense" || defensiveBeam) {
    for (const missile of projectiles) {
      if (
        missile.ownerTeam === ship.team ||
        missile.weaponType !== "missile" ||
        missile.hp <= 0 ||
        missile.lifetime <= 0
      )
        continue;
      let arrival = Infinity;
      let urgentTorpedo = false;
      for (const defended of defendedShips) {
        const r = vecSub(missile.pos, defended.pos);
        const v = vecSub(missile.velocity, defended.velocity);
        const t = -vecDot(r, v) / Math.max(vecDot(v, v), 1e-6);
        if (t < 0 || t > missile.lifetime) continue;
        if (vecDistance([0, 0], vecAdd(r, vecScale(v, t))) < defended.size + 80) {
          arrival = Math.min(arrival, t);
          if (
            isHeavyTorpedo(missile) &&
            (defended.hullClass === "carrier" ||
              defended.hullClass === "battleship" ||
              defended.hullClass === "dreadnought" ||
              defended.hullClass === "cruiser") &&
            vecDistance(missile.pos, defended.pos) < 300
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
  solutions.sort(
    (a, b) =>
      b.priority - a.priority || b.score - a.score || a.target.id.localeCompare(b.target.id),
  );
  const best = solutions[0];
  if (!best) return null;
  const current = solutions.find(
    (s) => s.target.id === turret.currentTargetId && s.kind === turret.currentTargetKind,
  );
  const selected =
    defense !== "laser" &&
    current &&
    best.priority === current.priority &&
    best.score <= current.score + 0.2 * Math.max(Math.abs(current.score), 1)
      ? current
      : best;
  if (selected.kind === "ship" && selected.target.id !== primary?.id)
    turret.sideTargetId = selected.target.id;
  return selected;
}
