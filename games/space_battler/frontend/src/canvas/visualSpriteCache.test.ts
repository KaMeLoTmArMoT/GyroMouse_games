import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapObstacles } from "../engine/battleMaps";
import { shieldGlowSprite } from "./glowSprites";
import { renderMapObstacles } from "./obstacleRenderer";

function context() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const ctx = new Proxy(
    {},
    {
      get(_, property) {
        const name = String(property);
        if (!calls.has(name)) {
          calls.set(
            name,
            vi.fn(() => {
              if (name === "getTransform") return { a: 1, b: 0, c: 0, d: 0.5 };
              if (name.includes("Gradient")) return { addColorStop: vi.fn() };
            }),
          );
        }
        return calls.get(name);
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("visual sprite caching", () => {
  it("reuses a shield glow for the same charge bucket and handles missing canvas support", () => {
    const canvasContext = context();
    const createElement = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => canvasContext.ctx,
    }));
    vi.stubGlobal("document", { createElement });

    const first = shieldGlowSprite(0.631);
    expect(shieldGlowSprite(0.632)).toBe(first);
    expect(shieldGlowSprite(0.75)).not.toBe(first);
    expect(createElement).toHaveBeenCalledTimes(2);
    expect(canvasContext.calls.get("createRadialGradient")).toHaveBeenCalledTimes(2);

    vi.stubGlobal("document", undefined);
    expect(shieldGlowSprite(0.631)).toBeNull();
  });

  it("reuses flat asteroid geometry across position, pitch, and rotation changes", () => {
    const baked: ReturnType<typeof context>[] = [];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          const result = context();
          baked.push(result);
          return result.ctx;
        }
      },
    );
    const [asteroid] = createMapObstacles("megaboulder");
    asteroid.radius = 123.45;
    const view = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const { ctx, calls } = context();

    renderMapObstacles(ctx, [asteroid], view, Math.PI / 3);
    asteroid.pos = [100, 50];
    renderMapObstacles(ctx, [asteroid], view, Math.PI / 3);
    expect(baked).toHaveLength(1);
    expect(calls.get("drawImage")?.mock.calls[0][0]).toBe(calls.get("drawImage")?.mock.calls[1][0]);
    expect(baked[0].calls.get("createLinearGradient")).toHaveBeenCalledTimes(1);
    expect(baked[0].calls.get("ellipse")).toHaveBeenCalledTimes(3);

    asteroid.rotation = 0.2;
    renderMapObstacles(ctx, [asteroid], view, Math.PI / 3);
    renderMapObstacles(ctx, [asteroid], view, Math.PI / 4);
    expect(baked).toHaveLength(1);

    asteroid.rotationSpeed = 0.1;
    renderMapObstacles(ctx, [asteroid], view, Math.PI / 4);
    expect(baked).toHaveLength(1);
    expect(calls.get("drawImage")).toHaveBeenCalledTimes(5);
    for (const [image] of calls.get("drawImage")?.mock.calls ?? []) {
      expect(image).toBe(calls.get("drawImage")?.mock.calls[0][0]);
    }

    vi.stubGlobal("OffscreenCanvas", undefined);
    renderMapObstacles(ctx, [asteroid], view, Math.PI / 4);
    expect(calls.get("createLinearGradient")).toHaveBeenCalledTimes(1);
    expect(calls.get("ellipse")).toHaveBeenCalledTimes(3);
  });

  it("reuses a rotating station sprite without resolution jitter at a zoom boundary", () => {
    const getContext = vi.fn(() => context().ctx);
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext = getContext;
      },
    );
    const [station] = createMapObstacles("orbital_station");
    const view = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const { ctx, calls } = context();
    renderMapObstacles(ctx, [station], view);
    station.rotation = 0.5;
    vi.mocked(ctx.getTransform).mockReturnValue({
      a: 1.0000000000000002,
      b: 0,
      c: 0,
      d: 0.5,
    } as DOMMatrix);
    renderMapObstacles(ctx, [station], view);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(calls.get("drawImage")?.mock.calls[0][0]).toBe(calls.get("drawImage")?.mock.calls[1][0]);
  });
});
