# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 67 Vitest + 24 Pytest tests passing)

---

## 1. Recently Completed & Calibrated Systems

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

### B.1: Direct Numeric Input in Fleet Builder (Budget Allocation)
- **Goal**: Allow fleet commanders to type unit numbers directly rather than repeatedly clicking `+` / `-` steppers.
- **Scope**:
  - In `FleetBuilder.tsx`, replace/augment the stepper with an `<input type="number" min="0" max="999" />`.
  - On input change, clamp to maximum affordable quantity within the 20,000 credit budget.
  - Support high-volume swarms (e.g., typing `120` fighters or `10` battleships instantly).

### B.2: Corvette Flak Dispersion & Probabilistic Interception (~90% Cap)
- **Goal**: Prevent corvettes from forming a 100% impervious anti-missile bubble.
- **Problem**: Current flak trigger radius creates deterministic 100% missile destruction if any corvette is within firing arc, completely shutting down missile/torpedo cruisers.
- **Solution**:
  - Introduce slight aim dispersion or an interception reliability check (~90% success rate per intercept opportunity).
  - Allows ~10% of well-timed torpedo salvos to punch through the escort screen to strike high-value capitals.
  - **Constraint**: Must NOT weaken corvette damage or burst radius against strike craft / fighter swarms.

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
