# AGENTS.md

## Commands

| Task                        | Command            |
| -----------------------------| --------------------|
| Dev server (LAN, port 5173) | `npm run dev`      |
| Build (typecheck + bundle)  | `npm run build`    |
| Preview production build    | `npm run preview`  |
| Type-check only             | `npx tsc --noEmit` |

## Rules
Do not run `npm run build` or `npm run dev` if i don't ask for it.

## Testing & Validation
No test runner configured — validate changes manually via `npm run dev` and visual check in browser.

## Gotchas
- `games/subway_runner/` referenced in hub but directory does not exist yet — don't assume it's buildable.
- Rapier3D physics requires `setSleeping(false)` on marble body or it freezes on low input.

## Structure

- **Vite multi-page app** — entry points: `/index.html` (hub), `games/marble_maze/index.html` (game)
- **Not an npm workspaces monorepo** — `shared/` is imported via relative paths from inside `games/`
- **`games/subway_runner/`** is a planned "Coming Soon" placeholder in the hub but does **not exist** as a directory yet

## Architecture

- **Physics tilt** is applied via gravity vector rotation on Rapier3D (not board rotation). The marble body has `setSleeping(false)` to avoid freezing.
- **Input dual-mode**: `SharedInputManager` handles both GyroMouse (cursor offset) and keyboard (WASD/arrows). A `blur` listener clears `keysPressed` to prevent stuck keys.
- **Audio muted by default**: `SharedAudioManager.isMuted = true`
- **Seeded randomness**: `SeededRandom` (FNV hash + LCG) for reproducible mazes
