import type { ProjectileState, ShipState, Vector2 } from "../types/combat";
import { clamp, vecAdd, vecDistance, vecDot, vecNormalize, vecScale, vecSub } from "./math2d";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";

function craftSeed(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Blend into an orbit tangent before entering a friendly capital's repulsor. */
export function friendlyShieldRecoveryDirection(
  craft: ShipState,
  destination: Vector2,
  ships: ShipState[],
  direct: Vector2,
): Vector2 {
  let route = direct;
  let bestDetour = Infinity;
  for (const capital of ships) {
    if (
      !capital.isAlive ||
      capital.isDocked ||
      capital.isDebris ||
      capital.team !== craft.team ||
      !isCapitalShip(capital)
    )
      continue;
    const radius = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(craft) + 60;
    // The assigned deck corridor is intentionally allowed through its own umbrella.
    if (capital.id === craft.flagshipId && vecDistance(destination, capital.pos) < radius) continue;
    const offset = vecSub(capital.pos, craft.pos);
    const along = vecDot(offset, direct);
    const cross = vecSub(offset, vecScale(direct, along));
    const lateral = vecDistance([0, 0], cross);
    const distance = vecDistance(craft.pos, capital.pos);
    if (
      along <= 0 ||
      along >= vecDistance(craft.pos, destination) ||
      along > 900 ||
      lateral > radius + 150
    )
      continue;
    const tangent: Vector2 = [-direct[1], direct[0]];
    const side = vecDot(cross, tangent) >= 0 ? -1 : 1;
    const waypoint = vecAdd(capital.pos, vecScale(tangent, side * radius));
    const detour = vecDistance(craft.pos, waypoint) + vecDistance(waypoint, destination);
    if (detour >= bestDetour) continue;
    bestDetour = detour;
    const outward = vecNormalize(vecSub(craft.pos, capital.pos));
    const orbit: Vector2 = [outward[1] * side, -outward[0] * side];
    const perimeter = vecNormalize(
      vecAdd(orbit, vecScale(outward, clamp((radius - distance) / 80, 0, 1))),
    );
    const blend = clamp((radius + 180 - distance) / 180, 0, 1);
    route = vecNormalize(
      vecAdd(
        vecScale(vecNormalize(vecSub(waypoint, craft.pos)), 1 - blend),
        vecScale(perimeter, blend),
      ),
    );
  }
  return route;
}

export function recoveryApproachVelocity(
  craft: ShipState,
  carrier: ShipState,
  destination: Vector2,
  direction: Vector2,
  dt: number,
): Vector2 {
  const speed = Math.min(craft.maxSpeed, vecDistance(craft.pos, destination) * 1.5);
  const desired = vecAdd(carrier.velocity, vecScale(direction, speed));
  const change = vecSub(desired, craft.velocity);
  const length = vecDistance([0, 0], change);
  return vecAdd(
    craft.velocity,
    vecScale(change, length > 0 ? Math.min(1, (240 * dt) / length) : 0),
  );
}

// Shared by deck recovery and mission egress; fade jinks out on final docking approach.
export function fighterRecoveryDirection(
  craft: ShipState,
  destination: Vector2,
  ships: ShipState[],
  time: number,
  projectiles: readonly ProjectileState[] = [],
): Vector2 {
  const delta = vecSub(destination, craft.pos);
  const distance = vecDistance([0, 0], delta);
  const direct = vecNormalize(delta);
  if (distance < 60) return direct;
  const route = friendlyShieldRecoveryDirection(craft, destination, ships, direct);
  let nearest = 300;
  let fireLine: { pos: Vector2; direction: Vector2 } | null = null;
  for (const peer of ships) {
    if (!peer.isAlive || peer.isDocked || peer.isDebris || peer.team === craft.team) continue;
    const range = vecDistance(craft.pos, peer.pos);
    const direction: Vector2 = [Math.cos(peer.heading), Math.sin(peer.heading)];
    if (range >= nearest || vecDot(direction, vecSub(craft.pos, peer.pos)) <= 0) continue;
    nearest = range;
    fireLine = { pos: peer.pos, direction };
  }
  for (const projectile of projectiles) {
    if (projectile.ownerTeam === craft.team || projectile.lifetime <= 0) continue;
    const range = vecDistance(craft.pos, projectile.pos);
    const direction = vecNormalize(projectile.velocity);
    if (range >= nearest || vecDot(direction, vecSub(craft.pos, projectile.pos)) <= 0) continue;
    nearest = range;
    fireLine = { pos: projectile.pos, direction };
  }
  if (!fireLine) return route;
  const seed = craftSeed(craft.id);
  const normal: Vector2 = [-fireLine.direction[1], fireLine.direction[0]];
  const offset = vecDot(vecSub(craft.pos, fireLine.pos), normal);
  const side = Math.abs(offset) > 1 ? Math.sign(offset) : seed % 2 ? 1 : -1;
  const phase = (seed / 4294967296) * Math.PI * 2;
  const frequency = 2.5 + ((seed >>> 8) % 1000) / 500;
  const amplitude =
    (0.5 + 0.2 * Math.sin(time * frequency + phase)) *
    Math.min(1, distance / 180) *
    (0.5 + 0.5 * (1 - nearest / 300));
  return friendlyShieldRecoveryDirection(
    craft,
    destination,
    ships,
    vecNormalize(vecAdd(direct, vecScale(normal, side * amplitude))),
  );
}
