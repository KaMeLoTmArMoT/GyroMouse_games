import type { SharedAudioManager } from "../../../../shared/audioManager";
import { BaseGame } from "../../../../shared/baseGame";
import { MenuNav } from "../../../../shared/menuNav";
import type { SettingsOverlay } from "../../../../shared/settingsOverlay";
import type { CraneGraphicsManager } from "../graphics/craneGraphics";
import {
	CRATE_TYPES,
	type CranePhysicsManager,
	type CrateTypeId,
} from "../physics/cranePhysics";

export type GameState =
	| "IDLE"
	| "SPAWNING"
	| "PLAYING"
	| "COUNTDOWN"
	| "VICTORY"
	| "GAME_OVER";

export class CraneGameLogic extends BaseGame {
	public state: GameState = "IDLE";

	public currentLevel: number = 1;
	public targetCrateCount: number = 3;
	public currentCratesSpawned: number = 0;
	public nextCargoType: CrateTypeId = "STANDARD";

	// Countdown timer
	public countdownTimer: number = 5.0;

	// UI Element references
	private hudLevelElem: HTMLElement | null = null;
	private hudCargoElem: HTMLElement | null = null;
	private hudNextCargoElem: HTMLElement | null = null;
	private hudBalanceBarElem: HTMLElement | null = null;
	private hudBalanceTextElem: HTMLElement | null = null;
	private hudHeatBarElem: HTMLElement | null = null;
	private hudHeatTextElem: HTMLElement | null = null;

	private countdownOverlay: HTMLElement | null = null;
	private modalOverlay: HTMLElement | null = null;
	private modalTitle: HTMLElement | null = null;
	private modalDesc: HTMLElement | null = null;
	private modalBtn: HTMLElement | null = null;

	public settingsOverlay?: SettingsOverlay;

	private physics: CranePhysicsManager;
	private graphics: CraneGraphicsManager;
	private audio: SharedAudioManager;
	private modalMenuNav!: MenuNav;

	constructor(
		physics: CranePhysicsManager,
		graphics: CraneGraphicsManager,
		audio: SharedAudioManager,
	) {
		super();
		this.physics = physics;
		this.graphics = graphics;
		this.audio = audio;

		this.physics.onOverheatCallback = () => {
			this.audio.playTone(180, 0.4, "sawtooth");
		};

		this.bindUI();
	}

	protected override onEscape() {
		if (this.state !== "VICTORY" && this.state !== "GAME_OVER") {
			this.settingsOverlay?.toggle();
		}
	}

	protected override onSpace() {
		if (this.isPaused) {
			this.settingsOverlay?.toggle();
		} else if (this.state !== "VICTORY" && this.state !== "GAME_OVER") {
			this.triggerDropAction();
		}
	}

	private bindUI() {
		this.hudLevelElem = document.getElementById("hud-level");
		this.hudCargoElem = document.getElementById("hud-cargo");
		this.hudNextCargoElem = document.getElementById("hud-next-cargo");
		this.hudBalanceBarElem = document.getElementById("hud-balance-bar");
		this.hudBalanceTextElem = document.getElementById("hud-balance-text");
		this.hudHeatBarElem = document.getElementById("hud-heat-bar");
		this.hudHeatTextElem = document.getElementById("hud-heat-text");

		this.countdownOverlay = document.getElementById("countdown-overlay");
		this.modalOverlay = document.getElementById("game-modal");
		this.modalTitle = document.getElementById("modal-title");
		this.modalDesc = document.getElementById("modal-desc");
		this.modalBtn = document.getElementById("modal-btn");
		if (this.modalOverlay) {
			this.modalMenuNav = new MenuNav({ container: this.modalOverlay });
		}

		if (this.modalBtn) {
			this.modalBtn.addEventListener("click", () => {
				if (this.state === "VICTORY") {
					this.nextLevel();
				} else if (this.state === "GAME_OVER") {
					this.restartLevel();
				}
			});
		}

		const soundBtn = document.getElementById("btn-sound");
		if (soundBtn) {
			soundBtn.textContent = this.audio.getMuted() ? "🔊 Mute" : "🔊 Sound ON";
			soundBtn.addEventListener("click", () => {
				const muted = this.audio.toggleMute();
				soundBtn.textContent = muted ? "🔊 Mute" : "🔊 Sound ON";
			});
		}

		const savedGoal = localStorage.getItem("crane_tower_target_goal");
		const goalSelect = document.getElementById(
			"select-target-goal",
		) as HTMLSelectElement;
		if (goalSelect) {
			if (savedGoal) goalSelect.value = savedGoal;
			goalSelect.addEventListener("change", () => {
				const val = parseInt(goalSelect.value, 10);
				localStorage.setItem("crane_tower_target_goal", val.toString());
				this.startLevel(1, val);
			});
		}

		const targetToggle = document.getElementById(
			"chk-show-target",
		) as HTMLInputElement;
		if (targetToggle) {
			targetToggle.addEventListener("change", (e) => {
				const checked = (e.target as HTMLInputElement).checked;
				this.graphics.setTargetRegionVisible(checked);
			});
		}

		const dropBtn = document.getElementById("btn-drop");
		if (dropBtn) {
			dropBtn.addEventListener("click", () => {
				this.triggerDropAction();
			});
		}

		const canvas = document.getElementById("game-canvas");
		if (canvas) {
			canvas.addEventListener("pointerdown", (e) => {
				// Prevent drop trigger if clicking top bar buttons / selects / modals
				const target = e.target as HTMLElement;
				if (target?.closest(".top-bar, .modal-overlay, #countdown-overlay"))
					return;
				if (this.state === "PLAYING" || this.state === "COUNTDOWN") {
					this.triggerDropAction();
				}
			});
		}
	}

	public startLevel(level: number = 1, customTargetCount?: number) {
		this.currentLevel = level;

		const goalSelect = document.getElementById(
			"select-target-goal",
		) as HTMLSelectElement;
		if (customTargetCount !== undefined) {
			this.targetCrateCount = customTargetCount;
		} else if (goalSelect?.value) {
			this.targetCrateCount = parseInt(goalSelect.value, 10) || 3;
		} else {
			const savedGoal = localStorage.getItem("crane_tower_target_goal");
			this.targetCrateCount = savedGoal ? parseInt(savedGoal, 10) : 3;
		}

		if (goalSelect) {
			goalSelect.value = `${this.targetCrateCount}`;
		}
		localStorage.setItem(
			"crane_tower_target_goal",
			this.targetCrateCount.toString(),
		);

		this.currentCratesSpawned = 0;
		this.countdownTimer = 5.0;
		this.nextCargoType = "STANDARD";

		this.graphics.clearCrates();
		this.physics.clear();

		this.updateHUD();
		this.hideModal();
		this.hideCountdown();

		this.spawnNextCrate();
		this.state = "PLAYING";
	}

	public triggerDropAction() {
		if (this.state !== "PLAYING" && this.state !== "COUNTDOWN") return;

		if (this.physics.currentHeldCrateId) {
			// Release held crate
			this.physics.releaseHeldCrate();
			this.audio.playTone(300, 0.15, "square");

			// Schedule spawn of next crate if target not reached
			if (this.currentCratesSpawned < this.targetCrateCount) {
				this.tryScheduleSpawnNextCrate();
			}
		} else {
			// Try to re-grab nearby crate if magnet lowered onto one
			const reGrabbed = this.physics.tryRegrabCrate();
			if (reGrabbed) {
				this.audio.playTone(500, 0.2, "sine");
			}
		}
	}

	private tryScheduleSpawnNextCrate() {
		setTimeout(() => {
			if (this.state === "PLAYING" || this.state === "COUNTDOWN") {
				if (this.physics.isSpawnZoneClear()) {
					this.spawnNextCrate();
				} else {
					// If spawn zone is obstructed, check again shortly
					this.tryScheduleSpawnNextCrate();
				}
			}
		}, 1200);
	}

	private spawnNextCrate() {
		if (this.currentCratesSpawned >= this.targetCrateCount) return;

		this.currentCratesSpawned++;
		const crateId = `crate_lvl${this.currentLevel}_${this.currentCratesSpawned}`;
		const typeToSpawn = this.nextCargoType;

		// Spawn crate matching current type
		this.physics.spawnCrate(crateId, typeToSpawn);
		this.graphics.addCrateMesh(crateId, typeToSpawn);

		// Select next cargo type for upcoming spawn
		const types: CrateTypeId[] = ["STANDARD", "LONG", "HEAVY", "LIGHT"];
		this.nextCargoType = types[Math.floor(Math.random() * types.length)];

		this.updateHUD();
	}

	public update(dt: number) {
		if (this.state === "PLAYING" || this.state === "COUNTDOWN") {
			// Check ground crash failure
			if (this.physics.checkGroundCollision()) {
				this.triggerGameOver(
					"A crate fell off the train platform onto the ground!",
				);
				return;
			}

			// Check target region crate count
			const { count, settled } = this.physics.countCratesInTargetRegion();
			this.updateHUD(count);

			// Check if all required crates are placed in target region and settled
			if (count >= this.targetCrateCount && settled) {
				if (this.state !== "COUNTDOWN") {
					this.state = "COUNTDOWN";
					this.countdownTimer = 5.0;
				}

				// Advance countdown
				this.countdownTimer -= dt;
				const displaySec = Math.max(1, Math.ceil(this.countdownTimer));
				this.showCountdown(displaySec);

				if (this.countdownTimer <= 0) {
					this.triggerVictory();
				}
			} else {
				// If stack shifts out of zone during countdown, cancel countdown
				if (this.state === "COUNTDOWN" && count < this.targetCrateCount) {
					this.state = "PLAYING";
					this.hideCountdown();
				}
			}
		} else if (this.state === "VICTORY") {
			// Drive train off-screen
			this.physics.moveTrain(dt * 6.0);
		}
	}

	private triggerVictory() {
		this.state = "VICTORY";
		this.hideCountdown();
		this.physics.glueCratesToTrain();

		// Play Train Horn synth
		this.audio.playTone(320, 0.6, "sawtooth");
		setTimeout(() => this.audio.playTone(420, 1.2, "sawtooth"), 180);

		setTimeout(() => {
			this.showModal(
				"Level Cleared! 🎉",
				`Train fully loaded with ${this.targetCrateCount} crates!`,
				"Next Level ▶",
			);
		}, 1800);
	}

	private triggerGameOver(reason: string) {
		this.state = "GAME_OVER";
		this.hideCountdown();
		this.audio.playFall();

		this.showModal("Cargo Spilled! 💥", reason, "Try Again 🔄");
	}

	private nextLevel() {
		const nextCount = Math.min(11, this.targetCrateCount + 2);
		const goalSelect = document.getElementById(
			"select-target-goal",
		) as HTMLSelectElement;
		if (goalSelect) goalSelect.value = `${nextCount}`;
		this.startLevel(this.currentLevel + 1, nextCount);
	}

	private restartLevel() {
		this.startLevel(this.currentLevel, this.targetCrateCount);
	}

	private updateHUD(currentInZone?: number) {
		if (this.hudLevelElem) {
			this.hudLevelElem.textContent = `${this.currentLevel}`;
		}
		if (this.hudCargoElem) {
			const displayZone = currentInZone !== undefined ? currentInZone : 0;
			this.hudCargoElem.textContent = `${displayZone} / ${this.targetCrateCount}`;
		}
		if (this.hudNextCargoElem) {
			const nextConfig = CRATE_TYPES[this.nextCargoType];
			this.hudNextCargoElem.textContent = nextConfig
				? nextConfig.name
				: "Standard";
			this.hudNextCargoElem.style.color = nextConfig
				? nextConfig.color
				: "#38bdf8";
		}

		// Update Wagon Balance Meter
		if (this.hudBalanceBarElem && this.hudBalanceTextElem) {
			const offset = this.physics.centerOfMassOffset; // -1.0 to +1.0
			const absOffset = Math.abs(offset);
			const widthPct = Math.min(50, absOffset * 50);

			if (offset >= 0) {
				this.hudBalanceBarElem.style.left = "50%";
				this.hudBalanceBarElem.style.width = `${widthPct}%`;
			} else {
				this.hudBalanceBarElem.style.left = `${50 - widthPct}%`;
				this.hudBalanceBarElem.style.width = `${widthPct}%`;
			}

			if (absOffset < 0.25) {
				this.hudBalanceBarElem.style.background = "#10b981";
				this.hudBalanceTextElem.textContent = "BALANCED";
				this.hudBalanceTextElem.style.color = "#10b981";
			} else if (absOffset < 0.6) {
				this.hudBalanceBarElem.style.background = "#f59e0b";
				this.hudBalanceTextElem.textContent = "SLANTED";
				this.hudBalanceTextElem.style.color = "#f59e0b";
			} else {
				this.hudBalanceBarElem.style.background = "#ef4444";
				this.hudBalanceTextElem.textContent = "UNBALANCED!";
				this.hudBalanceTextElem.style.color = "#ef4444";
			}
		}

		// Update Magnet Heat Gauge
		if (this.hudHeatBarElem && this.hudHeatTextElem) {
			const heat = Math.round(this.physics.magnetHeat);
			this.hudHeatBarElem.style.width = `${heat}%`;

			if (heat < 40) {
				this.hudHeatBarElem.style.background = "#38bdf8";
				this.hudHeatTextElem.textContent = "COOL";
				this.hudHeatTextElem.style.color = "#38bdf8";
			} else if (heat < 80) {
				this.hudHeatBarElem.style.background = "#f59e0b";
				this.hudHeatTextElem.textContent = `WARM (${heat}%)`;
				this.hudHeatTextElem.style.color = "#f59e0b";
			} else {
				this.hudHeatBarElem.style.background = "#ef4444";
				this.hudHeatTextElem.textContent = `OVERHEAT! (${heat}%)`;
				this.hudHeatTextElem.style.color = "#ef4444";
			}
		}
	}

	private lastSecPlayed: number = -1;

	private showCountdown(sec: number) {
		if (this.countdownOverlay) {
			this.countdownOverlay.style.display = "block";
			this.countdownOverlay.innerHTML = `<div style="font-size: 1.2rem; color: #cbd5e1; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px;">Hold Stack Secure!</div><div style="font-size: 5rem;">${sec}</div>`;
			if (this.lastSecPlayed !== sec) {
				this.lastSecPlayed = sec;
				this.audio.playTone(800 - sec * 80, 0.1, "sine");
			}
		}
	}

	private hideCountdown() {
		if (this.countdownOverlay) {
			this.countdownOverlay.style.display = "none";
		}
	}

	private showModal(title: string, desc: string, btnText: string) {
		if (this.modalTitle) this.modalTitle.textContent = title;
		if (this.modalDesc) this.modalDesc.textContent = desc;
		if (this.modalBtn) this.modalBtn.textContent = btnText;
		if (this.modalOverlay) {
			this.modalOverlay.classList.add("active");
			this.modalMenuNav?.activate();
		}
	}

	private hideModal() {
		if (this.modalOverlay) {
			this.modalOverlay.classList.remove("active");
			this.modalMenuNav?.deactivate();
		}
	}
}
