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
  ctx.moveTo(s * 1.05, 0);
  if (ship.team !== 0) {
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
  ctx.restore();
}
