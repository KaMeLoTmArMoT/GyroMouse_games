import { readFileSync } from "node:fs";

interface Pressure {
  name?: string;
  sources: { key: string; count: number; guns?: number; delivery?: number }[];
  target: string;
  cost: number;
  dps: { shield: number; armor: number; hull: number };
  meanKill: number | null;
  censored: number;
  runs: { firstShieldBreak: number | null; kill: number | null }[];
}
interface Baseline {
  id: string; seed: number; swapped: boolean; outcome: string;
  duration: number; firstShot: number | null; alerts: string[]; errors: string[];
}
const data = JSON.parse(readFileSync(new URL("./results/roster-expansion.json", import.meta.url), "utf8")) as {
  baselineWallSeconds: number; baseline: Baseline[]; offense: Pressure[];
  dreadArcs: Pressure[]; budgetPressure: Pressure[]; fleetPressure: Pressure[]; deliverySweep: Pressure[]; synergy: Pressure[];
};
if (process.argv.includes("--latest-math")) {
  const math = JSON.parse(readFileSync(new URL("./results/roster-expansion-math.json", import.meta.url), "utf8")) as typeof data;
  for (const section of ["offense", "dreadArcs", "budgetPressure", "fleetPressure", "deliverySweep", "synergy"] as const)
    data[section] = math[section];
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round = (n: number | null) => n === null ? ">300" : n.toFixed(2);
const count = (values: string[]) => Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((v) => v === value).length]));
console.log("BASELINE", JSON.stringify({
  runs: data.baseline.length, seconds: data.baselineWallSeconds,
  outcomes: count(data.baseline.map((r) => r.outcome)),
  mean: mean(data.baseline.map((r) => r.duration)),
  alerts: count(data.baseline.flatMap((r) => r.alerts)),
  errors: data.baseline.flatMap((r) => r.errors),
}));
for (const id of [...new Set(data.baseline.map((r) => r.id))]) {
  const runs = data.baseline.filter((r) => r.id === id);
  console.log(id, JSON.stringify({
    actualTeamOutcomes: count(runs.map((r) => r.outcome)),
    outcomesOriginalComposition: count(runs.map((r) => r.outcome === "blue" ? r.swapped ? "B" : "A" : r.outcome === "red" ? r.swapped ? "A" : "B" : r.outcome)),
    mean: round(mean(runs.map((r) => r.duration))),
    min: round(Math.min(...runs.map((r) => r.duration))),
    max: round(Math.max(...runs.map((r) => r.duration))),
    firstShot: round(mean(runs.flatMap((r) => r.firstShot === null ? [] : [r.firstShot]))),
  }));
}
for (const section of ["offense", "dreadArcs", "budgetPressure", "fleetPressure", "deliverySweep", "synergy"] as const) {
  console.log(section.toUpperCase());
  for (const row of data[section]) {
    console.log(JSON.stringify({
      name: row.name ?? row.sources, target: row.target, cost: row.cost,
      dps: Object.fromEntries(Object.entries(row.dps).map(([key, value]) => [key, round(value)])),
      meanKill: round(row.meanKill), censored: row.censored,
      shieldBreaks: row.runs.map((r) => round(r.firstShieldBreak)),
    }));
  }
}
