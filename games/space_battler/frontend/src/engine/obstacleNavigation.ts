import type { ShipState } from "../types/combat";
import { clamp, normalizeAngle } from "./math2d";
import { activeShieldRadius, isCapitalShip } from "./shieldGeometry";

/** Allocation-free swept clearance query; returns a course correction in radians. */
export function obstacleCourseCorrection(
  ship: ShipState,
  ships: ShipState[],
  vx: number,
  vy: number,
  attackTarget: ShipState | null = null,
): number {
  const speed = Math.hypot(vx, vy);
  if (speed < 1) return 0;
  const horizon = 750 / speed;
  const heading = Math.atan2(vy, vx);
  let firstContact = Infinity;
  let correction = 0;
  for (const obstacle of ships) {
    // The fighter attack cycle already routes its firing pass tangent to this shield.
    if (obstacle === attackTarget) continue;
    if (obstacle === ship || obstacle.isDocked || (!obstacle.isAlive && !obstacle.isDebris))
      continue;
    // Capitals never yield to small craft; wrecks must have a substantial hull.
    if (!isCapitalShip(obstacle) && obstacle.size < (isCapitalShip(ship) ? 80 : 30)) continue;
    const rx = obstacle.pos[0] - ship.pos[0];
    const ry = obstacle.pos[1] - ship.pos[1];
    const dx = vx - obstacle.velocity[0];
    const dy = vy - obstacle.velocity[1];
    const closing = rx * dx + ry * dy;
    if (closing <= 0) continue;
    const relativeSpeedSquared = dx * dx + dy * dy;
    const tStar = clamp(closing / relativeSpeedSquared, 0, horizon);
    const clearance = activeShieldRadius(ship) + activeShieldRadius(obstacle) + 60;
    const cx = rx - dx * tStar;
    const cy = ry - dy * tStar;
    if (cx * cx + cy * cy >= clearance * clearance) continue;
    const discriminant =
      closing * closing - relativeSpeedSquared * (rx * rx + ry * ry - clearance * clearance);
    const contact = Math.max(
      0,
      (closing - Math.sqrt(Math.max(0, discriminant))) / relativeSpeedSquared,
    );
    if (contact >= firstContact) continue;
    firstContact = contact;
    // Tangent to the obstacle's predicted envelope, rather than a repulsive force.
    const px = rx + obstacle.velocity[0] * tStar;
    const py = ry + obstacle.velocity[1] * tStar;
    const distance = Math.hypot(px, py);
    const bearing = Math.atan2(py, px);
    const side = Math.sign(normalizeAngle(heading - bearing)) || (ship.id < obstacle.id ? -1 : 1);
    const tangent = Math.asin(Math.min(1, clearance / Math.max(1, distance)));
    correction = normalizeAngle(bearing + side * (tangent + 0.08) - heading);
  }
  return correction;
}
