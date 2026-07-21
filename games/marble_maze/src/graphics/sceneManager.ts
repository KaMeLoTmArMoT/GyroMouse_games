import * as THREE from 'three';
import { MazeData } from '../maze/mazeGenerator';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  public boardGroup: THREE.Group;
  private marbleMesh: THREE.Mesh;
  private coinMeshes: Map<string, THREE.Mesh> = new Map();
  private goalMesh: THREE.Mesh | null = null;
  private particleGroup: THREE.Group;

  private shadowLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0f1d');
    this.scene.fog = new THREE.FogExp2('#0c0f1d', 0.015);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 25, 0.001);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(this.ambientLight);

    this.shadowLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.shadowLight.position.set(15, 30, 20);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.width = 2048;
    this.shadowLight.shadow.mapSize.height = 2048;
    this.shadowLight.shadow.camera.near = 0.5;
    this.shadowLight.shadow.camera.far = 150;
    const d = 30;
    this.shadowLight.shadow.camera.left = -d;
    this.shadowLight.shadow.camera.right = d;
    this.shadowLight.shadow.camera.top = d;
    this.shadowLight.shadow.camera.bottom = -d;
    this.scene.add(this.shadowLight);

    // Marble Sphere Mesh
    const marbleGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      metalness: 0.9,
      roughness: 0.1
    });

    this.marbleMesh = new THREE.Mesh(marbleGeo, marbleMat);
    this.marbleMesh.castShadow = true;
    this.marbleMesh.receiveShadow = true;

    const stripeGeo = new THREE.TorusGeometry(0.35, 0.04, 16, 32);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.rotation.x = Math.PI / 2;
    this.marbleMesh.add(stripeMesh);

    // Add marbleMesh INSIDE boardGroup so it rotates with the board in 3D!
    this.boardGroup.add(this.marbleMesh);

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  public buildMazeMesh(maze: MazeData) {
    while (this.boardGroup.children.length > 0) {
      const child = this.boardGroup.children[0];
      this.boardGroup.remove(child);
    }
    this.coinMeshes.clear();

    // Re-add marbleMesh to boardGroup after clearing
    this.boardGroup.add(this.marbleMesh);

    const cellSize = maze.cellSize;
    const halfCell = cellSize / 2;
    const mazeWorldWidth = maze.width * cellSize;
    const mazeWorldHeight = maze.height * cellSize;

    const frameGeo = new THREE.BoxGeometry(mazeWorldWidth + 1.2, 0.6, mazeWorldHeight + 1.2);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(0, -0.4, 0);
    frameMesh.receiveShadow = true;
    this.boardGroup.add(frameMesh);

    const tileGeo = new THREE.BoxGeometry(cellSize, 0.4, cellSize);
    const wallGeoY = new THREE.BoxGeometry(cellSize, 0.8, 0.3);
    const wallGeoX = new THREE.BoxGeometry(0.3, 0.8, cellSize);

    const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.8, metalness: 0.1 });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.9, metalness: 0.0 });
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      roughness: 0.05,
      metalness: 0.2,
      transmission: 0.6,
      opacity: 0.9,
      transparent: true
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 });
    const pitMat = new THREE.MeshBasicMaterial({ color: 0x030305 });
    const pitRingMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const goalMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.3, emissive: 0x15803d });

    const pitGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 32);
    const pitRingGeo = new THREE.TorusGeometry(0.55, 0.06, 16, 32);

    for (let z = 0; z < maze.height; z++) {
      for (let x = 0; x < maze.width; x++) {
        const cell = maze.cells[z][x];
        const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
        const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;

        let mat = asphaltMat;
        if (cell.terrain === 'sand') mat = sandMat;
        if (cell.terrain === 'ice') mat = iceMat;
        if (cell.isGoal) mat = goalMat;

        const tileMesh = new THREE.Mesh(tileGeo, mat);
        tileMesh.position.set(cellCenterX, -0.2, cellCenterZ);
        tileMesh.receiveShadow = true;
        tileMesh.castShadow = true;
        this.boardGroup.add(tileMesh);

        if (cell.isHole) {
          const pitMesh = new THREE.Mesh(pitGeo, pitMat);
          pitMesh.position.set(cellCenterX, -0.18, cellCenterZ);
          this.boardGroup.add(pitMesh);

          const ringMesh = new THREE.Mesh(pitRingGeo, pitRingMat);
          ringMesh.rotation.x = Math.PI / 2;
          ringMesh.position.set(cellCenterX, 0.02, cellCenterZ);
          this.boardGroup.add(ringMesh);
        }

        if (cell.hasCoin && !cell.isHole) {
          const coinId = `coin_${x}_${z}`;
          const coinGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16);
          const coinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.2 });
          const coinMesh = new THREE.Mesh(coinGeo, coinMat);
          coinMesh.rotation.x = Math.PI / 2;
          coinMesh.position.set(cellCenterX, 0.4, cellCenterZ);
          coinMesh.castShadow = true;
          this.boardGroup.add(coinMesh);
          this.coinMeshes.set(coinId, coinMesh);
        }

        const g = cell.hasGuardrail;

        if (g.top) {
          const wMesh = new THREE.Mesh(wallGeoY, wallMat);
          wMesh.position.set(cellCenterX, 0.4, cellCenterZ - halfCell);
          wMesh.castShadow = true;
          wMesh.receiveShadow = true;
          this.boardGroup.add(wMesh);
        }
        if (g.bottom) {
          const wMesh = new THREE.Mesh(wallGeoY, wallMat);
          wMesh.position.set(cellCenterX, 0.4, cellCenterZ + halfCell);
          wMesh.castShadow = true;
          wMesh.receiveShadow = true;
          this.boardGroup.add(wMesh);
        }
        if (g.left) {
          const wMesh = new THREE.Mesh(wallGeoX, wallMat);
          wMesh.position.set(cellCenterX - halfCell, 0.4, cellCenterZ);
          wMesh.castShadow = true;
          wMesh.receiveShadow = true;
          this.boardGroup.add(wMesh);
        }
        if (g.right) {
          const wMesh = new THREE.Mesh(wallGeoX, wallMat);
          wMesh.position.set(cellCenterX + halfCell, 0.4, cellCenterZ);
          wMesh.castShadow = true;
          wMesh.receiveShadow = true;
          this.boardGroup.add(wMesh);
        }
      }
    }

    const goalX = maze.goalCell.x * cellSize + halfCell - mazeWorldWidth / 2;
    const goalZ = maze.goalCell.z * cellSize + halfCell - mazeWorldHeight / 2;

    const ringGeo = new THREE.TorusGeometry(0.8, 0.1, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    this.goalMesh = new THREE.Mesh(ringGeo, ringMat);
    this.goalMesh.rotation.x = Math.PI / 2;
    this.goalMesh.position.set(goalX, 0.05, goalZ);
    this.boardGroup.add(this.goalMesh);

    const maxDim = Math.max(mazeWorldWidth, mazeWorldHeight);
    this.camera.position.set(0, maxDim * 1.6, 0.001);
    this.camera.lookAt(0, 0, 0);
  }

  public updateBoardTilt(tiltXRad: number, tiltZRad: number) {
    this.boardGroup.rotation.x = tiltXRad;
    this.boardGroup.rotation.z = -tiltZRad;
  }

  public updateMarble(pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }) {
    this.marbleMesh.position.set(pos.x, pos.y, pos.z);
    this.marbleMesh.rotation.z -= vel.x * 0.05;
    this.marbleMesh.rotation.x += vel.z * 0.05;
  }

  public removeCoinMesh(coinId: string) {
    const mesh = this.coinMeshes.get(coinId);
    if (mesh) {
      this.createParticleBurst(mesh.position, 0xfacc15);
      this.boardGroup.remove(mesh);
      this.coinMeshes.delete(coinId);
    }
  }

  private createParticleBurst(pos: THREE.Vector3, colorHex: number) {
    const count = 12;
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];

    for (let i = 0; i < count; i++) {
      positions.push(
        pos.x + (Math.random() - 0.5) * 0.4,
        pos.y + (Math.random() - 0.5) * 0.4,
        pos.z + (Math.random() - 0.5) * 0.4
      );
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: colorHex, size: 0.15, transparent: true, opacity: 1 });
    const p = new THREE.Points(geo, mat);
    this.particleGroup.add(p);

    let opacity = 1.0;
    const interval = setInterval(() => {
      opacity -= 0.1;
      mat.opacity = opacity;
      if (opacity <= 0) {
        clearInterval(interval);
        this.particleGroup.remove(p);
      }
    }, 30);
  }

  public render() {
    this.coinMeshes.forEach((mesh) => {
      mesh.rotation.z += 0.03;
    });

    if (this.goalMesh) {
      this.goalMesh.rotation.z += 0.02;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
