import { Vector2D } from '../types';
import { TerrainManager } from '../terrain/terrainManager';

export type WormTeam = 'player' | 'ai';

export class Worm {
  public id: string;
  public name: string;
  public team: WormTeam;
  public x: number;
  public y: number;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 12;
  public health: number = 100;
  public maxHealth: number = 100;

  // Oxygen & Water Submersion
  public oxygen: number = 100;
  public maxOxygen: number = 100;
  public isInWater: boolean = false;

  public aimAngle: number = 0; // Degrees (-90 = straight up, 0 = right, 180 = left)
  public facingRight: boolean = true;
  public isGrounded: boolean = false;
  public isAlive: boolean = true;
  public isDrowned: boolean = false;
  public fallStartY: number = 0;

  constructor(id: string, name: string, team: WormTeam, x: number, y: number) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.x = x;
    this.y = y;
    this.fallStartY = y;
    this.isGrounded = true;
    this.aimAngle = team === 'player' ? -30 : -150;
    this.facingRight = team === 'player';
  }

  public update(terrain: TerrainManager): void {
    if (!this.isAlive) return;

    // Cellular Automata Water Density & Submersion Check
    const waterCells = terrain.getWaterDensityAt(this.x, this.y, 22);
    if (waterCells > 2 || this.y >= terrain.waterY - 10) {
      this.isInWater = true;
      this.vy += 0.1; // Reduced effective gravity in water
      this.vy -= Math.min(0.5, waterCells * 0.04); // Buoyancy force upward!
      this.vx *= 0.75; // Fluid drag
      this.vy *= 0.8;

      // Deplete oxygen while submerged
      this.oxygen = Math.max(0, this.oxygen - 0.5);
      if (this.oxygen <= 0) {
        this.takeDamage(0.4); // Gradual drowning damage per tick
      }
    } else {
      this.isInWater = false;
      this.oxygen = Math.min(this.maxOxygen, this.oxygen + 2.0); // Replenish breath
      this.vy += 0.5; // Normal gravity
      this.vx *= 0.85; // Normal friction
    }

    this.x += this.vx;
    this.y += this.vy;



    // Terrain Collision
    const surfaceY = terrain.getSurfaceY(this.x);
    const feetY = this.y + this.radius;

    if (feetY >= surfaceY) {
      // Check fall damage
      if (!this.isGrounded && this.vy > 8 && !this.isInWater) {
        const fallDist = Math.max(0, this.y - this.fallStartY);
        if (fallDist > 120) {
          const dmg = Math.floor((fallDist - 120) * 0.35);
          this.takeDamage(dmg);
        }
      }

      this.y = surfaceY - this.radius;
      this.vy = 0;
      this.isGrounded = true;
    } else {
      if (this.isGrounded) {
        this.fallStartY = this.y;
      }
      this.isGrounded = false;
    }

    // Screen Bounds
    this.x = Math.max(this.radius, Math.min(terrain.width - this.radius, this.x));

    // Bottom Ocean Void Death Check
    if (this.y > terrain.height + 20) {
      this.isDrowned = true;
      this.health = 0;
      this.isAlive = false;
    }
  }

  public walk(direction: number): void {
    if (!this.isAlive) return;
    const speed = this.isInWater ? 1.5 : 2.5;
    if (this.isGrounded || this.isInWater) {
      this.vx = direction * speed;
    }
    if (direction !== 0) {
      this.facingRight = direction > 0;
    }
  }

  public jump(): void {
    if (!this.isAlive) return;
    if (this.isInWater) {
      this.vy = -4.5; // Swim upward!
      this.vx = (this.facingRight ? 1 : -1) * 2.0;
    } else if (this.isGrounded) {
      this.vy = -6.5;
      this.vx = (this.facingRight ? 1 : -1) * 3.0;
      this.isGrounded = false;
    }
  }

  public takeDamage(amount: number): void {
    if (!this.isAlive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.isAlive = false;
    }
  }

  public getCannonTip(): Vector2D {
    const rad = (this.aimAngle * Math.PI) / 180;
    const barrelLength = 22;
    return {
      x: this.x + Math.cos(rad) * barrelLength,
      y: this.y + Math.sin(rad) * barrelLength
    };
  }

  public draw(ctx: CanvasRenderingContext2D, isActive: boolean): void {
    if (!this.isAlive) return;

    ctx.save();
    ctx.translate(this.x, this.y);

    const bodyColor = this.team === 'player' ? '#ef4444' : '#3b82f6';
    const accentColor = this.team === 'player' ? '#b91c1c' : '#1d4ed8';

    // Active Arrow Indicator above head
    if (isActive) {
      const floatY = -this.radius - 22 + Math.sin(Date.now() * 0.008) * 3;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(-6, floatY);
      ctx.lineTo(6, floatY);
      ctx.lineTo(0, floatY + 8);
      ctx.closePath();
      ctx.fill();
    }

    // Worm Body (Capsule / Circle)
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Eyes
    const eyeOffsetX = this.facingRight ? 4 : -4;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(eyeOffsetX + (this.facingRight ? 1 : -1), -3, 2, 0, Math.PI * 2);
    ctx.fill();

    // Aim Barrel Line
    if (isActive) {
      const rad = (this.aimAngle * Math.PI) / 180;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(rad) * 20, Math.sin(rad) * 20);
      ctx.stroke();
    }

    ctx.restore();

    // Floating Health & Oxygen Bar
    const barWidth = 32;
    const barHeight = 5;
    const barX = this.x - barWidth / 2;
    const barY = this.y - this.radius - 14;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    const hpRatio = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

    // Oxygen Bubble Bar when submerged
    if (this.oxygen < 100) {
      const oxyRatio = Math.max(0, this.oxygen / this.maxOxygen);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(barX, barY - 4, barWidth * oxyRatio, 3);
    }

    // Name Label
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x, barY - 5);
  }
}

