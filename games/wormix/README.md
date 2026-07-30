# 🐛💥 Wormix (Turn-Based Elemental Artillery)

A 2D turn-based tactical artillery battle game (inspired by Worms & Wormix) built with **Canvas 2D**, featuring an **Offscreen Pixel-Mask Destructible Terrain Engine**, **30 FPS locked simulation tick**, elemental terrain physics (Grass, Dirt, Stone, Bedrock, Sand, Water, Acid, Portals), wind vectors, trajectory sighting arcs, smart tactical AI, and **dual control modes** (GyroMouse Restricted Mode & PC Mouse/Keyboard Mode).

---

## 🕹️ Controls & Gameplay

### Dual Control Support

1. **GyroMouse / Restricted Mode** (`WASD` / Arrow Keys + `Space` + `ESC`):
   * **Step 1 — Move (`WALK`)**: `A` / `D` or `←` / `→` (or Gyro Roll tilt) to walk. `W` / `↑` tap to jump. Tap `Space` to proceed to Weapon Selection.
   * **Step 2 — Select Weapon (`WEAPON_SELECT`)**: `A` / `D` or `←` / `→` to cycle toolbar. Tap `Space` to equip weapon. Tap `S` / `↓` to return to Movement.
   * **Step 3 — Aim & Fire (`AIM_FIRE`)**: `W` / `S` or `↑` / `↓` (or Gyro Pitch tilt) to adjust aim angle. **Hold `Space`** to charge launch power meter $\rightarrow$ **Release `Space`** to FIRE!
   * **Re-Center Calibration**: `KeyC` (letter C).
   * **Settings Overlay**: `ESC` or floating gear icon `⚙️`.

2. **PC Mode** (Mouse + Keyboard):
   * `WASD` / Arrow keys to walk, mouse cursor to aim cannon angle, click or hold `Space` to charge launch power meter and fire!

---

## ⚙️ Game Features & Mechanics

1. **Offscreen Pixel-Mask Destructible Terrain**:
   * True 2D circular crater carving using `destination-out` composite blending on an offscreen terrain canvas.
   * Fixed geological layers: Grass green (`#15803d`), Dirt brown (`#78350f`), Stone grey (`#64748b`), Bedrock dark charcoal (`#1c1917`), and Sand dunes golden yellow (`#f59e0b`).
   * Sand slumping physics into adjacent craters.
   * Bottom Water layer (`waterY`): Falling into water causes drowning and instant defeat for that unit.
2. **Arsenal**:
   * 🚀 **Bazooka**: Wind-affected heavy explosive missile.
   * 💣 **Grenade**: Bouncing projectile with 3-second fuse timer.
   * 💥 **Cluster Bomb**: Splits into 5 mini-bombs on impact.
   * 🧪 **Acid Bomb**: Spawns acid particles that dissolve terrain layers.
   * ⏳ **Sand Bomb**: Generates a new sand dune mound on impact.
   * 🌀 **Portal Gun**: Deploys an Orange or Blue portal pair on terrain surfaces to warp incoming projectiles and worms.
   * 🔫 **Shotgun**: Direct line-of-sight double shot.
3. **Trajectory Sighting Arc**:
   * Dotted ballistic arc preview projected in real time from cannon tip, calculated using current aim angle, charge power, gravity, and wind vector.
4. **Dynamic Wind Vector**:
   * Wind direction and speed update every turn, affecting Bazooka and Cluster bomb trajectories.
5. **Smart Tactical AI**:
   * Single-player bot target solver (`easy`, `normal`, `hard` difficulty levels) using inverse parabolic trajectory math.
6. **Fixed 30 FPS Lock**:
   * Game loop simulation locked at `1000/30` ms tick rate for consistent physics across all hardware.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | Canvas container, back button to main hub, styling. |
| [`src/main.ts`](src/main.ts) | Game orchestrator, 30 FPS tick loop, 3-step turn state machine, input handling. |
| [`src/terrain/terrainManager.ts`](src/terrain/terrainManager.ts) | Offscreen pixel-mask terrain engine, Bezier curve surface generation, crater carving, water/acid/sand physics, portal rendering. |
| [`src/entities/worm.ts`](src/entities/worm.ts) | Worm unit physics, walking, jumping, terrain collision, health bar, team colors. |
| [`src/physics/projectile.ts`](src/physics/projectile.ts) | Projectile simulation, wind force, gravity, portal warping, explosion damage & knockback. |
| [`src/ai/wormAI.ts`](src/ai/wormAI.ts) | Tactical AI trajectory calculation and difficulty levels. |
| [`src/ui/hud.ts`](src/ui/hud.ts) | Glassmorphism HUD, turn phase banner, trajectory arc preview, power meter, weapon selector toolbar. |
| [`src/types.ts`](src/types.ts) | Type interfaces for turn phases, materials, weapons, portals, and particles. |

---

## 🚀 How to Run

1. Launch dev server from root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/wormix/index.html`
