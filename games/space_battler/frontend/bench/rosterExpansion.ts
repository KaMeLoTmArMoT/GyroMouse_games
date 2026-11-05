// Reproducible research: live-roster battles + isolated stationary damage experiments.
// New-hull results are NOT moving-fleet win rates. No runtime registry is mutated.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { HULL_PROFILES, type HullProfile } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import { SCENARIOS, type ScenarioDefinition } from "../src/engine/scenarios";
import type { ShipState, WeaponDefinition } from "../src/types/combat";
import { runScenario } from "./run";
import { ROSTER_CANDIDATES } from "./rosterExpansionProfiles";

const profiles = { ...HULL_PROFILES, ...ROSTER_CANDIDATES };
type Key = keyof typeof profiles;
type Source = { key: Key; count: number; guns?: number; delivery?: number; stagger?: boolean };
const DT = 1 / 60;
const CAP = 300;
const seeds = [1, 7, 42, 2026];
function against(weapon: WeaponDefinition, target: Key): WeaponDefinition {
  return weapon.flak && target === "strike_craft"
    ? { ...weapon, shieldMultiplier: 1, armorMultiplier: 1, hullMultiplier: 1 }
    : weapon;
}
function targetShip(profile: HullProfile): ShipState {
  return {
    id: "stationary-target", name: profile.name, team: 1, groupId: 1,
    hullClass: "battleship", pos: [0, 0], velocity: [0, 0], heading: 0,
    maxSpeed: 0, turnRate: 0, size: profile.size, cost: profile.cost,
    shieldMax: profile.shieldMax, shieldCurrent: profile.shieldMax,
    shieldRegen: profile.shieldRegen, shieldRechargeDelay: profile.shieldRechargeDelay,
    shieldDelayTimer: 0, armorMax: profile.armorMax, armorCurrent: profile.armorMax,
    armorRating: profile.armorRating, hullMax: profile.hullMax, hullCurrent: profile.hullMax,
    turrets: [], isAlive: true,
  };
}
// Deliberately call the current damage implementation rather than copy its nonlinear rules.
type DamageAccess = {
  applyDamageInternal(ship: ShipState, raw: number, weapon: WeaponDefinition,
    attackerTeam?: number, channel?: object): void;
};
function battery(source: Source) {
  let mounts = profiles[source.key].turrets;
  // Single-target ideal duty: one BB broadside only. Rail + beam is a generous
  // time-multiplexed upper envelope, never a claim of overlapping physical arcs.
  if (source.key === "battleship") mounts = mounts.slice(0, source.guns ?? 2);
  if (source.key === "broadside_dreadnought") mounts = mounts.slice(0, source.guns ?? 3);
  return Array.from({ length: source.count }, (_, ship) => mounts.map((mount, gun) => {
    const w = mount.weapon;
    const beam = w.weaponType === "beam_laser";
    const cycle = w.cooldown + (beam ? 1.2 : 0);
    return {
      w, beam, cycle: Math.round(cycle / DT),
      phase: Math.round((mount.cooldownTimer + (source.stagger ? ship * cycle / source.count : 0)) / DT),
      delivery: source.delivery ?? 1, ship, gun,
    };
  })).flat();
}
function experiment(sources: Source[], target: Key, seed = 1) {
  const ship = targetShip(profiles[target]);
  const sim = new ClientCombatSimulation();
  const damage = sim as unknown as DamageAccess;
  const guns = sources.flatMap(battery);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  let regenerated = 0;
  let firstShieldBreak: number | null = null;
  for (let tick = 0; tick <= CAP / DT; tick++) {
    sim.timeElapsed = tick * DT;
    if (tick > 0) {
      if (ship.shieldDelayTimer > 0) ship.shieldDelayTimer = Math.max(0, ship.shieldDelayTimer - DT);
      else {
        const before = ship.shieldCurrent;
        ship.shieldCurrent = Math.min(ship.shieldMax, before + ship.shieldRegen * DT);
        regenerated += ship.shieldCurrent - before;
      }
    }
    for (const gun of guns) {
      const age = tick - gun.phase;
      if (age < 0) continue;
      const phase = age % gun.cycle;
      const fires = gun.beam ? phase >= 6 && phase <= 72 && phase % 6 === 0 : phase === 0;
      if (!fires || random() >= gun.delivery) continue;
      damage.applyDamageInternal(ship, gun.w.damage / (gun.beam ? 12 : 1), against(gun.w, target), 0,
        gun.beam ? {} : undefined);
      if (firstShieldBreak === null && ship.shieldCurrent <= 1e-9) firstShieldBreak = tick * DT;
      if (!ship.isAlive) return { kill: tick * DT, firstShieldBreak, regenerated };
    }
  }
  return { kill: null, firstShieldBreak, regenerated };
}
function throughput(sources: Source[], target: Key) {
  const rating = profiles[target].armorRating;
  return sources.flatMap(battery).reduce((sum, gun) => {
    const w = against(gun.w, target);
    const rate = gun.w.damage / (gun.cycle * DT) * gun.delivery;
    return {
      shield: sum.shield + rate * w.shieldMultiplier,
      armor: sum.armor + rate * w.armorMultiplier * w.damage / (w.damage + rating),
      hull: sum.hull + rate * w.hullMultiplier,
    };
  }, { shield: 0, armor: 0, hull: 0 });
}
function summary(sources: Source[], target: Key) {
  const runs = seeds.map((seed) => experiment(sources, target, seed));
  const kills = runs.flatMap((run) => run.kill === null ? [] : [run.kill]);
  return {
    sources, target, cost: sources.reduce((sum, source) => sum + profiles[source.key].cost * source.count, 0),
    dps: throughput(sources, target), runs,
    meanKill: kills.length ? kills.reduce((a, b) => a + b, 0) / kills.length : null,
    censored: runs.length - kills.length,
  };
}

// Sanity checks of damage access and beam-cycle interpretation, not a second damage engine.
const probe = targetShip(HULL_PROFILES.battleship);
probe.shieldCurrent = 0;
(new ClientCombatSimulation() as unknown as DamageAccess).applyDamageInternal(
  probe, 180, ROSTER_CANDIDATES.broadside_dreadnought.turrets[0].weapon);
assert.ok(Math.abs(probe.armorCurrent - (2000 - 180 * 1.35 * 180 / 255)) < 1e-9);
assert.equal(battery({ key: "battleship", count: 1 })[1].cycle, 144);

const offense = (Object.keys(profiles) as Key[]).flatMap((key) =>
  (Object.keys(profiles) as Key[]).map((target) => summary([{ key, count: 1 }], target)));
const dreadArcs = [1, 2, 3].map((guns) => summary([{ key: "broadside_dreadnought", count: 1, guns }], "battleship"));
const budgetPressure = [
  summary([{ key: "battleship", count: 1, guns: 1 }], "broadside_dreadnought"),
  summary([{ key: "cruiser", count: 3 }], "broadside_dreadnought"),
  summary([{ key: "corvette", count: 10 }], "broadside_dreadnought"),
  summary([{ key: "strike_craft", count: 30 }], "broadside_dreadnought"),
  summary([{ key: "missile_frigate", count: 5, stagger: true }], "broadside_dreadnought"),
];
const permutations: Array<{ name: string; sources: Source[] }> = [
  { name: "BB + CR + 2CV + 6SC", sources: [{ key: "battleship", count: 1 }, { key: "cruiser", count: 1 }, { key: "corvette", count: 2 }, { key: "strike_craft", count: 6 }] },
  { name: "D + CR + 2CV + 3SC", sources: [{ key: "broadside_dreadnought", count: 1 }, { key: "cruiser", count: 1 }, { key: "corvette", count: 2 }, { key: "strike_craft", count: 3 }] },
  { name: "D + 2MF + 2CV", sources: [{ key: "broadside_dreadnought", count: 1 }, { key: "missile_frigate", count: 2 }, { key: "corvette", count: 2 }] },
  { name: "D + MF + 2CV + 6SC", sources: [{ key: "broadside_dreadnought", count: 1 }, { key: "missile_frigate", count: 1 }, { key: "corvette", count: 2 }, { key: "strike_craft", count: 6 }] },
  { name: "BB + 2MF + 2CV + 4SC", sources: [{ key: "battleship", count: 1 }, { key: "missile_frigate", count: 2 }, { key: "corvette", count: 2 }, { key: "strike_craft", count: 4 }] },
  { name: "4CR + 2CV + 5SC", sources: [{ key: "cruiser", count: 4 }, { key: "corvette", count: 2 }, { key: "strike_craft", count: 5 }] },
];
const fleetPressure = permutations.flatMap(({ name, sources }) =>
  (["battleship", "broadside_dreadnought"] as Key[]).map((target) => ({ name, ...summary(sources, target) })));
const deliverySweep = [0.1, 0.25, 0.5, 0.75, 1].flatMap((delivery) =>
  [1, 2, 4, 5].map((count) => summary([{ key: "missile_frigate", count, delivery, stagger: true }], "battleship")));
const synergy = [0.1, 0.25, 0.5, 0.75, 1].map((delivery) => summary([
  { key: "broadside_dreadnought", count: 1 },
  { key: "missile_frigate", count: 1, delivery },
], "battleship"));
const baselineCases = SCENARIOS.filter((scenario) =>
  scenario.tags.includes("golden") || scenario.tags.includes("curated") ||
  ["3cv-vs-1cr", "9cv-vs-26sc", "1bb-vs-27sc"].includes(scenario.id));
const baseline: object[] = [];
const started = performance.now();
if (!process.argv.includes("--math-only")) {
  for (const scenario of baselineCases) {
    for (const seed of seeds) {
      for (const swapped of [false, true]) {
        const test: ScenarioDefinition = {
          ...scenario, durationLimit: CAP,
          blue: swapped ? scenario.red : scenario.blue,
          red: swapped ? scenario.blue : scenario.red,
        };
        const r = runScenario(test, seed);
        baseline.push({ id: scenario.id, seed, swapped, outcome: r.outcome,
          duration: r.duration, firstShot: r.telemetry.firstShot,
          residualHpPercent: r.residualHpPercent, alerts: r.alerts, errors: r.telemetry.errors });
      }
    }
    console.log(`Baseline complete: ${scenario.id}`);
  }
}
const hashes = Object.fromEntries([
  "../src/engine/shipProfiles.ts", "../src/engine/simulation.ts", "../src/engine/fireControl.ts",
  "../src/engine/flightControl.ts", "../src/engine/fleetBuilder.ts", "../src/engine/scenarios.ts",
  "../src/engine/combatTelemetry.ts", "../src/engine/math2d.ts", "../src/engine/fleetPresets.ts",
  "./rosterExpansion.ts", "./rosterExpansionProfiles.ts", "./run.ts",
].map((path) => [path, createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")]));
const output = {
  version: 1, date: new Date().toISOString(), node: process.version, hashes,
  baselineWallSeconds: (performance.now() - started) / 1000,
  assumptions: "Stationary outgoing damage only: no range/flight time, movement, losses, PD geometry or hit chance unless explicit delivery sweep. First impact t=0; 300s cap; live damage formula and regen; BB rail+one beam upper envelope; D three-gun broadside; full flak falloff with strike-craft multiplier override. Seeds in sweep are hypothetical Bernoulli delivery, not measured PD probability.",
  profiles, offense, dreadArcs, budgetPressure, fleetPressure, deliverySweep, synergy, baseline,
};
const path = new URL(process.argv.includes("--math-only") ? "./results/roster-expansion-math.json" : "./results/roster-expansion.json", import.meta.url);
writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Evidence: ${path.pathname}; baseline runs: ${baseline.length}`);
