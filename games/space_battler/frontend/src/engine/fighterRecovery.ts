import type { ShipState, Vector2 } from "../types/combat";
import { vecAdd, vecDistance, vecDot, vecNormalize, vecScale, vecSub } from "./math2d";
import { shieldEnvelopeRadius } from "./shieldGeometry";

// Shared by deck recovery and mission egress; fade jinks out on final docking approach.
export function fighterRecoveryDirection(
  craft: ShipState,
  destination: Vector2,
  ships: ShipState[],
  time: number,
): Vector2 {
  const delta = vecSub(destination, craft.pos);
  const distance = vecDistance([0, 0], delta);
  const direct = vecNormalize(delta);
  const threatened = ships.some(
    (peer) =>
      peer.isAlive &&
      !peer.isDocked &&
      !peer.isDebris &&
      peer.team !== craft.team &&
      vecDistance(craft.pos, peer.pos) < 300,
  );
  if (!threatened || distance < 60) return direct;
  let route = direct;
  let bestDetour = Infinity;
  for (const capital of ships) {
    if (
      !capital.isAlive ||
      capital.isDocked ||
      capital.isDebris ||
      capital.team !== craft.team ||
      !["battleship", "dreadnought", "cruiser"].includes(capital.hullClass)
    )
      continue;
    const offset = vecSub(capital.pos, craft.pos);
    const along = vecDot(offset, direct);
    const cross = vecSub(offset, vecScale(direct, along));
    const lateral = vecDistance([0, 0], cross);
    if (along <= 0 || along >= distance || along > 900 || lateral > 450) continue;
    const tangent: Vector2 = [-direct[1], direct[0]];
    const side = vecDot(cross, tangent) >= 0 ? -1 : 1;
    const waypoint = vecAdd(
      capital.pos,
      vecScale(tangent, side * (shieldEnvelopeRadius(capital) + craft.size + 60)),
    );
    const detour = vecDistance(craft.pos, waypoint) + vecDistance(waypoint, destination);
    if (detour >= bestDetour) continue;
    bestDetour = detour;
    route = vecNormalize(vecSub(waypoint, craft.pos));
  }
  const weave =
    Math.sin(time * 4 + (craft.wingSlot ?? 0) * 1.7) * 0.65 * Math.min(1, distance / 180);
  return vecNormalize(vecAdd(route, vecScale([-route[1], route[0]], weave)));
}
