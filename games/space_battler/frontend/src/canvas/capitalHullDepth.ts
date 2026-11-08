import type { ShipState } from "../types/combat";

const points: Record<string, number[][]> = {
  cruiser: [
    [1.22, 0],
    [0.6, -0.38],
    [0.2, -0.38],
    [-0.65, -0.5],
    [-1.1, -0.28],
    [-1.1, 0.28],
    [-0.65, 0.5],
    [0.2, 0.38],
    [0.6, 0.38],
  ],
  battleship: [
    [1.28, 0],
    [0.8, -0.38],
    [0.25, -0.58],
    [-0.85, -0.62],
    [-1.2, -0.35],
    [-1.2, 0.35],
    [-0.85, 0.62],
    [0.25, 0.58],
    [0.8, 0.38],
  ],
  dreadnought: [
    [1.25, 0],
    [0.85, -0.4],
    [0.3, -0.48],
    [0.14, -0.67],
    [-0.58, -0.67],
    [-0.78, -0.52],
    [-1.12, -0.42],
    [-1.12, 0.42],
    [-0.78, 0.52],
    [-0.58, 0.67],
    [0.14, 0.67],
    [0.3, 0.48],
    [0.85, 0.4],
  ],
  carrier: [
    [1.25, 0],
    [0.75, -0.35],
    [0.35, -0.42],
    [0.12, -0.68],
    [-0.82, -0.68],
    [-1.08, -0.48],
    [-1.08, 0.48],
    [-0.82, 0.68],
    [0.12, 0.68],
    [0.35, 0.42],
    [0.75, 0.35],
  ],
};

export function isHeavyHull(ship: ShipState): boolean {
  return (
    ship.hullClass === "cruiser" ||
    ship.hullClass === "battleship" ||
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "carrier"
  );
}

/** The same dorsal silhouette is used for every slice of the ventral armor. */
export function traceHeavyHull(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  ctx.beginPath();
  if (ship.hullClass === "carrier" && alien) {
    ctx.moveTo(s * 1.25, 0);
    ctx.bezierCurveTo(s * 0.9, -s * 0.18, s * 0.45, -s * 0.7, -s * 0.2, -s * 0.67);
    ctx.bezierCurveTo(-s * 0.65, -s * 0.7, -s * 1.18, -s * 0.57, -s * 1.08, -s * 0.35);
    ctx.bezierCurveTo(-s * 0.78, -s * 0.18, -s * 0.78, s * 0.18, -s * 1.08, s * 0.35);
    ctx.bezierCurveTo(-s * 1.18, s * 0.57, -s * 0.65, s * 0.7, -s * 0.2, s * 0.67);
    ctx.bezierCurveTo(s * 0.45, s * 0.7, s * 0.9, s * 0.18, s * 1.25, 0);
  } else if (ship.hullClass === "dreadnought" && alien) {
    ctx.moveTo(s * 1.25, 0);
    ctx.quadraticCurveTo(s * 0.85, -s * 0.42, s * 0.25, -s * 0.46);
    ctx.lineTo(0, -s * 0.68);
    ctx.lineTo(-s * 0.52, -s * 0.64);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.55, -s * 1.12, -s * 0.42);
    ctx.lineTo(-s * 1.12, s * 0.42);
    ctx.quadraticCurveTo(-s * 0.9, s * 0.55, -s * 0.52, s * 0.64);
    ctx.lineTo(0, s * 0.68);
    ctx.lineTo(s * 0.25, s * 0.46);
    ctx.quadraticCurveTo(s * 0.85, s * 0.42, s * 1.25, 0);
  } else if (ship.hullClass === "cruiser" && alien) {
    ctx.moveTo(s * 1.22, -s * 0.2411);
    ctx.lineTo(s * 0.9, 0);
    ctx.lineTo(s * 1.22, s * 0.2411);
    ctx.quadraticCurveTo(s * 0.35, s * 0.5479, -s * 0.85, s * 0.3945);
    ctx.quadraticCurveTo(-s * 1.1, 0, -s * 0.85, -s * 0.3945);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.5479, s * 1.22, -s * 0.2411);
  } else if (ship.hullClass === "battleship" && alien) {
    ctx.moveTo(s * 1.28, 0);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.892, -s * 1.15, -s * 0.6559);
    ctx.quadraticCurveTo(-s * 0.4, 0, -s * 1.15, s * 0.6559);
    ctx.quadraticCurveTo(s * 0.5, s * 0.892, s * 1.28, 0);
  } else {
    for (const [i, [x, y]] of points[ship.hullClass].entries()) {
      if (i === 0) ctx.moveTo(s * x, s * y);
      else ctx.lineTo(s * x, s * y);
    }
  }
  ctx.closePath();
}
