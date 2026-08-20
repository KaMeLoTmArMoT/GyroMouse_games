import * as THREE from "three";

export interface BoundingBox3D {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
}

export class Runner {
	public mesh: THREE.Group;
	private torsoMesh!: THREE.Mesh;
	private headMesh!: THREE.Mesh;

	public currentLane: number = 0; // -1: Left, 0: Center, 1: Right
	public targetX: number = 0;
	public posX: number = 0;
	public posY: number = 0;
	public posZ: number = 0;

	public isJumping: boolean = false;
	public isSliding: boolean = false;

	private velY: number = 0;
	private slideTimer: number = 0;
	private readonly LANE_DISTANCE: number = 2.4;
	private readonly GRAVITY: number = -38;
	private readonly JUMP_IMPULSE: number = 13.5;

	constructor(scene: THREE.Scene) {
		this.mesh = new THREE.Group();
		this.createCharacterModel();
		scene.add(this.mesh);
	}

	private createCharacterModel() {
		// Stylized Cyber Character
		const bodyMat = new THREE.MeshStandardMaterial({
			color: "#38bdf8",
			roughness: 0.3,
			metalness: 0.6,
		});
		const headMat = new THREE.MeshStandardMaterial({
			color: "#c084fc",
			roughness: 0.2,
			metalness: 0.8,
		});
		const visorMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });

		// Torso
		const torsoGeo = new THREE.BoxGeometry(0.7, 1.0, 0.4);
		this.torsoMesh = new THREE.Mesh(torsoGeo, bodyMat);
		this.torsoMesh.position.y = 0.9;
		this.torsoMesh.castShadow = true;
		this.mesh.add(this.torsoMesh);

		// Head
		const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
		this.headMesh = new THREE.Mesh(headGeo, headMat);
		this.headMesh.position.y = 1.7;
		this.headMesh.castShadow = true;
		this.mesh.add(this.headMesh);

		// Visor
		const visorGeo = new THREE.BoxGeometry(0.4, 0.15, 0.1);
		const visor = new THREE.Mesh(visorGeo, visorMat);
		visor.position.set(0, 1.72, 0.23);
		this.mesh.add(visor);

		// Legs
		const legGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
		const legL = new THREE.Mesh(legGeo, bodyMat);
		legL.position.set(-0.2, 0.3, 0);
		legL.castShadow = true;
		this.mesh.add(legL);

		const legR = new THREE.Mesh(legGeo, bodyMat);
		legR.position.set(0.2, 0.3, 0);
		legR.castShadow = true;
		this.mesh.add(legR);

		// Visual Power-Up 1: Shield Energy Bubble
		const shieldGeo = new THREE.SphereGeometry(1.2, 16, 16);
		const shieldMat = new THREE.MeshBasicMaterial({
			color: "#10b981",
			transparent: true,
			opacity: 0.35,
			wireframe: true,
		});
		this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
		this.shieldMesh.position.y = 1.0;
		this.shieldMesh.visible = false;
		this.mesh.add(this.shieldMesh);

		// Visual Power-Up 2: Jetpack Thrusters
		this.jetpackMesh = new THREE.Group();
		const tankGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8);
		const tankMat = new THREE.MeshStandardMaterial({
			color: "#f97316",
			metalness: 0.8,
			roughness: 0.2,
		});
		const tankL = new THREE.Mesh(tankGeo, tankMat);
		tankL.position.set(-0.2, 1.0, -0.28);
		const tankR = new THREE.Mesh(tankGeo, tankMat);
		tankR.position.set(0.2, 1.0, -0.28);
		this.jetpackMesh.add(tankL);
		this.jetpackMesh.add(tankR);

		// Jet flame cones
		const flameGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
		const flameMat = new THREE.MeshBasicMaterial({ color: "#fbbf24" });
		const flameL = new THREE.Mesh(flameGeo, flameMat);
		flameL.rotation.x = Math.PI;
		flameL.position.set(-0.2, 0.6, -0.28);
		const flameR = new THREE.Mesh(flameGeo, flameMat);
		flameR.rotation.x = Math.PI;
		flameR.position.set(0.2, 0.6, -0.28);
		this.jetpackMesh.add(flameL);
		this.jetpackMesh.add(flameR);
		this.jetpackMesh.visible = false;
		this.mesh.add(this.jetpackMesh);
	}

	private shieldMesh!: THREE.Mesh;
	private jetpackMesh!: THREE.Group;

	public activePowerUp: "magnet" | "shield" | "jetpack" | null = null;
	public powerUpTimer: number = 0;
	public maxPowerUpTimer: number = 0;
	public hasShield: boolean = false;

	public activatePowerUp(type: "magnet" | "shield" | "jetpack") {
		if (type === "shield") {
			this.hasShield = true;
			this.shieldMesh.visible = true;
			return;
		}

		this.activePowerUp = type;
		if (type === "magnet") {
			this.powerUpTimer = 10.0;
			this.maxPowerUpTimer = 10.0;
		} else if (type === "jetpack") {
			this.powerUpTimer = 6.0;
			this.maxPowerUpTimer = 6.0;
			this.jetpackMesh.visible = true;
		}
	}

	public steer(direction: -1 | 1) {
		this.currentLane = Math.max(-1, Math.min(1, this.currentLane - direction));
		this.targetX = this.currentLane * this.LANE_DISTANCE;
	}

	public jump() {
		if (!this.isJumping && !this.isSliding) {
			this.isJumping = true;
			this.velY = this.JUMP_IMPULSE;
		}
	}

	public slide() {
		if (!this.isSliding) {
			this.isSliding = true;
			this.slideTimer = 0.65; // Seconds sliding
			// Fast drop if in air
			if (this.isJumping) {
				this.velY = -20;
			}
		}
	}

	public groundY: number = 0;
	public stumbleTimer: number = 0;

	public triggerStumble(duration: number = 7.0) {
		this.stumbleTimer = duration;
	}

	public update(dt: number, forwardSpeed: number, targetGroundY: number = 0) {
		this.groundY = targetGroundY;

		// Power-Up Timer Countdown
		if (this.powerUpTimer > 0) {
			this.powerUpTimer -= dt;
			if (this.powerUpTimer <= 0) {
				this.activePowerUp = null;
				this.jetpackMesh.visible = false;
			}
		}

		// Shield Aura Rotation
		if (this.hasShield) {
			this.shieldMesh.visible = true;
			this.shieldMesh.rotation.y += dt * 2.5;
		} else {
			this.shieldMesh.visible = false;
		}

		// Stumble invulnerability & blinking
		if (this.stumbleTimer > 0) {
			this.stumbleTimer -= dt;
			// Fast blink (every 80ms)
			this.mesh.visible = Math.floor(this.stumbleTimer * 12) % 2 === 0;
		} else {
			this.mesh.visible = true;
		}

		// Forward progression
		this.posZ += forwardSpeed * dt;

		// Lateral smooth transition
		this.posX += (this.targetX - this.posX) * Math.min(1.0, dt * 15.0);

		// Jetpack Flight Mode vs Standard Jump & Gravity
		if (this.activePowerUp === "jetpack") {
			this.jetpackMesh.visible = true;
			this.posY += (6.0 - this.posY) * Math.min(1.0, dt * 10.0);
			this.velY = 0;
			this.isJumping = false;
		} else if (this.isJumping || this.posY > this.groundY) {
			this.velY += this.GRAVITY * dt;
			this.posY += this.velY * dt;

			if (this.posY <= this.groundY) {
				this.posY = this.groundY;
				this.velY = 0;
				this.isJumping = false;
			}
		} else if (this.posY < this.groundY) {
			this.posY = this.groundY;
			this.velY = 0;
			this.isJumping = false;
		}

		// Slide timer
		if (this.isSliding) {
			this.slideTimer -= dt;
			if (this.slideTimer <= 0) {
				this.isSliding = false;
			}
		}

		// Update meshes position & crouch transform animation
		this.mesh.position.set(this.posX, this.posY, this.posZ);

		if (this.isSliding) {
			this.mesh.scale.y = 0.5;
			this.mesh.position.y = this.posY - 0.2;
		} else {
			this.mesh.scale.y = 1.0;
		}

		// Running bounce & tilt
		if (!this.isJumping && !this.isSliding && this.activePowerUp !== "jetpack") {
			const bounce = Math.sin(this.posZ * 3.0) * 0.08;
			this.torsoMesh.position.y = 0.9 + bounce;
			this.headMesh.position.y = 1.7 + bounce;
		}
	}

	public getBoundingBox(): BoundingBox3D {
		const height = this.isSliding ? 0.6 : 1.8;
		return {
			minX: this.posX - 0.35,
			maxX: this.posX + 0.35,
			minY: this.posY,
			maxY: this.posY + height,
			minZ: this.posZ - 0.3,
			maxZ: this.posZ + 0.3,
		};
	}

	public reset() {
		this.currentLane = 0;
		this.targetX = 0;
		this.posX = 0;
		this.posY = 0;
		this.posZ = 0;
		this.velY = 0;
		this.groundY = 0;
		this.stumbleTimer = 0;
		this.activePowerUp = null;
		this.powerUpTimer = 0;
		this.maxPowerUpTimer = 0;
		this.hasShield = false;
		this.shieldMesh.visible = false;
		this.jetpackMesh.visible = false;
		this.isJumping = false;
		this.isSliding = false;
		this.slideTimer = 0;
		this.mesh.visible = true;
		this.mesh.position.set(0, 0, 0);
	}
}
