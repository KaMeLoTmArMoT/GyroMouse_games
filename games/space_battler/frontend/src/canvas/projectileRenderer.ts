// Projectile and munitions renderer (plasma bolts, railgun kinetics, torpedoes) with high visibility

import { mountPosition } from "../engine/fireControl";
import type { ProjectileState, ShipState } from "../types/combat";
import type { LaserBeamEffect } from "./effects";
import { drawGlowLine } from "./glowSprites";

export function renderBeam(
  ctx: CanvasRenderingContext2D,
  beam: LaserBeamEffect,
  time: number,
): void {
  const alpha = beam.remainingDuration / beam.maxDuration;
  const shimmer = 0.85 + 0.15 * Math.sin(time * 24);
  ctx.save();
  ctx.globalAlpha = alpha * shimmer;
  ctx.strokeStyle = beam.harmonic
    ? beam.ownerTeam === 0
      ? "#38bdf8"
      : "#c084fc"
    : beam.ownerTeam === 0
      ? "#0284c7"
      : "#991b1b";
  // Canvas shadows are screen-space; compensate for the camera scale.
  const zoom = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  drawGlowLine(ctx, beam.from, beam.to, beam.color, beam.width * 2 + 12 / zoom);
  ctx.lineWidth = beam.width * 4;
  ctx.beginPath();
  ctx.moveTo(...beam.from);
  ctx.lineTo(...beam.to);
  ctx.stroke();
  ctx.strokeStyle = beam.color;
  ctx.lineWidth = beam.width;
  ctx.stroke();
  if (beam.harmonic) {
    ctx.fillStyle = beam.ownerTeam === 0 ? "#a5f3fc" : "#e9d5ff";
    for (let i = 0; i < 3; i++) {
      const phase = (time * 0.8 + i / 3) % 1;
      const x = beam.from[0] + (beam.to[0] - beam.from[0]) * phase;
      const y = beam.from[1] + (beam.to[1] - beam.from[1]) * phase;
      ctx.beginPath();
      ctx.arc(x, y, beam.width * 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const radius = 8 + 2 * Math.sin(time * 31);
  const glow = ctx.createRadialGradient(beam.to[0], beam.to[1], 0, beam.to[0], beam.to[1], radius);
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(0.35, beam.color);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(beam.to[0], beam.to[1], radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function renderProjectile(
  ctx: CanvasRenderingContext2D,
  p: ProjectileState,
  plumeAlpha = 1,
): void {
  const [x, y] = p.pos;
  const isBlue = p.ownerTeam === 0;

  ctx.save();
  ctx.translate(x, y);

  switch (p.weaponType) {
    case "railgun": {
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      // Ionized wake and hot projectile core.
      ctx.strokeStyle = isBlue ? "rgba(56, 189, 248, 0.6)" : "rgba(249, 115, 22, 0.7)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-24, 0);
      ctx.stroke();

      ctx.strokeStyle = isBlue ? "#cbd5e1" : "#ef4444";
      ctx.lineWidth = isBlue ? 2 : 4;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-12, 0);
      ctx.stroke();

      ctx.fillStyle = isBlue ? "#ffffff" : "#fdba74";
      ctx.beginPath();
      ctx.arc(12, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "plasma": {
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
      glow.addColorStop(0, isBlue ? "#e0f2fe" : "#fca5a5");
      glow.addColorStop(0.3, isBlue ? "#0ea5e9" : "#dc2626");
      if (!isBlue) glow.addColorStop(0.65, "#a855f7");
      glow.addColorStop(1, isBlue ? "rgba(14, 165, 233, 0)" : "rgba(168, 85, 247, 0)");

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "point_defense": {
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      ctx.strokeStyle = isBlue ? "rgba(251, 146, 60, 0.75)" : "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();

      ctx.fillStyle = isBlue ? "#fde047" : "#fda4af";
      ctx.beginPath();
      ctx.arc(5, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "missile": {
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      // Terran armor is angular; the alien hull is a tapered organic pod.
      ctx.beginPath();
      if (isBlue) {
        ctx.moveTo(-8, -3);
        ctx.lineTo(5, -3);
        ctx.lineTo(11, 0);
        ctx.lineTo(5, 3);
        ctx.lineTo(-8, 3);
      } else {
        ctx.moveTo(-9, 0);
        ctx.quadraticCurveTo(-3, -6, 4, -4);
        ctx.quadraticCurveTo(8, -3, 11, 0);
        ctx.quadraticCurveTo(8, 3, 4, 4);
        ctx.quadraticCurveTo(-3, 6, -9, 0);
      }
      ctx.closePath();
      ctx.fillStyle = isBlue ? "#cbd5e1" : "#7f1d1d";
      ctx.fill();
      ctx.strokeStyle = isBlue ? "#64748b" : "#ef4444";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = isBlue ? "#67e8f9" : "#ef4444";
      ctx.globalAlpha *= plumeAlpha;
      const zoom = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
      drawGlowLine(ctx, [-7, 0], [-16, 0], isBlue ? "#0ea5e9" : "#dc2626", 8 / zoom + 2);
      ctx.lineWidth = isBlue ? 2.5 : 4;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-16, 0);
      ctx.stroke();
      break;
    }

    default:
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
  }

  ctx.restore();
}

export function renderProjectileGuidance(
  ctx: CanvasRenderingContext2D,
  projectile: ProjectileState,
  target: ShipState | undefined,
  zoom: number,
): void {
  const [x, y] = projectile.pos;
  const angle = Math.atan2(projectile.velocity[1], projectile.velocity[0]);
  const unit = 1 / zoom;
  const color = projectile.ownerTeam === 0 ? "#67e8f9" : "#fca5a5";

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * unit;
  ctx.beginPath();
  ctx.moveTo(x, y - 18 * unit);
  ctx.lineTo(x + 18 * unit, y);
  ctx.lineTo(x, y + 18 * unit);
  ctx.lineTo(x - 18 * unit, y);
  ctx.closePath();
  ctx.stroke();

  if (target) {
    ctx.setLineDash([5 * unit, 5 * unit]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(...target.pos);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(target.pos[0], target.pos[1], 7 * unit, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.45;
  const radius = 65 * unit;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, radius, angle - Math.PI / 3, angle + Math.PI / 3);
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  ctx.stroke();
  ctx.restore();
}

export function renderProjectileThreats(
  ctx: CanvasRenderingContext2D,
  projectile: ProjectileState,
  ships: ShipState[],
  zoom: number,
): void {
  const mounts = ships.flatMap((ship) =>
    ship.isAlive && ship.team !== projectile.ownerTeam
      ? ship.turrets
          .filter(
            (turret) =>
              turret.currentTargetKind === "missile" && turret.currentTargetId === projectile.id,
          )
          .map((turret) => mountPosition(ship, turret))
      : [],
  );
  if (mounts.length === 0) return;

  const unit = 1 / zoom;
  const [x, y] = projectile.pos;
  ctx.save();
  ctx.strokeStyle = "rgba(248, 113, 113, 0.55)";
  ctx.lineWidth = unit;
  ctx.setLineDash([4 * unit, 5 * unit]);
  ctx.beginPath();
  for (const mount of mounts) {
    ctx.moveTo(...mount);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 * unit;
  ctx.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.moveTo(x + sx * 15 * unit, y + sy * 22 * unit);
      ctx.lineTo(x + sx * 22 * unit, y + sy * 22 * unit);
      ctx.lineTo(x + sx * 22 * unit, y + sy * 15 * unit);
    }
  }
  ctx.stroke();
  ctx.restore();
}
