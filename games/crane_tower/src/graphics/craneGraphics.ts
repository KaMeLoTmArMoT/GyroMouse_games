import * as THREE from "three";
import type { CranePhysicsManager } from "../physics/cranePhysics";

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

	// Target Region Visual Box Wireframe
	private targetRegionMesh!: THREE.LineSegments;

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
		this.camera.position.set(0.5, 4.5, 14.5);
		this.camera.lookAt(0.5, 3.8, 0);

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
		dirLight.position.set(8, 15, 10);
		dirLight.castShadow = true;
		dirLight.shadow.mapSize.width = 2048;
		dirLight.shadow.mapSize.height = 2048;
		dirLight.shadow.camera.near = 0.5;
		dirLight.shadow.camera.far = 30;
		dirLight.shadow.camera.left = -10;
		dirLight.shadow.camera.right = 10;
		dirLight.shadow.camera.top = 12;
		dirLight.shadow.camera.bottom = -2;
		dirLight.shadow.bias = -0.0005;
		this.scene.add(dirLight);

		const rimLight = new THREE.DirectionalLight("#a855f7", 1.2);
		rimLight.position.set(-10, 8, -8);
		this.scene.add(rimLight);

		// 5. Environment & Gantry Build
		this.buildEnvironment();
		this.buildGantryCrane();
		this.buildTrainPlatform();
		this.buildTargetRegionVisual();

		// Window Resize Listener
		window.addEventListener("resize", this.onWindowResize.bind(this));
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

		// Side Supply Dock Platform (where new boxes arrive)
		const sideDockGeo = new THREE.BoxGeometry(2.6, 0.4, 2.4);
		const sideDockMat = new THREE.MeshStandardMaterial({
			color: "#334155",
			metalness: 0.6,
			roughness: 0.4,
		});
		const sideDockMesh = new THREE.Mesh(sideDockGeo, sideDockMat);
		sideDockMesh.position.set(-4.5, 0.5, 0);
		sideDockMesh.receiveShadow = true;
		sideDockMesh.castShadow = true;
		this.scene.add(sideDockMesh);
	}

	private buildGantryCrane() {
		// Top Horizontal Beam (Rail for trolley)
		const beamGeo = new THREE.BoxGeometry(22, 0.5, 0.6);
		const beamMat = new THREE.MeshStandardMaterial({
			color: "#f59e0b", // Yellow industrial gantry beam
			metalness: 0.6,
			roughness: 0.3,
		});
		const beamMesh = new THREE.Mesh(beamGeo, beamMat);
		beamMesh.position.set(1.5, 8.0, 0);
		beamMesh.castShadow = true;
		this.scene.add(beamMesh);

		// Vertical Gantry Support Legs
		const legGeo = new THREE.CylinderGeometry(0.2, 0.25, 8.0);
		const legMat = new THREE.MeshStandardMaterial({
			color: "#475569",
			metalness: 0.7,
		});

		const leftLeg = new THREE.Mesh(legGeo, legMat);
		leftLeg.position.set(-7.5, 4.0, 0);
		this.scene.add(leftLeg);

		const rightLeg = new THREE.Mesh(legGeo, legMat);
		rightLeg.position.set(10.5, 4.0, 0);
		this.scene.add(rightLeg);

		// Trolley mesh (rides on beam)
		const trolleyGeo = new THREE.BoxGeometry(1.0, 0.4, 0.8);
		const trolleyMat = new THREE.MeshStandardMaterial({
			color: "#0284c7",
			metalness: 0.8,
		});
		this.trolleyMesh = new THREE.Mesh(trolleyGeo, trolleyMat);
		this.trolleyMesh.position.set(0, 7.7, 0);
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
			new THREE.Vector3(0, 7.7, 0),
			new THREE.Vector3(0, 6.0, 0),
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

		// Main Flatbed Chassis
		const bedGeo = new THREE.BoxGeometry(5.4, 0.4, 2.2);
		const bedMat = new THREE.MeshStandardMaterial({
			color: "#dc2626",
			metalness: 0.5,
			roughness: 0.4,
		});
		const bedMesh = new THREE.Mesh(bedGeo, bedMat);
		bedMesh.position.y = 0.5;
		bedMesh.castShadow = true;
		bedMesh.receiveShadow = true;
		this.trainGroup.add(bedMesh);

		// Train Wheels
		const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 16);
		const wheelMat = new THREE.MeshStandardMaterial({
			color: "#1e293b",
			metalness: 0.9,
			roughness: 0.2,
		});

		const wheelPositions = [
			[-2.0, 0.25, 0.95],
			[-1.2, 0.25, 0.95],
			[1.2, 0.25, 0.95],
			[2.0, 0.25, 0.95],
			[-2.0, 0.25, -0.95],
			[-1.2, 0.25, -0.95],
			[1.2, 0.25, -0.95],
			[2.0, 0.25, -0.95],
		];

		wheelPositions.forEach((pos) => {
			const wheel = new THREE.Mesh(wheelGeo, wheelMat);
			wheel.rotation.x = Math.PI / 2;
			wheel.position.set(pos[0], pos[1], pos[2]);
			wheel.castShadow = true;
			this.trainGroup.add(wheel);
		});

		this.scene.add(this.trainGroup);
	}

	private buildTargetRegionVisual() {
		// Target zone box wireframe
		const width = 5.6;
		const height = 7.4;
		const depth = 2.4;

		const boxGeo = new THREE.BoxGeometry(width, height, depth);
		const wireframeGeo = new THREE.WireframeGeometry(boxGeo);
		const wireframeMat = new THREE.LineBasicMaterial({
			color: "#38bdf8",
			opacity: 0.4,
			transparent: true,
		});

		this.targetRegionMesh = new THREE.LineSegments(wireframeGeo, wireframeMat);
		// Center at target region bounds midpoint (X = 3.5)
		this.targetRegionMesh.position.set(3.5, 4.3, 0);
		this.scene.add(this.targetRegionMesh);
	}

	public setTargetRegionVisible(visible: boolean) {
		if (this.targetRegionMesh) {
			this.targetRegionMesh.visible = visible;
		}
	}

	/**
	 * Create crate visual mesh matching physics size & color
	 */
	public addCrateMesh(
		id: string,
		size: { x: number; y: number; z: number },
		colorHex = "#0284c7",
	): THREE.Mesh {
		const geo = new THREE.BoxGeometry(size.x, size.y, size.z);

		// Industrial Shipping Container Texture look
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
			opacity: 0.3,
			transparent: true,
		});
		const wireframe = new THREE.LineSegments(edges, lineMat);
		mesh.add(wireframe);

		this.crateMeshes.set(id, mesh);
		this.scene.add(mesh);
		return mesh;
	}

	/**
	 * Sync graphics transforms with Rapier3D physics state
	 */
	public syncGraphics(physics: CranePhysicsManager) {
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

		// Magnet LED indicator color changes based on held status
		const held = physics.currentHeldCrateId !== null;
		(this.magnetLed.color as THREE.Color).set(held ? "#f59e0b" : "#38bdf8");

		// 2. Sync Train Flatbed position
		const trainPos = physics.trainBody.translation();
		this.trainGroup.position.set(trainPos.x, trainPos.y - 0.5, trainPos.z);

		// 3. Sync Crates
		for (const [id, crate] of physics.crates.entries()) {
			let mesh = this.crateMeshes.get(id);
			if (!mesh) {
				mesh = this.addCrateMesh(id, crate.size);
			}

			const translation = crate.body.translation();
			const rotation = crate.body.rotation();

			mesh.position.set(translation.x, translation.y, translation.z);
			mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
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
