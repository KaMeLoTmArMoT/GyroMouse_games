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
  isGoal: boolean;
  isStart: boolean;
  hasCoin: boolean;
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
  holesCount: number;
  coinsCount: number;
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
          isGoal: false,
          isStart: false,
          hasCoin: false,
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

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[z][x];
        cell.hasGuardrail = {
          top: cell.walls.top,
          right: cell.walls.right,
          bottom: cell.walls.bottom,
          left: cell.walls.left
        };

        if (difficulty === 'hard' && !cell.isHole) {
          if (prng.next() < 0.2) cell.hasGuardrail.top = false;
          if (prng.next() < 0.2) cell.hasGuardrail.right = false;
          if (prng.next() < 0.2) cell.hasGuardrail.bottom = false;
          if (prng.next() < 0.2) cell.hasGuardrail.left = false;
        }
      }
    }

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
      holesCount,
      coinsCount
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

