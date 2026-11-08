import { rotatePoint } from "../engine/math2d";
import type { ShipState, TurretMountState } from "../types/combat";
import { isLightHull } from "./lightHullDepth";

const lightTurretSprites = new Map<string, OffscreenCanvas>();
const barbetteSprites = new Map<string, OffscreenCanvas>();

export function previewTurretOffsets(r: number, depth: number): { collar: number; cupola: number } {
  const effectiveDepth = Math.max(0, Math.min(depth, 1.8));
  const maxVerticalOffset = Math.min(r * 0.4, 3.5);
  const collar = Math.min(r * 0.15 * effectiveDepth, maxVerticalOffset * 0.375);
  const cupola = Math.min(r * 0.25 * effectiveDepth, maxVerticalOffset - collar);
  return { collar, cupola };
}

function drawBarbette(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  r: number,
  height: number,
): void {
  const radius = r * 1.05;
  ctx.fillStyle = "rgba(2, 6, 23, 0.3)";
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
  ctx.fill();

  const flank = ctx.createLinearGradient(-radius, 0, radius, 0);
  flank.addColorStop(0, ship.team === 0 ? "#7099af" : "#bc7079");
  flank.addColorStop(0.5, ship.team === 0 ? "#36566b" : "#793642");
  flank.addColorStop(1, ship.team === 0 ? "#172c3c" : "#40121c");
  ctx.fillStyle = flank;
  ctx.strokeStyle = ship.team === 0 ? "#0b1b2b" : "#300810";
  ctx.lineWidth = Math.max(0.4, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(-radius, -height);
  ctx.lineTo(-radius, 0);
  ctx.ellipse(0, 0, radius, radius, 0, Math.PI, 0, true);
  ctx.lineTo(radius, -height);
  ctx.ellipse(0, -height, radius, radius, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const top = ctx.createLinearGradient(0, -height - radius, 0, -height + radius);
  top.addColorStop(0, ship.team === 0 ? "#7699aa" : "#b66c76");
  top.addColorStop(1, ship.team === 0 ? "#29465a" : "#632733");
  ctx.fillStyle = top;
  ctx.strokeStyle = ship.team === 0 ? "#63879c" : "#a35c69";
  ctx.beginPath();
  ctx.arc(0, -height, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = ship.team === 0 ? "#e0f2fe" : "#ffe4e6";
  ctx.lineWidth = Math.max(0.4, r * 0.13);
  ctx.beginPath();
  ctx.arc(0, -height, radius * 0.9, Math.PI * 1.08, Math.PI * 1.86);
  ctx.stroke();
}

function renderBarbette(ctx: CanvasRenderingContext2D, ship: ShipState, r: number): void {
  if (typeof OffscreenCanvas !== "undefined") {
    const transform = ctx.getTransform();
    const scale = Math.max(
      Math.hypot(transform.a, transform.b),
      Math.hypot(transform.c, transform.d),
    );
    const resolution = Math.max(3, 2 ** Math.ceil(Math.log2(scale)));
    const key = JSON.stringify([ship.team, r, resolution]);
    let sprite = barbetteSprites.get(key);
    if (!sprite) {
      const pixels = Math.ceil((r * 3 + 2) * 2 * resolution);
      const canvas = new OffscreenCanvas(pixels, pixels);
      const offscreen = canvas.getContext("2d");
      if (offscreen) {
        offscreen.translate(pixels / 2, pixels / 2);
        offscreen.scale(resolution, resolution);
        drawBarbette(offscreen as unknown as CanvasRenderingContext2D, ship, r, r * 0.7);
        sprite = canvas;
        const oldest = barbetteSprites.keys().next().value;
        if (barbetteSprites.size >= 64 && oldest !== undefined) barbetteSprites.delete(oldest);
        barbetteSprites.set(key, sprite);
      }
    }
    if (sprite) {
      const width = sprite.width / resolution;
      ctx.drawImage(sprite, -width / 2, -width / 2, width, width);
      return;
    }
  }
  drawBarbette(ctx, ship, r, r * 0.7);
}

export function renderTurret(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
  previewDepth?: number,
): void {
  const [x, y] = rotatePoint(turret.offset, ship.heading);
  const r = turret.baseRadius ?? 4;
  const length = turret.barrelLength ?? 10;
  const lightShip = isLightHull(ship);

  ctx.save();
  ctx.translate(x, y);
  if (previewDepth !== undefined) {
    const { collar: collarHeight } = previewTurretOffsets(r, previewDepth);
    drawBarbette(ctx, ship, r, collarHeight);
    ctx.translate(0, -collarHeight);
  } else if (lightShip) {
    renderBarbette(ctx, ship, r);
    ctx.translate(0, -r * 0.7);
  }
  ctx.rotate(ship.heading + turret.currentLocalAngle);

  if (previewDepth !== undefined) {
    drawVolumetricTurret(ctx, ship, turret, primaryColor, previewDepth);
    ctx.restore();
    return;
  }

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

  drawTurretBody(ctx, ship, turret, primaryColor);
  ctx.restore();
}

function drawVolumetricTurret(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
  depth: number,
): void {
  const r = turret.baseRadius;
  const length = turret.barrelLength;
  const { cupola } = previewTurretOffsets(r, depth);
  const [ux, uy] = rotatePoint([0, -cupola], -(ship.heading + turret.currentLocalAngle));
  const missile = turret.weapon.weaponType === "missile";
  const round = turret.weapon.weaponType === "beam_laser" || turret.weapon.weaponType === "plasma";
  const housing = () => {
    ctx.beginPath();
    if (round) {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else {
      const front = missile ? length : r * 1.1;
      ctx.moveTo(-r, -r * 0.6);
      ctx.lineTo(-r * 0.65, -r);
      ctx.lineTo(missile ? length * 0.75 : r * 0.7, -r);
      ctx.lineTo(front, -r * 0.55);
      ctx.lineTo(front, r * 0.55);
      ctx.lineTo(missile ? length * 0.75 : r * 0.7, r);
      ctx.lineTo(-r * 0.65, r);
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
    }
  };
  // Successive profiles form vertical walls in world space, independent of turret bearing.
  for (let i = 0; i <= 10; i++) {
    ctx.save();
    ctx.translate((ux * i) / 10, (uy * i) / 10);
    ctx.fillStyle =
      i === 10
        ? ship.team === 0
          ? "#7595a7"
          : "#b66b75"
        : ship.team === 0
          ? "#243e50"
          : "#57212b";
    housing();
    ctx.fill();
    if (i === 10) {
      ctx.strokeStyle = ship.team === 0 ? "#b4d9e7" : "#ffc1c4";
      ctx.lineWidth = Math.max(0.4, r * 0.12);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (!missile) {
    const barrels =
      turret.weapon.weaponType === "point_defense" || turret.weapon.weaponType === "railgun"
        ? [-0.35, 0.35]
        : [0];
    for (const side of barrels) {
      ctx.strokeStyle = ship.team === 0 ? "#172c3c" : "#40121c";
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.beginPath();
      ctx.moveTo(r * 0.5 + ux * 0.35, side * r + uy * 0.35);
      ctx.lineTo(length + ux * 0.35, side * r + uy * 0.35);
      ctx.stroke();
    }
  }
  ctx.translate(ux, uy);
  drawTurretBody(ctx, ship, turret, primaryColor);
  const dual =
    turret.weapon.weaponType === "point_defense" ||
    turret.weapon.weaponType === "railgun" ||
    (missile && r > 3.8);
  for (const side of dual ? [-0.35, 0.35] : [0]) {
    ctx.save();
    ctx.translate(length, side * r);
    ctx.rotate(-(ship.heading + turret.currentLocalAngle));
    ctx.fillStyle = ship.team === 0 ? "#020617" : "#260606";
    ctx.strokeStyle = ship.team === 0 ? "#b4d9e7" : "#ffc1c4";
    ctx.lineWidth = Math.max(0.3, r * 0.1);
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      r * 0.16,
      Math.max(r * 0.08, r * 0.16 * Math.min(depth, 1.8)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawTurretBody(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  turret: TurretMountState,
  primaryColor: string,
): void {
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
      drawCupolaBevel(ctx, ship, r, length);
      for (const side of [-1, 1]) {
        const y = side * r * (flak ? 0.5 : 0.38);
        drawBarrelJoint(ctx, r, recess, metal, y);
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(0.7, r * (flak ? 0.5 : 0.3));
        ctx.beginPath();
        ctx.moveTo(r * 0.55, y);
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
        drawMuzzle(ctx, length, y, r, brake * 0.4, recess, metal);
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
      drawCupolaBevel(ctx, ship, r, length);
      drawBarrelJoint(ctx, r, recess, metal);
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
      ctx.fillRect(r * 0.55, -width / 2, length - r * 0.55, width);
      ctx.strokeStyle = metal;
      ctx.strokeRect(r * 0.55, -width / 2, length - r * 0.55, width);
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(length, 0, r * (heavy ? 0.3 : 0.4), 0, Math.PI * 2);
      ctx.fill();
      drawMuzzle(ctx, length, 0, r, width * 0.5, recess, metal);
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
      drawCupolaBevel(ctx, ship, r, length);
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
        drawBarrelJoint(ctx, r, recess, metal, y);
        ctx.strokeStyle = metal;
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(r * 0.55, y);
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
        drawMuzzle(ctx, length, y, r, r * 0.19, recess, metal);
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
      drawCupolaBevel(ctx, ship, r, length);
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
      for (const y of heavy ? [-r * 0.35, r * 0.35] : [0])
        drawMuzzle(ctx, length, y, r, r * (heavy ? 0.18 : 0.3), recess, metal);
      break;
    }
    case "plasma": {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawCupolaBevel(ctx, ship, r, length);
      drawBarrelJoint(ctx, r, recess, metal);
      ctx.strokeStyle = metal;
      ctx.lineWidth = r * 0.65;
      ctx.beginPath();
      ctx.moveTo(r * 0.55, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(length, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      drawMuzzle(ctx, length, 0, r, r * 0.3, recess, metal);
      break;
    }
  }
}

/** Shade the existing housing path before adding barrels and fittings. */
function drawCupolaBevel(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  r: number,
  length: number,
): void {
  ctx.save();
  ctx.clip();
  const bevel = ctx.createLinearGradient(0, -r, 0, r);
  bevel.addColorStop(0, ship.team === 0 ? "rgba(224, 242, 254, 0.75)" : "rgba(255, 205, 211, 0.7)");
  bevel.addColorStop(
    0.2,
    ship.team === 0 ? "rgba(125, 180, 205, 0.38)" : "rgba(210, 110, 120, 0.35)",
  );
  bevel.addColorStop(0.5, "rgba(0, 0, 0, 0)");
  bevel.addColorStop(1, "rgba(0, 0, 0, 0.65)");
  ctx.fillStyle = bevel;
  ctx.fillRect(-r * 1.3, -r * 1.2, length + r * 2.6, r * 2.4);
  ctx.restore();
}

function drawBarrelJoint(
  ctx: CanvasRenderingContext2D,
  r: number,
  recess: string,
  metal: string,
  y = 0,
): void {
  ctx.fillStyle = recess;
  ctx.strokeStyle = metal;
  ctx.lineWidth = Math.max(0.35, r * 0.12);
  ctx.beginPath();
  ctx.ellipse(r * 0.55, y, r * 0.3, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawMuzzle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  radius: number,
  recess: string,
  metal: string,
): void {
  ctx.fillStyle = recess;
  ctx.strokeStyle = metal;
  ctx.lineWidth = Math.max(0.3, r * 0.1);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.17, radius, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
