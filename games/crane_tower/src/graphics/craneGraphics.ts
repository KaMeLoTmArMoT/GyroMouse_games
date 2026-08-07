import * as THREE from "three";
import {
	CRATE_TYPES,
	type CranePhysicsManager,
	type CrateTypeId,
} from "../physics/cranePhysics";

export class CraneGraphicsManager {
	public scene!: THREE.Scene;
	public camera!: THREE.PerspectiveCamera;
	public renderer!: THREE.WebGLRenderer;

	// Scene Meshes
	private trolleyMesh!: THREE.Mesh;
	private magnetMesh!: THREE.Mesh;
	private magnetLed!: THREE.PointLight;
	private cableLine!: THREE.Line;

	private trainGroup!: THREE.Group;
	private crateMeshes: Map<string, THREE.Mesh> = new Map();

	// Target Region Visual Box Wireframe & 3D Projector Grid
	private targetRegionMesh!: THREE.LineSegments;
	private comMarkerMesh!: THREE.Mesh;

	// Background Animated Life
	private cloudsGroup!: THREE.Group;
	private birdsGroup!: THREE.Group;
	private truckMesh!: THREE.Mesh;
	private smokeParticles: THREE.Mesh[] = [];

	// Victory Steam Particles
	private steamParticles: THREE.Mesh[] = [];

	private canvas: HTMLCanvasElement;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
	}

	public init() {
		// 1. Scene setup
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color("#090d16");
		this.scene.fog = new THREE.FogExp2("#090d16", 0.025);

		// 2. Camera setup
		this.camera = new THREE.PerspectiveCamera(
			45,
			window.innerWidth / window.innerHeight,
			0.1,
			100,
		);
		this.camera.position.set(0.5, 5.2, 15.5);
		this.camera.lookAt(0.5, 4.4, 0);

		// 3. Renderer setup
		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
			powerPreference: "high-performance",
		});
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		// 4. Lighting
		const ambientLight = new THREE.AmbientLight("#ffffff", 0.8);
		this.scene.add(ambientLight);

		const dirLight = new THREE.DirectionalLight("#e0f2fe", 1.8);
		dirLight.position.set(8, 18, 10);
		dirLight.castShadow = true;
		dirLight.shadow.mapSize.width = 2048;
		dirLight.shadow.mapSize.height = 2048;
		dirLight.shadow.camera.near = 0.5;
		dirLight.shadow.camera.far = 35;
		dirLight.shadow.camera.left = -10;
		dirLight.shadow.camera.right = 10;
		dirLight.shadow.camera.top = 14;
		dirLight.shadow.camera.bottom = -2;
		dirLight.shadow.bias = -0.0005;
		this.scene.add(dirLight);

		const rimLight = new THREE.DirectionalLight("#a855f7", 1.2);
		rimLight.position.set(-10, 10, -8);
		this.scene.add(rimLight);

		// 5. Environment & Gantry Build
		this.buildEnvironment();
		this.buildGantryCrane();
		this.buildTrainPlatform();
		this.buildTargetRegionVisual();
		this.buildBackgroundLife();

		// Window Resize Listener
		window.addEventListener("resize", this.onWindowResize.bind(this));
	}

	private buildBackgroundLife() {
		// 1. Drifting Clouds
		this.cloudsGroup = new THREE.Group();
		const cloudMat = new THREE.MeshStandardMaterial({
			color: "#f8fafc",
			roughness: 0.9,
			opacity: 0.85,
			transparent: true,
		});
		for (let i = 0; i < 6; i++) {
			const cloud = new THREE.Group();
			const numPuffs = 3 + Math.floor(Math.random() * 3);
			for (let p = 0; p < numPuffs; p++) {
				const r = 0.8 + Math.random() * 0.8;
				const puffGeo = new THREE.SphereGeometry(r, 8, 8);
				const puff = new THREE.Mesh(puffGeo, cloudMat);
				puff.position.set(
					(p - numPuffs / 2) * 1.0,
					(Math.random() - 0.5) * 0.4,
					(Math.random() - 0.5) * 0.5,
				);
				cloud.add(puff);
			}
			cloud.position.set(
				-25 + Math.random() * 50,
				11 + Math.random() * 4,
				-15 - Math.random() * 5,
			);
			this.cloudsGroup.add(cloud);
		}
		this.scene.add(this.cloudsGroup);

		// 2. Flying Birds Flock
		this.birdsGroup = new THREE.Group();
		const birdMat = new THREE.MeshBasicMaterial({
			color: "#cbd5e1",
			side: THREE.DoubleSide,
		});
		for (let b = 0; b < 5; b++) {
			const bird = new THREE.Group();
			const wingGeo = new THREE.BufferGeometry();
			const vertices = new Float32Array([
				-0.3, 0.1, 0, 0.0, 0.0, 0, 0.3, 0.1, 0, 0.0, -0.1, 0.15,
			]);
			wingGeo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
			const birdMesh = new THREE.Mesh(wingGeo, birdMat);
			bird.add(birdMesh);
			bird.position.set(-20 + b * 4, 13 + (b % 2) * 1.5, -12);
			this.birdsGroup.add(bird);
		}
		this.scene.add(this.birdsGroup);

		// 3. Moving Background Forklift / Truck on Distant Depot Road
		const truckGroup = new THREE.Group();
		const bodyGeo = new THREE.BoxGeometry(1.6, 0.8, 0.9);
		const bodyMat = new THREE.MeshStandardMaterial({
			color: "#eab308",
			roughness: 0.5,
		});
		const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
		bodyMesh.position.y = 0.5;
		truckGroup.add(bodyMesh);

		const cabinGeo = new THREE.BoxGeometry(0.8, 0.7, 0.8);
		const cabinMat = new THREE.MeshStandardMaterial({
			color: "#1e293b",
			roughness: 0.3,
		});
		const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat);
		cabinMesh.position.set(0.3, 1.1, 0);
		truckGroup.add(cabinMesh);

		truckGroup.position.set(-20, 0.1, -10);
		this.truckMesh = truckGroup as unknown as THREE.Mesh;
		this.scene.add(this.truckMesh);

		// 4. Background Factory Chimneys & Puffing Smoke
		const factoryGeo = new THREE.CylinderGeometry(0.6, 0.8, 6.0, 12);
		const factoryMat = new THREE.MeshStandardMaterial({
			color: "#334155",
			roughness: 0.8,
		});
		const stack1 = new THREE.Mesh(factoryGeo, factoryMat);
		stack1.position.set(-18, 3.0, -18);
		this.scene.add(stack1);

		const stack2 = new THREE.Mesh(factoryGeo, factoryMat);
		stack2.position.set(-15, 3.0, -18);
		this.scene.add(stack2);

		// Factory smoke puff pool
		const smokeMat = new THREE.MeshBasicMaterial({
			color: "#64748b",
			transparent: true,
			opacity: 0.4,
		});
		for (let s = 0; s < 12; s++) {
			const puff = new THREE.Mesh(
				new THREE.SphereGeometry(0.4 + Math.random() * 0.3, 8, 8),
				smokeMat,
			);
			puff.position.set(-18 + (s % 2) * 3, 6.2 + (s % 6) * 0.8, -18);
			this.smokeParticles.push(puff);
			this.scene.add(puff);
		}
	}

	private buildEnvironment() {
		// Ground floor mesh
		const floorGeo = new THREE.PlaneGeometry(50, 50);
		const floorMat = new THREE.MeshStandardMaterial({
			color: "#0f172a",
			roughness: 0.8,
			metalness: 0.2,
		});
		const floorMesh = new THREE.Mesh(floorGeo, floorMat);
		floorMesh.rotation.x = -Math.PI / 2;
		floorMesh.position.y = 0;
		floorMesh.receiveShadow = true;
		this.scene.add(floorMesh);

		// Grid Overlay on Floor
		const gridHelper = new THREE.GridHelper(50, 50, "#38bdf8", "#1e293b");
		gridHelper.position.y = 0.01;
		this.scene.add(gridHelper);

		// Train Rails on Ground
		for (let x = -20; x <= 20; x += 0.8) {
			const tieGeo = new THREE.BoxGeometry(0.3, 0.06, 2.2);
			const tieMat = new THREE.MeshStandardMaterial({
				color: "#334155",
				roughness: 0.9,
			});
			const tie = new THREE.Mesh(tieGeo, tieMat);
			tie.position.set(x, 0.03, 0);
			tie.receiveShadow = true;
			this.scene.add(tie);
		}

		const railGeo = new THREE.BoxGeometry(40, 0.1, 0.08);
		const railMat = new THREE.MeshStandardMaterial({
			color: "#94a3b8",
			metalness: 0.9,
			roughness: 0.2,
		});

		const leftRail = new THREE.Mesh(railGeo, railMat);
		leftRail.position.set(0, 0.1, -0.85);
		this.scene.add(leftRail);

		const rightRail = new THREE.Mesh(railGeo, railMat);
		rightRail.position.set(0, 0.1, 0.85);
		this.scene.add(rightRail);

		// Side Supply Dock Platform (where new boxes arrive - Y raised to 0.75)
		const sideDockGeo = new THREE.BoxGeometry(2.6, 0.4, 2.4);
		const sideDockMat = new THREE.MeshStandardMaterial({
			color: "#334155",
			metalness: 0.6,
			roughness: 0.4,
		});
		const sideDockMesh = new THREE.Mesh(sideDockGeo, sideDockMat);
		sideDockMesh.position.set(-4.5, 0.75, 0);
		sideDockMesh.receiveShadow = true;
		sideDockMesh.castShadow = true;
		this.scene.add(sideDockMesh);
	}

	private buildGantryCrane() {
		// Top Horizontal Beam (Rail for trolley - Y raised +20% to 9.55)
		const beamGeo = new THREE.BoxGeometry(22, 0.5, 0.6);
		const beamMat = new THREE.MeshStandardMaterial({
			color: "#f59e0b", // Yellow industrial gantry beam
			metalness: 0.6,
			roughness: 0.3,
		});
		const beamMesh = new THREE.Mesh(beamGeo, beamMat);
		beamMesh.position.set(1.5, 9.55, 0);
		beamMesh.castShadow = true;
		this.scene.add(beamMesh);

		// Vertical Gantry Support Legs (height 9.55)
		const legGeo = new THREE.CylinderGeometry(0.2, 0.25, 9.55);
		const legMat = new THREE.MeshStandardMaterial({
			color: "#475569",
			metalness: 0.7,
		});

		const leftLeg = new THREE.Mesh(legGeo, legMat);
		leftLeg.position.set(-7.5, 4.775, 0);
		this.scene.add(leftLeg);

		const rightLeg = new THREE.Mesh(legGeo, legMat);
		rightLeg.position.set(10.5, 4.775, 0);
		this.scene.add(rightLeg);

		// Trolley mesh (rides on beam Y=9.25)
		const trolleyGeo = new THREE.BoxGeometry(1.0, 0.4, 0.8);
		const trolleyMat = new THREE.MeshStandardMaterial({
			color: "#0284c7",
			metalness: 0.8,
		});
		this.trolleyMesh = new THREE.Mesh(trolleyGeo, trolleyMat);
		this.trolleyMesh.position.set(0, 9.25, 0);
		this.trolleyMesh.castShadow = true;
		this.scene.add(this.trolleyMesh);

		// Electro-Magnet Head Mesh
		const magnetGroup = new THREE.Group();
		const magGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.3, 16);
		const magMat = new THREE.MeshStandardMaterial({
			color: "#1e293b",
			metalness: 0.9,
			roughness: 0.2,
		});
		const magMesh = new THREE.Mesh(magGeo, magMat);
		magMesh.castShadow = true;
		magnetGroup.add(magMesh);

		// Magnet LED indicator ring
		const ledGeo = new THREE.TorusGeometry(0.45, 0.05, 8, 24);
		const ledMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
		const ledMesh = new THREE.Mesh(ledGeo, ledMat);
		ledMesh.rotation.x = Math.PI / 2;
		ledMesh.position.y = -0.15;
		magnetGroup.add(ledMesh);

		this.magnetLed = new THREE.PointLight("#38bdf8", 1.5, 3);
		this.magnetLed.position.set(0, -0.2, 0);
		magnetGroup.add(this.magnetLed);

		this.magnetMesh = magnetGroup as unknown as THREE.Mesh;
		this.scene.add(this.magnetMesh);

		// Cable Line geometry
		const cableGeo = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 9.25, 0),
			new THREE.Vector3(0, 6.75, 0),
		]);
		const cableMat = new THREE.LineBasicMaterial({
			color: "#94a3b8",
			linewidth: 2,
		});
		this.cableLine = new THREE.Line(cableGeo, cableMat);
		this.scene.add(this.cableLine);
	}

	private buildTrainPlatform() {
		this.trainGroup = new THREE.Group();

		// Main Flatbed Chassis (Y center = 0.75)
		const bedGeo = new THREE.BoxGeometry(5.4, 0.4, 2.2);
		const bedMat = new THREE.MeshStandardMaterial({
			color: "#dc2626",
			metalness: 0.5,
			roughness: 0.4,
		});
		const bedMesh = new THREE.Mesh(bedGeo, bedMat);
		bedMesh.position.y = 0.75;
		bedMesh.castShadow = true;
		bedMesh.receiveShadow = true;
		this.trainGroup.add(bedMesh);

		// Train Wheels (Radius 0.35, Y position = 0.35)
		const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.15, 16);
		const wheelMat = new THREE.MeshStandardMaterial({
			color: "#1e293b",
			metalness: 0.9,
			roughness: 0.2,
		});

		const wheelPositions = [
			[-2.0, 0.35, 0.95],
			[-1.2, 0.35, 0.95],
			[1.2, 0.35, 0.95],
			[2.0, 0.35, 0.95],
			[-2.0, 0.35, -0.95],
			[-1.2, 0.35, -0.95],
			[1.2, 0.35, -0.95],
			[2.0, 0.35, -0.95],
		];

		wheelPositions.forEach((pos) => {
			const wheel = new THREE.Mesh(wheelGeo, wheelMat);
			wheel.rotation.x = Math.PI / 2;
			wheel.position.set(pos[0], pos[1], pos[2]);
			wheel.castShadow = true;
			this.trainGroup.add(wheel);
		});

		// Locomotive Chimney Pipe & Steam Particle pool
		const chimneyGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.7, 12);
		const chimneyMat = new THREE.MeshStandardMaterial({
			color: "#334155",
			metalness: 0.8,
		});
		const chimneyMesh = new THREE.Mesh(chimneyGeo, chimneyMat);
		chimneyMesh.position.set(2.4, 1.15, 0);
		this.trainGroup.add(chimneyMesh);

		const steamMat = new THREE.MeshBasicMaterial({
			color: "#f8fafc",
			transparent: true,
			opacity: 0.6,
		});
		for (let s = 0; s < 8; s++) {
			const steamPuff = new THREE.Mesh(
				new THREE.SphereGeometry(0.25 + Math.random() * 0.2, 8, 8),
				steamMat,
			);
			steamPuff.position.set(2.4, 1.55 + s * 0.3, 0);
			steamPuff.visible = false;
			this.steamParticles.push(steamPuff);
			this.trainGroup.add(steamPuff);
		}

		this.scene.add(this.trainGroup);
	}

	private buildTargetRegionVisual() {
		// Target zone box wireframe
		const width = 5.6;
		const height = 8.5;
		const depth = 2.4;

		const boxGeo = new THREE.BoxGeometry(width, height, depth);
		const wireframeGeo = new THREE.WireframeGeometry(boxGeo);
		const wireframeMat = new THREE.LineBasicMaterial({
			color: "#38bdf8",
			opacity: 0.4,
			transparent: true,
		});

		this.targetRegionMesh = new THREE.LineSegments(wireframeGeo, wireframeMat);
		// Center at target region bounds midpoint (X = 3.5, Y = 5.2)
		this.targetRegionMesh.position.set(3.5, 5.2, 0);
		this.scene.add(this.targetRegionMesh);

		// Center of Mass 3D Indicator Marker on train platform
		const markerGroup = new THREE.Group();
		const pinGeo = new THREE.ConeGeometry(0.18, 0.4, 4);
		const pinMat = new THREE.MeshBasicMaterial({ color: "#10b981" });
		const pinMesh = new THREE.Mesh(pinGeo, pinMat);
		pinMesh.rotation.x = Math.PI;
		markerGroup.add(pinMesh);

		this.comMarkerMesh = markerGroup as unknown as THREE.Mesh;
		this.comMarkerMesh.position.set(0, 0.97, 0);
		this.trainGroup.add(this.comMarkerMesh);
	}

	public setTargetRegionVisible(visible: boolean) {
		if (this.targetRegionMesh) {
			this.targetRegionMesh.visible = visible;
		}
	}

	/**
	 * Create crate visual mesh matching physics size & CrateType configuration
	 */
	public addCrateMesh(
		id: string,
		typeId: CrateTypeId = "STANDARD",
	): THREE.Mesh {
		const config = CRATE_TYPES[typeId] || CRATE_TYPES.STANDARD;
		const size = config.size;
		const colorHex = config.color;

		const geo = new THREE.BoxGeometry(size.x, size.y, size.z);

		// Industrial Shipping Container / Crate Material
		const mat = new THREE.MeshStandardMaterial({
			color: colorHex,
			roughness: 0.4,
			metalness: 0.4,
		});

		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;

		// Edge highlight for crisp container detail
		const edges = new THREE.EdgesGeometry(geo);
		const lineMat = new THREE.LineBasicMaterial({
			color: "#ffffff",
			opacity: 0.35,
			transparent: true,
		});
		const wireframe = new THREE.LineSegments(edges, lineMat);
		mesh.add(wireframe);

		// Add custom detail decals per crate type
		if (typeId === "HEAVY") {
			// Hazard warning stripe badge on heavy cargo
			const stripeGeo = new THREE.BoxGeometry(
				size.x * 0.9,
				0.25,
				size.z + 0.02,
			);
			const stripeMat = new THREE.MeshStandardMaterial({
				color: "#f59e0b",
				roughness: 0.3,
			});
			const stripe = new THREE.Mesh(stripeGeo, stripeMat);
			mesh.add(stripe);
		} else if (typeId === "LONG") {
			// Center reinforced steel beam on long containers
			const beamGeo = new THREE.BoxGeometry(0.15, size.y * 0.95, size.z + 0.02);
			const beamMat = new THREE.MeshStandardMaterial({
				color: "#1e293b",
				metalness: 0.8,
			});
			const beam = new THREE.Mesh(beamGeo, beamMat);
			mesh.add(beam);
		} else if (typeId === "LIGHT") {
			// Cross brace wood slats on light crate
			const slatGeo = new THREE.BoxGeometry(size.x * 0.8, 0.1, size.z + 0.02);
			const slatMat = new THREE.MeshStandardMaterial({
				color: "#fbbf24",
				roughness: 0.8,
			});
			const slat1 = new THREE.Mesh(slatGeo, slatMat);
			slat1.position.y = 0.2;
			const slat2 = new THREE.Mesh(slatGeo, slatMat);
			slat2.position.y = -0.2;
			mesh.add(slat1);
			mesh.add(slat2);
		}

		this.crateMeshes.set(id, mesh);
		this.scene.add(mesh);
		return mesh;
	}

	private animTime: number = 0;

	/**
	 * Sync graphics transforms with Rapier3D physics state and animate background life
	 */
	public syncGraphics(
		physics: CranePhysicsManager,
		dt: number = 0.016,
		gameState: string = "PLAYING",
	) {
		this.animTime += dt;

		// 1. Sync Trolley & Magnet Hook with Pendulum Swing
		this.trolleyMesh.position.x = physics.trolleyX;

		this.magnetMesh.position.set(physics.magnetX, physics.magnetY, 0);
		this.magnetMesh.rotation.z = physics.cableAngle;

		// Cable line connects top trolley to swinging magnet head
		const positions = this.cableLine.geometry.attributes
			.position as THREE.BufferAttribute;
		positions.setXYZ(0, physics.trolleyX, physics.gantryY, 0);
		positions.setXYZ(1, physics.magnetX, physics.magnetY, 0);
		positions.needsUpdate = true;

		// 2. Electromagnet Heat Visual Glow Effect
		const heat = physics.magnetHeat;
		const held = physics.currentHeldCrateId !== null;

		if (heat > 10) {
			const heatRatio = heat / 100;
			const heatColor = new THREE.Color().lerpColors(
				new THREE.Color("#f59e0b"),
				new THREE.Color("#ef4444"),
				heatRatio,
			);
			(this.magnetLed.color as THREE.Color).copy(heatColor);
			this.magnetLed.intensity = 2.0 + heatRatio * 4.0;
		} else {
			(this.magnetLed.color as THREE.Color).set(held ? "#f59e0b" : "#38bdf8");
			this.magnetLed.intensity = held ? 2.2 : 1.5;
		}

		// 3. Sync Train Flatbed Position & Roll Tilt
		const trainPos = physics.trainBody.translation();
		this.trainGroup.position.set(trainPos.x, trainPos.y - 0.75, trainPos.z);
		this.trainGroup.rotation.z = physics.trainTiltAngle;

		// Update Center of Mass 3D Indicator Marker position on train bed
		if (this.comMarkerMesh) {
			this.comMarkerMesh.position.x = physics.centerOfMassOffset * 2.2;
		}

		// 4. Sync Crates
		for (const [id, crate] of physics.crates.entries()) {
			let mesh = this.crateMeshes.get(id);
			if (!mesh) {
				mesh = this.addCrateMesh(id, crate.typeId);
			}

			const translation = crate.body.translation();
			const rotation = crate.body.rotation();

			mesh.position.set(translation.x, translation.y, translation.z);
			mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
		}

		// 5. Animate Background Life ("Живий фон")
		// A. Drifting Clouds
		if (this.cloudsGroup) {
			this.cloudsGroup.children.forEach((cloud) => {
				cloud.position.x += 0.5 * dt;
				if (cloud.position.x > 30) cloud.position.x = -30;
			});
		}

		// B. Flying Birds (Flapping wings & sinusoidal path)
		if (this.birdsGroup) {
			this.birdsGroup.children.forEach((bird, idx) => {
				bird.position.x -= 2.5 * dt;
				bird.position.y += Math.sin(this.animTime * 4 + idx) * 0.4 * dt;
				if (bird.position.x < -30) bird.position.x = 30;
				bird.rotation.z = Math.sin(this.animTime * 12 + idx) * 0.25;
			});
		}

		// C. Moving Background Forklift / Truck
		if (this.truckMesh) {
			this.truckMesh.position.x += 3.0 * dt;
			if (this.truckMesh.position.x > 30) this.truckMesh.position.x = -30;
		}

		// D. Factory Chimney Smoke Puffs
		this.smokeParticles.forEach((puff, idx) => {
			puff.position.y += 0.9 * dt;
			puff.position.x += Math.sin(this.animTime * 2 + idx) * 0.2 * dt;
			if (puff.position.y > 9.0) {
				puff.position.y = 6.2;
				puff.position.x = -18 + (idx % 2) * 3;
			}
		});

		// 6. Victory Scene Camera Tracking & Locomotive Steam Puffs
		if (gameState === "VICTORY") {
			this.steamParticles.forEach((puff) => {
				puff.visible = true;
				puff.position.y += 0.8 * dt;
				puff.position.x -= 0.3 * dt;
				if (puff.position.y > 3.0) {
					puff.position.y = 1.55;
					puff.position.x = 2.4;
				}
			});

			const targetCamX = trainPos.x + 2.0;
			this.camera.position.x +=
				(targetCamX - this.camera.position.x) * 2.0 * dt;
			this.camera.position.y += (5.2 - this.camera.position.y) * 2.0 * dt;
			this.camera.position.z += (18.0 - this.camera.position.z) * 1.5 * dt;
			this.camera.lookAt(trainPos.x, 4.4, 0);
		} else {
			this.steamParticles.forEach((puff) => {
				puff.visible = false;
			});

			// Normal camera position
			this.camera.position.x += (0.5 - this.camera.position.x) * 3.0 * dt;
			this.camera.position.y += (5.2 - this.camera.position.y) * 3.0 * dt;
			this.camera.position.z += (15.5 - this.camera.position.z) * 3.0 * dt;
			this.camera.lookAt(0.5, 4.4, 0);
		}
	}

	/**
	 * Remove crate mesh on level reset
	 */
	public clearCrates() {
		for (const mesh of this.crateMeshes.values()) {
			this.scene.remove(mesh);
		}
		this.crateMeshes.clear();
	}

	private onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	public render() {
		this.renderer.render(this.scene, this.camera);
	}
}
