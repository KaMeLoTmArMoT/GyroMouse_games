# 🔮 3D Marble Maze

An interactive 3D physics marble maze game controlled by tilting your smartphone via **GyroMouse** air-mouse or using keyboard arrow keys / WASD.

---

## 🤝 Handoff / Current State (Теперішній стан)

> **Status:** Fully functional & verified. 0 TypeScript compilation errors. Running via `npm run dev`.

### 📍 На чому зупинилися:
- **Вигляд камери:** 100% Top-Down (прямо зверху 90°) для максимальної точності огляду мапи та контролю кулі.
- **Фізика та підлога (Rapier3D):**
  - Підлога статична, нахил реалізовано через математичне обертання вектора гравітації $\vec{g}$.
  - М'яч **НЕ провалюється** і **НЕ підкидається** при нахилах дошки.
  - Кулька прикріплена всередину 3D-групи дошки (`boardGroup.add(marbleMesh)`), тому візуально вона 100% синхронізована з поверхнею.
- **Круглі ями (Holes):**
  - Ями зроблені круглими циліндрами ($r = 0.5\,\text{м}$) із червоним застережним обідком у центрі клітинки.
  - Навколо ями збережено $0.95\,\text{м}$ проходу підлоги, тому кульку ($r = 0.35\,\text{м}$) можна акуратно провести вільними краями коридору.
- **Керування та осі:**
  - **Клавіатура (За замовчуванням):** WASD / Стрілочки з плавною інтерполяцією (Lerp factor = `dt * 4.0`, Max Tilt = $12^\circ$).
    - `W` / `Up`: нахил переднього краю донизу $\rightarrow$ кулька котиться **вперед**.
    - `S` / `Down`: нахил ближнього краю донизу $\rightarrow$ кулька котиться **назад**.
    - `A` / `Left`: нахил лівого краю донизу $\rightarrow$ кулька котиться **ліворуч**.
    - `D` / `Right`: нахил правого краю донизу $\rightarrow$ кулька котиться **праворуч**.
  - **Миша ПК:** Відстеження курсора миші **вимкнено за замовчуванням** (`mouseEnabled: false`), щоб рух миші на ПК не заважав. Перемикач є у вікні налаштувань (`⚙️ Settings`).
- **Аудіо:** Вимкнено за замовчуванням (`isMuted: true`).

---

## 📁 Карта файлів підмодуля

| Файл | Роль та функціонал |
| :--- | :--- |
| [`src/main.ts`](file:///g:/programming/GyroMouse_games/games/marble_maze/src/main.ts) | Точка входу: оркестрація ігрового циклу, physics step, render loop, HUD updates. |
| [`src/physics/physicsManager.ts`](file:///g:/programming/GyroMouse_games/games/marble_maze/src/physics/physicsManager.ts) | **Rapier3D physics:** Статичні колайдери підлоги, циліндричні сенсори ям, розрахунок вектора гравітації $\vec{g}$. |
| [`src/graphics/sceneManager.ts`](file:///g:/programming/GyroMouse_games/games/marble_maze/src/graphics/sceneManager.ts) | **Three.js graphics:** 100% top-down camera, матеріали (Асфальт, Лід, Пісок), рендеринг круглих ям та монет. |
| [`src/maze/mazeGenerator.ts`](file:///g:/programming/GyroMouse_games/games/marble_maze/src/maze/mazeGenerator.ts) | **DFS генератор:** Створення сітки рівнів, розстановка монет, круглих ям та покриттів. |
| [`src/ui/hudManager.ts`](file:///g:/programming/GyroMouse_games/games/marble_maze/src/ui/hudManager.ts) | **UI HUD:** Таймер, монети, бейдж покриття, сід-код, модалки налаштувань/перемоги/падіння. |
| [`../../../shared/inputManager.ts`](file:///g:/programming/GyroMouse_games/shared/inputManager.ts) | **Спільний ввід:** Обробка WASD/стрілочок та GyroMouse air-mouse з плавною інтерполяцією. |
| [`../../../shared/audioManager.ts`](file:///g:/programming/GyroMouse_games/shared/audioManager.ts) | **Спільне аудіо:** Web Audio API синтезатор звуків (muted by default). |

---

## 🚀 Як запустити

1. Запустіть сервер у корені `GyroMouse_games`:
   ```bash
   npm run dev
   ```
2. Відкрийте у браузері: `http://localhost:5173/games/marble_maze/index.html`
