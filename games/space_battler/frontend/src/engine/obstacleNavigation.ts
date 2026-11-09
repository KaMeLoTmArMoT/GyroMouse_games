import type { ShipState, Vector2 } from "../types/combat";
import { circleContactFraction, type MapObstacle } from "./battleMaps";
import { clamp, normalizeAngle } from "./math2d";
import { activeShieldRadius, isCapitalShip } from "./shieldGeometry";

/** Nearby shadow station on the existing standoff vector, outside the solid envelope. */
export function obstacleMissileCoverStation(
  ship: ShipState,
  target: ShipState,
  obstacles: readonly MapObstacle[],
  standoff: number,
  missileRange: number,
): { station: Vector2; obstacle: MapObstacle } | null {
  const dx = ship.pos[0] - target.pos[0];
  const dy = ship.pos[1] - target.pos[1];
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return null;
  const nx = dx / distance;
  const ny = dy / distance;
  const shield = activeShieldRadius(ship);
  let best: { station: Vector2; obstacle: MapObstacle } | null = null;
  let bestTravel = Infinity;
  for (const obstacle of obstacles) {
    // Small rocks cannot shelter the full shield silhouette.
    if (obstacle.radius <= shield * 2) continue;
    const ox = obstacle.pos[0] - target.pos[0];
    const oy = obstacle.pos[1] - target.pos[1];
    const along = ox * nx + oy * ny;
    const cross = Math.abs(ox * ny - oy * nx);
    if (
      along <= obstacle.radius ||
      along > distance + ship.maxSpeed * 2 ||
      cross > obstacle.radius + shield + ship.maxSpeed * 2
    )
      continue;
    const threatDistance = Math.hypot(ox, oy);
    const radius = Math.max(obstacle.radius + shield + 60, standoff - threatDistance);
    if (threatDistance + radius > missileRange * 0.95) continue;
    const station: Vector2 = [
      obstacle.pos[0] + (ox / threatDistance) * radius,
      obstacle.pos[1] + (oy / threatDistance) * radius,
    ];
    const travel = Math.hypot(station[0] - ship.pos[0], station[1] - ship.pos[1]);
    if (travel > Math.max(standoff * 0.5, obstacle.radius * 2)) continue;
    if (travel < bestTravel || (travel === bestTravel && best && obstacle.id < best.obstacle.id)) {
      best = { station, obstacle };
      bestTravel = travel;
    }
  }
  return best;
}

/** Route past the first firing-line blocker, using the swept steering envelope. */
export function obstacleFlankingWaypoint(
  ship: ShipState,
  target: ShipState,
  obstacles: readonly MapObstacle[],
  muzzle: Vector2 = ship.pos,
  aim: Vector2 = target.pos,
): Vector2 | null {
  let blocker: MapObstacle | undefined;
  let firstContact = Infinity;
  for (const obstacle of obstacles) {
    // Fire control requires both the current target and its intercept to be visible.
    const contact = Math.min(
      circleContactFraction(
        muzzle[0] - obstacle.pos[0],
        muzzle[1] - obstacle.pos[1],
        target.pos[0] - muzzle[0],
        target.pos[1] - muzzle[1],
        obstacle.radius,
      ),
      circleContactFraction(
        muzzle[0] - obstacle.pos[0],
        muzzle[1] - obstacle.pos[1],
        aim[0] - muzzle[0],
        aim[1] - muzzle[1],
        obstacle.radius,
      ),
    );
    if (
      contact < firstContact ||
      (contact < Infinity && contact === firstContact && blocker && obstacle.id < blocker.id)
    ) {
      firstContact = contact;
      blocker = obstacle;
    }
  }
  if (!blocker) return null;
  const radius = activeShieldRadius(ship) + blocker.radius + 60;
  const dx = ship.pos[0] - blocker.pos[0];
  const dy = ship.pos[1] - blocker.pos[1];
  const distance = Math.hypot(dx, dy);
  const nx = distance > 1e-6 ? dx / distance : -Math.cos(ship.heading);
  const ny = distance > 1e-6 ? dy / distance : -Math.sin(ship.heading);
  const side =
    Math.sign(nx * (aim[1] - blocker.pos[1]) - ny * (aim[0] - blocker.pos[0])) ||
    (ship.id < blocker.id ? -1 : 1);
  const tx = -ny * side;
  const ty = nx * side;
  if (distance <= radius) {
    // An embedded/near-boundary ship moves outward as it walks the perimeter.
    return [blocker.pos[0] + nx * radius + tx * radius, blocker.pos[1] + ny * radius + ty * radius];
  }
  const radial = (radius * radius) / distance;
  const lateral = radius * Math.sqrt(1 - (radius / distance) ** 2);
  const contactX = blocker.pos[0] + nx * radial + tx * lateral;
  const contactY = blocker.pos[1] + ny * radial + ty * lateral;
  const routeX = contactX - ship.pos[0];
  const routeY = contactY - ship.pos[1];
  const extension = radius / Math.hypot(routeX, routeY);
  // Aim beyond contact so arrival does not brake to zero at the tangent point.
  return [contactX + routeX * extension, contactY + routeY * extension];
}

/** Allocation-free swept clearance query; returns a course correction in radians. */
export function obstacleCourseCorrection(
  ship: ShipState,
  ships: ShipState[],
  vx: number,
  vy: number,
  attackTarget: ShipState | null = null,
  mapObstacles?: readonly MapObstacle[],
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
  if (!mapObstacles) return correction;
  for (const obstacle of mapObstacles) {
    const rx = obstacle.pos[0] - ship.pos[0];
    const ry = obstacle.pos[1] - ship.pos[1];
    const dx = vx - obstacle.velocity[0];
    const dy = vy - obstacle.velocity[1];
    const closing = rx * dx + ry * dy;
    const relativeSpeedSquared = dx * dx + dy * dy;
    if (closing <= 0 || relativeSpeedSquared < 1e-6) continue;
    const tStar = clamp(closing / relativeSpeedSquared, 0, horizon);
    const clearance = activeShieldRadius(ship) + obstacle.radius + 60;
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
    const px = rx + obstacle.velocity[0] * tStar;
    const py = ry + obstacle.velocity[1] * tStar;
    const bearing = Math.atan2(py, px);
    const side = Math.sign(normalizeAngle(heading - bearing)) || (ship.id < obstacle.id ? -1 : 1);
    const tangent = Math.asin(Math.min(1, clearance / Math.max(1, Math.hypot(px, py))));
    correction = normalizeAngle(bearing + side * (tangent + 0.08) - heading);
  }
  return correction;
}
