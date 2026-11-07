import { cpus } from "node:os";
import { expect, it, vi } from "vitest";
import { createSwarm } from "../bench/swarmFixture";
import { CollisionContactSolver } from "../src/engine/collisionContactSolver";
import { FighterMissionSystem } from "../src/engine/fighterMissionSystem";
import * as fireControl from "../src/engine/fireControl";
import * as flightControl from "../src/engine/flightControl";
import * as obstacleNavigation from "../src/engine/obstacleNavigation";
import { ProjectileEngine } from "../src/engine/projectileEngine";
import * as navigation from "../src/engine/shipNavigationSystem";
import { ShipWeaponSystem } from "../src/engine/shipWeaponSystem";
import { ClientCombatSimulation } from "../src/engine/simulation";

// Opt-in: timings are diagnostic, never machine-dependent pass/fail thresholds.
// SWARM_PROFILE=1 npx vitest run tests/swarmProfiling.test.ts --reporter=verbose
it.skipIf(process.env.SWARM_PROFILE !== "1")(
  "profiles 300 ticks of 100 versus 100 light craft",
  () => {
    const ticks = 300;
    const run = (corvettes: number, count = ticks) => {
      const sim = createSwarm(corvettes);
      const durations: number[] = [];
      let minAlive = 200;
      let maxProjectiles = 0;
      for (let tick = 0; tick < count; tick++) {
        const start = performance.now();
        sim.update(1 / 60);
        durations.push(performance.now() - start);
        minAlive = Math.min(minAlive, sim.ships.filter((ship) => ship.isAlive).length);
        maxProjectiles = Math.max(maxProjectiles, sim.projectiles.length);
      }
      expect(sim.timeElapsed).toBeCloseTo(count / 60, 8);
      expect(sim.ships).toHaveLength(200);
      expect(minAlive).toBe(200);
      durations.sort((a, b) => a - b);
      return {
        meanMs: durations.reduce((sum, value) => sum + value, 0) / count,
        p50Ms: durations[Math.ceil(count * 0.5) - 1],
        p95Ms: durations[Math.ceil(count * 0.95) - 1],
        maxMs: durations[count - 1],
        minAlive,
        maxProjectiles,
        state: JSON.stringify({ ships: sim.ships, projectiles: sim.projectiles, stats: sim.stats }),
      };
    };
    console.log("Environment", { node: process.version, cpu: cpus()[0].model, ticks });
    // Warm all three paths before collecting plain and instrumented comparisons.
    for (const corvettes of [0, 50, 100]) run(corvettes, 30);
    for (const corvettes of [0, 50, 100]) {
      const plain = run(corvettes);
      const totals = new Map<string, { calls: number; inclusiveMs: number; selfMs: number }>();
      const stack: { childMs: number }[] = [];
      const wrap = <Args extends unknown[], Result>(
        name: string,
        original: (...args: Args) => Result,
      ) => {
        const metric = { calls: 0, inclusiveMs: 0, selfMs: 0 };
        totals.set(name, metric);
        return function (this: unknown, ...args: Args): Result {
          const frame = { childMs: 0 };
          stack.push(frame);
          const start = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            const elapsed = performance.now() - start;
            stack.pop();
            metric.calls++;
            metric.inclusiveMs += elapsed;
            metric.selfMs += elapsed - frame.childMs;
            const parent = stack.at(-1);
            if (parent) parent.childMs += elapsed;
          }
        };
      };
      const instrument = <T extends object, K extends keyof T>(object: T, key: K, name: string) => {
        // Only callable exports/prototype methods are passed; retain their receiver.
        const original = object[key] as (...args: unknown[]) => unknown;
        const spy = vi.spyOn(object, key as never);
        spy.mockImplementation(wrap(name, original) as never);
      };
      try {
        instrument(ClientCombatSimulation.prototype, "update", "sim.update");
        instrument(navigation, "findNavigationTarget", "findNavigationTarget");
        instrument(navigation, "updateShipNavigation", "updateShipNavigation");
        instrument(flightControl, "separation", "calculateSeparation");
        instrument(obstacleNavigation, "obstacleCourseCorrection", "obstacleCourseCorrection");
        instrument(FighterMissionSystem.prototype, "ensureWings", "fighterMission.ensureWings");
        instrument(FighterMissionSystem.prototype, "updateWings", "fighterMission.updateWings");
        instrument(FighterMissionSystem.prototype, "updateCycle", "fighterMission.updateCycle");
        instrument(
          ProjectileEngine.prototype,
          "updateProjectiles",
          "projectileEngine.updateProjectiles",
        );
        instrument(
          CollisionContactSolver.prototype,
          "resolveShipCollisions",
          "collisionContactSolver.resolveShipCollisions",
        );
        instrument(
          CollisionContactSolver.prototype,
          "resolveCruiserClearance",
          "collisionContactSolver.resolveCruiserClearance",
        );
        instrument(fireControl, "acquireMountTarget", "fireControl.acquireMountTarget");
        instrument(ShipWeaponSystem.prototype, "updateTurretAim", "turretAim");
        instrument(ShipWeaponSystem.prototype, "fireWeapon", "fireWeapon");
        const profiled = run(corvettes);
        // Wrappers must not change combat decisions or outcomes.
        expect(profiled.state).toBe(plain.state);
        const { state: _plainState, ...plainSummary } = plain;
        const { state: _profiledState, ...profiledSummary } = profiled;
        console.log(
          JSON.stringify(
            {
              corvettesPerTeam: corvettes,
              fightersPerTeam: 100 - corvettes,
              plain: plainSummary,
              instrumented: profiledSummary,
              subsystems: [...totals]
                .map(([name, metric]) => ({
                  name,
                  ...metric,
                  inclusiveMsPerTick: metric.inclusiveMs / ticks,
                  selfMsPerTick: metric.selfMs / ticks,
                }))
                .sort((a, b) => b.selfMs - a.selfMs),
            },
            null,
            2,
          ),
        );
      } finally {
        vi.restoreAllMocks();
      }
    }
  },
  600_000,
);
