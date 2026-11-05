# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 88 Vitest + 24 Pytest tests passing)

---

## 1. Recently Completed & Calibrated Systems

- **Corvette Picket Sortie Doctrine & 90% Flak Interception Cap (B.8 & B.2)**:
  - **Picket Sortie (Anti-Burrow)**: Corvettes with healthy shields ($\text{shieldRatio} > 0.70$) now deploy into an active 550u forward/lateral picket screen with a 600u operational tether, screening against torpedoes and engaging strike craft rather than idling 120u ahead of the flagship.
  - When shields drop below 40%, corvettes smoothly fall back under the flagship's defensive flak umbrella.
  - **90% Flak Reliability Cap**: Deterministic stable per-missile hash dispersion (`(dispersion >>> 0) / 0x100000000 >= 0.9`) allows ~10% of torpedoes in a salvo to punch through the screen to strike capitals. Overlapping flak bursts do not defeat the cap. Strike craft damage remains at 100% full strength.
  - Verified by deterministic 1000-missile salvo tests in `simulation.test.ts`.

- **Direct Numeric Input in Fleet Builder (`FleetBuilder.tsx`, B.1)**:
  - Quantity steppers feature an interactive, monospace number input allowing direct click, delete, and typing (e.g. typing `10` battleships or `120` fighters).
  - Focus protection: `initialCountRef` captures pre-focus value so pressing `Escape` cleanly restores the original roster count.
  - Strict input rejection: non-digit characters (`-`, `.`, `e`, `+`) are blocked on `onKeyDown`.
  - Strict budget clamp: $\text{maxAffordable} = \text{stack.count} + \lfloor \text{remainingBudget} / \text{unitCost} \rfloor$.
  - Verified by 19 unit tests in `fleetBuilder.test.ts`.

- **Grand Scale Arena & Sizing Calibration**:
  - Arena radius expanded to $R = 1900\text{u}$ with hard-pull boundary $R_{\text{hard}} = 2200\text{u}$.
  - Fleet spawn origins at $x = \pm 1100\text{u}$ with dynamic shield-safe layout spacing:
    $$\text{spacing} = (r_A \times 1.4 + r_B \times 1.4) \times 1.15 + 20$$
  - Battleship inertia and turn rate tuned to $0.50\text{ rad/s}$ ($4.0\text{s}$ broadside-to-broadside cycle).
  - Headless benchmark validation: 88-battle suite completed in $22.7\text{s}$ with 0 timeouts.

- **Billiards-Style Trajectory Prediction & Tactical HUD**:
  - Clicking any friendly or enemy vessel renders an extrapolated dotted vector $+2.5\text{s}$ into the future.
  - End waypoint ring with 4-axis crosshair reticle showing projected arrival point and distance.
  - Tactical Target Lock vector with red corner brackets `[ TARGET ]` and live range readout.
  - Contextual HUD pill displaying vessel speed and current doctrine intent (`BROADSIDE COMBAT`, `BOW PURSUIT`, `EVADING SPINAL FIRE`, `STRIKE RUN`, `SCREEN & FLAK FIRE`).

- **Torpedo Seeker Homing (Gentle 1–3% Course Correction)**:
  - Guided trajectory within a $60^\circ$ forward seeker cone.
  - Turn rate clamped to $\approx 0.40\text{ rad/s}$ (~1–3% heading adjustment per second).
  - Non-reversing constraint: target lost or overshot if outside seeker cone, preventing unnatural $180^\circ$ reversals.
  - Headless benchmark: 5/5 Golden Set scenarios completed in $0.89\text{s}$ wall time with 0 alerts.

---

## 2. Priority Backlog (Next Implementation Sprints)

### B.3: Sustained Beam Lasers (Channeled Continuous Tick Damage)
- **Goal**: Make beam weapons feel like true heavy energy beams instead of instant hitscan pulses.
- **Mechanics**:
  - Continuous beam channeled over 1.5–2.5 seconds.
  - Deals damage in high-frequency ticks (every 0.1s) while beam is on target.
  - Dynamic beam origin and end point tracking as target and firing ship maneuver.
  - Shields shimmer continuously under sustained beam load.

### B.4: Directional Shield Quadrants (Star Trek / FTL Style)
- **Goal**: Reward tactical flanking and broadside weaving by tracking shield integrity per quadrant.
- **Mechanics**:
  - Hull shields split into 4 independent quadrants: Front, Aft, Port, Starboard.
  - Hits deplete only the facing quadrant.
  - Once a quadrant collapses, armor and hull take direct damage on that side even if other quadrants are at 100%.
  - Regenerative power can be balanced equally or routed to damaged facings.

### B.5: Weapon Slot Sizing & Dedicated Rear Defense
- **Goal**: Architectural ship loadout balance across Small, Medium, Large, and Huge weapon mounts.
- **Mechanics**:
  - Battleships: 1 Huge Spinal Mount, 2 Medium Broadside Batteries, 1 Small Dedicated Rear Point-Defense Mount to discourage trailing fighters.
  - Cruisers: 1 Large Torpedo Tube, 1 Medium Beam Turret.
  - Corvettes: 2 Small Rapid Flak Mounts.

### B.6: 300s Stalemate Horizon, Tactical Draw & Campaign Retreat
- **Goal**: Cleanly resolve prolonged standoffs or circular kiting.
- **Mechanics**:
  - Hard limit at 300 seconds triggers a formal Tactical Stalemate (Draw).
  - Snapshot surviving ships, current HP, and armor state.
  - Enables persistent campaign mechanics: fleet retreat, repair, or tactical rematch.

### B.7: Expanded Ship Roster (8 Specialized Hulls)
- Guided Missile Frigate (lateral salvo tubes).
- Broadside Heavy Dreadnought (dual-bank heavy kinetics).
- Plasma Burst Corvette (anti-corvette brawler).
- Shield Support Tender (remote shield recharge beam).
- Artillery Sniper Monitor (extreme-range slow spinal cannon).
- Light Drone Carrier (autonomous micro-fighter swarms).
- Heavy Torpedo Bomber (anti-capital strike wing).
- Rocket Interceptor (fast swarm defense).

### B.9: Capital Ship Standoff & Range Harmony (Eliminating Legacy Hardcoded Margins)
- **Problem (Excessive Ingress / Capital Cluster Brawls)**:
  - In `flightControl.ts:259–270`, capital standoff distance is hardcoded to legacy pre-Grand-Scale values:
    - Battleship: `optimal_range = 840u`, `brawl = 620u`, `max_range = 1180u`.
    - Cruiser: `optimal_range = 740u`, `brawl = 560u`, `max_range = 1250u`.
  - However, in Grand Scale:
    - Battleship Railguns have **1800u** range; Broadsides have **1200u** range.
    - Cruiser Torpedoes have **1800u** range; Beams have **1100u** range.
  - Because `nominal` is still 840u / 740u, capital ships unnecessarily dive straight into close-quarters knife-fights rather than maintaining majestic standoff artillery duels with broadside weaving.
- **Solution**:
  - Dynamically compute `nominal` standoff distance directly from equipped weapon ranges:
    - `max_range`: $\min(\text{primaryGun.range} \times 0.85, 1500\text{u})$ ($\approx 1500\text{u}$ for BBs).
    - `optimal_range`: $\min(\text{secondaryBattery.range} \times 0.90, 1150\text{u})$ ($\approx 1080-1150\text{u}$ for BBs and Cruisers).
    - `brawl`: $750-800\text{u}$.
  - Secondary battery fire control: allow port/starboard batteries to independently target secondary threats (e.g. nearby cruisers or screening corvettes) even while the spinal gun pursues the primary capital flagship.

### B.10: Creeping Drift Prevention & Tiered Multi-Seed Guardrail (Analyzed & Ready)
- **Problem (The "1% Drift Over 10 Changes" Risk & Chaotic Bifurcation)**:
  - Boolean test assertions (e.g. `expect(winner).toBe("blue")`) only catch catastrophic flips (0% vs 100%).
  - Minor procedural or physics tweaks can slowly erode HP retention by 1% per commit. By commit 10, a fleet is at the edge of collapse.
  - Crucial finding from Astra: symmetric dogfights (`3 SC vs 3 SC`) naturally bifurcate between seeds. A naive single-seed baseline would falsely fail. Multi-seed averaging across 4 deterministic seeds (`[1, 7, 29, 42]`) converts this flip into a smooth, stable statistical mean.
- **Specification**:
  - **Committed Golden Baseline Snapshot** (`bench/results/golden_baseline.json`):
    - Compact ~10 KB JSON recording aggregated metrics across 16 scenarios on 4 seeds (64 battles in 5.9s wall time):
      - `residualHpPercent` (armor + hull retention; shields excluded)
      - `duration` (time to decisive victory)
      - `firstShotTime`
  - **Automated Anti-Drift Check (`npm run bench:drift`)**:
    - Asymmetric tolerance: $|\Delta \text{Residual HP}| \le \pm 5.0\text{ pp}$, $|\Delta \text{Duration}| \le \pm 10.0\%$.
    - Symmetric tolerance: $|\Delta \text{Duration}| \le \pm 15.0\%$, zero timeouts.
    - Zero tolerance: no RAM, OOB, STALL, or unhandled errors.
  - **One-Command Update (`npm run bench:update-golden`)**:
    - Re-serializes clean formatted baseline when intentional rebalances are committed.


