# Space Battler Technical Plan

## 1. Completed Milestones

- **Fleet builder and HUD**: Compact symmetric layouts, presets, weapon grouping, crew tiers, fleet copying, battle summaries, advantage and performance telemetry.
- **Fleet tactics**: Skirmish spacing and kiting, capital standoff and targeting, corvette escorts and wolfpacks, fighter evasion and coordinated wings, and tender rescue and shield havens.
- **Carriers and effects**: Staged launches, docking, recovery, repair and fabrication, alongside combat effects, wreckage and synchronized audio.
- **Maps and boundaries**: Obstacle maps and projectile blocking, predictive avoidance, radiation return, containment visuals, and inward-compacted large-fleet spawning.
- **Scalability and profiling**: Allocation-free navigation scoring, bounded spatial scans and scalar AABB pruning accelerated navigation, fire control, projectiles and shield havens; fast tests and CPU profiling support further work.
- **Performance phases 1–3**: Team haven blackboards and a missile payload ledger, reusable separation spatial grid, cached wing centroids and pruned ordnance avoidance are implemented.
- **Rendering and camera**: Viewport culling, cached hull and glow sprites, frame-rate-independent follow, tactical tilt with projected picking and volumetric battlefield ships.
- **2.5D battlefield upgrades**: Volumetric asteroids, spherical dome shields and sprite-baking improvements are implemented; visual review remains open.
- **3D ship visuals**: Volumetric hulls, turrets and deck details across all eight hulls, plus an interactive 3D inspector with orbit, zoom and subsystem selection.
- **Worker presentation**: Live simulation Worker, interpolated snapshots and event draining, using three transferable buffers sized for 2048 ships, 4096 projectiles, 16384 mounts and 1024 events; browser integration verification remains open.

## 2. Active Technical Backlog

### 📝 User Review Feedback (Progress & Status)
- **Paused performance HUD (`7eb8d81`)**: Resolved. Eliminated 60 ↔ 120 Hz comb/sawtooth oscillation in paused frame-time sampling while preserving honest telemetry.
- **Containment boundary visuals (`7eb8d81`)**: Resolved. Replaced harsh concentric vinyl-groove boundary rings under 2.5D tilt with smooth, subtle boundary glow.
- **Cruiser obstacle flanking (`7eb8d81`)**: Resolved. Cruisers whose direct-fire LoS is blocked calculate tangent flanking waypoints around obstacle contours to restore firing solutions without deadlocking.
- **Missile frigate asteroid shelter (`412acfe`)**: Resolved. Missile frigates facing heavy line direct-fire ships utilize asteroid directional cover while launching curved missiles, with threat-flank awareness.
- **Display-refresh interpolation (`412acfe`)**: Resolved. Presentation Hermite interpolation runs at native display refresh rates (120–144 Hz) from 60 Hz Web Worker authoritative snapshots.
- **Tender (Оберіг) shield support discipline (`b76c1c0`)**: Resolved. Tenders under fire maintain shield restoration in capital shield shadow instead of fleeing to the arena edge or idling in combat patrol.
- **Swarm mission loops & spatial grid cell pruning (`7e0f701`)**: Resolved. Swarm 59.75 ms/tick; eliminated O(N) array filter/map allocations in fighter peer scans via spatial grid queries and O(1) team-wing indexing.
- **Corvette escort stagnation (`58dbb77`)**: Resolved. Unanchored corvettes without capital anchors advance as forward screens, maintain wolfpack mutual support, and hunt enemy strike craft rather than stalling at spawn.
- **Obstacles and line of sight**: Additional validation for retreat vectors and complex multi-obstacle maps.

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
  - **Reusable Spatial Grid**: Separation uses typed-array cell storage, conservative clearance and velocity bounds, and ascending source indices; naive allocation-heavy buckets and overly broad queries still need care.
  - **Scalar AABB Pruning**: In-place coordinate bounds reject distant candidates; pruning complements shared worklists and grids rather than eliminating nested full scans on its own.
  - **TypedArray / ArrayBuffer Pool**: Three reusable transferable snapshot buffers with expanded limits; integration verification is ongoing.

### 🏆 Faction & Crew Balance + Orchestration Hygiene (Resolved / Standing)
- **Task 14.1 (Crew Veterancy Calibration Tournament)**: Resolved / cancelled as unnecessary; baseline Pilot tier confirmed balanced.
- **Task 16.1 (Orchestrator / CAB Hygiene)**: Fully enforced; batched single-command verification (`test:fast` + `tsc` + `biome`) is standard across all subagent dispatches.
