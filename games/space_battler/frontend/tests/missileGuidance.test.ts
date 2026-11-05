import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent } from "../src/engine/flightControl";
import { FLEET_PRESETS } from "../src/engine/fleetPresets";
import { SCENARIOS } from "../src/engine/scenarios";
import { HULL_PROFILES, projectileMaxHp } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState, Vector2 } from "../src/types/combat";

function ship(hullClass: HullClass, team: number, pos: Vector2) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = pos;
  result.maxSpeed = result.turnRate = 0;
  result.turrets = [];
  return result;
}

describe("guided ordnance", () => {
  it.each([false, true])("reacquires the closest forward hostile (heavy=%s)", (heavy) => {
    const weapon = heavy ? HULL_PROFILES.cruiser.turrets[1].weapon : HULL_PROFILES.missile_frigate.turrets[0].weapon;
    const projectile: ProjectileState = {
      id: "guided", weaponType: "missile", weapon: { ...weapon }, damage: weapon.damage,
      ownerId: "owner", ownerTeam: 0, pos: [0, 0], velocity: [360, 0], lifetime: 5,
      targetId: "destroyed", hp: projectileMaxHp(weapon), maxHp: projectileMaxHp(weapon),
    };
    const sim = new ClientCombatSimulation();
    const closest = ship("battleship", 1, [600, 200]);
    const outside = ship("cruiser", 1, [200, 200]);
    const behind = ship("corvette", 1, [-200, 0]);
    const friendly = ship("cruiser", 0, [100, 0]);
    for (const candidate of [closest, outside, behind, friendly]) sim.addShip(candidate);
    sim.projectiles.push(projectile);
    sim.update(1 / 60);
    expect(projectile.targetId).toBe(closest.id);
    expect(Math.atan2(projectile.velocity[1], projectile.velocity[0])).toBeCloseTo((heavy ? 0.8 : 2.2) / 60);
    expect(Math.hypot(...projectile.velocity)).toBeCloseTo(360);
  });

  it("launches two central missiles and two flanking missiles", () => {
    const owner = buildFleetFromSlots([{ id: "fixture", hullClass: "missile_frigate", groupId: 1 }], 0, 0, 0)[0];
    owner.pos = [0, 0];
    owner.maxSpeed = owner.turnRate = 0;
    for (const mount of owner.turrets) mount.cooldownTimer = 0;
    const target = ship("battleship", 1, [1000, 0]);
    const sim = new ClientCombatSimulation();
    sim.addShip(owner);
    sim.addShip(target);
    sim.update(1 / 60);
    expect(sim.projectiles).toHaveLength(4);
    const angles = sim.projectiles.map((p) => Math.atan2(p.velocity[1], p.velocity[0]));
    expect(Math.abs(angles[0])).toBeLessThan(0.02);
    expect(Math.abs(angles[1])).toBeLessThan(0.02);
    expect(angles[2]).toBeGreaterThan(0.35);
    expect(angles[3]).toBeLessThan(-0.35);
    expect(sim.projectiles.every((p) => p.maxHp === 18)).toBe(true);
  });
});

describe("expanded fleet doctrine", () => {
  it.each(["dreadnought", "battleship", "cruiser"] as const)("approaches bow-first with %s", (hull) => {
    const owner = ship(hull, 0, [0, 0]);
    const target = ship("battleship", 1, [1600, 0]);
    const intent = capitalIntent(owner, target, [owner, target], { groupId: 1, priority: "nearest", stance: "optimal_range" });
    expect(intent.heading).toBeCloseTo(0);
  });

  it("covers all 36 ordered matchups and prices curated fleets correctly", () => {
    expect(SCENARIOS.filter((scenario) => scenario.tags.includes("golden"))).toHaveLength(36);
    for (const id of ["ironclad_line", "missile_wall"]) {
      const preset = FLEET_PRESETS.find((entry) => entry.id === id)!;
      expect(preset.budget).toBe(preset.composition.reduce((sum, entry) => sum + HULL_PROFILES[entry.hullClass].cost * entry.count, 0));
    }
  });
});
