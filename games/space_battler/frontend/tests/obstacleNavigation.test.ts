import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { obstacleCourseCorrection } from "../src/engine/obstacleNavigation";
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
