import { expect, it } from "vitest";
import { FleetBreakdown } from "../src/engine/fleetBreakdown";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";

it("reports added and lost craft, actual damage, restoration, and remaining fleet capacity", () => {
  const sim = new ClientCombatSimulation();
  const [fighter] = buildFleetFromSlots(
    [{ id: "fighter", hullClass: "strike_craft", groupId: 1 }],
    0,
    0,
    0,
  );
  const [enemy] = buildFleetFromSlots(
    [{ id: "enemy", hullClass: "corvette", groupId: 1 }],
    1,
    0,
    0,
  );
  sim.addShip(fighter);
  sim.addShip(enemy);
  const breakdown = new FleetBreakdown(sim);
  const added = { ...fighter, id: "fabricated", isAlive: true };
  sim.addShip(added);
  fighter.isAlive = false;
  added.hullCurrent = added.hullMax / 2;
  const before = [enemy.shieldCurrent, enemy.armorCurrent, enemy.hullCurrent];
  enemy.hullCurrent -= 10;
  breakdown.onDamage(enemy, added.id, undefined, "beam_laser", before);
  breakdown.onShieldRegen(added, 12.4);
  sim.timeElapsed = 5;
  const text = breakdown.format(0);
  expect(text).toContain("Strike Craft | 1 → 1 (+1, -1)");
  expect(text).toContain("| 12 | 10 (2.0 DPS) |");
  const expectedPercent = (
    ((added.hullCurrent + added.armorCurrent + added.shieldCurrent) /
      (2 * (added.hullMax + added.armorMax + added.shieldMax))) *
    100
  ).toFixed(1);
  expect(text).toContain(`Fleet HP remaining: ${expectedPercent}%`);
  expect(breakdown.format(1)).not.toContain("Strike Craft");
  expect(text).toContain("| Total | 1 → 1 (+1, -1)");
  const battle = breakdown.format();
  expect(battle).toContain("## Battle Breakdown");
  expect(battle).toContain("| Total | 2 → 2 (+1, -1)");
  expect(battle).toContain("Corvette");
  expect(battle).toContain("Strike Craft");
});
