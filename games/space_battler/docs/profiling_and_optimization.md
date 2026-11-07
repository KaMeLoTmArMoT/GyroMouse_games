# Space Battler profiling and optimization

Run commands from `games/space_battler/frontend`. Timings depend on hardware,
runtime, and system load; compare runs under the same conditions.

## CLI swarm benchmark

```powershell
npx tsx bench/swarm.ts
```

The benchmark runs directly through `tsx`, without Vitest module interception.
It prints the Node version and CPU model, then tests three 200-ship scenarios:

| Corvettes per team | Strike craft per team |
| ---: | ---: |
| 0 | 100 |
| 50 | 50 |
| 100 | 0 |

Each team starts in a compact grid within combat range. Hulls are enlarged to
keep the population stable without disabling weapons. Each scenario warms up
for 30 ticks on a separate simulation, then measures 300 updates at 1/60 s.

Reported fields include `corvettesPerTeam`, `ticks`, mean, p50, p95, and max
update time in milliseconds, final alive count, and peak projectile count.
Use the percentile and maximum alongside the mean to spot spikes.

## Vitest profiling suite

Enable the opt-in diagnostic test in PowerShell:

```powershell
$env:SWARM_PROFILE='1'
npx vitest run tests/swarmProfiling.test.ts --reporter=verbose
Remove-Item Env:SWARM_PROFILE
```

The suite warms all three swarm compositions and measures 300 ticks per
composition, both plain and instrumented. It reports mean, p50, p95, max,
minimum alive and maximum projectile counts, plus per-subsystem call counts,
inclusive and self time, and milliseconds per tick. `sim.update` is the total;
navigation, separation, obstacle correction, collision, projectile and weapon
functions provide phase-level detail. Inclusive timings can overlap; self time
excludes nested instrumented calls. Instrumentation adds overhead, so compare
with the plain measurements. State equality verifies instrumentation preserves
outcomes; timing values are diagnostic, not pass/fail thresholds.

For normal fast CI-style checks, leave `SWARM_PROFILE` unset and run:

```powershell
npm run test:fast
```

This sets `SKIP_HEAVY_TESTS=1`; the profiling test is skipped unless explicitly
enabled with `SWARM_PROFILE=1`.

## Runtime performance HUD

In the Battle tab, click **Perf** in the speed controls. The choice persists in
local storage; turning it off clears the samples. Sampling occurs only while
the HUD is enabled. The display refreshes every 250 ms and keeps up to 160
recent frame intervals and 160 fixed simulation-step durations.

- **FPS / Frame:** reciprocal of the latest frame interval and that interval in
  milliseconds. Frames are sampled only while the window is focused and visible.
- **Frametime sparkline:** one bar per recent frame, capped visually at 50 ms;
  green is at most 16.7 ms, amber at most 33 ms, red above 33 ms.
- **1% / 0.1% low:** FPS calculated from the average of the slowest 1% / 0.1%
  of stored frame intervals, rounding up to at least one sample. At 160 samples
  the 0.1% low is the single slowest frame; lower values indicate stutters.
- **Sim step avg:** mean wall-clock latency of fixed simulation ticks. The HUD
  displays microseconds (μs), so divide by 1000 for milliseconds. It measures
  simulation work, not the entire frame; paused frames need not produce ticks.

## Architecture optimizations

- `NavigationContext` pre-indexes ship data in O(N) for reuse during navigation.
- Candidate scoring avoids per-candidate allocations in navigation hot paths.
- AI decision cadences are staggered to distribute expensive decisions over ticks.
- `ShipSpriteCache` caches hulls offscreen instead of redrawing static geometry.
- Viewport culling skips offscreen entities and effects during canvas rendering.
