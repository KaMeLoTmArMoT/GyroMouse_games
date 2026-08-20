# 🏃‍♂️ 3D Subway Runner

An endless 3D obstacle runner game built with **Three.js** inspired by Subway Surfers. Features procedural chunk-based track spawning, coins, trains, low/high hurdle barriers, and synthesized sound FX.

---

## 🕹️ Controls & Gameplay

| Action | Control Keys | Description |
|---|---|---|
| **Steer Left** | `ArrowLeft` / `A` | Switch to the left lane |
| **Steer Right** | `ArrowRight` / `D` | Switch to the right lane |
| **Jump** | `ArrowUp` / `W` | Leap over low hurdles & low barriers |
| **Slide / Crawl** | `ArrowDown` / `S` | Duck under high overhead arches & drop fast from air |
| **Pause** | `ESC` | Pause / resume game & show menu |

---

## 🎨 Visuals & Obstacle Mechanics

### 🧱 Obstacle & Element Types
1. **🚈 Trains & Convoys**: Tall red train cars occupying a full lane. Spawn as single cars or 2–3 car linked convoys with roof coin paths.
2. **🛹 Launch Ramps**: Sloped ramps before train convoys with glowing chevron arrows allowing seamless running onto train roofs.
3. **⬆️ Low Hurdles (Jump over)**: Ground-level orange hurdles topped with glowing red warning strips (`height = 0.5m`). Cannot be crawled under!
4. **⬇️ High Hurdles / Arches (Slide under)**: Overhead arches (`height clearance = 1.1m`) featuring purple banners with **glowing neon arrows pointing DOWN**, making it immediately clear that you must slide.
5. **🪙 Gold Coins**: Collectible gold rings placed along ground lanes and train roofs.
6. **🎁 Collectible Power-Ups**:
   - 🧲 **Magnet (10s)**: Pulls all coins in a 9m radius directly to the runner.
   - 🛡️ **Shield**: Surrounds the runner with a glowing energy bubble that absorbs 1 collision.
   - 🚀 **Jetpack (6s)**: Launches the player into the sky ($Y=6.0\text{m}$) above all obstacles.
7. **⚠️ Stumble Grace System**: Side-swiping or bumping an obstacle triggers a 7-second blinking grace state; only a second consecutive mistake during this window ends the run.

### 🌟 Graphics Features
- **Lighting & Shadows**: Directional sun with soft PCF shadow maps + cyber-blue ambient fill.
- **Atmosphere**: Exponential depth fog fading into a stylized city skyline.
- **FX**: Speed particle streaks that re-cycle as you run forward.

---

## 📁 File Map

| File | Role & Features |
| :--- | :--- |
| [`index.html`](index.html) | HTML container, HUD score/coins overlay, start/pause/gameover modals. |
| [`src/main.ts`](src/main.ts) | Game orchestrator, keyboard event listeners, ESC pause state, frame loop. |
| [`src/game/runner.ts`](src/game/runner.ts) | Player character 3D mesh, lane transition physics, jump & slide crouching. |
| [`src/game/trackManager.ts`](src/game/trackManager.ts) | Procedural 40m track chunk spawner, train/hurdle/coin generators, recycling behind camera. |
| [`src/game/collisionManager.ts`](src/game/collisionManager.ts) | 3D bounding box intersection logic for hurdle clearances, train crashes & coin pickups. |
| [`src/graphics/sceneManager.ts`](src/graphics/sceneManager.ts) | Three.js scene setup, smooth tracking camera, speed particles & directional light follow. |
| [`src/audio/soundFX.ts`](src/audio/soundFX.ts) | Synthesized Web Audio API sound effects for jump, slide, coin collect, and crash. |
| [`../../../shared/settingsOverlay.ts`](../../../shared/settingsOverlay.ts) | In-game settings modal (`⚙️` icon / `ESC`) with Control Mode, Sensitivity & Invert X/Y stored in `localStorage`. |

---

## 🚀 How to Run

1. Launch Vite dev server in project root:
   ```bash
   npm run dev
   ```
2. Open in browser: `http://localhost:5173/games/subway_runner/index.html`
