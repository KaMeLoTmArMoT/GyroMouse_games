import { SharedAudioManager as AudioManager } from "../../../shared/audioManager";
import {
	SharedInputManager as InputManager,
	type InputSettings,
} from "../../../shared/inputManager";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { SceneManager } from "./graphics/sceneManager";
import {
	type Difficulty,
	type MazeData,
	MazeGenerator,
	type TerrainType,
} from "./maze/mazeGenerator";
import { PhysicsManager } from "./physics/physicsManager";
import { HudManager } from "./ui/hudManager";

class Game {
	private physicsManager: PhysicsManager;
	private sceneManager: SceneManager;
	private inputManager: InputManager;
	private audioManager: AudioManager;
	private hudManager: HudManager;
	public settingsOverlay: SettingsOverlay;

	private currentMaze!: MazeData;
	private currentDifficulty: string = "medium";
	private currentSeed: string = "";
	private debugPathEnabled: boolean = false;

	private collectedCoinsCount: number = 0;
	private isGameOver: boolean = false;
	private isPaused: boolean = false;
	private startPos: { x: number; y: number; z: number } = {
		x: 0,
		y: 0.8,
		z: 0,
	};
	private activatedCheckpoints: Set<string> = new Set();
	private lastCheckpoint: { x: number; y: number; z: number } | null = null;
	private lastCheckpointTime = 0;

	private lastFrameTime: number = performance.now();

	constructor() {
		const container = document.getElementById("canvas-container")!;
		this.sceneManager = new SceneManager(container);
		this.physicsManager = new PhysicsManager();
		this.inputManager = new InputManager();
		this.audioManager = new AudioManager();

		this.settingsOverlay = new SettingsOverlay({
			gameId: "marble_maze",
			inputManager: this.inputManager,
			onPauseToggle: (paused) => {
				this.isPaused = paused;
				if (paused) {
					this.hudManager.stopTimer();
				} else {
					this.hudManager.startTimer();
				}
			},
			onRestart: () => this.restartLevel(),
			onToggleMute: () => this.audioManager.toggleMute(),
			customGameOptionsHtml: `
        <div class="gm-group">
          <label class="gm-label" for="setting-difficulty">Difficulty & Maze Size</label>
          <select id="setting-difficulty" class="gm-select">
            <option value="easy">Easy (6x6)</option>
            <option value="medium_easy">Standard (8x8)</option>
            <option value="medium" selected>Medium (10x10)</option>
            <option value="medium_hard">Advanced (12x12)</option>
            <option value="hard">Extreme (14x14)</option>
          </select>
        </div>
        <div class="gm-group">
          <label class="gm-label" for="setting-seed">Custom Maze Seed</label>
          <input type="text" id="setting-seed" placeholder="e.g. maze-12345" class="gm-select" />
        </div>
        <div class="gm-group" style="display: flex; align-items: center; justify-content: space-between;">
          <label class="gm-label" for="setting-debug-path" style="cursor: pointer; margin: 0;">Show Debug Path</label>
          <input type="checkbox" id="setting-debug-path" style="width: 18px; height: 18px; accent-color: #38bdf8; cursor: pointer;" />
        </div>
      `,
			onBindCustomOptions: (container) => {
				const diffEl = container.querySelector(
					"#setting-difficulty",
				) as HTMLSelectElement;
				const seedEl = container.querySelector(
					"#setting-seed",
				) as HTMLInputElement;
				const debugEl = container.querySelector(
					"#setting-debug-path",
				) as HTMLInputElement;

				if (diffEl) {
					diffEl.value = this.currentDifficulty;
					diffEl.addEventListener("change", () => {
						this.currentDifficulty = diffEl.value;
						this.saveDifficulty();
						this.generateNewLevel();
					});
				}
				if (seedEl) {
					seedEl.addEventListener("change", () => {
						const seed = seedEl.value.trim();
						if (seed) this.generateLevelFromSeed(seed);
					});
				}
				if (debugEl) {
					debugEl.checked = this.debugPathEnabled;
					debugEl.addEventListener("change", () => {
						this.debugPathEnabled = debugEl.checked;
						this.saveDebugPathSetting();
						this.hudManager.updateDebugPathSetting(this.debugPathEnabled);
						this.generateNewLevel();
					});
				}
			},
		});

		this.hudManager = new HudManager({
			onRestart: (fromCheckpoint?: boolean) =>
				this.restartLevel(fromCheckpoint),
			onNewRandom: () => this.generateNewLevel(),
			onApplySeed: (seed) => this.generateLevelFromSeed(seed),
			onUpdateSettings: (settings, diff, debugPath) =>
				this.updateSettings(settings, diff, debugPath),
			onToggleMute: () => this.audioManager.toggleMute(),
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
		this.debugPathEnabled = this.loadDebugPathSetting();
		this.hudManager.updateDebugPathSetting(this.debugPathEnabled);
	}

	private loadDifficulty(): string {
		const stored = localStorage.getItem("marble-maze-difficulty");
		if (
			stored === "easy" ||
			stored === "medium_easy" ||
			stored === "medium" ||
			stored === "medium_hard" ||
			stored === "hard"
		)
			return stored;
		return "medium";
	}

	private loadDebugPathSetting(): boolean {
		const stored = localStorage.getItem("marble-maze-debug-path");
		return stored === "true";
	}

	private saveDebugPathSetting() {
		localStorage.setItem(
			"marble-maze-debug-path",
			this.debugPathEnabled.toString(),
		);
	}

	private saveDifficulty() {
		localStorage.setItem("marble-maze-difficulty", this.currentDifficulty);
	}

	private generateNewLevel() {
		const randomSeed = `maze-${Math.floor(Math.random() * 899999 + 100000)}`;
		this.generateLevelFromSeed(randomSeed);
	}

	private generateLevelFromSeed(seedStr: string) {
		this.currentSeed = seedStr;
		const diffMap: Record<string, { size: number; diff: Difficulty }> = {
			easy: { size: 6, diff: "easy" },
			medium_easy: { size: 8, diff: "easy" },
			medium: { size: 10, diff: "medium" },
			medium_hard: { size: 12, diff: "medium" },
			hard: { size: 14, diff: "hard" },
		};
		const { size, diff } = diffMap[this.currentDifficulty] || diffMap.medium;

		this.currentMaze = MazeGenerator.generate(
			size,
			size,
			this.currentSeed,
			diff,
		);

		this.collectedCoinsCount = 0;
		this.isGameOver = false;

		const { startPos } = this.physicsManager.buildMazePhysics(
			this.currentMaze,
			{
				onCollectCoin: (x, z, coinId) => this.handleCollectCoin(x, z, coinId),
				onFallInHole: () => this.handleFallInHole(),
				onReachGoal: () => this.handleReachGoal(),
				onHitWall: (vel) => this.audioManager.playHit(vel),
				onActivateGate: (gateId) => this.handleActivateGate(gateId),
				onActivateCheckpoint: (checkpointId) =>
					this.handleActivateCheckpoint(checkpointId),
			},
		);

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
			this.physicsManager.resetMarblePosition(
				this.lastCheckpoint.x,
				this.lastCheckpoint.y,
				this.lastCheckpoint.z,
			);
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
			onActivateCheckpoint: (checkpointId) =>
				this.handleActivateCheckpoint(checkpointId),
		});

		this.sceneManager.buildMazeMesh(this.currentMaze, this.debugPathEnabled);
		this.sceneManager.resetCheckpoints();

		this.collectedCoinsCount = 0;
		this.activatedCheckpoints.clear();
		this.lastCheckpoint = null;
		this.physicsManager.resetMarblePosition(
			this.startPos.x,
			this.startPos.y,
			this.startPos.z,
		);
		this.sceneManager.updateMarble(this.startPos, { x: 0, y: 0, z: 0 });
		this.hudManager.updateCoins(0, this.currentMaze.coinsCount);
		this.hudManager.resetTimer();
		this.hudManager.startTimer();
	}

	private updateSettings(
		settings: Partial<InputSettings>,
		difficulty: string,
		debugPath?: boolean,
	) {
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
		this.hudManager.updateCoins(
			this.collectedCoinsCount,
			this.currentMaze.coinsCount,
		);
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
				this.collectedCoinsCount -= requiredCoins;
				this.hudManager.updateCoins(
					this.collectedCoinsCount,
					this.currentMaze.coinsCount,
				);
				this.physicsManager.world.removeCollider(gate.blocker, false);
				this.physicsManager.gateSensors.delete(gateId);
				this.sceneManager.removeGateMesh(gateId);
			}
		}
	}

	private handleActivateCheckpoint(checkpointId: string) {
		if (this.activatedCheckpoints.has(checkpointId)) return;
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
		this.hudManager.showWinModal(
			finalTime,
			this.collectedCoinsCount,
			this.currentMaze.coinsCount,
		);
	}

	private gameLoop(now: number) {
		const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
		this.lastFrameTime = now;

		if (!this.isGameOver && !this.isPaused) {
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
		if (!this.currentMaze) return "asphalt";
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
		return "asphalt";
	}
}

window.addEventListener("DOMContentLoaded", () => {
	const game = new Game();
	game.start();
});
