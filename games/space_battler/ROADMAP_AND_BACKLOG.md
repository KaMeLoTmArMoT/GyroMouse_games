# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (270 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks Phase 1 & 2**:
  - `flightCycles.ts`: isolated `BroadsideCycle` and `SkirmishCycle` state reducers.
  - Zero crab-walk approach pipeline with angular drift clamping ($|v_l| \le \min(\lambda v_{\max}, |v_f| \tan 10^\circ)$).
  - Authoritative shield geometry (`1.68x` capitals, `1.40x` light craft) via `shieldGeometry.ts`.
  - `ShieldHavenSystem`: 6 named haven docking slots (`port/starboard-forward/mid/aft`) with atomic leasing, recovery hysteresis (<30% HP enter, >=75% shield release, <10% emergency eject).
- **Flak Balance Tuning**: Refined corvette flak interception (`triggerRadius: 15`, `blastRadius: 30`, spread `0.035 rad`) to let missile/torpedo swarms break through.
- **2D/2.5D Silhouette Parity**: Rewrote SVG `ShipSilhouette` to 100% mathematical parity with `shipRenderer.ts` across all 6 Terran and 6 Alien hulls.
- **Anti-Overkill Targeting**: Capped missile lock allocations per hull to prevent salvo waste.

---

## 2. Active Roadmap: DRY/OOP Behavior Pipeline & Shield Haven

### Phase 3: Moving-Slot Attachment & Collision Bypass (Sol — ACTIVE)
- Tethered movement calculation matching parent rotation: $V_i = V_p + \omega \times r_i$.
- Suspend independent free-flight steering while tethered.
- Relationship-aware collision handling: permit nested shield overlap between parent and tethered guests while strictly prohibiting hull collisions.
- Bounded ejection corridors during emergency release.

### Phase 4: Umbrella Damage Absorption & Visuals (Sol + Terra)
- Parent shield absorbs incoming external attacks directed at tethered craft.
- UI/Canvas: Visual indicators for active Shield Haven tethers/docks (connecting energy conduits / tether lines and slot markers on selected capital).

### Phase 5: Dynamic Doctrine & Haven Telemetry in UI (Terra)
- UI card inspection: when clicking a ship, display its Shield Haven status (docked slot, tethered guests count, parent name).
- Dynamic resolver `resolveDoctrine(definition, loadout, order)` feeding `DoctrineDialog.tsx`.
