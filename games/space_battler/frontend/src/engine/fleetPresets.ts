// Preset adversary fleets for testing tactical doctrine counters

import type { HullClass } from "../types/combat";

export interface FleetPreset {
  id: string;
  name: string;
  description: string;
  budget: number;
  composition: { hullClass: HullClass; count: number; groupId: number }[];
}

export const FLEET_PRESETS: FleetPreset[] = [
  // --- Standard Combined Arms ---
  {
    id: "combined",
    name: "Task Force (1 BS + 2 CV + 6 SC)",
    description: "1 Battleship + 2 PD Corvettes + 6 Fighters. Balanced combined-arms fleet.",
    budget: 4620,
    composition: [
      { hullClass: "battleship", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 2, groupId: 2 },
      { hullClass: "strike_craft", count: 6, groupId: 3 },
    ],
  },

  // --- Strict 3-Ship Variation Matchups for Benchmarking ---
  {
    id: "test_3_battleships",
    name: "Dreadnought Line (3x Battleships)",
    description: "3 Leviathan Battleships. Heavy railguns and dual broadsides (9,600 CR).",
    budget: 9600,
    composition: [{ hullClass: "battleship", count: 3, groupId: 1 }],
  },
  {
    id: "test_3_cruisers",
    name: "Cruiser Squadron (3x Cruisers)",
    description: "3 Vanguard Cruisers with prow heavy torpedoes and beam turrets (3,300 CR).",
    budget: 3300,
    composition: [{ hullClass: "cruiser", count: 3, groupId: 1 }],
  },
  {
    id: "test_3_corvettes",
    name: "Aegis Flak Picket (3x Corvettes)",
    description: "3 Aegis Corvettes with rapid point defense flak cannons (1,050 CR).",
    budget: 1050,
    composition: [{ hullClass: "corvette", count: 3, groupId: 1 }],
  },
  {
    id: "test_3_fighters",
    name: "Scout Flight (3x Fighters)",
    description: "3 Raider Interceptors for small-scale skirmish testing (360 CR).",
    budget: 360,
    composition: [{ hullClass: "strike_craft", count: 3, groupId: 1 }],
  },
  {
    id: "test_12_fighters",
    name: "Interceptor Wings (12x Fighters)",
    description: "12 Raider Interceptors in 4 tactical wings (1,440 CR).",
    budget: 1440,
    composition: [{ hullClass: "strike_craft", count: 12, groupId: 1 }],
  },
  {
    id: "test_30_fighters",
    name: "Raider Swarm (30x Fighters)",
    description: "Massive 30-fighter swarm. Overwhelms unescorted capitals (3,600 CR).",
    budget: 3600,
    composition: [{ hullClass: "strike_craft", count: 30, groupId: 1 }],
  },

  // --- Mixed Multi-Class 3-Ship Test Scenarios ---
  {
    id: "test_3cr_3cv",
    name: "Cruiser-Corvette Flotilla (3 CR + 3 CV)",
    description: "3 Cruisers screened by 3 Corvettes (4,350 CR).",
    budget: 4350,
    composition: [
      { hullClass: "cruiser", count: 3, groupId: 1 },
      { hullClass: "corvette", count: 3, groupId: 2 },
    ],
  },
  {
    id: "test_3bs_3cr",
    name: "Heavy Battlefleet (3 BS + 3 CR)",
    description: "3 Battleships supported by 3 Cruisers (12,900 CR).",
    budget: 12900,
    composition: [
      { hullClass: "battleship", count: 3, groupId: 1 },
      { hullClass: "cruiser", count: 3, groupId: 2 },
    ],
  },
  {
    id: "test_1bs_3cv",
    name: "Escorted Flagship (1 BS + 3 CV)",
    description: "1 Battleship protected by 3 Aegis screening corvettes (4,250 CR).",
    budget: 4250,
    composition: [
      { hullClass: "battleship", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 3, groupId: 2 },
    ],
  },
  {
    id: "test_all_threes",
    name: "Triple Threat (3 BS + 3 CR + 3 CV + 3 SC)",
    description: "Grand fleet with exactly 3 of every single hull class (14,310 CR).",
    budget: 14310,
    composition: [
      { hullClass: "battleship", count: 3, groupId: 1 },
      { hullClass: "cruiser", count: 3, groupId: 2 },
      { hullClass: "corvette", count: 3, groupId: 3 },
      { hullClass: "strike_craft", count: 3, groupId: 4 },
    ],
  },
];
