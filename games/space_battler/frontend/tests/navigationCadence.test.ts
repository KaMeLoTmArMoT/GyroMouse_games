import { describe, expect, it } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
  NavigationContext,
  NavigationNeighborhoodCache,
  prepareNavigationContext,
} from "../src/engine/navigationContext";
import type { HullClass, ShipState } from "../src/types/combat";

function ship(hullClass: HullClass, id: string, team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [0, 0];
  return result;
}

describe("navigation neighborhood reaction cadence", () => {
  it("reuses all neighborhood values and refreshes only the staggered cohort", () => {
    const ships = Array.from({ length: 12 }, (_, i) => ship("corvette", `ship-${i}`));
    const cache = new NavigationNeighborhoodCache();
    let previous = new NavigationContext(ships, cache);
    for (let tick = 2; tick <= 7; tick++) {
      const next = new NavigationContext([...ships], cache);
      for (const [index, pilot] of ships.entries()) {
        expect(next.localDensity.get(pilot) === previous.localDensity.get(pilot)).toBe(
          index % 6 !== tick % 6,
        );
        expect(next.anchors.get(pilot)).toBe(previous.anchors.get(pilot));
        expect(next.safe.get(pilot)).toBe(previous.safe.get(pilot));
        expect(next.isolated.get(pilot)).toBe(previous.isolated.get(pilot));
      }
      previous = next;
    }
  });

  it("shares an explicit battle cache between constructor and preparation calls", () => {
    const pilot = ship("corvette", "pilot");
    const fleet = [pilot];
    const cache = new NavigationNeighborhoodCache();
    const first = new NavigationContext(fleet, cache);
    expect(prepareNavigationContext(fleet, cache).localDensity.get(pilot)).toBe(
      first.localDensity.get(pilot),
    );
  });

  it("refreshes anchor, flak safety, density, and isolation when the pilot cohort reacts", () => {
    const pilot = ship("missile_frigate", "pilot");
    const near = ship("carrier", "near");
    const far = ship("carrier", "far");
    const flak = [ship("corvette", "flak-a"), ship("corvette", "flak-b")];
    near.pos = [100, 0];
    far.pos = [200, 0];
    const fleet = [pilot, near, far, ...flak];
    const cache = new NavigationNeighborhoodCache();
    const first = new NavigationContext(fleet, cache);
    expect(first.anchors.get(pilot)).toBe(near);
    expect(first.safe.get(pilot)).toBe(false);
    expect(first.localDensity.get(pilot)?.get(0)).toBe(5);
    expect(first.isolated.get(pilot)).toBe(false);
    for (const peer of [near, ...flak]) peer.pos = [2000, 0];
    for (let tick = 2; tick < 6; tick++) {
      const retained = new NavigationContext(fleet, cache);
      expect(retained.anchors.get(pilot)).toBe(near);
      expect(retained.safe.get(pilot)).toBe(false);
      expect(retained.localDensity.get(pilot)).toBe(first.localDensity.get(pilot));
      expect(retained.isolated.get(pilot)).toBe(false);
    }
    const reaction = new NavigationContext(fleet, cache);
    expect(reaction.anchors.get(pilot)).toBe(far);
    expect(reaction.safe.get(pilot)).toBe(true);
    expect(reaction.localDensity.get(pilot)?.get(0)).toBe(2);
    expect(reaction.isolated.get(pilot)).toBe(true);
  });

  it("keeps standalone snapshots fresh when a supporting peer moves", () => {
    const pilot = ship("missile_frigate", "pilot");
    const peer = ship("corvette", "peer");
    const fleet = [pilot, peer];
    expect(prepareNavigationContext(fleet).localDensity.get(pilot)?.get(0)).toBe(2);
    peer.pos = [2000, 0];
    expect(prepareNavigationContext(fleet).localDensity.get(pilot)?.get(0)).toBe(1);
  });

  it("reuses at exactly 18 units but invalidates displacement beyond that bound", () => {
    const pilot = ship("corvette", "pilot");
    const cache = new NavigationNeighborhoodCache();
    const first = new NavigationContext([pilot], cache);
    pilot.pos = [18, 0];
    const second = new NavigationContext([pilot], cache);
    expect(second.localDensity.get(pilot)).toBe(first.localDensity.get(pilot));
    pilot.pos = [18, 0.1];
    expect(new NavigationContext([pilot], cache).localDensity.get(pilot)).not.toBe(
      second.localDensity.get(pilot),
    );
  });

  it.each(["death", "docking", "debris", "team", "hull", "replacement", "addition", "removal"])(
    "invalidates immediately on fleet %s",
    (change) => {
      const pilot = ship("corvette", "pilot");
      const capital = ship("carrier", "capital");
      let fleet = [pilot, capital];
      const cache = new NavigationNeighborhoodCache();
      const first = new NavigationContext(fleet, cache);
      if (change === "death") capital.isAlive = false;
      if (change === "docking") capital.isDocked = true;
      if (change === "debris") capital.isDebris = true;
      if (change === "team") capital.team = 1;
      if (change === "hull") capital.hullClass = "strike_craft";
      if (change === "replacement") fleet = [pilot, ship("carrier", "capital")];
      if (change === "addition") fleet.push(ship("corvette", "new"));
      if (change === "removal") fleet = [pilot];
      const next = new NavigationContext(fleet, cache);
      expect(next.localDensity.get(pilot)).not.toBe(first.localDensity.get(pilot));
      if (["death", "docking", "debris", "team", "hull", "removal"].includes(change))
        expect(next.anchors.get(pilot)).toBeUndefined();
      if (change === "replacement") expect(next.anchors.get(pilot)).toBe(fleet[1]);
    },
  );

  it("invalidates flagship changes and capital haven envelope changes", () => {
    const pilot = ship("corvette", "pilot");
    const near = ship("carrier", "near");
    const far = ship("carrier", "far");
    far.pos = [1000, 0];
    const fleet = [pilot, near, far];
    const cache = new NavigationNeighborhoodCache();
    const first = new NavigationContext(fleet, cache);
    expect(first.anchors.get(pilot)).toBe(near);
    pilot.flagshipId = far.id;
    const second = new NavigationContext(fleet, cache);
    expect(second.anchors.get(pilot)).toBe(far);
    expect(second.localDensity.get(pilot)).not.toBe(first.localDensity.get(pilot));
    far.havenRadiusMultiplier = 1.2;
    expect(new NavigationContext(fleet, cache).localDensity.get(pilot)).not.toBe(
      second.localDensity.get(pilot),
    );
  });

  it("does not advance another battle's cadence", () => {
    const pilot = ship("corvette", "pilot");
    const fleet = [pilot];
    const cache = new NavigationNeighborhoodCache();
    const first = new NavigationContext(fleet, cache);
    const other = ship("corvette", "other");
    for (let i = 0; i < 8; i++) prepareNavigationContext([other]);
    expect(new NavigationContext(fleet, cache).localDensity.get(pilot)).toBe(
      first.localDensity.get(pilot),
    );
  });
});
