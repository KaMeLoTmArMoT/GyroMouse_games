import type { ProjectileState, ShipState, TurretMountState, Vector2 } from "../types/combat";
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
import { projectileLifetime } from "./shipProfiles";

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
  return bearing >= turret.baseArc[0] && bearing <= turret.baseArc[1];
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

export function acquireMountTarget(
  ship: ShipState,
  turret: TurretMountState,
  primary: ShipState | null,
  ships: ShipState[],
  projectiles: ProjectileState[],
): FireSolution | null {
  const muzzle = mountPosition(ship, turret);
  const weapon = turret.weapon;
  const solutions: FireSolution[] = [];
  const evaluate = (
    target: ShipState | ProjectileState,
    kind: "ship" | "missile",
    role: number,
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
      Math.abs(fullCircle(turret) ? normalizeAngle(error) : error) /
      Math.max(0.01, turret.trackingSpeed);
    solutions.push({ kind, target, aim, score: role - distance / weapon.range - 0.4 * turn });
  };

  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.team === ship.team) continue;
    if (
      ship.hullClass === "strike_craft" &&
      enemy.hullClass !== "strike_craft" &&
      (ship.fighterPhase !== "attack" || enemy.id !== primary?.id)
    )
      continue;
    const capital = enemy.hullClass === "battleship" || enemy.hullClass === "cruiser";
    let role = enemy.id === primary?.id ? 2 : 0;
    if ((turret.isSpinalGimbal || weapon.weaponType === "missile") && capital) role += 3;
    if (
      (weapon.weaponType === "point_defense" || ship.hullClass === "strike_craft") &&
      enemy.hullClass === "strike_craft"
    )
      role += 3;
    role += damagedTargetPriority(enemy);
    evaluate(enemy, "ship", role);
  }

  const defensiveBeam =
    ship.hullClass === "battleship" && weapon.weaponType === "beam_laser" && solutions.length === 0;
  if (weapon.weaponType === "point_defense" || defensiveBeam) {
    const anchor = ships.find((s) => s.isAlive && s.id === ship.flagshipId);
    for (const missile of projectiles) {
      if (
        missile.ownerTeam === ship.team ||
        missile.weaponType !== "missile" ||
        missile.hp <= 0 ||
        missile.lifetime <= 0
      )
        continue;
      let arrival = Infinity;
      for (const defended of anchor ? [ship, anchor] : [ship]) {
        const r = vecSub(missile.pos, defended.pos);
        const v = vecSub(missile.velocity, defended.velocity);
        const t = -vecDot(r, v) / Math.max(vecDot(v, v), 1e-6);
        if (t < 0 || t > missile.lifetime) continue;
        if (vecDistance([0, 0], vecAdd(r, vecScale(v, t))) < defended.size + 80)
          arrival = Math.min(arrival, t);
      }
      if (Number.isFinite(arrival)) evaluate(missile, "missile", 10 + 2 / (1 + arrival));
    }
  }
  solutions.sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id));
  const best = solutions[0];
  if (!best) return null;
  const current = solutions.find(
    (s) => s.target.id === turret.currentTargetId && s.kind === turret.currentTargetKind,
  );
  return current && best.score <= current.score + 0.2 * Math.max(Math.abs(current.score), 1)
    ? current
    : best;
}
