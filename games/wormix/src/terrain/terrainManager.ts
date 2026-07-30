import {
  Portal,
  Particle,
  CELL_AIR,
  CELL_GRASS,
  CELL_DIRT,
  CELL_STONE,
  CELL_BEDROCK,
  CELL_SAND,
  CELL_WATER,
  CELL_ACID,
  CELL_IRON
} from '../types';

export class TerrainManager {
  public width: number = 1200;
  public height: number = 700;
  public waterY: number = 660;

  // Cellular Automata Grid
  public readonly cellScale: number = 2; // 2px per cell for performance
  public gridWidth: number;
  public gridHeight: number;
  public grid: Uint8Array;
  public surfaceYCache: Float32Array;

  // Offscreen Canvas for Grid Rendering
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private gridImageData: ImageData;

  // Portals & Particles
  public orangePortal: Portal | null = null;
  public bluePortal: Portal | null = null;
  public particles: Particle[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(800, width);
    this.height = Math.max(500, height);
    this.waterY = this.height - 40;

    this.gridWidth = Math.floor(this.width / this.cellScale);
    this.gridHeight = Math.floor(this.height / this.cellScale);
    this.grid = new Uint8Array(this.gridWidth * this.gridHeight);
    this.surfaceYCache = new Float32Array(this.width);

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = this.gridWidth;
    this.offscreenCanvas.height = this.gridHeight;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;
    this.gridImageData = this.offscreenCtx.createImageData(this.gridWidth, this.gridHeight);

    this.generateTerrain();
  }

  public resize(w: number, h: number): void {
    this.width = Math.max(800, w);
    this.height = Math.max(500, h);
    this.waterY = this.height - 40;

    this.gridWidth = Math.floor(this.width / this.cellScale);
    this.gridHeight = Math.floor(this.height / this.cellScale);
    this.grid = new Uint8Array(this.gridWidth * this.gridHeight);
    this.surfaceYCache = new Float32Array(this.width);

    this.offscreenCanvas.width = this.gridWidth;
    this.offscreenCanvas.height = this.gridHeight;
    this.gridImageData = this.offscreenCtx.createImageData(this.gridWidth, this.gridHeight);

    this.generateTerrain();
  }

  public getCell(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return gy >= Math.floor(this.waterY / this.cellScale) ? CELL_BEDROCK : CELL_AIR;
    }
    return this.grid[gy * this.gridWidth + gx];
  }

  public setCell(gx: number, gy: number, type: number): void {
    if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
      this.grid[gy * this.gridWidth + gx] = type;
    }
  }

  public generateTerrain(): void {
    this.grid.fill(CELL_AIR);

    const bedrockGY = Math.floor((this.waterY + 10) / this.cellScale);

    const sandStartG = Math.floor((this.width * 0.38) / this.cellScale);
    const sandEndG = Math.floor((this.width * 0.62) / this.cellScale);

    for (let gx = 0; gx < this.gridWidth; gx++) {
      const xWorld = gx * this.cellScale;
      const hillSin1 = Math.sin(xWorld * 0.005) * 65;
      const hillSin2 = Math.sin(xWorld * 0.015) * 35;
      const hillSin3 = Math.cos(xWorld * 0.03) * 15;
      const heightOffset = hillSin1 + hillSin2 + hillSin3;

      let groundY = Math.min(this.waterY - 70, Math.max(120, this.height * 0.62 + heightOffset));
      if (gx >= sandStartG && gx <= sandEndG) {
        const sandPeak = Math.sin(((gx - sandStartG) / (sandEndG - sandStartG)) * Math.PI) * 25;
        groundY -= sandPeak;
      }

      const groundGY = Math.floor(groundY / this.cellScale);

      for (let gy = 0; gy < this.gridHeight; gy++) {
        if (gy >= bedrockGY) {
          this.setCell(gx, gy, CELL_BEDROCK);
        } else if (gy >= groundGY + 25) {
          this.setCell(gx, gy, CELL_STONE);
        } else if (gy >= groundGY + 5) {
          this.setCell(gx, gy, CELL_DIRT);
        } else if (gy >= groundGY) {
          if (gx >= sandStartG && gx <= sandEndG) {
            this.setCell(gx, gy, CELL_SAND);
          } else {
            this.setCell(gx, gy, CELL_GRASS);
          }
        }
      }
    }

    this.rebuildSurfaceCache();

    // Default Lake Water Pool in terrain valley
    const lakeStartG = Math.floor((this.width * 0.15) / this.cellScale);
    const lakeEndG = Math.floor((this.width * 0.28) / this.cellScale);
    for (let gx = lakeStartG; gx <= lakeEndG; gx++) {
      const surfaceGY = Math.floor(this.getSurfaceY(gx * this.cellScale) / this.cellScale);
      const targetWaterGY = Math.floor((this.waterY - 75) / this.cellScale);
      if (surfaceGY > targetWaterGY) {
        for (let gy = targetWaterGY; gy < surfaceGY; gy++) {
          if (gy > 0) this.setCell(gx, gy, CELL_WATER);
        }
      }
    }

    this.rebuildSurfaceCache();
  }

  public buildTerrainFromHeights(
    customHeights: number[] | Float32Array,
    waterY?: number,
    customMaterials?: string[],
    gridData?: number[]
  ): void {
    if (waterY) this.waterY = waterY;
    this.grid.fill(CELL_AIR);

    if (gridData && gridData.length === this.grid.length) {
      this.grid.set(gridData);
      this.rebuildSurfaceCache();
      return;
    }

    const bedrockGY = Math.floor((this.waterY + 10) / this.cellScale);

    for (let gx = 0; gx < this.gridWidth; gx++) {
      const xWorld = gx * this.cellScale;
      const groundY = customHeights[xWorld] !== undefined ? customHeights[xWorld] : this.height * 0.65;
      const groundGY = Math.floor(groundY / this.cellScale);
      const matColor = customMaterials ? customMaterials[xWorld] : '#15803d';

      let topCell = CELL_GRASS;
      if (matColor === '#78350f') topCell = CELL_DIRT;
      else if (matColor === '#64748b') topCell = CELL_STONE;
      else if (matColor === '#f59e0b') topCell = CELL_SAND;

      for (let gy = 0; gy < this.gridHeight; gy++) {
        if (gy >= bedrockGY) {
          this.setCell(gx, gy, CELL_BEDROCK);
        } else if (gy >= groundGY + 20) {
          this.setCell(gx, gy, CELL_STONE);
        } else if (gy >= groundGY + 6) {
          this.setCell(gx, gy, CELL_DIRT);
        } else if (gy >= groundGY) {
          this.setCell(gx, gy, topCell);
        }
      }
    }

    this.rebuildSurfaceCache();
  }

  public getSurfaceY(x: number): number {
    const colX = Math.floor(Math.max(0, Math.min(this.width - 1, x)));
    return this.surfaceYCache[colX] || this.waterY;
  }

  public isSolidCell(cell: number): boolean {
    return (
      cell === CELL_GRASS ||
      cell === CELL_DIRT ||
      cell === CELL_STONE ||
      cell === CELL_BEDROCK ||
      cell === CELL_SAND ||
      cell === CELL_IRON
    );
  }

  public isSolidAt(x: number, y: number): boolean {
    const gx = Math.floor(x / this.cellScale);
    const gy = Math.floor(y / this.cellScale);
    return this.isSolidCell(this.getCell(gx, gy));
  }

  public getLocalGroundY(
    x: number,
    startY: number,
    maxSearchDown: number = 40,
    maxSearchUp: number = 25
  ): number | null {
    const colX = Math.floor(Math.max(0, Math.min(this.width - 1, x)));
    const gx = Math.floor(colX / this.cellScale);
    const startGY = Math.floor(startY / this.cellScale);
    const maxDownGY = Math.min(this.gridHeight - 1, startGY + Math.ceil(maxSearchDown / this.cellScale));
    const maxUpGY = Math.max(0, startGY - Math.ceil(maxSearchUp / this.cellScale));

    if (this.isSolidCell(this.getCell(gx, startGY))) {
      for (let gy = startGY; gy >= maxUpGY; gy--) {
        if (!this.isSolidCell(this.getCell(gx, gy))) {
          return (gy + 1) * this.cellScale;
        }
      }
      return maxUpGY * this.cellScale;
    }

    for (let gy = startGY; gy <= maxDownGY; gy++) {
      if (this.isSolidCell(this.getCell(gx, gy))) {
        return gy * this.cellScale;
      }
    }

    return null;
  }

  public getWaterDensityAt(x: number, y: number, radiusWorld: number = 24): number {
    const centerGX = Math.floor(x / this.cellScale);
    const centerGY = Math.floor(y / this.cellScale);
    const radiusG = Math.ceil(radiusWorld / this.cellScale);

    let waterCount = 0;
    for (let dy = -radiusG; dy <= radiusG; dy++) {
      for (let dx = -radiusG; dx <= radiusG; dx++) {
        if (dx * dx + dy * dy <= radiusG * radiusG) {
          const cell = this.getCell(centerGX + dx, centerGY + dy);
          if (cell === CELL_WATER || cell === CELL_ACID) {
            waterCount++;
          }
        }
      }
    }
    return waterCount;
  }

  public explode(centerX: number, centerY: number, radiusWorld: number): void {
    const centerGX = Math.floor(centerX / this.cellScale);
    const centerGY = Math.floor(centerY / this.cellScale);
    const radiusG = Math.ceil(radiusWorld / this.cellScale);

    for (let dy = -radiusG; dy <= radiusG; dy++) {
      for (let dx = -radiusG; dx <= radiusG; dx++) {
        if (dx * dx + dy * dy <= radiusG * radiusG) {
          const gx = centerGX + dx;
          const gy = centerGY + dy;
          const currentCell = this.getCell(gx, gy);
          if (currentCell !== CELL_BEDROCK && currentCell !== CELL_AIR) {
            this.setCell(gx, gy, CELL_AIR);
          }
        }
      }
    }

    this.rebuildSurfaceCache();

    // Spawn flying debris particles
    for (let i = 0; i < 20; i++) {
      const pAngle = Math.random() * Math.PI * 2;
      const pSpeed = Math.random() * 8 + 2;
      this.particles.push({
        x: centerX + Math.cos(pAngle) * (radiusWorld * 0.3),
        y: centerY + Math.sin(pAngle) * (radiusWorld * 0.3),
        vx: Math.cos(pAngle) * pSpeed,
        vy: Math.sin(pAngle) * pSpeed - 2,
        life: 0,
        maxLife: Math.floor(Math.random() * 20 + 15),
        color: Math.random() > 0.5 ? '#8b4513' : '#64748b',
        size: Math.random() * 4 + 2
      });
    }
  }

  public depositSand(centerX: number, radiusWorld: number = 25): void {
    const centerGX = Math.floor(centerX / this.cellScale);
    const surfaceGY = Math.floor(this.getSurfaceY(centerX) / this.cellScale);
    const radiusG = Math.ceil(radiusWorld / this.cellScale);

    for (let dy = -radiusG; dy <= 0; dy++) {
      for (let dx = -radiusG; dx <= radiusG; dx++) {
        if (dx * dx + dy * dy <= radiusG * radiusG) {
          this.setCell(centerGX + dx, surfaceGY + dy, CELL_SAND);
        }
      }
    }
    this.rebuildSurfaceCache();
  }

  public spawnElementStream(xWorld: number, yWorld: number, cellType: number, radiusWorld: number = 15): void {
    const centerGX = Math.floor(xWorld / this.cellScale);
    const centerGY = Math.floor(yWorld / this.cellScale);
    const radiusG = Math.ceil(radiusWorld / this.cellScale);

    for (let dy = -radiusG; dy <= radiusG; dy++) {
      for (let dx = -radiusG; dx <= radiusG; dx++) {
        if (dx * dx + dy * dy <= radiusG * radiusG) {
          this.setCell(centerGX + dx, centerGY + dy, cellType);
        }
      }
    }
    this.rebuildSurfaceCache();
  }

  public updatePhysics(): void {
    // 1. Double-pass Liquid Physics Loop for smooth, fast fluid dispersion (prevents jelly sloshing)
    for (let pass = 0; pass < 2; pass++) {
      const updateGrid = new Uint8Array(this.grid);
      const dirLeftFirst = Math.random() < 0.5;

      for (let gy = this.gridHeight - 2; gy >= 0; gy--) {
        const xStart = dirLeftFirst ? 0 : this.gridWidth - 1;
        const xEnd = dirLeftFirst ? this.gridWidth : -1;
        const xStep = dirLeftFirst ? 1 : -1;

        for (let gx = xStart; gx !== xEnd; gx += xStep) {
          const idx = gy * this.gridWidth + gx;
          const cell = updateGrid[idx];

          if (cell !== CELL_WATER && cell !== CELL_ACID) continue;

          const belowIdx = (gy + 1) * this.gridWidth + gx;
          const cellBelow = updateGrid[belowIdx];

          // Acid reaction: dissolve adjacent terrain
          if (cell === CELL_ACID && pass === 0) {
            let dissolved = false;
            const neighbors = [
              belowIdx,
              gy * this.gridWidth + Math.max(0, gx - 1),
              gy * this.gridWidth + Math.min(this.gridWidth - 1, gx + 1)
            ];
            for (const nIdx of neighbors) {
              const targetMat = updateGrid[nIdx];
              if (targetMat === CELL_GRASS || targetMat === CELL_DIRT || targetMat === CELL_STONE || targetMat === CELL_SAND) {
                this.grid[idx] = CELL_AIR;
                this.grid[nIdx] = CELL_AIR;
                updateGrid[idx] = CELL_AIR;
                updateGrid[nIdx] = CELL_AIR;
                dissolved = true;
                break;
              }
            }
            if (dissolved) continue;
          }

          // Liquid movement: Down -> Diagonals -> Leveling only when target column is lower
          if (cellBelow === CELL_AIR) {
            this.grid[idx] = CELL_AIR;
            this.grid[belowIdx] = cell;
            updateGrid[idx] = CELL_AIR;
            updateGrid[belowIdx] = cell;
          } else {
            const checkDir = Math.random() < 0.5 ? -1 : 1;
            const diag1GX = gx + checkDir;
            const diag2GX = gx - checkDir;

            if (diag1GX >= 0 && diag1GX < this.gridWidth && updateGrid[(gy + 1) * this.gridWidth + diag1GX] === CELL_AIR) {
              const diag1Idx = (gy + 1) * this.gridWidth + diag1GX;
              this.grid[idx] = CELL_AIR;
              this.grid[diag1Idx] = cell;
              updateGrid[idx] = CELL_AIR;
              updateGrid[diag1Idx] = cell;
            } else if (diag2GX >= 0 && diag2GX < this.gridWidth && updateGrid[(gy + 1) * this.gridWidth + diag2GX] === CELL_AIR) {
              const diag2Idx = (gy + 1) * this.gridWidth + diag2GX;
              this.grid[idx] = CELL_AIR;
              this.grid[diag2Idx] = cell;
              updateGrid[idx] = CELL_AIR;
              updateGrid[diag2Idx] = cell;
            } else {
              // Horizontal flow into adjacent AIR cell (allows cascading down hill slopes)
              for (const dir of [checkDir, -checkDir]) {
                const hGX = gx + dir;
                if (hGX >= 0 && hGX < this.gridWidth && updateGrid[gy * this.gridWidth + hGX] === CELL_AIR) {
                  const targetIdx = gy * this.gridWidth + hGX;
                  this.grid[idx] = CELL_AIR;
                  this.grid[targetIdx] = cell;
                  updateGrid[idx] = CELL_AIR;
                  updateGrid[targetIdx] = cell;
                  break;
                }
              }
            }
          }
        }
      }
    }

    // 2. Sand Physics Sweep
    const updateGridSand = new Uint8Array(this.grid);
    const dirLeftFirstSand = Math.random() < 0.5;

    for (let gy = this.gridHeight - 2; gy >= 0; gy--) {
      const xStart = dirLeftFirstSand ? 0 : this.gridWidth - 1;
      const xEnd = dirLeftFirstSand ? this.gridWidth : -1;
      const xStep = dirLeftFirstSand ? 1 : -1;

      for (let gx = xStart; gx !== xEnd; gx += xStep) {
        const idx = gy * this.gridWidth + gx;
        const cell = updateGridSand[idx];

        if (cell !== CELL_SAND) continue;

        const belowIdx = (gy + 1) * this.gridWidth + gx;
        const cellBelow = updateGridSand[belowIdx];

        if (cellBelow === CELL_AIR) {
          this.grid[idx] = CELL_AIR;
          this.grid[belowIdx] = CELL_SAND;
          updateGridSand[idx] = CELL_AIR;
          updateGridSand[belowIdx] = CELL_SAND;
        } else if (cellBelow === CELL_WATER) {
          // Sand displaces water upward!
          this.grid[idx] = CELL_WATER;
          this.grid[belowIdx] = CELL_SAND;
          updateGridSand[idx] = CELL_WATER;
          updateGridSand[belowIdx] = CELL_SAND;
        } else {
          const checkDir = Math.random() < 0.5 ? -1 : 1;
          const diag1GX = gx + checkDir;
          const diag2GX = gx - checkDir;

          if (diag1GX >= 0 && diag1GX < this.gridWidth && updateGridSand[(gy + 1) * this.gridWidth + diag1GX] === CELL_AIR) {
            const diag1Idx = (gy + 1) * this.gridWidth + diag1GX;
            this.grid[idx] = CELL_AIR;
            this.grid[diag1Idx] = CELL_SAND;
            updateGridSand[idx] = CELL_AIR;
            updateGridSand[diag1Idx] = CELL_SAND;
          } else if (diag2GX >= 0 && diag2GX < this.gridWidth && updateGridSand[(gy + 1) * this.gridWidth + diag2GX] === CELL_AIR) {
            const diag2Idx = (gy + 1) * this.gridWidth + diag2GX;
            this.grid[idx] = CELL_AIR;
            this.grid[diag2Idx] = CELL_SAND;
            updateGridSand[idx] = CELL_AIR;
            updateGridSand[diag2Idx] = CELL_SAND;
          }
        }
      }
    }

    // Update Debris Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.life++;

      if (p.life >= p.maxLife || p.y > this.height) {
        this.particles.splice(i, 1);
      }
    }

    this.rebuildSurfaceCache();
  }

  public rebuildSurfaceCache(): void {
    const waterGY = Math.floor(this.waterY / this.cellScale);
    for (let x = 0; x < this.width; x++) {
      const gx = Math.floor(x / this.cellScale);
      let foundGY = waterGY;

      for (let gy = 0; gy < this.gridHeight; gy++) {
        const cell = this.grid[gy * this.gridWidth + gx];
        if (cell === CELL_GRASS || cell === CELL_DIRT || cell === CELL_STONE || cell === CELL_BEDROCK || cell === CELL_SAND || cell === CELL_IRON) {
          foundGY = gy;
          break;
        }
      }
      this.surfaceYCache[x] = foundGY * this.cellScale;
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    // 1. Clear Screen
    ctx.clearRect(0, 0, this.width, this.height);

    // 2. Render Grid onto Offscreen Canvas ImageData
    const imgData = this.gridImageData;
    const data = imgData.data;
    const time = Date.now() * 0.003;

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const cell = this.grid[gy * this.gridWidth + gx];
        const ptr = (gy * this.gridWidth + gx) * 4;

        if (cell === CELL_AIR) {
          data[ptr + 3] = 0;
        } else if (cell === CELL_GRASS) {
          data[ptr] = 0x15; data[ptr + 1] = 0x80; data[ptr + 2] = 0x3d; data[ptr + 3] = 255;
        } else if (cell === CELL_DIRT) {
          data[ptr] = 0x78; data[ptr + 1] = 0x35; data[ptr + 2] = 0x0f; data[ptr + 3] = 255;
        } else if (cell === CELL_STONE) {
          data[ptr] = 0x64; data[ptr + 1] = 0x74; data[ptr + 2] = 0x8b; data[ptr + 3] = 255;
        } else if (cell === CELL_BEDROCK) {
          data[ptr] = 0x1c; data[ptr + 1] = 0x19; data[ptr + 2] = 0x17; data[ptr + 3] = 255;
        } else if (cell === CELL_SAND) {
          data[ptr] = 0xf5; data[ptr + 1] = 0x9e; data[ptr + 2] = 0x0b; data[ptr + 3] = 255;
        } else if (cell === CELL_WATER) {
          data[ptr] = 0x38; data[ptr + 1] = 0xbd; data[ptr + 2] = 0xf8; data[ptr + 3] = 220;
        } else if (cell === CELL_ACID) {
          data[ptr] = 0x22; data[ptr + 1] = 0xc5; data[ptr + 2] = 0x5e; data[ptr + 3] = 240;
        } else if (cell === CELL_IRON) {
          data[ptr] = 0x33; data[ptr + 1] = 0x41; data[ptr + 2] = 0x55; data[ptr + 3] = 255;
        }
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    // Render scaled Offscreen Grid Canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.offscreenCanvas, 0, 0, this.width, this.height);
    ctx.restore();

    // 2.5 Render Smooth Contiguous Horizontal Surface Wave Lines
    ctx.save();
    ctx.lineWidth = 2;
    const waveTime = Date.now() * 0.004;

    const rawTopY = new Float32Array(this.gridWidth).fill(-1);
    const liquidType = new Uint8Array(this.gridWidth);

    for (let gx = 0; gx < this.gridWidth; gx++) {
      for (let gy = 0; gy < this.gridHeight; gy++) {
        const cell = this.grid[gy * this.gridWidth + gx];
        if (cell === CELL_WATER || cell === CELL_ACID) {
          rawTopY[gx] = gy * this.cellScale;
          liquidType[gx] = cell;
          break;
        }
      }
    }

    // Identify flat / mild slope surface columns (ignore steep cascades)
    const validSurface = new Uint8Array(this.gridWidth);
    for (let gx = 0; gx < this.gridWidth; gx++) {
      if (rawTopY[gx] < 0) continue;
      const leftY = gx > 0 && rawTopY[gx - 1] >= 0 ? rawTopY[gx - 1] : rawTopY[gx];
      const rightY = gx < this.gridWidth - 1 && rawTopY[gx + 1] >= 0 ? rawTopY[gx + 1] : rawTopY[gx];
      if (Math.abs(leftY - rawTopY[gx]) <= 6 && Math.abs(rightY - rawTopY[gx]) <= 6) {
        validSurface[gx] = 1;
      }
    }

    let inLiquid = false;
    let currentType = CELL_WATER;
    let segStart = -1;

    for (let gx = 0; gx <= this.gridWidth; gx++) {
      const active = gx < this.gridWidth && validSurface[gx] === 1;
      const type = gx < this.gridWidth ? liquidType[gx] : 0;

      if (active) {
        if (!inLiquid) {
          inLiquid = true;
          currentType = type;
          segStart = gx;
        }
      }

      if ((!active || type !== currentType) && inLiquid) {
        const segEnd = gx - 1;
        if (segEnd - segStart >= 2) {
          const isWater = currentType === CELL_WATER;
          ctx.strokeStyle = isWater ? 'rgba(186, 230, 253, 0.85)' : 'rgba(187, 247, 208, 0.9)';
          ctx.shadowColor = isWater ? '#38bdf8' : '#22c55e';
          ctx.shadowBlur = 3;

          ctx.beginPath();
          for (let x = segStart; x <= segEnd; x++) {
            const xW = x * this.cellScale;
            const waveOffset = Math.sin(xW * 0.06 + waveTime) * 1.2;
            const yW = rawTopY[x] + waveOffset;
            if (x === segStart) ctx.moveTo(xW, yW);
            else ctx.lineTo(xW, yW);
          }
          ctx.stroke();
        }

        inLiquid = active;
        currentType = type;
        segStart = gx;
      }
    }
    ctx.restore();

    // 3. Render Ocean Floor Wave at Bottom
    const waterGrad = ctx.createLinearGradient(0, this.waterY, 0, this.height);
    waterGrad.addColorStop(0, 'rgba(14, 165, 233, 0.8)');
    waterGrad.addColorStop(1, 'rgba(3, 105, 161, 0.95)');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, this.waterY, this.width, this.height - this.waterY);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < this.width; x += 5) {
      const waveY = this.waterY + Math.sin(x * 0.04 + time) * 3;
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();

    // 4. Draw Portals
    if (this.orangePortal) this.drawPortal(ctx, this.orangePortal, '#f97316');
    if (this.bluePortal) this.drawPortal(ctx, this.bluePortal, '#3b82f6');

    // 5. Draw Debris Particles
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

    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, portal.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, portal.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
