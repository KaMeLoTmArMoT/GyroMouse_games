// Procedural vector renderer for 2.5D ship hulls, Terran (sharp/industrial) vs Alien (curved/sleek), thruster flames, bridges, and turrets

import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";
import { damageState, engineNozzles, engineSpeed } from "./effects";

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

  drawEngineGlow(ctx, ship);

  if (isBlue) {
    drawTerranHull(ctx, ship, primaryColor, hullDarkColor, accentColor);
  } else {
    drawAlienHull(ctx, ship, primaryColor, hullDarkColor, accentColor);
  }

  drawHullDamage(ctx, ship);

  ctx.restore();

  // 3. Render Independent Turrets
  for (const turret of ship.turrets) {
    renderTurret(ctx, ship, turret, primaryColor);
  }

  // 4. Render Shield Bubble (calibrated 1.40x envelope, completely encloses prow and stern)
  if (ship.shieldCurrent > 0) {
    const shieldRatio = ship.shieldCurrent / ship.shieldMax;
    const shieldBubbleRadius = ship.size * 1.4;

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

function drawHullDamage(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const { scarred, burning, critical } = damageState(ship);
  if (!scarred && !burning && !critical) return;
  const s = ship.size;
  const time = performance.now();
  ctx.save();

  if (scarred || burning) {
    ctx.strokeStyle = "#030508";
    ctx.lineWidth = Math.max(1.2, s * 0.045);
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(s * 0.12, side * s * 0.12);
      ctx.lineTo(s * 0.25, side * s * 0.19);
      ctx.lineTo(s * 0.21, side * s * 0.25);
      ctx.lineTo(s * 0.36, side * s * 0.3);
    }
    ctx.stroke();
  }

  if (burning) {
    const flicker = 0.75 + 0.25 * Math.sin(time / 85 + ship.pos[0]);
    ctx.globalAlpha = flicker;
    ctx.shadowColor = "#f97316";
    ctx.shadowBlur = Math.max(3, s * 0.18);
    for (const side of [-1, 1]) {
      ctx.fillStyle = "#ef4420";
      ctx.beginPath();
      ctx.moveTo(s * 0.18, side * s * 0.18);
      ctx.lineTo(s * 0.25, side * s * (0.34 + flicker * 0.08));
      ctx.lineTo(s * 0.32, side * s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(s * 0.25, side * s * 0.21, Math.max(1, s * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (critical) {
    const coreX =
      ship.team === 0
        ? { strike_craft: 0.53, corvette: 0.5, cruiser: -0.53, battleship: -0.36 }[ship.hullClass]
        : { strike_craft: 0.57, corvette: 0.3, cruiser: 0.25, battleship: -0.16 }[ship.hullClass];
    ctx.globalAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time / 100));
    ctx.shadowColor = "#ff2020";
    ctx.shadowBlur = Math.max(5, s * 0.3);
    ctx.fillStyle = "#ff3030";
    ctx.beginPath();
    ctx.ellipse(s * coreX, 0, Math.max(2, s * 0.07), Math.max(2, s * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEngineGlow(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const speed = engineSpeed(ship);
  const flicker = 0.85 + 0.15 * Math.sin(performance.now() / 75 + ship.pos[0]);
  const radius = ship.size * (0.18 + speed * 0.2) * flicker;
  if (radius <= 0) return;
  ctx.save();
  ctx.globalAlpha *= (0.3 + speed * 0.7) * flicker;
  for (const [x, y] of engineNozzles(ship)) {
    const gx = ship.size * x - radius * 0.35;
    const gy = ship.size * y;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
    glow.addColorStop(0, ship.team === 0 ? "#38bdf8" : "#f97316");
    glow.addColorStop(0.4, ship.team === 0 ? "#0284c7" : "#dc2626");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTerranHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
): void {
  // Calibrated scale: 100% fits strictly within the 1.40x shield bubble (<= 5% area delta vs Alien)
  const s = ship.size;

  ctx.fillStyle = hullDarkColor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  switch (ship.hullClass) {
    case "strike_craft":
      // Terran Viper / Dart: faceted wedge with twin tail thrusters
      ctx.moveTo(s * 1.1, 0);
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
      ctx.lineTo(-s * 0.5, -s * 0.58);
      ctx.lineTo(-s * 0.95, -s * 0.32);
      ctx.lineTo(-s * 0.75, 0);
      ctx.lineTo(-s * 0.95, s * 0.32);
      ctx.lineTo(-s * 0.5, s * 0.58);
      ctx.lineTo(s * 0.4, s * 0.45);
      ctx.closePath();
      break;

    case "cruiser":
      // Terran Cruiser: heavy armored prow, long spinal trench, flanking engine pods
      ctx.moveTo(s * 1.22, 0);
      ctx.lineTo(s * 0.6, -s * 0.38);
      ctx.lineTo(s * 0.2, -s * 0.38);
      ctx.lineTo(-s * 0.65, -s * 0.5);
      ctx.lineTo(-s * 1.1, -s * 0.28);
      ctx.lineTo(-s * 1.1, s * 0.28);
      ctx.lineTo(-s * 0.65, s * 0.5);
      ctx.lineTo(s * 0.2, s * 0.38);
      ctx.lineTo(s * 0.6, s * 0.38);
      ctx.closePath();
      break;

    default:
      // Terran Battleship: massive segmented dreadnought with conning tower bridge and prow hangar
      ctx.moveTo(s * 1.28, 0);
      ctx.lineTo(s * 0.8, -s * 0.38);
      ctx.lineTo(s * 0.25, -s * 0.58);
      ctx.lineTo(-s * 0.85, -s * 0.62);
      ctx.lineTo(-s * 1.2, -s * 0.35);
      ctx.lineTo(-s * 1.2, s * 0.35);
      ctx.lineTo(-s * 0.85, s * 0.62);
      ctx.lineTo(s * 0.25, s * 0.58);
      ctx.lineTo(s * 0.8, s * 0.38);
      ctx.closePath();
      break;
  }

  ctx.fill();
  ctx.stroke();

  if (ship.hullClass === "cruiser") {
    ctx.save();
    ctx.clip();
    drawTerranCruiserDetails(ctx, ship, accentColor);
    ctx.restore();
    return;
  }

  if (ship.hullClass === "corvette") {
    ctx.save();
    ctx.clip();
    drawTerranCorvetteDetails(ctx, ship, accentColor);
    ctx.restore();
    return;
  }

  if (ship.hullClass === "strike_craft") {
    drawTerranStrikeDetails(ctx, ship, accentColor);
    return;
  }

  if (ship.hullClass === "battleship") {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#0c4a6e";
    ctx.fillRect(-s * 1.18, -s * 0.35, s * 0.32, s * 0.32);
    ctx.fillRect(-s * 1.18, s * 0.03, s * 0.32, s * 0.32);
    drawTerranBattleshipDetails(ctx, ship, accentColor);
    ctx.restore();
  }
}

function drawAlienHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
): void {
  // Lateral coordinates calibrated against Terran filled areas by backend/tests/test_hull_geometry.py.
  // Endpoints and Bezier controls remain inside the 1.40x shield envelope.
  const s = ship.size;

  ctx.fillStyle = hullDarkColor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  switch (ship.hullClass) {
    case "strike_craft":
      // Cylon Raider / Bio-Crescent: curved swept-forward wings
      ctx.moveTo(s * 0.85, -s * 0.6884);
      ctx.quadraticCurveTo(s * 0.15, -s * 0.1252, -s * 0.65, -s * 0.3505);
      ctx.lineTo(-s * 0.35, 0);
      ctx.lineTo(-s * 0.65, s * 0.3505);
      ctx.quadraticCurveTo(s * 0.15, s * 0.1252, s * 0.85, s * 0.6884);
      ctx.quadraticCurveTo(s * 0.55, 0, s * 0.85, -s * 0.6884);
      ctx.closePath();
      break;

    case "corvette":
      // Alien Sentinel: predatory stingray / manta silhouette
      ctx.moveTo(s * 1.15, 0);
      ctx.quadraticCurveTo(s * 0.25, -s * 0.7916, -s * 0.75, -s * 0.548);
      ctx.quadraticCurveTo(-s * 0.45, 0, -s * 0.75, s * 0.548);
      ctx.quadraticCurveTo(s * 0.25, s * 0.7916, s * 1.15, 0);
      ctx.closePath();
      break;

    case "cruiser":
      // Alien Warship: serpentine curved war-hull with biomorphic mandible prow
      ctx.moveTo(s * 1.22, -s * 0.2411);
      ctx.lineTo(s * 0.9, 0);
      ctx.lineTo(s * 1.22, s * 0.2411);
      ctx.quadraticCurveTo(s * 0.35, s * 0.5479, -s * 0.85, s * 0.3945);
      ctx.quadraticCurveTo(-s * 1.1, 0, -s * 0.85, -s * 0.3945);
      ctx.quadraticCurveTo(s * 0.35, -s * 0.5479, s * 1.22, -s * 0.2411);
      ctx.closePath();
      break;

    default:
      // Alien Dreadnought: massive curved crescent basestar with central energy eye
      ctx.moveTo(s * 1.28, 0);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.892, -s * 1.15, -s * 0.6559);
      ctx.quadraticCurveTo(-s * 0.4, 0, -s * 1.15, s * 0.6559);
      ctx.quadraticCurveTo(s * 0.5, s * 0.892, s * 1.28, 0);
      ctx.closePath();
      break;
  }

  ctx.fill();
  ctx.stroke();

  if (ship.hullClass === "cruiser") {
    ctx.save();
    ctx.clip();
    drawAlienCruiserDetails(ctx, ship, accentColor);
    ctx.restore();
    return;
  }

  if (ship.hullClass === "corvette") {
    ctx.save();
    ctx.clip();
    drawAlienCorvetteDetails(ctx, ship, accentColor);
    ctx.restore();
    return;
  }

  if (ship.hullClass === "strike_craft") {
    drawAlienStrikeDetails(ctx, ship, accentColor);
    return;
  }

  if (ship.hullClass === "battleship") {
    ctx.save();
    ctx.clip();
    drawAlienBattleshipDetails(ctx, ship, accentColor);
    ctx.restore();
  }
}

function drawTerranBattleshipDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;

  // Open accelerator channel, with paired coils outside the railgun mount.
  ctx.fillStyle = "#020617";
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.fillRect(s * 0.04, -s * 0.1, s * 1.08, s * 0.2);
  ctx.strokeRect(s * 0.04, -s * 0.1, s * 1.08, s * 0.2);
  for (const side of [-1, 1]) {
    for (const x of [0.15, 0.36, 0.57, 0.78]) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s * x, side * s * 0.1);
      ctx.lineTo(s * (x + 0.05), side * s * 0.17);
      ctx.stroke();
      ctx.fillStyle = "#facc15";
      ctx.fillRect(s * (x + 0.025), side * s * 0.15 - s * 0.015, s * 0.05, s * 0.03);
    }
  }

  // Armored octagonal casemates follow the actual beam battery mounts.
  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "beam_laser") continue;
    const [x, y] = turret.offset;
    const r = (turret.baseRadius ?? 4) * 1.8;
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * (i + 0.5)) / 4;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const side = Math.sign(y) || 1;
    ctx.strokeStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(-s * 0.52, side * s * 0.12);
    ctx.lineTo(-s * 0.38, side * s * 0.22);
    ctx.lineTo(x - r, y);
    ctx.moveTo(x - r, y + side * r * 0.8);
    ctx.lineTo(x, y + side * r * 1.25);
    ctx.lineTo(x + r, y + side * r * 0.8);
    ctx.stroke();
  }

  // Fortress tiers, bridge windows, sensor masts and armored heat sinks.
  ctx.strokeStyle = accentColor;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-s * 0.7, -s * 0.22, s * 0.49, s * 0.44);
  ctx.strokeRect(-s * 0.7, -s * 0.22, s * 0.49, s * 0.44);
  ctx.fillStyle = "#334155";
  ctx.fillRect(-s * 0.62, -s * 0.15, s * 0.3, s * 0.3);
  ctx.strokeRect(-s * 0.62, -s * 0.15, s * 0.3, s * 0.3);
  ctx.fillStyle = "#bae6fd";
  for (const y of [-0.09, -0.03, 0.03, 0.09]) {
    ctx.fillRect(-s * 0.36, s * (y - 0.015), s * 0.025, s * 0.03);
  }
  ctx.strokeStyle = "#38bdf8";
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(-s * 0.57, side * s * 0.15);
    ctx.lineTo(-s * 0.57, side * s * 0.27);
    ctx.lineTo(-s * 0.53, side * s * 0.29);
    for (const x of [-0.76, -0.69, -0.62]) {
      ctx.moveTo(s * x, side * s * 0.32);
      ctx.lineTo(s * (x + 0.04), side * s * 0.42);
    }
  }
  ctx.stroke();

  // Four inset nozzles and side-facing maneuvering ports.
  for (const y of [-0.27, -0.09, 0.09, 0.27]) {
    ctx.fillStyle = "#164e63";
    ctx.fillRect(-s * 1.16, s * (y - 0.065), s * 0.27, s * 0.13);
    ctx.strokeStyle = accentColor;
    ctx.strokeRect(-s * 1.16, s * (y - 0.065), s * 0.27, s * 0.13);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(-s * 1.13, s * (y - 0.045), s * 0.15, s * 0.09);
    ctx.fillStyle = "#f0f9ff";
    ctx.fillRect(-s * 1.12, s * (y - 0.018), s * 0.09, s * 0.036);
  }
  ctx.fillStyle = "#bae6fd";
  for (const side of [-1, 1]) {
    ctx.fillRect(-s * 0.94, side * s * 0.45 - s * 0.025, s * 0.08, s * 0.05);
  }
}

function drawAlienBattleshipDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;

  // Wing lattice and vascular branches converging on the command eye.
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    for (const x of [-0.7, -0.42, -0.14, 0.14, 0.42]) {
      ctx.moveTo(s * (x + 0.18), side * s * 0.12);
      ctx.quadraticCurveTo(s * (x - 0.1), side * s * 0.32, s * x, side * s * 0.56);
    }
    ctx.moveTo(-s * 0.12, 0);
    ctx.quadraticCurveTo(-s * 0.28, side * s * 0.25, -s * 0.65, side * s * 0.43);
    ctx.moveTo(-s * 0.3, side * s * 0.25);
    ctx.quadraticCurveTo(0, side * s * 0.42, s * 0.35, side * s * 0.44);
  }
  ctx.stroke();

  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "beam_laser") continue;
    const [x, y] = turret.offset;
    ctx.fillStyle = "#7f1d1d";
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.19, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, 0);
    ctx.quadraticCurveTo(x - s * 0.2, y * 0.5, x, y);
    ctx.stroke();
  }

  // Singularity canal and curved accelerator arcs toward the focal lens.
  ctx.fillStyle = "#200606";
  ctx.fillRect(s * 0.08, -s * 0.085, s * 1.02, s * 0.17);
  for (const x of [0.25, 0.43, 0.61, 0.79]) {
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s * x, -s * 0.1);
    ctx.quadraticCurveTo(s * (x + 0.1), 0, s * x, s * 0.1);
    ctx.stroke();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.fillStyle = "#fb923c";
  ctx.beginPath();
  ctx.arc(s * 1.06, 0, s * 0.065, 0, Math.PI * 2);
  ctx.fill();

  // Segmented orbital rings surround a softly pulsing command eye.
  ctx.fillStyle = "#450a0a";
  ctx.beginPath();
  ctx.arc(-s * 0.16, 0, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fb923c";
  ctx.lineWidth = 1.3;
  for (const radius of [0.15, 0.21]) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-s * 0.16, 0, s * radius, i * Math.PI * 0.5 + 0.15, (i + 1) * Math.PI * 0.5 - 0.15);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-s * 0.16, 0, s * (0.075 + 0.01 * Math.sin(performance.now() / 400)), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(-s * 0.16, 0, s * 0.025, 0, Math.PI * 2);
  ctx.fill();

  // The concave stern places the outer vents farther aft than the inner pair.
  for (const y of [-0.42, -0.24, 0.24, 0.42]) {
    const x = Math.abs(y) > 0.3 ? -0.69 : -0.45;
    ctx.fillStyle = "#991b1b";
    ctx.beginPath();
    ctx.ellipse(s * x, s * y, s * 0.1, s * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.ellipse(s * x, s * y, s * 0.055, s * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerranCruiserDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;

  // Recessed loading trench and armored launch doors.
  ctx.fillStyle = "#020617";
  ctx.fillRect(s * 0.43, -s * 0.07, s * 0.53, s * 0.14);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(s * 0.43, -s * 0.07, s * 0.53, s * 0.14);
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#164e63";
    ctx.beginPath();
    ctx.moveTo(s * 0.46, side * s * 0.1);
    ctx.lineTo(s * 0.78, side * s * 0.1);
    ctx.lineTo(s * 0.68, side * s * 0.23);
    ctx.lineTo(s * 0.46, side * s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#f59e0b";
    ctx.beginPath();
    ctx.moveTo(s * 0.49, side * s * 0.15);
    ctx.lineTo(s * 0.54, side * s * 0.2);
    ctx.lineTo(s * 0.59, side * s * 0.15);
    ctx.stroke();
    ctx.strokeStyle = accentColor;
  }

  // Stepped terraces and transverse armor ribs.
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-s * 0.48, -s * 0.25, s * 0.85, s * 0.5);
  ctx.strokeRect(-s * 0.48, -s * 0.25, s * 0.85, s * 0.5);
  ctx.fillStyle = "#334155";
  ctx.fillRect(-s * 0.36, -s * 0.18, s * 0.65, s * 0.36);
  ctx.strokeRect(-s * 0.36, -s * 0.18, s * 0.65, s * 0.36);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    for (const x of [-0.48, -0.22, 0.04, 0.3]) {
      ctx.moveTo(s * x, side * s * 0.26);
      ctx.lineTo(s * (x - 0.08), side * s * 0.4);
    }
    // Radiator fins flank the propulsion block.
    for (const x of [-0.91, -0.82, -0.73]) {
      ctx.moveTo(s * x, side * s * 0.23);
      ctx.lineTo(s * (x + 0.06), side * s * 0.34);
    }
  }
  ctx.stroke();

  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "beam_laser") continue;
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(turret.offset[0], turret.offset[1], (turret.baseRadius ?? 4) * 1.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Aft bridge tiers and viewport.
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-s * 0.68, -s * 0.16, s * 0.22, s * 0.32);
  ctx.strokeRect(-s * 0.68, -s * 0.16, s * 0.22, s * 0.32);
  ctx.fillStyle = "#334155";
  ctx.fillRect(-s * 0.62, -s * 0.11, s * 0.12, s * 0.22);
  ctx.fillStyle = "#bae6fd";
  ctx.fillRect(-s * 0.53, -s * 0.08, s * 0.025, s * 0.16);

  for (const y of [-0.2, 0, 0.2]) {
    const radius = y === 0 ? 0.09 : 0.055;
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.ellipse(-s * 0.96, s * y, s * 0.1, s * radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bae6fd";
    ctx.beginPath();
    ctx.ellipse(-s * 0.98, s * y, s * 0.045, s * radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAlienCruiserDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;

  // Converging channels and paired skeletal ribs.
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(s * 0.25, side * s * 0.11);
    ctx.quadraticCurveTo(s * 0.65, side * s * 0.3, s * 1.08, side * s * 0.21);
    for (const x of [-0.58, -0.3, -0.02, 0.26]) {
      ctx.moveTo(s * x, side * s * 0.1);
      ctx.quadraticCurveTo(s * (x - 0.12), side * s * 0.23, s * (x - 0.08), side * s * 0.39);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = "#fb923c";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(s * 0.35, side * s * 0.08);
    ctx.quadraticCurveTo(s * 0.7, side * s * 0.21, s * 0.99, side * s * 0.18);
  }
  ctx.stroke();

  // Armored, luminous nexus follows the independently rendered beam mount.
  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "beam_laser") continue;
    ctx.fillStyle = "#7f1d1d";
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(turret.offset[0], turret.offset[1], (turret.baseRadius ?? 4) * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Three recessed plasma vents trace the trailing crescent.
  for (const y of [-0.24, 0, 0.24]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.81, s * (y - 0.07));
    ctx.quadraticCurveTo(-s * 0.9, s * y, -s * 0.81, s * (y + 0.07));
    ctx.strokeStyle = "#991b1b";
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function drawTerranCorvetteDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;
  const speed = Math.min(1, Math.hypot(...ship.velocity) / ship.maxSpeed);

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(s * 0.95, 0);
    ctx.lineTo(s * 0.45, side * s * 0.25);
    ctx.lineTo(s * 0.25, side * s * 0.4);
    ctx.moveTo(s * 0.45, side * s * 0.25);
    ctx.lineTo(s * 0.1, side * s * 0.24);
    ctx.lineTo(-s * 0.35, side * s * 0.44);
    ctx.lineTo(-s * 0.62, side * s * 0.4);
  }
  ctx.stroke();

  // The deck rings follow the independently rendered point-defense mounts.
  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "point_defense") continue;
    ctx.fillStyle = "#020617";
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(turret.offset[0], turret.offset[1], (turret.baseRadius ?? 4) * 1.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Aft crossbar and forward armored bridge slit.
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.53, -s * 0.18);
  ctx.lineTo(-s * 0.53, s * 0.18);
  ctx.moveTo(-s * 0.61, 0);
  ctx.lineTo(-s * 0.45, 0);
  ctx.stroke();
  ctx.fillStyle = "#bae6fd";
  ctx.fillRect(s * 0.39, -s * 0.055, s * 0.22, s * 0.11);

  for (const side of [-1, 1]) {
    const y = side * s * 0.32;
    ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
    ctx.beginPath();
    ctx.moveTo(-s * 0.68, y - s * 0.06);
    ctx.lineTo(-s * (0.7 + speed * 0.35), y);
    ctx.lineTo(-s * 0.68, y + s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.ellipse(-s * 0.61, y, s * 0.14, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bae6fd";
    ctx.beginPath();
    ctx.ellipse(-s * 0.65, y, s * 0.07, s * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAlienCorvetteDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(s * 0.88, 0);
    ctx.quadraticCurveTo(s * 0.35, side * s * 0.44, -s * 0.55, side * s * 0.42);
    ctx.moveTo(s * 0.55, side * s * 0.17);
    ctx.quadraticCurveTo(s * 0.1, side * s * 0.3, -s * 0.44, side * s * 0.3);
  }
  ctx.stroke();

  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const turret of ship.turrets) {
    if (turret.weapon.weaponType !== "point_defense") continue;
    ctx.moveTo(s * 0.3, 0);
    ctx.quadraticCurveTo(0, turret.offset[1] * 0.5, turret.offset[0], turret.offset[1]);
  }
  ctx.stroke();

  // Concentric containment and a three-lobed nucleus, forward of the PD deck.
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.8;
  for (const radius of [0.2, 0.15]) {
    ctx.beginPath();
    ctx.arc(s * 0.3, 0, s * radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#ef4444";
  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    ctx.beginPath();
    ctx.arc(
      s * (0.3 + Math.cos(angle) * 0.055),
      s * Math.sin(angle) * 0.055,
      s * 0.065,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  for (const side of [-1, 1]) {
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.56, side * s * 0.2);
    ctx.quadraticCurveTo(-s * 0.39, side * s * 0.3, -s * 0.59, side * s * 0.4);
    ctx.stroke();
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.arc(-s * 0.51, side * s * 0.3, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerranStrikeDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;
  const speed = Math.min(1, Math.hypot(...ship.velocity) / ship.maxSpeed);

  ctx.lineWidth = 0.7;
  ctx.strokeStyle = accentColor;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(s * 0.25, side * s * 0.1);
    ctx.lineTo(-s * 0.35, side * s * 0.3);
    ctx.lineTo(-s * 0.5, side * s * 0.4);
  }
  ctx.stroke();

  ctx.fillStyle = "#0ea5e9";
  ctx.beginPath();
  ctx.moveTo(s * 0.75, 0);
  ctx.lineTo(s * 0.52, -s * 0.09);
  ctx.lineTo(s * 0.4, 0);
  ctx.lineTo(s * 0.52, s * 0.09);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#e0f2fe";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(s * 0.46, -s * 0.02);
  ctx.lineTo(s * 0.56, -s * 0.05);
  ctx.lineTo(s * 0.68, 0);
  ctx.stroke();

  for (const side of [-1, 1]) {
    ctx.fillStyle = "#020617";
    ctx.beginPath();
    ctx.arc(s * 0.15, side * s * 0.18, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(s * 0.17, side * s * 0.18, s * 0.025, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
    ctx.beginPath();
    ctx.moveTo(-s * 0.61, side * s * 0.29);
    ctx.lineTo(-s * (0.68 + speed * 0.24), side * s * 0.32);
    ctx.lineTo(-s * 0.61, side * s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0ea5e9";
    ctx.beginPath();
    ctx.arc(-s * 0.59, side * s * 0.32, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAlienStrikeDetails(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  accentColor: string,
): void {
  const s = ship.size;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(-s * 0.36, side * s * 0.23);
    ctx.quadraticCurveTo(s * 0.12, side * s * 0.19, s * 0.61, side * s * 0.49);
    ctx.moveTo(-s * 0.14, side * s * 0.16);
    ctx.quadraticCurveTo(s * 0.15, side * s * 0.18, s * 0.34, side * s * 0.3);
  }
  ctx.stroke();

  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(s * 0.57, -s * 0.18);
  ctx.quadraticCurveTo(s * 0.63, 0, s * 0.57, s * 0.18);
  ctx.stroke();
  ctx.strokeStyle = "#f87171";
  ctx.lineWidth = 0.6;
  ctx.stroke();

  ctx.fillStyle = "#f87171";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(-s * 0.43, side * s * 0.27, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTurretArcCone(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  _color: string,
): void {
  const [tx, ty] = rotatePoint(turret.offset, ship.heading);
  const [minArc, maxArc] = turret.baseArc;
  const range = turret.weapon.range;
  const isFullCircle = maxArc - minArc >= Math.PI * 1.98;
  const isHeavy = turret.isSpinalGimbal || turret.weapon.weaponType === "missile";
  const isPD = turret.weapon.weaponType === "point_defense";

  ctx.save();
  ctx.translate(tx, ty);

  const startAngle = ship.heading + minArc;
  const endAngle = ship.heading + maxArc;

  const fillRgba = isHeavy
    ? "rgba(234, 179, 8, 0.055)"
    : isPD
      ? "rgba(251, 146, 60, 0.035)"
      : "rgba(56, 189, 248, 0.04)";
  const strokeRgba = isHeavy
    ? "rgba(234, 179, 8, 0.45)"
    : isPD
      ? "rgba(251, 146, 60, 0.32)"
      : "rgba(56, 189, 248, 0.35)";

  ctx.fillStyle = fillRgba;
  ctx.strokeStyle = strokeRgba;
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  if (isFullCircle) {
    ctx.arc(0, 0, range, 0, Math.PI * 2);
  } else {
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, range, startAngle, endAngle);
    ctx.closePath();
  }
  ctx.fill();

  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Render actual max range label on the outer arc
  const midAngle = isFullCircle ? ship.heading - Math.PI * 0.25 : (startAngle + endAngle) * 0.5;
  const labelDist = Math.max(40, range - 18);
  const lx = Math.cos(midAngle) * labelDist;
  const ly = Math.sin(midAngle) * labelDist;

  ctx.fillStyle = isHeavy ? "#facc15" : isPD ? "#fb923c" : "#38bdf8";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${range}u`, lx, ly);

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
  const classScale = {
    strike_craft: 0.7,
    corvette: 1,
    cruiser: 1.35,
    battleship: 1.7,
  }[ship.hullClass];
  ctx.scale(classScale, classScale);

  const r = turret.baseRadius ?? 4;
  const length = turret.barrelLength ?? 10;
  const armor = ship.team === 0 ? "#1e293b" : "#450a0a";
  const recess = ship.team === 0 ? "#020617" : "#260606";
  const metal = ship.team === 0 ? "#94a3b8" : "#fca5a5";
  const lens = ship.team === 0 ? "#38bdf8" : "#ef4444";

  ctx.fillStyle = armor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 0.8;

  switch (turret.weapon.weaponType) {
    case "railgun": {
      // Elongated octagonal barbette and recessed capacitor banks.
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, -r * 0.55);
      ctx.lineTo(-r * 0.7, -r);
      ctx.lineTo(r * 0.75, -r);
      ctx.lineTo(r * 1.15, -r * 0.55);
      ctx.lineTo(r * 1.15, r * 0.55);
      ctx.lineTo(r * 0.75, r);
      ctx.lineTo(-r * 0.7, r);
      ctx.lineTo(-r * 1.15, r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = recess;
      for (const side of [-1, 1]) {
        ctx.fillRect(-r * 0.85, side * r * 0.65 - r * 0.12, r * 1.25, r * 0.24);
      }
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 0.5;
      for (const side of [-1, 1]) {
        for (const x of [-0.55, -0.2, 0.15]) {
          ctx.beginPath();
          ctx.moveTo(r * x, side * r * 0.53);
          ctx.lineTo(r * x, side * r * 0.77);
          ctx.stroke();
        }
      }
      // Twin rails, emitter cross-ties, and slotted muzzle brakes.
      for (const side of [-1, 1]) {
        const y = side * r * 0.35;
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(length, y);
        ctx.stroke();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 0.7;
        for (const fraction of [0.4, 0.6, 0.8]) {
          ctx.beginPath();
          ctx.moveTo(length * fraction, y - r * 0.19);
          ctx.lineTo(length * fraction, y + r * 0.19);
          ctx.stroke();
        }
        ctx.fillStyle = recess;
        ctx.fillRect(length - r * 0.4, y - r * 0.2, r * 0.5, r * 0.4);
        ctx.strokeStyle = "#facc15";
        ctx.beginPath();
        ctx.moveTo(length - r * 0.25, y - r * 0.14);
        ctx.lineTo(length - r * 0.25, y + r * 0.14);
        ctx.stroke();
      }
      break;
    }
    case "beam_laser": {
      // Rounded dome with lateral radiator ribs and a focused crystal emitter.
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = 0.7;
      for (const side of [-1, 1]) {
        for (const x of [-0.5, -0.2, 0.1]) {
          ctx.beginPath();
          ctx.moveTo(r * x, side * r * 0.65);
          ctx.lineTo(r * x, side * r * 1.1);
          ctx.stroke();
        }
      }
      ctx.fillStyle = recess;
      ctx.fillRect(0, -r * 0.28, length, r * 0.56);
      ctx.strokeStyle = metal;
      ctx.strokeRect(0, -r * 0.28, length, r * 0.56);
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(length, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "point_defense": {
      // Hexagonal traverse ring, paired autocannons, and tracking sensor.
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const side of [-1, 1]) {
        const y = side * r * 0.38;
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(0.7, r * 0.3);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(length * 0.85, y);
        ctx.stroke();
        ctx.fillStyle = recess;
        ctx.beginPath();
        ctx.moveTo(length * 0.8, y - r * 0.14);
        ctx.lineTo(length, y - r * 0.25);
        ctx.lineTo(length, y + r * 0.25);
        ctx.lineTo(length * 0.8, y + r * 0.14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(-r * 0.45, -r * 0.9, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "missile": {
      // Armored canister with a reinforced pair of launch guides.
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.8);
      ctx.lineTo(length * 0.75, -r * 0.8);
      ctx.lineTo(length, -r * 0.5);
      ctx.lineTo(length, r * 0.5);
      ctx.lineTo(length * 0.75, r * 0.8);
      ctx.lineTo(-r, r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = Math.max(0.7, r * 0.16);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.75, side * r * 0.52);
        ctx.lineTo(length * 0.85, side * r * 0.52);
        ctx.stroke();
      }
      ctx.fillStyle = recess;
      ctx.fillRect(length * 0.75, -r * 0.3, length * 0.25, r * 0.6);
      break;
    }
    case "plasma": {
      // Strike craft carry a compact forward blaster port.
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = r * 0.65;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(length, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

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
