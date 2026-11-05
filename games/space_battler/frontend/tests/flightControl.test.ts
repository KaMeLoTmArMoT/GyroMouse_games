import { describe, expect, it } from "vitest";
import { mountPosition } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { capitalIntent, spinalEscape } from "../src/engine/flightControl";
import { normalizeAngle, vecDistance, vecDot } from "../src/engine/math2d";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { EngagementStance, HullClass, Vector2 } from "../src/types/combat";

function ship(hullClass: HullClass, team = 0) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = [0, 0];
  return result;
}

describe("capital beam avoidance", () => {
  it.each(["corvette", "strike_craft"] as const)(
    "%s moves away from a broadside boundary before the capital turns",
    (hull) => {
      const small = ship(hull);
      const capital = ship("battleship", 1);
      capital.heading = 0.4;
      const beam = capital.turrets.find((mount) => mount.id.endsWith("_stbd"));
      if (!beam) throw new Error("Missing beam mount");
      capital.turrets = [beam];
      const angle = capital.heading + beam.baseArc[0] - 0.1;
      const muzzle = mountPosition(capital, beam);
      small.pos = [muzzle[0] + 600 * Math.cos(angle), muzzle[1] + 600 * Math.sin(angle)];
      const avoidance = spinalEscape(small, [small, capital], [], 0);
      const tangent: [number, number] = [-Math.sin(angle), Math.cos(angle)];
      expect(vecDot(avoidance, tangent)).toBeLessThan(0);
    },
  );

  it("projects incoming movement and ignores distant, friendly, and dead capitals", () => {
    const small = ship("corvette");
    const capital = ship("cruiser", 1);
    capital.turrets = capital.turrets.filter((mount) => mount.weapon.weaponType === "beam_laser");
    small.pos = [1200, 0];
    small.velocity = [-200, 0];
    expect(spinalEscape(small, [small, capital], [], 0)[0]).toBeGreaterThan(0);
    small.velocity = [0, 0];
    small.pos = [1500, 0];
    expect(spinalEscape(small, [small, capital], [], 0)).toEqual([0, 0]);
    small.pos = [500, 0];
    capital.team = small.team;
    expect(spinalEscape(small, [small, capital], [], 0)).toEqual([0, 0]);
    capital.team = 1;
    capital.isAlive = false;
    expect(spinalEscape(small, [small, capital], [], 0)).toEqual([0, 0]);
  });

  it("escapes a full-circle beam radially, including across the angle wrap", () => {
    const small = ship("strike_craft");
    const capital = ship("cruiser", 1);
    const beam = capital.turrets.find((mount) => mount.weapon.weaponType === "beam_laser");
    if (!beam) throw new Error("Missing beam mount");
    beam.baseArc = [-Math.PI, Math.PI];
    capital.turrets = [beam];
    capital.heading = 0.2;
    const muzzle = mountPosition(capital, beam);
    small.pos = [muzzle[0] - 500, muzzle[1]];
    expect(spinalEscape(small, [small, capital], [], 0)[0]).toBeLessThan(0);
  });
});

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
      checkRadius("optimal_range", hull === "battleship" ? 1025 : 990);
      checkRadius("brawl", hull === "battleship" ? 800 : 750);
      primary.weapon.range = 1000;
      for (const mount of secondary) mount.weapon.range = 800;
      checkRadius("max_range", 850);
      checkRadius("optimal_range", 720);
      for (const mount of secondary) mount.weapon.range = 2000;
      checkRadius("optimal_range", hull === "battleship" ? 1025 : 1150);
    },
  );

  it("closes bow-first and enables weaving only at the envelope threshold", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship", 1);
    cruiser.maneuverTargetId = target.id;
    cruiser.capitalManeuver = "broadside_hold";
    cruiser.turrets[1].cooldownTimer = 5;
    const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
    target.pos = [1051, 0];
    const closing = capitalIntent(cruiser, target, [cruiser, target], order);
    expect(closing.heading).toBeCloseTo(0);
    expect(closing.velocity[0]).toBeGreaterThan(0);
    expect(closing.velocity[1]).toBeCloseTo(0);
    target.pos = [1050, 0];
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

describe("missile frigate hit-and-run", () => {
  const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;

  it("approaches nose-first and keeps moving across the launch envelope", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    target.pos = [1600, 0];
    const approach = capitalIntent(frigate, target, [frigate, target], order);
    expect(approach.heading).toBeCloseTo(0);
    expect(approach.velocity[0]).toBeGreaterThan(90);
    target.pos = [1200, 0];
    const delivery = capitalIntent(frigate, target, [frigate, target], order);
    expect(delivery.heading).toBeCloseTo(0);
    expect(Math.hypot(...delivery.velocity)).toBeGreaterThanOrEqual(30);
    expect(Math.abs(delivery.velocity[1])).toBeGreaterThanOrEqual(30);
  });

  it("finishes the staggered salvo, burns away at 150 degrees, and retains retreat until reload is near", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    target.pos = [1200, 0];
    for (const tube of frigate.turrets.slice(0, 3)) {
      tube.lastFiredTime = 1;
      tube.cooldownTimer = 4.8;
    }
    frigate.turrets[3].cooldownTimer = 0;
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(0);
    frigate.turrets[3].lastFiredTime = 1.6;
    frigate.turrets[3].cooldownTimer = 4.8;
    const retreat = capitalIntent(frigate, target, [frigate, target], order);
    expect(Math.abs(retreat.heading)).toBeCloseTo((150 * Math.PI) / 180);
    expect(Math.hypot(...retreat.velocity)).toBeCloseTo(100);
    expect(retreat.velocity[0]).toBeLessThan(-80);
    expect(Math.abs(retreat.velocity[1])).toBeGreaterThan(45);
    for (const tube of frigate.turrets) tube.cooldownTimer = 2;
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(
      retreat.heading,
    );
    for (const tube of frigate.turrets) tube.cooldownTimer = 0.9;
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(0);
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(0);
    frigate.turrets[0].lastFiredTime = 6;
    frigate.turrets[0].cooldownTimer = 4.8;
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(0);
    for (const tube of frigate.turrets.slice(1)) {
      tube.lastFiredTime = 6.6;
      tube.cooldownTimer = 4.8;
    }
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(
      retreat.heading,
    );
  });

  it("breaks off when already reloading, including on target changes", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    target.pos = [1200, 0];
    for (const tube of frigate.turrets) tube.cooldownTimer = 3;
    const retreat = capitalIntent(frigate, target, [frigate, target], order);
    for (const tube of frigate.turrets) tube.cooldownTimer = 1.5;
    target.id = "replacement";
    expect(capitalIntent(frigate, target, [frigate, target], order).heading).toBeCloseTo(
      retreat.heading,
    );
  });

  it("delivers repeated four-tube salvoes while opening distance and relocating", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    target.pos = [1200, 0];
    target.maxSpeed = target.turnRate = 0;
    target.turrets = [];
    target.shieldCurrent = target.shieldMax = 100000;
    const sim = new ClientCombatSimulation();
    sim.addShip(frigate);
    sim.addShip(target);
    const shots = new Map<string, number>();
    sim.onProjectileFire = () => {
      const mount = frigate.turrets.find((tube) => tube.lastFiredTime === sim.timeElapsed);
      if (mount) shots.set(mount.id, (shots.get(mount.id) ?? 0) + 1);
    };
    let retreatStart: Vector2 | undefined;
    let openedDistance = 0;
    let fastestRetreat = 0;
    for (let tick = 0; tick < 1200; tick++) {
      sim.update(1 / 60);
      if (frigate.capitalManeuver !== "broadside_hold") continue;
      retreatStart ??= [...frigate.pos];
      openedDistance = Math.max(
        openedDistance,
        vecDistance(frigate.pos, target.pos) - vecDistance(retreatStart, target.pos),
      );
      fastestRetreat = Math.max(fastestRetreat, Math.hypot(...frigate.velocity));
    }
    expect(shots.size).toBe(4);
    expect([...shots.values()].every((count) => count >= 2)).toBe(true);
    expect(openedDistance).toBeGreaterThan(100);
    expect(fastestRetreat).toBeGreaterThan(99);
    expect(Math.abs(frigate.pos[1])).toBeGreaterThan(100);
  });
});
