// Procedural vector renderer for 2.5D ship hulls, directional arcs, turrets, and tactical HUD

import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";

export function renderShip(ctx: CanvasRenderingContext2D, ship: ShipState, selected = false): void {
  if (!ship.isAlive) return;

  const [x, y] = ship.pos;
  const isBlue = ship.team === 0;
  const primaryColor = isBlue ? "#38bdf8" : "#f87171"; // Sky-400 vs Red-400
  const hullDarkColor = isBlue ? "#0c4a6e" : "#7f1d1d";
  const accentColor = isBlue ? "#0284c7" : "#dc2626";

  ctx.save();
  ctx.translate(x, y);

  // 1. Selection & Range / Fire Arc Overlay (When selected)
  if (selected) {
    // Selection pulse ring
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, ship.size * 1.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Turret Firing Cones (visualize true weapon dead zones!)
    for (const turret of ship.turrets) {
      drawTurretArcCone(ctx, ship, turret, primaryColor);
    }
  }

  // 2. Render Hull (rotated by ship heading)
  ctx.save();
  ctx.rotate(ship.heading);

  drawHullSilhouette(ctx, ship, primaryColor, hullDarkColor, accentColor);

  ctx.restore();

  // 3. Render Independent Turrets
  for (const turret of ship.turrets) {
    renderTurret(ctx, ship, turret, primaryColor);
  }

  // 4. Render Shield Arc / Bubble
  if (ship.shieldCurrent > 0) {
    const shieldRatio = ship.shieldCurrent / ship.shieldMax;
    ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + shieldRatio * 0.4})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, ship.size * 1.18, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 5. Compact Status HUD Bar
  renderHealthHUD(ctx, ship);

  ctx.restore();
}

function drawTurretArcCone(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  _color: string,
): void {
  const [tx, ty] = rotatePoint(turret.offset, ship.heading);
  const [minArc, maxArc] = turret.baseArc;
  const range = Math.min(turret.weapon.range, 350); // visual cone radius

  ctx.save();
  ctx.translate(tx, ty);

  // Draw Sector of Fire
  const startAngle = ship.heading + minArc;
  const endAngle = ship.heading + maxArc;

  ctx.fillStyle = turret.isSpinalGimbal
    ? "rgba(234, 179, 8, 0.08)" // Yellow narrow cone
    : "rgba(56, 189, 248, 0.05)";
  ctx.strokeStyle = turret.isSpinalGimbal ? "rgba(234, 179, 8, 0.35)" : "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, range, startAngle, endAngle);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawHullSilhouette(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
): void {
  const s = ship.size;

  ctx.fillStyle = hullDarkColor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  switch (ship.hullClass) {
    case "strike_craft":
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.8, -s * 0.6);
      ctx.lineTo(-s * 0.4, 0);
      ctx.lineTo(-s * 0.8, s * 0.6);
      ctx.closePath();
      break;

    case "corvette":
      ctx.moveTo(s * 1.1, 0);
      ctx.lineTo(-s * 0.3, -s * 0.7);
      ctx.lineTo(-s, -s * 0.5);
      ctx.lineTo(-s * 0.7, 0);
      ctx.lineTo(-s, s * 0.5);
      ctx.lineTo(-s * 0.3, s * 0.7);
      ctx.closePath();
      break;

    case "cruiser":
      ctx.moveTo(s * 1.3, 0);
      ctx.lineTo(s * 0.6, -s * 0.45);
      ctx.lineTo(-s * 0.8, -s * 0.5);
      ctx.lineTo(-s * 1.1, -s * 0.25);
      ctx.lineTo(-s * 1.1, s * 0.25);
      ctx.lineTo(-s * 0.8, s * 0.5);
      ctx.lineTo(s * 0.6, s * 0.45);
      ctx.closePath();
      break;

    default:
      ctx.moveTo(s * 1.4, 0);
      ctx.lineTo(s * 0.8, -s * 0.4);
      ctx.lineTo(s * 0.2, -s * 0.6);
      ctx.lineTo(-s * 1.1, -s * 0.65);
      ctx.lineTo(-s * 1.3, -s * 0.3);
      ctx.lineTo(-s * 1.3, s * 0.3);
      ctx.lineTo(-s * 1.1, s * 0.65);
      ctx.lineTo(s * 0.2, s * 0.6);
      ctx.lineTo(s * 0.8, s * 0.4);
      ctx.closePath();
      break;
  }

  ctx.fill();
  ctx.stroke();

  // Internal structural line detail
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.6, 0);
  ctx.stroke();
}

function renderTurret(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
): void {
  const [tx, ty] = rotatePoint(turret.offset, ship.heading);
  const turretWorldAngle = ship.heading + turret.currentLocalAngle;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(turretWorldAngle);

  const baseRadius = turret.baseRadius ?? (turret.isSpinalGimbal ? 6 : 4);
  const barrelLen = turret.barrelLength ?? (turret.weapon.weaponType === "railgun" ? 18 : 10);
  const barrelWidth = turret.isSpinalGimbal
    ? 3.5
    : turret.weapon.weaponType === "point_defense"
      ? 1.4
      : 2.4;

  // Turret Barbette
  ctx.fillStyle = turret.isSpinalGimbal ? "#0f172a" : "#1e293b";
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Barrel
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = barrelWidth;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(barrelLen, 0);
  ctx.stroke();

  ctx.restore();
}

function renderHealthHUD(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const barWidth = ship.size * 1.5;
  const barHeight = 2.5;
  const startX = -barWidth / 2;
  const startY = ship.size + 8;

  // Background track
  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(startX, startY, barWidth, barHeight * 3 + 2);

  // 1. Shield Bar (Cyan)
  const shieldPct = Math.max(0, ship.shieldCurrent / ship.shieldMax);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(startX, startY, barWidth * shieldPct, barHeight);

  // 2. Armor Bar (Amber)
  const armorPct = Math.max(0, ship.armorCurrent / ship.armorMax);
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(startX, startY + barHeight + 1, barWidth * armorPct, barHeight);

  // 3. Hull Bar (Emerald)
  const hullPct = Math.max(0, ship.hullCurrent / ship.hullMax);
  ctx.fillStyle = "#10b981";
  ctx.fillRect(startX, startY + (barHeight + 1) * 2, barWidth * hullPct, barHeight);
}
