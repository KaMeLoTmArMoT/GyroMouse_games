import { SharedInputManager } from '../../../shared/inputManager';
import { SettingsOverlay } from '../../../shared/settingsOverlay';
import { SharedAudioManager } from '../../../shared/audioManager';
import { TurnPhase, AIDifficulty } from './types';
import { TerrainManager } from './terrain/terrainManager';
import { Worm } from './entities/worm';
import { Projectile } from './physics/projectile';
import { WormAI } from './ai/wormAI';
import { HUD, WEAPON_LIST } from './ui/hud';

export class WormixGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private inputManager: SharedInputManager;
  private settingsOverlay: SettingsOverlay;
  private audioManager: SharedAudioManager;
  private hud: HUD;

  public terrain: TerrainManager;
  public worms: Worm[] = [];
  public projectiles: Projectile[] = [];

  public phase: TurnPhase = 'MOVE';
  public activeWormIndex: number = 0;
  public activeWeaponIndex: number = 0;

  // Turn Timer & Wind
  public turnTimer: number = 45.0; // 45s countdown
  public windX: number = 0.0; // -2.5 to +2.5
  public aiDifficulty: AIDifficulty = 'normal';

  // Charge Power State
  public isCharging: boolean = false;
  public chargePower: number = 0.0; // 0 to 1.0
  public chargeSpeed: number = 0.025; // Speed per tick (30fps)

  // 30 FPS Lock Loop Variables
  private lastTickTime: number = 0;
  private readonly frameInterval: number = 1000 / 30; // 33.33ms

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    this.inputManager = new SharedInputManager();
    this.audioManager = new SharedAudioManager();
    this.hud = new HUD();
    this.terrain = new TerrainManager(window.innerWidth, window.innerHeight);

    // Initialize Settings Overlay
    this.settingsOverlay = new SettingsOverlay({
      gameId: 'wormix',
      inputManager: this.inputManager
    });

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.initGame();
    this.setupInputs();

    // Start locked 30 FPS loop
    requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.terrain.resize(this.canvas.width, this.canvas.height);
  }

  private initGame(): void {
    const xPositions = [
      this.canvas.width * 0.2,
      this.canvas.width * 0.35,
      this.canvas.width * 0.65,
      this.canvas.width * 0.8
    ];

    this.worms = [
      new Worm('p1', 'Red Commando', 'player', xPositions[0], this.terrain.getSurfaceY(xPositions[0]) - 12),
      new Worm('p2', 'Red Gunner', 'player', xPositions[1], this.terrain.getSurfaceY(xPositions[1]) - 12),
      new Worm('ai1', 'Blue Sniper', 'ai', xPositions[2], this.terrain.getSurfaceY(xPositions[2]) - 12),
      new Worm('ai2', 'Blue Heavy', 'ai', xPositions[3], this.terrain.getSurfaceY(xPositions[3]) - 12)
    ];

    this.activeWormIndex = 0;
    this.phase = 'MOVE';
    this.turnTimer = 45.0;
    this.updateWind();
  }

  private updateWind(): void {
    this.windX = (Math.random() - 0.5) * 5.0; // -2.5 to +2.5
  }

  private setupInputs(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') {
        this.inputManager.reCenter();
        return;
      }
      if (e.code === 'Escape') {
        this.settingsOverlay.toggle();
        return;
      }

      // 3-Step Turn Flow on Space Bar Press / Release
      if (e.code === 'Space' && !e.repeat) {
        const activeWorm = this.getActiveWorm();
        if (activeWorm && activeWorm.team === 'player') {
          if (this.phase === 'MOVE') {
            this.phase = 'WEAPON_SELECT';
            this.audioManager.playTone(440, 0.05, 'sine');
          } else if (this.phase === 'WEAPON_SELECT') {
            this.phase = 'AIM_FIRE';
            this.audioManager.playTone(550, 0.05, 'sine');
          } else if (this.phase === 'AIM_FIRE') {
            this.isCharging = true;
            this.chargePower = 0.0;
            this.audioManager.playTone(300, 0.1, 'sawtooth');
          }
        }
      }

      // Back key (S / Down arrow in weapon select returns to move)
      if ((e.code === 'KeyS' || e.code === 'ArrowDown') && this.phase === 'WEAPON_SELECT') {
        this.phase = 'MOVE';
        this.audioManager.playTone(350, 0.05, 'sine');
      }

      // Cycle weapons with A/D or Left/Right during WEAPON_SELECT
      if (this.phase === 'WEAPON_SELECT') {
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          this.activeWeaponIndex = (this.activeWeaponIndex - 1 + WEAPON_LIST.length) % WEAPON_LIST.length;
          this.audioManager.playTone(600, 0.03, 'sine');
        } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          this.activeWeaponIndex = (this.activeWeaponIndex + 1) % WEAPON_LIST.length;
          this.audioManager.playTone(600, 0.03, 'sine');
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.isCharging && this.phase === 'AIM_FIRE') {
        this.fireActiveWeapon();
      }
    });

    // PC Mode Mouse Clicks
    this.canvas.addEventListener('mousedown', () => {
      if (this.inputManager.settings.mode !== 'pointer') return;
      const activeWorm = this.getActiveWorm();
      if (!activeWorm || activeWorm.team !== 'player') return;

      if (this.phase === 'MOVE') {
        this.phase = 'WEAPON_SELECT';
      } else if (this.phase === 'WEAPON_SELECT') {
        this.phase = 'AIM_FIRE';
      } else if (this.phase === 'AIM_FIRE') {
        this.isCharging = true;
        this.chargePower = 0.0;
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      if (this.isCharging && this.phase === 'AIM_FIRE') {
        this.fireActiveWeapon();
      }
    });

    // PC Mode Mouse Aiming
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.inputManager.settings.mode !== 'pointer') return;
      const activeWorm = this.getActiveWorm();
      if (!activeWorm || activeWorm.team !== 'player' || this.phase !== 'AIM_FIRE') return;

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const dx = mouseX - activeWorm.x;
      const dy = mouseY - activeWorm.y;
      activeWorm.aimAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      activeWorm.facingRight = dx >= 0;
    });
  }

  private fireActiveWeapon(): void {
    this.isCharging = false;
    const activeWorm = this.getActiveWorm();
    if (!activeWorm) return;

    const tip = activeWorm.getCannonTip();
    const rad = (activeWorm.aimAngle * Math.PI) / 180;
    const launchSpeed = Math.max(0.15, this.chargePower) * 22.0;

    const vx = Math.cos(rad) * launchSpeed;
    const vy = Math.sin(rad) * launchSpeed;

    const weapon = WEAPON_LIST[this.activeWeaponIndex];

    if (weapon.id === 'shotgun') {
      // Immediate Shotgun Raycast
      this.audioManager.playHit(1.5);
      this.terrain.explode(tip.x + vx * 2, tip.y + vy * 2, 25);
      for (const w of this.worms) {
        if (w !== activeWorm && w.isAlive) {
          const dist = Math.hypot(w.x - tip.x, w.y - tip.y);
          if (dist < 120) w.takeDamage(40);
        }
      }
      this.phase = 'PROJECTILE_FLIGHT';
    } else {
      // Spawn Projectile
      this.audioManager.playTone(220, 0.15, 'sawtooth');
      this.projectiles.push(
        new Projectile(weapon.id, tip.x, tip.y, vx, vy, activeWorm.team, 3)
      );
      this.phase = 'PROJECTILE_FLIGHT';
    }
  }

  private getActiveWorm(): Worm | null {
    return this.worms[this.activeWormIndex] || null;
  }

  private gameLoop(timestamp: number): void {
    if (!this.lastTickTime) this.lastTickTime = timestamp;
    const elapsed = timestamp - this.lastTickTime;

    // Fixed 30 FPS Tick Lock
    if (elapsed >= this.frameInterval) {
      this.lastTickTime = timestamp - (elapsed % this.frameInterval);
      this.updateFixedTick();
      this.render();
    }

    requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private updateFixedTick(): void {
    // 1. Update Terrain & Elemental Physics
    this.terrain.updatePhysics();

    // 2. Update Worm Physics
    for (const worm of this.worms) {
      worm.update(this.terrain);
    }

    const activeWorm = this.getActiveWorm();

    // 3. Process Active Turn Input (If Player Turn)
    if (activeWorm && activeWorm.isAlive && activeWorm.team === 'player') {
      const keys = this.inputManager.keysPressed;

      // Movement Phase Controls
      if (this.phase === 'MOVE') {
        let dir = 0;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) dir -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) dir += 1;

        // GyroMouse Roll Steering
        const steer = this.inputManager.getSteeringValue();
        if (Math.abs(steer.x) > 0.2) dir = Math.sign(steer.x);

        activeWorm.walk(dir);

        if (keys.has('KeyW') || keys.has('ArrowUp')) {
          activeWorm.jump();
          this.audioManager.playTone(500, 0.08, 'sine');
        }
      }

      // Aiming Controls (Aim angle up/down)
      if (this.phase === 'AIM_FIRE') {
        if (keys.has('KeyW') || keys.has('ArrowUp')) {
          activeWorm.aimAngle -= 2.5;
        }
        if (keys.has('KeyS') || keys.has('ArrowDown')) {
          activeWorm.aimAngle += 2.5;
        }

        // GyroMouse Pitch Steering
        const steer = this.inputManager.getSteeringValue();
        if (Math.abs(steer.y) > 0.2) {
          activeWorm.aimAngle += steer.y * 3.0;
        }

        // Charge Shot Power Meter
        if (this.isCharging) {
          this.chargePower += this.chargeSpeed;
          if (this.chargePower >= 1.0) {
            this.chargePower = 1.0;
            this.fireActiveWeapon(); // Auto-fire at 100% max power
          }
        }
      }

      // Turn Countdown Timer
      this.turnTimer -= 1 / 30; // 30 FPS tick
      if (this.turnTimer <= 0) {
        this.turnTimer = 0;
        this.phase = 'PROJECTILE_FLIGHT';
      }
    }

    // 4. AI Turn Logic
    if (activeWorm && activeWorm.isAlive && activeWorm.team === 'ai') {
      if (this.phase === 'MOVE' || this.phase === 'WEAPON_SELECT') {
        const playerWorms = this.worms.filter((w) => w.team === 'player');
        const plan = WormAI.calculateTurn(activeWorm, playerWorms, this.aiDifficulty, this.windX);

        activeWorm.aimAngle = plan.targetAngle;
        activeWorm.facingRight = Math.cos((plan.targetAngle * Math.PI) / 180) >= 0;

        const weaponIdx = WEAPON_LIST.findIndex((w) => w.id === plan.weaponId);
        if (weaponIdx !== -1) this.activeWeaponIndex = weaponIdx;

        this.chargePower = plan.targetPower;
        this.phase = 'AIM_FIRE';
        setTimeout(() => this.fireActiveWeapon(), 1000);
      }
    }

    // 5. Update Projectiles Physics & Collisions
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(this.terrain, this.worms, this.windX, (p, x, y) => {
        this.audioManager.playHit(2.0);
        // Handle Cluster Split
        if (p.weaponId === 'cluster' && !p.isClusterChild) {
          for (let c = 0; c < 5; c++) {
            const angle = (Math.PI / 4) + (c * Math.PI) / 8;
            const speed = Math.random() * 6 + 3;
            this.projectiles.push(
              new Projectile('cluster', x, y - 5, Math.cos(angle) * speed, -Math.sin(angle) * speed, p.teamId, 2, true)
            );
          }
        }
      });

      if (proj.isExpired) {
        this.projectiles.splice(i, 1);
      }
    }

    // 6. Turn Resolution Check
    if (this.phase === 'PROJECTILE_FLIGHT' && this.projectiles.length === 0) {
      this.checkTurnEnd();
    }
  }

  private checkTurnEnd(): void {
    const redAlive = this.worms.filter((w) => w.team === 'player' && w.isAlive).length;
    const blueAlive = this.worms.filter((w) => w.team === 'ai' && w.isAlive).length;

    if (redAlive === 0 || blueAlive === 0) {
      this.phase = 'GAME_OVER';
      this.audioManager.playWin();
      return;
    }

    // Pass turn to next alive worm
    let nextIdx = (this.activeWormIndex + 1) % this.worms.length;
    while (!this.worms[nextIdx].isAlive) {
      nextIdx = (nextIdx + 1) % this.worms.length;
    }

    this.activeWormIndex = nextIdx;
    this.phase = 'MOVE';
    this.turnTimer = 45.0;
    this.updateWind();
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render Terrain, Water, Particles, Portals
    this.terrain.draw(this.ctx);

    // Render Worms
    const activeWorm = this.getActiveWorm();
    this.worms.forEach((w) => w.draw(this.ctx, w === activeWorm));

    // Render Projectiles
    this.projectiles.forEach((p) => p.draw(this.ctx));

    // Calculate Team Total HPs
    const playerHp = this.worms.filter((w) => w.team === 'player').reduce((acc, w) => acc + w.health, 0);
    const aiHp = this.worms.filter((w) => w.team === 'ai').reduce((acc, w) => acc + w.health, 0);

    // Render Glassmorphism HUD overlay
    this.hud.draw(
      this.ctx,
      this.canvas.width,
      this.canvas.height,
      this.phase,
      activeWorm,
      this.activeWeaponIndex,
      this.chargePower,
      this.isCharging,
      this.windX,
      this.turnTimer,
      playerHp,
      aiHp,
      this.inputManager.settings.mode === 'pointer'
    );

    // Game Over Overlay
    if (this.phase === 'GAME_OVER') {
      const redAlive = this.worms.filter((w) => w.team === 'player' && w.isAlive).length;
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      this.ctx.fillStyle = redAlive > 0 ? '#22c55e' : '#ef4444';
      this.ctx.font = 'bold 36px Outfit, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(redAlive > 0 ? '🏆 RED TEAM VICTORIOUS!' : '💀 DEFEAT - BLUE TEAM WINS!', this.canvas.width / 2, this.canvas.height / 2 - 20);

      this.ctx.fillStyle = '#9ca3af';
      this.ctx.font = '16px Outfit, sans-serif';
      this.ctx.fillText('Press ESC to open menu or refresh to replay', this.canvas.width / 2, this.canvas.height / 2 + 30);
    }
  }
}

// Start Game on DOM Content Loaded
window.addEventListener('DOMContentLoaded', () => {
  new WormixGame();
});
