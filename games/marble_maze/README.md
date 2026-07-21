# 🔮 3D Marble Maze

An interactive 3D physics marble maze game controlled by tilting your smartphone via **GyroMouse** air-mouse or using keyboard arrow keys / WASD.

---

## 🤝 Handoff / Current State

> **Status:** Fully functional & verified. 0 TypeScript compilation errors. Running via `npm run dev`.

### 📍 Поточний стан:

#### 🎨 Тематичні біоми (Themes & Biomes)
Кожен рівень випадково отримує одну з трьох тем із власними покриттями, освітленням та туманом:

| Тема | Основне | Вторинне | Третинне | Атмосфера |
|---|---|---|---|---|
| ❄️ **Winter** | Snow (норм.) | Ice (надслизько) | Asphalt | Крижано-синій туман |
| 🏙️ **City** | Asphalt (норм.) | Dirt/Mud (повільно) | Cobblestone | Сутінкове міське |
| 🌿 **Forest** | Grass (норм.) | Dirt/Mud (повільно) | Path/Asphalt | Смарагдовий ліс |

Покриття генеруються **органічними кластерами** (Voronoi seed clustering), а не суцільним рандомом.

#### 🕳️ Ями (Holes)
- **Три розміри:** Малі ($r = 0.35\text{ м}$), Середні ($r = 0.48\text{ м}$), Великі ($r = 0.62\text{ м}$).
- **Варіативне розташування:** Центр, Кути, Боки клітинки.
- **Фізика:** Програш спрацьовує лише коли кулька **фізично провалюється** нижче рівня підлоги (`translation.y < -0.35`). Без штучних магнітів, без миттєвих тригерів при дотику до краю.

#### 🎮 Фізика (Rapier3D)
- Підлога статична; нахил — через математичне обертання $\vec{g}$.
- **Сон (Sleep) вимкнено:** `setSleeping(false)` + `wakeUp()` при зміні нахилу — кулька ніколи не "застигає" через Rapier sleep.
- **Тертя за покриттями:**

| Покриття | Тертя | Ефект |
|---|---|---|
| Ice | 0.03 | Надслизько |
| Cobblestone | 0.35 | Гладко |
| Snow / Asphalt / Path | 0.45 | Стандарт |
| Grass | 0.65 | М'який опір |
| Sand / Dirt | 0.90–0.95 | Різко гальмує |

#### ⌨️ Ввід (InputManager)
- Слухає **обидва** `e.code` та `e.key` — сумісний з реальною клавіатурою, `pyautogui`, Chrome Extension `dispatchEvent` (де `e.code` може бути порожнім).
- `window.blur` → `keysPressed.clear()` — клавіші **не залипають** при відкритті F12 / Alt+Tab.
- За замовчуванням: `mode: 'keyboard'`, `mouseEnabled: false` (вмикається в ⚙️ Settings).
- **Аудіо:** Вимкнено за замовчуванням (`isMuted: true`).

---

## 📁 Карта файлів підмодуля

| Файл | Роль та функціонал |
| :--- | :--- |
| [`src/main.ts`](src/main.ts) | Точка входу: ігровий цикл, physics step, render loop, HUD updates. |
| [`src/physics/physicsManager.ts`](src/physics/physicsManager.ts) | **Rapier3D:** Колайдери підлоги, сенсори ям, гравітаційний вектор $\vec{g}$, sleep-fix. |
| [`src/graphics/sceneManager.ts`](src/graphics/sceneManager.ts) | **Three.js:** Top-down камера, матеріали всіх 7 типів покриттів, атмосфера біому, рендер ям. |
| [`src/maze/mazeGenerator.ts`](src/maze/mazeGenerator.ts) | **DFS генератор:** Теми, органічні біомні кластери, конфіги ям (`HoleConfig`). |
| [`src/ui/hudManager.ts`](src/ui/hudManager.ts) | **HUD:** Таймер, монети, бейдж покриття (7 типів + іконки), сід, модалки. |
| [`../../../shared/inputManager.ts`](../../../shared/inputManager.ts) | **Ввід:** WASD/стрілочки + GyroMouse. `e.code`+`e.key` fix. `blur`-clear fix. |
| [`../../../shared/audioManager.ts`](../../../shared/audioManager.ts) | **Аудіо:** Web Audio API синтезатор звуків (muted by default). |

---

## 🚀 Як запустити

1. Запустіть сервер у корені `GyroMouse_games`:
   ```bash
   npm run dev
   ```
2. Відкрийте у браузері: `http://localhost:5173/games/marble_maze/index.html`
