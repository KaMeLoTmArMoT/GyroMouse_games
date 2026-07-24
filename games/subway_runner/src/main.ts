import { SceneManager } from './graphics/sceneManager';
import { Runner } from './game/runner';
import { TrackManager } from './game/trackManager';
import { CollisionManager } from './game/collisionManager';
import { RunnerSoundFX } from './audio/soundFX';
import { MenuNav } from '../../../shared/menuNav';
import { BaseGame } from '../../../shared/baseGame';
import { SettingsOverlay } from '../../../shared/settingsOverlay';

class SubwayRunnerGame extends BaseGame {
  private sceneManager!: SceneManager;
  private runner!: Runner;
  private trackManager!: TrackManager;
  private collisionManager!: CollisionManager;
  private soundFX!: RunnerSoundFX;
  private gameOverMenuNav!: MenuNav;
  private pauseMenuNav!: MenuNav;
  public settingsOverlay: SettingsOverlay;

  private isRunning: boolean = false;
  private lastTime: number = 0;

  private forwardSpeed: number = 14.0; // Increases over time
  private coinsCount: number = 0;
  private distance: number = 0;

  // UI Elements
  private scoreValEl = document.getElementById('score-val')!;
  private coinsValEl = document.getElementById('coins-val')!;
  private startScreenEl = document.getElementById('start-screen')!;
  private pauseScreenEl = document.getElementById('pause-screen')!;
  private gameoverScreenEl = document.getElementById('gameover-screen')!;
  private finalScoreEl = document.getElementById('final-score')!;
  private finalCoinsEl = document.getElementById('final-coins')!;

  constructor() {
    super();
    this.settingsOverlay = new SettingsOverlay({
      gameId: 'subway_runner',
      inputManager: this.input
    });
    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container);
    this.runner = new Runner(this.sceneManager.scene);
    this.trackManager = new TrackManager(this.sceneManager.scene);
    this.collisionManager = new CollisionManager();
    this.soundFX = new RunnerSoundFX();

    this.gameOverMenuNav = new MenuNav({ container: this.gameoverScreenEl });
    this.pauseMenuNav = new MenuNav({ container: this.pauseScreenEl });

    this.setupUI();
    this.animate(0);
  }

  protected override onSpace() {
    if (!this.isRunning && !this.isPaused) {
      this.startGame();
    } else if (this.isRunning) {
      this.togglePause();
    }
  }

  protected override onKeyDown(e: KeyboardEvent) {
    if (!this.isRunning || this.isPaused) return;

    const code = e.code;
    const key = e.key;

    const isLeft = code === 'ArrowLeft' || key === 'ArrowLeft' || code === 'KeyA' || key === 'a' || key === 'A';
    const isRight = code === 'ArrowRight' || key === 'ArrowRight' || code === 'KeyD' || key === 'd' || key === 'D';
    const isUp = code === 'ArrowUp' || key === 'ArrowUp' || code === 'KeyW' || key === 'w' || key === 'W';
    const isDown = code === 'ArrowDown' || key === 'ArrowDown' || code === 'KeyS' || key === 's' || key === 'S';

    if (isLeft) {
      this.runner.steer(-1);
    } else if (isRight) {
      this.runner.steer(1);
    } else if (isUp) {
      this.runner.jump();
      this.soundFX.playJump();
    } else if (isDown) {
      this.runner.slide();
      this.soundFX.playSlide();
    }
  }

  private setupUI() {
    this.startScreenEl.addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart')?.addEventListener('click', () => this.restartGame());
    document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePause(false));
  }

  public override togglePause(forceState?: boolean) {
    if (!this.isRunning) return;
    super.togglePause(forceState);

    if (this.isPaused) {
      this.pauseScreenEl.classList.remove('hidden');
      this.pauseMenuNav.activate();
    } else {
      this.pauseScreenEl.classList.add('hidden');
      this.pauseMenuNav.deactivate();
      this.lastTime = performance.now(); // Prevent large dt jump
    }
  }

  private startGame() {
    this.startScreenEl.classList.add('hidden');
    this.gameoverScreenEl.classList.add('hidden');
    this.pauseScreenEl.classList.add('hidden');
    this.gameOverMenuNav.deactivate();
    this.isPaused = false;
    this.resetGame();
    this.isRunning = true;
    this.lastTime = performance.now();
  }

  private restartGame() {
    this.startGame();
  }

  private gameOver() {
    this.isRunning = false;
    this.soundFX.playCrash();
    this.finalScoreEl.textContent = `${Math.floor(this.distance)} m`;
    this.finalCoinsEl.textContent = `${this.coinsCount}`;
    this.gameoverScreenEl.classList.remove('hidden');
    this.gameOverMenuNav.activate();
  }

  private resetGame() {
    this.forwardSpeed = 14.0;
    this.coinsCount = 0;
    this.distance = 0;
    this.input.keysPressed.clear();

    this.scoreValEl.textContent = '0 m';
    this.coinsValEl.textContent = '0';

    this.runner.reset();
    this.trackManager.reset();
  }

  private animate(currentTime: number) {
    requestAnimationFrame(this.animate.bind(this));

    const dt = Math.min((currentTime - (this.lastTime || currentTime)) / 1000, 0.1);
    this.lastTime = currentTime;

    if (this.isRunning && !this.isPaused) {
      // Speed up over time
      this.forwardSpeed += dt * 0.15;
      this.runner.update(dt, this.forwardSpeed);

      this.distance = this.runner.posZ;
      this.scoreValEl.textContent = `${Math.floor(this.distance)} m`;

      // Update Track & Particles
      this.trackManager.update(this.runner.posZ);
      this.sceneManager.updateCamera(this.runner.posZ, this.runner.posX, dt);
      this.sceneManager.updateParticles(this.runner.posZ);

      // Check Collisions
      const crashed = this.collisionManager.checkCollisions(
        this.runner,
        this.trackManager,
        () => {
          this.coinsCount++;
          this.coinsValEl.textContent = `${this.coinsCount}`;
          this.soundFX.playCoin();
        }
      );

      if (crashed) {
        this.gameOver();
      }
    } else {
      // Idle scene rendering
      this.sceneManager.render();
    }

    if (this.isRunning) {
      this.sceneManager.render();
    }
  }
}

new SubwayRunnerGame();
