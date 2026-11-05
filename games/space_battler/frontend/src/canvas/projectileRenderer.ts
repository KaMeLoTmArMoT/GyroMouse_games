// Projectile and munitions renderer (plasma bolts, railgun kinetics, torpedoes) with high visibility

import type { ProjectileState, ShipState } from "../types/combat";
import type { LaserBeamEffect } from "./effects";

export function renderBeam(
  ctx: CanvasRenderingContext2D,
  beam: LaserBeamEffect,
  time: number,
): void {
  const alpha = beam.remainingDuration / beam.maxDuration;
  const shimmer = 0.85 + 0.15 * Math.sin(time * 24);
  ctx.save();
  ctx.globalAlpha = alpha * shimmer;
  ctx.strokeStyle = beam.ownerTeam === 0 ? "#0284c7" : "#991b1b";
  ctx.shadowColor = beam.color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = beam.width * 4;
  ctx.beginPath();
  ctx.moveTo(...beam.from);
  ctx.lineTo(...beam.to);
  ctx.stroke();
  ctx.strokeStyle = beam.color;
  ctx.lineWidth = beam.width;
  ctx.stroke();
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

export function renderProjectile(ctx: CanvasRenderingContext2D, p: ProjectileState): void {
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
      ctx.shadowColor = isBlue ? "#0ea5e9" : "#dc2626";
      ctx.shadowBlur = 8;
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
