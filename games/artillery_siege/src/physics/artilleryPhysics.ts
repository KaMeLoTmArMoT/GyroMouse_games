import RAPIER from "@dimforge/rapier3d-compat";

export type ShellType = "BASIC" | "CLUSTER" | "ICE" | "GRAPPLE";

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
	isFrozen?: boolean;
	isGrappled?: boolean;
	category: "tower_left" | "tower_right" | "gate" | "keep" | "wall";
}

export interface Cannonball {
	id: string;
	body: RAPIER.RigidBody;
	collider: RAPIER.Collider;
	active: boolean;
	spawnTime: number;
	shellType: ShellType;
	spawnPos: { x: number; y: number; z: number };
	trajectoryPoints: Array<{ x: number; y: number; z: number }>;
	hasSplit?: boolean;
	isSubMunition?: boolean;
}

export interface ImpactRecord {
	position: { x: number; y: number; z: number };
	targetHitId: string | null;
	distanceToTarget: number;
	pitch: number;
	yaw: number;
	power: number;
	shellType: ShellType;
}

export class ArtilleryPhysicsManager {
	public world!: RAPIER.World;
	public isInitialized: boolean = false;

	public groundCollider!: RAPIER.Collider;
	public targets: Map<string, TargetStructure> = new Map();
	public activeBalls: Cannonball[] = [];
	public lastImpact: ImpactRecord | null = null;
	public impactHistory: ImpactRecord[] = [];

	public windVector: { x: number; z: number } = { x: 0, z: 0 };

	// Coins & Combo State
	public coinsEarned: number = 0;
	public comboCount: number = 0;
	public lastDestroyTime: number = 0;

	// Active Grapple Cable Link
	public activeGrappleCable: {
		start: { x: number; y: number; z: number };
		end: { x: number; y: number; z: number };
	} | null = null;

	public async init() {
		await RAPIER.init();

		const gravity = { x: 0.0, y: -9.81, z: 0.0 };
		this.world = new RAPIER.World(gravity);

		// Ground plane
		const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
			0,
			-0.5,
			50,
		);
		const groundBody = this.world.createRigidBody(groundBodyDesc);
		const groundColliderDesc = RAPIER.ColliderDesc.cuboid(150, 0.5, 150)
			.setFriction(0.8)
			.setRestitution(0.1);
		this.groundCollider = this.world.createCollider(
			groundColliderDesc,
			groundBody,
		);

		this.isInitialized = true;
	}

	public setupLevel(level: number, windSpeed: number = 0) {
		this.clearLevel();
		this.windVector = {
			x: (Math.random() - 0.5) * windSpeed * 2.0,
			z: (Math.random() - 0.5) * windSpeed * 1.0,
		};

		const targetConfigs = this.getLevelTargetConfigs(level);
		this.createTargetBodies(targetConfigs);
	}

	public setupSandboxLevel() {
		this.clearLevel();
		this.windVector = {
			x: (Math.random() - 0.5) * 3.0,
			z: (Math.random() - 0.5) * 2.0,
		};

		const configs: Array<{
			x: number;
			y: number;
			z: number;
			sizeX: number;
			sizeY: number;
			sizeZ: number;
			hp: number;
			score: number;
			category: "tower_left" | "tower_right" | "gate" | "keep" | "wall";
		}> = [];

		const centerZ = 45;

		// 1. Central Keep Citadel (4 blocks stacked)
		for (let h = 0; h < 4; h++) {
			configs.push({
				x: 0,
				y: h * 2.5,
				z: centerZ,
				sizeX: 4.5 - h * 0.4,
				sizeY: 2.4,
				sizeZ: 4.5 - h * 0.4,
				hp: 250 + h * 50,
				score: 300,
				category: "keep",
			});
		}

		// 2. Main Gate (2 side posts + arch)
		configs.push(
			{
				x: -3.5,
				y: 0,
				z: centerZ - 6,
				sizeX: 2.0,
				sizeY: 4.0,
				sizeZ: 2.0,
				hp: 180,
				score: 200,
				category: "gate",
			},
			{
				x: 3.5,
				y: 0,
				z: centerZ - 6,
				sizeX: 2.0,
				sizeY: 4.0,
				sizeZ: 2.0,
				hp: 180,
				score: 200,
				category: "gate",
			},
			{
				x: 0,
				y: 4.0,
				z: centerZ - 6,
				sizeX: 9.0,
				sizeY: 1.8,
				sizeZ: 2.2,
				hp: 220,
				score: 250,
				category: "gate",
			},
		);

		// 3. Left Flank Tower (3 tiers)
		for (let h = 0; h < 3; h++) {
			configs.push({
				x: -11,
				y: h * 3.0,
				z: centerZ - 2,
				sizeX: 3.2,
				sizeY: 2.8,
				sizeZ: 3.2,
				hp: 200,
				score: 220,
				category: "tower_left",
			});
		}

		// 4. Right Flank Tower (3 tiers)
		for (let h = 0; h < 3; h++) {
			configs.push({
				x: 11,
				y: h * 3.0,
				z: centerZ - 2,
				sizeX: 3.2,
				sizeY: 2.8,
				sizeZ: 3.2,
				hp: 200,
				score: 220,
				category: "tower_right",
			});
		}

		// 5. Curtain Walls connecting towers
		configs.push(
			{
				x: -7.5,
				y: 0,
				z: centerZ - 4,
				sizeX: 4.5,
				sizeY: 3.0,
				sizeZ: 1.5,
				hp: 150,
				score: 150,
				category: "wall",
			},
			{
				x: 7.5,
				y: 0,
				z: centerZ - 4,
				sizeX: 4.5,
				sizeY: 3.0,
				sizeZ: 1.5,
				hp: 150,
				score: 150,
				category: "wall",
			},
		);

		this.createTargetBodies(configs);
	}

	private createTargetBodies(
		configs: Array<{
			x: number;
			y: number;
			z: number;
			sizeX: number;
			sizeY: number;
			sizeZ: number;
			hp: number;
			score: number;
			category?: "tower_left" | "tower_right" | "gate" | "keep" | "wall";
		}>,
	) {
		configs.forEach((cfg, idx) => {
			const id = `target_${idx}_${Date.now()}`;
			const category =
				cfg.category ||
				(cfg.x < -3 ? "tower_left" : cfg.x > 3 ? "tower_right" : "keep");
			const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(cfg.x, cfg.y + cfg.sizeY / 2, cfg.z)
				.setLinearDamping(0.6)
				.setAngularDamping(0.6)
				.setCanSleep(true); // Optimization: enable rigid body sleeping!
			const body = this.world.createRigidBody(bodyDesc);

			const colliderDesc = RAPIER.ColliderDesc.cuboid(
				cfg.sizeX / 2,
				cfg.sizeY / 2,
				cfg.sizeZ / 2,
			)
				.setDensity(1.8)
				.setRestitution(0.15)
				.setFriction(0.75);
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
				scoreValue: cfg.score,
				category,
			});
		});
	}

	private getLevelTargetConfigs(level: number) {
		const baseDistance = 35 + level * 4;
		const configs = [];

		if (level === 1) {
			configs.push(
				{
					x: -5,
					y: 0,
					z: baseDistance,
					sizeX: 2.6,
					sizeY: 3.5,
					sizeZ: 2.6,
					hp: 100,
					score: 100,
					category: "tower_left" as const,
				},
				{
					x: 0,
					y: 0,
					z: baseDistance + 5,
					sizeX: 3.2,
					sizeY: 4.5,
					sizeZ: 3.2,
					hp: 150,
					score: 200,
					category: "keep" as const,
				},
				{
					x: 5,
					y: 0,
					z: baseDistance + 2,
					sizeX: 2.6,
					sizeY: 3.5,
					sizeZ: 2.6,
					hp: 100,
					score: 100,
					category: "tower_right" as const,
				},
			);
		} else if (level === 2) {
			configs.push(
				{
					x: -9,
					y: 0,
					z: baseDistance,
					sizeX: 2.6,
					sizeY: 4.0,
					sizeZ: 2.6,
					hp: 120,
					score: 150,
					category: "tower_left" as const,
				},
				{
					x: 0,
					y: 0,
					z: baseDistance + 8,
					sizeX: 3.5,
					sizeY: 5.2,
					sizeZ: 3.5,
					hp: 220,
					score: 250,
					category: "keep" as const,
				},
				{
					x: 0,
					y: 0,
					z: baseDistance + 1,
					sizeX: 6.0,
					sizeY: 2.5,
					sizeZ: 1.8,
					hp: 140,
					score: 180,
					category: "gate" as const,
				},
				{
					x: 9,
					y: 0,
					z: baseDistance + 3,
					sizeX: 2.6,
					sizeY: 4.0,
					sizeZ: 2.6,
					hp: 120,
					score: 150,
					category: "tower_right" as const,
				},
			);
		} else {
			const count = Math.min(4 + level, 8);
			for (let i = 0; i < count; i++) {
				const spreadX = (i - count / 2) * 5.5;
				const spreadZ = baseDistance + (i % 3) * 6;
				const cat =
					spreadX < -3
						? "tower_left"
						: spreadX > 3
							? "tower_right"
							: i % 2 === 0
								? "keep"
								: "gate";
				configs.push({
					x: spreadX,
					y: 0,
					z: spreadZ,
					sizeX: 2.5 + (i % 2) * 0.5,
					sizeY: 3.5 + (i % 3) * 0.8,
					sizeZ: 2.5 + (i % 2) * 0.5,
					hp: 120 + (i % 3) * 40,
					score: 150 + i * 40,
					category: cat as any,
				});
			}
		}

		return configs;
	}

	/**
	 * Computes exact real-time parabolic trajectory points taking Rapier gravity & damping into account
	 */
	public computeTrajectoryPoints(
		pitchDeg: number,
		yawDeg: number,
		powerMps: number,
		maxSteps: number = 80,
	): Array<{ x: number; y: number; z: number }> {
		const points: Array<{ x: number; y: number; z: number }> = [];

		const pitchRad = (pitchDeg * Math.PI) / 180;
		const yawRad = (yawDeg * Math.PI) / 180;

		const muzzleOffset = 3.2;
		let currX = -Math.sin(yawRad) * Math.cos(pitchRad) * muzzleOffset;
		let currY = 2.0 + Math.sin(pitchRad) * muzzleOffset;
		let currZ = Math.cos(yawRad) * Math.cos(pitchRad) * muzzleOffset;

		let vx = -Math.sin(yawRad) * Math.cos(pitchRad) * powerMps;
		let vy = Math.sin(pitchRad) * powerMps;
		let vz = Math.cos(yawRad) * Math.cos(pitchRad) * powerMps;

		const dt = 0.04; // 25 fps simulation step
		const g = -9.81;
		const linearDamping = 0.02;

		points.push({ x: currX, y: currY, z: currZ });

		for (let step = 0; step < maxSteps; step++) {
			// Apply gravity & damping
			vy += g * dt;
			vx += this.windVector.x * dt * 0.2;
			vz += this.windVector.z * dt * 0.2;

			vx *= 1.0 - linearDamping * dt;
			vy *= 1.0 - linearDamping * dt;
			vz *= 1.0 - linearDamping * dt;

			currX += vx * dt;
			currY += vy * dt;
			currZ += vz * dt;

			points.push({ x: currX, y: currY, z: currZ });

			// Stop preview if hitting ground
			if (currY <= 0.2) break;
		}

		return points;
	}

	public launchShell(
		pitchDeg: number,
		yawDeg: number,
		powerMps: number,
		shellType: ShellType = "BASIC",
	): Cannonball | null {
		if (this.activeBalls.some((b) => b.active)) {
			return null;
		}

		const pitchRad = (pitchDeg * Math.PI) / 180;
		const yawRad = (yawDeg * Math.PI) / 180;

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

		const radius =
			shellType === "CLUSTER" ? 0.45 : shellType === "GRAPPLE" ? 0.5 : 0.4;
		const ballColliderDesc = RAPIER.ColliderDesc.ball(radius)
			.setDensity(shellType === "ICE" ? 5.0 : 8.0)
			.setRestitution(0.2)
			.setFriction(0.5);

		const ballCollider = this.world.createCollider(ballColliderDesc, ballBody);

		const vx = -Math.sin(yawRad) * Math.cos(pitchRad) * powerMps;
		const vy = Math.sin(pitchRad) * powerMps;
		const vz = Math.cos(yawRad) * Math.cos(pitchRad) * powerMps;

		ballBody.setLinvel({ x: vx, y: vy, z: vz }, true);

		const ball: Cannonball = {
			id: `ball_${Date.now()}`,
			body: ballBody,
			collider: ballCollider,
			active: true,
			spawnTime: performance.now(),
			shellType,
			spawnPos: { x: spawnX, y: spawnY, z: spawnZ },
			trajectoryPoints: [{ x: spawnX, y: spawnY, z: spawnZ }],
			hasSplit: false,
		};

		this.activeBalls.push(ball);
		this.activeGrappleCable = null;

		return ball;
	}

	public update(_dt: number): {
		impact: ImpactRecord | null;
		destroyedTargets: string[];
		coinsEarned: number;
		comboCount: number;
		slowMoTrigger: boolean;
	} {
		if (!this.isInitialized)
			return {
				impact: null,
				destroyedTargets: [],
				coinsEarned: 0,
				comboCount: 0,
				slowMoTrigger: false,
			};

		// Track active ball trajectory
		this.activeBalls.forEach((b) => {
			if (b.active) {
				const pos = b.body.translation();
				b.trajectoryPoints.push({ x: pos.x, y: pos.y, z: pos.z });

				// CLUSTER SHELL AUTO-SPLIT at ~45m travel distance!
				if (b.shellType === "CLUSTER" && !b.hasSplit) {
					const distTraveled = Math.hypot(
						pos.x - b.spawnPos.x,
						pos.z - b.spawnPos.z,
					);
					if (distTraveled >= 40.0 || pos.z >= 38.0) {
						this.splitClusterShell(b);
					}
				}
			}
		});

		// Step Rapier physics world
		this.world.step();

		const destroyedTargets: string[] = [];
		let impactRecord: ImpactRecord | null = null;
		let totalCoinsThisFrame = 0;
		let slowMoTrigger = false;

		// Process collisions for all active balls
		for (let i = this.activeBalls.length - 1; i >= 0; i--) {
			const ball = this.activeBalls[i];
			if (!ball || !ball.active) continue;

			const pos = ball.body.translation();
			const vel = ball.body.linvel();
			const speed = Math.hypot(vel.x, vel.y, vel.z);

			// Check target collision
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

			const hitGround = pos.y <= 0.4;
			const timedOut = performance.now() - ball.spawnTime > 8000;
			const stoppedMoving = pos.y < 2.0 && speed < 1.0;

			if (directHitTarget || hitGround || timedOut || stoppedMoving) {
				ball.active = false;

				if (ball.shellType !== "BASIC") {
					slowMoTrigger = true; // Cinematic slow-mo on special shell hits
				}

				let closestTargetId: string | null = null;
				let minDistance = Infinity;

				this.targets.forEach((target) => {
					if (target.isDestroyed) return;
					const tPos = target.body.translation();
					const dist = Math.hypot(
						tPos.x - pos.x,
						tPos.y - pos.y,
						tPos.z - pos.z,
					);
					const distXZ = Math.hypot(tPos.x - pos.x, tPos.z - pos.z);

					if (distXZ < minDistance) {
						minDistance = distXZ;
						closestTargetId = target.id;
					}

					const isDirect = directHitTarget && directHitTarget.id === target.id;
					const splashRadius = ball.shellType === "CLUSTER" ? 6.0 : 4.5;

					if (isDirect || dist < splashRadius) {
						let baseDamage = isDirect
							? 220
							: Math.max(30, Math.floor((1 - dist / splashRadius) * 160));

						// Frozen targets take 2.5x damage multiplier (fragile!)
						if (target.isFrozen) {
							baseDamage = Math.floor(baseDamage * 2.5);
						}

						// ICE SHELL: Freezes target block
						if (ball.shellType === "ICE" && (isDirect || dist < 3.5)) {
							target.isFrozen = true;
							target.body.setLinearDamping(1.5); // Slippery / brittle block
						}

						target.hp -= baseDamage;
						totalCoinsThisFrame += Math.max(5, Math.floor(baseDamage / 10));

						// Impulse application
						const forceMult = isDirect ? 35 : 20;
						if (ball.shellType === "GRAPPLE" && isDirect) {
							// GRAPPLE HOOK: Applies massive pulling force back towards cannon!
							target.isGrappled = true;
							const pullX = -tPos.x * 60;
							const pullY = 15;
							const pullZ = -tPos.z * 60;
							target.body.applyImpulse({ x: pullX, y: pullY, z: pullZ }, true);
							this.activeGrappleCable = {
								start: { x: 0, y: 2, z: 2 },
								end: { x: tPos.x, y: tPos.y, z: tPos.z },
							};
						} else {
							const forceX =
								(tPos.x - pos.x) * forceMult + (isDirect ? -vel.x * 2 : 0);
							const forceY = 25 + Math.abs(vel.y) * 2;
							const forceZ =
								(tPos.z - pos.z) * forceMult + (isDirect ? vel.z * 2 : 0);
							target.body.applyImpulse(
								{ x: forceX, y: forceY, z: forceZ },
								true,
							);
						}

						// Destruction check
						if (target.hp <= 0 && !target.isDestroyed) {
							target.isDestroyed = true;
							destroyedTargets.push(target.id);
							totalCoinsThisFrame += target.scoreValue;
						}
					}
				});

				impactRecord = {
					position: { x: pos.x, y: Math.max(0, pos.y), z: pos.z },
					targetHitId: closestTargetId,
					distanceToTarget: Math.round(minDistance * 10) / 10,
					pitch: 0,
					yaw: 0,
					power: 0,
					shellType: ball.shellType,
				};

				this.lastImpact = impactRecord;
				this.impactHistory.push(impactRecord);

				// Cleanup ball body
				setTimeout(() => {
					try {
						this.world.removeRigidBody(ball.body);
					} catch (_e) {}
				}, 1000);
			}
		}

		// Update combo state
		const now = performance.now();
		if (destroyedTargets.length > 0) {
			if (now - this.lastDestroyTime < 2500) {
				this.comboCount += destroyedTargets.length;
			} else {
				this.comboCount = destroyedTargets.length;
			}
			this.lastDestroyTime = now;

			// Combo Coin multiplier
			const multiplier =
				this.comboCount >= 3 ? 3 : this.comboCount === 2 ? 1.8 : 1.0;
			totalCoinsThisFrame = Math.floor(totalCoinsThisFrame * multiplier);
			this.coinsEarned += totalCoinsThisFrame;
		}

		// Remove inactive balls from array
		this.activeBalls = this.activeBalls.filter(
			(b) => b.active || performance.now() - b.spawnTime < 1200,
		);

		// Sync visual positions of target bodies
		this.targets.forEach((target) => {
			if (!target.isDestroyed) {
				const p = target.body.translation();
				target.position = { x: p.x, y: p.y, z: p.z };
			}
		});

		return {
			impact: impactRecord,
			destroyedTargets,
			coinsEarned: totalCoinsThisFrame,
			comboCount: this.comboCount,
			slowMoTrigger,
		};
	}

	private splitClusterShell(parentBall: Cannonball) {
		parentBall.hasSplit = true;
		const pos = parentBall.body.translation();
		const vel = parentBall.body.linvel();

		// Spawn 5 sub-munition bombs in radial cone
		for (let i = 0; i < 5; i++) {
			const angle = (i / 5) * Math.PI * 2;
			const spreadSpeed = 8.0;
			const subVx = vel.x + Math.cos(angle) * spreadSpeed;
			const subVy = vel.y + 4.0 + (Math.random() - 0.5) * 3.0;
			const subVz = vel.z + Math.sin(angle) * spreadSpeed;

			const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(
					pos.x + (Math.random() - 0.5),
					pos.y,
					pos.z + (Math.random() - 0.5),
				)
				.setCcdEnabled(true)
				.setLinearDamping(0.02);

			const body = this.world.createRigidBody(bodyDesc);
			const colliderDesc = RAPIER.ColliderDesc.ball(0.28)
				.setDensity(6.0)
				.setRestitution(0.3);
			const collider = this.world.createCollider(colliderDesc, body);

			body.setLinvel({ x: subVx, y: subVy, z: subVz }, true);

			this.activeBalls.push({
				id: `sub_${parentBall.id}_${i}`,
				body,
				collider,
				active: true,
				spawnTime: performance.now(),
				shellType: "CLUSTER",
				spawnPos: { x: pos.x, y: pos.y, z: pos.z },
				trajectoryPoints: [{ x: pos.x, y: pos.y, z: pos.z }],
				isSubMunition: true,
			});
		}
	}

	public getCastleIntegrity(): {
		totalHpRatio: number;
		towerLeft: number;
		towerRight: number;
		gate: number;
		keep: number;
	} {
		let totalHp = 0;
		let totalMaxHp = 0;

		const categoryHp = {
			tower_left: { current: 0, max: 0 },
			tower_right: { current: 0, max: 0 },
			gate: { current: 0, max: 0 },
			keep: { current: 0, max: 0 },
			wall: { current: 0, max: 0 },
		};

		this.targets.forEach((t) => {
			const hp = t.isDestroyed ? 0 : Math.max(0, t.hp);
			totalHp += hp;
			totalMaxHp += t.maxHp;

			const cat = t.category || "keep";
			if (categoryHp[cat]) {
				categoryHp[cat].current += hp;
				categoryHp[cat].max += t.maxHp;
			}
		});

		const getRatio = (c: { current: number; max: number }) =>
			c.max > 0 ? Math.round((c.current / c.max) * 100) : 100;

		return {
			totalHpRatio:
				totalMaxHp > 0 ? Math.round((totalHp / totalMaxHp) * 100) : 100,
			towerLeft: getRatio(categoryHp.tower_left),
			towerRight: getRatio(categoryHp.tower_right),
			gate: getRatio(categoryHp.gate),
			keep: getRatio(categoryHp.keep),
		};
	}

	public clearLevel() {
		this.activeBalls.forEach((b) => {
			try {
				this.world.removeRigidBody(b.body);
			} catch (_e) {}
		});
		this.activeBalls = [];

		this.targets.forEach((target) => {
			try {
				this.world.removeRigidBody(target.body);
			} catch (_e) {}
		});
		this.targets.clear();
		this.impactHistory = [];
		this.lastImpact = null;
		this.activeGrappleCable = null;
	}
}
