import { describe, expect, it } from "vitest";
import { fleetAdvantage } from "../src/engine/fleetAdvantage";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, team: number) {
  return buildFleetFromSlots([{ id: "test", hullClass, groupId: 1 }], team, 0, 0)[0];
}

describe("fleet advantage", () => {
  it("compares class power and weighs shield, armor and hull damage", () => {
    const terran = ship("battleship", 0);
    const alien = ship("cruiser", 1);
    terran.shieldCurrent = 0;
    terran.armorCurrent = terran.armorMax / 2;
    terran.hullCurrent = terran.hullMax / 2;
    // 75 × (0.35 × 0.5 + 0.45 × 0.5) = 30, against 40.
    const [blue, red] = fleetAdvantage([terran, alien], null);
    expect(blue).toBeCloseTo((30 / 70) * 100);
    expect(red).toBeCloseTo((40 / 70) * 100);
  });

  it("counts newly added and docked craft, but excludes dead ships and debris", () => {
    const carrier = ship("carrier", 0);
    const craft = ship("strike_craft", 0);
    craft.isDocked = true;
    const enemy = ship("battleship", 1);
    const dead = { ...enemy, isAlive: false };
    const debris = { ...enemy, isDebris: true };
    const neutral = { ...enemy, team: -1 };
    const [blue] = fleetAdvantage([carrier, craft, enemy, dead, debris, neutral], null);
    expect(blue).toBeCloseTo((74 / 149) * 100);
  });

  it("handles empty fleets, missing defenses, and completed matches", () => {
    expect(fleetAdvantage([], null)).toEqual([0, 0]);
    const terran = ship("corvette", 0);
    terran.shieldMax = 0;
    terran.armorMax = 0;
    expect(fleetAdvantage([terran], null)).toEqual([100, 0]);
    expect(fleetAdvantage([terran], 1)).toEqual([0, 100]);
    expect(fleetAdvantage([], 0)).toEqual([100, 0]);
    expect(fleetAdvantage([terran, ship("corvette", 1)], -1)[0]).toBeCloseTo((0.45 / 1.45) * 100);
  });
});
