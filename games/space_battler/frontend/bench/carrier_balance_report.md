# Fleet Carrier: hull, point defense, and economy calibration

## Decision

**Recommend D: three Light Defense Lasers + one 360-degree Flak.** Suggested price:
**3,000 CR**, including an initially empty hangar and finite fabrication reserve.
The economical B variant (two lasers + flak) is **2,900 CR**. D is worth the extra
100 CR under the explicit component-price model below; it is not swarm-proof.

- **Additional preloaded wing, +16 current Raiders: +1,920 CR.** D + wing = **4,920 CR**.
- **One ready Aegis Corvette in escort dock: +350 CR; two: +700 CR.**
  D + docks = **3,350 / 3,700 CR**. These buy actual Corvettes, not respawns.
- **Fabrication: +2 Raiders every 20 seconds, first pair at t=20, maximum 16
  fabricated per battle.** Its valuation assumes a supported 180-second battle.
- An empty Carrier **requires allied anti-fighter support** against 10–20 Raiders.
  The tested B + two Corvette screen still died against 20 Raiders in all seeds.
  Fabrication cannot solve an opening strike that kills the Carrier before t=20.

These are exact arithmetic recommendations under a declared pricing model, not a
claim that simulation uniquely determines a universally fair price. Carrier,
hangar, fabrication, named light-laser/twin-autocannon profiles, and bombers are
not present in the inspected live roster. Their parameters below are proposals.

## Evidence and scope

Harness: [`carrierBalance.ts`](./carrierBalance.ts). It follows the research-only
approach in `rosterExpansion.ts` / `rosterExpansionProfiles.ts`, but uses the full
live simulation for flight, targeting, slew, ordnance, interception, damage, and
regeneration rather than treating missile delivery probability as an input.

Run from `games/space_battler/frontend`:

```sh
npx tsx bench/carrierBalance.ts missiles
npx tsx bench/carrierBalance.ts fighters
npx tsx bench/carrierBalance.ts escorts
```

Saved raw evidence:

- `bench/results/carrier-balance-missiles.json`: 100 runs; 28.1 s wall time.
- `bench/results/carrier-balance-fighters.json`: 80 runs; 117.6 s wall time.
- `bench/results/carrier-balance-escorts.json`: 32 runs; 63.7 s wall time.

Each file contains profiles, per-run metrics, all engine TypeScript source hashes,
and the harness hash. Successful suites used simulation SHA-256
`38680d7a7d0db5806a3de9c779befee77e723d25c0d1f4f33be7661323b13cc5`
and harness SHA-256
`080ef135a1594a6a51895a9098fe5d481de6848e4ba3530aa0fe690f8846e04c`.
Earlier attempts rejected concurrent engine changes and are excluded.

Protocol:

- 60 Hz, maximum 120 simulated seconds; seeds **1, 7, 42, 2026** supply layout
  jitter. Four layouts are sensitivity samples, not a statistical population.
- The Carrier is a **stationary battleship-class surrogate**, with the proposed
  Carrier's layers and dimensions. This enables existing capital targeting,
  shield geometry, and Corvette escort logic. It does not test Carrier doctrine.
- Quivers are actual four-tube live profiles, stationary at 1,000 units across
  a 120-degree sector, with their 0/0.2/0.4/0.6-second tube offsets and launch spread.
- Quivers have **light missiles, not heavy torpedoes**. Heavy tests therefore use
  two/four stationary Cruiser torpedo tubes, with their beam turrets removed.
- Raiders use live moving-wing AI, 850–910-unit initial x positions, 45-unit
  vertical spacing plus jitter. The benchmark tests 10 and 20 craft.
- **Bomber proxy:** Raider defensive layers/size, speed 200, turn rate 2.5, one
  existing heavy torpedo (220 damage, 120 casing HP, 5.5 s cooldown, speed 320,
  fuel 8 s), launch range shortened to 550. This is a stress proxy, not a
  calibrated or priced new bomber class.
- Escort cases use B plus one/two actual moving Corvettes with Carrier flagship
  assignment. Fabricated/preloaded friendly craft are absent from these tests.
- Stop on Carrier death or enemy extinction; otherwise censor at 120 s.
  Surviving stationary missile tests are endurance holds, not fleet victories.
- Interception = destroyed hostile missiles / (launched minus still flying).
  Expired/missed missiles stay in the denominator; they are not credited as PD.
  The report averages per-run ratios, rather than pooling unequal death windows.
- First shield break and first hull damage are captured on damage events. Final
  shield, minimum shield, time-average shield, remaining armor/hull, regeneration,
  enemy survivors and damage sources are retained in JSON. Every run checks
  finite states and reconciles all ships' three layers against damage and regen.

No registry or runtime gameplay file was changed by this study. The harness's
2,900 CR Carrier metadata is the B reference price; cost does not affect combat.

## Proposed hull

| Parameter | Proposal | Interpretation |
|---|---:|---|
| Size | 80 | Capital shield radius = 1.68 × 80 = 134.4 |
| Hull | 2,400 | Below Battleship's 2,800 and Dreadnought's 3,000 |
| Armor pool / rating | 1,200 / 45 | Considerably below line capitals; small-hit resistance remains |
| Shield | 1,600 | Below Battleship 2,200 and Dreadnought 1,800 |
| Shield regen / delay | 30/s / 3 s | Full refill from zero needs 56.33 s without further hits |
| Speed | 32 | Between Dreadnought 30 and Battleship 38 |
| Turn rate | 0.30 rad/s | 180-degree turn takes 10.47 s |
| Full-speed turn radius | 106.67 | Speed / turn rate; slower steering than either line capital |

The design trades capital armor/offense for hangar utility. Its broad shield
envelope leaves only roughly **0.79 s** of light-missile travel or **0.89 s** of
heavy-torpedo travel between a central 420-range PD mount and shield contact.
Mount offsets, acquisition time, and projectile flight further alter that window.
Hull speed/turn values are design comparisons, not measured maneuver outcomes.

## Defensive candidates and actual engine semantics

All research mounts have full-circle arcs, range **420**, and slew **6.28 rad/s**.
Flak is at [0,0]; additional mounts use [24,-24], [-24,24], [-24,-24].

| Weapon | Implemented behavior used by benchmark | Component CR |
|---|---|---:|
| Flak | Existing 10-damage shell / 0.3 s, speed 1,500, trigger 15, blast 30, lifetime 0.32 s; 18 damage to missile casing | 150 |
| Light Defense Laser | Existing laser-PD mode: hardcoded 110 continuous DPS, zero projectile speed | 125 proposed |
| Twin Autocannon | Existing rotary-PD mode, 15-damage rounds / 0.15 s, speed 1,500; one mount approximates alternating twin barrels | 150 proposed |

Laser and autocannon inherit the Flak's capital-damage multipliers
**0.35 shield / 0.45 armor / 0.45 hull**. Only actual flak gets the engine's
1/1/1 override against strike craft. Consequently these results must not be
applied to differently tuned weapons bearing similar names.

| Config | Battery | Component CR |
|---|---|---:|
| A | 1 Flak + 1 laser | 275 |
| B | 1 Flak + 2 lasers | 400 |
| C | 1 Flak + 2 twin autocannons | 450 |
| D | 1 Flak + 3 lasers | 525 |

Important engine constraints:

1. Laser PD uses `110 / 60` raw damage each tick regardless of its configured
   `damage`/`cooldown`; it is not an ordinary `beam_laser` channel. Armor mitigation
   therefore uses **1.833 damage**, not a 110-damage pulse. Against Raider rating 5,
   a laser delivers only **13.28 armor DPS**, even with uninterrupted aim.
2. Rotary bullets deal a hardcoded **15 casing damage**. A heavy torpedo takes
   eight hits; flak takes seven 18-damage blasts; one laser needs 1.091 seconds
   uninterrupted contact. These exceed a lone central mount's heavy-torpedo window.
3. Light missiles have an ID-deterministic 10% flak immunity; repeated flak hits
   do not independently reroll that immunity. Laser coverage fills this gap.
4. Flak prioritizes nearby fighters; rotary prioritizes attack runs except urgent
   capital-bound torpedoes; lasers prioritize incoming missiles. Mounts can waste
   shared aim on the same threat; more nominal DPS does not guarantee interception.
5. Raider plasma **cannot be intercepted** by these systems. Its 550 launch range
   exceeds PD range, and the fighter can egress before enough defensive exposure.
   Ideal uninterrupted single-target kill times are already about 5.7 s for flak,
   6.0 s for a laser, and 4.5 s for a twin autocannon, excluding shield regeneration.

## Missile salvos: measured results

Times are seconds from scenario start. `>120` means unobserved by the cap.
Shield break is the observed range across seeds; percentages are means.
Hull onset is the mean when all four runs have an event. Survivor count is out of 4.

### Quiver light missiles

| Config | Quivers | Intercept % | Final shield / 1,600 | First shield break | First hull damage | Survived |
|---|---:|---:|---:|---|---:|---:|
| None | 2 | 0 | 0 | 12.67–12.68 | 89.53 | 4 |
| None | 3 | 0 | 0 | 7.83–7.85 | 58.18 | 0 |
| None | 4 | 0 | 0 | 7.42–7.43 | 41.72 | 0 |
| A | 2 | 76.38 | 0 | 41.12–84.93 | >120 | 4 |
| A | 3 | 69.50 | 0 | 22.07–27.12 | >120 | 4 |
| A | 4 | 56.56 | 0 | 17.05–17.28 | 105.53 | 4 |
| B | 2 | 91.63 | 1,433.63 | >120 | >120 | 4 |
| B | 3 | 88.33 | 800.88 | 65.63 in 1/4; others >120 | >120 | 4 |
| B | 4 | 81.06 | 22.50 | 27.12–46.20 | >120 | 4 |
| C | 2 | 85.13 | 776.13 | 41.15 in 1/4; others >120 | >120 | 4 |
| C | 3 | 68.58 | 0 | 17.50–41.38 | >120 | 4 |
| C | 4 | 50.88 | 0 | 12.45–12.65 | 92.10 | 4 |
| D | 2 | 99.25 | 1,600 | >120 | >120 | 4 |
| D | 3 | 99.08 | 1,600 | >120 | >120 | 4 |
| D | 4 | 91.25 | 529.25 | 60.80–65.63 in 2/4; others >120 | >120 | 4 |

No-PD deaths: 94.09 s against three Quivers, 70.17 s against four. B and D prevent
hull damage for 120 seconds against four Quivers, but D gives much better shield
retention. C costs more than B and is substantially worse under saturation.
All four D-versus-four-Quiver interception rates were **99.25 / 88.75 / 85.25 /
91.75%**: report the layout sensitivity rather than promising a guaranteed 91%.

One Quiver's ideal shield pressure is `4 × 36 × 2 / 4.8 = 60 DPS`.
Ignoring recharge delay, the necessary long-run interception fractions to offset
30/s regen are 75 / 83.33 / 87.5% against 2 / 3 / 4 Quivers. Those are optimistic
lower bounds: if residual hits span each 0.6-second salvo, only about 1.2 seconds
remain for regen per 4.8-second cycle after the 3-second delay. The corresponding
idealized thresholds rise to **93.75 / 95.83 / 96.88%**. Actual hit spacing matters.

### Heavy torpedoes (Cruiser tubes, not Quivers)

| Config | Tubes | Intercept % | First hull damage | Mean death time | Survived |
|---|---:|---:|---|---|---:|
| None | 2 | 0 | 35.96 | 57.82 | 0 |
| None | 4 | 0 | 13.89 | 24.92 | 0 |
| A | 2 | 37.50 | 77.21 | 57.82 in 1/4; others >120 | 3 |
| A | 4 | 17.31 | 19.36 | 31.81 | 0 |
| B | 2 | 50.00 | 90.96 | >120 | 4 |
| B | 4 | 23.26 | 20.74 | 35.91 | 0 |
| C | 2 | 50.00 | 90.96 | >120 | 4 |
| C | 4 | 17.31 | 19.36 | 31.81 | 0 |
| D | 2 | 75.00 | 90.95–90.97 in 2/4; others >120 | >120 | 4 |
| D | 4 | 44.49 | 29.02 | 49.61 | 0 |

Final shield is zero except D versus two tubes (mean 800; two intact shields and
two depleted). With four tubes, first shield break occurs at 8.20–13.72 s for A,
B and C, versus 13.72–24.75 s for D. No standalone loadout survives four tubes.

## Moving strike runs

### Live Raider Interceptors

All loadouts lose all four runs and kill **zero** Raiders before Carrier death.
Missile interception is **N/A**, not zero: Raiders fire plasma. Final shield is zero.

| Config | Craft | First shield break range | Mean first hull damage | Mean death time |
|---|---:|---|---:|---:|
| None | 10 | 8.27–8.75 | 14.22 | 21.28 |
| None | 20 | 6.18–7.10 | 11.73 | 17.30 |
| A | 10 | 8.37–10.13 | 15.80 | 24.26 |
| A | 20 | 7.18–7.60 | 12.70 | 18.36 |
| B | 10 | 8.37–10.47 | 15.71 | 24.04 |
| B | 20 | 7.18–7.37 | 12.63 | 18.27 |
| C | 10 | 8.37–10.47 | 15.71 | 24.23 |
| C | 20 | 7.17–7.37 | 12.77 | 17.75 |
| D | 10 | 8.37–10.47 | 15.71 | 24.04 |
| D | 20 | 7.18–7.37 | 12.63 | 18.27 |

The additional laser in D provides no measured anti-Raider improvement here.
Buying more hull to withstand this sustained pressure would make the Carrier too
similar to a line capital; an allied fighter screen needs separate validation.

### Hypothetical heavy-torpedo bombers

| Config | Craft | Torpedoes intercepted % | First shield break range | First hull damage | Death time | Survived |
|---|---:|---:|---|---|---|---:|
| None | 10 | 0 | 4.75–5.35 | 8.44 | 11.05 | 0 |
| None | 20 | 0 | 4.37–4.70 | 5.00 | 9.19 | 0 |
| A | 10 | 17.12 | 5.02–8.70 | 9.97 | 15.44 | 0 |
| A | 20 | 18.91 | 5.00–6.03 | 7.50 | 11.51 | 0 |
| B | 10 | 52.20 | 8.65–11.13 | 15.70 | 28.14 | 0 |
| B | 20 | 50.17 | 5.37–9.02 | 11.28 | 17.74 | 0 |
| C | 10 | 31.26 | 5.02–8.70 | 10.76 | 18.55 | 0 |
| C | 20 | 39.25 | 5.10–8.03 | 9.70 | 15.25 | 0 |
| D | 10 | 82.93 | 9.70–14.15 in 3/4; one unbroken | 31.42–36.27 in 2/4; two hulls undamaged | All enemies eliminated | 4 |
| D | 20 | 80.78 | 5.68–14.57 | 28.87 | 48.25 | 0 |

All defeated Carriers end with zero shield. D versus ten bombers ends with mean
shield 1,060.88, but mean **minimum** shield only 80.5: its recovered final shield
must not be interpreted as having safely tanked the opening salvos. Seed 42
finished with only **78.39 of 2,400 hull**; wins occurred at 94.82–114.73 seconds.

### Is a Corvette dock sufficient? Measured B escort sensitivity

These are deployed escorts, with no docking latency, repair bonus, or replacement.

| Attack | Corvettes | Intercept % | Final shield | First hull damage | Mean death time | Survived |
|---|---:|---:|---:|---|---|---:|
| 4 Quivers | 1 | 96.25 | 1,469.38 | >120 | >120 | 4 |
| 4 Quivers | 2 | 97.88 | 1,600 | >120 | >120 | 4 |
| 4 torpedo tubes | 1 | 73.86 | 0 | 84.06 | >120 | 4 |
| 4 torpedo tubes | 2 | 79.26 | 400 | 98.31 in 3/4; one >120 | >120 | 4 |
| 20 Raiders | 1 | N/A | 0 | 14.35 | 22.35 | 0 |
| 20 Raiders | 2 | N/A | 0 | 15.38 | 24.99 | 0 |
| 20 bomber proxies | 1 | 55.01 | 0 | 17.50 | 24.71 | 0 |
| 20 bomber proxies | 2 | 67.00 | 611.50 | 18.11 | 29.07 among 2 deaths; two >120 | 2 |

Neither Quiver escort case suffered a shield break. Both screens retained three
or four hostile Quivers, so allied offense is still needed to end the engagement.
Two escorts reduced surviving Raiders to 11–14, but too late to save the Carrier.
Do not extrapolate B escort outcomes into an unmeasured guarantee for D escorts.

## EHP and prices

### Damage-dependent EHP

For shield S, armor A, armor rating R, hull H, a full raw hit d, and layer
multipliers ms/ma/mh, use the no-regeneration layer-continuum approximation:

`EHP(d) = S/ms + A × (d + R)/(d × ma) + H/mh`.

This is incoming raw damage capacity, not the sum of displayed HP. Actual layer
crossing hits have reduced remaining penetration, so discrete kill thresholds
can differ; beam channels and tick-based laser PD also require their actual hit
granularity. Regeneration and PD are excluded to avoid double-counting defenses.

Carrier estimates:

| Incoming weapon | Raw-damage EHP |
|---|---:|
| Neutral 100-damage hit, 1/1/1 | 5,740.00 |
| Quiver 36, 2/0.65/0.8 | 7,953.85 |
| Raider plasma 120, 1/1.1/1.5 | 4,700.00 |
| Heavy torpedo 220, 1/1.8/1.8 | 3,736.36 |

### Explicit component-price model

The requested **Cruiser 1,400 / Battleship 2,800 / Dreadnought 3,600 CR** anchors
are used for calibration. The saved live prices are 1,100 / 3,200 / 3,600.
Weapon prices are component anchors, not proof of marginal combat value.

| Reference | Neutral-100 EHP | Requested price | Installed weapon CR | Hull-only residual CR |
|---|---:|---:|---:|---:|
| Cruiser | 1,975 | 1,400 | 630 | 770 |
| Battleship | 8,500 | 2,800 | 950 | 1,850 |
| Dreadnought | 9,240 | 3,600 | 1,040 | 2,560 |

Pool residual hull prices per EHP:

`k = (770 + 1850 + 2560) / (1975 + 8500 + 9240)`

`k = 5180 / 19715 = 0.2627441035 CR/EHP`.

`Bare Carrier hull = 5740 × k = 1508.15115394 CR`.

With defenses but no production utility: B = **1,908.15115394 CR**;
D = **2,033.15115394 CR**. This pooled coefficient is a declared compromise:
individual anchor residuals range from 0.21765 to 0.38987 CR/EHP. It does not
identify an exact mobility, recovery, or support-system premium.

### Empty-hangar fabrication

Choose N=20 seconds, output two current 120-CR Raiders per cycle, and a finite
reserve R=16 craft. For valuation horizon T, an uptime-weighted production value is:

`Vfab(T,N,R) = 2 × 120 × sum(k=1..R/2) max(0, 1 - kN/T)`.

This prices the fraction of the battle each pair can participate in; it assumes
Carrier survival and availability to launch. It is a policy model, not measured
fabrication DPS or an estimate of fighters' realized survival after launch.
With a Carrier-survival model, multiply each term by `Pr(alive at kN)`; launch
delays and occupancy restrictions also reduce it.

| Horizon | Fabricated by horizon | Uptime-equivalent wing value |
|---|---:|---:|
| 60 s | 6 | 240 CR |
| 120 s (benchmark cap) | 12 | 600 CR |
| 180 s (pricing horizon) | 16 | 960 CR |
| 300 s | 16, reserve exhausted | 1,344 CR |

At the chosen 180-second horizon, changing N from 20 to 15 raises value to
1,200 CR; N=30 lowers it to 600 CR. Thus **20 s** is a transparent midpoint, not
an experimentally optimized hangar timer. Full 16-craft wing completion takes
160 seconds. The first cycle costs the design approximately one opening raid.

For T=180, **D base exact model price**:

`1508.15115394 + 525 + 960 = 2993.15115394 CR`.

Round to nearest 100 CR: **3,000 CR**. B analogously is
`1508.15115394 + 400 + 960 = 2868.15115394`, rounded to **2,900 CR**.
At T=120 those rounded prices would be 2,600 / 2,500; long-battle value must not
silently justify an opening-combat balance claim. An unlimited fabrication
stream has horizon-dependent value and no finite all-horizons fair price.

### Preloaded wing and escort dock

- **Additive +16 ready Raiders:** `16 × 120 = 1920 CR`. They are additional to the
  base fabrication reserve; maximum lifetime output is then 32 craft. The price
  assumes immediate deployability, no hangar discount, and no free replacements.
- If "preloaded" instead means **accelerating the same 16 reserve craft**, the
  T=180 differential is `1920 - 960 = 960 CR`, not 1,920. This is a different SKU;
  the headline recommendation implements the task's additive **+16** reading.
- **Escort dock with m ready Corvettes:** `m × 350`, hence **350 / 700 CR**. Do not
  charge the Corvettes' turrets again; their complete ship price already includes
  them. An empty dock has zero separately evidenced premium in this model.
- Recovery, repairs, invulnerability while docked, free resupply, or redeployment
  after destruction have no calibrated price here. They require explicit rules.

### Comparable EHP/CR summary

Neutral-100 EHP only; no regen/PD multiplication and no future fabricated craft.
For upgrades, "Carrier EHP/CR" keeps only the Carrier's layers; the last column
adds **deployed** escort/wing EHP as separate hulls, not one shared damage pool.
One Raider contributes 172 EHP, one Corvette 572.5 EHP at this reference hit size.

| Package | CR | Carrier/reference EHP | Carrier/reference EHP/CR | Including ready auxiliaries EHP/CR |
|---|---:|---:|---:|---:|
| Cruiser, requested anchor | 1,400 | 1,975 | 1.411 | 1.411 |
| Battleship, requested anchor | 2,800 | 8,500 | 3.036 | 3.036 |
| Dreadnought | 3,600 | 9,240 | 2.567 | 2.567 |
| Carrier B, empty + fabrication | 2,900 | 5,740 | 1.979 | 1.979 |
| **Carrier D, empty + fabrication** | **3,000** | **5,740** | **1.913** | **1.913** |
| D + 16 preloaded Raiders | 4,920 | 5,740 | 1.167 | 1.726 |
| D + 1 Corvette | 3,350 | 5,740 | 1.713 | 1.884 |
| D + 2 Corvettes | 3,700 | 5,740 | 1.551 | 1.861 |

At actual live prices, Cruiser and Battleship EHP/CR are **1.795 / 2.656**. Reusing
those prices in the pooled hull formula changes k to `5280/19715 = 0.267816`;
the Carrier bare-hull result rises by only about 29.12 CR, leaving D rounded at
3,000 and B at 2,900. The strategic strength of the anchors still changes.

## Integration acceptance criteria

1. Preserve D's missile specialization and require fighter support: do not infer
   anti-fighter safety from its high light-missile interception percentage.
2. Register Carrier as a capital in targeting, shield geometry and escort/haven
   logic before replacing the surrogate. Re-run this harness after those changes.
3. Test actual Carrier movement, loaded-wing launches, finite fabrication,
   hangar occupancy and recovery against matched-budget fleets. The present
   study establishes an isolated defensive baseline and conditional economic
   formula, not a moving-fleet win-rate or hangar-system implementation.
4. Define a real bomber profile before interpreting the proxy as a roster matchup.

Validation completed: all 212 successful benchmark runs passed telemetry and
layer-accounting assertions; the focused TypeScript check and Oxlint check of
`bench/carrierBalance.ts` passed; all 12 existing `tests/pointDefense.test.ts`
tests passed.
