import { rotatePoint } from "../engine/math2d";
import type { ShipState } from "../types/combat";
import { engineNozzles } from "./effects";
import { isLightHull, traceLightHull } from "./lightHullDepth";

export function isPreviewLightHull(ship: ShipState): boolean {
  return isLightHull(ship) || ship.hullClass === "tender";
}

/** Approximate the aft deck edge at a nozzle's lateral coordinate. */
export function sternEdge(ship: ShipState, y: number): number {
  const side = Math.abs(y);
  const alien = ship.team !== 0;
  switch (ship.hullClass) {
    case "strike_craft":
      return alien ? -0.35 - (0.3 * side) / 0.3505 : -0.5 - (0.2 * (side - 0.2)) / 0.35;
    case "corvette": {
      if (!alien)
        return side < 0.32 ? -0.75 - (0.2 * side) / 0.32 : -0.95 + (0.45 * (side - 0.32)) / 0.26;
      const t = (y + 0.548) / 1.096;
      return -0.75 + 0.6 * t * (1 - t);
    }
    case "missile_frigate":
      return alien
        ? side < 0.15
          ? -0.65 - (0.27 * side) / 0.15
          : -0.92 + (0.07 * (side - 0.15)) / 0.27
        : -0.78 - (0.17 * side) / 0.34;
    default:
      return alien ? -0.85 : -0.82;
  }
}

/** Convert a vertical height to deck coordinates before the caller's Y projection. */
export function previewDepthFactor(elevation: number): number {
  return Math.cos(elevation) / Math.sin(elevation);
}

function traceCapitalKeel(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  ctx.beginPath();
  ctx.moveTo(s * 1.05, 0);
  if (ship.hullClass === "tender" && ship.team !== 0) {
    ctx.moveTo(s * 0.92, 0);
    ctx.bezierCurveTo(s * 0.65, -s * 0.25, s * 0.1, -s * 0.68, -s * 0.58, -s * 0.52);
    ctx.bezierCurveTo(-s * 0.92, -s * 0.36, -s * 0.85, -s * 0.14, -s * 0.8, 0);
    ctx.bezierCurveTo(-s * 0.85, s * 0.14, -s * 0.92, s * 0.36, -s * 0.58, s * 0.52);
    ctx.bezierCurveTo(s * 0.1, s * 0.68, s * 0.65, s * 0.25, s * 0.92, 0);
  } else if (ship.hullClass === "tender") {
    ctx.moveTo(s * 1.04, 0);
    for (const [x, y] of [
      [0.58, -0.4],
      [0.25, -0.5],
      [0.08, -0.82],
      [-0.55, -0.82],
      [-0.66, -0.48],
      [-0.82, -0.34],
      [-0.82, 0.34],
      [-0.66, 0.48],
      [-0.55, 0.82],
      [0.08, 0.82],
      [0.25, 0.5],
      [0.58, 0.4],
    ])
      ctx.lineTo(s * x, s * y);
  } else if (ship.team !== 0) {
    ctx.quadraticCurveTo(s * 0.25, -s * 0.5, -s * 0.8, -s * 0.36);
    ctx.quadraticCurveTo(-s * 0.65, 0, -s * 0.8, s * 0.36);
    ctx.quadraticCurveTo(s * 0.25, s * 0.5, s * 1.05, 0);
  } else {
    ctx.lineTo(s * 0.42, -s * 0.32);
    ctx.lineTo(-s * 0.75, -s * 0.4);
    ctx.lineTo(-s * 0.95, -s * 0.25);
    ctx.lineTo(-s * 0.95, s * 0.25);
    ctx.lineTo(-s * 0.75, s * 0.4);
    ctx.lineTo(s * 0.42, s * 0.32);
  }
  ctx.closePath();
}

/** Sweep from a narrow ventral spine through a broad chine to the detailed deck. */
export function drawPreviewKeel(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  const s = ship.size;
  const [dx, dy] = rotatePoint([0, s * 0.24 * depth], -ship.heading);
  if (Math.hypot(dx, dy) < 1e-10) return;
  const alien = ship.team !== 0;
  const light = isPreviewLightHull(ship);
  ctx.save();
  for (let i = 24; i >= 0; i--) {
    const fraction = i / 24;
    // The widest belt is one third of the way down from the dorsal deck.
    const scale = fraction <= 1 / 3 ? 1 + fraction * 0.09 : 1.03 - (fraction - 1 / 3) * 0.285;
    ctx.save();
    ctx.translate(dx * fraction, dy * fraction);
    ctx.scale(scale, scale);
    if (light) {
      // Each successive slice darkens towards the keel, with a lit chamfer across its width.
      const shade = 1 - fraction * 0.68;
      const color = (r: number, g: number, b: number) =>
        `rgb(${Math.round(r * shade)}, ${Math.round(g * shade)}, ${Math.round(b * shade)})`;
      const flank = ctx.createLinearGradient(0, -s, 0, s);
      flank.addColorStop(0, alien ? color(165, 83, 96) : color(102, 145, 164));
      flank.addColorStop(0.45, alien ? color(112, 43, 57) : color(49, 82, 102));
      flank.addColorStop(1, alien ? color(70, 23, 34) : color(26, 49, 66));
      ctx.fillStyle = flank;
    } else {
      ctx.fillStyle =
        fraction > 1 / 3 ? (alien ? "#350d17" : "#102333") : alien ? "#702b39" : "#315266";
    }
    if (isLightHull(ship)) traceLightHull(ctx, ship);
    else traceCapitalKeel(ctx, ship);
    ctx.fill();
    if (i === 8) {
      ctx.strokeStyle = alien ? "#c16773" : "#81adbf";
      ctx.lineWidth = Math.max(0.5, s * 0.012);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Aft-facing recessed ports sit in the stern flank, never on the dorsal deck.
  if (Math.sin(ship.heading) < -0.01) {
    for (const [nozzleX, y] of engineNozzles(ship)) {
      // The artwork's nozzle centers lie inside the deck; move preview ports to the aft edge.
      const port = (halfWidth: number, top: number, bottom: number) => {
        const edge = (fraction: number) => (light ? 1.03 - (fraction - 1 / 3) * 0.285 : 1);
        const x = (lateral: number) => (light ? sternEdge(ship, lateral) : nozzleX);
        const near = y - halfWidth;
        const far = y + halfWidth;
        ctx.beginPath();
        ctx.moveTo(s * x(near) * edge(top) + dx * top, s * near * edge(top) + dy * top);
        ctx.lineTo(s * x(far) * edge(top) + dx * top, s * far * edge(top) + dy * top);
        ctx.lineTo(s * x(far) * edge(bottom) + dx * bottom, s * far * edge(bottom) + dy * bottom);
        ctx.lineTo(s * x(near) * edge(bottom) + dx * bottom, s * near * edge(bottom) + dy * bottom);
        ctx.closePath();
      };
      ctx.fillStyle = alien ? "#260913" : "#061824";
      ctx.strokeStyle = alien ? "#9f4856" : "#548398";
      ctx.lineWidth = Math.max(0.5, s * 0.015);
      port(0.065, light ? 0.35 : 0.22, 0.85);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = alien ? "#fb923c" : "#7dd3fc";
      port(0.034, 0.35, 0.7);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Compact faceted bridge, painted with the turrets in camera-depth order. */
export function drawPreviewSuperstructure(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  if (Math.abs(depth) < 1e-10) return;
  const s = ship.size;
  const alien = ship.team !== 0;
  const [ux, uy] = rotatePoint([0, -s * 0.12 * depth], -ship.heading);
  const roof = () => {
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, 0);
    ctx.lineTo(-s * 0.2, -s * 0.1);
    ctx.lineTo(-s * 0.4, -s * 0.1);
    ctx.lineTo(-s * 0.48, 0);
    ctx.lineTo(-s * 0.4, s * 0.1);
    ctx.lineTo(-s * 0.2, s * 0.1);
    ctx.closePath();
  };
  ctx.save();
  for (let i = 0; i <= 12; i++) {
    ctx.save();
    ctx.translate((ux * i) / 12, (uy * i) / 12);
    ctx.fillStyle = i === 12 ? (alien ? "#8c3e4d" : "#46697d") : alien ? "#491824" : "#1c3748";
    roof();
    ctx.fill();
    if (i === 12) {
      ctx.strokeStyle = alien ? "#e68387" : "#92c5d7";
      ctx.lineWidth = Math.max(0.5, s * 0.012);
      ctx.stroke();
      ctx.strokeStyle = alien ? "#ffb07d" : "#b9efff";
      ctx.beginPath();
      ctx.moveTo(-s * 0.22, -s * 0.06);
      ctx.lineTo(-s * 0.17, 0);
      ctx.lineTo(-s * 0.22, s * 0.06);
      ctx.moveTo(-s * 0.37, -s * 0.065);
      ctx.lineTo(-s * 0.37, s * 0.065);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (isPreviewLightHull(ship)) {
    // The forward face sits below the roof, so its lights remain visible at low elevation.
    ctx.fillStyle = alien ? "#ff9b79" : "#b9efff";
    ctx.strokeStyle = alien ? "#ff9b79" : "#b9efff";
    ctx.lineWidth = Math.max(0.5, s * 0.018);
    if (alien) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          -s * 0.2 + ux * 0.55,
          side * s * 0.045 + uy * 0.55,
          s * 0.018,
          s * 0.018,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(-s * 0.2 + ux * 0.55, -s * 0.06 + uy * 0.55);
      ctx.lineTo(-s * 0.15 + ux * 0.55, uy * 0.55);
      ctx.lineTo(-s * 0.2 + ux * 0.55, s * 0.06 + uy * 0.55);
      ctx.stroke();
    }
  }
  ctx.restore();
}
