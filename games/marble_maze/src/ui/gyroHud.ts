import * as THREE from "three";

export class GyroHud3D {
	private container: HTMLElement;
	private canvas: HTMLCanvasElement;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;

	private miniBoardGroup: THREE.Group;
	private miniBoardPlate: THREE.Mesh;
	private miniMarble: THREE.Mesh;
	private indicatorRingMat: THREE.MeshBasicMaterial;

	private angleReadoutEl: HTMLElement;
	private statusBadgeEl: HTMLElement;

	constructor(container: HTMLElement) {
		this.container = container;

		// Create HUD Card structure
		this.container.classList.add("gyro-hud-card");
		this.container.innerHTML = `
			<div class="gyro-hud-header">
				<span class="gyro-hud-title">📐 3D GYRO HUD</span>
				<span class="gyro-hud-badge" id="gyro-status-badge">SAFE</span>
			</div>
			<div class="gyro-hud-viewport">
				<canvas id="gyro-hud-canvas"></canvas>
			</div>
			<div class="gyro-hud-readout" id="gyro-angle-readout">
				Pitch: 0.0° | Roll: 0.0°
			</div>
		`;

		this.canvas = this.container.querySelector(
			"#gyro-hud-canvas",
		) as HTMLCanvasElement;
		this.statusBadgeEl = this.container.querySelector(
			"#gyro-status-badge",
		) as HTMLElement;
		this.angleReadoutEl = this.container.querySelector(
			"#gyro-angle-readout",
		) as HTMLElement;

		// Initialize Three.js scene for Gyro HUD
		this.scene = new THREE.Scene();

		this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
		this.camera.position.set(0, 7, 0.001);
		this.camera.lookAt(0, 0, 0);

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			alpha: true,
			antialias: true,
		});
		this.renderer.setSize(120, 120);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		// Lighting
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
		this.scene.add(ambientLight);

		const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
		dirLight.position.set(5, 10, 5);
		this.scene.add(dirLight);

		// Mini Board Group
		this.miniBoardGroup = new THREE.Group();
		this.scene.add(this.miniBoardGroup);

		// Mini Board Base Plate
		const plateGeo = new THREE.BoxGeometry(3, 0.2, 3);
		const plateMat = new THREE.MeshStandardMaterial({
			color: 0x1e293b,
			roughness: 0.4,
			metalness: 0.6,
		});
		this.miniBoardPlate = new THREE.Mesh(plateGeo, plateMat);
		this.miniBoardGroup.add(this.miniBoardPlate);

		// Mini Indicator Border Ring
		const ringGeo = new THREE.BoxGeometry(3.2, 0.08, 3.2);
		this.indicatorRingMat = new THREE.MeshBasicMaterial({
			color: 0x22c55e,
			transparent: true,
			opacity: 0.9,
		});
		const indicatorRing = new THREE.Mesh(ringGeo, this.indicatorRingMat);
		indicatorRing.position.y = 0.12;
		this.miniBoardGroup.add(indicatorRing);

		// Mini Marble
		const marbleGeo = new THREE.SphereGeometry(0.28, 16, 16);
		const marbleMat = new THREE.MeshStandardMaterial({
			color: 0x00f0ff,
			metalness: 0.9,
			roughness: 0.1,
		});
		this.miniMarble = new THREE.Mesh(marbleGeo, marbleMat);
		this.miniMarble.position.set(0, 0.28, 0);
		this.miniBoardGroup.add(this.miniMarble);

		this.render();
	}

	public updateTilt(tiltX: number, tiltZ: number) {
		// Convert normalized tilt to degrees (max tilt ~ 25 deg)
		const maxAngleDeg = 25;
		const degX = tiltX * maxAngleDeg;
		const degZ = tiltZ * maxAngleDeg;

		const totalTiltDeg = Math.hypot(degX, degZ);

		// Smooth rotation of mini 3D board
		const targetRotX = tiltZ * 0.45;
		const targetRotZ = -tiltX * 0.45;

		this.miniBoardGroup.rotation.x +=
			(targetRotX - this.miniBoardGroup.rotation.x) * 0.2;
		this.miniBoardGroup.rotation.z +=
			(targetRotZ - this.miniBoardGroup.rotation.z) * 0.2;

		// Move mini marble dynamically towards tilt direction
		this.miniMarble.position.x = THREE.MathUtils.clamp(tiltX * 1.1, -1.1, 1.1);
		this.miniMarble.position.z = THREE.MathUtils.clamp(tiltZ * 1.1, -1.1, 1.1);

		// Color indication logic (Green -> Yellow -> Red)
		let colorHex = 0x22c55e;
		let colorCss = "#22c55e";
		let statusText = "SAFE";

		if (totalTiltDeg >= 18) {
			colorHex = 0xef4444;
			colorCss = "#ef4444";
			statusText = "DANGER!";
		} else if (totalTiltDeg >= 9) {
			colorHex = 0xeab308;
			colorCss = "#eab308";
			statusText = "CAUTION";
		}

		this.indicatorRingMat.color.setHex(colorHex);

		// Update HTML readouts & styles
		this.statusBadgeEl.innerText = statusText;
		this.statusBadgeEl.style.backgroundColor = `${colorCss}22`;
		this.statusBadgeEl.style.color = colorCss;
		this.statusBadgeEl.style.borderColor = colorCss;

		this.angleReadoutEl.innerText = `Pitch: ${degZ.toFixed(1)}° | Roll: ${degX.toFixed(1)}°`;
		this.container.style.borderColor = `${colorCss}66`;

		this.render();
	}

	private render() {
		this.renderer.render(this.scene, this.camera);
	}
}
