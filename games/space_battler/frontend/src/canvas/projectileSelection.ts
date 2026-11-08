import type { ProjectileState } from "../types/combat";

export function projectileAtPoint(
  projectiles: ProjectileState[],
  worldX: number,
  worldY: number,
  screenScaleX: number,
  screenScaleY: number,
  shipClicked: boolean,
): string | null {
  let closest: { id: string; distance: number } | null = null;
  for (const projectile of projectiles) {
    if (projectile.weaponType !== "missile" || projectile.hp <= 0 || projectile.lifetime <= 0)
      continue;
    const distance = Math.hypot(
      (projectile.pos[0] - worldX) * screenScaleX,
      (projectile.pos[1] - worldY) * screenScaleY,
    );
    if (distance <= 25 && (!closest || distance < closest.distance)) {
      closest = { id: projectile.id, distance };
    }
  }
  return closest && (!shipClicked || closest.distance <= 8) ? closest.id : null;
}
