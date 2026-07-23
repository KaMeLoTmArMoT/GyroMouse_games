import * as THREE from 'three';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private dirLight!: THREE.DirectionalLight;
  private particles!: THREE.Points;
  private particleCoords: Float32Array = new Float32Array(300);

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0f19');
    this.scene.fog = new THREE.FogExp2('#0b0f19', 0.018);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    // Elevated third-person runner angle
    this.camera.position.set(0, 3.5, -6);
    this.camera.lookAt(0, 1.5, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupEnvironment();
    this.setupSpeedParticles();

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight('#818cf8', 0.7);
    this.scene.add(ambientLight);

    this.dirLight = new THREE.DirectionalLight('#38bdf8', 1.8);
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
  }

  private setupEnvironment() {
    // City skyline backdrop buildings
    const buildingGeo = new THREE.BoxGeometry(10, 1, 10);
    const buildingMat = new THREE.MeshStandardMaterial({
      color: '#1e1b4b',
      roughness: 0.8,
      metalness: 0.2
    });

    for (let i = 0; i < 20; i++) {
      const height = 15 + Math.random() * 35;
      const b = new THREE.Mesh(buildingGeo, buildingMat);
      b.scale.set(1 + Math.random(), height, 1 + Math.random() * 2);
      const side = i % 2 === 0 ? -1 : 1;
      b.position.set(side * (18 + Math.random() * 10), height / 2 - 5, (i * 12) - 20);
      this.scene.add(b);
    }
  }

  private setupSpeedParticles() {
    const pGeo = new THREE.BufferGeometry();
    for (let i = 0; i < 100; i++) {
      this.particleCoords[i * 3] = (Math.random() - 0.5) * 12;
      this.particleCoords[i * 3 + 1] = Math.random() * 6;
      this.particleCoords[i * 3 + 2] = Math.random() * 80;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particleCoords, 3));

    const pMat = new THREE.PointsMaterial({
      color: '#c084fc',
      size: 0.15,
      transparent: true,
      opacity: 0.6
    });

    this.particles = new THREE.Points(pGeo, pMat);
    this.scene.add(this.particles);
  }

  public updateCamera(runnerZ: number, runnerX: number, dt: number) {
    // Smooth camera track target
    const targetZ = runnerZ - 6;
    const targetX = runnerX * 0.4;
    this.camera.position.z += (targetZ - this.camera.position.z) * Math.min(1.0, dt * 6.0);
    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1.0, dt * 6.0);
    this.camera.lookAt(runnerX * 0.2, 1.5, runnerZ + 8);

    // Keep light tracking runner
    this.dirLight.position.z = runnerZ - 10;
  }

  public updateParticles(runnerZ: number) {
    const attr = this.particles.geometry.attributes.position as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    for (let i = 0; i < 100; i++) {
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
