import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent } from "../src/engine/flightControl";
import { normalizeAngle, vecDistance, vecDot } from "../src/engine/math2d";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { EngagementStance, HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, team = 0) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = [0, 0];
  return result;
}

describe("capital standoff and cruiser drift", () => {
  it.each(["battleship", "cruiser"] as const)(
    "derives %s envelopes from equipped ranges",
    (hull) => {
      const capital = ship(hull);
      const target = ship("battleship", 1);
      const primary = capital.turrets.find(
        (mount) => mount.isSpinalGimbal || mount.weapon.weaponType === "missile",
      );
      if (!primary) throw new Error("Missing primary weapon");
      const secondary = capital.turrets.filter((mount) => mount !== primary);
      const checkRadius = (stance: EngagementStance, radius: number) => {
        target.pos = [radius, 0];
        const intent = capitalIntent(capital, target, [capital, target], {
          groupId: 1,
          priority: "nearest",
          stance,
        });
        expect(intent.velocity[0]).toBeCloseTo(0);
      };
      checkRadius("max_range", 1500);
      checkRadius("optimal_range", hull === "battleship" ? 1080 : 990);
      checkRadius("brawl", hull === "battleship" ? 800 : 750);
      primary.weapon.range = 1000;
      for (const mount of secondary) mount.weapon.range = 800;
      checkRadius("max_range", 850);
      checkRadius("optimal_range", 720);
      for (const mount of secondary) mount.weapon.range = 2000;
      checkRadius("optimal_range", 1150);
    },
  );

  it("closes bow-first and enables weaving only at the envelope threshold", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship", 1);
    cruiser.maneuverTargetId = target.id;
    cruiser.capitalManeuver = "broadside_hold";
    cruiser.turrets[1].cooldownTimer = 5;
    const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
    target.pos = [1191, 0];
    const closing = capitalIntent(cruiser, target, [cruiser, target], order);
    expect(closing.heading).toBeCloseTo(0);
    expect(closing.velocity[0]).toBeGreaterThan(0);
    expect(closing.velocity[1]).toBeCloseTo(0);
    target.pos = [1190, 0];
    const weaving = capitalIntent(cruiser, target, [cruiser, target], order);
    expect(Math.abs(weaving.heading)).toBeCloseTo((40 * Math.PI) / 180);
    expect(Math.abs(weaving.velocity[1])).toBeGreaterThan(0);
  });

  it("turns a sideways cruiser into its closing course and caps inherited lateral speed", () => {
    const cruiser = ship("cruiser");
    cruiser.heading = Math.PI / 2;
    cruiser.velocity = [cruiser.maxSpeed, 0];
    const target = ship("battleship", 1);
    target.pos = [1800, 0];
    target.maxSpeed = target.turnRate = 0;
    cruiser.turrets.forEach((mount) => {
      mount.cooldownTimer = 100;
    });
    target.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(cruiser);
    sim.addShip(target);
    const initialDistance = vecDistance(cruiser.pos, target.pos);
    for (let tick = 0; tick < 180; tick++) {
      sim.update(1 / 60);
      const right: [number, number] = [-Math.sin(cruiser.heading), Math.cos(cruiser.heading)];
      expect(Math.abs(vecDot(cruiser.velocity, right))).toBeLessThanOrEqual(
        cruiser.maxSpeed * 0.35 + 1e-8,
      );
    }
    expect(vecDistance(cruiser.pos, target.pos)).toBeLessThan(initialDistance - 100);
    expect(
      Math.abs(
        normalizeAngle(Math.atan2(cruiser.velocity[1], cruiser.velocity[0]) - cruiser.heading),
      ),
    ).toBeLessThan(0.1);
  });
});
