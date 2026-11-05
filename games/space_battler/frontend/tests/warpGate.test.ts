import { describe, expect, it } from "vitest";
import { VisualEffectsManager } from "../src/canvas/effects";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";

describe("fleet warp ingress", () => {
  it("creates gates at living ships' spawn positions and replaces the previous ingress", () => {
    const ships = buildFleetFromSlots(
      [
        { id: "a", hullClass: "battleship", groupId: 1 },
        { id: "b", hullClass: "corvette", groupId: 1 },
      ],
      0,
      -1100,
      0,
    );
    const effects = new VisualEffectsManager();
    ships[1].isAlive = false;
    effects.triggerFleetWarpIn(ships);
    expect(effects.warpGates).toHaveLength(1);
    expect(effects.warpGates[0]).toMatchObject({
      shipId: ships[0].id,
      pos: ships[0].pos,
      heading: ships[0].heading,
      radius: ships[0].size * 1.5,
      team: 0,
    });
    const spawnX = ships[0].pos[0];
    ships[0].pos[0] += 10;
    expect(effects.warpGates[0].pos[0]).toBe(spawnX);
    effects.triggerFleetWarpIn(ships);
    expect(effects.warpGates).toHaveLength(1);
    expect(effects.warpGates[0].pos[0]).toBe(spawnX + 10);
  });

  it("emits a single capped forward burst at collapse and removes expired gates", () => {
    const effects = new VisualEffectsManager();
    effects.addWarpGate([20, 30], Math.PI, 20, 1);
    effects.updateWarpGates(0.49);
    expect(effects.sparkParticles).toHaveLength(0);
    effects.updateWarpGates(0.02);
    expect(effects.sparkParticles).toHaveLength(5);
    expect(effects.sparkParticles.every((particle) => particle.velocity[0] < 0)).toBe(true);
    effects.updateWarpGates(0.3);
    expect(effects.warpGates).toHaveLength(0);
    expect(effects.sparkParticles).toHaveLength(5);

    effects.sparkParticles = Array.from({ length: 399 }, () => effects.sparkParticles[0]);
    effects.addWarpGate([0, 0], 0, 10, 0);
    effects.updateWarpGates(0.8);
    expect(effects.sparkParticles).toHaveLength(400);
  });
});
