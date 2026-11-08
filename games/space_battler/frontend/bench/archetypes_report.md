# Multi-archetype latency diagnosis

## Reproduce

From `games/space_battler/frontend`, run `npx tsx bench/archetypes.ts --output bench/archetypes.results.json`. Requires the existing frontend dependencies and root TypeScript 5 dependency (also used by `wave15bProfile.ts`). The output flag is optional.

Each composition runs **60 warmup + 80 measured ticks**, advancing the same fleet through warmup into measurement at the stock 1/60-second timestep. Three passes use native `tsx`, uninstrumented in-memory TS5/CommonJS, and timed in-memory TS5/CommonJS. Assertions verify fleet counts, unique ship IDs, stock initial health/speed/size, elapsed simulation time, and identical final SHA-256 combat-state hashes across all passes.

The rerun used Windows, Node **v24.16.0**, **Ryzen 7 7700**, engine revision `aa16a24`, without concurrent test/check processes. Machine-readable traces, CPU samples and hashes are in `archetypes.results.json`. The previous baseline recorded the same CPU model and Node version at engine revision `07bcd33`; a single run per revision is sensitive to system load and runtime variation.

## Wall-clock results

RTF = simulated milliseconds / measured milliseconds. These are Node headless measurements, not browser throughput predictions.

| Composition | Initial / minimum active ships | Mean / p95 update (ms) | Update RTF | Update + publication proxy (ms / RTF) |
|---|---:|---:|---:|---:|
| A: 200 fighters + 17 corvettes vs 250 fighters | 467 / 372 | 70.24 / 82.37 | 0.237× | 75.00 / 0.222× |
| B: 50 dreadnoughts + 50 battleships per side | 200 / 200 | 23.12 / 24.61 | 0.721× | 25.35 / 0.657× |
| C: 100 missile frigates per side, 4× missile replication | 200 / 168 | 48.37 / 57.01 | 0.345× | 52.27 / 0.319× |

| Composition | Previous mean / RTF | Current mean / RTF | Mean update change |
|---|---:|---:|---:|
| A: swarm | 61.10 ms / 0.273× | 70.24 ms / 0.237× | +15.0% |
| B: capitals | 35.27 ms / 0.473× | 23.12 ms / 0.721× | −34.4% |
| C: missiles | 63.67 ms / 0.262× | 48.37 ms / 0.345× | −24.0% |

The swarm regression merits investigation rather than a speedup claim. All three final combat hashes also match the previous baseline, in addition to matching across the rerun's passes; this establishes equivalence for these fixtures and measured windows only.

Placement is benchmark geometry: mirrored grids compacted radially inside the stock arena. Initial shield-envelope overlaps are **18 / 406 / 0** for A/B/C. B intentionally exercises a crowded capital/contact workload, not an overlap-free deployment. Ships retain normal damage and destruction.

C adds three uniquely identified copies of each surviving naturally emitted missile before the next tick, with identical stock payload, health, velocity, seeker and lifetime. Copies are never recursively replicated. This is a **4× injection factor**, not a claim that concurrent missiles remain exactly four times a separate control battle. Peak live missiles: **2,984**. Injection cost is outside update/publication timings.

## Current hotspots

Native V8 sampling at a requested 1 ms interval covers the measured loop, including publication and fixture bookkeeping. Shares are **inclusive** and nested rows overlap; do not add them.

| Subsystem | A | B | C |
|---|---:|---:|---:|
| Ship navigation | 53.5% | 44.6% | 50.2% |
| Fighter mission cycle | 37.8% | — | — |
| Separation | 20.5% | 10.6% | 14.0% |
| Navigation target selection | 8.1% | 14.9% | 7.0% |
| Fire-control mount target acquisition | 5.4% | 12.1% | 21.1% |
| Ordnance avoidance | secondary | secondary | 13.1% |

Phases 1–3 added team haven blackboards and a missile payload ledger, a reusable conservative separation grid, and cached wing centroids with pruned ordnance avoidance. Further profiling should investigate the swarm regression, navigation/mission costs and missile-heavy target acquisition and avoidance. Sample shares are not isolated causal measurements.

### Swept collision and flak

In-memory timers provide call counts and inclusive per-tick costs below. These timings belong to the transformed runtime, not the native baseline.

| Timed subsystem | A ms/tick (calls/tick) | B ms/tick (calls/tick) | C ms/tick (calls/tick) |
|---|---:|---:|---:|
| WASM projectile-to-ship swept-hit wrapper | 0.121 (164.84) | 0.013 (32.04) | 0.988 (2,536.01) |
| Ship contact solver | 0.841 (2) | 0.759 (2) | 0.239 (2) |
| Flak detonation, including radius tests and damage | 0.013 (0.575) | not exercised | not exercised |

The projectile-to-ship sweep is inside `wasmHotLoops.findProjectileShipHitWasm`; timing only JS `fireControl.sweptHit` would miss it. The JS missile-to-missile swept-hit path had zero calls in these windows. A exercised 46 flak bursts. C has missile-only frigates without hostile flak/rotary batteries, so it does not establish a bound for thousands of missiles fighting point-defense batteries.

### Worker publication overhead

| Stage, mean ms/tick | A | B | C |
|---|---:|---:|---:|
| Binary snapshot pack, reused 589,888-byte buffer | 0.238 | 0.073 | 0.216 |
| Presentation metadata pack | 2.815 | 1.138 | 1.228 |
| Structured-clone sidecar proxy | 1.707 | 1.023 | 2.461 |
| Total measured publication proxy | 4.759 | 2.235 | 3.905 |

The binary buffer is transferred by the real worker, not cloned. The proxy measures codec, metadata construction and cloning the non-buffer sidecar, but not browser worker scheduling, transferable handoff, reliable events, FleetBreakdown observer work, main-thread reconstruction or rendering.

## Runtime control

Uninstrumented TS5/CommonJS means are **45.72 / 12.12 / 34.98 ms** for A/B/C. Native `tsx` is **1.54× / 1.91× / 1.38×** slower despite identical combat hashes. Compiler/module representation, V8 optimization and generated runtime helpers affect this benchmark. Native CPU profiles include helper-labelled frames; timed wrappers also affect optimization, so their costs are diagnostic rather than additive estimates of native tick time. Validate follow-up optimizations with state-hash checks and browser RTF measurements.
