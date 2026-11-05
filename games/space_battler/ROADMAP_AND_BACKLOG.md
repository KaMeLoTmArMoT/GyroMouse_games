# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 88 Vitest + 24 Pytest tests passing)

---

## 1. Recently Completed & Calibrated Systems

- **Picket Sortie Doctrine & 90% Flak Interception Cap (B.8 & B.2)**: Healthy corvettes deploy to a 550u forward/lateral screen (tether 600u) and fall back below 40% shields; flak has a deterministic 90% interception cap allowing ~10% torpedoes through.
- **Direct Numeric Input in Fleet Builder (B.1)**: Quantity steppers support direct typing, budget clamping, pre-focus restore on Escape, and strict non-digit key blocking.
- **Grand Scale Arena & Sizing Calibration**: Expanded arena radius ($R=1900\text{u}$), shield-safe fleet spawn offsets ($\pm 1100\text{u}$), calibrated capital turn rates ($0.50\text{ rad/s}$).
- **Billiards Trajectory & Tactical HUD**: Clicked ship projects a 2.5s future vector with endpoint reticle, target lock brackets, and tactical doctrine pills.
- **Torpedo Seeker Homing**: 60° forward cone with gentle 1–3% turn rate correction ($0.40\text{ rad/s}$) and non-reversing lock loss.

---

## 2. Active Implementation Sprints

### B.9: Capital Standoff Envelopes & Cruiser Sideways Drift Fix
- **Standoff Range**: Compute dynamic standoff from equipped weapon ranges ($1500\text{u}$ max_range, $1100\text{u}$ optimal, $750\text{u}$ brawl) instead of legacy 840u hardcode.
- **Cruiser Drift Fix**: Fix flight controller so cruisers align bow with movement vector while advancing, pivoting to broadside only once inside engagement range rather than awkward sideways crab-walking.

### B.10: 4-Layer Anti-Drift Architecture (`bench/drift.ts`)
- **Layer A (Isolated Sentinels, <1.5s)**: Fixtures for direct gun fire (DPS $\pm 3\%$), flak intercept against fixed salvos, and shield recharge cycles.
- **Layer B (Segmented Panel, 5-8s)**: Segmented metrics per archetype (artillery duration/tempo, escort intercept ratios, fighter survival AUC).
- **Layer C (Immutable Anchor)**: Committed reference baseline with single-command update `npm run bench:update-golden`.
- **Layer D (Diagnostic Tracing)**: Detailed breakdown identifying weapon/class attribution on failure.

### B.11: Tactical Group Spatial Spawn Offsets
- In `fleetBuilder.ts`, assign spatial spawn origins per group (Alpha, Bravo, Charlie, Delta, Echo) with inter-group distance significantly larger than intra-group ship spacing, creating distinct tactical wings.

### B.12: Layer-Specific Hit FX & Visual Damage Decals
- **Hit FX**: Distinct visual impact effects per layer: electric blue distortion ripple (Shield), molten ricochet sparks (Armor), explosive fireball and metal debris (Hull).
- **Damage Decals & States**: Scorch marks at hit offsets, progressive smoke trails below 50% armor, and heavy smoke/emergency warning strobes below 30% hull.

---

## 3. Priority Feature Backlog

- **B.3: Sustained Beam Lasers**: Continuous channeled laser beam over 1.5–2.5s dealing high-frequency tick damage with shimmering shields.
- **B.4: Directional Shield Quadrants**: 4-quadrant shields (Front, Aft, Port, Starboard) rewarding tactical flanking and broadside weaving.
- **B.5: Weapon Slot Sizing & Dedicated Rear Defense**: Architectural mounts (Huge Spinal, Medium Broadsides, dedicated rear Anti-Fighter point defense).
- **B.6: 300s Stalemate Horizon & Tactical Fleet Retreat**: Hard 300s draw limit with persistent fleet health snapshots for campaign retreat/rematch.
- **B.7: Expanded 8-Hull Ship Roster**: Missile Frigate, Heavy Dreadnought, Plasma Corvette, Shield Tender, Artillery Monitor, Drone Carrier, Torpedo Bomber, Rocket Interceptor.



