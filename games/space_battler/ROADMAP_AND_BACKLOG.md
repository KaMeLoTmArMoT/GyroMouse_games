# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 134 Vitest + 24 Pytest tests passing)

---

## 1. Recently Completed & Calibrated Systems

- **Warp Gate Transition & Ingress FX**: Shimmering neon spatial rift aperture expanding and collapsing on match start and remnant rematch with team-coded particles.
- **Beam Laser Post-Channel Cooldown & Fighter Strike Run Fix**: Laser cooldown strictly starts after 1.2s beam completion/cutoff; strike craft engagement starts at $\le 600\text{u}$ so all 30 craft deliver first-pass payloads; groups 2/3 rear spawn spacing prevents crowd collisions.
- **300s Stalemate Horizon & Remnant Continuation (B.6)**: 300s draw limit (`winner = -1`), post-match «Продовжити бій» rematch button resetting surviving ships to mirrored spawns with preserved hull/armor damage and full shields.
- **Single Source of Truth (`shipProfiles.ts`)**: Unified canonical hull/weapon profiles (`HULL_PROFILES`), eliminating magic number duplication across fleet builder, UI catalog, and drift test suites.
- **Sustained Channeled Beam Lasers (B.3)**: 1.2s continuous beam channel with 12 discrete 0.1s damage ticks, target tracking, early cutoff, shimmering impact flares, and calibrated DPS.
- **Capital Standoff Envelopes & Cruiser Drift Fix (B.9)**: Dynamic weapon-derived standoffs ($1500\text{u}$ / $1100\text{u}$ / $750\text{u}$); cruisers fly bow-first during approach with lateral drift clamped, broadside-weaving only in firing range.
- **4-Layer Anti-Drift Architecture (`bench/drift.ts`, B.10)**: Layer A isolated sentinels (DPS $\pm 3\%$, 10-missile flak, shield recharge) + Layer B 16-scenario 4-seed panel (duration $\pm 10\%$, HP $\pm 5\text{ pp}$); verified in $5.5\text{s}$.
- **Tactical Group Spatial Spawns (B.11)**: Wings Alpha, Bravo, Charlie, Delta, Echo spawn at distinct spatial anchors with inter-group distance > intra-group spacing.
- **Layer-Specific Hit FX & Damage Decals (B.12)**: Electric blue ripples for shields, molten sparks for armor, explosive fireball/debris for hull; trailing smoke $<50\%$ armor, heavy plumes + red hazard strobes $<30\%$ hull, and scorch decals.
- **Picket Sortie Doctrine & 90% Flak Interception Cap (B.8 & B.2)**: Corvettes sortie to 550u screen (tether 600u) when shields $>70\%$ and fall back below 40%; flak has deterministic 90% interception cap allowing ~10% torpedoes through.
- **Direct Numeric Input in Fleet Builder (B.1)**: Quantity steppers support direct typing, budget clamping, pre-focus restore on Escape, and strict non-digit key blocking.
- **Grand Scale Arena & Sizing Calibration**: Expanded arena radius ($R=1900\text{u}$), shield-safe fleet spawn offsets ($\pm 1100\text{u}$), calibrated capital turn rates ($0.50\text{ rad/s}$).

---

## 2. Priority Feature Backlog (Next Sprints)

- **B.5: Weapon Caliber Matrix & Echelon Strikes**: Explicit projectile calibers (Flak vs Rotary PD vs Heavy Torpedo) + 3-echelon staggered strike waves ($\Delta t = 1.7\text{s}$) based on Astra's analytical model.
- **B.7: Expanded 8-Hull Ship Roster**: Missile Frigate, Heavy Dreadnought, Plasma Corvette, Shield Tender, Artillery Monitor, Drone Carrier, Torpedo Bomber, Rocket Interceptor.





