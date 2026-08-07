import { SharedAudioManager } from "../../../shared/audioManager";
import { SharedInputManager } from "../../../shared/inputManager";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import {
	type AIPlanner,
	type AITurnPlan,
	createPlanner,
	WormAI,
} from "./ai/wormAI";
import { MapEditor } from "./editor/mapEditor";
import { EffectSystem } from "./effects/effects";
import { MapObject } from "./entities/mapObject";
import { Worm } from "./entities/worm";
import { Projectile } from "./physics/projectile";
import { TerrainManager } from "./terrain/terrainManager";
import type {
	AIDifficulty,
	AIPersonality,
	CustomMapData,
	LobbyConfig,
	MatchSaveData,
	TeamAmmo,
	TurnPhase,
	WeaponId,
} from "./types";
import {
	PROJECTILE_MAX_SPEED,
	WEAPON_STATS,
	WORLD_HEIGHT,
	WORLD_WIDTH,
} from "./types";
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

	public terrain: TerrainManager;
	public worms: Worm[] = [];
	public mapObjects: MapObject[] = [];
	public projectiles: Projectile[] = [];

	public phase: TurnPhase = "MENU";
	public activeWormIndex: number = 0;
	public activeWeaponIndex: number = 0;
	public playerWeaponIndex: number = 0;
	private turnCount: number = 0;

	// Turn Timer, Wind & Lobby Config
	public turnTimer: number = 45.0; // 45s countdown
	public windX: number = 0.0; // -2.5 to +2.5
	public aiDifficulty: AIDifficulty = "normal";
	public lobbyConfig: LobbyConfig = {
		teamSize: 2,
		wormHealth: 100,
		gameMode: "deathmatch",
		mapId: "random",
		aiDifficulty: "normal",
		matchType: "ai",
	};

	// Charge Power State
	public isCharging: boolean = false;
	public chargePower: number = 0.0; // 0 to 1.0
	public chargeSpeed: number = 0.025; // Speed per tick (30fps)

	// Camera (static world + zoom). camX/camY = world coordinate at screen center.
	private camScale: number = 1;
	private camX: number = WORLD_WIDTH / 2;
	private camY: number = WORLD_HEIGHT / 2;
	private readonly MIN_CAM_SCALE: number = 0.3;
	private readonly MAX_CAM_SCALE: number = 2.5;
	private readonly ZOOM_STEP: number = 1.2;

	// AI Turn State
	private aiPlan: AITurnPlan | null = null;
	private aiPersonalities: Record<string, AIPersonality> = {};
	private aiPlanner: AIPlanner | null = null;
	private aiThinking: boolean = false;
	private aiFiringPending: boolean = false;
	private aiTargetX: number = 0;
	private aiWalkTimeLeft: number = 0;
	private aiReposTargetX: number | null = null;

	// AI Debug Mode State
	private isAiDebugMode: boolean = false;
	private aiDebugFrozen: boolean = false;

	// Reposition State (post-fire movement window)
	private repositionTimer: number = 0;
	private lastExplosionX: number = 0;

	// Team Ammo Inventory
	private teamAmmo: Record<"player" | "ai", TeamAmmo> = { player: {}, ai: {} };

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
		// Only the viewport canvas resizes — the world/terrain stays static.
		// Never regenerate terrain here, or every resize would wipe explosion
		// holes, shift the land and teleport worms (F12/open-devtools bug).
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	private returnToEditorBtn: HTMLElement | null = null;
	private lobbyBtn: HTMLElement | null = null;

	public openMapEditor(initialMap?: CustomMapData): void {
		this.hideReturnToEditorBtn();
		this.hideLobbyBtn();
		if (this.mapEditor) {
			this.mapEditor.exit();
			this.mapEditor = null;
		}
		this.phase = "EDITOR";
		const targetMap = initialMap || this.editingMap || undefined;
		this.mapEditor = new MapEditor(
			this.canvas,
			(customMap) => {
				this.editingMap = customMap;
				if (this.mapEditor) this.mapEditor.exit();
				this.startMatch(this.lobbyConfig, customMap, true);
			},
			() => {
				this.mapEditor = null;
				this.phase = "MENU";
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
		this.lobbyConfig = config;
		this.aiDifficulty = config.aiDifficulty;

		if (this.mapEditor) {
			this.mapEditor.exit();
			this.mapEditor = null;
		}

		if (isTestPlay) {
			this.showReturnToEditorBtn();
		} else {
			this.hideReturnToEditorBtn();
		}

		// Show Lobby button during all active matches
		this.showLobbyBtn();

		// 1. Generate or Load Terrain (fixed world size, independent of the window)
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

		// Reset camera to fit the freshly generated map
		this.camScale = Math.max(
			this.MIN_CAM_SCALE,
			Math.min(
				this.MAX_CAM_SCALE,
				Math.min(
					this.canvas.width / this.terrain.width,
					this.canvas.height / this.terrain.height,
				),
			),
		);
		this.camX = this.terrain.width / 2;
		this.camY = this.terrain.height / 2;

		// 2. Initialize Worm Teams based on LobbyConfig (interleaved player-bot order)
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

		// Roll a personality per AI worm (each bot gets its own tactics)
		this.aiPersonalities = {};
		for (const w of this.worms) {
			if (w.team === "ai") {
				const p = WormAI.rollPersonality(config.aiDifficulty);
				this.aiPersonalities[w.id] = p;
				w.personality = p;
			}
		}

		// 3. Initialize Interactive Map Objects (Barrels, Mines, Health Crates)
		this.mapObjects = [];
		if (mapData?.mapObjects && mapData.mapObjects.length > 0) {
			mapData.mapObjects.forEach((objData) => {
				this.mapObjects.push(new MapObject(objData));
			});
		} else {
			// Default Random Objects
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
		this.activeWormIndex = 0;
		this.playerWeaponIndex = 0;
		this.turnCount = 0;
		this.phase = "MOVE";
		this.turnTimer = 45.0;
		this.aiPlan = null;
		this.aiPlanner = null;
		this.aiThinking = false;
		this.aiFiringPending = false;
		this.repositionTimer = 0;
		this.aiReposTargetX = null;
		this.showDecisionOverlay(false);

		// Initialize team ammo (bazooka is always infinite — absent from map)
		const defaultAmmo: TeamAmmo = {
			grenade: 4,
			cluster: 2,
			acid_bomb: 2,
			sand_bomb: 3,
			drill: 2,
			mortar: 2,
			dynamite: 1,
			shotgun: 3,
			rifle: 5,
		};
		this.teamAmmo = {
			player: { ...defaultAmmo },
			ai: { ...defaultAmmo },
		};

		this.updateWind();
	}

	private updateWind(): void {
		if (this.lobbyConfig.enableWind) {
			this.windX = (Math.random() - 0.5) * 5.0; // -2.5 to +2.5
		} else {
			this.windX = 0;
		}
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

	private spawnExplosionFx(
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
				if (this.phase === "EDITOR") return;
				this.settingsOverlay.toggle();
				return;
			}

			if (this.phase === "MENU" || this.phase === "EDITOR") return;

			// Camera zoom (in/out) — view only, not steering
			if (e.code === "Equal" || e.code === "NumpadAdd") {
				this.camScale = Math.min(
					this.MAX_CAM_SCALE,
					this.camScale * this.ZOOM_STEP,
				);
				return;
			}
			if (e.code === "Minus" || e.code === "NumpadSubtract") {
				this.camScale = Math.max(
					this.MIN_CAM_SCALE,
					this.camScale / this.ZOOM_STEP,
				);
				return;
			}

			// Focus camera on the currently active worm (F key)
			if (e.code === "KeyF") {
				const focusWorm = this.getActiveWorm();
				if (focusWorm) {
					this.camX = focusWorm.x;
					this.camY = focusWorm.y - 30;
				}
				return;
			}

			// Toggle AI Debug Mode (F3 key)
			if (e.code === "F3") {
				e.preventDefault();
				this.isAiDebugMode = !this.isAiDebugMode;
				this.aiDebugFrozen = false;
				this.audioManager.playTone(800, 0.08, "sine");
				return;
			}

			// Enter key to step/unfreeze AI in Debug Mode
			if (e.code === "Enter" && this.aiDebugFrozen) {
				e.preventDefault();
				this.aiDebugFrozen = false;
				this.audioManager.playTone(700, 0.08, "sine");
				return;
			}

			// 3-Step Turn Flow on Space Bar Press / Release
			if (e.code === "Space" && !e.repeat) {
				const activeWorm = this.getActiveWorm();
				const isPvP = this.lobbyConfig.matchType === "pvp";
				if (activeWorm && (activeWorm.team === "player" || isPvP)) {
					if (this.phase === "MOVE") {
						this.phase = "WEAPON_SELECT";
						this.ensureActiveWeaponHasAmmo();
						this.audioManager.playTone(440, 0.05, "sine");
					} else if (this.phase === "WEAPON_SELECT") {
						this.phase = "AIM_FIRE";
						this.audioManager.playTone(550, 0.05, "sine");
					} else if (this.phase === "AIM_FIRE") {
						this.isCharging = true;
						this.chargePower = 0.0;
						this.audioManager.playTone(300, 0.1, "sawtooth");
					}
				}
			}

			// Back key (S / Down arrow in weapon select returns to move)
			if (
				(e.code === "KeyS" || e.code === "ArrowDown") &&
				this.phase === "WEAPON_SELECT"
			) {
				this.phase = "MOVE";
				this.audioManager.playTone(350, 0.05, "sine");
			}

			// Cycle weapons with A/D or Left/Right during WEAPON_SELECT
			if (this.phase === "WEAPON_SELECT") {
				const activeWormTeam = this.getActiveWorm()?.team ?? "player";
				const ammo = this.teamAmmo[activeWormTeam];
				const hasAmmo = (wid: string) =>
					wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0;

				const startIdx = this.activeWeaponIndex;
				if (e.code === "KeyA" || e.code === "ArrowLeft") {
					do {
						this.activeWeaponIndex =
							(this.activeWeaponIndex - 1 + WEAPON_LIST.length) %
							WEAPON_LIST.length;
					} while (
						!hasAmmo(WEAPON_LIST[this.activeWeaponIndex].id) &&
						this.activeWeaponIndex !== startIdx
					);
					if (activeWormTeam === "player") {
						this.playerWeaponIndex = this.activeWeaponIndex;
					}
					this.audioManager.playTone(600, 0.03, "sine");
				} else if (e.code === "KeyD" || e.code === "ArrowRight") {
					do {
						this.activeWeaponIndex =
							(this.activeWeaponIndex + 1) % WEAPON_LIST.length;
					} while (
						!hasAmmo(WEAPON_LIST[this.activeWeaponIndex].id) &&
						this.activeWeaponIndex !== startIdx
					);
					if (activeWormTeam === "player") {
						this.playerWeaponIndex = this.activeWeaponIndex;
					}
					this.audioManager.playTone(600, 0.03, "sine");
				}
			}
		});

		window.addEventListener("keyup", (e) => {
			if (e.code === "Space" && this.isCharging && this.phase === "AIM_FIRE") {
				this.fireActiveWeapon();
			}
		});

		// PC Mode Mouse Clicks
		this.canvas.addEventListener("mousedown", () => {
			if (this.phase === "MENU" || this.phase === "EDITOR") return;
			if (this.inputManager.settings.mode !== "pointer") return;
			const activeWorm = this.getActiveWorm();
			const isPvP = this.lobbyConfig.matchType === "pvp";
			if (!activeWorm || (activeWorm.team !== "player" && !isPvP)) return;

			if (this.phase === "MOVE") {
				this.phase = "WEAPON_SELECT";
				this.ensureActiveWeaponHasAmmo();
			} else if (this.phase === "WEAPON_SELECT") {
				this.phase = "AIM_FIRE";
			} else if (this.phase === "AIM_FIRE") {
				this.isCharging = true;
				this.chargePower = 0.0;
			}
		});

		this.canvas.addEventListener("mouseup", () => {
			if (this.isCharging && this.phase === "AIM_FIRE") {
				this.fireActiveWeapon();
			}
		});

		// PC Mode Mouse Aiming
		this.canvas.addEventListener("mousemove", (e) => {
			if (this.phase === "MENU" || this.phase === "EDITOR") return;
			if (this.inputManager.settings.mode !== "pointer") return;
			const activeWorm = this.getActiveWorm();
			const isPvP = this.lobbyConfig.matchType === "pvp";
			if (
				!activeWorm ||
				(activeWorm.team !== "player" && !isPvP) ||
				this.phase !== "AIM_FIRE"
			)
				return;

			const rect = this.canvas.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			// Convert screen -> world (camera zoom + pan)
			const worldX =
				(mouseX - this.canvas.width / 2) / this.camScale + this.camX;
			const worldY =
				(mouseY - this.canvas.height / 2) / this.camScale + this.camY;

			const dx = worldX - activeWorm.x;
			const dy = worldY - activeWorm.y;
			activeWorm.aimAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
			activeWorm.facingRight = dx >= 0;
		});
	}

	/**
	 * Ensure activeWeaponIndex points at a weapon the active worm's team still has
	 * ammo for (bazooka is always infinite). Keeps the current selection if valid,
	 * otherwise falls back to bazooka.
	 */
	private ensureActiveWeaponHasAmmo(): void {
		const team = (this.getActiveWorm()?.team ?? "player") as "player" | "ai";
		const ammo = this.teamAmmo[team];
		const hasAmmo = (wid: string) =>
			wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0;

		if (hasAmmo(WEAPON_LIST[this.activeWeaponIndex].id)) return;

		const bazookaIdx = WEAPON_LIST.findIndex((w) => w.id === "bazooka");
		this.activeWeaponIndex = bazookaIdx;
		if (team === "player") {
			this.playerWeaponIndex = bazookaIdx;
		}
	}

	private fireActiveWeapon(): void {
		this.isCharging = false;
		const activeWorm = this.getActiveWorm();
		if (!activeWorm) return;

		const weapon = WEAPON_LIST[this.activeWeaponIndex];
		const team = activeWorm.team as "player" | "ai";
		const teamAmmo = this.teamAmmo[team];
		const ammoCount = teamAmmo[weapon.id];

		// Guard: no ammo for selected weapon — drop back to weapon select so the
		// player can pick another (bazooka is always infinite — ammoCount undefined)
		if (ammoCount !== undefined && ammoCount <= 0) {
			this.ensureActiveWeaponHasAmmo();
			this.phase = "WEAPON_SELECT";
			this.audioManager.playTone(220, 0.1, "square");
			return;
		}

		const tip = activeWorm.getCannonTip();
		const rad = (activeWorm.aimAngle * Math.PI) / 180;
		const launchSpeed =
			Math.max(0.15, this.chargePower) * PROJECTILE_MAX_SPEED[weapon.id];

		this.effects.spawnMuzzleFlash(tip.x, tip.y, rad);

		const vx = Math.cos(rad) * launchSpeed;
		const vy = Math.sin(rad) * launchSpeed;

		if (weapon.id === "shotgun") {
			// Shotgun: raycast along aim direction, double-tap
			this.audioManager.playHit(1.5);
			this.effects.spawnTracer(tip.x, tip.y, rad, 250, "#fbbf24");
			const rayLen = 250;
			const rayStep = 4;
			const shotDamage = 40;

			const shootRay = (damageMult: number) => {
				for (let d = 0; d < rayLen; d += rayStep) {
					const rx = tip.x + Math.cos(rad) * d;
					const ry = tip.y + Math.sin(rad) * d;

					// Stop at first terrain hit
					if (this.terrain.isSolidAt(rx, ry)) {
						this.terrain.explode(rx, ry, 18);
						this.effects.spawnFlash(rx, ry, 12);
						this.effects.spawnSparks(rx, ry, 10, 1, 4, "#fbbf24");
						break;
					}

					// Damage worms along the ray
					for (const w of this.worms) {
						if (w !== activeWorm && w.isAlive) {
							if (Math.hypot(w.x - rx, w.y - ry) < 14) {
								w.takeDamage(Math.floor(shotDamage * damageMult));
								const kAngle = Math.atan2(w.y - tip.y, w.x - tip.x);
								w.vx += Math.cos(kAngle) * 6;
								w.vy += Math.sin(kAngle) * 4 - 2;
							}
						}
					}

					// Damage objects along the ray
					for (const obj of this.mapObjects) {
						if (!obj.isDestroyed && Math.hypot(obj.x - rx, obj.y - ry) < 14) {
							obj.takeDamage(Math.floor(shotDamage * damageMult));
						}
					}
				}
			};

			// First shot (full damage)
			shootRay(1.0);
			// Second shot (75% damage, slight delay feel)
			shootRay(0.75);

			this.lastExplosionX = tip.x + Math.cos(rad) * 60;
			this.phase = "PROJECTILE_FLIGHT";
		} else {
			// Spawn Projectile
			this.audioManager.playTone(220, 0.15, "sawtooth");
			if (weapon.id === "rifle") {
				this.effects.spawnTracer(
					tip.x,
					tip.y,
					rad,
					300,
					"rgba(103, 232, 249, 0.8)",
				);
			}
			const fuseTime =
				weapon.id === "dynamite" ? 4 : weapon.id === "mortar" ? 2.5 : 3;
			this.projectiles.push(
				new Projectile(
					weapon.id,
					tip.x,
					tip.y,
					vx,
					vy,
					activeWorm.team,
					fuseTime,
				),
			);
			this.lastExplosionX = tip.x;

			if (weapon.id === "dynamite") {
				// Instant live-fuse escape window: worm runs to safety while Dynamite fuse ticks down!
				this.phase = "REPOSITION";
				this.repositionTimer = 3.5;
				this.aiReposTargetX = null;
			} else {
				this.phase = "PROJECTILE_FLIGHT";
			}
		}

		// Decrement ammo (skip if undefined = infinite bazooka)
		if (ammoCount !== undefined) {
			this.teamAmmo[team][weapon.id] = ammoCount - 1;
		}
	}

	private getActiveWorm(): Worm | null {
		return this.worms[this.activeWormIndex] || null;
	}

	/**
	 * Smoothly keep the camera centered on the active worm (or the live projectile
	 * while one is flying) so gameplay stays in view regardless of zoom.
	 */
	private updateCamera(): void {
		let targetX: number | null = null;
		let targetY: number | null = null;

		if (this.phase === "PROJECTILE_FLIGHT" && this.projectiles.length > 0) {
			const p = this.projectiles[0];
			targetX = p.x;
			targetY = p.y;
		} else {
			const focusWorm = this.getActiveWorm();
			if (focusWorm) {
				targetX = focusWorm.x;
				targetY = focusWorm.y - 30;
			}
		}

		if (targetX === null || targetY === null) return;

		const k = 0.15;
		this.camX += (targetX - this.camX) * k;
		this.camY += (targetY - this.camY) * k;
	}

	/** Show/hide the DOM "making decision…" spinner overlay during AI thinking. */
	private showDecisionOverlay(show: boolean): void {
		const el = document.getElementById("aiDecisionOverlay");
		if (el) el.hidden = !show;
	}

	/**
	 * Emergency turn end: if the 45s timer expires while the AI is still
	 * thinking/walking, stop searching, apply the best-known plan and fire.
	 */
	private forceFinishAiTurn(activeWorm: Worm): void {
		if (this.aiPlanner && !this.aiPlan) {
			this.aiPlanner.step(500);
			this.aiPlan = this.aiPlanner.getPlan();
			this.aiPlanner = null;
			this.aiThinking = false;
			this.showDecisionOverlay(false);
		}
		if (this.aiPlan && !this.aiFiringPending) {
			this.aiFiringPending = true;
			activeWorm.aimAngle = this.aiPlan.targetAngle;
			activeWorm.facingRight =
				Math.cos((this.aiPlan.targetAngle * Math.PI) / 180) >= 0;
			const weaponIdx = WEAPON_LIST.findIndex(
				(w) => w.id === this.aiPlan!.weaponId,
			);
			if (weaponIdx !== -1) this.activeWeaponIndex = weaponIdx;
			this.chargePower = this.aiPlan.targetPower;
			this.aiPlan = null;
			this.phase = "AIM_FIRE";
			this.fireActiveWeapon();
		} else if (!this.aiPlan && !this.aiFiringPending) {
			this.phase = "PROJECTILE_FLIGHT"; // skip the turn
		}
	}

	/**
	 * Fire-from-actual-position: if walking toward the planned spot was blocked
	 * (cliff/water), rescan the best shot cheaply from where the worm actually
	 * stopped so it doesn't fire a stale plan.
	 */
	private maybeReplanFromHere(activeWorm: Worm): void {
		if (!this.aiPlan) return;
		if (Math.abs(activeWorm.x - this.aiTargetX) <= 20) return;
		const planner = createPlanner({
			aiWorm: activeWorm,
			allWorms: this.worms,
			terrain: this.terrain,
			mapObjects: this.mapObjects,
			windX: this.windX,
			difficulty: this.aiDifficulty,
			personality: this.aiPersonalities[activeWorm.id] ?? "default",
			availableAmmo: this.teamAmmo.ai,
			gameMode: this.lobbyConfig.gameMode,
			deadlineMs: 80,
			fixedPositionX: activeWorm.x,
		});
		planner.step(80);
		if (planner.isDone) {
			const p = planner.getPlan();
			if (p) {
				this.aiPlan = p;
				this.aiTargetX = activeWorm.x;
			}
		}
	}

	/** Pick a reposition spot after firing (crate if low HP, else away from enemies). */
	private pickAiRepositionTarget(w: Worm): number {
		if (w.health < w.maxHealth * 0.6) {
			let bestX: number | null = null;
			let bestD = Infinity;
			for (const obj of this.mapObjects) {
				if (obj.type === "health_crate" && !obj.isDestroyed) {
					const d = Math.abs(obj.x - w.x);
					if (
						d < bestD &&
						d < 400 &&
						WormAI.canWalkTo(this.terrain, w.x, w.y, obj.x)
					) {
						bestD = d;
						bestX = obj.x;
					}
				}
			}
			if (bestX !== null) return bestX;
		}
		let nearestDist = Infinity;
		let nearestEnemyX = this.lastExplosionX;
		for (const e of this.worms) {
			if (e.team !== w.team && e.isAlive) {
				const d = Math.hypot(e.x - w.x, e.y - w.y);
				if (d < nearestDist) {
					nearestDist = d;
					nearestEnemyX = e.x;
				}
			}
		}
		const preferredDir = w.x >= nearestEnemyX ? 1 : -1;
		const offsets = [
			preferredDir * 200,
			preferredDir * 140,
			preferredDir * 80,
			-preferredDir * 120,
			-preferredDir * 60,
		];
		for (const off of offsets) {
			const candX = Math.max(30, Math.min(this.terrain.width - 30, w.x + off));
			if (WormAI.canWalkTo(this.terrain, w.x, w.y, candX)) {
				return candX;
			}
		}
		return w.x;
	}

	private gameLoop(timestamp: number): void {
		if (!this.lastTickTime) this.lastTickTime = timestamp;
		const elapsed = timestamp - this.lastTickTime;

		// Fixed 30 FPS Tick Lock
		if (elapsed >= this.frameInterval) {
			this.lastTickTime = timestamp - (elapsed % this.frameInterval);
			if (this.phase === "EDITOR" && this.mapEditor) {
				this.mapEditor.render();
			} else if (this.phase !== "MENU") {
				this.updateFixedTick();
				this.render();
			}
		}

		requestAnimationFrame((ts) => this.gameLoop(ts));
	}

	private updateFixedTick(): void {
		// Sudden Death / Rising Water Mode Tick
		if (this.lobbyConfig.gameMode === "rising_water") {
			this.terrain.waterY = Math.max(100, this.terrain.waterY - 0.08);
		}

		// 1. Update Terrain & Live Dynamic Water Physics
		this.terrain.updatePhysics();

		// 2. Update Worm Physics & Water Oxygen
		for (const worm of this.worms) {
			worm.update(this.terrain);
		}

		// 3. Update Interactive Map Objects (Barrels, Mines, Crates)
		for (let i = this.mapObjects.length - 1; i >= 0; i--) {
			const obj = this.mapObjects[i];
			obj.update(
				this.terrain,
				this.worms,
				(x, y, radius, damage) => {
					this.audioManager.playHit(2.5);
					this.terrain.explode(x, y, radius);
					this.spawnExplosionFx(x, y, null, radius);

					// Explosion damage to nearby worms
					for (const w of this.worms) {
						if (w.isAlive) {
							const d = Math.hypot(w.x - x, w.y - y);
							if (d < radius + 15) {
								w.takeDamage(Math.floor(damage * (1 - d / (radius + 15))));
							}
						}
					}

					// Chain explosion: damage nearby barrels/objects (for barrel chain reactions)
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

		// 4. Process Active Turn Input
		// In PvP mode both teams are human-controlled; in AI mode only 'player' team is human.
		const isPvP = this.lobbyConfig.matchType === "pvp";
		const isHumanTurn =
			activeWorm?.isAlive && (activeWorm.team === "player" || isPvP);

		if (isHumanTurn) {
			const keys = this.inputManager.keysPressed;

			// Movement Phase Controls
			if (this.phase === "MOVE") {
				let dir = 0;
				if (keys.has("KeyA") || keys.has("ArrowLeft")) dir -= 1;
				if (keys.has("KeyD") || keys.has("ArrowRight")) dir += 1;

				// GyroMouse Roll Steering
				const steer = this.inputManager.getSteeringValue();
				if (Math.abs(steer.x) > 0.2) dir = Math.sign(steer.x);

				activeWorm.walk(dir);

				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.jump();
					this.audioManager.playTone(500, 0.08, "sine");
				}
			}

			// Aiming Controls (Aim angle up/down)
			if (this.phase === "AIM_FIRE") {
				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.aimAngle -= 2.5;
				}
				if (keys.has("KeyS") || keys.has("ArrowDown")) {
					activeWorm.aimAngle += 2.5;
				}

				// GyroMouse Pitch Steering
				const steer = this.inputManager.getSteeringValue();
				if (Math.abs(steer.y) > 0.2) {
					activeWorm.aimAngle += steer.y * 3.0;
				}

				// Charge Shot Power Meter
				if (this.isCharging) {
					this.chargePower += this.chargeSpeed;
					if (this.chargePower >= 1.0) {
						this.chargePower = 1.0;
						this.fireActiveWeapon(); // Auto-fire at 100% max power
					}
				}
			}

			// Turn Countdown Timer (if time expires, immediately end turn cleanly)
			this.turnTimer -= 1 / 30; // 30 FPS tick
			if (this.turnTimer <= 0) {
				this.turnTimer = 0;
				this.checkTurnEnd();
			}
		}

		// 4b. PROJECTILE_FLIGHT Phase — allow human player to run & jump for cover while projectile flies!
		if (
			this.phase === "PROJECTILE_FLIGHT" &&
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

		// 5. REPOSITION Phase — post-fire movement window (separate from turn timer)
		if (this.phase === "REPOSITION" && activeWorm && activeWorm.isAlive) {
			this.repositionTimer -= 1 / 30;

			if (this.repositionTimer <= 0) {
				this.checkTurnEnd();
			} else if (isHumanTurn) {
				// Human: allow walk + jump only (no weapon switch, no firing)
				const keys = this.inputManager.keysPressed;
				let dir = 0;
				if (keys.has("KeyA") || keys.has("ArrowLeft")) dir -= 1;
				if (keys.has("KeyD") || keys.has("ArrowRight")) dir += 1;
				activeWorm.walk(dir);
				if (keys.has("KeyW") || keys.has("ArrowUp")) {
					activeWorm.jump();
				}
			} else if (activeWorm.team === "ai") {
				// AI: reposition toward a chosen safe spot (crate if low HP,
				// otherwise away from the nearest enemy / last explosion)
				if (this.aiReposTargetX === null) {
					this.aiReposTargetX = this.pickAiRepositionTarget(activeWorm);
				}
				if (Math.abs(this.aiReposTargetX - activeWorm.x) > 20) {
					const dir = this.aiReposTargetX > activeWorm.x ? 1 : -1;
					// Check if there's ground ahead before walking
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
						// Jump if hitting a wall (stuck with zero horizontal velocity)
						if (activeWorm.isGrounded && activeWorm.vx === 0) {
							activeWorm.jump();
						}
					} else {
						activeWorm.walk(0); // stop if no ground ahead
					}
				} else {
					activeWorm.walk(0);
				}
			}
		}

		// 6. AI Turn Logic (only in AI match mode and only for Blue team worms)
		const isAiTurn =
			!isPvP &&
			activeWorm !== null &&
			activeWorm.isAlive &&
			activeWorm.team === "ai";

		this.showDecisionOverlay(isAiTurn && this.aiThinking);

		if (isAiTurn && activeWorm) {
			// AI turn clock: thinking + walking consume the 45s turn timer (paused when debug frozen)
			if (
				!this.aiDebugFrozen &&
				(this.phase === "MOVE" ||
					this.phase === "WEAPON_SELECT" ||
					this.phase === "AIM_FIRE")
			) {
				this.turnTimer -= 1 / 30;
				if (this.turnTimer <= 0) {
					this.turnTimer = 0;
					this.forceFinishAiTurn(activeWorm);
				}
			}

			// 6a. Decision phase — frame-sliced search (spinner + timer tick)
			if (this.phase === "MOVE" && !this.aiPlan) {
				if (!this.aiPlanner) {
					this.aiPlanner = createPlanner({
						aiWorm: activeWorm,
						allWorms: this.worms,
						terrain: this.terrain,
						mapObjects: this.mapObjects,
						windX: this.windX,
						difficulty: this.aiDifficulty,
						personality: this.aiPersonalities[activeWorm.id] ?? "default",
						availableAmmo: this.teamAmmo.ai,
						gameMode: this.lobbyConfig.gameMode,
					});
					this.aiThinking = true;
				}
				this.aiPlanner.step(16);
				if (this.aiPlanner.isDone) {
					this.aiPlan = this.aiPlanner.getPlan();
					this.aiPlanner = null;
					this.aiThinking = false;
					this.aiTargetX = this.aiPlan.targetX;
					this.aiWalkTimeLeft = 240; // 8 seconds max at 30fps
					activeWorm.aimAngle = this.aiPlan.targetAngle;
					activeWorm.facingRight =
						Math.cos((this.aiPlan.targetAngle * Math.PI) / 180) >= 0;

					if (this.isAiDebugMode) {
						this.aiDebugFrozen = true;
					}
				}
			}

			// 6b. Walk toward planned position (with jump obstacle handling, paused if debug frozen)
			if (
				this.phase === "MOVE" &&
				this.aiPlan &&
				!this.aiThinking &&
				!this.aiDebugFrozen
			) {
				const distToTarget = Math.abs(this.aiTargetX - activeWorm.x);
				if (distToTarget > 5 && this.aiWalkTimeLeft > 0) {
					const dir = this.aiTargetX > activeWorm.x ? 1 : -1;
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
					this.aiWalkTimeLeft--;
				} else {
					activeWorm.walk(0); // stop
					this.phase = "WEAPON_SELECT";
					// If walking was cliff-blocked, rescan the shot from here
					this.maybeReplanFromHere(activeWorm);
				}
			} else if (this.phase === "WEAPON_SELECT" && this.aiPlan) {
				this.phase = "AIM_FIRE";
			} else if (
				this.phase === "AIM_FIRE" &&
				this.aiPlan &&
				!this.aiFiringPending
			) {
				this.aiFiringPending = true;

				// Recalculate precise aim angle and facing direction from CURRENT position
				const enemies = this.worms.filter(
					(e) => e.isAlive && e.team !== activeWorm.team,
				);
				const est = WormAI.estimateAnglePower(
					this.aiPlan.weaponId,
					activeWorm.x,
					activeWorm.y,
					enemies,
				);
				activeWorm.aimAngle = this.aiPlan.targetAngle || est.angle;
				activeWorm.facingRight =
					Math.cos((activeWorm.aimAngle * Math.PI) / 180) >= 0;

				// Set weapon
				const weaponIdx = WEAPON_LIST.findIndex(
					(w) => w.id === this.aiPlan!.weaponId,
				);
				if (weaponIdx !== -1) this.activeWeaponIndex = weaponIdx;
				this.chargePower = this.aiPlan.targetPower;
				this.aiPlan = null;

				// Delay fire so player can see the aim. Phase stays AIM_FIRE until
				// projectile actually exists — prevents premature turn resolution.
				setTimeout(() => {
					this.fireActiveWeapon(); // sets phase = 'PROJECTILE_FLIGHT' inside
					this.aiFiringPending = false;
				}, 300);
			}
		}

		// 6. Update Projectiles Physics & Collisions
		for (let i = this.projectiles.length - 1; i >= 0; i--) {
			const proj = this.projectiles[i];
			proj.update(
				this.terrain,
				this.worms,
				this.mapObjects,
				this.windX,
				(p, x, y) => {
					this.audioManager.playHit(2.0);
					this.lastExplosionX = x;
					this.spawnExplosionFx(x, y, p.weaponId);

					// Damage map objects hit by projectile explosion (barrel chain explosions!)
					for (const obj of this.mapObjects) {
						if (!obj.isDestroyed && Math.hypot(obj.x - x, obj.y - y) < 55) {
							obj.takeDamage(60);
						}
					}

					// Handle Cluster Split
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

		// Update visual effect particles (smoke trails, sparks, flashes)
		this.effects.update();

		// 7. Turn Resolution Check — enter REPOSITION phase only if active worm took NO damage
		if (this.phase === "PROJECTILE_FLIGHT" && this.projectiles.length === 0) {
			const currentWorm = this.getActiveWorm();
			if (currentWorm?.tookDamageThisTurn) {
				this.checkTurnEnd();
			} else {
				this.phase = "REPOSITION";
				this.repositionTimer = 3.0; // 3 seconds to reposition
			}
		}
	}

	private checkTurnEnd(): void {
		const redAlive = this.worms.filter(
			(w) => w.team === "player" && w.isAlive,
		).length;
		const blueAlive = this.worms.filter(
			(w) => w.team === "ai" && w.isAlive,
		).length;

		if (redAlive === 0 || blueAlive === 0) {
			this.phase = "GAME_OVER";
			this.audioManager.playWin();
			this.aiThinking = false;
			this.showDecisionOverlay(false);
			return;
		}

		// Pass turn to next alive worm of the opposing team (checkerboard alternating order)
		const currentWorm = this.worms[this.activeWormIndex];
		const targetTeam = currentWorm?.team === "player" ? "ai" : "player";

		let nextIdx = (this.activeWormIndex + 1) % this.worms.length;
		let attempts = 0;
		while (attempts < this.worms.length * 2) {
			const candidate = this.worms[nextIdx];
			if (candidate?.isAlive && candidate.team === targetTeam) {
				break;
			}
			nextIdx = (nextIdx + 1) % this.worms.length;
			attempts++;
		}

		this.activeWormIndex = nextIdx;
		const nextWorm = this.worms[nextIdx];
		nextWorm.resetTurnFlags();

		// Restore player's last chosen weapon if starting human turn & ensure valid ammo
		if (nextWorm.team === "player" || this.lobbyConfig.matchType === "pvp") {
			this.activeWeaponIndex = this.playerWeaponIndex;
			this.ensureActiveWeaponHasAmmo();
		}

		this.turnCount++;
		this.phase = "MOVE";
		this.turnTimer = 45.0;
		this.aiPlan = null;
		this.aiPlanner = null;
		this.aiThinking = false;
		this.aiFiringPending = false;
		this.repositionTimer = 0;
		this.aiReposTargetX = null;
		this.showDecisionOverlay(false);
		this.updateWind();

		// Auto-save match state to localStorage (keeps 3 latest saves for F5 recovery)
		this.saveMatchState();
	}

	private saveMatchState(): void {
		if (
			this.phase === "MENU" ||
			this.phase === "EDITOR" ||
			this.phase === "GAME_OVER"
		) {
			return;
		}

		const saveObj: MatchSaveData = {
			id: `save_${Date.now()}`,
			timestamp: Date.now(),
			dateString: new Date().toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			}),
			lobbyConfig: this.lobbyConfig,
			worms: this.worms.map((w) => ({
				id: w.id,
				name: w.name,
				team: w.team,
				x: w.x,
				y: w.y,
				health: w.health,
				maxHealth: w.maxHealth,
				personality: w.personality,
				isAlive: w.isAlive,
			})),
			activeWormIndex: this.activeWormIndex,
			playerWeaponIndex: this.playerWeaponIndex,
			teamAmmo: this.teamAmmo,
			windX: this.windX,
			turnCount: this.turnCount,
			terrainData: {
				gridData: Array.from(this.terrain.grid),
				waterY: this.terrain.waterY,
				width: this.terrain.width,
				height: this.terrain.height,
			},
		};

		try {
			const existingJson = localStorage.getItem("wormix_saved_matches");
			let saves: MatchSaveData[] = existingJson ? JSON.parse(existingJson) : [];
			saves.unshift(saveObj);
			saves = saves.slice(0, 3);
			localStorage.setItem("wormix_saved_matches", JSON.stringify(saves));
		} catch (err) {
			console.warn("Failed to save match state:", err);
		}
	}

	public loadMatchState(saveData: MatchSaveData): void {
		this.lobbyConfig = saveData.lobbyConfig;
		this.aiDifficulty = saveData.lobbyConfig.aiDifficulty;
		this.windX = saveData.windX;
		this.playerWeaponIndex = saveData.playerWeaponIndex ?? 0;
		this.activeWeaponIndex = this.playerWeaponIndex;
		this.teamAmmo = saveData.teamAmmo;

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

		this.activeWormIndex = saveData.activeWormIndex;
		this.phase = "MOVE";
		this.turnTimer = 45.0;
		this.ensureActiveWeaponHasAmmo();
		this.showReturnToEditorBtn();
		this.updateWind();
	}

	private render(): void {
		this.updateCamera();

		// Screen space: clear + fill background
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.fillStyle = "#0f172a";
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		// World space: apply camera zoom + pan so all game entities keep world coords
		this.ctx.setTransform(
			this.camScale,
			0,
			0,
			this.camScale,
			this.canvas.width / 2 - this.camX * this.camScale,
			this.canvas.height / 2 - this.camY * this.camScale,
		);

		// Render Terrain, Water, Particles, Portals
		this.terrain.draw(this.ctx);

		// Render Interactive Map Objects (Barrels, Mines, Crates)
		this.mapObjects.forEach((obj) => obj.draw(this.ctx));

		// Render Worms
		const activeWorm = this.getActiveWorm();
		this.worms.forEach((w) => w.draw(this.ctx, w === activeWorm));

		// Render Projectiles
		this.projectiles.forEach((p) => p.draw(this.ctx));

		// Render Visual Effect Particles (trails, flashes, smoke)
		this.effects.draw(this.ctx);

		// Trajectory sighting arc (strictly shown ONLY during AIM_FIRE phase)
		if (activeWorm?.isAlive && !this.aiThinking && this.phase === "AIM_FIRE") {
			const wid = WEAPON_LIST[this.activeWeaponIndex].id;
			const powerToDraw = this.isCharging ? this.chargePower : 0.6;
			const arcWind = WEAPON_LIST[this.activeWeaponIndex].affectedByWind
				? this.windX
				: 0;
			this.hud.drawTrajectoryArc(
				this.ctx,
				activeWorm,
				powerToDraw,
				arcWind,
				wid,
			);
		}

		// AI Debug Visualizations (World space: Candidates Heatmap, Target Path, Planned Arc)
		if (this.isAiDebugMode && this.aiPlan) {
			this.renderAiDebugWorld(this.ctx, activeWorm);
		}

		// Back to screen space for UI overlay
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);

		// Update AI Debug DOM Panel
		this.updateAiDebugOverlay();

		// Calculate Team Total HPs
		const playerHp = this.worms
			.filter((w) => w.team === "player")
			.reduce((acc, w) => acc + w.health, 0);
		const aiHp = this.worms
			.filter((w) => w.team === "ai")
			.reduce((acc, w) => acc + w.health, 0);

		// Render Glassmorphism HUD overlay
		const activeTeam = activeWorm?.team ?? "player";
		this.hud.draw(
			this.ctx,
			this.canvas.width,
			this.canvas.height,
			this.phase,
			activeWorm,
			this.activeWeaponIndex,
			this.chargePower,
			this.isCharging,
			this.windX,
			this.turnTimer,
			playerHp,
			aiHp,
			this.inputManager.settings.mode === "pointer",
			this.lobbyConfig.matchType === "pvp",
			this.teamAmmo[activeTeam as "player" | "ai"],
			this.repositionTimer,
		);

		// Game Over Overlay
		if (this.phase === "GAME_OVER") {
			const redAlive = this.worms.filter(
				(w) => w.team === "player" && w.isAlive,
			).length;
			this.ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
			this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

			this.ctx.fillStyle = redAlive > 0 ? "#22c55e" : "#ef4444";
			this.ctx.font = "bold 36px Outfit, sans-serif";
			this.ctx.textAlign = "center";
			this.ctx.fillText(
				redAlive > 0
					? "🏆 RED TEAM VICTORIOUS!"
					: "💀 DEFEAT - BLUE TEAM WINS!",
				this.canvas.width / 2,
				this.canvas.height / 2 - 20,
			);

			this.ctx.fillStyle = "#9ca3af";
			this.ctx.font = "16px Outfit, sans-serif";
			this.ctx.fillText(
				"Press ESC to open menu or refresh to replay",
				this.canvas.width / 2,
				this.canvas.height / 2 + 30,
			);
		}
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

	private renderAiDebugWorld(
		ctx: CanvasRenderingContext2D,
		activeWorm: Worm | null,
	): void {
		if (!this.aiPlan) return;

		// 1. Position Candidates Heatmap
		if (this.aiPlan.evals && this.aiPlan.evals.length > 0) {
			const maxScore = Math.max(...this.aiPlan.evals.map((e) => e.totalScore));
			const minScore = Math.min(...this.aiPlan.evals.map((e) => e.totalScore));
			const scoreRange = maxScore - minScore || 1;

			for (const ev of this.aiPlan.evals) {
				const norm = (ev.totalScore - minScore) / scoreRange;
				const isChosen = Math.abs(ev.x - this.aiPlan.targetX) < 5;

				ctx.fillStyle = isChosen
					? "rgba(34, 197, 94, 0.85)"
					: norm > 0.65
						? "rgba(56, 189, 248, 0.55)"
						: norm > 0.35
							? "rgba(234, 179, 8, 0.55)"
							: "rgba(239, 68, 68, 0.45)";

				ctx.beginPath();
				ctx.arc(ev.x, ev.y, isChosen ? 14 : 8, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = isChosen ? "#ffffff" : "rgba(255, 255, 255, 0.3)";
				ctx.lineWidth = isChosen ? 2.5 : 1;
				ctx.stroke();

				ctx.font = isChosen
					? "bold 11px Outfit, sans-serif"
					: "9px Outfit, sans-serif";
				ctx.fillStyle = isChosen ? "#ffffff" : "#cbd5e1";
				ctx.textAlign = "center";
				ctx.fillText(`${Math.round(ev.totalScore)}`, ev.x, ev.y - 12);
			}
		}

		// 2. Target Walk Path & Flag Marker
		if (activeWorm) {
			ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.moveTo(activeWorm.x, activeWorm.y);
			ctx.lineTo(this.aiPlan.targetX, activeWorm.y);
			ctx.stroke();
			ctx.setLineDash([]);

			ctx.font = "16px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("🚩", this.aiPlan.targetX, activeWorm.y - 18);
		}

		// 3. Planned Trajectory Arc & Target Impact
		if (activeWorm) {
			const planX = this.aiPlan.targetX;
			const planSurfaceY = this.terrain.getSurfaceY(planX);
			const planY = planSurfaceY - 12;
			const rad = (this.aiPlan.targetAngle * Math.PI) / 180;
			const speed =
				this.aiPlan.targetPower * PROJECTILE_MAX_SPEED[this.aiPlan.weaponId];
			let vx = Math.cos(rad) * speed;
			let vy = Math.sin(rad) * speed;
			let px = planX + Math.cos(rad) * 20;
			let py = planY + Math.sin(rad) * 20;
			const hasWind = WEAPON_STATS[this.aiPlan.weaponId].wind;
			const gravity = WEAPON_STATS[this.aiPlan.weaponId].gravity;

			ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(px, py);

			for (let step = 0; step < 40; step++) {
				if (hasWind) vx += this.windX * 0.05;
				if (this.aiPlan.weaponId !== "rifle") vy += gravity;
				px += vx;
				py += vy;
				ctx.lineTo(px, py);
				if (this.terrain.isSolidAt(px, py) || py >= this.terrain.waterY) break;
			}
			ctx.stroke();

			ctx.font = "18px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("🎯", px, py);
		}
	}

	private updateAiDebugOverlay(): void {
		const panelEl = document.getElementById("aiDebugPanel");
		const contentEl = document.getElementById("aiDebugContent");
		const freezeEl = document.getElementById("aiDebugFreezeBadge");
		if (!panelEl || !contentEl || !freezeEl) return;

		panelEl.hidden = !this.isAiDebugMode;
		if (!this.isAiDebugMode) return;

		const activeWorm = this.getActiveWorm();
		freezeEl.hidden = !this.aiDebugFrozen;

		if (activeWorm?.team !== "ai") {
			contentEl.innerHTML = `<div>Waiting for AI turn...</div>`;
			return;
		}

		const p = this.aiPlan;
		if (!p) {
			contentEl.innerHTML = `<div>🤖 <b>${activeWorm.name}</b> is searching plan...</div>`;
			return;
		}

		contentEl.innerHTML = `
			<div>🤖 <b>${activeWorm.name}</b> [<code>${p.personality || "default"}</code>]</div>
			<div>📍 Target X: <b>${Math.round(p.targetX)}</b> (Current: ${Math.round(activeWorm.x)})</div>
			<div>🚀 Weapon: <b>${p.weaponId.toUpperCase()}</b> (Angle: ${Math.round(p.targetAngle)}°, Power: ${Math.round(p.targetPower * 100)}%)</div>
			<div>💥 Est. Dmg: <b>${p.enemyDamageEst ?? 0}</b> enemy | <b>${p.selfDamageEst ?? 0}</b> self</div>
			<div>☠️ Est. Kills: <b>${p.killsEst ?? 0}</b> | Water KO: <b>${p.waterKnockoutsEst ?? 0}</b></div>
			<div>⏱️ Sims: <b>${p.sims ?? 0}</b> | Wind: <b>${this.windX.toFixed(1)}</b></div>
		`;
	}
}

// Start Game on DOM Content Loaded
window.addEventListener("DOMContentLoaded", () => {
	new WormixGame();
});
