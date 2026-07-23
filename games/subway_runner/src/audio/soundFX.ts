import { SharedAudioManager } from '../../../../shared/audioManager';

export class RunnerSoundFX {
  private audioManager: SharedAudioManager;

  constructor() {
    this.audioManager = new SharedAudioManager();
  }

  public playJump() {
    this.audioManager.playTone(440, 0.1, 'sine');
  }

  public playSlide() {
    this.audioManager.playTone(220, 0.12, 'triangle');
  }

  public playCoin() {
    this.audioManager.playTone(880, 0.08, 'sine');
  }

  public playCrash() {
    this.audioManager.playTone(120, 0.35, 'sawtooth');
  }
}
