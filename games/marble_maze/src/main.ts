import { MazeGenerator, MazeData, Difficulty, TerrainType } from './maze/mazeGenerator';
import { PhysicsManager } from './physics/physicsManager';
import { SceneManager } from './graphics/sceneManager';
import { SharedInputManager as InputManager, InputSettings } from '../../../shared/inputManager';
import { SharedAudioManager as AudioManager } from '../../../shared/audioManager';
import { HudManager } from './ui/hudManager';

class Game {
  private physicsManager: PhysicsManager;
  private sceneManager: SceneManager;
  private inputManager: InputManager;
  private audioManager: AudioManager;
  private hudManager: HudManager;

  private currentMaze!: MazeData;
  private currentDifficulty: Difficulty = 'medium';
  private currentSeed: string = '';
  private debugPathEnabled: boolean = false;

  private collectedCoinsCount: number = 0;
  private isGameOver: boolean = false;
  private startPos: { x: number; y: number; z: number } = { x: 0, y: 0.8, z: 0 };
  private activatedCheckpoints: Set<string> = new Set();
  private lastCheckpoint: { x: number; y: number; z: number } | null = null;
  private lastCheckpointTime = 0;

  private lastFrameTime: number = performance.now();

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container);
    this.physicsManager = new PhysicsManager();
    this.inputManager = new InputManager();
    this.audioManager = new AudioManager();

    this.hudManager = new HudManager({
      onRestart: (fromCheckpoint?: boolean) => this.restartLevel(fromCheckpoint),
      onNewRandom: () => this.generateNewLevel(),
      onApplySeed: (seed) => this.generateLevelFromSeed(seed),
      onUpdateSettings: (settings, diff, debugPath) => this.updateSettings(settings, diff, debugPath),
      onToggleMute: () => this.audioManager.toggleMute()
    });
  }

  public async start() {
    await this.physicsManager.init();
    this.loadSettings();
    this.generateNewLevel();
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  private loadSettings() {
    this.currentDifficulty = this.loadDifficulty();
    const diffEl = document.getElementById('setting-difficulty') as HTMLSelectElement | null;
    if (diffEl) diffEl.value = this.currentDifficulty;

    this.debugPathEnabled = this.loadDebugPathSetting();
    this.hudManager.updateDebugPathSetting(this.debugPathEnabled);
  }

  private loadDifficulty(): Difficulty {
    const stored = localStorage.getItem('marble-maze-difficulty');
    if (stored === 'easy' || stored === 'medium' || stored === 'hard') return stored;
    return 'medium';
  }

  private loadDebugPathSetting(): boolean {
    const stored = localStorage.getItem('marble-maze-debug-path');
    return stored === 'true';
  }

  private saveDebugPathSetting() {
    localStorage.setItem('marble-maze-debug-path', this.debugPathEnabled.toString());
  }

  private saveDifficulty() {
    localStorage.setItem('marble-maze-difficulty', this.currentDifficulty);
  }

  private generateNewLevel() {
    const randomSeed = `maze-${Math.floor(Math.random() * 899999 + 100000)}`;
    this.generateLevelFromSeed(randomSeed);
  }

  private generateLevelFromSeed(seedStr: string) {
    this.currentSeed = seedStr;
    const gridDim = this.currentDifficulty === 'easy' ? 6 : this.currentDifficulty === 'medium' ? 10 : 14;

    this.currentMaze = MazeGenerator.generate(gridDim, gridDim, this.currentSeed, this.currentDifficulty);
    this.collectedCoinsCount = 0;
    this.isGameOver = false;

    const { startPos } =     this.physicsManager.buildMazePhysics(this.currentMaze, {
      onCollectCoin: (x, z, coinId) => this.handleCollectCoin(x, z, coinId),
      onFallInHole: () => this.handleFallInHole(),
      onReachGoal: () => this.handleReachGoal(),
      onHitWall: (vel) => this.audioManager.playHit(vel),
      onActivateGate: (gateId) => this.handleActivateGate(gateId),
      onActivateCheckpoint: (checkpointId) => this.handleActivateCheckpoint(checkpointId)
    });

    this.startPos = startPos;
    this.sceneManager.buildMazeMesh(this.currentMaze, this.debugPathEnabled);
    this.sceneManager.resetCheckpoints();
    this.sceneManager.updateMarble(startPos, { x: 0, y: 0, z: 0 });

    this.hudManager.updateSeed(this.currentSeed);
    this.hudManager.updateCoins(0, this.currentMaze.coinsCount);
    this.hudManager.resetTimer();
    this.hudManager.startTimer();
  }

  private restartLevel(fromCheckpoint: boolean = false) {
    this.isGameOver = false;

    if (fromCheckpoint && this.lastCheckpoint) {
      this.physicsManager.resetMarblePosition(this.lastCheckpoint.x, this.lastCheckpoint.y, this.lastCheckpoint.z);
      this.sceneManager.updateMarble(this.lastCheckpoint, { x: 0, y: 0, z: 0 });
      this.hudManager.resetTimer();
      this.hudManager.startTimer();
      return;
    }

    this.physicsManager.buildMazePhysics(this.currentMaze, {
      onCollectCoin: (x, z, coinId) => this.handleCollectCoin(x, z, coinId),
      onFallInHole: () => this.handleFallInHole(),
      onReachGoal: () => this.handleReachGoal(),
      onHitWall: (vel) => this.audioManager.playHit(vel),
      onActivateGate: (gateId) => this.handleActivateGate(gateId),
      onActivateCheckpoint: (checkpointId) => this.handleActivateCheckpoint(checkpointId)
    });

    this.sceneManager.buildMazeMesh(this.currentMaze, this.debugPathEnabled);
    this.sceneManager.resetCheckpoints();

    this.collectedCoinsCount = 0;
    this.activatedCheckpoints.clear();
    this.lastCheckpoint = null;
    this.physicsManager.resetMarblePosition(this.startPos.x, this.startPos.y, this.startPos.z);
    this.sceneManager.updateMarble(this.startPos, { x: 0, y: 0, z: 0 });
    this.hudManager.updateCoins(0, this.currentMaze.coinsCount);
    this.hudManager.resetTimer();
  }

   private updateSettings(settings: Partial<InputSettings>, difficulty: Difficulty, debugPath?: boolean) {
    Object.assign(this.inputManager.settings, settings);
    if (difficulty !== this.currentDifficulty) {
      this.currentDifficulty = difficulty;
      this.saveDifficulty();
      this.generateNewLevel();
    }
    if (debugPath !== undefined && debugPath !== this.debugPathEnabled) {
      this.debugPathEnabled = debugPath;
      this.saveDebugPathSetting();
      this.generateNewLevel();
    }
   }

  private handleCollectCoin(_gridX: number, _gridZ: number, coinId: string) {
    this.collectedCoinsCount++;
    this.audioManager.playCollect();
    this.sceneManager.removeCoinMesh(coinId);
    this.hudManager.updateCoins(this.collectedCoinsCount, this.currentMaze.coinsCount);
  }

  private handleFallInHole() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.audioManager.playFall();
    this.hudManager.showFallModal(this.activatedCheckpoints.size > 0);
  }

  private handleActivateGate(gateId: string) {
    const gate = this.physicsManager.gateSensors.get(gateId);
    if (gate) {
      const requiredCoins = this.physicsManager.gateCosts.get(gateId) || 5;
      if (this.collectedCoinsCount >= requiredCoins) {
        this.physicsManager.world.removeCollider(gate.blocker, false);
        this.physicsManager.gateSensors.delete(gateId);
        this.sceneManager.removeGateMesh(gateId);
      }
    }
  }

  private handleActivateCheckpoint(checkpointId: string) {
    const now = Date.now();
    if (now - this.lastCheckpointTime < 500) return;
    this.lastCheckpointTime = now;

    this.activatedCheckpoints.add(checkpointId);
    const checkpoint = this.physicsManager.checkpointSensors.get(checkpointId);
    if (checkpoint) {
      this.lastCheckpoint = checkpoint.position;
    }
    this.sceneManager.activateCheckpoint(checkpointId);
  }

  private handleReachGoal() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    const finalTime = this.hudManager.stopTimer();
    this.audioManager.playWin();
    this.hudManager.showWinModal(finalTime, this.collectedCoinsCount, this.currentMaze.coinsCount);
  }

  private gameLoop(now: number) {
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (!this.isGameOver) {
      this.inputManager.update(dt);

      const tiltX = this.inputManager.currentTiltX;
      const tiltZ = this.inputManager.currentTiltZ;

      this.physicsManager.updateBoardTilt(tiltX, tiltZ);
      this.sceneManager.updateBoardTilt(tiltX, tiltZ);

      this.physicsManager.updateMovingHoles(dt);
      this.sceneManager.updateMovingHoles(dt);

      const { marblePos, marbleVel, speed } = this.physicsManager.step(dt);
      this.sceneManager.updateMarble(marblePos, marbleVel);

      this.audioManager.updateRollSound(speed);

      const currentTerrain = this.getTerrainAtPos(marblePos.x, marblePos.z);
      this.hudManager.updateTerrain(currentTerrain);

      this.hudManager.update(dt);
    }

    this.sceneManager.render();
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  private getTerrainAtPos(worldX: number, worldZ: number): TerrainType {
    if (!this.currentMaze) return 'asphalt';
    const cellSize = this.currentMaze.cellSize;
    const mazeWorldWidth = this.currentMaze.width * cellSize;
    const mazeWorldHeight = this.currentMaze.height * cellSize;

    const gridX = Math.floor((worldX + mazeWorldWidth / 2) / cellSize);
    const gridZ = Math.floor((worldZ + mazeWorldHeight / 2) / cellSize);

    if (
      gridZ >= 0 &&
      gridZ < this.currentMaze.height &&
      gridX >= 0 &&
      gridX < this.currentMaze.width
    ) {
      return this.currentMaze.cells[gridZ][gridX].terrain;
    }
    return 'asphalt';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
});
