# 🎮 GyroMouse Games Ecosystem — Roadmap & Recommendations

## 🏓 5. 3D Cyber Air Hockey / Cyber Pong (`games/cyber_pong`)

### 🔍 Deep Code Inspection
* **Physics Engine ([`games/cyber_pong/src/physics/PhysicsWorld.ts`](file:///g:/programming/GyroMouse_games/games/cyber_pong/src/physics/PhysicsWorld.ts))**: 2.5D planar physics locked to $Y = 0$. Paddle collisions reflect puck angle based on point-of-impact offset.
* **AI Bot Controller ([`games/cyber_pong/src/ai/BotController.ts`](file:///g:/programming/GyroMouse_games/games/cyber_pong/src/ai/BotController.ts))**: Calculates reactive target $Z$-intercept with lerp speeds across 3 difficulties (Easy: 4.5, Medium: 8.5, Hard: 15.0).
* **Game Manager ([`games/cyber_pong/src/game/PongGame.ts`](file:///g:/programming/GyroMouse_games/games/cyber_pong/src/game/PongGame.ts))**: 1P vs AI & 2P local split-keyboard modes, brick shield generation, 10-point victory match target.

### 🛠️ Top Recommended Changes for Cyber Air Hockey
1. **[Gameplay] Central Arena Power-Up Capsules**: Spawning multi-puck, speed boost, or barrier wall on brick destruction.
2. **[AI Bot] Predictive Bank Shot Strategy**: Hard AI calculating multi-wall reflection paths.
3. **[Visuals] Reactive Floor Neon Ripple Waves**: Propagating ripple waves on floor grid upon puck impacts.

---

## 🐛 6. Wormix Elemental Artillery (`games/wormix`)

### 🔍 Deep Code Inspection
* **Destructible Terrain ([`games/wormix/src/terrain/terrainManager.ts`](file:///g:/programming/GyroMouse_games/games/wormix/src/terrain/terrainManager.ts))**: Offscreen pixel mask rendering 8 material layers with procedural Perlin cave generation.
* **Physics Simulation ([`games/wormix/src/physics/physicsEngine.ts`](file:///g:/programming/GyroMouse_games/games/wormix/src/physics/physicsEngine.ts))**: 30 FPS locked simulation tick for projectile ballistics, wind drift, fluid particle settling, and crater deformation.
* **AI Bot Controller ([`games/wormix/src/ai/wormAI.ts`](file:///g:/programming/GyroMouse_games/games/wormix/src/ai/wormAI.ts))**: Simulates 32 angle/power ballistic candidate arcs targeting nearest opponent.

### 🛠️ Top Recommended Changes for Wormix
1. **[AI Bot] Trapped Bot Utility Recovery**: AI bot evaluates Teleport / Jetpack when stuck in deep craters.
2. **[Gameplay] Environmental Events**: Turn-based weather events (Acid Rain, Meteor Showers).
3. **[UI/UX] Fast Radial Weapon Selector (`KeyQ`)**: Circular weapon selection wheel.
4. **[UX] Sudden Death Flood Siren & Warning Banner**: Audio/visual alert 1 turn before water rises.

---

## 🗡️ 7. Void Dungeon (`games/void_dungeon`)

### 🔍 Deep Code Inspection
* **Visibility Raycaster ([`games/void_dungeon/src/visibility.ts`](file:///g:/programming/GyroMouse_games/games/void_dungeon/src/visibility.ts))**: 2D raycasting torch light cone and ambient shadow illumination.
* **Enemy AI ([`games/void_dungeon/src/enemyManager.ts`](file:///g:/programming/GyroMouse_games/games/void_dungeon/src/enemyManager.ts))**: 8 patrolling shadow phantoms with health bars, line-of-sight auto-aim snapping in 90° vision cone.
* **Dungeon Generator ([`games/void_dungeon/src/dungeon_gen.ts`](file:///g:/programming/GyroMouse_games/games/void_dungeon/src/dungeon_gen.ts))**: Seeded procedural room and corridor BSP generator.

### 🛠️ Top Recommended Changes for Void Dungeon
1. **[Gameplay] Interactive Floor Traps**: Spike traps, pressure plates, and teleport pads.
2. **[UI/UX] Sonar Audio Ping Feedback**: Audio cue and radar ring when revealing hidden keys/doors.
3. **[Feature / UX] Seed Input & Level Summary Card**: Text seed entry and end-of-floor exploration stats.
