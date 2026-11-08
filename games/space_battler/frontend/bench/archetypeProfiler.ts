// Benchmark-only AST instrumentation, following wave15bProfile.ts. Production sources stay untouched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Profiler } from "node:inspector";
import { Session } from "node:inspector";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// TS 7 in the frontend is native-only; the root TS 5 compiler provides transpileModule.
import ts from "../../../../node_modules/typescript/lib/typescript.js";
import type { ClientCombatSimulation } from "../src/engine/simulation";

export type Metric = { calls: number; inclusiveMs: number; selfMs: number };
type Frame = { name: string; start: number; childMs: number };
const timed: Record<string, string[]> = {
  simulation: ["update"],
  shipNavigationSystem: ["findNavigationTarget", "updateShipNavigation"],
  flightBehaviors: ["calculateSeparation", "OrdnanceAvoidanceBlock"],
  flightControl: ["fighterDispersal", "dogfightTarget", "escortVelocity", "capitalIntent"],
  navigationContext: ["prepareNavigationContext"],
  fireControl: ["prepareFireControlContext", "acquireMountTarget", "sweptHit"],
  arenaBoundary: ["arenaVelocity", "returnRouteCost"],
  projectileEngine: ["updateProjectiles", "detonateFlak"],
  wasmHotLoops: ["findProjectileShipHitWasm", "collectCollisionPairsWasm"],
  collisionContactSolver: ["resolveShipCollisions", "resolveCruiserClearance"],
  shipWeaponSystem: ["fireWeapon", "updateTurretAim", "applyDamage"],
  fighterMissionSystem: ["ensureWings", "updateWings", "updateCycle"],
  beamLaserSystem: ["prepareBeam", "updateBeam"],
  shieldHaven: ["update"],
  harmonicShieldSystem: ["update"],
};

export async function startNativeSampler() {
  const session = new Session();
  session.connect();
  const post = (method: string, params = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      session.post(method, params, (error, result) =>
        error ? reject(error) : resolve((result ?? {}) as Record<string, unknown>),
      );
    });
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 1000 });
  await post("Profiler.start");
  return async () => {
    const { profile } = (await post("Profiler.stop")) as { profile: Profiler.Profile };
    session.disconnect();
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, number>();
    for (const node of profile.nodes)
      for (const child of node.children ?? []) parents.set(child, node.id);
    const self = new Map<number, number>();
    const inclusive = new Map<string, number>();
    for (const id of profile.samples ?? []) {
      self.set(id, (self.get(id) ?? 0) + 1);
      const seen = new Set<string>();
      for (
        let current: number | undefined = id;
        current !== undefined;
        current = parents.get(current)
      ) {
        const node = nodes.get(current);
        assert(node);
        const frame = node.callFrame;
        const base = basename(frame.url, ".ts");
        const key = `${base}.${frame.functionName}`;
        if (timed[base]?.includes(frame.functionName) && !seen.has(key)) {
          inclusive.set(key, (inclusive.get(key) ?? 0) + 1);
          seen.add(key);
        }
      }
    }
    const samples = profile.samples?.length ?? 0;
    assert(samples > 0, "Native CPU profiler returned no samples");
    return {
      samples,
      topSelf: [...self]
        .map(([id, count]) => {
          const node = nodes.get(id);
          assert(node);
          return {
            function: node.callFrame.functionName,
            file: basename(node.callFrame.url),
            percent: (count * 100) / samples,
          };
        })
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 25),
      subsystemInclusive: [...inclusive]
        .map(([name, count]) => ({ name, percent: (count * 100) / samples }))
        .sort((a, b) => b.percent - a.percent),
    };
  };
}

export function createProfiler(instrument = true) {
  let metrics: Record<string, Metric> = {};
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
      metrics[frame.name] ??= { calls: 0, inclusiveMs: 0, selfMs: 0 };
      const metric = metrics[frame.name];
      metric.calls++;
      metric.inclusiveMs += elapsed;
      metric.selfMs += elapsed - frame.childMs;
      const parent = stack.at(-1);
      if (parent) parent.childMs += elapsed;
    },
  };
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(file: string): Record<string, unknown> {
    const cached = modules.get(file);
    if (cached) return cached.exports;
    const module = { exports: {} as Record<string, unknown> };
    modules.set(file, module);
    const base = basename(file, ".ts");
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const f = context.factory;
      const visit: ts.Visitor = (node) => {
        const visited = ts.visitEachChild(node, visit, context);
        const owner = node.parent;
        if (
          !instrument ||
          !ts.isBlock(visited) ||
          !owner ||
          !(ts.isFunctionDeclaration(owner) || ts.isMethodDeclaration(owner)) ||
          !owner.name ||
          !timed[base]?.includes(owner.name.getText())
        )
          return visited;
        const name = `${base}.${owner.name.getText()}`;
        return f.createBlock(
          [
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    "__benchFrame",
                    undefined,
                    undefined,
                    f.createCallExpression(
                      f.createPropertyAccessExpression(f.createIdentifier("__benchHooks"), "enter"),
                      undefined,
                      [f.createStringLiteral(name)],
                    ),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
            f.createTryStatement(
              visited,
              undefined,
              f.createBlock([
                f.createExpressionStatement(
                  f.createCallExpression(
                    f.createPropertyAccessExpression(f.createIdentifier("__benchHooks"), "exit"),
                    undefined,
                    [f.createIdentifier("__benchFrame")],
                  ),
                ),
              ]),
            ),
          ],
          true,
        );
      };
      return (source) => ts.visitNode(source, visit) as ts.SourceFile;
    };
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: file,
      transformers: { before: [transformer] },
    }).outputText;
    new Function("require", "module", "exports", "__benchHooks", output)(
      (specifier: string) => {
        assert(specifier.startsWith("."), `Unexpected runtime import: ${specifier}`);
        return load(resolve(dirname(file), `${specifier}.ts`));
      },
      module,
      module.exports,
      hooks,
    );
    return module.exports;
  }
  const engineDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/engine");
  const Simulation = load(resolve(engineDir, "simulation.ts"))
    .ClientCombatSimulation as typeof ClientCombatSimulation;
  return {
    Simulation,
    reset() {
      assert.equal(stack.length, 0);
      metrics = {};
    },
    metrics() {
      assert.equal(stack.length, 0);
      return metrics;
    },
  };
}
