import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
  FIGHTER_DISPERSAL_RADIUS,
  fighterDispersal,
  fighterIngressHeading,
} from "../src/engine/flightControl";
import { normalizeAngle, vecDistance } from "../src/engine/math2d";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2 } from "../src/types/combat";

function ship(id: string, hullClass: HullClass, pos: Vector2, team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = pos;
  result.turrets = [];
  return result;
}

function fighter(id: string, pos: Vector2, wingIndex: number): ShipState {
  const result = ship(id, "strike_craft", pos);
  result.wingIndex = wingIndex;
  return result;
}

describe("fighter wing potential fields", () => {
  it("repels other wings at 200u with quadratic falloff without repelling its own echelon", () => {
    const craft = fighter("own", [0, 0], 0);
    const wingmate = fighter("wingmate", [0, 50], 0);
    expect(fighterDispersal(craft, [craft, wingmate])).toEqual([0, 0]);
    const peer = fighter("other", [0, 100], 1);
    const force = fighterDispersal(craft, [craft, peer]);
    expect(force[0]).toBe(0);
    expect(force[1]).toBeCloseTo(-craft.maxSpeed * 0.8 * 0.25);
    peer.pos = [0, 150];
    expect(Math.abs(fighterDispersal(craft, [craft, peer])[1])).toBeLessThan(Math.abs(force[1]));
    peer.pos = [0, FIGHTER_DISPERSAL_RADIUS];
    expect(fighterDispersal(craft, [craft, peer])).toEqual([0, 0]);
  });

  it("pushes wingmates together as a unit rather than stretching their echelon", () => {
    const a = fighter("a", [-30, -25], 0);
    const b = fighter("b", [30, 25], 0);
    const c = fighter("c", [-30, 75], 1);
    const d = fighter("d", [30, 125], 1);
    const ships = [a, b, c, d];
    expect(fighterDispersal(a, ships)).toEqual(fighterDispersal(b, ships));
    expect(fighterDispersal(c, ships)).toEqual(fighterDispersal(d, ships));
    expect(fighterDispersal(a, ships)[1]).toBeLessThan(0);
    expect(fighterDispersal(c, ships)[1]).toBeGreaterThan(0);
  });

  it("breaks coincident wing symmetry with finite opposite pushes and caps dense fields", () => {
    const a = fighter("a", [0, 0], 0);
    const b = fighter("b", [0, 0], 1);
    const first = fighterDispersal(a, [a, b]);
    const second = fighterDispersal(b, [a, b]);
    expect(first[1]).toBeLessThan(0);
    expect(second[1]).toBeCloseTo(-first[1]);
    const crowded = [
      a,
      ...Array.from({ length: 8 }, (_, i) => fighter(`peer_${i}`, [0, 0], i + 1)),
    ];
    expect(vecDistance([0, 0], fighterDispersal(a, crowded))).toBeCloseTo(a.maxSpeed);
  });

  it("ignores hostile fighters, dead wings, and capital hulls", () => {
    const craft = fighter("own", [0, 0], 0);
    const dead = fighter("dead", [0, 50], 1);
    dead.isAlive = false;
    const enemy = fighter("enemy", [0, 50], 2);
    enemy.team = 1;
    const capital = ship("capital", "cruiser", [0, 50]);
    expect(fighterDispersal(craft, [craft, dead, enemy, capital])).toEqual([0, 0]);
  });
});

describe("wide-arc ingress doctrine", () => {
  it.each([0, Math.PI])(
    "assigns repeating center/high/low arcs relative to bearing %s",
    (bearing) => {
      const degrees = [0, 40, -40, 0, 40, -40];
      degrees.forEach((angle, index) => {
        expect(normalizeAngle(fighterIngressHeading(bearing, index) - bearing)).toBeCloseTo(
          (angle * Math.PI) / 180,
        );
      });
    },
  );

  it("separates ingress corridors across fighter groups and holds their bearings during a pass", () => {
    const fighters = buildFleetFromSlots(
      Array.from({ length: 12 }, (_, i) => ({
        id: `fighter_${i}`,
        hullClass: "strike_craft" as const,
        groupId: Math.floor(i / 4) + 1,
      })),
      0,
      -900,
      0,
    );
    const anchor = ship("anchor", "cruiser", [-1500, 0]);
    const target = ship("target", "battleship", [900, 0], 1);
    anchor.maxSpeed = target.maxSpeed = 0;
    fighters.forEach((craft, i) => {
      craft.pos = [-1100 - Math.floor(i / 4) * 80, ((i % 4) - 1.5) * 56];
      craft.turrets = [];
      craft.maxSpeed = 220;
    });
    const sim = new ClientCombatSimulation();
    for (const craft of [anchor, target, ...fighters]) sim.addShip(craft);
    sim.update(1 / 60);
    const bearings = sim.getFighterWingVisuals().map((wing) => wing.heading);
    expect(bearings[0]).toBeCloseTo(0);
    expect(bearings[1]).toBeCloseTo((40 * Math.PI) / 180);
    expect(bearings[2]).toBeCloseTo((-40 * Math.PI) / 180);
    for (let tick = 0; tick < 60 * 5; tick++) sim.update(1 / 60);
    const meanY = (index: number) => {
      const members = fighters.filter((craft) => craft.wingIndex === index);
      return members.reduce((sum, craft) => sum + craft.pos[1], 0) / members.length;
    };
    // Positive ingress bearings approach from below the centerline; negative bearings from above.
    expect(meanY(1)).toBeLessThan(meanY(0) - 100);
    expect(meanY(2)).toBeGreaterThan(meanY(0) + 100);
    target.pos[1] = 200;
    sim.update(1 / 60);
    expect(sim.getFighterWingVisuals().map((wing) => wing.heading)).toEqual(bearings);
  });
});

describe("critically wounded fighter retreat", () => {
  it.each(["battleship", "cruiser", "corvette"] as const)(
    "falls back toward the nearest friendly %s when no haven lease is available",
    (hull) => {
      const craft = ship("wounded", "strike_craft", [0, 0]);
      craft.hullCurrent = craft.hullMax * 0.29;
      craft.shieldCurrent = craft.shieldRegen = 0;
      craft.safeHavenId = "distant";
      craft.safeHavenTimer = 10;
      const distant = ship("distant", "cruiser", [-900, 0]);
      distant.shieldCurrent = distant.shieldRegen = 0;
      const nearest = ship("nearest", hull, [0, 350]);
      nearest.shieldCurrent = nearest.shieldRegen = 0;
      const dead = ship("dead", "cruiser", [0, 100]);
      dead.isAlive = false;
      const target = ship("enemy", "battleship", [1200, 0], 1);
      [distant, nearest, target].forEach((capital) => {
        capital.maxSpeed = 0;
      });
      const sim = new ClientCombatSimulation();
      for (const s of [craft, distant, nearest, dead, target]) sim.addShip(s);
      sim.update(1 / 60);
      expect(craft.fighterPhase).toBe("recover");
      expect(craft.safeHavenId).toBe(nearest.id);
      expect(craft.heading).toBeGreaterThan(0);
      const initialDistance = vecDistance(craft.pos, nearest.pos);
      for (let tick = 0; tick < 60; tick++) sim.update(1 / 60);
      expect(vecDistance(craft.pos, nearest.pos)).toBeLessThan(initialDistance - 20);
    },
  );
});
