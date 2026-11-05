import { describe, expect, it } from "vitest";
import { acquireMountTarget, mountPosition } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HULL_PROFILES, projectileMaxHp } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState, ShipState, Vector2 } from "../src/types/combat";

const STEP = 1 / 60;

function ship(hullClass: HullClass, team = 0, pos: Vector2 = [0, 0]): ShipState {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = pos;
  result.maxSpeed = result.turnRate = result.shieldRegen = 0;
  return result;
}

function missile(id = "torpedo", pos: Vector2 = [200, 0], heavy = true): ProjectileState {
  const weapon = { ...HULL_PROFILES.cruiser.turrets[1].weapon, projectileHp: heavy ? 120 : 25 };
  return {
    id,
    weaponType: "missile",
    weapon,
    damage: weapon.damage,
    ownerId: "enemy",
    ownerTeam: 1,
    pos,
    velocity: [-100, 0],
    lifetime: 8,
    targetId: null,
    hp: projectileMaxHp(weapon),
    maxHp: projectileMaxHp(weapon),
  };
}

function shell(defender: ShipState, id: string, pos: Vector2): ProjectileState {
  const weapon = structuredClone(defender.turrets[0].weapon);
  return {
    id,
    weaponType: weapon.weaponType,
    weapon,
    damage: weapon.damage,
    ownerId: defender.id,
    ownerTeam: defender.team,
    pos: [...pos],
    velocity: [0, 0],
    lifetime: STEP,
    targetId: null,
    hp: 25,
    maxHp: 25,
  };
}

function defense(mode: "flak" | "rotary" | "laser"): ShipState {
  const result = ship("corvette");
  result.turrets = [result.turrets[0]];
  const mount = result.turrets[0];
  mount.offset = [0, 0];
  if (mode !== "flak") mount.weapon.flak = undefined;
  if (mode === "rotary") mount.weapon.damage = 15;
  if (mode === "laser") {
    mount.weapon.projectileSpeed = 0;
    mount.weapon.damage = 110;
  }
  return result;
}

function simulation(...ships: ShipState[]): ClientCombatSimulation {
  const sim = new ClientCombatSimulation();
  for (const s of ships) sim.addShip(s);
  return sim;
}

function advance(sim: ClientCombatSimulation, frames: number): void {
  for (let i = 0; i < frames; i++) sim.update(STEP);
}

describe("shared heavy torpedo durability", () => {
  it("gives flak a small deterministic angular spread without changing shell speed", () => {
    const defender = defense("flak");
    const target = ship("battleship", 1, [300, 0]);
    target.turrets = [];
    const sim = simulation(defender, target);
    sim.update(STEP);
    const shot = sim.projectiles.find((projectile) => projectile.ownerId === defender.id);
    expect(shot).toBeDefined();
    const [x, y] = shot?.velocity ?? [0, 0];
    expect(Math.atan2(y, x)).toBeCloseTo(Math.sin(12.9898) * 0.02);
    expect(Math.hypot(x, y)).toBeCloseTo(defender.turrets[0].weapon.projectileSpeed);
  });

  it("spawns a heavy torpedo with 120 current and maximum HP", () => {
    const owner = ship("cruiser");
    owner.turrets = [owner.turrets[1]];
    const target = ship("battleship", 1, [1000, 0]);
    target.turrets = [];
    const sim = simulation(owner, target);
    sim.update(STEP);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.projectiles[0]).toMatchObject({ hp: 120, maxHp: 120 });
  });

  it("requires seven direct 18-damage flak blasts for every torpedo ID, counting one interception", () => {
    const defender = defense("flak");
    const sim = simulation();
    const torpedoes = Array.from({ length: 20 }, (_, i) => missile(`proj_${i + 1}`, [0, 0]));
    torpedoes.forEach((torpedo) => {
      torpedo.velocity = [0, 0];
    });
    sim.projectiles = [...torpedoes];
    for (let blast = 1; blast <= 6; blast++) {
      sim.projectiles.push(shell(defender, `blast_${blast}`, [0, 0]));
      sim.update(STEP);
      expect(torpedoes.every((torpedo) => torpedo.hp === 120 - 18 * blast)).toBe(true);
      expect(sim.stats[0].missilesIntercepted).toBe(0);
    }
    sim.projectiles.push(shell(defender, "lethal", [0, 0]), shell(defender, "extra", [0, 0]));
    sim.update(STEP);
    expect(torpedoes.every((torpedo) => torpedo.hp === 0 && torpedo.lifetime === 0)).toBe(true);
    expect(sim.projectiles).toEqual([]);
    expect(sim.stats[0].missilesIntercepted).toBe(torpedoes.length);
    expect(sim.combatLog).toHaveLength(torpedoes.length);
  });

  it("sweeps rotary bullets into torpedoes for 15 damage per hit and consumes the bullets", () => {
    const defender = defense("rotary");
    const torpedo = missile();
    const sim = simulation();
    sim.projectiles = [torpedo];
    for (let hit = 1; hit <= 8; hit++) {
      const bullet = shell(defender, `bullet_${hit}`, [torpedo.pos[0] - 20, 0]);
      bullet.velocity = [2400, 0];
      sim.projectiles.push(bullet);
      sim.update(STEP);
      expect(torpedo.hp).toBe(Math.max(0, 120 - hit * 15));
      expect(bullet.hp).toBe(0);
      expect(sim.projectiles.includes(bullet)).toBe(false);
      expect(sim.stats[0].missilesIntercepted).toBe(hit === 8 ? 1 : 0);
    }
    expect(sim.projectiles).toEqual([]);
  });

  it("shares damage across flak, rotary hits and continuous laser contact", () => {
    const flak = defense("flak");
    const rotary = defense("rotary");
    const laser = defense("laser");
    const torpedo = missile("mixed", [300, 0]);
    const sim = simulation();
    sim.projectiles = [torpedo, shell(flak, "flak", torpedo.pos)];
    sim.update(STEP);
    expect(torpedo.hp).toBe(102);
    sim.projectiles.push(shell(rotary, "rotary", torpedo.pos));
    sim.update(STEP);
    expect(torpedo.hp).toBe(87);
    sim.addShip(laser);
    advance(sim, 30);
    expect(torpedo.hp).toBeCloseTo(32);
    expect(torpedo.maxHp).toBe(120);
    expect(sim.stats[0].missilesIntercepted).toBe(0);
    advance(sim, 18);
    expect(torpedo.hp).toBe(0);
    expect(sim.projectiles).toEqual([]);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
  });

  it("delivers exactly 110 laser DPS and retains damage across lost contact and target switches", () => {
    const laser = defense("laser");
    const torpedo = missile("first", [300, 0]);
    const other = missile("second", [600, 0]);
    const sim = simulation(laser);
    sim.projectiles = [torpedo, other];
    advance(sim, 30);
    expect(torpedo.hp).toBeCloseTo(65);
    expect(other.hp).toBe(120);
    torpedo.pos = [600, 0];
    other.pos = [300, 0];
    advance(sim, 12);
    expect(torpedo.hp).toBeCloseTo(65);
    expect(other.hp).toBeCloseTo(98);
    torpedo.pos = [250, 0];
    other.pos = [600, 0];
    advance(sim, 30);
    expect(torpedo.hp).toBeCloseTo(10);
    expect(other.hp).toBeCloseTo(98);
    advance(sim, 6);
    expect(torpedo.hp).toBe(0);
    expect(sim.projectiles).toEqual([other]);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
  });

  it("does not apply laser contact damage while the mount is unaligned", () => {
    const laser = defense("laser");
    laser.turrets[0].trackingSpeed = 0;
    laser.turrets[0].currentLocalAngle = Math.PI;
    const torpedo = missile("unaligned", [300, 0]);
    const sim = simulation(laser);
    sim.projectiles = [torpedo];
    advance(sim, 30);
    expect(torpedo.hp).toBe(120);
    expect(sim.stats[0].missilesIntercepted).toBe(0);
  });

  it("counts simultaneous lethal laser contacts only once", () => {
    const first = defense("laser");
    const second = defense("laser");
    second.id = "second_defender";
    second.pos = [0, 80];
    second.turrets[0].currentLocalAngle = -Math.atan2(80, 300);
    const torpedo = missile("shared", [300, 0]);
    torpedo.hp = 1;
    const sim = simulation(first, second);
    sim.projectiles = [torpedo];
    sim.update(STEP);
    expect(torpedo.hp).toBe(0);
    expect(sim.projectiles).toEqual([]);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
    expect(sim.combatLog).toHaveLength(1);
  });
});

describe("defensive target priority matrix", () => {
  it("makes flak switch from torpedoes to nearby fighters, then light missiles, then torpedoes", () => {
    const flak = defense("flak");
    const fighter = ship("strike_craft", 1, [340, 0]);
    const heavy = missile("heavy", [150, 0]);
    const light = missile("light", [250, 0], false);
    const mount = flak.turrets[0];
    mount.currentTargetId = heavy.id;
    mount.currentTargetKind = "missile";
    const acquire = () => acquireMountTarget(flak, mount, fighter, [flak, fighter], [heavy, light]);
    expect(acquire()?.target).toBe(fighter);
    fighter.pos = [350, 0];
    expect(acquire()?.target).toBe(light);
    light.hp = 0;
    expect(acquire()?.target).toBe(heavy);
    heavy.velocity = [100, 0];
    expect(acquire()?.target).toBe(fighter);
  });

  it("makes rotary prioritize a capital-bound torpedo strictly inside 300u, then ingress, then light missiles", () => {
    const rotary = defense("rotary");
    const capital = ship("battleship");
    rotary.flagshipId = capital.id;
    const fighter = ship("strike_craft", 1, [150, 50]);
    fighter.velocity = [-100, 0];
    const heavy = missile("heavy", [299, 0]);
    const light = missile("light", [100, 0], false);
    const mount = rotary.turrets[0];
    mount.currentTargetId = fighter.id;
    mount.currentTargetKind = "ship";
    const acquire = () =>
      acquireMountTarget(rotary, mount, fighter, [rotary, capital, fighter], [heavy, light]);
    expect(acquire()?.target).toBe(heavy);
    heavy.pos = [300, 0];
    expect(acquire()?.target).toBe(fighter);
    fighter.velocity = [100, 0];
    expect(acquire()?.target).toBe(light);
  });

  it("measures urgent torpedo range from the defended capital rather than the rotary muzzle", () => {
    const rotary = defense("rotary");
    rotary.pos = [150, 0];
    const capital = ship("cruiser");
    const fighter = ship("strike_craft", 1, [200, 50]);
    fighter.velocity = [-100, 0];
    const heavy = missile("heavy", [400, 0]);
    const acquire = () =>
      acquireMountTarget(rotary, rotary.turrets[0], fighter, [rotary, capital, fighter], [heavy]);
    expect(acquire()?.target).toBe(fighter);
    heavy.pos = [290, 0];
    expect(acquire()?.target).toBe(heavy);
  });

  it("uses closest inbound threat for laser PD and immediately switches to a nearer threat", () => {
    const laser = defense("laser");
    const fighter = ship("strike_craft", 1, [100, 50]);
    fighter.hullCurrent = 1;
    fighter.armorCurrent = fighter.shieldCurrent = 0;
    const heavy = missile("heavy", [300, 0]);
    const light = missile("light", [200, 0], false);
    const outgoing = missile("outgoing", [50, 0]);
    outgoing.velocity = [100, 0];
    const mount = laser.turrets[0];
    mount.currentTargetId = heavy.id;
    mount.currentTargetKind = "missile";
    const acquire = () =>
      acquireMountTarget(laser, mount, fighter, [laser, fighter], [heavy, light, outgoing]);
    expect(acquire()?.target).toBe(light);
    light.lifetime = 0;
    expect(acquire()?.target).toBe(heavy);
    heavy.pos = [mountPosition(laser, mount)[0] + mount.weapon.range + 1, 0];
    expect(acquire()?.target).toBe(fighter);
  });
});
