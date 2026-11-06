# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (227 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks Phase 1**: Extracted `flightBehaviors.ts` (`StandoffApproachBlock`, `BroadsideWeaveBlock`, `HitAndRunSkirmishBlock`, `LowHealthRetreatBlock`, `calculateSeparation`).
- **Flak Balance Tuning**: Refined corvette flak interception (`triggerRadius: 15`, `blastRadius: 30`, spread `0.035 rad`) to let missile/torpedo swarms break through.
- **2D/2.5D Silhouette Parity**: Rewrote SVG `ShipSilhouette` to 100% mathematical parity with `shipRenderer.ts` across all 6 Terran and 6 Alien hulls.
- **Anti-Overkill Targeting**: Capped missile lock allocations per hull (`strike_craft: 2`, `corvette: 6`, `cruiser: 14`, capital: unlimited) to prevent salvo waste.
- **Compact UI & Ship Doctrine Dialog**: Single-screen zero-scroll fleet builder and interactive state machine modal.
- **Roster Expansion (Dreadnought & Missile Frigate)**: Bastion Dreadnought (3600 CR, 3-of-4 broadsides) and Quiver Missile Frigate (700 CR, fire-and-run kiting).

---

## 2. Active Roadmap: DRY/OOP Behavior Pipeline & Shield Haven

### Phase 1: Behavior Contracts & Reducer Extraction (Sol)
- Decouple heading decisions from velocity calculations.
- Extract dedicated state reducers: `BroadsideCycle` and `SkirmishCycle` (eliminates re-using capital maneuver states).
- Implement explicit range-phase classification (`approach` vs `engage`) to guarantee zero 45° crab-walking.
- Single movement integrator enforcing post-turn lateral drift constraints.

### Phase 2: Shield Geometry & Haven Anchor Allocation (Sol + Terra)
- Authoritative shield scaling (`1.68x` for Battleship, Dreadnought, Cruiser; `1.4x` for small craft).
- Geometry fit validation for 6 docking slots (`port-forward/mid/aft`, `starboard-forward/mid/aft`).
- Simulation-owned `ShieldHavenSystem` with deterministic atomic leasing and hysteresis (<30% HP / broken shields enter; >=75% shield release; <10% parent shield emergency release).

### Phase 3: Moving-Slot Attachment & Collision Bypass (Sol)
- Rotating slot velocity matching $V_i = V_p + \omega \times r_i$.
- Relationship-aware collision exemptions (allow shield overlap for tethered guests while strictly prohibiting hull overlap).
- Bounded ejection corridors on emergency release.

### Phase 4: Umbrella Damage Absorption & Visuals (Sol + Terra)
- Parent shield absorbs incoming external attacks directed at tethered craft.
- Visual FX (tether beams, shield haven connection lines, impact ripples) in `TacticalCanvas.tsx` and `shipRenderer.ts`.

### Phase 5: Dynamic Doctrine UI Synchronization (Terra)
- Dynamic resolver `resolveDoctrine(definition, loadout, order)` feeding `DoctrineDialog.tsx`.
- Real-time structural parameters and state transitions directly rendered from code without authored text duplication.
