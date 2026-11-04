// Procedural vector renderer for 2.5D ship hulls, directional shields, and calibrated turrets

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

  // Selection / Target Ring
  if (selected) {
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, ship.size * 1.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 1. Render Hull (rotated by ship heading)
  ctx.save();
  ctx.rotate(ship.heading);

  drawHullSilhouette(ctx, ship, primaryColor, hullDarkColor, accentColor);

  ctx.restore();

  // 2. Render Independent Turrets (proportional calibers & barrels)
  for (const turret of ship.turrets) {
    renderTurret(ctx, ship, turret, primaryColor);
  }

  // 3. Render Shield Arc / Bubble
  if (ship.shieldCurrent > 0) {
    const shieldRatio = ship.shieldCurrent / ship.shieldMax;
    ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + shieldRatio * 0.4})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, ship.size * 1.18, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 4. Compact Status HUD Bar
  renderHealthHUD(ctx, ship);

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
      // Fast dart fighter
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.8, -s * 0.6);
      ctx.lineTo(-s * 0.4, 0);
      ctx.lineTo(-s * 0.8, s * 0.6);
      ctx.closePath();
      break;

    case "corvette":
      // Sleek triangular escort
      ctx.moveTo(s * 1.1, 0);
      ctx.lineTo(-s * 0.3, -s * 0.7);
      ctx.lineTo(-s, -s * 0.5);
      ctx.lineTo(-s * 0.7, 0);
      ctx.lineTo(-s, s * 0.5);
      ctx.lineTo(-s * 0.3, s * 0.7);
      ctx.closePath();
      break;

    case "cruiser":
      // Elongated warship with bridge spine
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
      // Heavy battleship wedge with armored prow
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
  // World turret position relative to ship center
  const [tx, ty] = rotatePoint(turret.offset, ship.heading);
  const turretWorldAngle = ship.heading + turret.currentLocalAngle;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(turretWorldAngle);

  // Proportional calibers: heavy railguns get massive barbettes, PD gets tiny mounts
  const baseRadius = turret.baseRadius ?? (turret.isSpinalGimbal ? 6 : 4);
  const barrelLen = turret.barrelLength ?? (turret.weapon.weaponType === "railgun" ? 18 : 10);
  const barrelWidth = turret.isSpinalGimbal
    ? 3.5
    : turret.weapon.weaponType === "point_defense"
      ? 1.4
      : 2.4;

  // Turret Mount Base (circle / barbette)
  ctx.fillStyle = turret.isSpinalGimbal ? "#0f172a" : "#1e293b";
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cannon Barrel
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
