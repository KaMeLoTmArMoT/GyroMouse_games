import { BaseGame } from "../../../shared/baseGame";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { DungeonGenerator } from "./dungeon_gen";
import { DungeonInputManager } from "./input";
import type { DungeonLevel } from "./level";
import { Player } from "./player";
import { DungeonRenderer } from "./renderer";
import { TileType } from "./types";
import { VisibilityMap, VisibilityState } from "./visibility";

export class VoidDungeonGame extends BaseGame {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	public dungeonInput: DungeonInputManager;
	public level: DungeonLevel;
	public player: Player;
	public visibility: VisibilityMap;
	public renderer: DungeonRenderer;
	public settingsOverlay: SettingsOverlay;

	private seed: string = "void-seed-1";
	private lastTime: number = 0;
	private storageKey: string = "void_dungeon_save_v2";

	constructor() {
		super();

		this.canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
		this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

		this.dungeonInput = new DungeonInputManager(this.input);

		// Generate initial level using BSP
		this.level = DungeonGenerator.generate(40, 30, this.seed);
		this.visibility = new VisibilityMap(this.level.width, this.level.height);

		// Spawn player at generated spawn tile
		this.player = new Player(this.level.spawnTile.x, this.level.spawnTile.y);
		this.setupPlayerCallbacks();

		this.renderer = new DungeonRenderer(this.canvas, this.ctx);

		this.settingsOverlay = new SettingsOverlay({
			gameId: "void_dungeon",
			inputManager: this.input,
			onRestart: () => this.restartGame(),
		});

		this.resizeCanvas();
		window.addEventListener("resize", () => this.resizeCanvas());

		// Wire Victory Modal next button
		const nextBtn = document.getElementById("btn-next-dungeon");
		if (nextBtn) {
			nextBtn.addEventListener("click", () => {
				const winModal = document.getElementById("win-modal");
				if (winModal) winModal.style.display = "none";
				this.restartGame();
			});
		}

		// F5 state persistence setup
		this.loadSavedState();
		window.addEventListener("beforeunload", () => this.saveState());

		this.updateHUD();

		// Start game loop
		this.isStarted = true;
		requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
	}

	private setupPlayerCallbacks(): void {
		this.player.onKeyPickup = (_color: string) => {
			this.updateHUD();
		};

		this.player.onWin = () => {
			this.isPaused = true;
			const winModal = document.getElementById("win-modal");
			if (winModal) winModal.style.display = "flex";
		};
	}

	private resizeCanvas(): void {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	protected override onKeyDown(e: KeyboardEvent): void {
		// Alt + Number Mode Switching
		if (e.altKey) {
			if (e.code === "Digit1" || e.key === "1") {
				e.preventDefault();
				this.renderer.modes.fogEnabled = true;
				this.showModeNotification("Mode 1: Normal Gameplay (Fog Active)");
			} else if (e.code === "Digit2" || e.key === "2") {
				e.preventDefault();
				this.renderer.modes.fogEnabled = false;
				this.showModeNotification("Mode 2: Debug Reveal All Map (Fog Off)");
			} else if (e.code === "Digit3" || e.key === "3") {
				e.preventDefault();
				this.renderer.modes.showGrid = !this.renderer.modes.showGrid;
				this.showModeNotification(
					`Mode 3: Grid Overlay ${this.renderer.modes.showGrid ? "ON" : "OFF"}`,
				);
			} else if (e.code === "Digit4" || e.key === "4") {
				e.preventDefault();
				this.renderer.modes.showESP = !this.renderer.modes.showESP;
				this.showModeNotification(
					`Mode 4: Key/Exit ESP ${this.renderer.modes.showESP ? "ON" : "OFF"}`,
				);
			}
		}
	}

	private showModeNotification(msg: string): void {
		const hudMode = document.getElementById("hud-mode");
		if (hudMode) {
			hudMode.textContent = msg;
			hudMode.style.opacity = "1";
			setTimeout(() => {
				if (hudMode) hudMode.style.opacity = "0.7";
			}, 2500);
		}
	}

	private restartGame(): void {
		const winModal = document.getElementById("win-modal");
		if (winModal) winModal.style.display = "none";

		this.isPaused = false;
		this.seed = `void-${Math.floor(Math.random() * 10000)}`;
		this.level = DungeonGenerator.generate(40, 30, this.seed);
		this.visibility = new VisibilityMap(this.level.width, this.level.height);
		this.player = new Player(this.level.spawnTile.x, this.level.spawnTile.y);
		this.setupPlayerCallbacks();

		sessionStorage.removeItem(this.storageKey);
		this.updateHUD();
	}

	private updateHUD(): void {
		const seedEl = document.getElementById("hud-seed");
		if (seedEl) seedEl.textContent = this.seed;

		const keysEl = document.getElementById("hud-keys");
		if (keysEl) keysEl.textContent = `${this.player.collectedKeys.size} / 3`;

		// Toggle key slot active badges
		const redBadge = document.getElementById("key-red");
		if (redBadge) {
			redBadge.classList.toggle("active", this.player.collectedKeys.has("red"));
		}

		const blueBadge = document.getElementById("key-blue");
		if (blueBadge) {
			blueBadge.classList.toggle(
				"active",
				this.player.collectedKeys.has("blue"),
			);
		}

		const greenBadge = document.getElementById("key-green");
		if (greenBadge) {
			greenBadge.classList.toggle(
				"active",
				this.player.collectedKeys.has("green"),
			);
		}
	}

	private saveState(): void {
		try {
			const revealedGrid: boolean[][] = [];
			for (let y = 0; y < this.visibility.height; y++) {
				const row: boolean[] = [];
				for (let x = 0; x < this.visibility.width; x++) {
					row.push(
						this.visibility.getVisibility(x, y) !== VisibilityState.UNSEEN,
					);
				}
				revealedGrid.push(row);
			}

			const saveData = {
				seed: this.seed,
				player: this.player.getState(),
				revealedGrid,
				modes: this.renderer.modes,
				collectedKeyIds: Array.from(this.player.collectedKeys),
				timestamp: Date.now(),
			};
			sessionStorage.setItem(this.storageKey, JSON.stringify(saveData));
		} catch (_e) {}
	}

	private loadSavedState(): void {
		try {
			const raw = sessionStorage.getItem(this.storageKey);
			if (raw) {
				const saveData = JSON.parse(raw);
				if (saveData.seed) {
					this.seed = saveData.seed;
					this.level = DungeonGenerator.generate(40, 30, this.seed);
					this.visibility = new VisibilityMap(
						this.level.width,
						this.level.height,
					);
				}
				if (saveData.player) {
					this.player.setState(saveData.player);
				}
				if (saveData.collectedKeyIds) {
					for (const keyId of saveData.collectedKeyIds) {
						this.player.collectedKeys.add(keyId);
						const kEntity = this.level.entities.keys.find(
							(k) => k.color === keyId,
						);
						if (kEntity) {
							kEntity.collected = true;
							this.level.setTile(kEntity.tileX, kEntity.tileY, TileType.FLOOR);
						}
					}
					if (this.player.collectedKeys.size >= 3) {
						this.level.setTile(
							this.level.exitTile.x,
							this.level.exitTile.y,
							TileType.EXIT_OPEN,
						);
					}
				}
				if (saveData.revealedGrid) {
					for (let y = 0; y < this.visibility.height; y++) {
						for (let x = 0; x < this.visibility.width; x++) {
							if (saveData.revealedGrid[y]?.[x]) {
								this.visibility.setVisibility(x, y, VisibilityState.REVEALED);
							}
						}
					}
				}
				if (saveData.modes) {
					this.renderer.modes = saveData.modes;
				}
			}
		} catch (_e) {}
	}

	private gameLoop(timestamp: number): void {
		if (!this.lastTime) this.lastTime = timestamp;
		const dt = Math.min(0.1, (timestamp - this.lastTime) / 1000);
		this.lastTime = timestamp;

		if (!this.isPaused && this.isStarted) {
			this.dungeonInput.update();
			this.input.update(dt);

			const move = this.dungeonInput.getMovement();
			const aim = this.dungeonInput.getAimDirection();
			const sonar = this.dungeonInput.isShootPressed();

			this.player.update(dt, move, aim, this.level);

			// Compute fog of war & vision cone
			this.visibility.computeVisibility(
				this.player.tileX,
				this.player.tileY,
				this.player.aimDirection,
				this.level,
				sonar,
			);

			this.renderer.updateCamera(this.player);
		}

		this.renderer.render(
			this.level,
			this.player,
			this.visibility,
			timestamp / 1000,
		);

		requestAnimationFrame((ts) => this.gameLoop(ts));
	}
}

window.addEventListener("DOMContentLoaded", () => {
	new VoidDungeonGame();
});
