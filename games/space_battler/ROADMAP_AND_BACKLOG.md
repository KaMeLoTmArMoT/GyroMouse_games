# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-08
Status: Waves 1–18 delivered across the engine and UI; the recent fast suite reports 690+ Vitest tests. Worker live wiring and expanded capacity are undergoing parallel verification.

---

## 1. Recently Completed Milestones

- **2.5D ships and inspector**: Volumetric hulls, stepped decks, depth-sorted turrets and interactive ship inspection.
- **Tactical camera tilt**: Ctrl+left-drag or middle-drag tilts the battlefield from 90° to 25°; empty-space double-click or the tilt pill resets it.
- **Web Worker phases 1–3**: Transferable snapshot protocol, Worker host/client, interpolation, presentation events, App wiring and expanded buffers implemented; integration verification is ongoing.
- **DRY / Behavior Blocks & Shield Haven (Phases 1–5 Complete)**: Full umbrella mechanics, visuals, and UI telemetry.
- **Soft Shield Repulsor & Capital Anti-Hugging**: Bounded displacement ($\le 4\text{u}$/tick) and $420\text{u}$ capital standoff.
- **Predictive Boundary Avoidance**: Soft anticipation zone ($1250\text{–}1800\text{u}$) prevents edge circling.
- **Corvette Medium-Armor Gun Buff**: Rapid Flak `armorMultiplier` $0.22 \to 0.45$, `shieldMultiplier` $0.25 \to 0.35$, `hullMultiplier` $0.30 \to 0.45$.
- **Shield Surface Hits & Evasion**:
  - Swept projectile collisions test `activeShieldRadius` ($1.68\times$ capitals); torpedoes/missiles detonate on shield surface.
  - Skirmishers (`missile_frigate`) execute active lateral jinking against incoming missiles/torpedoes ($t_{\text{arrival}} \le 2\text{s}$).
- **Selective Haven Guidance Visuals**: Guidance lines appear strictly when clicking the retreating craft or receiving capital.

---

## 2. Active Scalability Roadmap

- Verify production Worker wiring and the three pooled buffers (2048 ships, 4096 projectiles, 16384 mounts and 1024 events each), including browser operation and fallback behavior.
- Profile always-on contact and projectile hot loops for flat SoA TypedArrays and WASM SIMD; preserve collision and combat behavior.
- Cache cadence-driven navigation neighbors and fire-control acquisition over 6–8 ticks, with correct invalidation.
- Gate boundary ships, active missiles and wrecks, and wounded haven seekers through situational worklists.
- For future 600–800 ships, evaluate coarse secondary-Worker AI/fire-control scoring batches; investigate WebGPU only with measured fallback costs.

See [Worker architecture](docs/web_worker_simulation_architecture.md) for the historical measurements, acceptance gates and 200v200–400v400 compute roadmap. Worker offload alone does not guarantee real-time simulation.
