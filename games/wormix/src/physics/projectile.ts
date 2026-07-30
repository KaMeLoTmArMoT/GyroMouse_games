import { WeaponId, Portal } from '../types';
import { TerrainManager } from '../terrain/terrainManager';
import { Worm } from '../entities/worm';

export class Projectile {
  public weaponId: WeaponId;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public radius: number = 6;
  public fuseTimer: number; // in frames (30fps)
  public isClusterChild: boolean = false;
  public isExpired: boolean = false;
  public bounciness: number = 0.6;
  public teamId: string;

  constructor(
    weaponId: WeaponId,
    x: number,
    y: number,
    vx: number,
    vy: number,
    teamId: string,
    fuseSeconds: number = 3,
    isClusterChild: boolean = false
  ) {
    this.weaponId = weaponId;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.teamId = teamId;
    this.fuseTimer = Math.round(fuseSeconds * 30);
    this.isClusterChild = isClusterChild;
    if (weaponId === 'grenade' || weaponId === 'cluster') {
      this.bounciness = 0.6;
    }
  }

  public update(
    terrain: TerrainManager,
    worms: Worm[],
    windX: number,
    onExplode: (proj: Projectile, x: number, y: number) => void
  ): void {
    if (this.isExpired) return;

    // Apply Wind Force to Bazooka / Cluster
    if (this.weaponId === 'bazooka' || this.weaponId === 'cluster') {
      this.vx += windX * 0.05;
    }

    // Apply Gravity
    this.vy += 0.45;

    // Position Step
    this.x += this.vx;
    this.y += this.vy;

    // Fuse Timer countdown for Grenade / Cluster
    if (this.weaponId === 'grenade' || (this.weaponId === 'cluster' && !this.isClusterChild)) {
      this.fuseTimer--;
      if (this.fuseTimer <= 0) {
        this.triggerExplosion(terrain, worms, onExplode);
        return;
      }
    }

    // Portal Teleport Check
    this.checkPortalWarp(terrain);

    // Collision with Terrain Surface
    const surfaceY = terrain.getSurfaceY(this.x);
    if (this.y >= surfaceY) {
      if (this.weaponId === 'grenade' || (this.weaponId === 'cluster' && !this.isClusterChild)) {
        // Bounce
        this.y = surfaceY - 2;
        this.vy = -this.vy * this.bounciness;
        this.vx *= 0.7;
      } else {
        // Immediate Impact Detonation
        this.triggerExplosion(terrain, worms, onExplode);
        return;
      }
    }

    // Collision with Worms
    for (const worm of worms) {
      if (!worm.isAlive) continue;
      const dx = this.x - worm.x;
      const dy = this.y - worm.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.radius + worm.radius) {
        this.triggerExplosion(terrain, worms, onExplode);
        return;
      }
    }

    // Out of Bounds or Drowning
    if (this.y >= terrain.waterY || this.x < -100 || this.x > terrain.width + 100) {
      this.isExpired = true;
    }
  }

  private checkPortalWarp(terrain: TerrainManager): void {
    const portals = [terrain.orangePortal, terrain.bluePortal].filter(Boolean) as Portal[];
    if (portals.length < 2) return;

    const p1 = portals[0];
    const p2 = portals[1];

    for (let i = 0; i < 2; i++) {
      const enterPortal = i === 0 ? p1 : p2;
      const exitPortal = i === 0 ? p2 : p1;

      const dx = this.x - enterPortal.x;
      const dy = this.y - enterPortal.y;
      if (Math.sqrt(dx * dx + dy * dy) < enterPortal.radius) {
        this.x = exitPortal.x + exitPortal.normalX * 25;
        this.y = exitPortal.y + exitPortal.normalY * 25;
        // Warp velocity direction
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        this.vx = exitPortal.normalX * speed;
        this.vy = exitPortal.normalY * speed;
        break;
      }
    }
  }

  public triggerExplosion(
    terrain: TerrainManager,
    worms: Worm[],
    onExplode: (proj: Projectile, x: number, y: number) => void
  ): void {
    if (this.isExpired) return;
    this.isExpired = true;

    if (this.weaponId === 'sand_bomb') {
      terrain.depositSand(this.x, 35);
    } else if (this.weaponId === 'acid_bomb') {
      // Spawn acid particles
      for (let i = 0; i < 15; i++) {
        terrain.particles.push({
          x: this.x + (Math.random() - 0.5) * 20,
          y: this.y,
          vx: (Math.random() - 0.5) * 6,
          vy: -Math.random() * 4,
          life: 0,
          maxLife: 60,
          color: '#84cc16',
          size: 4,
          isAcid: true
        });
      }
    } else if (this.weaponId === 'portal_gun') {
      // Deploy portal
      const isOrange = terrain.orangePortal === null;
      const portal: Portal = {
        id: isOrange ? 'orange' : 'blue',
        x: this.x,
        y: this.y,
        normalX: 0,
        normalY: -1,
        radius: 18
      };
      if (isOrange) terrain.orangePortal = portal;
      else terrain.bluePortal = portal;
    } else {
      // Standard Explosions (Bazooka, Grenade, Cluster)
      const blastRadius = this.weaponId === 'bazooka' ? 42 : this.weaponId === 'cluster' ? 30 : 38;
      const baseDamage = this.weaponId === 'bazooka' ? 45 : 35;

      terrain.explode(this.x, this.y, blastRadius);

      // Damage & Knockback to worms
      for (const worm of worms) {
        if (!worm.isAlive) continue;
        const dx = worm.x - this.x;
        const dy = worm.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < blastRadius + worm.radius) {
          const force = (1.0 - dist / (blastRadius + worm.radius));
          const dmg = Math.floor(baseDamage * force);
          worm.takeDamage(dmg);

          // Knockback vector
          const angle = Math.atan2(dy, dx);
          worm.vx += Math.cos(angle) * force * 10;
          worm.vy += Math.sin(angle) * force * 8 - 3;
          worm.isGrounded = false;
        }
      }
    }

    onExplode(this, this.x, this.y);
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    if (this.isExpired) return;

    ctx.save();
    ctx.translate(this.x, this.y);

    const colors: Record<WeaponId, string> = {
      bazooka: '#ef4444',
      grenade: '#22c55e',
      cluster: '#eab308',
      acid_bomb: '#84cc16',
      sand_bomb: '#f59e0b',
      portal_gun: '#3b82f6',
      shotgun: '#94a3b8'
    };

    ctx.fillStyle = colors[this.weaponId] || '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}
