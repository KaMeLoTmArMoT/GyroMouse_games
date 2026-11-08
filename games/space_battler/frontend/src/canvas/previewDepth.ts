import { rotatePoint } from "../engine/math2d";
import type { ShipState } from "../types/combat";
import { engineNozzles } from "./effects";

/** Convert a vertical height to deck coordinates before the caller's Y projection. */
export function previewDepthFactor(elevation: number): number {
  return Math.cos(elevation) / Math.sin(elevation);
}

/** Sweep a compact capital-ship belt beneath the detailed deck. */
export function drawPreviewCapitalKeel(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  const s = ship.size;
  const [dx, dy] = rotatePoint([0, s * 0.3 * depth], -ship.heading);
  if (Math.hypot(dx, dy) < 1e-10) return;
  const alien = ship.team !== 0;
  ctx.save();
  for (let i = 24; i >= 0; i--) {
    const fraction = i / 24;
    ctx.save();
    ctx.translate(dx * fraction, dy * fraction);
    ctx.scale(1 - fraction * 0.12, 1 - fraction * 0.12);
    ctx.fillStyle = i > 12 ? (alien ? "#350d17" : "#102333") : alien ? "#702b39" : "#315266";
    ctx.beginPath();
    ctx.moveTo(s * 1.05, 0);
    if (alien) {
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
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Raised deck, bridge, and engine pods share the same world-vertical axis. */
export function drawPreviewSuperstructure(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  depth: number,
): void {
  if (Math.abs(depth) < 1e-10) return;
  const s = ship.size;
  const alien = ship.team !== 0;
  const [ux, uy] = rotatePoint([0, -depth], -ship.heading);
  const layer = (height: number, draw: () => void) => {
    for (let i = 0; i <= 12; i++) {
      ctx.save();
      ctx.translate((ux * height * i) / 12, (uy * height * i) / 12);
      ctx.fillStyle = i === 12 ? (alien ? "#a54e5b" : "#66899b") : alien ? "#5d202c" : "#294858";
      draw();
      ctx.fill();
      ctx.restore();
    }
  };
  ctx.save();
  layer(s * 0.13, () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.7, 0);
    if (alien) {
      ctx.bezierCurveTo(s * 0.25, -s * 0.2, -s * 0.35, -s * 0.2, -s * 0.5, 0);
      ctx.bezierCurveTo(-s * 0.35, s * 0.2, s * 0.25, s * 0.2, s * 0.7, 0);
    } else {
      ctx.lineTo(s * 0.35, -s * 0.16);
      ctx.lineTo(-s * 0.4, -s * 0.16);
      ctx.lineTo(-s * 0.55, 0);
      ctx.lineTo(-s * 0.4, s * 0.16);
      ctx.lineTo(s * 0.35, s * 0.16);
    }
    ctx.closePath();
  });
  layer(s * 0.24, () => {
    ctx.beginPath();
    if (alien) ctx.ellipse(-s * 0.28, 0, s * 0.2, s * 0.12, 0, 0, Math.PI * 2);
    else ctx.rect(-s * 0.46, -s * 0.1, s * 0.32, s * 0.2);
  });
  for (const [x, y] of engineNozzles(ship)) {
    layer(s * 0.12, () => {
      ctx.beginPath();
      ctx.ellipse(s * x, s * y, s * 0.12, s * 0.07, 0, 0, Math.PI * 2);
    });
  }
  ctx.restore();
}
