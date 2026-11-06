# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (283 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks Phase 1, 2 & 3**:
  - `flightCycles.ts`: isolated `BroadsideCycle` and `SkirmishCycle` state reducers.
  - Zero crab-walk approach pipeline with angular drift clamping ($|v_l| \le \min(\lambda v_{\max}, |v_f| \tan 10^\circ)$).
  - Authoritative shield geometry (`1.68x` capitals, `1.40x` light craft) via `shieldGeometry.ts`.
  - `ShieldHavenSystem`: 6 named haven docking slots (`port/starboard-forward/mid/aft`) with atomic leasing and recovery hysteresis.
  - Rigid slot attachment with angular velocity matching ($V_i = V_p + \omega \times r_i$), suspension of guest autonomous steering, relationship-aware collision bypass (nested shields permitted, hull exclusion enforced), and bounded release corridors.
- **Flak Balance Tuning**: Refined corvette flak interception (`triggerRadius: 15`, `blastRadius: 30`, spread `0.035 rad`) to let missile/torpedo swarms break through.
- **2D/2.5D Silhouette Parity**: Rewrote SVG `ShipSilhouette` to 100% mathematical parity with `shipRenderer.ts` across all 6 Terran and 6 Alien hulls.

---

## 2. Active Roadmap: DRY/OOP Behavior Pipeline & Shield Haven

### Phase 4: Umbrella Damage Absorption & Visuals (Sol + Terra — ACTIVE)
- **Sol**: Parent shield intercepts and absorbs incoming attacks (projectiles, beams, splash) directed at tethered craft while parent shield $> 0$; remaining energy spills over.
- **Terra**: Tactical canvas visuals for Shield Haven:
  - Energy tether conduits connecting parent capital to tethered guests.
  - Slot markers on selected capital ships showing occupied/free slots.
  - Tether recharge particle ripples.

### Phase 5: Dynamic Doctrine & Haven Telemetry in UI (Terra)
- UI card inspection: when clicking a ship, display its Shield Haven status (docked slot, tethered guests count, parent name).
- Dynamic resolver `resolveDoctrine(definition, loadout, order)` feeding `DoctrineDialog.tsx`.

---

## 3. Backlog & Known Quirks (Pending Investigation)

- **Shield Re-inflation Repulsor Discontinuity**:
  - When a capital ship's shield collapses, surrounding friendly and enemy ships may close inside the $1.68\times$ boundary.
  - Upon shield reboot/re-inflation, the instantaneous restoration of the full shield repulsor aggressively thrusts nearby ships outward.
  - *Fix needed*: Soft repulsor ramp-up (grow radius over 1.5s or scale repulsor force by current shield ratio $S_{\text{current}} / S_{\max}$ rather than binary step).
