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
  // --- Curated Opposing Red Forces ---
  {
    id: "combined",
    name: "Anchor & Talons",
    description: "1 Battleship + 2 PD Corvettes + 6 Fighters. Balanced combined-arms fleet.",
    budget: 4620,
    composition: [
      { hullClass: "battleship", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 2, groupId: 2 },
      { hullClass: "strike_craft", count: 6, groupId: 3 },
    ],
  },

  {
    id: "test_3_cruisers",
    name: "Three Knives",
    description: "3 Vanguard Cruisers with heavy prow torpedoes and beam turrets (3,300 CR).",
    budget: 3300,
    composition: [{ hullClass: "cruiser", count: 3, groupId: 1 }],
  },
  {
    id: "split_spear",
    name: "Split Spear",
    description: "Pincer assault with dual cruiser wings and flanking fighter escorts (4,100 CR).",
    budget: 4100,
    composition: [
      { hullClass: "cruiser", count: 1, groupId: 1 },
      { hullClass: "cruiser", count: 1, groupId: 2 },
      { hullClass: "corvette", count: 2, groupId: 3 },
      { hullClass: "strike_craft", count: 5, groupId: 4 },
      { hullClass: "strike_craft", count: 5, groupId: 5 },
    ],
  },
  {
    id: "glass_hammer",
    name: "Glass Hammer",
    description: "Heavy dual-capital line lacking dedicated point defense escorts (4,300 CR).",
    budget: 4300,
    composition: [
      { hullClass: "battleship", count: 1, groupId: 1 },
      { hullClass: "cruiser", count: 1, groupId: 2 },
    ],
  },
  {
    id: "needle_cloud",
    name: "Needle Cloud",
    description:
      "24 Raider Interceptors in three distinct strike wings covered by 2 Flak Corvettes (3,580 CR).",
    budget: 3580,
    composition: [
      { hullClass: "strike_craft", count: 8, groupId: 1 },
      { hullClass: "strike_craft", count: 8, groupId: 2 },
      { hullClass: "strike_craft", count: 8, groupId: 3 },
      { hullClass: "corvette", count: 2, groupId: 4 },
    ],
  },
  {
    id: "picket_gambit",
    name: "Picket Gambit",
    description:
      "Thick defensive screen of 6 Flak Corvettes protecting a single artillery cruiser (3,680 CR).",
    budget: 3680,
    composition: [
      { hullClass: "cruiser", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 6, groupId: 2 },
      { hullClass: "strike_craft", count: 4, groupId: 3 },
    ],
  },

  // --- Strict 3-Ship Variation Matchups for Benchmarking ---
  {
    id: "ironclad_line",
    name: "Ironclad Linebreaker",
    description: "1 Dreadnought + 2 Corvettes + 4 Fighters. Screened broadside battle line.",
    budget: 4780,
    composition: [
      { hullClass: "dreadnought", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 2, groupId: 2 },
      { hullClass: "strike_craft", count: 4, groupId: 3 },
    ],
  },
  {
    id: "missile_wall",
    name: "Missile Saturation Screen",
    description: "1 Cruiser + 3 Missile Frigates + 2 Corvettes. Standoff shield saturation fleet.",
    budget: 3900,
    composition: [
      { hullClass: "cruiser", count: 1, groupId: 1 },
      { hullClass: "missile_frigate", count: 3, groupId: 2 },
      { hullClass: "corvette", count: 2, groupId: 3 },
    ],
  },
  {
    id: "test_3_battleships",
    name: "Dreadnought Line (3x Battleships)",
    description: "3 Leviathan Battleships. Heavy railguns and dual broadsides (9,600 CR).",
    budget: 9600,
    composition: [{ hullClass: "battleship", count: 3, groupId: 1 }],
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
