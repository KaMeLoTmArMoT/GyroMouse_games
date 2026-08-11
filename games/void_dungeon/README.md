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

## 🔮 Game Features & Mechanics

1. **BSP Procedural Dungeon Generation**: Generates varied dungeons with interconnected rooms of multiple architectural shapes (**Oval**, **Diamond**, **Cross**, **Rectangle**) using seeded randomness (`DungeonGenerator.generate(width, height, seed)`).
2. **Key Collection & Exit Unlock**: 3 colored keys (**Red**, **Blue**, **Green**) spawn in distant rooms with floating animations, HUD slot tracking, and automatic door unlocking.
3. **Raycasted Shadowcasting Fog of War**:
   - **Omni-vision**: 2.5 tiles immediate surrounding area always lit.
   - **90° Forward Cone**: Casts ray paths up to 8 tiles away along aim direction. Opaque walls block light propagation.
   - **Memory**: Previously visited tiles remain visible in grayed/desaturated memory.
4. **F5 State Persistence**: Automatically persists current level seed, player tile position, collected keys, revealed fog map, and mode settings into `sessionStorage`. Reloading (`F5`) restores the exact game state.
5. **Settings & Overlay Integration**: Press `Esc` or click the `⚙️` icon to adjust control modes and settings via `SettingsOverlay`.
