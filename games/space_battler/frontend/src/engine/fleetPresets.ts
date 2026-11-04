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
  {
    id: "swarm",
    name: "Raider Swarm (30x Fighters)",
    description: "Overwhelms unescorted capitals with plasma torpedoes. Weak to Point Defense.",
    budget: 3600,
    composition: [{ hullClass: "strike_craft", count: 30, groupId: 1 }],
  },
  {
    id: "dreadnought",
    name: "Heavy Leviathan (1x Battleship)",
    description: "Devastating spinal railgun and broadsides. Highly vulnerable without escort.",
    budget: 3200,
    composition: [{ hullClass: "battleship", count: 1, groupId: 1 }],
  },
  {
    id: "combined",
    name: "Task Force (Flagship + Screen)",
    description: "1 Battleship + 2 PD Corvettes + 6 Fighters. Balanced combined-arms fleet.",
    budget: 4620,
    composition: [
      { hullClass: "battleship", count: 1, groupId: 1 },
      { hullClass: "corvette", count: 2, groupId: 2 },
      { hullClass: "strike_craft", count: 6, groupId: 3 },
    ],
  },
  {
    id: "cruiser_line",
    name: "Cruiser Flotilla (3x Cruisers)",
    description: "Fast, high-damage beam and torpedo cruisers. Good against all medium targets.",
    budget: 3300,
    composition: [{ hullClass: "cruiser", count: 3, groupId: 1 }],
  },
];
