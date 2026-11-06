# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (346 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks & Shield Haven (Phases 1–5 Complete)**: Full umbrella mechanics, visuals, and UI telemetry.
- **Soft Shield Repulsor & Capital Anti-Hugging**: Bounded displacement ($\le 4\text{u}$/tick) and $420\text{u}$ capital standoff.
- **Predictive Boundary Avoidance**: Soft anticipation zone ($1250\text{–}1800\text{u}$) prevents edge circling.
- **Corvette Medium-Armor Gun Buff**: Rapid Flak `armorMultiplier` $0.22 \to 0.45$, `shieldMultiplier` $0.25 \to 0.35$, `hullMultiplier` $0.30 \to 0.45$.
- **Shield Surface Hits & Evasion**:
  - Swept projectile collisions test `activeShieldRadius` ($1.68\times$ capitals); torpedoes/missiles detonate on shield surface.
  - Skirmishers (`missile_frigate`) execute active lateral jinking against incoming missiles/torpedoes ($t_{\text{arrival}} \le 2\text{s}$).
- **Selective Haven Guidance Visuals**: Guidance lines appear strictly when clicking the retreating craft or receiving capital.

---

## 2. Active Next Step: Domain-Driven Architectural Refactor

- **Monster-File Refactor (`simulation.ts` ~1,890 lines)**:
  - Deconstruct into cohesive domain modules (`projectileEngine.ts`, `beamLaserSystem.ts`, `fighterMissionSystem.ts`, `collisionContactSolver.ts`).
  - Strict `/code-guide` and `/code-auditor` compliance: no generic `utils.ts` / `helpers.ts`, early returns, isolated pure contracts.
