import { describe, expect, it } from "vitest";
import { compareGolden, DRIFT_SEEDS, type GoldenBaseline, runLayerA } from "../bench/drift";

function baseline(): GoldenBaseline {
  return {
    version: 1,
    step: 1 / 60,
    seeds: DRIFT_SEEDS,
    layerA: {
      gunDps: { gun: 100 },
      flakInterceptRate: 0.8,
      shieldDelay: { cruiser: 1.2 },
      shieldRegen: { cruiser: 25 },
    },
    layerB: [
      {
        id: "asymmetric",
        scenarioVersion: 1,
        seed: 1,
        outcome: "blue",
        duration: 100,
        residualHpPercent: [40, 0],
      },
    ],
  };
}

describe("anti-drift guardrails", () => {
  it("isolates direct gun DPS from fighter mission cycles and measures the fixed salvo and defenses", () => {
    const fixtures = runLayerA();
    const expectedDps = {
      blue_bb_0_spinal: 300 / 3.5,
      blue_bb_0_port: 75 / 1.2,
      blue_bb_0_stbd: 75 / 1.2,
      blue_cr_0_laser: 45 / 1.2,
      blue_cr_0_torp: (220 * 1.8) / 5.5,
      blue_sc_0_gun: (120 * 1.5) / 3,
    };
    for (const [id, expected] of Object.entries(expectedDps))
      expect(Math.abs(fixtures.gunDps[id] / expected - 1)).toBeLessThanOrEqual(0.03);
    expect(fixtures.flakInterceptRate).toBe(0.8);
    for (const [hull, delay] of Object.entries({
      battleship: 1.5,
      cruiser: 1.2,
      corvette: 3.5,
      strike_craft: 3.5,
    }))
      expect(Math.abs(fixtures.shieldDelay[hull] - delay)).toBeLessThanOrEqual(2 / 60 + 1e-8);
    for (const [hull, rate] of Object.entries({
      battleship: 50,
      cruiser: 25,
      corvette: 15,
      strike_craft: 10,
    }))
      expect(fixtures.shieldRegen[hull]).toBeCloseTo(rate);
  });

  it("accepts the inclusive DPS, delay, duration and percentage-point tolerances", () => {
    const golden = baseline();
    const actual = baseline();
    actual.layerA.gunDps.gun = 103;
    actual.layerA.shieldDelay.cruiser += 1 / 60;
    actual.layerA.shieldRegen.cruiser *= 0.97;
    actual.layerB[0].duration = 110;
    actual.layerB[0].residualHpPercent = [35, 5];
    expect(compareGolden(actual, golden)).toEqual([]);
  });

  it.each([
    "DPS",
    "flak",
    "delay",
    "regen",
    "duration",
    "HP",
    "asymmetry",
    "coverage",
    "nonfinite",
  ])("rejects %s regression without averaging it away", (metric) => {
    const golden = baseline();
    const actual = baseline();
    if (metric === "DPS") actual.layerA.gunDps.gun = 103.01;
    if (metric === "flak") actual.layerA.flakInterceptRate = 0.7;
    if (metric === "delay") actual.layerA.shieldDelay.cruiser += 2 / 60;
    if (metric === "regen") actual.layerA.shieldRegen.cruiser *= 0.96;
    if (metric === "duration") actual.layerB[0].duration = 110.01;
    if (metric === "HP") actual.layerB[0].residualHpPercent[0] = 34.99;
    if (metric === "asymmetry") actual.layerB[0].residualHpPercent = [0, 40];
    if (metric === "coverage") actual.layerB[0].seed = 7;
    if (metric === "nonfinite") actual.layerB[0].duration = Number.NaN;
    expect(compareGolden(actual, golden).length).toBeGreaterThan(0);
  });
});
