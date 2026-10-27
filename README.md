# GyroMouse Web Games 🎯🕹️

A high-performance suite of 3D web games engineered for local execution, zero hosting, and seamless smartphone control via **GyroMouse** (Android Air-Mouse app over WebSocket) or physical keyboard inputs.

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
│   ├── inputManager.ts        # Input module (WASD/Arrows & GyroMouse WebSocket at ws://127.0.0.1:5006, Re-Center, getSteeringValue)
│   ├── settingsOverlay.ts     # In-game settings modal (Gyro/Pointer/Keyboard mode, sensitivity 0.2x-3.0x, invert X/Y, auto localStorage)
│   ├── settingsOverlay.css    # Sleek dark/neon glassmorphism styles for settings overlay modal & floating gear button
│   ├── menuNav.ts             # 2D spatial grid keyboard navigation manager using element bounding rects
│   ├── audioManager.ts        # Web Audio API sound synthesizer (Muted by default)
│   └── baseGame.ts            # Abstract BaseGame controller with unified key & pause handling
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
│   ├── crane_tower/           # 🏗️ 3D Crane Tower (Cooperative split-axis cargo stacker)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   ├── artillery_siege/       # 💥 3D Artillery Siege (Cooperative dual-axis artillery bombardment)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   ├── cyber_pong/            # 🏓 3D Cyber Air Hockey / Cyber Pong (1P vs AI Bot & 2P local split-screen)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   ├── wormix/                # 🐛💥 Wormix (Turn-based 2D elemental artillery battle)
│   │   ├── index.html
│   │   ├── README.md          # Game documentation & handoff state
│   │   └── src/
│   │
│   └── void_dungeon/          # 🗡️ Void Dungeon (Co-op 2P dungeon crawler with raycast auto-aim & enemies)
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
   - **Game Hub:** `http://localhost:5175/`
   - **3D Marble Maze:** `http://localhost:5175/games/marble_maze/index.html`
   - **3D Subway Runner:** `http://localhost:5175/games/subway_runner/index.html`
   - **3D Crane Tower:** `http://localhost:5175/games/crane_tower/index.html`
   - **3D Artillery Siege:** `http://localhost:5175/games/artillery_siege/index.html`
   - **3D Cyber Air Hockey:** `http://localhost:5175/games/cyber_pong/index.html`
   - **Wormix Artillery:** `http://localhost:5175/games/wormix/index.html`
   - **Void Dungeon:** `http://localhost:5175/games/void_dungeon/index.html`

---

## 🎮 Games & Status

### 1. 🔮 3D Marble Maze (`games/marble_maze/`)
* **Perspective:** Top-Down 90° overhead camera.
* **Physics:** Rapier3D static floor colliders with gravity vector tilt simulation $\vec{g}$, Continuous Collision Detection (CCD), and delta-time capping.
* **Features:** Organic Voronoi terrain clusters (Snow/Ice/Asphalt, City, Forest), procedural pitfall holes, checkpoint respawns, and seed sharing.
* **Controls:** GyroMouse tilt / Keyboard Arrow keys / `WASD`. Re-Center with `C`. Pause via `ESC`.

### 2. 🏃‍♂️ 3D Subway Runner (`games/subway_runner/`)
* **Perspective:** Third-person runner camera.
* **Gameplay:** Endless 3-lane obstacle runner with chunk-based track generation, coin rings, low/high hurdles, launch ramps, train roof running with coin lines, multi-car train convoys, and 7s stumble grace period.
* **Power-Ups:** Collectible 🧲 *Magnet* (10s coin suction), 🛡️ *Shield* (absorbs 1 hit), and 🚀 *Jetpack* (soars $Y=6.0\text{m}$ above tracks for 6s).
* **Controls:** Arrow Keys & `WASD` (`A`/`←` & `D`/`→` for lanes, `W`/`↑` for Jump, `S`/`↓` for Slide, `ESC` for Pause).

### 3. 🏗️ 3D Crane Tower (`games/crane_tower/`)
* **Perspective:** Industrial depot profile view.
* **Gameplay:** Cooperative dual-axis cargo stacker. Player 1 controls Hook Height (Y), Player 2 controls Trolley Position (X). Drop crates onto a train flatbed with Rapier3D physics.
* **Features:** Dynamic 12-point ballistic trajectory laser arc calculating pendulum swing velocity and trolley inertia (automatically visible when cargo is held).
* **Controls:** Player 1 (`W`/`S` or `Up`/`Down`), Player 2 (`A`/`D` or `Left`/`Right`), Drop (`Space`), Pause (`ESC`).

### 4. 💥 3D Artillery Siege (`games/artillery_siege/`)
* **Perspective:** Dynamic 3D behind-the-turret camera with automatic orbit follow & Tactical Radar overlay.
* **Gameplay:** Cooperative dual-axis artillery bombardment. Player 1 controls Elevation Pitch & Power, Player 2 controls Turret Azimuth.
* **Features:** High-impact positional and lookAt rotational screenshake, plus 5 procedurally stacked destructible fortress archetypes (Citadel, Twin Spires, Stepped Pyramid, Barbican Gatehouse, Sky Watchtower Redoubt).
* **Controls:** Player 1 (`Up`/`Down` pitch & power), Player 2 (`Left`/`Right` direction), Stage Lock / Fire (`Space`), Pause (`ESC`).

### 5. 🏓 3D Cyber Air Hockey / Cyber Pong (`games/cyber_pong/`)
* **Perspective:** 3D overhead neon arena view.
* **Gameplay:** 1-Player vs AI Bot (3 difficulties) or 2-Player local versus air hockey with brick shield destruction.
* **Features:** Curved paddle surface normal reflections (up to $\pm 56^\circ$ deflection), spin shot velocity transfer, and Rapier3D CCD anti-tunneling.
* **Controls:** Player 1 (`W`/`S` or `Up`/`Down`), Player 2 (`A`/`D` or `Left`/`Right`), Start/Pause (`Space` / `ESC`).

### 6. 🐛💥 Wormix Artillery (`games/wormix/`)
* **Perspective:** 2D profile tactical arena.
* **Gameplay:** Turn-based elemental artillery with Offscreen Pixel-Mask Destructible Terrain (Grass, Dirt, Stone, Bedrock, Sand, Water, Acid, Portals), wind physics, trajectory arcs, and smart AI opponents.
* **Controls:** GyroMouse Restricted Mode (3-step turn flow with `WASD`/Arrows + `Space`) & PC Mode (Mouse aiming/clicking). 30 FPS locked simulation tick.

### 7. 🗡️ Void Dungeon (`games/void_dungeon/`)
* **Perspective:** Top-down co-op dungeon crawler.
* **Gameplay:** Procedural dungeon mazes with fog-of-war visibility, key collection, and exit portal.
* **Features:** Smooth wall and corner-sliding physics, 8 patrolling shadow phantom enemies with HP bars, and magic projectile shooting with a 90° forward vision cone auto-aim.
* **Controls:** Player 1 (`WASD` move), Player 2 (Arrow keys aim torch), Shoot (`Space` / `Enter`), Pause (`ESC`).

---

## 📡 GyroMouse Input & WebSocket Protocol

All games automatically receive gyroscope stream data via `SharedInputManager` from the GyroMouse WebSocket server (`ws://127.0.0.1:5006`).

* **Auto-connect & Reconnect:** Automatically connects on launch and reconnects every 2s if connection is dropped.
* **Re-Center Calibration:** Press **`C`** on keyboard or send `"buttons": { "calibrate": true }` to reset zero tilt reference.
* **Unified Steering:** Exposes `getSteeringValue({ deadzone, sensitivity, invertX, invertY })` returning normalized `{ x, y }` values `[-1.0..1.0]`. Fallback to WASD/Arrows when no live gyro data is connected.

---

## ⚙️ In-Game Settings & 2D Grid Navigation

* **⚙️ Settings Overlay (`shared/settingsOverlay.ts`):** Press **`ESC`** key or click the floating **`⚙️`** gear icon in the top-right corner in any game to customize:
  1. **Control Mode**: Dropdown (`Gyro Motion / Analog`, `Air Mouse / Pointer`, `Keyboard / WASD`).
  2. **Sensitivity Multiplier**: Slider (`0.2x` to `3.0x`).
  3. **Axis Inversion**: Checkboxes for `Invert X` and `Invert Y`.
  - Preferences auto-save to `localStorage` under `gyromouse_settings_<game_id>` and restore automatically on page refresh (`F5`).
* **🛠️ 2D Grid Menu Navigation (`shared/menuNav.ts`):** Menu navigation operates as a true 2D spatial grid using element bounding rects. Pressing or tilting `Down` / `Up` / `Left` / `Right` moves focus strictly to the adjacent element in 2D space.

---

## ⚙️ Development Commands

| Task | Command |
|---|---|
| Development Server | `npm run dev` |
| Build (Type-check + Bundle) | `npm run build` |
| Preview Production Build | `npm run preview` |
| Type-check only | `npx tsc --noEmit` |

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

