import { describe, expect, it } from "vitest";
import { ARENA_RADIUS, applyArenaRadiation, arenaVelocity } from "../src/engine/arenaBoundary";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { normalizeAngle } from "../src/engine/math2d";
import type { HullClass, ShipState, Vector2 } from "../src/types/combat";

function vessel(hullClass: HullClass = "strike_craft", team = 0, id = "returner"): ShipState {
  const ship = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  ship.pos = [ARENA_RADIUS + 25, 0];
  ship.heading = Math.PI;
  ship.velocity = [0, 0];
  ship.shieldCurrent = 0;
  return ship;
}

function cluster(hullClass: HullClass, count: number): ShipState[] {
  return Array.from({ length: count }, (_, index) => {
    const enemy = vessel(hullClass, 1, `enemy-${index}`);
    enemy.pos = [
      ARENA_RADIUS - (hullClass === "corvette" ? 500 : 300),
      (index - (count - 1) / 2) * 8,
    ];
    enemy.heading = hullClass === "missile_frigate" ? Math.PI * 0.75 : 0;
    return enemy;
  });
}

function direct(ship: ShipState): Vector2 {
  return [-ship.maxSpeed, 0];
}

describe("threat-aware arena return", () => {
  it.each([
    ["strike_craft", 6],
    ["missile_frigate", 5],
    ["corvette", 2],
  ] as const)("skirts a blocking %s formation (%i enemies)", (hullClass, count) => {
    const ship = vessel();
    const enemies = cluster(hullClass, count);
    const route = arenaVelocity(ship, direct(ship), enemies);
    expect(route[0]).toBeLessThan(0);
    expect(Math.abs(route[1])).toBeGreaterThan(ship.maxSpeed * 0.4);
    expect(Math.hypot(...route)).toBeCloseTo(ship.maxSpeed);
    expect(arenaVelocity(ship, direct(ship))).toEqual([
      expect.closeTo(-ship.maxSpeed),
      expect.closeTo(0),
    ]);
  });

  it.each(["isDocked", "isDebris", "isAlive", "team"] as const)(
    "ignores a formation made inactive or friendly via %s",
    (flag) => {
      const ship = vessel();
      const enemies = cluster("strike_craft", 6);
      for (const enemy of enemies) {
        if (flag === "team") enemy.team = ship.team;
        else enemy[flag] = flag !== "isAlive";
      }
      const route = arenaVelocity(ship, direct(ship), enemies);
      expect(route[0]).toBeCloseTo(-ship.maxSpeed);
      expect(route[1]).toBeCloseTo(0);
    },
  );

  it("ignores distant enemies and does not give equal fighters a lethal ramming penalty", () => {
    const ship = vessel();
    const enemy = vessel("strike_craft", 1);
    enemy.pos = [...ship.pos];
    enemy.turrets = [];
    expect(arenaVelocity(ship, direct(ship), [enemy])[1]).toBeCloseTo(0);
    enemy.pos = [-ARENA_RADIUS, 0];
    enemy.turrets = cluster("strike_craft", 1)[0].turrets;
    expect(arenaVelocity(ship, direct(ship), [enemy])[1]).toBeCloseTo(0);
  });

  it("accepts partial radiation hull loss to evade a lethal fighter kill-zone", () => {
    const ship = vessel();
    const route = arenaVelocity(ship, direct(ship), cluster("strike_craft", 6));
    expect(Math.abs(route[1])).toBeGreaterThan(ship.maxSpeed * 0.4);
    const startHull = ship.hullCurrent;
    const heading = Math.atan2(route[1], route[0]);
    applyArenaRadiation(ship, Math.abs(normalizeAngle(heading - Math.PI)) / ship.turnRate);
    for (let tick = 0; tick < 60 && Math.hypot(...ship.pos) > ARENA_RADIUS; tick++) {
      applyArenaRadiation(ship, 1 / 60);
      ship.pos = [ship.pos[0] + route[0] / 60, ship.pos[1] + route[1] / 60];
    }
    expect(ship.hullCurrent).toBeGreaterThan(startHull * 0.5);
    expect(ship.hullCurrent).toBeLessThan(startHull);
    expect(Math.hypot(...ship.pos)).toBeLessThanOrEqual(ARENA_RADIUS);
  });

  it.each([
    [25, 5],
    [ARENA_RADIUS * 0.5, 70],
  ])(
    "breaks straight inward when radiation makes skirting fatal (depth %s, hull %s)",
    (depth, hull) => {
      const ship = vessel();
      ship.pos = [ARENA_RADIUS + depth, 0];
      ship.hullCurrent = hull;
      const enemies = cluster("strike_craft", 6);
      const route = arenaVelocity(ship, direct(ship), enemies);
      expect(route[0]).toBeCloseTo(-ship.maxSpeed);
      expect(route[1]).toBeCloseTo(0);
      expect(Math.hypot(...route)).toBeCloseTo(ship.maxSpeed);
    },
  );

  it("makes rare per-ship desperate rolls only against lethal odds, stable for five seconds", () => {
    const enemies = cluster("strike_craft", 6);
    for (const enemy of enemies) {
      enemy.turrets[0].baseArc = [-0.12, 0.12];
      enemy.turrets[0].weapon.damage = 5000;
    }
    let breakthroughs = 0;
    let changedWindows = 0;
    for (let index = 0; index < 100; index++) {
      const ship = vessel();
      ship.id = `cornered-${index}`;
      ship.lastThreatTime = 0;
      const initial = arenaVelocity(ship, direct(ship), enemies);
      if (Math.abs(initial[1]) < 1e-6) breakthroughs++;
      ship.lastThreatTime = 4.99;
      expect(arenaVelocity(ship, direct(ship), enemies)).toEqual(initial);
      ship.lastThreatTime = 5;
      if (arenaVelocity(ship, direct(ship), enemies)[1] !== initial[1]) changedWindows++;
    }
    expect(breakthroughs).toBeGreaterThan(0);
    expect(breakthroughs).toBeLessThan(15);
    expect(changedWindows).toBeGreaterThan(0);
  });
});
