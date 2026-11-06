# New Ship Class Pipeline (Space Battler 2.5D)

Standardized engineering and balance protocol for introducing new ship classes into the fleet roster.

---

## The 7-Stage Pipeline

```
[1. Math & Bench (Astra)] ──> [2. Flight Doctrine] ──> [3. Profile & FleetBuilder]
          │
          ▼
[4. Core Mechanics (Sol)] ──> [5. 2.5D SVG & Canvas (Terra)] ──> [6. Fleet UI (Terra)]
          │
          ▼
[7. Headless Matchup Verification]
```

### Stage 1: Mathematical Modeling & Throughput Benchmarks (Astra)
- **Tooling**: `bench/rosterExpansionProfiles.ts` & `bench/rosterExpansion.ts`.
- **Methodology**:
  - Define candidate profile: size, cost, hull, armor, armor rating, shield, shield regen.
  - Define mounts, weapon types, arcs, cycle times, and damage delivery ratios.
  - Run stationary damage experiments across seeds `[1, 7, 42, 2026]`:
    - Shield-break time ($t_{\text{break}}$).
    - Time-to-kill ($t_{\text{kill}}$) against baseline targets (Strike Craft, Corvette, Cruiser, Battleship, Dreadnought).
    - Net Effective Hit Points (EHP) per credit: $\text{EHP}/\text{CR} = \frac{\text{Hull} + \text{Armor} \times \text{RatingMult} + \text{Shield}}{\text{Cost}}$.
  - Ensure candidate does not create degenerate win rates or infinite regeneration stalemates.

### Stage 2: Flight & Tactical Doctrine
- **Location**: `src/engine/shipDoctrines.ts`.
- **Actions**:
  - Assign or author flight doctrine: `kind: "capital" | "skirmish" | "escort" | "carrier" | "support"`.
  - Set standoff distances, breakoff angles, retreat health thresholds, and lateral speed damping.

### Stage 3: Hull Profile & Fleet Registration
- **Location**: `src/engine/shipProfiles.ts` & `src/types/combat.ts`.
- **Actions**:
  - Add hull class to `HullClass` union type if introducing a new category.
  - Register profile in `HULL_PROFILES` with authoritative costs, sizes, base speeds, turn rates, and turret layouts.
  - Register default squad / wing sizes in `src/engine/fleetBuilder.ts`.

### Stage 4: Specialized Engine Systems (Sol)
- **Location**: Domain modules under `src/engine/` (e.g. `shieldHaven.ts`, `beamLaserSystem.ts`, `carrierHangar.ts`).
- **Actions**:
  - Implement unique class mechanics (e.g. Carrier 8-slot recovery queue, fabrication timers, support harmonic beams).
  - Connect lifecycle updates into `simulation.ts` without bloating coordinator files.

### Stage 5: 2.5D Art, SVG Silhouette & Canvas Renderer (Terra)
- **Location**: `src/canvas/shipRenderer.ts` & `src/components/ShipSilhouette.tsx`.
- **Actions**:
  - Render crisp vector SVG silhouette in `ShipSilhouette.tsx` for cards and badges.
  - Implement 2.5D hull renderer in `shipRenderer.ts`:
    - Faceted bevels, armored plating layers, and team-colored glow accents.
    - Specialized visual parts: flight decks, landing runways, animated bay lights, heavy exhausts.
    - Authoritative turret mount positions and firing arc indicators.

### Stage 6: Fleet Builder & Tactical UI Integration (Terra)
- **Location**: `src/App.tsx`, `FleetBuilder.tsx`, `src/canvas/TacticalCanvas.tsx`.
- **Actions**:
  - Add ship card to fleet builder with live cost calculation.
  - Render specialized toggles/checkboxes (e.g. pre-loaded wings, docked escorts).
  - Add tactical inspection HUD tags (intent, recovery status, hangar capacity).

### Stage 7: Headless Verification & Matchup Balance
- **Location**: `tests/rosterExpansion.test.ts`, `tests/benchmark.test.ts`, `tests/fleetBuilderMatchups.test.ts`.
- **Actions**:
  - Write unit tests for new profile loading and mechanics.
  - Run full suite (`npx vitest run`) to verify all existing and new fleet matchups pass without regressions.

