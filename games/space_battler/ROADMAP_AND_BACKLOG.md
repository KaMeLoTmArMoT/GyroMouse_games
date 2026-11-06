# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (332 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks & Shield Haven (Phases 1–5 Complete)**: Full umbrella mechanics, visuals, and UI telemetry.
- **Soft Shield Repulsor & Capital Anti-Hugging**: Bounded displacement ($\le 4\text{u}$/tick) and $420\text{u}$ capital standoff.
- **Predictive Boundary Avoidance**: Soft anticipation zone ($1250\text{–}1800\text{u}$) prevents edge circling.
- **Corvette Medium-Armor Gun Buff**: Rapid Flak `armorMultiplier` $0.22 \to 0.45$, `shieldMultiplier` $0.25 \to 0.35$, `hullMultiplier` $0.30 \to 0.45$ (3/10 missile interception preserved).
- **Retreat Kinematics & Haven Guidance**:
  - Reverse flight speed clamped to $\le 35\%$ of `maxSpeed`; craft turn nose-first when retreating/seeking haven.
  - Animated dashed guidance vector to leased haven slots; amber `RESERVED` pulsing indicators & beacons on selected capitals.

---

## 2. Active Next Step: Domain-Driven Architectural Refactor

- **Monster-File Refactor (`simulation.ts` ~1,880 lines)**:
  - Decompose disparate responsibilities (projectile collision, beam channeling, tactical mission cycle) into domain modules.
  - Strictly adhere to `/code-guide` and `/code-auditor`: zero generic `utils.ts` / `helpers.ts`, early returns, minimal moving parts.
