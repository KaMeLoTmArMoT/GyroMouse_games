// Read-only Wave 15B diagnostics. Run: npx tsx bench/wave15bProfile.ts
// Source instrumentation is transpiled IN MEMORY; no production files are written.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Frontend TS 7 is native-only; the repository's existing TS 5 compiler exposes AST transforms.
import ts from "../../../../node_modules/typescript/lib/typescript.js";
import * as nativeBuilder from "../src/engine/fleetBuilder";
import * as nativeGeometry from "../src/engine/shieldGeometry";
import * as nativeProfiles from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState } from "../src/types/combat";

const benchDir = dirname(fileURLToPath(import.meta.url));
const engineDir = resolve(benchDir, "../src/engine");
const ticks = 300;
const dt = 1 / 60;
const args = process.argv.slice(2);
const scaleIndex = args.indexOf("--scale");
const scale = scaleIndex === -1 ? "170v170" : args[scaleIndex + 1];
assert(scale === "170v170" || scale === "200v200", "--scale must be 170v170 or 200v200");
if (scaleIndex !== -1) args.splice(scaleIndex, 2);
const mode = args[0] ?? "baseline";
assert(args.length <= 1 && ["baseline", "profile", "census", "cpu", "plain"].includes(mode));
const composition: [HullClass, number][] =
  scale === "200v200"
    ? [
        ["carrier", 4],
        ["dreadnought", 6],
        ["battleship", 10],
        ["cruiser", 28],
        ["missile_frigate", 38],
        ["tender", 4],
        ["corvette", 52],
        ["strike_craft", 58],
      ]
    : [
        ["carrier", 4],
        ["dreadnought", 6],
        ["battleship", 8],
        ["cruiser", 24],
        ["missile_frigate", 32],
        ["corvette", 48],
        ["strike_craft", 48],
      ];
const reportPrefix = scale === "170v170" ? "wave15b" : `wave15b.${scale}`;
type Engine = {
  Simulation: typeof ClientCombatSimulation;
  builder: typeof nativeBuilder;
  profiles: typeof nativeProfiles;
  geometry: typeof nativeGeometry;
};
const native: Engine = {
  Simulation: ClientCombatSimulation,
  builder: nativeBuilder,
  profiles: nativeProfiles,
  geometry: nativeGeometry,
};

function createFleet(engine: Engine) {
  const sim = new engine.Simulation();
  for (const team of [0, 1]) {
    const placed: ShipState[] = [];
    for (const [hullClass, count] of composition) {
      const template = engine.builder.buildFleetFromSlots(
        [{ id: "template", hullClass, groupId: 1 }],
        team,
        0,
        team ? Math.PI : 0,
      )[0];
      for (let i = 0; i < count; i++) {
        const ship = structuredClone(template);
        ship.id = `${team ? "red" : "blue"}_${hullClass}_${i}`;
        ship.groupId = 1 + Math.floor(i / 8);
        ship.turrets = engine.profiles.instantiateTurrets(
          engine.profiles.HULL_PROFILES[hullClass],
          ship.id,
          i,
        );
        const radius = engine.geometry.shieldEnvelopeRadius(ship);
        // Only initial placement changes: stock envelopes, stock arena, zero overlaps.
        let position: [number, number] | undefined;
        for (
          let x = engine.geometry.isCapitalShip(ship) ? 460 : 160;
          x <= 1710 && !position;
          x += 50
        ) {
          for (let row = 0; row <= 66; row++) {
            const y = Math.ceil(row / 2) * 50 * (row % 2 ? 1 : -1);
            if (Math.hypot(x, y) + radius + 25 > 1900) continue;
            if (
              placed.some(
                (peer) =>
                  Math.hypot(x - Math.abs(peer.pos[0]), y - peer.pos[1]) <=
                  radius + engine.geometry.shieldEnvelopeRadius(peer) + 20,
              )
            )
              continue;
            position = [team ? x : -x, y];
            break;
          }
        }
        assert(position, `No room for ${ship.id}`);
        ship.pos = position;
        placed.push(ship);
      }
    }
    const capitals = placed.filter(engine.geometry.isCapitalShip);
    placed
      .filter((ship) => ship.hullClass === "corvette")
      .forEach((ship, i) => {
        ship.flagshipId = capitals[i % capitals.length].id;
      });
    for (const ship of placed) sim.addShip(ship);
  }
  assert.equal(sim.ships.length, scale === "200v200" ? 400 : 340);
  for (const ship of sim.ships) {
    const profile = engine.profiles.HULL_PROFILES[ship.hullClass];
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
      assert.equal(ship[field as keyof ShipState], expected);
  }
  return sim;
}

type Metric = { calls: number; inclusiveMs: number; selfMs: number };
type Frame = { name: string; start: number; childMs: number };
let tickMetrics: Record<string, Metric> = {};
let census: Record<string, number> = {};
const stack: Frame[] = [];
const hooks = {
  enter(name: string): Frame {
    const frame = { name, start: performance.now(), childMs: 0 };
    stack.push(frame);
    return frame;
  },
  exit(frame: Frame) {
    const elapsed = performance.now() - frame.start;
    assert.equal(stack.pop(), frame);
    tickMetrics[frame.name] ??= { calls: 0, inclusiveMs: 0, selfMs: 0 };
    const metric = tickMetrics[frame.name];
    metric.calls++;
    metric.inclusiveMs += elapsed;
    metric.selfMs += elapsed - frame.childMs;
    if (stack.length) stack[stack.length - 1].childMs += elapsed;
  },
};
(globalThis as any).__wave15b = hooks;
(globalThis as any).__wave15bCounts = census;

const timed: Record<string, string[]> = {
  arenaBoundary: ["arenaVelocity", "returnRouteCost"],
  simulation: ["update"],
  shipNavigationSystem: ["findNavigationTarget", "updateShipNavigation"],
  flightBehaviors: ["calculateSeparation", "OrdnanceAvoidanceBlock"],
  flightControl: [
    "fighterDispersal",
    "dogfightTarget",
    "debrisAvoidanceVelocity",
    "escortVelocity",
    "capitalIntent",
  ],
  navigationContext: ["prepareNavigationContext"],
  fireControl: ["prepareFireControlContext", "acquireMountTarget"],
  shipWeaponSystem: [
    "updateTurretAim",
    "fireWeapon",
    "applyDamage",
    "applyShieldDamage",
    "destroyShip",
  ],
  projectileEngine: ["updateProjectiles", "detonateFlak"],
  collisionContactSolver: ["resolveShipCollisions", "resolveCruiserClearance", "applyWreckImpact"],
  obstacleNavigation: ["obstacleCourseCorrection"],
  fighterMissionSystem: ["ensureWings", "updateWings", "updateCycle"],
  shieldHaven: [
    "update",
    "attachGuests",
    "moveGuest",
    "refreshAmplification",
    "cleanup",
    "request",
    "hasTenderAura",
  ],
  harmonicShieldSystem: ["update"],
  beamLaserSystem: ["prepareBeam", "updateBeam"],
};

// AST counters identify actual candidate visits, not inferred O(N^2) estimates.
function counterName(file: string, text: string, owner: string): string | undefined {
  if (file === "arenaBoundary" && owner === "returnRouteCost") {
    if (text.startsWith("for (let sample = 1;")) return "arena.routeSamples";
    if (text.startsWith("for (const enemy of ships)")) return "arena.routeEnemyCandidates";
    if (text.startsWith("for (const turret of enemy.turrets)"))
      return "arena.routeTurretCandidates";
  }
  if (file === "shieldHaven") {
    if (owner === "hasTenderAura" && text.startsWith("for (const donor of tenders)"))
      return "haven.auraDonorCandidates";
    if (owner === "tenderTeams" && text.startsWith("for (const donor of ships)"))
      return "haven.tenderIndexCandidates";
    if (owner === "refreshAmplification" && text.startsWith("for (const ship of fleet)"))
      return "haven.auraShipCandidates";
  }
  if (file === "fireControl") {
    if (text.startsWith("for (const enemy of ships)")) return "fireControl.shipCandidates";
    if (text.startsWith("for (const missile of projectiles)"))
      return "fireControl.projectileCandidates";
    if (text.startsWith("for (const missile of missilesByTarget.get(enemy.id)"))
      return "fireControl.targetPayloadCandidates";
    if (text.startsWith("for (const lock of missileLocks)"))
      return "fireControl.reservationCandidates";
    if (text.startsWith("for (const defended of defendedShips)"))
      return "fireControl.defendedCandidates";
  }
  if (file === "projectileEngine") {
    if (text.startsWith("for (const p of this.projectiles)")) return "projectiles.processed";
    if (text.startsWith("for (const ship of aliveShips)"))
      return owner === "detonateFlak"
        ? "flak.shipCandidates"
        : text.includes("const t = sweptHit")
          ? "projectiles.shipSweepCandidates"
          : "flak.shipPositionCandidates";
    if (text.startsWith("for (const missile of this.projectiles)"))
      return text.includes("const t = sweptHit")
        ? "projectiles.missileSweepCandidates"
        : "flak.missilePositionCandidates";
    if (text.startsWith("for (const other of this.projectiles)"))
      return "flak.projectileCandidates";
  }
  if (file === "collisionContactSolver") {
    if (text.startsWith("for (let j = i + 1; j < aliveShips.length"))
      return "contacts.pairCandidates";
    if (text.startsWith("for (let j = i + 1; j < cruisers.length")) return "cruiser.pairCandidates";
    if (text.startsWith("for (let pass = 0;")) return "cruiser.passes";
  }
  if (
    file === "flightBehaviors" &&
    owner === "calculateSeparation" &&
    text.startsWith("for (const peer of ships)")
  )
    return "separation.peerCandidates";
  if (file === "obstacleNavigation" && text.startsWith("for (const obstacle of ships)"))
    return "obstacles.shipCandidates";
  return undefined;
}

function loadEngine(mode: "plain" | "profile" | "census"): Engine {
  const modules = new Map<string, { exports: any }>();
  function load(file: string): any {
    if (modules.has(file)) return modules.get(file)!.exports;
    const module = { exports: {} as any };
    modules.set(file, module);
    const source = readFileSync(file, "utf8");
    const base = file.split(/[\\/]/).at(-1)!.replace(/\.ts$/, "");
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const factory = context.factory;
      const expression = (value: string) => {
        const root = (
          ts.createSourceFile("injected.ts", value, ts.ScriptTarget.ES2022, true)
            .statements[0] as ts.ExpressionStatement
        ).expression;
        const synthesize = (node: ts.Node) => {
          ts.setTextRange(node, { pos: -1, end: -1 });
          ts.forEachChild(node, synthesize);
        };
        synthesize(root);
        return root;
      };
      const visit: ts.Visitor = (node) => {
        const visited = ts.visitEachChild(node, visit, context);
        if (
          mode === "profile" &&
          (ts.isFunctionDeclaration(visited) || ts.isMethodDeclaration(visited)) &&
          visited.body &&
          visited.name &&
          timed[base]?.includes(visited.name.getText())
        ) {
          const name = `${base}.${visited.name.getText()}`;
          const frame = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  "__waveFrame",
                  undefined,
                  undefined,
                  expression(`globalThis.__wave15b.enter(${JSON.stringify(name)})`),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          );
          const body = factory.createBlock(
            [
              frame,
              factory.createTryStatement(
                visited.body,
                undefined,
                factory.createBlock([
                  factory.createExpressionStatement(
                    expression("globalThis.__wave15b.exit(__waveFrame)"),
                  ),
                ]),
              ),
            ],
            true,
          );
          if (ts.isFunctionDeclaration(visited))
            return factory.updateFunctionDeclaration(
              visited,
              visited.modifiers,
              visited.asteriskToken,
              visited.name,
              visited.typeParameters,
              visited.parameters,
              visited.type,
              body,
            );
          return factory.updateMethodDeclaration(
            visited,
            visited.modifiers,
            visited.asteriskToken,
            visited.name,
            visited.questionToken,
            visited.typeParameters,
            visited.parameters,
            visited.type,
            body,
          );
        }
        if (mode === "census" && (ts.isForOfStatement(visited) || ts.isForStatement(visited))) {
          let parent: ts.Node | undefined = node.parent;
          while (parent && !ts.isFunctionDeclaration(parent) && !ts.isMethodDeclaration(parent))
            parent = parent.parent;
          const owner =
            parent && (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent))
              ? (parent.name?.getText() ?? "")
              : "";
          const key = counterName(base, node.getText(), owner);
          if (!key) return visited;
          const body = factory.createBlock([
            factory.createExpressionStatement(
              expression(
                `globalThis.__wave15bCounts[${JSON.stringify(key)}] = (globalThis.__wave15bCounts[${JSON.stringify(key)}] || 0) + 1`,
              ),
            ),
            ...(ts.isBlock(visited.statement) ? visited.statement.statements : [visited.statement]),
          ]);
          if (ts.isForOfStatement(visited))
            return factory.updateForOfStatement(
              visited,
              visited.awaitModifier,
              visited.initializer,
              visited.expression,
              body,
            );
          return factory.updateForStatement(
            visited,
            visited.initializer,
            visited.condition,
            visited.incrementor,
            body,
          );
        }
        return visited;
      };
      return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
    };
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: file,
      transformers: { before: [transformer] },
    }).outputText;
    new Function(
      "require",
      "module",
      "exports",
      `${output}\n//# sourceURL=${file.replace(/\\/g, "/")}`,
    )(
      (specifier: string) => {
        assert(specifier.startsWith("."), specifier);
        return load(resolve(dirname(file), `${specifier}.ts`));
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return {
    Simulation: load(resolve(engineDir, "simulation.ts")).ClientCombatSimulation,
    builder: load(resolve(engineDir, "fleetBuilder.ts")),
    profiles: load(resolve(engineDir, "shipProfiles.ts")),
    geometry: load(resolve(engineDir, "shieldGeometry.ts")),
  };
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}
function run(engine: Engine, count = ticks, detailed = false) {
  console.log("Creating run", { count, detailed });
  const sim = createFleet(engine);
  console.log("Fleet ready", { ships: sim.ships.length });
  const initialShips = structuredClone(sim.ships);
  const trace: any[] = [];
  for (let tick = 0; tick < count; tick++) {
    tickMetrics = {};
    census = {};
    (globalThis as any).__wave15bCounts = census;
    const start = performance.now();
    sim.update(dt);
    const durationMs = performance.now() - start;
    trace.push({
      tick: tick + 1,
      durationMs,
      alive: sim.ships.filter((s) => s.isAlive && !s.isDebris && !s.isDocked).length,
      wrecks: sim.ships.filter((s) => s.isAlive && s.isDebris).length,
      projectiles: sim.projectiles.length,
      missiles: sim.projectiles.filter((p) => p.weaponType === "missile").length,
      beams: sim.activeBeams.length,
      damage: sim.stats[0].damageDealt + sim.stats[1].damageDealt,
      ...(detailed ? { metrics: tickMetrics, census } : {}),
    });
    if (count === ticks && tick % 60 === 0)
      console.log("Progress", {
        tick: tick + 1,
        durationMs,
        alive: trace.at(-1).alive,
        projectiles: sim.projectiles.length,
      });
  }
  assert(Math.abs(sim.timeElapsed - count * dt) < 1e-8);
  const state = createHash("sha256")
    .update(
      JSON.stringify({
        ships: sim.ships,
        projectiles: sim.projectiles,
        stats: sim.stats,
        beams: sim.activeBeams,
        time: sim.timeElapsed,
      }),
    )
    .digest("hex");
  return {
    summary: summary(trace.map((row) => row.durationMs)),
    trace,
    state,
    initialShips,
    minAlive: Math.min(...trace.map((row) => row.alive)),
    maxWrecks: Math.max(...trace.map((row) => row.wrecks)),
    maxProjectiles: Math.max(...trace.map((row) => row.projectiles)),
    maxMissiles: Math.max(...trace.map((row) => row.missiles)),
  };
}
function aggregate(trace: any[]) {
  const totals: Record<string, Metric> = {};
  for (const row of trace)
    for (const [name, metric] of Object.entries(row.metrics ?? {}) as [string, Metric][]) {
      totals[name] ??= { calls: 0, inclusiveMs: 0, selfMs: 0 };
      const total = totals[name];
      total.calls += metric.calls;
      total.inclusiveMs += metric.inclusiveMs;
      total.selfMs += metric.selfMs;
    }
  return Object.entries(totals)
    .map(([name, metric]) => ({
      name,
      ...metric,
      inclusiveMsPerTick: metric.inclusiveMs / trace.length,
      selfMsPerTick: metric.selfMs / trace.length,
    }))
    .sort((a, b) => b.selfMs - a.selfMs);
}
function censusTotals(trace: any[]) {
  const totals: Record<string, number> = {};
  for (const row of trace)
    for (const [name, count] of Object.entries(row.census) as [string, number][])
      totals[name] = (totals[name] ?? 0) + count;
  return totals;
}

const environment = {
  node: process.version,
  cpu: cpus()[0].model,
  platform: process.platform,
  scale,
  ticks,
  dt,
  composition: Object.fromEntries(composition),
};
console.log("Environment", environment);
const engine =
  mode === "baseline" || mode === "cpu"
    ? native
    : loadEngine(mode as "plain" | "profile" | "census");
run(engine, 30);
let session: Session | undefined;
const post = (method: string, params: any = {}) =>
  new Promise<any>((resolve, reject) =>
    session!.post(method as any, params, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
if (mode === "cpu") {
  session = new Session();
  session.connect();
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 500 });
  await post("Profiler.start");
}
const measured = run(engine, ticks, mode === "profile" || mode === "census");
let nativeSampling: any;
if (session) {
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  writeFileSync(resolve(benchDir, `${reportPrefix}.native.cpuprofile`), JSON.stringify(profile));
  const nodeById = new Map<number, any>(profile.nodes.map((node: any) => [node.id, node]));
  const sampleCounts = new Map<number, number>();
  for (const id of profile.samples) sampleCounts.set(id, (sampleCounts.get(id) ?? 0) + 1);
  const cpuSamples = [...sampleCounts]
    .map(([id, samples]) => ({
      ...nodeById.get(id).callFrame,
      samples,
      percent: (samples * 100) / profile.samples.length,
    }))
    .sort((a, b) => b.samples - a.samples);
  nativeSampling = { samples: profile.samples.length, topSelf: cpuSamples.slice(0, 40) };
}
let baseline: any;
if (mode !== "baseline") {
  baseline = JSON.parse(readFileSync(resolve(benchDir, `${reportPrefix}.baseline.json`), "utf8"));
  assert.equal(measured.state, baseline.state, "Instrumentation changed simulation outcomes");
}
const report = {
  environment,
  mode,
  ...measured,
  stateEquality: mode === "baseline" ? "reference" : true,
  subsystems: aggregate(measured.trace),
  windows: [
    [0, 60],
    [60, 120],
    [120, 300],
  ].map(([start, end]) => ({
    ticks: `${start + 1}-${end}`,
    summary: summary(measured.trace.slice(start, end).map((row) => row.durationMs)),
    subsystems: aggregate(measured.trace.slice(start, end)),
    census: mode === "census" ? censusTotals(measured.trace.slice(start, end)) : undefined,
  })),
  peaks: [...measured.trace].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
  census: mode === "census" ? censusTotals(measured.trace) : undefined,
  nativeSampling,
};
writeFileSync(resolve(benchDir, `${reportPrefix}.${mode}.json`), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      mode,
      summary: report.summary,
      minAlive: report.minAlive,
      maxWrecks: report.maxWrecks,
      maxProjectiles: report.maxProjectiles,
      maxMissiles: report.maxMissiles,
      state: report.state,
      stateEquality: report.stateEquality,
      subsystems: report.subsystems,
      census: report.census,
      nativeSampling,
    },
    null,
    2,
  ),
);
