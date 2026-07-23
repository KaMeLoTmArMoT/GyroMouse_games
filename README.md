# GyroMouse Web Games 🎯🕹️

A high-performance suite of 3D web games engineered for local execution, zero hosting, and seamless smartphone control via **GyroMouse** (Android Air-Mouse app) or physical keyboard inputs.

---

## 🏗️ Architecture & Project Structure

This project is built as a lightweight multi-page web application using **Vite**, **TypeScript**, **Three.js**, and **Rapier3D physics**. All games share common core dependencies (`package.json`) and shared input/audio modules (`shared/`).

```text
GyroMouse_games/
├── package.json               # Root dependencies (Three.js, Rapier3D, Vite, TypeScript)
├── vite.config.ts             # Multi-page bundler configuration
├── index.html                 # 🎯 Main Game Hub / Launcher
├── README.md                  # Main project documentation
├── AGENTS.md                  # Project rules & guidelines
│
├── shared/                    # 🧬 Shared Core Infrastructure
│   ├── inputManager.ts        # Dual-input parser (Keyboard WASD/Arrows & GyroMouse cursor vectors)
│   └── audioManager.ts        # Web Audio API sound synthesizer (Muted by default)
│
├── games/                     # 🎮 Web Games
│   ├── marble_maze/           # 🔮 3D Marble Maze (Top-down view, Rapier3D physics & terrain types)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   ├── subway_runner/         # 🏃‍♂️ 3D Subway Runner (Subway Surfers-style lane runner)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   └── crane_tower/           # 🏗️ 3D Crane Tower (Cooperative split-axis cargo stacker)
│       ├── index.html
│       ├── README.md          # Game documentation & handoff state
│       └── src/
```

---

## ⚡ Quick Start / Local Launch

### Running locally
1. Open the project root directory:
   ```bash
   cd GyroMouse_games
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Launch local dev server:
   ```bash
   npm run dev
   ```
4. Access in your browser:
   - **Game Hub:** `http://localhost:5173/`
   - **3D Marble Maze:** `http://localhost:5173/games/marble_maze/index.html`
   - **3D Subway Runner:** `http://localhost:5173/games/subway_runner/index.html`
   - **3D Crane Tower:** `http://localhost:5173/games/crane_tower/index.html`

---

## 🎮 Games & Status

### 1. 🔮 3D Marble Maze (`games/marble_maze/`)
* **Perspective:** 100% Top-Down (90° overhead camera).
* **Physics Engine:** Rapier3D static floor colliders with tilt simulated via gravity vector rotation $\vec{g}$. Marble body uses `setSleeping(false)` to prevent freezing on low input.
* **Environments:** Winter (Snow/Ice/Asphalt), City (Asphalt/Dirt/Cobblestone), Forest (Grass/Dirt/Path) — with organic Voronoi terrain clusters and dynamic friction values.
* **Pitfalls & Hazards:** Circular holes with variable radii (0.35m / 0.48m / 0.62m), off-center placement, and pure physical Y-drop detection.
* **Controls:** Keyboard Arrow keys / WASD or GyroMouse tilt.

### 2. 🏃‍♂️ 3D Subway Runner (`games/subway_runner/`)
* **Perspective:** Elevated third-person runner camera.
* **Gameplay:** Endless 3-lane obstacle runner with chunk-based track generation, coin rings, trains, and low/high hurdles.
* **Visuals:** Three.js directional sun + soft shadow mapping, glowing neon rail guides, speed particle streaks, background city skyline, and exponential fog.
* **Controls:** Arrow Keys (`ArrowLeft`/`ArrowRight` for lanes, `ArrowUp` for Jump, `ArrowDown` for Slide, `ESC` for Pause).

### 3. 🏗️ 3D Crane Tower (`games/crane_tower/`)
* **Perspective:** Industrial depot 2D/3D profile view.
* **Gameplay:** Cooperative dual-axis cargo stacker. Player 1 controls Hook Height (Y), Player 2 controls Trolley Position (X). Drop crates onto a train flatbed with Rapier3D physics.
* **Physics & Features:** Cable pendulum equations with frequency-based energy scaling, elastic collision momentum transfer, side supply dock platform, configurable aim goal (3, 5, 7, 9, 11 boxes), and `localStorage` persistence.
* **Controls:** Player 1 (`W`/`S` or `Up`/`Down`), Player 2 (`A`/`D` or `Left`/`Right`), Drop (`Space`).

---

## ⚙️ Development Commands

| Task | Command |
|---|---|
| Development Server | `npm run dev` |
| Build (Type-check + Bundle) | `npm run build` |
| Preview Production Build | `npm run preview` |
| Type-check only | `npx tsc --noEmit` |
