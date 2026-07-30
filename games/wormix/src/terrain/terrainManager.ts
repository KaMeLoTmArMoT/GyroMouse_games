import { Portal, Particle } from '../types';

export class TerrainManager {
  public width: number = 1200;
  public height: number = 700;
  public waterY: number = 660;

  // Offscreen Canvas for Pixel-Perfect Destructible Terrain
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private surfaceYCache: Float32Array;

  // Portals
  public orangePortal: Portal | null = null;
  public bluePortal: Portal | null = null;

  // Active Acid & Particles
  public particles: Particle[] = [];

  constructor(width: number, height: number) {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })!;
    this.width = Math.max(800, width);
    this.height = Math.max(500, height);
    this.surfaceYCache = new Float32Array(this.width);
    this.resize(width, height);
  }

  public resize(w: number, h: number): void {
    this.width = Math.max(800, w);
    this.height = Math.max(500, h);
    this.waterY = this.height - 40;

    this.offscreenCanvas.width = this.width;
    this.offscreenCanvas.height = this.height;
    this.surfaceYCache = new Float32Array(this.width);

    this.generateTerrain();
  }

  public generateTerrain(): void {
    const ctx = this.offscreenCtx;
    ctx.clearRect(0, 0, this.width, this.height);

    const baseGroundY = this.height * 0.62;
    const bedrockY = this.waterY - 20;

    const sandStart = Math.floor(this.width * 0.38);
    const sandEnd = Math.floor(this.width * 0.62);

    // 1. Calculate Hill Surface Y array
    const grassHeights = new Float32Array(this.width);
    for (let x = 0; x < this.width; x++) {
      const hillSin1 = Math.sin(x * 0.005) * 65;
      const hillSin2 = Math.sin(x * 0.015) * 35;
      const hillSin3 = Math.cos(x * 0.03) * 15;
      const heightOffset = hillSin1 + hillSin2 + hillSin3;

      let groundY = Math.min(this.waterY - 70, Math.max(120, baseGroundY + heightOffset));

      if (x >= sandStart && x <= sandEnd) {
        const sandPeak = Math.sin(((x - sandStart) / (sandEnd - sandStart)) * Math.PI) * 25;
        groundY -= sandPeak;
      }
      grassHeights[x] = groundY;
    }

    // 2. Draw Geological Layers onto Offscreen Canvas

    // A. Bedrock Layer (Bottom Charcoal)
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, bedrockY, this.width, this.height - bedrockY);

    // B. Stone Layer (Grey)
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(0, bedrockY);
    for (let x = 0; x < this.width; x++) {
      const stoneTop = grassHeights[x] + 55;
      ctx.lineTo(x, Math.min(bedrockY, stoneTop));
    }
    ctx.lineTo(this.width, bedrockY);
    ctx.closePath();
    ctx.fill();

    // C. Dirt Layer (Brown)
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.moveTo(0, bedrockY);
    for (let x = 0; x < this.width; x++) {
      const dirtTop = grassHeights[x] + 10;
      ctx.lineTo(x, dirtTop);
    }
    ctx.lineTo(this.width, bedrockY);
    ctx.closePath();
    ctx.fill();

    // D. Grass Layer (Green Surface)
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.moveTo(0, grassHeights[0]);
    for (let x = 1; x < this.width - 2; x += 2) {
      const xc = (x + (x + 1)) / 2;
      const yc = (grassHeights[x] + grassHeights[x + 1]) / 2;
      ctx.quadraticCurveTo(x, grassHeights[x], xc, yc);
    }
    ctx.lineTo(this.width, bedrockY);
    ctx.lineTo(0, bedrockY);
    ctx.closePath();
    ctx.fill();

    // E. Sand Dunes Layer (Golden Yellow)
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    let inSand = false;
    for (let x = sandStart; x <= sandEnd; x++) {
      if (!inSand) {
        ctx.moveTo(x, grassHeights[x] + 12);
        inSand = true;
      }
      ctx.lineTo(x, grassHeights[x]);
    }
    if (inSand) {
      ctx.lineTo(sandEnd, grassHeights[sandEnd] + 12);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Populate Surface Y Cache
    this.rebuildSurfaceCache(0, this.width);
  }

  public getSurfaceY(x: number): number {
    const colX = Math.floor(Math.max(0, Math.min(this.width - 1, x)));
    return this.surfaceYCache[colX] || this.waterY;
  }

  public explode(centerX: number, centerY: number, radius: number): void {
    // Cut out circular hole from Offscreen Terrain
    const ctx = this.offscreenCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rebuild surface cache in affected X range
    const minX = Math.floor(Math.max(0, centerX - radius - 2));
    const maxX = Math.floor(Math.min(this.width - 1, centerX + radius + 2));
    this.rebuildSurfaceCache(minX, maxX);

    // Spawn flying debris particles
    for (let i = 0; i < 24; i++) {
      const pAngle = Math.random() * Math.PI * 2;
      const pSpeed = Math.random() * 8 + 2;
      this.particles.push({
        x: centerX + Math.cos(pAngle) * (radius * 0.3),
        y: centerY + Math.sin(pAngle) * (radius * 0.3),
        vx: Math.cos(pAngle) * pSpeed,
        vy: Math.sin(pAngle) * pSpeed - 2,
        life: 0,
        maxLife: Math.floor(Math.random() * 20 + 15),
        color: Math.random() > 0.5 ? '#8b4513' : '#64748b',
        size: Math.random() * 4 + 2
      });
    }
  }

  public depositSand(centerX: number, amount: number = 30): void {
    const ctx = this.offscreenCtx;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(centerX, this.getSurfaceY(centerX) - 10, amount, 0, Math.PI * 2);
    ctx.fill();

    const minX = Math.max(0, Math.floor(centerX - amount - 5));
    const maxX = Math.min(this.width - 1, Math.ceil(centerX + amount + 5));
    this.rebuildSurfaceCache(minX, maxX);
  }

  private rebuildSurfaceCache(minX: number, maxX: number): void {
    const width = maxX - minX + 1;
    if (width <= 0) return;

    try {
      const imgData = this.offscreenCtx.getImageData(minX, 0, width, this.height);
      const data = imgData.data;

      for (let relX = 0; relX < width; relX++) {
        const x = minX + relX;
        let foundY = this.waterY;

        for (let y = 0; y < this.height; y++) {
          const alphaIndex = (y * width + relX) * 4 + 3;
          if (data[alphaIndex] > 30) { // Non-transparent pixel
            foundY = y;
            break;
          }
        }
        this.surfaceYCache[x] = foundY;
      }
    } catch {
      // Fallback if canvas context fails
      for (let x = minX; x <= maxX; x++) {
        this.surfaceYCache[x] = this.waterY;
      }
    }
  }

  public updatePhysics(): void {
    // Update Particles (Debris & Acid)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3; // Gravity
      p.life++;

      // Acid particle terrain erosion check
      if (p.isAcid && p.y >= this.getSurfaceY(p.x)) {
        this.explode(p.x, p.y, 10);
        this.particles.splice(i, 1);
        continue;
      }

      if (p.life >= p.maxLife || p.y > this.waterY) {
        this.particles.splice(i, 1);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    // 1. Background Sky Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    skyGrad.addColorStop(0, '#0f172a');
    skyGrad.addColorStop(0.7, '#1e293b');
    skyGrad.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Draw Destructible Terrain Offscreen Canvas
    ctx.drawImage(this.offscreenCanvas, 0, 0);

    // 3. Draw Water Layer at bottom
    const waterGrad = ctx.createLinearGradient(0, this.waterY, 0, this.height);
    waterGrad.addColorStop(0, 'rgba(14, 165, 233, 0.75)');
    waterGrad.addColorStop(1, 'rgba(3, 105, 161, 0.95)');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, this.waterY, this.width, this.height - this.waterY);

    // Draw Water Surface Wave
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const time = Date.now() * 0.003;
    for (let x = 0; x < this.width; x += 5) {
      const waveY = this.waterY + Math.sin(x * 0.04 + time) * 3;
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();

    // 4. Draw Portals
    if (this.orangePortal) this.drawPortal(ctx, this.orangePortal, '#f97316');
    if (this.bluePortal) this.drawPortal(ctx, this.bluePortal, '#3b82f6');

    // 5. Draw Debris & Acid Particles
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPortal(ctx: CanvasRenderingContext2D, portal: Portal, color: string): void {
    ctx.save();
    ctx.translate(portal.x, portal.y);

    // Glowing outer ring
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, portal.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Swirling inner core
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, portal.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
