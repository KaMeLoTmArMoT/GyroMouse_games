import type { CombatAudioCue, ShipState, WeaponType } from "../types/combat";

type Sound = WeaponType | CombatAudioCue | "shield" | "explosion" | "chime";
interface Layer {
  wave: "sine" | "triangle" | "noise";
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain: number;
  cutoff?: number;
  endCutoff?: number;
  bandpass?: boolean;
  tremolo?: boolean;
}

const COOLDOWNS: Record<Sound, number> = {
  beam_laser: 0.1,
  railgun: 0.14,
  plasma: 0.07,
  missile: 0.14,
  point_defense: 0.07,
  shield: 0.09,
  explosion: 0.12,
  chime: 1,
  torpedo_launch: 0.14,
  flak_burst: 0.09,
  laser_intercept: 0.12,
  warp_ingress: 1,
  fighter_egress: 0.4,
};

/** Quiet by construction: bounded voices, low envelopes, then compression and master gain. */
export class SpaceAudioEngine {
  private muted = true;
  private context?: AudioContext;
  private compressor?: DynamicsCompressorNode;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private activeSources = 0;
  private lastPlayed = new Map<Sound, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem("gyromouse-muted") !== "false";
    } catch {
      // Storage may be disabled; keep the quiet default.
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem("gyromouse-muted", String(muted));
    } catch {
      // The in-memory toggle still works without persistent storage.
    }
    if (!muted) this.unlock();
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelAndHoldAtTime(now);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.2, now + 0.025);
    }
  }

  /** Call from a user gesture, including when restoring a saved unmuted preference. */
  unlock(): void {
    if (this.muted || typeof AudioContext === "undefined") return;
    if (!this.context) {
      this.context = new AudioContext();
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 30;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.master = this.context.createGain();
      this.master.gain.value = 0.2;
      this.compressor.connect(this.master);
      this.master.connect(this.context.destination);
      this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch(() => {
        // A subsequent user gesture can retry browser autoplay authorization.
      });
    }
  }

  playWeapon(type: WeaponType): void {
    switch (type) {
      case "beam_laser":
        this.play(type, [
          {
            wave: "sine",
            frequency: 420,
            endFrequency: 380,
            duration: 0.16,
            gain: 0.05,
            cutoff: 1200,
            tremolo: true,
          },
        ]);
        break;
      case "railgun":
        this.play(type, [
          {
            wave: "sine",
            frequency: 140,
            endFrequency: 35,
            duration: 0.22,
            gain: 0.07,
            cutoff: 400,
          },
        ]);
        break;
      case "plasma":
        this.play(type, [
          {
            wave: "triangle",
            frequency: 520,
            endFrequency: 200,
            duration: 0.06,
            gain: 0.05,
            cutoff: 1000,
          },
        ]);
        break;
      case "missile":
        this.play(type, [
          { wave: "noise", frequency: 0, duration: 0.24, gain: 0.04, cutoff: 500, endCutoff: 180 },
          {
            wave: "sine",
            frequency: 80,
            endFrequency: 160,
            duration: 0.2,
            gain: 0.035,
            cutoff: 400,
          },
        ]);
        break;
      case "point_defense":
        this.play(type, [
          {
            wave: "noise",
            frequency: 0,
            duration: 0.045,
            gain: 0.045,
            cutoff: 380,
            bandpass: true,
          },
        ]);
        break;
    }
  }

  playCombatEvent(event: CombatAudioCue): void {
    switch (event) {
      case "torpedo_launch":
        this.play(event, [
          { wave: "noise", frequency: 0, duration: 0.3, gain: 0.045, cutoff: 550, endCutoff: 160 },
          { wave: "sine", frequency: 70, endFrequency: 180, duration: 0.25, gain: 0.04 },
        ]);
        break;
      case "flak_burst":
        this.play(event, [
          {
            wave: "noise",
            frequency: 0,
            duration: 0.13,
            gain: 0.055,
            cutoff: 1500,
            endCutoff: 250,
          },
          { wave: "sine", frequency: 160, endFrequency: 55, duration: 0.12, gain: 0.035 },
        ]);
        break;
      case "laser_intercept":
        this.play(event, [
          {
            wave: "triangle",
            frequency: 1050,
            endFrequency: 560,
            duration: 0.08,
            gain: 0.035,
            cutoff: 1800,
          },
        ]);
        break;
      case "warp_ingress":
        this.play(event, [
          { wave: "noise", frequency: 0, duration: 0.8, gain: 0.035, cutoff: 180, endCutoff: 1200 },
          { wave: "sine", frequency: 90, endFrequency: 320, duration: 0.7, gain: 0.045 },
        ]);
        break;
      case "fighter_egress":
        this.play(event, [
          {
            wave: "triangle",
            frequency: 600,
            endFrequency: 180,
            duration: 0.24,
            gain: 0.035,
            cutoff: 1300,
          },
        ]);
        break;
    }
  }

  playShieldHit(intensity: number): void {
    const gain = 0.06 * Math.min(1, Math.max(0.25, intensity));
    this.play("shield", [
      { wave: "sine", frequency: 320, duration: 0.12, gain: gain * 0.8, cutoff: 1200 },
      { wave: "sine", frequency: 640, duration: 0.1, gain: gain * 0.2, cutoff: 1200 },
    ]);
  }

  playExplosion(ship: ShipState): void {
    const capital = ship.hullClass === "battleship" || ship.hullClass === "cruiser";
    const duration = capital ? 0.6 : 0.25;
    this.play("explosion", [
      { wave: "noise", frequency: 0, duration, gain: 0.06, cutoff: 250, endCutoff: 100 },
      {
        wave: "sine",
        frequency: capital ? 60 : 90,
        endFrequency: capital ? 25 : 40,
        duration,
        gain: 0.06,
        cutoff: 250,
      },
    ]);
  }

  playVictory(winnerTeam: number): void {
    // The player commands team 0; defeat gets a gentle minor chord.
    const notes = winnerTeam === 0 ? [261.63, 329.63, 392] : [220, 261.63, 329.63];
    this.play(
      "chime",
      notes.map((frequency) => ({
        wave: "sine",
        frequency,
        duration: 0.8,
        gain: 0.025,
        cutoff: 1200,
      })),
    );
  }

  private play(sound: Sound, layers: Layer[]): void {
    const ctx = this.context;
    if (this.muted || !ctx || ctx.state !== "running" || !this.compressor) return;
    const now = ctx.currentTime;
    // Drop excess events instead of queueing a burst. Reserve three sources for the result chord.
    const sources = layers.reduce((count, layer) => count + (layer.tremolo ? 2 : 1), 0);
    if (this.activeSources + sources > (sound === "chime" ? 19 : 16)) return;
    if (now - (this.lastPlayed.get(sound) ?? -Infinity) < COOLDOWNS[sound]) return;
    this.lastPlayed.set(sound, now);
    for (const layer of layers) this.playLayer(ctx, this.compressor, layer, now);
  }

  private playLayer(ctx: AudioContext, bus: AudioNode, layer: Layer, now: number): void {
    const end = now + layer.duration;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.bandpass ? "bandpass" : "lowpass";
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(layer.cutoff ?? 1200, now);
    filter.frequency.exponentialRampToValueAtTime(layer.endCutoff ?? layer.cutoff ?? 1200, end);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(layer.gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.00001, end - 0.005);
    envelope.gain.linearRampToValueAtTime(0, end);
    filter.connect(envelope);
    envelope.connect(bus);

    let source: AudioBufferSourceNode | OscillatorNode;
    if (layer.wave === "noise") {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise ?? null;
      source = noise;
    } else {
      const oscillator = ctx.createOscillator();
      oscillator.type = layer.wave;
      oscillator.frequency.setValueAtTime(layer.frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(layer.endFrequency ?? layer.frequency, end);
      source = oscillator;
    }

    const tremolo = layer.tremolo ? ctx.createOscillator() : null;
    const depth = layer.tremolo ? ctx.createGain() : null;
    const modulation = layer.tremolo ? ctx.createGain() : null;
    if (tremolo && depth && modulation) {
      modulation.gain.value = 0.9;
      tremolo.frequency.value = 8;
      depth.gain.value = 0.1;
      tremolo.connect(depth);
      depth.connect(modulation.gain);
      source.connect(modulation);
      modulation.connect(filter);
      tremolo.start(now);
      tremolo.stop(end);
    } else {
      source.connect(filter);
    }
    const sourceCount = tremolo ? 2 : 1;
    this.activeSources += sourceCount;
    source.onended = () => {
      source.disconnect();
      tremolo?.disconnect();
      depth?.disconnect();
      modulation?.disconnect();
      filter.disconnect();
      envelope.disconnect();
      this.activeSources -= sourceCount;
    };
    source.start(now);
    source.stop(end);
  }
}

export const spaceAudio = new SpaceAudioEngine();
