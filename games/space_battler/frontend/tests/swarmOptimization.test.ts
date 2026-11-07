import { describe, expect, it } from "vitest";
import { CollisionContactSolver } from "../src/engine/collisionContactSolver";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { calculateSeparation } from "../src/engine/flightBehaviors";
import { fleetDefenseAnchor } from "../src/engine/flightControl";
import { prepareNavigationContext } from "../src/engine/navigationContext";
import { findNavigationTarget } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, team = 0) {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [0, 0];
  return result;
}

describe("swarm optimization invariants", () => {
  it("preserves incremental squad allocation and ship-relative defense anchors", () => {
    const ships = Array.from({ length: 8 }, (_, i) => ship("corvette", `ally-${i}`));
    const enemies = [ship("corvette", "enemy-a", 1), ship("corvette", "enemy-b", 1)];
    enemies[0].pos = [500, 0];
    enemies[1].pos = [510, 0];
    const all = [...ships, ...enemies];
    const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
    const expected = ships.map((pilot) => {
      pilot.navigationTargetId = findNavigationTarget(pilot, order, all)?.id;
      return pilot.navigationTargetId;
    });
    for (const pilot of ships) pilot.navigationTargetId = undefined;
    const context = prepareNavigationContext(all);
    const actual = ships.map((pilot) => {
      pilot.navigationTargetId = findNavigationTarget(pilot, order, all)?.id;
      context.adjust(context.navigationAssignments, pilot, pilot.navigationTargetId, 1);
      return pilot.navigationTargetId;
    });
    expect(actual).toEqual(expected);
    const capitals = [ship("carrier", "far"), ship("cruiser", "near")];
    capitals[0].pos = [1000, 0];
    capitals[1].pos = [100, 0];
    const fleet = [ships[0], ...capitals];
    const anchor = fleetDefenseAnchor(ships[0], fleet);
    prepareNavigationContext(fleet);
    expect(fleetDefenseAnchor(ships[0], fleet)).toBe(anchor);
  });

  it.each(["dreadnought", "battleship", "carrier", "cruiser"] as const)(
    "keeps %s momentum and position when a fighter collides",
    (hull) => {
      const capital = ship(hull, "capital");
      const fighter = ship("strike_craft", "fighter");
      fighter.pos = [capital.size + fighter.size - 10, 0];
      capital.velocity = [80, 12];
      fighter.velocity = [-50, 0];
      const simulation = new ClientCombatSimulation();
      const solver = new CollisionContactSolver(simulation, (victim) => {
        victim.isAlive = false;
      });
      solver.resolveShipCollisions([capital, fighter], 1 / 60, false);
      expect(capital.pos).toEqual([0, 0]);
      expect(capital.velocity).toEqual([80, 12]);
      expect(fighter.pos[0]).toBeGreaterThanOrEqual(capital.size + fighter.size);
    },
  );

  it("ignores fighter repulsion with other hulls present and retains the all-light fallback", () => {
    const capital = ship("battleship", "capital");
    const fighter = ship("strike_craft", "fighter");
    fighter.pos = [10, 0];
    const peer = ship("cruiser", "peer");
    peer.pos = [5000, 0];
    expect(calculateSeparation(capital, [capital, fighter, peer])).toEqual([0, 0]);
    expect(calculateSeparation(capital, [capital, fighter])[0]).toBeLessThan(0);
  });
});
