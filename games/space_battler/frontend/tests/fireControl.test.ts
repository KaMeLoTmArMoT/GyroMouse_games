import { describe, expect, it } from "vitest";
import { inMountArc, slewTurret } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";

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
