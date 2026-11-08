import type { MapObstacle } from "../engine/battleMaps";
import { discVisible, type Viewport } from "./viewport";

const obstacleSprites = new Map<string, { canvas: OffscreenCanvas; width: number }>();

export function renderMapObstacles(
  ctx: CanvasRenderingContext2D,
  obstacles: readonly MapObstacle[],
  viewport: Viewport,
  elevation = Math.PI / 2,
): void {
  const depth = Math.cos(elevation) / Math.sin(elevation);
  for (const obstacle of obstacles) {
    const lift = obstacle.kind === "asteroid" ? obstacle.radius * 0.48 * depth : 0;
    if (!discVisible(viewport, obstacle.pos, obstacle.radius + lift + 3)) continue;
    ctx.save();
    ctx.translate(...obstacle.pos);
    ctx.rotate(obstacle.rotation);
    if (!drawCachedObstacle(ctx, obstacle, elevation, lift)) {
      drawObstacle(ctx, obstacle, elevation, lift);
    }
    ctx.restore();
  }
}

function drawCachedObstacle(
  ctx: CanvasRenderingContext2D,
  obstacle: MapObstacle,
  elevation: number,
  lift: number,
): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  // Asteroid facets depend on their rotation relative to the camera. Avoid
  // rebaking them continuously if a map gives an asteroid a rotation speed.
  if (obstacle.kind === "asteroid" && obstacle.rotationSpeed !== 0) return false;
  const transform = ctx.getTransform();
  const sum = transform.a ** 2 + transform.b ** 2 + transform.c ** 2 + transform.d ** 2;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  const scale = Number(
    Math.sqrt((sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * determinant ** 2))) / 2).toPrecision(6),
  );
  const extent = obstacle.radius + lift + 4;
  const resolution = Math.min(1536 / (extent * 2), Math.max(0.5, 2 ** Math.ceil(Math.log2(scale))));
  const key = JSON.stringify([
    obstacle.kind,
    obstacle.radius,
    obstacle.kind === "asteroid" ? obstacle.id.length % 5 : 0,
    obstacle.kind === "asteroid" ? obstacle.rotation : 0,
    obstacle.kind === "asteroid" ? elevation : 0,
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
    drawObstacle(offscreen as unknown as CanvasRenderingContext2D, obstacle, elevation, lift);
    sprite = { canvas, width: pixels / resolution };
    const oldest = obstacleSprites.keys().next().value;
    if (obstacleSprites.size >= 8 && oldest !== undefined) obstacleSprites.delete(oldest);
    obstacleSprites.set(key, sprite);
  }
  ctx.drawImage(sprite.canvas, -sprite.width / 2, -sprite.width / 2, sprite.width, sprite.width);
  return true;
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obstacle: MapObstacle,
  elevation: number,
  lift: number,
): void {
  const r = obstacle.radius;
  if (obstacle.kind === "asteroid") {
    // Vertical height stays in camera space even when the asteroid rotates.
    const upX = -Math.sin(obstacle.rotation) * lift;
    const upY = -Math.cos(obstacle.rotation) * lift;
    const capScale = 1 - 0.24 * Math.cos(elevation);
    const vertices: [number, number][] = [];
    for (let i = 0; i < 13; i++) {
      const angle = (i * Math.PI * 2) / 13;
      const edge = r * (0.84 + (0.16 * ((i * 7 + obstacle.id.length) % 5)) / 4);
      vertices.push([Math.cos(angle) * edge, Math.sin(angle) * edge]);
    }

    if (lift > 0.01) {
      // Far faces first, then the nearer facets, with the raised cap above them.
      const facets = vertices.map((point, i) => {
        const next = vertices[(i + 1) % vertices.length];
        const worldY = (x: number, y: number) =>
          x * Math.sin(obstacle.rotation) + y * Math.cos(obstacle.rotation);
        return { point, next, depth: worldY(point[0] + next[0], point[1] + next[1]) };
      });
      facets.sort((a, b) => a.depth - b.depth);
      for (const { point, next } of facets) {
        const edgeX = next[0] - point[0];
        const edgeY = next[1] - point[1];
        const light = Math.max(0, (-edgeY - edgeX * 0.45) / Math.hypot(edgeX, edgeY));
        const midX = (point[0] + next[0]) / 2;
        const midY = (point[1] + next[1]) / 2;
        const side = ctx.createLinearGradient(
          midX * capScale + upX,
          midY * capScale + upY,
          midX,
          midY,
        );
        side.addColorStop(
          0,
          `rgb(${Math.round(66 + light * 32)}, ${Math.round(74 + light * 32)}, ${Math.round(81 + light * 31)})`,
        );
        side.addColorStop(1, "#171d25");
        ctx.beginPath();
        ctx.moveTo(point[0], point[1]);
        ctx.lineTo(next[0], next[1]);
        ctx.lineTo(next[0] * capScale + upX, next[1] * capScale + upY);
        ctx.lineTo(point[0] * capScale + upX, point[1] * capScale + upY);
        ctx.closePath();
        ctx.fillStyle = side;
        ctx.fill();
        ctx.strokeStyle = "rgba(13, 19, 27, 0.35)";
        ctx.lineWidth = Math.max(0.5, r * 0.006);
        ctx.stroke();
      }
    }

    if (lift > 0.01) {
      ctx.translate(upX, upY);
      ctx.scale(capScale, capScale);
    }
    const gradient = ctx.createLinearGradient(-r, -r, r, r);
    gradient.addColorStop(0, "#6c7379");
    gradient.addColorStop(0.45, "#343b42");
    gradient.addColorStop(1, "#161c25");
    ctx.beginPath();
    for (let i = 0; i < vertices.length; i++) {
      const [x, y] = vertices[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "#87929a";
    ctx.lineWidth = Math.max(1, r * 0.012);
    ctx.stroke();
    if (lift > 0.01) {
      ctx.save();
      ctx.clip();
      for (let i = 0; i < vertices.length; i++) {
        const [x, y] = vertices[i];
        const [nextX, nextY] = vertices[(i + 1) % vertices.length];
        ctx.beginPath();
        ctx.moveTo(-r * 0.08, -r * 0.12);
        ctx.lineTo(x, y);
        ctx.lineTo(nextX, nextY);
        ctx.closePath();
        ctx.fillStyle = i % 3 === 0 ? "rgba(192, 205, 211, 0.07)" : "rgba(8, 13, 20, 0.06)";
        ctx.fill();
      }
      ctx.restore();
    }
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
      if (lift > 0.01) {
        // A recessed crater floor shifts towards the viewer as the camera tilts.
        ctx.beginPath();
        ctx.ellipse(
          x * r - (upX / capScale) * size * 0.25,
          y * r - (upY / capScale) * size * 0.25,
          size * r * 0.72,
          size * r * 0.48,
          -0.3,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "rgba(5, 10, 17, 0.25)";
        ctx.fill();
      }
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
