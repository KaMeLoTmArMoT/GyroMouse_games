# Space Battler — Tactical Roadmap & Architecture

Last Updated: 2026-11-06
Status: Production Baseline Active (318 Vitest tests passing, 0 Drift alerts)

---

## 1. Recently Completed Milestones

- **DRY / Behavior Blocks & Shield Haven (Phases 1–5 Complete)**: Full umbrella mechanics, visuals, and UI telemetry.
- **Soft Shield Repulsor & Capital Anti-Hugging**:
  - `shieldRepulsorRadius`: Repulsor contact radius scales with current shield charge ($\frac{S_{\text{current}}}{S_{\max}}$); bounded positional displacement ($\le 4\text{u}$/frame) prevents teleportation on shield reboot.
  - `capitalSeparationDistance`: Enforces tactical standoff buffer ($420\text{u}$ hostile, $300\text{u}$ friendly) preventing capitals from pressing face-to-face.
- **Predictive Boundary Avoidance**:
  - Soft anticipation zone ($1250\text{–}1800\text{u}$) smoothly blends tangential inward velocity before ships hit the perimeter, eliminating orbital edge circling.
- **Process Optimization**: Documented non-blocking CAB protocol & benchmark timeouts in `AGENTS.md`.

---

## 2. Active Next Step

- **Corvette Mid-Armor Gun Compensation**:
  - Buff corvette gun effectiveness (`armorMultiplier` from 0.22 to ~0.42–0.45 or base damage) against medium ships (`cruiser`, `destroyer`) without undoing flak swarm balance.
