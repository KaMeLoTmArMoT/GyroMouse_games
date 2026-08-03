# AGENTS.md

## Commands

| Task                        | Command            |
| -----------------------------| --------------------|
| Dev server (LAN, port 5173) | `npm run dev`      |
| Build (typecheck + bundle)  | `npm run build`    |
| Preview production build    | `npm run preview`  |
| Type-check only             | `npx tsc --noEmit` |
| Lint check (Biome)          | `npm run lint`     |
| Format codebase (Biome)     | `npm run format`   |

## Rules
Do not run `npm run build` or `npm run dev` if i don't ask for it.
STRICTLY FORBIDDEN: NEVER add mouse movement/cursor tilt controls (e.g. `mouseEnabled`, `pointermove` for game steering) to games unless explicitly requested. Controls must remain strictly keyboard-driven (WASD / Arrow keys / Space).

## Testing & Validation
No test runner configured — validate changes manually via `npm run dev` and visual check in browser.

## Gotchas
- Rapier3D physics requires `setSleeping(false)` on marble body or it freezes on low input.
- Re-Center calibration hotkey is `KeyC` (letter `C`). Do NOT assign `Space` for calibration as it's used in games (firing/dropping cargo).

## Structure

- **Vite multi-page app** — entry points: `/index.html` (hub), `games/marble_maze/index.html` (game), `games/subway_runner/index.html` (game), `games/crane_tower/index.html` (game), `games/artillery_siege/index.html` (game), `games/cyber_pong/index.html` (game), `games/wormix/index.html` (game)
- **Not an npm workspaces monorepo** — `shared/` is imported via relative paths from inside `games/`

## Architecture

- **Physics tilt** is applied via gravity vector rotation on Rapier3D (not board rotation). The marble body has `setSleeping(false)` to avoid freezing.
- **Input system**: Centralized `SharedInputManager` (`shared/inputManager.ts`).
  - Listens to WASD / Arrow keys with `blur` cleanup listener to prevent stuck keys.
  - Automatically connects to GyroMouse WebSocket server at `ws://127.0.0.1:5006` (with auto-reconnect).
  - Supports `GyroInputState`, zero-point calibration (`reCenter()` via `KeyC` or `calibrate` payload button), and normalized steering extraction (`getSteeringValue()`).
- **Settings Overlay**: `SettingsOverlay` (`shared/settingsOverlay.ts`, `shared/settingsOverlay.css`).
  - Opens on `ESC` key or floating `⚙️` gear icon. Auto-saves settings (`mode`, `sensitivity`, `invertX`, `invertY`) to `localStorage` (`gyromouse_settings_<game_id>`).
- **2D Menu Grid Navigation**: `MenuNav` (`shared/menuNav.ts`).
  - Navigates elements spatially in 2D grid space (`Up`/`Down`/`Left`/`Right`) using bounding client rects.
- **Audio muted by default**: `SharedAudioManager.isMuted = true`
- **Seeded randomness**: `SeededRandom` (FNV hash + LCG) for reproducible mazes

## Cyber Air Hockey Controls (STRICT)

- **Player 1 (Left Paddle / Blue)**: `W` / `S` OR `Up` / `Down` Arrow keys
- **Player 2 (Right Paddle / Red)**: `A` / `D` OR `Left` / `Right` Arrow keys
