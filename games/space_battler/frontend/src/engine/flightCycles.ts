export type RangePhase = "approach" | "engage";

export function classifyRange(distance: number, engagementRange: number): RangePhase {
  return distance > engagementRange ? "approach" : "engage";
}

export interface BroadsideCycle {
  phase: "bow_acquire" | "broadside_hold" | "bow_reacquire";
  targetId: string;
  side: number;
  lastShot?: number;
}

export function reduceBroadsideCycle(
  state: Readonly<BroadsideCycle> | undefined,
  input: {
    targetId: string;
    initialSide: number;
    lastShot?: number;
    cooldown: number;
    reacquireTime: number;
    alternateAfterShot: boolean;
  },
): BroadsideCycle {
  const changedTarget = state?.targetId !== input.targetId;
  const next: BroadsideCycle = changedTarget
    ? {
        phase: "bow_acquire",
        targetId: input.targetId,
        side: state?.side ?? input.initialSide,
        lastShot: input.lastShot,
      }
    : { ...state };
  if (input.lastShot !== undefined && input.lastShot !== state?.lastShot) {
    next.lastShot = input.lastShot;
    next.phase = "broadside_hold";
    if (input.alternateAfterShot) next.side = -next.side;
  }
  if (next.phase === "broadside_hold" && input.cooldown <= input.reacquireTime)
    next.phase = "bow_reacquire";
  return next;
}

export interface SkirmishCycle {
  phase: "acquire" | "breakoff" | "reacquire";
  targetId: string;
  side: number;
  lastSalvoShot?: number;
}

export function reduceSkirmishCycle(
  state: Readonly<SkirmishCycle> | undefined,
  input: {
    targetId: string;
    initialSide: number;
    reload: number;
    salvoComplete: boolean;
    lastShot: number;
    breakoffReload: number;
    reacquireReload: number;
  },
): SkirmishCycle {
  // A new target does not cancel an in-progress reload retreat.
  const next: SkirmishCycle = {
    phase: state?.phase ?? "acquire",
    targetId: input.targetId,
    side: state?.side ?? input.initialSide,
    lastSalvoShot: state?.lastSalvoShot,
  };
  if (input.salvoComplete || input.reload > input.breakoffReload) {
    next.phase = "breakoff";
    next.lastSalvoShot = input.lastShot;
  }
  if (next.phase === "breakoff" && input.reload < input.reacquireReload) next.phase = "reacquire";
  return next;
}
