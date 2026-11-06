import { describe, expect, it } from "vitest";
import { mountPosition } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { calculateSeparation, clampLateralVelocity } from "../src/engine/flightBehaviors";
import {
  ARENA_HARD_PULL_RADIUS,
  ARENA_RADIUS,
  arenaVelocity,
  capitalIntent,
  configureArena,
  debrisAvoidanceVelocity,
  escortVelocity,
  spinalEscape,
} from "../src/engine/flightControl";
import {
  type BroadsideCycle,
  classifyRange,
  reduceBroadsideCycle,
  reduceSkirmishCycle,
  type SkirmishCycle,
} from "../src/engine/flightCycles";
import { normalizeAngle, rotatePoint, vecDistance, vecDot } from "../src/engine/math2d";
import { SHIP_DOCTRINES } from "../src/engine/shipDoctrines";
import { updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { EngagementStance, HullClass, Vector2 } from "../src/types/combat";

function ship(hullClass: HullClass, team = 0) {
  const result = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, 0, 0)[0];
  result.pos = [0, 0];
  return result;
}

describe("predictive kinetic wreck routing", () => {
  it("evades an oncoming wreck using thrust before any collision solver runs", () => {
    const craft = ship("strike_craft");
    const wreck = ship("cruiser");
    wreck.id = "wreck";
    wreck.isDebris = true;
    wreck.size = 30;
    wreck.pos = [400, 0];
    wreck.velocity = [-160, 0];
    const sim = new ClientCombatSimulation();
    sim.addShip(craft);
    sim.addShip(wreck);
    for (let tick = 0; tick < 150; tick++) {
      updateShipNavigation(craft, null, [craft], 1 / 60, sim, () => ({ heading: 0, speed: 0 }));
      wreck.pos[0] += wreck.velocity[0] / 60;
      expect(vecDistance(craft.pos, wreck.pos)).toBeGreaterThan(craft.size + wreck.size + 7.5);
    }
    expect(Math.abs(craft.pos[1])).toBeGreaterThan(craft.size + wreck.size);
    expect(wreck.velocity).toEqual([-160, 0]);
  });

  it.each(["strike_craft", "corvette", "tender", "missile_frigate"] as const)(
    "leaves a diameter-plus-15 corridor open for %s",
    (hull) => {
      const craft = ship(hull);
      const wrecks = [-1, 1].map((side) => {
        const wreck = ship("cruiser");
        wreck.id = `wreck_${side}`;
        wreck.isDebris = true;
        wreck.size = 30;
        wreck.pos = [craft.maxSpeed, side * (30 + craft.size + 8)];
        wreck.velocity = [0, 0];
        return wreck;
      });
      craft.velocity = [craft.maxSpeed, 0];
      expect(debrisAvoidanceVelocity(craft, craft.velocity, wrecks)).toEqual(craft.velocity);
      for (const wreck of wrecks) wreck.pos[1] *= 0.8;
      expect(Math.abs(debrisAvoidanceVelocity(craft, craft.velocity, wrecks)[1])).toBeGreaterThan(
        0,
      );
    },
  );

  it.each(["cruiser", "battleship", "carrier", "dreadnought"] as const)(
    "routes %s outside a connected multi-wreck field instead of between wrecks",
    (hull) => {
      const capital = ship(hull);
      const wrecks = [-1, 1].map((side) => {
        const wreck = ship("cruiser");
        wreck.id = `wreck_${side}`;
        wreck.isDebris = true;
        wreck.size = 30;
        wreck.pos = [capital.size + 110 + capital.maxSpeed, side * 60];
        wreck.velocity = [0, 0];
        return wreck;
      });
      capital.velocity = [capital.maxSpeed, 0];
      const routed = debrisAvoidanceVelocity(capital, capital.velocity, wrecks);
      expect(routed[1]).toBeGreaterThan(0);
      expect(routed[0]).toBeLessThan(capital.maxSpeed);
      expect(debrisAvoidanceVelocity(capital, capital.velocity, [...wrecks].reverse())).toEqual(
        routed,
      );
      for (let tick = 0; tick < 1800; tick++) {
        const desired = debrisAvoidanceVelocity(capital, [capital.maxSpeed, 0], wrecks);
        for (const axis of [0, 1] as const) {
          capital.velocity[axis] += Math.max(
            -110 / 60,
            Math.min(110 / 60, desired[axis] - capital.velocity[axis]),
          );
          capital.pos[axis] += capital.velocity[axis] / 60;
        }
        for (const wreck of wrecks)
          expect(vecDistance(capital.pos, wreck.pos)).toBeGreaterThan(capital.size + wreck.size);
      }
      expect(capital.pos[0]).toBeGreaterThan(wrecks[0].pos[0]);
    },
  );

  it("ignores expired wrecks and receding safe trajectories", () => {
    const craft = ship("strike_craft");
    const wreck = ship("cruiser");
    wreck.isDebris = true;
    wreck.pos = [400, 0];
    wreck.velocity = [200, 0];
    const desired: Vector2 = [100, 0];
    expect(debrisAvoidanceVelocity(craft, desired, [wreck])).toEqual(desired);
    wreck.velocity = [-200, 0];
    wreck.isAlive = false;
    expect(debrisAvoidanceVelocity(craft, desired, [wreck])).toEqual(desired);
  });
});

describe("escort physical capital clearance", () => {
  it.each(["corvette", "missile_frigate"] as const)(
    "keeps every %s recovery and screen station outside oversized hulls and rear exhaust",
    (hull) => {
      for (const capitalHull of ["cruiser", "battleship", "dreadnought"] as const) {
        const anchor = ship(capitalHull);
        for (const size of [anchor.size, 240]) {
          anchor.size = size;
          for (const heading of [0, Math.PI / 2, Math.PI]) {
            anchor.heading = heading;
            for (const index of [0, 1, 4, 5, 10, 11]) {
              const escort = ship(hull);
              escort.id = `escort_${index}`;
              escort.flagshipId = anchor.id;
              for (const charge of [0, 0.4, 0.55, 1]) {
                escort.shieldCurrent = escort.shieldMax * charge;
                const velocity = escortVelocity(escort, null, [anchor, escort]);
                // A stationary anchor and escort at the origin expose the formation station.
                const offset: Vector2 = [velocity[0] / 0.6, velocity[1] / 0.6];
                expect(Math.hypot(...offset)).toBeGreaterThanOrEqual(
                  Math.max(220, anchor.size + escort.size + 90) - 1e-8,
                );
                const local = rotatePoint(offset, -heading);
                expect(local[0]).toBeGreaterThan(0);
                expect(Math.abs(local[1])).toBeGreaterThan(escort.size);
              }
            }
          }
        }
      }
    },
  );

  it.each(["corvette", "missile_frigate"] as const)(
    "brakes %s before the buffer even with collapsed shields, in either pair order",
    (hull) => {
      const escort = ship(hull);
      const anchor = ship("dreadnought");
      anchor.size = 240;
      anchor.shieldCurrent = 0;
      escort.shieldCurrent = 0;
      const clearance = Math.max(220, escort.size + anchor.size + 90);
      escort.pos = [clearance + 45, 0];
      expect(calculateSeparation(escort, [anchor, escort])[0]).toBeGreaterThan(0);
      escort.pos = [clearance, 0];
      expect(calculateSeparation(escort, [anchor, escort])[0]).toBeGreaterThan(escort.maxSpeed);
      expect(calculateSeparation(anchor, [escort, anchor])[0]).toBeLessThan(-anchor.maxSpeed);
      anchor.team = 1;
      expect(calculateSeparation(escort, [anchor, escort])[0]).toBeGreaterThan(escort.maxSpeed);
    },
  );

  it("keeps a recovering picket outside the buffer throughout station acquisition", () => {
    const escort = ship("corvette");
    const anchor = ship("battleship");
    escort.flagshipId = anchor.id;
    escort.shieldCurrent = escort.shieldMax * 0.39;
    const clearance = Math.max(220, escort.size + anchor.size + 90);
    escort.pos = [clearance, 0];
    const simulation = new ClientCombatSimulation();
    simulation.addShip(anchor);
    simulation.addShip(escort);
    for (let frame = 0; frame < 600; frame++) {
      simulation.update(1 / 60);
      expect(vecDistance(escort.pos, anchor.pos)).toBeGreaterThanOrEqual(clearance - 1e-6);
    }
  });
});

describe("predictive arena steering", () => {
  it.each(["strike_craft", "missile_frigate"] as const)(
    "turns an outward-moving %s progressively before the edge",
    (hull) => {
      const craft = ship(hull);
      craft.velocity = [craft.maxSpeed, 0];
      const desired: Vector2 = [craft.maxSpeed, 0];
      craft.pos = [ARENA_RADIUS - 600, 0];
      expect(arenaVelocity(craft, desired)).toEqual(desired);
      craft.pos = [ARENA_RADIUS - 400, 0];
      const early = arenaVelocity(craft, desired);
      craft.pos = [ARENA_RADIUS - 100, 0];
      const near = arenaVelocity(craft, desired);
      expect(early[0]).toBeLessThan(desired[0]);
      expect(early[1]).toBeGreaterThan(0);
      expect(near[0]).toBeLessThan(early[0]);
      expect(near[0]).toBeLessThan(0);
      expect(Math.hypot(...near)).toBeLessThanOrEqual(craft.maxSpeed + 1e-8);
    },
  );

  it("damps outward momentum without disturbing safe inward or tangential travel", () => {
    const craft = ship("strike_craft");
    craft.pos = [ARENA_RADIUS - 100, 0];
    craft.velocity = [craft.maxSpeed, 0];
    const braking = arenaVelocity(craft, [0, 50]);
    expect(braking[0]).toBeLessThan(0);
    expect(braking[1]).toBe(50);
    craft.velocity = [-50, 0];
    expect(arenaVelocity(craft, [-50, 25])).toEqual([-50, 25]);
    expect(arenaVelocity(craft, [0, 50])).toEqual([0, 50]);
  });

  it("scales the anticipation zone with the configured arena", () => {
    const radius = ARENA_RADIUS;
    const hardRadius = ARENA_HARD_PULL_RADIUS;
    try {
      configureArena(1000, 1300);
      const craft = ship("strike_craft");
      craft.pos = [800, 0];
      craft.velocity = [craft.maxSpeed, 0];
      expect(arenaVelocity(craft, [craft.maxSpeed, 0])[0]).toBeLessThan(craft.maxSpeed);
    } finally {
      configureArena(radius, hardRadius);
    }
  });

  it("chooses an inward breakoff side and keeps an existing outward arc under correction", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
    frigate.pos = [ARENA_RADIUS - 100, 0];
    target.pos = [frigate.pos[0] - 100, -500];
    for (const tube of frigate.turrets) tube.cooldownTimer = 3;
    const inward = capitalIntent(frigate, target, [frigate, target], order);
    expect(frigate.skirmishCycle?.side).toBe(-1);
    expect(Math.cos(inward.heading)).toBeLessThan(0);

    if (!frigate.skirmishCycle) throw new Error("Missing skirmish cycle");
    frigate.skirmishCycle.side = 1;
    frigate.velocity = [frigate.maxSpeed, 0];
    const corrected = capitalIntent(frigate, target, [frigate, target], order);
    const doctrine = SHIP_DOCTRINES.missile_frigate.flight;
    if (doctrine.kind !== "skirmish") throw new Error("Missing skirmish doctrine");
    const uncorrected = Math.atan2(-500, -100) + doctrine.breakoffAngle;
    expect(Math.cos(corrected.heading)).toBeLessThan(Math.cos(uncorrected));
    expect(frigate.skirmishCycle.side).toBe(1);
  });
});

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
      if (frigate.skirmishCycle?.phase !== "breakoff") continue;
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

describe("flight behavior contracts", () => {
  const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;

  it("classifies the engagement boundary inclusively", () => {
    expect(classifyRange(1050.001, 1050)).toBe("approach");
    expect(classifyRange(1050, 1050)).toBe("engage");
    expect(classifyRange(1049, 1050)).toBe("engage");
  });

  it.each(["battleship", "dreadnought", "cruiser", "missile_frigate"] as const)(
    "%s approaches the direct target bearing despite battery, reload, fleet and boundary biases",
    (hull) => {
      const approaching = ship(hull);
      const target = ship("battleship", 1);
      const wingmate = ship(hull);
      wingmate.id = "wingmate";
      approaching.pos = [1900, 0];
      approaching.heading = -1.4;
      target.pos = [3900, 700];
      target.velocity = [0, 100];
      wingmate.pos = [1900, 10];
      for (const mount of approaching.turrets) {
        mount.lastFiredTime = 10;
        mount.cooldownTimer = 10;
      }
      approaching.maneuverTargetId = target.id;
      approaching.capitalManeuver = "broadside_hold";
      approaching.broadsideSide = -1;
      const bearing = Math.atan2(700, 2000);
      for (const time of [0, 3, 1000]) {
        const intent = capitalIntent(
          approaching,
          target,
          [approaching, target, wingmate],
          order,
          time,
        );
        expect(intent.rangePhase).toBe("approach");
        expect(normalizeAngle(intent.heading - bearing)).toBeCloseTo(0, 12);
        const forward = vecDot(intent.velocity, [Math.cos(bearing), Math.sin(bearing)]);
        const lateral = vecDot(intent.velocity, [-Math.sin(bearing), Math.cos(bearing)]);
        const doctrine = SHIP_DOCTRINES[hull].flight;
        if (doctrine.kind !== "capital" && doctrine.kind !== "skirmish")
          throw new Error("Missing doctrine");
        expect(Math.abs(lateral)).toBeLessThanOrEqual(
          Math.min(
            approaching.maxSpeed * doctrine.lateralSpeedRatio,
            Math.abs(forward) * Math.tan(Math.PI / 18),
          ) + 1e-8,
        );
      }
    },
  );

  it.each(["battleship", "dreadnought", "cruiser", "missile_frigate"] as const)(
    "%s clamps inherited drift in the post-turn frame after arena corrections",
    (hull) => {
      const approaching = ship(hull);
      const target = ship("battleship", 1);
      approaching.pos = [2300, 500];
      approaching.heading = Math.PI / 4;
      approaching.velocity = [0, approaching.maxSpeed];
      target.pos = [4500, 500];
      target.maxSpeed = target.turnRate = 0;
      target.turrets = [];
      approaching.turrets = [];
      const sim = new ClientCombatSimulation();
      sim.addShip(approaching);
      sim.addShip(target);
      const doctrine = SHIP_DOCTRINES[hull].flight;
      if (doctrine.kind !== "capital" && doctrine.kind !== "skirmish")
        throw new Error("Missing doctrine");
      for (let tick = 0; tick < 120; tick++) {
        const oldHeading = approaching.heading;
        sim.update(1 / 60);
        if (tick === 0) expect(approaching.heading).not.toBe(oldHeading);
        const forward = vecDot(approaching.velocity, [
          Math.cos(approaching.heading),
          Math.sin(approaching.heading),
        ]);
        const lateral = vecDot(approaching.velocity, [
          -Math.sin(approaching.heading),
          Math.cos(approaching.heading),
        ]);
        expect(Math.abs(lateral)).toBeLessThanOrEqual(
          Math.min(
            approaching.maxSpeed * doctrine.lateralSpeedRatio,
            Math.abs(forward) * Math.tan(Math.PI / 18),
          ) + 1e-8,
        );
      }
    },
  );

  it("permits no lateral-only approach and bounds reverse drift as well", () => {
    const fixture = { heading: 0, maxSpeed: 100 };
    expect(clampLateralVelocity(fixture, [0, 100], 0.35, "approach")).toEqual([0, 0]);
    expect(clampLateralVelocity(fixture, [-10, 100], 0.35, "approach")[1]).toBeCloseTo(
      10 * Math.tan(Math.PI / 18),
    );
    expect(clampLateralVelocity(fixture, [100, 100], 0.1, "approach")[1]).toBe(10);
  });

  it("reduces staggered skirmish reloads deterministically without mutating prior states", () => {
    const base = {
      targetId: "target",
      initialSide: -1,
      reload: 0,
      salvoComplete: false,
      lastShot: 1,
      breakoffReload: 2.5,
      reacquireReload: 1,
    };
    const run = () => {
      let state: SkirmishCycle | undefined;
      return [
        {},
        { lastShot: 1.4 },
        { reload: 4.8, salvoComplete: true, lastShot: 1.6 },
        { targetId: "replacement", reload: 2, lastShot: 1.6 },
        { reload: 1, lastShot: 1.6 },
        { reload: 0.9, lastShot: 1.6 },
        { reload: 0, lastShot: 6 },
        { reload: 4.8, salvoComplete: true, lastShot: 6.6 },
      ].map((input) => {
        const previous = state && Object.freeze(state);
        state = reduceSkirmishCycle(previous, { ...base, ...input });
        return state;
      });
    };
    const states = run();
    expect(run()).toEqual(states);
    expect(states.map((state) => state.phase)).toEqual([
      "acquire",
      "acquire",
      "breakoff",
      "breakoff",
      "breakoff",
      "reacquire",
      "reacquire",
      "breakoff",
    ]);
    expect(states[3].targetId).toBe("replacement");
    expect(states[5].lastSalvoShot).toBe(1.6);
    expect(states[7].lastSalvoShot).toBe(6.6);
    expect(reduceSkirmishCycle(undefined, { ...base, reload: 3 }).phase).toBe("breakoff");
  });

  it("reduces capital shots, side alternation, reacquisition and target changes independently", () => {
    const input = {
      targetId: "target",
      initialSide: 1,
      lastShot: undefined as number | undefined,
      cooldown: 5,
      reacquireTime: 1,
      alternateAfterShot: true,
    };
    const acquire = Object.freeze(reduceBroadsideCycle(undefined, input));
    const hold = Object.freeze(reduceBroadsideCycle(acquire, { ...input, lastShot: 2 }));
    expect(acquire.phase).toBe("bow_acquire");
    expect(hold.phase).toBe("broadside_hold");
    expect(hold.side).toBe(-1);
    expect(reduceBroadsideCycle(hold, { ...input, lastShot: 2 })).toEqual(hold);
    expect(reduceBroadsideCycle(hold, { ...input, lastShot: 2, cooldown: 1 }).phase).toBe(
      "bow_reacquire",
    );
    expect(
      reduceBroadsideCycle(hold, { ...input, targetId: "replacement", lastShot: 2 }).phase,
    ).toBe("bow_acquire");
  });

  it("keeps skirmish state separate from legacy and dedicated capital maneuver state", () => {
    const frigate = ship("missile_frigate");
    const target = ship("battleship", 1);
    target.pos = [1200, 0];
    const capitalState: BroadsideCycle = Object.freeze({
      phase: "broadside_hold",
      targetId: "unrelated",
      side: -1,
      lastShot: 500,
    });
    frigate.broadsideCycle = capitalState;
    frigate.capitalManeuver = "broadside_hold";
    frigate.maneuverTargetId = "unrelated";
    frigate.broadsideSide = -1;
    frigate.lastManeuverShot = 500;
    for (const tube of frigate.turrets) {
      tube.lastFiredTime = 1;
      tube.cooldownTimer = 4.8;
    }
    capitalIntent(frigate, target, [frigate, target], order);
    expect(frigate.skirmishCycle).toMatchObject({ phase: "breakoff", lastSalvoShot: 1, side: 1 });
    expect(frigate.broadsideCycle).toBe(capitalState);
    expect([
      frigate.capitalManeuver,
      frigate.maneuverTargetId,
      frigate.broadsideSide,
      frigate.lastManeuverShot,
    ]).toEqual(["broadside_hold", "unrelated", -1, 500]);
    const capital = ship("cruiser");
    capital.skirmishCycle = frigate.skirmishCycle;
    const skirmishState = capital.skirmishCycle;
    capitalIntent(capital, target, [capital, target], order);
    expect(capital.skirmishCycle).toBe(skirmishState);
  });

  it("tunes cruiser broadside behavior without changing other hull intents or cycles", () => {
    const target = ship("battleship", 1);
    target.pos = [900, 0];
    const sample = (hull: HullClass) => {
      const fixture = ship(hull);
      if (hull === "corvette" || hull === "strike_craft") {
        const sim = new ClientCombatSimulation();
        sim.addShip(fixture);
        sim.addShip(ship("battleship", 1));
        sim.ships[1].pos = [900, 0];
        for (let tick = 0; tick < 10; tick++) sim.update(1 / 60);
        return {
          intent: { heading: fixture.heading, velocity: fixture.velocity },
          broadside: fixture.broadsideCycle,
          skirmish: fixture.skirmishCycle,
        };
      }
      fixture.maneuverTargetId = target.id;
      fixture.capitalManeuver = "broadside_hold";
      for (const turret of fixture.turrets) turret.cooldownTimer = 5;
      const intent = capitalIntent(fixture, target, [fixture, target], order);
      return { intent, broadside: fixture.broadsideCycle, skirmish: fixture.skirmishCycle };
    };
    const hulls = [
      "battleship",
      "dreadnought",
      "missile_frigate",
      "corvette",
      "strike_craft",
    ] as const;
    const before = hulls.map(sample);
    const cruiserBefore = sample("cruiser");
    const doctrine = SHIP_DOCTRINES.cruiser.flight;
    if (doctrine.kind !== "capital") throw new Error("Missing cruiser doctrine");
    const original = doctrine.broadside;
    try {
      doctrine.broadside = { ...original, arcOffset: Math.PI / 2, continuous: true };
      expect(sample("cruiser").intent.heading).not.toBe(cruiserBefore.intent.heading);
      expect(hulls.map(sample)).toEqual(before);
    } finally {
      doctrine.broadside = original;
    }
  });
});

describe("doctrine-driven behavior composition", () => {
  it("lets a cruiser reuse continuous fleet-facing broadside behavior through doctrine", () => {
    const cruiser = ship("cruiser");
    const target = ship("battleship", 1);
    const otherEnemy = ship("cruiser", 1);
    target.pos = [900, 0];
    otherEnemy.pos = [900, 900];
    const ships = [cruiser, target, otherEnemy];
    const order = { groupId: 1, priority: "nearest", stance: "optimal_range" } as const;
    expect(capitalIntent(cruiser, target, ships, order).heading).toBeCloseTo(0);
    const doctrine = SHIP_DOCTRINES.cruiser.flight;
    if (doctrine.kind !== "capital") throw new Error("Missing cruiser flight doctrine");
    const original = doctrine.broadside;
    try {
      doctrine.broadside = {
        ...original,
        continuous: true,
        bearing: "fleet",
        arcOffset: Math.PI / 2,
      };
      const intent = capitalIntent(cruiser, target, ships, order);
      expect(intent.heading).toBeCloseTo(Math.atan2(450, 900) - Math.PI / 2);
      expect(intent.velocity[1]).toBeGreaterThan(0);
    } finally {
      doctrine.broadside = original;
    }
  });

  it("reuses escort recovery for a doctrine hull threshold while shields remain healthy", () => {
    const corvette = ship("corvette");
    const anchor = ship("battleship");
    const target = ship("cruiser", 1);
    corvette.flagshipId = anchor.id;
    corvette.pos = [490, 245];
    target.pos = [590, 245];
    const ships = [corvette, anchor, target];
    const doctrine = SHIP_DOCTRINES.corvette.flight;
    if (doctrine.kind !== "escort") throw new Error("Missing corvette flight doctrine");
    const original = doctrine.retreat;
    try {
      doctrine.retreat = { hullRatio: 0.3 };
      corvette.hullCurrent = corvette.hullMax * 0.31;
      expect(escortVelocity(corvette, target, ships)).not.toEqual(
        escortVelocity(corvette, null, ships),
      );
      corvette.hullCurrent = corvette.hullMax * 0.3;
      expect(escortVelocity(corvette, target, ships)).toEqual(
        escortVelocity(corvette, null, ships),
      );
    } finally {
      doctrine.retreat = original;
    }
  });
});
