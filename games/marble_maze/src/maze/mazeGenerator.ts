import { SeededRandom } from '../utils/seedrandom';

export type TerrainType = 'asphalt' | 'sand' | 'ice';

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
    cellSize: number = 3.0
  ): MazeData {
    const prng = new SeededRandom(seedStr);
    const cells: MazeCell[][] = [];

    for (let z = 0; z < height; z++) {
      cells[z] = [];
      for (let x = 0; x < width; x++) {
        cells[z][x] = {
          x,
          z,
          visited: false,
          walls: { top: true, right: true, bottom: true, left: true },
          terrain: 'asphalt',
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

    this.assignMixedTerrains(cells, width, height, difficulty, prng);

    let holesCount = 0;
    let coinsCount = 0;
    const holeProb = difficulty === 'easy' ? 0.04 : difficulty === 'medium' ? 0.09 : 0.16;

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
      cells,
      startCell,
      goalCell,
      holesCount,
      coinsCount
    };
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

  private static assignMixedTerrains(
    cells: MazeCell[][],
    width: number,
    height: number,
    difficulty: Difficulty,
    prng: SeededRandom
  ) {
    const numIceSeeds = Math.max(1, Math.floor((width * height) / 12));
    const numSandSeeds = Math.max(1, Math.floor((width * height) / 12));

    const iceSeeds: { x: number; z: number }[] = [];
    const sandSeeds: { x: number; z: number }[] = [];

    for (let i = 0; i < numIceSeeds; i++) {
      iceSeeds.push({ x: prng.nextInt(0, width - 1), z: prng.nextInt(0, height - 1) });
    }
    for (let i = 0; i < numSandSeeds; i++) {
      sandSeeds.push({ x: prng.nextInt(0, width - 1), z: prng.nextInt(0, height - 1) });
    }

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[z][x];
        if (cell.isStart || cell.isGoal) {
          cell.terrain = 'asphalt';
          continue;
        }

        let minIceDist = Infinity;
        let minSandDist = Infinity;

        iceSeeds.forEach((s) => {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < minIceDist) minIceDist = d;
        });

        sandSeeds.forEach((s) => {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < minSandDist) minSandDist = d;
        });

        const iceRadius = difficulty === 'hard' ? 3.5 : 2.2;
        const sandRadius = 2.5;

        if (minIceDist < iceRadius && minIceDist <= minSandDist) {
          cell.terrain = 'ice';
        } else if (minSandDist < sandRadius) {
          cell.terrain = 'sand';
        } else {
          cell.terrain = 'asphalt';
        }
      }
    }
  }
}
