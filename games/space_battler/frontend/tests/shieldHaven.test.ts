import { describe, expect, it, vi } from "vitest";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { calculateSeparation } from "../src/engine/flightBehaviors";
import * as flightControl from "../src/engine/flightControl";
import {
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDot,
  vecSub,
} from "../src/engine/math2d";
import {
  activeShieldRadius,
  shieldEnvelopeRadius,
  shieldRepulsorRadius,
} from "../src/engine/shieldGeometry";
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

  it.each(["battleship", "dreadnought", "cruiser", "corvette"] as const)(
    "inflates the %s repulsor continuously from zero charge while retaining its hitbox",
    (hull) => {
      const parent = ship("parent", hull);
      parent.shieldCurrent = 0;
      expect(shieldRepulsorRadius(parent)).toBe(parent.size);
      parent.shieldCurrent = parent.shieldMax * 0.0001;
      expect(shieldRepulsorRadius(parent) - parent.size).toBeLessThan(0.01);
      expect(activeShieldRadius(parent)).toBe(shieldEnvelopeRadius(parent));
      parent.shieldCurrent = parent.shieldMax * 0.5;
      expect(shieldRepulsorRadius(parent)).toBeCloseTo(
        (parent.size + shieldEnvelopeRadius(parent)) / 2,
      );
      parent.shieldCurrent = parent.shieldMax;
      expect(shieldRepulsorRadius(parent)).toBe(shieldEnvelopeRadius(parent));
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

describe("capital tactical separation and soft contacts", () => {
  it.each(["battleship", "dreadnought", "cruiser"] as const)(
    "starts %s separation at 420u hostile and 300u friendly even without shields",
    (hull) => {
      const capital = ship("capital", hull);
      const peer = ship("peer", hull, [400, 0], 1);
      capital.shieldCurrent = peer.shieldCurrent = 0;
      expect(calculateSeparation(capital, [capital, peer])[0]).toBeLessThan(0);
      peer.pos = [420, 0];
      expect(calculateSeparation(capital, [capital, peer])).toEqual([0, 0]);
      peer.team = capital.team;
      expect(calculateSeparation(capital, [capital, peer])).toEqual([0, 0]);
      peer.pos = [280, 0];
      expect(calculateSeparation(capital, [capital, peer])[0]).toBeLessThan(0);
      peer.pos = [300, 0];
      expect(calculateSeparation(capital, [capital, peer])).toEqual([0, 0]);
    },
  );

  it.each([0, 1])(
    "restores capital standoff against team %s without ramming or launching",
    (team) => {
      const a = ship("a", "battleship");
      const b = ship("b", "battleship", [240, 0], team);
      a.velocity = [20, 0];
      b.velocity = [-20, 0];
      const sim = new ClientCombatSimulation();
      sim.addShip(a);
      sim.addShip(b);
      for (let frame = 0; frame < 30; frame++) {
        const previous = [a.pos, b.pos];
        sim["resolveShipCollisions"]([a, b], 1 / 60, false);
        expect(vecDistance(previous[0], a.pos)).toBeLessThanOrEqual(4 + 1e-6);
        expect(vecDistance(previous[1], b.pos)).toBeLessThanOrEqual(4 + 1e-6);
      }
      expect(vecDistance(a.pos, b.pos)).toBeCloseTo(team === 0 ? 300 : 420);
      expect(a.velocity).toEqual([0, 0]);
      expect(b.velocity).toEqual([0, 0]);
      expect(a.shieldCurrent).toBe(a.shieldMax);
      expect(b.shieldCurrent).toBe(b.shieldMax);
    },
  );

  it("does not eject a neighboring frigate when a capital shield regenerates from zero", () => {
    const capital = ship("capital", "battleship");
    const escort = ship("escort", "missile_frigate");
    capital.shieldCurrent = 0;
    capital.shieldRegen = capital.shieldMax * 0.1;
    escort.pos = [capital.size + shieldRepulsorRadius(escort) + 20, 0];
    const previous: Vector2 = [...escort.pos];
    const sim = new ClientCombatSimulation();
    sim.addShip(capital);
    sim.addShip(escort);
    sim.update(1 / 60);
    expect(capital.shieldCurrent).toBeGreaterThan(0);
    expect(vecDistance(previous, escort.pos)).toBeLessThan(1);
    expect(vecDistance([0, 0], escort.velocity)).toBeLessThan(2);
  });

  it("shares a single soft-displacement budget across crowded contacts", () => {
    const capital = ship("capital", "battleship");
    const peers = Array.from({ length: 3 }, (_, i) =>
      ship(`peer_${i}`, "dreadnought", [
        200 * Math.cos(((i - 1) * Math.PI) / 3),
        200 * Math.sin(((i - 1) * Math.PI) / 3),
      ]),
    );
    const ships = [capital, ...peers];
    const previous = ships.map((s) => s.pos);
    const sim = new ClientCombatSimulation();
    sim["resolveShipCollisions"](ships, 1 / 60, false);
    ships.forEach((s, i) => {
      expect(vecDistance(previous[i], s.pos)).toBeLessThanOrEqual(4 + 1e-6);
    });
  });

  it("caps a sudden full shield refill without imparting outward velocity", () => {
    const capital = ship("capital", "battleship");
    const escort = ship("escort", "missile_frigate");
    capital.shieldCurrent = 0;
    escort.pos = [capital.size + shieldRepulsorRadius(escort) + 20, 0];
    const previous = [capital.pos, escort.pos];
    capital.shieldCurrent = capital.shieldMax;
    const sim = new ClientCombatSimulation();
    sim["resolveShipCollisions"]([capital, escort], 1 / 60, false);
    expect(vecDistance(previous[0], capital.pos)).toBeLessThanOrEqual(4);
    expect(vecDistance(previous[1], escort.pos)).toBeLessThanOrEqual(4);
    expect(escort.pos[0]).toBeGreaterThan(previous[1][0]);
    expect(capital.velocity).toEqual([0, 0]);
    expect(escort.velocity).toEqual([0, 0]);
  });

  it("keeps the friendly cruiser clearance pass from bypassing the soft cap", () => {
    const a = ship("a", "cruiser");
    const b = ship("b", "cruiser", [100, 0]);
    const sim = new ClientCombatSimulation();
    sim.addShip(a);
    sim.addShip(b);
    sim.update(1 / 60);
    expect(vecDistance([0, 0], a.pos)).toBeLessThanOrEqual(4);
    expect(vecDistance([100, 0], b.pos)).toBeLessThanOrEqual(4);
    expect(vecDistance(a.pos, b.pos)).toBeGreaterThan(100);
  });

  it("preserves immediate physical exclusion for coincident capital hulls", () => {
    const a = ship("a", "battleship");
    const b = ship("b", "dreadnought");
    const sim = new ClientCombatSimulation();
    sim["resolveShipCollisions"]([a, b], 1 / 60, false);
    expect(vecDistance(a.pos, b.pos)).toBeGreaterThanOrEqual(a.size + b.size);
  });
});

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

  it.each(weapons)("preserves %s collapse penetration rules through guest layers", (type) => {
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
    if (type === "missile") {
      expect(craft.shieldCurrent).toBe(3);
      expect(craft.armorCurrent).toBe(2);
      expect(craft.hullCurrent).toBe(hull);
      expect(sim.stats[0].shieldDamageAbsorbed).toBe(4);
      expect(sim.stats[1].damageDealt).toBe(4);
      expect(craft.havenState).toBe("releasing");
      return;
    }
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
  it.each(["corridor", "stern-waypoint", "capture"] as const)(
    "turns toward the approach vector until final slot capture (%s)",
    (stage) => {
      const parent = ship("parent", "battleship");
      parent.heading = 0;
      const craft = guest();
      const system = new ShieldHavenSystem();
      const ships = [parent, craft];
      const lease = system.request(craft, ships, 0);
      if (!lease) throw new Error("Expected reservation");
      const slot = shieldHavenSlotPosition(parent, lease.slotId);
      craft.pos =
        stage === "stern-waypoint"
          ? [-parent.size - craft.size - 10, 100]
          : [slot[0] + (stage === "capture" ? 20 : 150), slot[1]];
      craft.heading = Math.PI / 2;
      system.moveGuest(craft, ships, 1 / 60);
      expect(craft.heading).toBeCloseTo(
        Math.PI / 2 + ((stage === "capture" ? -1 : 1) * craft.turnRate) / 60,
      );
    },
  );

  it.each(["strike_craft", "corvette"] as const)(
    "limits reverse %s haven propulsion while turning toward the slot",
    (hull) => {
      const parent = ship("parent", "battleship");
      parent.heading = 0;
      const craft = guest("guest", hull);
      const system = new ShieldHavenSystem();
      const ships = [parent, craft];
      const lease = system.request(craft, ships, 0);
      if (!lease) throw new Error("Expected reservation");
      const slot = shieldHavenSlotPosition(parent, lease.slotId);
      craft.pos = [slot[0] + 300, slot[1]];
      craft.heading = 0;
      craft.turnRate = 0;
      for (let frame = 0; frame < 60; frame++) {
        system.moveGuest(craft, ships, 1 / 60);
        expect(craft.velocity[0]).toBeGreaterThanOrEqual(-craft.maxSpeed * 0.35 - 1e-8);
      }
      expect(craft.velocity[0]).toBeCloseTo(-craft.maxSpeed * 0.35);
    },
  );

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

  it("moves unrelated friendly ships out of the shield repulsor with bounded steps", () => {
    const { sim, craft } = dockedSimulation();
    const unrelated = ship("unrelated", "corvette", [craft.pos[0], craft.pos[1] - 30]);
    sim.addShip(unrelated);
    expect(sharesShieldHaven(craft, unrelated)).toBe(false);
    for (let frame = 0; frame < 12; frame++) {
      const previous: Vector2 = [...unrelated.pos];
      sim["resolveShipCollisions"]([craft, unrelated], 1 / 60, true);
      expect(vecDistance(previous, unrelated.pos)).toBeLessThanOrEqual(4 + 1e-6);
    }
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

describe("batched haven maintenance", () => {
  it("reuses recovered slots in the same update while keeping remaining tether counts", () => {
    const parent = ship("parent", "battleship");
    const guests = Array.from({ length: 7 }, (_, i) => guest(`guest_${i}`));
    const ships = [parent, ...guests];
    const system = new ShieldHavenSystem();
    system.update(ships, 1);
    const leases = guests.map((craft) => system.getLease(craft.id));
    for (const craft of guests.slice(0, 6)) {
      const lease = system.getLease(craft.id);
      if (!lease) throw new Error("Expected reservation");
      craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
    }
    system.attachGuests(ships, 1 / 60);
    expect(parent.havenGuestCount).toBe(6);
    guests[0].shieldCurrent = guests[0].shieldMax * 0.75;
    guests[1].shieldCurrent = guests[1].shieldMax * 0.75;

    system.update([...ships].reverse(), 2);

    for (const craft of guests.slice(0, 2)) {
      expect(system.getLease(craft.id)).toBeNull();
      expect(craft.havenState).toBe("releasing");
      expect(craft.recoveryStarted).toBeUndefined();
      expect(craft.recoveredHull).toBe(craft.hullCurrent);
    }
    for (let i = 2; i < 6; i++) expect(system.getLease(guests[i].id)).toBe(leases[i]);
    expect(system.getLease(guests[6].id)?.slotId).toBe(leases[0]?.slotId);
    expect(guests[6].havenState).toBe("approaching");
    expect(parent.havenGuestCount).toBe(4);
  });

  it("synchronizes leases and aura before a standalone healthy request returns", () => {
    const parent = ship("parent", "battleship");
    const craft = guest();
    const healthy = ship("healthy", "strike_craft", [-1000, 0]);
    const donor = ship("donor", "tender", [500, 0]);
    const ships = [parent, craft, healthy, donor];
    const system = new ShieldHavenSystem();
    const lease = system.request(craft, ships, 1);
    if (!lease) throw new Error("Expected reservation");
    craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
    system.attachGuests(ships, 1 / 60);
    expect(parent.havenGuestCount).toBe(1);
    expect(parent.havenRadiusMultiplier).toBe(1.2);
    parent.shieldCurrent = 0;
    donor.isAlive = false;

    expect(system.request(healthy, ships, 2)).toBeNull();

    expect(system.getLease(craft.id)).toBeNull();
    expect(system.protectedParent(craft)).toBeNull();
    expect(craft.havenState).toBe("releasing");
    expect(parent.havenGuestCount).toBe(0);
    expect(parent.havenRadiusMultiplier).toBe(1);
  });

  it("drops removed fleet membership and refreshes aura from one-shot iterables", () => {
    const parent = ship("parent", "battleship");
    const craft = guest();
    const donor = ship("donor", "tender", [300, 400]);
    const system = new ShieldHavenSystem();
    const ships = [parent, craft, donor];
    const lease = system.request(craft, ships, 1);
    if (!lease) throw new Error("Expected reservation");
    craft.pos = shieldHavenSlotPosition(parent, lease.slotId);
    system.attachGuests(ships, 1 / 60);
    expect(parent.havenRadiusMultiplier).toBe(1.2);
    expect(system.overflowMultiplier(parent)).toBe(0.9);

    system.cleanup([craft]);

    expect(system.getLease(craft.id)).toBeNull();
    expect(system.protectedParent(craft)).toBeNull();
    expect(craft.havenState).toBe("none");
    expect(craft.havenParentId).toBeNull();
    expect(parent.havenState).toBe("none");
    expect(system.overflowMultiplier(parent)).toBe(1);
    system.refreshAmplification(ships.values());
    expect(parent.havenRadiusMultiplier).toBe(1.2);
    donor.pos = [300, 400.001];
    system.refreshAmplification(ships.values());
    expect(parent.havenRadiusMultiplier).toBe(1);
    donor.pos = [300, 400];
    system.refreshAmplification(ships.values());
    expect(parent.havenRadiusMultiplier).toBe(1.2);
    donor.isAlive = false;
    system.refreshAmplification(ships.values());
    expect(parent.havenRadiusMultiplier).toBe(1);
  });
});

describe("simulation-owned haven allocation", () => {
  it.each(["recover", "seeking"] as const)(
    "turns a %s fighter nose-first toward the parent-local retreat waypoint",
    (state) => {
      const parent = ship("parent", "battleship", [-900, 350]);
      parent.heading = Math.PI / 2;
      const craft = guest();
      craft.pos = [0, 0];
      craft.heading = 0;
      const enemy = ship("enemy", "battleship", [1500, 0], 1);
      const sim = new ClientCombatSimulation();
      for (const s of [parent, craft, enemy]) sim.addShip(s);
      sim["ensureFighterWings"](sim.ships);
      craft.fighterPhase = state === "recover" ? "recover" : "attack";
      craft.havenState = state === "seeking" ? "seeking" : "none";
      const retreat = vecAdd(parent.pos, rotatePoint([-parent.size - 55, 0], parent.heading));
      const delta = vecSub(retreat, craft.pos);
      const expectedHeading = Math.atan2(delta[1], delta[0]);
      const maneuver = sim["updateFighterCycle"](craft, enemy, 1 / 60, sim.ships);
      expect(Math.abs(normalizeAngle(maneuver.heading - expectedHeading))).toBeLessThanOrEqual(
        Math.PI / 8,
      );
      expect(maneuver.speed).toBeGreaterThan(0);
      sim["updateShipMovement"](craft, enemy, sim.ships, 1 / 60);
      expect(craft.heading).toBeCloseTo(craft.turnRate / 60);
      for (let frame = 0; frame < 60; frame++) {
        sim["updateShipMovement"](craft, enemy, sim.ships, 1 / 60);
      }
      expect(vecDot(craft.velocity, vecSub(retreat, craft.pos))).toBeGreaterThan(0);
      expect(
        vecDot(craft.velocity, [Math.cos(craft.heading), Math.sin(craft.heading)]),
      ).toBeGreaterThan(0);
    },
  );

  it.each(["battleship", "dreadnought", "cruiser", "missile_frigate", "corvette"] as const)(
    "caps %s reverse thrust at 35 percent while retaining full forward thrust",
    (hull) => {
      const capitalIntent = vi.spyOn(flightControl, "capitalIntent");
      const escortVelocity = vi.spyOn(flightControl, "escortVelocity");
      try {
        for (const direction of [-1, 1]) {
          const craft = ship("craft", hull);
          craft.heading = 0;
          craft.turnRate = 0;
          const enemy = ship("enemy", "battleship", [1500, 0], 1);
          const sim = new ClientCombatSimulation();
          const velocity: Vector2 = [direction * craft.maxSpeed, 0];
          capitalIntent.mockReturnValue({ heading: 0, velocity, rangePhase: "approach" });
          escortVelocity.mockReturnValue(velocity);
          for (let frame = 0; frame < 120; frame++) {
            sim["updateShipMovement"](craft, enemy, [craft, enemy], 1 / 60);
            expect(craft.velocity[0]).toBeGreaterThanOrEqual(-craft.maxSpeed * 0.35 - 1e-8);
          }
          expect(craft.velocity[0]).toBeCloseTo(craft.maxSpeed * (direction < 0 ? -0.35 : 1));
        }
      } finally {
        capitalIntent.mockRestore();
        escortVelocity.mockRestore();
      }
    },
  );

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
