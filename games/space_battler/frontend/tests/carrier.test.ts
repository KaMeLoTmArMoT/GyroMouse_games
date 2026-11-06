import { describe, expect, it } from "vitest";
import {
  buildFleetFromSlots,
  fleetSlotCost,
  redeployFleetRemnants,
} from "../src/engine/fleetBuilder";
import { isCapitalShip } from "../src/engine/shieldGeometry";
import { HULL_PROFILES, pointDefenseMode } from "../src/engine/shipProfiles";

describe("carrier fleet loadout", () => {
  it("charges the calibrated hull and optional auxiliaries", () => {
    const slot = { id: "carrier", groupId: 1, hullClass: "carrier" as const };
    expect(fleetSlotCost(slot)).toBe(3000);
    expect(fleetSlotCost({ ...slot, wingSize: 8 })).toBe(3960);
    expect(fleetSlotCost({ ...slot, wingSize: 16, escortCount: 2 })).toBe(5620);
    expect(HULL_PROFILES.carrier.turrets.map((mount) => pointDefenseMode(mount.weapon))).toEqual([
      "flak",
      "laser",
      "laser",
      "laser",
    ]);
    expect(isCapitalShip(slot)).toBe(true);
  });

  it.each([0, 1])(
    "deploys each carrier's paid craft for team %i and preserves survivors on redeploy",
    (team) => {
      const ships = buildFleetFromSlots(
        [
          { id: "a", groupId: 1, hullClass: "carrier", wingSize: 8, escortCount: 1 },
          { id: "b", groupId: 1, hullClass: "carrier", wingSize: 16, escortCount: 2 },
        ],
        team,
        0,
        team === 0 ? 0 : Math.PI,
      );
      const carriers = ships.filter((ship) => ship.hullClass === "carrier");
      expect(carriers).toHaveLength(2);
      expect(ships.filter((ship) => ship.hullClass === "strike_craft")).toHaveLength(24);
      expect(ships.filter((ship) => ship.hullClass === "corvette")).toHaveLength(3);
      expect(ships.filter((ship) => ship.flagshipId === carriers[0].id)).toHaveLength(9);
      expect(ships.filter((ship) => ship.flagshipId === carriers[1].id)).toHaveLength(18);
      const ids = ships.map((ship) => ship.id).sort();
      const assignments = ships.map((ship) => [ship.id, ship.flagshipId]);
      redeployFleetRemnants(ships);
      expect(ships.map((ship) => ship.id).sort()).toEqual(ids);
      expect(ships.map((ship) => [ship.id, ship.flagshipId])).toEqual(assignments);
    },
  );
});
