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

  private collectedCoinsCount: number = 0;
  private isGameOver: boolean = false;
  private startPos: { x: number; y: number; z: number } = { x: 0, y: 0.8, z: 0 };

  private lastFrameTime: number = performance.now();

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container);
    this.physicsManager = new PhysicsManager();
    this.inputManager = new InputManager();
    this.audioManager = new AudioManager();

    this.hudManager = new HudManager({
      onRestart: () => this.restartLevel(),
      onNewRandom: () => this.generateNewLevel(),
      onApplySeed: (seed) => this.generateLevelFromSeed(seed),
      onUpdateSettings: (settings, diff) => this.updateSettings(settings, diff),
      onToggleMute: () => this.audioManager.toggleMute()
    });
  }

  public async start() {
    await this.physicsManager.init();
    this.generateNewLevel();
    requestAnimationFrame(this.gameLoop.bind(this));
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

    const { startPos } = this.physicsManager.buildMazePhysics(this.currentMaze, {
      onCollectCoin: (x, z, coinId) => this.handleCollectCoin(x, z, coinId),
      onFallInHole: () => this.handleFallInHole(),
      onReachGoal: () => this.handleReachGoal(),
      onHitWall: (vel) => this.audioManager.playHit(vel)
    });

    this.startPos = startPos;
    this.sceneManager.buildMazeMesh(this.currentMaze);
    this.sceneManager.updateMarble(startPos, { x: 0, y: 0, z: 0 });

    this.hudManager.updateSeed(this.currentSeed);
    this.hudManager.updateCoins(0, this.currentMaze.coinsCount);
    this.hudManager.resetTimer();
    this.hudManager.startTimer();
  }

  private restartLevel() {
    this.collectedCoinsCount = 0;
    this.isGameOver = false;

    this.physicsManager.buildMazePhysics(this.currentMaze, {
      onCollectCoin: (x, z, coinId) => this.handleCollectCoin(x, z, coinId),
      onFallInHole: () => this.handleFallInHole(),
      onReachGoal: () => this.handleReachGoal(),
      onHitWall: (vel) => this.audioManager.playHit(vel)
    });

    this.sceneManager.buildMazeMesh(this.currentMaze);
    this.physicsManager.resetMarblePosition(this.startPos.x, this.startPos.y, this.startPos.z);
    this.sceneManager.updateMarble(this.startPos, { x: 0, y: 0, z: 0 });

    this.hudManager.updateCoins(0, this.currentMaze.coinsCount);
    this.hudManager.resetTimer();
  }

  private updateSettings(settings: Partial<InputSettings>, difficulty: Difficulty) {
    Object.assign(this.inputManager.settings, settings);
    if (difficulty !== this.currentDifficulty) {
      this.currentDifficulty = difficulty;
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
    this.hudManager.showFallModal();
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
