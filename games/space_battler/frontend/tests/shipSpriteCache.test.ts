import { afterEach, describe, expect, it, vi } from "vitest";
import { ShipSpriteCache } from "../src/canvas/shipSpriteCache";

afterEach(() => vi.unstubAllGlobals());

describe("ship sprite cache", () => {
  it("lazily caches separately by hull and team and regenerates after clearing", () => {
    const context = {};
    const create = vi.fn(() => context);
    class Canvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext = create;
    }
    vi.stubGlobal("OffscreenCanvas", Canvas);
    const draw = vi.fn();
    const cache = new ShipSpriteCache(128, draw);
    expect(draw).not.toHaveBeenCalled();
    const first = cache.get("cruiser", 0);
    expect(cache.get("cruiser", 0)).toBe(first);
    expect(cache.get("cruiser", 1)).not.toBe(first);
    expect(cache.get("carrier", 0)).not.toBe(first);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(draw).toHaveBeenCalledWith(context, "cruiser", 0, 128);
    expect(first).toMatchObject({ width: 128, height: 128 });
    cache.clear();
    expect(cache.get("cruiser", 0)).not.toBe(first);
    expect(draw).toHaveBeenCalledTimes(4);
  });

  it("falls back without caching when offscreen rendering is unavailable", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const draw = vi.fn();
    const cache = new ShipSpriteCache(128, draw);
    expect(cache.get("cruiser", 0)).toBeNull();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => null;
      },
    );
    expect(cache.get("cruiser", 0)).toBeNull();
    expect(draw).not.toHaveBeenCalled();
  });
});
