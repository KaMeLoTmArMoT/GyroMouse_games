# 🔮 3D Marble Maze

An interactive 3D physics marble maze game controlled by tilting your smartphone via **GyroMouse** air-mouse or using keyboard arrow keys / WASD.

---

## 🤝 Handoff / Current State

> **Status:** Fully functional & verified. 0 TypeScript compilation errors. Running via `npm run dev`.

### 📍 Current Features & Architecture:

#### 🎨 Themed Biomes
Every generated maze randomly picks one of three environment themes featuring dedicated terrain types, lighting, and atmospheric fog:

| Theme | Primary Surface | Secondary Surface | Tertiary Surface | Atmosphere & Fog |
|---|---|---|---|---|
| ❄️ **Winter** | Snow (standard) | Ice (ultra-slippery) | Asphalt | Crisp ice-blue fog |
| 🏙️ **City** | Asphalt (standard) | Dirt/Mud (heavy drag) | Cobblestone | Dark urban dusk |
| 🌿 **Forest** | Grass (light resistance) | Dirt/Mud (heavy drag) | Path/Asphalt | Emerald forest haze |

Surfaces are generated in **organic clusters** (Voronoi seed placement) rather than completely random single tiles.

#### 🕳️ Pitfalls & Holes
- **Three Diameters:** Small ($r = 0.35\text{m}$), Medium ($r = 0.48\text{m}$), Large ($r = 0.62\text{m}$).
- **Variable Cell Placement:** Center, Corners, or Side edges.
- **Physics Behavior:** Game Over triggers ONLY when the marble **physically drops** below the floor level (`translation.y < -0.35`). No artificial magnetic attraction or premature boundary triggers.

#### 🎮 Physics Engine (Rapier3D)
- Board geometry is static; tilt is achieved by mathematically rotating the gravity vector $\vec{g}$.
- **Sleep Disabled:** `setSleeping(false)` + `wakeUp()` on gravity update prevent the marble from freezing if Rapier puts the rigid body to sleep.
- **Surface Frictions:**

| Surface | Friction Coefficient | In-Game Effect |
|---|---|---|
| Ice | 0.03 | Ultra-slippery sliding |
| Cobblestone | 0.35 | Smooth rolling |
| Snow / Asphalt / Path | 0.45 | Standard balanced control |
| Grass | 0.65 | Soft surface drag |
| Sand / Dirt / Mud | 0.90–0.95 | Heavy resistance / deceleration |

#### ⌨️ Input Handling (InputManager)
- Captures both `e.code` and `e.key` for maximum compatibility with physical keyboards, `pyautogui`, and Chrome Extension `dispatchEvent`.
- Auto-connects to GyroMouse WebSocket stream at `ws://127.0.0.1:5006` with auto-reconnect.
- Supports zero-point calibration (Re-Center via `KeyC` hotkey or `calibrate` payload button).
- `window.blur` listener clears `keysPressed` to prevent stuck arrow keys when switching windows or opening DevTools (F12).
- Default mode: `mode: 'keyboard'`, `mouseEnabled: false` (toggleable in ⚙️ Settings).
- **Audio:** Muted by default (`isMuted: true`).

---

## 📁 Submodule File Map

| File | Role & Features |
| :--- | :--- |
| [`src/main.ts`](src/main.ts) | Entry point: Game loop orchestration, physics step, render loop, HUD updates. |
| [`src/physics/physicsManager.ts`](src/physics/physicsManager.ts) | **Rapier3D:** Static floor colliders, hole sensors, gravity vector $\vec{g}$ rotation, sleep fix. |
| [`src/graphics/sceneManager.ts`](src/graphics/sceneManager.ts) | **Three.js:** Top-down camera, materials for 7 terrain types, biome atmosphere, hole rendering. |
| [`src/maze/mazeGenerator.ts`](src/maze/mazeGenerator.ts) | **DFS Generator:** Themes, organic Voronoi biome clusters, dynamic `HoleConfig`. |
| [`src/ui/hudManager.ts`](src/ui/hudManager.ts) | **UI HUD:** Timer, coin counter, terrain badge (7 types + icons), seed copying, modals. |
| [`../../../shared/inputManager.ts`](../../../shared/inputManager.ts) | **Shared Input:** WASD/Arrows + GyroMouse WebSocket `ws://127.0.0.1:5006`, Re-Center (`KeyC`), `getSteeringValue()`. |
| [`../../../shared/audioManager.ts`](../../../shared/audioManager.ts) | **Shared Audio:** Web Audio API sound synthesizer (muted by default). |

---

## 🚀 How to Run

1. Start the Vite dev server in the `GyroMouse_games` root:
   ```bash
   npm run dev
   ```
2. Open in your browser: `http://localhost:5173/games/marble_maze/index.html`
