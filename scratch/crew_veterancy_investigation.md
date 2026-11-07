# Crew veterancy investigation (draft)

## Current behavior

- Fighter tactical decisions (`shipNavigationSystem.ts`, `fighterTacticalTick`) run immediately on first evaluation, then at 12 Hz (~83 ms) during attack/intercept or near an enemy within 600 units, and 5 Hz (200 ms) otherwise. A stable per-ship phase spreads work across 60 Hz physics frames. `fighterMissionSystem.ts` caches steering by tactical tick, but holds an evasive line for 150 ms unless the mission phase changes. Thus 150 ms is a commitment time, not a global decision interval.
- Fighter steering scores 16 reachable sectors; missile/rail threats within 650 units are evaluated with up to a 2 s horizon, a 75-unit miss-distance threshold and 0.04 s minimum predicted contact time. Danger above 0.4 triggers the evasive flag and attack speed. Obstacle clearance and flak avoidance also affect the score; ship turn rate still limits actual movement.
- `fireControl.ts` computes a deterministic constant-velocity intercept and rejects solutions outside range, lifetime or mount arc. Mount slew is bounded by each turret's `trackingSpeed`. `shipWeaponSystem.ts` permits fire within 0.08 rad for spinal gimbals or 0.15 rad for other mounts; projectiles are launched toward the solution. Hitscan and beam behavior differs. There is no existing crew jitter or lead-error parameter to scale; targeting and turret tracking also apply to capital ships, not a separate human-reaction timer.

## Proposed curves, not implemented

| Tier | Proposed nominal reaction / reevaluation | Aim / lead error scale | Evasive margin |
| --- | --- | --- | --- |
| Recruit (Новачок) | 240 ms | 1.15× | 0.95× |
| Pilot (Пілот) | 150 ms reference | 1.00× | 1.00× |
| Veteran (Ветеран) | 120 ms | 0.90× | 1.03× |
| Ace (Ас) | 85 ms | 0.85× | 1.06× |

The nominal values are design targets, not a description of the current adaptive scheduler. Preserve Pilot's existing 12/5 Hz timing and 150 ms hold when integrating; calibrate tier-specific combat and noncombat periods separately, quantized to the fixed 60 Hz step, while retaining staggered scheduling. Avoid treating a shorter commitment hold as an automatic dodge improvement: it may increase steering flicker. Apply the margin scale only to the 75-unit predicted projectile miss-distance threshold, not physical collision or shield clearance, and validate its effect on attack commitment and friendly congestion.

Aim scaling requires a new, small, bounded, seeded angular or lead-estimation error with a nonzero baseline; multiplying today's exact solution by 0.9 would have no effect. Keep Pilot's current behavior unchanged until a baseline error model is deliberately introduced and balanced. Apply any later error consistently to the firing solution, respecting mount arcs, slew, target size and projectile lifetime; explicitly evaluate beam and point-defense behavior separately. No damage, health, weapon range, ship speed or turret motor multipliers are proposed. Differences should be tactical and nuanced rather than +100% damage or godmode evasion.

The Fleet Builder tier choices are draft team-level configuration only; they do not change the simulation. Before activation, compare seeded mirrored matchups across mixed fleet compositions, fighter survival, accuracy, battle duration and frame cost, including carrier-launched fighters, and tune against the existing Pilot baseline.
