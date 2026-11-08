import { describe, expect, it } from "vitest";
import { FighterMissionSystem } from "../src/engine/fighterMissionSystem";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { limitVelocity } from "../src/engine/flightControl";
import { clamp, vecAdd, vecDistance, vecDot, vecScale, vecSub } from "../src/engine/math2d";
import { prepareNavigationContext } from "../src/engine/navigationContext";
import { isCapitalShip, shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { ShieldHavenSystem } from "../src/engine/shieldHaven";
import { hostileFlakThreats, updateShipNavigation } from "../src/engine/shipNavigationSystem";
import { flakThreatRadius } from "../src/engine/shipProfiles";
import type {
  GroupOrder,
  HullClass,
  ProjectileState,
  ShipState,
  Vector2,
} from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2, team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = pos;
  result.heading = 0;
  result.velocity = [0, 0];
  return result;
}

// Legacy vector stage with no navigation target: compare exact IEEE-754 results,
// including sequential shield projections and the final speed limit/integration.
function coastingVelocity(craft: ShipState, ships: ShipState[], dt: number): Vector2 {
  const forward: Vector2 = [Math.cos(craft.heading), Math.sin(craft.heading)];
  const right: Vector2 = [-Math.sin(craft.heading), Math.cos(craft.heading)];
  const forwardSpeed = vecDot(craft.velocity, forward);
  const lateralSpeed =
    vecDot(craft.velocity, right) *
    Math.max(0, 1 - dt * (craft.hullClass === "strike_craft" ? 2.5 : 5.0));
  const accel = craft.hullClass === "strike_craft" ? 240.0 : 110.0;
  let velocity = vecAdd(
    vecScale(forward, forwardSpeed + clamp(-forwardSpeed, -accel * dt, accel * dt)),
    vecScale(right, lateralSpeed),
  );
  if (craft.hullClass === "strike_craft") {
    for (const capital of ships) {
      if (!capital.isAlive || !isCapitalShip(capital)) continue;
      const distance = vecDistance(craft.pos, capital.pos);
      if (distance < 1e-6) continue;
      const clearance =
        shieldEnvelopeRadius(capital) + shieldEnvelopeRadius(craft) + craft.size * 3;
      const toward = vecScale(vecSub(capital.pos, craft.pos), 1 / distance);
      const closing = vecDot(vecSub(velocity, capital.velocity), toward);
      const safeClosing = Math.max(0, (distance - clearance) / 0.5);
      if (closing > safeClosing)
        velocity = vecSub(velocity, vecScale(toward, closing - safeClosing));
    }
  }
  return limitVelocity(velocity, craft.maxSpeed);
}

describe("scalar navigation invariants", () => {
  it("preserves flak order, inclusive range, and live eligibility with a prepared context", () => {
    const craft = ship("craft", "strike_craft", [0, 0]);
    const first = ship("first", "corvette", [0, 0], 2);
    const second = ship("second", "corvette", [0, 0], 1);
    const initiallyDocked = ship("docked", "corvette", [0, 0], 1);
    initiallyDocked.isDocked = true;
    const radius = flakThreatRadius(first);
    first.pos = [radius, 0];
    const far = ship("far", "corvette", [radius + 1, 0], 1);
    const ships = [craft, first, ship("ally", "corvette", [0, 0]), second, initiallyDocked, far];
    expect(hostileFlakThreats(craft, ships)).toEqual([first, second]);
    prepareNavigationContext(ships);
    expect(hostileFlakThreats(craft, ships)).toEqual([first, second]);
    first.isAlive = false;
    second.isDebris = true;
    initiallyDocked.isDocked = false;
    expect(hostileFlakThreats(craft, ships)).toEqual([initiallyDocked]);
  });

  it.each(["strike_craft", "cruiser"] as const)(
    "retains exact %s coasting velocity and position across shield projections",
    (hullClass) => {
      for (let sample = 0; sample < 24; sample++) {
        const craft = ship(`craft-${sample}`, hullClass, [13.125, -29.75]);
        craft.heading = (sample - 12) * 0.237;
        craft.velocity = [Math.cos(sample) * 430.125, Math.sin(sample) * 317.75];
        const first = ship("first", "battleship", [180.5, 35.25]);
        const second = ship("second", "cruiser", [-115.25, -170.5], 1);
        const far = ship("far", "carrier", [8000, 8000], 1);
        first.velocity = [-17.125, 23.75];
        second.velocity = [12.5, -8.125];
        const ships = [craft, first, second, far];
        const dt = sample % 2 ? 1 / 60 : 1 / 120;
        const expectedVelocity = coastingVelocity(craft, ships, dt);
        const expectedPos = vecAdd(craft.pos, vecScale(expectedVelocity, dt));
        updateShipNavigation(
          craft,
          null,
          ships,
          dt,
          {
            timeElapsed: 0,
            orders: new Map(),
            projectiles: [],
            ships,
            shieldHaven: new ShieldHavenSystem(),
          },
          () => ({ heading: 0, speed: 0 }),
        );
        for (const axis of [0, 1]) {
          expect(craft.velocity[axis]).toBe(expectedVelocity[axis]);
          expect(craft.pos[axis]).toBe(expectedPos[axis]);
        }
      }
    },
  );
});

describe("safe haven occupancy invariants", () => {
  it.each([false, true])(
    "counts live docked/debris occupants and preserves ties with context=%s",
    (prepared) => {
      const craft = ship("craft", "strike_craft", [0, 0]);
      const first = ship("first", "cruiser", [-500, 0]);
      const second = ship("second", "cruiser", [500, 0]);
      const docked = ship("docked", "strike_craft", [-500, 0]);
      docked.isDocked = true;
      docked.safeHavenId = first.id;
      const debris = ship("debris", "strike_craft", [-500, 0]);
      debris.isDebris = true;
      debris.safeHavenId = first.id;
      const dead = ship("dead", "strike_craft", [500, 0]);
      dead.isAlive = false;
      dead.safeHavenId = second.id;
      const enemy = ship("enemy", "battleship", [4000, 0], 1);
      enemy.safeHavenId = second.id;
      const ships = [craft, first, second, docked, debris, dead, enemy];
      const context = {
        timeElapsed: 0,
        orders: new Map<number, GroupOrder>(),
        projectiles: [] as ProjectileState[],
      };
      const system = new FighterMissionSystem(context, () => {});
      system.ensureWings([craft]);
      if (prepared) prepareNavigationContext(ships);
      system.updateCycle(craft, enemy, 1 / 60, ships);
      expect(craft.safeHavenId).toBe(second.id);
      expect(craft.safeHavenTimer).toBe(2);

      // Critical damage ignores occupancy; equal distances retain the first anchor.
      craft.hullCurrent = craft.hullMax * 0.2;
      context.timeElapsed = 0.3;
      system.updateCycle(craft, enemy, 1 / 60, ships);
      expect(craft.safeHavenId).toBe(first.id);

      // An unexpired haven remains selected, then a live death invalidates the lookup.
      craft.hullCurrent = craft.hullMax;
      context.timeElapsed = 0.6;
      system.updateCycle(craft, enemy, 1 / 60, ships);
      expect(craft.safeHavenId).toBe(first.id);
      expect(craft.safeHavenTimer).toBe(2 - (0.6 - 0.3));
      first.isAlive = false;
      context.timeElapsed = 0.9;
      system.updateCycle(craft, enemy, 1 / 60, ships);
      expect(craft.safeHavenId).toBe(second.id);
    },
  );
});
