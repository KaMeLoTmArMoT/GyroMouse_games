# 🐛💥 Wormix (Turn-Based Elemental Artillery)

A 2D turn-based tactical artillery battle game (inspired by Worms & Wormix) built with **Canvas 2D**, featuring an **Offscreen Pixel-Mask Destructible Terrain Engine**, **Live Dynamic Water Physics & Lakes**, **Interactive Map Objects**, **Canvas Map Editor with LocalStorage & JSON Save/Load**, **Match Lobby & Game Modes**, **30 FPS locked simulation tick**, elemental terrain physics (Grass, Dirt, Stone, Bedrock, Sand, Water, Acid, Portals), wind vectors, trajectory sighting arcs, smart tactical AI, and **dual control modes** (GyroMouse Restricted Mode & PC Mouse/Keyboard Mode).

---

## 🕹️ Controls & Gameplay

### Dual Control Support

1. **GyroMouse / Restricted Mode** (`WASD` / Arrow Keys + `Space` + `ESC`):
   * **Step 1 — Move (`WALK`)**: `A` / `D` or `←` / `→` (or Gyro Roll tilt) to walk. `W` / `↑` tap to jump / swim upward in water. Tap `Space` to proceed to Weapon Selection.
   * **Step 2 — Select Weapon (`WEAPON_SELECT`)**: `A` / `D` or `←` / `→` to cycle toolbar. Tap `Space` to equip weapon. Tap `S` / `↓` to return to Movement.
   * **Step 3 — Aim & Fire (`AIM_FIRE`)**: `W` / `S` or `↑` / `↓` (or Gyro Pitch tilt) to adjust aim angle. **Hold `Space`** to charge launch power meter $\rightarrow$ **Release `Space`** to FIRE!
   * **Re-Center Calibration**: `KeyC` (letter C).
   * **Settings Overlay**: `ESC` or floating gear icon `⚙️`.

2. **PC Mode** (Mouse + Keyboard):
   * `WASD` / Arrow keys to walk, mouse cursor to aim cannon angle, click or hold `Space` to charge launch power meter and fire!

---

## ⚙️ Game Features & Mechanics

1. **🧪 2D Cellular Automata Grid Physics Engine**:
   * Powered by a discrete 2D grid (`Uint8Array`) running a **Falling Sand Cellular Automata Simulation Algorithm** with bottom-to-top processing sweeps and directional shuffling.
   * **🌊 Water & Liquid Mechanics**:
     * **Multi-Pass Fluid Dispersion**: 2-pass liquid physics loop for fast, natural fluid flow without jelly sloshing.
     * **Free Hill Slope Tumbles**: Liquids flow freely down steep terrain slopes and cascade down into valley craters without sticking.
     * **Smooth Lake Surface Wave Lines**: Contiguous horizontal liquid pools feature animated surface wave highlights (`rgba(186, 230, 253, 0.85)`) rendered dynamically over flat lake tops.
   * **🧪 Acid Mechanics**: Flows like water and actively dissolves adjacent solid terrain and sand cells into empty air on contact with bubbling particles.
   * **⏳ Sand Mechanics**: Falls down, slumps down slopes into craters, and sinks through water cells (displacing water upward).
   * **Real-time Waterfall Cascades**: Carving holes beneath liquid pools causes water and acid to cascade down into newly carved craters in real-time.
   * **🌊 Global Ocean & Subterranean Bedrock**: Smooth animated ocean liquid level at `waterY = height - 40` with an indestructible bedrock foundation (`CELL_BEDROCK`) safely layered beneath the ocean floor.

2. **🌊 Submersion, Buoyancy & Swimming**:
   * Worms submerged in water or acid experience dynamic buoyancy force and fluid drag based on surrounding liquid grid cell density, allowing them to swim upward (`W` / `↑` key).
   * **Oxygen Breath Meter**: Submerged worms have an Oxygen meter (100 $\rightarrow$ 0). When oxygen runs out, worms take gradual drowning damage (-0.4 HP/tick).

3. **🛢️ Interactive Map Objects**:
   * 🛢️ **Explosive Barrels**: 50 HP. Detonate when shot or hit by explosions, causing a 55px explosion + flying fire debris.
   * 💣 **Landmines**: Triggers a 1-second countdown beep when a worm steps within 28px distance, then explodes!
   * 🧰 **Health Supply Crates**: Walking or jumping into crates collects them, restoring +30 HP to the worm with a healing sound effect!

4. **🛠️ Interactive Map Editor, Physics Flow & Preview Workflow**:
   * In-game canvas map sculpting tool accessible directly from the Main Menu or ESC Settings screen.
   * **Live Stream Brushes**: Paint Grass, Dirt, Stone, Sand, 🌊 Water, 🧪 Acid, or Eraser in real-time and watch liquids flow and settle into valleys directly inside the editor.
   * **👁️ Preview <-> ✏️ Edit Mode**: Toggle between active editing tools and a clean fullscreen **Preview Mode** to observe falling sand, water leveling, and acid dissolution without UI distraction.
   * **⏸️ Pause / ▶️ Resume Physics Flow**: Freeze cellular physics tick while painting steep sand dunes or liquid containers, or unpause to test fluid flow dynamics.
   * **🔄 Reset Grid Snapshot**: One-click grid snapshot restore button to instantly reset terrain back to its initial state before physics simulation ran.
   * **Entity Placement**: Drag & drop Red Spawns, Blue Spawns, Oil Barrels, Landmines, and Health Crates.
   * **Storage**: Save maps to browser `localStorage`, export as `.wormix.json` files, or import custom JSON map files.
   * **Seamless Test Play Loop**: Test your custom map in an active match with one click, and return to the editor at any time via ESC Settings (`✏️ Map Editor / Return to Edit`).

5. **⚔️ Match Lobby & Game Modes**:
   * **Team Configurations**: 1v1, 2v2, 3v3 team sizes.
   * **Custom Health**: 50 HP, 100 HP, 150 HP, 200 HP per worm.
   * **Game Modes**:
     * *Classic Deathmatch*
     * *🌊 Rising Water (Sudden Death)*: Ocean water level constantly rises by +0.08px each tick!
     * *🏰 Fort Warfare*: Pre-built fortress maps.

6. **Arsenal**:
   * 🚀 **Bazooka**: Wind-affected heavy explosive missile.
   * 💣 **Grenade**: Bouncing projectile with 3-second fuse timer.
   * 💥 **Cluster Bomb**: Splits into 5 mini-bombs on impact.
   * 🧪 **Acid Bomb**: Spawns a stream of corrosive `CELL_ACID` cells that melt terrain layers.
   * ⏳ **Sand Bomb**: Generates a new sand dune mound on impact.
   * 🌀 **Portal Gun**: Deploys an Orange or Blue portal pair on terrain surfaces to warp incoming projectiles and worms.
   * 🔫 **Shotgun**: Direct line-of-sight double shot.


7. **Fixed 30 FPS Lock**:
   * Game loop simulation locked at `1000/30` ms tick rate for consistent physics across all hardware.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | Canvas container, back button to main hub, styling. |
| [`src/main.ts`](src/main.ts) | Game orchestrator, 30 FPS tick loop, 3-step turn state machine, menu/editor management. |
| [`src/terrain/terrainManager.ts`](src/terrain/terrainManager.ts) | Offscreen pixel-mask terrain engine, Bezier curve surface generation, live dynamic water physics, lake breaching & waterfall particles. |
| [`src/entities/worm.ts`](src/entities/worm.ts) | Worm unit physics, walking, jumping, terrain collision, water buoyancy, oxygen breath meter, health bar. |
| [`src/entities/mapObject.ts`](src/entities/mapObject.ts) | Interactive map entities: Explosive Barrels, Landmines proximity triggers, Health Crates pickup. |
| [`src/editor/mapEditor.ts`](src/editor/mapEditor.ts) | Interactive canvas map editor with material brushes, spawn/object placement, and instant test play. |
| [`src/editor/mapStorage.ts`](src/editor/mapStorage.ts) | Map storage utility for LocalStorage map registry, preset maps, and JSON file export/import. |
| [`src/ui/menuModal.ts`](src/ui/menuModal.ts) | Glassmorphism main menu & match lobby (Quick Play, Team Size, Health, Game Modes, Map Selector). |
| [`src/physics/projectile.ts`](src/physics/projectile.ts) | Projectile simulation, wind force, gravity, portal warping, explosion damage & knockback. |
| [`src/ai/wormAI.ts`](src/ai/wormAI.ts) | Tactical AI trajectory calculation and difficulty levels. |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Glassmorphism HUD, turn phase banner, trajectory arc preview, power meter, weapon selector toolbar. |
| [`src/types.ts`](src/types.ts) | Type interfaces for turn phases, materials, weapons, map objects, water bodies, map data, and lobby config. |

---

## 🚀 How to Run

1. Launch dev server from root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/wormix/index.html`
