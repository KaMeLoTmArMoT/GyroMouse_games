import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureArena } from "../src/engine/flightControl";
import { SCENARIOS, type ScenarioDefinition, type ScenarioResult } from "../src/engine/scenarios";
import { HULL_PROFILES } from "../src/engine/shipProfiles";
import { HARD_BATTLE_TIMEOUT, runScenario } from "./run";
import { StudyMetrics } from "./studyMetrics";

interface Profile {
  id: string;
  arena: number;
  spawn: number;
  turn: number;
  hp: number;
  regen: number;
  beam: number;
  rail: number;
  scaled: boolean;
  speed?: number;
  spacing?: boolean;
  sizes?: boolean;
  hardPull?: number;
  shield?: number;
  armor?: number;
  hull?: number;
}

const baseline: Profile = {
  id: "baseline",
  arena: 1350,
  spawn: 800,
  turn: 0.75,
  hp: 1,
  regen: 40,
  beam: 65,
  rail: 260,
  scaled: false,
};
const a: Profile = {
  id: "A",
  arena: 2200,
  spawn: 1300,
  turn: 0.35,
  hp: 1.25,
  regen: 60,
  beam: 65,
  rail: 260,
  scaled: true,
};
const b: Profile = {
  id: "B",
  arena: 2800,
  spawn: 1600,
  turn: 0.25,
  hp: 1.4,
  regen: 70,
  beam: 85,
  rail: 320,
  scaled: true,
};
const c: Profile = {
  id: "C",
  arena: 3200,
  spawn: 2000,
  turn: 0.18,
  hp: 1.6,
  regen: 80,
  beam: 100,
  rail: 260,
  scaled: true,
};
const d: Profile = { ...b, id: "D", spawn: 1000, hp: 1.25, regen: 40, turn: 0.5, spacing: true };
const seeds: Array<number | undefined> = [undefined, 1, 7, 42, 2026, 0xffffffff];
const focused: Profile = {
  id: "focused",
  arena: 1900,
  hardPull: 2200,
  spawn: 1100,
  turn: 0.5,
  hp: 1,
  shield: 2200,
  armor: 2000,
  hull: 2800,
  regen: 50,
  beam: 75,
  rail: 300,
  scaled: false,
};

function applyProfile(profile: Profile): void {
  configureArena(profile.arena, profile.hardPull ?? profile.arena + 200);
  const battleship = HULL_PROFILES.battleship;
  battleship.turnRate = profile.turn;
  battleship.shieldRegen = profile.regen;
  for (const layer of ["shield", "armor", "hull"] as const) {
    battleship[`${layer}Max`] = profile[layer] ?? battleship[`${layer}Max`] * profile.hp;
  }
  for (const mount of battleship.turrets) {
    if (mount.weapon.weaponType === "beam_laser") mount.weapon.damage = profile.beam;
    if (mount.weapon.weaponType === "railgun") mount.weapon.damage = profile.rail;
  }
  if (profile.scaled) {
    HULL_PROFILES.cruiser.turnRate = 0.65;
    HULL_PROFILES.corvette.turnRate = 1.5;
    if (profile.sizes !== false) {
      HULL_PROFILES.battleship.size = 105;
      HULL_PROFILES.cruiser.size = 48;
      HULL_PROFILES.corvette.size = 22;
    }
  }
  for (const hull of Object.values(HULL_PROFILES)) {
    hull.speed *= profile.speed ?? 1;
    hull.turnRateDisplay = `${hull.turnRate.toFixed(2)} rad/s`;
  }
}

function worker(profile: Profile, mode: string, output: string): void {
  // Each worker owns a fresh module graph; overrides never affect the source files.
  applyProfile(profile);
  const started = performance.now();
  const bb: ScenarioDefinition["blue"] = [{ hullClass: "battleship", count: 1, groupId: 1 }];
  const extra = (id: string, red: ScenarioDefinition["red"]): ScenarioDefinition => ({
    id,
    label: id,
    version: 1,
    tags: ["study"],
    blue: bb,
    red,
    durationLimit: 180,
    expectations: [],
  });
  const scenarios = [
    ...SCENARIOS.filter(
      (s) => s.tags.includes("golden") || s.tags.includes("curated") || s.id === "1bb-vs-27sc",
    ),
    extra("1bb-vs-3cv", [{ hullClass: "corvette", count: 3, groupId: 1 }]),
    extra("1bb-vs-needle", SCENARIOS.find((s) => s.id === "needle_cloud")!.red),
  ];
  const selected =
    mode === "focused"
      ? SCENARIOS.filter((s) => s.tags.includes("golden") || s.tags.includes("curated"))
      : mode === "matrix" || mode === "holdout"
        ? scenarios
        : scenarios.filter((s) =>
            [
              "3bb-vs-3bb",
              "1bb-vs-3cr",
              "1bb-vs-27sc",
              "1bb-vs-3cv",
              "1bb-vs-needle",
              "combined",
              "split_spear",
              "glass_hammer",
            ].includes(s.id),
          );
  const selectedSeeds =
    mode === "focused"
      ? [1, 7, 42, 2026]
      : mode === "holdout"
        ? Array.from({ length: 10 }, (_, i) => 100 + i)
        : seeds;
  const results: Array<ScenarioResult & { study: ReturnType<StudyMetrics["summary"]> }> = [];
  const prior =
    mode === "extended"
      ? (JSON.parse(readFileSync(resolve(output, "..", `matrix-${profile.id}.json`), "utf8"))
          .results as Array<{ id: string; seed: number | null; outcome: string }>)
      : [];
  for (const scenario of selected) {
    for (const seed of selectedSeeds) {
      if (
        mode === "extended" &&
        !prior.some(
          (r) => r.id === scenario.id && r.seed === (seed ?? null) && r.outcome === "timeout",
        )
      )
        continue;
      let metrics: StudyMetrics | undefined;
      const result = runScenario(
        {
          ...scenario,
          durationLimit: mode === "extended" || mode === "focused" ? HARD_BATTLE_TIMEOUT : 180,
        },
        seed,
        (ships, sim) => {
          metrics = new StudyMetrics(ships, sim);
          if (mode === "focused" && metrics.spawnPairs.some((pair) => pair.bubbleGap < 0))
            throw new Error(`Spawn shield overlap: ${scenario.id}@${seed}`);
          return metrics;
        },
        { spawn: profile.spawn, expandedSpacing: profile.spacing },
      );
      const study = metrics!.summary();
      if (study.spawnShieldOverlaps > 0) result.alerts.push("SPAWN OVERLAP");
      results.push({ ...result, study });
    }
  }
  const gates = {
    expectedRuns: results.length === 88,
    zeroHardErrors: results.every(
      (r) => r.outcome !== "invalid" && r.telemetry.errors.length === 0,
    ),
    timeoutsBelowFivePercent:
      results.filter((r) => r.outcome === "timeout").length / results.length < 0.05,
    openingShotsInBand: results.every(
      (r) =>
        r.telemetry.firstShot !== null && r.telemetry.firstShot >= 9 && r.telemetry.firstShot <= 14,
    ),
    zeroSpawnOverlaps: results.every((r) => r.study.spawnShieldOverlaps === 0),
  };
  const wallSeconds = (performance.now() - started) / 1000;
  writeFileSync(
    output,
    JSON.stringify({
      profile,
      mode,
      seeds: selectedSeeds.map((s) => s ?? null),
      step: 1 / 60,
      hardBattleTimeout: HARD_BATTLE_TIMEOUT,
      wallSeconds,
      gates: mode === "focused" ? gates : undefined,
      results,
    }),
  );
  if (mode === "focused") {
    const range = (values: number[]) => ({
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    });
    const shots = results.flatMap((r) =>
      r.telemetry.firstShot === null ? [] : [r.telemetry.firstShot],
    );
    const summary = {
      runs: results.length,
      wallSeconds,
      gates,
      timeouts: results.filter((r) => r.outcome === "timeout").length,
      hardErrors: results.flatMap((r) => r.telemetry.errors),
      spawnOverlapRuns: results.filter((r) => r.study.spawnShieldOverlaps > 0).length,
      minimumSpawnShieldGap: Math.min(
        ...results.flatMap((r) =>
          r.study.minimumSpawnShieldGap === null ? [] : [r.study.minimumSpawnShieldGap],
        ),
      ),
      openingShots: range(shots),
      openingShotsInBand: shots.filter((shot) => shot >= 9 && shot <= 14).length,
      missingOpeningShots: results.length - shots.length,
      durations: range(results.map((r) => r.duration)),
      effectiveShips: Object.fromEntries(
        results
          .flatMap((r) => r.layout)
          .map((ship) => [
            ship.hullClass,
            {
              size: ship.size,
              turnRate: ship.turnRate,
              maxSpeed: ship.maxSpeed,
              shield: ship.shieldMax,
              regen: ship.shieldRegen,
              armor: ship.armorMax,
              hull: ship.hullMax,
              weapons: ship.turrets.map((mount) => ({
                name: mount.weapon.name,
                damage: mount.weapon.damage,
                range: mount.weapon.range,
                cooldown: mount.weapon.cooldown,
              })),
            },
          ]),
      ),
      matchups: selected.map((scenario) => {
        const runs = results.filter((r) => r.id === scenario.id);
        return {
          id: scenario.id,
          outcomes: runs.map((r) => r.outcome),
          duration: range(runs.map((r) => r.duration)),
          firstShot: range(
            runs.flatMap((r) => (r.telemetry.firstShot === null ? [] : [r.telemetry.firstShot])),
          ),
        };
      }),
    };
    writeFileSync(resolve(output, "..", "focused-summary.json"), JSON.stringify(summary, null, 2));
  }
  const outcomes: Record<string, number> = {};
  const alerts: Record<string, number> = {};
  for (const result of results) {
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    for (const alert of result.alerts) alerts[alert] = (alerts[alert] ?? 0) + 1;
  }
  console.log(
    JSON.stringify({
      profile: profile.id,
      mode,
      runs: results.length,
      wallSeconds,
      outcomes,
      alerts,
      gates: mode === "focused" ? gates : undefined,
    }),
  );
  if (results.some((r) => r.outcome === "invalid")) throw new Error("Invalid simulation result");
}

export async function calibrate(args: string[]): Promise<void> {
  const mode = args[0] ?? "focused";
  if (!["focused", "matrix", "sensitivity", "extended", "holdout", "refinement"].includes(mode))
    throw new Error(`Unknown study mode: ${mode}`);
  const profiles =
    mode === "focused"
      ? [focused]
      : mode === "matrix"
        ? [baseline, a, b, c]
        : mode === "extended"
          ? [baseline, a, b, c]
          : mode === "refinement"
            ? [d, { ...d, id: "E", hp: 1.4, beam: 95, speed: 1.5 }]
            : mode === "sensitivity"
              ? [
                  { ...b, id: "B-spawn1000", spawn: 1000 },
                  { ...b, id: "B-spawn1150", spawn: 1150 },
                  { ...b, id: "B-speed1.5", speed: 1.5 },
                  { ...b, id: "B-turn035", turn: 0.35 },
                  { ...b, id: "B-baseSize", sizes: false },
                  { ...b, id: "B-regen40", regen: 40 },
                  { ...b, id: "B-hp125", hp: 1.25 },
                  { ...b, id: "B-spacing", spacing: true },
                  { ...b, id: "B-turn05", turn: 0.5 },
                ]
              : [baseline, d];
  const root = fileURLToPath(new URL("../", import.meta.url));
  const destination = resolve(root, "bench/results/grand-scale");
  mkdirSync(destination, { recursive: true });
  const files = [
    "shipProfiles.ts",
    "fleetBuilder.ts",
    "simulation.ts",
    "scenarios.ts",
    "flightControl.ts",
    "fireControl.ts",
    "combatTelemetry.ts",
    "fleetPresets.ts",
    "math2d.ts",
  ];
  const hashes = Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(resolve(root, "src/engine", file)))
        .digest("hex"),
    ]),
  );
  const benchHashes = Object.fromEntries(
    ["run.ts", "studyMetrics.ts", "calibrate.ts"].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(resolve(root, "bench", file)))
        .digest("hex"),
    ]),
  );
  writeFileSync(
    resolve(destination, `${mode}-manifest.json`),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        node: process.version,
        hashes,
        benchHashes,
        hardBattleTimeout: HARD_BATTLE_TIMEOUT,
        layoutAlgorithm: "shield-aware-columns-v2+y-jitter-lcg-v1",
        profiles,
      },
      null,
      2,
    ),
  );
  for (const profile of profiles) {
    // Separate module graph per profile: arena constants affect both motion and telemetry.
    const snapshot = resolve(destination, "snapshots", profile.id);
    mkdirSync(resolve(snapshot, "bench"), { recursive: true });
    cpSync(resolve(root, "src/engine"), resolve(snapshot, "src/engine"), { recursive: true });
    cpSync(resolve(root, "src/types"), resolve(snapshot, "src/types"), { recursive: true });
    for (const file of ["run.ts", "studyMetrics.ts", "calibrate.ts"])
      cpSync(resolve(root, "bench", file), resolve(snapshot, "bench", file));
    writeFileSync(resolve(snapshot, "package.json"), '{"type":"module"}');
    const child = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/tsx/dist/cli.mjs"),
        resolve(snapshot, "bench/calibrate.ts"),
        "worker",
        JSON.stringify(profile),
        mode,
        resolve(destination, `${mode}-${profile.id}.json`),
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    if (child.stdout) console.log(child.stdout.trim());
    if (child.status !== 0) throw new Error(child.stderr || `Study worker exited ${child.status}`);
  }
  console.log(`Study evidence: ${destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "worker")
    worker(JSON.parse(process.argv[3]) as Profile, process.argv[4], process.argv[5]);
  else await calibrate(process.argv.slice(2));
}
