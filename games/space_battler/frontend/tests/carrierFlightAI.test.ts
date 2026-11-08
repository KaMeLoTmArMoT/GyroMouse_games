import { describe, expect, it } from "vitest";
import {
  CATAPULT_DURATION,
  carrierRecoveryPoint,
  LAUNCH_BOOST,
  moveCarrierLaunch,
  moveCarrierRecovery,
  TRACTOR_DURATION,
  updateCarrierHangars,
} from "../src/engine/carrierHangar";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
  capitalIntent,
  corvetteWolfpack,
  dogfightTarget,
  escortVelocity,
  withinPursuitTheater,
} from "../src/engine/flightControl";
import { rotatePoint, vecAdd, vecDistance, vecScale, vecSub } from "../src/engine/math2d";
import { shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { findNavigationTarget } from "../src/engine/shipNavigationSystem";
import type { HullClass } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, team = 0) {
  const craft = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  craft.id = id;
  craft.pos = [0, 0];
  return craft;
}
const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;

describe("carrier staging and catapults", () => {
  it("matches a moving carrier before a linear 0.7-second tractor glide", () => {
    const carrier = ship("carrier", "carrier");
    const craft = ship("strike_craft", "craft_0");
    carrier.velocity = [30, 10];
    carrier.heading = Math.PI / 3;
    craft.flagshipId = carrier.id;
    craft.carrierRecovering = true;
    const pad = carrierRecoveryPoint(carrier, craft);
    expect(vecDistance(pad, carrier.pos)).toBeLessThan(shieldEnvelopeRadius(carrier));
    expect(rotatePoint(vecSub(pad, carrier.pos), -carrier.heading)[0]).toBeLessThan(0);
    craft.pos = [...pad];
    craft.velocity = [130, 10];
    moveCarrierRecovery(craft, [carrier, craft], 0.01, 0);
    updateCarrierHangars([carrier, craft], 1);
    expect(craft.isDocked).toBeFalsy();
    craft.pos = [...pad];
    craft.velocity = [...carrier.velocity];
    moveCarrierRecovery(craft, [carrier, craft], TRACTOR_DURATION / 2, 1);
    const bay = rotatePoint([-carrier.size * 0.35, carrier.size * 0.45], carrier.heading);
    const midpoint = vecAdd(carrier.pos, vecScale(vecAdd(vecSub(pad, carrier.pos), bay), 0.5));
    expect(
      vecDistance(craft.pos, vecAdd(midpoint, vecScale(carrier.velocity, TRACTOR_DURATION / 2))),
    ).toBeLessThan(1e-8);
    updateCarrierHangars([carrier, craft], 1 + TRACTOR_DURATION / 2);
    expect(craft.isDocked).toBeFalsy();
    updateCarrierHangars([carrier, craft], 1 + TRACTOR_DURATION);
    expect(craft.isDocked).toBe(true);
    expect(craft.velocity).toEqual(carrier.velocity);
  });

  it("emerges at a forward flank tube with carrier momentum then fans out", () => {
    const carrier = ship("carrier", "carrier");
    const craft = ship("strike_craft", "craft_0");
    carrier.heading = Math.PI / 2;
    carrier.velocity = [20, 30];
    craft.flagshipId = carrier.id;
    craft.isDocked = true;
    craft.hangarLaunchAt = 0;
    updateCarrierHangars([carrier, craft], 0);
    expect(craft.isDocked).toBe(false);
    const local = rotatePoint(vecSub(craft.pos, carrier.pos), -carrier.heading);
    expect(local[0]).toBeCloseTo(carrier.size * 0.65);
    expect(local[1]).toBeCloseTo(carrier.size * 1.05);
    expect(craft.velocity[0]).toBeCloseTo(20);
    expect(craft.velocity[1]).toBeCloseTo(30 + LAUNCH_BOOST);
    const start = [...craft.pos] as [number, number];
    expect(moveCarrierLaunch(craft, [carrier], 0.1, 0.3)).toBe(true);
    expect(vecDistance(start, craft.pos)).toBeLessThan(30);
    expect(craft.heading).toBeGreaterThan(carrier.heading);
    expect(moveCarrierLaunch(craft, [carrier], 0.1, CATAPULT_DURATION)).toBe(false);
  });
});

describe("bounded wolfpack hunting", () => {
  it("allows initial fighter ingress but releases a craft that disengages after contact", () => {
    const hunter = ship("strike_craft", "hunter");
    const enemy = ship("strike_craft", "enemy", 1);
    enemy.pos = [800, 0];
    expect(withinPursuitTheater(hunter, enemy, [hunter, enemy])).toBe(true);
    enemy.pos = [500, 0];
    expect(withinPursuitTheater(hunter, enemy, [hunter, enemy])).toBe(true);
    enemy.pos = [601, 0];
    expect(findNavigationTarget(hunter, order, [hunter, enemy])).toBeNull();
  });
  it.each([
    ["strike_craft", 601],
    ["corvette", 601],
    ["missile_frigate", 901],
    ["cruiser", 901],
    ["battleship", 901],
    ["dreadnought", 901],
  ] as const)("breaks %s pursuit beyond its tactical limit", (hull, distance) => {
    const hunter = ship(hull, "hunter");
    const enemy = ship("strike_craft", "enemy", 1);
    enemy.pos = [distance, 0];
    const other = ship("corvette", "other", 1);
    other.pos = [-2000, 0];
    const fleet = [hunter, enemy, other];
    hunter.navigationTargetId = enemy.id;
    hunter.dogfightTargetId = enemy.id;
    expect(findNavigationTarget(hunter, order, fleet, enemy.id)).not.toBe(enemy);
    expect(dogfightTarget(hunter, fleet, 0)).toBeNull();
    if (hull !== "strike_craft" && hull !== "corvette")
      expect(capitalIntent(hunter, enemy, fleet, order).velocity[0]).toBeLessThanOrEqual(0);
    if (hull === "corvette") expect(escortVelocity(hunter, enemy, [hunter, enemy])).toEqual([0, 0]);
  });

  it("reserves a picket and pairs excess corvettes against isolated craft, prioritizing gunboats", () => {
    const capital = ship("battleship", "capital");
    const escorts = [0, 1, 2].map((i) => {
      const escort = ship("corvette", `escort_${i}`);
      escort.flagshipId = capital.id;
      escort.pos = [200, i * 40];
      return escort;
    });
    const straggler = ship("strike_craft", "straggler", 1);
    straggler.pos = [500, 0];
    const grouped = ship("strike_craft", "grouped", 1);
    grouped.pos = [200, 450];
    const ally = ship("cruiser", "ally", 1);
    ally.pos = [200, 500];
    const secondAlly = ship("missile_frigate", "second-ally", 1);
    secondAlly.pos = [0, 500];
    const fleet = [capital, ...escorts, straggler, grouped, ally, secondAlly];
    expect(corvetteWolfpack(escorts[0], fleet)).toEqual([]);
    expect(corvetteWolfpack(escorts[1], fleet)).toEqual(escorts.slice(1));
    for (const hunter of escorts.slice(1))
      expect(findNavigationTarget(hunter, order, fleet)?.id).toBe(straggler.id);
    const gunboat = ship("corvette", "gunboat", 1);
    gunboat.pos = [550, 0];
    expect(findNavigationTarget(escorts[1], order, [...fleet, gunboat])?.id).toBe(gunboat.id);
    straggler.pos = [1100, 0];
    escorts[1].pos = [700, 0];
    expect(withinPursuitTheater(escorts[1], straggler, fleet)).toBe(false);
  });
});

describe("corvette flak escort screen", () => {
  it.each(["carrier", "battleship", "dreadnought"] as const)(
    "screens a threatened %s toward the predicted strike vector even during a wolfpack attack",
    (hull) => {
      const capital = ship(hull, "capital");
      const escorts = [0, 1, 2].map((i) => {
        const escort = ship("corvette", `escort_${i}`);
        escort.flagshipId = capital.id;
        escort.pos = [-100, i * 20];
        return escort;
      });
      const strike = ship("strike_craft", "strike", 1);
      strike.pos = [600, 200];
      strike.velocity = [-100, -100];
      const enemyCapital = ship("battleship", "enemy", 1);
      enemyCapital.pos = [-500, 0];
      const fleet = [capital, ...escorts, strike, enemyCapital];
      const escort = escorts[1];
      expect(corvetteWolfpack(escort, fleet)).toHaveLength(2);
      const velocity = escortVelocity(escort, enemyCapital, fleet);
      expect(velocity[0]).toBeGreaterThan(0);
      expect(velocity[1]).toBeLessThan(0);
      escort.pos = [300, 0];
      expect(escortVelocity(escort, enemyCapital, fleet)).toEqual([0, 0]);
    },
  );

  it("screens the nearest threatened capital and follows its velocity", () => {
    const escort = ship("corvette", "escort");
    const safe = ship("carrier", "safe");
    safe.pos = [-500, 0];
    escort.flagshipId = safe.id;
    const capital = ship("battleship", "threatened");
    capital.pos = [400, 0];
    capital.velocity = [10, 0];
    const strike = ship("strike_craft", "strike", 1);
    strike.pos = [1000, 0];
    strike.velocity = [10, 0];
    escort.pos = [700, 0];
    expect(escortVelocity(escort, null, [escort, safe, capital, strike])).toEqual([10, 0]);
  });

  it("resumes ordinary escort behavior when the strike threat disappears or flak is absent", () => {
    const capital = ship("carrier", "capital");
    const escort = ship("corvette", "escort_0");
    escort.flagshipId = capital.id;
    escort.pos = [300, 0];
    const strike = ship("strike_craft", "strike", 1);
    strike.pos = [600, 0];
    const fleet = [capital, escort, strike];
    const screened = escortVelocity(escort, null, fleet);
    expect(screened).toEqual([0, 0]);
    strike.isDocked = true;
    const normal = escortVelocity(escort, null, fleet);
    expect(normal).not.toEqual(screened);
    strike.isDocked = false;
    escort.shieldCurrent = escort.shieldMax * 0.39;
    expect(escortVelocity(escort, null, fleet)).toEqual(
      escortVelocity(escort, null, [capital, escort]),
    );
    escort.shieldCurrent = escort.shieldMax;
    escort.turrets.forEach((turret) => {
      turret.weapon.flak = undefined;
    });
    expect(escortVelocity(escort, null, fleet)).toEqual(normal);
    strike.isAlive = false;
    expect(escortVelocity(escort, null, fleet)).toEqual(normal);
  });
});
