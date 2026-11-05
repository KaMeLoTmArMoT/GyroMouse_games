import type { HullClass, ShipState } from "../types/combat";
import type { TelemetryReport } from "./combatTelemetry";
import { buildFleetFromSlots, type FleetSlot } from "./fleetBuilder";
import { FLEET_PRESETS } from "./fleetPresets";

export interface FleetComposition {
  hullClass: HullClass;
  count: number;
  groupId: number;
}
export interface MatchupExpectation {
  id: string;
  severity: "soft" | "hard";
  status: "design-hypothesis" | "existing-regression" | "measured-baseline";
  rationale: string;
}
export interface ScenarioDefinition {
  id: string;
  version: number;
  label: string;
  tags: string[];
  blue: FleetComposition[];
  red: FleetComposition[];
  durationLimit: number;
  expectations: MatchupExpectation[];
}
export interface ScenarioResult {
  id: string;
  scenarioVersion: number;
  label: string;
  seed: number | null;
  outcome: "blue" | "red" | "mutual" | "timeout" | "invalid";
  duration: number;
  survivors: [number, number];
  residualHpPercent: [number, number];
  speed: number;
  layout: ShipState[];
  telemetry: TelemetryReport;
  alerts: string[];
}

const classes: Array<{ code: string; hullClass: HullClass }> = [
  { code: "bb", hullClass: "battleship" },
  { code: "cr", hullClass: "cruiser" },
  { code: "cv", hullClass: "corvette" },
  { code: "sc", hullClass: "strike_craft" },
];
const fleet = (hullClass: HullClass, count: number, groupId = 1): FleetComposition => ({
  hullClass,
  count,
  groupId,
});
const matrix: ScenarioDefinition[] = classes.flatMap((blue) =>
  classes.map((red) => ({
    id: `3${blue.code}-vs-3${red.code}`,
    version: 1,
    label: `3 ${blue.code.toUpperCase()} vs 3 ${red.code.toUpperCase()}`,
    tags: blue === red ? ["golden", "smoke", "mirror"] : ["golden"],
    blue: [fleet(blue.hullClass, 3)],
    red: [fleet(red.hullClass, 3)],
    durationLimit: 180,
    expectations: [],
  })),
);

// Candidate encounters from plan §5; outcomes remain balance hypotheses.
const curated: ScenarioDefinition[] = [
  {
    id: "combined",
    blue: [fleet("cruiser", 3, 1), fleet("corvette", 2, 2), fleet("strike_craft", 5, 3)],
  },
  {
    id: "test_3_cruisers",
    blue: [fleet("battleship", 1)],
  },
  {
    id: "split_spear",
    blue: [fleet("battleship", 1, 1), fleet("corvette", 2, 2), fleet("strike_craft", 2, 3)],
  },
  {
    id: "glass_hammer",
    blue: [fleet("cruiser", 2, 1), fleet("corvette", 4, 2), fleet("strike_craft", 6, 3)],
  },
  {
    id: "needle_cloud",
    blue: [fleet("cruiser", 3, 1), fleet("strike_craft", 2, 2)],
  },
  {
    id: "picket_gambit",
    blue: [fleet("cruiser", 2, 1), fleet("corvette", 2, 2), fleet("strike_craft", 6, 3)],
  },
].map(({ id, blue }) => {
  const preset = FLEET_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Missing curated fleet preset: ${id}`);
  const isThreeKnives = id === "test_3_cruisers";
  return {
    // Preserve the existing costly-duel regression ID and smoke coverage.
    id: isThreeKnives ? "1bb-vs-3cr" : id,
    version: 1,
    label: `${preset.name} (suggested Blue vs Red)`,
    tags: isThreeKnives ? ["curated", "budget", "smoke"] : ["curated", "budget"],
    blue,
    red: preset.composition,
    durationLimit: 180,
    expectations: [],
  };
});

export const SCENARIOS: ScenarioDefinition[] = [
  ...matrix,
  ...curated,
  {
    id: "3cv-vs-1cr",
    version: 1,
    label: "3 CV vs 1 CR",
    tags: ["budget"],
    blue: [fleet("corvette", 3)],
    red: [fleet("cruiser", 1)],
    durationLimit: 180,
    expectations: [],
  },
  {
    id: "9cv-vs-26sc",
    version: 1,
    label: "9 CV vs 26 SC",
    tags: ["budget", "stress"],
    blue: [fleet("corvette", 9)],
    red: [fleet("strike_craft", 26)],
    durationLimit: 180,
    expectations: [],
  },
  {
    id: "1bb-vs-27sc",
    version: 1,
    label: "1 BB vs 27 SC",
    tags: ["budget", "stress"],
    blue: [fleet("battleship", 1)],
    red: [fleet("strike_craft", 27)],
    durationLimit: 180,
    expectations: [],
  },
  {
    id: "swarm60-triple",
    version: 1,
    label: "60 SC vs Triple Threat",
    tags: ["stress"],
    blue: [
      fleet("strike_craft", 20, 1),
      fleet("strike_craft", 20, 2),
      fleet("strike_craft", 20, 3),
    ],
    red: [
      fleet("battleship", 3, 1),
      fleet("cruiser", 3, 2),
      fleet("corvette", 3, 3),
      fleet("strike_craft", 3, 4),
    ],
    durationLimit: 180,
    expectations: [],
  },
];

/** The seed perturbs only initial y coordinates, by at most two units (LCG v1). */
export interface ScenarioAssemblyOptions {
  spawn?: number;
  expandedSpacing?: boolean;
}

export function assembleScenario(
  scenario: ScenarioDefinition,
  seed?: number,
  options: ScenarioAssemblyOptions = {},
): ShipState[] {
  const slots = (composition: FleetComposition[]): FleetSlot[] =>
    composition.flatMap((entry, index) =>
      Array.from({ length: entry.count }, (_, i) => ({
        id: `${index}-${i}`,
        hullClass: entry.hullClass,
        groupId: entry.groupId,
      })),
    );
  const ships = [
    ...buildFleetFromSlots(
      slots(scenario.blue),
      0,
      -(options.spawn ?? 1100),
      0,
      options.expandedSpacing,
    ),
    ...buildFleetFromSlots(
      slots(scenario.red),
      1,
      options.spawn ?? 1100,
      Math.PI,
      options.expandedSpacing,
    ),
  ];
  if (seed !== undefined) {
    let state = seed >>> 0;
    for (const ship of ships) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      ship.pos[1] += (state / 0x100000000 - 0.5) * 4;
    }
  }
  return ships;
}
