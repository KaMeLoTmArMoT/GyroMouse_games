// Projectile and munitions renderer (plasma bolts, railgun kinetics, torpedoes)

import type { ProjectileState } from "../types/combat";

export function renderProjectile(ctx: CanvasRenderingContext2D, p: ProjectileState): void {
  const [x, y] = p.pos;
  const isBlue = p.ownerTeam === 0;

  ctx.save();
  ctx.translate(x, y);

  switch (p.weaponType) {
    case "railgun": {
      // High-velocity kinetic slug with bright tracer
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = isBlue ? "#38bdf8" : "#f87171";
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-12, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(8, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "plasma": {
      // Pulsing green/cyan plasma ball
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 7);
      glow.addColorStop(0, "#ffffff");
      glow.addColorStop(0.4, "#a855f7");
      glow.addColorStop(1, "rgba(168, 85, 247, 0)");

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "missile": {
      // Guided torpedo with engine plume
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      // Rocket body
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(-6, -2, 12, 4);

      // Warhead
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(6, -2);
      ctx.lineTo(9, 0);
      ctx.lineTo(6, 2);
      ctx.closePath();
      ctx.fill();

      // Engine plume
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-11, 0);
      ctx.stroke();
      break;
    }

    default:
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
  }

  ctx.restore();
}
