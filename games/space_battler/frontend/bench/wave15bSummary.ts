import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
const baseline = load("wave15b.baseline.json");
const profile = load("wave15b.profile.json");
const census = load("wave15b.census.json");
const cpu = load("wave15b.native.cpuprofile");
const nodes = new Map<number, any>(cpu.nodes.map((node: any) => [node.id, node]));
const parents = new Map<number, number>();
for (const node of cpu.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const groups = [
  ["arena route", "returnRouteCost"], ["missile/ship fire control", "acquireMountTarget"],
  ["haven aura", "hasTenderAura"], ["haven cleanup", "cleanup"],
  ["navigation target", "findNavigationTarget", "selectNavigationTarget"],
  ["separation", "calculateSeparation"], ["projectiles", "updateProjectiles"],
  ["obstacles", "obstacleCourseCorrection"], ["contacts", "resolveShipCollisions", "resolveCruiserClearance"],
];
const exclusive: Record<string, number> = {};
const inclusive: Record<string, number> = {};
const leaves: Record<string, number> = {};
for (const id of cpu.samples) {
  const chain: any[] = [];
  let current: number | undefined = id;
  while (current !== undefined) { chain.push(nodes.get(current)); current = parents.get(current); }
  const leaf = chain[0].callFrame;
  const key = `${leaf.url.split("/").at(-1) || "runtime"}:${leaf.functionName || "anonymous"}`;
  leaves[key] = (leaves[key] ?? 0) + 1;
  let assigned = false;
  for (const [name, ...functions] of groups) if (chain.some((node) => functions.includes(node.callFrame.functionName))) {
    inclusive[name] = (inclusive[name] ?? 0) + 1;
    if (!assigned) { exclusive[name] = (exclusive[name] ?? 0) + 1; assigned = true; }
  }
  if (!assigned) exclusive.other = (exclusive.other ?? 0) + 1;
}
const percentages = (counts: Record<string, number>) => Object.entries(counts).map(([name, samples]) => ({ name, samples, percent: samples * 100 / cpu.samples.length })).sort((a, b) => b.samples - a.samples);
const compact = (row: any) => ({
  tick: row.tick, ms: row.durationMs, alive: row.alive, projectiles: row.projectiles, missiles: row.missiles,
  beams: row.beams, damage: row.damage,
});
const metrics = (row: any) => Object.entries(row.metrics).map(([name, value]: [string, any]) => ({ name, calls: value.calls, inclusive: value.inclusiveMs, self: value.selfMs })).sort((a, b) => b.self - a.self).slice(0, 12);
const data = {
  baseline: baseline.summary,
  windows: baseline.windows.map((window: any, i: number) => ({
    ticks: window.ticks, baseline: window.summary,
    subsystems: profile.windows[i].subsystems.slice(0, 10), census: census.windows[i].census,
  })),
  baselinePeaks: baseline.peaks.map(compact),
  profilePeaks: profile.peaks.slice(0, 5).map((row: any) => ({ ...compact(row), metrics: metrics(row) })),
  timeline: [1, 2, 10, 20, 30, 60, 90, 120, 180, 240, 300].map((tick) => ({
    ...compact(baseline.trace[tick - 1]), profileMs: profile.trace[tick - 1].durationMs,
    metrics: metrics(profile.trace[tick - 1]), census: census.trace[tick - 1].census,
  })),
  milestones: {
    projectilePeak: compact(baseline.trace.reduce((a: any, b: any) => a.projectiles >= b.projectiles ? a : b)),
    missilePeak: compact(baseline.trace.reduce((a: any, b: any) => a.missiles >= b.missiles ? a : b)),
    firstDamage: compact(baseline.trace.find((row: any) => row.damage > 0)),
    firstLoss: compact(baseline.trace.find((row: any) => row.alive < 340)),
    firstArenaCost: profile.trace.find((row: any) => row.metrics["arenaBoundary.returnRouteCost"]),
    maxArenaCost: profile.trace.reduce((a: any, b: any) => (a.metrics["arenaBoundary.returnRouteCost"]?.inclusiveMs ?? 0) >= (b.metrics["arenaBoundary.returnRouteCost"]?.inclusiveMs ?? 0) ? a : b),
  },
  nativeExclusive: percentages(exclusive), nativeInclusive: percentages(inclusive), nativeLeaves: percentages(leaves).slice(0, 25),
  minAlive: baseline.minAlive, state: baseline.state,
};
for (const key of ["firstArenaCost", "maxArenaCost"]) {
  const row = (data.milestones as any)[key];
  (data.milestones as any)[key] = row ? { ...compact(row), metrics: metrics(row), route: row.metrics["arenaBoundary.returnRouteCost"] } : null;
}
writeFileSync(resolve(dir, "wave15b.summary.json"), JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, null, 2));
