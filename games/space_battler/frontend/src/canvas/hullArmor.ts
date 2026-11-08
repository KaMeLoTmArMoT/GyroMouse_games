import type { ShipState } from "../types/combat";
import { isLightHull, traceLightHull } from "./lightHullDepth";

/** Static armor is painted in hull coordinates so it turns with the deck, not the guns. */
export function drawHullArmor(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  ctx.save();
  if (isLightHull(ship)) {
    traceLightHull(ctx, ship);
    ctx.clip();
  }

  // A narrow raised spine leaves the distinctive hull fittings visible through its facets.
  const ridge = ctx.createLinearGradient(0, -s * 0.25, 0, s * 0.25);
  ridge.addColorStop(0, "rgba(2, 6, 23, 0.25)");
  ridge.addColorStop(0.34, alien ? "rgba(251, 146, 160, 0.3)" : "rgba(186, 230, 253, 0.3)");
  ridge.addColorStop(0.55, alien ? "rgba(190, 80, 95, 0.2)" : "rgba(100, 160, 190, 0.2)");
  ridge.addColorStop(1, "rgba(2, 6, 23, 0.38)");
  ctx.fillStyle = ridge;
  ctx.beginPath();
  ctx.moveTo(s * 0.76, 0);
  if (alien) {
    ctx.bezierCurveTo(s * 0.32, -s * 0.25, -s * 0.2, -s * 0.23, -s * 0.38, 0);
    ctx.bezierCurveTo(-s * 0.2, s * 0.23, s * 0.32, s * 0.25, s * 0.76, 0);
  } else {
    ctx.lineTo(s * 0.35, -s * 0.2);
    ctx.lineTo(-s * 0.28, -s * 0.21);
    ctx.lineTo(-s * 0.43, 0);
    ctx.lineTo(-s * 0.28, s * 0.21);
    ctx.lineTo(s * 0.35, s * 0.2);
  }
  ctx.closePath();
  ctx.fill();

  // The fairings widen into the deck and taper toward each authoritative mount.
  for (const turret of ship.turrets) {
    const [x, y] = turret.offset;
    const r = turret.baseRadius ?? 4;
    const ramp = ctx.createLinearGradient(x, y - r * 1.45, x, y + r * 1.45);
    ramp.addColorStop(0, alien ? "rgba(251, 146, 160, 0.12)" : "rgba(186, 230, 253, 0.15)");
    ramp.addColorStop(0.35, alien ? "rgba(180, 75, 88, 0.75)" : "rgba(94, 140, 165, 0.75)");
    ramp.addColorStop(0.65, alien ? "rgba(100, 35, 47, 0.8)" : "rgba(43, 72, 91, 0.8)");
    ramp.addColorStop(1, "rgba(2, 6, 23, 0.35)");
    ctx.fillStyle = ramp;
    ctx.beginPath();
    if (alien) {
      ctx.moveTo(x - r * 1.9, y);
      ctx.bezierCurveTo(x - r * 1.45, y - r * 1.5, x + r * 1.1, y - r * 1.5, x + r * 1.6, y);
      ctx.bezierCurveTo(x + r * 1.1, y + r * 1.5, x - r * 1.45, y + r * 1.5, x - r * 1.9, y);
    } else {
      ctx.moveTo(x - r * 2, y);
      ctx.lineTo(x - r * 1.2, y - r * 1.4);
      ctx.lineTo(x + r * 0.9, y - r * 1.25);
      ctx.lineTo(x + r * 1.6, y);
      ctx.lineTo(x + r * 0.9, y + r * 1.25);
      ctx.lineTo(x - r * 1.2, y + r * 1.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = alien ? "rgba(255, 190, 195, 0.3)" : "rgba(186, 230, 253, 0.3)";
    ctx.lineWidth = Math.max(0.3, r * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}
