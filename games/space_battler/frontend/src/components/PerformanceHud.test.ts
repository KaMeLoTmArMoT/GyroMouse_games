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

  it("smooths refresh-phase aliasing while preserving actual slow frames", () => {
    const samples = new PerformanceSamples();
    // A 60 Hz render target on a 144 Hz display alternates two and three refreshes.
    for (let i = 0; i < 200; i++) samples.addFrame((1000 / 144) * (i % 2 === 0 ? 2 : 3));

    const steady = samples.graphFrames.slice(5);
    expect(Math.max(...steady) - Math.min(...steady)).toBeLessThan(1);
    expect(steady.reduce((sum, value) => sum + value, 0) / steady.length).toBeCloseTo(
      1000 / 57.6,
      1,
    );

    samples.addFrame(80);
    expect(samples.graphFrames.at(-1)).toBe(80);
    expect(samples.frames.at(-1)).toBe(80);
  });
});
