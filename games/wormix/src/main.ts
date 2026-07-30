import { SharedInputManager } from '../../../shared/inputManager';
import { SettingsOverlay } from '../../../shared/settingsOverlay';
import { SharedAudioManager } from '../../../shared/audioManager';
import { TurnPhase, AIDifficulty, LobbyConfig, CustomMapData } from './types';
import { TerrainManager } from './terrain/terrainManager';
import { Worm } from './entities/worm';
import { MapObject } from './entities/mapObject';
import { Projectile } from './physics/projectile';
import { WormAI } from './ai/wormAI';
import { HUD, WEAPON_LIST } from './ui/hud';
import { MenuModal } from './ui/menuModal';
import { MapEditor } from './editor/mapEditor';
import { MapManager } from './ui/mapManager';

export class WormixGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private inputManager: SharedInputManager;
  private settingsOverlay: SettingsOverlay;
  private audioManager: SharedAudioManager;
  private hud: HUD;
  private menuModal: MenuModal;
  private mapEditor: MapEditor | null = null;
  private mapManager: MapManager | null = null;

  public terrain: TerrainManager;
  public worms: Worm[] = [];
  public mapObjects: MapObject[] = [];
  public projectiles: Projectile[] = [];

  public phase: TurnPhase = 'MENU';
  public activeWormIndex: number = 0;
  public activeWeaponIndex: number = 0;

  // Turn Timer, Wind & Lobby Config
  public turnTimer: number = 45.0; // 45s countdown
  public windX: number = 0.0; // -2.5 to +2.5
  public aiDifficulty: AIDifficulty = 'normal';
  public lobbyConfig: LobbyConfig = {
    teamSize: 2,
    wormHealth: 100,
    gameMode: 'deathmatch',
    mapId: 'random',
    aiDifficulty: 'normal',
    matchType: 'ai'
  };

  // Charge Power State
  public isCharging: boolean = false;
  public chargePower: number = 0.0; // 0 to 1.0
  public chargeSpeed: number = 0.025; // Speed per tick (30fps)

  public editingMap: CustomMapData | null = null;

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

    // Initialize Settings Overlay with custom Game Modes & Map Editor actions
    this.settingsOverlay = new SettingsOverlay({
      gameId: 'wormix',
      inputManager: this.inputManager,
      customGameOptionsHtml: `
        <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
          <button class="gm-action-btn primary" id="gm-btn-lobby" style="background: linear-gradient(135deg, #16a34a, #22c55e);">⚔️ Match Lobby & Game Modes</button>
          <button class="gm-action-btn secondary" id="gm-btn-editor" style="background: linear-gradient(135deg, #7c3aed, #8b5cf6);">🛠️ Map Editor</button>
        </div>
      `,
      onBindCustomOptions: (container) => {
        container.querySelector('#gm-btn-lobby')?.addEventListener('click', () => {
          this.settingsOverlay.toggle();
          this.menuModal.show();
        });
        container.querySelector('#gm-btn-editor')?.addEventListener('click', () => {
          this.settingsOverlay.toggle();
          this.openMapEditor(this.editingMap || undefined);
        });
      }
    });

    // Initialize Main Menu Modal
    this.menuModal = new MenuModal(
      (config, mapData) => this.startMatch(config, mapData),
      () => this.openMapEditor(),
      () => this.settingsOverlay.toggle(),
      () => this.openMapManager()
    );

    // Initialize Map Manager
    this.mapManager = new MapManager(
      (map) => this.openMapEditor(map),
      () => this.menuModal.show()
    );

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.setupInputs();

    // Start locked 30 FPS loop
    requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.terrain.resize(this.canvas.width, this.canvas.height);
  }

  private returnToEditorBtn: HTMLElement | null = null;
  private lobbyBtn: HTMLElement | null = null;

  public openMapEditor(initialMap?: CustomMapData): void {
    this.hideReturnToEditorBtn();
    this.hideLobbyBtn();
    if (this.mapEditor) {
      this.mapEditor.exit();
      this.mapEditor = null;
    }
    this.phase = 'EDITOR';
    const targetMap = initialMap || this.editingMap || undefined;
    this.mapEditor = new MapEditor(
      this.canvas,
      (customMap) => {
        this.editingMap = customMap;
        if (this.mapEditor) this.mapEditor.exit();
        this.startMatch(this.lobbyConfig, customMap, true);
      },
      () => {
        this.mapEditor = null;
        this.phase = 'MENU';
        this.menuModal.show();
      },
      targetMap
    );
  }

  public openMapManager(): void {
    if (this.mapManager) {
      this.mapManager.show();
    }
  }

  public startMatch(config: LobbyConfig, mapData?: CustomMapData, isTestPlay: boolean = false): void {
    this.menuModal.hide();
    this.lobbyConfig = config;
    this.aiDifficulty = config.aiDifficulty;

    if (this.mapEditor) {
      this.mapEditor.exit();
      this.mapEditor = null;
    }

    if (isTestPlay) {
      this.showReturnToEditorBtn();
    } else {
      this.hideReturnToEditorBtn();
    }

    // Show Lobby button during all active matches
    this.showLobbyBtn();

    // 1. Generate or Load Terrain
    if (mapData && mapData.terrainHeights && mapData.terrainHeights.length > 0) {
      this.terrain.width = mapData.width || this.canvas.width;
      this.terrain.height = mapData.height || this.canvas.height;
      this.terrain.waterY = mapData.waterY || this.canvas.height - 40;
      this.terrain.buildTerrainFromHeights(
        mapData.terrainHeights,
        mapData.waterY,
        mapData.terrainMaterials,
        mapData.gridData
      );
    } else {
      this.terrain.resize(this.canvas.width, this.canvas.height);
    }



    // 2. Initialize Worm Teams based on LobbyConfig
    this.worms = [];
    const teamSize = config.teamSize;
    const hp = config.wormHealth;

    for (let i = 0; i < teamSize; i++) {
      const redX = mapData?.spawnPoints[i]?.x || this.canvas.width * (0.15 + i * 0.12);
      const redY = mapData?.spawnPoints[i]?.y ?? (this.terrain.getSurfaceY(redX) - 12);
      const redWorm = new Worm(`p_${i}`, `Red #${i + 1}`, 'player', redX, redY);
      redWorm.health = hp;
      redWorm.maxHealth = hp;
      this.worms.push(redWorm);
    }

    for (let i = 0; i < teamSize; i++) {
      const blueX = mapData?.spawnPoints[i + 2]?.x || this.canvas.width * (0.65 + i * 0.12);
      const blueY = mapData?.spawnPoints[i + 2]?.y ?? (this.terrain.getSurfaceY(blueX) - 12);
      const blueWorm = new Worm(`ai_${i}`, `Blue #${i + 1}`, 'ai', blueX, blueY);
      blueWorm.health = hp;
      blueWorm.maxHealth = hp;
      this.worms.push(blueWorm);
    }

    // 3. Initialize Interactive Map Objects (Barrels, Mines, Health Crates)
    this.mapObjects = [];
    if (mapData && mapData.mapObjects && mapData.mapObjects.length > 0) {
      mapData.mapObjects.forEach((objData) => {
        this.mapObjects.push(new MapObject(objData));
      });
    } else {
      // Default Random Objects
      const objSpawns = [
        { type: 'barrel' as const, x: this.canvas.width * 0.3 },
        { type: 'barrel' as const, x: this.canvas.width * 0.7 },
        { type: 'landmine' as const, x: this.canvas.width * 0.5 },
        { type: 'health_crate' as const, x: this.canvas.width * 0.45 }
      ];
      objSpawns.forEach((s) => {
        this.mapObjects.push(
          new MapObject({
            id: `obj_${Math.random()}`,
            type: s.type,
            x: s.x,
            y: this.terrain.getSurfaceY(s.x) - 14
          })
        );
      });
    }

    this.projectiles = [];
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
        if (this.phase === 'EDITOR') return;
        this.settingsOverlay.toggle();
        return;
      }


      if (this.phase === 'MENU' || this.phase === 'EDITOR') return;

      // 3-Step Turn Flow on Space Bar Press / Release
      if (e.code === 'Space' && !e.repeat) {
        const activeWorm = this.getActiveWorm();
        const isPvP = this.lobbyConfig.matchType === 'pvp';
        if (activeWorm && (activeWorm.team === 'player' || isPvP)) {
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
      if (this.phase === 'MENU' || this.phase === 'EDITOR') return;
      if (this.inputManager.settings.mode !== 'pointer') return;
      const activeWorm = this.getActiveWorm();
      const isPvP = this.lobbyConfig.matchType === 'pvp';
      if (!activeWorm || (activeWorm.team !== 'player' && !isPvP)) return;

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
      if (this.phase === 'MENU' || this.phase === 'EDITOR') return;
      if (this.inputManager.settings.mode !== 'pointer') return;
      const activeWorm = this.getActiveWorm();
      const isPvP = this.lobbyConfig.matchType === 'pvp';
      if (!activeWorm || (activeWorm.team !== 'player' && !isPvP) || this.phase !== 'AIM_FIRE') return;

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

      // Damage worms & objects in shotgun line
      for (const w of this.worms) {
        if (w !== activeWorm && w.isAlive) {
          const dist = Math.hypot(w.x - tip.x, w.y - tip.y);
          if (dist < 120) w.takeDamage(40);
        }
      }
      for (const obj of this.mapObjects) {
        if (Math.hypot(obj.x - tip.x, obj.y - tip.y) < 120) {
          obj.takeDamage(40);
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
      if (this.phase === 'EDITOR' && this.mapEditor) {
        this.mapEditor.render();
      } else if (this.phase !== 'MENU') {
        this.updateFixedTick();
        this.render();
      }
    }

    requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private updateFixedTick(): void {
    // Sudden Death / Rising Water Mode Tick
    if (this.lobbyConfig.gameMode === 'rising_water') {
      this.terrain.waterY = Math.max(100, this.terrain.waterY - 0.08);
    }

    // 1. Update Terrain & Live Dynamic Water Physics
    this.terrain.updatePhysics();

    // 2. Update Worm Physics & Water Oxygen
    for (const worm of this.worms) {
      worm.update(this.terrain);
    }

    // 3. Update Interactive Map Objects (Barrels, Mines, Crates)
    for (let i = this.mapObjects.length - 1; i >= 0; i--) {
      const obj = this.mapObjects[i];
      obj.update(
        this.terrain,
        this.worms,
        (x, y, radius, damage) => {
          this.audioManager.playHit(2.5);
          this.terrain.explode(x, y, radius);

          // Explosion damage to nearby worms
          for (const w of this.worms) {
            if (w.isAlive) {
              const d = Math.hypot(w.x - x, w.y - y);
              if (d < radius + 15) {
                w.takeDamage(Math.floor(damage * (1 - d / (radius + 15))));
              }
            }
          }
        },
        (worm, healAmount) => {
          this.audioManager.playWin();
          worm.health = Math.min(worm.maxHealth, worm.health + healAmount);
        }
      );

      if (obj.isDestroyed) {
        this.mapObjects.splice(i, 1);
      }
    }

    const activeWorm = this.getActiveWorm();

    // 4. Process Active Turn Input
    // In PvP mode both teams are human-controlled; in AI mode only 'player' team is human.
    const isPvP = this.lobbyConfig.matchType === 'pvp';
    const isHumanTurn = activeWorm && activeWorm.isAlive &&
      (activeWorm.team === 'player' || isPvP);

    if (isHumanTurn) {
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

    // 5. AI Turn Logic (only in AI match mode and only for Blue team worms)
    if (!isPvP && activeWorm && activeWorm.isAlive && activeWorm.team === 'ai') {
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

    // 6. Update Projectiles Physics & Collisions
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(this.terrain, this.worms, this.windX, (p, x, y) => {
        this.audioManager.playHit(2.0);

        // Damage objects hit by projectile explosion
        for (const obj of this.mapObjects) {
          if (Math.hypot(obj.x - x, obj.y - y) < 40) {
            obj.takeDamage(40);
          }
        }

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

    // 7. Turn Resolution Check
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

    // Render Interactive Map Objects (Barrels, Mines, Crates)
    this.mapObjects.forEach((obj) => obj.draw(this.ctx));

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
      this.inputManager.settings.mode === 'pointer',
      this.lobbyConfig.matchType === 'pvp'
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

  private showReturnToEditorBtn(): void {
    if (!this.returnToEditorBtn) {
      const btn = document.createElement('button');
      btn.id = 'btnReturnToEditor';
      btn.className = 'wormix-return-editor-btn';
      btn.innerHTML = '✏️ Return to Editor';
      btn.style.cssText = `
        position: fixed;
        top: 85px;
        right: 16px;
        z-index: 100;
        background: rgba(124, 58, 237, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.85rem;
        font-family: 'Outfit', sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.background = 'rgba(139, 92, 246, 1)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = 'rgba(124, 58, 237, 0.9)';
      });
      btn.addEventListener('click', () => {
        this.hideReturnToEditorBtn();
        this.openMapEditor(this.editingMap || undefined);
      });
      document.body.appendChild(btn);
      this.returnToEditorBtn = btn;
    } else {
      this.returnToEditorBtn.style.display = 'block';
    }
  }

  private hideReturnToEditorBtn(): void {
    if (this.returnToEditorBtn) {
      this.returnToEditorBtn.style.display = 'none';
    }
  }

  private showLobbyBtn(): void {
    if (!this.lobbyBtn) {
      const btn = document.createElement('button');
      btn.id = 'btnLobbyShortcut';
      btn.innerHTML = '⚔️ Lobby';
      btn.style.cssText = `
        position: fixed;
        top: 85px;
        left: 16px;
        z-index: 100;
        background: rgba(22, 163, 74, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.85rem;
        font-family: 'Outfit', sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.background = 'rgba(34, 197, 94, 1)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = 'rgba(22, 163, 74, 0.9)';
      });
      btn.addEventListener('click', () => {
        this.hideLobbyBtn();
        this.hideReturnToEditorBtn();
        this.menuModal.show();
      });
      document.body.appendChild(btn);
      this.lobbyBtn = btn;
    } else {
      this.lobbyBtn.style.display = 'block';
    }
  }

  private hideLobbyBtn(): void {
    if (this.lobbyBtn) {
      this.lobbyBtn.style.display = 'none';
    }
  }
}

// Start Game on DOM Content Loaded
window.addEventListener('DOMContentLoaded', () => {
  new WormixGame();
});
