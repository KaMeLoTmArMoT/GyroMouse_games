// Run from frontend: npx tsx bench/archetypes.ts [--output path] [--compare prior-results.json]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { ARENA_RADIUS } from "../src/engine/arenaBoundary";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { HULL_PROFILES, instantiateTurrets } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import { SimulationPresentationMetadataPacker } from "../src/engine/simulationPresentationMetadata";
import {
  packSimulationSnapshot,
  prepareSimulationSnapshotBuffer,
  SIMULATION_SNAPSHOT_BYTE_LENGTH,
} from "../src/engine/simulationWorkerProtocol";
import type { HullClass, ProjectileState } from "../src/types/combat";
import { createProfiler, type Metric, startNativeSampler } from "./archetypeProfiler";

const dt = 1 / 60;
const warmupTicks = 60;
const measurementTicks = 80;
type Composition = Array<[HullClass, number]>;
const scenarios: Array<{
  name: string;
  teams: [Composition, Composition];
  missileCopies: number;
  spacing: number;
}> = [
  {
    name: "A-massive-swarm",
    teams: [
      [
        ["strike_craft", 200],
        ["corvette", 17],
      ],
      [["strike_craft", 250]],
    ],
    missileCopies: 1,
    spacing: 50,
  },
  {
    name: "B-heavy-capital-line",
    teams: [
      [
        ["dreadnought", 50],
        ["battleship", 50],
      ],
      [
        ["dreadnought", 50],
        ["battleship", 50],
      ],
    ],
    missileCopies: 1,
    spacing: 260,
  },
  {
    name: "C-ordnance-saturation",
    teams: [[["missile_frigate", 100]], [["missile_frigate", 100]]],
    missileCopies: 4,
    spacing: 90,
  },
];

function fixture(scenario: (typeof scenarios)[number], Simulation = ClientCombatSimulation) {
  const sim = new Simulation();
  scenario.teams.forEach((composition, team) => {
    let index = 0;
    for (const [hullClass, count] of composition) {
      // Build one stock template; avoid the fleet builder's unbounded packing search at extreme density.
      const template = buildFleetFromSlots(
        [{ id: "template", hullClass, groupId: 1 }],
        team,
        0,
        team ? Math.PI : 0,
      )[0];
      for (let i = 0; i < count; i++, index++) {
        const ship = structuredClone(template);
        ship.id = `${team}_${hullClass}_${i}`;
        ship.groupId = 1 + Math.floor(index / 8);
        ship.turrets = instantiateTurrets(HULL_PROFILES[hullClass], ship.id, i);
        const width = scenario.name.startsWith("A") ? 14 : 10;
        const height = Math.ceil(composition.reduce((sum, [, n]) => sum + n, 0) / width);
        const x = 150 + (index % width) * scenario.spacing;
        const y = (Math.floor(index / width) - (height - 1) / 2) * scenario.spacing;
        const radius = ARENA_RADIUS - shieldEnvelopeRadius(ship) - 25;
        const scale = Math.min(1, radius / Math.hypot(x, y));
        ship.pos = [(team ? 1 : -1) * x * scale, y * scale];
        const profile = HULL_PROFILES[hullClass];
        for (const [field, expected] of Object.entries({
          hullMax: profile.hullMax,
          hullCurrent: profile.hullMax,
          armorMax: profile.armorMax,
          armorCurrent: profile.armorMax,
          shieldMax: profile.shieldMax,
          shieldCurrent: profile.shieldMax,
          maxSpeed: profile.speed,
          turnRate: profile.turnRate,
          size: profile.size,
        }))
          assert.equal(ship[field as keyof typeof ship], expected);
        sim.addShip(ship);
      }
    }
  });
  assert.equal(
    sim.ships.length,
    scenario.teams.flat().reduce((sum, [, count]) => sum + count, 0),
  );
  assert.equal(new Set(sim.ships.map((ship) => ship.id)).size, sim.ships.length);
  let initialEnvelopeOverlaps = 0;
  for (let i = 0; i < sim.ships.length; i++)
    for (let j = i + 1; j < sim.ships.length; j++) {
      const a = sim.ships[i],
        b = sim.ships[j];
      if (
        Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) <
        shieldEnvelopeRadius(a) + shieldEnvelopeRadius(b)
      )
        initialEnvelopeOverlaps++;
    }
  return { sim, initialEnvelopeOverlaps };
}

function summary(values: number[]) {
  assert(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const meanMs = values.reduce((sum, n) => sum + n, 0) / values.length;
  return {
    meanMs,
    p50Ms: sorted[Math.ceil(values.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(values.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    rtf: (dt * 1000) / meanMs,
  };
}

async function run(
  scenario: (typeof scenarios)[number],
  profiler?: ReturnType<typeof createProfiler>,
) {
  const { sim, initialEnvelopeOverlaps } = fixture(scenario, profiler?.Simulation);
  const expanded = new WeakSet<ProjectileState>();
  const inject = () => {
    if (scenario.missileCopies === 1) return;
    for (const missile of [...sim.projectiles]) {
      if (missile.weaponType !== "missile" || expanded.has(missile)) continue;
      expanded.add(missile);
      for (let copy = 1; copy < scenario.missileCopies; copy++) {
        const extra = structuredClone(missile);
        extra.id = `${missile.id}_density_${copy}`;
        expanded.add(extra);
        sim.projectiles.push(extra);
      }
    }
  };
  for (let tick = 0; tick < warmupTicks; tick++) {
    inject();
    sim.update(dt);
  }
  const buffer = new ArrayBuffer(SIMULATION_SNAPSHOT_BYTE_LENGTH);
  prepareSimulationSnapshotBuffer(buffer);
  const metadata = new SimulationPresentationMetadataPacker();
  metadata.pack(sim); // Prime entity-definition tracking just as a live worker does.
  const durations: number[] = [],
    pack: number[] = [],
    presentation: number[] = [],
    clone: number[] = [];
  const totals: Record<string, Metric> = {};
  const trace: Array<{
    tick: number;
    ms: number;
    alive: number;
    projectiles: number;
    missiles: number;
  }> = [];
  const stopSampler = profiler ? undefined : await startNativeSampler();
  for (let tick = 0; tick < measurementTicks; tick++) {
    inject(); // Fixture injection cost is excluded from simulation timings.
    profiler?.reset();
    const start = performance.now();
    sim.update(dt);
    const durationMs = performance.now() - start;
    durations.push(durationMs);
    for (const [name, metric] of Object.entries(profiler?.metrics() ?? {})) {
      totals[name] ??= { calls: 0, inclusiveMs: 0, selfMs: 0 };
      const total = totals[name];
      total.calls += metric.calls;
      total.inclusiveMs += metric.inclusiveMs;
      total.selfMs += metric.selfMs;
    }
    if (!profiler) {
      let start = performance.now();
      const { byteLength } = packSimulationSnapshot(sim, buffer);
      pack.push(performance.now() - start);
      start = performance.now();
      const payload = metadata.pack(sim);
      presentation.push(performance.now() - start);
      start = performance.now();
      // Approximate the structured-cloned sidecar in postMessage; binary buffer is transferred, not cloned.
      structuredClone({
        type: "SNAPSHOT",
        epoch: 1,
        byteLength,
        presentation: payload,
        stepDurationMs: durations.at(-1),
        sentAtMs: performance.timeOrigin + performance.now(),
      });
      clone.push(performance.now() - start);
    }
    trace.push({
      tick: warmupTicks + tick + 1,
      ms: durationMs,
      alive: sim.ships.filter((s) => s.isAlive && !s.isDebris && !s.isDocked).length,
      projectiles: sim.projectiles.length,
      missiles: sim.projectiles.filter((p) => p.weaponType === "missile").length,
    });
  }
  const nativeSampling = await stopSampler?.();
  assert(Math.abs(sim.timeElapsed - (warmupTicks + measurementTicks) * dt) < 1e-8);
  const stateHash = createHash("sha256")
    .update(
      JSON.stringify({
        ships: sim.ships,
        projectiles: sim.projectiles,
        beams: sim.activeBeams,
        stats: sim.stats,
        time: sim.timeElapsed,
      }),
    )
    .digest("hex");
  const worker = profiler
    ? undefined
    : {
        binaryPack: summary(pack),
        presentationPack: summary(presentation),
        sidecarCloneProxy: summary(clone),
        combined: summary(durations.map((ms, i) => ms + pack[i] + presentation[i] + clone[i])),
        bufferBytes: buffer.byteLength,
      };
  return {
    simulation: summary(durations),
    worker,
    nativeSampling,
    stateHash,
    initialEnvelopeOverlaps,
    minAlive: Math.min(...trace.map((t) => t.alive)),
    maxProjectiles: Math.max(...trace.map((t) => t.projectiles)),
    maxMissiles: Math.max(...trace.map((t) => t.missiles)),
    trace,
    subsystems: Object.entries(totals)
      .map(([name, m]) => ({
        name,
        callsPerTick: m.calls / measurementTicks,
        inclusiveMsPerTick: m.inclusiveMs / measurementTicks,
        selfMsPerTick: m.selfMs / measurementTicks,
      }))
      .sort((a, b) => b.selfMsPerTick - a.selfMsPerTick),
  };
}

const args = process.argv.slice(2);
assert(
  args.length % 2 === 0 &&
    args.every((arg, index) => index % 2 !== 0 || arg === "--output" || arg === "--compare"),
  "Usage: tsx bench/archetypes.ts [--output path] [--compare prior-results.json]",
);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  assert(!options.has(args[index]), `Duplicate option: ${args[index]}`);
  options.set(args[index], args[index + 1]);
}
const comparisonPath = options.get("--compare");
const previous = comparisonPath
  ? (JSON.parse(readFileSync(comparisonPath, "utf8")) as {
      environment: { dt: number; warmupTicks: number; measurementTicks: number };
      results: Array<{ scenario: (typeof scenarios)[number]; baseline: { stateHash: string } }>;
    })
  : undefined;
if (previous) {
  assert.equal(previous.environment.dt, dt);
  assert.equal(previous.environment.warmupTicks, warmupTicks);
  assert.equal(previous.environment.measurementTicks, measurementTicks);
  assert.deepEqual(
    previous.results.map((result) => result.scenario),
    scenarios,
  );
}
const profiler = createProfiler();
const plain = createProfiler(false);
const results = [];
for (const scenario of scenarios) {
  console.log(`Running ${scenario.name}`);
  const baseline = await run(scenario);
  if (previous)
    assert.equal(
      baseline.stateHash,
      previous.results.find((result) => result.scenario.name === scenario.name)?.baseline.stateHash,
      `${scenario.name}: optimization changed combat outcome`,
    );
  const control = await run(scenario, plain);
  const profile = await run(scenario, profiler);
  assert.equal(
    control.stateHash,
    baseline.stateHash,
    `${scenario.name}: transpilation changed combat outcome`,
  );
  assert.equal(
    profile.stateHash,
    baseline.stateHash,
    `${scenario.name}: instrumentation changed combat outcome`,
  );
  console.log(
    JSON.stringify(
      {
        name: scenario.name,
        simulation: baseline.simulation,
        worker: baseline.worker,
        initialEnvelopeOverlaps: baseline.initialEnvelopeOverlaps,
        minAlive: baseline.minAlive,
        maxMissiles: baseline.maxMissiles,
        nativeSampling: baseline.nativeSampling?.subsystemInclusive.slice(0, 8),
        transpilationControl: control.simulation,
        requestedSubsystems: profile.subsystems.filter((s) =>
          [
            "flightBehaviors.calculateSeparation",
            "wasmHotLoops.findProjectileShipHitWasm",
            "fireControl.sweptHit",
            "fireControl.acquireMountTarget",
            "projectileEngine.detonateFlak",
            "collisionContactSolver.resolveShipCollisions",
          ].includes(s.name),
        ),
        topSelf: profile.subsystems.slice(0, 8),
      },
      null,
      2,
    ),
  );
  results.push({
    scenario,
    baseline,
    transpilationControl: { simulation: control.simulation, stateHash: control.stateHash },
    profile,
    stateEquality: true,
  });
}
const report = {
  comparisonPath,
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: process.platform,
    dt,
    warmupTicks,
    measurementTicks,
  },
  results,
};
const outputPath = options.get("--output");
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
