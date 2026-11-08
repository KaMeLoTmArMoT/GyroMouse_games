import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";
import { isHeavyHull, traceHeavyHull } from "./capitalHullDepth";
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
    case "cruiser": {
      if (!alien) return -1.1;
      const t = (y + 0.3945) / 0.789;
      return -0.85 - 0.5 * t * (1 - t);
    }
    case "battleship": {
      if (!alien) return -1.2;
      const t = (y + 0.6559) / 1.3118;
      return -1.15 + 1.5 * t * (1 - t);
    }
    case "dreadnought":
      return -1.12;
    case "carrier": {
      if (!alien) return -1.08;
      // Invert the stern Bezier's lateral coordinate for the recessed port.
      let low = 0;
      let high = 1;
      for (let i = 0; i < 24; i++) {
        const t = (low + high) / 2;
        const v = 1 - t;
        const lateral = -0.35 * v ** 3 - 0.54 * v * v * t + 0.54 * v * t * t + 0.35 * t ** 3;
        if (lateral < y) low = t;
        else high = t;
      }
      const t = (low + high) / 2;
      return -1.08 + 0.9 * t * (1 - t);
    }
    default:
      return alien ? -0.85 : -0.82;
  }
}

export function previewKeelHeight(ship: ShipState): number {
  return ship.size * (isHeavyHull(ship) ? 0.32 : 0.24);
}

export function previewBridge(ship: ShipState): { x: number; height: number } {
  return isHeavyHull(ship)
    ? { x: -ship.size * (ship.hullClass === "dreadnought" ? 0.78 : 0.48), height: ship.size * 0.18 }
    : { x: -ship.size * 0.3, height: ship.size * 0.12 };
}

export function previewTerraceHeight(ship: ShipState, turret: TurretMountState): number {
  if (ship.hullClass !== "battleship" && ship.hullClass !== "dreadnought") return 0;
  return turret.offset[0] < ship.size * 0.15 ? ship.size * 0.08 : 0;
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
  const [dx, dy] = rotatePoint([0, previewKeelHeight(ship) * depth], -ship.heading);
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
    if (light || isHeavyHull(ship)) {
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
    else if (isHeavyHull(ship)) traceHeavyHull(ctx, ship);
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
    for (const [, y] of engineNozzles(ship)) {
      // The artwork's nozzle centers lie inside the deck; move preview ports to the aft edge.
      const port = (halfWidth: number, top: number, bottom: number) => {
        const edge = (fraction: number) => 1.03 - (fraction - 1 / 3) * 0.285;
        const x = (lateral: number) => sternEdge(ship, lateral);
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
      port(0.065, 0.35, 0.85);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = alien ? "#fb923c" : "#7dd3fc";
      port(0.034, 0.35, 0.7);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Broad, low armor terraces lift midship batteries without tall cylindrical supports. */
export function drawPreviewTerrace(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  depth: number,
): void {
  const height = previewTerraceHeight(ship, turret);
  if (!height) return;
  const s = ship.size;
  const [x, y] = turret.offset;
  const [ux, uy] = rotatePoint([0, -height * depth], -ship.heading);
  const width = Math.max(turret.baseRadius * 1.65, s * 0.14);
  const length = Math.max(turret.baseRadius * 2, s * 0.19);
  ctx.save();
  for (let i = 0; i <= 10; i++) {
    ctx.save();
    ctx.translate((ux * i) / 10, (uy * i) / 10);
    ctx.beginPath();
    ctx.moveTo(x + length, y - width * 0.65);
    ctx.lineTo(x + length * 0.72, y - width);
    ctx.lineTo(x - length * 0.72, y - width);
    ctx.lineTo(x - length, y - width * 0.65);
    ctx.lineTo(x - length, y + width * 0.65);
    ctx.lineTo(x - length * 0.72, y + width);
    ctx.lineTo(x + length * 0.72, y + width);
    ctx.lineTo(x + length, y + width * 0.65);
    ctx.closePath();
    ctx.fillStyle =
      i === 10
        ? ship.team === 0
          ? "#415e70"
          : "#853c49"
        : ship.team === 0
          ? "#142d3c"
          : "#42131e";
    ctx.fill();
    if (i === 10) {
      ctx.strokeStyle = ship.team === 0 ? "#8db8ca" : "#e37e87";
      ctx.lineWidth = Math.max(0.5, s * 0.012);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Compact faceted bridge, painted with the turrets in camera-depth order. */
export function drawPreviewSuperstructure(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  if (Math.abs(depth) < 1e-10 && !isHeavyHull(ship)) return;
  const s = ship.size;
  const alien = ship.team !== 0;
  if (isHeavyHull(ship)) {
    const center = previewBridge(ship).x;
    const [ux, uy] = rotatePoint([0, -s * 0.18 * depth], -ship.heading);
    ctx.save();
    for (let i = 0; i <= 18; i++) {
      const upper = i > 10;
      const halfWidth = s * (upper ? 0.105 : 0.16);
      const front = center + s * (upper ? 0.1 : 0.19);
      const back = center - s * (upper ? 0.13 : 0.21);
      ctx.save();
      ctx.translate((ux * i) / 18, (uy * i) / 18);
      ctx.beginPath();
      ctx.moveTo(front, 0);
      ctx.lineTo(front - s * 0.06, -halfWidth);
      ctx.lineTo(back + s * 0.06, -halfWidth);
      ctx.lineTo(back, 0);
      ctx.lineTo(back + s * 0.06, halfWidth);
      ctx.lineTo(front - s * 0.06, halfWidth);
      ctx.closePath();
      ctx.fillStyle =
        i === 10 || i === 18 ? (alien ? "#8c3e4d" : "#46697d") : alien ? "#491824" : "#1c3748";
      ctx.fill();
      if (i === 10 || i === 18) {
        ctx.strokeStyle = alien ? "#e68387" : "#92c5d7";
        ctx.lineWidth = Math.max(0.5, s * 0.012);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = alien ? "#ffb07d" : "#b9efff";
    ctx.lineWidth = Math.max(0.5, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(center + s * 0.07 + ux, -s * 0.06 + uy);
    ctx.lineTo(center + s * 0.1 + ux, uy);
    ctx.lineTo(center + s * 0.07 + ux, s * 0.06 + uy);
    ctx.stroke();
    ctx.restore();
    return;
  }
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
