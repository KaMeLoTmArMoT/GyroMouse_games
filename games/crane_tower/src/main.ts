import { SharedInputManager } from '../../../shared/inputManager';
import { SharedAudioManager } from '../../../shared/audioManager';
import { CranePhysicsManager } from './physics/cranePhysics';
import { CraneGraphicsManager } from './graphics/craneGraphics';
import { CraneGameLogic } from './game/craneGameLogic';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Canvas element not found!');
    return;
  }

  // 1. Initialize Audio & Input Managers
  const audio = new SharedAudioManager();
  const input = new SharedInputManager();
  input.settings.mode = 'keyboard'; // Dual split keyboard / gyromouse

  // 2. Initialize Physics & Graphics
  const physics = new CranePhysicsManager();
  await physics.init();

  const graphics = new CraneGraphicsManager(canvas);
  graphics.init();

  // 3. Initialize Game Logic
  const game = new CraneGameLogic(physics, graphics, audio);
  game.startLevel(1);

  // 4. Main Game Loop
  let lastTime = performance.now();

  function animate(now: number) {
    requestAnimationFrame(animate);

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Update Input
    input.update(dt);

    // Read dual-axis inputs continuously (Player 1 Y = Up/Down, Player 2 X = Left/Right)
    let inputX = 0;
    let inputY = 0;

    const keys = (input as unknown as { keysPressed: Set<string> }).keysPressed;
    if (keys) {
      if (keys.has('KeyD') || keys.has('ArrowRight')) inputX += 1.0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) inputX -= 1.0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) inputY += 1.0;
      if (keys.has('KeyS') || keys.has('ArrowDown')) inputY -= 1.0;
    }

    // Combine with gyro/mouse if active
    if (Math.abs(input.normalizedDx) > 0.05) inputX += input.normalizedDx;
    if (Math.abs(input.normalizedDy) > 0.05) inputY -= input.normalizedDy;

    // Clamp input range [-1, 1]
    inputX = Math.max(-1.0, Math.min(1.0, inputX));
    inputY = Math.max(-1.0, Math.min(1.0, inputY));

    // Check magnet active state (Space key or UI drop button)
    const isMagnetActive = Boolean(keys && keys.has('Space'));

    // Update Crane Hook movement
    if (game.state === 'PLAYING' || game.state === 'COUNTDOWN') {
      physics.updateCranePosition(inputX, inputY, dt, isMagnetActive);
    }

    // Step Physics
    physics.step(dt);

    // Update Game Rules & Countdown
    game.update(dt);

    // Sync 3D Graphics
    graphics.syncGraphics(physics);
    graphics.render();
  }

  requestAnimationFrame(animate);
}

main().catch((err) => {
  console.error('Failed to initialize 3D Crane Tower:', err);
});
