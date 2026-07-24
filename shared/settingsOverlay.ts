import { SharedInputManager, ControlMode, InputSettings } from './inputManager';
import './settingsOverlay.css';

export interface SavedSettings {
  mode: ControlMode;
  sensitivity: number;
  invertX: boolean;
  invertY: boolean;
}

export interface SettingsOverlayOptions {
  gameId: string;
  inputManager: SharedInputManager;
  onSettingsChanged?: (settings: InputSettings) => void;
}

export class SettingsOverlay {
  private storageKey: string;
  private inputManager: SharedInputManager;
  private onSettingsChanged?: (settings: InputSettings) => void;

  private overlayEl!: HTMLElement;
  private gearBtnEl!: HTMLElement;
  private isOpen: boolean = false;
  private boundKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.code === 'Escape' || e.key === 'Esc') this.toggle();
  };

  constructor(options: SettingsOverlayOptions) {
    this.storageKey = `gyromouse_settings_${options.gameId}`;
    this.inputManager = options.inputManager;
    this.onSettingsChanged = options.onSettingsChanged;

    this.loadSavedSettings();
    this.createUI();
    window.addEventListener('keydown', this.boundKeyDown, true);
  }

  private loadSavedSettings() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;
      const { mode, sensitivity, invertX, invertY }: Partial<SavedSettings> = JSON.parse(stored);
      if (mode) this.inputManager.settings.mode = mode;
      if (typeof sensitivity === 'number') this.inputManager.settings.sensitivity = sensitivity;
      if (typeof invertX === 'boolean') this.inputManager.settings.invertX = invertX;
      if (typeof invertY === 'boolean') this.inputManager.settings.invertY = invertY;
      this.inputManager.settings.mouseEnabled = (mode === 'pointer');
    } catch {}
  }

  private saveSettings() {
    const data: SavedSettings = {
      mode: this.inputManager.settings.mode,
      sensitivity: this.inputManager.settings.sensitivity,
      invertX: this.inputManager.settings.invertX,
      invertY: this.inputManager.settings.invertY
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {}

    this.onSettingsChanged?.(this.inputManager.settings);
  }

  private createUI() {
    // 1. Gear button
    this.gearBtnEl = document.createElement('div');
    this.gearBtnEl.className = 'gm-gear-btn';
    this.gearBtnEl.innerHTML = '⚙️';
    this.gearBtnEl.title = 'Game Settings (ESC)';
    this.gearBtnEl.onclick = () => this.toggle();
    document.body.appendChild(this.gearBtnEl);

    // 2. Modal Overlay
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'gm-overlay';

    const { mode = 'gyromouse', sensitivity = 1.0, invertX, invertY } = this.inputManager.settings;
    const sensVal = sensitivity.toFixed(1);

    this.overlayEl.innerHTML = `
      <div class="gm-card">
        <div class="gm-header">
          <div class="gm-title"><span>⚙️</span> Control Settings</div>
          <button class="gm-close-btn" id="gm-close-btn">&times;</button>
        </div>
        <div class="gm-group">
          <label class="gm-label" for="gm-mode-select">Control Mode</label>
          <select class="gm-select" id="gm-mode-select">
            <option value="gyromouse" ${mode === 'gyromouse' ? 'selected' : ''}>Gyro Motion / Analog</option>
            <option value="pointer" ${mode === 'pointer' ? 'selected' : ''}>Air Mouse / Pointer</option>
            <option value="keyboard" ${mode === 'keyboard' ? 'selected' : ''}>Keyboard / WASD</option>
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
              <input type="checkbox" id="gm-invert-x" ${invertX ? 'checked' : ''}> Invert X
            </label>
            <label class="gm-checkbox-label">
              <input type="checkbox" id="gm-invert-y" ${invertY ? 'checked' : ''}> Invert Y
            </label>
          </div>
        </div>
        <div class="gm-footer">
          <button class="gm-done-btn" id="gm-done-btn">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlayEl);

    // Event bindings
    const $ = <T extends HTMLElement>(sel: string) => this.overlayEl.querySelector<T>(sel);

    $('#gm-close-btn')?.addEventListener('click', () => this.close());
    $('#gm-done-btn')?.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => { if (e.target === this.overlayEl) this.close(); });

    $<HTMLSelectElement>('#gm-mode-select')?.addEventListener('change', (e) => {
      const selected = (e.target as HTMLSelectElement).value as ControlMode;
      this.inputManager.settings.mode = selected;
      this.inputManager.settings.mouseEnabled = (selected === 'pointer');
      this.saveSettings();
    });

    const sensRange = $<HTMLInputElement>('#gm-sens-range');
    const sensBadge = $('#gm-sens-badge');
    sensRange?.addEventListener('input', () => {
      const val = parseFloat(sensRange.value);
      if (sensBadge) sensBadge.textContent = `${val.toFixed(1)}x`;
      this.inputManager.settings.sensitivity = val;
      this.saveSettings();
    });

    $<HTMLInputElement>('#gm-invert-x')?.addEventListener('change', (e) => {
      this.inputManager.settings.invertX = (e.target as HTMLInputElement).checked;
      this.saveSettings();
    });

    $<HTMLInputElement>('#gm-invert-y')?.addEventListener('change', (e) => {
      this.inputManager.settings.invertY = (e.target as HTMLInputElement).checked;
      this.saveSettings();
    });
  }

  public open() {
    this.isOpen = true;
    this.overlayEl.classList.add('open');
  }

  public close() {
    this.isOpen = false;
    this.overlayEl.classList.remove('open');
  }

  public toggle() {
    this.isOpen ? this.close() : this.open();
  }

  public destroy() {
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.gearBtnEl?.remove();
    this.overlayEl?.remove();
  }
}
