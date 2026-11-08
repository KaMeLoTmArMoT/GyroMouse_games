import { describe, expect, it } from "vitest";
import { swarmFlakFear } from "../src/engine/fighterMissionSystem";
import { capitalFinishPriority } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
  capitalIntent,
  rescueRouteRisk,
  supportVelocity,
  tenderRescueTarget,
} from "../src/engine/flightControl";
import { activeShieldRadius } from "../src/engine/shieldGeometry";
import { findNavigationTarget, updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, x = 0, team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [x, 0];
  result.velocity = [0, 0];
  return result;
}

const order = { groupId: 1, priority: "capitals", stance: "optimal_range" } as const;

describe("wave 9 tactical coordination", () => {
  it("rescues globally and balances capital importance with distance", () => {
    const tender = ship("tender", "t");
    const dread = ship("dreadnought", "d", 1600);
    const frigate = ship("missile_frigate", "f", 900);
    dread.shieldCurrent = frigate.shieldCurrent = 0;
    expect(tenderRescueTarget(tender, [tender, frigate, dread])).toBe(dread);
    const nearer = ship("dreadnought", "n", 1000);
    nearer.shieldCurrent = 0;
    expect(tenderRescueTarget(tender, [dread, nearer])).toBe(nearer);
  });

  it("rescues heavy capitals through dense crossfire while vetoing exposed light allies", () => {
    const tender = ship("tender", "t");
    const wounded = ship("dreadnought", "d", 1800);
    wounded.shieldCurrent = 0;
    const a = ship("battleship", "a", 900, 1);
    const b = ship("dreadnought", "b", 1000, 1);
    const ships = [tender, wounded, a, b];
    expect(rescueRouteRisk(tender, wounded, ships)).toBeGreaterThanOrEqual(1.5);
    expect(tenderRescueTarget(tender, ships)).toBe(wounded);
    const clearance = activeShieldRadius(wounded) + activeShieldRadius(tender) + 30;
    tender.pos = [wounded.pos[0] + clearance, 0];
    expect(supportVelocity(tender, ships)).toEqual([0, 0]);
    const exposed = ship("missile_frigate", "f", 1800);
    exposed.shieldCurrent = 0;
    tender.pos = [0, 0];
    expect(tenderRescueTarget(tender, [tender, exposed, a, b])).toBeUndefined();
  });

  it("routes a front-side tender around the capital instead of through its hull", () => {
    const tender = ship("tender", "t", 300);
    const wounded = ship("dreadnought", "d");
    wounded.shieldCurrent = 0;
    const enemy = ship("battleship", "e", 900, 1);
    const ships = [tender, wounded, enemy];
    expect(tenderRescueTarget(tender, ships)).toBe(wounded);
    const velocity = supportVelocity(tender, ships);
    expect(velocity[1]).not.toBe(0);
    const closestTime = Math.max(
      0,
      -(tender.pos[0] * velocity[0]) / (velocity[0] ** 2 + velocity[1] ** 2),
    );
    const closestDistance = Math.hypot(
      tender.pos[0] + velocity[0] * closestTime,
      velocity[1] * closestTime,
    );
    expect(closestDistance).toBeGreaterThan(wounded.size + tender.size);
  });

  it("wounded capitals rendezvous with tenders beyond 800 units", () => {
    const wounded = ship("battleship", "b");
    wounded.shieldCurrent = 0;
    wounded.hullCurrent = wounded.hullMax * 0.2;
    wounded.heading = 0;
    const tender = ship("tender", "t", 1400);
    const context = new ClientCombatSimulation();
    updateShipNavigation(wounded, null, [wounded, tender], 0.1, context, () => ({
      heading: 0,
      speed: 0,
    }));
    expect(wounded.velocity[0]).toBeGreaterThan(0);
  });

  it("heavy ships share finishing locks across groups without saturation penalties", () => {
    const heavy = ship("battleship", "h");
    const target = ship("carrier", "c", 700, 1);
    target.shieldCurrent = 0;
    target.velocity = [100, 0];
    const alternative = ship("carrier", "other", 650, 1);
    const allies = Array.from({ length: 4 }, (_, i) => {
      const ally = ship("battleship", `ally${i}`);
      ally.groupId = i + 2;
      ally.navigationTargetId = target.id;
      return ally;
    });
    const ships = [heavy, target, alternative, ...allies];
    expect(capitalFinishPriority(heavy, target, ships)).toBe(9);
    expect(findNavigationTarget(heavy, order, ships)).toBe(target);
    for (const ally of allies) ally.groupId = heavy.groupId;
    expect(findNavigationTarget(heavy, order, ships)).toBe(target);
    target.shieldCurrent = 1;
    expect(capitalFinishPriority(heavy, target, ships)).toBe(0);
  });

  it("closes on exposed retreaters and resumes standoff after shield recovery", () => {
    const heavy = ship("battleship", "h");
    const target = ship("carrier", "c", 650, 1);
    target.velocity = [80, 0];
    target.shieldCurrent = 0;
    const aggressive = capitalIntent(heavy, target, [heavy, target], order);
    target.shieldCurrent = target.shieldMax;
    const normal = capitalIntent(heavy, target, [heavy, target], order);
    expect(aggressive.velocity[0]).toBeGreaterThan(normal.velocity[0]);
    expect(aggressive.velocity[0]).toBeGreaterThan(0);
  });

  it("requires four committed attackers for swarm courage", () => {
    const corvette = ship("corvette", "c", 400, 1);
    const fighters = Array.from({ length: 4 }, (_, i) => {
      const fighter = ship("strike_craft", `f${i}`);
      fighter.fighterPhase = "attack";
      fighter.navigationTargetId = corvette.id;
      return fighter;
    });
    expect(swarmFlakFear(fighters[0], corvette, fighters.slice(0, 3))).toBe(1);
    expect(swarmFlakFear(fighters[0], corvette, fighters)).toBe(0.5);
    fighters[3].fighterPhase = "recover";
    expect(swarmFlakFear(fighters[0], corvette, fighters)).toBe(1);
  });
});
