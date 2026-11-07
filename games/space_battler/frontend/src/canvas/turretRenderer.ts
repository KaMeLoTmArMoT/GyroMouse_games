import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";

const lightTurretSprites = new Map<string, OffscreenCanvas>();

export function renderTurret(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
): void {
  const [x, y] = rotatePoint(turret.offset, ship.heading);
  const r = turret.baseRadius ?? 4;
  const length = turret.barrelLength ?? 10;
  const lightShip =
    ship.hullClass === "strike_craft" ||
    ship.hullClass === "corvette" ||
    ship.hullClass === "missile_frigate";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ship.heading + turret.currentLocalAngle);

  if (lightShip && typeof OffscreenCanvas !== "undefined") {
    const transform = ctx.getTransform();
    const scale = Math.max(
      Math.hypot(transform.a, transform.b),
      Math.hypot(transform.c, transform.d),
    );
    const resolution = Math.max(3, 2 ** Math.ceil(Math.log2(scale)));
    const key = JSON.stringify([
      ship.team,
      primaryColor,
      r,
      length,
      turret.weapon.weaponType,
      !!turret.weapon.flak,
      turret.weapon.damage > 10,
      resolution,
    ]);
    let sprite = lightTurretSprites.get(key);
    if (!sprite) {
      const extent = Math.max(length + r * 2, r * 3) + 2;
      const pixels = Math.ceil(extent * 2 * resolution);
      const canvas = new OffscreenCanvas(pixels, pixels);
      const offscreen = canvas.getContext("2d");
      if (offscreen) {
        offscreen.translate(pixels / 2, pixels / 2);
        offscreen.scale(resolution, resolution);
        drawTurretBody(
          offscreen as unknown as CanvasRenderingContext2D,
          ship,
          turret,
          primaryColor,
          true,
        );
        sprite = canvas;
        const oldest = lightTurretSprites.keys().next().value;
        if (lightTurretSprites.size >= 64 && oldest !== undefined)
          lightTurretSprites.delete(oldest);
        lightTurretSprites.set(key, sprite);
      }
    }
    if (sprite) {
      const width = sprite.width / resolution;
      ctx.drawImage(sprite, -width / 2, -width / 2, width, width);
      ctx.restore();
      return;
    }
  }

  drawTurretBody(ctx, ship, turret, primaryColor, lightShip);
  ctx.restore();
}

function drawTurretBody(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
  elevated: boolean,
): void {
  const r = turret.baseRadius ?? 4;
  const length = turret.barrelLength ?? 10;
  const armor = ship.team === 0 ? "#1e293b" : "#450a0a";
  const recess = ship.team === 0 ? "#020617" : "#260606";
  const metal = ship.team === 0 ? "#94a3b8" : "#fca5a5";
  const lens = ship.team === 0 ? "#38bdf8" : "#ef4444";

  if (elevated) {
    // Solid offsets give the rotating housing a raised lower edge without a canvas blur.
    ctx.fillStyle = ship.team === 0 ? "#020617" : "#200306";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 1.12, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    if (turret.weapon.weaponType === "missile") {
      ctx.fillRect(-r, -r * 0.52, length + r, r * 1.6);
    }
  }
  ctx.fillStyle = armor;
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 0.8;

  switch (turret.weapon.weaponType) {
    case "point_defense": {
      const flak = turret.weapon.flak;
      const sides = flak ? 8 : 6;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (Math.PI * 2 * (i + (flak ? 0.5 : 0))) / sides;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const side of [-1, 1]) {
        const y = side * r * (flak ? 0.5 : 0.38);
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(0.7, r * (flak ? 0.5 : 0.3));
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(length, y);
        ctx.stroke();
        ctx.fillStyle = recess;
        const brake = r * (flak ? 0.6 : 0.3);
        ctx.fillRect(length - brake * 0.7, y - brake / 2, brake, brake);
        if (flak) {
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(length - brake * 0.3, y - brake * 0.35);
          ctx.lineTo(length - brake * 0.3, y + brake * 0.35);
          ctx.stroke();
        }
      }
      if (!flak) {
        ctx.fillStyle = lens;
        ctx.beginPath();
        ctx.arc(-r * 0.45, -r * 0.85, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "beam_laser": {
      const heavy = r > 3.8 && turret.weapon.damage > 10;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (heavy) {
        ctx.strokeStyle = metal;
        ctx.lineWidth = 0.7;
        for (const side of [-1, 1]) {
          for (const rib of [-0.5, -0.2, 0.1]) {
            ctx.beginPath();
            ctx.moveTo(r * rib, side * r * 0.65);
            ctx.lineTo(r * rib, side * r * 1.1);
            ctx.stroke();
          }
        }
      }
      const width = r * (heavy ? 0.65 : 0.3);
      ctx.fillStyle = recess;
      ctx.fillRect(0, -width / 2, length, width);
      ctx.strokeStyle = metal;
      ctx.strokeRect(0, -width / 2, length, width);
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(length, 0, r * (heavy ? 0.3 : 0.4), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "railgun": {
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
      for (const side of [-1, 1]) {
        ctx.fillStyle = recess;
        ctx.fillRect(-r * 0.85, side * r * 0.65 - r * 0.12, r * 1.25, r * 0.24);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 0.5;
        for (const rib of [-0.55, -0.2, 0.15]) {
          ctx.beginPath();
          ctx.moveTo(r * rib, side * r * 0.53);
          ctx.lineTo(r * rib, side * r * 0.77);
          ctx.stroke();
        }
        const y = side * r * 0.35;
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(length, y);
        ctx.stroke();
        ctx.strokeStyle = primaryColor;
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
    case "missile": {
      const heavy = r > 3.8;
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
      ctx.lineWidth = Math.max(0.7, r * (heavy ? 0.22 : 0.16));
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.75, side * r * 0.52);
        ctx.lineTo(length * 0.85, side * r * 0.52);
        ctx.stroke();
        if (heavy) {
          ctx.fillStyle = recess;
          ctx.fillRect(length * 0.75, side * r * 0.35 - r * 0.18, length * 0.25, r * 0.36);
        }
      }
      if (!heavy) {
        ctx.fillStyle = recess;
        ctx.fillRect(length * 0.75, -r * 0.3, length * 0.25, r * 0.6);
      }
      break;
    }
    case "plasma": {
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
  if (elevated) {
    ctx.strokeStyle = ship.team === 0 ? "rgba(224, 242, 254, 0.85)" : "rgba(254, 205, 211, 0.85)";
    ctx.lineWidth = Math.max(0.35, r * 0.16);
    ctx.beginPath();
    if (turret.weapon.weaponType === "missile") {
      ctx.moveTo(-r * 0.85, -r * 0.73);
      ctx.lineTo(length * 0.7, -r * 0.73);
      ctx.lineTo(length * 0.92, -r * 0.48);
    } else {
      ctx.arc(0, 0, r * 0.8, Math.PI * 1.12, Math.PI * 1.73);
    }
    ctx.stroke();
  }
}
