import { describe, expect, it } from "vitest";
import {
  carrierFabricationProgress,
  storeCarrierAuxiliaries,
  updateCarrierHangars,
} from "../src/engine/carrierHangar";
import {
  fighterRecoveryDirection,
  friendlyShieldRecoveryDirection,
} from "../src/engine/fighterRecovery";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HarmonicShieldSystem } from "../src/engine/harmonicShieldSystem";
import { vecDistance, vecDot, vecNormalize, vecSub } from "../src/engine/math2d";
import { shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { HULL_PROFILES } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState, Vector2 } from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2 = [0, 0], team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = pos;
  return result;
}

describe("carrier fabrication", () => {
  it("fabricates a docked pair every 20 seconds and launches it next wave", () => {
    const carrier = ship("deck", "carrier");
    const ships = [carrier];
    storeCarrierAuxiliaries(ships);
    updateCarrierHangars(ships, 19.999);
    expect(ships).toHaveLength(1);
    expect(carrierFabricationProgress(carrier, 10)).toEqual({
      timerRemaining: 10,
      currentWings: 0,
      maxWings: 16,
    });
    updateCarrierHangars(ships, 20);
    expect(ships).toHaveLength(3);
    for (const craft of ships.slice(1)) {
      expect(craft.isDocked).toBe(true);
      expect(craft.flagshipId).toBe(carrier.id);
      expect(craft.pos).toEqual(carrier.pos);
      expect(craft.hullCurrent).toBe(HULL_PROFILES.strike_craft.hullMax);
      expect(craft.turrets.length).toBeGreaterThan(0);
    }
    updateCarrierHangars(ships, 21);
    expect(ships.slice(1).every((craft) => !craft.isDocked)).toBe(true);
    updateCarrierHangars(ships, 40);
    expect(ships).toHaveLength(5);
    expect(new Set(ships.map((craft) => craft.id)).size).toBe(5);
  });

  it("counts docked and deployed survivors, caps at 16, and replaces losses", () => {
    const ships = buildFleetFromSlots(
      [{ id: "deck", hullClass: "carrier", groupId: 1, wingSize: 16 }],
      0,
      0,
      0,
    );
    const carrier = ships[0];
    updateCarrierHangars(ships, 20);
    expect(ships).toHaveLength(17);
    ships[1].isAlive = false;
    updateCarrierHangars(ships, 40);
    expect(ships).toHaveLength(18);
    expect(carrierFabricationProgress(carrier, 40).currentWings).toBe(16);
    carrier.isAlive = false;
    updateCarrierHangars(ships, 60);
    expect(ships).toHaveLength(18);
    expect(ships.at(-1)?.isAlive).toBe(false);
  });

  it("catches up elapsed cycles and resets its clock on redeployment", () => {
    const carrier = ship("deck", "carrier");
    const ships = [carrier];
    storeCarrierAuxiliaries(ships);
    updateCarrierHangars(ships, 60);
    expect(ships).toHaveLength(7);
    storeCarrierAuxiliaries(ships);
    updateCarrierHangars(ships, 19);
    expect(ships).toHaveLength(7);
    updateCarrierHangars(ships, 20);
    expect(ships).toHaveLength(9);
  });

  it("retains fabricated ships in the simulation's authoritative fleet", () => {
    const sim = new ClientCombatSimulation();
    const carrier = ship("deck", "carrier");
    const enemy = ship("enemy", "carrier", [8000, 0], 1);
    for (const craft of [carrier, enemy]) {
      craft.turrets = [];
      craft.maxSpeed = 0;
      sim.addShip(craft);
    }
    for (let i = 0; i < 1201; i++) sim.update(1 / 60);
    expect(sim.ships.filter((craft) => craft.flagshipId === carrier.id)).toHaveLength(2);
  });
});

describe("tender state inspection", () => {
  it("reports active transfer, four-second recharge, readiness, and restart", () => {
    const tender = ship("tender", "tender");
    const recipient = ship("recipient", "battleship", [100, 0]);
    recipient.shieldCurrent = 0;
    const system = new HarmonicShieldSystem();
    expect(system.getTenderState(tender.id, 0)).toBeNull();
    system.update([tender, recipient], 1, 1);
    expect(system.getTenderState(tender.id, 1)).toEqual({
      active: true,
      recipientId: recipient.id,
      timeRemaining: 5,
      cooldownRemaining: 0,
    });
    expect(system.getTenderState(tender.id, 6)).toEqual({
      active: false,
      recipientId: null,
      timeRemaining: 0,
      cooldownRemaining: 4,
    });
    expect(system.getTenderState(tender.id, 10)?.cooldownRemaining).toBe(0);
    system.update([tender, recipient], 11, 1);
    expect(system.getTenderState(tender.id, 11)?.timeRemaining).toBe(5);
    tender.isAlive = false;
    expect(system.getTenderState(tender.id, 11)).toBeNull();
    system.clear();
    expect(system.getTenderState(tender.id, 11)).toBeNull();
  });

  it("reports interrupted channels without changing the original ready time", () => {
    const tender = ship("tender", "tender");
    const recipient = ship("recipient", "battleship", [100, 0]);
    recipient.shieldCurrent = 0;
    const system = new HarmonicShieldSystem();
    system.update([tender, recipient], 1, 1);
    recipient.pos = [600, 0];
    expect(system.getTenderState(tender.id, 2)).toEqual({
      active: false,
      recipientId: null,
      timeRemaining: 0,
      cooldownRemaining: 8,
    });
  });
});

describe("situational recovery evasion", () => {
  it("moves away from either side of the nearest firing line", () => {
    const craft = ship("fighter", "strike_craft");
    const enemy = ship("enemy", "strike_craft", [-100, -20], 1);
    const route = () => fighterRecoveryDirection(craft, [1000, 0], [craft, enemy], 1);
    expect(route()[1]).toBeGreaterThan(0);
    enemy.pos[1] = 20;
    expect(route()[1]).toBeLessThan(0);
    enemy.heading = Math.PI;
    expect(route()).toEqual([1, 0]);
    enemy.heading = 0;
    enemy.isAlive = false;
    expect(route()).toEqual([1, 0]);
  });

  it("uses per-craft phase and frequency deterministically and fades near docking", () => {
    const craft = ship("fighter-a", "strike_craft");
    const other = ship("fighter-b", "strike_craft");
    const enemy = ship("enemy", "strike_craft", [-100, -20], 1);
    const route = (time: number) => fighterRecoveryDirection(craft, [1000, 0], [enemy], time);
    expect(route(1)).toEqual(route(1));
    expect(route(1)).not.toEqual(fighterRecoveryDirection(other, [1000, 0], [enemy], 1));
    expect(route(1)).not.toEqual(route(2));
    expect(fighterRecoveryDirection(craft, [59, 0], [enemy], 1)).toEqual([1, 0]);
  });

  it("prioritizes a closer incoming projectile and ignores friendly or departing shots", () => {
    const craft = ship("fighter", "strike_craft");
    const enemy = ship("enemy", "strike_craft", [-200, -20], 1);
    const projectile: ProjectileState = {
      id: "shot",
      ownerId: enemy.id,
      ownerTeam: 1,
      pos: [-50, 20],
      velocity: [100, 0],
      lifetime: 1,
      weaponType: "missile",
      damage: 1,
      targetId: craft.id,
      hp: 1,
      maxHp: 1,
      weapon: HULL_PROFILES.strike_craft.turrets[0].weapon,
    };
    const route = () => fighterRecoveryDirection(craft, [1000, 0], [enemy], 1, [projectile]);
    expect(route()[1]).toBeLessThan(0);
    projectile.ownerTeam = 0;
    expect(route()[1]).toBeGreaterThan(0);
    projectile.ownerTeam = 1;
    projectile.velocity = [-100, 0];
    expect(route()[1]).toBeGreaterThan(0);
  });

  it.each(["carrier", "battleship", "dreadnought"] as const)(
    "curves tangentially around a friendly %s shield",
    (hullClass) => {
      const capital = ship("capital", hullClass, [500, 0]);
      const craft = ship("fighter", "strike_craft");
      const radius = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(craft) + 60;
      craft.pos = [500 - radius, 0];
      const route = friendlyShieldRecoveryDirection(craft, [1200, 0], [capital], [1, 0]);
      expect(Math.abs(route[1])).toBeGreaterThan(0.9);
      expect(vecDot(route, vecNormalize(vecSub(capital.pos, craft.pos)))).toBeLessThan(0.01);
      craft.pos[0] += 1;
      const next = friendlyShieldRecoveryDirection(craft, [1200, 0], [capital], [1, 0]);
      expect(vecDistance(route, next)).toBeLessThan(0.05);
    },
  );
});
