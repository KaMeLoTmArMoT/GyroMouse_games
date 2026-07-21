import RAPIER from '@dimforge/rapier3d-compat';
import { MazeData, TerrainType } from '../maze/mazeGenerator';

export interface PhysicsCallbacks {
  onCollectCoin: (x: number, z: number, coinId: string) => void;
  onFallInHole: () => void;
  onReachGoal: () => void;
  onHitWall: (impactVelocity: number) => void;
}

export class PhysicsManager {
  public world!: RAPIER.World;
  public marbleBody!: RAPIER.RigidBody;
  public marbleCollider!: RAPIER.Collider;

  private coinSensors: Map<string, RAPIER.Collider> = new Map();
  private holeSensors: RAPIER.Collider[] = [];
  private goalSensor: RAPIER.Collider | null = null;

  private isInitialized: boolean = false;
  private callbacks?: PhysicsCallbacks;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    await RAPIER.init();
    this.isInitialized = true;
  }

  private holeDataList: { x: number; z: number; radius: number; sensor: RAPIER.Collider }[] = [];

  public buildMazePhysics(maze: MazeData, callbacks: PhysicsCallbacks): {
    startPos: { x: number; y: number; z: number };
    goalPos: { x: number; y: number; z: number };
  } {
    this.callbacks = callbacks;
    this.coinSensors.clear();
    this.holeSensors = [];
    this.holeDataList = [];
    this.goalSensor = null;

    // 1. Clean Rapier world with initial downward gravity
    const gravity = { x: 0.0, y: -22.0, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // 2. Fixed board body (Static, completely immune to tunneling or catapulting!)
    const boardBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const boardBody = this.world.createRigidBody(boardBodyDesc);

    const cellSize = maze.cellSize;
    const halfCell = cellSize / 2;
    const wallThickness = 0.3;
    const wallHeight = 1.0;
    const wallHalfThick = wallThickness / 2;
    const wallHalfHeight = wallHeight / 2;

    const mazeWorldWidth = maze.width * cellSize;
    const mazeWorldHeight = maze.height * cellSize;

    const startX = maze.startCell.x * cellSize + halfCell - mazeWorldWidth / 2;
    const startZ = maze.startCell.z * cellSize + halfCell - mazeWorldHeight / 2;
    const startPos = { x: startX, y: 0.5, z: startZ };

    // 3. Dynamic Marble RigidBody
    const marbleRadius = 0.35;
    const marbleBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startPos.x, startPos.y, startPos.z)
      .setLinearDamping(0.3)
      .setAngularDamping(0.3)
      .setCcdEnabled(true)
      .setSleeping(false); // Never sleep: must always respond to gravity vector changes

    this.marbleBody = this.world.createRigidBody(marbleBodyDesc);

    const marbleColliderDesc = RAPIER.ColliderDesc.ball(marbleRadius)
      .setFriction(0.4)
      .setRestitution(0.15)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    this.marbleCollider = this.world.createCollider(marbleColliderDesc, this.marbleBody);

    // 4. Build Floor Tiles & Walls
    for (let z = 0; z < maze.height; z++) {
      for (let x = 0; x < maze.width; x++) {
        const cell = maze.cells[z][x];
        const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
        const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;
        const friction = this.getFrictionForTerrain(cell.terrain);
        const restitution = cell.terrain === 'ice' ? 0.05 : 0.15;

        if (cell.isHole) {
          const cfg = cell.holeConfig || { radius: 0.5, offsetX: 0, offsetZ: 0 };
          const holeWorldX = cellCenterX + cfg.offsetX;
          const holeWorldZ = cellCenterZ + cfg.offsetZ;

          // Hole sensor in exact position & radius
          const holeSensorDesc = RAPIER.ColliderDesc.cylinder(0.2, cfg.radius * 0.9)
            .setTranslation(holeWorldX, -0.2, holeWorldZ)
            .setSensor(true)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

          const sensor = this.world.createCollider(holeSensorDesc, boardBody);
          this.holeSensors.push(sensor);
          this.holeDataList.push({ x: holeWorldX, z: holeWorldZ, radius: cfg.radius, sensor });

          // Build surrounding floor colliders safely avoiding the off-center hole area
          const r = cfg.radius;
          const offX = cfg.offsetX;
          const offZ = cfg.offsetZ;

          // We build 4 surrounding slab boxes around the specific hole circle
          const topRimH = Math.max(0.05, halfCell + offZ - r);
          const botRimH = Math.max(0.05, halfCell - offZ - r);
          const leftRimW = Math.max(0.05, halfCell + offX - r);
          const rightRimW = Math.max(0.05, halfCell - offX - r);

          // Top slab
          const topSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, topRimH / 2)
            .setTranslation(cellCenterX, -0.4, cellCenterZ - halfCell + topRimH / 2)
            .setFriction(friction).setRestitution(restitution);
          this.world.createCollider(topSlabDesc, boardBody);

          // Bottom slab
          const botSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, botRimH / 2)
            .setTranslation(cellCenterX, -0.4, cellCenterZ + halfCell - botRimH / 2)
            .setFriction(friction).setRestitution(restitution);
          this.world.createCollider(botSlabDesc, boardBody);

          // Left slab
          const leftSlabDesc = RAPIER.ColliderDesc.cuboid(leftRimW / 2, 0.4, r)
            .setTranslation(cellCenterX - halfCell + leftRimW / 2, -0.4, holeWorldZ)
            .setFriction(friction).setRestitution(restitution);
          this.world.createCollider(leftSlabDesc, boardBody);

          // Right slab
          const rightSlabDesc = RAPIER.ColliderDesc.cuboid(rightRimW / 2, 0.4, r)
            .setTranslation(cellCenterX + halfCell - rightRimW / 2, -0.4, holeWorldZ)
            .setFriction(friction).setRestitution(restitution);
          this.world.createCollider(rightSlabDesc, boardBody);
        } else {
          const floorDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, halfCell)
            .setTranslation(cellCenterX, -0.4, cellCenterZ)
            .setFriction(friction)
            .setRestitution(restitution);

          this.world.createCollider(floorDesc, boardBody);
        }

        if (cell.hasCoin && !cell.isHole) {
          const coinId = `coin_${x}_${z}`;
          const coinSensorDesc = RAPIER.ColliderDesc.ball(0.4)
            .setTranslation(cellCenterX, 0.4, cellCenterZ)
            .setSensor(true)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

          const coinSensor = this.world.createCollider(coinSensorDesc, boardBody);
          this.coinSensors.set(coinId, coinSensor);
        }

        if (cell.isGoal) {
          const goalDesc = RAPIER.ColliderDesc.cuboid(halfCell * 0.8, 0.5, halfCell * 0.8)
            .setTranslation(cellCenterX, 0.1, cellCenterZ)
            .setSensor(true)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

          this.goalSensor = this.world.createCollider(goalDesc, boardBody);
        }

        const g = cell.hasGuardrail;

        if (g.top) {
          const wallDesc = RAPIER.ColliderDesc.cuboid(halfCell, wallHalfHeight, wallHalfThick)
            .setTranslation(cellCenterX, wallHalfHeight, cellCenterZ - halfCell)
            .setFriction(0.3);
          this.world.createCollider(wallDesc, boardBody);
        }
        if (g.bottom) {
          const wallDesc = RAPIER.ColliderDesc.cuboid(halfCell, wallHalfHeight, wallHalfThick)
            .setTranslation(cellCenterX, wallHalfHeight, cellCenterZ + halfCell)
            .setFriction(0.3);
          this.world.createCollider(wallDesc, boardBody);
        }
        if (g.left) {
          const wallDesc = RAPIER.ColliderDesc.cuboid(wallHalfThick, wallHalfHeight, halfCell)
            .setTranslation(cellCenterX - halfCell, wallHalfHeight, cellCenterZ)
            .setFriction(0.3);
          this.world.createCollider(wallDesc, boardBody);
        }
        if (g.right) {
          const wallDesc = RAPIER.ColliderDesc.cuboid(wallHalfThick, wallHalfHeight, halfCell)
            .setTranslation(cellCenterX + halfCell, wallHalfHeight, cellCenterZ)
            .setFriction(0.3);
          this.world.createCollider(wallDesc, boardBody);
        }
      }
    }

    const goalX = maze.goalCell.x * cellSize + halfCell - mazeWorldWidth / 2;
    const goalZ = maze.goalCell.z * cellSize + halfCell - mazeWorldHeight / 2;

    return {
      startPos,
      goalPos: { x: goalX, y: 0.2, z: goalZ }
    };
  }

  private getFrictionForTerrain(terrain: TerrainType): number {
    switch (terrain) {
      case 'dirt':
        return 0.95; // Muddy/heavy drag
      case 'grass':
        return 0.65; // Lush grass friction
      case 'sand':
        return 0.90;
      case 'ice':
        return 0.03; // Extremely slippery
      case 'cobblestone':
        return 0.35;
      case 'snow':
        return 0.45;
      case 'asphalt':
      default:
        return 0.45;
    }
  }

  /**
   * Rotates gravity vector mathematically (Zero tunneling, zero catapulting!).
   */
  public updateBoardTilt(tiltXRad: number, tiltZRad: number) {
    const baseG = 22.0;
    const gx = baseG * Math.sin(tiltZRad);
    const gz = baseG * Math.sin(tiltXRad);
    const gy = -baseG * Math.cos(tiltXRad) * Math.cos(tiltZRad);

    this.world.gravity = { x: gx, y: gy, z: gz };

    // Wake the marble if Rapier put it to sleep — sleeping bodies ignore gravity changes!
    if (this.marbleBody && this.marbleBody.isSleeping()) {
      this.marbleBody.wakeUp();
    }
  }

  public step(dt: number): {
    marblePos: { x: number; y: number; z: number };
    marbleVel: { x: number; y: number; z: number };
    speed: number;
  } {
    this.world.timestep = Math.min(dt, 0.033);
    this.world.step();

    const translation = this.marbleBody.translation();
    const linvel = this.marbleBody.linvel();
    const speed = Math.hypot(linvel.x, linvel.y, linvel.z);

    if (this.callbacks) {
      // Trigger loss ONLY when marble physically drops into the hole below floor level (y < -0.35)
      if (translation.y < -0.35) {
        this.callbacks.onFallInHole();
      }

      if (this.goalSensor && this.world.intersectionPair(this.marbleCollider, this.goalSensor)) {
        this.callbacks.onReachGoal();
      }

      this.coinSensors.forEach((sensor, coinId) => {
        if (this.world.intersectionPair(this.marbleCollider, sensor)) {
          const parts = coinId.split('_');
          const gridX = parseInt(parts[1], 10);
          const gridZ = parseInt(parts[2], 10);
          this.callbacks?.onCollectCoin(gridX, gridZ, coinId);
          this.world.removeCollider(sensor, false);
          this.coinSensors.delete(coinId);
        }
      });
    }

    return {
      marblePos: { x: translation.x, y: translation.y, z: translation.z },
      marbleVel: { x: linvel.x, y: linvel.y, z: linvel.z },
      speed
    };
  }

  public resetMarblePosition(x: number, y: number, z: number) {
    this.marbleBody.setTranslation({ x, y, z }, true);
    this.marbleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.marbleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
