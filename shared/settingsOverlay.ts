import type {
	ControlMode,
	InputSettings,
	SharedInputManager,
} from "./inputManager";
import { MenuNav } from "./menuNav";
import "./settingsOverlay.css";

export interface SavedSettings {
	mode: ControlMode;
	sensitivity: number;
	invertX: boolean;
	invertY: boolean;
}

export interface SettingsOverlayOptions {
	gameId: string;
	inputManager: SharedInputManager;
	onPauseToggle?: (isPaused: boolean) => void;
	onRestart?: () => void;
	onToggleMute?: () => boolean;
	onQuitToHub?: () => void;
	onSettingsChanged?: (settings: InputSettings) => void;
	customGameOptionsHtml?: string;
	onBindCustomOptions?: (container: HTMLElement) => void;
}

export class SettingsOverlay {
	private storageKey: string;
	private inputManager: SharedInputManager;
	private options: SettingsOverlayOptions;
	private onSettingsChanged?: (settings: InputSettings) => void;

	private overlayEl!: HTMLElement;
	private gearBtnEl!: HTMLElement;
	private menuNav!: MenuNav;
	public isOpen: boolean = false;

	private boundKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape" || e.code === "Escape" || e.key === "Esc") {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		}
	};

	constructor(options: SettingsOverlayOptions) {
		this.options = options;
		this.storageKey = `gyromouse_settings_${options.gameId}`;
		this.inputManager = options.inputManager;
		this.onSettingsChanged = options.onSettingsChanged;

		this.loadSavedSettings();
		this.createUI();
		window.addEventListener("keydown", this.boundKeyDown, true);
	}

	private loadSavedSettings() {
		try {
			const stored = localStorage.getItem(this.storageKey);
			if (!stored) return;
			const { mode, sensitivity, invertX, invertY }: Partial<SavedSettings> =
				JSON.parse(stored);
			if (mode) this.inputManager.settings.mode = mode;
			if (typeof sensitivity === "number")
				this.inputManager.settings.sensitivity = sensitivity;
			if (typeof invertX === "boolean")
				this.inputManager.settings.invertX = invertX;
			if (typeof invertY === "boolean")
				this.inputManager.settings.invertY = invertY;
			this.inputManager.settings.mouseEnabled = mode === "pointer";
		} catch {}
	}

	private saveSettings() {
		const data: SavedSettings = {
			mode: this.inputManager.settings.mode,
			sensitivity: this.inputManager.settings.sensitivity,
			invertX: this.inputManager.settings.invertX,
			invertY: this.inputManager.settings.invertY,
		};
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(data));
		} catch {}

		this.onSettingsChanged?.(this.inputManager.settings);
	}

	private createUI() {
		// 1. Gear button
		this.gearBtnEl = document.createElement("div");
		this.gearBtnEl.className = "gm-gear-btn";
		this.gearBtnEl.innerHTML = "⚙️";
		this.gearBtnEl.title = "Pause & Settings (ESC)";
		this.gearBtnEl.onclick = () => this.toggle();
		document.body.appendChild(this.gearBtnEl);

		// 2. Modal Overlay
		this.overlayEl = document.createElement("div");
		this.overlayEl.className = "gm-overlay";

		const {
			mode = "gyromouse",
			sensitivity = 1.0,
			invertX,
			invertY,
		} = this.inputManager.settings;
		const sensVal = sensitivity.toFixed(1);

		const customSection = this.options.customGameOptionsHtml
			? `
      <div class="gm-section-divider"></div>
      <div class="gm-section-title">🎯 Game Specific Options</div>
      <div id="gm-custom-options-container">
        ${this.options.customGameOptionsHtml}
      </div>
    `
			: "";

		this.overlayEl.innerHTML = `
      <div class="gm-card">
        <div class="gm-header">
          <div class="gm-title"><span>⏸️</span> Game Paused & Settings</div>
          <button class="gm-close-btn" id="gm-close-btn">&times;</button>
        </div>

        <div class="gm-actions-grid">
          <button class="gm-action-btn primary" id="gm-btn-resume">▶ Resume Game</button>
          <button class="gm-action-btn secondary" id="gm-btn-restart">🔄 Restart</button>
          <button class="gm-action-btn secondary" id="gm-btn-mute">🔊 Audio</button>
          <a href="../../index.html" class="gm-action-btn danger" id="gm-btn-hub">🏠 Quit to Hub</a>
        </div>

        ${customSection}

        <div class="gm-section-divider"></div>
        <div class="gm-section-title">🎮 GyroMouse Input Controls</div>

        <div class="gm-group">
          <label class="gm-label" for="gm-mode-select">Control Mode</label>
          <select class="gm-select" id="gm-mode-select">
            <option value="gyromouse" ${mode === "gyromouse" ? "selected" : ""}>Gyro Motion / Analog</option>
            <option value="pointer" ${mode === "pointer" ? "selected" : ""}>Air Mouse / Pointer</option>
            <option value="keyboard" ${mode === "keyboard" ? "selected" : ""}>Keyboard / WASD</option>
          </select>
        </div>
        <div class="gm-group">
          <label class="gm-label">Sensitivity Multiplier</label>
          <div class="gm-slider-row">
            <input type="range" class="gm-range" id="gm-sens-range" min="0.2" max="3.0" step="0.1" value="${sensVal}">
            <span class="gm-val-badge" id="gm-sens-badge">${sensVal}x</span>
          </div>
        </div>
        <div class="gm-group">
          <label class="gm-label">Axis Inversion</label>
          <div class="gm-checkbox-group">
            <label class="gm-checkbox-label">
              <input type="checkbox" id="gm-invert-x" ${invertX ? "checked" : ""}> Invert X
            </label>
            <label class="gm-checkbox-label">
              <input type="checkbox" id="gm-invert-y" ${invertY ? "checked" : ""}> Invert Y
            </label>
          </div>
        </div>
        <div class="gm-footer">
          <button class="gm-done-btn" id="gm-done-btn">Done</button>
        </div>
      </div>
    `;

		document.body.appendChild(this.overlayEl);

		// Initialize MenuNav for 2D spatial grid navigation in SettingsOverlay card
		const cardEl = this.overlayEl.querySelector(".gm-card") as HTMLElement;
		this.menuNav = new MenuNav({
			container: cardEl,
			buttonSelector: "button, input, select, a",
		});

		// Custom options binding callback
		if (this.options.onBindCustomOptions) {
			const container = this.overlayEl.querySelector(
				"#gm-custom-options-container",
			) as HTMLElement | null;
			if (container) {
				this.options.onBindCustomOptions(container);
			}
		}

		// Event bindings
		const $ = <T extends HTMLElement>(sel: string) =>
			this.overlayEl.querySelector<T>(sel);

		$("#gm-close-btn")?.addEventListener("click", () => this.close());
		$("#gm-done-btn")?.addEventListener("click", () => this.close());
		$("#gm-btn-resume")?.addEventListener("click", () => this.close());

		$("#gm-btn-restart")?.addEventListener("click", () => {
			this.close();
			this.options.onRestart?.();
		});

		$("#gm-btn-mute")?.addEventListener("click", (e) => {
			if (this.options.onToggleMute) {
				const isMuted = this.options.onToggleMute();
				(e.currentTarget as HTMLElement).innerHTML = isMuted
					? "🔇 Muted"
					: "🔊 Audio";
			}
		});

		this.overlayEl.addEventListener("click", (e) => {
			if (e.target === this.overlayEl) this.close();
		});

		$<HTMLSelectElement>("#gm-mode-select")?.addEventListener("change", (e) => {
			const selected = (e.target as HTMLSelectElement).value as ControlMode;
			this.inputManager.settings.mode = selected;
			this.inputManager.settings.mouseEnabled = selected === "pointer";
			this.saveSettings();
		});

		const sensRange = $<HTMLInputElement>("#gm-sens-range");
		const sensBadge = $("#gm-sens-badge");
		sensRange?.addEventListener("input", () => {
			const val = parseFloat(sensRange.value);
			if (sensBadge) sensBadge.textContent = `${val.toFixed(1)}x`;
			this.inputManager.settings.sensitivity = val;
			this.saveSettings();
		});

		$<HTMLInputElement>("#gm-invert-x")?.addEventListener("change", (e) => {
			this.inputManager.settings.invertX = (
				e.target as HTMLInputElement
			).checked;
			this.saveSettings();
		});

		$<HTMLInputElement>("#gm-invert-y")?.addEventListener("change", (e) => {
			this.inputManager.settings.invertY = (
				e.target as HTMLInputElement
			).checked;
			this.saveSettings();
		});
	}

	public open() {
		this.isOpen = true;
		this.overlayEl.classList.add("open");
		this.menuNav.activate();
		this.options.onPauseToggle?.(true);
	}

	public close() {
		this.isOpen = false;
		this.overlayEl.classList.remove("open");
		this.menuNav.deactivate();
		this.options.onPauseToggle?.(false);
	}

	public toggle() {
		this.isOpen ? this.close() : this.open();
	}

	public destroy() {
		window.removeEventListener("keydown", this.boundKeyDown, true);
		this.gearBtnEl?.remove();
		this.overlayEl?.remove();
	}
}
