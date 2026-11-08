import { describe, expect, it, vi } from "vitest";
import {
  BATTLE_MAPS,
  createMapObstacles,
  resolveMapContacts,
  updateMapObstacles,
} from "../src/engine/battleMaps";
import { BeamLaserSystem } from "../src/engine/beamLaserSystem";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ProjectileEngine } from "../src/engine/projectileEngine";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { ProjectileState, Vector2, WeaponType } from "../src/types/combat";

function ship(team: number, pos: Vector2) {
  const result = buildFleetFromSlots(
    [{ id: "fixture", hullClass: "corvette", groupId: 1 }],
    team,
    0,
    0,
  )[0];
  result.pos = pos;
  result.velocity = [0, 0];
  return result;
}

function projectile(type: WeaponType): ProjectileState {
  const weapon = { ...ship(0, [-600, 0]).turrets[0].weapon, weaponType: type, flak: undefined };
  return {
    id: "shot",
    ownerId: "owner",
    ownerTeam: 0,
    weaponType: type,
    weapon,
    damage: 100,
    pos: [-600, 0],
    velocity: [1200, 0],
    lifetime: 5,
    hp: 100,
    maxHp: 100,
    targetId: null,
  };
}

describe("map obstacle physics", () => {
  it("defines the five assigned arenas and exact static geometry", () => {
    expect(BATTLE_MAPS.map((map) => map.id)).toEqual([
      "empty_void",
      "megaboulder",
      "twin_pillars",
      "drifting_field",
      "orbital_station",
    ]);
    expect(createMapObstacles("megaboulder")[0]).toMatchObject({ pos: [0, 0], radius: 280 });
    const pillars = createMapObstacles("twin_pillars");
    expect(pillars.map((p) => p.pos[0])).toEqual([-450, 450]);
    for (const pillar of pillars) {
      expect(pillar.pos[1]).toBeCloseTo(0);
      expect(pillar.radius).toBe(175);
      expect(pillar.kind).toBe("asteroid");
    }
    expect(createMapObstacles("orbital_station")[0]).toMatchObject({
      radius: 220,
      rotationSpeed: 0.05,
    });
  });

  it("keeps stable orbital radii, bounded speeds, and the same vector storage", () => {
    const obstacles = createMapObstacles("drifting_field");
    expect(obstacles.length).toBeGreaterThanOrEqual(6);
    expect(obstacles.length).toBeLessThanOrEqual(8);
    const vectors = obstacles.map((o) => [o.pos, o.velocity, o.previousPos]);
    updateMapObstacles(obstacles, 1234);
    for (const [i, obstacle] of obstacles.entries()) {
      expect(obstacle.radius).toBeGreaterThanOrEqual(80);
      expect(obstacle.radius).toBeLessThanOrEqual(140);
      expect(Math.hypot(...obstacle.pos)).toBeCloseTo(obstacle.orbitRadius);
      expect(Math.hypot(...obstacle.velocity)).toBeGreaterThanOrEqual(15 - 1e-9);
      expect(Math.hypot(...obstacle.velocity)).toBeLessThanOrEqual(30 + 1e-9);
      expect(obstacle.pos).toBe(vectors[i][0]);
      expect(obstacle.velocity).toBe(vectors[i][1]);
      expect(obstacle.previousPos).toBe(vectors[i][2]);
    }
  });

  it("rotates the station and resets obstacles for a remnant battle", () => {
    const sim = new ClientCombatSimulation("orbital_station");
    sim.update(1);
    expect(sim.mapObstacles[0].rotation).toBeCloseTo(0.05);
    sim.continueBattleWithRemnants();
    expect(sim.mapObstacles[0].rotation).toBe(0);
  });

  it.each(["railgun", "beam_laser", "plasma", "missile"] as const)(
    "absorbs a swept %s before the ship behind it",
    (type) => {
      const damage = vi.fn();
      const engine = new ProjectileEngine({
        applyShipDamage: damage,
        onMissileIntercept: vi.fn(),
        onDetonate: vi.fn(),
        onFlakAudio: vi.fn(),
      });
      const shot = projectile(type);
      const target = ship(1, [500, 0]);
      engine.projectiles = [shot];
      engine.updateProjectiles(1, [target], new Map(), createMapObstacles("megaboulder"));
      expect(damage).not.toHaveBeenCalled();
      expect(engine.projectiles).toHaveLength(0);
      expect(shot.pos[0]).toBeCloseTo(-280);
      expect(shot.hp).toBe(0);
    },
  );

  it("damages a ship in front of the obstacle rather than absorbing its shot", () => {
    const damage = vi.fn();
    const engine = new ProjectileEngine({
      applyShipDamage: damage,
      onMissileIntercept: vi.fn(),
      onDetonate: vi.fn(),
      onFlakAudio: vi.fn(),
    });
    engine.projectiles = [projectile("railgun")];
    const target = ship(1, [-450, 0]);
    engine.updateProjectiles(1, [target], new Map(), createMapObstacles("megaboulder"));
    expect(damage).toHaveBeenCalledOnce();
    expect(damage.mock.calls[0][0]).toBe(target);
  });

  it("detects a drifting obstacle crossing an otherwise clear projectile segment", () => {
    const engine = new ProjectileEngine({
      applyShipDamage: vi.fn(),
      onMissileIntercept: vi.fn(),
      onDetonate: vi.fn(),
      onFlakAudio: vi.fn(),
    });
    const obstacle = createMapObstacles("megaboulder")[0];
    obstacle.radius = 20;
    obstacle.previousPos = [0, 100];
    obstacle.pos = [0, -100];
    engine.projectiles = [projectile("plasma")];
    engine.updateProjectiles(1, [], new Map(), [obstacle]);
    expect(engine.projectiles).toHaveLength(0);
  });

  it("prevents hull tunneling, damps impact and preserves tangential velocity", () => {
    const craft = ship(0, [600, 0]);
    craft.velocity = [1200, 50];
    const pos = craft.pos;
    const velocity = craft.velocity;
    resolveMapContacts(
      [craft],
      createMapObstacles("megaboulder"),
      new Map([[craft.id, [-600, 0]]]),
      1,
    );
    expect(craft.pos[0]).toBeLessThan(-280);
    expect(craft.velocity[0]).toBeCloseTo(-240);
    expect(craft.velocity[1]).toBeCloseTo(49);
    expect(craft.pos).toBe(pos);
    expect(craft.velocity).toBe(velocity);
  });

  it("clips beam visuals and resumes damage when a blocker moves clear", () => {
    const obstacles = createMapObstacles("megaboulder");
    const damage = vi.fn();
    const fire = vi.fn();
    const beams = new BeamLaserSystem({
      getTime: () => 0,
      getProjectiles: () => [],
      getMapObstacles: () => obstacles,
      updateTurretAim: () => true,
      applyShipDamage: damage,
      damageMissile: vi.fn(),
      onBeamFire: fire,
    });
    const owner = ship(0, [-600, 0]);
    const target = ship(1, [600, 0]);
    const turret = owner.turrets[0];
    beams.startBeam(owner, turret, target, "ship");
    const channel = beams.channels.get(turret);
    if (!channel) throw new Error("Missing beam channel");
    expect(fire.mock.calls[0][1][0]).toBeLessThan(0);
    expect(beams.collectActiveBeams()[0].to[0]).toBeLessThan(0);
    for (let i = 0; i < 6; i++) beams.updateBeam(channel, true);
    expect(damage).not.toHaveBeenCalled();
    obstacles[0].pos[1] = 1000;
    for (let i = 0; i < 6; i++) beams.updateBeam(channel, true);
    expect(damage).toHaveBeenCalledOnce();
  });
});
