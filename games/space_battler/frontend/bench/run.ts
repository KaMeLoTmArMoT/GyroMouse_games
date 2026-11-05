import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import {
  assembleScenario,
  SCENARIOS,
  type ScenarioAssemblyOptions,
  type ScenarioDefinition,
  type ScenarioResult,
} from "../src/engine/scenarios";
import { ClientCombatSimulation } from "../src/engine/simulation";

const STEP = 1 / 60;
export const HARD_BATTLE_TIMEOUT = 300;

export function runScenario(
  scenario: ScenarioDefinition,
  seed?: number,
  createTelemetry = (ships: ReturnType<typeof assembleScenario>, _sim: ClientCombatSimulation) =>
    new CombatTelemetry(ships),
  assemblyOptions: ScenarioAssemblyOptions = {},
): ScenarioResult {
  const ships = assembleScenario(scenario, seed, assemblyOptions);
  const layout = structuredClone(ships);
  const sim = new ClientCombatSimulation();
  for (const ship of ships) sim.addShip(ship);
  const telemetry = createTelemetry(ships, sim);
  sim.observer = telemetry;
  const start = performance.now();
  let outcome: ScenarioResult["outcome"] = "timeout";
  const tickLimit = Math.floor(Math.min(scenario.durationLimit, HARD_BATTLE_TIMEOUT) / STEP);
  for (let tick = 0; tick < tickLimit; tick++) {
    sim.update(STEP);
    const blue = ships.some((ship) => ship.team === 0 && ship.isAlive);
    const red = ships.some((ship) => ship.team === 1 && ship.isAlive);
    if (telemetry.errors.length) {
      outcome = "invalid";
      break;
    }
    if (!blue || !red) {
      outcome = blue ? "blue" : red ? "red" : "mutual";
      break;
    }
  }
  const wallSeconds = (performance.now() - start) / 1000;
  const report = telemetry.report();
  for (const ship of ships) {
    const initial = layout.find((entry) => entry.id === ship.id);
    if (!initial) continue;
    const damage = report.damage.filter((entry) => entry.targetId === ship.id);
    for (const layer of ["shield", "armor", "hull"] as const) {
      const regenerated = layer === "shield" ? (report.shieldRegenerated[ship.id] ?? 0) : 0;
      const expected =
        initial[`${layer}Current`] +
        regenerated -
        damage.reduce((sum, event) => sum + event[layer], 0);
      if (Math.abs(expected - ship[`${layer}Current`]) > 1e-5) {
        report.errors.push(`Damage accounting mismatch: ${ship.id} ${layer}`);
      }
    }
  }
  if (report.errors.length) outcome = "invalid";
  const survivors = [0, 1].map(
    (team) => ships.filter((ship) => ship.team === team && ship.isAlive).length,
  ) as [number, number];
  const residualHpPercent = [0, 1].map((team) => {
    const initial = layout
      .filter((ship) => ship.team === team)
      .reduce((sum, ship) => sum + ship.armorMax + ship.hullMax, 0);
    const remaining = ships
      .filter((ship) => ship.team === team && ship.isAlive)
      .reduce((sum, ship) => sum + ship.armorCurrent + ship.hullCurrent, 0);
    return initial ? (100 * remaining) / initial : 0;
  }) as [number, number];
  const alerts = [
    outcome === "timeout" ? "TACTICAL STALEMATE / TIMEOUT" : "",
    report.ramProximityPairTicks > 0 ? "RAM" : "",
    report.hardPullEntries > 0 ? "OOB" : "",
    report.stalls.length > 0 ? "STALL" : "",
    (report.firstShot === null && sim.timeElapsed >= 20) || (report.firstShot ?? 0) >= 20
      ? "NO FIRE"
      : "",
    report.batteries.some((battery) => battery.eligibleSeconds >= 5 && battery.shots === 0)
      ? "BROADSIDE"
      : "",
    outcome === "invalid" ? "ERROR" : "",
  ].filter(Boolean);
  return {
    id: scenario.id,
    scenarioVersion: scenario.version,
    label: scenario.label,
    seed: seed ?? null,
    outcome,
    duration: sim.timeElapsed,
    survivors,
    residualHpPercent,
    speed: sim.timeElapsed / wallSeconds,
    layout,
    telemetry: report,
    alerts,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  let suite = "smoke";
  let scenarioId: string | undefined;
  let seed: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--suite") suite = value;
    else if (arg === "--scenario") scenarioId = value;
    else if (arg === "--seed") {
      seed = Number(value);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new Error("Seed must be a 32-bit unsigned integer");
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (suite !== "smoke" && suite !== "golden") throw new Error(`Unknown suite: ${suite}`);
  const selected = scenarioId
    ? SCENARIOS.filter((scenario) => scenario.id === scenarioId)
    : SCENARIOS.filter((scenario) => scenario.tags.includes(suite));
  if (!selected.length) throw new Error(`Unknown scenario: ${scenarioId}`);

  const suiteStart = performance.now();
  const results = selected.map((scenario) => runScenario(scenario, seed));
  const wallSeconds = (performance.now() - suiteStart) / 1000;
  const columns = ["Matchup", "Winner", "Time(s)", "Blue", "Red", "HP% B/R", "Speed", "Alerts"];
  const rows = results.map((result) => [
    result.label,
    result.outcome,
    result.duration.toFixed(1),
    String(result.survivors[0]),
    String(result.survivors[1]),
    result.residualHpPercent.map((value) => value.toFixed(1)).join("/"),
    `${result.speed.toFixed(1)}x`,
    result.alerts.map((alert) => `[${alert}]`).join(" ") || "-",
  ]);
  const widths = columns.map((column, i) =>
    Math.max(column.length, ...rows.map((row) => row[i].length)),
  );
  const format = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join(" | ");
  console.log(format(columns));
  console.log(widths.map((width) => "-".repeat(width)).join("-+-"));
  for (const row of rows) console.log(format(row));
  console.log(
    `\n${results.length} scenarios, ${wallSeconds.toFixed(2)}s wall time; HP% = surviving armor + hull / initial armor + hull.`,
  );
  const output = fileURLToPath(new URL("./results/latest.json", import.meta.url));
  mkdirSync(fileURLToPath(new URL("./results/", import.meta.url)), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        node: process.version,
        step: STEP,
        stopPolicy: "first-extinction",
        seed: seed ?? null,
        layoutAlgorithm: seed === undefined ? "nominal" : "y-jitter-lcg-v1",
        wallSeconds,
        results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Results: ${output}`);
  if (results.some((result) => result.outcome === "invalid")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--study") {
      void import("./calibrate")
        .then(({ calibrate }) => calibrate(process.argv.slice(3)))
        .catch((error) => {
          console.error(error instanceof Error ? error.message : error);
          process.exitCode = 1;
        });
    } else main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
