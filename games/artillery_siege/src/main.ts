import * as THREE from "three";
import { SharedAudioManager } from "../../../shared/audioManager";
import { BaseGame } from "../../../shared/baseGame";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { ArtilleryGraphicsManager } from "./graphics/artilleryGraphics";
import {
	ArtilleryPhysicsManager,
	type ShellType,
} from "./physics/artilleryPhysics";
import { ArtilleryHUD } from "./ui/hud";

class ArtilleryGame extends BaseGame {
	private physics: ArtilleryPhysicsManager;
	private graphics: ArtilleryGraphicsManager;
	private hud: ArtilleryHUD;
	private audio: SharedAudioManager;
	public settingsOverlay: SettingsOverlay;

	// Game Mode & State
	private gameMode: "SIEGE" | "SANDBOX" = "SIEGE";
	private currentLevel: number = 1;
	private currentStage: 1 | 2 = 1;

	// Cannon Aim State (degrees)
	public pitchDeg: number = 40.0;
	public yawDeg: number = 0.0;
	public powerMps: number = 35.0;

	// Special Shell Shop Prices
	private shellPrices: Record<ShellType, number> = {
		BASIC: 0,
		CLUSTER: 50,
		ICE: 75,
		GRAPPLE: 100,
	};
	public selectedShellType: ShellType = "BASIC";

	// Game Stats & Economy
	public totalLevelTargets: number = 3;
	public hitTargetsCount: number = 0;
	public isLevelComplete: boolean = false;

	private spaceDebounce: boolean = false;

	constructor() {
		super();
		this.physics = new ArtilleryPhysicsManager();
		this.graphics = new ArtilleryGraphicsManager();
		this.audio = new SharedAudioManager();
		this.hud = new ArtilleryHUD();
		this.settingsOverlay = new SettingsOverlay({
			gameId: "artillery_siege",
			inputManager: this.input,
			onPauseToggle: (paused) => {
				if (this.isLevelComplete || this.isGameOver) return;
				this.isPaused = paused;
			},
			onRestart: () =>
				this.gameMode === "SANDBOX"
					? this.startSandbox()
					: this.startLevel(this.currentLevel),
			onToggleMute: () => this.audio.toggleMute(),
		});

		this.init();
	}

	private async init() {
		const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
		this.graphics.init(canvas);

		await this.physics.init();

		this.setupUI();
		this.startLevel(1);

		let lastTime = performance.now();
		const tick = (now: number) => {
			const dt = Math.min((now - lastTime) / 1000, 0.1);
			lastTime = now;

			this.update(dt);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	protected override onEscape() {
		if (this.isLevelComplete || this.isGameOver) return;
		this.settingsOverlay.toggle();
	}

	protected override onSpace() {
		if (this.isPaused) {
			this.settingsOverlay.toggle();
			return;
		}
		if (!this.spaceDebounce) {
			this.spaceDebounce = true;
			this.handleSpaceAction();
		}
	}

	protected override onKeyUp(e: KeyboardEvent) {
		if (e.code === "Space" || e.key === " ") {
			this.spaceDebounce = false;
		}
		if (e.code === "KeyR" || e.key === "r" || e.key === "R") {
			if (this.gameMode === "SANDBOX") {
				this.startSandbox();
			}
		}
	}

	private setupUI() {
		const btnSound = document.getElementById("btn-sound");
		if (btnSound) {
			btnSound.addEventListener("click", () => {
				const isMuted = this.audio.toggleMute();
				btnSound.innerHTML = isMuted ? "🔊 Mute" : "🔊 Sound ON";
			});
		}

		const btnStageTrigger = document.getElementById("btn-stage-trigger");
		if (btnStageTrigger) {
			btnStageTrigger.addEventListener("click", () => this.handleSpaceAction());
		}

		const btnFireTrigger = document.getElementById("btn-fire-trigger");
		if (btnFireTrigger) {
			btnFireTrigger.addEventListener("click", () => this.handleSpaceAction());
		}

		// Mode Toggle Button
		this.hud.btnModeToggle.addEventListener("click", () => {
			if (this.gameMode === "SIEGE") {
				this.startSandbox();
			} else {
				this.startLevel(1);
			}
		});

		// Sandbox Rebuild Button
		this.hud.btnSandboxRebuild.addEventListener("click", () => {
			if (this.gameMode === "SANDBOX") {
				this.startSandbox();
			}
		});

		// Arsenal Store Option Buttons
		this.hud.shellOptions.forEach((btn, type) => {
			btn.addEventListener("click", () => {
				const cost = this.shellPrices[type];
				if (type !== "BASIC" && this.physics.coinsEarned < cost) {
					this.hud.setSpotterMessage(
						`NOT ENOUGH COINS! ${type} shell requires ${cost}🪙 (You have ${this.physics.coinsEarned}🪙).`,
					);
					this.audio.playHit(0.5);
					return;
				}
				this.selectedShellType = type;
				this.hud.selectShellType(type);
				this.hud.setSpotterMessage(
					`ARSENAL LOADED: Selected ${type} Shell (${cost === 0 ? "Infinite" : `${cost}🪙`}).`,
				);
			});
		});
	}

	private startLevel(level: number) {
		this.gameMode = "SIEGE";
		this.currentLevel = level;
		this.currentStage = 1;
		this.isLevelComplete = false;
		this.isGameOver = false;

		this.pitchDeg = 40.0;
		this.yawDeg = 0.0;
		this.powerMps = 35.0;
		this.hitTargetsCount = 0;

		this.graphics.resetLevelVisuals();
		this.physics.setupLevel(level, 1.0 + level * 0.5);

		this.totalLevelTargets = this.physics.targets.size;
		this.graphics.syncTargets(this.physics.targets);

		this.hud.btnModeToggle.innerText = "🏰 Sandbox Mode";
		this.hud.btnSandboxRebuild.style.display = "none";

		this.hud.setStage(1);
		this.hud.updateStats(
			`Lvl ${level}`,
			this.physics.coinsEarned,
			"⚪ Standard (∞)",
		);
		this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
		this.hud.setSpotterMessage(
			`Level ${level} Siege Ready! Basic shells are INFINITE. Earn coins to buy special arsenal shells!`,
		);
	}

	private startSandbox() {
		this.gameMode = "SANDBOX";
		this.currentStage = 1;
		this.isLevelComplete = false;
		this.isGameOver = false;

		this.pitchDeg = 38.0;
		this.yawDeg = 0.0;
		this.powerMps = 38.0;

		this.graphics.resetLevelVisuals();
		this.physics.setupSandboxLevel();

		this.totalLevelTargets = this.physics.targets.size;
		this.graphics.syncTargets(this.physics.targets);

		this.hud.btnModeToggle.innerText = "🎯 Classic Siege";
		this.hud.btnSandboxRebuild.style.display = "inline-flex";

		this.hud.setStage(1);
		this.hud.updateStats(
			"Sandbox 💣",
			this.physics.coinsEarned,
			"⚪ Standard (∞)",
		);
		this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
		this.hud.setSpotterMessage(
			"CASTLE DESTRUCTION SANDBOX MODE: Unlimited destruction! Rebuild anytime with 'R'.",
		);
	}

	private handleSpaceAction() {
		if (this.isLevelComplete || this.isGameOver) return;
		if (this.physics.activeBalls.some((b) => b.active)) return;

		if (this.currentStage === 1) {
			this.currentStage = 2;
			this.powerMps = 30.0;
			this.hud.setStage(2);
			this.hud.setSpotterMessage(
				"STAGE 2: P1: Press UP/DOWN to set Power | P2: Press LEFT/RIGHT to fine tune angle | Press SPACE to Fire!",
			);
			this.audio.playCollect();
		} else if (this.currentStage === 2) {
			this.fireCannon();
		}
	}

	private fireCannon() {
		const cost = this.shellPrices[this.selectedShellType];
		if (cost > 0) {
			if (this.physics.coinsEarned < cost) {
				this.hud.setSpotterMessage(
					`NOT ENOUGH COINS! Reverting to Standard shell.`,
				);
				this.selectedShellType = "BASIC";
				this.hud.selectShellType("BASIC");
			} else {
				this.physics.coinsEarned -= cost;
			}
		}

		const ball = this.physics.launchShell(
			this.pitchDeg,
			this.yawDeg,
			this.powerMps,
			this.selectedShellType,
		);
		if (ball) {
			this.graphics.triggerRecoil();
			this.audio.playFall();
			this.hud.setSpotterMessage(
				`FIRED ${this.selectedShellType} SHELL AT ${this.powerMps.toFixed(1)} m/s! Tracking trajectory...`,
			);
		}

		this.currentStage = 1;
		this.hud.setStage(1);
	}

	private update(dt: number) {
		if (this.isPaused) return;

		// 1. Aim Controls in Stage 1 or Stage 2
		if (
			this.currentStage === 1 &&
			!this.physics.activeBalls.some((b) => b.active)
		) {
			if (
				this.input.keysPressed.has("ArrowUp") ||
				this.input.keysPressed.has("KeyW")
			) {
				this.pitchDeg = Math.max(10.0, this.pitchDeg - dt * 17.0);
			}
			if (
				this.input.keysPressed.has("ArrowDown") ||
				this.input.keysPressed.has("KeyS")
			) {
				this.pitchDeg = Math.min(75.0, this.pitchDeg + dt * 17.0);
			}

			if (
				this.input.keysPressed.has("ArrowRight") ||
				this.input.keysPressed.has("KeyD")
			) {
				this.yawDeg = Math.min(50.0, this.yawDeg + dt * 20.0);
			}
			if (
				this.input.keysPressed.has("ArrowLeft") ||
				this.input.keysPressed.has("KeyA")
			) {
				this.yawDeg = Math.max(-50.0, this.yawDeg - dt * 20.0);
			}

			this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
		} else if (this.currentStage === 2) {
			if (
				this.input.keysPressed.has("ArrowUp") ||
				this.input.keysPressed.has("KeyW")
			) {
				this.powerMps = Math.min(65.0, this.powerMps + dt * 23.0);
			}
			if (
				this.input.keysPressed.has("ArrowDown") ||
				this.input.keysPressed.has("KeyS")
			) {
				this.powerMps = Math.max(15.0, this.powerMps - dt * 23.0);
			}

			if (
				this.input.keysPressed.has("ArrowRight") ||
				this.input.keysPressed.has("KeyD")
			) {
				this.yawDeg = Math.min(50.0, this.yawDeg + dt * 6.5);
			}
			if (
				this.input.keysPressed.has("ArrowLeft") ||
				this.input.keysPressed.has("KeyA")
			) {
				this.yawDeg = Math.max(-50.0, this.yawDeg - dt * 6.5);
			}

			const powerRatio = (this.powerMps - 15.0) / 50.0;
			this.hud.updatePowerBar(this.powerMps, powerRatio);
			this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
		}

		// 2. Parabolic Trajectory Predictor Sight
		const trajectoryPoints = this.physics.computeTrajectoryPoints(
			this.pitchDeg,
			this.yawDeg,
			this.powerMps,
		);
		this.graphics.renderTrajectoryPreview(trajectoryPoints);

		// 3. Update Turret 3D orientation
		this.graphics.updateTurretOrientation(this.pitchDeg, this.yawDeg);

		// 4. Physics Step
		const { impact, destroyedTargets, comboCount, slowMoTrigger } =
			this.physics.update(dt);

		// Slow-Motion trigger management
		if (slowMoTrigger) {
			this.graphics.slowMoFactor = 0.35;
			setTimeout(() => {
				this.graphics.slowMoFactor = 1.0;
			}, 900);
		}

		// 5. Sound & Combo Feedback
		if (destroyedTargets.length > 0) {
			this.audio.playHit(2.0);
			this.hitTargetsCount += destroyedTargets.length;

			if (comboCount >= 2) {
				const comboText = `CHAIN COLLAPSE x${comboCount}! +${comboCount * 75}🪙`;
				this.hud.triggerComboBanner(comboText);
			}
		}

		// 6. Active Cannonball Meshes
		this.graphics.syncBalls(this.physics.activeBalls);

		let activePosVector: THREE.Vector3 | null = null;
		const mainBall = this.physics.activeBalls.find((b) => b.active);
		if (mainBall) {
			const pos = mainBall.body.translation();
			activePosVector = new THREE.Vector3(pos.x, pos.y, pos.z);
		}

		// 7. Impact explosion & spotter feedback
		if (impact) {
			this.audio.playHit(1.5);
			this.graphics.triggerExplosion(
				impact.position,
				impact.shellType === "ICE" ? "ice" : "fire",
			);

			const dist = impact.distanceToTarget;
			let feedback = `${impact.shellType} IMPACT LANDED! `;
			if (impact.targetHitId && dist < 3.0) {
				feedback += `DIRECT HIT! Structure collapsed.`;
			} else {
				feedback += `Splash distance ${dist}m to nearest block.`;
			}
			this.hud.setSpotterMessage(feedback);

			if (this.gameMode === "SIEGE") {
				setTimeout(() => this.checkGameCondition(), 1000);
			}
		}

		// 8. Castle Integrity, Targets & Voxel Debris Sync
		this.graphics.syncTargets(this.physics.targets);
		this.graphics.syncVoxelChunks(this.physics.voxelChunks);
		this.hud.updateCastleIntegrity(this.physics.getCastleIntegrity());

		// 9. Stats & Radar update
		const modeText =
			this.gameMode === "SIEGE" ? `Lvl ${this.currentLevel}` : "Sandbox 💣";
		this.hud.updateStats(
			modeText,
			this.physics.coinsEarned,
			`${this.selectedShellType}`,
		);
		this.hud.drawRadarMap(this.physics.targets);

		// 10. Render 3D Graphics
		this.graphics.update(dt, activePosVector);
	}

	private checkGameCondition() {
		if (this.isLevelComplete || this.isGameOver) return;

		let allDestroyed = true;
		this.physics.targets.forEach((t) => {
			if (!t.isDestroyed) allDestroyed = false;
		});

		if (allDestroyed) {
			this.isLevelComplete = true;
			this.audio.playCollect();
			this.hud.showModal(
				"SECTOR CLEARED! 💥",
				`All targets in Level ${this.currentLevel} destroyed! Earned bonus coins.`,
				"Next Level ▶",
				() => this.startLevel(this.currentLevel + 1),
			);
		}
	}
}

window.addEventListener("DOMContentLoaded", () => {
	new ArtilleryGame();
});
