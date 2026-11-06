import { describe, expect, it, vi } from "vitest";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { buildFleetFromSlots, fleetSlotCost } from "../src/engine/fleetBuilder";
import { supportVelocity } from "../src/engine/flightControl";
import { HarmonicShieldSystem } from "../src/engine/harmonicShieldSystem";
import { vecDistance } from "../src/engine/math2d";
import {
  activeShieldRadius,
  shieldEnvelopeRadius,
  shieldRepulsorRadius,
} from "../src/engine/shieldGeometry";
import { ShieldHavenSystem, shieldHavenSlotPosition } from "../src/engine/shieldHaven";
import { updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2 } from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2 = [0, 0], team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [...pos];
  result.turrets = [];
  result.shieldRegen = 0;
  return result;
}

function advance(system: HarmonicShieldSystem, ships: ShipState[], start: number, seconds: number) {
  for (let step = 1; step <= Math.round(seconds * 60); step++)
    system.update(ships, start + step / 60, 1 / 60);
}

describe("harmonic shield restoration", () => {
  it("delivers 390 SP over six seconds, recharges for four, then resumes at 65 SP/s", () => {
    const donor = ship("donor", "tender");
    const recipient = ship("recipient", "battleship", [500, 0]);
    recipient.shieldCurrent = 0;
    recipient.shieldDelayTimer = 3;
    const system = new HarmonicShieldSystem();
    advance(system, [donor, recipient], 0, 6);
    expect(recipient.shieldCurrent).toBeCloseTo(390);
    expect(system.collectActiveBeams()).toHaveLength(0);
    advance(system, [donor, recipient], 6, 4);
    expect(recipient.shieldCurrent).toBeCloseTo(390);
    advance(system, [donor, recipient], 10, 6);
    expect(recipient.shieldCurrent).toBeCloseTo(780);
    expect(recipient.shieldDelayTimer).toBe(3);
    expect(recipient.armorCurrent).toBe(recipient.armorMax);
    expect(recipient.hullCurrent).toBe(recipient.hullMax);
  });

  it("rejects self, all tenders, enemies, dead ships, full shields and out-of-range allies", () => {
    const donor = ship("donor", "tender");
    const tender = ship("tender", "tender");
    const enemy = ship("enemy", "cruiser", [100, 0], 1);
    const dead = ship("dead", "cruiser", [100, 0]);
    const far = ship("far", "cruiser", [500.001, 0]);
    const full = ship("full", "cruiser", [100, 0]);
    for (const s of [donor, tender, enemy, dead, far]) s.shieldCurrent = 0;
    dead.isAlive = false;
    const ships = [donor, tender, enemy, dead, far, full];
    const system = new HarmonicShieldSystem();
    advance(system, ships, 0, 20);
    expect(ships.map((s) => s.shieldCurrent)).toEqual([0, 0, 0, 0, 0, full.shieldMax]);
    expect(system.collectActiveBeams()).toEqual([]);
  });

  it.each([false, true])(
    "allows only one incoming channel independently of storage order (reversed=%s)",
    (reverse) => {
      const first = ship("a", "tender");
      const second = ship("b", "tender");
      const recipient = ship("recipient", "battleship", [400, 0]);
      recipient.shieldCurrent = 0;
      const ships = [first, second, recipient];
      const system = new HarmonicShieldSystem();
      advance(system, reverse ? ships.reverse() : ships, 0, 1);
      expect(recipient.shieldCurrent).toBeCloseTo(65);
      expect(system.collectActiveBeams().map((beam) => beam.id)).toEqual(["a:harmonic"]);
    },
  );

  it("lets multiple donors serve distinct recipients", () => {
    const donors = [ship("a", "tender"), ship("b", "tender")];
    const recipients = [ship("x", "battleship", [400, 0]), ship("y", "cruiser", [400, 0])];
    for (const s of recipients) s.shieldCurrent = 0;
    const system = new HarmonicShieldSystem();
    advance(system, [...donors, ...recipients], 0, 1);
    for (const recipient of recipients) expect(recipient.shieldCurrent).toBeCloseTo(65);
    expect(system.collectActiveBeams()).toHaveLength(2);
  });

  it.each(["range", "recipient death", "full shields", "team change", "donor death"])(
    "interrupts immediately on %s without retargeting or resetting the cycle",
    (reason) => {
      const donor = ship("donor", "tender");
      const recipient = ship("recipient", "battleship", [400, 0]);
      recipient.shieldCurrent = 0;
      const spare = ship("spare", "cruiser", [400, 0]);
      const system = new HarmonicShieldSystem();
      const ships = [donor, recipient, spare];
      advance(system, ships, 0, 1);
      spare.shieldCurrent = 0;
      if (reason === "range") recipient.pos = [501, 0];
      if (reason === "recipient death") recipient.isAlive = false;
      if (reason === "full shields") recipient.shieldCurrent = recipient.shieldMax;
      if (reason === "team change") recipient.team = 1;
      if (reason === "donor death") donor.isAlive = false;
      const before = recipient.shieldCurrent;
      advance(system, ships, 1, 9);
      expect(recipient.shieldCurrent).toBe(before);
      expect(spare.shieldCurrent).toBe(0);
      expect(system.collectActiveBeams()).toHaveLength(0);
      if (donor.isAlive) {
        advance(system, ships, 10, 1);
        expect(spare.shieldCurrent).toBeCloseTo(65);
      }
    },
  );

  it.each([
    [0, "#22d3ee"],
    [1, "#f43f5e"],
  ] as const)("caps overheal and uses team %i channel visuals", (team, color) => {
    const donor = ship("donor", "tender", [0, 0], team);
    const recipient = ship("recipient", "cruiser", [400, 0], team);
    recipient.shieldCurrent -= 2;
    const system = new HarmonicShieldSystem();
    const callback = vi.fn();
    system.update([donor, recipient], 1 / 60, 1 / 60, callback);
    expect(callback).toHaveBeenCalledWith(donor.pos, recipient.pos, color, 2.8, team, true);
    expect(system.collectActiveBeams()[0]).toMatchObject({
      color,
      ownerTeam: team,
      harmonic: true,
    });
    system.update([donor, recipient], 2 / 60, 1 / 60);
    expect(recipient.shieldCurrent).toBe(recipient.shieldMax);
    recipient.shieldCurrent = 0;
    advance(system, [donor, recipient], 2 / 60, 1);
    expect(recipient.shieldCurrent).toBe(0);
  });

  it("interrupts on native recharge reaching full before another impact in the same step", () => {
    const donor = ship("donor", "tender", [-425, 0]);
    const recipient = ship("recipient", "battleship");
    recipient.shieldCurrent = 100;
    const sim = new ClientCombatSimulation();
    sim.addShip(donor);
    sim.addShip(recipient);
    sim.update(1 / 60);
    expect(sim.activeBeams).toHaveLength(1);
    recipient.shieldRegen = 60;
    recipient.shieldCurrent = recipient.shieldMax - 0.5;
    vi.spyOn(sim["projectileEngine"], "updateProjectiles").mockImplementationOnce(() => {
      recipient.shieldCurrent -= 100;
    });
    sim.update(1 / 60);
    expect(recipient.shieldCurrent).toBe(recipient.shieldMax - 100);
    expect(sim.activeBeams).toHaveLength(0);
  });

  it("integrates transfer, native regeneration, telemetry, visuals and remnant reset", () => {
    const donor = ship("donor", "tender", [-425, 0]);
    const recipient = ship("recipient", "battleship");
    recipient.shieldCurrent = 0;
    recipient.shieldRegen = 50;
    const sim = new ClientCombatSimulation();
    sim.addShip(donor);
    sim.addShip(recipient);
    sim.observer = new CombatTelemetry(sim.ships);
    sim.update(1);
    expect(recipient.shieldCurrent).toBeCloseTo(115);
    expect((sim.observer as CombatTelemetry).shieldRegenerated.recipient).toBeCloseTo(115);
    expect(sim.activeBeams.map((beam) => beam.id)).toContain("donor:harmonic");
    sim.continueBattleWithRemnants();
    expect(sim.harmonicShields.collectActiveBeams()).toEqual([]);
    recipient.pos = [0, 0];
    donor.pos = [-425, 0];
    recipient.shieldCurrent = 0;
    sim.update(1 / 60);
    expect(recipient.shieldCurrent).toBeCloseTo(115 / 60);
  });
});

describe("tender haven amplification", () => {
  it.each([false, true])(
    "uses the amplified envelope for real projectile collision (aura=%s)",
    (active) => {
      const parent = ship("parent", "battleship");
      const donor = ship("donor", "tender", [active ? 400 : 501, 0]);
      const attacker = buildFleetFromSlots(
        [{ id: "attacker", hullClass: "strike_craft", groupId: 1 }],
        1,
        1000,
        Math.PI,
      )[0];
      const sim = new ClientCombatSimulation();
      for (const s of [parent, donor, attacker]) sim.addShip(s);
      sim.shieldHaven.cleanup(sim.ships);
      sim["fireWeapon"](attacker, attacker.turrets[0], parent.pos, parent);
      const projectile = sim.projectiles[0];
      projectile.pos = [0, 125]; // Outside 114.24u base; inside 137.088u amplified umbrella.
      projectile.velocity = [0, 0];
      sim["updateProjectiles"](1 / 60, sim.ships);
      expect(parent.shieldCurrent).toBe(parent.shieldMax - (active ? 120 : 0));
      expect(sim.projectiles).toHaveLength(active ? 0 : 1);
    },
  );

  it("enlarges authoritative hitboxes and repulsors once, retaining slots and excluding tender guests", () => {
    const parent = ship("parent", "battleship");
    const donors = [ship("a", "tender", [500, 0]), ship("b", "tender", [-500, 0])];
    const system = new ShieldHavenSystem();
    system.cleanup([parent, ...donors]);
    expect(shieldEnvelopeRadius(parent)).toBeCloseTo(parent.size * 1.68 * 1.2);
    expect(activeShieldRadius(parent)).toBeCloseTo(parent.size * 1.68 * 1.2);
    expect(shieldRepulsorRadius(parent)).toBeCloseTo(parent.size * 1.68 * 1.2);
    expect(shieldHavenSlotPosition(parent, "port-mid")).toEqual([0, -parent.size * 1.05]);
    expect(shieldEnvelopeRadius(donors[0])).toBeCloseTo(donors[0].size * 1.4);
    donors[0].shieldCurrent = 0;
    expect(system.request(donors[0], [parent, ...donors], 0)).toBeNull();
    donors[0].isAlive = false;
    donors[1].pos = [-500.001, 0];
    system.cleanup([parent, ...donors]);
    expect(shieldEnvelopeRadius(parent)).toBeCloseTo(parent.size * 1.68);
    donors[1].pos = [100, 0];
    donors[1].team = 1;
    system.cleanup([parent, ...donors]);
    expect(parent.havenRadiusMultiplier).toBe(1);
  });

  it.each([1, 2])(
    "reduces raw overflow once at collapse with shield multiplier %s, then releases protection",
    (multiplier) => {
      const parent = ship("parent", "battleship");
      const craft = ship("craft", "strike_craft");
      const donor = ship("donor", "tender", [400, 0]);
      const other = ship("other", "tender", [-400, 0]);
      craft.shieldCurrent = 0;
      craft.armorCurrent = 0;
      craft.hullMax = craft.hullCurrent = 500;
      const sim = new ClientCombatSimulation();
      for (const s of [parent, craft, donor, other]) sim.addShip(s);
      const lease = sim.shieldHaven.request(craft, sim.ships, 0);
      if (!lease) throw new Error("Expected haven lease");
      craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
      sim.shieldHaven.attachGuests(sim.ships, 1 / 60);
      expect(craft.havenState).toBe("tethered");
      parent.shieldCurrent = 100 * multiplier;
      const weapon = {
        ...buildFleetFromSlots([{ id: "weapon", hullClass: "cruiser", groupId: 1 }], 1, 0, 0)[0]
          .turrets[1].weapon,
        shieldMultiplier: multiplier,
        armorMultiplier: 1,
        hullMultiplier: 1,
      };
      sim["weapons"].applyDamage(craft, 10, weapon, 1);
      expect(parent.shieldCurrent).toBe(90 * multiplier);
      expect(craft.hullCurrent).toBe(500);
      parent.shieldCurrent = 100 * multiplier;
      sim["weapons"].applyDamage(craft, 220, weapon, 1);
      expect(parent.shieldCurrent).toBe(0);
      expect(craft.hullCurrent).toBeCloseTo(500 - 108);
      expect(sim.shieldHaven.getLease(craft.id)).toBeNull();
      expect(craft.havenState).toBe("releasing");
      sim["weapons"].applyDamage(craft, 100, weapon, 1);
      expect(craft.hullCurrent).toBeCloseTo(500 - 108 - 100);
      sim["weapons"].destroyShip(donor, 1);
      sim["weapons"].destroyShip(other, 1);
      expect(parent.havenRadiusMultiplier).toBe(1);
    },
  );
});

describe("tender fleet and support flight", () => {
  it("spawns configured tenders with distinct IDs, the specified flak and capital anchors", () => {
    const fleet = buildFleetFromSlots(
      [
        { id: "parent", hullClass: "battleship", groupId: 1 },
        { id: "a", hullClass: "tender", groupId: 1 },
        { id: "b", hullClass: "tender", groupId: 2 },
      ],
      0,
      0,
      0,
    );
    const donors = fleet.filter((s) => s.hullClass === "tender");
    expect(donors).toHaveLength(2);
    expect(new Set(fleet.map((s) => s.id)).size).toBe(3);
    expect(donors[0]).toMatchObject({
      cost: 1250,
      size: 32,
      maxSpeed: 75,
      turnRate: 0.8,
      shieldMax: 650,
      shieldRegen: 15,
      shieldRechargeDelay: 3,
      armorMax: 450,
      armorRating: 30,
      hullMax: 800,
      flagshipId: fleet[0].id,
    });
    expect(donors[0].turrets).toHaveLength(1);
    expect(donors[0].turrets[0]).toMatchObject({
      baseArc: [-Math.PI, Math.PI],
      trackingSpeed: 2.5,
      weapon: {
        range: 420,
        trackingSpeed: 2.5,
        damage: 10,
        cooldown: 0.3,
        flak: { lifetime: 0.32, triggerRadius: 15, blastRadius: 30, missileDamage: 18 },
      },
    });
    expect(fleetSlotCost({ id: "tender", hullClass: "tender", groupId: 1 })).toBe(1250);
  });

  it("holds a rear station at 425u and retreats away from enemies when isolated or damaged", () => {
    const donor = ship("donor", "tender", [-425, 0]);
    const parent = ship("parent", "battleship");
    const enemy = ship("enemy", "battleship", [1000, 0], 1);
    const orbit = supportVelocity(donor, [donor, parent, enemy]);
    expect(orbit[0]).toBeCloseTo(0);
    expect(orbit[1]).toBeCloseTo(0);
    expect(supportVelocity(donor, [donor, enemy])[0]).toBeLessThan(0);
    donor.hullCurrent = 200;
    expect(supportVelocity(donor, [donor, parent, enemy])[0]).toBeLessThan(0);
  });

  it("advances with healthy frigates instead of retreating at the opening", () => {
    const donor = ship("donor", "tender", [-600, 0]);
    const frigates = [-200, 0, 200].map((y, index) =>
      ship(`frigate_${index}`, "missile_frigate", [0, y]),
    );
    const enemies = frigates.map((ally, index) =>
      ship(`enemy_${index}`, "missile_frigate", [1800, ally.pos[1]], 1),
    );
    enemies.push(ship("enemy_tender", "tender", [2200, 0], 1));
    expect(supportVelocity(donor, [donor, ...frigates, ...enemies])[0]).toBeGreaterThan(0);
    donor.pos = [-1200, 0];
    expect(supportVelocity(donor, [donor, ...frigates, ...enemies])[0]).toBeGreaterThan(0);
  });

  it.each(["depleted", "heavy fire"])(
    "boosts pursuit for %s and releases it on recovery",
    (damage) => {
      const donor = ship("donor", "tender", [-700, 0]);
      donor.heading = 0;
      const ally = ship("ally", "missile_frigate");
      ally.shieldCurrent = damage === "depleted" ? 0 : ally.shieldMax * 0.3;
      ally.shieldDelayTimer = 3;
      const sim = new ClientCombatSimulation();
      const move = (dt: number) =>
        updateShipNavigation(donor, null, [donor, ally], dt, sim, () => ({ heading: 0, speed: 0 }));
      move(0.1);
      expect(donor.velocity[0]).toBeCloseTo(110 * 1.35 * 0.1);
      move(1);
      expect(donor.velocity[0]).toBeCloseTo(donor.maxSpeed * 1.35);
      expect(donor.maxSpeed).toBe(75);
      ally.shieldCurrent = ally.shieldMax;
      ally.shieldDelayTimer = 0;
      move(0.1);
      expect(Math.hypot(...donor.velocity)).toBeLessThanOrEqual(donor.maxSpeed);
    },
  );

  it("brakes a critically wounded frigate into a nearby live Tender's beam range", () => {
    const donor = ship("donor", "tender");
    const ally = ship("ally", "missile_frigate", [700, 0]);
    ally.heading = 0;
    ally.velocity = [ally.maxSpeed, 0];
    ally.shieldCurrent = 0;
    ally.hullCurrent = ally.hullMax * 0.3;
    const enemy = ship("enemy", "missile_frigate", [2000, 0], 1);
    const sim = new ClientCombatSimulation();
    const move = () =>
      updateShipNavigation(ally, enemy, [donor, ally, enemy], 0.1, sim, () => ({
        heading: 0,
        speed: 0,
      }));
    const initialSpeed = ally.velocity[0];
    move();
    expect(ally.velocity[0]).toBeLessThan(initialSpeed);
    for (let frame = 0; frame < 200; frame++) move();
    expect(vecDistance(donor.pos, ally.pos)).toBeLessThan(500);
  });

  it("maintains a live allied tether in the simulation even under a brawl order", () => {
    const donor = ship("donor", "tender", [-425, 0]);
    const parent = ship("parent", "battleship");
    const sim = new ClientCombatSimulation();
    sim.addShip(donor);
    sim.addShip(parent);
    sim.setGroupOrder({ groupId: 1, priority: "nearest", stance: "brawl" });
    for (let step = 0; step < 20; step++) sim.update(1);
    expect(vecDistance(donor.pos, parent.pos)).toBeGreaterThan(350);
    expect(vecDistance(donor.pos, parent.pos)).toBeLessThan(500);
    expect(donor.havenState).toBe("none");
  });
});
