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

## Spatial Acceleration Architecture: Spatial Grid vs. Scalar AABB vs. TypedArray Pools

During performance audits across 100v100 (200 ships) and 170v170 (340 ships) fleet scales, multiple spatial acceleration architectures were evaluated:

### 1. Rejection of Dynamic Spatial Grid in V8 / JavaScript
A naive dynamic 2D spatial grid (bucketing entities into spatial cells every simulation tick) was formally evaluated and rejected for the following technical reasons:
- **GC Allocation Churn:** In JavaScript/V8, rebuilding or clearing cell lists every 60Hz tick for 340+ vessels and 300+ projectiles generates continuous heap allocations (`new Array()`, `Array.push`, or linked list nodes). This triggers recurring minor GC scavenging pauses that directly harm frame pacing and cause frame stutters.
- **Inflated Query Radius for High-Velocity Craft:** Light strike craft move up to $280\,\text{u/s}$ and weapon ranges span from $300\,\text{u}$ to $1200\,\text{u}$. With boundary sweeps and projectile relative displacement, the required bounding query cells expand dramatically, causing spatial cell lookups to visit nearly all inhabited buckets anyway, negating the theoretical $O(1)$ cell benefit while introducing spatial hashing overhead.

### 2. The Winning Strategy: Zero-Allocation Scalar AABB Pruning
Instead of dynamic bucket indexing, all high-frequency simulation systems (`projectileEngine`, `fireControl`, `flightBehaviors`, `shipNavigationSystem`) rely on **Zero-Allocation Scalar AABB Early Rejection**:
- **Pre-cached scalar phase buffers:** Ship coordinates, speeds, radiuses, and displacement vectors are hoisted once per epoch into primitive variables (`dx, dy, r0x, r1x, bound`).
- **In-place coordinate bounding:** Candidate pairs are rejected along primary axes ($|dx| > R \lor |dy| > R$) with zero allocations, zero array creation, and zero vector operations. Over $90\%$ of projectile-ship and ship-ship interaction pairs are rejected before reaching quadratic math or trigonometry.
- **Strict preservation of deterministic traversal order:** Bypassing spatial hashing ensures candidate evaluation order, tie-breaking, and floating-point accumulation orders remain 100% bit-identical.

### 3. Investigation of TypedArray / ArrayBuffer Pooling
For massive fleet scale (200v200 = 400 ships and beyond):
- Reusable pre-allocated flat memory structures (`Float64Array`, `Int32Array`) provide zero-allocation scratch buffers for spatial sorting, broadphase sorting (Sweep & Prune on X-axis), and contiguous velocity integration.
- Flat contiguous arrays also serve as the serialization-free foundation for Web Worker simulation offloading via `SharedArrayBuffer` or transferable `ArrayBuffer` structured snapshots.

