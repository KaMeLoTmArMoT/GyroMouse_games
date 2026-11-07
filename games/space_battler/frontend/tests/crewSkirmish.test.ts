import { describe, expect, it } from "vitest";
import { type CrewVeterancy, crewDecisionPeriod } from "../src/engine/crewVeterancy";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { skirmishFleetVelocity } from "../src/engine/flightBehaviors";
import { ARENA_RADIUS } from "../src/engine/flightControl";
import { vecDistance } from "../src/engine/math2d";
import { fighterTacticalTick, updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, team = 0) {
  return buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0)[0];
}

describe("crew tactical cadence", () => {
  it("preserves every Pilot tick against the implicit baseline", () => {
    const baseline = ship("strike_craft");
    const pilot = structuredClone(baseline);
    for (let frame = 0; frame < 600; frame++) {
      baseline.fighterPhase = pilot.fighterPhase = frame < 300 ? "attack" : "rejoin";
      expect(fighterTacticalTick(pilot, frame / 60, [pilot], "pilot")).toBe(
        fighterTacticalTick(baseline, frame / 60, [baseline]),
      );
    }
  });

  it("orders reaction cadence without changing Pilot's 12/5 Hz baseline", () => {
    for (const combat of [true, false]) {
      const periods = (["recruit", "pilot", "veteran", "ace"] as CrewVeterancy[]).map((tier) =>
        crewDecisionPeriod(tier, combat),
      );
      expect(periods[0]).toBeGreaterThan(periods[1]);
      expect(periods[1]).toBe(1 / (combat ? 12 : 5));
      expect(periods[2]).toBeLessThan(periods[1]);
      expect(periods[3]).toBeLessThan(periods[2]);
    }
  });
});

describe("missile frigate containment", () => {
  it("returns to friendly capital support while preserving lateral thrust", () => {
    const frigate = ship("missile_frigate");
    frigate.pos = [1500, 0];
    const carrier = ship("carrier");
    carrier.pos = [0, 0];
    const enemy = ship("battleship", 1);
    enemy.pos = [3000, 0];
    const escort = ship("missile_frigate");
    escort.pos = [2500, 0];
    expect(skirmishFleetVelocity(frigate, [60, 30], [frigate, carrier, enemy, escort])).toEqual([
      -50, 30,
    ]);
    expect(skirmishFleetVelocity(frigate, [60, 30], [frigate, enemy, escort])).toEqual([60, 30]);
  });

  it("keeps target-facing standoff inside the arena over sustained flight", () => {
    const frigate = ship("missile_frigate");
    frigate.pos = [ARENA_RADIUS - 50, 0];
    frigate.heading = Math.PI;
    frigate.velocity = [frigate.maxSpeed * 0.3, 0];
    const target = ship("battleship", 1);
    target.pos = [ARENA_RADIUS - 550, 0];
    const sim = new ClientCombatSimulation();
    sim.ships = [frigate, target];
    for (let frame = 0; frame < 1200; frame++) {
      sim.timeElapsed = frame / 60;
      updateShipNavigation(frigate, target, sim.ships, 1 / 60, sim, () => ({
        heading: 0,
        speed: 0,
      }));
      expect(vecDistance([0, 0], frigate.pos)).toBeLessThan(ARENA_RADIUS + 100);
    }
  });
});
