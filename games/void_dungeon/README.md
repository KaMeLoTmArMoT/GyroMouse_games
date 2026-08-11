# 🗡️ Void Dungeon — Co-op Top-Down Dungeon Crawler

**Void Dungeon** is a 2D pixel-art cooperative top-down dungeon crawler built with TypeScript and HTML5 Canvas 2D. Designed for dual-player collaboration (or single-player multi-input testing), **Player 1 controls movement**, while **Player 2 controls vision and aim direction**.

---

## 🎮 Controls & Inputs

### Player 1 (Movement & Physical Interaction)
* `W` / `A` / `S` / `D` — Move character in 8 directions with wall collision sliding.
* `Space` — Primary action: Pick up keys, push movable boxes, interact with objects.

### Player 2 (Vision, Aiming & Pulse)
* `Arrow Keys` — Rotate aim direction in 8 discrete angles (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`).
* `Enter` / `Right Shift` — Sonar Pulse action: Temporarily expands vision cone to 180° wide and 14 tiles deep for ~1.5 seconds.

---

## 🔑 Goal & Gameplay Flow

1. **Explore procedural dungeon rooms**: Navigate varied room shapes (**Rectangular**, **Oval/Circular**, **Diamond/Hexagonal**, and **Cross-shaped**).
2. **Collect 3 Keys**: Find the **🔴 Red**, **🔵 Blue**, and **🟢 Green** keys scattered across distant rooms.
3. **Unlock Exit Door**: Once all 3 keys are collected, the locked exit door unlocks (`TileType.EXIT_OPEN`).
4. **Escape the Void**: Step onto the opened exit door to trigger victory and proceed to the next dungeon level!

---

## ⚙️ Debug & Viewing Modes (`Alt + Number`)

Toggle game modes dynamically using `Alt` key shortcuts:

| Hotkey | Mode Description | Behavior |
| --- | --- | --- |
| `Alt + 1` | **Normal Gameplay Mode** | Standard Fog of War active (unseen = black, revealed = 65% dark memory, visible = lit). |
| `Alt + 2` | **Reveal All Map Mode** | Toggles Fog of War OFF, displaying the entire BSP dungeon in bright color. |
| `Alt + 3` | **Grid Overlay Mode** | Toggles 32×32 pixel tile grid lines and tile coordinates overlay `(x, y)`. |
| `Alt + 4` | **Key & Exit ESP Mode** | Draws marker indicators showing all 3 keys and exit location through fog/walls. |

---

## 🧱 Architecture & Code Structure

```
games/void_dungeon/
├── index.html              # Game entry point, key slots HUD & victory modal layout
├── README.md               # Game documentation
└── src/
    ├── main.ts             # Main game loop, key pickup callbacks & state persistence
    ├── types.ts            # TileType enums, 8-direction vectors, state interfaces
    ├── input.ts            # DungeonInputManager wrapping SharedInputManager
    ├── player.ts           # Player entity, movement lerp, key pickup & win callback
    ├── level.ts            # Tile grid data structure & bounding box collision checks
    ├── entities.ts         # Key entities, floating animation & pixel key renderer
    ├── dungeon_gen.ts      # BSP procedural generator with shape variations (oval, diamond, cross)
    ├── visibility.ts       # Raycasted shadowcasting fog of war & vision cone system
    ├── renderer.ts         # Canvas 2D renderer, dark fog, key graphics & ESP overlays
    ├── style.css           # Pixel-art canvas styling, key slot badges & victory modal
    └── utils/
        └── seedrandom.ts   # Seeded random number generator (FNV-1a hash + LCG)
```

---

## 🛠️ Level Editor & JSON Map Loading (`Key E`)

Press `E` or click **`🛠️ Level Editor`** in the HUD to enter real-time edit mode:
- **Tile Palette**: Paint `Wall`, `Floor`, `Hole`, `Box/Crate`, `Red Key`, `Blue Key`, `Green Key`, `Spawn`, `Exit`.
- **JSON Export (`💾 Export JSON`)**: Export custom level layout, entities, spawn, and exit points into a `.json` map file.
- **JSON Import (`📂 Import JSON`)**: Import custom `.json` map files to play user-created dungeons instantly.

---

## 🔮 Game Features & Mechanics

1. **BSP Procedural Dungeon Generation**: Generates varied dungeons with interconnected rooms of multiple architectural shapes (**Oval**, **Diamond**, **Cross**, **Rectangle**) using seeded randomness (`DungeonGenerator.generate(width, height, seed)`).
2. **Movable Boxes & Pitfall Puzzles**: Push crates (`Space` key) into pitfall `HOLE` tiles to fill gaps and bridge paths to keys.
3. **Ambient Torch Lighting & Flashlight Dust Motes**:
   - **Soft Radial Fog Gradients**: Smooth radial opacity gradients replace sharp tile cutoffs.
   - **Flickering Room Torches**: Wall-mounted torches illuminate rooms with animated warmth radii.
   - **Drifting Dust Motes**: Floating dust particles drift softly in air currents and glow inside the flashlight vision cone.
4. **Top-Right Tactical Minimap**: Displays explored rooms, player position, keys, crates, holes, and exit door in real time.
5. **Key Collection & Exit Unlock**: 3 colored keys (**Red**, **Blue**, **Green**) spawn in distant rooms with floating animations, HUD slot tracking, and automatic door unlocking.
6. **3-Second Hold Map Regenerate**: Requires holding the reset button for 3 full seconds with progress bar fill to avoid accidental level resets.
7. **F5 State Persistence**: Automatically persists current level seed, player tile position, crates, collected keys, revealed fog map, and mode settings into `sessionStorage`. Reloading (`F5`) restores exact game state.
8. **Settings & Overlay Integration**: Press `Esc` or click the `⚙️` icon to adjust control modes and settings via `SettingsOverlay`.
