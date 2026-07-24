# 🏓 3D Cyber Air Hockey (Cyber Pong)

A 3D cyberpunk air-hockey & brick breaker fusion built with **Three.js**, **Rapier3D physics**, and Web Audio sound synthesis. Supports 1-Player vs AI Bot (3 difficulties) and 2-Player local co-op/versus modes.

---

## 🕹️ Controls & Gameplay

### Controls (Strict Keyboard Input)

| Player | Up / Move Up | Down / Move Down |
| :--- | :--- | :--- |
| **Player 1 (Blue / Left Paddle)** | `W` or `ArrowUp` | `S` or `ArrowDown` |
| **Player 2 (Red / Right Paddle)** | `A` or `ArrowLeft` | `D` or `ArrowRight` |

* **Pause / Menu:** `ESC` or `Space`
* **Start Game / Reset:** `Space`

---

## ⚙️ Game Features & Mechanics

1. **Brick Wall Shields:** Each player protects a wall of 6 neon energy bricks. Clearing opponent's bricks expands your paddle width dynamically (up to 1.8x).
2. **AI Bot (1-Player Mode):** 3 difficulty settings (`easy`, `medium`, `hard`) with predictive target tracking, reaction lag, and error margins.
3. **Rally Speedup:** Puck speed escalates progressively during long rallies to keep matches fast-paced.
4. **Pause & Keyboard Navigation:** Full `MenuNav` keyboard navigation (`WASD`/`Arrows` + `Space` selection) in pause & game over screens.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | Canvas container, glassmorphism HUD, start modal, settings & pause overlays. |
| [`src/main.ts`](src/main.ts) | Game orchestrator extending `BaseGame`, handling match flow, scoring & input. |
| [`src/graphics/ArenaRenderer.ts`](src/graphics/ArenaRenderer.ts) | Three.js scene, neon bloom arena, glowing paddle/puck meshes, dynamic particle trails. |
| [`src/physics/PhysicsWorld.ts`](src/physics/PhysicsWorld.ts) | Rapier3D rigid body physics, kinematic paddles, dynamic puck reflection & brick destruction. |
| [`src/ai/AIBotController.ts`](src/ai/AIBotController.ts) | Autonomous opponent AI with trajectory extrapolation & reaction speed curves. |
| [`../../../shared/settingsOverlay.ts`](../../../shared/settingsOverlay.ts) | In-game settings modal (`⚙️` icon / `ESC`) with Control Mode, Sensitivity & Invert X/Y stored in `localStorage`. |

---

## 🚀 How to Run

1. Launch dev server from root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/cyber_pong/index.html`
