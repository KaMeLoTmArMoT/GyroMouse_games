import RAPIER from '@dimforge/rapier3d-compat';

export interface TargetStructure {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  hp: number;
  maxHp: number;
  isDestroyed: boolean;
  scoreValue: number;
}

export interface Cannonball {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  active: boolean;
  spawnTime: number;
  trajectoryPoints: Array<{ x: number; y: number; z: number }>;
}

export interface ImpactRecord {
  position: { x: number; y: number; z: number };
  targetHitId: string | null;
  distanceToTarget: number;
  pitch: number;
  yaw: number;
  power: number;
}

export class ArtilleryPhysicsManager {
  public world!: RAPIER.World;
  public isInitialized: boolean = false;

  public groundCollider!: RAPIER.Collider;
  public targets: Map<string, TargetStructure> = new Map();
  public activeBall: Cannonball | null = null;
  public lastImpact: ImpactRecord | null = null;
  public impactHistory: ImpactRecord[] = [];

  public windVector: { x: number; z: number } = { x: 0, z: 0 };

  public async init() {
    await RAPIER.init();

    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Ground plane
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 50);
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(150, 0.5, 150)
      .setFriction(0.8)
      .setRestitution(0.1);
    this.groundCollider = this.world.createCollider(groundColliderDesc, groundBody);

    this.isInitialized = true;
  }

  public setupLevel(level: number, _windSpeed: number = 0) {
    // Clear old targets & active ball
    this.clearLevel();

    // Wind disabled
    this.windVector = { x: 0, z: 0 };

    // Spawn targets depending on level
    const targetConfigs = this.getLevelTargetConfigs(level);

    targetConfigs.forEach((cfg, idx) => {
      const id = `target_${level}_${idx}`;
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(cfg.x, cfg.y + cfg.sizeY / 2, cfg.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5)
        .setCanSleep(false);
      const body = this.world.createRigidBody(bodyDesc);
      body.wakeUp();

      const colliderDesc = RAPIER.ColliderDesc.cuboid(cfg.sizeX / 2, cfg.sizeY / 2, cfg.sizeZ / 2)
        .setDensity(1.5)
        .setRestitution(0.2)
        .setFriction(0.7);
      const collider = this.world.createCollider(colliderDesc, body);

      this.targets.set(id, {
        id,
        body,
        collider,
        position: { x: cfg.x, y: cfg.y + cfg.sizeY / 2, z: cfg.z },
        size: { x: cfg.sizeX, y: cfg.sizeY, z: cfg.sizeZ },
        hp: cfg.hp,
        maxHp: cfg.hp,
        isDestroyed: false,
        scoreValue: cfg.score
      });
    });
  }

  private getLevelTargetConfigs(level: number) {
    // Generates varying target layouts across different distances
    const baseDistance = 35 + level * 5;
    const configs = [];

    if (level === 1) {
      // 3 static target towers in a line
      configs.push(
        { x: -5, y: 0, z: baseDistance, sizeX: 2.5, sizeY: 3.5, sizeZ: 2.5, hp: 100, score: 100 },
        { x: 0, y: 0, z: baseDistance + 6, sizeX: 3.0, sizeY: 4.5, sizeZ: 3.0, hp: 150, score: 200 },
        { x: 5, y: 0, z: baseDistance + 2, sizeX: 2.5, sizeY: 3.5, sizeZ: 2.5, hp: 100, score: 100 }
      );
    } else if (level === 2) {
      // 4 targets staggered
      configs.push(
        { x: -10, y: 0, z: baseDistance, sizeX: 2.5, sizeY: 4, sizeZ: 2.5, hp: 120, score: 150 },
        { x: -2, y: 0, z: baseDistance + 10, sizeX: 3, sizeY: 5, sizeZ: 3, hp: 200, score: 250 },
        { x: 4, y: 0, z: baseDistance + 4, sizeX: 2.5, sizeY: 3.5, sizeZ: 2.5, hp: 100, score: 100 },
        { x: 12, y: 0, z: baseDistance + 12, sizeX: 2.8, sizeY: 4, sizeZ: 2.8, hp: 150, score: 200 }
      );
    } else {
      // 5+ targets spread across deep field
      for (let i = 0; i < Math.min(3 + level, 7); i++) {
        const spreadX = (i - (3 + level) / 2) * 6.5;
        const spreadZ = baseDistance + (i % 3) * 8 + Math.random() * 4;
        configs.push({
          x: spreadX,
          y: 0,
          z: spreadZ,
          sizeX: 2.5 + (i % 2),
          sizeY: 3.5 + (i % 3),
          sizeZ: 2.5 + (i % 2),
          hp: 100 + (i % 3) * 50,
          score: 150 + i * 50
        });
      }
    }

    return configs;
  }

  public launchShell(pitchDeg: number, yawDeg: number, powerMps: number): Cannonball | null {
    if (this.activeBall && this.activeBall.active) {
      return null; // Only 1 ball in air at a time
    }

    const pitchRad = (pitchDeg * Math.PI) / 180;
    const yawRad = (yawDeg * Math.PI) / 180;

    // Cannon muzzle location (x=0, y=2.2, z=2.5) matching rotation.y = -yawRad
    const muzzleOffset = 3.2;
    const spawnX = -Math.sin(yawRad) * Math.cos(pitchRad) * muzzleOffset;
    const spawnY = 2.0 + Math.sin(pitchRad) * muzzleOffset;
    const spawnZ = Math.cos(yawRad) * Math.cos(pitchRad) * muzzleOffset;

    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, spawnZ)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setLinearDamping(0.02);

    const ballBody = this.world.createRigidBody(ballBodyDesc);
    ballBody.wakeUp();

    const ballColliderDesc = RAPIER.ColliderDesc.ball(0.4)
      .setDensity(8.0)
      .setRestitution(0.3)
      .setFriction(0.5);

    const ballCollider = this.world.createCollider(ballColliderDesc, ballBody);

    // Calculate initial velocity vector straight down the barrel axis
    const vx = -Math.sin(yawRad) * Math.cos(pitchRad) * powerMps;
    const vy = Math.sin(pitchRad) * powerMps;
    const vz = Math.cos(yawRad) * Math.cos(pitchRad) * powerMps;

    ballBody.setLinvel({ x: vx, y: vy, z: vz }, true);

    this.activeBall = {
      body: ballBody,
      collider: ballCollider,
      active: true,
      spawnTime: performance.now(),
      trajectoryPoints: [{ x: spawnX, y: spawnY, z: spawnZ }]
    };

    return this.activeBall;
  }

  public update(_dt: number): { impact: ImpactRecord | null; destroyedTargets: string[] } {
    if (!this.isInitialized) return { impact: null, destroyedTargets: [] };

    // Record trajectory points
    if (this.activeBall && this.activeBall.active) {
      this.activeBall.body.wakeUp();
      const pos = this.activeBall.body.translation();
      this.activeBall.trajectoryPoints.push({ x: pos.x, y: pos.y, z: pos.z });
    }

    // Step Rapier physics world
    this.world.step();

    const destroyedTargets: string[] = [];
    let impactRecord: ImpactRecord | null = null;

    // Check cannonball position and collision
    if (this.activeBall && this.activeBall.active) {
      const pos = this.activeBall.body.translation();
      const vel = this.activeBall.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);

      // Check direct collision with any target structure
      let directHitTarget: TargetStructure | null = null;
      this.targets.forEach((t) => {
        if (t.isDestroyed || directHitTarget) return;
        const tPos = t.body.translation();
        const dx = tPos.x - pos.x;
        const dy = tPos.y - pos.y;
        const dz = tPos.z - pos.z;
        const hitRadius = Math.max(t.size.x, t.size.y, t.size.z) / 2 + 0.6;

        if (Math.hypot(dx, dy, dz) <= hitRadius) {
          directHitTarget = t;
        }
      });

      // Check collision conditions
      const hitGround = pos.y <= 0.4;
      const timedOut = performance.now() - this.activeBall.spawnTime > 8000;
      const stoppedMoving = pos.y < 2.0 && speed < 1.0;

      if (directHitTarget || hitGround || timedOut || stoppedMoving) {
        this.activeBall.active = false;

        // Process damage to targets
        let closestTargetId: string | null = null;
        let minDistance = Infinity;

        this.targets.forEach((target) => {
          if (target.isDestroyed) return;
          const tPos = target.body.translation();
          const dist = Math.hypot(tPos.x - pos.x, tPos.y - pos.y, tPos.z - pos.z);
          const distXZ = Math.hypot(tPos.x - pos.x, tPos.z - pos.z);

          if (distXZ < minDistance) {
            minDistance = distXZ;
            closestTargetId = target.id;
          }

          // Damage target if direct hit or landed within splash radius (4.5m)
          const isDirect = directHitTarget && directHitTarget.id === target.id;
          if (isDirect || dist < 4.5) {
            const damage = isDirect ? 200 : Math.max(30, Math.floor((1 - dist / 4.5) * 150));
            target.hp -= damage;

            // Apply strong physics impulse to send target block tumbling
            const forceX = (tPos.x - pos.x) * 25 + (isDirect ? -vel.x * 2 : 0);
            const forceY = 25 + Math.abs(vel.y) * 2;
            const forceZ = (tPos.z - pos.z) * 25 + (isDirect ? vel.z * 2 : 0);
            target.body.applyImpulse({ x: forceX, y: forceY, z: forceZ }, true);

            if (target.hp <= 0 && !target.isDestroyed) {
              target.isDestroyed = true;
              destroyedTargets.push(target.id);
            }
          }
        });

        impactRecord = {
          position: { x: pos.x, y: Math.max(0, pos.y), z: pos.z },
          targetHitId: closestTargetId,
          distanceToTarget: Math.round(minDistance * 10) / 10,
          pitch: 0,
          yaw: 0,
          power: 0
        };

        this.lastImpact = impactRecord;
        this.impactHistory.push(impactRecord);

        // Remove active ball body after slight delay
        setTimeout(() => {
          if (this.activeBall) {
            this.world.removeRigidBody(this.activeBall.body);
            this.activeBall = null;
          }
        }, 1500);
      }
    }

    // Update targets current visual position
    this.targets.forEach((target) => {
      if (!target.isDestroyed) {
        const p = target.body.translation();
        target.position = { x: p.x, y: p.y, z: p.z };
      }
    });

    return { impact: impactRecord, destroyedTargets };
  }

  public clearLevel() {
    if (this.activeBall) {
      this.world.removeRigidBody(this.activeBall.body);
      this.activeBall = null;
    }

    this.targets.forEach((target) => {
      this.world.removeRigidBody(target.body);
    });
    this.targets.clear();
    this.impactHistory = [];
    this.lastImpact = null;
  }
}
