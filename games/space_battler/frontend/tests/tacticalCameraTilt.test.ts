import { describe, expect, it } from "vitest";
import { projectileAtPoint } from "../src/canvas/projectileSelection";
import {
  clampCameraPitch,
  pitchVerticalScale,
  screenToWorldPoint,
} from "../src/canvas/TacticalCanvas";
import { worldViewport } from "../src/canvas/viewport";
import type { ProjectileState } from "../src/types/combat";

describe("tactical camera projection", () => {
  it("clamps pitch and projects the vertical axis", () => {
    expect(clampCameraPitch(-50)).toBe(25);
    expect(clampCameraPitch(120)).toBe(90);
    expect(clampCameraPitch(45)).toBe(45);
    expect(pitchVerticalScale(90)).toBe(1);
    expect(pitchVerticalScale(30)).toBeCloseTo(0.5);
  });

  it.each([90, 60, 30, 25])("inverts a panned and zoomed %s° projection", (pitchDeg) => {
    const camera = { x: 50, y: -80, zoom: 1.7, pitchDeg };
    const scale = pitchVerticalScale(pitchDeg);
    const world = [230, -140];
    const x = 400 + camera.x + world[0] * camera.zoom;
    const y = 300 + (camera.y + world[1] * camera.zoom) * scale;
    const result = screenToWorldPoint(x, y, 800, 600, camera);
    expect(result[0]).toBeCloseTo(world[0]);
    expect(result[1]).toBeCloseTo(world[1]);
  });

  it("includes the visible world at the tilted viewport edges", () => {
    const camera = { x: 80, y: -50, zoom: 0.8, pitchDeg: 30 };
    const viewport = worldViewport(800, 600 / pitchVerticalScale(camera.pitchDeg), camera);
    const top = screenToWorldPoint(0, 0, 800, 600, camera);
    const bottom = screenToWorldPoint(800, 600, 800, 600, camera);
    expect(viewport.minX).toBeLessThan(top[0]);
    expect(viewport.minY).toBeLessThan(top[1]);
    expect(viewport.maxX).toBeGreaterThan(bottom[0]);
    expect(viewport.maxY).toBeGreaterThan(bottom[1]);
  });

  it("uses projected pixel distances for missile selection", () => {
    const camera = { x: 20, y: -30, zoom: 2, pitchDeg: 30 };
    const scale = pitchVerticalScale(camera.pitchDeg);
    const missile = {
      id: "missile",
      pos: [100, 200],
      weaponType: "missile",
      hp: 1,
      lifetime: 1,
    } as ProjectileState;
    const x = 400 + camera.x + missile.pos[0] * camera.zoom;
    const y = 300 + (camera.y + missile.pos[1] * camera.zoom) * scale;
    const [worldX, worldY] = screenToWorldPoint(x, y + 24, 800, 600, camera);
    expect(
      projectileAtPoint([missile], worldX, worldY, camera.zoom, camera.zoom * scale, false),
    ).toBe("missile");
    const [outsideX, outsideY] = screenToWorldPoint(x, y + 26, 800, 600, camera);
    expect(
      projectileAtPoint([missile], outsideX, outsideY, camera.zoom, camera.zoom * scale, false),
    ).toBeNull();
  });
});
