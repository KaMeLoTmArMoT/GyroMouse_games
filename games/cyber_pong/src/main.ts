import * as THREE from 'three';
import { SharedAudioManager } from '../../../shared/audioManager';
import { SharedInputManager } from '../../../shared/inputManager';
import { MenuNav } from '../../../shared/menuNav';
import { ArenaRenderer } from './graphics/ArenaRenderer';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { AIBotController, AIDifficulty } from './ai/AIBotController';

export class CyberPongGame {
  private renderer!: ArenaRenderer;
  private physicsWorld!: PhysicsWorld;
  private inputManager!: SharedInputManager;
  private aiBot!: AIBotController;
  private audioManager!: SharedAudioManager;

  // Game Settings & State
  public mode: '1p' | '2p' = '1p';
  public p1Score: number = 0;
  public p2Score: number = 0;
  public targetScore: number = 10;

  public p1BricksCleared: number = 0;
  public p2BricksCleared: number = 0;
  public totalBricksPerSide: number = 6;

  public isStarted: boolean = false;
  public isPaused: boolean = false;
  public isGameOver: boolean = false;
  private lastTime: number = 0;

  // UI Element References
  private scoreP1El!: HTMLElement;
  private scoreP2El!: HTMLElement;
  private p2LabelEl!: HTMLElement;
  private modeSelectEl!: HTMLSelectElement;
  private diffSelectEl!: HTMLSelectElement;
  private btnAudioEl!: HTMLButtonElement;
  private startModalEl!: HTMLElement;
  private pauseModalEl!: HTMLElement;
  private gameoverModalEl!: HTMLElement;
  private winnerTitleEl!: HTMLElement;
  private winnerDescEl!: HTMLElement;
  private btnResumeEl!: HTMLButtonElement;
  private btnRestartEl!: HTMLButtonElement;

  private p1PaddleZ: number = 0;
  private p2PaddleZ: number = 0;
  private p1Scale: number = 1.0;
  private p2Scale: number = 1.0;

  private pauseMenuNav!: MenuNav;
  private gameoverMenuNav!: MenuNav;

  public static async init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const game = new CyberPongGame();
    await game.setup(canvas);
  }

  private async setup(canvas: HTMLCanvasElement) {
    this.renderer = new ArenaRenderer(canvas);
    this.inputManager = new SharedInputManager();
    this.audioManager = new SharedAudioManager();
    this.aiBot = new AIBotController('medium');

    this.physicsWorld = await PhysicsWorld.create(
      (id, side) => this.onBrickDestroyed(id, side),
      (scoringSide) => this.onGoalScored(scoringSide)
    );

    this.initUI();

    this.pauseMenuNav = new MenuNav({ container: this.pauseModalEl });
    this.gameoverMenuNav = new MenuNav({ container: this.gameoverModalEl });

    this.resetMatch();

    window.addEventListener('keydown', (e) => this.handleGlobalInput(e));

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private initUI() {
    this.scoreP1El = document.getElementById('score-p1')!;
    this.scoreP2El = document.getElementById('score-p2')!;
    this.p2LabelEl = document.getElementById('p2-label')!;
    this.modeSelectEl = document.getElementById('mode-select') as HTMLSelectElement;
    this.diffSelectEl = document.getElementById('diff-select') as HTMLSelectElement;
    this.btnAudioEl = document.getElementById('btn-audio') as HTMLButtonElement;
    this.startModalEl = document.getElementById('start-modal')!;
    this.pauseModalEl = document.getElementById('pause-modal')!;
    this.gameoverModalEl = document.getElementById('gameover-modal')!;
    this.winnerTitleEl = document.getElementById('winner-title')!;
    this.winnerDescEl = document.getElementById('winner-desc')!;
    this.btnResumeEl = document.getElementById('btn-resume') as HTMLButtonElement;
    this.btnRestartEl = document.getElementById('btn-restart') as HTMLButtonElement;

    this.startModalEl.addEventListener('click', () => this.startGame());

    // Load saved settings from localStorage on F5 reload
    const savedMode = localStorage.getItem('cyberpong-mode');
    if (savedMode && (savedMode === '1p' || savedMode === '2p')) {
      this.mode = savedMode;
      this.modeSelectEl.value = savedMode;
    }

    const savedDiff = localStorage.getItem('cyberpong-diff');
    if (savedDiff && ['easy', 'medium', 'hard', 'adaptive'].includes(savedDiff)) {
      this.aiBot.difficulty = savedDiff as AIDifficulty;
      this.diffSelectEl.value = savedDiff;
    }

    const updateControlsHint = () => {
      const p1HintEl = document.getElementById('p1-controls-hint');
      const p2HintEl = document.getElementById('p2-controls-hint');
      if (this.mode === '2p') {
        if (p1HintEl) p1HintEl.innerHTML = 'P1 (Blue): <span class="key-badge">W</span>/<span class="key-badge">S</span> or <span class="key-badge">↑</span>/<span class="key-badge">↓</span>';
        if (p2HintEl) {
          p2HintEl.innerHTML = 'P2 (Red): <span class="key-badge">A</span>/<span class="key-badge">D</span> or <span class="key-badge">←</span>/<span class="key-badge">→</span>';
          p2HintEl.style.display = 'block';
        }
      } else {
        if (p1HintEl) p1HintEl.innerHTML = 'P1 (Blue): <span class="key-badge">W</span>/<span class="key-badge">S</span> or <span class="key-badge">↑</span>/<span class="key-badge">↓</span>';
        if (p2HintEl) p2HintEl.style.display = 'none';
      }
    };

    this.p2LabelEl.textContent = this.mode === '1p' ? 'Bot (Red)' : 'P2 (Red)';
    this.diffSelectEl.style.display = this.mode === '1p' ? 'inline-block' : 'none';
    updateControlsHint();

    // Event Listeners
    this.modeSelectEl.addEventListener('change', () => {
      this.mode = this.modeSelectEl.value as '1p' | '2p';
      localStorage.setItem('cyberpong-mode', this.mode);
      this.p2LabelEl.textContent = this.mode === '1p' ? 'Bot (Red)' : 'P2 (Red)';
      this.diffSelectEl.style.display = this.mode === '1p' ? 'inline-block' : 'none';
      updateControlsHint();
      this.modeSelectEl.blur();
      this.resetMatch();
    });

    this.diffSelectEl.addEventListener('change', () => {
      this.aiBot.difficulty = this.diffSelectEl.value as AIDifficulty;
      localStorage.setItem('cyberpong-diff', this.aiBot.difficulty);
      this.diffSelectEl.blur();
    });

    this.btnAudioEl.addEventListener('click', () => {
      const isMuted = this.audioManager.toggleMute();
      this.btnAudioEl.textContent = isMuted ? '🔇 Muted' : '🔊 Sound';
    });

    this.btnResumeEl.addEventListener('click', () => this.togglePause(false));
    this.btnRestartEl.addEventListener('click', () => this.resetMatch());
  }

  private startGame() {
    this.isStarted = true;
    this.isPaused = false;
    this.startModalEl.classList.add('hidden');
    this.lastTime = performance.now();
  }

  private handleGlobalInput(e: KeyboardEvent) {
    if (!this.isStarted) {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (e.key === 'Escape' || e.code === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (!this.isGameOver) {
        this.togglePause();
      }
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (this.isGameOver) {
        this.resetMatch();
      } else {
        this.togglePause();
      }
    }
  }

  public togglePause(forceState?: boolean) {
    this.isPaused = forceState !== undefined ? forceState : !this.isPaused;
    if (this.isPaused) {
      this.pauseModalEl.classList.remove('hidden');
      this.pauseMenuNav.activate();
    } else {
      this.pauseModalEl.classList.add('hidden');
      this.pauseMenuNav.deactivate();
    }
  }

  private resetMatch() {
    this.p1Score = 0;
    this.p2Score = 0;
    this.p1BricksCleared = 0;
    this.p2BricksCleared = 0;
    this.p1Scale = 1.0;
    this.p2Scale = 1.0;
    this.isPaused = false;
    this.isGameOver = false;

    this.scoreP1El.textContent = '0';
    this.scoreP2El.textContent = '0';

    this.pauseModalEl.classList.add('hidden');
    this.gameoverModalEl.classList.add('hidden');
    this.pauseMenuNav.deactivate();
    this.gameoverMenuNav.deactivate();

    // Reset paddle sizes (visuals & physics)
    this.renderer.setPaddleSize(this.renderer.p1PaddleMesh, 1.0);
    this.renderer.setPaddleSize(this.renderer.p2PaddleMesh, 1.0);
    this.physicsWorld.setPaddleScale('p1', 1.0);
    this.physicsWorld.setPaddleScale('p2', 1.0);

    // Setup visual & physics center bricks
    this.physicsWorld.setupCenterBricks();

    // Recreate 3D brick meshes
    for (const mesh of this.renderer.brickMeshes.values()) {
      this.renderer.scene.remove(mesh);
    }
    this.renderer.brickMeshes.clear();

    for (const b of this.physicsWorld.bricks.values()) {
      this.renderer.createBrickMesh(b.id, b.side, b.x, b.z, b.depth);
    }

    this.physicsWorld.servePuck('right');
  }

  private onBrickDestroyed(id: string, side: 'p1' | 'p2') {
    this.renderer.removeBrickMesh(id);
    this.audioManager.playHit(1.2);

    if (side === 'p1') {
      this.p1BricksCleared++;
      this.p1Scale = 1.0 + (this.p1BricksCleared / this.totalBricksPerSide) * 0.8;
      this.renderer.setPaddleSize(this.renderer.p1PaddleMesh, this.p1Scale);
      this.physicsWorld.setPaddleScale('p1', this.p1Scale);
    } else {
      this.p2BricksCleared++;
      this.p2Scale = 1.0 + (this.p2BricksCleared / this.totalBricksPerSide) * 0.8;
      this.renderer.setPaddleSize(this.renderer.p2PaddleMesh, this.p2Scale);
      this.physicsWorld.setPaddleScale('p2', this.p2Scale);
    }
  }

  private onGoalScored(scoringSide: 'p1' | 'p2') {
    this.audioManager.playWin();

    if (scoringSide === 'p1') {
      this.p1Score++;
      this.scoreP1El.textContent = this.p1Score.toString();
    } else {
      this.p2Score++;
      this.scoreP2El.textContent = this.p2Score.toString();
    }

    if (this.p1Score >= this.targetScore || this.p2Score >= this.targetScore) {
      this.triggerGameOver(scoringSide === 'p1' ? 'P1 (BLUE)' : (this.mode === '1p' ? 'BOT (RED)' : 'P2 (RED)'));
    } else {
      // Serve puck towards losing player (resets rally time speedup)
      this.physicsWorld.servePuck(scoringSide === 'p1' ? 'right' : 'left');
    }
  }

  private triggerGameOver(winnerText: string) {
    this.isGameOver = true;
    this.winnerTitleEl.textContent = `${winnerText} WINS!`;
    this.winnerDescEl.textContent = `Final Score: ${this.p1Score} - ${this.p2Score}`;
    this.gameoverModalEl.classList.remove('hidden');
    this.gameoverMenuNav.activate();
  }

  private updatePlayerMovement(dt: number) {
    this.inputManager.update(dt);

    const moveSpeed = 12;
    const checkKey = (k: string) => this.inputManager.isKeyPressed(k);

    // Compute dynamic bounds so enlarged paddles never penetrate top/bottom walls
    const p1MaxZ = Math.max(0, 9.8 - 1.6 * this.p1Scale);
    const p2MaxZ = Math.max(0, 9.8 - 1.6 * this.p2Scale);

    if (this.mode === '2p') {
      // Player 1 (Left Paddle): W / S OR ArrowUp / ArrowDown
      const isP1Up = checkKey('KeyW') || checkKey('w') || checkKey('W') || checkKey('ArrowUp');
      const isP1Down = checkKey('KeyS') || checkKey('s') || checkKey('S') || checkKey('ArrowDown');

      if (isP1Up) this.p1PaddleZ -= moveSpeed * dt;
      if (isP1Down) this.p1PaddleZ += moveSpeed * dt;

      // Player 2 (Right Paddle): A / D OR ArrowLeft / ArrowRight
      const isP2Up = checkKey('KeyA') || checkKey('a') || checkKey('A') || checkKey('ArrowLeft');
      const isP2Down = checkKey('KeyD') || checkKey('d') || checkKey('D') || checkKey('ArrowRight');

      if (isP2Up) this.p2PaddleZ -= moveSpeed * dt;
      if (isP2Down) this.p2PaddleZ += moveSpeed * dt;

      this.p2PaddleZ = Math.max(-p2MaxZ, Math.min(p2MaxZ, this.p2PaddleZ));
      this.physicsWorld.p2PaddleBody.setNextKinematicTranslation({
        x: 14,
        y: 0.4,
        z: this.p2PaddleZ
      });
    } else {
      // In 1P mode: Player 1 uses W / S OR ArrowUp / ArrowDown (plus Gyro/Mouse vertical tilt)
      const isP1Up = checkKey('KeyW') || checkKey('w') || checkKey('W') || checkKey('ArrowUp');
      const isP1Down = checkKey('KeyS') || checkKey('s') || checkKey('S') || checkKey('ArrowDown');

      if (isP1Up) this.p1PaddleZ -= moveSpeed * dt;
      if (isP1Down) this.p1PaddleZ += moveSpeed * dt;

      if (Math.abs(this.inputManager.normalizedDy) > 0.05) {
        this.p1PaddleZ += this.inputManager.normalizedDy * moveSpeed * dt;
      }
    }

    this.p1PaddleZ = Math.max(-p1MaxZ, Math.min(p1MaxZ, this.p1PaddleZ));
    this.physicsWorld.p1PaddleBody.setNextKinematicTranslation({
      x: -14,
      y: 0.4,
      z: this.p1PaddleZ
    });

    if (this.mode === '1p') {
      const puckPos = this.physicsWorld.puckBody.translation();
      const puckVel = this.physicsWorld.puckBody.linvel();
      this.aiBot.update(
        dt,
        this.physicsWorld.p2PaddleBody,
        puckPos,
        puckVel,
        this.p1Score - this.p2Score
      );
    }
  }

  private gameLoop(time: number) {
    requestAnimationFrame((t) => this.gameLoop(t));

    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;

    if (this.isStarted && !this.isPaused && !this.isGameOver) {
      this.updatePlayerMovement(dt);

      const isP1AllCleared = this.p1BricksCleared >= this.totalBricksPerSide;
      const isP2AllCleared = this.p2BricksCleared >= this.totalBricksPerSide;
      this.physicsWorld.step(dt, isP1AllCleared, isP2AllCleared);

      // Sync physics position to 3D graphics meshes
      const p1Pos = this.physicsWorld.p1PaddleBody.translation();
      const p2Pos = this.physicsWorld.p2PaddleBody.translation();
      const puckPos = this.physicsWorld.puckBody.translation();

      this.renderer.p1PaddleMesh.position.set(p1Pos.x, p1Pos.y, p1Pos.z);
      this.renderer.p2PaddleMesh.position.set(p2Pos.x, p2Pos.y, p2Pos.z);
      this.renderer.puckMesh.position.set(puckPos.x, puckPos.y, puckPos.z);

      this.renderer.updatePuckColor(this.physicsWorld.puckOwner);
      this.renderer.updatePuckTrail(new THREE.Vector3(puckPos.x, puckPos.y, puckPos.z));
    }

    this.renderer.render();
  }
}

CyberPongGame.init();
