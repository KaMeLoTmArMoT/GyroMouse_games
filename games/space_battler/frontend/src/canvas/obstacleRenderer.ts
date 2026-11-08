import type { MapObstacle } from "../engine/battleMaps";
import { discVisible, type Viewport } from "./viewport";

const obstacleSprites = new Map<string, { canvas: OffscreenCanvas; width: number }>();

export function renderMapObstacles(
  ctx: CanvasRenderingContext2D,
  obstacles: readonly MapObstacle[],
  viewport: Viewport,
  _elevation = Math.PI / 2,
): void {
  for (const obstacle of obstacles) {
    if (!discVisible(viewport, obstacle.pos, obstacle.radius + 3)) continue;
    ctx.save();
    ctx.translate(...obstacle.pos);
    ctx.rotate(obstacle.rotation);
    if (!drawCachedObstacle(ctx, obstacle)) {
      drawObstacle(ctx, obstacle);
    }
    ctx.restore();
  }
}

function drawCachedObstacle(ctx: CanvasRenderingContext2D, obstacle: MapObstacle): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  const transform = ctx.getTransform();
  const sum = transform.a ** 2 + transform.b ** 2 + transform.c ** 2 + transform.d ** 2;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  const scale = Number(
    Math.sqrt((sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * determinant ** 2))) / 2).toPrecision(6),
  );
  const extent = obstacle.radius + 4;
  const resolution = Math.min(1536 / (extent * 2), Math.max(0.5, 2 ** Math.ceil(Math.log2(scale))));
  const key = JSON.stringify([
    obstacle.kind,
    obstacle.radius,
    obstacle.kind === "asteroid" ? obstacle.id.length % 5 : 0,
    resolution,
  ]);
  let sprite = obstacleSprites.get(key);
  if (!sprite) {
    const pixels = Math.ceil(extent * 2 * resolution);
    const canvas = new OffscreenCanvas(pixels, pixels);
    const offscreen = canvas.getContext("2d");
    if (!offscreen) return false;
    offscreen.translate(pixels / 2, pixels / 2);
    offscreen.scale(resolution, resolution);
    drawObstacle(offscreen as unknown as CanvasRenderingContext2D, obstacle);
    sprite = { canvas, width: pixels / resolution };
    const oldest = obstacleSprites.keys().next().value;
    if (obstacleSprites.size >= 8 && oldest !== undefined) obstacleSprites.delete(oldest);
    obstacleSprites.set(key, sprite);
  }
  ctx.drawImage(sprite.canvas, -sprite.width / 2, -sprite.width / 2, sprite.width, sprite.width);
  return true;
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: MapObstacle): void {
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
}
