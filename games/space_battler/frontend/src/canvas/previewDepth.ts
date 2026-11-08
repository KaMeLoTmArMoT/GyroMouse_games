import { rotatePoint } from "../engine/math2d";
import type { ShipState } from "../types/combat";
import { engineNozzles } from "./effects";
import { isLightHull, traceLightHull } from "./lightHullDepth";

/** Convert a vertical height to deck coordinates before the caller's Y projection. */
export function previewDepthFactor(elevation: number): number {
  return Math.cos(elevation) / Math.sin(elevation);
}

function traceCapitalKeel(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  ctx.beginPath();
  if (ship.team !== 0 && ship.hullClass === "cruiser") {
    ctx.moveTo(s * 1.22, -s * 0.2411);
    ctx.lineTo(s * 0.9, 0);
    ctx.lineTo(s * 1.22, s * 0.2411);
    ctx.quadraticCurveTo(s * 0.35, s * 0.5479, -s * 0.85, s * 0.3945);
    ctx.quadraticCurveTo(-s * 1.1, 0, -s * 0.85, -s * 0.3945);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.5479, s * 1.22, -s * 0.2411);
  } else if (ship.team !== 0 && ship.hullClass === "battleship") {
    ctx.moveTo(s * 1.28, 0);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.892, -s * 1.15, -s * 0.6559);
    ctx.quadraticCurveTo(-s * 0.4, 0, -s * 1.15, s * 0.6559);
    ctx.quadraticCurveTo(s * 0.5, s * 0.892, s * 1.28, 0);
  } else if (ship.team !== 0 && ship.hullClass === "dreadnought") {
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
  } else if (ship.team !== 0 && (ship.hullClass === "carrier" || ship.hullClass === "tender")) {
    const carrier = ship.hullClass === "carrier";
    ctx.moveTo(s * (carrier ? 1.25 : 0.92), 0);
    ctx.bezierCurveTo(
      s * 0.9,
      -s * 0.18,
      s * 0.45,
      -s * (carrier ? 0.7 : 0.68),
      -s * (carrier ? 0.2 : 0.58),
      -s * (carrier ? 0.67 : 0.52),
    );
    ctx.bezierCurveTo(-s * 1.18, -s * 0.57, -s * 0.78, -s * 0.18, -s * (carrier ? 0.78 : 0.8), 0);
    ctx.bezierCurveTo(
      -s * 0.78,
      s * 0.18,
      -s * 1.18,
      s * 0.57,
      -s * (carrier ? 0.2 : 0.58),
      s * (carrier ? 0.67 : 0.52),
    );
    ctx.bezierCurveTo(
      s * 0.45,
      s * (carrier ? 0.7 : 0.68),
      s * 0.9,
      s * 0.18,
      s * (carrier ? 1.25 : 0.92),
      0,
    );
  } else {
    const outlines: Record<string, number[][]> = {
      cruiser: [
        [1.22, 0],
        [0.6, -0.38],
        [0.2, -0.38],
        [-0.65, -0.5],
        [-1.1, -0.28],
      ],
      battleship: [
        [1.28, 0],
        [0.8, -0.38],
        [0.25, -0.58],
        [-0.85, -0.62],
        [-1.2, -0.35],
      ],
      dreadnought: [
        [1.25, 0],
        [0.85, -0.4],
        [0.3, -0.48],
        [0.14, -0.67],
        [-0.58, -0.67],
        [-0.78, -0.52],
        [-1.12, -0.42],
      ],
      carrier: [
        [1.25, 0],
        [0.75, -0.35],
        [0.35, -0.42],
        [0.12, -0.68],
        [-0.82, -0.68],
        [-1.08, -0.48],
      ],
      tender: [
        [1.04, 0],
        [0.58, -0.4],
        [0.25, -0.5],
        [0.08, -0.82],
        [-0.55, -0.82],
        [-0.66, -0.48],
        [-0.82, -0.34],
      ],
    };
    const outline = outlines[ship.hullClass] ?? outlines.cruiser;
    ctx.moveTo(s * outline[0][0], 0);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(s * x, s * y);
    for (const [x, y] of outline.slice(1).reverse()) ctx.lineTo(s * x, -s * y);
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
  ctx.save();
  for (let i = 24; i >= 0; i--) {
    const fraction = i / 24;
    // The widest belt is one third of the way down from the dorsal deck.
    const scale = fraction <= 1 / 3 ? 1 + fraction * 0.09 : 1.03 - (fraction - 1 / 3) * 0.285;
    ctx.save();
    ctx.translate(dx * fraction, dy * fraction);
    ctx.scale(scale, scale);
    ctx.fillStyle =
      fraction > 1 / 3 ? (alien ? "#350d17" : "#102333") : alien ? "#702b39" : "#315266";
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
    for (const [x, y] of engineNozzles(ship)) {
      const port = (halfWidth: number, top: number, bottom: number) => {
        ctx.beginPath();
        ctx.moveTo(s * x + dx * top, s * (y - halfWidth) + dy * top);
        ctx.lineTo(s * x + dx * top, s * (y + halfWidth) + dy * top);
        ctx.lineTo(s * x + dx * bottom, s * (y + halfWidth) + dy * bottom);
        ctx.lineTo(s * x + dx * bottom, s * (y - halfWidth) + dy * bottom);
        ctx.closePath();
      };
      ctx.fillStyle = alien ? "#260913" : "#061824";
      ctx.strokeStyle = alien ? "#9f4856" : "#548398";
      ctx.lineWidth = Math.max(0.5, s * 0.015);
      port(0.065, 0.22, 0.85);
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
  const capital = !isLightHull(ship);
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
  if (capital) {
    // A broad lower terrace supports the narrower bridge tower.
    for (let i = 0; i <= 8; i++) {
      ctx.save();
      ctx.translate((ux * i) / 16, (uy * i) / 16);
      ctx.fillStyle = i === 8 ? (alien ? "#793544" : "#385b6d") : alien ? "#3c121c" : "#142c3a";
      ctx.beginPath();
      ctx.ellipse(
        -s * 0.3,
        0,
        s * (ship.hullClass === "carrier" ? 0.32 : 0.28),
        s * (ship.hullClass === "tender" ? 0.23 : 0.18),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
  }
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
  ctx.restore();
}

export function drawPreviewEmitter(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  const [ex, ey] = rotatePoint([0, -s * 0.1 * depth], -ship.heading);
  for (let i = 0; i <= 8; i++) {
    ctx.save();
    ctx.translate((ex * i) / 8, (ey * i) / 8);
    ctx.fillStyle = i === 8 ? (alien ? "#fb7185" : "#67e8f9") : alien ? "#732b3d" : "#20556a";
    ctx.beginPath();
    ctx.ellipse(s * 0.57, 0, s * 0.1, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
