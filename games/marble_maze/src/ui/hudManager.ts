import { TerrainType, Difficulty } from '../maze/mazeGenerator';
import { InputSettings } from '../../../../shared/inputManager';

export interface HudCallbacks {
  onRestart: () => void;
  onNewRandom: () => void;
  onApplySeed: (seed: string) => void;
  onUpdateSettings: (settings: Partial<InputSettings>, difficulty: Difficulty) => void;
  onToggleMute: () => boolean;
}

export class HudManager {
  private timerEl!: HTMLElement;
  private coinEl!: HTMLElement;
  private seedEl!: HTMLElement;
  private surfaceEl!: HTMLElement;

  private settingsModal!: HTMLElement;
  private winModal!: HTMLElement;
  private fallModal!: HTMLElement;

  private winTimeEl!: HTMLElement;
  private winCoinsEl!: HTMLElement;

  private callbacks: HudCallbacks;
  private isTimerRunning: boolean = false;
  private elapsedSeconds: number = 0;

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.bindDOM();
  }

  private bindDOM() {
    this.timerEl = document.getElementById('hud-timer')!;
    this.coinEl = document.getElementById('hud-coins')!;
    this.seedEl = document.getElementById('hud-seed')!;
    this.surfaceEl = document.getElementById('hud-surface')!;

    this.settingsModal = document.getElementById('settings-modal')!;
    this.winModal = document.getElementById('win-modal')!;
    this.fallModal = document.getElementById('fall-modal')!;

    this.winTimeEl = document.getElementById('win-time')!;
    this.winCoinsEl = document.getElementById('win-coins')!;

    document.getElementById('btn-restart')?.addEventListener('click', () => this.callbacks.onRestart());
    document.getElementById('btn-new-level')?.addEventListener('click', () => this.callbacks.onNewRandom());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('btn-mute')?.addEventListener('click', (e) => {
      const isMuted = this.callbacks.onToggleMute();
      (e.currentTarget as HTMLElement).innerText = isMuted ? '🔇 Muted' : '🔊 Audio';
    });

    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('btn-save-settings')?.addEventListener('click', () => this.saveSettings());

    document.getElementById('btn-win-next')?.addEventListener('click', () => {
      this.closeWinModal();
      this.callbacks.onNewRandom();
    });

    document.getElementById('btn-fall-retry')?.addEventListener('click', () => {
      this.closeFallModal();
      this.callbacks.onRestart();
    });

    this.seedEl.addEventListener('click', () => {
      const seedText = this.seedEl.getAttribute('data-seed') || '';
      navigator.clipboard.writeText(seedText);
      alert(`Copied seed "${seedText}" to clipboard!`);
    });
  }

  public startTimer() {
    this.isTimerRunning = true;
  }

  public stopTimer(): number {
    this.isTimerRunning = false;
    return this.elapsedSeconds;
  }

  public resetTimer() {
    this.elapsedSeconds = 0;
    this.isTimerRunning = true;
    this.updateTimerDisplay(0);
  }

  public update(dt: number) {
    if (this.isTimerRunning) {
      this.elapsedSeconds += dt;
      this.updateTimerDisplay(this.elapsedSeconds);
    }
  }

  private updateTimerDisplay(totalSeconds: number) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds % 1) * 10);
    this.timerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  }

  public updateCoins(collected: number, total: number) {
    this.coinEl.innerText = `⭐ ${collected} / ${total}`;
  }

  public updateSeed(seed: string) {
    this.seedEl.innerText = `🌱 ${seed}`;
    this.seedEl.setAttribute('data-seed', seed);
  }

  public updateSurface(terrain: TerrainType) {
    this.surfaceEl.className = 'surface-badge';
    if (terrain === 'ice') {
      this.surfaceEl.classList.add('surface-ice');
      this.surfaceEl.innerText = '🧊 Ice (Slide!)';
    } else if (terrain === 'sand') {
      this.surfaceEl.classList.add('surface-sand');
      this.surfaceEl.innerText = '🏜️ Sand (Slow!)';
    } else {
      this.surfaceEl.classList.add('surface-asphalt');
      this.surfaceEl.innerText = '🪨 Asphalt';
    }
  }

  public openSettingsModal() {
    this.settingsModal.classList.add('active');
  }

  public closeSettingsModal() {
    this.settingsModal.classList.remove('active');
  }

  private saveSettings() {
    const mode = (document.getElementById('setting-mode') as HTMLSelectElement).value as any;
    const mouseEnabled = (document.getElementById('setting-mouse-enable') as HTMLInputElement).checked;
    const difficulty = (document.getElementById('setting-difficulty') as HTMLSelectElement).value as Difficulty;
    const sensitivity = parseFloat((document.getElementById('setting-sensitivity') as HTMLInputElement).value);
    const customSeed = (document.getElementById('setting-seed') as HTMLInputElement).value.trim();

    this.callbacks.onUpdateSettings(
      {
        mode,
        mouseEnabled,
        sensitivity
      },
      difficulty
    );

    if (customSeed) {
      this.callbacks.onApplySeed(customSeed);
    }

    this.closeSettingsModal();
  }

  public showWinModal(finalTimeSec: number, coins: number, totalCoins: number) {
    this.isTimerRunning = false;
    const mins = Math.floor(finalTimeSec / 60);
    const secs = (finalTimeSec % 60).toFixed(1);
    this.winTimeEl.innerText = `${mins > 0 ? `${mins}m ` : ''}${secs}s`;
    this.winCoinsEl.innerText = `${coins} / ${totalCoins}`;
    this.winModal.classList.add('active');
  }

  public closeWinModal() {
    this.winModal.classList.remove('active');
  }

  public showFallModal() {
    this.isTimerRunning = false;
    this.fallModal.classList.add('active');
  }

  public closeFallModal() {
    this.fallModal.classList.remove('active');
  }
}
