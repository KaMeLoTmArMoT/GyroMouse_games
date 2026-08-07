import * as THREE from "three";
import type { Cannonball, TargetStructure } from "../physics/artilleryPhysics";

export class ArtilleryGraphicsManager {
	public scene!: THREE.Scene;
	public camera!: THREE.PerspectiveCamera;
	public renderer!: THREE.WebGLRenderer;

	// Cannon visual parts
	public cannonBaseGroup!: THREE.Group;
	public cannonBarrelGroup!: THREE.Group;
	public cannonMesh!: THREE.Mesh;

	// Visual Target Meshes
	public targetMeshes: Map<string, THREE.Group> = new Map();

	// Active Cannonball Meshes & Trails
	public ballMeshes: Map<string, THREE.Mesh> = new Map();
	public ballTrailPoints: Map<string, THREE.Vector3[]> = new Map();
	public ballTrailLines: Map<string, THREE.Line> = new Map();

	// Parabolic Trajectory Arc & Target Marker
	public trajectoryArcLine: THREE.Line | null = null;
	public targetCrosshairMesh: THREE.Group | null = null;

	// Grapple Cable Line
	public grappleCableLine: THREE.Line | null = null;

	// Impact Craters on ground
	public craterGroup!: THREE.Group;

	// GPU / Instanced Explosion Particle System Pool
	private maxParticles = 300;
	private particleInstancedMesh!: THREE.InstancedMesh;
	private particleDummy = new THREE.Object3D();
	private particleData: Array<{
		active: boolean;
		position: THREE.Vector3;
		velocity: THREE.Vector3;
		scale: number;
		life: number;
		maxLife: number;
		colorType: "fire" | "smoke" | "spark" | "ice";
	}> = [];

	// Textures & Materials
	private groundTexture!: THREE.CanvasTexture;
	private skyTexture!: THREE.CanvasTexture;
	private woodTexture!: THREE.CanvasTexture;
	private metalTexture!: THREE.CanvasTexture;

	private iceMaterial!: THREE.MeshStandardMaterial;

	// Camera State & Slow-Mo
	private defaultCamPos = new THREE.Vector3(0, 5, -9);
	private defaultCamLookAt = new THREE.Vector3(0, 3, 20);
	public currentCamPos = new THREE.Vector3().copy(this.defaultCamPos);
	public currentCamLookAt = new THREE.Vector3().copy(this.defaultCamLookAt);
	public slowMoFactor = 1.0;

	// Recoil State
	private recoilOffset: number = 0;

	public init(canvas: HTMLCanvasElement) {
		this.createProceduralTextures();

		// Scene
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x0c102b);
		this.scene.fog = new THREE.FogExp2(0x0c102b, 0.004);

		// Camera
		this.camera = new THREE.PerspectiveCamera(
			60,
			window.innerWidth / window.innerHeight,
			0.1,
			600,
		);
		this.camera.position.copy(this.defaultCamPos);
		this.camera.lookAt(this.defaultCamLookAt);

		// Renderer
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		// Lighting
		const ambientLight = new THREE.AmbientLight(0xffedd5, 0.75);
		this.scene.add(ambientLight);

		const dirLight = new THREE.DirectionalLight(0xfff1f2, 1.35);
		dirLight.position.set(40, 70, -30);
		dirLight.castShadow = true;
		dirLight.shadow.mapSize.width = 2048;
		dirLight.shadow.mapSize.height = 2048;
		dirLight.shadow.camera.near = 0.5;
		dirLight.shadow.camera.far = 300;
		dirLight.shadow.camera.left = -60;
		dirLight.shadow.camera.right = 60;
		dirLight.shadow.camera.top = 120;
		dirLight.shadow.camera.bottom = -20;
		this.scene.add(dirLight);

		// Build Scene Elements
		this.buildSky();
		this.buildTerrain();
		this.buildCannon();
		this.setupGPUInstancedParticles();

		// Crater Container
		this.craterGroup = new THREE.Group();
		this.scene.add(this.craterGroup);

		// Target Crosshair Ground Ring
		this.buildTargetCrosshair();

		window.addEventListener("resize", this.onWindowResize.bind(this));
	}

	private createProceduralTextures() {
		// Ground Texture
		const gCanvas = document.createElement("canvas");
		gCanvas.width = 512;
		gCanvas.height = 512;
		const gCtx = gCanvas.getContext("2d")!;
		gCtx.fillStyle = "#1e293b";
		gCtx.fillRect(0, 0, 512, 512);

		for (let i = 0; i < 4000; i++) {
			const x = Math.random() * 512;
			const y = Math.random() * 512;
			const size = 1 + Math.random() * 3;
			gCtx.fillStyle = Math.random() > 0.5 ? "#111827" : "#334155";
			gCtx.fillRect(x, y, size, size);
		}
		gCtx.strokeStyle = "rgba(56, 189, 248, 0.15)";
		gCtx.lineWidth = 2;
		for (let c = 0; c <= 512; c += 64) {
			gCtx.beginPath();
			gCtx.moveTo(c, 0);
			gCtx.lineTo(c, 512);
			gCtx.moveTo(0, c);
			gCtx.lineTo(512, c);
			gCtx.stroke();
		}
		this.groundTexture = new THREE.CanvasTexture(gCanvas);
		this.groundTexture.wrapS = THREE.RepeatWrapping;
		this.groundTexture.wrapT = THREE.RepeatWrapping;
		this.groundTexture.repeat.set(12, 12);

		// Sky Gradient
		const sCanvas = document.createElement("canvas");
		sCanvas.width = 1024;
		sCanvas.height = 512;
		const sCtx = sCanvas.getContext("2d")!;
		const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
		skyGrad.addColorStop(0, "#090d16");
		skyGrad.addColorStop(0.4, "#1e1b4b");
		skyGrad.addColorStop(0.75, "#431407");
		skyGrad.addColorStop(1, "#9a3412");
		sCtx.fillStyle = skyGrad;
		sCtx.fillRect(0, 0, 1024, 512);

		sCtx.fillStyle = "#ffffff";
		for (let i = 0; i < 150; i++) {
			const sx = Math.random() * 1024;
			const sy = Math.random() * 250;
			const sr = Math.random() * 1.5;
			sCtx.beginPath();
			sCtx.arc(sx, sy, sr, 0, Math.PI * 2);
			sCtx.fill();
		}
		this.skyTexture = new THREE.CanvasTexture(sCanvas);

		// Metal Texture
		const mCanvas = document.createElement("canvas");
		mCanvas.width = 256;
		mCanvas.height = 256;
		const mCtx = mCanvas.getContext("2d")!;
		mCtx.fillStyle = "#1e293b";
		mCtx.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 800; i++) {
			mCtx.fillStyle = Math.random() > 0.5 ? "#334155" : "#0f172a";
			mCtx.fillRect(0, Math.random() * 256, 256, 1);
		}
		this.metalTexture = new THREE.CanvasTexture(mCanvas);

		// Wood Texture
		const wCanvas = document.createElement("canvas");
		wCanvas.width = 256;
		wCanvas.height = 256;
		const wCtx = wCanvas.getContext("2d")!;
		wCtx.fillStyle = "#9a3412";
		wCtx.fillRect(0, 0, 256, 256);
		wCtx.fillStyle = "#7c2d12";
		for (let y = 0; y < 256; y += 32) {
			wCtx.fillRect(0, y, 256, 3);
		}
		this.woodTexture = new THREE.CanvasTexture(wCanvas);

		// Ice Freeze Material
		this.iceMaterial = new THREE.MeshStandardMaterial({
			color: 0x38bdf8,
			roughness: 0.1,
			metalness: 0.8,
			emissive: 0x0284c7,
			emissiveIntensity: 0.5,
			transparent: true,
			opacity: 0.9,
		});
	}

	private buildSky() {
		const skyGeo = new THREE.SphereGeometry(450, 32, 16);
		const skyMat = new THREE.MeshBasicMaterial({
			map: this.skyTexture,
			side: THREE.BackSide,
		});
		const skyMesh = new THREE.Mesh(skyGeo, skyMat);
		this.scene.add(skyMesh);
	}

	private buildTerrain() {
		const groundGeo = new THREE.PlaneGeometry(350, 350, 40, 40);
		const groundMat = new THREE.MeshStandardMaterial({
			map: this.groundTexture,
			roughness: 0.8,
			metalness: 0.2,
		});
		const ground = new THREE.Mesh(groundGeo, groundMat);
		ground.rotation.x = -Math.PI / 2;
		ground.position.set(0, 0, 100);
		ground.receiveShadow = true;
		this.scene.add(ground);

		// Distance Marker Bands
		for (let d = 20; d <= 90; d += 10) {
			const lineGeo = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(-45, 0.1, d),
				new THREE.Vector3(45, 0.1, d),
			]);
			const lineMat = new THREE.LineDashedMaterial({
				color: 0xef4444,
				dashSize: 1.5,
				gapSize: 1.0,
				opacity: 0.6,
				transparent: true,
			});
			const line = new THREE.Line(lineGeo, lineMat);
			line.computeLineDistances();
			this.scene.add(line);
		}
	}

	private buildCannon() {
		this.cannonBaseGroup = new THREE.Group();
		this.cannonBaseGroup.position.set(0, 0, 0);

		const baseGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.8, 16);
		const baseMat = new THREE.MeshStandardMaterial({
			map: this.metalTexture,
			color: 0x475569,
			metalness: 0.8,
			roughness: 0.3,
		});
		const baseMesh = new THREE.Mesh(baseGeo, baseMat);
		baseMesh.position.y = 0.4;
		baseMesh.castShadow = true;
		this.cannonBaseGroup.add(baseMesh);

		const bracketGeo = new THREE.BoxGeometry(0.5, 1.4, 1.2);
		const bracketMat = new THREE.MeshStandardMaterial({
			map: this.metalTexture,
			color: 0x334155,
			metalness: 0.7,
			roughness: 0.4,
		});
		const leftBracket = new THREE.Mesh(bracketGeo, bracketMat);
		leftBracket.position.set(-1.1, 1.2, 0);
		leftBracket.castShadow = true;

		const rightBracket = new THREE.Mesh(bracketGeo, bracketMat);
		rightBracket.position.set(1.1, 1.2, 0);
		rightBracket.castShadow = true;

		this.cannonBaseGroup.add(leftBracket, rightBracket);

		this.cannonBarrelGroup = new THREE.Group();
		this.cannonBarrelGroup.position.set(0, 1.5, 0);

		const barrelGeo = new THREE.CylinderGeometry(0.5, 0.75, 4.2, 16);
		barrelGeo.rotateX(Math.PI / 2);
		barrelGeo.translate(0, 0, 2.1);

		const barrelMat = new THREE.MeshStandardMaterial({
			map: this.metalTexture,
			color: 0x1e293b,
			metalness: 0.9,
			roughness: 0.2,
		});
		this.cannonMesh = new THREE.Mesh(barrelGeo, barrelMat);
		this.cannonMesh.castShadow = true;
		this.cannonMesh.position.set(0, 0, 0);

		const ringGeo = new THREE.TorusGeometry(0.55, 0.08, 8, 16);
		const ringMat = new THREE.MeshStandardMaterial({
			color: 0xf59e0b,
			metalness: 0.9,
			roughness: 0.2,
		});
		const ringMesh = new THREE.Mesh(ringGeo, ringMat);
		ringMesh.position.set(0, 0, 3.8);
		this.cannonMesh.add(ringMesh);

		this.cannonBarrelGroup.add(this.cannonMesh);
		this.cannonBaseGroup.add(this.cannonBarrelGroup);
		this.scene.add(this.cannonBaseGroup);
	}

	private setupGPUInstancedParticles() {
		const particleGeo = new THREE.SphereGeometry(0.3, 8, 8);
		const particleMat = new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: 0.9,
		});

		this.particleInstancedMesh = new THREE.InstancedMesh(
			particleGeo,
			particleMat,
			this.maxParticles,
		);
		this.particleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.scene.add(this.particleInstancedMesh);

		for (let i = 0; i < this.maxParticles; i++) {
			this.particleData.push({
				active: false,
				position: new THREE.Vector3(),
				velocity: new THREE.Vector3(),
				scale: 1.0,
				life: 0,
				maxLife: 1.0,
				colorType: "fire",
			});
			this.particleDummy.position.set(0, -999, 0);
			this.particleDummy.scale.set(0.001, 0.001, 0.001);
			this.particleDummy.updateMatrix();
			this.particleInstancedMesh.setMatrixAt(i, this.particleDummy.matrix);
		}
		this.particleInstancedMesh.instanceMatrix.needsUpdate = true;
	}

	private buildTargetCrosshair() {
		this.targetCrosshairMesh = new THREE.Group();

		const ringGeo = new THREE.RingGeometry(1.2, 1.5, 24);
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x38bdf8,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.85,
		});
		const ring = new THREE.Mesh(ringGeo, ringMat);
		ring.rotation.x = -Math.PI / 2;

		const line1Geo = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-2.2, 0.05, 0),
			new THREE.Vector3(2.2, 0.05, 0),
		]);
		const line2Geo = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0.05, -2.2),
			new THREE.Vector3(0, 0.05, 2.2),
		]);
		const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });

		this.targetCrosshairMesh.add(
			ring,
			new THREE.Line(line1Geo, lineMat),
			new THREE.Line(line2Geo, lineMat),
		);
		this.targetCrosshairMesh.position.set(0, 0.1, 40);
		this.scene.add(this.targetCrosshairMesh);
	}

	public renderTrajectoryPreview(
		points: Array<{ x: number; y: number; z: number }>,
	) {
		if (this.trajectoryArcLine) {
			this.scene.remove(this.trajectoryArcLine);
			this.trajectoryArcLine = null;
		}

		if (points.length < 2) return;

		const vecPoints = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
		const lineGeo = new THREE.BufferGeometry().setFromPoints(vecPoints);
		const lineMat = new THREE.LineDashedMaterial({
			color: 0x38bdf8,
			dashSize: 1.0,
			gapSize: 0.5,
			linewidth: 3,
		});
		this.trajectoryArcLine = new THREE.Line(lineGeo, lineMat);
		this.trajectoryArcLine.computeLineDistances();
		this.scene.add(this.trajectoryArcLine);

		// Position target landing crosshair
		const lastPt = points[points.length - 1];
		if (this.targetCrosshairMesh && lastPt) {
			this.targetCrosshairMesh.position.set(lastPt.x, 0.1, lastPt.z);
			this.targetCrosshairMesh.visible = true;
		}
	}

	public updateTurretOrientation(pitchDeg: number, yawDeg: number) {
		const yawRad = (yawDeg * Math.PI) / 180;
		this.cannonBaseGroup.rotation.y = -yawRad;
		this.cannonBarrelGroup.rotation.x = -(pitchDeg * Math.PI) / 180;

		const camDist = 9.0;
		const camHeight = 4.5;
		const lookDist = 25.0;

		const camX = Math.sin(yawRad) * camDist;
		const camZ = -Math.cos(yawRad) * camDist;

		const lookX = -Math.sin(yawRad) * lookDist;
		const lookZ = Math.cos(yawRad) * lookDist;

		this.defaultCamPos.set(camX, camHeight, camZ);
		this.defaultCamLookAt.set(lookX, 3.0, lookZ);
	}

	// Voxel Debris Meshes
	public voxelMeshes: Map<string, THREE.Mesh> = new Map();

	public syncTargets(targets: Map<string, TargetStructure>) {
		targets.forEach((target, id) => {
			let group = this.targetMeshes.get(id);

			if (!group) {
				group = new THREE.Group();

				const boxGeo = new THREE.BoxGeometry(
					target.size.x,
					target.size.y,
					target.size.z,
				);
				const boxMat = new THREE.MeshStandardMaterial({
					map: this.woodTexture,
					color: 0xef4444,
					metalness: 0.2,
					roughness: 0.7,
				});
				const boxMesh = new THREE.Mesh(boxGeo, boxMat);
				boxMesh.castShadow = true;
				boxMesh.receiveShadow = true;
				group.add(boxMesh);

				const ringGeo = new THREE.RingGeometry(0.3, 0.9, 16);
				const ringMat = new THREE.MeshBasicMaterial({
					color: 0xffffff,
					side: THREE.DoubleSide,
				});
				const ringMesh = new THREE.Mesh(ringGeo, ringMat);
				ringMesh.position.set(0, 0, target.size.z / 2 + 0.01);
				group.add(ringMesh);

				this.scene.add(group);
				this.targetMeshes.set(id, group);
			}

			if (target.isDestroyed) {
				group.visible = false; // Solid block disappears, replaced by shattered voxel chunks!
			} else {
				group.visible = true;
				group.position.set(
					target.position.x,
					target.position.y,
					target.position.z,
				);

				const boxMesh = group.children[0] as THREE.Mesh;
				if (target.isFrozen) {
					boxMesh.material = this.iceMaterial;
				} else {
					const hpRatio = target.hp / target.maxHp;
					const mat = boxMesh.material as THREE.MeshStandardMaterial;
					mat.color.setHSL(0.0 + hpRatio * 0.15, 0.8, 0.45);
				}
			}
		});
	}

	public syncVoxelChunks(chunks: Array<any>) {
		const now = performance.now();
		chunks.forEach((chunk) => {
			let mesh = this.voxelMeshes.get(chunk.id);
			if (!mesh) {
				const boxGeo = new THREE.BoxGeometry(
					chunk.size.x,
					chunk.size.y,
					chunk.size.z,
				);
				const mat = chunk.isFrozen
					? this.iceMaterial
					: new THREE.MeshStandardMaterial({
							map: this.woodTexture,
							color: 0xd97706,
							metalness: 0.3,
							roughness: 0.6,
						});
				mesh = new THREE.Mesh(boxGeo, mat);
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				this.scene.add(mesh);
				this.voxelMeshes.set(chunk.id, mesh);
			}

			mesh.position.set(chunk.position.x, chunk.position.y, chunk.position.z);
			mesh.quaternion.set(
				chunk.rotation.x,
				chunk.rotation.y,
				chunk.rotation.z,
				chunk.rotation.w,
			);

			// Smooth scale fade-out after 2 seconds
			const ageSec = (now - chunk.spawnTime) / 1000;
			if (ageSec > 2.0) {
				const fade = Math.max(0.01, (3.5 - ageSec) / 1.5);
				mesh.scale.setScalar(fade);
			} else {
				mesh.scale.setScalar(1.0);
			}
		});

		// Remove old voxel meshes no longer in physics
		this.voxelMeshes.forEach((mesh, id) => {
			if (!chunks.some((c) => c.id === id)) {
				this.scene.remove(mesh);
				mesh.geometry.dispose();
				this.voxelMeshes.delete(id);
			}
		});
	}

	public syncBalls(balls: Cannonball[]) {
		// Sync visual meshes for all active balls (including cluster sub-munitions)
		balls.forEach((ball) => {
			if (!ball.active) return;

			let mesh = this.ballMeshes.get(ball.id);
			const pos = ball.body.translation();

			if (!mesh) {
				const radius = ball.isSubMunition
					? 0.28
					: ball.shellType === "CLUSTER"
						? 0.45
						: 0.4;
				const ballGeo = new THREE.SphereGeometry(radius, 16, 16);
				const colorHex =
					ball.shellType === "ICE"
						? 0x38bdf8
						: ball.shellType === "CLUSTER"
							? 0xf59e0b
							: ball.shellType === "GRAPPLE"
								? 0x10b981
								: 0x0f172a;

				const ballMat = new THREE.MeshStandardMaterial({
					map: this.metalTexture,
					color: colorHex,
					metalness: 0.9,
					roughness: 0.2,
					emissive: colorHex,
					emissiveIntensity: 0.4,
				});
				mesh = new THREE.Mesh(ballGeo, ballMat);
				mesh.castShadow = true;
				this.scene.add(mesh);
				this.ballMeshes.set(ball.id, mesh);
			}

			mesh.position.set(pos.x, pos.y, pos.z);
		});

		// Cleanup inactive ball meshes
		this.ballMeshes.forEach((mesh, id) => {
			if (!balls.some((b) => b.id === id && b.active)) {
				this.scene.remove(mesh);
				this.ballMeshes.delete(id);
			}
		});
	}

	public triggerRecoil() {
		this.recoilOffset = 0.8;
	}

	public triggerExplosion(
		pos: { x: number; y: number; z: number },
		colorType: "fire" | "smoke" | "spark" | "ice" = "fire",
	) {
		const craterGeo = new THREE.CircleGeometry(2.2, 16);
		const craterMat = new THREE.MeshBasicMaterial({
			color: colorType === "ice" ? 0x0284c7 : 0x090d16,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.85,
		});
		const crater = new THREE.Mesh(craterGeo, craterMat);
		crater.rotation.x = -Math.PI / 2;
		crater.position.set(pos.x, 0.06, pos.z);
		this.craterGroup.add(crater);

		// Spawn particles into GPU Instanced particle pool
		const count = 40;
		for (let i = 0; i < count; i++) {
			const freeIdx = this.particleData.findIndex((p) => !p.active);
			if (freeIdx === -1) break;

			const p = this.particleData[freeIdx];
			p.active = true;
			p.position.set(pos.x, pos.y + 0.2, pos.z);
			p.velocity.set(
				(Math.random() - 0.5) * 16,
				Math.random() * 14 + 4,
				(Math.random() - 0.5) * 16,
			);
			p.scale = 0.4 + Math.random() * 0.8;
			p.life = 0;
			p.maxLife = 1.0 + Math.random() * 0.6;
			p.colorType = colorType;
		}
	}

	public update(dt: number, activeBallPos: THREE.Vector3 | null) {
		// Update GPU instanced particles
		for (let i = 0; i < this.maxParticles; i++) {
			const p = this.particleData[i];
			if (!p.active) continue;

			p.life += dt;
			if (p.life >= p.maxLife) {
				p.active = false;
				this.particleDummy.position.set(0, -999, 0);
				this.particleDummy.scale.set(0.001, 0.001, 0.001);
				this.particleDummy.updateMatrix();
				this.particleInstancedMesh.setMatrixAt(i, this.particleDummy.matrix);
				continue;
			}

			p.position.addScaledVector(p.velocity, dt);
			p.velocity.y -= 9.81 * dt * 0.4; // Particle gravity

			const progress = p.life / p.maxLife;
			const currentScale = (1.0 - progress) * p.scale;

			this.particleDummy.position.copy(p.position);
			this.particleDummy.scale.set(currentScale, currentScale, currentScale);
			this.particleDummy.updateMatrix();
			this.particleInstancedMesh.setMatrixAt(i, this.particleDummy.matrix);
		}
		this.particleInstancedMesh.instanceMatrix.needsUpdate = true;

		// Update Recoil
		if (this.recoilOffset > 0) {
			this.recoilOffset = Math.max(0, this.recoilOffset - dt * 3.5);
			this.cannonMesh.position.z = -this.recoilOffset;
		} else {
			this.cannonMesh.position.z = 0;
		}

		// Camera follow mode & slow-mo handling
		const scaledDt = dt * this.slowMoFactor;

		if (activeBallPos) {
			const targetCamPos = new THREE.Vector3(
				activeBallPos.x - 4,
				Math.max(4, activeBallPos.y + 3),
				activeBallPos.z - 8,
			);
			this.currentCamPos.lerp(targetCamPos, Math.min(1.0, scaledDt * 4.0));
			this.currentCamLookAt.lerp(activeBallPos, Math.min(1.0, scaledDt * 6.0));
		} else {
			this.currentCamPos.lerp(
				this.defaultCamPos,
				Math.min(1.0, scaledDt * 3.0),
			);
			this.currentCamLookAt.lerp(
				this.defaultCamLookAt,
				Math.min(1.0, scaledDt * 3.0),
			);
		}

		this.camera.position.copy(this.currentCamPos);
		this.camera.lookAt(this.currentCamLookAt);

		this.renderer.render(this.scene, this.camera);
	}

	private onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	public clearBallVisuals() {
		this.ballMeshes.forEach((mesh) => this.scene.remove(mesh));
		this.ballMeshes.clear();
	}

	public resetLevelVisuals() {
		this.clearBallVisuals();
		if (this.trajectoryArcLine) {
			this.scene.remove(this.trajectoryArcLine);
			this.trajectoryArcLine = null;
		}
		if (this.targetCrosshairMesh) {
			this.targetCrosshairMesh.visible = false;
		}
		this.targetMeshes.forEach((mesh) => this.scene.remove(mesh));
		this.targetMeshes.clear();

		while (this.craterGroup.children.length > 0) {
			this.craterGroup.remove(this.craterGroup.children[0]);
		}
	}
}
