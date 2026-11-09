import { describe, expect, it } from "vitest";
import {
  circleContactFraction,
  createMapObstacles,
  mapObstacleHitFraction,
} from "../src/engine/battleMaps";
import { acquireMountTarget, mountPosition } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { obstacleFlankingVelocity } from "../src/engine/flightControl";
import {
  obstacleCourseCorrection,
  obstacleFlankingWaypoint,
} from "../src/engine/obstacleNavigation";
import { activeShieldRadius } from "../src/engine/shieldGeometry";
import { ShieldHavenSystem } from "../src/engine/shieldHaven";
import { updateShipNavigation } from "../src/engine/shipNavigationSystem";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass) {
  const result = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], 0, 0, 0)[0];
  result.pos = [0, 0];
  result.velocity = [0, 0];
  return result;
}

describe("predictive obstacle sphere casting", () => {
  it("routes ingress tangent to a friendly capital shield before reaching it", () => {
    const craft = ship("strike_craft");
    const capital = ship("battleship");
    capital.pos = [500, 0];
    const correction = obstacleCourseCorrection(craft, [craft, capital], 200, 0);
    expect(Math.abs(correction)).toBeGreaterThan(0.2);
    expect(
      obstacleCourseCorrection(
        craft,
        [capital],
        200 * Math.cos(correction),
        200 * Math.sin(correction),
      ),
    ).toBe(0);
  });

  it("predicts a crossing capital and ignores one moving away faster", () => {
    const craft = ship("strike_craft");
    const capital = ship("battleship");
    capital.pos = [400, 400];
    capital.velocity = [0, -200];
    expect(Math.abs(obstacleCourseCorrection(craft, [capital], 200, 0))).toBeGreaterThan(0);
    capital.pos = [400, 0];
    capital.velocity = [300, 0];
    expect(obstacleCourseCorrection(craft, [capital], 200, 0)).toBe(0);
  });

  it("capitals ignore light craft but yield to massive debris", () => {
    const capital = ship("dreadnought");
    const obstacle = ship("corvette");
    obstacle.pos = [500, 0];
    expect(obstacleCourseCorrection(capital, [obstacle], 100, 0)).toBe(0);
    obstacle.isDebris = true;
    obstacle.isAlive = false;
    obstacle.size = 100;
    expect(Math.abs(obstacleCourseCorrection(capital, [obstacle], 100, 0))).toBeGreaterThan(0);
    obstacle.pos = [2000, 0];
    expect(obstacleCourseCorrection(capital, [obstacle], 100, 0)).toBe(0);
  });
});

describe("direct-fire obstacle flanking", () => {
  it("extends a tangent waypoint outside the cruiser clearance envelope", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship");
    cruiser.pos = [-600, 0];
    target.pos = [600, 0];
    const obstacles = createMapObstacles("megaboulder");
    const waypoint = obstacleFlankingWaypoint(cruiser, target, obstacles);
    expect(waypoint).not.toBeNull();
    if (!waypoint) throw new Error("Missing flanking waypoint");
    expect(Math.abs(waypoint[1])).toBeGreaterThan(obstacles[0].radius);
    const clearance = activeShieldRadius(cruiser) + obstacles[0].radius + 60;
    // A tangent may contact the envelope, but must never cross its interior.
    expect(
      circleContactFraction(
        cruiser.pos[0],
        cruiser.pos[1],
        waypoint[0] - cruiser.pos[0],
        waypoint[1] - cruiser.pos[1],
        clearance - 1e-6,
      ),
    ).toBe(Infinity);
    expect(obstacleFlankingWaypoint(cruiser, target, obstacles)).toEqual(waypoint);
  });

  it("leaves clear firing lines and missile-only hulls on their existing course", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship");
    cruiser.pos = [-600, 500];
    target.pos = [600, 500];
    const obstacles = createMapObstacles("megaboulder");
    expect(obstacleFlankingVelocity(cruiser, target, obstacles)).toBeNull();
    expect(obstacleFlankingVelocity(cruiser, target, [])).toBeNull();
    const frigate = ship("missile_frigate");
    frigate.pos = [-600, 0];
    target.pos = [600, 0];
    expect(obstacleFlankingVelocity(frigate, target, obstacles)).toBeNull();
  });

  it("also flanks when only the predicted firing line is obscured", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship");
    cruiser.pos = [-600, 500];
    target.pos = [600, 500];
    const obstacles = createMapObstacles("megaboulder");
    expect(mapObstacleHitFraction(obstacles, cruiser.pos, target.pos)).toBe(Infinity);
    expect(
      obstacleFlankingWaypoint(cruiser, target, obstacles, cruiser.pos, [600, -500]),
    ).not.toBeNull();
  });

  it("bounds incoming cruiser momentum while preserving boundary-orbit thrust", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship");
    const obstacles = createMapObstacles("megaboulder");
    const clearance = activeShieldRadius(cruiser) + obstacles[0].radius + 60;
    cruiser.pos = [-clearance, 0];
    cruiser.heading = 0;
    cruiser.velocity = [cruiser.maxSpeed, 0];
    target.id = "enemy";
    target.team = 1;
    target.pos = [600, 0];
    const ships = [cruiser, target];
    updateShipNavigation(
      cruiser,
      target,
      ships,
      1 / 60,
      {
        shieldHaven: new ShieldHavenSystem(),
        orders: new Map(),
        timeElapsed: 0,
        projectiles: [],
        ships,
        mapObstacles: obstacles,
      },
      () => ({ heading: 0, speed: 0 }),
    );
    expect(Math.hypot(...cruiser.pos)).toBeGreaterThanOrEqual(clearance);
    expect(cruiser.velocity[0]).toBeCloseTo(0);
    expect(Math.abs(cruiser.velocity[1])).toBeGreaterThan(0);
  });

  it.each([600, 1200])(
    "flies a cruiser around an asteroid and reacquires a firing solution from %s units away",
    (distance) => {
      const cruiser = ship("cruiser");
      const target = ship("battleship");
      cruiser.pos = [-distance, 0];
      cruiser.heading = 0;
      target.id = "enemy";
      target.team = 1;
      target.pos = [600, 0];
      const ships = [cruiser, target];
      const obstacles = createMapObstacles("megaboulder");
      const gun = cruiser.turrets.find((turret) => turret.weapon.weaponType === "beam_laser");
      if (!gun) throw new Error("Missing cruiser primary gun");
      expect(acquireMountTarget(cruiser, gun, target, ships, [], [], obstacles)).toBeNull();
      const context = {
        shieldHaven: new ShieldHavenSystem(),
        orders: new Map(),
        timeElapsed: 0,
        projectiles: [],
        ships,
        mapObstacles: obstacles,
      };
      let minimumDistance = distance;
      let solution = null;
      const dt = 1 / 60;
      for (let frame = 0; frame < 60 * 40; frame++) {
        context.timeElapsed = frame * dt;
        updateShipNavigation(cruiser, target, ships, dt, context, () => ({ heading: 0, speed: 0 }));
        minimumDistance = Math.min(minimumDistance, Math.hypot(...cruiser.pos));
        expect(Math.hypot(...cruiser.velocity)).toBeLessThanOrEqual(cruiser.maxSpeed + 1e-9);
        solution = acquireMountTarget(cruiser, gun, target, ships, [], [], obstacles);
        if (solution) break;
      }
      expect(minimumDistance).toBeGreaterThanOrEqual(
        activeShieldRadius(cruiser) + obstacles[0].radius + 60 - 1e-6,
      );
      expect(Math.abs(cruiser.pos[1])).toBeGreaterThan(obstacles[0].radius);
      expect(solution).not.toBeNull();
      expect(mapObstacleHitFraction(obstacles, mountPosition(cruiser, gun), target.pos)).toBe(
        Infinity,
      );
      expect(obstacleFlankingVelocity(cruiser, target, obstacles)).toBeNull();
    },
  );
});
