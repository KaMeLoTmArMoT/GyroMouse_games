import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ARENA_HARD_PULL_RADIUS } from "../src/engine/flightControl";
import { SCENARIOS, type ScenarioResult } from "../src/engine/scenarios";
import { HULL_PROFILES, projectileMaxHp } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState, ShipState, WeaponDefinition } from "../src/types/combat";
import { runScenario } from "./run";

const STEP = 1 / 60;
export const DRIFT_SEEDS = [1, 7, 29, 42] as const;
const BASELINE = new URL("./results/golden_baseline.json", import.meta.url);
const HULLS = Object.keys(HULL_PROFILES) as HullClass[];

export interface FixtureMetrics {
  gunDps: Record<string, number>;
  flakInterceptRate: number;
  shieldDelay: Record<string, number>;
  shieldRegen: Record<string, number>;
}

export interface BattleMetrics {
  id: string;
  scenarioVersion: number;
  seed: number;
  outcome: ScenarioResult["outcome"];
  duration: number;
  residualHpPercent: [number, number];
}

export interface GoldenBaseline {
  version: 1;
  step: number;
  seeds: readonly number[];
  layerA: FixtureMetrics;
  layerB: BattleMetrics[];
}

function fixtureShip(hullClass: HullClass, team = 0, x = 0): ShipState {
  const ship = buildFleetFromSlots([{ id: "fixture", hullClass, groupId: 1 }], team, x, 0)[0];
  ship.pos = [x, 0];
  ship.maxSpeed = ship.turnRate = ship.shieldRegen = 0;
  return ship;
}

function simulation(ships: ShipState[]): ClientCombatSimulation {
  const sim = new ClientCombatSimulation();
  for (const ship of ships) sim.addShip(ship);
  return sim;
}

function advance(sim: ClientCombatSimulation, seconds: number): void {
  for (let tick = 0; tick < Math.round(seconds / STEP); tick++) sim.update(STEP);
}

function missile(
  weapon: WeaponDefinition,
  id: string,
  x: number,
  y: number,
  target: ShipState,
): ProjectileState {
  return {
    id,
    weaponType: "missile",
    weapon: { ...weapon },
    damage: weapon.damage,
    ownerId: "salvo",
    ownerTeam: 1,
    pos: [x, y],
    velocity: [-weapon.projectileSpeed, 0],
    lifetime: 4,
    hp: projectileMaxHp(weapon),
    maxHp: projectileMaxHp(weapon),
    targetId: target.id,
  };
}

/** Layer A uses stationary, isolated fixtures but the real firing, impact and defense pipeline. */
export function runLayerA(): FixtureMetrics {
  const metrics: FixtureMetrics = {
    gunDps: {},
    flakInterceptRate: 0,
    shieldDelay: {},
    shieldRegen: {},
  };
  for (const hull of HULLS.filter((hull) => hull !== "corvette")) {
    const equipped = HULL_PROFILES[hull].turrets;
    for (let index = 0; index < equipped.length; index++) {
      const shooter = fixtureShip(hull);
      // Gun fixtures bypass fighter mission-phase gating while keeping the equipped weapon intact.
      shooter.hullClass = "cruiser";
      const mount = shooter.turrets[index];
      shooter.turrets = [mount];
      mount.baseArc = [-Math.PI, Math.PI];
      mount.currentLocalAngle = mount.cooldownTimer = 0;
      const target = fixtureShip("battleship", 1, Math.min(400, mount.weapon.range * 0.5));
      target.turrets = [];
      target.shieldCurrent = target.armorCurrent = 0;
      target.hullCurrent = target.hullMax = 1e7;
      const sim = simulation([shooter, target]);
      advance(sim, 10); // Fill the projectile pipeline before measuring sustained DPS.
      const before = target.hullCurrent;
      advance(sim, 120);
      metrics.gunDps[mount.id] = (before - target.hullCurrent) / 120;
      const weapon = equipped[index].weapon;
      const cycle = weapon.cooldown + (weapon.weaponType === "beam_laser" ? 1.2 : 0);
      const expected = (weapon.damage * weapon.hullMultiplier) / cycle;
      if (Math.abs(metrics.gunDps[mount.id] - expected) > expected * 0.03)
        throw new Error(
          `Layer A ${mount.id}: sustained DPS differs from the equipped profile by more than 3%`,
        );
    }
  }

  const torpedo = HULL_PROFILES.cruiser.turrets[1].weapon;
  const defender = fixtureShip("corvette");
  defender.shieldCurrent = defender.shieldMax = 1e6;
  const flakSim = simulation([defender]);
  flakSim.projectiles = Array.from({ length: 10 }, (_, i) =>
    missile(torpedo, `salvo_${i}`, 400, (i - 4.5) * 20, defender),
  );
  advance(flakSim, 4);
  metrics.flakInterceptRate = flakSim.stats[0].missilesIntercepted / 10;

  for (const hull of HULLS) {
    const target = fixtureShip(hull);
    target.turrets = [];
    const profile = HULL_PROFILES[hull];
    target.shieldRegen = profile.shieldRegen;
    const sim = simulation([target]);
    const hit = missile(torpedo, `shield_${hull}`, target.size + 1, 0, target);
    hit.damage = 30;
    sim.projectiles = [hit];
    sim.update(STEP);
    const damaged = target.shieldCurrent;
    const hitTime = sim.timeElapsed;
    for (let tick = 0; tick < 600 && target.shieldCurrent === damaged; tick++) sim.update(STEP);
    metrics.shieldDelay[hull] = sim.timeElapsed - hitTime;
    const before = target.shieldCurrent;
    advance(sim, 0.25);
    metrics.shieldRegen[hull] = (target.shieldCurrent - before) / 0.25;
  }
  return metrics;
}

/** Layer B segments the complete ordered matrix by seed; no seed averaging hides asymmetry. */
export function runLayerB(): BattleMetrics[] {
  const scenarios = SCENARIOS.filter((scenario) => scenario.tags.includes("golden"));
  if (scenarios.length !== 36 && scenarios.length !== 16) throw new Error("Layer B requires the complete matrix");
  const results: BattleMetrics[] = [];
  for (const seed of DRIFT_SEEDS) {
    const start = performance.now();
    for (const scenario of scenarios) {
      const result = runScenario(scenario, seed);
      if (result.outcome === "invalid" || result.telemetry.errors.length)
        throw new Error(`${scenario.id} seed ${seed}: ${result.telemetry.errors.join("; ")}`);
      if (
        result.alerts.includes("OOB") ||
        result.telemetry.hardPullEntries > 0 ||
        result.telemetry.shipSecondsOutsideHardPull > 0 ||
        result.telemetry.maxRadius > ARENA_HARD_PULL_RADIUS
      )
        throw new Error(`${scenario.id} seed ${seed}: containment/OOB alert`);
      results.push({
        id: result.id,
        scenarioVersion: result.scenarioVersion,
        seed,
        outcome: result.outcome,
        duration: result.duration,
        residualHpPercent: result.residualHpPercent,
      });
    }
    console.log(
      `Layer B seed ${seed}: ${scenarios.length} scenarios, ${((performance.now() - start) / 1000).toFixed(2)}s`,
    );
  }
  return results;
}

export function compareGolden(actual: GoldenBaseline, golden: GoldenBaseline): string[] {
  const failures: string[] = [];
  const check = (label: string, value: number, baseline: number, tolerance: number) => {
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(baseline) ||
      Math.abs(value - baseline) > tolerance + 1e-8
    )
      failures.push(
        `${label}: ${value.toFixed(4)} vs ${baseline?.toFixed(4)} (tolerance ${tolerance.toFixed(4)})`,
      );
  };
  if (
    golden.version !== actual.version ||
    golden.step !== STEP ||
    JSON.stringify(golden.seeds) !== JSON.stringify(DRIFT_SEEDS)
  )
    failures.push("Baseline contract differs; regenerate with bench:update-golden");
  for (const key of ["gunDps", "shieldDelay", "shieldRegen"] as const) {
    const measured = actual.layerA[key];
    const saved = golden.layerA[key];
    if (JSON.stringify(Object.keys(measured).sort()) !== JSON.stringify(Object.keys(saved).sort()))
      failures.push(`Layer A ${key}: fixture set differs`);
    for (const [id, value] of Object.entries(measured))
      check(
        `Layer A ${key} ${id}`,
        value,
        saved[id],
        key === "shieldDelay" ? STEP : Math.abs(saved[id]) * 0.03,
      );
  }
  // One missile is 10 pp: this fixed salvo must retain the same intercept count.
  check(
    "Layer A flak intercept rate",
    actual.layerA.flakInterceptRate,
    golden.layerA.flakInterceptRate,
    0,
  );
  const key = (battle: BattleMetrics) => `${battle.id} seed ${battle.seed}`;
  const saved = new Map(golden.layerB.map((battle) => [key(battle), battle]));
  if (saved.size !== actual.layerB.length || golden.layerB.length !== actual.layerB.length)
    failures.push("Layer B scenario/seed coverage differs");
  for (const battle of actual.layerB) {
    const baseline = saved.get(key(battle));
    if (!baseline) {
      failures.push(`Layer B missing ${key(battle)}`);
      continue;
    }
    if (baseline.scenarioVersion !== battle.scenarioVersion)
      failures.push(`${key(battle)}: scenario version differs`);
    check(`${key(battle)} duration`, battle.duration, baseline.duration, baseline.duration * 0.1);
    // Ordered team retention is intentional: swapping the winning faction must not pass.
    for (const team of [0, 1])
      check(
        `${key(battle)} team ${team} HP pp`,
        battle.residualHpPercent[team],
        baseline.residualHpPercent[team],
        5,
      );
  }
  return failures;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--update") || args.length > 1)
    throw new Error("Usage: tsx bench/drift.ts [--update]");
  const update = args.includes("--update");
  let golden: GoldenBaseline | undefined;
  if (!update) {
    try {
      golden = JSON.parse(readFileSync(BASELINE, "utf8")) as GoldenBaseline;
    } catch {
      throw new Error("Missing or unreadable golden baseline; run npm run bench:update-golden");
    }
  }
  const start = performance.now();
  const layerA = runLayerA();
  console.log(
    `Layer A: gun DPS, 10-missile flak salvo, shield delay/regen; ${((performance.now() - start) / 1000).toFixed(2)}s`,
  );
  if (golden) {
    const failures = compareGolden({ ...golden, layerA }, golden);
    if (failures.length) throw new Error(failures.join("\n")); // Fail fast before the battle suite.
  }
  const layerBStart = performance.now();
  const actual: GoldenBaseline = {
    version: 1,
    step: STEP,
    seeds: DRIFT_SEEDS,
    layerA,
    layerB: runLayerB(),
  };
  console.log(`Layer B total: ${((performance.now() - layerBStart) / 1000).toFixed(2)}s`);
  if (update) {
    mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`Golden baseline saved: ${fileURLToPath(BASELINE)}`);
    return;
  }
  if (!golden) throw new Error("Missing golden baseline");
  const failures = compareGolden(actual, golden);
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(
    `Drift checks passed: ${actual.layerB.length} seeded battles, duration ±10%, ordered HP ±5 pp, zero containment/OOB alerts.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
