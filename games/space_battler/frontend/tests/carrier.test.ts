import { describe, expect, it } from "vitest";
import { carrierRecoveryPoint } from "../src/engine/carrierHangar";
import {
  buildFleetFromSlots,
  fleetSlotCost,
  redeployFleetRemnants,
} from "../src/engine/fleetBuilder";
import { isCapitalShip } from "../src/engine/shieldGeometry";
import { HULL_PROFILES, pointDefenseMode } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";

describe("carrier fleet loadout", () => {
  function battle(wingSize: 8 | 16) {
    const ships = buildFleetFromSlots(
      [{ id: "carrier", groupId: 1, hullClass: "carrier", wingSize, escortCount: 2 }],
      0,
      0,
      0,
    );
    const enemy = buildFleetFromSlots(
      [{ id: "enemy", groupId: 2, hullClass: "battleship" }],
      1,
      8000,
      Math.PI,
    )[0];
    const sim = new ClientCombatSimulation();
    for (const ship of [...ships, enemy]) {
      ship.turrets = [];
      ship.maxSpeed = 0;
      sim.addShip(ship);
    }
    return {
      sim,
      carrier: ships[0],
      fighters: ships.filter((ship) => ship.hullClass === "strike_craft"),
      escorts: ships.filter((ship) => ship.hullClass === "corvette"),
    };
  }

  function advance(sim: ClientCombatSimulation, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 60); i++) sim.update(1 / 60);
  }

  it.each([8, 16] as const)("launches a %i-craft wing in eight-craft deck waves", (size) => {
    const { sim, carrier, fighters, escorts } = battle(size);
    expect(
      fighters.every(
        (ship) => ship.isDocked && ship.pos[0] === carrier.pos[0] && ship.pos[1] === carrier.pos[1],
      ),
    ).toBe(true);
    advance(sim, 29 / 60);
    expect(escorts.every((ship) => ship.isDocked)).toBe(true);
    advance(sim, 1 / 60);
    expect(escorts.every((ship) => !ship.isDocked)).toBe(true);
    advance(sim, 29 / 60);
    expect(fighters.every((ship) => ship.isDocked)).toBe(true);
    advance(sim, 1 / 60);
    expect(fighters.filter((ship) => !ship.isDocked)).toHaveLength(8);
    advance(sim, 149 / 60);
    expect(fighters.filter((ship) => !ship.isDocked)).toHaveLength(8);
    advance(sim, 1 / 60);
    expect(fighters.filter((ship) => !ship.isDocked)).toHaveLength(size);
  });

  it("stores damaged craft internally for exactly 4.5 seconds and repairs on relaunch", () => {
    const { sim, carrier, fighters } = battle(8);
    advance(sim, 1);
    const craft = fighters[0];
    craft.hullCurrent = craft.hullMax * 0.2;
    craft.armorCurrent = craft.armorMax * 0.1;
    craft.shieldCurrent = 0;
    craft.pos = carrierRecoveryPoint(carrier, craft);
    craft.velocity = [...carrier.velocity];
    advance(sim, 1 / 60);
    expect(craft.isDocked).toBe(false);
    advance(sim, 0.7);
    expect(craft.isDocked).toBe(true);
    expect(craft.pos).toEqual(carrier.pos);
    advance(sim, 269 / 60);
    expect(craft.isDocked).toBe(true);
    expect(craft.hullCurrent).toBeCloseTo(craft.hullMax * 0.2);
    advance(sim, 1 / 60);
    expect(craft.isDocked).toBe(false);
    expect(craft.shieldCurrent).toBe(craft.shieldMax);
    expect(craft.hullCurrent).toBeCloseTo(craft.hullMax * 0.7);
    expect(craft.armorCurrent).toBeCloseTo(craft.armorMax * 0.6);
    expect(craft.carrierRecovering).toBe(false);
  });

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
