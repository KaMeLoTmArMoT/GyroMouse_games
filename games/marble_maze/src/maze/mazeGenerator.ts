import { SeededRandom } from '../utils/seedrandom';

export type TerrainType = 'asphalt' | 'sand' | 'ice' | 'snow' | 'dirt' | 'grass' | 'cobblestone';

export type MazeTheme = 'winter' | 'city' | 'forest';

export type HoleShape = 'round' | 'square';
export type HoleMovePattern = 'static' | 'horizontal' | 'vertical' | 'circular';

export interface HoleConfig {
  shape: HoleShape;
  radius: number; // for round holes: e.g. 0.35, 0.48, 0.62
  size: number; // for square holes: side length, e.g. 0.7, 0.95, 1.25 (half-size = side/2)
  offsetX: number; // offset relative to cell center (-0.6 to 0.6)
  offsetZ: number; // offset relative to cell center (-0.6 to 0.6)
  movePattern: HoleMovePattern;
  moveSpeed: number;
  moveRange: number;
}

export interface BridgeConfig {
  lane: 'left' | 'center' | 'right';
  axis: 'x' | 'z'; // 'z': bridge spans Z (narrow in X). 'x': bridge spans X (narrow in Z).
}

export interface MazeCell {
  x: number;
  z: number;
  visited: boolean;
  walls: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  terrain: TerrainType;
  isHole: boolean;
  holeConfig?: HoleConfig;
  isBridge: boolean;
  bridgeConfig?: BridgeConfig;
  isGoal: boolean;
  isStart: boolean;
  hasCoin: boolean;
  isGate: boolean;
  gateCost?: number;
  isCheckpoint: boolean;
  hasGuardrail: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MazeData {
  width: number;
  height: number;
  cellSize: number;
  seed: string;
  difficulty: Difficulty;
  theme: MazeTheme;
  cells: MazeCell[][];
  startCell: { x: number; z: number };
  goalCell: { x: number; z: number };
  mainPath: { x: number; z: number }[]; // Store main path to avoid recalculation
  holesCount: number;
  coinsCount: number;
  gatesCount: number;
  checkpointsCount: number;
}

export class MazeGenerator {
  public static generate(
    width: number,
    height: number,
    seedStr: string,
    difficulty: Difficulty = 'medium',
    cellSize: number = 3.0,
    forcedTheme?: MazeTheme
  ): MazeData {
    const prng = new SeededRandom(seedStr);
    const cells: MazeCell[][] = [];

    // Select theme logically or randomly if not forced
    const availableThemes: MazeTheme[] = ['winter', 'city', 'forest'];
    const theme: MazeTheme = forcedTheme || prng.choice(availableThemes);

    for (let z = 0; z < height; z++) {
      cells[z] = [];
      for (let x = 0; x < width; x++) {
        cells[z][x] = {
          x,
          z,
          visited: false,
          walls: { top: true, right: true, bottom: true, left: true },
          terrain: this.getDefaultTerrainForTheme(theme),
          isHole: false,
          isBridge: false,
          isGoal: false,
          isStart: false,
          hasCoin: false,
          isGate: false,
          isCheckpoint: false,
          hasGuardrail: { top: true, right: true, bottom: true, left: true }
        };
      }
    }

    const stack: { x: number; z: number }[] = [];
    const startX = 0;
    const startZ = 0;
    cells[startZ][startX].visited = true;
    stack.push({ x: startX, z: startZ });

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = this.getUnvisitedNeighbors(current.x, current.z, width, height, cells);

      if (neighbors.length > 0) {
        const next = prng.choice(neighbors);
        this.removeWallsBetween(cells[current.z][current.x], cells[next.z][next.x]);
        cells[next.z][next.x].visited = true;
        stack.push({ x: next.x, z: next.z });
      } else {
        stack.pop();
      }
    }

    const startCell = { x: 0, z: 0 };
    const goalCell = { x: width - 1, z: height - 1 };
    cells[startZ][startX].isStart = true;
    cells[goalCell.z][goalCell.x].isGoal = true;

    this.assignOrganicTerrains(cells, width, height, difficulty, theme, prng);

    let holesCount = 0;
    let coinsCount = 0;
    const holeProb = difficulty === 'easy' ? 0.05 : difficulty === 'medium' ? 0.10 : 0.18;

    let gatesCount = 0;
    let checkpointsCount = 0;
    const mainPath = this.findMainPath(cells, width, height);
    const pathIndex = new Map<string, number>();
    mainPath.forEach((p, i) => pathIndex.set(`${p.x},${p.z}`, i));

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[z][x];
        if (cell.isStart || cell.isGoal) continue;

        const openWallsCount = (cell.walls.top ? 0 : 1) +
          (cell.walls.right ? 0 : 1) +
          (cell.walls.bottom ? 0 : 1) +
          (cell.walls.left ? 0 : 1);

        if (openWallsCount === 1) {
          cell.hasCoin = true;
          coinsCount++;
        } else if (prng.next() < holeProb) {
          cell.isHole = true;
          cell.holeConfig = this.generateHoleConfig(prng);
          holesCount++;
        } else if (prng.next() < 0.25) {
          cell.hasCoin = true;
          coinsCount++;
        }
      }
    }

    // Place gates on main path (not start/goal) with coin accessibility check
    const gateDifficultyCounts = { easy: 1, medium: 2, hard: 3 };
    const gateDifficultyCosts = { easy: 3, medium: 5, hard: 8 };
    const gateCount = gateDifficultyCounts[difficulty];
    const gateCost = gateDifficultyCosts[difficulty];

    // Ensure gates are placed where player has enough coins
    for (let i = 0; i < gateCount; i++) {
      const candidateIdx = Math.floor(prng.next() * (mainPath.length - 4)) + 2;
      const cell = cells[mainPath[candidateIdx].z][mainPath[candidateIdx].x];
      
      // Check if path to gate has enough coins
      const pathToGate = mainPath.slice(0, candidateIdx + 1);
      let coinCount = 0;
      for (const p of pathToGate) {
        if (cells[p.z][p.x].hasCoin) coinCount++;
      }
      
      if (!cell.isHole && !cell.hasCoin && !cell.isBridge && coinCount >= gateCost) {
        cell.isGate = true;
        cell.gateCost = gateCost;
        gatesCount++;
      }
    }

     // Place 3 checkpoints at 40%, 60%, 80% of main path length
     const checkpointPosValues = [0.4, 0.6, 0.8];
     for (const pos of checkpointPosValues) {
       const idx = Math.floor(pos * mainPath.length);
       const cell = cells[mainPath[idx].z][mainPath[idx].x];
       if (!cell.isHole && !cell.hasCoin && !cell.isBridge && !cell.isGate && !cell.isCheckpoint) {
         cell.isCheckpoint = true;
         checkpointsCount++;
       }
     }

    this.placeBridges(cells, width, height, difficulty, prng);

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[z][x];
        cell.hasGuardrail = {
          top: cell.walls.top,
          right: cell.walls.right,
          bottom: cell.walls.bottom,
          left: cell.walls.left
        };

        if (difficulty === 'hard' && !cell.isHole && !cell.isBridge) {
          if (prng.next() < 0.2) cell.hasGuardrail.top = false;
          if (prng.next() < 0.2) cell.hasGuardrail.right = false;
          if (prng.next() < 0.2) cell.hasGuardrail.bottom = false;
          if (prng.next() < 0.2) cell.hasGuardrail.left = false;
        }
      }
    }

     // Debug logging for all maze elements
     console.log(`[MAZE DEBUG] Generated maze ${width}x${height}, seed: ${seedStr}, difficulty: ${difficulty}`);
     console.log(`[MAZE DEBUG] Main path length: ${mainPath.length}`);
     console.log(`[MAZE DEBUG] Elements: ${holesCount} holes, ${coinsCount} coins, ${gatesCount} gates, ${checkpointsCount} checkpoints`);

     // Log all gates with positions
     const gatePositions = [];
     for (let z = 0; z < height; z++) {
       for (let x = 0; x < width; x++) {
         if (cells[z][x].isGate) {
           gatePositions.push(`(${x},${z})`);
         }
       }
     }
     console.log(`[MAZE DEBUG] Gates at: ${gatePositions.join(', ') || 'none'}`);

     // Log all checkpoints with positions
     const checkpointLocs = [];
     for (let z = 0; z < height; z++) {
       for (let x = 0; x < width; x++) {
         if (cells[z][x].isCheckpoint) {
           checkpointLocs.push(`(${x},${z})`);
         }
       }
     }
     console.log(`[MAZE DEBUG] Checkpoints at: ${checkpointLocs.join(', ') || 'none'}`);

     // Log all holes with types and positions
     const roundHoles = [];
     const squareHoles = [];
     const movingHoles = [];
     for (let z = 0; z < height; z++) {
       for (let x = 0; x < width; x++) {
         if (cells[z][x].isHole) {
           const config = cells[z][x].holeConfig;
           if (config?.shape === 'round') {
             roundHoles.push(`(${x},${z})${config.movePattern !== 'static' ? ' moving' : ''}`);
           } else {
             squareHoles.push(`(${x},${z})${config?.movePattern !== 'static' ? ' moving' : ''}`);
           }
            if (config?.movePattern !== 'static') {
              movingHoles.push(`(${x},${z}) ${config?.shape || 'unknown'} ${config?.movePattern || 'unknown'}`);
            }
         }
       }
     }
     console.log(`[MAZE DEBUG] Round holes: ${roundHoles.join(', ') || 'none'}`);
     console.log(`[MAZE DEBUG] Square holes: ${squareHoles.join(', ') || 'none'}`);
     console.log(`[MAZE DEBUG] Moving holes: ${movingHoles.join(', ') || 'none'}`);

     // Log all bridges with positions
     const bridgePositions = [];
     for (let z = 0; z < height; z++) {
       for (let x = 0; x < width; x++) {
         if (cells[z][x].isBridge) {
           bridgePositions.push(`(${x},${z}) ${cells[z][x].bridgeConfig?.lane || 'unknown'}`);
         }
       }
     }
     console.log(`[MAZE DEBUG] Bridges at: ${bridgePositions.join(', ') || 'none'}`);

     // Log wall statistics
     let totalWalls = 0;
     let cellsWithWalls = 0;
     for (let z = 0; z < height; z++) {
       for (let x = 0; x < width; x++) {
         const cell = cells[z][x];
         const wallCount = (cell.walls.top ? 1 : 0) + (cell.walls.right ? 1 : 0) + 
                          (cell.walls.bottom ? 1 : 0) + (cell.walls.left ? 1 : 0);
         totalWalls += wallCount;
         if (wallCount > 0) cellsWithWalls++;
       }
     }
     const avgWallsPerCell = (totalWalls / (width * height)).toFixed(2);
     console.log(`[MAZE DEBUG] Walls: ${totalWalls} total, ${avgWallsPerCell} avg per cell, ${cellsWithWalls}/${width*height} cells have walls`);

     return {
       width,
       height,
       cellSize,
       seed: seedStr,
       difficulty,
       theme,
       cells,
       startCell,
       goalCell,
       mainPath: mainPath,
       holesCount,
       coinsCount,
       gatesCount,
       checkpointsCount
     };
  }

  private static getDefaultTerrainForTheme(theme: MazeTheme): TerrainType {
    switch (theme) {
      case 'winter':
        return 'snow';
      case 'city':
        return 'asphalt';
      case 'forest':
        return 'grass';
    }
  }

  private static generateHoleConfig(prng: SeededRandom): HoleConfig {
    const shape: HoleShape = prng.next() < 0.4 ? 'round' : 'square';

    const roundRadii = [0.35, 0.48, 0.62];
    const squareSizes = [0.7, 0.95, 1.25];

    let radius = 0;
    let size = 0;

    if (shape === 'round') {
      radius = prng.choice(roundRadii);
    } else {
      size = prng.choice(squareSizes);
    }

    // Offsets: center (0,0), corners (±, ±), sides (±, 0) or (0, ±)
    const positionTypes = ['center', 'corner', 'side'];
    const posType = prng.choice(positionTypes);

    let offsetX = 0;
    let offsetZ = 0;

    const halfExtent = shape === 'round' ? radius : size / 2;
    const maxOffset = 0.6 - halfExtent * 0.4;

    if (posType === 'corner') {
      offsetX = (prng.next() < 0.5 ? 1 : -1) * maxOffset;
      offsetZ = (prng.next() < 0.5 ? 1 : -1) * maxOffset;
    } else if (posType === 'side') {
      if (prng.next() < 0.5) {
        offsetX = (prng.next() < 0.5 ? 1 : -1) * maxOffset;
      } else {
        offsetZ = (prng.next() < 0.5 ? 1 : -1) * maxOffset;
      }
    }

    // Movement: ~40% of holes move
    const movePatterns: HoleMovePattern[] = ['static', 'static', 'static', 'horizontal', 'vertical', 'circular'];
    const movePattern: HoleMovePattern = prng.choice(movePatterns);
    const moveSpeed = movePattern === 'static' ? 0 : 0.3 + prng.next() * 0.5;
    const moveRange = movePattern === 'static' ? 0 : 0.25 + prng.next() * 0.35;

    return { shape, radius, size, offsetX, offsetZ, movePattern, moveSpeed, moveRange };
  }

  private static findMainPath(
    cells: MazeCell[][],
    width: number,
    height: number
  ): { x: number; z: number }[] {
    const start = { x: 0, z: 0 };
    const goal = { x: width - 1, z: height - 1 };

    const parent = new Map<string, { x: number; z: number }>();
    const visited = new Set<string>();
    const queue: { x: number; z: number }[] = [{ x: 0, z: 0 }];
    visited.add('0,0');

    const dirs = [
      { dx: 0, dz: -1, wall: 'top' as const },
      { dx: 1, dz: 0, wall: 'right' as const },
      { dx: 0, dz: 1, wall: 'bottom' as const },
      { dx: -1, dz: 0, wall: 'left' as const },
    ];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.x === goal.x && cur.z === goal.z) break;

      for (const d of dirs) {
        const nx = cur.x + d.dx;
        const nz = cur.z + d.dz;
        const key = `${nx},${nz}`;
        if (nx >= 0 && nx < width && nz >= 0 && nz < height && !visited.has(key)) {
          if (!cells[cur.z][cur.x].walls[d.wall]) {
            visited.add(key);
            parent.set(key, cur);
            queue.push({ x: nx, z: nz });
          }
        }
      }
    }

    const path: { x: number; z: number }[] = [];
    let cur = goal;
    const goalKey = `${goal.x},${goal.z}`;
    if (!parent.has(goalKey)) return path;
    while (cur.x !== start.x || cur.z !== start.z) {
      path.unshift({ ...cur });
      const p = parent.get(`${cur.x},${cur.z}`);
      if (!p) break;
      cur = p;
    }
    path.unshift({ ...start });
    return path;
  }

  private static placeBridges(
    cells: MazeCell[][],
    width: number,
    height: number,
    difficulty: Difficulty,
    prng: SeededRandom
  ): void {
    if (difficulty === 'easy') return;
    const bridgeProb = difficulty === 'medium' ? 0.05 : 0.10;

    const mainPath = this.findMainPath(cells, width, height);
    const eligible = mainPath.slice(2, -2);

    const key = (p: { x: number; z: number }) => `${p.x},${p.z}`;
    const pathIndex = new Map<string, number>();
    mainPath.forEach((p, i) => pathIndex.set(key(p), i));

    for (const cell of eligible) {
      const c = cells[cell.z][cell.x];
      if (c.isHole || c.hasCoin) continue;
      if (prng.next() >= bridgeProb) continue;

      const idx = pathIndex.get(key(cell))!;
      const prev = mainPath[idx - 1];
      const next = mainPath[idx + 1];
      if (!prev || !next) continue;

      const entryDir =
        prev.x < cell.x ? 'left' :
        prev.x > cell.x ? 'right' :
        prev.z < cell.z ? 'top' : 'bottom';

      const exitDir =
        next.x > cell.x ? 'right' :
        next.x < cell.x ? 'left' :
        next.z > cell.z ? 'bottom' : 'top';

      // Only place bridge when path goes straight through this cell
      const opp: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
      if (exitDir !== opp[entryDir]) continue;

      const axis = (entryDir === 'top' || entryDir === 'bottom') ? 'z' : 'x';
      const lanes: ('left' | 'center' | 'right')[] = ['left', 'center', 'right'];

      c.isBridge = true;
      c.bridgeConfig = { lane: prng.choice(lanes), axis };
    }
  }

  private static getUnvisitedNeighbors(
    x: number,
    z: number,
    width: number,
    height: number,
    cells: MazeCell[][]
  ): { x: number; z: number }[] {
    const neighbors: { x: number; z: number }[] = [];
    if (z > 0 && !cells[z - 1][x].visited) neighbors.push({ x, z: z - 1 });
    if (x < width - 1 && !cells[z][x + 1].visited) neighbors.push({ x: x + 1, z });
    if (z < height - 1 && !cells[z + 1][x].visited) neighbors.push({ x, z: z + 1 });
    if (x > 0 && !cells[z][x - 1].visited) neighbors.push({ x: x - 1, z });
    return neighbors;
  }

  private static removeWallsBetween(a: MazeCell, b: MazeCell) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;

    if (dx === 1) {
      a.walls.right = false;
      b.walls.left = false;
    } else if (dx === -1) {
      a.walls.left = false;
      b.walls.right = false;
    } else if (dz === 1) {
      a.walls.bottom = false;
      b.walls.top = false;
    } else if (dz === -1) {
      a.walls.top = false;
      b.walls.bottom = false;
    }
  }

  private static assignOrganicTerrains(
    cells: MazeCell[][],
    width: number,
    height: number,
    difficulty: Difficulty,
    theme: MazeTheme,
    prng: SeededRandom
  ) {
    // Generate cluster seeds for secondary and tertiary terrains based on theme
    let secondaryTerrain: TerrainType = 'ice';
    let tertiaryTerrain: TerrainType = 'asphalt';

    if (theme === 'winter') {
      secondaryTerrain = 'ice';
      tertiaryTerrain = 'asphalt';
    } else if (theme === 'city') {
      secondaryTerrain = 'dirt';
      tertiaryTerrain = 'cobblestone';
    } else if (theme === 'forest') {
      secondaryTerrain = 'dirt';
      tertiaryTerrain = 'asphalt';
    }

    const numSecSeeds = Math.max(1, Math.floor((width * height) / 10));
    const numTertSeeds = Math.max(1, Math.floor((width * height) / 12));

    const secSeeds: { x: number; z: number }[] = [];
    const tertSeeds: { x: number; z: number }[] = [];

    for (let i = 0; i < numSecSeeds; i++) {
      secSeeds.push({ x: prng.nextInt(0, width - 1), z: prng.nextInt(0, height - 1) });
    }
    for (let i = 0; i < numTertSeeds; i++) {
      tertSeeds.push({ x: prng.nextInt(0, width - 1), z: prng.nextInt(0, height - 1) });
    }

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[z][x];
        if (cell.isStart || cell.isGoal) {
          cell.terrain = this.getDefaultTerrainForTheme(theme);
          continue;
        }

        let minSecDist = Infinity;
        let minTertDist = Infinity;

        secSeeds.forEach((s) => {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < minSecDist) minSecDist = d;
        });

        tertSeeds.forEach((s) => {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < minTertDist) minTertDist = d;
        });

        const secRadius = difficulty === 'hard' ? 3.5 : 2.4;
        const tertRadius = 2.2;

        if (minSecDist < secRadius && minSecDist <= minTertDist) {
          cell.terrain = secondaryTerrain;
        } else if (minTertDist < tertRadius) {
          cell.terrain = tertiaryTerrain;
        } else {
          cell.terrain = this.getDefaultTerrainForTheme(theme);
        }
      }
    }
  }
}

