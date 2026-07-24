import { CranePhysicsManager } from '../physics/cranePhysics';
import { CraneGraphicsManager } from '../graphics/craneGraphics';
import { SharedAudioManager } from '../../../../shared/audioManager';
import { MenuNav } from '../../../../shared/menuNav';
import { BaseGame } from '../../../../shared/baseGame';

export type GameState = 'IDLE' | 'SPAWNING' | 'PLAYING' | 'COUNTDOWN' | 'VICTORY' | 'GAME_OVER';

export class CraneGameLogic extends BaseGame {
  public state: GameState = 'IDLE';

  public currentLevel: number = 1;
  public targetCrateCount: number = 3;
  public currentCratesSpawned: number = 0;

  // Countdown timer
  public countdownTimer: number = 5.0;

  // UI Element references
  private hudLevelElem: HTMLElement | null = null;
  private hudCargoElem: HTMLElement | null = null;
  private countdownOverlay: HTMLElement | null = null;
  private modalOverlay: HTMLElement | null = null;
  private modalTitle: HTMLElement | null = null;
  private modalDesc: HTMLElement | null = null;
  private modalBtn: HTMLElement | null = null;

  private pauseModalOverlay: HTMLElement | null = null;
  private pauseMenuNav!: MenuNav;

  private physics: CranePhysicsManager;
  private graphics: CraneGraphicsManager;
  private audio: SharedAudioManager;
  private modalMenuNav!: MenuNav;

  constructor(physics: CranePhysicsManager, graphics: CraneGraphicsManager, audio: SharedAudioManager) {
    super();
    this.physics = physics;
    this.graphics = graphics;
    this.audio = audio;

    this.bindUI();
  }

  protected override onEscape() {
    if (this.state !== 'VICTORY' && this.state !== 'GAME_OVER') {
      this.togglePause();
    }
  }

  protected override onSpace() {
    if (this.isPaused) {
      this.togglePause(false);
    } else if (this.state !== 'VICTORY' && this.state !== 'GAME_OVER') {
      this.triggerDropAction();
    }
  }

  private bindUI() {
    this.hudLevelElem = document.getElementById('hud-level');
    this.hudCargoElem = document.getElementById('hud-cargo');
    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.modalOverlay = document.getElementById('game-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.modalDesc = document.getElementById('modal-desc');
    this.modalBtn = document.getElementById('modal-btn');
    this.pauseModalOverlay = document.getElementById('pause-modal');

    if (this.modalOverlay) {
      this.modalMenuNav = new MenuNav({ container: this.modalOverlay });
    }
    if (this.pauseModalOverlay) {
      this.pauseMenuNav = new MenuNav({ container: this.pauseModalOverlay });
    }

    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.togglePause(false);
    });

    if (this.modalBtn) {
      this.modalBtn.addEventListener('click', () => {
        if (this.state === 'VICTORY') {
          this.nextLevel();
        } else if (this.state === 'GAME_OVER') {
          this.restartLevel();
        }
      });
    }

    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn) {
      soundBtn.textContent = this.audio.getMuted() ? '🔊 Mute' : '🔊 Sound ON';
      soundBtn.addEventListener('click', () => {
        const muted = this.audio.toggleMute();
        soundBtn.textContent = muted ? '🔊 Mute' : '🔊 Sound ON';
      });
    }

    const savedGoal = localStorage.getItem('crane_tower_target_goal');
    const goalSelect = document.getElementById('select-target-goal') as HTMLSelectElement;
    if (goalSelect) {
      if (savedGoal) goalSelect.value = savedGoal;
      goalSelect.addEventListener('change', () => {
        const val = parseInt(goalSelect.value, 10);
        localStorage.setItem('crane_tower_target_goal', val.toString());
        this.startLevel(1, val);
      });
    }

    const targetToggle = document.getElementById('chk-show-target') as HTMLInputElement;
    if (targetToggle) {
      targetToggle.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.graphics.setTargetRegionVisible(checked);
      });
    }

    const dropBtn = document.getElementById('btn-drop');
    if (dropBtn) {
      dropBtn.addEventListener('click', () => {
        this.triggerDropAction();
      });
    }

    const canvas = document.getElementById('game-canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => {
        // Prevent drop trigger if clicking top bar buttons / selects / modals
        const target = e.target as HTMLElement;
        if (target && target.closest('.top-bar, .modal-overlay, #countdown-overlay')) return;
        if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
          this.triggerDropAction();
        }
      });
    }
  }

  public override togglePause(forceState?: boolean) {
    super.togglePause(forceState);
    if (this.isPaused) {
      this.pauseModalOverlay?.classList.add('active');
      this.pauseMenuNav?.activate();
    } else {
      this.pauseModalOverlay?.classList.remove('active');
      this.pauseMenuNav?.deactivate();
    }
  }

  public startLevel(level: number = 1, customTargetCount?: number) {
    this.currentLevel = level;

    const goalSelect = document.getElementById('select-target-goal') as HTMLSelectElement;
    if (customTargetCount !== undefined) {
      this.targetCrateCount = customTargetCount;
    } else if (goalSelect && goalSelect.value) {
      this.targetCrateCount = parseInt(goalSelect.value, 10) || 3;
    } else {
      const savedGoal = localStorage.getItem('crane_tower_target_goal');
      this.targetCrateCount = savedGoal ? parseInt(savedGoal, 10) : 3;
    }

    if (goalSelect) {
      goalSelect.value = `${this.targetCrateCount}`;
    }
    localStorage.setItem('crane_tower_target_goal', this.targetCrateCount.toString());

    this.currentCratesSpawned = 0;
    this.countdownTimer = 5.0;

    this.graphics.clearCrates();
    this.physics.clear();

    this.updateHUD();
    this.hideModal();
    this.hideCountdown();

    this.spawnNextCrate();
    this.state = 'PLAYING';
  }

  public triggerDropAction() {
    if (this.state !== 'PLAYING' && this.state !== 'COUNTDOWN') return;

    if (this.physics.currentHeldCrateId) {
      // Release held crate
      this.physics.releaseHeldCrate();
      this.audio.playTone(300, 0.15, 'square');

      // Schedule spawn of next crate if target not reached
      if (this.currentCratesSpawned < this.targetCrateCount) {
        this.tryScheduleSpawnNextCrate();
      }
    } else {
      // Try to re-grab nearby crate if magnet lowered onto one
      const reGrabbed = this.physics.tryRegrabCrate();
      if (reGrabbed) {
        this.audio.playTone(500, 0.2, 'sine');
      }
    }
  }

  private tryScheduleSpawnNextCrate() {
    setTimeout(() => {
      if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
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

    // Color variation per level
    const colors = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#dc2626'];
    const colorHex = colors[(this.currentCratesSpawned - 1) % colors.length];

    this.physics.spawnCrate(crateId, { x: 1.2, y: 1.2, z: 1.2 });
    this.graphics.addCrateMesh(crateId, { x: 1.2, y: 1.2, z: 1.2 }, colorHex);

    this.updateHUD();
  }

  public update(dt: number) {
    if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
      // Check ground crash failure
      if (this.physics.checkGroundCollision()) {
        this.triggerGameOver('A crate fell off the train platform onto the ground!');
        return;
      }

      // Check target region crate count
      const { count, settled } = this.physics.countCratesInTargetRegion();
      this.updateHUD(count);

      // Check if all required crates are placed in target region and settled
      if (count >= this.targetCrateCount && settled) {
        if (this.state !== 'COUNTDOWN') {
          this.state = 'COUNTDOWN';
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
        if (this.state === 'COUNTDOWN' && count < this.targetCrateCount) {
          this.state = 'PLAYING';
          this.hideCountdown();
        }
      }
    } else if (this.state === 'VICTORY') {
      // Drive train off-screen
      this.physics.moveTrain(dt * 6.0);
    }
  }

  private triggerVictory() {
    this.state = 'VICTORY';
    this.hideCountdown();
    this.physics.glueCratesToTrain();

    this.audio.playWin();

    setTimeout(() => {
      this.showModal('Level Cleared! 🎉', `Train fully loaded with ${this.targetCrateCount} crates!`, 'Next Level ▶');
    }, 1500);
  }

  private triggerGameOver(reason: string) {
    this.state = 'GAME_OVER';
    this.hideCountdown();
    this.audio.playFall();

    this.showModal('Cargo Spilled! 💥', reason, 'Try Again 🔄');
  }

  private nextLevel() {
    const nextCount = Math.min(11, this.targetCrateCount + 2);
    const goalSelect = document.getElementById('select-target-goal') as HTMLSelectElement;
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
  }

  private lastSecPlayed: number = -1;

  private showCountdown(sec: number) {
    if (this.countdownOverlay) {
      this.countdownOverlay.style.display = 'block';
      this.countdownOverlay.innerHTML = `<div style="font-size: 1.2rem; color: #cbd5e1; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px;">Hold Stack Secure!</div><div style="font-size: 5rem;">${sec}</div>`;
      if (this.lastSecPlayed !== sec) {
        this.lastSecPlayed = sec;
        this.audio.playTone(800 - sec * 80, 0.1, 'sine');
      }
    }
  }

  private hideCountdown() {
    if (this.countdownOverlay) {
      this.countdownOverlay.style.display = 'none';
    }
  }

  private showModal(title: string, desc: string, btnText: string) {
    if (this.modalTitle) this.modalTitle.textContent = title;
    if (this.modalDesc) this.modalDesc.textContent = desc;
    if (this.modalBtn) this.modalBtn.textContent = btnText;
    if (this.modalOverlay) {
      this.modalOverlay.classList.add('active');
      this.modalMenuNav?.activate();
    }
  }

  private hideModal() {
    if (this.modalOverlay) {
      this.modalOverlay.classList.remove('active');
      this.modalMenuNav?.deactivate();
    }
  }
}
