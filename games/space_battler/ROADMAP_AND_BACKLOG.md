# Space Battler — Tactical Roadmap & Feature Backlog

Last Updated: 2026-11-05
Status: Grand Scale Production Baseline Active (All 198 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed & Calibrated Systems

- **Custom Dual Fleet Builder & Scenario Selector (UI)**: Full two-fleet customization (`Custom Opposing Fleet`), Blue/Red editor tab switcher, one-click Curated & Extreme scenario presets (`Three Knives`, `Needle Cloud`, `1 BB vs 27 Fighters`, etc.), and a "Mirror Fleet" cloning action.
- **Predictive Turret Slewing & Optimistic Aiming**: Turrets outside current firing arc pre-emptively slew to sector limits facing the ship's active target, eliminating acquisition delay upon broadside turn.
- **Calibrate Script Refactoring & Single Source of Truth**: Replaced legacy text-patching in `bench/calibrate.ts` with direct overrides against canonical `shipProfiles.ts` (`HULL_PROFILES`).
- **2.5D Ship Previews & Laser Avoidance**: Debounced rotating 2.5D hull previews on icon hover with depth shading; small craft calculate capital beam laser arcs + turn rate for predictive evasive maneuvers.
- **Fighter Heatmap Dispersal, Flanking Ducts & Audio Synthesis (B.15)**: 200u quadratic repulsion between wing centers, alternating center/±40° attack corridors, wounded retreat (<30% HP) under capital ship umbrellas, and Web Audio procedural combat sound cues (`torpedo_launch`, `flak_burst`, `laser_intercept`, `warp_ingress`, `fighter_egress`).
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

## 2. Priority Feature Backlog (Pending Activation)

- **B.7: Expanded 8-Hull Ship Roster Candidates (Astra-Modelled & Calibrated)**:
  - Heavy Artillery Dreadnought (3-of-4 broadside architecture: bow/aft wide arcs + port/stbd casemates, 3600 CR).
  - Missile Frigate (Quiver class, 4 light missile tubes, shield saturation support, 700 CR).
  - Torpedo Bomber / Heavy Gunship (dedicated anti-capital strike craft).
  - Shield Tender / EW Support (localized shield recharge aura).
  - Plasma Assault Corvette (short-range brawler).
