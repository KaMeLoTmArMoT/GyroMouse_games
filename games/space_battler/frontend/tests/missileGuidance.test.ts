import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { FLEET_PRESETS } from "../src/engine/fleetPresets";
import { capitalIntent } from "../src/engine/flightControl";
import { normalizeAngle } from "../src/engine/math2d";
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
    const weapon = heavy
      ? HULL_PROFILES.cruiser.turrets[1].weapon
      : HULL_PROFILES.missile_frigate.turrets[0].weapon;
    const projectile: ProjectileState = {
      id: "guided",
      weaponType: "missile",
      weapon: { ...weapon },
      damage: weapon.damage,
      ownerId: "owner",
      ownerTeam: 0,
      pos: [0, 0],
      velocity: [360, 0],
      lifetime: 5,
      targetId: "destroyed",
      hp: projectileMaxHp(weapon),
      maxHp: projectileMaxHp(weapon),
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
    expect(Math.atan2(projectile.velocity[1], projectile.velocity[0])).toBeCloseTo(
      (heavy ? 0.8 : 2.5) / 60,
    );
    expect(Math.hypot(...projectile.velocity)).toBeCloseTo(360);
  });

  it("launches two central missiles and two flanking missiles", () => {
    const owner = buildFleetFromSlots(
      [{ id: "fixture", hullClass: "missile_frigate", groupId: 1 }],
      0,
      0,
      0,
    )[0];
    owner.pos = [0, 0];
    owner.maxSpeed = owner.turnRate = 0;
    for (const mount of owner.turrets) mount.cooldownTimer = 0;
    const target = ship("battleship", 1, [1000, 0]);
    const sim = new ClientCombatSimulation();
    sim.addShip(owner);
    sim.addShip(target);
    const launchAngles: number[] = [];
    sim.onProjectileFire = () => {
      const p = sim.projectiles[sim.projectiles.length - 1];
      const bearing = Math.atan2(target.pos[1] - p.pos[1], target.pos[0] - p.pos[0]);
      launchAngles.push(normalizeAngle(Math.atan2(p.velocity[1], p.velocity[0]) - bearing));
    };
    sim.update(1 / 60);
    expect(sim.projectiles).toHaveLength(4);
    for (const [index, degrees] of [5, -5, 30, -30].entries())
      expect(launchAngles[index]).toBeCloseTo((degrees * Math.PI) / 180);
    const angles = sim.projectiles.map((p) => Math.atan2(p.velocity[1], p.velocity[0]));
    expect(angles[0]).toBeGreaterThan(0);
    expect(angles[1]).toBeLessThan(0);
    expect(angles[2]).toBeGreaterThan(0.35);
    expect(angles[3]).toBeLessThan(-0.35);
    expect(sim.projectiles.every((p) => p.maxHp === 18)).toBe(true);
    const flanking = sim.projectiles.slice(2);
    for (let tick = 0; tick < 15; tick++) sim.update(1 / 60);
    expect(flanking[0].pos[1]).toBeGreaterThan(owner.turrets[2].offset[1]);
    expect(flanking[1].pos[1]).toBeLessThan(owner.turrets[3].offset[1]);
    expect(Math.abs(Math.atan2(flanking[0].velocity[1], flanking[0].velocity[0]))).toBeLessThan(
      0.1,
    );
    expect(Math.abs(Math.atan2(flanking[1].velocity[1], flanking[1].velocity[0]))).toBeLessThan(
      0.1,
    );
  });
});

describe("expanded fleet doctrine", () => {
  it.each([false, true])("jinks at full speed across incoming missiles (heavy=%s)", (heavy) => {
    const owner = ship("missile_frigate", 0, [0, 0]);
    owner.maxSpeed = HULL_PROFILES.missile_frigate.speed;
    const target = ship("battleship", 1, [1600, 0]);
    const weapon = heavy
      ? HULL_PROFILES.cruiser.turrets[1].weapon
      : HULL_PROFILES.missile_frigate.turrets[0].weapon;
    const missile: ProjectileState = {
      id: "incoming",
      weaponType: "missile",
      weapon,
      damage: weapon.damage,
      ownerId: target.id,
      ownerTeam: 1,
      pos: [400, 400],
      velocity: [-200, -200],
      lifetime: 3,
      targetId: owner.id,
      hp: projectileMaxHp(weapon),
      maxHp: projectileMaxHp(weapon),
    };
    const intent = capitalIntent(
      owner,
      target,
      [owner, target],
      {
        groupId: 1,
        priority: "nearest",
        stance: "optimal_range",
      },
      0,
      [missile],
    );
    expect(intent.rangePhase).toBe("approach");
    expect(intent.evadingOrdnance).toBe(true);
    expect(Math.hypot(...intent.velocity)).toBeCloseTo(owner.maxSpeed);
    expect(
      intent.velocity[0] * missile.velocity[0] + intent.velocity[1] * missile.velocity[1],
    ).toBeCloseTo(0);
  });

  it.each(["friendly", "receding", "distant", "miss", "dead", "expired", "short fuel"])(
    "keeps its normal course for a %s missile",
    (condition) => {
      const owner = ship("missile_frigate", 0, [0, 0]);
      owner.maxSpeed = HULL_PROFILES.missile_frigate.speed;
      const target = ship("battleship", 1, [1600, 0]);
      const weapon = HULL_PROFILES.missile_frigate.turrets[0].weapon;
      const missile: ProjectileState = {
        id: "incoming",
        weaponType: "missile",
        weapon,
        damage: weapon.damage,
        ownerId: target.id,
        ownerTeam: condition === "friendly" ? 0 : 1,
        pos: [condition === "distant" ? 601 : 600, condition === "miss" ? 200 : 0],
        velocity: [condition === "receding" ? 300 : -300, 0],
        lifetime: condition === "expired" ? 0 : condition === "short fuel" ? 1 : 3,
        targetId: owner.id,
        hp: condition === "dead" ? 0 : 18,
        maxHp: 18,
      };
      const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
      const normal = capitalIntent(owner, target, [owner, target], order);
      const intent = capitalIntent(owner, target, [owner, target], order, 0, [missile]);
      expect(intent.evadingOrdnance).not.toBe(true);
      expect(intent.velocity).toEqual(normal.velocity);
    },
  );

  it.each(["dreadnought", "battleship", "cruiser"] as const)(
    "approaches bow-first with %s",
    (hull) => {
      const owner = ship(hull, 0, [0, 0]);
      const target = ship("battleship", 1, [1600, 0]);
      const intent = capitalIntent(owner, target, [owner, target], {
        groupId: 1,
        priority: "nearest",
        stance: "optimal_range",
      });
      expect(intent.heading).toBeCloseTo(0);
    },
  );

  it("covers all 36 ordered matchups and prices curated fleets correctly", () => {
    expect(SCENARIOS.filter((scenario) => scenario.tags.includes("golden"))).toHaveLength(36);
    for (const id of ["ironclad_line", "missile_wall"]) {
      const preset = FLEET_PRESETS.find((entry) => entry.id === id)!;
      expect(preset.budget).toBe(
        preset.composition.reduce(
          (sum, entry) => sum + HULL_PROFILES[entry.hullClass].cost * entry.count,
          0,
        ),
      );
    }
  });
});
