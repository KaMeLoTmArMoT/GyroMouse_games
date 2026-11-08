import { describe, expect, it } from "vitest";
import {
  ARENA_RADIUS,
  applyArenaRadiation,
  arenaVelocity,
  radiationIntensity,
} from "../src/engine/arenaBoundary";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { vecDistance } from "../src/engine/math2d";
import { updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, Vector2 } from "../src/types/combat";

function ship(hullClass: HullClass = "cruiser", team = 0) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = [ARENA_RADIUS * 1.15, 0];
  result.velocity = [0, 0];
  return result;
}

describe("progressive arena radiation", () => {
  it("has no damage at the edge and doubles intensity at 15% excess radius", () => {
    const vessel = ship();
    vessel.pos = [ARENA_RADIUS, 0];
    const before = [vessel.shieldCurrent, vessel.armorCurrent, vessel.hullCurrent];
    applyArenaRadiation(vessel, 1);
    expect([vessel.shieldCurrent, vessel.armorCurrent, vessel.hullCurrent]).toEqual(before);
    expect(radiationIntensity([ARENA_RADIUS * 1.15, 0])).toBeCloseTo(2);
    expect(radiationIntensity([0, -ARENA_RADIUS * 1.3])).toBeCloseTo(5);
    vessel.pos = [ARENA_RADIUS * 1.15, 0];
    applyArenaRadiation(vessel, 1);
    expect(vessel.shieldCurrent).toBeCloseTo(vessel.shieldMax * 0.8);
    expect(vessel.hullCurrent).toBe(vessel.hullMax);
  });

  it("exposes hull only after mid-step shield collapse and bypasses armor", () => {
    const vessel = ship();
    vessel.shieldCurrent = vessel.shieldMax * 0.1;
    applyArenaRadiation(vessel, 1);
    expect(vessel.shieldCurrent).toBe(0);
    expect(vessel.armorCurrent).toBe(vessel.armorMax);
    expect(vessel.hullCurrent).toBeCloseTo(vessel.hullMax - 30);
    const stepped = ship();
    stepped.shieldCurrent = stepped.shieldMax * 0.1;
    for (let tick = 0; tick < 60; tick++) applyArenaRadiation(stepped, 1 / 60);
    expect(stepped.hullCurrent).toBeCloseTo(vessel.hullCurrent);
  });

  it.each(["isDocked", "isDebris"] as const)("does not irradiate %s entities", (flag) => {
    const vessel = ship();
    vessel[flag] = true;
    vessel.shieldCurrent = 0;
    applyArenaRadiation(vessel, 1);
    expect(vessel.hullCurrent).toBe(vessel.hullMax);
  });

  it("suppresses regeneration in the fixed-step simulation, then resumes it after re-entry", () => {
    const vessel = ship();
    vessel.maxSpeed = vessel.turnRate = 0;
    vessel.shieldCurrent = vessel.shieldMax * 0.5;
    vessel.shieldRegen = vessel.shieldMax;
    vessel.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(vessel);
    sim.update(1);
    expect(vessel.shieldCurrent).toBeCloseTo(vessel.shieldMax * 0.3);
    expect(vessel.shieldDelayTimer).toBe(vessel.shieldRechargeDelay);
    vessel.pos = [0, 0];
    const shield = vessel.shieldCurrent;
    sim.update(0.5);
    expect(vessel.shieldCurrent).toBe(shield);
    sim.update(2);
    expect(vessel.shieldCurrent).toBeGreaterThan(shield);
  });

  it("destroys an exposed capital through the usual lifecycle without crediting enemy DPS", () => {
    const vessel = ship();
    vessel.maxSpeed = vessel.turnRate = 0;
    vessel.shieldCurrent = 0;
    vessel.hullCurrent = 0.5;
    vessel.turrets = [];
    const sim = new ClientCombatSimulation();
    const telemetry = new CombatTelemetry([vessel]);
    sim.observer = telemetry;
    sim.addShip(vessel);
    sim.update(1 / 60);
    expect(vessel.isAlive).toBe(false);
    expect(vessel.hullCurrent).toBe(0);
    expect(sim.stats[0].shipsLost).toBe(1);
    expect(sim.stats[1].damageDealt).toBe(0);
    expect(sim.ships.filter((peer) => peer.isDebris)).toHaveLength(2);
    expect(telemetry.report().damage.some((record) => record.weapon === "radiation")).toBe(true);
    expect(sim.combatLog[0].text).toContain("environmental hazards");
  });
});

describe("natural boundary breakthrough steering", () => {
  it("preserves outward inertia with ordinary acceleration limits even deep outside", () => {
    const vessel = ship();
    vessel.pos = [ARENA_RADIUS * 1.4, 0];
    vessel.velocity = [vessel.maxSpeed, 0];
    const start: Vector2 = [...vessel.pos];
    const velocity: Vector2 = [...vessel.velocity];
    const sim = new ClientCombatSimulation();
    updateShipNavigation(vessel, null, [vessel], 1 / 60, sim, () => ({ heading: 0, speed: 0 }));
    expect(vessel.velocity[0]).toBeGreaterThan(0);
    expect(vecDistance(vessel.velocity, velocity)).toBeLessThanOrEqual((110 * Math.SQRT2) / 60);
    expect(vecDistance(vessel.pos, start)).toBeLessThanOrEqual(vessel.maxSpeed / 60 + 1e-8);
    expect(Math.abs(vessel.heading)).toBeCloseTo(vessel.turnRate / 60);
  });

  it("accepts an angled radiation route rather than flying into an oncoming capital broadside", () => {
    const vessel = ship("strike_craft");
    vessel.pos = [ARENA_RADIUS + 25, 0];
    vessel.heading = Math.PI;
    vessel.shieldCurrent = 0;
    const enemy = ship("battleship", 1);
    enemy.pos = [ARENA_RADIUS - 220, 0];
    enemy.velocity = [40, 0];
    enemy.heading = Math.PI / 2;
    const beam = enemy.turrets[1];
    beam.baseArc = [-Math.PI / 2 - 0.12, -Math.PI / 2 + 0.12];
    beam.weapon.damage = 5000;
    enemy.turrets = [beam];
    const desired: Vector2 = [-vessel.maxSpeed, 0];
    const route = arenaVelocity(vessel, desired, [vessel, enemy]);
    expect(route[0]).toBeLessThan(0);
    expect(Math.abs(route[1])).toBeGreaterThan(vessel.maxSpeed * 0.4);
    expect(Math.hypot(...route)).toBeCloseTo(vessel.maxSpeed);
    enemy.isDebris = true;
    const direct = arenaVelocity(vessel, desired, [vessel, enemy]);
    expect(direct[0]).toBeCloseTo(-vessel.maxSpeed);
    expect(direct[1]).toBeCloseTo(0);
  });
});
