# Space Battler Technical Plan

## 1. Completed Milestones (One-Line Changelog)

- `d156071` — Overhauled fleet builder layout, weapon grouping and preset selectors.
- `cbdc5bb` — Added cooperative skirmish spacing, shield-broken kiting and capital standoff limits.
- `3ca08d1` — Tuned capital standoff and broadside beam firing.
- `7806f6e` — Updated matchup test helpers for dual preset selectors.
- `f6f5abb` — Polished carrier hardpoints and docking bays and displayed the tender healing radius.
- `95ca4aa` — Added staged carrier launches and hangar repair cycles.
- `b2896a1` — Compacted fleet builder cards and budget headers.
- `f8fb38c` — Improved tender pursuit and wounded-ally rendezvous.
- `70d0329` — Capped torpedo overkill allocation and added capital wreckage.
- `043f6ee` — Polished symmetric fleet builder layouts and group badges.
- `9fdecee` — Added predictive kinetic debris avoidance and size-aware routing.
- `714e153` — Fixed debris avoidance fallback and tender pursuit boost.
- `8fd802c` — Improved carrier standoff, fighter recovery, shield collapse and HUD.
- `1cd53b7` — Added docking, catapult launches, corvette wolfpacks and camera polish.
- `d1ffede` — Added tab-blur auto-pause and unified ballistic decay effects.
- `eb495cf` — Added fighter evasion, carrier fabrication and tender cooldown telemetry.
- `536cf45` — Added capital threat prioritization and hardpoint cooldown HUD.
- `07f4b05` — Added capital proximity targeting and opportunistic side-targeting.
- `f9c13fc` — Added flak avoidance, tangent shield routing and staggered decisions.
- `2dba323` — Added pilot experience telemetry and documented decision staggering.
- `3639868` — Added dynamic tangent shield clearance and optimized sector calculations.
- `6dbed5c` — Audited crew veterancy and added fleet builder tier selection.
- `5f36476` — Optimized navigation candidate scoring to a single allocation-free pass.
- `197cb70` — Added fast test runner and tick profiling telemetry.
- `f9e0443` — Added missile frigate arena tethering and pilot veterancy mechanics.
- `f912ae6` — Added viewport culling and cached canvas glow sprites.
- `931b2d5` — Added skirmish threat standoff and emergency corner breakout.
- `c471713` — Documented rendering architecture and introduced the hull sprite cache foundation.
- `e1b5e3b` — Added dynamic obstacle avoidance and natural skirmish steering.
- `ca6002d` — Improved tender rescue scoring, focus fire and fighter swarm courage.
- `65701fd` — Added corvette escort screening for threatened capitals.
- `6abfc3f` — Added battle summary reopening and fleet breakdown copying.
- `19a04de` — Integrated cached ship hull sprites.
- `a843121` — Added fleet copy buttons and streamlined crew veterancy selection.
- `89c3ec5` — Added dynamic crew veterancy badges to inspection and canvas HUDs.
- `62674db` — Added the live fleet advantage evaluation bar.
- `5d72482` — Added performance HUD, frametime sparkline and timeout clock.
- `2dfa0e4` — Added map selection and viewport-culled obstacle rendering.
- `4f50bd8` — Added battle maps, obstacle collisions and projectile blocking.
- `f5ec6f2` — Profiled 100v100 light-craft dogfight bottlenecks.
- `441e12b` — Wave 10: 100v100 swarm O(N) navigation indexing (6.3x speedup), modular turret renderer (`turretRenderer.ts`), and boundary visuals.
- `3b1b37b` — Wave 11: Progressive radioactive boundary physics, capital wreckage kinetic impact damage, derived flak ranges (`flakThreatRadius`), and F5 UI persistence.
- `8795e56` — Wave 12: Wolfpack isolated-target focus, anti-kite pursuit limits, containment shield barrier visuals, and builder side persistence.
- `5e52f58` — Wave 13: Threat-aware radiation return across all ship classes with desperate breakthrough, deep-space scintillation ramp past 2nd ring, 120Hz/144Hz frame-rate independent camera follow, and profiling guide (`docs/profiling_and_optimization.md`).
- `5331acb` — Wave 14: Tactical cluster and echelon spawning for large fleets, relative spatial scaling and magic numbers audit (`tacticalSupportRadius`, `antiKitePursuitLimit`), and Y-centering anchor stability.
- `86a220d` — Wave 15A: Fixed HUD container width & stabilized time-based sparkline rate, removed software `shadowBlur` from 340 warp gates, and clamped massive 170v170 fleet spawning safely inward within the primary containment shield.
- `6c68841` — Wave 15C: Widened Performance HUD (`w-64`, 256px), formatted sim latency in milliseconds above 1000 μs, and committed strict hyperparameter rule to `AGENTS.md`.
- `8a41e00` — Wave 15B.1: Eliminated O(N) tender scans in `shieldHaven.ts` (335M checks saved) and pruned missile intercept scans in `fireControl.ts` (468M candidates reduced to 8.6M).
- `02dac4a` — Wave 15B.2: Spatially bounded `returnRouteCost` in `arenaBoundary.ts` with route-reach filtering and `maxCost` short-circuiting (28.6x faster return routing).
- `c6c2263` — Wave 15B Benchmark Tooling: Integrated AST/V8 CPU profiling suite and summary parser in `bench/wave15bProfile.ts` and `bench/wave15bSummary.ts`.
- `3acf4d6` — Wave 15B.3: Optimized navigation target candidate selection in `shipNavigationSystem.ts` and `navigationContext.ts` (navigation time reduced from 33.8 ms to 12.0 ms / tick).
- `4f98a1d` — Wave 17.1: Initial 2.5D visual depth pass for Tier 1 light craft.
- `3aafe1d` — Wave 15B.4: Batched shield haven requests and release recounts in `shieldHaven.ts`, eliminated repeated fleet-wide maintenance, and optimized donor distance to squared radius.
- `75d6e0b` / `1f95859` — Wave 17.4: Interactive 3D Ship Inspector Modal (`ShipInspectorModal.tsx`) with orbit controls (pitch/yaw drag), idle auto-rotation, and recenter button.
- `2b93d98` — Wave 15B.5: Early `inMountArc` arc gating and scalar candidate tracking in `fireControl.ts` (fire control dropped from 44.2 ms to 12.1 ms / tick).
- `176f810` — Wave 15B.6: Scalar swept AABB projectile rejection in `projectileEngine.ts` and separation scalarization in `flightBehaviors.ts` (projectiles dropped from 13.9 ms to 2.2 ms, separation dropped from 11.8 ms to 6.7 ms). Total sim step latency fell to 85.5 ms / tick!
- `342af66` — Wave 17.3: Sculpted 2.5D hull blisters, chiseled armor ridges (`hullArmor.ts`), elevated turret fairings with articulated mantlets, and expanded textless Fleet Builder preview cards.
- `b638a27` — Wave 17.5: Fixed inspector orbit drag direction, elevation-aware true 2.5D side projection, and concentric turret barbette mount rings.
- `37108eb` — Wave 15B.7: Optimized `capitalIntent` fleet scans, scalarized defensive standoff with quadratic distance pruning, and pruned redundant target selection loops.
- `c169405` — Wave 17.6: Fixed vertical drag inversion, added depth-sorted painter's order between bridge and turrets, chined space-hull keel, and aft thruster cowlings.
- `9cbcfaf` — Wave 15B.8: Scalarized torpedo escape, spinal corridor projections, and ordnance avoidance; optimized navigation context tactical density and escort screening.
- `f7c0f32` — Wave 15B.9: Optimized `updateShipNavigation` standoff scans, scalarized flak threat checks and `fighterMissionSystem` safe haven occupancy calculation.
- `03cfcf9` — Wave 17.7: Added carrier "Copy to All" button in Fleet Builder, interactive 3D Inspector subsystem clicking, wheel/button zoom, pause/resume button, 6-second post-drag freeze, and 3D volumetric turret and capital hull extrusions.
- `bb2c7fb` — Wave 17.10: Restored rich solid 2.5D hull volume from golden baseline without rear roof smokestacks, and polished light craft aesthetics.
- `e29be28` — Wave 15B.11: Implemented Phase 1 Zero-Copy Transferable Snapshot Protocol (`simulationWorkerProtocol.ts`) packing 512 ships, 1024 projectiles, and 256 events in a flat 147.5 KB ArrayBuffer.

- `6f1b58d` — Wave 17.11: Sculpted 2.5D volumetric hulls and stepped citadel decks for top 4 heavy capitals (`cruiser`, `battleship`, `dreadnought`, `carrier`).
- `af133bb` — Wave 15B.12: Implemented simulation worker host (`simulation.worker.ts`) and client harness (`simulationWorkerClient.ts`).
- `c9f49df` — Wave 17.12: Elevated lateral sponsons, central citadel, and deck details into 3D volumetric objects across all hulls (`previewDeckDetails.ts`).
- `a465aa0` — Wave 15B.13: Implemented Phase 3 Web Worker UI decoupling, presentation interpolation, and event draining (`simulationPresenter.ts`, `snapshotInterpolation.ts`).
- Wave 18.1: Tactical camera tilt with projected picking, culling and volumetric battlefield ships.
- Phase 3 live wiring and buffer expansion: App connects the Worker presentation; each of three transferable buffers supports 2048 ships, 4096 projectiles, 16384 mounts and 1024 events. Parallel integration verification remains in progress.

## 2. Active Technical Backlog

### 📝 User Review Feedback
- **Paused performance HUD**: Investigate and fix the 60 ↔ 120 Hz sawtooth / comb in paused frame-time sampling; retain honest frame-time and low-FPS reporting.
- **Corvette escort stagnation**: Without a valid friendly capital (for example 200 fighters + 17 corvettes vs 250 fighters), corvettes can remain stationary in escort formation. Fall back to advancing fleet screening or hunting rather than waiting at spawn for flak range.
- **Obstacles and line of sight**: Investigate obstacle collisions and line-of-sight gating for missiles and other projectiles, and obstacle navigation for retreating craft; verify behavior on obstacle maps.
- **2.5D tactical tilt**: Investigate the FPS drop, including hull sprite-cache bypass and projected canvas overhead. Polish containment shields and the tactical grid so tilted concentric boundaries do not resemble vinyl grooves.
- **Profiler roadmap**: Extend profiling beyond the light-craft swarm to multiple fleet archetypes and mixed compositions; compare representative scenarios before choosing further optimizations.

### 🎮 Camera & Tactical Controls (Completed)
- Battlefield pitch ranges from 90° to 25° via middle-drag or Ctrl+left-drag; empty-space double-click and the tilt pill restore 90°.

### 🎨 3D Ship Visuals & Space Anatomy (Terra)
- **Wave 17.12 Completed (`c9f49df`)**: All 8 ship hulls now feature elevated 3D volumetric deck details, lateral sponsons, central citadels, and carrier control islands.

### ⚙️ Engine, Scalability & Web Worker Decoupling (Sol / Astra)
- **Task 15.13 Completed (`a465aa0`)**: Web Worker presentation pipeline and sub-tick interpolation in place; recent fast-suite report: 691 passing tests.
- **Live wiring and capacity expansion**: verify the production Worker path and fallback in a browser, including the expanded three-buffer pool.

### 🚀 Future High-Scale Roadmap (300v300–400v400 / 600–800 Ships Backlog)
- **Always-on hot loops**: Profile contact pair and projectile sweep loops for flat SoA TypedArrays and WASM SIMD kernels while preserving deterministic combat behavior.
- **Cadence caching**: Reuse navigation neighbor lists and fire-control target acquisition across 6–8 ticks (~120–180 ms), with invalidation for urgent changes.
- **Situational worklists**: Gate boundary ships, active missiles, active wrecks and wounded haven seekers by O(1) active counts.
- **Coarse secondary Worker**: At 600–800 ships evaluate read-only batched AI/fire-control scoring matrices, including transfer and synchronization costs.
- **WebGPU Compute Pipeline Evaluation**:
  - Long-term feasibility evaluation for massive swarms (1000+ units): offloading projectile particle tracking and swept collision grids to WebGPU compute shaders, with fallback CPU pathways to prevent degradation on integrated/low-end graphics.

### 📐 Spatial Acceleration & Performance Strategy (Documented)
- Documented in `games/space_battler/docs/profiling_and_optimization.md`:
  - **Dynamic Spatial Grid Rejected**: Avoided heap allocation churn and GC pauses in V8; high-speed craft ($280\,\text{u/s}$) expand search radiuses to the point of negating bucket efficiency.
  - **Scalar AABB Pruning Adopted**: In-place primitive coordinate bounding ($|dx| > R$) rejects >90% of candidate pairs with zero heap allocations while strictly preserving 100% deterministic tie-breaking.
  - **TypedArray / ArrayBuffer Pool**: Three reusable transferable snapshot buffers with expanded limits; integration verification is ongoing.

### 🏆 Faction & Crew Balance + Orchestration Hygiene (Resolved / Standing)
- **Task 14.1 (Crew Veterancy Calibration Tournament)**: Resolved / cancelled as unnecessary; baseline Pilot tier confirmed balanced.
- **Task 16.1 (Orchestrator / CAB Hygiene)**: Fully enforced; batched single-command verification (`test:fast` + `tsc` + `biome`) is standard across all subagent dispatches.
