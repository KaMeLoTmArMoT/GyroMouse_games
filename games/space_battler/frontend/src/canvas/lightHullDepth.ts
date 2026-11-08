import type { ShipState, Vector2 } from "../types/combat";

export function isLightHull(ship: ShipState): boolean {
  return (
    ship.hullClass === "strike_craft" ||
    ship.hullClass === "corvette" ||
    ship.hullClass === "missile_frigate"
  );
}

/** The actual deck outline, shared by the top armor and its ventral extrusion. */
export function traceLightHull(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  ctx.beginPath();
  if (ship.hullClass === "strike_craft" && alien) {
    ctx.moveTo(s * 0.85, -s * 0.6884);
    ctx.quadraticCurveTo(s * 0.15, -s * 0.1252, -s * 0.65, -s * 0.3505);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.65, s * 0.3505);
    ctx.quadraticCurveTo(s * 0.15, s * 0.1252, s * 0.85, s * 0.6884);
    ctx.quadraticCurveTo(s * 0.55, 0, s * 0.85, -s * 0.6884);
  } else if (ship.hullClass === "strike_craft") {
    ctx.moveTo(s * 1.1, 0);
    ctx.lineTo(-s * 0.7, -s * 0.55);
    ctx.lineTo(-s * 0.5, -s * 0.2);
    ctx.lineTo(-s * 0.85, 0);
    ctx.lineTo(-s * 0.5, s * 0.2);
    ctx.lineTo(-s * 0.7, s * 0.55);
  } else if (ship.hullClass === "corvette" && alien) {
    ctx.moveTo(s * 1.15, 0);
    ctx.quadraticCurveTo(s * 0.25, -s * 0.7916, -s * 0.75, -s * 0.548);
    ctx.quadraticCurveTo(-s * 0.45, 0, -s * 0.75, s * 0.548);
    ctx.quadraticCurveTo(s * 0.25, s * 0.7916, s * 1.15, 0);
  } else if (ship.hullClass === "corvette") {
    ctx.moveTo(s * 1.15, 0);
    ctx.lineTo(s * 0.4, -s * 0.45);
    ctx.lineTo(-s * 0.5, -s * 0.58);
    ctx.lineTo(-s * 0.95, -s * 0.32);
    ctx.lineTo(-s * 0.75, 0);
    ctx.lineTo(-s * 0.95, s * 0.32);
    ctx.lineTo(-s * 0.5, s * 0.58);
    ctx.lineTo(s * 0.4, s * 0.45);
  } else if (alien) {
    ctx.moveTo(s * 1.2, 0);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.48, -s * 0.85, -s * 0.42);
    ctx.lineTo(-s * 0.92, -s * 0.15);
    ctx.lineTo(-s * 0.65, 0);
    ctx.lineTo(-s * 0.92, s * 0.15);
    ctx.lineTo(-s * 0.85, s * 0.42);
    ctx.quadraticCurveTo(s * 0.35, s * 0.48, s * 1.2, 0);
  } else {
    ctx.moveTo(s * 1.2, 0);
    ctx.lineTo(s * 0.4, -s * 0.3);
    ctx.lineTo(-s * 0.55, -s * 0.46);
    ctx.lineTo(-s * 0.95, -s * 0.34);
    ctx.lineTo(-s * 0.78, 0);
    ctx.lineTo(-s * 0.95, s * 0.34);
    ctx.lineTo(-s * 0.55, s * 0.46);
    ctx.lineTo(s * 0.4, s * 0.3);
  }
  ctx.closePath();
}

/** A reusable solid profile for the cached battlefield keel. */
export function drawLightHullKeel(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const side = ctx.createLinearGradient(0, -ship.size, 0, ship.size);
  side.addColorStop(0, ship.team === 0 ? "#31536a" : "#883947");
  side.addColorStop(0.55, ship.team === 0 ? "#214a5c" : "#762b39");
  side.addColorStop(1, ship.team === 0 ? "#102537" : "#330c14");
  ctx.fillStyle = side;
  traceLightHull(ctx, ship);
  ctx.fill();
}

/** Sweep the silhouette to form solid flanks in previews and the vector fallback. */
export function drawLightHullExtrusion(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  offset: Vector2,
): void {
  const [dx, dy] = offset;
  const length = Math.hypot(dx, dy);
  const gx = (dx / length) * ship.size;
  const gy = (dy / length) * ship.size;
  const side = ctx.createLinearGradient(-gx, -gy, gx, gy);
  side.addColorStop(0, ship.team === 0 ? "#31536a" : "#883947");
  side.addColorStop(0.45, ship.team === 0 ? "#214a5c" : "#762b39");
  side.addColorStop(1, ship.team === 0 ? "#102537" : "#330c14");
  ctx.save();
  ctx.fillStyle = side;
  // Successive overlapping profiles cover the area between the deck and keel.
  for (let i = 8; i >= 0; i--) {
    ctx.save();
    ctx.translate((dx * i) / 8, (dy * i) / 8);
    traceLightHull(ctx, ship);
    ctx.fill();
    if (i === 8) {
      ctx.strokeStyle = ship.team === 0 ? "#101e2c" : "#300a10";
      ctx.lineWidth = Math.max(0.6, ship.size * 0.025);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
