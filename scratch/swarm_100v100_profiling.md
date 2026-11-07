# 100 vs 100 light-craft profile

## Result

**#1: `findNavigationTarget` → `selectNavigationTarget`, not sphere casting.**
**#2 depends on roster:** `FighterMissionSystem.updateWings` for pure strike craft;
`CollisionContactSolver.resolveShipCollisions` for the 50/50 mix;
`acquireMountTarget` for pure corvettes (contacts are a close third).

The expensive pattern is repeated fleet-wide metadata/assignment scans inside
candidate scans, effectively **O(N³)** on reassessment ticks. Optimizing separation
alone will not solve this load.

## Reproduce / scope

From `games/space_battler/frontend`, PowerShell:

```powershell
$env:SWARM_PROFILE='1'
npx vitest run tests/swarmProfiling.test.ts --reporter=verbose
Remove-Item Env:SWARM_PROFILE
npx tsx bench/swarm.ts
```

Node 24.16.0, AMD Ryzen 7 7700, Windows. Three deterministic fleets: each team
has 100 fighters, 50 fighters + 50 corvettes, or 100 corvettes. `empty_void`, default
pilot crew, default orders, compact 10×10 grids, 30 warm-up ticks per roster;
each measured run advances **300 × 1/60-second ticks**. Hull capacity/current are
raised to 1e9 solely to retain **200 active ships on every tick**; shields, armor,
weapons, navigation, contacts and projectile damage remain enabled. This is a
sustained-density stress fixture, not the UI's default spaced fleet or a normal
lethal combat outcome. Peak projectile counts: 157 / 147 / 186.

Vitest wraps exported functions and prototype methods, preserving `this`, and
checks identical plain/instrumented ships, projectiles and stats. Nested calls
are subtracted for **self time**; do not add inclusive parents to their children.
The test is opt-in and has no timing thresholds. JSON output includes calls and
aggregate milliseconds as well as per-tick values. Standalone `tsx` uses the same
fixture without Vitest interception to cross-check total CPU cost.

## Measured milliseconds per physics tick

| Function | Fighters | 50/50 mix | Corvettes |
| --- | ---: | ---: | ---: |
| `sim.update`, plain mean | 119.84 | 135.37 | 159.21 |
| `sim.update`, plain median / p95 | 121.68 / 151.87 | 132.33 / 159.59 | 159.20 / 172.00 |
| `sim.update`, instrumented mean | 117.76 | 140.62 | 158.66 |
| `findNavigationTarget`, self | **67.74** | **107.74** | **123.49** |
| `fighterMission.updateWings`, self | **20.62** | 1.26 | 0.002 |
| `fighterMission.updateCycle`, self | 4.18 | 2.07 | 0 |
| `fighterMission.updateCycle`, inclusive | 5.58 | 2.65 | 0 |
| `fighterMission.ensureWings`, self | 0.021 | 0.015 | 0.002 |
| `calculateSeparation`, self | 1.40 | 4.31 | 7.06 |
| `obstacleCourseCorrection`, self | 0.325 | 0.303 | 0.319 |
| `collisionContactSolver.resolveShipCollisions`, self | 7.42 | **7.72** | 7.62 |
| `resolveCruiserClearance`, self | 0.005 | 0.006 | 0.004 |
| `projectileEngine.updateProjectiles`, self | 1.21 | 1.70 | 2.51 |
| `fireControl.acquireMountTarget`, self | 5.34 | 5.84 | **8.44** |
| `turretAim`, self | 0.089 | 0.119 | 0.123 |
| `fireWeapon`, self | 0.009 | 0.019 | 0.023 |
| `updateShipNavigation`, self excluding wrapped children | 3.84 | 3.80 | 3.53 |

Standalone plain mean / median / p95: fighters **127.25 / 130.32 / 164.30**;
mix **148.88 / 146.13 / 174.91**; corvettes **181.27 / 176.13 / 227.57** ms.
Absolute timings vary with JIT, GC, module runtime and host load; these are not
browser FPS measurements. Both runtimes show severe simulation cost without Canvas.

Navigation calls: 60,122 / 60,114 / 60,000. Mount acquisitions: 60,000 / 90,000 /
120,000. Separation calls: 12,044 / 34,712 / 60,000. Obstacle corrections: 11,960 /
10,441 / 11,654: already tactically staggered, not 200 full casts every tick.
The names `predictiveSphereCast`, `scoreFighterTrajectory` and mission `.update`
do not exist here: casting is `obstacleCourseCorrection`; sector scoring is inline
in `updateCycle`; missions use `ensureWings`, `updateWings` and `updateCycle`.

## Why the leaders are expensive / fixes in priority order

1. **Navigation: remove candidate × fleet rescans.**
   `shipNavigationSystem.ts:196–209,237–301` calls `withinPursuitTheater` for every
   candidate and counts peer assignments for every scored enemy. In
   `flightControl.ts:544–551`, even a fighter chasing another fighter computes
   `fleetDefenseAnchor` (a full fleet filter/sort) before entering the fighter
   branch that never uses it. `safeNavigationTarget` also rescans flak per candidate.
   Build an O(N) per-tick team/hull/ID index and `(team,group,target)` assignment
   counts. Increment counts in the existing stable ship-ID selection order so
   squad saturation behavior remains identical. Precompute each target's flak
   safety and each ship's defense anchor once; skip anchor lookup in the fighter
   branch. This removes cubic metadata work. Use local spatial candidates plus
   the existing retained/wing/global fallback to approach O(N·k) for bounded
   neighborhoods. Preserve distant target acquisition, pursuit history and ties.

2. **Pure fighters: eliminate repeated dogfight metadata work in `updateWings`.**
   This parent costs 20.62 ms self, versus 4.18 ms for sector steering. Its
   `dogfightTarget` child (`flightControl.ts:1095–1125`) repeats pursuit/anchor
   evaluation and `ships.filter(...dogfightTargetId...)` for each candidate.
   Maintain dogfight assignment counts incrementally, use a 600-unit spatial
   query, map wing member IDs to ships once, and pre-group wings. These changes
   remove O(N³) tactical reassessment and O(wings·N) membership filtering.
   Child attribution is source inspection, not a separate measured leaf timing.

3. **Contacts: spatial broad phase before geometry and pair strings.**
   `collisionContactSolver.ts:60–85` visits 19,900 pairs per pass at N=200, twice
   per tick, and creates sorted string keys even for distant non-contact pairs.
   Hash envelopes into cells; query overlapping neighboring cells, deduplicate,
   and preserve original pair order. Compute numeric squared-distance rejection
   before square roots, shield geometry and string keys. Refresh candidates after
   movement/contact corrections, including tether attachments, so correctness is
   not lost. Expected O(N + nearby pairs), with O(N²) worst case in a packed cell.

4. **Corvette mounts: spatial candidates and single-pass selection.**
   `fireControl.ts:211–224,258–326,345–387` rebuilds defended ships and scans/sorts
   targets per mount every tick, including cooldown ticks. Cache defended-ship
   metadata, query ships/missiles within weapon range, reject range before
   intercept/priority work, and select best/current in one pass while preserving
   hysteresis/ties. Missile scans are present, but these rosters produce no
   torpedoes: scanned projectile entries mostly fail the missile-type guard.
   Separation should reuse the same spatial index; it is secondary here.

## Projected gain (targets, not measured optimization results)

Using self-time shares and Amdahl's law, **90% less navigation work** yields
approximately **2.1× / 3.2× / 3.3×** simulation throughput. Adding **80% reduction
of the roster-specific #2** yields approximately **2.9× / 3.7× / 3.9×**.
For a genuinely simulation-bound observed 15–20 FPS, that models roughly
**44–59 / 56–75 / 59–79 FPS** before display caps and rendering costs. These
reduction percentages require implementation/measurement; they are not promises.
On this deliberately dense sustained fixture, even those combined reductions
leave about **40 / 38 / 41 ms per tick**: further spatial reduction and profiling
would still be needed for 60 Hz. Separation/casting alone cannot deliver that.

## Canvas / browser limitation

Canvas 2D submission, effects, UI and GPU rasterization are **not measured** by
headless Node. No fake-context result is treated as browser evidence. Existing
`TacticalCanvas.tsx:179–183` runs `sim.update` and effects before drawing, and
`simulation.ts:305–318` catches up fixed ticks (up to 240). Once a tick exceeds
16.67 ms, catch-up can compound stalls before Canvas receives any work.
Use the existing performance HUD's per-step sampling plus browser Performance
recording to compare simulation, effects and draw/raster time on the user's
actual roster/map. Hull sprites are already cached. These measurements establish
a CPU bottleneck independent of drawing, but cannot exclude additional Canvas cost.

## Verification

- Opt-in benchmark passed: 300 ticks per plain/profiled roster, 200 ships remain
  alive; plain/instrumented combat state equality passed.
- Standalone cross-check completed all three 300-tick rosters.
- `npm run test:fast --prefix games/space_battler/frontend`: **509 passed,
  4 skipped (513 total)**; the new diagnostic is one skip, and three pre-existing
  heavy tests are skipped by the fast-suite environment.
- Biome checked all three added TypeScript files successfully (formatted the
  profiling test). No production engine code changed.
