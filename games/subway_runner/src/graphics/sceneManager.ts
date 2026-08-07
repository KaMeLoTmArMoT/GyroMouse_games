import * as THREE from "three";

export interface BiomeTheme {
	name: string;
	bgColor: string;
	fogColor: string;
	ambientColor: string;
	dirLightColor: string;
	trackColor: string;
	railColor: string;
	buildingColor: string;
	particleColor: string;
	wallColor: string;
}

export const BIOMES: BiomeTheme[] = [
	{
		name: "Neon Metropolis",
		bgColor: "#0b0f19",
		fogColor: "#0b0f19",
		ambientColor: "#818cf8",
		dirLightColor: "#38bdf8",
		trackColor: "#1e293b",
		railColor: "#38bdf8",
		buildingColor: "#1e1b4b",
		particleColor: "#c084fc",
		wallColor: "#334155",
	},
	{
		name: "Snowy Tunnel",
		bgColor: "#0f172a",
		fogColor: "#0f172a",
		ambientColor: "#93c5fd",
		dirLightColor: "#e0f2fe",
		trackColor: "#334155",
		railColor: "#f8fafc",
		buildingColor: "#1e293b",
		particleColor: "#38bdf8",
		wallColor: "#475569",
	},
	{
		name: "Cyber Lab",
		bgColor: "#022c22",
		fogColor: "#022c22",
		ambientColor: "#34d399",
		dirLightColor: "#a7f3d0",
		trackColor: "#064e3b",
		railColor: "#f43f5e",
		buildingColor: "#022c22",
		particleColor: "#34d399",
		wallColor: "#0f766e",
	},
];

interface CyberCar {
	mesh: THREE.Group;
	speed: number;
	laneX: number;
}

export class SceneManager {
	public scene: THREE.Scene;
	public camera: THREE.PerspectiveCamera;
	public renderer: THREE.WebGLRenderer;

	private dirLight!: THREE.DirectionalLight;
	private hemiLight!: THREE.HemisphereLight;
	private runnerLight!: THREE.PointLight;

	private particles!: THREE.Points;
	private particleCoords: Float32Array = new Float32Array(300);
	private particleMat!: THREE.PointsMaterial;
	private buildingGroup: THREE.Group = new THREE.Group();
	private buildingMaterials: THREE.MeshStandardMaterial[] = [];

	private sideRoadsGroup: THREE.Group = new THREE.Group();
	private cyberCars: CyberCar[] = [];

	// Shader Bending Uniforms
	public cameraZUniform = { value: 0 };
	public worldCurveUniform = { value: new THREE.Vector2(0.0007, 0.0003) };

	// Dynamic Camera & FX
	private shakeIntensity: number = 0;
	private baseFOV: number = 60;

	// Lerp Target Colors for Biome Transitions
	private targetBgColor = new THREE.Color(BIOMES[0].bgColor);
	private targetFogColor = new THREE.Color(BIOMES[0].fogColor);
	private targetAmbientColor = new THREE.Color(BIOMES[0].ambientColor);
	private targetDirLightColor = new THREE.Color(BIOMES[0].dirLightColor);
	private targetParticleColor = new THREE.Color(BIOMES[0].particleColor);

	constructor(container: HTMLElement) {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(BIOMES[0].bgColor);
		this.scene.fog = new THREE.FogExp2(BIOMES[0].fogColor, 0.018);

		this.camera = new THREE.PerspectiveCamera(
			this.baseFOV,
			window.innerWidth / window.innerHeight,
			0.1,
			200,
		);
		// Elevated third-person runner angle
		this.camera.position.set(0, 4.8, -7.5);
		this.camera.lookAt(0, 1.2, 10);

		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: "high-performance",
		});
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		container.appendChild(this.renderer.domElement);

		this.scene.add(this.buildingGroup);
		this.scene.add(this.sideRoadsGroup);

		this.setupLighting();
		this.setupEnvironment();
		this.setupSideRoadsAndTraffic();
		this.setupSpeedParticles();

		window.addEventListener("resize", this.onWindowResize.bind(this));
	}

	/**
	 * Inject world bending vertex shader code into Three.js materials
	 */
	public applyWorldBending(material: THREE.Material) {
		material.onBeforeCompile = (shader) => {
			shader.uniforms.uCurve = this.worldCurveUniform;
			shader.uniforms.uCameraZ = this.cameraZUniform;

			shader.vertexShader = `
				uniform vec2 uCurve;
				uniform float uCameraZ;
			${shader.vertexShader}`;

			shader.vertexShader = shader.vertexShader.replace(
				"#include <worldpos_vertex>",
				`
				#include <worldpos_vertex>
				float distZ = max(0.0, worldPosition.z - uCameraZ);
				worldPosition.y -= distZ * distZ * uCurve.x;
				worldPosition.x += distZ * distZ * uCurve.y;
				`,
			);
		};
	}

	private createBuildingWindowTexture(): THREE.CanvasTexture {
		const canvas = document.createElement("canvas");
		canvas.width = 128;
		canvas.height = 256;
		const ctx = canvas.getContext("2d")!;

		ctx.fillStyle = "#0f172a";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		const cols = 6;
		const rows = 16;
		const padX = 6;
		const padY = 6;
		const winW = (canvas.width - (cols + 1) * padX) / cols;
		const winH = (canvas.height - (rows + 1) * padY) / rows;

		const litColors = ["#fef08a", "#38bdf8", "#f43f5e", "#fbbf24", "#a7f3d0"];

		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const x = padX + c * (winW + padX);
				const y = padY + r * (winH + padY);

				if (Math.random() < 0.45) {
					ctx.fillStyle =
						litColors[Math.floor(Math.random() * litColors.length)];
				} else {
					ctx.fillStyle = "#1e293b";
				}
				ctx.fillRect(x, y, winW, winH);
			}
		}

		const texture = new THREE.CanvasTexture(canvas);
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.repeat.set(1, 4);
		return texture;
	}

	private setupLighting() {
		this.hemiLight = new THREE.HemisphereLight(
			BIOMES[0].ambientColor,
			"#0f172a",
			1.0,
		);
		this.scene.add(this.hemiLight);

		this.dirLight = new THREE.DirectionalLight(BIOMES[0].dirLightColor, 2.2);
		this.dirLight.position.set(20, 40, -10);
		this.dirLight.castShadow = true;
		this.dirLight.shadow.mapSize.width = 1024;
		this.dirLight.shadow.mapSize.height = 1024;
		this.dirLight.shadow.camera.near = 0.5;
		this.dirLight.shadow.camera.far = 100;
		this.dirLight.shadow.camera.left = -15;
		this.dirLight.shadow.camera.right = 15;
		this.dirLight.shadow.camera.top = 30;
		this.dirLight.shadow.camera.bottom = -10;
		this.scene.add(this.dirLight);

		this.runnerLight = new THREE.PointLight(BIOMES[0].railColor, 3.5, 35);
		this.scene.add(this.runnerLight);
	}

	private setupEnvironment() {
		const buildingGeo = new THREE.BoxGeometry(10, 1, 10);
		const winTex = this.createBuildingWindowTexture();

		const bMat = new THREE.MeshStandardMaterial({
			color: BIOMES[0].buildingColor,
			map: winTex,
			emissiveMap: winTex,
			emissive: new THREE.Color("#ffffff"),
			emissiveIntensity: 0.6,
			roughness: 0.6,
			metalness: 0.3,
		});
		this.applyWorldBending(bMat);
		this.buildingMaterials.push(bMat);

		for (let i = 0; i < 24; i++) {
			const height = 18 + Math.random() * 35;
			const b = new THREE.Mesh(buildingGeo, bMat);
			b.scale.set(1 + Math.random() * 0.8, height, 1 + Math.random() * 1.5);
			const side = i % 2 === 0 ? -1 : 1;
			b.position.set(
				side * (20 + Math.random() * 10),
				height / 2 - 5,
				i * 12 - 20,
			);
			this.buildingGroup.add(b);
		}
	}

	private setupSideRoadsAndTraffic() {
		// Parallel Side Roads Slabs (Left x=-12, Right x=+12)
		const roadGeo = new THREE.BoxGeometry(4.0, 0.1, 300);
		const roadMat = new THREE.MeshStandardMaterial({
			color: "#0f172a",
			roughness: 0.8,
		});
		this.applyWorldBending(roadMat);

		const roadL = new THREE.Mesh(roadGeo, roadMat);
		roadL.position.set(-11.5, -0.08, 100);
		const roadR = new THREE.Mesh(roadGeo, roadMat);
		roadR.position.set(11.5, -0.08, 100);
		this.sideRoadsGroup.add(roadL);
		this.sideRoadsGroup.add(roadR);

		// Glowing Lane Center Divider Strips
		const dividerGeo = new THREE.BoxGeometry(0.12, 0.05, 300);
		const dividerMat = new THREE.MeshBasicMaterial({ color: "#fbbf24" });
		this.applyWorldBending(dividerMat);

		const divL = new THREE.Mesh(dividerGeo, dividerMat);
		divL.position.set(-11.5, 0.02, 100);
		const divR = new THREE.Mesh(dividerGeo, dividerMat);
		divR.position.set(11.5, 0.02, 100);
		this.sideRoadsGroup.add(divL);
		this.sideRoadsGroup.add(divR);

		// Spawning Cyber Traffic Hovercars along side roads
		const carColors = ["#0284c7", "#7e22ce", "#be123c", "#047857", "#d97706"];

		for (let i = 0; i < 10; i++) {
			const carGroup = new THREE.Group();
			const side = i % 2 === 0 ? -11.5 : 11.5;
			const isForward = i % 2 === 0;

			// Car Body
			const carMat = new THREE.MeshStandardMaterial({
				color: carColors[i % carColors.length],
				roughness: 0.3,
				metalness: 0.7,
			});
			this.applyWorldBending(carMat);

			const bodyGeo = new THREE.BoxGeometry(1.4, 0.6, 2.8);
			const body = new THREE.Mesh(bodyGeo, carMat);
			body.position.y = 0.5;
			carGroup.add(body);

			// Cabin Glass Visor
			const visorMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
			this.applyWorldBending(visorMat);
			const cabinGeo = new THREE.BoxGeometry(1.1, 0.45, 1.4);
			const cabin = new THREE.Mesh(cabinGeo, visorMat);
			cabin.position.set(0, 0.9, -0.1);
			carGroup.add(cabin);

			// Headlights (White/Yellow) & Taillights (Red)
			const headMat = new THREE.MeshBasicMaterial({ color: "#fef08a" });
			const tailMat = new THREE.MeshBasicMaterial({ color: "#ef4444" });
			this.applyWorldBending(headMat);
			this.applyWorldBending(tailMat);

			const headL = new THREE.Mesh(
				new THREE.BoxGeometry(0.35, 0.15, 0.1),
				headMat,
			);
			headL.position.set(-0.45, 0.5, 1.42);
			const headR = new THREE.Mesh(
				new THREE.BoxGeometry(0.35, 0.15, 0.1),
				headMat,
			);
			headR.position.set(0.45, 0.5, 1.42);

			const tailL = new THREE.Mesh(
				new THREE.BoxGeometry(0.35, 0.15, 0.1),
				tailMat,
			);
			tailL.position.set(-0.45, 0.5, -1.42);
			const tailR = new THREE.Mesh(
				new THREE.BoxGeometry(0.35, 0.15, 0.1),
				tailMat,
			);
			tailR.position.set(0.45, 0.5, -1.42);

			carGroup.add(headL);
			carGroup.add(headR);
			carGroup.add(tailL);
			carGroup.add(tailR);

			if (!isForward) {
				carGroup.rotateY(Math.PI);
			}

			const startZ = i * 25 - 30;
			carGroup.position.set(side, 0, startZ);
			this.scene.add(carGroup);

			const speed = isForward
				? 24.0 + Math.random() * 8
				: -18.0 - Math.random() * 8;
			this.cyberCars.push({ mesh: carGroup, speed, laneX: side });
		}
	}

	private setupSpeedParticles() {
		const pGeo = new THREE.BufferGeometry();
		for (let i = 0; i < 100; i++) {
			this.particleCoords[i * 3] = (Math.random() - 0.5) * 14;
			this.particleCoords[i * 3 + 1] = Math.random() * 6;
			this.particleCoords[i * 3 + 2] = Math.random() * 80;
		}
		pGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.particleCoords, 3),
		);

		this.particleMat = new THREE.PointsMaterial({
			color: BIOMES[0].particleColor,
			size: 0.18,
			transparent: true,
			opacity: 0.7,
		});

		this.particles = new THREE.Points(pGeo, this.particleMat);
		this.scene.add(this.particles);
	}

	public triggerScreenShake(amount: number = 0.5) {
		this.shakeIntensity = Math.max(this.shakeIntensity, amount);
	}

	/**
	 * Smoothly interpolates biome themes over a 100m window [-50m, +50m] around 1000m thresholds
	 */
	public updateBiomeThemeByDistance(distance: number): {
		biomeIndex: number;
		shouldShowToast: boolean;
		biomeName: string;
	} {
		const boundaryDist = 1000;
		const prevIdx = Math.floor(distance / boundaryDist);
		const nextIdx = prevIdx + 1;
		const boundaryZ = nextIdx * boundaryDist;

		const startZ = boundaryZ - 50;
		const endZ = boundaryZ + 50;

		let blendT = 0;
		let displayBiomeIdx = prevIdx;

		if (distance < startZ) {
			blendT = 0;
			displayBiomeIdx = prevIdx;
		} else if (distance > endZ) {
			blendT = 1;
			displayBiomeIdx = nextIdx;
		} else {
			// Inside smooth transition range [-50m, +50m]
			const rawT = (distance - startZ) / 100.0;
			blendT = rawT * rawT * (3 - 2 * rawT); // Smoothstep
			displayBiomeIdx = rawT > 0.5 ? nextIdx : prevIdx;
		}

		const b1 = BIOMES[prevIdx % BIOMES.length];
		const b2 = BIOMES[nextIdx % BIOMES.length];

		this.targetBgColor
			.copy(new THREE.Color(b1.bgColor))
			.lerp(new THREE.Color(b2.bgColor), blendT);
		this.targetFogColor
			.copy(new THREE.Color(b1.fogColor))
			.lerp(new THREE.Color(b2.fogColor), blendT);
		this.targetAmbientColor
			.copy(new THREE.Color(b1.ambientColor))
			.lerp(new THREE.Color(b2.ambientColor), blendT);
		this.targetDirLightColor
			.copy(new THREE.Color(b1.dirLightColor))
			.lerp(new THREE.Color(b2.dirLightColor), blendT);
		this.targetParticleColor
			.copy(new THREE.Color(b1.particleColor))
			.lerp(new THREE.Color(b2.particleColor), blendT);

		this.runnerLight.color.lerp(this.targetDirLightColor, blendT);

		const nextBiomeName = b2.name;
		const shouldShowToast = distance >= startZ && distance < startZ + 15;

		return {
			biomeIndex: displayBiomeIdx,
			shouldShowToast,
			biomeName: nextBiomeName,
		};
	}

	public updateCamera(
		runnerZ: number,
		runnerX: number,
		forwardSpeed: number,
		dt: number,
	) {
		// Update shader bending camera position uniform
		this.cameraZUniform.value = runnerZ - 7.5;

		// FOV Distortion based on Speed (60 -> 75)
		const targetFOV = this.baseFOV + Math.min(15, (forwardSpeed - 14.0) * 0.85);
		if (Math.abs(this.camera.fov - targetFOV) > 0.05) {
			this.camera.fov +=
				(targetFOV - this.camera.fov) * Math.min(1.0, dt * 4.0);
			this.camera.updateProjectionMatrix();
		}

		// Higher camera position & slightly further back (-7.5z, 4.8y) for clear train visibility
		const targetZ = runnerZ - 7.5;
		const targetX = runnerX * 0.35;

		this.camera.position.z +=
			(targetZ - this.camera.position.z) * Math.min(1.0, dt * 6.0);
		this.camera.position.x +=
			(targetX - this.camera.position.x) * Math.min(1.0, dt * 6.0);

		// Apply Screen Shake offset (Crash only)
		if (this.shakeIntensity > 0.01) {
			this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
			this.camera.position.y =
				4.8 + (Math.random() - 0.5) * this.shakeIntensity;
			this.shakeIntensity *= Math.max(0, 1 - dt * 10);
		} else {
			this.camera.position.y = 4.8;
			this.shakeIntensity = 0;
		}

		// Look slightly down and ahead over train tops
		this.camera.lookAt(runnerX * 0.2, 1.2, runnerZ + 12);

		// Update lights tracking runner
		this.dirLight.position.z = runnerZ - 10;
		this.runnerLight.position.set(runnerX, 3.2, runnerZ + 2.0);

		// Smoothly lerp Biome colors
		if (this.scene.background instanceof THREE.Color) {
			this.scene.background.lerp(this.targetBgColor, dt * 3.0);
		}
		if (this.scene.fog && this.scene.fog instanceof THREE.FogExp2) {
			this.scene.fog.color.lerp(this.targetFogColor, dt * 3.0);
		}
		this.hemiLight.color.lerp(this.targetAmbientColor, dt * 3.0);
		this.dirLight.color.lerp(this.targetDirLightColor, dt * 3.0);
		this.particleMat.color.lerp(this.targetParticleColor, dt * 3.0);

		// Continuously recycle background buildings to follow runner
		this.buildingGroup.children.forEach((b) => {
			if (b.position.z < runnerZ - 30) {
				b.position.z += 280;
			}
		});

		// Recycle Side Roads to follow runner
		this.sideRoadsGroup.children.forEach((r) => {
			if (r.position.z < runnerZ - 50) {
				r.position.z += 250;
			}
		});

		// Animate & Recycle Cyber Cars on side roads
		this.cyberCars.forEach((car) => {
			car.mesh.position.z += car.speed * dt;
			if (car.speed > 0 && car.mesh.position.z < runnerZ - 30) {
				car.mesh.position.z = runnerZ + 180 + Math.random() * 40;
			} else if (car.speed < 0 && car.mesh.position.z < runnerZ - 30) {
				car.mesh.position.z = runnerZ + 180 + Math.random() * 40;
			} else if (car.mesh.position.z > runnerZ + 220) {
				car.mesh.position.z = runnerZ - 20 - Math.random() * 30;
			}
		});
	}

	public updateParticles(runnerZ: number, forwardSpeed: number) {
		const attr = this.particles.geometry.attributes
			.position as THREE.BufferAttribute;
		const pos = attr.array as Float32Array;
		const speedMult = Math.max(1.0, forwardSpeed / 14.0);

		for (let i = 0; i < 100; i++) {
			pos[i * 3 + 2] -= speedMult * 0.4;
			if (pos[i * 3 + 2] < runnerZ - 5) {
				pos[i * 3 + 2] = runnerZ + 70 + Math.random() * 10;
			}
		}
		attr.needsUpdate = true;
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
