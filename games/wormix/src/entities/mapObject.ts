import { MapObjectType, MapObjectData } from '../types';
import { TerrainManager } from '../terrain/terrainManager';
import { Worm } from './worm';

export class MapObject {
  public id: string;
  public type: MapObjectType;
  public x: number;
  public y: number;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 14;
  public health: number = 50;
  public isGrounded: boolean = false;
  public isDestroyed: boolean = false;

  // Landmine specific state
  public isTriggered: boolean = false;
  public triggerTimer: number = 30; // 30 ticks (1s at 30fps)

  constructor(data: MapObjectData) {
    this.id = data.id || `obj_${Math.random().toString(36).substr(2, 9)}`;
    this.type = data.type;
    this.x = data.x;
    this.y = data.y;
    this.health = data.type === 'barrel' ? 50 : 10;
  }

  public update(
    terrain: TerrainManager,
    worms: Worm[],
    onExplode: (x: number, y: number, radius: number, damage: number) => void,
    onCollectCrate: (worm: Worm, amount: number) => void
  ): void {
    if (this.isDestroyed) return;

    // Apply gravity
    this.vy += 0.5;
    this.y += this.vy;

    // Terrain surface collision
    const surfaceY = terrain.getSurfaceY(this.x);
    if (this.y + this.radius >= surfaceY) {
      this.y = surfaceY - this.radius;
      this.vy = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    // Handle Barrel explosion on zero health
    if (this.type === 'barrel' && this.health <= 0) {
      this.isDestroyed = true;
      onExplode(this.x, this.y, 55, 50);
      return;
    }

    // Handle Landmine proximity trigger & countdown
    if (this.type === 'landmine') {
      if (!this.isTriggered) {
        for (const worm of worms) {
          if (worm.isAlive && Math.hypot(worm.x - this.x, worm.y - this.y) < 28) {
            this.isTriggered = true;
            break;
          }
        }
      } else {
        this.triggerTimer--;
        if (this.triggerTimer <= 0) {
          this.isDestroyed = true;
          onExplode(this.x, this.y, 42, 40);
          return;
        }
      }
    }

    // Handle Health Crate collection by worms
    if (this.type === 'health_crate') {
      for (const worm of worms) {
        if (worm.isAlive && Math.hypot(worm.x - this.x, worm.y - this.y) < 24) {
          this.isDestroyed = true;
          onCollectCrate(worm, 30);
          return;
        }
      }
    }
  }

  public takeDamage(amount: number): void {
    if (this.type === 'barrel') {
      this.health -= amount;
    } else if (this.type === 'landmine') {
      this.isTriggered = true;
      this.triggerTimer = Math.min(this.triggerTimer, 5);
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    if (this.isDestroyed) return;

    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.type === 'barrel') {
      // 🛢️ Oil Barrel
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-10, -14, 20, 28);
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 2;
      ctx.strokeRect(-10, -14, 20, 28);

      // Warning hazard stripes
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-10, -3, 20, 6);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', 0, 11);
    } else if (this.type === 'landmine') {
      // 💣 Landmine
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(0, 4, 10, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Blinking red light when triggered
      const isRed = !this.isTriggered || Math.floor(Date.now() / 150) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : '#facc15';
      ctx.beginPath();
      ctx.arc(0, -2, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'health_crate') {
      // 🧰 Health Crate
      ctx.fillStyle = '#15803d';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -12, 24, 24);

      // White Medical Cross
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, -8, 6, 16);
      ctx.fillRect(-8, -3, 16, 6);
    }

    ctx.restore();
  }

  public toData(): MapObjectData {
    return {
      id: this.id,
      type: this.type,
      x: Math.round(this.x),
      y: Math.round(this.y),
      health: this.health,
      triggered: this.isTriggered,
      triggerTimer: this.triggerTimer
    };
  }
}
