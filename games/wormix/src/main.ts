import { SharedAudioManager } from "../../../shared/audioManager";
import { SharedInputManager } from "../../../shared/inputManager";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { AITurnController } from "./ai/aiTurnController";
import { createPlanner, WormAI } from "./ai/wormAI";
import { WeaponController } from "./controllers/weaponController";
import { MapEditor } from "./editor/mapEditor";
import { EffectSystem } from "./effects/effects";
import { CameraController } from "./engine/cameraController";
import { TurnController } from "./engine/turnController";
import { MapObject } from "./entities/mapObject";
import { Worm } from "./entities/worm";
import { Projectile } from "./physics/projectile";
import { MatchRenderer } from "./renderer/matchRenderer";
import { TerrainManager } from "./terrain/terrainManager";
import type {
	CustomMapData,
	LobbyConfig,
	MatchSaveData,
	TeamAmmo,
	WeaponId,
} from "./types";
import { WORLD_HEIGHT, WORLD_WIDTH } from "./types";
import { HUD, WEAPON_LIST } from "./ui/hud";
import { MapManager } from "./ui/mapManager";
import { MenuModal } from "./ui/menuModal";

export class WormixGame {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	private inputManager: SharedInputManager;
	private settingsOverlay: SettingsOverlay;
	private audioManager: SharedAudioManager;
	private hud: HUD;
	private menuModal: MenuModal;
	private mapEditor: MapEditor | null = null;
	private mapManager: MapManager | null = null;
	private effects: EffectSystem;

	// Sub-controllers
	public camera: CameraController;
	public turnCtrl: TurnController;
	public weaponCtrl: WeaponController;
	public aiTurnCtrl: AITurnController;
	public renderer: MatchRenderer;

	public terrain: TerrainManager;
	public worms: Worm[] = [];
	public mapObjects: MapObject[] = [];
	public projectiles: Projectile[] = [];

	public editingMap: CustomMapData | null = null;

	// 30 FPS Lock Loop Variables
	private lastTickTime: number = 0;
	private readonly frameInterval: number = 1000 / 30; // 33.33ms

	constructor() {
		this.canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
		this.ctx = this.canvas.getContext("2d")!;

		this.inputManager = new SharedInputManager();
		this.audioManager = new SharedAudioManager();
		this.hud = new HUD();
		this.effects = new EffectSystem();
		this.terrain = new TerrainManager(WORLD_WIDTH, WORLD_HEIGHT);

		this.camera = new CameraController();
		this.turnCtrl = new TurnController();
		this.weaponCtrl = new WeaponController();
		this.aiTurnCtrl = new AITurnController();
		this.renderer = new MatchRenderer();

		// Initialize Settings Overlay with custom Game Modes & Map Editor actions
		this.settingsOverlay = new SettingsOverlay({
			gameId: "wormix",
			inputManager: this.inputManager,
			customGameOptionsHtml: `
        <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
          <button class="gm-action-btn primary" id="gm-btn-lobby" style="background: linear-gradient(135deg, #16a34a, #22c55e);">⚔️ Match Lobby & Game Modes</button>
          <button class="gm-action-btn secondary" id="gm-btn-editor" style="background: linear-gradient(135deg, #7c3aed, #8b5cf6);">🛠️ Map Editor</button>
        </div>
      `,
			onBindCustomOptions: (container) => {
				container
					.querySelector("#gm-btn-lobby")
					?.addEventListener("click", () => {
						this.settingsOverlay.toggle();
						this.menuModal.show();
					});
				container
					.querySelector("#gm-btn-editor")
					?.addEventListener("click", () => {
						this.settingsOverlay.toggle();
						this.openMapEditor(this.editingMap || undefined);
					});
			},
		});

		// Initialize Main Menu Modal
		this.menuModal = new MenuModal(
			(config, mapData) => this.startMatch(config, mapData),
			() => this.openMapEditor(),
			() => this.openMapManager(),
			(saveData) => this.loadMatchState(saveData),
		);

		// Initialize Map Manager
		this.mapManager = new MapManager(
			(map) => this.openMapEditor(map),
			() => this.menuModal.show(),
		);

		this.resizeCanvas();
		window.addEventListener("resize", () => this.resizeCanvas());

		this.setupInputs();

		// Start locked 30 FPS loop
		requestAnimationFrame((ts) => this.gameLoop(ts));
	}

	private resizeCanvas(): void {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	private returnToEditorBtn: HTMLElement | null = null;
	private lobbyBtn: HTMLElement | null = null;

	public getActiveWorm(): Worm | null {
		return this.turnCtrl.getActiveWorm(this.worms);
	}

	public openMapEditor(initialMap?: CustomMapData): void {
		this.hideReturnToEditorBtn();
		this.hideLobbyBtn();
		if (this.mapEditor) {
			this.mapEditor.exit();
			this.mapEditor = null;
		}
		this.turnCtrl.phase = "EDITOR";
		const targetMap = initialMap || this.editingMap || undefined;
		this.mapEditor = new MapEditor(
			this.canvas,
			(customMap) => {
				this.editingMap = customMap;
				if (this.mapEditor) this.mapEditor.exit();
				this.startMatch(this.turnCtrl.lobbyConfig, customMap, true);
			},
			() => {
				this.mapEditor = null;
				this.turnCtrl.phase = "MENU";
				this.menuModal.show();
			},
			targetMap,
		);
	}

	public openMapManager(): void {
		if (this.mapManager) {
			this.mapManager.show();
		}
	}

	public startMatch(
		config: LobbyConfig,
		mapData?: CustomMapData,
		isTestPlay: boolean = false,
	): void {
		this.menuModal.hide();
		this.turnCtrl.lobbyConfig = config;
		this.turnCtrl.aiDifficulty = config.aiDifficulty;

		if (this.mapEditor) {
			this.mapEditor.exit();
			this.mapEditor = null;
		}

		if (isTestPlay) {
			this.showReturnToEditorBtn();
		} else {
			this.hideReturnToEditorBtn();
		}

		this.showLobbyBtn();

		// 1. Terrain Setup
		if (mapData?.terrainHeights && mapData.terrainHeights.length > 0) {
			const mw = mapData.width || WORLD_WIDTH;
			const mh = mapData.height || WORLD_HEIGHT;
			this.terrain.resize(mw, mh);
			this.terrain.waterY = mapData.waterY || mh - 40;
			this.terrain.buildTerrainFromHeights(
				mapData.terrainHeights,
				mapData.waterY,
				mapData.terrainMaterials,
				mapData.gridData,
			);
		} else {
			this.terrain.resize(WORLD_WIDTH, WORLD_HEIGHT);
		}

		// Reset camera
		this.camera.resetToFit(
			this.canvas.width,
			this.canvas.height,
			this.terrain.width,
			this.terrain.height,
		);

		// 2. Initialize Worm Teams
		this.worms = [];
		const teamSize = config.teamSize;
		const hp = config.wormHealth;

		const playerSpawns =
			mapData?.spawnPoints?.filter((sp) => sp.team === "player") || [];
		const aiSpawns =
			mapData?.spawnPoints?.filter((sp) => sp.team === "ai") || [];

		for (let i = 0; i < teamSize; i++) {
			const redX = playerSpawns[i]?.x || this.terrain.width * (0.15 + i * 0.12);
			const redY = playerSpawns[i]?.y ?? this.terrain.getSurfaceY(redX) - 12;
			const redWorm = new Worm(`p_${i}`, `Red #${i + 1}`, "player", redX, redY);
			redWorm.health = hp;
			redWorm.maxHealth = hp;
			this.worms.push(redWorm);

			const blueX = aiSpawns[i]?.x || this.terrain.width * (0.65 + i * 0.12);
			const blueY = aiSpawns[i]?.y ?? this.terrain.getSurfaceY(blueX) - 12;
			const blueWorm = new Worm(
				`ai_${i}`,
				`Blue #${i + 1}`,
				"ai",
				blueX,
				blueY,
			);
			blueWorm.health = hp;
			blueWorm.maxHealth = hp;
			this.worms.push(blueWorm);
		}

		this.aiTurnCtrl.rollPersonalities(
			this.worms,
			config.redAiDifficulty ?? "normal",
			config.blueAiDifficulty ?? config.aiDifficulty ?? "normal",
			config.matchType,
		);

		// 3. Initialize Interactive Map Objects
		this.mapObjects = [];
		if (mapData?.mapObjects && mapData.mapObjects.length > 0) {
			mapData.mapObjects.forEach((objData) => {
				this.mapObjects.push(new MapObject(objData));
			});
		} else {
			const objSpawns = [
				{ type: "barrel" as const, x: this.terrain.width * 0.3 },
				{ type: "barrel" as const, x: this.terrain.width * 0.7 },
				{ type: "landmine" as const, x: this.terrain.width * 0.5 },
				{ type: "health_crate" as const, x: this.terrain.width * 0.45 },
			];
			objSpawns.forEach((s) => {
				this.mapObjects.push(
					new MapObject({
						id: `obj_${Math.random()}`,
						type: s.type,
						x: s.x,
						y: this.terrain.getSurfaceY(s.x) - 14,
					}),
				);
			});
		}

		this.projectiles = [];
		this.turnCtrl.activeWormIndex = 0;
		this.turnCtrl.playerWeaponIndex = 0;
		this.weaponCtrl.activeWeaponIndex = 0;
		this.turnCtrl.turnCount = 0;
		this.turnCtrl.phase = "MOVE";
		this.turnCtrl.turnTimer = 45.0;
		this.aiTurnCtrl.resetTurnState();
		this.aiTurnCtrl.showDecisionOverlay(false);

		this.weaponCtrl.resetAmmo();
		this.turnCtrl.updateWind();
	}

	private spawnProjectileTrail(proj: Projectile): void {
		switch (proj.weaponId) {
			case "bazooka":
				this.effects.spawnSmoke(
					proj.x,
					proj.y,
					-proj.vx * 0.1,
					-proj.vy * 0.1,
					3 + Math.random() * 2,
				);
				break;
			case "mortar":
				this.effects.spawnSmoke(
					proj.x,
					proj.y,
					-proj.vx * 0.1,
					-proj.vy * 0.1,
					2.5 + Math.random() * 1.5,
				);
				break;
			case "drill":
				if (proj.age % 2 === 0) {
					this.effects.spawnSparks(proj.x, proj.y, 1, 0.5, 3, "#a5b4fc");
				}
				break;
			case "acid_bomb":
				if (proj.age % 3 === 0) {
					this.effects.spawnAcidDrip(proj.x, proj.y);
				}
				break;
			default:
				break;
		}
	}

	public spawnExplosionFx(
		x: number,
		y: number,
		weaponId: WeaponId | null,
		radiusOverride?: number,
	): void {
		const radius =
			radiusOverride ??
			(weaponId === "bazooka"
				? 42
				: weaponId === "cluster"
					? 30
					: weaponId === "drill"
						? 35
						: weaponId === "dynamite"
							? 65
							: weaponId === "acid_bomb"
								? 20
								: weaponId === "mortar"
									? 15
									: 38);

		if (weaponId === "rifle") {
			this.effects.spawnFlash(x, y, 10);
			this.effects.spawnSparks(x, y, 10, 1, 4, "#67e8f9");
			return;
		}
		if (weaponId === "acid_bomb") {
			this.effects.spawnFlash(x, y, radius);
			this.effects.spawnShockwave(x, y, radius);
			for (let i = 0; i < 12; i++) {
				this.effects.spawnAcidDrip(x, y);
			}
			return;
		}
		if (weaponId === "sand_bomb") {
			this.effects.spawnFlash(x, y, radius);
			for (let i = 0; i < 14; i++) {
				this.effects.spawnSandPuff(x, y);
			}
			return;
		}

		this.effects.spawnFlash(x, y, radius);
		this.effects.spawnFireball(x, y, radius);
		this.effects.spawnShockwave(x, y, radius);
		for (let i = 0; i < 6; i++) {
			const a = Math.random() * Math.PI * 2;
			this.effects.spawnSmoke(
				x + Math.cos(a) * radius * 0.3,
				y + Math.sin(a) * radius * 0.3,
				Math.cos(a) * 1.5,
				-Math.random() * 1.5,
				radius * 0.12 + 3,
			);
		}
	}

	private setupInputs(): void {
		window.addEventListener("keydown", (e) => {
			if (e.code === "KeyC") {
				this.inputManager.reCenter();
				return;
			}
			if (e.code === "Escape") {
				if (this.turnCtrl.phase === "EDITOR") return;
				this.settingsOverlay.toggle();
				return;
			}

			if (this.turnCtrl.phase === "MENU" || this.turnCtrl.phase === "EDITOR")
				return;

			// Camera zoom
			if (e.code === "Equal" || e.code === "NumpadAdd") {
				this.camera.zoomIn();
				return;
			}
			if (e.code === "Minus" || e.code === "NumpadSubtract") {
				this.camera.zoomOut();
				return;
			}

			// Focus camera on active worm (F key)
			if (e.code === "KeyF") {
				this.camera.focusOnWorm(this.getActiveWorm());
				return;
			}

			// Toggle AI Debug Mode (F3 key)
			if (e.code === "F3") {
				e.preventDefault();
				this.aiTurnCtrl.isAiDebugMode = !this.aiTurnCtrl.isAiDebugMode;
				this.aiTurnCtrl.aiDebugFrozen = false;
				this.audioManager.playTone(800, 0.08, "sine");
				return;
			}

			// Enter key to step/unfreeze AI in Debug Mode
			if (e.code === "Enter" && this.aiTurnCtrl.aiDebugFrozen) {
				e.preventDefault();
				this.aiTurnCtrl.aiDebugFrozen = false;
				this.audioManager.playTone(700, 0.08, "sine");
				return;
			}

			// Number Keys 1-9 to select weapons
			if (e.code.startsWith("Digit")) {
				const num = Number.parseInt(e.code.replace("Digit", ""), 10);
				if (num >= 1 && num <= WEAPON_LIST.length) {
					const idx = num - 1;
					const activeWorm = this.getActiveWorm();
					const team = activeWorm?.team ?? "player";
					const ammo = this.weaponCtrl.teamAmmo[team as "player" | "ai"];
					const wid = WEAPON_LIST[idx].id;
					if (wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0) {
						this.weaponCtrl.activeWeaponIndex = idx;
						if (team === "player") this.turnCtrl.playerWeaponIndex = idx;
						if (
							this.turnCtrl.phase === "MOVE" ||
							this.turnCtrl.phase === "WEAPON_SELECT" ||
							this.turnCtrl.phase === "AIM_FIRE"
						) {
							this.turnCtrl.phase = "AIM_FIRE";
						}
						this.audioManager.playTone(600, 0.04, "sine");
					}
				}
			}

			// 3-Step Turn Flow on Space Bar
			if (e.code === "Space" && !e.repeat) {
				const activeWorm = this.getActiveWorm();
				const matchType = this.turnCtrl.lobbyConfig.matchType;
				const isPvP = matchType === "pvp";
				const isBotVsBot = matchType === "bot_vs_bot";
				if (
					activeWorm &&
					!isBotVsBot &&
					(activeWorm.team === "player" || isPvP)
				) {
					if (this.turnCtrl.phase === "MOVE") {
						this.turnCtrl.phase = "WEAPON_SELECT";
						this.weaponCtrl.ensureActiveWeaponHasAmmo(activeWorm, (idx) => {
							this.turnCtrl.playerWeaponIndex = idx;
						});
						this.audioManager.playTone(440, 0.05, "sine");
					} else if (this.turnCtrl.phase === "WEAPON_SELECT") {
						this.turnCtrl.phase = "AIM_FIRE";
						this.audioManager.playTone(550, 0.05, "sine");
					} else if (this.turnCtrl.phase === "AIM_FIRE") {
						this.weaponCtrl.isCharging = true;
						this.weaponCtrl.chargePower = 0.0;
						this.audioManager.playTone(300, 0.1, "sawtooth");
					}
				}
			}

			// Back key (S / Down arrow in weapon select returns to move)
			if (
				(e.code === "KeyS" || e.code === "ArrowDown") &&
				this.turnCtrl.phase === "WEAPON_SELECT"
			) {
				this.turnCtrl.phase = "MOVE";
				this.audioManager.playTone(350, 0.05, "sine");
			}

			// Cycle weapons during WEAPON_SELECT
			if (this.turnCtrl.phase === "WEAPON_SELECT") {
				const activeWormTeam = this.getActiveWorm()?.team ?? "player";
				const ammo = this.weaponCtrl.teamAmmo[activeWormTeam];
				const hasAmmo = (wid: string) =>
					wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0;

				const startIdx = this.weaponCtrl.activeWeaponIndex;
				if (e.code === "KeyA" || e.code === "ArrowLeft") {
					do {
						this.weaponCtrl.activeWeaponIndex =
							(this.weaponCtrl.activeWeaponIndex - 1 + WEAPON_LIST.length) %
							WEAPON_LIST.length;
					} while (
						!hasAmmo(WEAPON_LIST[this.weaponCtrl.activeWeaponIndex].id) &&
						this.weaponCtrl.activeWeaponIndex !== startIdx
					);
					if (activeWormTeam === "player") {
						this.turnCtrl.playerWeaponIndex = this.weaponCtrl.activeWeaponIndex;
					}
					this.audioManager.playTone(600, 0.03, "sine");
				} else if (e.code === "KeyD" || e.code === "ArrowRight") {
					do {
						this.weaponCtrl.activeWeaponIndex =
							(this.weaponCtrl.activeWeaponIndex + 1) % WEAPON_LIST.length;
					} while (
						!hasAmmo(WEAPON_LIST[this.weaponCtrl.activeWeaponIndex].id) &&
						this.weaponCtrl.activeWeaponIndex !== startIdx
					);
					if (activeWormTeam === "player") {
						this.turnCtrl.playerWeaponIndex = this.weaponCtrl.activeWeaponIndex;
					}
					this.audioManager.playTone(600, 0.03, "sine");
				}
			}
		});

		window.addEventListener("keyup", (e) => {
			if (
				e.code === "Space" &&
				this.weaponCtrl.isCharging &&
				this.turnCtrl.phase === "AIM_FIRE"
			) {
				this.fireActiveWeapon();
			}
		});

		// Mouse Click Handler
		this.canvas.addEventListener("mousedown", (e) => {
			if (this.turnCtrl.phase === "MENU" || this.turnCtrl.phase === "EDITOR")
				return;
			const activeWorm = this.getActiveWorm();
			const matchType = this.turnCtrl.lobbyConfig.matchType;
			const isPvP = matchType === "pvp";
			const isBotVsBot = matchType === "bot_vs_bot";
			if (!activeWorm || isBotVsBot || (activeWorm.team !== "player" && !isPvP))
				return;

			const rect = this.canvas.getBoundingClientRect();
			const clickX = e.clientX - rect.left;
			const clickY = e.clientY - rect.top;

			if (clickY >= this.canvas.height - 80) {
				const cardW = 60;
				const gap = 8;
				const totalW = WEAPON_LIST.length * (cardW + gap) - gap;
				const startX = this.canvas.width / 2 - totalW / 2;
				if (clickX >= startX - 12 && clickX <= startX + totalW + 12) {
					const idx = Math.floor((clickX - startX) / (cardW + gap));
					if (idx >= 0 && idx < WEAPON_LIST.length) {
						const team = activeWorm.team;
						const ammo = this.weaponCtrl.teamAmmo[team];
						const wid = WEAPON_LIST[idx].id;
						if (wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0) {
							this.weaponCtrl.activeWeaponIndex = idx;
							if (team === "player") this.turnCtrl.playerWeaponIndex = idx;
							this.turnCtrl.phase = "AIM_FIRE";
							this.audioManager.playTone(600, 0.05, "sine");
							return;
						}
					}
				}
			}

			if (this.turnCtrl.phase === "MOVE") {
				this.turnCtrl.phase = "WEAPON_SELECT";
				this.weaponCtrl.ensureActiveWeaponHasAmmo(activeWorm, (idx) => {
					this.turnCtrl.playerWeaponIndex = idx;
				});
			} else if (this.turnCtrl.phase === "WEAPON_SELECT") {
				this.turnCtrl.phase = "AIM_FIRE";
			} else if (this.turnCtrl.phase === "AIM_FIRE") {
				this.weaponCtrl.isCharging = true;
				this.weaponCtrl.chargePower = 0.0;
			}
		});

		this.canvas.addEventListener("mouseup", () => {
			if (this.weaponCtrl.isCharging && this.turnCtrl.phase === "AIM_FIRE") {
				this.fireActiveWeapon();
			}
		});

		// Mouse Aiming
		this.canvas.addEventListener("mousemove", (e) => {
			if (this.turnCtrl.phase === "MENU" || this.turnCtrl.phase === "EDITOR")
				return;
			if (this.inputManager.settings.mode !== "pointer") return;
			const activeWorm = this.getActiveWorm();
			const matchType = this.turnCtrl.lobbyConfig.matchType;
			const isPvP = matchType === "pvp";
			const isBotVsBot = matchType === "bot_vs_bot";
			if (
				!activeWorm ||
				isBotVsBot ||
				(activeWorm.team !== "player" && !isPvP) ||
				this.turnCtrl.phase !== "AIM_FIRE"
			)
				return;

			const rect = this.canvas.getBoundingClientRect();
			const worldPos = this.camera.screenToWorld(
				e.clientX - rect.left,
				e.clientY - rect.top,
				this.canvas.width,
				this.canvas.height,
			);

			const dx = worldPos.x - activeWorm.x;
			const dy = worldPos.y - activeWorm.y;
			activeWorm.aimAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
			activeWorm.facingRight = dx >= 0;
		});
	}

	public fireActiveWeapon(): void {
		this.weaponCtrl.fireActiveWeapon(
			this.getActiveWorm(),
			this.worms,
			this.terrain,
			this.mapObjects,
			this.projectiles,
			this.effects,
			this.audioManager,
			(phase) => {
				this.turnCtrl.phase = phase;
			},
			(sec) => {
				this.turnCtrl.repositionTimer = sec;
			},
		);
	}

	private gameLoop(timestamp: number): void {
		if (!this.lastTickTime) this.lastTickTime = timestamp;
		const elapsed = timestamp - this.lastTickTime;

		if (elapsed >= this.frameInterval) {
			this.lastTickTime = timestamp - (elapsed % this.frameInterval);
			if (this.turnCtrl.phase === "EDITOR" && this.mapEditor) {
				this.mapEditor.render();
			} else if (this.turnCtrl.phase !== "MENU") {
				this.updateFixedTick();
				this.render();
			}
		}

		requestAnimationFrame((ts) => this.gameLoop(ts));
	}

	private updateFixedTick(): void {
		if (this.turnCtrl.lobbyConfig.gameMode === "rising_water") {
			this.terrain.waterY = Math.max(100, this.terrain.waterY - 0.08);
		}

		this.terrain.updatePhysics();

		for (const worm of this.worms) {
			worm.update(this.terrain);
		}

		// Update Map Objects
		for (let i = this.mapObjects.length - 1; i >= 0; i--) {
			const obj = this.mapObjects[i];
			obj.update(
				this.terrain,
				this.worms,
				(x, y, radius, damage) => {
					this.audioManager.playHit(2.5);
					this.terrain.explode(x, y, radius);
					this.spawnExplosionFx(x, y, null, radius);

					for (const w of this.worms) {
						if (w.isAlive) {
							const d = Math.hypot(w.x - x, w.y - y);
							if (d < radius + 15) {
								w.takeDamage(Math.floor(damage * (1 - d / (radius + 15))));
							}
						}
					}

					for (const other of this.mapObjects) {
						if (other !== obj && !other.isDestroyed) {
							const d = Math.hypot(other.x - x, other.y - y);
							if (d < radius + 30) {
								other.takeDamage(Math.floor(damage * 0.8));
							}
						}
					}
				},
				(worm, healAmount) => {
					this.audioManager.playWin();
					worm.health = Math.min(worm.maxHealth, worm.health + healAmount);
				},
			);

			if (obj.isDestroyed) {
				this.mapObjects.splice(i, 1);
			}
		}

		const activeWorm = this.getActiveWorm();
		const matchType = this.turnCtrl.lobbyConfig.matchType;
		const isPvP = matchType === "pvp";
		const isBotVsBot = matchType === "bot_vs_bot";
		const isHumanTurn =
			activeWorm?.isAlive &&
			!isBotVsBot &&
			(activeWorm.team === "player" || isPvP);

		if (isHumanTurn) {
			const keys = this.inputManager.keysPressed;

			if (this.turnCtrl.phase === "MOVE") {
				let dir = 0;
				if (keys.has("KeyA") || keys.has("ArrowLeft")) dir -= 1;
				if (keys.has("KeyD") || keys.has("ArrowRight")) dir += 1;

				const steer = this.inputManager.getSteeringValue();
				if (Math.abs(steer.x) > 0.2) dir = Math.sign(steer.x);

				activeWorm.walk(dir);

				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.jump();
					this.audioManager.playTone(500, 0.08, "sine");
				}
			}

			if (this.turnCtrl.phase === "AIM_FIRE") {
				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.aimAngle -= 2.5;
				}
				if (keys.has("KeyS") || keys.has("ArrowDown")) {
					activeWorm.aimAngle += 2.5;
				}

				const steer = this.inputManager.getSteeringValue();
				if (Math.abs(steer.y) > 0.2) {
					activeWorm.aimAngle += steer.y * 3.0;
				}

				if (this.weaponCtrl.isCharging) {
					this.weaponCtrl.chargePower += this.weaponCtrl.chargeSpeed;
					if (this.weaponCtrl.chargePower >= 1.0) {
						this.weaponCtrl.chargePower = 1.0;
						this.fireActiveWeapon();
					}
				}
			}

			this.turnCtrl.turnTimer -= 1 / 30;
			if (this.turnCtrl.turnTimer <= 0) {
				this.turnCtrl.turnTimer = 0;
				this.checkTurnEnd();
			}
		}

		// Allow human player to run & jump during projectile flight
		if (
			this.turnCtrl.phase === "PROJECTILE_FLIGHT" &&
			isHumanTurn &&
			activeWorm?.isAlive
		) {
			const keys = this.inputManager.keysPressed;
			let dir = 0;
			if (keys.has("KeyA") || keys.has("ArrowLeft")) dir -= 1;
			if (keys.has("KeyD") || keys.has("ArrowRight")) dir += 1;
			activeWorm.walk(dir);
			if (keys.has("KeyW") || keys.has("ArrowUp")) {
				activeWorm.jump();
			}
		}

		// REPOSITION Phase
		if (
			this.turnCtrl.phase === "REPOSITION" &&
			activeWorm &&
			activeWorm.isAlive
		) {
			this.turnCtrl.repositionTimer -= 1 / 30;

			if (this.turnCtrl.repositionTimer <= 0) {
				this.checkTurnEnd();
			} else if (isHumanTurn) {
				const keys = this.inputManager.keysPressed;
				let dir = 0;
				if (keys.has("KeyA") || keys.has("ArrowLeft")) dir -= 1;
				if (keys.has("KeyD") || keys.has("ArrowRight")) dir += 1;
				activeWorm.walk(dir);
				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.jump();
				}
			} else {
				if (this.aiTurnCtrl.aiReposTargetX === null) {
					this.aiTurnCtrl.aiReposTargetX =
						this.aiTurnCtrl.pickAiRepositionTarget(
							activeWorm,
							this.worms,
							this.terrain,
							this.mapObjects,
						);
				}
				if (Math.abs(this.aiTurnCtrl.aiReposTargetX - activeWorm.x) > 20) {
					const dir = this.aiTurnCtrl.aiReposTargetX > activeWorm.x ? 1 : -1;
					const nextX = activeWorm.x + dir * 30;
					if (
						this.terrain.getLocalGroundY(
							nextX,
							activeWorm.y + activeWorm.radius + 5,
							15,
							12,
						) !== null
					) {
						activeWorm.walk(dir);
						if (activeWorm.isGrounded && activeWorm.vx === 0) {
							activeWorm.jump();
						}
					} else {
						activeWorm.walk(0);
					}
				} else {
					activeWorm.walk(0);
				}
			}
		}

		// AI Turn Logic
		const isAiTurn =
			Boolean(activeWorm?.isAlive) &&
			(isBotVsBot || (!isPvP && activeWorm?.team === "ai"));

		this.aiTurnCtrl.showDecisionOverlay(isAiTurn && this.aiTurnCtrl.aiThinking);

		if (isAiTurn && activeWorm) {
			const activeWormDiff =
				activeWorm.team === "player"
					? (this.turnCtrl.lobbyConfig.redAiDifficulty ?? "normal")
					: (this.turnCtrl.lobbyConfig.blueAiDifficulty ??
						this.turnCtrl.lobbyConfig.aiDifficulty ??
						"normal");

			if (
				!this.aiTurnCtrl.aiDebugFrozen &&
				(this.turnCtrl.phase === "MOVE" ||
					this.turnCtrl.phase === "WEAPON_SELECT" ||
					this.turnCtrl.phase === "AIM_FIRE")
			) {
				this.turnCtrl.turnTimer -= 1 / 30;
				if (this.turnCtrl.turnTimer <= 0) {
					this.turnCtrl.turnTimer = 0;
					this.aiTurnCtrl.forceFinishAiTurn(
						activeWorm,
						() => this.fireActiveWeapon(),
						(idx) => {
							this.weaponCtrl.activeWeaponIndex = idx;
						},
						(p) => {
							this.weaponCtrl.chargePower = p;
						},
						(phase) => {
							this.turnCtrl.phase = phase;
						},
					);
				}
			}

			// Decision phase
			if (this.turnCtrl.phase === "MOVE" && !this.aiTurnCtrl.aiPlan) {
				if (!this.aiTurnCtrl.aiPlanner) {
					this.aiTurnCtrl.aiPlanner = createPlanner({
						aiWorm: activeWorm,
						allWorms: this.worms,
						terrain: this.terrain,
						mapObjects: this.mapObjects,
						windX: this.turnCtrl.windX,
						difficulty: activeWormDiff,
						personality:
							this.aiTurnCtrl.aiPersonalities[activeWorm.id] ?? "default",
						availableAmmo: this.weaponCtrl.teamAmmo[activeWorm.team],
						gameMode: this.turnCtrl.lobbyConfig.gameMode,
					});
					this.aiTurnCtrl.aiThinking = true;
				}
				this.aiTurnCtrl.aiPlanner.step(16);
				if (this.aiTurnCtrl.aiPlanner.isDone) {
					this.aiTurnCtrl.aiPlan = this.aiTurnCtrl.aiPlanner.getPlan();
					this.aiTurnCtrl.lastAiPlan = this.aiTurnCtrl.aiPlan;
					this.aiTurnCtrl.aiPlanner = null;
					this.aiTurnCtrl.aiThinking = false;
					this.aiTurnCtrl.aiTargetX = this.aiTurnCtrl.aiPlan.targetX;
					this.aiTurnCtrl.aiWalkTimeLeft = 240;
					activeWorm.aimAngle = this.aiTurnCtrl.aiPlan.targetAngle;
					activeWorm.facingRight =
						Math.cos((this.aiTurnCtrl.aiPlan.targetAngle * Math.PI) / 180) >= 0;

					const plannedIdx = WEAPON_LIST.findIndex(
						(w) => w.id === this.aiTurnCtrl.aiPlan!.weaponId,
					);
					if (plannedIdx !== -1) {
						this.weaponCtrl.activeWeaponIndex = plannedIdx;
					}

					if (this.aiTurnCtrl.isAiDebugMode) {
						this.aiTurnCtrl.aiDebugFrozen = true;
					}
				}
			}

			// Walk phase
			if (
				this.turnCtrl.phase === "MOVE" &&
				this.aiTurnCtrl.aiPlan &&
				!this.aiTurnCtrl.aiThinking &&
				!this.aiTurnCtrl.aiDebugFrozen
			) {
				const distToTarget = Math.abs(this.aiTurnCtrl.aiTargetX - activeWorm.x);
				if (distToTarget > 5 && this.aiTurnCtrl.aiWalkTimeLeft > 0) {
					const dir = this.aiTurnCtrl.aiTargetX > activeWorm.x ? 1 : -1;
					activeWorm.walk(dir);
					if (activeWorm.isGrounded) {
						const nextX = activeWorm.x + dir * 18;
						const isWall = this.terrain.isSolidAt(nextX, activeWorm.y - 6);
						const localGround = this.terrain.getLocalGroundY(
							nextX,
							activeWorm.y + activeWorm.radius + 5,
							15,
							15,
						);
						if (isWall || localGround === null || activeWorm.vx === 0) {
							activeWorm.jump();
						}
					}
					this.aiTurnCtrl.aiWalkTimeLeft--;
				} else {
					activeWorm.walk(0);
					this.turnCtrl.phase = "WEAPON_SELECT";
					this.aiTurnCtrl.maybeReplanFromHere(
						activeWorm,
						this.worms,
						this.terrain,
						this.mapObjects,
						this.turnCtrl.windX,
						activeWormDiff,
						this.weaponCtrl.teamAmmo,
						this.turnCtrl.lobbyConfig.gameMode,
					);
				}
			} else if (
				this.turnCtrl.phase === "WEAPON_SELECT" &&
				this.aiTurnCtrl.aiPlan
			) {
				this.turnCtrl.phase = "AIM_FIRE";
			} else if (
				this.turnCtrl.phase === "AIM_FIRE" &&
				this.aiTurnCtrl.aiPlan &&
				!this.aiTurnCtrl.aiFiringPending
			) {
				this.aiTurnCtrl.aiFiringPending = true;

				const enemies = this.worms.filter(
					(e) => e.isAlive && e.team !== activeWorm.team,
				);
				const est = WormAI.estimateAnglePower(
					this.aiTurnCtrl.aiPlan.weaponId,
					activeWorm.x,
					activeWorm.y,
					enemies,
				);
				activeWorm.aimAngle = this.aiTurnCtrl.aiPlan.targetAngle || est.angle;
				activeWorm.facingRight =
					Math.cos((activeWorm.aimAngle * Math.PI) / 180) >= 0;

				const weaponIdx = WEAPON_LIST.findIndex(
					(w) => w.id === this.aiTurnCtrl.aiPlan!.weaponId,
				);
				if (weaponIdx !== -1) this.weaponCtrl.activeWeaponIndex = weaponIdx;
				this.weaponCtrl.chargePower = this.aiTurnCtrl.aiPlan.targetPower;
				this.aiTurnCtrl.aiPlan = null;

				setTimeout(() => {
					this.fireActiveWeapon();
					this.aiTurnCtrl.aiFiringPending = false;
				}, 300);
			}
		}

		// Update Projectiles
		for (let i = this.projectiles.length - 1; i >= 0; i--) {
			const proj = this.projectiles[i];
			proj.update(
				this.terrain,
				this.worms,
				this.mapObjects,
				this.turnCtrl.windX,
				(p, x, y) => {
					this.audioManager.playHit(2.0);
					this.spawnExplosionFx(x, y, p.weaponId);

					for (const obj of this.mapObjects) {
						if (!obj.isDestroyed && Math.hypot(obj.x - x, obj.y - y) < 55) {
							obj.takeDamage(60);
						}
					}

					if (p.weaponId === "cluster" && !p.isClusterChild) {
						for (let c = 0; c < 5; c++) {
							const angle = Math.PI / 4 + (c * Math.PI) / 8;
							const speed = Math.random() * 6 + 3;
							this.projectiles.push(
								new Projectile(
									"cluster",
									x,
									y - 5,
									Math.cos(angle) * speed,
									-Math.sin(angle) * speed,
									p.teamId,
									2,
									true,
								),
							);
						}
					}
				},
			);
			this.spawnProjectileTrail(proj);

			if (proj.isExpired) {
				this.projectiles.splice(i, 1);
			}
		}

		this.effects.update();

		// Turn Resolution Check
		if (
			this.turnCtrl.phase === "PROJECTILE_FLIGHT" &&
			this.projectiles.length === 0
		) {
			const currentWorm = this.getActiveWorm();
			if (currentWorm?.tookDamageThisTurn) {
				this.checkTurnEnd();
			} else {
				this.turnCtrl.phase = "REPOSITION";
				this.turnCtrl.repositionTimer = 3.0;
			}
		}
	}

	public checkTurnEnd(): void {
		this.turnCtrl.checkTurnEnd(
			this.worms,
			this.audioManager,
			() => {
				const nextWorm = this.getActiveWorm();
				if (
					nextWorm &&
					this.turnCtrl.lobbyConfig.matchType !== "bot_vs_bot" &&
					(nextWorm.team === "player" ||
						this.turnCtrl.lobbyConfig.matchType === "pvp")
				) {
					this.weaponCtrl.activeWeaponIndex = this.turnCtrl.playerWeaponIndex;
					this.weaponCtrl.ensureActiveWeaponHasAmmo(nextWorm, (idx) => {
						this.turnCtrl.playerWeaponIndex = idx;
					});
				}
				this.aiTurnCtrl.resetTurnState();
			},
			() => {
				this.aiTurnCtrl.aiThinking = false;
				this.aiTurnCtrl.showDecisionOverlay(false);
			},
			() => {
				this.turnCtrl.saveMatchState(
					this.worms,
					this.weaponCtrl.teamAmmo,
					this.terrain,
				);
			},
		);
	}

	public loadMatchState(saveData: MatchSaveData): void {
		this.turnCtrl.lobbyConfig = saveData.lobbyConfig;
		this.turnCtrl.aiDifficulty = saveData.lobbyConfig.aiDifficulty;
		this.turnCtrl.windX = saveData.windX;
		this.turnCtrl.playerWeaponIndex = saveData.playerWeaponIndex ?? 0;
		this.weaponCtrl.activeWeaponIndex = this.turnCtrl.playerWeaponIndex;
		this.weaponCtrl.teamAmmo = saveData.teamAmmo;

		if (saveData.terrainData) {
			this.terrain.buildTerrainFromHeights(
				[],
				saveData.terrainData.waterY,
				[],
				saveData.terrainData.gridData,
			);
		}

		this.worms = saveData.worms.map((sw) => {
			const w = new Worm(sw.id, sw.name, sw.team, sw.x, sw.y, sw.personality);
			w.health = sw.health;
			w.maxHealth = sw.maxHealth;
			w.isAlive = sw.isAlive;
			return w;
		});

		this.turnCtrl.activeWormIndex = saveData.activeWormIndex;
		this.turnCtrl.phase = "MOVE";
		this.turnCtrl.turnTimer = 45.0;
		this.weaponCtrl.ensureActiveWeaponHasAmmo(this.getActiveWorm(), (idx) => {
			this.turnCtrl.playerWeaponIndex = idx;
		});
		this.showReturnToEditorBtn();
		this.turnCtrl.updateWind();
	}

	private render(): void {
		this.renderer.renderMatch(
			this.ctx,
			this.canvas,
			this.camera,
			this.terrain,
			this.worms,
			this.mapObjects,
			this.projectiles,
			this.effects,
			this.hud,
			this.getActiveWorm(),
			this.weaponCtrl.activeWeaponIndex,
			this.weaponCtrl.chargePower,
			this.weaponCtrl.isCharging,
			this.turnCtrl.windX,
			this.turnCtrl.turnTimer,
			this.turnCtrl.repositionTimer,
			this.turnCtrl.phase,
			this.turnCtrl.lobbyConfig,
			this.weaponCtrl.teamAmmo,
			this.aiTurnCtrl.isAiDebugMode,
			this.aiTurnCtrl.aiPlan,
			this.aiTurnCtrl.lastAiPlan,
			this.aiTurnCtrl.aiDebugFrozen,
		);
	}

	private showReturnToEditorBtn(): void {
		if (!this.returnToEditorBtn) {
			const btn = document.createElement("button");
			btn.id = "btnReturnToEditor";
			btn.className = "wormix-return-editor-btn";
			btn.innerHTML = "✏️ Return to Editor";
			btn.style.cssText = `
        position: fixed;
        top: 85px;
        right: 16px;
        z-index: 100;
        background: rgba(124, 58, 237, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.85rem;
        font-family: 'Outfit', sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      `;
			btn.addEventListener("mouseenter", () => {
				btn.style.transform = "scale(1.05)";
				btn.style.background = "rgba(139, 92, 246, 1)";
			});
			btn.addEventListener("mouseleave", () => {
				btn.style.transform = "scale(1)";
				btn.style.background = "rgba(124, 58, 237, 0.9)";
			});
			btn.addEventListener("click", () => {
				this.hideReturnToEditorBtn();
				this.openMapEditor(this.editingMap || undefined);
			});
			document.body.appendChild(btn);
			this.returnToEditorBtn = btn;
		} else {
			this.returnToEditorBtn.style.display = "block";
		}
	}

	private hideReturnToEditorBtn(): void {
		if (this.returnToEditorBtn) {
			this.returnToEditorBtn.style.display = "none";
		}
	}

	private showLobbyBtn(): void {
		if (!this.lobbyBtn) {
			const btn = document.createElement("button");
			btn.id = "btnLobbyShortcut";
			btn.innerHTML = "⚔️ Lobby";
			btn.style.cssText = `
        position: fixed;
        top: 85px;
        left: 16px;
        z-index: 100;
        background: rgba(22, 163, 74, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.85rem;
        font-family: 'Outfit', sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      `;
			btn.addEventListener("mouseenter", () => {
				btn.style.transform = "scale(1.05)";
				btn.style.background = "rgba(34, 197, 94, 1)";
			});
			btn.addEventListener("mouseleave", () => {
				btn.style.transform = "scale(1)";
				btn.style.background = "rgba(22, 163, 74, 0.9)";
			});
			btn.addEventListener("click", () => {
				this.hideLobbyBtn();
				this.hideReturnToEditorBtn();
				this.menuModal.show();
			});
			document.body.appendChild(btn);
			this.lobbyBtn = btn;
		} else {
			this.lobbyBtn.style.display = "block";
		}
	}

	private hideLobbyBtn(): void {
		if (this.lobbyBtn) {
			this.lobbyBtn.style.display = "none";
		}
	}
}

// Start Game on DOM Content Loaded
window.addEventListener("DOMContentLoaded", () => {
	new WormixGame();
});
