import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent, withinPursuitTheater } from "../src/engine/flightControl";
import {
  antiKitePursuitLimit,
  prepareNavigationContext,
  tacticalDensity,
  tacticalSupportRadius,
} from "../src/engine/navigationContext";
import {
  fighterShieldWaypoint,
  findNavigationTarget,
  updateShipNavigation,
} from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, x = 0, team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [x, 0];
  result.velocity = [0, 0];
  return result;
}

const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
const heavyHulls = [
  "missile_frigate",
  "cruiser",
  "battleship",
  "dreadnought",
  "carrier",
  "tender",
] as const;

describe("hull-aware isolated targets", () => {
  it.each([
    ["strike_craft", 400],
    ["corvette", 400],
    ["missile_frigate", 500],
    ["cruiser", 500],
    ["battleship", 600],
    ["dreadnought", 600],
    ["carrier", 600],
    ["tender", 600],
  ] as const)("preserves the stock %s support horizon", (hull, radius) => {
    expect(tacticalSupportRadius(ship(hull, "target"))).toBeCloseTo(radius);
  });

  it.each(["strike_craft", "corvette", ...heavyHulls] as const)(
    "%s scales isolation with independently changed geometry and weapon reach",
    (hull) => {
      for (const metric of ["geometry", "weapons"] as const) {
        const target = ship(hull, "target", 0, 1);
        const stockRadius = tacticalSupportRadius(target);
        const peers = [
          ship("corvette", "first", stockRadius * 1.25, 1),
          ship("corvette", "second", -stockRadius * 1.25, 1),
        ];
        const ships = [target, ...peers];
        expect(prepareNavigationContext(ships).isolated.get(target)).toBe(true);
        if (metric === "geometry") target.size *= 2;
        else for (const turret of target.turrets) turret.weapon.range *= 2;
        expect(tacticalSupportRadius(target)).toBeCloseTo(stockRadius * 1.5);
        expect(tacticalDensity(target, [...ships]).get(1)).toBe(3);
        expect(prepareNavigationContext(ships).isolated.get(target)).toBe(false);
        if (metric === "geometry") target.size /= 4;
        else for (const turret of target.turrets) turret.weapon.range /= 4;
        expect(tacticalSupportRadius(target)).toBeCloseTo(stockRadius * 0.75);
        expect(tacticalDensity(target, [...ships]).get(1)).toBe(1);
        expect(prepareNavigationContext(ships).isolated.get(target)).toBe(true);
      }
    },
  );

  it("accounts for enlarged haven envelopes and unarmed hulls", () => {
    const target = ship("cruiser", "target");
    const stockRadius = tacticalSupportRadius(target);
    target.havenRadiusMultiplier = 2;
    expect(tacticalSupportRadius(target)).toBeCloseTo(stockRadius * 1.5);
    target.turrets = [];
    expect(tacticalSupportRadius(target)).toBeCloseTo(stockRadius * 2);
  });

  it.each(["strike_craft", "corvette", ...heavyHulls] as const)(
    "%s tolerates one supporting peer but not two, excluding inactive hulls",
    (hull) => {
      const target = ship(hull, "target", 0, 1);
      const radius = tacticalSupportRadius(target);
      const first = ship("strike_craft", "first", radius, 1);
      const second = ship("missile_frigate", "second", -radius - 1, 1);
      const dead = ship("cruiser", "dead", 0, 1);
      const docked = ship("strike_craft", "docked", 0, 1);
      const debris = ship("battleship", "debris", 0, 1);
      dead.isAlive = false;
      docked.isDocked = true;
      debris.isDebris = true;
      const ships = [target, first, second, dead, docked, debris];
      expect(prepareNavigationContext(ships).isolated.get(target)).toBe(true);
      second.pos = [-radius, 0];
      expect(prepareNavigationContext(ships).isolated.get(target)).toBe(false);
      expect(tacticalDensity(target, ships).get(1)).toBe(3);
    },
  );

  it.each(["corvette", "missile_frigate", "cruiser"] as const)(
    "%s packs converge on a straggler instead of a nearer supported vessel",
    (hull) => {
      const hunters = Array.from({ length: 3 }, (_, i) => ship(hull, `hunter_${i}`, -i * 20));
      const straggler = ship("missile_frigate", "straggler", 450, 1);
      const supported = ship("cruiser", "supported", -350, 1);
      const support = [ship("corvette", "screen", -650, 1), ship("strike_craft", "wing", -700, 1)];
      const ships = [...hunters, supported, straggler, ...support];
      for (const cached of [false, true]) {
        for (const hunter of hunters) hunter.navigationTargetId = undefined;
        const context = cached ? prepareNavigationContext(ships) : undefined;
        for (const hunter of hunters) {
          const target = findNavigationTarget(hunter, order, ships);
          expect(target).toBe(straggler);
          hunter.navigationTargetId = target?.id;
          context?.adjust(context.navigationAssignments, hunter, target?.id, 1);
        }
      }
    },
  );

  it.each([
    ["strike_craft", 6, 1],
    ["missile_frigate", 5, 2],
  ] as const)("uses local %s attackers (%i) against %i defenders", (hull, count, defenders) => {
    const hunter = ship("missile_frigate", "hunter");
    const right = ship("corvette", "right", 350, 1);
    const left = ship("corvette", "left", -350, 1);
    const allies = Array.from({ length: count }, (_, i) => ship(hull, `ally_${i}`, 100));
    const peers = defenders === 2 ? [ship("corvette", "peer", 650, 1)] : [];
    const ships = [hunter, left, right, ...allies, ...peers];
    expect(tacticalDensity(right, ships).get(0)).toBe(count + 1);
    expect(tacticalDensity(right, ships).get(1)).toBe(defenders);
    expect(findNavigationTarget(hunter, order, ships)).toBe(right);
    for (const ally of allies) ally.pos = [-100, 0];
    prepareNavigationContext(ships);
    expect(findNavigationTarget(hunter, order, ships)).toBe(left);
  });

  it("limits medium focus to four attackers before diverting excess firepower", () => {
    const hunters = Array.from({ length: 5 }, (_, i) => ship("missile_frigate", `hunter_${i}`));
    const straggler = ship("missile_frigate", "straggler", 350, 1);
    const alternative = ship("missile_frigate", "alternative", -350, 1);
    const ships = [...hunters, straggler, alternative];
    const context = prepareNavigationContext(ships);
    for (const hunter of hunters) {
      hunter.navigationTargetId = findNavigationTarget(hunter, order, ships)?.id;
      context.adjust(context.navigationAssignments, hunter, hunter.navigationTargetId, 1);
    }
    expect(hunters.filter((hunter) => hunter.navigationTargetId === straggler.id)).toHaveLength(4);
    expect(hunters[4].navigationTargetId).toBe(alternative.id);
  });
});

describe("anti-kite pursuit", () => {
  it.each(heavyHulls)("%s calibrates its dynamic pursuit limit to the stock theater", (hull) => {
    expect(antiKitePursuitLimit(ship(hull, "hunter"))).toBeCloseTo(900);
  });

  it.each(["geometry", "weapons", "speed"] as const)(
    "scales the pursuit helper with independently changed %s",
    (metric) => {
      const hunter = ship("cruiser", "hunter");
      const stockLimit = antiKitePursuitLimit(hunter);
      if (metric === "geometry") hunter.size *= 2;
      else if (metric === "speed") hunter.maxSpeed *= 2;
      else for (const turret of hunter.turrets) turret.weapon.range *= 2;
      expect(antiKitePursuitLimit(hunter)).toBeGreaterThan(stockLimit);
      if (metric === "geometry") hunter.size /= 4;
      else if (metric === "speed") hunter.maxSpeed /= 4;
      else for (const turret of hunter.turrets) turret.weapon.range /= 4;
      expect(antiKitePursuitLimit(hunter)).toBeLessThan(stockLimit);
    },
  );

  it("uses the hunter's scaled limit when pursuing fighters", () => {
    const hunter = ship("cruiser", "hunter");
    const fighter = ship("strike_craft", "fighter", 1000, 1);
    const other = ship("corvette", "other", -2500, 1);
    const ships = [hunter, fighter, other];
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(false);
    hunter.maxSpeed *= 2;
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(true);
  });

  it("uses the anchor's scaled limit for corvette pursuit", () => {
    const anchor = ship("battleship", "anchor");
    const hunter = ship("corvette", "hunter", 500);
    const fighter = ship("strike_craft", "fighter", 1000, 1);
    const ships = [anchor, hunter, fighter];
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(false);
    anchor.maxSpeed *= 2;
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(true);
  });

  it.each(heavyHulls)("%s rejects distant fighters while any other enemy hull survives", (hull) => {
    const hunter = ship(hull, "hunter");
    const fighter = ship("strike_craft", "fighter", 901, 1);
    const other = ship("corvette", "other", -2500, 1);
    const ships = [hunter, fighter, other];
    hunter.navigationTargetId = hunter.maneuverTargetId = fighter.id;
    fighter.shieldCurrent = fighter.armorCurrent = 0;
    fighter.hullCurrent = 1;
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(false);
    expect(findNavigationTarget(hunter, order, ships, fighter.id)).toBe(other);
    expect(capitalIntent(hunter, fighter, ships, order).velocity[0]).toBeLessThanOrEqual(0);
    expect(hunter.maneuverTargetId).toBeUndefined();
    fighter.pos = [900, 0];
    expect(withinPursuitTheater(hunter, fighter, ships)).toBe(true);
  });

  it.each(heavyHulls)("%s may target distant fighters once only fighters remain", (hull) => {
    const hunter = ship(hull, "hunter");
    const fighter = ship("strike_craft", "fighter", 3000, 1);
    const wingmate = ship("strike_craft", "wingmate", 3200, 1);
    const other = ship("battleship", "other", -2500, 1);
    const ships = [hunter, fighter, wingmate, other];
    for (const state of ["dead", "docked", "debris"] as const) {
      other.isAlive = state !== "dead";
      other.isDocked = state === "docked";
      other.isDebris = state === "debris";
      prepareNavigationContext(ships);
      expect(withinPursuitTheater(hunter, fighter, ships)).toBe(true);
      expect(findNavigationTarget(hunter, order, ships)).toBe(fighter);
    }
  });

  it("clears stale pursuit locks in movement when another enemy hull is still active", () => {
    const hunter = ship("cruiser", "hunter");
    const fighter = ship("strike_craft", "fighter", 1500, 1);
    const other = ship("missile_frigate", "other", -2000, 1);
    hunter.navigationTargetId = hunter.maneuverTargetId = hunter.dogfightTargetId = fighter.id;
    updateShipNavigation(
      hunter,
      fighter,
      [hunter, fighter, other],
      0.1,
      new ClientCombatSimulation(),
      () => ({
        heading: 0,
        speed: 0,
      }),
    );
    expect(hunter.navigationTargetId).toBeUndefined();
    expect(hunter.maneuverTargetId).toBeUndefined();
    expect(hunter.dogfightTargetId).toBeUndefined();
    expect(hunter.velocity[0]).toBeLessThanOrEqual(0);
  });
});

describe("relative shield flank waypoints", () => {
  it.each([false, true])("scales tangent clearance and runout (attack=%s)", (attack) => {
    for (const x of [50, 1000]) {
      const fighter = ship("strike_craft", "fighter", x);
      const capital = ship("battleship", "capital");
      const waypoint = fighterShieldWaypoint(fighter, capital, 1, attack);
      fighter.size *= 2;
      capital.size *= 2;
      fighter.pos = [x * 2, 0];
      const scaled = fighterShieldWaypoint(fighter, capital, 1, attack);
      expect(scaled[0]).toBeCloseTo(waypoint[0] * 2);
      expect(scaled[1]).toBeCloseTo(waypoint[1] * 2);
    }
  });
});
