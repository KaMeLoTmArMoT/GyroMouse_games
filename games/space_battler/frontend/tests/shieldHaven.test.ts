import { describe, expect, it, vi } from "vitest";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { calculateSeparation } from "../src/engine/flightBehaviors";
import { normalizeAngle, vecDistance } from "../src/engine/math2d";
import { activeShieldRadius, shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import {
  havenAcceleration,
  havenHullClearance,
  SHIELD_HAVEN_SLOTS,
  type ShieldHavenSlotId,
  ShieldHavenSystem,
  sharesShieldHaven,
  shieldHavenSlotPosition,
  shieldHavenSlotVelocity,
} from "../src/engine/shieldHaven";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2, WeaponType } from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2 = [0, 0], team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, pos[0], 0)[0];
  result.id = id;
  result.pos = [...pos];
  result.turrets = [];
  result.shieldRegen = 0;
  return result;
}

function guest(id = "guest", hull: "strike_craft" | "corvette" = "strike_craft"): ShipState {
  const result = ship(id, hull, [-400, 0]);
  result.shieldCurrent = 0;
  return result;
}

describe("authoritative shield geometry", () => {
  it.each(["battleship", "dreadnought", "cruiser"] as const)(
    "enlarges %s shields by 20 percent to 1.68x size",
    (hull) => {
      const parent = ship("parent", hull);
      expect(shieldEnvelopeRadius(parent)).toBeCloseTo(parent.size * 1.68);
      expect(shieldEnvelopeRadius(parent) / (parent.size * 1.4)).toBeCloseTo(1.2);
      expect(activeShieldRadius(parent)).toBe(shieldEnvelopeRadius(parent));
      parent.shieldCurrent = 0;
      expect(activeShieldRadius(parent)).toBe(parent.size);
    },
  );

  it.each(["corvette", "strike_craft", "missile_frigate"] as const)(
    "keeps %s at the standard 1.40x envelope",
    (hull) => {
      const light = ship("light", hull);
      expect(shieldEnvelopeRadius(light)).toBeCloseTo(light.size * 1.4);
    },
  );

  it.each(["battleship", "dreadnought", "cruiser"] as const)(
    "provides six distinct %s side slots inside the umbrella and outside the hull",
    (hull) => {
      const parent = ship("parent", hull);
      const offsets = Object.entries(SHIELD_HAVEN_SLOTS);
      expect(offsets.map(([id]) => id)).toEqual([
        "port-forward",
        "port-mid",
        "port-aft",
        "starboard-forward",
        "starboard-mid",
        "starboard-aft",
      ]);
      const positions = offsets.map(([id]) =>
        shieldHavenSlotPosition(parent, id as ShieldHavenSlotId),
      );
      expect(new Set(positions.map((pos) => pos.join(","))).size).toBe(6);
      const guestSize = hull === "cruiser" ? 10 : 20;
      for (const pos of positions) {
        expect(vecDistance(parent.pos, pos) + guestSize).toBeLessThan(shieldEnvelopeRadius(parent));
        // Capital side hulls fit within 0.75x size; leave room for the guest hull too.
        expect(Math.abs(pos[1]) - guestSize).toBeGreaterThan(parent.size * 0.75);
      }
    },
  );

  it("rotates and translates local slots with the moving parent", () => {
    const parent = ship("parent", "battleship", [100, -200]);
    parent.heading = Math.PI / 2;
    const forward = shieldHavenSlotPosition(parent, "port-forward");
    expect(forward[0]).toBeCloseTo(100 + parent.size * 1.05);
    expect(forward[1]).toBeCloseTo(-200 + parent.size * 0.65);
    parent.pos = [-20, 30];
    parent.heading = Math.PI;
    const moved = shieldHavenSlotPosition(parent, "port-forward");
    expect(moved[0]).toBeCloseTo(-20 - parent.size * 0.65);
    expect(moved[1]).toBeCloseTo(30 + parent.size * 1.05);
  });
});

function dockedSimulation(hull: "strike_craft" | "corvette" = "strike_craft") {
  const parent = ship("parent", "battleship");
  const craft = guest("guest", hull);
  const sim = new ClientCombatSimulation();
  sim.addShip(parent);
  sim.addShip(craft);
  const lease = sim.shieldHaven.request(craft, sim.ships, 0);
  if (!lease) throw new Error("Expected haven reservation");
  craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
  craft.velocity = shieldHavenSlotVelocity(parent, lease.slotId);
  sim.shieldHaven.attachGuests(sim.ships, 1 / 60);
  expect(craft.havenState).toBe("tethered");
  return { sim, parent, craft, lease };
}

function havenAttack(sim: ClientCombatSimulation, craft: ShipState, type: WeaponType) {
  const attacker = buildFleetFromSlots(
    [{ id: "attacker", hullClass: "battleship", groupId: 1 }],
    1,
    0,
    Math.PI / 2,
  )[0];
  attacker.pos = [craft.pos[0], craft.pos[1] - 500];
  const turret = attacker.turrets[0];
  attacker.turrets = [turret];
  turret.offset = [0, 0];
  turret.currentLocalAngle = 0;
  turret.baseArc = [-Math.PI, Math.PI];
  turret.currentTargetId = craft.id;
  turret.weapon = {
    ...turret.weapon,
    weaponType: type,
    damage: type === "beam_laser" ? 72 : 6,
    range: 1000,
    projectileSpeed: type === "beam_laser" ? 0 : 100,
    shieldMultiplier: 2,
    armorMultiplier: 1,
    hullMultiplier: 1,
    flak:
      type === "point_defense"
        ? { lifetime: 1, triggerRadius: 0, blastRadius: 1, missileDamage: 0 }
        : undefined,
  };
  sim.addShip(attacker);
  const impact = () => {
    sim["fireWeapon"](attacker, turret, craft.pos, craft);
    if (type === "beam_laser") {
      const channel = sim["beamChannels"].get(turret);
      if (!channel) throw new Error("Expected guest beam channel");
      for (let frame = 0; frame < 6; frame++) sim["updateBeam"](channel, true);
      expect(channel.target).toBe(craft);
      expect(sim["beamChannels"].get(turret)).toBe(channel);
    } else {
      const shot = sim.projectiles[sim.projectiles.length - 1];
      shot.pos = [...craft.pos];
      shot.velocity = [0, 0];
      sim["updateProjectiles"](1 / 60, sim.ships);
      expect(shot.targetId).toBe(craft.id);
    }
    expect(turret.currentTargetId).toBe(craft.id);
  };
  return { attacker, turret, impact };
}

describe("tethered guest damage absorption", () => {
  const weapons = ["railgun", "beam_laser", "missile", "point_defense"] as const;

  it.each(weapons)("absorbs the entire %s hit on a healthy parent", (type) => {
    const { sim, parent, craft } = dockedSimulation("corvette");
    craft.shieldCurrent = 20;
    const before = [craft.shieldCurrent, craft.armorCurrent, craft.hullCurrent];
    const parentShield = parent.shieldCurrent;
    const { impact } = havenAttack(sim, craft, type);
    impact();
    expect(parent.shieldCurrent).toBe(parentShield - 12);
    expect([craft.shieldCurrent, craft.armorCurrent, craft.hullCurrent]).toEqual(before);
    expect(parent.armorCurrent).toBe(parent.armorMax);
    expect(parent.hullCurrent).toBe(parent.hullMax);
    expect(parent.shieldDelayTimer).toBeGreaterThan(0);
    expect(craft.havenState).toBe("tethered");
    expect(sim.stats[0].shieldDamageAbsorbed).toBe(12);
    expect(sim.stats[1].damageDealt).toBe(12);
  });

  it.each(weapons)("spills the unabsorbed %s damage through guest layers", (type) => {
    const { sim, parent, craft } = dockedSimulation("corvette");
    parent.shieldCurrent = 4;
    craft.shieldCurrent = 3;
    craft.armorCurrent = 2;
    craft.armorRating = 0;
    const hull = craft.hullCurrent;
    const { attacker, turret, impact } = havenAttack(sim, craft, type);
    const telemetry = new CombatTelemetry(sim.ships);
    sim.observer = telemetry;
    sim.onShieldHit = vi.fn();
    sim.onWeaponImpact = vi.fn();
    impact();
    expect(parent.shieldCurrent).toBe(0);
    expect(parent.armorCurrent).toBe(parent.armorMax);
    expect(parent.hullCurrent).toBe(parent.hullMax);
    expect(craft.shieldCurrent).toBe(0);
    expect(craft.armorCurrent).toBe(0);
    expect(craft.hullCurrent).toBe(hull - 0.5);
    expect(sim.stats[0].shieldDamageAbsorbed).toBe(7);
    expect(sim.stats[1].damageDealt).toBe(10);
    expect(sim.stats[1].recentDamageWindow.reduce((sum, event) => sum + event.damage, 0)).toBe(9.5);
    expect(telemetry.report().damage).toEqual([
      {
        sourceId: attacker.id,
        mountId: turret.id,
        targetId: parent.id,
        weapon: type,
        shield: 4,
        armor: 0,
        hull: 0,
      },
      {
        sourceId: attacker.id,
        mountId: turret.id,
        targetId: craft.id,
        weapon: type,
        shield: 3,
        armor: 2,
        hull: 0.5,
      },
    ]);
    expect(sim.onShieldHit).toHaveBeenCalledWith(parent.pos, 0.04);
    expect(sim.onWeaponImpact).toHaveBeenCalledWith(parent, expect.any(Array), true, false, false);
    expect(sim.onWeaponImpact).toHaveBeenCalledWith(craft, expect.any(Array), true, true, true);
  });

  it("immediately releases every tethered guest on exact parent shield collapse", () => {
    const { sim, parent, craft } = dockedSimulation();
    const siblings = Array.from({ length: 5 }, (_, i) => guest(`sibling_${i}`));
    for (const sibling of siblings) {
      sim.addShip(sibling);
      const lease = sim.shieldHaven.request(sibling, sim.ships, 0);
      if (!lease) throw new Error("Expected sibling lease");
      sibling.pos = shieldHavenSlotPosition(parent, lease.slotId);
    }
    sim.shieldHaven.attachGuests(sim.ships, 1 / 60);
    expect(parent.havenGuestCount).toBe(6);
    parent.shieldCurrent = 12;
    const { impact } = havenAttack(sim, craft, "railgun");
    impact();
    expect(parent.shieldCurrent).toBe(0);
    expect(parent.havenGuestCount).toBe(0);
    for (const tethered of [craft, ...siblings]) {
      expect(tethered.havenState).toBe("releasing");
      expect(sim.shieldHaven.getLease(tethered.id)).toBeNull();
    }
    expect(craft.hullCurrent).toBe(craft.hullMax);
  });

  it.each(["zero-shield", "destroyed", "zero-hull"] as const)(
    "does not protect a guest with a %s parent",
    (state) => {
      const { sim, parent, craft } = dockedSimulation("corvette");
      if (state === "zero-shield") parent.shieldCurrent = 0;
      if (state === "destroyed") parent.isAlive = false;
      if (state === "zero-hull") parent.hullCurrent = 0;
      const shield = parent.shieldCurrent;
      craft.shieldCurrent = 20;
      const { impact } = havenAttack(sim, craft, "railgun");
      impact();
      expect(parent.shieldCurrent).toBe(shield);
      expect(craft.shieldCurrent).toBe(8);
    },
  );

  it.each(["approaching", "releasing", "unleased"] as const)(
    "does not grant umbrella protection to an %s guest",
    (state) => {
      const { sim, parent, craft } = dockedSimulation("corvette");
      if (state === "unleased") {
        sim.shieldHaven.release(craft.id);
        craft.havenState = "tethered";
      } else craft.havenState = state;
      craft.shieldCurrent = 20;
      const shield = parent.shieldCurrent;
      const { impact } = havenAttack(sim, craft, "railgun");
      impact();
      expect(parent.shieldCurrent).toBe(shield);
      expect(craft.shieldCurrent).toBe(8);
    },
  );

  it("releases guests immediately when a direct parent hit collapses its shield", () => {
    const { sim, parent, craft } = dockedSimulation();
    parent.shieldCurrent = 12;
    const { impact } = havenAttack(sim, parent, "railgun");
    impact();
    expect(craft.havenState).toBe("releasing");
    expect(sim.shieldHaven.getLease(craft.id)).toBeNull();
  });
});

describe("moving-slot attachment and relationship-aware collisions", () => {
  it.each(["battleship", "dreadnought", "cruiser"] as const)(
    "matches all six moving %s slots under linear movement and both rotation directions",
    (hull) => {
      const parent = ship("parent", hull, [200, -100]);
      const guests = Array.from({ length: 6 }, (_, i) => guest(`guest_${i}`));
      const ships = [parent, ...guests];
      const system = new ShieldHavenSystem();
      system.update(ships, 0);
      for (const craft of guests) {
        const lease = system.getLease(craft.id);
        if (!lease) throw new Error("Expected reservation");
        craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
      }
      system.attachGuests(ships, 1 / 60);
      expect(parent.havenGuestCount).toBe(6);
      for (const omega of [-0.4, 0, 0.3]) {
        parent.heading += omega * 0.5;
        parent.pos = [parent.pos[0] + 15, parent.pos[1] - 10];
        parent.velocity = [30, -20];
        parent.angularVelocity = omega;
        system.attachGuests([...ships].reverse(), 1 / 60);
        for (const craft of guests) {
          const lease = system.getLease(craft.id);
          if (!lease) throw new Error("Expected attachment");
          const pos = shieldHavenSlotPosition(parent, lease.slotId);
          const r = [pos[0] - parent.pos[0], pos[1] - parent.pos[1]];
          expect(craft.pos).toEqual(pos);
          expect(craft.velocity[0]).toBeCloseTo(30 - omega * r[1]);
          expect(craft.velocity[1]).toBeCloseTo(-20 + omega * r[0]);
          expect(craft.havenParentId).toBe(parent.id);
          expect(craft.havenSlotId).toBe(lease.slotId);
        }
      }
    },
  );

  it("applies the final parent transform independent of fleet order and combat steering", () => {
    const run = (reverse: boolean) => {
      const { sim, parent, craft, lease } = dockedSimulation("corvette");
      const enemy = ship("enemy", "battleship", [-1500, -300], 1);
      sim.addShip(enemy);
      parent.heading = Math.PI - 0.001;
      parent.velocity = [35, 20];
      craft.heading = 0;
      const heading = parent.heading;
      if (reverse) sim.ships.reverse();
      sim.update(1 / 60);
      expect(parent.angularVelocity).toBeCloseTo(normalizeAngle(parent.heading - heading) * 60);
      expect(Math.abs(parent.angularVelocity ?? 0)).toBeGreaterThan(0);
      expect(craft.pos).toEqual(shieldHavenSlotPosition(parent, lease.slotId));
      expect(craft.velocity).toEqual(shieldHavenSlotVelocity(parent, lease.slotId));
      expect(Math.abs(normalizeAngle(craft.heading))).toBeLessThanOrEqual(
        craft.turnRate / 60 + 1e-9,
      );
      expect(craft.havenState).toBe("tethered");
      expect(parent.havenGuestCount).toBe(1);
      expect(craft.capitalManeuver).toBeUndefined();
      return { pos: craft.pos, velocity: craft.velocity, heading: craft.heading };
    };
    expect(run(false)).toEqual(run(true));
  });

  it("permits parent and sibling shield overlap without repulsor or separation ejection", () => {
    const { sim, parent, craft, lease } = dockedSimulation("corvette");
    craft.shieldCurrent = craft.shieldMax * 0.5;
    const sibling = guest("sibling", "corvette");
    sibling.shieldCurrent = sibling.shieldMax * 0.5;
    sibling.hullCurrent = sibling.hullMax * 0.2;
    sim.addShip(sibling);
    const siblingLease = sim.shieldHaven.request(sibling, sim.ships, 0);
    if (!siblingLease) throw new Error("Expected sibling reservation");
    sibling.pos = shieldHavenSlotPosition(parent, siblingLease.slotId);
    sim.shieldHaven.attachGuests(sim.ships, 1 / 60);
    expect(vecDistance(craft.pos, sibling.pos)).toBeLessThan(
      activeShieldRadius(craft) + activeShieldRadius(sibling),
    );
    expect(calculateSeparation(craft, sim.ships)).toEqual([0, 0]);
    for (let frame = 0; frame < 120; frame++) {
      sim.update(1 / 60);
      expect(craft.pos).toEqual(shieldHavenSlotPosition(parent, lease.slotId));
      expect(sibling.pos).toEqual(shieldHavenSlotPosition(parent, siblingLease.slotId));
      expect(vecDistance(craft.pos, parent.pos)).toBeGreaterThanOrEqual(
        havenHullClearance(craft, parent),
      );
      expect(vecDistance(craft.pos, sibling.pos)).toBeGreaterThanOrEqual(craft.size + sibling.size);
    }
    expect(parent.havenGuestCount).toBe(2);
  });

  it.each(["parent", "sibling"] as const)(
    "enforces hull exclusion for an approaching guest overlapping its %s",
    (overlap) => {
      const { sim, parent, craft } = dockedSimulation();
      const arriving = guest("arriving");
      sim.addShip(arriving);
      sim.shieldHaven.request(arriving, sim.ships, 0);
      const obstacle = overlap === "parent" ? parent : craft;
      arriving.pos = [...obstacle.pos];
      expect(sharesShieldHaven(arriving, obstacle)).toBe(true);
      expect(
        vecDistance([0, 0], calculateSeparation(arriving, [arriving, obstacle])),
      ).toBeGreaterThan(0);
      sim.update(1 / 60);
      expect(vecDistance(arriving.pos, obstacle.pos) + 1e-6).toBeGreaterThanOrEqual(
        havenHullClearance(arriving, obstacle),
      );
      expect(craft.havenState).toBe("tethered");
    },
  );

  it("keeps unrelated friendly ships outside the standard shield repulsor", () => {
    const { sim, craft } = dockedSimulation();
    const unrelated = ship("unrelated", "corvette", [craft.pos[0], craft.pos[1] - 30]);
    sim.addShip(unrelated);
    expect(sharesShieldHaven(craft, unrelated)).toBe(false);
    sim.update(1 / 60);
    expect(vecDistance(craft.pos, unrelated.pos) + 1e-6).toBeGreaterThanOrEqual(
      activeShieldRadius(craft) + activeShieldRadius(unrelated) + 20,
    );
  });

  it("flies a reserved corridor through the umbrella and captures without hull penetration", () => {
    const parent = ship("parent", "battleship");
    const craft = guest();
    const sim = new ClientCombatSimulation();
    sim.addShip(parent);
    sim.addShip(craft);
    let entered = false;
    let largestStep = 0;
    for (let frame = 0; frame < 1200 && craft.havenState !== "tethered"; frame++) {
      const previous: Vector2 = [...craft.pos];
      sim.update(1 / 60);
      largestStep = Math.max(largestStep, vecDistance(previous, craft.pos));
      expect(vecDistance(craft.pos, parent.pos) + 1e-6).toBeGreaterThanOrEqual(
        havenHullClearance(craft, parent),
      );
      if (vecDistance(craft.pos, parent.pos) < shieldEnvelopeRadius(parent)) entered = true;
    }
    expect(entered).toBe(true);
    expect(craft.havenState).toBe("tethered");
    expect(largestStep).toBeLessThan(craft.maxSpeed / 60 + 2);
    expect(parent.havenGuestCount).toBe(1);
  });

  it("uses the authoritative healthy-parent reservation instead of a collapsed legacy haven", () => {
    const craft = guest();
    craft.pos = [0, 0];
    craft.safeHavenId = "collapsed";
    const collapsed = ship("collapsed", "cruiser", [0, 350]);
    collapsed.shieldCurrent = 0;
    const parent = ship("parent", "cruiser", [-900, 0]);
    const sim = new ClientCombatSimulation();
    for (const s of [craft, collapsed, parent]) sim.addShip(s);
    sim.update(1 / 60);
    expect(craft.havenState).toBe("approaching");
    expect(craft.havenParentId).toBe(parent.id);
    expect(craft.safeHavenId).toBe(parent.id);
    expect(craft.velocity[0]).toBeLessThan(0);
  });
});

describe("bounded release corridors and telemetry", () => {
  it.each(["recovered", "emergency"] as const)(
    "releases on %s with bounded acceleration and no repulsor snapping",
    (reason) => {
      const { sim, parent, craft } = dockedSimulation();
      if (reason === "recovered") craft.shieldCurrent = craft.shieldMax * 0.75;
      else parent.shieldCurrent = parent.shieldMax * 0.09;
      let lastVelocity: Vector2 = [...craft.velocity];
      let lastPos: Vector2 = [...craft.pos];
      let cleared = false;
      for (let frame = 0; frame < 240; frame++) {
        sim.update(1 / 60);
        expect(vecDistance(lastVelocity, craft.velocity)).toBeLessThanOrEqual(
          havenAcceleration(craft) / 60 + 1e-6,
        );
        expect(vecDistance(lastPos, craft.pos)).toBeLessThanOrEqual(
          vecDistance([0, 0], craft.velocity) / 60 + 1e-6,
        );
        expect(craft.pos[1]).toBeLessThan(lastPos[1]);
        expect(vecDistance(craft.pos, parent.pos)).toBeGreaterThanOrEqual(
          havenHullClearance(craft, parent),
        );
        expect(sim.shieldHaven.getLease(craft.id)).toBeNull();
        expect(parent.havenGuestCount).toBe(0);
        if (craft.havenState === "none") {
          expect(craft.havenParentId).toBeNull();
          expect(craft.havenSlotId).toBeNull();
          expect(craft.fighterPhase).toBe("rejoin");
          expect(vecDistance(craft.pos, parent.pos)).toBeGreaterThan(
            shieldEnvelopeRadius(parent) + shieldEnvelopeRadius(craft) + 20,
          );
          cleared = true;
          break;
        }
        expect(craft.havenState).toBe("releasing");
        expect(craft.havenParentId).toBe(parent.id);
        lastVelocity = [...craft.velocity];
        lastPos = [...craft.pos];
      }
      expect(cleared).toBe(true);
    },
  );

  it("reports seeking without capacity and resets all attachment telemetry between rounds", () => {
    const unassigned = guest("unassigned");
    const system = new ShieldHavenSystem();
    system.update([unassigned], 0);
    expect(unassigned.havenState).toBe("seeking");
    expect(unassigned.havenParentId).toBeNull();
    expect(unassigned.havenSlotId).toBeNull();
    const { sim, parent, craft } = dockedSimulation();
    sim.continueBattleWithRemnants();
    expect(craft.havenState).toBe("none");
    expect(craft.havenParentId).toBeNull();
    expect(craft.havenSlotId).toBeNull();
    expect(parent.havenGuestCount).toBe(0);
  });
});

describe("atomic haven capacity and parent selection", () => {
  it.each(["battleship", "dreadnought", "cruiser"] as const)(
    "reserves six unique %s slots, rejects the seventh, and reuses released capacity",
    (hull) => {
      const parent = ship("parent", hull);
      const guests = Array.from({ length: 7 }, (_, i) => guest(`guest_${i}`));
      const ships = [parent, ...guests];
      const system = new ShieldHavenSystem();
      const leases = guests.slice(0, 6).map((craft) => system.request(craft, ships, 1));
      expect(leases.every((lease) => lease?.parentId === parent.id)).toBe(true);
      expect(new Set(leases.map((lease) => lease?.slotId)).size).toBe(6);
      expect(system.request(guests[0], ships, 1)).toBe(leases[0]);
      expect(system.request(guests[6], ships, 1)).toBeNull();
      expect(guests[6].recoveryStarted).toBe(1);
      system.release(guests[0].id);
      system.release(guests[0].id);
      expect(system.request(guests[6], ships, 2)?.slotId).toBe(leases[0]?.slotId);
      expect(system.getLease(guests[0].id)).toBeNull();
    },
  );

  it("allows corvettes only on battleships or dreadnoughts, and rejects ineligible guests", () => {
    const cruiser = ship("cruiser", "cruiser");
    const escort = guest("escort", "corvette");
    const fighter = guest("fighter");
    const frigate = ship("frigate", "missile_frigate");
    frigate.shieldCurrent = 0;
    const system = new ShieldHavenSystem();
    expect(system.request(escort, [cruiser, escort], 1)).toBeNull();
    expect(system.request(frigate, [cruiser, frigate], 1)).toBeNull();
    expect(system.request(fighter, [cruiser, fighter], 1)?.parentId).toBe(cruiser.id);
    const battleship = ship("battleship", "battleship");
    expect(system.request(escort, [battleship, escort], 2)?.parentId).toBe(battleship.id);
  });

  it("excludes hostile, dead, collapsed and noncapital parents", () => {
    const craft = guest();
    const hostile = ship("hostile", "battleship", [0, 0], 1);
    const dead = ship("dead", "battleship");
    dead.isAlive = false;
    const collapsed = ship("collapsed", "battleship");
    collapsed.shieldCurrent = 0;
    const escort = ship("escort", "corvette");
    const system = new ShieldHavenSystem();
    expect(system.request(craft, [craft, hostile, dead, collapsed, escort], 1)).toBeNull();
  });

  it("chooses nearest parents with stable ID ties and spills over a full parent", () => {
    const nearest = ship("a", "battleship", [-350, 0]);
    const tied = ship("b", "battleship", [-450, 0]);
    const distant = ship("c", "battleship", [900, 0]);
    const guests = Array.from({ length: 7 }, (_, i) => guest(`guest_${i}`));
    const ships = [distant, tied, nearest, ...guests];
    const system = new ShieldHavenSystem();
    system.update(ships, 1);
    for (const craft of guests.slice(0, 6)) expect(system.getLease(craft.id)?.parentId).toBe("a");
    expect(system.getLease(guests[6].id)?.parentId).toBe("b");
    const reversed = new ShieldHavenSystem();
    reversed.update(
      [...ships].reverse().map((s) => ({ ...s })),
      1,
    );
    expect(guests.map((craft) => reversed.getLease(craft.id))).toEqual(
      guests.map((craft) => system.getLease(craft.id)),
    );
  });

  it("requires greater than 15 percent for new leases but holds leases down to 10 percent", () => {
    const parent = ship("parent", "battleship");
    const craft = guest();
    const ships = [parent, craft];
    const system = new ShieldHavenSystem();
    parent.shieldCurrent = parent.shieldMax * 0.15;
    expect(system.request(craft, ships, 1)).toBeNull();
    parent.shieldCurrent += 1;
    const lease = system.request(craft, ships, 2);
    expect(lease).not.toBeNull();
    parent.shieldCurrent = parent.shieldMax * 0.1;
    system.update(ships, 3);
    expect(system.getLease(craft.id)).toBe(lease);
    parent.shieldCurrent -= 1;
    system.update(ships, 4);
    expect(system.getLease(craft.id)).toBeNull();
    expect(craft.recoveryStarted).toBe(1);
  });
});

describe("recovery episode lifecycle", () => {
  it.each(["strike_craft", "corvette"] as const)(
    "enters %s recovery strictly below 30 percent hull or on broken shields",
    (hull) => {
      const parent = ship("parent", "battleship");
      const craft = guest("guest", hull);
      craft.hullCurrent = craft.hullMax * 0.3;
      craft.shieldCurrent = craft.shieldMax * 0.5;
      const system = new ShieldHavenSystem();
      const ships = [parent, craft];
      expect(system.request(craft, ships, 1)).toBeNull();
      craft.hullCurrent -= 1;
      expect(system.request(craft, ships, 2)).not.toBeNull();
      expect(craft.recoveryStarted).toBe(2);
      system.clear();
      craft.recoveryStarted = undefined;
      craft.hullCurrent = craft.hullMax;
      craft.shieldCurrent = 0.01;
      expect(system.request(craft, ships, 3)).toBeNull();
      craft.shieldCurrent = 0;
      expect(system.request(craft, ships, 4)).not.toBeNull();
    },
  );

  it.each(["strike_craft", "corvette"] as const)(
    "releases %s at 75 percent shields and latches hull until new damage",
    (hull) => {
      const parent = ship("parent", "battleship");
      const craft = guest("guest", hull);
      craft.hullCurrent = craft.hullMax * 0.29;
      const ships = [parent, craft];
      const system = new ShieldHavenSystem();
      system.update(ships, 1);
      const lease = system.getLease(craft.id);
      craft.shieldCurrent = craft.shieldMax * 0.75 - 0.01;
      system.update(ships, 20);
      expect(system.getLease(craft.id)).toBe(lease);
      craft.shieldCurrent = craft.shieldMax * 0.75;
      system.update(ships, 21);
      expect(system.getLease(craft.id)).toBeNull();
      expect(craft.recoveryStarted).toBeUndefined();
      expect(craft.recoveredHull).toBe(craft.hullCurrent);
      for (let time = 22; time < 30; time++) system.update(ships, time);
      expect(system.getLease(craft.id)).toBeNull();
      craft.hullCurrent -= 1;
      system.update(ships, 30);
      expect(system.getLease(craft.id)).not.toBeNull();
      system.update(ships, 31);
      expect(system.getLease(craft.id)).toBeNull();
      craft.shieldCurrent = 0;
      system.update(ships, 32);
      expect(system.getLease(craft.id)).not.toBeNull();
    },
  );

  it.each(["shield-collapse", "destroyed", "zero-hull", "removed"] as const)(
    "cleans all leases after parent %s and can select a surviving parent",
    (cause) => {
      const parent = ship("parent", "battleship");
      const guests = Array.from({ length: 6 }, (_, i) => guest(`guest_${i}`));
      let ships = [parent, ...guests];
      const system = new ShieldHavenSystem();
      system.update(ships, 1);
      if (cause === "shield-collapse") parent.shieldCurrent = 0;
      if (cause === "destroyed") parent.isAlive = false;
      if (cause === "zero-hull") parent.hullCurrent = 0;
      if (cause === "removed") ships = guests;
      system.cleanup(ships);
      for (const craft of guests) expect(system.getLease(craft.id)).toBeNull();
      const survivor = ship("survivor", "dreadnought", [100, 0]);
      system.update([...ships, survivor], 2);
      for (const craft of guests) expect(system.getLease(craft.id)?.parentId).toBe(survivor.id);
    },
  );

  it("reclaims dead and removed guest slots before processing new requests", () => {
    const parent = ship("parent", "battleship");
    const guests = Array.from({ length: 7 }, (_, i) => guest(`guest_${i}`));
    const system = new ShieldHavenSystem();
    system.update([parent, ...guests], 1);
    guests[0].isAlive = false;
    system.update([parent, ...guests], 2);
    expect(system.getLease(guests[0].id)).toBeNull();
    expect(system.getLease(guests[6].id)?.slotId).toBe("port-forward");
    system.cleanup([parent]);
    expect(guests.every((craft) => system.getLease(craft.id) === null)).toBe(true);
  });

  it("ends recovery without a lease and does not loop on unchanged wounded hull", () => {
    const craft = guest();
    craft.hullCurrent = craft.hullMax * 0.2;
    const system = new ShieldHavenSystem();
    system.update([craft], 1);
    expect(craft.recoveryStarted).toBe(1);
    craft.shieldCurrent = craft.shieldMax * 0.75;
    system.update([craft], 2);
    system.update([craft], 3);
    expect(craft.recoveryStarted).toBeUndefined();
    expect(system.getLease(craft.id)).toBeNull();
  });
});

describe("simulation-owned haven allocation", () => {
  it("detects broken shields before regen and preserves ordinary fallback for the seventh request", () => {
    const parent = ship("parent", "battleship");
    const guests = Array.from({ length: 7 }, (_, i) => {
      const craft = guest(`guest_${i}`);
      craft.pos = [-500, i * 100];
      craft.shieldRegen = 1;
      return craft;
    });
    const enemy = ship("enemy", "battleship", [1500, 0], 1);
    const sim = new ClientCombatSimulation();
    for (const s of [parent, ...guests, enemy]) sim.addShip(s);
    sim.update(1 / 60);
    expect(guests.slice(0, 6).every((craft) => sim.shieldHaven.getLease(craft.id))).toBe(true);
    expect(sim.shieldHaven.getLease(guests[6].id)).toBeNull();
    expect(guests[6].fighterPhase).toBe("recover");
    expect(guests[6].safeHavenId).toBe(parent.id);
    expect(guests.every((craft) => craft.shieldCurrent > 0)).toBe(true);
    parent.shieldCurrent = parent.shieldMax * 0.09;
    sim.update(1 / 60);
    expect(guests.every((craft) => sim.shieldHaven.getLease(craft.id) === null)).toBe(true);
  });

  it("clears prior-round leases when continuing with remnants", () => {
    const parent = ship("parent", "battleship");
    const craft = guest();
    const sim = new ClientCombatSimulation();
    sim.addShip(parent);
    sim.addShip(craft);
    sim.update(1 / 60);
    expect(sim.shieldHaven.getLease(craft.id)).not.toBeNull();
    sim.continueBattleWithRemnants();
    expect(sim.shieldHaven.getLease(craft.id)).toBeNull();
    expect(craft.recoveryStarted).toBeUndefined();
  });
});
