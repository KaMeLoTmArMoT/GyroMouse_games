import { SceneManager } from './graphics/sceneManager';
import { Runner } from './game/runner';
import { TrackManager } from './game/trackManager';
import { CollisionManager } from './game/collisionManager';
import { RunnerSoundFX } from './audio/soundFX';

class SubwayRunnerGame {
  private sceneManager!: SceneManager;
  private runner!: Runner;
  private trackManager!: TrackManager;
  private collisionManager!: CollisionManager;
  private soundFX!: RunnerSoundFX;

  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private lastTime: number = 0;

  private forwardSpeed: number = 14.0; // Increases over time
  private coinsCount: number = 0;
  private distance: number = 0;

  // Keyboard input state tracking
  private keysPressed: Set<string> = new Set();

  // UI Elements
  private scoreValEl = document.getElementById('score-val')!;
  private coinsValEl = document.getElementById('coins-val')!;
  private startScreenEl = document.getElementById('start-screen')!;
  private pauseScreenEl = document.getElementById('pause-screen')!;
  private gameoverScreenEl = document.getElementById('gameover-screen')!;
  private finalScoreEl = document.getElementById('final-score')!;
  private finalCoinsEl = document.getElementById('final-coins')!;

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container);
    this.runner = new Runner(this.sceneManager.scene);
    this.trackManager = new TrackManager(this.sceneManager.scene);
    this.collisionManager = new CollisionManager();
    this.soundFX = new RunnerSoundFX();

    this.setupControls();
    this.setupUI();
    this.animate(0);
  }

  private setupControls() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this.isRunning) {
        this.togglePause();
        return;
      }

      if (!this.isRunning || this.isPaused) return;

      if (e.code === 'ArrowLeft' && !this.keysPressed.has('ArrowLeft')) {
        this.runner.steer(-1);
      } else if (e.code === 'ArrowRight' && !this.keysPressed.has('ArrowRight')) {
        this.runner.steer(1);
      } else if (e.code === 'ArrowUp' && !this.keysPressed.has('ArrowUp')) {
        this.runner.jump();
        this.soundFX.playJump();
      } else if (e.code === 'ArrowDown' && !this.keysPressed.has('ArrowDown')) {
        this.runner.slide();
        this.soundFX.playSlide();
      }

      this.keysPressed.add(e.code);
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    });

    window.addEventListener('blur', () => this.keysPressed.clear());
  }

  private setupUI() {
    document.getElementById('btn-start')?.addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart')?.addEventListener('click', () => this.restartGame());
    document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePause(false));
  }

  private togglePause(forceState?: boolean) {
    if (!this.isRunning) return;
    this.isPaused = forceState !== undefined ? forceState : !this.isPaused;

    if (this.isPaused) {
      this.pauseScreenEl.classList.remove('hidden');
    } else {
      this.pauseScreenEl.classList.add('hidden');
      this.lastTime = performance.now(); // Prevent large dt jump
    }
  }

  private startGame() {
    this.startScreenEl.classList.add('hidden');
    this.gameoverScreenEl.classList.add('hidden');
    this.pauseScreenEl.classList.add('hidden');
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
  }

  private resetGame() {
    this.forwardSpeed = 14.0;
    this.coinsCount = 0;
    this.distance = 0;
    this.keysPressed.clear();

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
