import { BaseGame } from "../../../shared/baseGame";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { DungeonInputManager } from "./input";
import { DungeonLevel } from "./level";
import { Player } from "./player";
import { DungeonRenderer } from "./renderer";

export class VoidDungeonGame extends BaseGame {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	public dungeonInput: DungeonInputManager;
	public level: DungeonLevel;
	public player: Player;
	public renderer: DungeonRenderer;
	public settingsOverlay: SettingsOverlay;

	private lastTime: number = 0;
	private storageKey: string = "void_dungeon_save_v1";

	constructor() {
		super();

		this.canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
		this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

		this.dungeonInput = new DungeonInputManager(this.input);
		this.level = new DungeonLevel(20, 15);
		this.player = new Player(2, 2);
		this.renderer = new DungeonRenderer(this.canvas, this.ctx);

		this.settingsOverlay = new SettingsOverlay({
			gameId: "void_dungeon",
			inputManager: this.input,
			onRestart: () => this.restartGame(),
		});

		this.resizeCanvas();
		window.addEventListener("resize", () => this.resizeCanvas());

		// F5 state persistence setup
		this.loadSavedState();
		window.addEventListener("beforeunload", () => this.saveState());

		// Start game loop
		this.isStarted = true;
		requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
	}

	private resizeCanvas(): void {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	protected override onKeyDown(e: KeyboardEvent): void {
		if (e.code === "KeyF" || e.key === "F3") {
			this.renderer.debugMode = !this.renderer.debugMode;
			const debugHud = document.getElementById("hud-debug");
			if (debugHud) {
				debugHud.style.display = this.renderer.debugMode ? "flex" : "none";
			}
		}
	}

	private restartGame(): void {
		this.level.initSampleRoom();
		this.player = new Player(2, 2);
		sessionStorage.removeItem(this.storageKey);
	}

	private saveState(): void {
		try {
			const saveData = {
				player: this.player.getState(),
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
				if (saveData.player) {
					this.player.setState(saveData.player);
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

			this.player.update(dt, move, aim, this.level);
			this.renderer.updateCamera(this.player);
		}

		this.renderer.render(this.level, this.player);

		requestAnimationFrame((ts) => this.gameLoop(ts));
	}
}

window.addEventListener("DOMContentLoaded", () => {
	new VoidDungeonGame();
});
