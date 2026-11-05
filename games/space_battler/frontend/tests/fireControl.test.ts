import { describe, expect, it } from "vitest";
import { acquireMountTarget, inMountArc, slewTurret } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState } from "../src/types/combat";

describe("missile saturation", () => {
  function fixture(hullClass: HullClass, team = 1, id = "target") {
    const ship = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
    ship.id = `${team}_${id}`;
    ship.pos = team === 0 ? [0, 0] : [300, 0];
    ship.velocity = [0, 0];
    ship.maxSpeed = ship.turnRate = 0;
    return ship;
  }

  it.each([
    ["strike_craft", 2, false],
    ["strike_craft", 1, true],
    ["corvette", 6, false],
    ["corvette", 2, true],
    ["cruiser", 14, false],
  ] as const)("retargets saturated %s with %i missiles (heavy: %s)", (hull, count, heavy) => {
    const owner = fixture("missile_frigate", 0);
    const turret = owner.turrets[0];
    turret.weapon.projectileHp = heavy ? 120 : 25;
    const target = fixture(hull);
    const alternate = fixture(hull, 1, "alternate");
    alternate.pos = [350, 0];
    const missiles: ProjectileState[] = Array.from({ length: count }, (_, i) => ({
      id: `missile_${i}`,
      weaponType: "missile",
      weapon: turret.weapon,
      ownerId: owner.id,
      ownerTeam: 0,
      targetId: target.id,
      pos: [100, 0],
      velocity: [100, 0],
      lifetime: 5,
      hp: heavy ? 120 : 25,
      maxHp: heavy ? 120 : 25,
      damage: 10,
    }));
    turret.currentTargetId = target.id;
    turret.currentTargetKind = "ship";
    expect(
      acquireMountTarget(owner, turret, target, [target, alternate], missiles)?.target.id,
    ).toBe(alternate.id);
    expect(acquireMountTarget(owner, turret, target, [target], missiles)).toBeNull();
    missiles[0].hp = 0;
    expect(acquireMountTarget(owner, turret, target, [target], missiles)?.target.id).toBe(
      target.id,
    );
    missiles[0].hp = 25;
    missiles[0].lifetime = 0;
    expect(acquireMountTarget(owner, turret, target, [target], missiles)?.target.id).toBe(
      target.id,
    );
  });

  it.each(["battleship", "dreadnought"] as const)("does not cap %s", (hull) => {
    const owner = fixture("missile_frigate", 0);
    const target = fixture(hull);
    const turret = owner.turrets[0];
    const locks = Array.from({ length: 100 }, () => ({
      targetId: target.id,
      weapon: turret.weapon,
    }));
    expect(acquireMountTarget(owner, turret, target, [target], [], locks)?.target.id).toBe(
      target.id,
    );
  });

  it("shares same-tick reservations across frigates and tubes", () => {
    const owners = [fixture("missile_frigate", 0, "one"), fixture("missile_frigate", 0, "two")];
    for (const owner of owners) {
      for (const turret of owner.turrets) {
        turret.offset = [0, 0];
        turret.currentLocalAngle = 0;
        turret.cooldownTimer = 0;
      }
    }
    const target = fixture("strike_craft");
    const alternate = fixture("corvette", 1, "alternate");
    alternate.pos = [350, 0];
    target.turrets = alternate.turrets = [];
    target.hullCurrent = 1;
    const sim = new ClientCombatSimulation();
    for (const ship of [...owners, target, alternate]) sim.addShip(ship);
    sim.update(1 / 60);
    expect(sim.projectiles.filter((p) => p.targetId === target.id)).toHaveLength(2);
    expect(sim.projectiles.filter((p) => p.targetId === alternate.id)).toHaveLength(6);
  });
});

function battleship(team = 0) {
  return buildFleetFromSlots(
    [{ id: "0", hullClass: "battleship", groupId: team + 1 }],
    team,
    0,
    0,
  )[0];
}

describe("predictive turret slewing", () => {
  it("pre-slews an off-arc broadside mount toward the active enemy without firing", () => {
    const ship = battleship();
    const enemy = battleship(1);
    enemy.pos = [500, -20];
    for (const combatant of [ship, enemy]) {
      combatant.maxSpeed = 0;
      combatant.turnRate = 0;
    }
    const turret = ship.turrets[1];
    ship.turrets = [turret];
    enemy.turrets = [];
    const initial = turret.currentLocalAngle;
    expect(inMountArc(ship, turret, enemy.pos)).toBe(false);
    const sim = new ClientCombatSimulation();
    sim.addShip(ship);
    sim.addShip(enemy);
    sim.update(1 / 60);
    expect(turret.currentLocalAngle).toBeGreaterThan(initial);
    expect(turret.currentLocalAngle - initial).toBeLessThanOrEqual(
      turret.trackingSpeed / 60 + 1e-9,
    );
    for (let i = 0; i < 300; i++) sim.update(1 / 60);
    expect(turret.currentLocalAngle).toBeCloseTo(turret.baseArc[1]);
    expect(turret.currentTargetId).toBeNull();
    expect(sim.projectiles).toHaveLength(0);
  });

  it("keeps the nearest rear sector boundary across the angle wrap", () => {
    const turret = battleship().turrets[1];
    slewTurret(turret, -Math.PI + 0.01, 10);
    expect(turret.currentLocalAngle).toBe(turret.baseArc[0]);
    slewTurret(turret, Math.PI - 0.01, 1 / 60);
    expect(turret.currentLocalAngle).toBe(turret.baseArc[0]);
  });

  it("takes the shortest permitted path without crossing sector limits", () => {
    const turret = battleship().turrets[0];
    turret.baseArc = [-2.5, 2.5];
    turret.currentLocalAngle = -2.4;
    slewTurret(turret, 2.4, 1 / 60);
    expect(turret.currentLocalAngle).toBeGreaterThan(-2.4);
    expect(turret.currentLocalAngle).toBeLessThanOrEqual(turret.baseArc[1]);
    turret.baseArc = [-Math.PI, Math.PI];
    turret.currentLocalAngle = Math.PI - 0.01;
    slewTurret(turret, -Math.PI + 0.01, 1);
    expect(turret.currentLocalAngle).toBeCloseTo(-Math.PI + 0.01);
  });
});
