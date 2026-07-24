# 💥 3D Artillery Siege (Split-Control Artillery)

A cooperative 2-Player / Dual-Axis 3D artillery bombardment game built with **Three.js** and **Rapier3D physics**. Player 1 controls Cannon Elevation Pitch (Up/Down), Player 2 controls Turret Azimuth Direction (Left/Right). Players coordinate in a 2-stage aiming & power sequence to hit distant target fortresses with ballistics physics and progressive trajectory sighting hints.

---

## 🕹️ Controls & Gameplay

| Player / Phase | Control Key | Description |
|---|---|---|
| **Player 1 (Pitch / Elevation)** | `W` / `S` or `↑` / `↓` | Adjust cannon pitch angle ($10^\circ \text{ to } 75^\circ$) in Stage 1 / Adjust launch power in Stage 2 |
| **Player 2 (Azimuth / Direction)** | `A` / `D` or `←` / `→` | Turn turret direction ($ -50^\circ \text{ to } +50^\circ$) in Stage 1 / Micro-tune fine angle in Stage 2 |
| **Stage Lock / Fire Trigger** | `Spacebar` / Onscreen Button | **Stage 1:** Lock coarse aim $\rightarrow$ **Stage 2:** Fire cannonball shell |

---

## ⚙️ Game Features & Mechanics

1. **Dual-Axis Split Control**:
   * **Stage 1 (Coarse Aim)**: Player 1 adjusts pitch elevation angle, Player 2 rotates turret base azimuth direction.
   * **Stage 2 (Manual Power & Micro-Tune)**: Player 1 sets launch velocity ($15.0 \text{ to } 65.0 \text{ m/s}$), Player 2 micro-tunes target angle.
2. **Camera Follow & Rotation**:
   * 3D camera dynamically swings and orbits to stay directly behind the cannon barrel sightline as Player 2 turns Left or Right.
3. **Ballistics Physics & Direct Hit System**:
   * Rapier3D continuous collision detection (`setCcdEnabled`). Direct target hits deal 200 damage instantly, triggering explosive particle bursts and sending target blocks tumbling backwards.
4. **Progressive Trajectory Sighting Hints**:
   * Initial sighting shots are unguided. Impact craters remain marked on the field and tactical radar mini-map, while ghost trajectory arcs render past shot paths to help micro-adjust subsequent shots.
5. **Tactical Radar Mini-Map & Spotter Recon**:
   * Top-down canvas overlay displaying range rings ($20\text{m} - 90\text{m}$), active target markers, aim direction vector, past impact crosshairs, and spotter recon logs.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | Main HTML shell, HUD top bar, spotter recon box, 2-stage control panel, tactical radar canvas, victory/defeat modal. |
| [`src/main.ts`](src/main.ts) | Main game loop, 2-stage state machine, keyboard listener tracking, score & level progression. |
| [`src/physics/artilleryPhysics.ts`](src/physics/artilleryPhysics.ts) | Rapier3D physics manager, ground plane collider, target rigidbodies, shell ballistics, instant direct-hit detection. |
| [`src/graphics/artilleryGraphics.ts`](src/graphics/artilleryGraphics.ts) | Three.js visual scene, procedural dusk sunset sky dome, grass/dirt ground texture, metallic cannon model, recoil animation, explosion particles. |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Canvas-based tactical radar map renderer, 2-stage HUD switcher, power bar display, spotter feedback log. |
| [`../../../shared/settingsOverlay.ts`](../../../shared/settingsOverlay.ts) | In-game settings modal (`⚙️` icon / `ESC`) with Control Mode, Sensitivity & Invert X/Y stored in `localStorage`. |

---

## 🚀 How to Run

1. Launch Vite dev server in project root:
   ```bash
   cd GyroMouse_games
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/artillery_siege/index.html`
