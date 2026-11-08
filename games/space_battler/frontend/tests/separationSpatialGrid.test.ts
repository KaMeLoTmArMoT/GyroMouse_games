import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { calculateSeparation } from "../src/engine/flightBehaviors";
import {
  NavigationNeighborhoodCache,
  prepareNavigationContext,
} from "../src/engine/navigationContext";
import type { HullClass, ShipState } from "../src/types/combat";

const HULLS: HullClass[] = [
  "strike_craft",
  "corvette",
  "missile_frigate",
  "cruiser",
  "battleship",
  "dreadnought",
  "carrier",
  "tender",
];

function makeShip(index: number): ShipState {
  const hullClass = HULLS[index % HULLS.length];
  const ship = buildFleetFromSlots([{ id: `${index}`, hullClass, groupId: 1 }], index % 3, 0, 0)[0];
  ship.id = `${index}`;
  return ship;
}

function expectFullScan(ships: ShipState[]): void {
  // This array has no prepared context, so it exercises the unchanged all-peer narrowphase.
  const unindexed = [...ships];
  for (const ship of ships) {
    const expected = calculateSeparation(ship, unindexed);
    const actual = calculateSeparation(ship, ships);
    expect(Object.is(actual[0], expected[0])).toBe(true);
    expect(Object.is(actual[1], expected[1])).toBe(true);
  }
}

describe("separation spatial broadphase", () => {
  it("is bit-identical to full scans across hulls, shields, velocities and storage orders", () => {
    const cache = new NavigationNeighborhoodCache();
    let seed = 123456789;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let epoch = 0; epoch < 8; epoch++) {
      const ships = Array.from({ length: 96 }, (_, index) => {
        const ship = makeShip(index);
        ship.pos = [(random() - 0.5) * 6500, (random() - 0.5) * 6500];
        ship.velocity = [(random() - 0.5) * 600, (random() - 0.5) * 600];
        ship.heading = random() * Math.PI * 2;
        ship.size *= 0.5 + random() * 4;
        ship.havenRadiusMultiplier = 1 + random() * 2;
        if (index % 5 === 0) ship.shieldCurrent = 0;
        if (index % 11 === 0) ship.isDocked = true;
        if (index % 13 === 0) ship.isDebris = true;
        if (index % 17 === 0) ship.isAlive = false;
        return ship;
      });
      // Multiple contributing cells and coincident peers exercise addition order and ID ties.
      for (let index = 1; index < 16; index++) ships[index].pos = [index * 23, index % 3];
      ships[0].pos = [...ships[1].pos];
      ships.reverse();
      prepareNavigationContext(ships, cache);
      expectFullScan(ships);
      ships[3].isAlive = false;
      ships[10].isAlive = true;
      expectFullScan(ships);
    }
  });

  it("keeps distant braking peers, enlarged envelopes and arena overflow conservative", () => {
    const ships = Array.from({ length: 8 }, (_, index) => makeShip(index));
    for (const ship of ships) {
      ship.pos = [12000 + Number(ship.id) * 110, -12000];
      ship.velocity = [0, 0];
    }
    ships[0].pos = [0, 0];
    ships[0].velocity = [1600, 700];
    ships[1].pos = [3000, 1000];
    ships[1].velocity = [-1600, -700];
    ships[3].size = 1500;
    ships[3].havenRadiusMultiplier = 4;
    prepareNavigationContext(ships);
    expectFullScan(ships);
    expect(calculateSeparation(ships[0], [...ships])).not.toEqual([0, 0]);
  });

  it("prunes remote cells, yields ascending source indices and reuses epoch storage", () => {
    const cache = new NavigationNeighborhoodCache();
    const ships = Array.from({ length: 300 }, (_, index) => {
      const ship = makeShip(index);
      ship.pos = index < 4 ? [index * 10, 0] : [1500, 1500];
      ship.velocity = [0, 0];
      return ship;
    });
    const boundaryIndices = [31, 32, 63, 64, 255, 256, 299];
    for (const index of boundaryIndices) ships[index].pos = [index % 2 ? -250 : 250, 0];
    const grid = prepareNavigationContext(ships, cache).separationGrid;
    grid.query(ships[0]);
    const indices: number[] = [];
    for (let index = grid.nextIndex(0); index < ships.length; index = grid.nextIndex(index + 1))
      indices.push(index);
    expect(indices).toEqual([0, 1, 2, 3, ...boundaryIndices]);
    expectFullScan(ships);
    ships[5].pos = [25, 0];
    expect(prepareNavigationContext(ships, cache).separationGrid).toBe(grid);
    grid.query(ships[0]);
    expect(grid.nextIndex(4)).toBe(5);
    expectFullScan(ships);
    prepareNavigationContext([], cache).separationGrid.query(ships[0]);
    expect(grid.nextIndex(0)).toBe(0);
  });

  it("falls back for source-array aliases whose membership differs from the snapshot", () => {
    const source = [makeShip(0), makeShip(1), makeShip(2)];
    const snapshot = [source[0], source[2]];
    for (const ship of source) {
      ship.pos = [Number(ship.id) * 10, 0];
      ship.velocity = [0, 0];
    }
    prepareNavigationContext(snapshot, new NavigationNeighborhoodCache(), [], source);
    expectFullScan(source);
  });
});
