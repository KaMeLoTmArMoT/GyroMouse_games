# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 105 Vitest + 24 Pytest tests passing)

---

## 1. Recently Completed & Calibrated Systems

- **Capital Standoff Envelopes & Cruiser Drift Fix (B.9)**: Dynamic weapon-derived standoffs ($1500\text{u}$ / $1100\text{u}$ / $750\text{u}$); cruisers fly bow-first during approach with lateral drift clamped, broadside-weaving only in firing range.
- **4-Layer Anti-Drift Architecture (`bench/drift.ts`, B.10)**: Layer A isolated sentinels (DPS $\pm 3\%$, 10-missile flak, shield recharge) + Layer B 16-scenario 4-seed panel (duration $\pm 10\%$, HP $\pm 5\text{ pp}$); verified in $5.7\text{s}$.
- **Tactical Group Spatial Spawns (B.11)**: Wings Alpha, Bravo, Charlie, Delta, Echo spawn at distinct spatial anchors with inter-group distance > intra-group spacing.
- **Layer-Specific Hit FX & Damage Decals (B.12)**: Electric blue ripples for shields, molten sparks for armor, explosive fireball/debris for hull; trailing smoke $<50\%$ armor, heavy plumes + red hazard strobes $<30\%$ hull, and scorch decals.
- **Picket Sortie Doctrine & 90% Flak Interception Cap (B.8 & B.2)**: Corvettes sortie to 550u screen (tether 600u) when shields $>70\%$ and fall back below 40%; flak has deterministic 90% interception cap allowing ~10% torpedoes through.
- **Direct Numeric Input in Fleet Builder (B.1)**: Quantity steppers support direct typing, budget clamping, pre-focus restore on Escape, and strict non-digit key blocking.
- **Grand Scale Arena & Sizing Calibration**: Expanded arena radius ($R=1900\text{u}$), shield-safe fleet spawn offsets ($\pm 1100\text{u}$), calibrated capital turn rates ($0.50\text{ rad/s}$).
- **Billiards Trajectory & Tactical HUD**: Clicked ship projects a 2.5s future vector with endpoint reticle, target lock brackets, and tactical doctrine pills.
- **Torpedo Seeker Homing**: 60° forward cone with gentle 1–3% turn rate correction ($0.40\text{ rad/s}$) and non-reversing lock loss.

---

## 2. Priority Feature Backlog (Next Sprints)

- **B.3: Sustained Beam Lasers**: Continuous channeled laser beam over 1.5–2.5s dealing high-frequency tick damage with shimmering shields.
- **B.4: Directional Shield Quadrants**: 4-quadrant shields (Front, Aft, Port, Starboard) rewarding tactical flanking and broadside weaving.
- **B.5: Weapon Slot Sizing & Dedicated Rear Defense**: Architectural mounts (Huge Spinal, Medium Broadsides, dedicated rear Anti-Fighter point defense).
- **B.6: 300s Stalemate Horizon & Tactical Fleet Retreat**: Hard 300s draw limit with persistent fleet health snapshots for campaign retreat/rematch.
- **B.7: Expanded 8-Hull Ship Roster**: Missile Frigate, Heavy Dreadnought, Plasma Corvette, Shield Tender, Artillery Monitor, Drone Carrier, Torpedo Bomber, Rocket Interceptor.



