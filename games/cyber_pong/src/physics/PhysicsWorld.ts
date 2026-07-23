import RAPIER from '@dimforge/rapier3d-compat';

export interface BrickData {
  id: string;
  side: 'p1' | 'p2';
  x: number;
  z: number;
  depth: number;
  collider: RAPIER.Collider;
  rigidBody: RAPIER.RigidBody;
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  public p1PaddleBody!: RAPIER.RigidBody;
  public p2PaddleBody!: RAPIER.RigidBody;
  public puckBody!: RAPIER.RigidBody;

  public bricks: Map<string, BrickData> = new Map();

  // Arena Dimensions
  public readonly courtWidth = 36;
  public readonly courtDepth = 20;
  public readonly paddleZLimit = 8.5;
  public readonly paddleXBoundary = 16.5;

  private onBrickDestroyCallback?: (id: string, side: 'p1' | 'p2') => void;
  private onGoalCallback?: (scoringSide: 'p1' | 'p2') => void;

  public static async create(
    onBrickDestroy: (id: string, side: 'p1' | 'p2') => void,
    onGoal: (scoringSide: 'p1' | 'p2') => void
  ): Promise<PhysicsWorld> {
    await RAPIER.init();
    const pw = new PhysicsWorld();
    pw.onBrickDestroyCallback = onBrickDestroy;
    pw.onGoalCallback = onGoal;
    pw.init();
    return pw;
  }

  private init() {
    const gravity = { x: 0.0, y: 0.0, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    this.setupArenaColliders();
    this.setupPaddles();
    this.setupPuck();
    this.setupCenterBricks();
  }

  private setupArenaColliders() {
    // Top & Bottom Bounce Walls (z = -10.3 and z = 10.3)
    const wallMaterial = { restitution: 1.0, friction: 0.0 };

    const topWallGeo = RAPIER.ColliderDesc.cuboid(18.4, 1, 0.3);
    const topWallBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.5, -10.3));
    this.world.createCollider(topWallGeo, topWallBody).setRestitution(wallMaterial.restitution);

    const botWallGeo = RAPIER.ColliderDesc.cuboid(18.4, 1, 0.3);
    const botWallBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.5, 10.3));
    this.world.createCollider(botWallGeo, botWallBody).setRestitution(wallMaterial.restitution);

    // Side Wall Flanks around Goal Zone (P1 Left Goal and P2 Right Goal)
    // Goal gap is z = -4 to z = 4. Flanks cover z = -10..-4 (center z=-7) and z = 4..10 (center z=7)
    const flankGeo = RAPIER.ColliderDesc.cuboid(0.3, 1, 3);

    const p1TopFlankBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-18.3, 0.5, -7));
    this.world.createCollider(flankGeo, p1TopFlankBody).setRestitution(wallMaterial.restitution);

    const p1BotFlankBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-18.3, 0.5, 7));
    this.world.createCollider(flankGeo, p1BotFlankBody).setRestitution(wallMaterial.restitution);

    const p2TopFlankBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(18.3, 0.5, -7));
    this.world.createCollider(flankGeo, p2TopFlankBody).setRestitution(wallMaterial.restitution);

    const p2BotFlankBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(18.3, 0.5, 7));
    this.world.createCollider(flankGeo, p2BotFlankBody).setRestitution(wallMaterial.restitution);
  }

  public p1Collider!: RAPIER.Collider;
  public p2Collider!: RAPIER.Collider;
  public puckCollider!: RAPIER.Collider;

  private lastPaddleHitTime: number = 0;
  private lastWallHitTime: number = 0;

  private setupPaddles() {
    // Line-like wider bar paddles (x-radius: 0.25, z-half: 1.6) locked in 2D plane (y = 0.4)
    const p1Desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-14, 0.4, 0);
    this.p1PaddleBody = this.world.createRigidBody(p1Desc);
    const paddleCol1 = RAPIER.ColliderDesc.cuboid(0.25, 0.4, 1.6).setRestitution(1.2).setFriction(0.0);
    this.p1Collider = this.world.createCollider(paddleCol1, this.p1PaddleBody);

    const p2Desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(14, 0.4, 0);
    this.p2PaddleBody = this.world.createRigidBody(p2Desc);
    const paddleCol2 = RAPIER.ColliderDesc.cuboid(0.25, 0.4, 1.6).setRestitution(1.2).setFriction(0.0);
    this.p2Collider = this.world.createCollider(paddleCol2, this.p2PaddleBody);
  }

  private setupPuck() {
    const puckDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.4, 0)
      .setLinearDamping(0.0)
      .setAngularDamping(0.0)
      .setCcdEnabled(true);
    this.puckBody = this.world.createRigidBody(puckDesc);
    this.puckBody.wakeUp();

    const puckCol = RAPIER.ColliderDesc.cylinder(0.2, 0.6)
      .setRestitution(1.0)
      .setFriction(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.puckCollider = this.world.createCollider(puckCol, this.puckBody);
  }

  public setupCenterBricks() {
    // Destroy existing bricks
    this.bricks.forEach((b) => this.world.removeRigidBody(b.rigidBody));
    this.bricks.clear();

    const countPerSide = 6;
    const brickDepth = 18 / countPerSide;

    // P1 Bricks at x = -2 (must be struck by P1 to break & grant paddle size)
    for (let i = 0; i < countPerSide; i++) {
      const z = -8 + i * brickDepth + brickDepth / 2;
      const id = `p1_brick_${i}`;
      this.createBrick(id, 'p1', -2, z, brickDepth);
    }

    // P2 Bricks at x = 2 (must be struck by P2 to break & grant paddle size)
    for (let i = 0; i < countPerSide; i++) {
      const z = -8 + i * brickDepth + brickDepth / 2;
      const id = `p2_brick_${i}`;
      this.createBrick(id, 'p2', 2, z, brickDepth);
    }
  }

  private createBrick(id: string, side: 'p1' | 'p2', x: number, z: number, depth: number) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.4, z);
    const body = this.world.createRigidBody(desc);
    const colDesc = RAPIER.ColliderDesc.cuboid(0.3, 0.4, depth / 2 - 0.1)
      .setRestitution(1.0)
      .setSensor(true) // Set as sensor initially so neutral puck passes through
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = this.world.createCollider(colDesc, body);

    this.bricks.set(id, { id, side, x, z, depth, collider: col, rigidBody: body });
  }

  public setPaddleScale(side: 'p1' | 'p2', scale: number) {
    const body = side === 'p1' ? this.p1PaddleBody : this.p2PaddleBody;
    const oldCol = side === 'p1' ? this.p1Collider : this.p2Collider;
    if (oldCol && body) {
      this.world.removeCollider(oldCol, false);
    }
    const newColDesc = RAPIER.ColliderDesc.cuboid(0.25, 0.4, 1.6 * scale)
      .setRestitution(1.2)
      .setFriction(0.0);
    const newCol = this.world.createCollider(newColDesc, body);
    if (side === 'p1') {
      this.p1Collider = newCol;
    } else {
      this.p2Collider = newCol;
    }
  }

  public removeBrick(id: string) {
    const b = this.bricks.get(id);
    if (b) {
      this.world.removeRigidBody(b.rigidBody);
      this.bricks.delete(id);
    }
  }

  public puckOwner: 'neutral' | 'p1' | 'p2' = 'neutral';
  public bounceCount: number = 0;
  public rallyTime: number = 0;
  private isPuckInEnemyTerritory: boolean = false;

  public servePuck(direction: 'left' | 'right', speedMultiplier = 1.0) {
    this.puckOwner = 'neutral';
    this.bounceCount = 0;
    this.rallyTime = 0;
    this.isPuckInEnemyTerritory = false;

    // Ensure all bricks are sensors while puck is neutral
    for (const b of this.bricks.values()) {
      b.collider.setSensor(true);
    }

    this.puckBody.setTranslation({ x: 0, y: 0.4, z: 0 }, true);
    this.puckBody.wakeUp();

    // 30% slower base speed (11.2 instead of 16)
    const baseSpeed = 11.2 * speedMultiplier;
    const angle = (Math.random() - 0.5) * (Math.PI / 4);
    const dirX = direction === 'left' ? -Math.cos(angle) : Math.cos(angle);
    const dirZ = Math.sin(angle);

    this.puckBody.setLinvel({ x: dirX * baseSpeed, y: 0, z: dirZ * baseSpeed }, true);
  }

  private setPuckOwner(owner: 'p1' | 'p2') {
    this.puckOwner = owner;
    this.bounceCount = 0; // Reset bounce counter on paddle hit
    this.isPuckInEnemyTerritory = false;

    for (const b of this.bricks.values()) {
      if (b.side === owner) {
        b.collider.setSensor(false);
      } else {
        b.collider.setSensor(true);
      }
    }
  }

  private resetPuckToNeutral() {
    this.puckOwner = 'neutral';
    this.bounceCount = 0;
    this.isPuckInEnemyTerritory = false;

    for (const b of this.bricks.values()) {
      b.collider.setSensor(true);
    }
  }

  public step(dt: number, isP1AllCleared: boolean, isP2AllCleared: boolean) {
    this.world.step();
    this.puckBody.wakeUp();
    this.rallyTime += dt;

    // Keep puck constrained to 2D playplane (y = 0.4)
    const puckPos = this.puckBody.translation();
    if (Math.abs(puckPos.y - 0.4) > 0.05) {
      this.puckBody.setTranslation({ x: puckPos.x, y: 0.4, z: puckPos.z }, true);
    }

    // Check enemy territory (+20% speed boost when blue ball is in red half or red ball is in blue half)
    const inEnemy = (this.puckOwner === 'p1' && puckPos.x > 0) || (this.puckOwner === 'p2' && puckPos.x < 0);
    if (inEnemy && !this.isPuckInEnemyTerritory) {
      this.isPuckInEnemyTerritory = true;
      const v = this.puckBody.linvel();
      this.puckBody.setLinvel({ x: v.x * 1.2, y: 0, z: v.z * 1.2 }, true);
    } else if (!inEnemy && this.isPuckInEnemyTerritory) {
      this.isPuckInEnemyTerritory = false;
      const v = this.puckBody.linvel();
      this.puckBody.setLinvel({ x: v.x / 1.2, y: 0, z: v.z / 1.2 }, true);
    }

    // Dynamic speed clamp & minimum velocity check (+20% speed on enemy half + rally time acceleration)
    const territoryMultiplier = inEnemy ? 1.2 : 1.0;
    const timeMultiplier = 1.0 + Math.min(0.8, this.rallyTime * 0.04); // Gradually speeds up over time
    const totalMultiplier = territoryMultiplier * timeMultiplier;

    const vel = this.puckBody.linvel();
    let speed = Math.hypot(vel.x, vel.z);
    const minSpeed = ((isP1AllCleared || isP2AllCleared) ? 16.8 : 11.2) * totalMultiplier;
    const maxSpeed = ((isP1AllCleared || isP2AllCleared) ? 25.2 : 18.2) * totalMultiplier;

    if (speed < minSpeed && speed > 0.1) {
      const scale = minSpeed / speed;
      this.puckBody.setLinvel({ x: vel.x * scale, y: 0, z: vel.z * scale }, true);
    } else if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      this.puckBody.setLinvel({ x: vel.x * scale, y: 0, z: vel.z * scale }, true);
    }

    // Check goal line triggers ONLY within the open goal net (x < -18.5 or x > 18.5 AND |z| <= 4.2)
    if (puckPos.x < -18.5 && Math.abs(puckPos.z) <= 4.2) {
      this.onGoalCallback?.('p2'); // P2 scores goal in P1 net
    } else if (puckPos.x > 18.5 && Math.abs(puckPos.z) <= 4.2) {
      this.onGoalCallback?.('p1'); // P1 scores goal in P2 net
    }

    // Process paddle & wall/brick collisions
    const now = performance.now();
    let hitPaddleThisFrame: 'p1' | 'p2' | null = null;
    const destroyedBrickIds: string[] = [];
    let hitWallThisFrame = false;

    this.world.contactPairsWith(this.puckCollider, (otherCollider) => {
      const handle = otherCollider.handle;
      if (handle === this.p1Collider.handle) {
        hitPaddleThisFrame = 'p1';
      } else if (handle === this.p2Collider.handle) {
        hitPaddleThisFrame = 'p2';
      } else {
        let isBrick = false;
        for (const [id, brick] of this.bricks.entries()) {
          if (brick.collider.handle === handle) {
            isBrick = true;
            if ((this.puckOwner === 'p1' && brick.side === 'p1') ||
                (this.puckOwner === 'p2' && brick.side === 'p2')) {
              destroyedBrickIds.push(id);
            }
          }
        }
        if (!isBrick) {
          hitWallThisFrame = true;
        }
      }
    });

    this.world.intersectionPairsWith(this.puckCollider, (otherCollider) => {
      const handle = otherCollider.handle;
      for (const [id, brick] of this.bricks.entries()) {
        if (brick.collider.handle === handle) {
          if ((this.puckOwner === 'p1' && brick.side === 'p1') ||
              (this.puckOwner === 'p2' && brick.side === 'p2')) {
            destroyedBrickIds.push(id);
          }
        }
      }
    });

    if (hitPaddleThisFrame && (now - this.lastPaddleHitTime > 150)) {
      this.lastPaddleHitTime = now;
      const hitPaddle = hitPaddleThisFrame;
      this.setPuckOwner(hitPaddle);

      const paddleBody = hitPaddle === 'p1' ? this.p1PaddleBody : this.p2PaddleBody;
      const paddleZ = paddleBody.translation().z;
      const offsetZ = puckPos.z - paddleZ;
      const halfLength = 1.6;
      const normRatio = offsetZ / halfLength;

      if (Math.abs(normRatio) > 0.75) {
        const currentVel = this.puckBody.linvel();
        const currentSpeed = Math.hypot(currentVel.x, currentVel.z) || 12;
        const edgeSign = Math.sign(normRatio);
        const newDirX = hitPaddle === 'p1' ? 0.6 : -0.6;
        const newDirZ = edgeSign * 0.8;

        this.puckBody.setLinvel({
          x: newDirX * currentSpeed,
          y: 0,
          z: newDirZ * currentSpeed
        }, true);
      }
    }

    for (const id of destroyedBrickIds) {
      const brick = this.bricks.get(id);
      if (brick) {
        const side = brick.side;
        // Bounce puck back towards paddle upon hitting matching brick
        const currentVel = this.puckBody.linvel();
        if (side === 'p1') {
          // P1 brick at x = -2: ball came from left (x = -14), bounce left (-X)
          this.puckBody.setLinvel({ x: -Math.abs(currentVel.x || 12), y: 0, z: currentVel.z }, true);
        } else {
          // P2 brick at x = 2: ball came from right (x = 14), bounce right (+X)
          this.puckBody.setLinvel({ x: Math.abs(currentVel.x || 12), y: 0, z: currentVel.z }, true);
        }

        this.removeBrick(id);
        this.onBrickDestroyCallback?.(id, side);
      }
    }

    if (hitWallThisFrame && this.puckOwner !== 'neutral' && (now - this.lastWallHitTime > 200)) {
      this.lastWallHitTime = now;
      this.bounceCount++;
      if (this.bounceCount >= 5) {
        this.resetPuckToNeutral();
      }
    }
  }
}
