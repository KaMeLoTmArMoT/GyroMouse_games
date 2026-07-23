import RAPIER from '@dimforge/rapier3d-compat';

export interface CrateItem {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  size: { x: number; y: number; z: number };
  isAttachedToMagnet: boolean;
  isGlued: boolean;
}

export interface TargetRegionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export class CranePhysicsManager {
  public world!: RAPIER.World;
  public isInitialized: boolean = false;

  // Platform (train bed)
  public trainBody!: RAPIER.RigidBody;
  public trainCollider!: RAPIER.Collider;

  // Ground plane collider
  public groundCollider!: RAPIER.Collider;

  // Crates list
  public crates: Map<string, CrateItem> = new Map();

  // Currently held crate ID
  public currentHeldCrateId: string | null = null;

  // Target Region Bounding Box for box counter
  public targetRegion: TargetRegionBounds = {
    minX: -2.8,
    maxX: 2.8,
    minY: 0.6,
    maxY: 8.0,
    minZ: -1.2,
    maxZ: 1.2
  };

  // Magnet Head Kinematic Rigid Body for physical crane collision
  public magnetBody!: RAPIER.RigidBody;
  public magnetCollider!: RAPIER.Collider;

  // Side Supply Platform (where new boxes arrive)
  public sidePlatformBody!: RAPIER.RigidBody;
  public sidePlatformCollider!: RAPIER.Collider;

  // Trolley & Magnet position (driven by Player 1 Y, Player 2 X)
  public trolleyX: number = 0;

  // Cable & Pendulum State
  public cableLength: number = 2.2; // Cable length L
  public cableAngle: number = 0.0;  // Swing angle theta (radians)
  public cableAngVel: number = 0.0; // Angular velocity omega
  public magnetX: number = 0.0;     // Actual swinging magnet X position
  public magnetY: number = 5.5;     // Actual swinging magnet Y position
  private lastTrolleyVx: number = 0.0;

  // Boundaries for crane movement
  public readonly minX: number = -6.0;
  public readonly maxX: number = 6.0;
  public readonly minCableL: number = 1.0;
  public readonly maxCableL: number = 6.4;
  public readonly gantryY: number = 7.7;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    await RAPIER.init();
    this.isInitialized = true;

    // Standard gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Ground floor collider (Static ground level Y=0)
    const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const groundBody = this.world.createRigidBody(groundDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(30, 0.2, 30)
      .setFriction(0.8)
      .setRestitution(0.1);
    this.groundCollider = this.world.createCollider(groundColliderDesc, groundBody);

    // Side Supply Dock Platform at X = -5.0 (where new crates rest)
    const sideDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(-5.0, 0.5, 0);
    this.sidePlatformBody = this.world.createRigidBody(sideDesc);
    const sideColliderDesc = RAPIER.ColliderDesc.cuboid(1.5, 0.2, 1.2)
      .setFriction(0.9)
      .setRestitution(0.05);
    this.sidePlatformCollider = this.world.createCollider(sideColliderDesc, this.sidePlatformBody);

    // Train Flatbed Platform (Kinematic body so it can drive away)
    const trainDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.5, 0);
    this.trainBody = this.world.createRigidBody(trainDesc);

    // Flatbed collider: Width = 5.2, Height = 0.4, Depth = 2.0
    const trainColliderDesc = RAPIER.ColliderDesc.cuboid(2.6, 0.2, 1.0)
      .setFriction(0.9)
      .setRestitution(0.05);
    this.trainCollider = this.world.createCollider(trainColliderDesc, this.trainBody);

    // Kinematic Magnet Head RigidBody (provides physical collision for the crane itself!)
    const magDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5.5, 0);
    this.magnetBody = this.world.createRigidBody(magDesc);
    const magColliderDesc = RAPIER.ColliderDesc.cylinder(0.2, 0.55)
      .setFriction(0.8)
      .setRestitution(0.1);
    this.magnetCollider = this.world.createCollider(magColliderDesc, this.magnetBody);
  }

  /**
   * Spawns a new Crate resting on the side supply dock at X = -5.0.
   */
  public spawnCrate(id: string, size = { x: 1.2, y: 1.2, z: 1.2 }): CrateItem {
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const halfZ = size.z / 2;

    // Spawn resting on side platform (X = -5.0, Y = 0.7 + halfY)
    const spawnX = -5.0;
    const spawnY = 0.7 + halfY;

    // Create dynamic rigid body for crate
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, 0)
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCcdEnabled(true)
      .setSleeping(false);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setFriction(0.85)
      .setRestitution(0.1)
      .setDensity(1.5);

    const collider = this.world.createCollider(colliderDesc, body);

    const crate: CrateItem = {
      id,
      body,
      collider,
      size,
      isAttachedToMagnet: false,
      isGlued: false
    };

    this.crates.set(id, crate);
    return crate;
  }

  /**
   * Release crate from crane magnet (Drop action) with pendulum momentum
   */
  public releaseHeldCrate(): string | null {
    if (!this.currentHeldCrateId) return null;

    const crate = this.crates.get(this.currentHeldCrateId);
    if (crate) {
      crate.isAttachedToMagnet = false;
      crate.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

      // Inherit tangential pendulum velocity when dropped!
      const tangentSpeed = this.cableAngVel * this.cableLength;
      const vx = tangentSpeed * Math.cos(this.cableAngle);
      const vy = -tangentSpeed * Math.sin(this.cableAngle);

      crate.body.setLinvel({ x: vx, y: vy, z: 0 }, true);
      crate.body.setAngvel({ x: 0, y: 0, z: -this.cableAngVel }, true);
      crate.body.wakeUp();
    }

    const releasedId = this.currentHeldCrateId;
    this.currentHeldCrateId = null;
    return releasedId;
  }

  /**
   * Try to re-grab a nearby crate under the magnet if no crate is currently held
   */
  public tryRegrabCrate(): boolean {
    if (this.currentHeldCrateId) return false;

    const magnetPos = { x: this.magnetX, y: this.magnetY, z: 0 };

    for (const [id, crate] of this.crates.entries()) {
      if (crate.isGlued) continue;

      const pos = crate.body.translation();
      const dist = Math.hypot(pos.x - magnetPos.x, pos.y - (magnetPos.y - crate.size.y / 2));

      // If magnet is right on top of this crate
      if (dist < 1.1) {
        crate.isAttachedToMagnet = true;
        this.currentHeldCrateId = id;
        return true;
      }
    }
    return false;
  }

  /**
   * Update Crane Hook position and Cable Pendulum Physics from Player inputs
   */
  public updateCranePosition(inputX: number, inputY: number, dt: number) {
    const trolleySpeed = 4.0;
    const hoistSpeed = 3.5;

    // 1. Move Top Trolley X
    const prevTrolleyX = this.trolleyX;
    this.trolleyX += inputX * trolleySpeed * dt;
    this.trolleyX = Math.max(this.minX, Math.min(this.maxX, this.trolleyX));

    const trolleyVx = (this.trolleyX - prevTrolleyX) / dt;
    const trolleyAx = (trolleyVx - this.lastTrolleyVx) / dt;
    this.lastTrolleyVx = trolleyVx;

    // 2. Player 1: Cable Hoist Length L (InputY: Up decreases length L, Down increases length L)
    this.cableLength -= inputY * hoistSpeed * dt;
    this.cableLength = Math.max(this.minCableL, Math.min(this.maxCableL, this.cableLength));

    // 3. Cable Pendulum Angular Acceleration equation:
    // alpha = -(g / L) * sin(theta) - (Ax / L) * cos(theta) - damping * omega
    const g = 9.81;
    const damping = 0.1;
    const alpha = (-g / this.cableLength) * Math.sin(this.cableAngle)
      - (trolleyAx / this.cableLength) * Math.cos(this.cableAngle)
      - damping * this.cableAngVel;

    this.cableAngVel += alpha * dt;
    this.cableAngle += this.cableAngVel * dt;

    // Clamp maximum swing angle to ~80 degrees
    const maxAngle = 1.39626;
    if (this.cableAngle > maxAngle) {
      this.cableAngle = maxAngle;
      this.cableAngVel = Math.min(0, this.cableAngVel);
    } else if (this.cableAngle < -maxAngle) {
      this.cableAngle = -maxAngle;
      this.cableAngVel = Math.max(0, this.cableAngVel);
    }

    // 4. Compute Magnet Swinging Coordinates
    this.magnetX = this.trolleyX + this.cableLength * Math.sin(this.cableAngle);
    this.magnetY = this.gantryY - this.cableLength * Math.cos(this.cableAngle);

    // 5. Update Kinematic Magnet Head Collider
    if (this.magnetBody) {
      this.magnetBody.setNextKinematicTranslation({ x: this.magnetX, y: this.magnetY, z: 0 });
      const q = new RAPIER.Quaternion(0, 0, Math.sin(this.cableAngle / 2), Math.cos(this.cableAngle / 2));
      this.magnetBody.setNextKinematicRotation(q);
    }

    // Auto-grab unattached crate if magnet touches it
    if (!this.currentHeldCrateId) {
      this.tryRegrabCrate();
    }

    // 6. If holding a crate, attach it rigidly/kinematically to the swinging magnet head!
    if (this.currentHeldCrateId) {
      const crate = this.crates.get(this.currentHeldCrateId);
      if (crate && crate.isAttachedToMagnet) {
        const halfY = crate.size.y / 2;
        const crateX = this.magnetX - (halfY + 0.15) * Math.sin(this.cableAngle);
        const crateY = this.magnetY - (halfY + 0.15) * Math.cos(this.cableAngle);

        crate.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        crate.body.setNextKinematicTranslation({ x: crateX, y: crateY, z: 0 });
        const q = new RAPIER.Quaternion(0, 0, Math.sin(this.cableAngle / 2), Math.cos(this.cableAngle / 2));
        crate.body.setNextKinematicRotation(q);
      }
    }
  }

  /**
   * Count crates settled in the target region above the train bed
   */
  public countCratesInTargetRegion(): { count: number; settled: boolean } {
    let count = 0;
    let allSettled = true;

    for (const crate of this.crates.values()) {
      if (crate.isAttachedToMagnet) continue;

      const pos = crate.body.translation();
      const vel = crate.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);

      const inZone =
        pos.x >= this.targetRegion.minX &&
        pos.x <= this.targetRegion.maxX &&
        pos.y >= this.targetRegion.minY &&
        pos.y <= this.targetRegion.maxY &&
        pos.z >= this.targetRegion.minZ &&
        pos.z <= this.targetRegion.maxZ;

      if (inZone) {
        count++;
        if (speed > 0.4) {
          allSettled = false;
        }
      }
    }

    return { count, settled: allSettled };
  }

  /**
   * Check if any released crate touched ground (Failure)
   */
  public checkGroundCollision(): boolean {
    for (const crate of this.crates.values()) {
      if (crate.isAttachedToMagnet) continue;
      const pos = crate.body.translation();
      // If crate fallen below train bed height onto the ground floor (Y < 0.3)
      if (pos.y < 0.35) {
        return true;
      }
    }
    return false;
  }

  /**
   * Glue all crates to train flatbed (Make fixed/kinematic to train)
   */
  public glueCratesToTrain() {
    for (const crate of this.crates.values()) {
      if (crate.isGlued) continue;

      crate.isGlued = true;

      // Calculate relative position to train
      const cratePos = crate.body.translation();
      const rot = crate.body.rotation();

      // Convert body to fixed/kinematic attached to train
      crate.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      crate.body.setTranslation(cratePos, true);
      crate.body.setRotation(rot, true);
    }
  }

  /**
   * Move train off screen (Victory scene animation)
   */
  public moveTrain(dx: number) {
    const curPos = this.trainBody.translation();
    const newX = curPos.x + dx;
    this.trainBody.setNextKinematicTranslation({ x: newX, y: curPos.y, z: curPos.z });

    for (const crate of this.crates.values()) {
      if (crate.isGlued) {
        const cPos = crate.body.translation();
        crate.body.setNextKinematicTranslation({ x: cPos.x + dx, y: cPos.y, z: cPos.z });
      }
    }
  }

  /**
   * Physics step
   */
  public step(dt: number) {
    this.world.timestep = Math.min(dt, 0.033);
    this.world.step();
  }

  /**
   * Clear world for new game level reset
   */
  public clear() {
    this.currentHeldCrateId = null;
    for (const crate of this.crates.values()) {
      this.world.removeRigidBody(crate.body);
    }
    this.crates.clear();
    this.trolleyX = 0;
    this.cableLength = 2.2;
    this.cableAngle = 0;
    this.cableAngVel = 0;
    this.magnetX = 0;
    this.magnetY = 5.5;
    this.lastTrolleyVx = 0;
    this.trainBody.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
  }
}
