import { describe, expect, it } from "vitest";
import { carrierRecoveryPoint, moveCarrierRecovery } from "../src/engine/carrierHangar";
import { fighterRecoveryDirection } from "../src/engine/fighterRecovery";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent, carrierStandoffVelocity } from "../src/engine/flightControl";
import { vecDistance } from "../src/engine/math2d";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, Vector2, WeaponDefinition } from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2, team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [...pos];
  result.turrets = [];
  return result;
}

describe("carrier rear anchor", () => {
  it("holds 1400u behind friendly capitals regardless of brawl orders", () => {
    const carrier = ship("deck", "carrier", [-1400, 0]);
    const ally = ship("line", "battleship", [0, 0]);
    const enemy = ship("enemy", "battleship", [700, 0], 1);
    const ships = [carrier, ally, enemy];
    expect(
      capitalIntent(carrier, enemy, ships, {
        groupId: 1,
        priority: "capitals",
        stance: "brawl",
      }).velocity,
    ).toEqual([0, 0]);
    carrier.pos = [-1000, 0];
    for (let i = 0; i < 600; i++) {
      const velocity = carrierStandoffVelocity(carrier, ships);
      carrier.pos[0] += velocity[0] * 0.1;
      carrier.pos[1] += velocity[1] * 0.1;
    }
    expect(vecDistance(carrier.pos, ally.pos)).toBeCloseTo(1400, 1);
    expect(vecDistance(carrier.pos, enemy.pos)).toBeCloseTo(2100, 1);
  });

  it("holds an isolated pocket and reverses when a hostile capital closes within 1200u", () => {
    const carrier = ship("deck", "carrier", [0, 0]);
    const enemy = ship("enemy", "battleship", [1400, 0], 1);
    expect(carrierStandoffVelocity(carrier, [carrier, enemy])).toEqual([0, 0]);
    enemy.pos = [1100, 0];
    expect(carrierStandoffVelocity(carrier, [carrier, enemy])[0]).toBeLessThan(0);
  });
});

describe("fighter evasive recovery", () => {
  it("weaves both laterally and toward the deck only with a live hostile within 300u", () => {
    const carrier = ship("deck", "carrier", [1200, 0]);
    const craft = ship("craft", "strike_craft", [0, 0]);
    const pursuer = ship("pursuer", "corvette", [-200, 0], 1);
    craft.flagshipId = carrier.id;
    craft.carrierRecovering = true;
    const ships = [carrier, craft, pursuer];
    moveCarrierRecovery(craft, ships, 1 / 60, Math.PI / 8);
    expect(craft.velocity[0]).toBeGreaterThan(0);
    expect(craft.velocity[1]).toBeGreaterThan(0);
    craft.pos = [0, 0];
    craft.velocity = [0, 0];
    moveCarrierRecovery(craft, ships, 1 / 60, (Math.PI * 3) / 8);
    expect(craft.velocity[1]).toBeLessThan(0);
    craft.pos = [0, 0];
    craft.velocity = [0, 0];
    pursuer.pos = [-300, 0];
    moveCarrierRecovery(craft, ships, 1 / 60, Math.PI / 8);
    const pad = carrierRecoveryPoint(carrier, craft);
    expect(craft.velocity[1] / craft.velocity[0]).toBeCloseTo(pad[1] / pad[0]);
    craft.pos = carrierRecoveryPoint(carrier, craft);
    craft.velocity = [0, 0];
    moveCarrierRecovery(craft, ships, 1 / 60, Math.PI / 8);
    expect(craft.isDocked).toBeFalsy();
    expect(vecDistance(craft.pos, pad)).toBeGreaterThan(0);
  });

  it("routes near an intervening capital umbrella and ignores capitals outside the return corridor", () => {
    const craft = ship("craft", "strike_craft", [0, 0]);
    const pursuer = ship("pursuer", "strike_craft", [-200, 0], 1);
    const escort = ship("escort", "dreadnought", [500, 300]);
    expect(
      fighterRecoveryDirection(craft, [1200, 0], [craft, pursuer, escort], 0)[1],
    ).toBeGreaterThan(0);
    escort.pos = [-500, 300];
    expect(fighterRecoveryDirection(craft, [1200, 0], [craft, pursuer, escort], 0)).toEqual([1, 0]);
  });
});

describe("shield collapse penetration", () => {
  const weapon: WeaponDefinition = {
    weaponType: "missile",
    name: "torpedo",
    damage: 100,
    cooldown: 1,
    range: 1200,
    projectileSpeed: 300,
    trackingSpeed: 1,
    shieldMultiplier: 1,
    armorMultiplier: 1,
    hullMultiplier: 1,
    cost: 1,
  };

  it.each(["missile", "railgun", "beam_laser"] as const)(
    "handles %s residual damage",
    (weaponType) => {
      const target = ship("target", "battleship", [0, 0]);
      target.shieldCurrent = 30;
      target.armorCurrent = 10;
      target.armorRating = 0;
      const beforeHull = target.hullCurrent;
      const sim = new ClientCombatSimulation();
      sim.addShip(target);
      sim["weapons"].applyDamage(target, 100, { ...weapon, weaponType }, 1);
      expect(target.shieldCurrent).toBe(0);
      expect(target.armorCurrent).toBe(weaponType === "missile" ? 10 : 0);
      expect(target.hullCurrent).toBe(beforeHull - (weaponType === "missile" ? 0 : 60));
      expect(sim.stats[1].damageDealt).toBe(weaponType === "missile" ? 30 : 100);
    },
  );

  it("allows a subsequent torpedo to damage an already collapsed shield", () => {
    const target = ship("target", "battleship", [0, 0]);
    target.shieldCurrent = 0;
    target.armorCurrent = 0;
    const beforeHull = target.hullCurrent;
    const sim = new ClientCombatSimulation();
    sim.addShip(target);
    sim["weapons"].applyDamage(target, 100, weapon, 1);
    expect(target.hullCurrent).toBe(beforeHull - 100);
  });
});
