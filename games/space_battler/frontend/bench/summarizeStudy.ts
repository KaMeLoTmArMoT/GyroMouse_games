import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ScenarioResult } from "../src/engine/scenarios";
import type { StudyMetrics } from "./studyMetrics";

type Result = ScenarioResult & { study: ReturnType<StudyMetrics["summary"]> };
const directory = fileURLToPath(new URL("./results/grand-scale/", import.meta.url));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f = (n: number) => Number.isFinite(n) ? n.toFixed(2) : "—";
const lines: string[] = [];
const compact = [];
for (const file of readdirSync(directory).filter((name) => /^(matrix|sensitivity|extended|holdout|refinement)-.*\.json$/.test(name) && !name.includes("manifest"))) {
  const document = JSON.parse(readFileSync(`${directory}/${file}`, "utf8")) as { profile: Record<string, unknown>; mode: string; results: Result[] };
  compact.push({ ...document, results: document.results.map(({ layout, speed: _speed, telemetry, ...result }) => ({ ...result, composition: [0, 1].map((team) => layout.filter((s) => s.team === team).map((s) => s.hullClass)), telemetry: { ...telemetry, damage: telemetry.damage } })) });
  lines.push(`\n## ${document.mode}: ${document.profile.id}\n`, "| Matchup | n | B/R/M/T | Duration mean [min,max] | Shot / hit | Surv B/R | HP% B/R | STALL/OOB/RAM |", "|---|---:|---|---|---|---|---|---|---|");
  for (const id of new Set(document.results.map((r) => r.id))) {
    const rs = document.results.filter((r) => r.id === id);
    const times = rs.map((r) => r.duration);
    const outcomes = ["blue", "red", "mutual", "timeout"].map((o) => rs.filter((r) => r.outcome === o).length).join("/");
    lines.push(`| ${id} | ${rs.length} | ${outcomes} | ${f(mean(times))} [${f(Math.min(...times))},${f(Math.max(...times))}] | ${f(mean(rs.map((r) => r.telemetry.firstShot ?? NaN)))} / ${f(mean(rs.map((r) => r.study.firstWeaponHit ?? NaN)))} | ${[0, 1].map((t) => f(mean(rs.map((r) => r.survivors[t])))).join("/")} | ${[0, 1].map((t) => f(mean(rs.map((r) => r.residualHpPercent[t])))).join("/")} | ${["STALL", "OOB", "RAM"].map((a) => rs.filter((r) => r.alerts.includes(a)).length).join("/")} |`);
  }
  lines.push("\nBB diagnostics (pooled mount-live seconds denominator):\n", "| Matchup | Eligible % | Shots/live s × cooldown % | Tracking wait s | Rail shots/hits | Rear% / longest s | Open rail per BB | Spawn overlap runs | Ram fighter deaths |", "|---|---:|---:|---:|---|---|---:|---:|---:|");
  for (const id of ["3bb-vs-3bb", "1bb-vs-3cr", "1bb-vs-3cv", "1bb-vs-27sc", "1bb-vs-needle"]) {
    const rs = document.results.filter((r) => r.id === id);
    if (!rs.length) continue;
    const batteries = rs.flatMap((r) => r.telemetry.batteries);
    const live = rs.reduce((sum, r) => sum + r.telemetry.batteries.reduce((s, b) => s + (r.study.aliveSeconds[b.shipId] ?? 0), 0), 0);
    const sum = (fn: (r: Result) => number) => rs.reduce((s, r) => s + fn(r), 0);
    const rails = sum((r) => Object.entries(r.study.mountShots).filter(([k]) => k.includes("_spinal")).reduce((s, [, n]) => s + n, 0));
    const hits = sum((r) => Object.entries(r.study.weaponHits).filter(([k]) => k.includes("_spinal")).reduce((s, [, n]) => s + n, 0));
    const bbCount = sum((r) => r.layout.filter((s) => s.hullClass === "battleship").length);
    lines.push(`| ${id} | ${f(100 * batteries.reduce((s, b) => s + b.eligibleSeconds, 0) / live)} | ${f(120 * batteries.reduce((s, b) => s + b.shots, 0) / live)} | ${f(batteries.reduce((s, b) => s + b.readyTrackingSeconds, 0))} | ${rails}/${hits} | ${f(100 * sum((r) => r.study.rearPairSeconds) / sum((r) => r.study.nearbyPairSeconds))} / ${f(Math.max(...rs.map((r) => r.study.longestRearSeconds)))} | ${f(sum((r) => Object.values(r.study.openingRailShots).reduce((s, n) => s + n, 0)) / bbCount)} | ${rs.filter((r) => r.study.spawnPairs.some((p) => p.bubbleGap < 0)).length} | ${sum((r) => r.study.ramFighterDeaths)} |`);
  }
  const alerts = document.results.filter((r) => r.outcome === "timeout" || r.alerts.length);
  lines.push("\nAlerts: " + alerts.map((r) => `${r.id}@${r.seed ?? "nominal"}=${r.outcome}[${r.alerts.join(",")}](${r.telemetry.stalls.map((s) => `${s.kind}@${f(s.time)}`).join(",")})`).join("; "));
}
writeFileSync(`${directory}/tables.md`, lines.join("\n"));
writeFileSync(`${directory}/compact.json`, JSON.stringify(compact));
console.log(`Wrote ${directory}/tables.md and compact.json (${compact.length} experiments).`);
