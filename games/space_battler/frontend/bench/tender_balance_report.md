# EW Shield Tender «Оберіг» — Stage 1 calibration

## Decision

Recommend **1,250 CR**, **650 shield / 450 armor / 800 hull**, one light flak mount, and a **65 SP/s harmonic channel lasting 6 seconds per 10-second cycle**. This buys support throughput, not a superior frontline hull. Prohibit harmonic transfer to all Tenders, including self, and permit only one channel per recipient.

**Tracking-only ECM does not yet satisfy the anti-swarm concept.** The tested 600u / 8s pulse with 35–50% turn reduction caused no additional Quiver misses in the tested trajectories. Treat the 45% / 3s specification below as a provisional implementation baseline, not demonstrated reliable missile interception. Do not price an assumed missile-kill percentage into the hull. Haven amplification is an analytical recommendation, not an engine-integrated result.

## Reproduction and scope

Run from `games/space_battler/frontend`:

```sh
npx tsx bench/tenderBalance.ts
npx tsx bench/tenderBalance.ts --json
```

The first command emits compact per-seed results; the second emits profiles, engine hashes, all observations and timings. There are **136 live combat experiments**, **96 guidance batches**, and **30,720 individual missile flights**. Seeds, in every vector below, are **[1, 7, 42, 2026]**. Step is 1/60s; combat cap is 90s. Final run took **15.49s** wall time. Null times mean the event was not observed by the cap, not infinite survival.

### Live combat experiment

- Uses `ClientCombatSimulation`, real weapon targeting, beam pulses, projectile collision, flak interception, armor penetration, recharge delays, and `CombatTelemetry`.
- Cruiser/Battleship recipients are stationary, unarmed, initially at 25% shield (additional quiet tests start at 0%). Armor/hull start full. Initial shield delay is the full profile delay.
- A research-only external channel supplies shield before each engine step. This isolates maximum available support: the donor is assumed alive, in range, with uninterrupted channel availability. No donor collision, range breaks, power subsystem, or targeting AI is modeled.
- Tender survivability uses a stationary missile-frigate-class surrogate with the recommended profile and one stock Aegis flak mount. It has no haven privileges. Candidate speed and turn rate are recommendations, not movement-calibrated results.
- Quivers and capitals fire from 900u, hostile Aegis escorts from 350u. Raiders start at 500u and use live moving-fighter AI. Attacker bearing receives seeded jitter; deterministic stationary cases can legitimately match across seeds. Capitals are bow-on: Battleship TTK is not a simultaneous all-batteries broadside test.
- ECM/aura are absent from the live combat cases; their benefits are not silently included in the TTK or beam results.
- Assertions check telemetry errors and shield conservation: initial shield + native regeneration + external transfer − shield damage = final shield. Tender transfer denial is checked both on a depleted pair for all 5,400 ticks and through paired combat runs with attempted transfer enabled/disabled, which must be identical.

### ECM experiment

An explicitly isolated guidance surrogate uses the engine's `sweptHit` and angle math, live missile speed/fuel, hardcoded engine guidance limits (2.5 rad/s light missile; **0.8 rad/s heavy torpedo**, not the launcher's 1.5 tracking statistic), and the torpedo's ±60° steering gate. It is not a patched production ECM system.

Each seed has 128 independent salvos per threat/movement/penalty combination. Quiver launches four missiles 0.2s apart (512 missiles per seed); heavy torpedo launches one (128 per seed). Launch radius is uniformly 700–1,100u about the aura center; bearing, initial aim error ±0.075 rad, orbit phase, and pulse phase are seeded. Matched ECM-on/off batches use identical random draws.

Targets are stationary or follow a 150u-radius circle at 75 or 175u/s around a fixed Tender/aura center. Their collision envelope remains 44.8u (32 × 1.4) throughout. The 175u/s case is an escort-like maneuverability stress test, not physically attainable by the proposed Tender. It also is not a capital-sized hitbox test. No navigation, hull collision, shield depletion, seeker reacquisition, splash, PD, or randomized fuse kills are included. The target remains present; all flights terminate at impact or fuel exhaustion. Misses and interceptions are distinct: **PD/ECM destruction = 0 in every guidance batch**.

Pulse is an instantaneous 360° snapshot of hostile missiles within 600u every 8s, with random phase relative to launch. Affected missiles have reduced turn limit for 3s, including after leaving the radius. This is not an always-on 600u jamming volume. A rendered expanding wave can represent this instantaneous gameplay event; changing to finite propagation requires recalibration.

## Recommended hull

| Property | Recommendation |
|---|---:|
| Size (engine radius-like size statistic) | 32u |
| Hull | 800 HP |
| Armor | 450 AP |
| Armor rating | 30 |
| Shield | 650 SP |
| Native shield regeneration | 15 SP/s |
| Recharge delay after damage | 3s |
| Speed | 75u/s |
| Turn rate | 0.80 rad/s |
| Cost | 1,250 CR; tuning bracket 1,150–1,350 |
| PD | 1 stock Aegis light flak mount, 360°, range 420u |

Flak retains 10 damage / 0.3s cooldown, projectile speed 1,500u/s, 0.32s lifetime, 15u trigger radius, 30u blast radius, and 18 missile damage. A second mount is not justified by this evidence: even one permits survival to 90s against two Quivers, while the ship remains vulnerable to Raiders and capital fire.

### EHP and economics

Use packet-specific raw-damage EHP, excluding regeneration:

`EHP(D) = S / shieldMultiplier + A × (D + armorRating) / (D × armorMultiplier) + H / hullMultiplier`.

This is an analytical full-packet layer estimate. Actual boundary-crossing packets can have lower penetration after shield absorption; real TTK is measured separately. A single universal EHP number cannot represent plasma, shieldbreakers, and armored torpedoes equally.

| Hull (live cost except research Tender) | CR | Neutral 100-damage EHP | EHP/CR |
|---|---:|---:|---:|
| Оберіг | 1,250 | 2,035 | 1.628 |
| Quiver | 700 | 696 | 0.994 |
| Cruiser | 1,100 | 1,975 | 1.795 |
| Battleship | 3,200 | 8,500 | 2.656 |

Tender EHP/CR at 1,150 / 1,250 / 1,350 CR is **1.770 / 1.628 / 1.507**. At the midpoint it has ~3% more neutral EHP than a Cruiser but costs ~14% more and lacks capital offensive weapons. Maximum sustained beam output per 1,000 CR is **31.2 SP/s**. Over 90s the beam can supply 3,510 SP, or 2.808 SP/CR, only while a damaged valid recipient remains available. This is useful throughput, not a claim that shield points have a fixed credit value or that the price is proven by fleet win rates.

## Harmonic beam

| Property | Recommendation |
|---|---|
| Range | 500u center-to-center, one allied recipient |
| Active rate | 65 SP/s |
| Channel | 6s |
| Cooldown | 4s after channel; 10s start-to-start |
| Maximum delivery | 390 SP/cycle; sustained 39 SP/s |
| Power constraint | Dedicated 390-unit channel capacitor, 1 unit/SP; no recharge during channel; 97.5 units/s during the 4s cooldown |
| Depleted shields | Can restart from 0; capped at shieldMax; never repairs armor/hull |
| Native recharge | Independent; taking damage still resets native delay |
| Recipient restriction | No self or Tender-class recipients; one incoming harmonic channel maximum |
| Interruptions | Losing range, donor death, or invalid target ends the channel; cannot reset/restart its 10s cycle by retargeting |
| Overheal | Discard unused throughput; cannot bank extra charge or exceed 390 units |

The capacitor is an equivalent implementation specification for the tested fixed duty cycle, not an existing engine power resource. Make the cycle/capacitor the same budget, not two separately rechargeable mechanisms. With no native regeneration and no incoming fire, a 450-SP deficit requires 10.92s and a 1,650-SP deficit 41.38s under this duty cycle. In live quiet tests native regeneration shortens these times:

| Recipient / initial shield | Native only full recharge | With Tender full recharge |
|---|---:|---:|
| Cruiser / 25% (450 deficit) | 19.20s | 5.33s |
| Cruiser / depleted (600 deficit) | 25.20s | 9.60s |
| Battleship / 25% (1,650 deficit) | 34.52s | 18.92s |
| Battleship / depleted (2,200 deficit) | 45.52s | 24.32s |

All four seeds agree in quiet tests. For the damaged Cruiser, `(450 + 25 × 1.2) / (65 + 25) = 5.333s`, matching the observed result. Discrete engine recharge delay can add one step.

### Incoming fire and recharge

One Quiver's nominal shield load is `4 × 36 × 2 / 4.8 = 60 SP/s`; two are 120 SP/s. One Raider's all-hit nominal shield load is `120 / 3 = 40 SP/s`. Real deliveries differ due to maneuvering, cooldown quantization, collision and regen windows. Do not subtract constant native regen under uninterrupted fire.

**No attacked Cruiser or Battleship reached full shield within 90s in this suite**, with or without the beam. Survival results, starting at 25% shield:

| Recipient / attackers | TTK without beam, seeds [1,7,42,2026] | TTK with beam |
|---|---|---|
| Cruiser / 1 Quiver | >90 each | >90 each |
| Cruiser / 2 Quivers | 46.37 each | 79.65 each |
| Cruiser / 2 Raiders | 24.55, 23.53, 23.75, 24.65 | >90 each |
| Cruiser / 4 Raiders | 9.00, 9.10, 8.52, 9.25 | 16.70, 16.92, 16.47, 17.02 |
| Battleship / 1 or 2 Quivers | >90 each | >90 each |
| Battleship / 2 Raiders | >90 each | >90 each |
| Battleship / 4 Raiders | 56.67, 55.98, 55.57, 56.37 | >90 each |

Against one Quiver, the supported Battleship ends at **1,020.5 SP** in every seed; unsupported ends at zero. Against two Quivers both end at zero. Against two Raiders supported Battleship final shield is **[892.50, 895.00, 897.50, 924.17]**, versus **[45.83, 45.83, 49.17, 0]**. Against four Raiders the supported Battleship survives but ends near depletion: **[4.17, 37.50, 58.33, 32.50] SP**.

The supported Cruiser versus two Quivers receives 3,120 SP before death, extending TTK by **~71.8%**. Against four Raiders it receives 780 SP before death. Survivors with sustained pressure generally consume the full 3,510-SP 90s budget. Support can sustain a larger recipient against some small raiding forces; this is an intended niche, not evidence of Tender self-immortality. Fleet price validation still needs a killable donor and equal-budget opponent compositions.

## Survivability and regeneration-stall constraints

Tender starts at full layers, uses one real flak mount, and cannot receive harmonic transfer:

| Focus fire | TTK seconds, seeds [1,7,42,2026] | Observation |
|---|---|---|
| 2 Aegis escorts | 62.75 each | Low-caliber pressure kills eventually |
| 2 Quivers | >90 each | Shield depleted; PD kills [107,95,107,107] missiles |
| 4 Raiders | 15.37, 13.95, 15.30, 17.67 | Swarm remains a counter |
| 1 Cruiser | 27.52 each | No heavy torpedoes intercepted |
| 1 bow-on Battleship | 21.70 each | Long-range capital counter |

These interception numbers are **counts**, not rates: launches/in-flight ordnance were not collected for the survivability fixture. No ECM benefit is included. The paired attempted-heal version of every Tender scenario returns identical observations and zero external SP. A depleted pair also receives zero shield from repeated mutual-transfer attempts. This establishes the specified cross-heal denial invariant; it is not a two-Tender moving-fleet AI test.

Even before this prohibition, a Cruiser's nominal shield DPS is `220 / 5.5 + 45 × 0.5 / (1.2 + 1.2) = 49.375`, greater than the channel's sustained 39 SP/s. The prohibition is stronger: there is no harmonic healing edge into a Tender at all, so a cycle of two or more Tenders cannot generate mutual regeneration. Native 15 SP/s only activates after a 3s damage gap. Do not implement a shared recipient cap as merely per-donor: multiple donors could otherwise bypass it. The policy excludes support-generated stalls, not all stalemates under arbitrarily weak or absent fire.

## Haven amplification

Recommend **1.20× parent haven radius**, while a live Tender is within **500u of the parent**, and **0.90× raw overflow damage to a tethered guest** on the hit that exhausts the parent's shield. Strongest single aura only; no stacking, no increased shield pool/regen, no extra lease slots, no continued guest damage reduction after haven loss. Does not grant Tender guest eligibility.

Current capital envelope is `size × 1.68`: Cruiser **63.84 → 76.608u**, Battleship **114.24 → 137.088u**. Radius +20% means area +44%, not +20%. A 25% radius boost would give +56.25% area; start with the smaller option. Existing six authoritative lease slots and their offsets remain the baseline; a larger circle alone does not prove improved guest throughput.

Current haven mechanics have **zero bleed-through while parent shield fully absorbs the hit**. Thus “10% less bleed-through” cannot mean changing an existing constant from, for example, 20% to 10%. Define `overflow = max(0, rawDamage − parentShieldAbsorbed / shieldMultiplier)` and apply `0.9 × overflow` to the guest before its own layers. Example: a 220-damage torpedo with 100 parent SP remaining produces 120 raw overflow, reduced to 108. Snapshot the lease/aura at impact, because shield exhaustion immediately releases guests. Parent still pays its full absorbed damage.

Aura arithmetic above is analytical, not simulated navigation or integrated overflow resolution. Enlarging the authoritative shield envelope also enlarges the incoming-fire hitbox and repulsor geometry; this can offset the benefit. Stage 2 must verify guest routing, lease release, collision boundaries, and non-stacking before treating the aura as a net survivability gain.

## ECM calibration evidence

Provisional specification: **600u, 360°, pulse every 8s, −45% turn rate for 3s**, no guaranteed fuse detonation, no damage, no fuel extension. For overlapping Tenders, keep the strongest penalty and do not extend an existing debuff with another source. Recommend a shared 8s per-missile reapplication lockout to prevent permanent multi-Tender jamming; this multi-emitter constraint was not part of the single-emitter experiment.

| Target motion | Threat | Baseline misses / launched | 45% penalty misses / launched | Change |
|---|---|---:|---:|---:|
| Stationary | Quiver | 0 / 2,048 | 0 / 2,048 | 0 pp |
| 75u/s circular | Quiver | 0 / 2,048 | 0 / 2,048 | 0 pp |
| 175u/s circular | Quiver | 0 / 2,048 | 0 / 2,048 | 0 pp |
| Stationary | Heavy torpedo | 0 / 512 | 0 / 512 | 0 pp |
| 75u/s circular | Heavy torpedo | 0 / 512 | 0 / 512 | 0 pp |
| 175u/s circular | Heavy torpedo | 198 / 512 (38.67%) | 215 / 512 (41.99%) | +3.32 pp |

The Quiver results remain zero misses at **35%, 45%, and 50%** penalty. For fast circular heavy-torpedo targets:

| Penalty | Misses per seed, each /128 | Pooled miss rate |
|---|---|---:|
| Off | [54,46,53,45] | 38.67% |
| 35% | [56,52,57,48] | 41.60% |
| 45% | [56,53,57,49] | 41.99% |
| 50% | [56,55,57,49] | 42.38% |

At 45%, affected Quiver counts are **[101,104,88,89]** stationary, **[109,111,90,85]** at 75u/s, and **[115,112,89,93]** at 175u/s. Affected heavy-torpedo counts are **[27,31,21,23]**, **[28,30,22,22]**, and **[38,42,36,32]** respectively. Pulse coverage is limited by flight residence time, not 3/8 of all missiles by assumption. Missiles within a salvo share phase/geometry, so individual missiles are not independent statistical trials; these are finite seeded stress results, not universal confidence estimates.

**Interpretation:** slower tracking still steers adequately against slow targets and large shield envelopes. A 45% tracking penalty is not a 45% hit-rate penalty. The tested change does not establish meaningful Quiver swarm protection, and increasing it to 50% does not fix that. If reliable anti-swarm utility is required, the next experiment should compare temporary seeker lock loss or explicit fuse disruption using real PD and a killable donor, rather than assign an invented interception bonus. The current recommendation deliberately contains no unmeasured fuse-kill probability.

## Validation and remaining integration work

- `npx biome check games/space_battler/frontend/bench/`: ran; existing directory-wide formatting/import issues and warnings prevent a clean result. The initial run reported 12 errors, including this new file's formatting; the new file was subsequently formatted and its dedicated Biome check passed. Other research files were not reformatted.
- `npx tsc --noEmit -p games/space_battler/frontend/tsconfig.json`: passed. This root config has only references and no files, so this command does not establish bench type coverage.
- Additional direct strict check of the harness and its imports found pre-existing TS7022/TS7023 circular-inference errors in `simulation.ts` (`beamLaserSystem`, `updateTurretAim`, `weapons`). No runtime-source changes were made to conceal these errors.
- Supplemental harness/import check passed with `npx tsc --noEmit --target ES2023 --module ESNext --moduleResolution bundler --types node --skipLibCheck --strict --noImplicitAny false bench/tenderBalance.ts` from the frontend directory. This checks the harness while explicitly relaxing the inference diagnostic above; it is not a clean strict engine check.
- `npx vitest run games/space_battler/frontend/tests`: **19 files / 355 tests passed** (45.33s).
- Harness assertions passed on the final 136-combat/96-guidance-batch run.

Stage 2 priorities: implement donor/recipient channel eligibility and budget; integrate range interruptions; test real aura geometry/overflow; compare real PD with ECM on/off; test multi-Tender and killable-donor equal-budget fleets. These results support the proposed hull and duty cycle, but **do not claim completed production Tender mechanics or proven fleet-wide ECM effectiveness**.

Engine snapshot SHA-256 anchors (also emitted by the harness):

```text
shipProfiles     21f10133e4f23a603d53b486c98a5fef7bde21e4e3f790341ba7e92673e22128
projectileEngine 95e6f8b38bfc8f159281b4b744bc6f36b017c5495638c74f89dce4a212a12e6c
shipWeaponSystem 24d087e2b8e0c4d0d50f269bf8bf5cba9686fcd0ae50e48a55a176c19529d371
simulation       38680d7a7d0db5806a3de9c779befee77e723d25c0d1f4f33be7661323b13cc5
shieldHaven      dedfa7331dfb5e2043d2c6c3e2085410f17cff12ef8bdf9288610c0b0ff91a09
```
