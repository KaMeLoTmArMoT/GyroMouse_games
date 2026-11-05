import { describe, expect, it } from "vitest";
import { hasFighterHazard } from "../src/canvas/effects";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";

describe("echelon visuals", () => {
  it("marks recovering or below 40% hull fighters, but not healthy, dead or capital ships", () => {
    const ships = buildFleetFromSlots(
      [
        { id: "fighter", hullClass: "strike_craft", groupId: 1 },
        { id: "capital", hullClass: "cruiser", groupId: 1 },
      ],
      0,
      -800,
      0,
    );
    const fighter = ships.find((ship) => ship.hullClass === "strike_craft");
    const capital = ships.find((ship) => ship.hullClass === "cruiser");
    if (!fighter || !capital) throw new Error("Expected fighter and capital fixtures");
    fighter.fighterPhase = "egress";
    fighter.hullCurrent = fighter.hullMax * 0.4;
    expect(hasFighterHazard(fighter)).toBe(false);
    fighter.hullCurrent -= 0.01;
    expect(hasFighterHazard(fighter)).toBe(true);
    fighter.hullCurrent = fighter.hullMax;
    fighter.fighterPhase = "recover";
    expect(hasFighterHazard(fighter)).toBe(true);
    fighter.isAlive = false;
    expect(hasFighterHazard(fighter)).toBe(false);
    capital.hullCurrent = 1;
    expect(hasFighterHazard(capital)).toBe(false);
  });

  it("reports group-relative waves, living phases and isolated membership snapshots", () => {
    const slots = Array.from({ length: 14 }, (_, i) => ({
      id: `${i}`,
      hullClass: "strike_craft" as const,
      groupId: i < 10 ? 1 : 2,
    }));
    const fighters = buildFleetFromSlots(slots, 0, -800, 0);
    const [target] = buildFleetFromSlots(
      [{ id: "target", hullClass: "battleship", groupId: 1 }],
      1,
      1000,
      Math.PI,
    );
    const sim = new ClientCombatSimulation();
    for (const ship of [...fighters, target]) sim.addShip(ship);
    sim.update(1 / 60);
    const wings = sim.getFighterWingVisuals();
    expect(wings.map((wing) => [wing.groupId, wing.wave, wing.members.length])).toEqual([
      [1, 1, 4],
      [1, 2, 3],
      [1, 3, 3],
      [2, 1, 4],
    ]);
    expect(wings.slice(0, 3).map((wing) => wing.phase)).toEqual(["attack", "staging", "staging"]);
    expect(wings.every((wing) => wing.targetId === target.id)).toBe(true);
    (wings[0].members as string[]).length = 0;
    expect(sim.getFighterWingVisuals()[0].members).toHaveLength(4);
  });
});
