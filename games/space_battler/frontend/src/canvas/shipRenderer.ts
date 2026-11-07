// Procedural vector renderer for 2.5D ship hulls, Terran (sharp/industrial) vs Alien (curved/sleek), thruster flames, bridges, and turrets

import { rotatePoint } from "../engine/math2d";
import { shieldEnvelopeRadius } from "../engine/shieldGeometry";
import type { ShipState, TurretMountState, Vector2 } from "../types/combat";
import { damageState, engineNozzles, engineSpeed, hasFighterHazard } from "./effects";
import { ShipSpriteCache } from "./shipSpriteCache";
import { renderTurret } from "./turretRenderer";

// Size and hardpoint layout are fixed configuration of each bounded cache instance.
// Rasterize at 3 pixels/world unit, above the battlefield's maximum 2.5x zoom.
const hullSprites = new Map<string, ShipSpriteCache>();

function drawCachedHull(ctx: CanvasRenderingContext2D, ship: ShipState): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  const transform = ctx.getTransform();
  const cameraScale = Number(Math.hypot(transform.a, transform.b).toPrecision(6));
  const resolution = Math.max(3, 2 ** Math.ceil(Math.log2(cameraScale)));
  const key = JSON.stringify([
    ship.hullClass,
    ship.team,
    ship.size,
    resolution,
    ship.hullClass === "carrier" ? cameraScale : null,
    ship.turrets.map((turret) => [turret.offset, turret.baseRadius, turret.weapon.weaponType]),
  ]);
  let cache = hullSprites.get(key);
  const extent = ship.size * 1.6 + 4;
  if (!cache) {
    const snapshot = {
      ...ship,
      turrets: ship.turrets.map((turret) => ({ ...turret, offset: [...turret.offset] as Vector2 })),
    };
    cache = new ShipSpriteCache(
      Math.ceil(extent * 2 * resolution),
      (offscreen, _, team, pixels) => {
        offscreen.translate(pixels / 2, pixels / 2);
        offscreen.scale(resolution, resolution);
        // Both 2D contexts expose the same hull drawing operations.
        const hullContext = offscreen as unknown as CanvasRenderingContext2D;
        if (team === 0)
          drawTerranHull(
            hullContext,
            snapshot,
            "#38bdf8",
            "#0f172a",
            "#0284c7",
            undefined,
            true,
            resolution / cameraScale,
          );
        else
          drawAlienHull(
            hullContext,
            snapshot,
            "#f87171",
            "#450a0a",
            "#dc2626",
            undefined,
            true,
            resolution / cameraScale,
          );
      },
    );
    const oldest = hullSprites.keys().next().value;
    if (hullSprites.size >= 32 && oldest !== undefined) hullSprites.delete(oldest);
    hullSprites.set(key, cache);
  }
  const sprite = cache.get(ship.hullClass, ship.team);
  if (!sprite) return false;
  const width = sprite.width / resolution;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sprite, -width / 2, -width / 2, width, width);
  ctx.restore();
  drawAnimatedHullDetails(ctx, ship);
  return true;
}

function drawCarrierRecessLight(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  time: number,
  index: number,
  side: number,
): void {
  const s = ship.size;
  const pulse = 0.35 + 0.2 * Math.sin(time * 3 + index * 0.8);
  ctx.strokeStyle = `rgba(56, 189, 248, ${pulse + 0.25})`;
  ctx.fillStyle = `rgba(56, 189, 248, ${pulse * 0.35})`;
  ctx.lineWidth = s * 0.015;
  ctx.beginPath();
  ctx.ellipse(s * (-0.62 + index * 0.27), side * s * 0.51, s * 0.075, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCarrierRecessLights(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  time: number,
): void {
  ctx.save();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) drawCarrierRecessLight(ctx, ship, time, i, side);
  }
  ctx.restore();
}

function drawAlienCommandEye(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  const s = ship.size;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-s * 0.16, 0, s * (0.075 + 0.01 * Math.sin(performance.now() / 400)), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(-s * 0.16, 0, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerranDetailPlume(ctx: CanvasRenderingContext2D, ship: ShipState, side: number): void {
  const s = ship.size;
  const speed = Math.min(1, Math.hypot(...ship.velocity) / ship.maxSpeed);
  const corvette = ship.hullClass === "corvette";
  const y = side * s * 0.32;
  ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
  ctx.beginPath();
  ctx.moveTo(-s * (corvette ? 0.68 : 0.61), corvette ? y - s * 0.06 : side * s * 0.29);
  ctx.lineTo(-s * (corvette ? 0.7 + speed * 0.35 : 0.68 + speed * 0.24), y);
  ctx.lineTo(-s * (corvette ? 0.68 : 0.61), corvette ? y + s * 0.06 : side * s * 0.35);
  ctx.closePath();
  ctx.fill();
}

function drawAnimatedHullDetails(ctx: CanvasRenderingContext2D, ship: ShipState): void {
  ctx.save();
  if (ship.team !== 0 && ship.hullClass === "battleship") drawAlienCommandEye(ctx, ship);
  if (ship.team === 0 && (ship.hullClass === "corvette" || ship.hullClass === "strike_craft")) {
    const s = ship.size;
    const corvette = ship.hullClass === "corvette";
    if (corvette) {
      // Match the vector detail layer's hull clip without rebuilding the static deck.
      ctx.beginPath();
      ctx.moveTo(s * 1.15, 0);
      for (const [x, y] of [
        [0.4, -0.45],
        [-0.5, -0.58],
        [-0.95, -0.32],
        [-0.75, 0],
        [-0.95, 0.32],
        [-0.5, 0.58],
        [0.4, 0.45],
      ])
        ctx.lineTo(s * x, s * y);
      ctx.closePath();
      ctx.clip();
    }
    for (const side of [-1, 1]) {
      drawTerranDetailPlume(ctx, ship, side);
      // The nozzle covers the root of the animated plume in the original painter order.
      if (corvette) {
        ctx.fillStyle = "#0284c7";
        ctx.beginPath();
        ctx.ellipse(-s * 0.61, side * s * 0.32, s * 0.14, s * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#bae6fd";
        ctx.beginPath();
        ctx.ellipse(-s * 0.65, side * s * 0.32, s * 0.07, s * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#0ea5e9";
        ctx.beginPath();
        ctx.arc(-s * 0.59, side * s * 0.32, s * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Draw the same hull and hardpoints as the battlefield, without combat HUD overlays. */
export function renderShipPreview(ctx: CanvasRenderingContext2D, ship: ShipState, time = 0): void {
  const isBlue = ship.team === 0;
  // Offset the lower hull in screen space so the deck keeps a visible armored edge while rotating.
  ctx.save();
  ctx.translate(0, ship.size * 0.12);
  ctx.rotate(ship.heading);
  if (isBlue) drawTerranHull(ctx, ship, "#164e63", "#020617", "#082f49");
  else drawAlienHull(ctx, ship, "#7f1d1d", "#260606", "#991b1b");
  ctx.restore();
  ctx.save();
  ctx.rotate(ship.heading);
  drawEngineGlow(ctx, ship);
  if (isBlue) drawTerranHull(ctx, ship, "#38bdf8", "#0f172a", "#0284c7", time);
  else drawAlienHull(ctx, ship, "#f87171", "#450a0a", "#dc2626", time);
  ctx.restore();
  for (const turret of ship.turrets)
    renderTurret(ctx, ship, turret, isBlue ? "#38bdf8" : "#f87171");
}

export function renderShip(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  selected = false,
  decals: Vector2[] = [],
  time = performance.now() / 1000,
): void {
  if (!ship.isAlive) return;
  if (ship.isDebris) {
    ctx.save();
    ctx.translate(...ship.pos);
    ctx.rotate(ship.heading);
    ctx.globalAlpha *= Math.min(1, (ship.debrisLifetime ?? 0) / 3);
    ctx.fillStyle = "#292d35";
    ctx.strokeStyle = "#78716c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const angle = (i * Math.PI * 2) / 7;
      const radius = ship.size * (i % 2 === 0 ? 1 : 0.65);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-ship.size * 0.6, 0);
    ctx.lineTo(ship.size * 0.4, ship.size * 0.3);
    ctx.stroke();
    ctx.restore();
    return;
  }

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
  if (hasFighterHazard(ship)) drawCoolantTrail(ctx, ship, time);

  if (drawCachedHull(ctx, ship)) {
    if (ship.hullClass === "tender") drawTenderLight(ctx, ship, time);
    if (ship.hullClass === "carrier") drawCarrierRecessLights(ctx, ship, time);
  } else if (isBlue) {
    drawTerranHull(
      ctx,
      ship,
      primaryColor,
      hullDarkColor,
      accentColor,
      ship.hullClass === "tender" ? time : undefined,
    );
  } else {
    drawAlienHull(
      ctx,
      ship,
      primaryColor,
      hullDarkColor,
      accentColor,
      ship.hullClass === "tender" ? time : undefined,
    );
  }

  drawHullDamage(ctx, ship, decals);
  if (hasFighterHazard(ship)) drawHazardBeacon(ctx, ship, time);

  ctx.restore();

  // 3. Render Independent Turrets
  for (const turret of ship.turrets) {
    renderTurret(ctx, ship, turret, primaryColor);
  }

  // 4. Render the authoritative shield envelope, including capital haven umbrellas.
  if (ship.shieldCurrent > 0) {
    const shieldRatio = ship.shieldCurrent / ship.shieldMax;
    const shieldBubbleRadius = shieldEnvelopeRadius(ship);

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

function drawCoolantTrail(ctx: CanvasRenderingContext2D, ship: ShipState, time: number): void {
  const [x, y] = engineNozzles(ship)[0];
  const s = ship.size;
  const startX = x * s;
  const startY = y * s;
  const length = Math.max(18, s * 2.4);
  const gradient = ctx.createLinearGradient(startX, startY, startX - length, startY);
  gradient.addColorStop(0, "rgba(235, 255, 255, 0.9)");
  gradient.addColorStop(0.35, "rgba(125, 211, 252, 0.7)");
  gradient.addColorStop(1, "rgba(56, 189, 248, 0)");
  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(
    startX - length * 0.5,
    startY + Math.sin(time * 8) * s * 0.12,
    startX - length,
    startY,
  );
  ctx.stroke();
  ctx.restore();
}

function drawHazardBeacon(ctx: CanvasRenderingContext2D, ship: ShipState, time: number): void {
  const flash = time % 0.4 < 0.12;
  const color = Math.floor(time / 0.4) % 2 === 0 ? "#ff3030" : "#fbbf24";
  ctx.save();
  ctx.fillStyle = flash ? color : "#7f1d1d";
  if (flash) {
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(8, ship.size * 0.7);
  }
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, ship.size * 0.12), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHullDamage(ctx: CanvasRenderingContext2D, ship: ShipState, decals: Vector2[]): void {
  const { scarred, burning, critical } = damageState(ship);
  if (!scarred && !burning && !critical && decals.length === 0) return;
  const s = ship.size;
  const time = performance.now();
  ctx.save();
  const baseAlpha = ctx.globalAlpha;

  for (const [x, y] of decals) {
    ctx.fillStyle = "rgba(12, 8, 8, 0.85)";
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(2, s * 0.12), Math.max(1.5, s * 0.07), 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#60382a";
    ctx.lineWidth = Math.max(0.7, s * 0.015);
    ctx.stroke();
  }

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
    ctx.globalAlpha *= flicker;
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
        ? {
            strike_craft: 0.53,
            corvette: 0.5,
            cruiser: -0.53,
            battleship: -0.36,
            dreadnought: -0.15,
            missile_frigate: 0.55,
            tender: 0.5,
            carrier: -0.15,
          }[ship.hullClass]
        : {
            strike_craft: 0.57,
            corvette: 0.3,
            cruiser: 0.25,
            battleship: -0.16,
            dreadnought: -0.15,
            missile_frigate: 0.55,
            tender: 0.3,
            carrier: -0.15,
          }[ship.hullClass];
    ctx.globalAlpha = baseAlpha * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time / 100)));
    ctx.shadowColor = "#ff2020";
    ctx.shadowBlur = Math.max(5, s * 0.3);
    ctx.fillStyle = "#ff3030";
    ctx.beginPath();
    ctx.ellipse(s * coreX, 0, Math.max(2, s * 0.07), Math.max(2, s * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * coreX, side * s * 0.18, Math.max(1.5, s * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
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
    if (ship.hullClass === "carrier") {
      const plume = ctx.createLinearGradient(
        ship.size * x,
        0,
        ship.size * (x - 0.65 - speed * 0.4),
        0,
      );
      plume.addColorStop(0, "rgba(186, 230, 253, 0.8)");
      plume.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.moveTo(ship.size * x, ship.size * (y - 0.07));
      ctx.quadraticCurveTo(
        ship.size * (x - 0.5),
        ship.size * (y - 0.12 * flicker),
        ship.size * (x - 0.65 - speed * 0.4),
        ship.size * y,
      );
      ctx.quadraticCurveTo(
        ship.size * (x - 0.5),
        ship.size * (y + 0.12 * flicker),
        ship.size * x,
        ship.size * (y + 0.07),
      );
      ctx.fill();
    }
    if (ship.hullClass === "missile_frigate") {
      ctx.fillStyle = ship.team === 0 ? "rgba(56, 189, 248, 0.7)" : "rgba(249, 115, 22, 0.7)";
      ctx.beginPath();
      ctx.moveTo(ship.size * x, ship.size * (y - 0.06));
      ctx.lineTo(ship.size * (x - 0.25 - speed * 0.35), ship.size * y);
      ctx.lineTo(ship.size * x, ship.size * (y + 0.06));
      ctx.closePath();
      ctx.fill();
    }
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

/** Team-specific deck geometry; coordinates are local to the hull and face right. */
export function renderCarrierHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  secondaryColor: string,
  time = performance.now() / 1000,
  staticOnly = false,
  rasterScale = 1,
): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  ctx.save();
  ctx.beginPath();
  if (alien) {
    ctx.moveTo(s * 1.25, 0);
    ctx.bezierCurveTo(s * 0.9, -s * 0.18, s * 0.45, -s * 0.7, -s * 0.2, -s * 0.67);
    ctx.bezierCurveTo(-s * 0.65, -s * 0.7, -s * 1.18, -s * 0.57, -s * 1.08, -s * 0.35);
    ctx.bezierCurveTo(-s * 0.78, -s * 0.18, -s * 0.78, s * 0.18, -s * 1.08, s * 0.35);
    ctx.bezierCurveTo(-s * 1.18, s * 0.57, -s * 0.65, s * 0.7, -s * 0.2, s * 0.67);
    ctx.bezierCurveTo(s * 0.45, s * 0.7, s * 0.9, s * 0.18, s * 1.25, 0);
  } else {
    ctx.moveTo(s * 1.25, 0);
    ctx.lineTo(s * 0.75, -s * 0.35);
    ctx.lineTo(s * 0.35, -s * 0.42);
    ctx.lineTo(s * 0.12, -s * 0.68);
    ctx.lineTo(-s * 0.82, -s * 0.68);
    ctx.lineTo(-s * 1.08, -s * 0.48);
    ctx.lineTo(-s * 1.08, s * 0.48);
    ctx.lineTo(-s * 0.82, s * 0.68);
    ctx.lineTo(s * 0.12, s * 0.68);
    ctx.lineTo(s * 0.35, s * 0.42);
    ctx.lineTo(s * 0.75, s * 0.35);
  }
  ctx.closePath();
  const armor = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.7);
  armor.addColorStop(0, secondaryColor);
  armor.addColorStop(0.4, alien ? "#71313d" : "#24435b");
  armor.addColorStop(0.6, secondaryColor);
  armor.addColorStop(1, "#020617");
  ctx.fillStyle = armor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.shadowColor = primaryColor;
  // Canvas shadows are bitmap-space effects, unlike the transformed hull geometry.
  ctx.shadowBlur = s * 0.08 * rasterScale;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Eight lateral tractor recesses, distinct from the central medium-ship deck.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = s * (-0.62 + i * 0.27);
      const y = side * s * 0.51;
      ctx.fillStyle = "#020b16";
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.1, s * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!staticOnly) drawCarrierRecessLight(ctx, ship, time, i, side);
    }
    // Two integrated aft engine pods.
    ctx.lineWidth = s * 0.015;
    ctx.fillStyle = alien ? "#3d1c2b" : "#12283c";
    ctx.strokeStyle = primaryColor;
    ctx.beginPath();
    ctx.ellipse(-s * 0.94, side * s * 0.3, s * 0.13, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#020b16";
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = s * 0.018;
  ctx.beginPath();
  if (alien) {
    ctx.moveTo(s * 0.65, 0);
    ctx.bezierCurveTo(s * 0.3, -s * 0.22, -s * 0.45, -s * 0.22, -s * 0.6, 0);
    ctx.bezierCurveTo(-s * 0.45, s * 0.22, s * 0.3, s * 0.22, s * 0.65, 0);
  } else {
    ctx.rect(-s * 0.58, -s * 0.16, s * 1.08, s * 0.32);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.8)";
  ctx.lineWidth = s * 0.012;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.46, side * s * 0.1);
    ctx.lineTo(s * 0.28, side * s * 0.1);
    ctx.lineTo(s * 0.42, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.75, side * s * 0.25);
    ctx.bezierCurveTo(-s * 0.2, side * s * 0.3, s * 0.55, side * s * 0.22, s * 0.94, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTenderHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  edge: string,
  dark: string,
  time = 0,
  staticOnly = false,
): void {
  const s = ship.size;
  const alien = ship.team === 1;
  ctx.save();
  ctx.fillStyle = dark;
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  if (alien) {
    ctx.moveTo(s * 0.92, 0);
    ctx.bezierCurveTo(s * 0.65, -s * 0.25, s * 0.1, -s * 0.68, -s * 0.58, -s * 0.52);
    ctx.bezierCurveTo(-s * 0.92, -s * 0.36, -s * 0.85, -s * 0.14, -s * 0.8, 0);
    ctx.bezierCurveTo(-s * 0.85, s * 0.14, -s * 0.92, s * 0.36, -s * 0.58, s * 0.52);
    ctx.bezierCurveTo(s * 0.1, s * 0.68, s * 0.65, s * 0.25, s * 0.92, 0);
  } else {
    ctx.moveTo(s * 1.04, 0);
    ctx.lineTo(s * 0.58, -s * 0.4);
    ctx.lineTo(s * 0.25, -s * 0.5);
    ctx.lineTo(s * 0.08, -s * 0.82);
    ctx.lineTo(-s * 0.55, -s * 0.82);
    ctx.lineTo(-s * 0.66, -s * 0.48);
    ctx.lineTo(-s * 0.82, -s * 0.34);
    ctx.lineTo(-s * 0.82, s * 0.34);
    ctx.lineTo(-s * 0.66, s * 0.48);
    ctx.lineTo(-s * 0.55, s * 0.82);
    ctx.lineTo(s * 0.08, s * 0.82);
    ctx.lineTo(s * 0.25, s * 0.5);
    ctx.lineTo(s * 0.58, s * 0.4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (alien) {
      // Curved resonance antennae remain within the 1.4x shield envelope.
      ctx.moveTo(-s * 0.5, side * s * 0.38);
      ctx.bezierCurveTo(
        -s * 0.25,
        side * s * 0.82,
        s * 0.55,
        side * s * 0.95,
        s * 0.85,
        side * s * 0.68,
      );
      ctx.bezierCurveTo(
        s * 0.5,
        side * s * 0.81,
        s * 0.05,
        side * s * 0.65,
        -s * 0.18,
        side * s * 0.38,
      );
    } else {
      ctx.moveTo(-s * 0.55, side * s * 0.75);
      ctx.lineTo(s * 0.03, side * s * 0.75);
      ctx.lineTo(s * 0.03, side * s * 0.57);
      ctx.lineTo(-s * 0.55, side * s * 0.57);
    }
    ctx.closePath();
    ctx.fillStyle = alien ? "#7f1d1d" : "#1e3a52";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = alien ? "#fb7185" : "#7dd3fc";
    ctx.beginPath();
    ctx.arc(-s * 0.82, side * s * 0.25, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  // Armored command citadel; the actual flak turret is drawn at its authoritative mount.
  ctx.fillStyle = alien ? "#581c2b" : "#334155";
  ctx.beginPath();
  if (alien) {
    ctx.ellipse(0, 0, s * 0.48, s * 0.3, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(s * 0.42, 0);
    ctx.lineTo(s * 0.25, -s * 0.32);
    ctx.lineTo(-s * 0.3, -s * 0.32);
    ctx.lineTo(-s * 0.48, 0);
    ctx.lineTo(-s * 0.3, s * 0.32);
    ctx.lineTo(s * 0.25, s * 0.32);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (!staticOnly) drawTenderLight(ctx, ship, time);
  ctx.restore();
}

function drawTenderLight(ctx: CanvasRenderingContext2D, ship: ShipState, time: number): void {
  const s = ship.size;
  const alien = ship.team === 1;
  ctx.save();
  const pulse = 0.7 + 0.3 * Math.sin(time * 3);
  ctx.shadowColor = alien ? "#f43f5e" : "#22d3ee";
  ctx.shadowBlur = s * (0.12 + pulse * 0.18);
  ctx.fillStyle = alien ? "#fb7185" : "#67e8f9";
  ctx.globalAlpha *= 0.65 + pulse * 0.35;
  ctx.beginPath();
  ctx.arc(s * 0.57, 0, s * (0.09 + pulse * 0.02), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTerranHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  primaryColor: string,
  hullDarkColor: string,
  accentColor: string,
  previewTime?: number,
  staticOnly = false,
  rasterScale = 1,
): void {
  if (ship.hullClass === "tender") {
    drawTenderHull(ctx, ship, primaryColor, hullDarkColor, previewTime, staticOnly);
    return;
  }
  if (ship.hullClass === "carrier") {
    renderCarrierHull(ctx, ship, primaryColor, hullDarkColor, previewTime, staticOnly, rasterScale);
    return;
  }
  if (ship.hullClass === "dreadnought" || ship.hullClass === "missile_frigate") {
    drawNewHull(ctx, ship, false, previewTime);
    return;
  }
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

  if (previewTime !== undefined) {
    ctx.save();
    ctx.clip();
    const light = ctx.createLinearGradient(-s, -s * 0.6, s, s * 0.6);
    light.addColorStop(0, "rgba(186, 230, 253, 0.25)");
    light.addColorStop(0.45, "rgba(56, 189, 248, 0.06)");
    light.addColorStop(1, "rgba(2, 6, 23, 0.45)");
    ctx.fillStyle = light;
    ctx.fillRect(-s * 1.3, -s, s * 2.6, s * 2);
    ctx.strokeStyle = `rgba(186, 230, 253, ${0.2 + 0.12 * Math.sin(previewTime * 1.5)})`;
    ctx.lineWidth = Math.max(0.6, s * 0.018);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, side * s * 0.31);
      ctx.lineTo(-s * 0.4, side * s * 0.26);
      ctx.lineTo(s * 0.35, side * s * 0.22);
      ctx.lineTo(s * 0.85, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

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
    drawTerranCorvetteDetails(ctx, ship, accentColor, staticOnly);
    ctx.restore();
    return;
  }

  if (ship.hullClass === "strike_craft") {
    drawTerranStrikeDetails(ctx, ship, accentColor, staticOnly);
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
  previewTime?: number,
  staticOnly = false,
  rasterScale = 1,
): void {
  if (ship.hullClass === "tender") {
    drawTenderHull(ctx, ship, primaryColor, hullDarkColor, previewTime, staticOnly);
    return;
  }
  if (ship.hullClass === "carrier") {
    renderCarrierHull(ctx, ship, primaryColor, hullDarkColor, previewTime, staticOnly, rasterScale);
    return;
  }
  if (ship.hullClass === "dreadnought" || ship.hullClass === "missile_frigate") {
    drawNewHull(ctx, ship, true, previewTime);
    return;
  }
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
    drawAlienBattleshipDetails(ctx, ship, accentColor, staticOnly);
    ctx.restore();
  }
}

function drawNewHull(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  alien: boolean,
  previewTime?: number,
): void {
  const s = ship.size;
  const dread = ship.hullClass === "dreadnought";
  const edge = alien ? "#f87171" : "#38bdf8";
  const accent = alien ? "#fb923c" : "#bae6fd";
  const dark = alien ? "#260606" : "#020617";
  const plate = alien ? "#7f1d1d" : "#334155";

  ctx.beginPath();
  if (dread && alien) {
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
  } else if (dread) {
    ctx.moveTo(s * 1.25, 0);
    ctx.lineTo(s * 0.85, -s * 0.4);
    ctx.lineTo(s * 0.3, -s * 0.48);
    ctx.lineTo(s * 0.14, -s * 0.67);
    ctx.lineTo(-s * 0.58, -s * 0.67);
    ctx.lineTo(-s * 0.78, -s * 0.52);
    ctx.lineTo(-s * 1.12, -s * 0.42);
    ctx.lineTo(-s * 1.12, s * 0.42);
    ctx.lineTo(-s * 0.78, s * 0.52);
    ctx.lineTo(-s * 0.58, s * 0.67);
    ctx.lineTo(s * 0.14, s * 0.67);
    ctx.lineTo(s * 0.3, s * 0.48);
    ctx.lineTo(s * 0.85, s * 0.4);
  } else if (alien) {
    ctx.moveTo(s * 1.2, 0);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.48, -s * 0.85, -s * 0.42);
    ctx.lineTo(-s * 0.92, -s * 0.15);
    ctx.lineTo(-s * 0.65, 0);
    ctx.lineTo(-s * 0.92, s * 0.15);
    ctx.lineTo(-s * 0.85, s * 0.42);
    ctx.quadraticCurveTo(s * 0.35, s * 0.48, s * 1.2, 0);
  } else {
    ctx.moveTo(s * 1.2, 0);
    ctx.lineTo(s * 0.4, -s * 0.3);
    ctx.lineTo(-s * 0.55, -s * 0.46);
    ctx.lineTo(-s * 0.95, -s * 0.34);
    ctx.lineTo(-s * 0.78, 0);
    ctx.lineTo(-s * 0.95, s * 0.34);
    ctx.lineTo(-s * 0.55, s * 0.46);
    ctx.lineTo(s * 0.4, s * 0.3);
  }
  ctx.closePath();
  const light = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.7);
  light.addColorStop(0, plate);
  light.addColorStop(0.45, alien ? "#450a0a" : "#1e293b");
  light.addColorStop(1, dark);
  ctx.fillStyle = light;
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.clip();
  // Layered armor ribs frame the weapon decks and catch rotating preview light.
  ctx.strokeStyle = previewTime === undefined ? edge : accent;
  ctx.globalAlpha = previewTime === undefined ? 0.55 : 0.55 + 0.2 * Math.sin(previewTime * 1.5);
  ctx.lineWidth = Math.max(0.7, s * 0.015);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.95, 0);
    ctx.lineTo(s * 0.46, side * s * (dread ? 0.33 : 0.19));
    ctx.lineTo(-s * 0.65, side * s * (dread ? 0.49 : 0.34));
    ctx.stroke();
    for (const x of dread ? [-0.65, -0.4, -0.15, 0.1, 0.35, 0.6] : [-0.6, -0.3, 0]) {
      ctx.beginPath();
      ctx.moveTo(s * x, side * s * (dread ? 0.3 : 0.2));
      ctx.lineTo(s * (x - 0.1), side * s * (dread ? 0.53 : 0.37));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (dread) {
    // Reinforced barbettes use the actual bow, broadside and aft mount positions.
    for (const turret of ship.turrets) {
      const [x, y] = turret.offset;
      ctx.fillStyle = dark;
      ctx.strokeStyle = edge;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.18, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.145, s * 0.125, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = dark;
    ctx.strokeStyle = edge;
    ctx.fillRect(-s * 0.19, -s * 0.17, s * 0.27, s * 0.34);
    ctx.strokeRect(-s * 0.19, -s * 0.17, s * 0.27, s * 0.34);
    ctx.fillStyle = plate;
    ctx.fillRect(-s * 0.14, -s * 0.11, s * 0.17, s * 0.22);
    ctx.fillStyle = accent;
    ctx.fillRect(s * 0.005, -s * 0.075, s * 0.025, s * 0.15);
  } else {
    // Four exposed launch-cell sockets sit under the independent missile mounts.
    for (const turret of ship.turrets) {
      const [x, y] = turret.offset;
      ctx.fillStyle = dark;
      ctx.strokeStyle = edge;
      ctx.fillRect(x - s * 0.12, y - s * 0.1, s * 0.24, s * 0.2);
      ctx.strokeRect(x - s * 0.12, y - s * 0.1, s * 0.24, s * 0.2);
    }
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(s * 0.48, 0);
    ctx.lineTo(s * 0.25, 0);
    ctx.lineTo(s * 0.16, -s * 0.13);
    ctx.moveTo(s * 0.25, -s * 0.08);
    ctx.lineTo(s * 0.25, s * 0.08);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(s * 0.16, -s * 0.13, Math.max(1, s * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y] of engineNozzles(ship)) {
    ctx.fillStyle = dark;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.ellipse(s * x, s * y, s * 0.1, s * (dread ? 0.06 : 0.08), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(s * x, s * y, s * 0.045, s * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  staticOnly = false,
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
  if (!staticOnly) drawAlienCommandEye(ctx, ship);

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
  staticOnly = false,
): void {
  const s = ship.size;

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
    if (!staticOnly) drawTerranDetailPlume(ctx, ship, side);
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
  staticOnly = false,
): void {
  const s = ship.size;

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

    if (!staticOnly) drawTerranDetailPlume(ctx, ship, side);
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
