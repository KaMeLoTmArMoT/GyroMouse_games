import type { ProjectileState, ShipState } from "../types/combat";
import {
  MOUNT_STRIDE,
  MountWord,
  PROJECTILE_STRIDE,
  ProjectileFlags,
  ProjectileWord,
  type RenderInterpolationState,
  SHIP_STRIDE,
  ShipFlags,
  ShipWord,
  WORKER_HULL_CLASSES,
} from "./simulationWorkerProtocol";

const snapshotRows = new WeakMap<
  RenderInterpolationState,
  { ships: Map<string, number>; projectiles: Map<string, number> }
>();
function rows(snapshot: RenderInterpolationState) {
  let indexes = snapshotRows.get(snapshot);
  if (!indexes) {
    indexes = {
      ships: new Map(snapshot.presentation?.shipIds.map((id, row) => [id, row]) ?? []),
      projectiles: new Map(snapshot.presentation?.projectileIds.map((id, row) => [id, row]) ?? []),
    };
    snapshotRows.set(snapshot, indexes);
  }
  return indexes;
}

export function interpolateAngle(previous: number, latest: number, alpha: number): number {
  if (alpha <= 0) return previous;
  if (alpha >= 1) return latest;
  const delta = Math.atan2(Math.sin(latest - previous), Math.cos(latest - previous));
  const angle = previous + delta * alpha;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function snapshotBlendAlpha(
  previous: RenderInterpolationState | null,
  latest: RenderInterpolationState,
  nowMs: number,
  speed: number,
): number {
  const interval = previous ? latest.timeElapsed - previous.timeElapsed : 0;
  if (speed <= 0 || interval <= 0) return 1;
  return Math.max(0, Math.min(1, ((nowMs - latest.receivedAtMs) * speed) / (interval * 1000)));
}

/** ID joins prevent blending unrelated rows after removal, launch or reordering.
 * Writes only to stable, owned presentation objects, never to endpoint views.
 */
export function interpolateSimulationSnapshot(
  previous: RenderInterpolationState | null,
  latest: RenderInterpolationState,
  alpha: number,
  ships: readonly ShipState[],
  projectiles: readonly ProjectileState[],
): void {
  const current = latest.views;
  if (!current) return;
  const old = previous?.views;
  const oldRows = previous ? rows(previous) : null;
  const blend = Math.max(0, Math.min(1, alpha));
  const lerp = (a: number, b: number) => a + (b - a) * blend;
  ships.forEach((ship, i) => {
    const row = i * SHIP_STRIDE;
    const previousIndex = oldRows?.ships.get(ship.id);
    const before = previousIndex === undefined ? -1 : previousIndex * SHIP_STRIDE;
    const flags = current.shipsInt[row + ShipWord.flags];
    // Docking/death transitions are discrete; do not sweep through a warp jump.
    const continuous = old && before >= 0 && old.shipsInt[before + ShipWord.flags] === flags;
    const scalar = (word: number) => current.shipsFloat[row + word];
    ship.pos[0] = continuous
      ? lerp(old.shipsFloat[before + ShipWord.posX], scalar(ShipWord.posX))
      : scalar(ShipWord.posX);
    ship.pos[1] = continuous
      ? lerp(old.shipsFloat[before + ShipWord.posY], scalar(ShipWord.posY))
      : scalar(ShipWord.posY);
    ship.heading = continuous
      ? interpolateAngle(old.shipsFloat[before + ShipWord.heading], scalar(ShipWord.heading), blend)
      : scalar(ShipWord.heading);
    ship.velocity[0] = scalar(ShipWord.velX);
    ship.velocity[1] = scalar(ShipWord.velY);
    ship.hullCurrent = scalar(ShipWord.hullCurrent);
    ship.hullMax = scalar(ShipWord.hullMax);
    ship.shieldCurrent = scalar(ShipWord.shieldCurrent);
    ship.shieldMax = scalar(ShipWord.shieldMax);
    ship.armorCurrent = scalar(ShipWord.armorCurrent);
    ship.armorMax = scalar(ShipWord.armorMax);
    ship.team = current.shipsInt[row + ShipWord.team];
    ship.hullClass = WORKER_HULL_CLASSES[current.shipsInt[row + ShipWord.hullClassIndex]];
    ship.isAlive = (flags & ShipFlags.alive) !== 0;
    ship.isDocked = (flags & ShipFlags.docked) !== 0;
    ship.isDebris = (flags & ShipFlags.debris) !== 0;
    const start = current.shipsInt[row + ShipWord.mountStart];
    const oldStart = continuous ? old.shipsInt[before + ShipWord.mountStart] : 0;
    const oldCount = continuous ? old.shipsInt[before + ShipWord.mountCount] : 0;
    ship.turrets.forEach((turret, j) => {
      const mount = (start + j) * MOUNT_STRIDE;
      const angle = current.mountsFloat[mount + MountWord.angle];
      turret.currentLocalAngle =
        continuous && j < oldCount
          ? interpolateAngle(
              old.mountsFloat[(oldStart + j) * MOUNT_STRIDE + MountWord.angle],
              angle,
              blend,
            )
          : angle;
      turret.cooldownTimer = current.mountsFloat[mount + MountWord.cooldown];
      const lastFired = current.mountsFloat[mount + MountWord.lastFiredTime];
      turret.lastFiredTime = Number.isNaN(lastFired) ? undefined : lastFired;
    });
  });
  projectiles.forEach((projectile, i) => {
    const row = i * PROJECTILE_STRIDE;
    const previousIndex = oldRows?.projectiles.get(projectile.id);
    const before = previousIndex === undefined ? -1 : previousIndex * PROJECTILE_STRIDE;
    for (const [axis, word] of [
      [0, ProjectileWord.posX],
      [1, ProjectileWord.posY],
    ] as const) {
      const value = current.projectilesFloat[row + word];
      projectile.pos[axis] =
        old && before >= 0 ? lerp(old.projectilesFloat[before + word], value) : value;
    }
    projectile.velocity[0] = current.projectilesFloat[row + ProjectileWord.velX];
    projectile.velocity[1] = current.projectilesFloat[row + ProjectileWord.velY];
    projectile.lifetime = current.projectilesFloat[row + ProjectileWord.lifetime];
    projectile.isFlakBurst =
      (current.projectilesInt[row + ProjectileWord.flags] & ProjectileFlags.flakBurst) !== 0;
  });
}
