import { SharedAudioManager } from '../../../shared/audioManager';
import { ArtilleryGraphicsManager } from './graphics/artilleryGraphics';
import { ArtilleryPhysicsManager } from './physics/artilleryPhysics';
import { ArtilleryHUD } from './ui/hud';
import * as THREE from 'three';

class ArtilleryGame {
  private physics: ArtilleryPhysicsManager;
  private graphics: ArtilleryGraphicsManager;
  private hud: ArtilleryHUD;
  private audio: SharedAudioManager;

  // Game Loop & State
  private currentLevel: number = 1;
  private currentStage: 1 | 2 = 1;

  // Cannon Aim State (degrees)
  public pitchDeg: number = 40.0; // P1 Pitch: 10 to 75 deg
  public yawDeg: number = 0.0;    // P2 Yaw: -50 (Left) to +50 (Right) deg

  // Stage 2 Power & Micro Adjust
  public powerMps: number = 35.0; // Power speed: 15 to 65 m/s

  // Game Stats
  public shellsLeft: number = 5;
  public totalLevelTargets: number = 3;
  public hitTargetsCount: number = 0;
  public isLevelComplete: boolean = false;
  public isGameOver: boolean = false;

  // Key tracking
  private keysPressed: Set<string> = new Set();
  private spaceDebounce: boolean = false;

  // Trajectory history for sighting hints
  private trajectoryHistory: Array<Array<{ x: number; y: number; z: number }>> = [];

  constructor() {
    this.physics = new ArtilleryPhysicsManager();
    this.graphics = new ArtilleryGraphicsManager();
    this.audio = new SharedAudioManager();
    this.hud = new ArtilleryHUD();

    this.init();
  }

  private async init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.graphics.init(canvas);

    await this.physics.init();

    this.setupEventListeners();
    this.startLevel(1);

    // Main animation loop
    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      this.update(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private setupEventListeners() {
    window.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.code);
      this.keysPressed.add(e.key);

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!this.spaceDebounce) {
          this.spaceDebounce = true;
          this.handleSpaceAction();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.code);
      this.keysPressed.delete(e.key);

      if (e.code === 'Space' || e.key === ' ') {
        this.spaceDebounce = false;
      }
    });

    window.addEventListener('blur', () => this.keysPressed.clear());

    // Sound toggle button
    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const isMuted = this.audio.toggleMute();
        btnSound.innerHTML = isMuted ? '🔊 Mute' : '🔊 Sound ON';
      });
    }

    // UI Buttons for mouse / touch users
    const btnStageTrigger = document.getElementById('btn-stage-trigger');
    if (btnStageTrigger) {
      btnStageTrigger.addEventListener('click', () => this.handleSpaceAction());
    }

    const btnFireTrigger = document.getElementById('btn-fire-trigger');
    if (btnFireTrigger) {
      btnFireTrigger.addEventListener('click', () => this.handleSpaceAction());
    }
  }

  private startLevel(level: number) {
    this.currentLevel = level;
    this.currentStage = 1;
    this.isLevelComplete = false;
    this.isGameOver = false;

    this.pitchDeg = 40.0;
    this.yawDeg = 0.0;
    this.powerMps = 35.0;
    this.shellsLeft = 4 + level;
    this.hitTargetsCount = 0;

    this.trajectoryHistory = [];

    // Reset physics & graphics
    this.graphics.resetLevelVisuals();
    this.physics.setupLevel(level, 1.5 + level * 0.5);

    this.totalLevelTargets = this.physics.targets.size;
    this.graphics.syncTargets(this.physics.targets);

    this.hud.setStage(1);
    this.hud.updateStats(this.currentLevel, 0, this.totalLevelTargets, this.shellsLeft);
    this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
    this.hud.setSpotterMessage(`Level ${level} Ready! P1: Up/Down pitch, P2: Left/Right direction (Right = Turn Right, Left = Turn Left).`);
  }

  private handleSpaceAction() {
    if (this.isLevelComplete || this.isGameOver) return;
    if (this.physics.activeBall && this.physics.activeBall.active) return;

    if (this.currentStage === 1) {
      // Transition to Stage 2: Power Charge & Micro-Adjust
      this.currentStage = 2;
      this.powerMps = 30.0;
      this.hud.setStage(2);
      this.hud.setSpotterMessage('STAGE 2: P1: Press UP/DOWN to set Power | P2: Press LEFT/RIGHT to fine tune wind | Press SPACE to Fire!');
      this.audio.playCollect();
    } else if (this.currentStage === 2) {
      // Fire cannonball!
      this.fireCannon();
    }
  }

  private fireCannon() {
    if (this.shellsLeft <= 0) return;

    this.shellsLeft--;
    this.hud.updateStats(this.currentLevel, this.hitTargetsCount, this.totalLevelTargets, this.shellsLeft);

    // Launch shell in physics (passing pitchDeg & yawDeg)
    const ball = this.physics.launchShell(this.pitchDeg, this.yawDeg, this.powerMps);
    if (ball) {
      this.graphics.createCannonballMesh();
      this.graphics.triggerRecoil();
      this.audio.playFall();
      this.hud.setSpotterMessage(`SHELL FIRED AT ${this.powerMps.toFixed(1)} m/s! Tracking trajectory...`);
    }

    // Reset to Stage 1 after firing
    this.currentStage = 1;
    this.hud.setStage(1);
  }

  private update(dt: number) {
    // 1. Process Input depending on Stage
    if (this.currentStage === 1 && (!this.physics.activeBall || !this.physics.activeBall.active)) {
      // Player 1 Elevation Pitch (Up lowers pitch, Down raises pitch)
      if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW')) {
        this.pitchDeg = Math.max(10.0, this.pitchDeg - dt * 25.0);
      }
      if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS')) {
        this.pitchDeg = Math.min(75.0, this.pitchDeg + dt * 25.0);
      }

      // Player 2 Azimuth Direction (Right = Turn Right, Left = Turn Left)
      if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) {
        this.yawDeg = Math.min(50.0, this.yawDeg + dt * 30.0);
      }
      if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) {
        this.yawDeg = Math.max(-50.0, this.yawDeg - dt * 30.0);
      }

      this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
    } else if (this.currentStage === 2) {
      // P1 100% Manual Power adjustment (Up increases, Down decreases)
      if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW')) {
        this.powerMps = Math.min(65.0, this.powerMps + dt * 35.0);
      }
      if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS')) {
        this.powerMps = Math.max(15.0, this.powerMps - dt * 35.0);
      }

      // P2 Micro Wind / Angle Adjust (Right = Turn Right, Left = Turn Left)
      if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) {
        this.yawDeg = Math.min(50.0, this.yawDeg + dt * 10.0);
      }
      if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) {
        this.yawDeg = Math.max(-50.0, this.yawDeg - dt * 10.0);
      }

      const powerRatio = (this.powerMps - 15.0) / 50.0;
      this.hud.updatePowerBar(this.powerMps, powerRatio);
      this.hud.updateAimValues(this.pitchDeg, this.yawDeg);
    }

    // 2. Update Cannon 3D visual angles
    this.graphics.updateTurretOrientation(this.pitchDeg, this.yawDeg);

    // 3. Step Physics
    const { impact, destroyedTargets } = this.physics.update(dt);

    // 4. Check for target destruction sound & score
    if (destroyedTargets.length > 0) {
      this.audio.playHit(2.0);
      this.hitTargetsCount += destroyedTargets.length;
      this.hud.updateStats(this.currentLevel, this.hitTargetsCount, this.totalLevelTargets, this.shellsLeft);
    }

    // 5. Update Cannonball graphics position
    let activePosVector: THREE.Vector3 | null = null;
    if (this.physics.activeBall && this.physics.activeBall.active) {
      const pos = this.physics.activeBall.body.translation();
      this.graphics.updateCannonball(pos);
      activePosVector = new THREE.Vector3(pos.x, pos.y, pos.z);
    }

    // 6. Handle Impact Spotter Recon & Trajectory Sighting Hints
    if (impact) {
      this.audio.playHit(1.5);
      this.graphics.triggerExplosion(impact.position);

      if (this.physics.lastImpact && this.physics.impactHistory.length > 0) {
        const points = this.physics.activeBall?.trajectoryPoints || [];
        if (points.length > 0) {
          this.trajectoryHistory.push([...points]);
          this.graphics.drawGhostTrajectory(this.trajectoryHistory);
        }
      }

      const dist = impact.distanceToTarget;
      let spotterFeedback = `IMPACT LANDED AT Z=${Math.round(impact.position.z)}m! `;
      if (impact.targetHitId && dist < 3.0) {
        spotterFeedback += `DIRECT HIT! Damage delivered to structure.`;
      } else {
        const offsetZ = Math.round(impact.position.z - 45);
        if (offsetZ < 0) {
          spotterFeedback += `Short by ${Math.abs(offsetZ)}m! P1: Increase pitch or charge power.`;
        } else {
          spotterFeedback += `Over-shot by ${offsetZ}m! P1: Lower pitch or power.`;
        }
      }

      this.hud.setSpotterMessage(spotterFeedback);
      this.graphics.clearBallVisuals();

      setTimeout(() => this.checkGameCondition(), 1000);
    }

    // 7. Sync visual targets
    this.graphics.syncTargets(this.physics.targets);

    // 8. Render Radar Map
    this.hud.drawRadarMap(
      this.physics.targets,
      this.physics.impactHistory,
      this.yawDeg,
      this.physics.windVector
    );

    // 9. Update Graphics & Camera
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
        'SECTOR CLEARED! 💥',
        `All targets in Level ${this.currentLevel} destroyed!`,
        'Next Level ▶',
        () => this.startLevel(this.currentLevel + 1)
      );
    } else if (this.shellsLeft <= 0 && (!this.physics.activeBall || !this.physics.activeBall.active)) {
      this.isGameOver = true;
      this.audio.playFall();
      this.hud.showModal(
        'OUT OF AMMO! 💥',
        `Targets remaining. Re-evaluate trajectory & try again.`,
        'Retry Level 🔄',
        () => this.startLevel(this.currentLevel)
      );
    }
  }
}

// Start game when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new ArtilleryGame();
});
