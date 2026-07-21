export class SharedAudioManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true; // Muted by default as requested
  private rollOsc: OscillatorNode | null = null;
  private rollGain: GainNode | null = null;
  private isRollingPlaying: boolean = false;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.rollGain && this.ctx) {
      this.rollGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public updateRollSound(speed: number) {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    if (speed < 0.1) {
      if (this.rollGain) {
        this.rollGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }

    if (!this.rollOsc) {
      try {
        this.rollOsc = this.ctx.createOscillator();
        this.rollGain = this.ctx.createGain();
        this.rollOsc.type = 'sine';
        this.rollOsc.frequency.value = 60;
        this.rollGain.gain.value = 0;
        this.rollOsc.connect(this.rollGain);
        this.rollGain.connect(this.ctx.destination);
        this.rollOsc.start();
        this.isRollingPlaying = true;
      } catch {
        return;
      }
    }

    if (this.rollGain && this.rollOsc && this.isRollingPlaying) {
      const freq = Math.min(60 + speed * 15, 220);
      const gain = Math.min(speed * 0.03, 0.15);
      this.rollOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
      this.rollGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
    }
  }

  public playHit(intensity: number = 1.0) {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.1);

      const vol = Math.min(0.2 * intensity, 0.4);
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
    } catch {
      // Audio fallback
    }
  }

  public playCollect() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // Audio fallback
    }
  }

  public playFall() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // Audio fallback
    }
  }

  public playWin() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const now = this.ctx.currentTime;

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);

        gain.gain.setValueAtTime(0.2, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.3);
      });
    } catch {
      // Audio fallback
    }
  }
}
