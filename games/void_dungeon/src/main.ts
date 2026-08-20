import { BaseGame } from "../../../shared/baseGame";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { DungeonGenerator } from "./dungeon_gen";
import { type EditorTool, LevelEditor } from "./editor";
import { EnemyManager } from "./enemyManager";
import { DungeonInputManager } from "./input";
import type { DungeonLevel } from "./level";
import { MinimapRenderer } from "./minimap";
import { Player } from "./player";
import { DungeonRenderer } from "./renderer";
import { TILE_SIZE, TileType } from "./types";
import { VisibilityMap, VisibilityState } from "./visibility";

export class VoidDungeonGame extends BaseGame {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	public dungeonInput: DungeonInputManager;
	public level: DungeonLevel;
	public player: Player;
	public visibility: VisibilityMap;
	public renderer: DungeonRenderer;
	public enemyManager: EnemyManager;
	public minimapRenderer?: MinimapRenderer;
	public editor: LevelEditor;
	public settingsOverlay: SettingsOverlay;

	private seed: string = "void-seed-1";
	private lastTime: number = 0;
	private storageKey: string = "void_dungeon_save_v2";

	constructor() {
		super();

		this.canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
		this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

		this.dungeonInput = new DungeonInputManager(this.input);
		this.editor = new LevelEditor();
		this.enemyManager = new EnemyManager();

		// Generate initial level using BSP
		this.level = DungeonGenerator.generate(40, 30, this.seed);
		this.visibility = new VisibilityMap(this.level.width, this.level.height);
		this.enemyManager.spawnEnemies(this.level, 8);

		// Spawn player at generated spawn tile
		this.player = new Player(this.level.spawnTile.x, this.level.spawnTile.y);
		this.setupPlayerCallbacks();

		this.renderer = new DungeonRenderer(this.canvas, this.ctx);

		const minimapCanvas = document.getElementById(
			"minimapCanvas",
		) as HTMLCanvasElement;
		if (minimapCanvas) {
			this.minimapRenderer = new MinimapRenderer(minimapCanvas);
		}

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

		this.setupModeBadges();
		this.setupRegenHoldButton();
		this.setupEditorUI();

		// F5 state persistence setup
		this.loadSavedState();
		window.addEventListener("beforeunload", () => this.saveState());

		this.updateHUD();

		// Start game loop
		this.isStarted = true;
		requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
	}

	private setupModeBadges(): void {
		for (let i = 1; i <= 4; i++) {
			const btn = document.getElementById(`btn-mode-${i}`);
			if (btn) {
				btn.addEventListener("click", () => this.setMode(i));
			}
		}
	}

	private setupRegenHoldButton(): void {
		const regenBtn = document.getElementById("btn-regen-map");
		const regenBar = document.getElementById("regen-bar");
		const regenText = document.getElementById("regen-text");

		if (!regenBtn || !regenBar || !regenText) return;

		let holdStartTime = 0;
		let holdTimer: number | null = null;
		const HOLD_DURATION = 3000; // 3 seconds in ms

		const resetHold = () => {
			if (holdTimer !== null) {
				cancelAnimationFrame(holdTimer);
				holdTimer = null;
			}
			holdStartTime = 0;
			regenBar.style.width = "0%";
			regenText.textContent = "🎲 Hold to Reset Map (3s)";
		};

		const updateHold = (now: number) => {
			if (holdStartTime === 0) return;
			const elapsed = now - holdStartTime;
			const progress = Math.min(1, elapsed / HOLD_DURATION);

			regenBar.style.width = `${progress * 100}%`;
			const remaining = Math.max(0, (HOLD_DURATION - elapsed) / 1000).toFixed(
				1,
			);
			regenText.textContent = `Hold... ${remaining}s`;

			if (progress >= 1) {
				resetHold();
				this.restartGame();
				this.showModeNotification("New Dungeon Generated! 🎲");
			} else {
				holdTimer = requestAnimationFrame(updateHold);
			}
		};

		const startHold = (e: Event) => {
			e.preventDefault();
			resetHold();
			holdStartTime = performance.now();
			holdTimer = requestAnimationFrame(updateHold);
		};

		regenBtn.addEventListener("mousedown", startHold);
		regenBtn.addEventListener("touchstart", startHold, { passive: false });

		regenBtn.addEventListener("mouseup", resetHold);
		regenBtn.addEventListener("mouseleave", resetHold);
		regenBtn.addEventListener("touchend", resetHold);
		regenBtn.addEventListener("touchcancel", resetHold);
	}

	private setupEditorUI(): void {
		const toggleBtn = document.getElementById("btn-toggle-editor");
		if (toggleBtn) {
			toggleBtn.addEventListener("click", () => {
				const active = this.editor.toggle();
				this.showModeNotification(
					active ? "🛠️ Level Editor Enabled" : "🎮 Level Editor Disabled",
				);
			});
		}

		// Tool palette selection
		const toolBtns = document.querySelectorAll(".editor-tool-btn");
		toolBtns.forEach((btn) => {
			btn.addEventListener("click", () => {
				const toolStr = btn.getAttribute("data-tool");
				if (toolStr) {
					const numericTool = Number.parseInt(toolStr, 10);
					this.editor.setTool(
						Number.isNaN(numericTool)
							? (toolStr as EditorTool)
							: (numericTool as unknown as EditorTool),
					);
				}
			});
		});

		// Export JSON
		const exportBtn = document.getElementById("btn-editor-export");
		if (exportBtn) {
			exportBtn.addEventListener("click", () => {
				const json = this.editor.exportJSON(this.level, this.seed);
				const blob = new Blob([json], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `void_dungeon_${this.seed}.json`;
				a.click();
				URL.revokeObjectURL(url);
				this.showModeNotification("Level Exported to JSON! 💾");
			});
		}

		// Import JSON
		const importBtn = document.getElementById("btn-editor-import");
		const fileInput = document.getElementById(
			"editor-file-input",
		) as HTMLInputElement;

		if (importBtn && fileInput) {
			importBtn.addEventListener("click", () => fileInput.click());
			fileInput.addEventListener("change", (e) => {
				const file = (e.target as HTMLInputElement).files?.[0];
				if (file) {
					const reader = new FileReader();
					reader.onload = (event) => {
						const jsonText = event.target?.result as string;
						if (
							jsonText &&
							this.editor.importJSON(jsonText, this.level, this.player)
						) {
							this.visibility.resetAll();
							this.updateHUD();
							this.showModeNotification("Custom Level Imported! 📂");
						} else {
							this.showModeNotification("Failed to parse level JSON ❌");
						}
					};
					reader.readAsText(file);
				}
			});
		}

		// Canvas mouse/pointer paint listeners
		this.canvas.addEventListener("pointerdown", (e) => {
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			this.editor.onPointerDown(
				px,
				py,
				this.renderer.cameraX,
				this.renderer.cameraY,
				this.level,
				this.player,
			);
		});

		this.canvas.addEventListener("pointermove", (e) => {
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			this.editor.onPointerMove(
				px,
				py,
				this.renderer.cameraX,
				this.renderer.cameraY,
				this.level,
				this.player,
			);
		});

		window.addEventListener("pointerup", () => this.editor.onPointerUp());
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
		if (e.code === "KeyE") {
			e.preventDefault();
			const active = this.editor.toggle();
			this.showModeNotification(
				active ? "🛠️ Level Editor Enabled" : "🎮 Level Editor Disabled",
			);
			return;
		}

		// Support 1/2/3/4 keys both with or without Alt key modifier
		if (e.code === "Digit1" || e.code === "Numpad1" || e.key === "1") {
			e.preventDefault();
			this.setMode(1);
		} else if (e.code === "Digit2" || e.code === "Numpad2" || e.key === "2") {
			e.preventDefault();
			this.setMode(2);
		} else if (e.code === "Digit3" || e.code === "Numpad3" || e.key === "3") {
			e.preventDefault();
			this.setMode(3);
		} else if (e.code === "Digit4" || e.code === "Numpad4" || e.key === "4") {
			e.preventDefault();
			this.setMode(4);
		}
	}

	public setMode(modeNum: number): void {
		if (modeNum === 1) {
			this.renderer.modes.fogEnabled = true;
			this.showModeNotification("Mode 1: Normal Gameplay (Fog Active)");
		} else if (modeNum === 2) {
			this.renderer.modes.fogEnabled = false;
			this.showModeNotification("Mode 2: Debug Reveal All Map (Fog Off)");
		} else if (modeNum === 3) {
			this.renderer.modes.showGrid = !this.renderer.modes.showGrid;
			this.showModeNotification(
				`Mode 3: Grid Overlay ${this.renderer.modes.showGrid ? "ON" : "OFF"}`,
			);
		} else if (modeNum === 4) {
			this.renderer.modes.showESP = !this.renderer.modes.showESP;
			this.showModeNotification(
				`Mode 4: Key/Exit ESP ${this.renderer.modes.showESP ? "ON" : "OFF"}`,
			);
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
		this.enemyManager.spawnEnemies(this.level, 8);

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
				crates: this.level.crateManager
					? this.level.crateManager.crates.map((c) => ({
							id: c.id,
							tileX: c.tileX,
							tileY: c.tileY,
						}))
					: [],
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
				if (saveData.crates && this.level.crateManager) {
					this.level.crateManager.clear();
					for (const c of saveData.crates) {
						this.level.crateManager.addCrate(c.id, c.tileX, c.tileY);
					}
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
			const interact = this.dungeonInput.isInteractPressed();

			if (this.level.crateManager) {
				this.level.crateManager.update(dt, this.level);
			}

			if (this.level.lightingManager) {
				this.level.lightingManager.update(
					dt,
					this.level.width * TILE_SIZE,
					this.level.height * TILE_SIZE,
				);
			}

			this.player.update(dt, move, aim, this.level, interact);

			// Update Enemies & Magic Projectiles
			this.enemyManager.update(dt, this.level);

			// Shooting Magic Bolts (Space / Enter / Shift) with hard 90° auto-aim
			if (sonar || interact || this.input.isKeyPressed("Space")) {
				this.enemyManager.fireMagicBolt(this.player, this.level);
			}

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
			this.enemyManager,
		);

		if (this.editor.active) {
			this.editor.renderCursor(
				this.ctx,
				this.renderer.cameraX,
				this.renderer.cameraY,
				this.input.mouseX,
				this.input.mouseY,
			);
		}

		if (this.minimapRenderer) {
			this.minimapRenderer.render(
				this.level,
				this.player,
				this.visibility,
				this.level.crateManager ? this.level.crateManager.crates : [],
				this.renderer.modes,
			);
		}

		requestAnimationFrame((ts) => this.gameLoop(ts));
	}
}

window.addEventListener("DOMContentLoaded", () => {
	new VoidDungeonGame();
});
