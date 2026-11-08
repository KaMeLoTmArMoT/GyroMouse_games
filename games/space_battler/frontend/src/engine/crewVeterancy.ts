export type CrewVeterancy = "recruit" | "pilot" | "veteran" | "ace";

export interface CrewContext {
  crewVeterancy?: Partial<Record<number, CrewVeterancy>>;
}

export const CREW_TACTICS = {
  recruit: { hold: 0.24, margin: 0.95 },
  pilot: { hold: 0.15, margin: 1 },
  veteran: { hold: 0.12, margin: 1.03 },
  ace: { hold: 0.085, margin: 1.06 },
} as const;

export function crewDecisionPeriod(tier: CrewVeterancy, combat: boolean): number {
  const baseline = 1 / (combat ? 12 : 5);
  // Pilot retains the original scheduler arithmetic, including its stable phase.
  return tier === "pilot"
    ? baseline
    : Math.max(1, Math.round((baseline * CREW_TACTICS[tier].hold * 60) / 0.15)) / 60;
}
