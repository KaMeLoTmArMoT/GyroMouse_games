import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { vecDistance } from "../src/engine/math2d";
import { activeShieldRadius, shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import {
  SHIELD_HAVEN_SLOTS,
  type ShieldHavenSlotId,
  ShieldHavenSystem,
  shieldHavenSlotPosition,
} from "../src/engine/shieldHaven";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2 } from "../src/types/combat";

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
