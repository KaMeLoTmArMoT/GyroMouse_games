# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (299 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks & Shield Haven (Phases 1–5 Complete)**:
  - `flightCycles.ts`: Isolated `BroadsideCycle` and `SkirmishCycle` state reducers.
  - Zero crab-walk approach pipeline with angular drift clamping.
  - Authoritative shield geometry (`1.68x` capitals, `1.40x` light craft) via `shieldGeometry.ts`.
  - `ShieldHavenSystem`: 6 named haven docking slots (`port/starboard-forward/mid/aft`) with atomic leasing, recovery hysteresis, rigid slot attachment ($V_i = V_p + \omega \times r_i$), and collision bypass.
  - Full umbrella damage interception with energy spillover.
  - Haven canvas visuals: pulsing faction energy conduits and slot hardpoint markers (`havenRenderer.ts`).
  - Dynamic UI doctrine resolver and real-time Haven telemetry card in vessel inspection sidebar.

---

## 2. Backlog & Pending User Requests

1. **Shield Re-inflation Repulsor Discontinuity**:
   - When capital shields reboot, the sudden appearance of the repulsor aggressively thrusts nearby ships away.
   - *Fix*: Scale repulsor force by current shield ratio ($S_{\text{current}} / S_{\max}$) or ramp radius over 1.5s.
2. **Corvette Mid-Armor Gun Compensation**:
   - Flak point defense was nerfed against missile swarms; corvettes need slight gun DPS/penetration tuning against medium craft.
3. **Real-time Tactical Fleet Commands (Direction 3)**:
   - Allow player in-combat doctrine overrides (e.g., Focus Fire, Defensive Haven, Standoff Kite).
4. **Roster Expansion Candidates (Using New Behavior Blocks)**:
   - Torpedo Bomber (strike craft), Shield Tender / EW Support (shield aura), Plasma Assault Corvette.
