# Space Battler — Astra Iteration 2: Focused Calibration

## Verdict

**The requested band resolves combat reliably, but fails the 9–14s opening-shot gate.** All 88 battles ended decisively: zero timeouts, hard errors, or spawn overlaps. Recommend the numbers below as the combat-stability production candidate, conditional on resolving the opening-pacing requirement; this is not a full acceptance pass.

## Method and acceptance gates

- 2026-11-05; Node v24.16.0; fixed 1/60s simulation step.
- Exactly 16 Golden Set pairings + 6 curated presets, each with seeds **1, 7, 42, 2026**. Seeds perturb initial y by at most ±2u.
- **300s hard cap** (18,000 ticks); first extinction ends a battle. A capped battle is labeled **Tactical Stalemate / Timeout**. No 900s horizons were run.
- Shield-aware layout preserves formation x columns and vertical ordering. For horizontally nearby ships, vertical spacing is `(shipA.size * 1.4 + shipB.size * 1.4) * 1.15 + 20`, then each fleet is vertically centered before seed jitter. All initial ship pairs are checked for shield overlap before simulation.
- Measured worker time: **22.69s**. Mean battle duration: **42.45s**, range **8.08–148.38s**.

| Gate | Measured result | Status |
|---|---|---|
| 88 battles | 88/88 | PASS |
| Zero hard errors | 0 invalid runs; 0 telemetry/accounting errors | PASS |
| Timeouts below 5% | 0/88 (0%) | PASS |
| Opening shot 9.0–14.0s | 4/88 in band; 84 earlier than 9s; none missing | **FAIL** |
| Zero spawn overlaps | 0/88; minimum shield-surface gap **24.29u** | PASS |
| Runtime under two minutes | 22.69s | PASS |

There were also zero RAM, OOB, STALL, NO FIRE, and BROADSIDE alerts in the 88-battle suite. Opening-shot time is the first actual weapon discharge (`telemetry.firstShot`), not first damage or a later close-range engagement.

## Recommended production candidate

| Hull | Size (u) | Turn rate (rad/s) | Speed (u/s) | Shield / regen per second | Armor | Hull HP |
|---|---:|---:|---:|---|---:|---:|
| Strike craft | 10 | 4.20 | 280 | 60 / 10 | 40 | 70 |
| Corvette | 20 | 1.60 | 175 | 180 / 15 | 150 | 220 |
| Cruiser | 38 | 0.75 | 85 | 600 / 25 | 500 | 700 |
| Battleship | 68 | 0.50 | 38 | 2200 / 50 | 2000 | 2800 |

| Weapon | Damage | Range (u) | Cooldown (s) |
|---|---:|---:|---:|
| BB spinal railgun | 300 | 1800 | 3.5 |
| BB broadside battery, each side | 75 | 1200 | 1.2 |
| Cruiser torpedo | 220 | 1800 | 5.5 |
| Cruiser beam turret | 45 | 1100 | 1.2 |
| Corvette flak, each mount | 10 | 420 | 0.3 |
| Strike-craft plasma | 120 | 550 | 3.0 |

Arena: **1900u**, outer pull threshold **2200u**; fleet origins **x = ±1100u**, with existing class-specific x offsets. In the current engine, inward steering blends smoothly from 1900u to full pull at 2200u (`ARENA_RADIUS` / `ARENA_HARD_PULL_RADIUS`). Use the dynamic shield-aware spacing above with these hull sizes.

## Matchup results

Each row contains four seeds. B/R are Blue/Red wins; there were no mutual destructions or timeouts. Opening times are the observed min–max across those seeds.

| Matchup | B/R | Mean duration (s) | First shot (s) |
|---|---|---:|---|
| 3 BB vs 3 BB | 4/0 | 148.38 | 5.20 |
| 3 BB vs 3 CR | 4/0 | 25.61 | 3.17 |
| 3 BB vs 3 CV | 4/0 | 26.59 | 3.88–3.90 |
| 3 BB vs 3 SC | 4/0 | 15.55 | 1.60 |
| 3 CR vs 3 BB | 0/4 | 25.92 | 3.17 |
| 3 CR vs 3 CR | 4/0 | 42.82 | 2.15 |
| 3 CR vs 3 CV | 4/0 | 26.42 | 2.85 |
| 3 CR vs 3 SC | 4/0 | 8.10 | 0.92 |
| 3 CV vs 3 BB | 0/4 | 22.18 | 4.03 |
| 3 CV vs 3 CR | 0/4 | 26.20 | 2.85 |
| 3 CV vs 3 CV | 4/0 | 102.73 | **11.43–11.45** |
| 3 CV vs 3 SC | 4/0 | 20.68 | 5.65 |
| 3 SC vs 3 BB | 0/4 | 14.15 | 1.67 |
| 3 SC vs 3 CR | 0/4 | 8.37 | 0.92 |
| 3 SC vs 3 CV | 0/4 | 25.62 | 5.60 |
| 3 SC vs 3 SC | 4/0 | 24.58 | 3.02–3.23 |
| combined | 0/4 | 71.80 | 0.72 |
| 1bb-vs-3cr | 4/0 | 65.42 | 3.27 |
| split_spear | 4/0 | 66.64 | 0.93 |
| glass_hammer | 4/0 | 47.16 | 1.08 |
| needle_cloud | 0/4 | 30.70 | 0.72 |
| picket_gambit | 4/0 | 88.35 | 0.82–0.83 |

## Interpretation

- The focused combination eliminates observed carousel stalemates in this suite. Even the slowest BB mirror finishes in 148.38s, comfortably inside the cap.
- Opening shots average **2.99s**, spanning **0.72–11.45s**. Only the CV mirror meets 9–14s. The 1800u railgun/torpedo ranges, 2200u fleet-origin separation, and forward cruiser/fighter offsets permit early fire. Iteration 1's 11–13s contact claim does **not** transfer to this complete parameter combination.
- The exact requested numbers cannot be signed off against the strict opening gate using these results. Keep this measured candidate for combat stability; a subsequent pacing change must explicitly reconcile spawn distance, weapon reach, and the definition of opening contact, then rerun the same suite.
- All 16 mirror runs favored Blue. Four small layout-jitter seeds establish resolution repeatability, not side fairness or equal-budget balance. The Iteration 1 `1bb-vs-3cv` result was not rerun: that matchup is outside the specified 22-scenario set.

## Reproduction and checks

From `games/space_battler/frontend`: **`npm run bench -- --study focused`**.

Evidence is generated under `frontend/bench/results/grand-scale/`:
- `focused-focused.json`: all 88 initial layouts, outcomes, telemetry, and study metrics.
- `focused-summary.json`: acceptance gates, effective ship/weapon values, and per-matchup aggregates.
- `focused-manifest.json`: engine and benchmark SHA-256 hashes, runtime, cap, and layout version.
- `snapshots/focused/`: isolated engine configuration used for the study.

Targeted strict TypeScript checking and Oxlint passed for all three benchmark files. A separate inert-fleet cap check requested 301s and stopped at 18,000 ticks (300s within floating-point tolerance), with the timeout label and zero hard errors.
