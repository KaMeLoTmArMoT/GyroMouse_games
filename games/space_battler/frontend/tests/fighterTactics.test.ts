import { describe, expect, it, vi } from "vitest";
import { FighterMissionSystem } from "../src/engine/fighterMissionSystem";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { vecDistance, vecDot, vecNormalize, vecSub } from "../src/engine/math2d";
import { shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { ShieldHavenSystem } from "../src/engine/shieldHaven";
import {
  fighterShieldWaypoint,
  fighterTacticalTick,
  findNavigationTarget,
  hostileFlakThreats,
  updateShipNavigation,
} from "../src/engine/shipNavigationSystem";
import type {
  GroupOrder,
  HullClass,
  ProjectileState,
  ShipState,
  Vector2,
} from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2, team = 0): ShipState {
  const craft = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  craft.id = id;
  craft.pos = pos;
  craft.heading = 0;
  craft.velocity = [0, 0];
  return craft;
}

function mission(ships: ShipState[]) {
  const context = {
    timeElapsed: 0,
    orders: new Map<number, GroupOrder>(),
    projectiles: [] as ProjectileState[],
  };
  const egress = vi.fn();
  const system = new FighterMissionSystem(context, egress);
  system.ensureWings(ships);
  system.updateWings(ships);
  return { context, system, egress };
}

describe("fighter flak denial", () => {
  it("chooses an isolated capital instead of plotting ingress through overlapping flak", () => {
    const craft = ship("pilot", "strike_craft", [-800, 0]);
    const denied = ship("denied", "battleship", [0, 0], 1);
    const isolated = ship("isolated", "cruiser", [1000, 1000], 1);
    const first = ship("flak-a", "corvette", [0, 150], 1);
    const second = ship("flak-b", "corvette", [0, -150], 1);
    const ships = [craft, denied, isolated, first, second];
    const order: GroupOrder = { groupId: 1, priority: "capitals", stance: "optimal_range" };
    expect(findNavigationTarget(craft, order, ships, denied.id, denied.id)).toBe(isolated);
  });

  it("slashes a single corvette at full speed and immediately leaves after firing", () => {
    const craft = ship("pilot", "strike_craft", [-500, 0]);
    const gunboat = ship("gunboat", "corvette", [0, 0], 1);
    const ships = [craft, gunboat];
    const { system, context, egress } = mission(ships);
    expect(craft.fighterPhase).toBe("attack");
    expect(system.updateCycle(craft, gunboat, 1 / 60, ships).speed).toBe(craft.maxSpeed);
    system.onShot(craft, gunboat);
    expect(craft.fighterPhase).toBe("egress");
    expect(craft.lastMissionShotTime).toBe(0);
    expect(system.updateCycle(craft, gunboat, 1 / 60, ships).speed).toBe(craft.maxSpeed);
    context.timeElapsed = 0.01;
    system.updateWings(ships);
    expect(craft.fighterPhase).toBe("egress");
    expect(egress).toHaveBeenCalledOnce();
  });

  it("aborts a moving corvette pass that cannot discharge within 1.5 seconds", () => {
    const craft = ship("pilot", "strike_craft", [-500, 0]);
    craft.turrets[0].cooldownTimer = 10;
    const target = ship("gunboat", "corvette", [0, 0], 1);
    const ships = [craft, target];
    const { system, context } = mission(ships);
    system.updateWings(ships);
    context.timeElapsed = 1.6;
    system.updateWings(ships);
    expect(craft.fighterPhase).toBe("egress");
  });

  it("abandons interception under overlapping flak and retreats toward capital cover", () => {
    const craft = ship("pilot", "strike_craft", [0, 0]);
    craft.heading = Math.PI;
    const anchor = ship("cover", "battleship", [-800, 0]);
    const first = ship("flak-a", "corvette", [300, 100], 1);
    const second = ship("flak-b", "corvette", [300, -100], 1);
    const opponent = ship("opponent", "strike_craft", [100, 0], 1);
    const ships = [craft, anchor, first, second, opponent];
    const { system, context } = mission(ships);
    craft.fighterPhase = "intercept";
    craft.dogfightTargetId = opponent.id;
    const retreat = system.updateCycle(craft, first, 1 / 60, ships);
    expect(craft.fighterPhase).toBe("egress");
    expect(craft.dogfightTargetId).toBeUndefined();
    expect(craft.safeHavenId).toBe(anchor.id);
    expect(retreat.speed).toBe(craft.maxSpeed);
    expect(
      vecDot([Math.cos(retreat.heading), Math.sin(retreat.heading)], vecSub(anchor.pos, craft.pos)),
    ).toBeGreaterThan(0);
    for (let tick = 1; tick <= 60; tick++) {
      context.timeElapsed = tick / 60;
      system.updateWings(ships);
      expect(craft.fighterPhase).toBe("egress");
      expect(craft.dogfightTargetId).toBeUndefined();
    }
  });

  it("breaks cached attack intent immediately when a second corvette enters local range", () => {
    const craft = ship("pilot", "strike_craft", [-500, 0]);
    const first = ship("flak-a", "corvette", [0, 100], 1);
    const second = ship("flak-b", "corvette", [1000, -100], 1);
    const ships = [craft, first, second];
    const { system, context } = mission(ships);
    system.updateCycle(craft, first, 1 / 60, ships);
    second.pos = [0, -100];
    context.timeElapsed = 0.001;
    system.updateCycle(craft, first, 1 / 60, ships);
    expect(craft.fighterPhase).toBe("egress");
  });

  it("ignores dead, docked, debris, friendly, and distant flak hulls", () => {
    const craft = ship("pilot", "strike_craft", [0, 0]);
    const valid = ship("valid", "corvette", [600, 0], 1);
    const dead = ship("dead", "corvette", [10, 0], 1);
    dead.isAlive = false;
    const docked = ship("docked", "corvette", [10, 0], 1);
    docked.isDocked = true;
    const debris = ship("debris", "corvette", [10, 0], 1);
    debris.isDebris = true;
    expect(
      hostileFlakThreats(craft, [
        valid,
        dead,
        docked,
        debris,
        ship("ally", "corvette", [10, 0]),
        ship("far", "corvette", [601, 0], 1),
      ]),
    ).toEqual([valid]);
  });
});

describe("tangent shield routing", () => {
  it.each([1, -1])("routes along flank %s with a shield-clear tangent", (side) => {
    const craft = ship("pilot", "strike_craft", [-900, 0]);
    const capital = ship("capital", "battleship", [0, 0], 1);
    const waypoint = fighterShieldWaypoint(craft, capital, side, true);
    const direction = vecNormalize(vecSub(waypoint, craft.pos));
    const center = vecSub(capital.pos, craft.pos);
    const closest = vecDistance(
      [0, 0],
      vecSub(center, [
        direction[0] * vecDot(center, direction),
        direction[1] * vecDot(center, direction),
      ]),
    );
    expect(closest).toBeGreaterThan(shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(craft));
    expect(closest).toBeGreaterThanOrEqual(290);
    expect(closest).toBeLessThanOrEqual(400);
    expect(Math.abs(waypoint[1])).toBeGreaterThan(250);
  });

  it("provides an outward tangent when launched inside an enlarged capital bubble", () => {
    const craft = ship("pilot", "strike_craft", [100, 0]);
    const capital = ship("carrier", "carrier", [0, 0]);
    capital.havenRadiusMultiplier = 3;
    const waypoint = fighterShieldWaypoint(craft, capital, 1);
    expect(waypoint[0]).toBeGreaterThan(shieldEnvelopeRadius(capital));
    expect(waypoint[1]).toBeGreaterThan(200);
  });

  it("keeps friendly and hostile shield collision safety active between tactical ticks", () => {
    const craft = ship("pilot", "strike_craft", [-180, 0]);
    craft.velocity = [craft.maxSpeed, 100];
    const capital = ship("capital", "battleship", [0, 0]);
    const enemy = ship("target", "corvette", [1200, 0], 1);
    const ships = [craft, capital, enemy];
    const cycle = vi.fn(() => ({ heading: 0, speed: craft.maxSpeed }));
    const context = {
      timeElapsed: 0,
      orders: new Map<number, GroupOrder>(),
      projectiles: [],
      ships,
      shieldHaven: new ShieldHavenSystem(),
    };
    updateShipNavigation(craft, enemy, ships, 1 / 60, context, cycle);
    const clearance = shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(craft) + 30;
    expect(craft.velocity[0]).toBeLessThanOrEqual((180 - clearance) / 0.5 + 1e-6);
    expect(craft.velocity[1]).toBeGreaterThan(90);
  });
});

describe("staggered pilot decisions", () => {
  it.each(["attack", "staging"] as const)("evaluates %s at the tactical cadence", (phase) => {
    const craft = ship("pilot", "strike_craft", [0, 0]);
    craft.fighterPhase = phase;
    const ticks = new Set<number>();
    for (let frame = 0; frame < 60; frame++)
      ticks.add(fighterTacticalTick(craft, frame / 60, [craft]));
    expect(ticks.size).toBeGreaterThanOrEqual(phase === "attack" ? 12 : 5);
    expect(ticks.size).toBeLessThanOrEqual(phase === "attack" ? 13 : 6);
  });

  it("interleaves different pilots instead of reevaluating the whole wing together", () => {
    const pilots = Array.from({ length: 16 }, (_, i) => ship(`pilot-${i}`, "strike_craft", [0, 0]));
    const previous = pilots.map((craft) => fighterTacticalTick(craft, 0, pilots));
    const counts = [];
    for (let frame = 1; frame <= 12; frame++) {
      let changed = 0;
      pilots.forEach((craft, i) => {
        const tick = fighterTacticalTick(craft, frame / 60, pilots);
        if (tick !== previous[i]) changed++;
        previous[i] = tick;
      });
      counts.push(changed);
    }
    expect(counts.filter((count) => count > 0).length).toBeGreaterThan(2);
    expect(Math.max(...counts)).toBeLessThan(pilots.length);
  });

  it("retains target assessment until a tactical tick, but drops a dead target immediately", () => {
    const craft = ship("pilot", "strike_craft", [0, 0]);
    const a = ship("a", "cruiser", [800, 0], 1);
    const b = ship("b", "cruiser", [1500, 0], 1);
    const ships = [craft, a, b];
    const order: GroupOrder = { groupId: 1, priority: "nearest", stance: "optimal_range" };
    fighterTacticalTick(craft, 0, ships);
    expect(findNavigationTarget(craft, order, ships)).toBe(a);
    b.pos = [100, 0];
    expect(findNavigationTarget(craft, order, ships)).toBe(a);
    a.isAlive = false;
    expect(findNavigationTarget(craft, order, ships)).toBe(b);
  });

  it("holds an evasive line for 150ms and integrates smooth movement on every physics frame", () => {
    const craft = ship("pilot", "strike_craft", [-800, 0]);
    craft.velocity = [craft.maxSpeed, 0];
    const target = ship("target", "cruiser", [800, 0], 1);
    const obstacle = ship("obstacle", "battleship", [-600, -150]);
    const ships = [craft, target, obstacle];
    const { system, context } = mission(ships);
    const first = system.updateCycle(craft, target, 1 / 60, ships);
    target.pos = [-800, 900];
    for (let frame = 1; frame < 9; frame++) {
      context.timeElapsed = frame / 60;
      const maneuver = system.updateCycle(craft, target, 1 / 60, ships);
      expect(maneuver.heading).toBe(first.heading);
    }
    const navigation = { ...context, ships, shieldHaven: new ShieldHavenSystem() };
    let previousHeading = craft.heading;
    for (let frame = 9; frame < 30; frame++) {
      context.timeElapsed = navigation.timeElapsed = frame / 60;
      const position = [...craft.pos] as Vector2;
      updateShipNavigation(
        craft,
        target,
        ships,
        1 / 60,
        navigation,
        system.updateCycle.bind(system),
      );
      expect(vecDistance(position, craft.pos)).toBeGreaterThan(0);
      expect(Math.abs(craft.heading - previousHeading)).toBeLessThanOrEqual(
        craft.turnRate / 60 + 1e-6,
      );
      previousHeading = craft.heading;
    }
  });
});
