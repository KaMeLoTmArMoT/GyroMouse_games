// A radial glow is reused as a three-slice strip for beams and missile plumes.
const sprites = new Map<string, HTMLCanvasElement>();
const size = 64;
const shieldSprites = new Map<number, HTMLCanvasElement>();

/** Reuse a normalized shield gradient across radii and near-identical charge levels. */
export function shieldGlowSprite(strength: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const level = Math.round(Math.max(0, Math.min(1, strength)) * 64);
  const cached = shieldSprites.get(level);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const charge = level / 64;
  const glow = ctx.createRadialGradient(64, 64 - 64 * 0.12, 0, 64, 64, 64);
  glow.addColorStop(0, `rgba(125, 211, 252, ${0.025 + charge * 0.025})`);
  glow.addColorStop(0.68, `rgba(56, 189, 248, ${0.025 + charge * 0.035})`);
  glow.addColorStop(0.93, `rgba(103, 232, 249, ${0.09 + charge * 0.11})`);
  glow.addColorStop(1, `rgba(186, 245, 255, ${0.15 + charge * 0.2})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  shieldSprites.set(level, canvas);
  return canvas;
}

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
