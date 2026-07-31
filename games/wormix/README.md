# 🐛💥 Wormix (Turn-Based Elemental Artillery)

A 2D turn-based tactical artillery battle game (inspired by Worms & Wormix) built with **Canvas 2D**, featuring an **Offscreen Pixel-Mask Destructible Terrain Engine**, **Live Dynamic Water & Acid Physics**, **Interactive Map Objects**, **Canvas Map Editor with LocalStorage & JSON Save/Load**, **Map Manager with Visual Gallery & CRUD Actions**, **Match Lobby with PvP & AI Modes**, **30 FPS locked simulation tick**, elemental terrain physics (Grass, Dirt, Stone, Bedrock, Sand, Water, Acid, Iron, Portals), wind vectors, trajectory sighting arcs, smart tactical AI with selectable difficulty, and **dual control modes** (GyroMouse Restricted Mode & PC Mouse/Keyboard Mode).

---

## 🕹️ Controls & Gameplay

### Dual Control Support

1. **GyroMouse / Restricted Mode** (`WASD` / Arrow Keys + `Space` + `ESC`):
   * **Step 1 — Move (`WALK`)**: `A` / `D` or `←` / `→` (or Gyro Roll tilt) to walk. `W` / `↑` tap to jump / swim upward in water. Tap `Space` to proceed to Weapon Selection.
   * **Step 2 — Select Weapon (`WEAPON_SELECT`)**: `A` / `D` or `←` / `→` to cycle toolbar (depleted weapons are skipped). Tap `Space` to equip weapon. Tap `S` / `↓` to return to Movement.
   * **Step 3 — Aim & Fire (`AIM_FIRE`)**: `W` / `S` or `↑` / `↓` (or Gyro Pitch tilt) to adjust aim angle. **Hold `Space`** to charge launch power meter → **Release `Space`** to FIRE!
   * **Step 4 — Reposition (`REPOSITION`)**: After firing, you have **3 seconds** to move before the turn ends. Use `A` / `D` / `W` to take cover or reposition. No weapon switching during this phase.
   * **Re-Center Calibration**: `KeyC` (letter C).
   * **Settings Overlay**: `ESC` or floating gear icon `⚙️`.

2. **PC Mode** (Mouse + Keyboard):
   * `WASD` / Arrow keys to walk, mouse cursor to aim cannon angle, click or hold `Space` to charge launch power meter and fire!

---

## ⚙️ Game Features & Mechanics

1. **🧪 2D Cellular Automata Grid Physics Engine**:
   * Powered by a discrete 2D grid (`Uint8Array`) running a **Falling Sand Cellular Automata Simulation Algorithm** with bottom-to-top processing sweeps and directional shuffling.
   * **⚙️ Iron / Metal Mechanics**: Acid-immune material (`CELL_IRON`) rendered in dark steel slate (`#334155`). Acid pools against or flows past Iron without dissolving it, while explosive weapons and projectiles can destroy Iron terrain normally.
   * **🌊 Water & Liquid Mechanics**:
     * **Multi-Pass Fluid Dispersion**: 2-pass liquid physics loop for fast, natural fluid flow without jelly sloshing.
     * **Free Hill Slope Tumbles**: Liquids flow freely down steep terrain slopes and cascade down into valley craters without sticking.
     * **Smooth Lake Surface Wave Lines**: Contiguous horizontal liquid pools feature animated surface wave highlights (`rgba(186, 230, 253, 0.85)`) rendered dynamically over flat lake tops.
   * **🧪 Acid Mechanics**: Flows like water and actively dissolves adjacent solid terrain and sand cells into empty air on contact with bubbling particles. Iron cells are immune to acid dissolution.
   * **⏳ Sand Mechanics**: Falls down, slumps down slopes into craters, and sinks through water cells (displacing water upward).
   * **Real-time Waterfall Cascades**: Carving holes beneath liquid pools causes water and acid to cascade down into newly carved craters in real-time.
   * **🌊 Global Ocean & Subterranean Bedrock**: Smooth animated ocean liquid level at `waterY = height - 40` with an indestructible bedrock foundation (`CELL_BEDROCK`) safely layered beneath the ocean floor.

2. **🏔️ Terrain Collision & Smooth Slope Physics**:
   * **Smooth Slope Traversal**: Worms walk up gentle and moderate hills with smooth frame-by-frame vertical interpolation instead of instant teleport snapping.
   * **10px Max Step-Up Limit & Cliff Blocking**: Steep cliffs, vertical walls, or island sides higher than 10px block horizontal movement (`vx = 0`). Worms must **jump** (`W` / `↑` / `Space`) to climb up high ledges!
   * **Local 2D Grid Collision & Floating Islands**: Ground surface detection probes local terrain cells around feet level instead of sky-column scanning, eliminating teleportation onto floating islands overhead and allowing natural cave/tunnel navigation.
   * **Ceiling & Head Collision**: Worms bump their heads (`vy = 0`) against overhangs or floating island undersides when jumping or swimming upward.
   * **Dynamic Waddle Animation**: Worm bodies feature subtle waddle rotation while walking across terrain for organic motion.

3. **🌊 Submersion, Buoyancy & Swimming**:
   * Worms submerged in water or acid experience dynamic buoyancy force and fluid drag based on surrounding liquid grid cell density, allowing them to swim upward (`W` / `↑` key).
   * **Oxygen Breath Meter**: Submerged worms have an Oxygen meter (100 → 0). When oxygen runs out, worms take gradual drowning damage (-0.4 HP/tick).

4. **🛢️ Interactive Map Objects**:
   * 🛢️ **Explosive Barrels**: 50 HP. Detonate when shot or hit by explosions, causing a 55px explosion + flying fire debris.
   * 💣 **Landmines**: Triggers a 1-second countdown beep when a worm steps within 28px distance, then explodes!
   * 🧰 **Health Supply Crates**: Walking or jumping into crates collects them, restoring +30 HP to the worm with a healing sound effect!

5. **🛠️ Interactive Map Editor, Physics Flow & Preview Workflow**:
   * In-game canvas map sculpting tool accessible directly from the Main Menu or ESC Settings screen.
   * **Live Stream Brushes & Adjustable Brush Size**: Paint Grass, Dirt, Stone, Sand, 🌊 Water, 🧪 Acid, ⚙️ Iron, or Eraser in real-time. Adjust brush radius from **6px to 40px** using the top slider control, with a live dashed cursor ring indicating brush size on canvas.
   * **↩️ Undo / ↪️ Redo (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`)**: Built-in 30-step undo/redo buffer for step-back and step-forward recovery via top-toolbar buttons or standard keyboard shortcuts.
   * **👁️ Preview ↔ ✏️ Edit Mode**: Toggle between active editing tools and a clean fullscreen **Preview Mode** (hides toolbar overlays) to observe falling sand, water leveling, and acid reactions across the entire canvas without UI clutter.
   * **⏸️ Pause / ▶️ Resume Physics Flow**: Freeze cellular physics tick while painting steep sand dunes or liquid containers, or unpause to test fluid flow dynamics.
   * **🔄 Reset Grid Snapshot**: One-click grid snapshot restore button with a **confirmation safety prompt** before clearing unsaved edits.
   * **Entity Placement**: Drag & drop Red Spawns, Blue Spawns, Oil Barrels, Landmines, and Health Crates.
   * **Storage**: Save maps to browser `localStorage`, export as `.wormix.json` files, or import custom JSON map files.
   * **Seamless Test Play Loop**: Test your custom map in an active match with one click (`▶️ Test Play`), and return instantly to editing via the floating **`✏️ Return to Editor`** button (`top: 85px; right: 16px;`) or ESC Settings (`✏️ Map Editor`).

6. **🗂️ Map Manager — Visual Gallery & CRUD**:
   * Dedicated gallery modal accessible from the Main Menu via the **`🗂️ Map Manager`** button (cyan gradient).
   * **On-the-fly Terrain Thumbnails**: Each map card renders a live canvas preview (220×90px) from `terrainHeights[]` — green grass, brown dirt, gray stone gradient, blue water level, and colored spawn point dots. Zero localStorage overhead.
   * **Card Layout**: Scrollable grid of map cards showing thumbnail, map name, creation date, and last-edited timestamp (falls back to creation date for pre-existing maps).
   * **Custom Map Actions**:
     * ✏️ **Edit** — Opens the Map Editor with the selected map loaded for editing.
     * 📋 **Clone** — Deep-clones the map with a new unique `id` and `(Copy)` suffix name. All arrays (terrain, spawns, objects) are independently copied.
     * ✏️ **Rename** — Inline editable text input on the card; saves on Enter/blur, cancels on Escape.
     * 🗑️ **Delete** — Confirmation prompt → permanently removes the map from `localStorage`.
     * 💾 **Export** — Downloads the map as a `.wormix.json` file.
   * **Preset Map Cards**: Displayed in a separate section with a `PRESET` badge. Each offers **👁️ View** (clones the preset and opens it in the editor for viewing/editing) and **📋 Clone as Custom** (copies the preset into custom storage as an editable map).
   * **➕ Create New Map**: Dashed-border card at the start of the custom grid — opens a blank map in the editor.
   * **📥 Import**: File picker button at the bottom to import `.wormix.json` files directly into the gallery.
   * **Backward-Compatible Data Model**: `updatedAt` field on `CustomMapData` is optional (`updatedAt?`) — existing saved maps display creation date only.

7. **⚔️ Match Lobby & Game Modes**:
    * **Match Type**:
      * 🤖 **Player vs AI**: Red Team (human) vs Blue Team (bot). Select bot difficulty below.
      * 👥 **Local PvP (Pass & Play)**: Both Red and Blue teams are human-controlled. Players take turns passing the keyboard. HUD turn banners display `🔴 RED PLAYER TURN` / `🔵 BLUE PLAYER TURN` to indicate whose turn it is. AI logic is completely disabled.
    * **🤖 Bot Difficulty** (Player vs AI only):
      * 🐣 **Easy**: Random target selection, large aim scatter (±20°), no wind compensation, Bazooka & Shotgun only.
      * 🎯 **Normal**: Closest target focus, moderate scatter (±6°), partial wind compensation (×1.2), Bazooka / Grenade / Cluster.
      * 🔥 **Hard**: Precise parabolic trajectory solver (±1.25°), full wind vector compensation (×2.8), tactical weapon selection (Cluster for grouped enemies, Acid Bomb for cover terrain, Grenade, Bazooka). **Utility-based AI** with 5 personality presets (aggressive, sniper, looter, chaotic, default), trajectory simulation, position scoring, and ammo-aware weapon selection.
    * **Team Configurations**: 1v1, 2v2, 3v3 team sizes.
    * **Custom Health**: 50 HP, 100 HP, 150 HP, 200 HP per worm.
    * **Game Modes**:
      * *Classic Deathmatch*
      * *🌊 Rising Water (Sudden Death)*: Ocean water level rises by +0.08px per tick!
      * *🏰 Fort Warfare*: Pre-built fortress maps.
    * **⚔️ Lobby Shortcut**: Floating green **`⚔️ Lobby`** button (`top: 85px; left: 16px;`) visible during all active matches. Click to jump back to the Match Lobby without using ESC.

8. **🗺️ Preset Maps**:
   * 🎲 **Random Procedural**: Freshly generated Bezier-curve terrain each match.
   * 🏝️ **Floating Archipelago**: Two isolated islands separated by a wide ocean channel with a Health Crate in the gap.
   * 🏰 **Twin Fortresses**: Mirror fortified towers on each side with a low valley battlefield in the center.
   * ⚙️ **Iron Citadel**: Raised Iron-material bunker towers on each flank — acid-immune, explosives-only breachable.
   * 🌋 **Volcano Acid Crater**: Concave central crater terrain, ideal for acid-lake flooding matches.

9. **Arsenal** (per-team shared ammo pool):
   * 🚀 **Bazooka**: Wind-affected heavy explosive missile. **∞ ammo** — always available.
   * 💣 **Grenade**: Bouncing projectile with 3-second fuse timer. **×4 ammo**.
   * 💥 **Cluster Bomb**: Splits into 5 mini-bombs on impact. **×2 ammo**.
   * 🧪 **Acid Bomb**: Spawns a stream of corrosive `CELL_ACID` cells that melt terrain layers. **×2 ammo**.
   * ⏳ **Sand Bomb**: Generates a new sand dune mound on impact. **×3 ammo**.
   * 🌀 **Portal Gun**: Deploys an Orange or Blue portal pair on terrain surfaces to warp incoming projectiles and worms. **×2 ammo**.
   * 🔫 **Shotgun**: Direct line-of-sight double shot. **×3 ammo**.
   * **Ammo Display**: Weapon toolbar shows `×N` badges on each card. Depleted weapons are grayed out and skipped during cycling.

10. **Fixed 30 FPS Lock**:
   * Game loop simulation locked at `1000/30` ms tick rate for consistent physics across all hardware.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | Canvas container, back button to main hub, styling. |
| [`src/main.ts`](src/main.ts) | Game orchestrator, 30 FPS tick loop, 4-step turn state machine (MOVE → WEAPON_SELECT → AIM_FIRE → PROJECTILE_FLIGHT → REPOSITION), PvP/AI mode, ammo inventory system, floating HUD buttons, menu/editor/MapManager lifecycle management. |
| [`src/terrain/terrainManager.ts`](src/terrain/terrainManager.ts) | Offscreen pixel-mask terrain engine, Bezier curve surface generation, live dynamic water physics, Iron acid-immunity, lake breaching & waterfall particles. |
| [`src/entities/worm.ts`](src/entities/worm.ts) | Worm unit physics, walking, jumping, terrain collision, water buoyancy, oxygen breath meter, health bar. |
| [`src/entities/mapObject.ts`](src/entities/mapObject.ts) | Interactive map entities: Explosive Barrels, Landmines proximity triggers, Health Crates pickup. |
| [`src/editor/mapEditor.ts`](src/editor/mapEditor.ts) | Interactive canvas map editor with material brushes (incl. Iron), spawn/object placement, 30-step Undo/Redo, and instant test play. |
| [`src/editor/mapStorage.ts`](src/editor/mapStorage.ts) | Map storage utility for LocalStorage map registry, 4 preset maps, rename/clone/delete operations, and JSON file export/import. |
| [`src/ui/menuModal.ts`](src/ui/menuModal.ts) | Glassmorphism match lobby — Match Type (PvP / AI), Bot Difficulty (Easy / Normal / Hard), Team Size, Health, Game Modes, Map Selector, Map Manager shortcut. |
| [`src/ui/mapManager.ts`](src/ui/mapManager.ts) | Visual gallery modal for map management — on-the-fly terrain thumbnails, card grid, Edit/Clone/Rename/Delete/Export actions, preset cloning, JSON import. |
| [`src/physics/projectile.ts`](src/physics/projectile.ts) | Projectile simulation, wind force, gravity, portal warping, explosion damage & knockback. |
| [`src/ai/wormAI.ts`](src/ai/wormAI.ts) | Tactical AI with utility-based scoring, trajectory simulation, 5 personality presets, position candidate evaluation, cover/crate scoring, ammo-aware weapon selection, and target-based movement (walks to optimal position, no random jumping). |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Glassmorphism HUD, PvP team turn banners, trajectory arc preview, power meter, weapon selector toolbar with ammo count badges (`×N`), depleted weapon dimming. |
| [`src/types.ts`](src/types.ts) | Type interfaces for turn phases (incl. `REPOSITION`), materials, weapons, map objects, water bodies, lobby config (incl. `matchType`), `TeamAmmo`, `CustomMapData` (incl. `updatedAt`). |

---

## 🚀 How to Run

1. Launch dev server from root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/wormix/index.html`
