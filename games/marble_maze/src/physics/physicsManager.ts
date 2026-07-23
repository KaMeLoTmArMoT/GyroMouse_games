import RAPIER from '@dimforge/rapier3d-compat';
import { MazeData, TerrainType, HoleShape, HoleMovePattern, gateBlockDirection } from '../maze/mazeGenerator';

export interface PhysicsCallbacks {
  onCollectCoin: (x: number, z: number, coinId: string) => void;
  onFallInHole: () => void;
  onReachGoal: () => void;
  onHitWall: (impactVelocity: number) => void;
  onActivateGate: (gateId: string) => void;
  onActivateCheckpoint: (checkpointId: string) => void;
}

export class PhysicsManager {
  public world!: RAPIER.World;
  public marbleBody!: RAPIER.RigidBody;
  public marbleCollider!: RAPIER.Collider;

  private coinSensors: Map<string, RAPIER.Collider> = new Map();
  private holeSensors: RAPIER.Collider[] = [];
  private goalSensor: RAPIER.Collider | null = null;
  public gateSensors: Map<string, { sensor: RAPIER.Collider, blocker: RAPIER.Collider, cooldown: number }> = new Map();
  public checkpointSensors: Map<string, { sensor: RAPIER.Collider, position: { x: number, y: number, z: number } }> = new Map();

  private isInitialized: boolean = false;
  private callbacks?: PhysicsCallbacks;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    await RAPIER.init();
    this.isInitialized = true;
  }

  private holeDataList: { x: number; z: number; radius: number; sensor: RAPIER.Collider }[] = [];
  public gateCosts: Map<string, number> = new Map();

  private movingHoles: {
    sensor: RAPIER.Collider;
    baseX: number;
    baseZ: number;
    pattern: HoleMovePattern;
    speed: number;
    range: number;
    elapsed: number;
    radius: number;
    isSquare: boolean;
    cellCenterX: number;
    cellCenterZ: number;
    halfCell: number;
    friction: number;
    restitution: number;
    body: RAPIER.RigidBody;
    topSlab: RAPIER.Collider;
    botSlab: RAPIER.Collider;
    leftSlab: RAPIER.Collider;
    rightSlab: RAPIER.Collider;
  }[] = [];

  public buildMazePhysics(maze: MazeData, callbacks: PhysicsCallbacks): {
    startPos: { x: number; y: number; z: number };
    goalPos: { x: number; y: number; z: number };
  } {
    this.callbacks = callbacks;
    this.coinSensors.clear();
    this.holeSensors = [];
    this.holeDataList = [];
    this.movingHoles = [];
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

        if (cell.isBridge) {
          const cfg = cell.bridgeConfig!;
          const bridgeWidth = cellSize / 3;
          const halfBridge = bridgeWidth / 2;
          const isZ = cfg.axis === 'z';

          const holes: { offset: number; halfW: number }[] = [];
          let bridgeOff: number;

          switch (cfg.lane) {
            case 'left':
              bridgeOff = -halfCell + halfBridge;
              holes.push({ offset: halfBridge, halfW: halfCell - halfBridge });
              break;
            case 'center':
              bridgeOff = 0;
              holes.push({ offset: -halfCell + halfBridge, halfW: halfBridge });
              holes.push({ offset: halfCell - halfBridge, halfW: halfBridge });
              break;
            case 'right':
              bridgeOff = halfCell - halfBridge;
              holes.push({ offset: -halfBridge, halfW: halfCell - halfBridge });
              break;
          }

          if (isZ) {
            const holeZ = halfCell * 0.95;
            const bDesc = RAPIER.ColliderDesc.cuboid(halfBridge * 0.9, 0.4, holeZ)
              .setTranslation(cellCenterX + bridgeOff, -0.4, cellCenterZ)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(bDesc, boardBody);

            for (const h of holes) {
              const sDesc = RAPIER.ColliderDesc.cuboid(h.halfW * 0.9, 0.2, holeZ)
                .setTranslation(cellCenterX + h.offset, -0.2, cellCenterZ)
                .setSensor(true)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
              this.holeSensors.push(this.world.createCollider(sDesc, boardBody));
            }
          } else {
            const holeX = halfCell * 0.95;
            const bDesc = RAPIER.ColliderDesc.cuboid(holeX, 0.4, halfBridge * 0.9)
              .setTranslation(cellCenterX, -0.4, cellCenterZ + bridgeOff)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(bDesc, boardBody);

            for (const h of holes) {
              const sDesc = RAPIER.ColliderDesc.cuboid(holeX, 0.2, h.halfW * 0.9)
                .setTranslation(cellCenterX, -0.2, cellCenterZ + h.offset)
                .setSensor(true)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
              this.holeSensors.push(this.world.createCollider(sDesc, boardBody));
            }
          }
        } else if (cell.isHole) {
          const defaultCfg = { shape: 'round' as HoleShape, radius: 0.5, size: 0, offsetX: 0, offsetZ: 0, movePattern: 'static' as HoleMovePattern, moveSpeed: 0, moveRange: 0 };
          const cfg = cell.holeConfig || defaultCfg;
          const holeWorldX = cellCenterX + cfg.offsetX;
          const holeWorldZ = cellCenterZ + cfg.offsetZ;
          const isSquare = cfg.shape === 'square';
          const halfExtent = isSquare ? cfg.size / 2 : cfg.radius;
          const isMoving = cfg.movePattern !== 'static';

          if (isMoving) {
            // Moving hole: create initial edge slabs that perfectly track the hole position
            const hMinX = holeWorldX - halfExtent;
            const hMaxX = holeWorldX + halfExtent;
            const hMinZ = holeWorldZ - halfExtent;
            const hMaxZ = holeWorldZ + halfExtent;
            const minX = cellCenterX - halfCell;
            const maxX = cellCenterX + halfCell;
            const minZ = cellCenterZ - halfCell;
            const maxZ = cellCenterZ + halfCell;

            const topD = Math.max(0.01, (hMinZ - minZ) / 2);
            const topSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, topD)
              .setTranslation(cellCenterX, -0.4, minZ + topD)
              .setFriction(friction).setRestitution(restitution);
            const topSlab = this.world.createCollider(topSlabDesc, boardBody);

            const botD = Math.max(0.01, (maxZ - hMaxZ) / 2);
            const botSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, botD)
              .setTranslation(cellCenterX, -0.4, hMaxZ + botD)
              .setFriction(friction).setRestitution(restitution);
            const botSlab = this.world.createCollider(botSlabDesc, boardBody);

            const leftW = Math.max(0.01, (hMinX - minX) / 2);
            const leftSlabDesc = RAPIER.ColliderDesc.cuboid(leftW, 0.4, halfExtent)
              .setTranslation(minX + leftW, -0.4, holeWorldZ)
              .setFriction(friction).setRestitution(restitution);
            const leftSlab = this.world.createCollider(leftSlabDesc, boardBody);

            const rightW = Math.max(0.01, (maxX - hMaxX) / 2);
            const rightSlabDesc = RAPIER.ColliderDesc.cuboid(rightW, 0.4, halfExtent)
              .setTranslation(hMaxX + rightW, -0.4, holeWorldZ)
              .setFriction(friction).setRestitution(restitution);
            const rightSlab = this.world.createCollider(rightSlabDesc, boardBody);

            let sensorDesc: RAPIER.ColliderDesc;
            if (isSquare) {
              sensorDesc = RAPIER.ColliderDesc.cuboid(halfExtent * 0.9, 0.2, halfExtent * 0.9)
                .setTranslation(holeWorldX, -0.2, holeWorldZ);
            } else {
              sensorDesc = RAPIER.ColliderDesc.cylinder(0.2, halfExtent * 0.9)
                .setTranslation(holeWorldX, -0.2, holeWorldZ);
            }
            sensorDesc.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const sensor = this.world.createCollider(sensorDesc, boardBody);
            this.holeSensors.push(sensor);
            this.holeDataList.push({ x: holeWorldX, z: holeWorldZ, radius: halfExtent, sensor });
            this.movingHoles.push({
              sensor,
              baseX: holeWorldX,
              baseZ: holeWorldZ,
              pattern: cfg.movePattern,
              speed: cfg.moveSpeed,
              range: cfg.moveRange,
              elapsed: 0,
              radius: halfExtent,
              isSquare,
              cellCenterX,
              cellCenterZ,
              halfCell,
              friction,
              restitution,
              body: boardBody,
              topSlab,
              botSlab,
              leftSlab,
              rightSlab
            });
          } else {
            // Static hole: sensor below floor + 4 floor slabs around the gap
            let holeSensorDesc: RAPIER.ColliderDesc;
            if (isSquare) {
              const s = halfExtent * 0.9;
              holeSensorDesc = RAPIER.ColliderDesc.cuboid(s, 0.2, s)
                .setTranslation(holeWorldX, -0.2, holeWorldZ);
            } else {
              holeSensorDesc = RAPIER.ColliderDesc.cylinder(0.2, halfExtent * 0.9)
                .setTranslation(holeWorldX, -0.2, holeWorldZ);
            }
            holeSensorDesc
              .setSensor(true)
              .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

            const sensor = this.world.createCollider(holeSensorDesc, boardBody);
            this.holeSensors.push(sensor);
            this.holeDataList.push({ x: holeWorldX, z: holeWorldZ, radius: halfExtent, sensor });

            // Build surrounding floor colliders safely avoiding the off-center hole area
            const r = halfExtent;
            const offX = cfg.offsetX;
            const offZ = cfg.offsetZ;

            const topRimH = Math.max(0.05, halfCell + offZ - r);
            const botRimH = Math.max(0.05, halfCell - offZ - r);
            const leftRimW = Math.max(0.05, halfCell + offX - r);
            const rightRimW = Math.max(0.05, halfCell - offX - r);

            const topSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, topRimH / 2)
              .setTranslation(cellCenterX, -0.4, cellCenterZ - halfCell + topRimH / 2)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(topSlabDesc, boardBody);

            const botSlabDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, botRimH / 2)
              .setTranslation(cellCenterX, -0.4, cellCenterZ + halfCell - botRimH / 2)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(botSlabDesc, boardBody);

            const leftSlabDesc = RAPIER.ColliderDesc.cuboid(leftRimW / 2, 0.4, r)
              .setTranslation(cellCenterX - halfCell + leftRimW / 2, -0.4, holeWorldZ)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(leftSlabDesc, boardBody);

            const rightSlabDesc = RAPIER.ColliderDesc.cuboid(rightRimW / 2, 0.4, r)
              .setTranslation(cellCenterX + halfCell - rightRimW / 2, -0.4, holeWorldZ)
              .setFriction(friction).setRestitution(restitution);
            this.world.createCollider(rightSlabDesc, boardBody);
          }
        } else {
          const floorDesc = RAPIER.ColliderDesc.cuboid(halfCell, 0.4, halfCell)
            .setTranslation(cellCenterX, -0.4, cellCenterZ)
            .setFriction(friction)
            .setRestitution(restitution);

          this.world.createCollider(floorDesc, boardBody);
        }

        if (cell.hasCoin && !cell.isHole && !cell.isBridge) {
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

       // Build gates
       for (let z = 0; z < maze.height; z++) {
         for (let x = 0; x < maze.width; x++) {
           const cell = maze.cells[z][x];
           if (cell.isGate) {
             const gateId = `gate_${x}_${z}`;
             const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
             const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;

             // Sensor collider (triggers activation) - covers center area
             const sensorDesc = RAPIER.ColliderDesc.cuboid(0.4, 0.5, 0.4)
               .setTranslation(cellCenterX, 0.2, cellCenterZ)
               .setSensor(true)
               .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
             const sensor = this.world.createCollider(sensorDesc, boardBody);

              // Blocker collider — placed on the wall side blocking forward path exit
              const blockDir = gateBlockDirection(x, z, maze.mainPath);
              const blockerDesc = (blockDir === 'top' || blockDir === 'bottom')
                ? RAPIER.ColliderDesc.cuboid(halfCell, wallHalfHeight, wallHalfThick)
                    .setTranslation(cellCenterX, wallHalfHeight,
                      blockDir === 'top' ? cellCenterZ - halfCell : cellCenterZ + halfCell)
                : RAPIER.ColliderDesc.cuboid(wallHalfThick, wallHalfHeight, halfCell)
                    .setTranslation(cellCenterX + (blockDir === 'left' ? -halfCell : halfCell),
                      wallHalfHeight, cellCenterZ);
              const blocker = this.world.createCollider(blockerDesc, boardBody);

             this.gateSensors.set(gateId, { sensor, blocker, cooldown: 0 });
             this.gateCosts.set(gateId, cell.gateCost || 5);
           }
         }
       }

      // Build checkpoints
      for (let z = 0; z < maze.height; z++) {
        for (let x = 0; x < maze.width; x++) {
          const cell = maze.cells[z][x];
          if (cell.isCheckpoint) {
            const checkpointId = `checkpoint_${x}_${z}`;
            const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
            const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;

            const sensorDesc = RAPIER.ColliderDesc.cuboid(0.4, 0.5, 0.4)
              .setTranslation(cellCenterX, 0.2, cellCenterZ)
              .setSensor(true)
              .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const sensor = this.world.createCollider(sensorDesc, boardBody);

            this.checkpointSensors.set(checkpointId, {
              sensor,
              position: { x: cellCenterX, y: 0.5, z: cellCenterZ }
            });
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

  private isMarbleInsideGate(gate: { sensor: RAPIER.Collider, blocker: RAPIER.Collider, cooldown: number }): boolean {
    const marblePos = this.marbleBody.translation();
    const blockerPos = gate.blocker.translation();
    const distance = Math.hypot(
      marblePos.x - blockerPos.x,
      marblePos.y - blockerPos.y,
      marblePos.z - blockerPos.z
    );
    return distance < 0.5; // Within 0.5 units of blocker
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

  public updateMovingHoles(dt: number) {
    for (const mh of this.movingHoles) {
      mh.elapsed += dt;
      let dx = 0;
      let dz = 0;
      const t = mh.elapsed * mh.speed;

      switch (mh.pattern) {
        case 'horizontal':
          dx = Math.sin(t) * mh.range;
          break;
        case 'vertical':
          dz = Math.sin(t) * mh.range;
          break;
        case 'circular':
          dx = Math.cos(t) * mh.range;
          dz = Math.sin(t) * mh.range;
          break;
      }

      const holeX = mh.baseX + dx;
      const holeZ = mh.baseZ + dz;
      mh.sensor.setTranslation({ x: holeX, y: -0.2, z: holeZ });

      // Update the 4 dynamic floor slabs to tightly frame the moving hole
      const r = mh.radius;
      const hMinX = holeX - r;
      const hMaxX = holeX + r;
      const hMinZ = holeZ - r;
      const hMaxZ = holeZ + r;
      
      const cX = mh.cellCenterX;
      const cZ = mh.cellCenterZ;
      const hC = mh.halfCell;
      const minX = cX - hC;
      const maxX = cX + hC;
      const minZ = cZ - hC;
      const maxZ = cZ + hC;

      // Destroy old slabs
      this.world.removeCollider(mh.topSlab, false);
      this.world.removeCollider(mh.botSlab, false);
      this.world.removeCollider(mh.leftSlab, false);
      this.world.removeCollider(mh.rightSlab, false);

      // Recreate them with updated dimensions/positions
      const topD = Math.max(0.01, (hMinZ - minZ) / 2);
      const topDesc = RAPIER.ColliderDesc.cuboid(hC, 0.4, topD)
        .setTranslation(cX, -0.4, minZ + topD)
        .setFriction(mh.friction).setRestitution(mh.restitution);
      mh.topSlab = this.world.createCollider(topDesc, mh.body);

      const botD = Math.max(0.01, (maxZ - hMaxZ) / 2);
      const botDesc = RAPIER.ColliderDesc.cuboid(hC, 0.4, botD)
        .setTranslation(cX, -0.4, hMaxZ + botD)
        .setFriction(mh.friction).setRestitution(mh.restitution);
      mh.botSlab = this.world.createCollider(botDesc, mh.body);

      const leftW = Math.max(0.01, (hMinX - minX) / 2);
      const leftDesc = RAPIER.ColliderDesc.cuboid(leftW, 0.4, r)
        .setTranslation(minX + leftW, -0.4, holeZ)
        .setFriction(mh.friction).setRestitution(mh.restitution);
      mh.leftSlab = this.world.createCollider(leftDesc, mh.body);

      const rightW = Math.max(0.01, (maxX - hMaxX) / 2);
      const rightDesc = RAPIER.ColliderDesc.cuboid(rightW, 0.4, r)
        .setTranslation(hMaxX + rightW, -0.4, holeZ)
        .setFriction(mh.friction).setRestitution(mh.restitution);
      mh.rightSlab = this.world.createCollider(rightDesc, mh.body);
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
      // Trigger loss ONLY when marble physically drops below floor level (y < -0.35)
      if (translation.y < -0.35) {
        this.callbacks.onFallInHole();
      }

      if (this.goalSensor && this.world.intersectionPair(this.marbleCollider, this.goalSensor)) {
        this.callbacks.onReachGoal();
      }

      // Gate activation
      this.gateSensors.forEach((gate, gateId) => {
        if (gate.cooldown > 0) {
          gate.cooldown -= dt;
          if (gate.cooldown <= 0 && this.isMarbleInsideGate(gate)) {
            this.world.removeCollider(gate.blocker, false);
            this.gateSensors.delete(gateId);
          }
          return;
        }

        if (this.world.intersectionPair(this.marbleCollider, gate.sensor)) {
          if (this.callbacks?.onActivateGate) {
            this.callbacks.onActivateGate(gateId);
          }
          gate.cooldown = 1.0; // 1-second cooldown
        }
      });

      // Checkpoint activation
      this.checkpointSensors.forEach((checkpoint, checkpointId) => {
        if (this.world.intersectionPair(this.marbleCollider, checkpoint.sensor)) {
          if (this.callbacks?.onActivateCheckpoint) {
            this.callbacks.onActivateCheckpoint(checkpointId);
          }
        }
      });

      // Coin collection
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
