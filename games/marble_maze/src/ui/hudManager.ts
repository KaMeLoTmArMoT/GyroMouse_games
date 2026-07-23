import { TerrainType } from '../maze/mazeGenerator';
import { InputSettings } from '../../../../shared/inputManager';
import { MenuNav } from '../../../../shared/menuNav';

export interface HudCallbacks {
  onRestart: (fromCheckpoint?: boolean) => void;
  onNewRandom: () => void;
  onApplySeed: (seed: string) => void;
  onUpdateSettings: (settings: Partial<InputSettings>, difficulty: string, debugPath?: boolean) => void;
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

  private fallMenuNav!: MenuNav;
  private winMenuNav!: MenuNav;

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

    this.fallMenuNav = new MenuNav({ container: this.fallModal });
    this.winMenuNav = new MenuNav({ container: this.winModal });

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

    document.addEventListener('keydown', (e) => {
      if (!this.settingsModal.classList.contains('active')) return;
      if (e.key === 'Escape') {
        this.closeSettingsModal();
      } else if (e.key === 'Enter') {
        this.saveSettings();
      }
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

  public updateTerrain(terrain: TerrainType) {
    let text = '🛣️ ASPHALT';
    let color = '#9ca3af';

    switch (terrain) {
      case 'ice':
        text = '🧊 ICE (SLIPPERY)';
        color = '#38bdf8';
        break;
      case 'snow':
        text = '❄️ SNOW';
        color = '#e2e8f0';
        break;
      case 'grass':
        text = '🌿 GRASS';
        color = '#4ade80';
        break;
      case 'dirt':
        text = '🪵 MUD / DIRT (SLOW)';
        color = '#d97706';
        break;
      case 'cobblestone':
        text = '🧱 COBBLESTONE';
        color = '#a855f7';
        break;
      case 'sand':
        text = '🏜️ SAND (SLOW)';
        color = '#f59e0b';
        break;
      case 'asphalt':
      default:
        text = '🛣️ ASPHALT';
        color = '#9ca3af';
        break;
    }

    this.surfaceEl.textContent = text;
    this.surfaceEl.style.borderColor = color;
    this.surfaceEl.style.color = color;
  }

   public openSettingsModal() {
    this.settingsModal.classList.add('active');
   }

   public updateDebugPathSetting(enabled: boolean) {
    const debugPathCheckbox = document.getElementById('setting-debug-path') as HTMLInputElement;
    if (debugPathCheckbox) {
      debugPathCheckbox.checked = enabled;
    }
   }

  public closeSettingsModal() {
    this.settingsModal.classList.remove('active');
  }

  private saveSettings() {
    const mode = (document.getElementById('setting-mode') as HTMLSelectElement).value as any;
    const mouseEnabled = (document.getElementById('setting-mouse-enable') as HTMLInputElement).checked;
    const difficulty = (document.getElementById('setting-difficulty') as HTMLSelectElement).value;
    const sensitivity = parseFloat((document.getElementById('setting-sensitivity') as HTMLInputElement).value);
    const customSeed = (document.getElementById('setting-seed') as HTMLInputElement).value.trim();
    const debugPath = (document.getElementById('setting-debug-path') as HTMLInputElement).checked;

    this.callbacks.onUpdateSettings(
      {
        mode,
        mouseEnabled,
        sensitivity
      },
      difficulty,
      debugPath
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
    this.winMenuNav.activate();
  }

  public closeWinModal() {
    this.winModal.classList.remove('active');
    this.winMenuNav.deactivate();
  }

  public showFallModal(hasCheckpoint: boolean) {
    this.isTimerRunning = false;
    this.fallModal.classList.add('active');
    
    const restartFromCheckpointBtn = document.getElementById('btn-fall-checkpoint');
    
    if (restartFromCheckpointBtn) {
      if (hasCheckpoint) {
        restartFromCheckpointBtn.style.display = 'inline-block';
        restartFromCheckpointBtn.onclick = () => {
          this.closeFallModal();
          (this.callbacks.onRestart as (fromCheckpoint?: boolean) => void)(true);
        };
      } else {
        restartFromCheckpointBtn.style.display = 'none';
      }
    }

    this.fallMenuNav.activate();
  }

  public closeFallModal() {
    this.fallModal.classList.remove('active');
    this.fallMenuNav.deactivate();
  }
}
