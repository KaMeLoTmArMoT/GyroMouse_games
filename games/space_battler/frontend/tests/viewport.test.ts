import { describe, expect, it } from "vitest";
import { discVisible, segmentVisible, worldViewport } from "../src/canvas/viewport";

describe("canvas viewport culling", () => {
  it("inverts camera translation and zoom and adds world-space padding", () => {
    expect(worldViewport(800, 600, { x: 100, y: -50, zoom: 2 })).toEqual({
      minX: -430,
      maxX: 330,
      minY: -305,
      maxY: 355,
    });
  });

  it("keeps intersecting discs and crossing beams, including their margins", () => {
    const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(discVisible(view, [-10, 50], 10)).toBe(true);
    expect(discVisible(view, [-11, 50], 10)).toBe(false);
    expect(segmentVisible(view, [-100, 50], [200, 50], 0)).toBe(true);
    expect(segmentVisible(view, [-100, -11], [200, -11], 10)).toBe(false);
    expect(segmentVisible(view, [-100, -10], [200, -10], 10)).toBe(true);
  });
});
