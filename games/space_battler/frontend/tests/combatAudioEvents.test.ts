import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HULL_PROFILES } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type {
  CombatAudioEvent,
  HullClass,
  ProjectileState,
  ShipState,
  Vector2,
} from "../src/types/combat";

const STEP = 1 / 60;

function ship(hullClass: HullClass, team = 0, pos: Vector2 = [0, 0]): ShipState {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = pos;
  result.maxSpeed = result.turnRate = result.shieldRegen = 0;
  return result;
}

function missile(): ProjectileState {
  const weapon = { ...HULL_PROFILES.cruiser.turrets[1].weapon };
  return {
    id: "inbound",
    ownerId: "enemy",
    ownerTeam: 1,
    weaponType: "missile",
    weapon,
    damage: weapon.damage,
    pos: [200, 0],
    velocity: [-100, 0],
    lifetime: 8,
    hp: 120,
    maxHp: 120,
    targetId: null,
  };
}

describe("discrete combat audio cues", () => {
  it("records warp ingress once per living spawn with a position snapshot and re-emits for remnant rounds", () => {
    const live = ship("cruiser");
    live.turrets = [];
    const dead = ship("battleship");
    dead.isAlive = false;
    const sim = new ClientCombatSimulation();
    sim.addShip(live);
    sim.addShip(dead);
    live.pos[0] = 50;
    expect(sim.audioEvents).toEqual([
      { type: "warp_ingress", time: 0, pos: [0, 0], team: 0, sourceId: live.id },
    ]);
    expect(sim.drainAudioEvents()).toHaveLength(1);
    sim.update(STEP);
    expect(sim.drainAudioEvents()).toEqual([]);
    sim.continueBattleWithRemnants();
    expect(sim.audioEvents).toHaveLength(1);
    expect(sim.audioEvents[0]).toMatchObject({ type: "warp_ingress", time: 0, pos: live.pos });
  });

  it("emits one torpedo launch cue per fired projectile through the callback and queue", () => {
    const launcher = ship("cruiser");
    launcher.turrets = [launcher.turrets[1]];
    const target = ship("battleship", 1, [1000, 0]);
    target.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(launcher);
    sim.addShip(target);
    sim.drainAudioEvents();
    const events: CombatAudioEvent[] = [];
    sim.onAudioEvent = (event) => events.push(event);
    sim.update(STEP);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "torpedo_launch",
      time: STEP,
      pos: [16, 0],
      team: 0,
      sourceId: launcher.id,
      targetId: target.id,
    });
    expect(sim.drainAudioEvents()).toEqual(events);
    sim.update(STEP * 30);
    expect(events).toHaveLength(1);
  });

  it("emits flak burst at detonation rather than every projectile flight tick", () => {
    const owner = ship("corvette");
    const weapon = structuredClone(owner.turrets[0].weapon);
    const shell: ProjectileState = {
      id: "shell",
      ownerId: owner.id,
      ownerTeam: 0,
      weaponType: weapon.weaponType,
      weapon,
      damage: weapon.damage,
      pos: [100, 20],
      velocity: [0, 0],
      lifetime: STEP * 2,
      hp: 25,
      maxHp: 25,
      targetId: null,
    };
    const sim = new ClientCombatSimulation();
    sim.projectiles = [shell];
    sim.update(STEP);
    expect(sim.audioEvents).toEqual([]);
    sim.update(STEP);
    expect(sim.audioEvents).toHaveLength(1);
    expect(sim.audioEvents[0]).toMatchObject({
      type: "flak_burst",
      pos: [100, 20],
      sourceId: owner.id,
    });
    sim.update(STEP * 5);
    expect(sim.audioEvents).toHaveLength(1);
  });

  it("emits laser intercept only on missile destruction, not each laser PD damage tick", () => {
    const defender = ship("corvette");
    defender.turrets = [defender.turrets[0]];
    const mount = defender.turrets[0];
    mount.offset = [0, 0];
    mount.weapon.flak = undefined;
    mount.weapon.projectileSpeed = 0;
    const inbound = missile();
    const sim = new ClientCombatSimulation();
    sim.addShip(defender);
    sim.drainAudioEvents();
    sim.projectiles = [inbound];
    for (let tick = 0; tick < 60; tick++) sim.update(STEP);
    expect(inbound.hp).toBeGreaterThan(0);
    expect(sim.audioEvents).toEqual([]);
    for (let tick = 0; tick < 10; tick++) sim.update(STEP);
    expect(inbound.hp).toBe(0);
    expect(sim.audioEvents).toHaveLength(1);
    expect(sim.audioEvents[0]).toMatchObject({
      type: "laser_intercept",
      sourceId: defender.id,
      targetId: inbound.id,
      team: 0,
    });
  });

  it("emits fighter egress on a mission shot and emits recovery retreat only once", () => {
    const fighter = ship("strike_craft");
    const target = ship("battleship", 1, [400, 0]);
    target.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(fighter);
    sim.addShip(target);
    sim.drainAudioEvents();
    sim.update(STEP);
    expect(fighter.fighterPhase).toBe("egress");
    expect(sim.audioEvents.filter((event) => event.type === "fighter_egress")).toHaveLength(1);
    fighter.hullCurrent = fighter.hullMax * 0.29;
    fighter.shieldCurrent = 0;
    sim.update(STEP * 30);
    expect(fighter.fighterPhase).toBe("recover");
    expect(sim.audioEvents.filter((event) => event.type === "fighter_egress")).toHaveLength(1);

    const wounded = ship("strike_craft");
    wounded.hullCurrent = wounded.hullMax * 0.29;
    wounded.shieldCurrent = 0;
    const recovery = new ClientCombatSimulation();
    recovery.addShip(wounded);
    recovery.addShip(target);
    recovery.drainAudioEvents();
    recovery.update(STEP * 30);
    expect(recovery.audioEvents.filter((event) => event.type === "fighter_egress")).toHaveLength(1);
  });
});
