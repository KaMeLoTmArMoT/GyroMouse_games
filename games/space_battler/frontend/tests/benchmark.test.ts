import { describe, expect, it } from "vitest";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { assembleScenario, SCENARIOS } from "../src/engine/scenarios";
import { ClientCombatSimulation } from "../src/engine/simulation";

describe("headless benchmark", () => {
  it("enumerates ordered matchups and assembles deterministic seeded layouts", () => {
    const matrix = SCENARIOS.filter((scenario) => scenario.tags.includes("golden"));
    expect(matrix).toHaveLength(36);
    expect(new Set(matrix.map((scenario) => scenario.id)).size).toBe(36);
    const scenario = matrix[0];
    expect(assembleScenario(scenario, 42)).toEqual(assembleScenario(scenario, 42));
    expect(assembleScenario(scenario, 42)).not.toEqual(assembleScenario(scenario, 43));
    expect(assembleScenario(scenario)).toHaveLength(6);
  });

  it("preserves combat outcomes and reconciles unrounded weapon damage and regeneration", () => {
    const scenario = SCENARIOS.find((entry) => entry.id === "1bb-vs-3cr");
    if (!scenario) throw new Error("Missing scenario");
    const run = (observed: boolean) => {
      const ships = assembleScenario(scenario);
      const initial = structuredClone(ships);
      const sim = new ClientCombatSimulation();
      for (const ship of ships) sim.addShip(ship);
      const telemetry = new CombatTelemetry(ships);
      if (observed) sim.observer = telemetry;
      // Use Vitest's verbose reporter to display profiling output for passing tests.
      if (process.env.PROFILING === "true") {
        const ticks: { duration: number; ships: number; projectiles: number; debris: number }[] =
          [];
        for (let tick = 0; tick < 3600; tick++) {
          const ships = sim.ships.filter((ship) => ship.isAlive && !ship.isDebris).length;
          const debris = sim.ships.filter((ship) => ship.isAlive && ship.isDebris).length;
          const projectiles = sim.projectiles.length;
          const start = performance.now();
          sim.update(1 / 60);
          ticks.push({ duration: performance.now() - start, ships, projectiles, debris });
        }
        const durations = ticks.map((tick) => tick.duration).sort((a, b) => a - b);
        const percentile = (p: number) => durations[Math.ceil(p * durations.length) - 1];
        const middle = durations.length / 2;
        const median = (durations[middle - 1] + durations[middle]) / 2;
        console.log(`Tick profile (${observed ? "observed" : "plain"}, ms):`, {
          median,
          p95: percentile(0.95),
          worst1Percent: percentile(0.99), // 99th-percentile duration: threshold for slowest 1%.
        });
        for (const [index, tick] of ticks.entries()) {
          if (tick.duration > 3 * median) console.log(`Tick spike ${index}:`, tick);
        }
      } else {
        for (let tick = 0; tick < 3600; tick++) sim.update(1 / 60);
      }
      return { ships, initial, stats: sim.stats, telemetry };
    };
    const observed = run(true);
    const plain = run(false);
    expect(observed.ships).toEqual(plain.ships);
    expect(observed.stats).toEqual(plain.stats);
    expect(observed.telemetry.firstShot).not.toBeNull();
    expect(observed.telemetry.errors).toEqual([]);
    const report = observed.telemetry.report();
    expect(report.damage.length).toBeGreaterThan(0);
    expect(report.damage.some((entry) => entry.sourceId && entry.mountId)).toBe(true);
    for (const ship of observed.ships) {
      const initial = observed.initial.find((entry) => entry.id === ship.id);
      if (!initial) throw new Error("Missing initial state");
      const records = report.damage.filter((entry) => entry.targetId === ship.id);
      for (const layer of ["shield", "armor", "hull"] as const) {
        const regen = layer === "shield" ? (report.shieldRegenerated[ship.id] ?? 0) : 0;
        const damage = records.reduce((sum, record) => sum + record[layer], 0);
        expect(initial[`${layer}Current`] + regen - damage).toBeCloseTo(ship[`${layer}Current`], 5);
      }
    }
  });

  it("records the complete lethal hull loss during capital contact", () => {
    const fighter = buildFleetFromSlots(
      [{ id: "f", hullClass: "strike_craft", groupId: 1 }],
      0,
      0,
      0,
    )[0];
    const capital = buildFleetFromSlots(
      [{ id: "b", hullClass: "battleship", groupId: 1 }],
      1,
      0,
      Math.PI,
    )[0];
    fighter.pos = [30, 0];
    capital.pos = [0, 0];
    const sim = new ClientCombatSimulation();
    sim.addShip(fighter);
    sim.addShip(capital);
    const observer = new CombatTelemetry(sim.ships);
    sim.observer = observer;
    sim.update(1 / 60);
    expect(fighter.isAlive).toBe(false);
    expect(observer.ramProximityPairTicks).toBeGreaterThan(0);
    expect(
      observer
        .report()
        .damage.find((entry) => entry.targetId === fighter.id && entry.weapon === "ram")?.hull,
    ).toBe(fighter.hullMax);
  });

  it("requires two low-progress windows before flagging a no-fire stall", () => {
    const scenario = SCENARIOS[0];
    const ships = assembleScenario(scenario);
    const observer = new CombatTelemetry(ships);
    observer.onTick(20, 1 / 60, ships, []);
    expect(observer.stalls).toEqual([]);
    observer.onTick(40, 1 / 60, ships, []);
    expect(observer.stalls).toEqual([{ time: 40, kind: "no-fire" }]);
  });

  it("counts boundary entries and ready broadside tracking opportunities", () => {
    const ships = assembleScenario(SCENARIOS[0]);
    const observer = new CombatTelemetry(ships);
    const ship = ships[0];
    const battery = ship.turrets.find((mount) => mount.id.endsWith("_port"));
    if (!battery) throw new Error("Missing port battery");
    observer.onMountDecision(ship, battery, true, false, 0.5);
    observer.onMountDecision(ship, battery, true, false, 0.5);
    expect(observer.batteries[battery.id].longestReadyTrackingSeconds).toBe(1);
    observer.onShot(1, ship, battery);
    expect(observer.batteries[battery.id].shots).toBe(1);
    ship.pos = [2300, 0];
    observer.onTick(1, 0.5, ships, []);
    observer.onTick(1.5, 0.5, ships, []);
    expect(observer.maxRadius).toBe(2300);
    expect(observer.hardPullEntries).toBe(1);
    expect(observer.shipSecondsOutsideHardPull).toBe(1);
  });
});
