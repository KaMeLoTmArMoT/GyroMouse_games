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

  // Flush collars remain concentric with the authoritative mounts as the guns turn.
  for (const turret of ship.turrets) {
    const [x, y] = turret.offset;
    const r = (turret.baseRadius ?? 4) * 1.12;
    ctx.fillStyle = alien ? "#4b1823" : "#1b3445";
    ctx.beginPath();
    if (alien) {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * (i + 0.5)) / 4;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = alien ? "rgba(255, 190, 195, 0.3)" : "rgba(186, 230, 253, 0.3)";
    ctx.lineWidth = Math.max(0.3, r * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}
