import { describe, expect, it } from "vitest";
import { acquireMountTarget } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { findNavigationTarget } from "../src/engine/shipNavigationSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { GroupOrder, HullClass, Vector2 } from "../src/types/combat";

const order: GroupOrder = { groupId: 1, priority: "capitals", stance: "optimal_range" };

function fixture(id: string, hullClass: HullClass, team: number, pos: Vector2) {
  const ship = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  ship.id = id;
  ship.pos = pos;
  ship.velocity = [0, 0];
  ship.maxSpeed = ship.turnRate = ship.shieldRegen = 0;
  return ship;
}

describe("capital navigation target priority", () => {
  it.each(["dreadnought", "battleship", "cruiser"] as const)(
    "%s abandons a focused 2000u carrier for nearby hostile dreadnoughts",
    (hullClass) => {
      const ship = fixture("owner", hullClass, 0, [0, 0]);
      const carrier = fixture("carrier", "carrier", 1, [2000, 0]);
      const threats = [
        fixture("near", "dreadnought", 1, [650, 0]),
        fixture("other", "dreadnought", 1, [750, 100]),
      ];
      const peers = Array.from({ length: 2 }, (_, index) => {
        const peer = fixture(`peer_${index}`, hullClass, 0, [-200, index * 200]);
        peer.navigationTargetId = carrier.id;
        return peer;
      });
      ship.maneuverTargetId = carrier.id;
      const mainGun = ship.turrets.find(
        (mount) => mount.isSpinalGimbal || mount.weapon.weaponType === "missile",
      );
      if (mainGun) {
        mainGun.currentTargetId = carrier.id;
        mainGun.lastFiredTime = 1;
      }
      expect(
        findNavigationTarget(ship, order, [ship, carrier, ...threats, ...peers], carrier.id)?.id,
      ).toBe("near");
    },
  );

  it("does not bypass a saturated hostile front line to chase a damaged rear anchor", () => {
    const ship = fixture("owner", "dreadnought", 0, [0, 0]);
    const carrier = fixture("carrier", "carrier", 1, [2000, 0]);
    carrier.shieldCurrent = carrier.armorCurrent = 0;
    carrier.hullCurrent = 1;
    const threat = fixture("threat", "dreadnought", 1, [700, 0]);
    const peers = Array.from({ length: 6 }, (_, index) => {
      const peer = fixture(`peer_${index}`, "dreadnought", 0, [-200, 0]);
      peer.navigationTargetId = threat.id;
      return peer;
    });
    expect(findNavigationTarget(ship, order, [ship, carrier, threat, ...peers], carrier.id)).toBe(
      threat,
    );
  });

  it("holds its target through small distance changes but switches for a decisive local threat", () => {
    const ship = fixture("owner", "dreadnought", 0, [0, 0]);
    const previous = fixture("previous", "dreadnought", 1, [900, 0]);
    const challenger = fixture("challenger", "dreadnought", 1, [600, 0]);
    for (let tick = 0; tick < 240; tick++) {
      challenger.pos = [600 + (tick % 2) * 30, 0];
      expect(findNavigationTarget(ship, order, [ship, previous, challenger], previous.id)).toBe(
        previous,
      );
    }
    previous.pos = [2000, 0];
    expect(findNavigationTarget(ship, order, [ship, previous, challenger], previous.id)).toBe(
      challenger,
    );
  });
});

describe("opportunistic mount side targets", () => {
  it.each(["out of range", "outside mount arc"] as const)(
    "fires broadside at a wounded escort when the primary is %s without changing navigation",
    (reason) => {
      const ship = fixture("owner", "dreadnought", 0, [0, 0]);
      const primary = fixture(
        "primary",
        "carrier",
        1,
        reason === "out of range" ? [0, -2000] : [700, 0],
      );
      const wounded = fixture("wounded", "corvette", 1, [-4, -500]);
      wounded.shieldCurrent = wounded.armorCurrent = 0;
      wounded.hullCurrent = 80;
      const healthy = fixture("healthy", "corvette", 1, [-4, -350]);
      const turret = ship.turrets[1];
      ship.turrets = [turret];
      primary.turrets = wounded.turrets = healthy.turrets = [];
      ship.navigationTargetId = primary.id;
      const ships = [ship, primary, wounded, healthy];
      expect(acquireMountTarget(ship, turret, primary, ships, [])?.target.id).toBe(wounded.id);
      expect(turret.sideTargetId).toBe(wounded.id);
      expect(ship.navigationTargetId).toBe(primary.id);
      const sim = new ClientCombatSimulation();
      for (const combatant of ships) sim.addShip(combatant);
      sim.update(1 / 60);
      expect(turret.currentTargetId).toBe(wounded.id);
      expect(turret.lastFiredTime).toBeDefined();
      expect(sim.projectiles.some((projectile) => projectile.ownerId === ship.id)).toBe(true);
      expect(ship.navigationTargetId).toBe(primary.id);
      expect(ship.heading).toBe(0);
      expect(ship.pos).toEqual([0, 0]);
      wounded.isAlive = healthy.isAlive = false;
      expect(acquireMountTarget(ship, turret, primary, ships, [])).toBeNull();
      expect(turret.sideTargetId).toBeUndefined();
    },
  );

  it("never adopts a torpedo side target as the navigation course on the next tick", () => {
    const ship = fixture("owner", "cruiser", 0, [0, 0]);
    const primary = fixture("primary", "carrier", 1, [0, 1000]);
    const side = fixture("side", "carrier", 1, [1000, 0]);
    const turret = ship.turrets[1];
    turret.currentTargetId = side.id;
    turret.lastFiredTime = 1;
    expect(acquireMountTarget(ship, turret, primary, [ship, primary, side], [])?.target.id).toBe(
      side.id,
    );
    expect(turret.sideTargetId).toBe(side.id);
    expect(findNavigationTarget(ship, order, [ship, primary, side], primary.id)).toBe(primary);
  });
});
