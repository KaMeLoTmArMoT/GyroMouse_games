import { describe, expect, it } from "vitest";
import { PerformanceSamples } from "./PerformanceHud";

describe("performance frame sampling", () => {
  it("averages alternating refresh intervals without hiding raw low-FPS samples", () => {
    const samples = new PerformanceSamples();
    for (let i = 0; i < 40; i++) samples.addFrame(i % 2 === 0 ? 8 : 17);

    expect(samples.graphFrames).toHaveLength(10);
    expect(samples.graphFrames.every((frame) => frame === 12.5)).toBe(true);
    expect(samples.frames).toContain(17);
    expect(samples.frames).toContain(8);
  });

  it("preserves a long stall's duration and ignores invalid frame intervals", () => {
    const samples = new PerformanceSamples();
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 250]) {
      samples.addFrame(duration);
    }
    expect(samples.frames).toEqual([250]);
    expect(samples.graphFrames).toEqual([250, 250, 250, 250, 250]);
    for (let i = 0; i < 4; i++) samples.addFrame(12.5);
    expect(samples.graphFrames).toEqual([250, 250, 250, 250, 250, 12.5]);
  });
});
