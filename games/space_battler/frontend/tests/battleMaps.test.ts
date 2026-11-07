import { describe, expect, it, vi } from "vitest";
import { renderMapObstacles } from "../src/canvas/obstacleRenderer";
import { BATTLE_MAPS, createMapObstacles, resolveMapContacts } from "../src/engine/battleMaps";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { obstacleCourseCorrection } from "../src/engine/obstacleNavigation";
import { ClientCombatSimulation } from "../src/engine/simulation";

describe("battle arenas", () => {
  it("creates independent obstacle sets and keeps the default arena empty", () => {
    expect(new ClientCombatSimulation().mapObstacles).toEqual([]);
    for (const map of BATTLE_MAPS.slice(1)) {
      const first = new ClientCombatSimulation(map.id);
      const second = new ClientCombatSimulation(map.id);
      expect(first.mapObstacles.length).toBeGreaterThan(0);
      expect(first.mapObstacles).toEqual(second.mapObstacles);
      expect(first.mapObstacles[0]).not.toBe(second.mapObstacles[0]);
    }
  });

  it("moves orbiting obstacles on simulation steps", () => {
    const sim = new ClientCombatSimulation("drifting_field");
    const before = [...sim.mapObstacles[0].pos];
    sim.update(1 / 60);
    expect(sim.mapObstacles[0].pos).not.toEqual(before);
    expect(Math.hypot(...sim.mapObstacles[0].velocity)).toBeGreaterThan(0);
  });

  it("steers around obstacles and prevents ships from penetrating them", () => {
    const ship = buildFleetFromSlots(
      [{ id: "ship", hullClass: "corvette", groupId: 1 }],
      0,
      -600,
      0,
    )[0];
    ship.pos = [-600, 0];
    ship.velocity = [100, 0];
    const obstacles = createMapObstacles("megaboulder");
    expect(
      Math.abs(obstacleCourseCorrection(ship, [ship], 100, 0, null, obstacles)),
    ).toBeGreaterThan(0);
    ship.pos = [-300, 0];
    resolveMapContacts([ship], obstacles);
    expect(Math.hypot(...ship.pos)).toBeCloseTo(obstacles[0].radius + ship.size);
    expect(ship.velocity[0]).toBeCloseTo(0);
  });

  it("culls off-screen obstacles before issuing canvas drawing calls", () => {
    const ctx = { save: vi.fn() } as unknown as CanvasRenderingContext2D;
    const obstacles = createMapObstacles("megaboulder");
    renderMapObstacles(ctx, obstacles, { minX: 1000, minY: 1000, maxX: 1200, maxY: 1200 });
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("draws visible asteroids and stations in their world positions", () => {
    const gradient = { addColorStop: vi.fn() };
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const asteroid = createMapObstacles("megaboulder")[0];
    const station = createMapObstacles("orbital_ruins")[0];
    renderMapObstacles(ctx, [asteroid, station], {
      minX: -500,
      minY: -500,
      maxX: 500,
      maxY: 500,
    });
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.translate).toHaveBeenCalledWith(...asteroid.pos);
    expect(ctx.ellipse).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(4);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });
});
