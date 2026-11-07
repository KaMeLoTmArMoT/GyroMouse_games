import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { ShipState } from "../src/types/combat";

export function createSwarm(corvettes: number): ClientCombatSimulation {
  const sim = new ClientCombatSimulation();
  for (const team of [0, 1]) {
    const ships = buildFleetFromSlots(
      Array.from({ length: 100 }, (_, i) => ({
        id: `${team}_${i}`,
        hullClass: (i < corvettes ? "corvette" : "strike_craft") as ShipState["hullClass"],
        groupId: 1,
      })),
      team,
      team === 0 ? -350 : 350,
      team === 0 ? 0 : Math.PI,
    );
    // Compact 10x10 grids start inside dogfight/flak range.
    ships.forEach((ship, i) => {
      ship.pos = [(team === 0 ? -350 : 350) + (i % 10) * 45, (Math.floor(i / 10) - 4.5) * 65];
      // Preserve N=200 throughout the window without disabling weapons.
      ship.hullCurrent = ship.hullMax = 1_000_000_000;
      sim.addShip(ship);
    });
  }
  return sim;
}
