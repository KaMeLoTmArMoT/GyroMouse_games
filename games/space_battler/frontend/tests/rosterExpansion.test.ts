import { describe, expect, it } from "vitest";
import { inMountArc, mountPosition, slewTurret } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent } from "../src/engine/flightControl";
import { normalizeAngle } from "../src/engine/math2d";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, team = 0) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = [0, 0];
  return result;
}

describe("activated expansion hulls", () => {
  it("assembles both hulls with distinct IDs and four mounts each", () => {
    const fleet = buildFleetFromSlots(
      ["dreadnought", "missile_frigate", "dreadnought", "missile_frigate"].map(
        (hullClass, index) => ({
          id: `${index}`,
          hullClass: hullClass as HullClass,
          groupId: index + 1,
        }),
      ),
      0,
      0,
      0,
    );
    expect(fleet).toHaveLength(4);
    expect(new Set(fleet.map((s) => s.id)).size).toBe(4);
    expect(fleet.every((s) => s.turrets.length === 4)).toBe(true);
  });

  it("concentrates three batteries on either broadside and permits aft slew across the stern", () => {
    const dreadnought = ship("dreadnought");
    for (const side of [-1, 1]) {
      expect(
        dreadnought.turrets.filter((t) => inMountArc(dreadnought, t, [0, side * 800])),
      ).toHaveLength(3);
    }
    const aft = dreadnought.turrets[3];
    const muzzle = mountPosition(dreadnought, aft);
    expect(inMountArc(dreadnought, aft, [muzzle[0] + 800, 0])).toBe(false);
    expect(inMountArc(dreadnought, aft, [muzzle[0] - 800, 0])).toBe(true);
    aft.currentLocalAngle = Math.PI - 0.05;
    slewTurret(aft, -Math.PI + 0.05, 1);
    expect(aft.currentLocalAngle).toBeCloseTo(-Math.PI + 0.05);
    slewTurret(aft, 0, 100);
    expect(Math.abs(aft.currentLocalAngle)).toBeCloseTo((40 * Math.PI) / 180);
  });

  it("holds a dreadnought broadside inside artillery range", () => {
    const dreadnought = ship("dreadnought");
    const target = ship("battleship", 1);
    target.pos = [945, 0];
    const intent = capitalIntent(dreadnought, target, [dreadnought, target], {
      groupId: 1,
      priority: "capitals",
      stance: "optimal_range",
    });
    expect(Math.abs(normalizeAngle(intent.heading))).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(intent.velocity[1])).toBeGreaterThan(0);
  });

  it.each(["optimal_range", "max_range", "brawl"] as const)(
    "keeps frigates moving at missile launch range under %s doctrine",
    (stance) => {
      const frigate = ship("missile_frigate");
      const target = ship("battleship", 1);
      const order = { groupId: 1, priority: "capitals" as const, stance };
      target.pos = [900, 0];
      expect(capitalIntent(frigate, target, [frigate, target], order).velocity[0]).toBeLessThan(0);
      target.pos = [1200, 0];
      const delivery = capitalIntent(frigate, target, [frigate, target], order);
      expect(delivery.velocity[0]).toBeCloseTo(0);
      expect(Math.abs(delivery.velocity[1])).toBeGreaterThan(0);
      target.pos = [1400, 0];
      expect(capitalIntent(frigate, target, [frigate, target], order).velocity[0]).toBeGreaterThan(
        0,
      );
    },
  );
});
