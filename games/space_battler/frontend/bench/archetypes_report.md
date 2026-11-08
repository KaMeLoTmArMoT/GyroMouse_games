# Multi-archetype latency diagnosis

## Reproduce

From `games/space_battler/frontend`, run `npx tsx bench/archetypes.ts --output bench/archetypes.results.json`.
Requires the existing frontend dependencies and root TypeScript 5 dependency (also used by `wave15bProfile.ts`).
The output flag is optional; without it the suite only prints diagnostics.

Each composition runs **60 warmup + 80 measured ticks**, advancing the same fleet through warmup into measurement at the stock 1/60-second timestep. Three passes use native `tsx`, uninstrumented in-memory TS5/CommonJS, and timed in-memory TS5/CommonJS. Assertions verify fleet counts, unique ship IDs, stock initial health/speed/size, elapsed simulation time, and identical final SHA-256 combat-state hashes across all passes. Engine files and balance values are untouched.

Recorded on Windows, Node **v24.16.0**, **Ryzen 7 7700**, engine revision `07bcd33`; benchmark executed without concurrent test/check processes. Machine-readable traces, calls, CPU samples and hashes are in `archetypes.results.json`.

## Wall-clock results

RTF = simulated milliseconds / measured milliseconds. These are Node headless measurements, not browser throughput predictions.

| Composition | Initial / minimum active ships | Mean / p95 update (ms) | Update RTF | Update + publication proxy (ms / RTF) |
|---|---:|---:|---:|---:|
| A: 200 fighters + 17 corvettes vs 250 fighters | 467 / 372 | 61.10 / 74.50 | 0.273× | 65.04 / 0.256× |
| B: 50 dreadnoughts + 50 battleships per side | 200 / 200 | 35.27 / 38.64 | 0.473× | 37.50 / 0.444× |
| C: 100 missile frigates per side, 4× missile replication | 200 / 168 | 63.67 / 78.64 | 0.262× | 67.38 / 0.247× |

Placement is benchmark geometry: mirrored grids compacted radially inside the stock arena. Initial shield-envelope overlaps are **18 / 406 / 0** for A/B/C. B intentionally exercises a crowded capital/contact workload; it is not an overlap-free deployment benchmark. Ships retain normal damage and destruction; A's 467-ship count is the starting count, not an invulnerable steady state.

C adds three uniquely identified copies of each surviving naturally emitted missile before the next tick, with identical stock payload, health, velocity, seeker and lifetime. Copies are never recursively replicated. This is a **4× injection factor**, not a claim that concurrent missiles remain exactly four times a separate control battle. Peak live missiles: **2,984**. Injection cost is outside update/publication timings.

## Where time goes

Native V8 sampling at a requested 1 ms interval covers the measured loop, including publication and fixture bookkeeping. Percentages below are **inclusive** sample shares; nested rows overlap and must not be added.

| Subsystem | A | B | C |
|---|---:|---:|---:|
| Ship navigation | 56.0% | 62.4% | 48.4% |
| Fighter mission cycle | 39.0% | — | — |
| Separation | 18.7% | 34.3% | 18.8% |
| Navigation target selection | 7.3% | 10.0% | 5.9% |
| Fire-control mount target acquisition | 5.3% | 6.9% | 26.9% |
| Ordnance avoidance | secondary | secondary | 8.8% |

Specific hotspots and next optimization targets:

1. **Swarm missions/navigation:** `fighterMissionSystem.updateCycle` runs **382.65 times/tick**. Its safe-haven occupancy reconstruction scans `aliveShips` per deciding fighter; on the anchor-less opposing side it can repeat because no safe haven exists. `findNavigationTarget` runs **411.01 times/tick**, and dispersal/dogfight scoring adds work. Investigate tick-local occupancy/anchor worklists and exact-membership caching while preserving target ties and tactical cadence.
2. **Spatial separation:** `flightBehaviors.calculateSeparation` still scans all peers and evaluates shield/escort/capital clearance before rejecting distant candidates. B makes **200 calls/tick**, so full peer visits scale quadratically. A conservative spatial candidate list must include closing-speed-dependent braking margins, not just present shield radius. Native samples identify this as a stronger hotspot than contact solving.
3. **Missile saturation targeting/avoidance:** `fireControl.acquireMountTarget` runs **742.8 times/tick** in C; incoming payloads and missile reservations are evaluated per eligible enemy/mount even though missiles are already indexed by target. `flightBehaviors.OrdnanceAvoidanceBlock`/`torpedoEscape` and `flightControl.capitalIntent` add repeated projectile/spacing work. Profile these worklists and reductions before spending effort on the collision kernel.

### Swept collision and flak

In-memory timers provide call counts and inclusive per-tick costs below. These timings belong to the transformed runtime, not the native baseline.

| Timed subsystem | A ms/tick (calls/tick) | B ms/tick (calls/tick) | C ms/tick (calls/tick) |
|---|---:|---:|---:|
| WASM projectile-to-ship swept-hit wrapper | 0.144 (164.84) | 0.016 (32.04) | 1.047 (2,536.01) |
| Ship contact solver | 0.992 (2) | 0.861 (2) | 0.261 (2) |
| Flak detonation, including radius tests and damage | 0.015 (0.575) | not exercised | not exercised |

The projectile-to-ship sweep is already inside `wasmHotLoops.findProjectileShipHitWasm`; timing only JS `fireControl.sweptHit` would miss it. The JS missile-to-missile swept-hit path had **zero calls** in these windows. A exercised **46 flak bursts**; their aggregate radius/damage work is small here. C has missile-only frigates without hostile flak/rotary batteries, so these results do not establish a bound for thousands of missiles fighting point-defense batteries.

### Worker publication overhead

| Stage, mean ms/tick | A | B | C |
|---|---:|---:|---:|
| Binary snapshot pack, reused 589,888-byte buffer | 0.177 | 0.076 | 0.196 |
| Presentation metadata pack | 2.368 | 1.137 | 1.200 |
| Structured-clone sidecar proxy | 1.404 | 1.015 | 2.315 |
| Total measured publication proxy | 3.949 | 2.228 | 3.711 |

The binary buffer is transferred by the real worker, not cloned. This suite measures codec + metadata construction + cloning the non-buffer sidecar. It does not measure browser worker scheduling, transferable handoff, reliable event messages, FleetBreakdown observer work, main-thread reconstruction, or rendering. Presentation packing already clones tactical state; cloning the sidecar duplicates some allocation/copy work. Reducing redundant sidecar copies is worthwhile, but publication accounts for only about **5.5–6.1%** of measured update+publication cost here.

## Runtime control and conclusion

Uninstrumented TS5/CommonJS means are **48.99 / 16.94 / 50.06 ms** for A/B/C. Native `tsx` is **1.25× / 2.08× / 1.27×** slower despite identical combat hashes. Compiler/module representation, V8 optimization and generated runtime helpers materially affect this benchmark. Native CPU profiles include helper-labelled frames; they must not be mistaken for standalone game subsystems. Timed wrappers also affect optimization, so their costs are diagnostic rather than additive estimates of native tick time.

**Priority:** swarm mission/navigation work and all-peer separation; for missile-heavy battles, fire-control payload scoring and torpedo avoidance. The current WASM swept-hit kernel, flak-radius tests in A, and binary worker serialization are not the leading costs in these windows. Validate any follow-up optimization with the same state-hash checks and browser RTF measurement before claiming a speedup.
