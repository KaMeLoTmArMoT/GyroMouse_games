# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 159 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed & Calibrated Systems

- **Refined Heavy Torpedo Defense Matrix & Echelon Visuals (B.16)**: 120 HP heavy torpedoes, flak casing degradation (18 dmg), rotary PD bursts (15 dmg), laser PD beams, 3-tier turret target priority, live integrity bar & damage FX, echelon wave pills, and retreat coolant leak trails.
- **Clickable Smart Projectile Telemetry HUD (B.13)**: Click guided torpedoes/missiles to inspect tracking reticle, 60° seeker cone, target pursuit line, and live fuel/speed sidebar card.
- **3-Echelon Staggered Strike Wings & Fuel Limits (B.14)**: 10-craft wings split into 4+3+3 echelons launching every 1.7s (102 frames) to maintain shield suppression; torpedoes capped at 8s fuel to prevent orbiting.
- **Warp Gate Transition & Ingress FX**: Shimmering neon spatial rift aperture expanding and collapsing on match start and remnant rematch with team-coded particles.
- **Beam Laser Post-Channel Cooldown & Fighter Strike Run Fix**: Laser cooldown strictly starts after 1.2s beam completion/cutoff; strike craft engagement starts at $\le 600\text{u}$ so all 30 craft deliver first-pass payloads.
- **300s Stalemate Horizon & Remnant Continuation (B.6)**: 300s draw limit (`winner = -1`), post-match «Продовжити бій» rematch button resetting surviving ships to mirrored spawns with preserved hull/armor damage and full shields.
- **Single Source of Truth (`shipProfiles.ts`)**: Unified canonical hull/weapon profiles (`HULL_PROFILES`), eliminating magic number duplication across fleet builder, UI catalog, and drift test suites.
- **Sustained Channeled Beam Lasers (B.3)**: 1.2s continuous beam channel with 12 discrete 0.1s damage ticks, target tracking, early cutoff, shimmering impact flares, and calibrated DPS.
- **Capital Standoff Envelopes & Cruiser Drift Fix (B.9)**: Dynamic weapon-derived standoffs ($1500\text{u}$ / $1100\text{u}$ / $750\text{u}$); cruisers fly bow-first during approach with lateral drift clamped, broadside-weaving only in firing range.
- **4-Layer Anti-Drift Architecture (`bench/drift.ts`, B.10)**: Layer A isolated sentinels (DPS $\pm 3\%$, 10-missile flak, shield recharge) + Layer B 16-scenario 4-seed panel (duration $\pm 10\%$, HP $\pm 5\text{ pp}$); verified in $5.5\text{s}$.
- **Tactical Group Spatial Spawns (B.11)**: Wings Alpha, Bravo, Charlie, Delta, Echo spawn at distinct spatial anchors with inter-group distance > intra-group spacing.
- **Layer-Specific Hit FX & Damage Decals (B.12)**: Electric blue ripples for shields, molten sparks for armor, explosive fireball/debris for hull; trailing smoke $<50\%$ armor, heavy plumes + red hazard strobes $<30\%$ hull, and scorch decals.
- **Picket Sortie Doctrine & 90% Flak Interception Cap (B.8 & B.2)**: Corvettes sortie to 550u screen (tether 600u) when shields $>70\%$ and fall back below 40%; flak has deterministic 90% interception cap allowing ~10% torpedoes through.

---

## 2. Priority Feature Backlog (Next Sprints)

- **Fighter Heatmap Dispersal & Dynamic Re-echeloning (B.15)**: Wide arc flanking runs, spatial density heatmap repulsion to avoid grouping, wounded regrouping behind friendly screens.
- **B.7: Expanded 8-Hull Ship Roster**: Missile Frigate, Heavy Dreadnought, Plasma Corvette, Shield Tender, Artillery Monitor, Drone Carrier, Torpedo Bomber, Rocket Interceptor.






