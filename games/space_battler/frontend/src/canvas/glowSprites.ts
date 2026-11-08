// A radial glow is reused as a three-slice strip for beams and missile plumes.
const sprites = new Map<string, HTMLCanvasElement>();
const size = 64;

function glowSprite(color: string): HTMLCanvasElement {
  const cached = sprites.get(color);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  sprites.set(color, canvas);
  return canvas;
}

export function drawGlowLine(
  ctx: CanvasRenderingContext2D,
  from: readonly number[],
  to: readonly number[],
  color: string,
  radius: number,
): void {
  const sprite = glowSprite(color);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  ctx.save();
  ctx.translate(from[0], from[1]);
  ctx.rotate(Math.atan2(to[1] - from[1], to[0] - from[0]));
  ctx.drawImage(sprite, 0, 0, 32, size, -radius, -radius, radius, radius * 2);
  if (length > 0) {
    ctx.drawImage(sprite, 31, 0, 2, size, 0, -radius, length, radius * 2);
  }
  ctx.drawImage(sprite, 32, 0, 32, size, length, -radius, radius, radius * 2);
  ctx.restore();
}
