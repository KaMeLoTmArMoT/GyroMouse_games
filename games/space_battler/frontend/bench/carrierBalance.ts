// Research-only carrier surrogate; runtime profiles and combat rules are never changed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { HULL_PROFILES, instantiateTurrets, type HullProfile } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ShipState, Vector2, WeaponDefinition } from "../src/types/combat";

const STEP = 1 / 60;
const CAP = 120;
const seeds = [1, 7, 42, 2026];
const flak = structuredClone(HULL_PROFILES.corvette.turrets[0].weapon);
const laser: WeaponDefinition = {
  ...flak, name: "Research Light Defense Laser", flak: undefined,
  damage: 110, cooldown: 0, projectileSpeed: 0, cost: 125,
};
// A twin mount is represented by two alternating barrels: 15 damage every 0.15s.
const autocannon: WeaponDefinition = {
  ...flak, name: "Research Twin Autocannon", flak: undefined,
  damage: 15, cooldown: 0.15, cost: 150,
};
const batteries = {
  none: [], A: [flak, laser], B: [flak, laser, laser],
  C: [flak, autocannon, autocannon], D: [flak, laser, laser, laser],
} satisfies Record<string, WeaponDefinition[]>;
type Loadout = keyof typeof batteries;
const carrier: HullProfile = {
  name: "Research Fleet Carrier", role: "Fleet aviation support", desc: "Empty hangar test hull",
  cost: 2900, size: 80, speed: 32, turnRate: 0.3, turnRateDisplay: "0.30 rad/s",
  shieldMax: 1600, shieldRegen: 30, shieldRechargeDelay: 3,
  armorMax: 1200, armorRating: 45, hullMax: 2400, turrets: [],
};
const bomber: HullProfile = {
  ...HULL_PROFILES.strike_craft, name: "Research heavy-torpedo bomber proxy",
  speed: 200, turnRate: 2.5,
  turrets: [{ ...HULL_PROFILES.strike_craft.turrets[0], weapon: {
    ...HULL_PROFILES.cruiser.turrets[1].weapon, range: 550,
  } }],
};

function makeShip(profile: HullProfile, hullClass: HullClass, id: string, team: number,
  pos: Vector2, heading: number): ShipState {
  return {
    id, name: profile.name, hullClass, team, groupId: team + 1,
    pos, velocity: [0, 0], heading, maxSpeed: profile.speed, turnRate: profile.turnRate,
    size: profile.size, cost: profile.cost,
    shieldMax: profile.shieldMax, shieldCurrent: profile.shieldMax,
    shieldRegen: profile.shieldRegen, shieldRechargeDelay: profile.shieldRechargeDelay,
    shieldDelayTimer: 0, armorMax: profile.armorMax, armorCurrent: profile.armorMax,
    armorRating: profile.armorRating, hullMax: profile.hullMax, hullCurrent: profile.hullMax,
    turrets: instantiateTurrets(profile, id, 0), isAlive: true,
  };
}
type Threat = "quiver" | "torpedo" | "interceptor" | "bomber";
function run(loadout: Loadout, threat: Threat, count: number, seed: number, escorts = 0) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const sim = new ClientCombatSimulation();
  const target = makeShip(carrier, "battleship", "carrier", 0, [0, 0], 0);
  target.maxSpeed = target.turnRate = 0;
  const offsets: Vector2[] = [[0, 0], [24, -24], [-24, 24], [-24, -24]];
  target.turrets = batteries[loadout].map((weapon, index) => ({
    ...instantiateTurrets(HULL_PROFILES.corvette, target.id, 0)[0],
    id: `carrier_pd${index}`, offset: offsets[index], weapon: structuredClone(weapon),
    cooldownTimer: index * 0.05,
  }));
  sim.addShip(target);
  for (let i = 0; i < escorts; i++) {
    const escort = makeShip(HULL_PROFILES.corvette, "corvette", `escort${i}`, 0,
      [150, (i === 0 ? -1 : 1) * 160], 0);
    escort.flagshipId = target.id;
    sim.addShip(escort);
  }
  const fighter = threat === "interceptor" || threat === "bomber";
  for (let i = 0; i < count; i++) {
    const angle = fighter ? 0 : (i / Math.max(1, count - 1) - 0.5) * Math.PI * 2 / 3;
    const pos: Vector2 = fighter
      ? [850 + random() * 60, (i - (count - 1) / 2) * 45 + (random() - 0.5) * 20]
      : [Math.cos(angle) * 1000, Math.sin(angle) * 1000 + (random() - 0.5) * 30];
    const profile = threat === "quiver" ? HULL_PROFILES.missile_frigate
      : threat === "torpedo" ? HULL_PROFILES.cruiser
      : threat === "bomber" ? bomber : HULL_PROFILES.strike_craft;
    const enemy = makeShip(profile, fighter ? "strike_craft"
      : threat === "quiver" ? "missile_frigate" : "cruiser", `enemy${i}`, 1,
      pos, Math.atan2(-pos[1], -pos[0]));
    if (!fighter) enemy.maxSpeed = enemy.turnRate = 0;
    if (threat === "torpedo") enemy.turrets = [enemy.turrets[1]];
    sim.addShip(enemy);
  }
  const telemetry = new CombatTelemetry(sim.ships);
  let launched = 0;
  let firstHull: number | null = null;
  let firstShieldBreak: number | null = null;
  let minShield = target.shieldMax;
  let shieldIntegral = 0;
  const onShot = telemetry.onShot.bind(telemetry);
  telemetry.onShot = (time, ship, mount) => {
    onShot(time, ship, mount);
    if (ship.team === 1 && mount.weapon.weaponType === "missile") launched++;
  };
  const onDamage = telemetry.onDamage.bind(telemetry);
  telemetry.onDamage = (...args) => {
    onDamage(...args);
    if (args[0].id !== target.id) return;
    if (target.hullCurrent < target.hullMax) firstHull ??= sim.timeElapsed;
    if (target.shieldCurrent <= 1e-9) firstShieldBreak ??= sim.timeElapsed;
    minShield = Math.min(minShield, target.shieldCurrent);
  };
  sim.observer = telemetry;
  let death: number | null = null;
  for (let tick = 0; tick < CAP / STEP; tick++) {
    sim.update(STEP);
    shieldIntegral += target.shieldCurrent * STEP;
    if (!target.isAlive) { death = sim.timeElapsed; break; }
    if (!sim.ships.some((ship) => ship.team === 1 && ship.isAlive)) break;
  }
  const report = telemetry.report();
  assert.deepEqual(report.errors, []);
  // Check every layer against the engine's event stream, including collateral and regeneration.
  for (const ship of sim.ships) {
    for (const layer of ["shield", "armor", "hull"] as const) {
      const loss = report.damage.filter((event) => event.targetId === ship.id)
        .reduce((sum, event) => sum + event[layer], 0);
      const regen = layer === "shield" ? (report.shieldRegenerated[ship.id] ?? 0) : 0;
      assert.ok(Math.abs(ship[`${layer}Max`] + regen - loss - ship[`${layer}Current`]) < 1e-5);
    }
  }
  const inFlight = sim.projectiles.filter((p) => p.ownerTeam === 1 && p.weaponType === "missile").length;
  const intercepted = sim.stats[0].missilesIntercepted;
  assert.ok(intercepted <= launched - inFlight);
  return {
    loadout, threat, count, seed, escorts, seconds: sim.timeElapsed, death,
    launched, inFlight, intercepted,
    interceptionRate: launched > inFlight ? intercepted / (launched - inFlight) : null,
    firstShieldBreak: firstShieldBreak as number | null, firstHull: firstHull as number | null,
    minShield, endShield: target.shieldCurrent,
    meanShield: shieldIntegral / sim.timeElapsed,
    endArmor: target.armorCurrent, endHull: target.hullCurrent,
    enemySurvivors: sim.ships.filter((ship) => ship.team === 1 && ship.isAlive).length,
    escortSurvivors: sim.ships.filter((ship) => ship.id.startsWith("escort") && ship.isAlive).length,
    carrierDamage: report.damage.filter((event) => event.targetId === target.id),
    regenerated: report.shieldRegenerated[target.id] ?? 0, errors: report.errors,
  };
}

function ehp(profile: HullProfile, damage = 100, shield = 1, armor = 1, hull = 1) {
  return profile.shieldMax / shield + profile.armorMax * (damage + profile.armorRating) /
    (armor * damage) + profile.hullMax / hull;
}
const suite = process.argv[2] ?? "missiles";
assert.ok(["missiles", "fighters", "escorts"].includes(suite));
const paths = readdirSync(new URL("../src/engine/", import.meta.url))
  .filter((name) => name.endsWith(".ts")).map((name) => name.slice(0, -3)).sort();
const hashes = () => Object.fromEntries(paths.map((path) => [path,
  createHash("sha256").update(readFileSync(new URL(`../src/engine/${path}.ts`, import.meta.url))).digest("hex")]));
const before = hashes();
const results: ReturnType<typeof run>[] = [];
const started = performance.now();
const threats: Array<[Threat, number]> = suite === "missiles"
  ? [["quiver", 2], ["quiver", 3], ["quiver", 4], ["torpedo", 2], ["torpedo", 4]]
  : suite === "fighters"
    ? [["interceptor", 10], ["interceptor", 20], ["bomber", 10], ["bomber", 20]]
    : [["quiver", 4], ["torpedo", 4], ["interceptor", 20], ["bomber", 20]];
for (const loadout of suite === "escorts" ? ["B"] as const : Object.keys(batteries) as Loadout[]) {
  for (const [threat, count] of threats) {
    for (const escorts of suite === "escorts" ? [1, 2] : [0]) {
      const runs = seeds.map((seed) => run(loadout, threat, count, seed, escorts));
      results.push(...runs);
      console.log(JSON.stringify({ loadout, threat, count, escorts,
        alive: runs.filter((r) => r.death === null).length,
        intercept: runs.map((r) => r.interceptionRate === null ? null : +(100 * r.interceptionRate).toFixed(1)),
        shield: runs.map((r) => +r.endShield.toFixed(0)),
        hullAt: runs.map((r) => r.firstHull === null ? null : +r.firstHull.toFixed(1)),
        death: runs.map((r) => r.death === null ? null : +r.death.toFixed(1)),
        enemies: runs.map((r) => r.enemySurvivors) }));
      const mean = (values: number[]) => values.length
        ? +(values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2) : null;
      console.log(JSON.stringify({ summary: `${loadout}/${threat}/${count}/escort${escorts}`,
        interceptMeanPercent: mean(runs.flatMap((r) => r.interceptionRate === null ? [] : [100 * r.interceptionRate])),
        endShieldMean: mean(runs.map((r) => r.endShield)),
        minimumShieldMean: mean(runs.map((r) => r.minShield)),
        firstShieldBreak: runs.map((r) => r.firstShieldBreak === null ? null : +r.firstShieldBreak.toFixed(2)),
        meanHullOnsetObserved: mean(runs.flatMap((r) => r.firstHull === null ? [] : [r.firstHull])),
        meanDeathObserved: mean(runs.flatMap((r) => r.death === null ? [] : [r.death])) }));
    }
  }
}
const after = hashes();
assert.deepEqual(after, before, "Engine changed during benchmark; rerun for a consistent snapshot");
const anchors = [["cruiser", 1400], ["battleship", 2800], ["dreadnought", 3600]] as const;
const economics = anchors.map(([key, price]) => ({
  key, price, livePrice: HULL_PROFILES[key].cost, ehp: ehp(HULL_PROFILES[key]),
  weaponCost: HULL_PROFILES[key].turrets.reduce((sum, mount) => sum + mount.weapon.cost, 0),
}));
const hullRate = economics.reduce((sum, p) => sum + p.price - p.weaponCost, 0) /
  economics.reduce((sum, p) => sum + p.ehp, 0);
const output = {
  generatedAt: new Date().toISOString(), node: process.version, suite, cap: CAP, step: STEP, seeds,
  wallSeconds: (performance.now() - started) / 1000, hashes: before,
  harnessHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  assumptions: "Carrier uses stationary battleship class surrogate for capital targeting/shield geometry. No hangar or fabrication. Missile launchers stationary at 1000u across 120deg; craft use live moving-wing AI. Bomber is explicitly hypothetical. Null survival times are right-censored. Interception denominator excludes still-flying missiles, includes expired/missed missiles.",
  carrier, bomber, batteries, economics, hullRate, carrierHullPrice: hullRate * ehp(carrier),
  carrierEhp: { neutral100: ehp(carrier), quiver: ehp(carrier, 36, 2, 0.65, 0.8),
    plasma: ehp(carrier, 120, 1, 1.1, 1.5), torpedo: ehp(carrier, 220, 1, 1.8, 1.8) }, results,
};
writeFileSync(new URL(`./results/carrier-balance-${suite}.json`, import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Completed ${results.length} runs in ${output.wallSeconds.toFixed(1)}s; hull CR/EHP ${hullRate}; carrier hull ${output.carrierHullPrice}`);
