// Stage-1 research: live combat with an external beam; isolated ECM guidance surrogate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { sweptHit } from "../src/engine/fireControl";
import { clamp, normalizeAngle } from "../src/engine/math2d";
import { HULL_PROFILES, type HullProfile, instantiateTurrets } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2, WeaponDefinition } from "../src/types/combat";

const SEEDS = [1, 7, 42, 2026];
const DT = 1 / 60;
const CAP = 90;
const BEAM = { rate: 65, active: 6, cycle: 10, range: 500 };
const ECM = { range: 600, interval: 8, duration: 3, penalty: 0.45 };
const tender: HullProfile = {
  name: "Оберіг research tender",
  role: "EW support",
  desc: "Stage-1 candidate",
  cost: 1250,
  size: 32,
  speed: 75,
  turnRate: 0.8,
  turnRateDisplay: "0.80 rad/s",
  hullMax: 800,
  armorMax: 450,
  armorRating: 30,
  shieldMax: 650,
  shieldRegen: 15,
  shieldRechargeDelay: 3,
  turrets: [HULL_PROFILES.corvette.turrets[0]],
};

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function ship(
  profile: HullProfile,
  hullClass: HullClass,
  id: string,
  team: number,
  pos: Vector2 = [0, 0],
): ShipState {
  return {
    id,
    name: profile.name,
    hullClass,
    team,
    groupId: team + 1,
    pos,
    velocity: [0, 0],
    heading: team ? Math.atan2(-pos[1], -pos[0]) : 0,
    maxSpeed: 0,
    turnRate: 0,
    size: profile.size,
    cost: profile.cost,
    shieldMax: profile.shieldMax,
    shieldCurrent: profile.shieldMax,
    shieldRegen: profile.shieldRegen,
    shieldRechargeDelay: profile.shieldRechargeDelay,
    shieldDelayTimer: 0,
    armorMax: profile.armorMax,
    armorCurrent: profile.armorMax,
    armorRating: profile.armorRating,
    hullMax: profile.hullMax,
    hullCurrent: profile.hullMax,
    turrets: instantiateTurrets(profile, id, 0),
    isAlive: true,
  };
}

// Explicit anti-loop rule: no Tender (including self) can receive harmonic transfer.
function transfer(target: ShipState, targetIsTender: boolean, tick: number, enabled: boolean) {
  if (!enabled || targetIsTender || !target.isAlive || tick % 600 >= 360) return 0;
  const amount = Math.min(BEAM.rate * DT, target.shieldMax - target.shieldCurrent);
  target.shieldCurrent += amount;
  return amount;
}

type Threat = "none" | "quiver" | "raider" | "escort" | "cruiser" | "battleship";
function combat(
  targetKind: "cruiser" | "battleship" | "tender",
  threat: Threat,
  count: number,
  seed: number,
  beam: boolean,
  initialFraction = 0.25,
) {
  const random = rng(seed);
  const sim = new ClientCombatSimulation();
  const target = ship(
    targetKind === "tender" ? tender : HULL_PROFILES[targetKind],
    targetKind === "tender" ? "missile_frigate" : targetKind,
    "target",
    0,
  );
  // Passive capital targets isolate support throughput; Tender retains its actual flak.
  if (targetKind !== "tender") {
    target.turrets = [];
    target.shieldCurrent *= initialFraction;
    target.shieldDelayTimer = target.shieldRechargeDelay ?? 0;
  }
  sim.addShip(target);
  const classes = {
    quiver: "missile_frigate",
    raider: "strike_craft",
    escort: "corvette",
    cruiser: "cruiser",
    battleship: "battleship",
  } as const;
  for (let i = 0; i < count && threat !== "none"; i++) {
    const hullClass = classes[threat];
    const angle = (i - (count - 1) / 2) * 0.45 + (random() - 0.5) * 0.12;
    const range = threat === "escort" ? 350 : threat === "raider" ? 500 : 900;
    const enemy = ship(HULL_PROFILES[hullClass], hullClass, `enemy${i}`, 1, [
      Math.cos(angle) * range,
      Math.sin(angle) * range,
    ]);
    if (threat === "raider") {
      enemy.maxSpeed = HULL_PROFILES.strike_craft.speed;
      enemy.turnRate = HULL_PROFILES.strike_craft.turnRate;
    }
    sim.addShip(enemy);
  }
  const telemetry = new CombatTelemetry(sim.ships);
  sim.observer = telemetry;
  const initialShield = target.shieldCurrent;
  let supplied = 0;
  let fullAt: number | null = null;
  let breakAt: number | null = null;
  let deathAt: number | null = null;
  for (let tick = 0; tick < CAP / DT; tick++) {
    supplied += transfer(target, targetKind === "tender", tick, beam);
    if (target.shieldCurrent >= target.shieldMax - 1e-7) fullAt ??= tick * DT;
    sim.update(DT);
    if (target.shieldCurrent >= target.shieldMax - 1e-7) fullAt ??= sim.timeElapsed;
    if (target.shieldCurrent <= 1e-7) breakAt ??= sim.timeElapsed;
    if (!target.isAlive) {
      deathAt = sim.timeElapsed;
      break;
    }
  }
  const report = telemetry.report();
  assert.deepEqual(report.errors, []);
  const damage = report.damage.filter((event) => event.targetId === target.id);
  const lostShield = damage.reduce((sum, event) => sum + event.shield, 0);
  const regenerated = report.shieldRegenerated[target.id] ?? 0;
  assert.ok(
    Math.abs(initialShield + supplied + regenerated - lostShield - target.shieldCurrent) < 1e-5,
  );
  if (targetKind === "tender") assert.equal(supplied, 0);
  return {
    targetKind,
    threat,
    count,
    seed,
    beam,
    initialFraction,
    fullAt,
    breakAt,
    deathAt,
    supplied,
    regenerated,
    lostShield,
    seconds: sim.timeElapsed,
    endShield: target.shieldCurrent,
    endArmor: target.armorCurrent,
    endHull: target.hullCurrent,
    pdInterceptions: sim.stats[0].missilesIntercepted,
  };
}

// Paired guidance microbenchmark: same launch errors, pulse phases, trajectories per seed.
// No PD: expired missiles are misses, never interceptions. Instantaneous 360-degree pulses.
function missiles(kind: "quiver" | "torpedo", seed: number, penalty: number, speed: number) {
  const random = rng(seed);
  const weapon =
    kind === "quiver"
      ? HULL_PROFILES.missile_frigate.turrets[0].weapon
      : HULL_PROFILES.cruiser.turrets[1].weapon;
  let hits = 0;
  let affected = 0;
  const tubes = kind === "quiver" ? 4 : 1;
  const salvos = 128;
  for (let salvo = 0; salvo < salvos; salvo++) {
    const phase = random() * ECM.interval;
    const orbitPhase = random() * Math.PI * 2;
    const bearing = random() * Math.PI * 2;
    const range = 700 + random() * 400;
    const targetAt = (time: number): Vector2 =>
      speed === 0
        ? [0, 0]
        : [
            150 * Math.cos(orbitPhase + (time * speed) / 150),
            150 * Math.sin(orbitPhase + (time * speed) / 150),
          ];
    for (let tube = 0; tube < tubes; tube++) {
      const launch = tube * 0.2;
      let pos: Vector2 = [Math.cos(bearing) * range, Math.sin(bearing) * range];
      const target = targetAt(launch);
      let heading = Math.atan2(target[1] - pos[1], target[0] - pos[0]) + (random() - 0.5) * 0.15;
      let jamUntil = -1;
      let touched = false;
      let hit = false;
      const fuel = weapon.fuelDuration ?? 5;
      for (let tick = 0; tick < Math.round(fuel / DT); tick++) {
        const time = launch + tick * DT;
        const oldTarget = targetAt(time);
        const nextTarget = targetAt(time + DT);
        const pulse =
          Math.floor((time + phase) / ECM.interval) !==
          Math.floor((time + phase + DT) / ECM.interval);
        if (penalty > 0 && pulse && Math.hypot(...pos) <= ECM.range) {
          jamUntil = time + ECM.duration;
          touched = true;
        }
        const diff = normalizeAngle(
          Math.atan2(oldTarget[1] - pos[1], oldTarget[0] - pos[0]) - heading,
        );
        if (kind === "quiver" || Math.abs(diff) < Math.PI / 3) {
          const turn = (kind === "quiver" ? 2.5 : 0.8) * (time < jamUntil ? 1 - penalty : 1) * DT;
          heading += clamp(diff, -turn, turn);
        }
        const next: Vector2 = [
          pos[0] + Math.cos(heading) * weapon.projectileSpeed * DT,
          pos[1] + Math.sin(heading) * weapon.projectileSpeed * DT,
        ];
        // Always-active frigate shield envelope, radius 32 * 1.4; no damage depletion.
        if (
          sweptHit(
            [pos[0] - oldTarget[0], pos[1] - oldTarget[1]],
            [next[0] - nextTarget[0], next[1] - nextTarget[1]],
            tender.size * 1.4,
          ) !== null
        ) {
          hit = true;
          break;
        }
        pos = next;
      }
      hits += Number(hit);
      affected += Number(touched);
    }
  }
  const launched = salvos * tubes;
  assert.ok(hits <= launched && affected <= launched);
  return {
    kind,
    seed,
    penalty,
    speed,
    salvos,
    launched,
    hits,
    misses: launched - hits,
    affected,
    interceptions: 0,
    missPercent: (100 * (launched - hits)) / launched,
  };
}

function ehp(profile: HullProfile, weapon: WeaponDefinition) {
  return (
    profile.shieldMax / weapon.shieldMultiplier +
    (profile.armorMax * (weapon.damage + profile.armorRating)) /
      (weapon.damage * weapon.armorMultiplier) +
    profile.hullMax / weapon.hullMultiplier
  );
}

const started = performance.now();
const pair = [
  ship(tender, "missile_frigate", "tenderA", 0),
  ship(tender, "missile_frigate", "tenderB", 0),
];
for (const target of pair) target.shieldCurrent = 0;
for (let tick = 0; tick < CAP / DT; tick++)
  for (const target of pair) assert.equal(transfer(target, true, tick, true), 0);
assert.deepEqual(
  pair.map((target) => target.shieldCurrent),
  [0, 0],
);
const combatResults: ReturnType<typeof combat>[] = [];
for (const seed of SEEDS) {
  for (const target of ["cruiser", "battleship"] as const) {
    for (const beam of [false, true]) combatResults.push(combat(target, "none", 0, seed, beam, 0));
    for (const [threat, count] of [
      ["none", 0],
      ["quiver", 1],
      ["quiver", 2],
      ["raider", 2],
      ["raider", 4],
    ] as const) {
      for (const beam of [false, true])
        combatResults.push(combat(target, threat, count, seed, beam));
    }
  }
  for (const [threat, count] of [
    ["escort", 2],
    ["quiver", 2],
    ["raider", 4],
    ["cruiser", 1],
    ["battleship", 1],
  ] as const) {
    for (const beam of [false, true])
      combatResults.push(combat("tender", threat, count, seed, beam));
  }
}
// Cross-heal denial must produce identical outcomes, not merely survive a bounded run.
for (let i = 0; i < combatResults.length; i += 2) {
  const a = combatResults[i];
  const b = combatResults[i + 1];
  if (a.targetKind === "tender") assert.deepEqual({ ...a, beam: true }, b);
}
const missileResults: ReturnType<typeof missiles>[] = [];
for (const seed of SEEDS)
  for (const kind of ["quiver", "torpedo"] as const)
    for (const speed of [0, 75, 175])
      for (const penalty of [0, 0.35, ECM.penalty, 0.5])
        missileResults.push(missiles(kind, seed, penalty, speed));

const anchors = ["missile_frigate", "cruiser", "battleship"] as const;
const neutral = {
  ...HULL_PROFILES.strike_craft.turrets[0].weapon,
  damage: 100,
  shieldMultiplier: 1,
  armorMultiplier: 1,
  hullMultiplier: 1,
};
const economics = [tender, ...anchors.map((key) => HULL_PROFILES[key])].map((profile) => ({
  name: profile.name,
  cost: profile.cost,
  neutral100Ehp: ehp(profile, neutral),
  ehpPerCr: ehp(profile, neutral) / profile.cost,
}));
const hashes = Object.fromEntries(
  ["shipProfiles", "projectileEngine", "shipWeaponSystem", "simulation", "shieldHaven"].map(
    (name) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL(`../src/engine/${name}.ts`, import.meta.url)))
        .digest("hex"),
    ],
  ),
);
const output = {
  seeds: SEEDS,
  dt: DT,
  cap: CAP,
  beam: BEAM,
  ecm: ECM,
  tender,
  hashes,
  economics,
  combatResults,
  missileResults,
  wallSeconds: (performance.now() - started) / 1000,
};
if (process.argv.includes("--json")) console.log(JSON.stringify(output, null, 2));
else {
  console.log(JSON.stringify({ economics, hashes, wallSeconds: output.wallSeconds }));
  const round = (n: number | null) => (n === null ? null : +n.toFixed(2));
  for (const row of combatResults.filter((r) => r.seed === 1)) {
    const runs = combatResults.filter(
      (r) =>
        r.targetKind === row.targetKind &&
        r.threat === row.threat &&
        r.count === row.count &&
        r.beam === row.beam &&
        r.initialFraction === row.initialFraction,
    );
    console.log(
      JSON.stringify({
        case: `${row.targetKind}/${row.threat}/${row.count}/${row.beam}/${row.initialFraction}`,
        full: runs.map((r) => round(r.fullAt)),
        death: runs.map((r) => round(r.deathAt)),
        shield: runs.map((r) => round(r.endShield)),
        supplied: runs.map((r) => round(r.supplied)),
        intercepted: runs.map((r) => r.pdInterceptions),
      }),
    );
  }
  for (const row of missileResults.filter((r) => r.seed === 1)) {
    const runs = missileResults.filter(
      (r) => r.kind === row.kind && r.speed === row.speed && r.penalty === row.penalty,
    );
    console.log(
      JSON.stringify({
        case: `${row.kind}/${row.speed}/${row.penalty}`,
        misses: runs.map((r) => r.misses),
        affected: runs.map((r) => r.affected),
        launchedPerSeed: row.launched,
      }),
    );
  }
}
