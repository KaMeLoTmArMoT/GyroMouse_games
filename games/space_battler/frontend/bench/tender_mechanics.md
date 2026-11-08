# «Оберіг» production mechanics

The 1,250 CR tender has Astra's 650 SP / 450 AP / 800 HP profile and one stock light flak mount (420u, 360°, 2.5 rad/s tracking). Fleet slots accept `hullClass: "tender"`; the fleet catalog exposes the registered profile.

## Harmonic channel

`HarmonicShieldSystem` runs in the fixed-step simulation after combat impacts. A live tender restores a damaged friendly non-tender within 500u center-to-center at 65 SP/s. Native recharge and its damage delay are independent; restoration does not repair armor or hull. Telemetry's shield-regeneration counter includes harmonic restoration for shield conservation.

Six active seconds deliver at most 390 SP, followed by four seconds of capacitor recharge. This duty cycle is the capacitor budget; there is no second rechargeable resource. Range loss, death, team changes and full shields terminate transfer, discard unused throughput and retain the original ten-second start-to-start cooldown. Self and all tender recipients are excluded. Existing recipients are reserved before deterministic donor-ID allocation, enforcing one incoming channel globally. Cyan `onBeamFire` callbacks and `activeBeams` expose live support channels; remnant redeployment clears cycle state.

## Support flight and haven aura

Tenders orbit friendly capitals or damaged non-tender allies at roughly 425u, independent of offensive group stance. Isolation (no support anchor within 1,000u) or hull below 35% triggers retreat away from the nearest enemy.

A live allied tender within 500u of a capital multiplies its authoritative haven envelope by 1.20. Hitboxes, repulsors, release corridors and rendering share this geometry. Multiple tenders do not stack; slots, shield pool, recharge and guest eligibility are unchanged. Tenders cannot lease haven slots.

On an impact routed through a tethered guest's parent shield, aura strength is sampled before shield collapse releases the lease. The parent pays its full shield absorption; `max(0, rawDamage - absorbedSP / shieldMultiplier)` is multiplied by 0.90 before the guest's layers. Fully absorbed hits have no overflow. Subsequent hits after lease loss receive no reduction.

## ECM evidence

NOTE: Tracking-only ECM (-45% turn rate) was benchmarked by Astra and proved insufficient to stop light missile swarms against large capital envelopes (+0% misses against Quivers). Future ECM pulse implementation must incorporate seeker lock disruption or fuse detonation to effectively neutralize swarm salvos.

No tracking-only ECM pulse or speculative missile-kill bonus is included in these mechanics. See `tender_balance_report.md` for calibration scope and limitations.

## Verification

- `npx vitest run games/space_battler/frontend/tests`: 20 files / 376 tests passed, including 21 tender cases covering budget, exclusions, channel allocation, interruptions, recharge timing, real aura collision boundaries, overflow and flight.
- `npx tsc --noEmit -p games/space_battler/frontend/tsconfig.json`: passed. The reference-only root config was supplemented with `tsconfig.app.json`, which also passed and checks production source.
- `npx biome check games/space_battler/frontend/src/`: zero errors; one pre-existing `noNonNullAssertion` warning in `src/main.tsx`.
