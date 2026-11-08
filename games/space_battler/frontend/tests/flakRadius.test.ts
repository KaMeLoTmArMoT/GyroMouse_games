import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
  CORVETTE_FLAK_THREAT_RADIUS,
  prepareNavigationContext,
} from "../src/engine/navigationContext";
import { findNavigationTarget, hostileFlakThreats } from "../src/engine/shipNavigationSystem";
import { flakThreatRadius } from "../src/engine/shipProfiles";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, x: number, team: number) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [x, 0];
  return result;
}

describe("relative corvette flak screening radius", () => {
  it("derives the nominal radius from muzzle, gun range, blast and hull clearance", () => {
    const corvette = ship("corvette", "flak", 0, 1);
    const gun = corvette.turrets[0];
    const expected =
      gun.weapon.range + Math.hypot(...gun.offset) + gun.barrelLength + 30 + corvette.size * 6;
    expect(CORVETTE_FLAK_THREAT_RADIUS).toBeCloseTo(expected);
    expect(flakThreatRadius(corvette)).toBeCloseTo(expected);
    corvette.size *= 2;
    expect(flakThreatRadius(corvette)).toBeCloseTo(expected + 120);
    gun.weapon.range += 500;
    expect(flakThreatRadius(corvette)).toBeCloseTo(expected + 620);
    corvette.turrets = [];
    expect(flakThreatRadius(corvette)).toBe(0);
  });

  it("keeps cached and uncached safety consistent after a range refit", () => {
    const fighter = ship("strike_craft", "fighter", -300, 0);
    const screened = ship("carrier", "screened", 0, 1);
    const safe = ship("carrier", "safe", -1500, 1);
    const flak = [ship("corvette", "flak1", 750, 1), ship("corvette", "flak2", 760, 1)];
    for (const corvette of flak) {
      for (const turret of corvette.turrets) turret.weapon.range = 900;
    }
    const order = { groupId: 1, priority: "capitals", stance: "optimal_range" } as const;
    const ships = [fighter, screened, safe, ...flak];
    expect(findNavigationTarget(fighter, order, ships)).toBe(safe);
    const context = prepareNavigationContext(ships);
    expect(context.safe.get(screened)).toBe(false);
    expect(findNavigationTarget(fighter, order, ships)).toBe(safe);
    expect(hostileFlakThreats(screened, [fighter, ...flak])).toEqual([]);
    expect(hostileFlakThreats(fighter, flak)).toEqual(flak);
  });
});
