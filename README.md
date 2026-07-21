# GyroMouse Web Games 🎯🕹️

A suite of minimalist, high-performance web games engineered for zero-hosting local execution and smart smartphone control via **GyroMouse** (Android Air-Mouse app) or standard keyboard inputs.

---

## 🏗️ Monorepo & Submodule Architecture

This repository uses a clean modular structure where all web games share common core dependencies (`package.json`) and shared input/audio libraries (`shared/`), while individual games are isolated in dedicated submodules inside `games/`:

```text
GyroMouse_games/
├── package.json               # Root dependencies (Three.js, Rapier3D, Vite, TypeScript)
├── vite.config.ts             # Multi-page bundler configuration
├── index.html                 # 🎯 Game Hub / Launcher page
├── README.md                  # Main project documentation
│
├── shared/                    # 🧬 Shared Core Libraries
│   ├── inputManager.ts        # Shared GyroMouse & WASD/Arrow input parser (Lerp factor = dt * 4.0)
│   └── audioManager.ts        # Shared Web Audio API synthesizer & sound hooks (Muted by default)
│
└── games/                     # 🎮 Game Submodules
    ├── marble_maze/           # 🔮 3D Marble Maze (100% Top-Down view, Rapier3D physics + Circular Holes)
    │   ├── index.html
    │   ├── README.md          # Game-specific documentation & Handoff status
    │   └── src/
    │
    └── subway_runner/         # 🏃‍♂️ 3D Endless Runner (Planned)
```

---

## ⚡ Quick Start / Local Launch

### Running locally
1. Clone / open the project directory:
   ```bash
   cd GyroMouse_games
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local server:
   ```bash
   npm run dev
   ```
4. Open your browser at:
   - **Game Hub:** `http://localhost:5173/`
   - **3D Marble Maze:** `http://localhost:5173/games/marble_maze/index.html`

---

## 🎮 Current Games & Status

- **🔮 3D Marble Maze (`games/marble_maze`):**
  - **View:** 100% Top-Down (90° overhead perspective).
  - **Physics:** Static board physics with gravity vector rotation in Rapier3D. Zero catapulting & zero floor tunneling.
  - **Obstacles:** Circular hole pits ($r=0.5\text{m}$) surrounded by walkable floor slabs ($0.95\text{m}$ clearance).
  - **Surfaces:** Ice (ultra-slippery), Sand (high friction), Asphalt (standard).
  - **Controls:** WASD / Arrow Keys by default; PC Mouse Cursor tracking disabled by default (`mouseEnabled: false`, toggleable in Settings).
  - **Audio:** Muted by default (`isMuted: true`).
