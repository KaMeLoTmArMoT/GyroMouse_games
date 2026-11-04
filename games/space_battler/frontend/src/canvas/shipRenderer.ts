// Procedural vector renderer for 2.5D ship hulls, Terran (sharp/industrial) vs Alien (curved/sleek), thruster flames, bridges, and turrets

import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";

export function renderShip(ctx: CanvasRenderingContext2D, ship: ShipState, selected = false): void {
  if (!ship.isAlive) return;

  const [x, y] = ship.pos;
  const isBlue = ship.team === 0; // Blue = Terran (Battlestar style), Red = Alien/Cylon (sleek curves)
  const primaryColor = isBlue ? "#38bdf8" : "#f87171"; // Sky-400 vs Red-400
  const hullDarkColor = isBlue ? "#0f172a" : "#450a0a"; // Deep slate vs Deep blood red
  const accentColor = isBlue ? "#0284c7" : "#dc2626";

  ctx.save();
  ctx.translate(x, y);

  // 1. Selection & Range / Fire Arc Overlay (When selected)
  if (selected) {
    const selRadius = Math.max(ship.size * 1.6, 32);
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, selRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Turret Firing Cones
    for (const turret of ship.turrets) {
      drawTurretArcCone(ctx, ship, turret, primaryColor);
    }
  }

  // 2. Render Hull (rotated by ship heading)
  ctx.save();
  ctx.rotate(ship.heading);

  if (isBlue) {
    drawTerranHull(ctx, ship, primaryColor, hullDarkColor, accentColor);
  } else {
    drawAlienHull(ctx, ship, primaryColor, hullDarkColor, accentColor);
  }

  ctx.restore();

  // 3. Render Independent Turrets
  for (const turret of ship.turrets) {
    renderTurret(ctx, ship, turret, primaryColor);
  }

  // 4. Render Shield Bubble (generous 1.5x envelope, prevents capital prow clipping)
  if (ship.shieldCurrent > 0) {
    const shieldRatio = ship.shieldCurrent / ship.shieldMax;
    const shieldBubbleRadius = ship.size * 1.5;

    ctx.strokeStyle = `rgba(56, 189, 248, ${0.18 + shieldRatio * 0.42})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(0, 0, shieldBubbleRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(56, 189, 248, ${0.03 + shieldRatio * 0.05})`;
    ctx.fill();
  }

  // 5. Compact Status HUD Bar
  renderHealthHUD(ctx, ship);

  ctx.restore();
}

function drawTerranHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
): void {
  const s = ship.size * 1.25; // 25% larger vessels!

  ctx.fillStyle = hullDarkColor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  switch (ship.hullClass) {
    case "strike_craft":
      // Terran Viper / Dart: faceted wedge with twin tail thrusters
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.7, -s * 0.55);
      ctx.lineTo(-s * 0.5, -s * 0.2);
      ctx.lineTo(-s * 0.85, 0);
      ctx.lineTo(-s * 0.5, s * 0.2);
      ctx.lineTo(-s * 0.7, s * 0.55);
      ctx.closePath();
      break;

    case "corvette":
      // Terran Aegis: angular escort with armored side sponsons
      ctx.moveTo(s * 1.15, 0);
      ctx.lineTo(s * 0.4, -s * 0.45);
      ctx.lineTo(-s * 0.5, -s * 0.65);
      ctx.lineTo(-s, -s * 0.35);
      ctx.lineTo(-s * 0.8, 0);
      ctx.lineTo(-s, s * 0.35);
      ctx.lineTo(-s * 0.5, s * 0.65);
      ctx.lineTo(s * 0.4, s * 0.45);
      ctx.closePath();
      break;

    case "cruiser":
      // Terran Cruiser: heavy armored prow, long spinal trench, flanking engine pods
      ctx.moveTo(s * 1.35, 0);
      ctx.lineTo(s * 0.7, -s * 0.4);
      ctx.lineTo(s * 0.2, -s * 0.4);
      ctx.lineTo(-s * 0.7, -s * 0.55);
      ctx.lineTo(-s * 1.1, -s * 0.3);
      ctx.lineTo(-s * 1.1, s * 0.3);
      ctx.lineTo(-s * 0.7, s * 0.55);
      ctx.lineTo(s * 0.2, s * 0.4);
      ctx.lineTo(s * 0.7, s * 0.4);
      ctx.closePath();
      break;

    default:
      // Terran Battleship: massive segmented dreadnought with conning tower bridge and prow hangar
      ctx.moveTo(s * 1.45, 0);
      ctx.lineTo(s * 0.9, -s * 0.4);
      ctx.lineTo(s * 0.3, -s * 0.62);
      ctx.lineTo(-s * 0.9, -s * 0.68);
      ctx.lineTo(-s * 1.3, -s * 0.4);
      ctx.lineTo(-s * 1.3, s * 0.4);
      ctx.lineTo(-s * 0.9, s * 0.68);
      ctx.lineTo(s * 0.3, s * 0.62);
      ctx.lineTo(s * 0.9, s * 0.4);
      ctx.closePath();
      break;
  }

  ctx.fill();
  ctx.stroke();

  // Terran Structural Details: command bridge, armored plating seams, blue engine glows
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  // Bridge Conning Tower
  ctx.strokeRect(-s * 0.35, -s * 0.15, s * 0.35, s * 0.3);
  // Armor Seam Centerline
  ctx.moveTo(s * 0.6, 0);
  ctx.lineTo(-s * 0.7, 0);
  ctx.stroke();

  // Engine exhaust glowing nozzles
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(-s * 1.05, -s * 0.2, s * 0.15, s * 0.1);
  ctx.fillRect(-s * 1.05, s * 0.1, s * 0.15, s * 0.1);
}

function drawAlienHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
): void {
  const s = ship.size * 1.25;

  ctx.fillStyle = hullDarkColor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  switch (ship.hullClass) {
    case "strike_craft":
      // Cylon Raider / Bio-Crescent: curved swept-forward wings
      ctx.moveTo(s * 0.9, -s * 0.6);
      ctx.quadraticCurveTo(s * 0.2, -s * 0.1, -s * 0.7, -s * 0.3);
      ctx.lineTo(-s * 0.4, 0);
      ctx.lineTo(-s * 0.7, s * 0.3);
      ctx.quadraticCurveTo(s * 0.2, s * 0.1, s * 0.9, s * 0.6);
      ctx.quadraticCurveTo(s * 0.6, 0, s * 0.9, -s * 0.6);
      ctx.closePath();
      break;

    case "corvette":
      // Alien Sentinel: predatory stingray / manta silhouette
      ctx.moveTo(s * 1.2, 0);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.7, -s * 0.8, -s * 0.5);
      ctx.quadraticCurveTo(-s * 0.5, 0, -s * 0.8, s * 0.5);
      ctx.quadraticCurveTo(s * 0.3, s * 0.7, s * 1.2, 0);
      ctx.closePath();
      break;

    case "cruiser":
      // Alien Warship: serpentine curved war-hull with biomorphic mandible prow
      ctx.moveTo(s * 1.4, -s * 0.25);
      ctx.lineTo(s * 1.0, 0);
      ctx.lineTo(s * 1.4, s * 0.25);
      ctx.quadraticCurveTo(s * 0.4, s * 0.55, -s * 0.9, s * 0.4);
      ctx.quadraticCurveTo(-s * 1.2, 0, -s * 0.9, -s * 0.4);
      ctx.quadraticCurveTo(s * 0.4, -s * 0.55, s * 1.4, -s * 0.25);
      ctx.closePath();
      break;

    default:
      // Alien Dreadnought: massive curved crescent basestar with central energy eye
      ctx.moveTo(s * 1.5, 0);
      ctx.quadraticCurveTo(s * 0.6, -s * 0.75, -s * 1.2, -s * 0.55);
      ctx.quadraticCurveTo(-s * 0.4, 0, -s * 1.2, s * 0.55);
      ctx.quadraticCurveTo(s * 0.6, s * 0.75, s * 1.5, 0);
      ctx.closePath();
      break;
  }

  ctx.fill();
  ctx.stroke();

  // Alien Bio-Mechanical Details: pulsing central red eye / plasma core
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(s * 0.1, 0, s * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(s * 0.1, 0, s * 0.22, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
}

function drawTurretArcCone(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  _color: string,
): void {
  const [tx, ty] = rotatePoint(turret.offset, ship.heading);
  const [minArc, maxArc] = turret.baseArc;
  const range = Math.min(turret.weapon.range, 350);

  ctx.save();
  ctx.translate(tx, ty);

  const startAngle = ship.heading + minArc;
  const endAngle = ship.heading + maxArc;

  ctx.fillStyle = turret.isSpinalGimbal ? "rgba(234, 179, 8, 0.08)" : "rgba(56, 189, 248, 0.05)";
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

  const baseRadius = (turret.baseRadius ?? 4) * 1.25;
  const barrelLen = (turret.barrelLength ?? 10) * 1.25;
  const barrelWidth = turret.isSpinalGimbal
    ? 4.0
    : turret.weapon.weaponType === "point_defense"
      ? 1.6
      : 2.6;

  ctx.fillStyle = turret.isSpinalGimbal ? "#020617" : "#1e293b";
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = barrelWidth;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(barrelLen, 0);
  ctx.stroke();

  ctx.restore();
}

function renderHealthHUD(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const barWidth = Math.max(ship.size * 1.8, 28);
  const barHeight = 2.5;
  const startX = -barWidth / 2;
  const startY = ship.size * 1.55 + 5;

  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(startX, startY, barWidth, barHeight * 3 + 2);

  // 1. Shield Bar
  const shieldPct = Math.max(0, ship.shieldCurrent / ship.shieldMax);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(startX, startY, barWidth * shieldPct, barHeight);

  // 2. Armor Bar
  const armorPct = Math.max(0, ship.armorCurrent / ship.armorMax);
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(startX, startY + barHeight + 1, barWidth * armorPct, barHeight);

  // 3. Hull Bar
  const hullPct = Math.max(0, ship.hullCurrent / ship.hullMax);
  ctx.fillStyle = "#10b981";
  ctx.fillRect(startX, startY + (barHeight + 1) * 2, barWidth * hullPct, barHeight);
}
