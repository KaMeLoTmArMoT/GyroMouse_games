export interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Keep projected paths in place while stroking them with an isotropic pen. */
export function strokeWithoutPitch(ctx: CanvasRenderingContext2D, verticalScale: number): void {
  ctx.save();
  ctx.scale(1, 1 / verticalScale);
  ctx.stroke();
  ctx.restore();
}

/** Projectile overlays construct their paths in world coordinates. */
export function unpitchedStrokeContext(
  ctx: CanvasRenderingContext2D,
  verticalScale: number,
): CanvasRenderingContext2D {
  if (verticalScale >= 0.9999) return ctx;
  return new Proxy(ctx, {
    get(target, property) {
      if (property === "stroke") return () => strokeWithoutPitch(target, verticalScale);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

export function worldViewport(
  width: number,
  height: number,
  camera: { x: number; y: number; zoom: number },
): Viewport {
  const padding = 180;
  return {
    minX: (-width / 2 - camera.x) / camera.zoom - padding,
    maxX: (width / 2 - camera.x) / camera.zoom + padding,
    minY: (-height / 2 - camera.y) / camera.zoom - padding,
    maxY: (height / 2 - camera.y) / camera.zoom + padding,
  };
}

export function discVisible(view: Viewport, pos: readonly number[], radius: number): boolean {
  return (
    pos[0] + radius >= view.minX &&
    pos[0] - radius <= view.maxX &&
    pos[1] + radius >= view.minY &&
    pos[1] - radius <= view.maxY
  );
}

export function segmentVisible(
  view: Viewport,
  from: readonly number[],
  to: readonly number[],
  radius: number,
): boolean {
  return (
    Math.max(from[0], to[0]) + radius >= view.minX &&
    Math.min(from[0], to[0]) - radius <= view.maxX &&
    Math.max(from[1], to[1]) + radius >= view.minY &&
    Math.min(from[1], to[1]) - radius <= view.maxY
  );
}
