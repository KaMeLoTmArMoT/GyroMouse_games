import type { HullClass } from "../types/combat";

export interface ShipDoctrine {
  standoff: string;
  targetPriority: string;
  states: { name: string; trigger?: string }[];
  note?: string;
}

// These describe tactical behavior; reactive maneuvers can interrupt the illustrated flow.
export const SHIP_DOCTRINES: Record<HullClass, ShipDoctrine> = {
  battleship: {
    standoff: "~1025u (optimal stance)",
    targetPriority: "Nearest enemy by default; group orders can change priority",
    states: [
      { name: "Bow Ingress (Spinal Alignment)" },
      {
        name: "Broadside Weave (Laser Engagement)",
        trigger: "Spinal shot fired; within engagement range",
      },
      {
        name: "Evasive Jink (Incoming Torpedo)",
        trigger: "Incoming missile predicted to hit within 1.5s",
      },
    ],
    note: "Missile avoidance can interrupt either approach or broadside; the ship reacquires its bow when the gun is nearly ready.",
  },
  dreadnought: {
    standoff: "~945u (optimal stance)",
    targetPriority: "Nearest enemy by default; group orders can change priority",
    states: [
      { name: "Line Approach (Bow-first)" },
      { name: "Broadside Lock (3-of-4 Heavy Battery Salvo)", trigger: "Distance ≤ 1050u" },
      { name: "Rear Kiting (Aft Battery Active)", trigger: "Target falls within aft battery arc" },
    ],
    note: "Aft fire depends on target bearing; rear kiting is not a separate maneuver state. Missile avoidance can interrupt the approach or broadside.",
  },
  cruiser: {
    standoff: "~990u (optimal stance)",
    targetPriority: "Nearest enemy by default; group orders can change priority",
    states: [
      { name: "Oblique Approach (Bow-first)" },
      { name: "Torpedo Launch", trigger: "Target in range and launcher arc; weapon ready" },
      { name: "Broadside Beam Laser Burn", trigger: "Torpedo fired; within 1050u" },
    ],
    note: "Reacquires bow alignment as the torpedo reload approaches completion.",
  },
  missile_frigate: {
    standoff: "1200u",
    targetPriority: "Nearest enemy by default; group orders can change priority",
    states: [
      { name: "Standoff Approach (1200u)" },
      { name: "Salvo Launch (Fan-out)", trigger: "Target in range and tube arc; weapons ready" },
      { name: "Disengage / Arc Reposition", trigger: "Salvo complete or reload > 2.5s" },
      { name: "Re-arm & Acquire", trigger: "Reload < 1s" },
    ],
  },
  corvette: {
    standoff: "550u forward screen; up to 600u from target",
    targetPriority: "Incoming missiles for flak; ships follow group priority",
    states: [
      { name: "Picket Sortie (Screen Vanguard at 550u)" },
      {
        name: "Flak Defense / Autocannon Strafing",
        trigger: "Threat in weapon range or target within 600u",
      },
      {
        name: "Shield Retreat (<40% shields)",
        trigger: "Shields ≤ 40%; return toward escort station",
      },
    ],
    note: "The current loadout uses dual flak turrets; there is no separate autocannon mount. The screen extends again as shields recover.",
  },
  strike_craft: {
    standoff: "520u rally, extended to avoid point defense",
    targetPriority: "Capital ships; nearby enemy fighters can interrupt the run",
    states: [
      { name: "Staggered Echelon Launch" },
      { name: "High-Speed Ingress (Flanking Arc)", trigger: "Wing launch window reached" },
      { name: "Strafe Run (Nose Cannon)", trigger: "Target in range and firing arc; weapon ready" },
      { name: "Breakaway & Egress", trigger: "Shot fired or too close to target" },
      {
        name: "Carrier Recovery (<30% HP)",
        trigger: "Currently: hull < 40% or shields < 10 points",
      },
    ],
    note: "Recovery currently means seeking cover, not docking with a carrier. Egress normally leads to rejoin and another launch; recovery can interrupt the cycle.",
  },
};
