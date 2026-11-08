import { describe, expect, it } from "vitest";
import {
  CollisionContactSolver,
  wreckImpactDamage,
  wreckMassFactor,
} from "../src/engine/collisionContactSolver";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HULL_PROFILES } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass } from "../src/types/combat";

function fixture(hullClass: HullClass = "cruiser") {
  const vessel = buildFleetFromSlots([{ id: "vessel", hullClass, groupId: 1 }], 0, 0, 0)[0];
  vessel.pos = [0, 0];
  vessel.velocity = [0, 0];
  vessel.turrets = [];
  const sim = new ClientCombatSimulation();
  sim.addShip(vessel);
  const parent = {
    ...vessel,
    id: "capital",
    hullClass: "cruiser" as const,
    size: HULL_PROFILES.cruiser.size,
  };
  sim.spawnCapitalWrecks(parent);
  const wreck = sim.ships.find((ship) => ship.isDebris);
  if (!wreck) throw new Error("Missing wreck fixture");
  wreck.pos = [vessel.size + wreck.size - 1, 0];
  wreck.velocity = [-5, 0];
  // Long durability isolates vessel absorption and contact latching from fragmentation.
  wreck.hullCurrent = wreck.hullMax = 10000;
  const solver = new CollisionContactSolver(sim, (ship, team) =>
    sim["weapons"].destroyShip(ship, team),
  );
  return { vessel, wreck, sim, solver };
}

describe("capital wreck kinetic impact", () => {
  it.each([false, true])(
    "uses pre-contact relative speed in either pair order (reverse=%s)",
    (reverse) => {
      const { vessel, wreck, solver } = fixture();
      vessel.velocity = [10, 3];
      wreck.velocity = [-5, -1];
      const damage = wreckImpactDamage(wreck, Math.hypot(15, 4));
      const shields = vessel.shieldCurrent;
      solver.resolveShipCollisions(reverse ? [wreck, vessel] : [vessel, wreck], 1 / 60, false);
      expect(vessel.shieldCurrent).toBeCloseTo(shields - damage);
      expect(vessel.armorCurrent).toBe(vessel.armorMax);
      expect(vessel.hullCurrent).toBe(vessel.hullMax);
      expect(wreck.hullCurrent).toBeCloseTo(wreck.hullMax - damage);
      expect(vessel.shieldDelayTimer).toBe(vessel.shieldRechargeDelay);
    },
  );

  it("scales impact energy with collider area, parent mass and relative speed", () => {
    const { wreck } = fixture();
    const mass = wreckMassFactor(wreck);
    const damage = wreckImpactDamage(wreck, 10);
    wreck.size *= 2;
    expect(wreckMassFactor(wreck)).toBeCloseTo(mass * 4);
    expect(wreckImpactDamage(wreck, 10)).toBeCloseTo(damage * 4);
    expect(wreckImpactDamage(wreck, 20)).toBeCloseTo(damage * 4 * 2 ** 1.5);
    const heavy = {
      ...wreck,
      hullClass: "dreadnought" as const,
      size: HULL_PROFILES.dreadnought.size * 0.28,
    };
    expect(wreckMassFactor(heavy)).toBeGreaterThan(mass);
  });

  it("passes a single impact's overflow through shields, armor and hull", () => {
    const { vessel, wreck, solver } = fixture();
    vessel.shieldCurrent = 3;
    vessel.armorCurrent = 4;
    const damage = wreckImpactDamage(wreck, 5);
    solver.resolveShipCollisions([vessel, wreck], 1 / 60, false);
    expect(vessel.shieldCurrent).toBe(0);
    expect(vessel.armorCurrent).toBe(0);
    expect(vessel.hullCurrent).toBeCloseTo(vessel.hullMax - (damage - 7));
  });

  it("does not repeatedly charge sustained contact, but counts a separated re-impact", () => {
    const { vessel, wreck, solver } = fixture();
    const ships = [vessel, wreck];
    const damage = wreckImpactDamage(wreck, 5);
    const resetContact = () => {
      wreck.pos = [vessel.pos[0] + vessel.size + wreck.size - 1, vessel.pos[1]];
      vessel.velocity = [0, 0];
      wreck.velocity = [-5, 0];
    };
    solver.resolveShipCollisions(ships, 1 / 60, false);
    const shields = vessel.shieldCurrent;
    resetContact();
    solver.resolveShipCollisions(ships, 1 / 60, false);
    solver.resolveShipCollisions(ships, 1 / 60, true);
    expect(vessel.shieldCurrent).toBe(shields);
    wreck.pos = [1000, 0];
    solver.resolveShipCollisions(ships, 1 / 60, false);
    resetContact();
    solver.resolveShipCollisions(ships, 1 / 60, false);
    expect(vessel.shieldCurrent).toBeCloseTo(shields - damage);
  });

  it("does not damage co-moving, separating, or wreck-only pairs", () => {
    for (const speed of [0, 5]) {
      const { vessel, wreck, solver } = fixture();
      wreck.velocity = [speed, 0];
      solver.resolveShipCollisions([vessel, wreck], 1 / 60, false);
      expect(vessel.shieldCurrent).toBe(vessel.shieldMax);
      expect(wreck.hullCurrent).toBe(wreck.hullMax);
    }
    const { vessel, wreck, solver } = fixture();
    vessel.isDebris = true;
    solver.resolveShipCollisions([vessel, wreck], 1 / 60, false);
    expect(wreck.hullCurrent).toBe(wreck.hullMax);
  });

  it("disintegrates accumulated wreck damage and destroys a crushed ship without recursive debris", () => {
    const { vessel, wreck, sim, solver } = fixture("strike_craft");
    wreck.hullCurrent = 1;
    wreck.velocity = [-100, 0];
    const wreckCount = sim.ships.filter((ship) => ship.isDebris).length;
    solver.resolveShipCollisions([vessel, wreck], 1 / 60, false);
    expect(wreck.hullCurrent).toBe(0);
    expect(wreck.isAlive).toBe(false);
    expect(vessel.isAlive).toBe(false);
    expect(sim.ships.filter((ship) => ship.isDebris)).toHaveLength(wreckCount);
    expect(sim.stats[0].shipsLost).toBe(1);
    expect(sim.stats[1].damageDealt).toBe(0);
  });
});
