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

## ⚙️ Debug & Viewing Modes (`Alt + Number`)

Toggle game modes dynamically using `Alt` key shortcuts:

| Hotkey | Mode Description | Behavior |
| --- | --- | --- |
| `Alt + 1` | **Normal Gameplay Mode** | Standard Fog of War active (unseen = black, revealed = 65% dark memory, visible = lit). |
| `Alt + 2` | **Reveal All Map Mode** | Toggles Fog of War OFF, displaying the entire BSP dungeon in bright color. |
| `Alt + 3` | **Grid Overlay Mode** | Toggles 32×32 pixel tile grid lines and tile coordinates overlay `(x, y)`. |
| `Alt + 4` | **Key & Exit ESP Mode** | Draws marker indicators showing exit location through fog/walls. |

---

## 🧱 Architecture & Code Structure

```
games/void_dungeon/
├── index.html              # Game entry point & glassmorphic HUD layout
├── README.md               # Game documentation
└── src/
    ├── main.ts             # Main game loop, settings overlay integration & state persistence
    ├── types.ts            # TileType enums, 8-direction vectors, state interfaces
    ├── input.ts            # DungeonInputManager wrapping SharedInputManager
    ├── player.ts           # Player entity, movement lerp, aim indicator & vision cone preview
    ├── level.ts            # Tile grid data structure & bounding box collision checks
    ├── dungeon_gen.ts      # Procedural BSP (Binary Space Partitioning) dungeon generator
    ├── visibility.ts       # Raycasted shadowcasting fog of war & vision cone system
    ├── renderer.ts         # Canvas 2D renderer, camera tracking, dark fog & debug overlays
    ├── style.css           # Pixel-art canvas styling & glassmorphism HUD card layout
    └── utils/
        └── seedrandom.ts   # Seeded random number generator (FNV-1a hash + LCG)
```

---

## 🔮 Game Features & Mechanics

1. **BSP Procedural Dungeon Generation**: Generates varied dungeons with interconnected rooms and corridors using seeded randomness (`DungeonGenerator.generate(width, height, seed)`).
2. **Raycasted Shadowcasting Fog of War**:
   - **Omni-vision**: 2.5 tiles immediate surrounding area always lit.
   - **90° Forward Cone**: Casts ray paths up to 8 tiles away along aim direction. Opaque walls block light propagation.
   - **Memory**: Previously visited tiles remain visible in grayed/desaturated memory.
3. **F5 State Persistence**: Automatically persists current level seed, player tile position, revealed fog map, and mode settings into `sessionStorage`. Reloading (`F5`) restores the exact game state.
4. **Settings & Overlay Integration**: Press `Esc` or click the `⚙️` icon to adjust control modes and settings via `SettingsOverlay`.
