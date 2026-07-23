import * as THREE from 'three';

export interface BrickMeshInfo {
  id: string;
  side: 'p1' | 'p2';
  mesh: THREE.Mesh;
}

export class ArenaRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  public p1PaddleMesh: THREE.Mesh;
  public p2PaddleMesh: THREE.Mesh;
  public puckMesh: THREE.Mesh;
  public puckTrail: THREE.Points;

  public brickMeshes: Map<string, THREE.Mesh> = new Map();
  private puckTrailPositions: THREE.Vector3[] = [];
  private puckTrailGeometry: THREE.BufferGeometry;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060913);
    this.scene.fog = new THREE.FogExp2(0x060913, 0.015);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Overhead angled 3D rink perspective
    this.camera.position.set(0, 32, 24);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.setupLighting();
    this.setupArenaVisuals();

    // Create Paddle & Puck meshes
    this.p1PaddleMesh = this.createPaddleMesh(0x38bdf8);
    this.p2PaddleMesh = this.createPaddleMesh(0xf43f5e);
    this.puckMesh = this.createPuckMesh();

    this.scene.add(this.p1PaddleMesh);
    this.scene.add(this.p2PaddleMesh);
    this.scene.add(this.puckMesh);

    // Puck Trail Particles
    this.puckTrailGeometry = new THREE.BufferGeometry();
    const trailMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.4,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending
    });
    this.puckTrail = new THREE.Points(this.puckTrailGeometry, trailMat);
    this.scene.add(this.puckTrail);

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(10, 40, 20);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    this.scene.add(mainLight);

    // Neon Court Lights
    const blueSpot = new THREE.PointLight(0x38bdf8, 3, 40);
    blueSpot.position.set(-15, 10, 0);
    this.scene.add(blueSpot);

    const redSpot = new THREE.PointLight(0xf43f5e, 3, 40);
    redSpot.position.set(15, 10, 0);
    this.scene.add(redSpot);
  }

  private setupArenaVisuals() {
    // Rink Floor (36 wide x 20 deep)
    const floorGeo = new THREE.BoxGeometry(36, 0.4, 20);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.8
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Arena Grid & Center Line (neutral purple/magenta color)
    const gridHelper = new THREE.GridHelper(36, 18, 0x8b5cf6, 0x1e293b);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // Glowing Rink Walls - Neutral Middle Perimeter Color
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x8b5cf6,
      emissiveIntensity: 0.4,
      roughness: 0.2
    });

    // Top & Bottom Horizontal Walls
    const topWall = new THREE.Mesh(new THREE.BoxGeometry(36.8, 1.2, 0.6), wallMat);
    topWall.position.set(0, 0.6, -10.3);
    topWall.castShadow = true;
    this.scene.add(topWall);

    const botWall = new THREE.Mesh(new THREE.BoxGeometry(36.8, 1.2, 0.6), wallMat);
    botWall.position.set(0, 0.6, 10.3);
    botWall.castShadow = true;
    this.scene.add(botWall);

    // Side Perimeter Wall Flanks around Goal Zone (Top & Bottom segments on Left & Right)
    // Goal width is z = -4 to z = 4 (length 8). Flanks cover z = -10..-4 and z = 4..10 (length 6)
    const flankGeo = new THREE.BoxGeometry(0.6, 1.2, 6);

    const p1TopFlank = new THREE.Mesh(flankGeo, wallMat);
    p1TopFlank.position.set(-18.3, 0.6, -7);
    this.scene.add(p1TopFlank);

    const p1BotFlank = new THREE.Mesh(flankGeo, wallMat);
    p1BotFlank.position.set(-18.3, 0.6, 7);
    this.scene.add(p1BotFlank);

    const p2TopFlank = new THREE.Mesh(flankGeo, wallMat);
    p2TopFlank.position.set(18.3, 0.6, -7);
    this.scene.add(p2TopFlank);

    const p2BotFlank = new THREE.Mesh(flankGeo, wallMat);
    p2BotFlank.position.set(18.3, 0.6, 7);
    this.scene.add(p2BotFlank);

    // Goal Zone Backing & Floor Highlight (Open Goal Net Gap)
    const goalGeo = new THREE.BoxGeometry(0.6, 1.2, 8);
    const p1GoalMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0284c7, emissiveIntensity: 0.8, transparent: true, opacity: 0.4 });
    const p1Goal = new THREE.Mesh(goalGeo, p1GoalMat);
    p1Goal.position.set(-18.8, 0.6, 0);
    this.scene.add(p1Goal);

    const p2GoalMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0xe11d48, emissiveIntensity: 0.8, transparent: true, opacity: 0.4 });
    const p2Goal = new THREE.Mesh(goalGeo, p2GoalMat);
    p2Goal.position.set(18.8, 0.6, 0);
    this.scene.add(p2Goal);
  }

  private createPaddleMesh(colorHex: number): THREE.Mesh {
    // Line-like wider rectangular bar paddle (width X: 0.5, height Y: 0.8, depth Z: 3.2)
    const geo = new THREE.BoxGeometry(0.5, 0.8, 3.2);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.5
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  private createPuckMesh(): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 0.4, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xfacc15,
      emissiveIntensity: 0.8,
      roughness: 0.1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  public createBrickMesh(id: string, side: 'p1' | 'p2', x: number, z: number, depth: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(0.6, 0.8, depth - 0.2);
    const colorHex = side === 'p1' ? 0x0284c7 : 0xf43f5e;
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.5,
      roughness: 0.3
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.4, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.brickMeshes.set(id, mesh);
    return mesh;
  }

  public removeBrickMesh(id: string) {
    const mesh = this.brickMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.brickMeshes.delete(id);
    }
  }

  public setPaddleSize(paddle: THREE.Mesh, heightScale: number) {
    paddle.scale.set(1.0, 1.0, heightScale);
  }

  public updatePuckColor(owner: 'neutral' | 'p1' | 'p2') {
    const mat = this.puckMesh.material as THREE.MeshStandardMaterial;
    const trailMat = this.puckTrail.material as THREE.PointsMaterial;
    let colorHex = 0xfacc15; // Yellow default for neutral

    if (owner === 'p1') {
      colorHex = 0x38bdf8; // Blue for P1
    } else if (owner === 'p2') {
      colorHex = 0xf43f5e; // Red for P2
    }

    mat.color.setHex(colorHex);
    mat.emissive.setHex(colorHex);
    trailMat.color.setHex(colorHex);
  }

  public updatePuckTrail(puckPos: THREE.Vector3) {
    this.puckTrailPositions.unshift(puckPos.clone());
    if (this.puckTrailPositions.length > 12) {
      this.puckTrailPositions.pop();
    }
    const coords: number[] = [];
    for (const p of this.puckTrailPositions) {
      coords.push(p.x, p.y + 0.1, p.z);
    }
    this.puckTrailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
