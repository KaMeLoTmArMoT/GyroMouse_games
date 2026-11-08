import { describe, expect, it, vi } from "vitest";
import { acquireMountTarget, prepareFireControlContext } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { debrisAvoidanceVelocity } from "../src/engine/flightControl";
import { prepareNavigationContext } from "../src/engine/navigationContext";
import { ProjectileEngine } from "../src/engine/projectileEngine";
import type { HullClass, ProjectileState, Vector2 } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = team === 0 ? [0, 0] : [300, 0];
  result.velocity = [0, 0];
  return result;
}

function missile(ownerTeam: number, targetId: string | null, id = "missile"): ProjectileState {
  const weapon = ship("missile_frigate", "launcher").turrets[0].weapon;
  return {
    id,
    weaponType: "missile",
    weapon,
    damage: 10,
    ownerId: "launcher",
    ownerTeam,
    targetId,
    pos: [200, 0],
    velocity: [-100, 0],
    lifetime: 8,
    hp: 25,
    maxHp: 25,
  };
}

describe("situational fire-control worklists", () => {
  it("shares missile saturation indexing across mounts without revisiting projectile storage", () => {
    const owner = ship("missile_frigate", "owner");
    const target = ship("corvette", "target", 1);
    const alternate = ship("corvette", "alternate", 1);
    alternate.pos = [350, 0];
    const fleet = [owner, target, alternate];
    const projectiles = Array.from({ length: 6 }, (_, i) => missile(0, target.id, `m-${i}`));
    prepareFireControlContext(fleet, projectiles);
    const iterator = vi.spyOn(projectiles, Symbol.iterator);
    for (let i = 0; i < 3; i++)
      expect(acquireMountTarget(owner, owner.turrets[0], target, fleet, projectiles)?.target).toBe(
        alternate,
      );
    expect(iterator).not.toHaveBeenCalled();
  });

  it("falls back for a different projectile array and observes payload deaths in indexed lists", () => {
    const owner = ship("missile_frigate", "owner");
    const target = ship("corvette", "target", 1);
    const fleet = [owner, target];
    const projectiles = Array.from({ length: 6 }, (_, i) => missile(0, target.id, `m-${i}`));
    prepareFireControlContext(fleet, projectiles);
    expect(acquireMountTarget(owner, owner.turrets[0], target, fleet, projectiles)).toBeNull();
    expect(acquireMountTarget(owner, owner.turrets[0], target, fleet, [])?.target).toBe(target);
    projectiles[0].hp = 0;
    expect(acquireMountTarget(owner, owner.turrets[0], target, fleet, projectiles)?.target).toBe(
      target,
    );
  });

  it("gates empty enemy missile lists and keeps null-lock threats for every opposing team", () => {
    const defender = ship("corvette", "defender");
    const thirdTeam = ship("corvette", "third-team", 2);
    const turret = defender.turrets[0];
    turret.offset = [0, 0];
    const fleet = [defender, thirdTeam];
    thirdTeam.pos = [5000, 0];
    const friendly = missile(0, null, "friendly");
    const dead = { ...missile(1, null, "dead"), hp: 0 };
    const expired = { ...missile(1, null, "expired"), lifetime: 0 };
    const projectiles = [friendly, dead, expired];
    prepareFireControlContext(fleet, projectiles);
    const iterator = vi.spyOn(projectiles, Symbol.iterator);
    expect(acquireMountTarget(defender, turret, null, fleet, projectiles)).toBeNull();
    expect(iterator).not.toHaveBeenCalled();
    const hostile = missile(2, null, "hostile");
    projectiles.push(hostile);
    prepareFireControlContext(fleet, projectiles);
    expect(acquireMountTarget(defender, turret, null, fleet, projectiles)?.target).toBe(hostile);
    hostile.hp = 0;
    expect(acquireMountTarget(defender, turret, null, fleet, projectiles)).toBeNull();
  });

  it("matches standalone point-defense tie-breaking with mixed projectile storage", () => {
    const defender = ship("corvette", "defender");
    const turret = defender.turrets[0];
    turret.offset = [0, 0];
    const fleet = [defender];
    const projectiles = [missile(1, null, "z"), missile(0, null), missile(1, null, "a")];
    const standalone = acquireMountTarget(defender, turret, null, fleet, projectiles);
    prepareFireControlContext(fleet, projectiles);
    expect(acquireMountTarget(defender, turret, null, fleet, projectiles)).toEqual(standalone);
    expect(standalone?.target.id).toBe("a");
  });
});

describe("active wreck worklists", () => {
  it("returns desired velocity without scanning a prepared wreck-free fleet", () => {
    const pilot = ship("corvette", "pilot");
    const fleet = [pilot, ship("carrier", "capital")];
    prepareNavigationContext(fleet);
    const filter = vi.spyOn(fleet, "filter");
    const desired: Vector2 = [50, 0];
    expect(debrisAvoidanceVelocity(pilot, desired, fleet)).toBe(desired);
    expect(filter).not.toHaveBeenCalled();
  });

  it("matches standalone avoidance and stops responding to expired wrecks", () => {
    const pilot = ship("corvette", "pilot");
    const wreck = ship("cruiser", "wreck");
    wreck.isDebris = true;
    wreck.pos = [150, 0];
    const fleet = [pilot, wreck];
    const desired: Vector2 = [pilot.maxSpeed, 0];
    const standalone = debrisAvoidanceVelocity(pilot, desired, fleet);
    prepareNavigationContext(fleet);
    expect(debrisAvoidanceVelocity(pilot, desired, fleet)).toEqual(standalone);
    expect(standalone).not.toEqual(desired);
    wreck.isAlive = false;
    expect(debrisAvoidanceVelocity(pilot, desired, fleet)).toBe(desired);
  });
});

describe("projectile target index", () => {
  it("retains a lock outside the acquisition arc without a ship-array find", () => {
    const target = ship("corvette", "target", 1);
    target.pos = [200, 200];
    const fleet = [target];
    const engine = new ProjectileEngine({
      applyShipDamage: vi.fn(),
      onMissileIntercept: vi.fn(),
      onDetonate: vi.fn(),
      onFlakAudio: vi.fn(),
    });
    const projectile = missile(0, target.id);
    projectile.pos = [0, 0];
    projectile.velocity = [100, 0];
    engine.projectiles = [projectile];
    const find = vi.spyOn(fleet, "find");
    engine.updateProjectiles(1 / 60, fleet, new Map());
    expect(find).not.toHaveBeenCalled();
    expect(projectile.targetId).toBe(target.id);
    expect(projectile.velocity[1]).toBeGreaterThan(0);
  });

  it.each(["dead", "debris", "friendly"])(
    "reacquires an indexed %s lock in storage order",
    (state) => {
      const invalid = ship("corvette", "invalid", 1);
      invalid.pos = [500, 200];
      if (state === "dead") invalid.isAlive = false;
      if (state === "debris") invalid.isDebris = true;
      if (state === "friendly") invalid.team = 0;
      const first = ship("corvette", "z-first", 1);
      const second = ship("corvette", "a-second", 1);
      first.pos = [500, 0];
      second.pos = [500, 0];
      const engine = new ProjectileEngine({
        applyShipDamage: vi.fn(),
        onMissileIntercept: vi.fn(),
        onDetonate: vi.fn(),
        onFlakAudio: vi.fn(),
      });
      const projectile = missile(0, invalid.id);
      projectile.pos = [0, 0];
      projectile.velocity = [100, 0];
      engine.projectiles = [projectile];
      engine.updateProjectiles(1 / 60, [invalid, first, second], new Map());
      expect(projectile.targetId).toBe(first.id);
    },
  );
});
