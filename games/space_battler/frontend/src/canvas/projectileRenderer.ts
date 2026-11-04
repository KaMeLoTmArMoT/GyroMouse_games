// Projectile and munitions renderer (plasma bolts, railgun kinetics, torpedoes) with high visibility

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

      // Outer glow tracer
      ctx.strokeStyle = isBlue ? "rgba(56, 189, 248, 0.4)" : "rgba(248, 113, 113, 0.4)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-24, 0);
      ctx.stroke();

      // Core kinetic slug
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-12, 0);
      ctx.stroke();

      // Tip flash
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(12, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "plasma": {
      // Glowing purple plasma bolt
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
      glow.addColorStop(0, "#ffffff");
      glow.addColorStop(0.3, "#c084fc");
      glow.addColorStop(1, "rgba(192, 132, 252, 0)");

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "point_defense": {
      // Proximity-fused flak shell with hot orange tracer
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      ctx.strokeStyle = "rgba(251, 146, 60, 0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();

      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(5, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "missile": {
      // Guided torpedo with animated engine trail
      const angle = Math.atan2(p.velocity[1], p.velocity[0]);
      ctx.rotate(angle);

      // Missile hull
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(-7, -2.5, 14, 5);

      // High-explosive warhead tip
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(7, -2.5);
      ctx.lineTo(11, 0);
      ctx.lineTo(7, 2.5);
      ctx.closePath();
      ctx.fill();

      // Rocket plume
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-15, 0);
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
