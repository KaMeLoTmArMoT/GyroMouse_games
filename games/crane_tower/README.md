# 🏗️ 3D Crane Tower (Cargo Stacker)

A cooperative 2-Player / Dual-Axis 3D physics cargo stacker built with **Three.js** and **Rapier3D physics**. Player 1 controls Hook Height (Y-axis), Player 2 controls Trolley Position (X-axis). Together, players grab crates from the side supply dock, transport them over an open train flatbed car, and drop them to construct a balanced container stack.

---

## 🕹️ Controls & Gameplay

| Player / Action | Control Key | Description |
|---|---|---|
| **Player 1 (Y-Axis)** | `W` / `S` or `↑` / `↓` | Raise / lower crane cable hook |
| **Player 2 (X-Axis)** | `A` / `D` or `←` / `→` | Drive trolley left / right on gantry beam |
| **Drop / Grab Action** | `Spacebar` / Onscreen Button | Drop attached crate from magnet, or pick up a crate under magnet |

---

## ⚙️ Physics & Mechanics

1. **Dual-Axis Split Control**:
   - Player 1 adjusts hoist cable length $L$, Player 2 shifts gantry trolley $X$.
2. **Dynamic Cable Pendulum Physics**:
   - Cable pendulum differential equations $\alpha = -\frac{g}{L}\sin\theta - \frac{A_x}{L}\cos\theta - c\cdot\omega$.
   - Energy conservation scaling $\omega \propto \sqrt{L_{\text{old}}/L_{\text{new}}}$ during hoisting keeps lowering & upering smooth and predictable.
3. **Collision & Momentum Transfer**:
   - Elastic momentum collision ($e = 0.5$) between crane hook/crate and settled stack crates — moving crane transfers kinetic impulse, bouncing back naturally.
4. **Side Supply Dock & Drop Hazards**:
   - Crates spawn unattached on a side supply dock ($X = -4.5$).
   - Train flatbed platform rests at $X = 3.5$, creating an open gap hazard where tumbling crates fall to the floor.
5. **Aim Goal & Countdown**:
   - Customizable target goal selector (3, 5, 7, 9, 11 boxes) persisted in `localStorage`.
   - Reaching settled target count triggers a **5...4...3...2...1** countdown before gluing crates to flatbed and driving train away.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | HTML layout, HUD stats overlay, Aim Goal selector, countdown overlay, victory/fail modals. |
| [`src/main.ts`](src/main.ts) | Game orchestrator, smooth 60fps keyboard event listeners, main animation loop. |
| [`src/physics/cranePhysics.ts`](src/physics/cranePhysics.ts) | Rapier3D physics manager, pendulum angular acceleration, kinematic magnet body, crate colliders, momentum transfer logic. |
| [`src/graphics/craneGraphics.ts`](src/graphics/craneGraphics.ts) | Three.js scene setup, industrial depot environment, yellow gantry beam, cable lines, magnet LED indicator, train flatbed. |
| [`src/game/craneGameLogic.ts`](src/game/craneGameLogic.ts) | Level state machine, Aim Goal selector integration, 5s countdown, victory train animation, `localStorage` persistence. |
| [`../../../shared/settingsOverlay.ts`](../../../shared/settingsOverlay.ts) | In-game settings modal (`⚙️` icon / `ESC`) with Control Mode, Sensitivity & Invert X/Y stored in `localStorage`. |

---

## 🚀 How to Run

1. Launch Vite dev server in project root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/crane_tower/index.html`
