import RAPIER from "@dimforge/rapier3d-compat";

export const ARM_MASS = 1.0;
export const CRATE_MASS = 10.0;

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

	// Target Region Bounding Box for box counter (centered at train platform X = 3.5)
	public targetRegion: TargetRegionBounds = {
		minX: 0.7,
		maxX: 6.3,
		minY: 0.6,
		maxY: 8.0,
		minZ: -1.2,
		maxZ: 1.2,
	};

	// Magnet Head Kinematic Rigid Body for physical crane collision
	public magnetBody!: RAPIER.RigidBody;
	public magnetCollider!: RAPIER.Collider;

	// Side Supply Platform (where new boxes arrive)
	public sidePlatformBody!: RAPIER.RigidBody;
	public sidePlatformCollider!: RAPIER.Collider;

	// Trolley & Magnet position (driven by Player 1 Y, Player 2 X)
	public trolleyX: number = -4.5;

	// Cable & Pendulum State
	public cableLength: number = 2.2; // Cable length L
	public cableAngle: number = 0.0; // Swing angle theta (radians)
	public cableAngVel: number = 0.0; // Angular velocity omega
	public magnetX: number = -4.5; // Actual swinging magnet X position
	public magnetY: number = 5.5; // Actual swinging magnet Y position
	private lastTrolleyVx: number = 0.0;

	// Boundaries for crane movement
	public readonly minX: number = -6.0;
	public readonly maxX: number = 9.5;
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
		this.groundCollider = this.world.createCollider(
			groundColliderDesc,
			groundBody,
		);

		// Side Supply Dock Platform at X = -4.5 (where new crates rest)
		const sideDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(-4.5, 0.5, 0);
		this.sidePlatformBody = this.world.createRigidBody(sideDesc);
		const sideColliderDesc = RAPIER.ColliderDesc.cuboid(1.2, 0.2, 1.2)
			.setFriction(0.9)
			.setRestitution(0.05);
		this.sidePlatformCollider = this.world.createCollider(
			sideColliderDesc,
			this.sidePlatformBody,
		);

		// Train Flatbed Platform at X = 3.5 (Kinematic body so it can drive away)
		const trainDesc =
			RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(3.5, 0.5, 0);
		this.trainBody = this.world.createRigidBody(trainDesc);

		// Flatbed collider: Width = 5.2, Height = 0.4, Depth = 2.0
		const trainColliderDesc = RAPIER.ColliderDesc.cuboid(2.6, 0.2, 1.0)
			.setFriction(0.9)
			.setRestitution(0.05);
		this.trainCollider = this.world.createCollider(
			trainColliderDesc,
			this.trainBody,
		);

		// Kinematic Magnet Head RigidBody (provides physical collision for the crane itself!)
		const magDesc =
			RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
				-4.5,
				5.5,
				0,
			);
		this.magnetBody = this.world.createRigidBody(magDesc);
		// Magnet head visual cylinder radius ~0.55, half-height ~0.15
		// Set collision group: Membership Group 2 (0x0002), Filter mask Group 1 & 2 (0x0003) -> 0x00030002
		const magColliderDesc = RAPIER.ColliderDesc.cylinder(0.15, 0.55)
			.setFriction(0.8)
			.setRestitution(0.1)
			.setCollisionGroups(0x00030002);
		this.magnetCollider = this.world.createCollider(
			magColliderDesc,
			this.magnetBody,
		);
	}

	/**
	 * Spawns a new Crate resting on the side supply dock at X = -4.5.
	 */
	public spawnCrate(id: string, size = { x: 1.2, y: 1.2, z: 1.2 }): CrateItem {
		const halfX = size.x / 2;
		const halfY = size.y / 2;
		const halfZ = size.z / 2;

		// Spawn resting on side platform (X = -4.5, Y = 0.7 + halfY)
		const spawnX = -4.5;
		const spawnY = 0.7 + halfY;

		// Create dynamic rigid body for crate locked to 2D X-Y plane (no Z drift or out-of-plane tilt)
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(spawnX, spawnY, 0)
			.setLinearDamping(0.2)
			.setAngularDamping(0.4)
			.setCcdEnabled(true)
			.setSleeping(false)
			.enabledTranslations(true, true, false)
			.enabledRotations(false, false, true);

		const body = this.world.createRigidBody(bodyDesc);

		const crateMass = CRATE_MASS;
		const volume = size.x * size.y * size.z;
		const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
			.setFriction(0.85)
			.setRestitution(0.1)
			.setDensity(crateMass / volume);

		const collider = this.world.createCollider(colliderDesc, body);

		const crate: CrateItem = {
			id,
			body,
			collider,
			size,
			isAttachedToMagnet: false, // Unattached on side platform (requires lowering magnet to grab)
			isGlued: false,
		};

		this.crates.set(id, crate);
		// Note: Do NOT clear currentHeldCrateId here so any crate currently attached to magnet remains attached!
		return crate;
	}

	public lastReleasedCrateId: string | null = null;
	public lastReleaseTime: number = 0;

	/**
	 * Release crate from crane magnet (Drop action) with pendulum momentum
	 */
	public releaseHeldCrate(): string | null {
		if (!this.currentHeldCrateId) return null;

		const crate = this.crates.get(this.currentHeldCrateId);
		if (crate) {
			crate.isAttachedToMagnet = false;

			// Clean separation without position teleport/nudge: zero out relative movement artifact
			crate.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
			crate.body.setEnabledTranslations(true, true, false, true);
			crate.body.setEnabledRotations(false, false, true, true);

			// Disable collision between this released crate and magnet head collider temporarily (250ms)
			// Magnet is group 2 (0x0002). Set crate filter to 0x0001 (collides with everything EXCEPT magnet group 2)
			crate.collider.setCollisionGroups(0x00010001);

			// Inherit natural crane momentum (trolley linear speed + cable swing speed)
			const cosAngle = Math.cos(this.cableAngle);
			const sinAngle = Math.sin(this.cableAngle);

			const vx =
				(this.lastTrolleyVx || 0) +
				this.cableAngVel * this.cableLength * cosAngle;
			const vy = this.cableAngVel * this.cableLength * sinAngle;

			// Clean release velocity without wild artificial spin or inverted vertical velocity
			crate.body.setLinvel(
				{ x: vx * 0.7, y: Math.max(-1.5, vy * 0.5), z: 0 },
				true,
			);
			crate.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
			crate.body.wakeUp();
		}

		const releasedId = this.currentHeldCrateId;
		this.lastReleasedCrateId = releasedId;
		this.currentHeldCrateId = null;
		this.lastReleaseTime = Date.now();
		return releasedId;
	}

	/**
	 * Try to re-grab a nearby crate under the magnet if no crate is currently held
	 */
	public tryRegrabCrate(): boolean {
		if (this.currentHeldCrateId) return false;
		// Don't re-grab immediately after dropping (1000ms cooldown)
		if (Date.now() - this.lastReleaseTime < 1000) return false;

		const magnetPos = { x: this.magnetX, y: this.magnetY, z: 0 };

		for (const [id, crate] of this.crates.entries()) {
			if (crate.isGlued) continue;

			const pos = crate.body.translation();
			const dist = Math.hypot(
				pos.x - magnetPos.x,
				pos.y - (magnetPos.y - crate.size.y / 2),
			);

			// Magnet proximity check (requires bringing magnet close directly above box)
			if (dist < 1.2) {
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
	public updateCranePosition(
		inputX: number,
		inputY: number,
		dt: number,
		isMagnetActive: boolean = false,
	) {
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
		// 2. Player 1: Cable Hoist Length L (InputY: Up decreases length L, Down increases length L)
		// Chain behavior: If lowering (inputY < 0), check if magnet or held crate is touching dynamic or static surfaces below.
		const prevL = this.cableLength;

		if (inputY < 0) {
			// Lowering: Check if bottom of held crate (or bottom of magnet) has touched a surface below
			let isRestingOnSurface = false;
			const bottomY = this.currentHeldCrateId
				? this.magnetY -
					(this.crates.get(this.currentHeldCrateId)?.size.y || 1.2) -
					0.15
				: this.magnetY - 0.35;

			// Contact check against ground level (Y=0.1), side platform / train bed (Y=0.6), or existing crates
			if (bottomY <= 0.6) {
				isRestingOnSurface = true;
			} else {
				for (const [id, crate] of this.crates.entries()) {
					if (id === this.currentHeldCrateId) continue;
					const pos = crate.body.translation();
					const halfY = crate.size.y / 2;
					const topY = pos.y + halfY;
					if (
						Math.abs(pos.x - this.magnetX) < 1.1 &&
						bottomY <= topY + 0.05 &&
						bottomY >= topY - 0.4
					) {
						isRestingOnSurface = true;
						break;
					}
				}
			}

			if (!isRestingOnSurface) {
				this.cableLength -= inputY * hoistSpeed * dt;
			}
		} else if (inputY > 0) {
			// Raising cable always allowed
			this.cableLength -= inputY * hoistSpeed * dt;
		}

		this.cableLength = Math.max(
			this.minCableL,
			Math.min(this.maxCableL, this.cableLength),
		);

		// Conserve natural pendulum swing energy during both lowering and upering (raising)
		if (prevL !== this.cableLength && Math.abs(this.cableAngVel) > 0.001) {
			const scale = Math.sqrt(prevL / this.cableLength);
			this.cableAngVel *= scale;
		}

		// 3. Cable Pendulum Angular Acceleration equation:
		// alpha = -(g / L) * sin(theta) - (Ax / L) * cos(theta) - damping * omega
		const g = 9.81;
		// Air damping: Heavy load (m=11) maintains swing longer than light empty arm (m=1)
		const mCrane = this.currentHeldCrateId ? ARM_MASS + CRATE_MASS : ARM_MASS;
		const damping = 0.12 + 0.13 / mCrane;
		const alpha =
			(-g / this.cableLength) * Math.sin(this.cableAngle) -
			(trolleyAx / this.cableLength) * Math.cos(this.cableAngle) -
			damping * this.cableAngVel;

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

		// 5. Update Kinematic Magnet Head & Held Crate Colliders
		if (this.magnetBody) {
			this.magnetBody.setNextKinematicTranslation({
				x: this.magnetX,
				y: this.magnetY,
				z: 0,
			});
			const q = new RAPIER.Quaternion(
				0,
				0,
				Math.sin(this.cableAngle / 2),
				Math.cos(this.cableAngle / 2),
			);
			this.magnetBody.setNextKinematicRotation(q);
		}

		// 6. Magnetic Force & Attachment logic (Activated when Space is pressed / magnet action active)
		if (!this.currentHeldCrateId) {
			if (isMagnetActive && Date.now() - this.lastReleaseTime >= 1000) {
				const magTargetY = this.magnetY - 0.75; // Attract top of crate to bottom of magnet
				const magnetPos = { x: this.magnetX, y: magTargetY };

				for (const [id, crate] of this.crates.entries()) {
					if (crate.isGlued || crate.isAttachedToMagnet) continue;

					const pos = crate.body.translation();
					const dx = magnetPos.x - pos.x;
					const dy = magnetPos.y - pos.y;
					const dist = Math.hypot(dx, dy);

					const maxRange = 2.4;
					if (dist < maxRange) {
						if (dist < 0.25) {
							// Lock onto magnet hook once close enough
							crate.isAttachedToMagnet = true;
							this.currentHeldCrateId = id;
						} else {
							// Normalized distance factor from 0.0 (far edge) to 1.0 (touching magnet)
							const proximityFactor = Math.max(0, 1.0 - dist / maxRange) ** 2.5;

							// Force is subtle at far distance and ramps up to max force at the very end
							const forceMagnitude = 2.0 + proximityFactor * 16.0;
							const fx = (dx / dist) * forceMagnitude;
							// Lift force ramps up gently from 0.95g up to 1.45g at the top contact point
							const liftMultiplier = 0.95 + proximityFactor * 0.5;
							const fy = (dy / dist) * forceMagnitude + 9.81 * liftMultiplier;

							crate.body.applyImpulse({ x: fx * dt, y: fy * dt, z: 0 }, true);
							crate.body.wakeUp();
						}
					}
				}
			}
		} else {
			// Holding a crate - lock it to pendulum position
			const crate = this.crates.get(this.currentHeldCrateId);
			if (crate?.isAttachedToMagnet) {
				const halfY = crate.size.y / 2;
				const effL = this.cableLength + halfY + 0.22; // 0.22 provides ~5%+ safety gap between magnet bottom and crate top
				const crateX = this.trolleyX + effL * Math.sin(this.cableAngle);
				const crateY = this.gantryY - effL * Math.cos(this.cableAngle);

				crate.body.setBodyType(
					RAPIER.RigidBodyType.KinematicPositionBased,
					true,
				);
				crate.body.setNextKinematicTranslation({ x: crateX, y: crateY, z: 0 });
				const q = new RAPIER.Quaternion(
					0,
					0,
					Math.sin(this.cableAngle / 2),
					Math.cos(this.cableAngle / 2),
				);
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
	 * Check if the spawn column (drop zone up to the sky at X = -4.5) is clear before spawning a new crate.
	 */
	public isSpawnZoneClear(): boolean {
		const spawnX = -4.5;
		const spawnZ = 0;
		const checkRadiusX = 1.0;
		const checkRadiusZ = 1.0;

		for (const crate of this.crates.values()) {
			const pos = crate.body.translation();
			// Check if any crate is anywhere in the vertical spawn column (from platform up to sky Y >= 0.6)
			const inColumn =
				Math.abs(pos.x - spawnX) < checkRadiusX &&
				Math.abs(pos.z - spawnZ) < checkRadiusZ &&
				pos.y >= 0.5;

			if (inColumn) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Check if any released crate touched ground (Failure)
	 */
	public checkGroundCollision(): boolean {
		for (const crate of this.crates.values()) {
			if (crate.isAttachedToMagnet) continue;
			const pos = crate.body.translation();
			// Side platform surface is Y=0.5 (cuboid height 0.2 means top is Y=0.6).
			// Train bed surface is Y=0.5 (top is Y=0.6).
			// Ground surface is Y=0 (top is Y=0.1).
			// If crate falls off side platform or train bed onto ground floor (center Y < 0.8), it dropped on the floor!
			if (pos.y < 0.8 && Math.abs(pos.x - -4.5) > 1.2) {
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
		this.trainBody.setNextKinematicTranslation({
			x: newX,
			y: curPos.y,
			z: curPos.z,
		});

		for (const crate of this.crates.values()) {
			if (crate.isGlued) {
				const cPos = crate.body.translation();
				crate.body.setNextKinematicTranslation({
					x: cPos.x + dx,
					y: cPos.y,
					z: cPos.z,
				});
			}
		}
	}

	private lastHitCooldown: number = 0;

	/**
	 * Physics step
	 */
	public step(dt: number) {
		this.world.timestep = Math.min(dt, 0.033);

		// Dynamic AABB Collision Check between swinging crane (magnet or held crate) and target crates
		if (this.lastHitCooldown > 0) {
			this.lastHitCooldown -= dt;
		} else {
			const activeCrate = this.currentHeldCrateId
				? this.crates.get(this.currentHeldCrateId)
				: null;
			const isHolding = !!activeCrate;

			// Position & half-extents of the swinging object (magnet head or held crate)
			let swingX = this.magnetX;
			let swingY = this.magnetY;
			let swingHalfX = 0.55; // magnet radius
			let swingHalfY = 0.3; // magnet half height

			if (activeCrate) {
				const cPos = activeCrate.body.translation();
				swingX = cPos.x;
				swingY = cPos.y;
				swingHalfX = activeCrate.size.x / 2;
				swingHalfY = activeCrate.size.y / 2;
			}

			for (const [id, targetCrate] of this.crates.entries()) {
				if (id === this.currentHeldCrateId || targetCrate.isAttachedToMagnet)
					continue;

				const targetPos = targetCrate.body.translation();
				const tHalfX = targetCrate.size.x / 2;
				const tHalfY = targetCrate.size.y / 2;

				const dx = swingX - targetPos.x;
				const dy = swingY - targetPos.y;

				const overlapX = swingHalfX + tHalfX - Math.abs(dx);
				const overlapY = swingHalfY + tHalfY - Math.abs(dy);

				// AABB Intersection check
				if (overlapX > 0 && overlapY > 0) {
					const hitFromLeft = dx < 0;
					const dir = hitFromLeft ? 1 : -1;

					const cosAngle = Math.cos(this.cableAngle);
					const armSpeedX =
						(this.lastTrolleyVx || 0) +
						this.cableAngVel * this.cableLength * cosAngle;
					const targetSpeedX = targetCrate.body.linvel().x;
					const relVx = armSpeedX - targetSpeedX;
					const relativeSpeed = relVx * dir;

					if (isHolding) {
						// --- CARRIER MODE (Mass 11 vs 10) ---
						// Heavy payload plows through: transfers massive impulse to target box, maintains forward swing
						const m1 = ARM_MASS + CRATE_MASS;
						const m2 = CRATE_MASS;
						const e = 0.35;
						const effSpeed = Math.max(0.6, relativeSpeed);
						const J = ((m1 * m2) / (m1 + m2)) * (1 + e) * effSpeed;

						targetCrate.body.applyImpulse({ x: J * dir, y: 0.8, z: 0 }, true);
						targetCrate.body.wakeUp();

						// Retain positive forward swing momentum
						this.cableAngVel *= 0.45;
						this.cableAngle += hitFromLeft ? -0.02 : 0.02;

						// Drop crate on violent impact
						if (Math.abs(this.cableAngVel * this.cableLength) > 2.2) {
							this.releaseHeldCrate();
						}
					} else {
						// --- EMPTY ARM MODE (Mass 1 vs 10) ---
						// Guaranteed visible impact on target box + smooth springy pendulum rebound (no position teleporting!)
						const minImpulse = 2.4;
						const effSpeed = Math.max(0.5, relativeSpeed);
						const J = Math.max(
							minImpulse,
							((ARM_MASS * CRATE_MASS) / (ARM_MASS + CRATE_MASS)) *
								1.35 *
								effSpeed,
						);

						// 1. Guaranteed physical bump on target box
						targetCrate.body.applyImpulse({ x: J * dir, y: 0.3, z: 0 }, true);
						targetCrate.body.wakeUp();

						// 2. Subtle velocity-driven angular recoil (reduced to 20% strength)
						const bounceSpeed = Math.max(
							0.12,
							Math.abs(this.cableAngVel) * 0.09,
						);
						this.cableAngVel = hitFromLeft ? -bounceSpeed : bounceSpeed;

						// 3. Micro angle nudge to prevent clipping
						const nudgeAngle = Math.min(
							0.006,
							Math.max(0.002, overlapX * 0.04),
						);
						this.cableAngle += hitFromLeft ? -nudgeAngle : nudgeAngle;

						// Recalculate position
						this.magnetX =
							this.trolleyX + this.cableLength * Math.sin(this.cableAngle);
						this.magnetY =
							this.gantryY - this.cableLength * Math.cos(this.cableAngle);
						if (this.magnetBody) {
							this.magnetBody.setNextKinematicTranslation({
								x: this.magnetX,
								y: this.magnetY,
								z: 0,
							});
						}
					}

					this.lastHitCooldown = 0.06; // 60ms cooldown
					break;
				}
			}
		}

		// Re-enable collisions between magnet and recently released crate after 250ms (1/4 sec)
		if (
			this.lastReleasedCrateId &&
			this.lastReleaseTime > 0 &&
			Date.now() - this.lastReleaseTime >= 250
		) {
			const releasedCrate = this.crates.get(this.lastReleasedCrateId);
			if (releasedCrate) {
				// Restore default collision groups (collides with group 1 and group 2)
				releasedCrate.collider.setCollisionGroups(0x00030003);
			}
			this.lastReleasedCrateId = null;
		}

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
		this.trolleyX = -4.5;
		this.cableLength = 2.2;
		this.cableAngle = 0;
		this.cableAngVel = 0;
		this.magnetX = -4.5;
		this.magnetY = 5.5;
		this.lastTrolleyVx = 0;
		this.trainBody.setTranslation({ x: 3.5, y: 0.5, z: 0 }, true);
	}
}
