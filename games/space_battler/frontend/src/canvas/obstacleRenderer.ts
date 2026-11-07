import type { MapObstacle } from "../engine/battleMaps";
import { discVisible, type Viewport } from "./viewport";

export function renderMapObstacles(
  ctx: CanvasRenderingContext2D,
  obstacles: readonly MapObstacle[],
  viewport: Viewport,
): void {
  for (const obstacle of obstacles) {
    if (!discVisible(viewport, obstacle.pos, obstacle.radius + 3)) continue;
    ctx.save();
    ctx.translate(...obstacle.pos);
    ctx.rotate(obstacle.rotation);
    const r = obstacle.radius;
    if (obstacle.kind === "asteroid") {
      const gradient = ctx.createLinearGradient(-r, -r, r, r);
      gradient.addColorStop(0, "#6c7379");
      gradient.addColorStop(0.45, "#343b42");
      gradient.addColorStop(1, "#161c25");
      ctx.beginPath();
      for (let i = 0; i < 13; i++) {
        const angle = (i * Math.PI * 2) / 13;
        const edge = r * (0.84 + (0.16 * ((i * 7 + obstacle.id.length) % 5)) / 4);
        const x = Math.cos(angle) * edge;
        const y = Math.sin(angle) * edge;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "#87929a";
      ctx.lineWidth = Math.max(1, r * 0.012);
      ctx.stroke();
      for (const [x, y, size] of [
        [-0.3, -0.2, 0.16],
        [0.3, 0.15, 0.11],
        [-0.12, 0.4, 0.08],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x * r, y * r, size * r, size * r * 0.7, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(10, 15, 23, 0.3)";
        ctx.fill();
        ctx.strokeStyle = "rgba(174, 186, 194, 0.2)";
        ctx.stroke();
      }
    } else {
      const gradient = ctx.createLinearGradient(-r, -r, r, r);
      gradient.addColorStop(0, "#53616b");
      gradient.addColorStop(0.45, "#252f3a");
      gradient.addColorStop(1, "#101722");
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const edge = i % 2 === 0 ? r : r * 0.72;
        if (i === 0) ctx.moveTo(Math.cos(angle) * edge, Math.sin(angle) * edge);
        else ctx.lineTo(Math.cos(angle) * edge, Math.sin(angle) * edge);
      }
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.018);
      ctx.strokeStyle = "#697c88";
      ctx.stroke();
      ctx.strokeStyle = "#8799a0";
      ctx.strokeRect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64);
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(r * 0.7, 0);
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(0, r * 0.7);
      ctx.stroke();
      for (const [x, y] of [
        [-0.55, 0],
        [0.55, 0],
        [0, -0.55],
        [0, 0.55],
      ]) {
        ctx.beginPath();
        ctx.arc(x * r, y * r, Math.max(2, r * 0.025), 0, Math.PI * 2);
        ctx.fillStyle = "#fbbf24";
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
