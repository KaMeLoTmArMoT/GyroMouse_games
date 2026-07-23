import * as THREE from 'three';
import { TargetStructure } from '../physics/artilleryPhysics';

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

  // Active Cannonball Mesh & Trail
  public ballMesh: THREE.Mesh | null = null;
  public ballTrailPoints: THREE.Vector3[] = [];
  public ballTrailLine: THREE.Line | null = null;

  // Ghost Trajectory Arc (Progressive Sighting Hints)
  public trajectoryArcLine: THREE.Line | null = null;

  // Impact Craters on ground
  public craterGroup!: THREE.Group;

  // Explosion Particle System
  public particles: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];

  // Textures
  private groundTexture!: THREE.CanvasTexture;
  private skyTexture!: THREE.CanvasTexture;
  private woodTexture!: THREE.CanvasTexture;
  private metalTexture!: THREE.CanvasTexture;

  // Camera State & Orbit
  private defaultCamPos = new THREE.Vector3(0, 5, -9);
  private defaultCamLookAt = new THREE.Vector3(0, 3, 20);
  public currentCamPos = new THREE.Vector3().copy(this.defaultCamPos);
  public currentCamLookAt = new THREE.Vector3().copy(this.defaultCamLookAt);

  // Recoil State
  private recoilOffset: number = 0;

  public init(canvas: HTMLCanvasElement) {
    // Generate Procedural Textures
    this.createProceduralTextures();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c102b);
    this.scene.fog = new THREE.FogExp2(0x0c102b, 0.005);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      600
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
    const ambientLight = new THREE.AmbientLight(0xffedd5, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff1f2, 1.3);
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

    // Build Sky Dome & Field
    this.buildSky();
    this.buildTerrain();

    // Build Cannon
    this.buildCannon();

    // Crater Container
    this.craterGroup = new THREE.Group();
    this.scene.add(this.craterGroup);

    // Window Resize Listener
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private createProceduralTextures() {
    // 1. Ground Canvas Texture (Grass + Dirt Noise)
    const gCanvas = document.createElement('canvas');
    gCanvas.width = 512;
    gCanvas.height = 512;
    const gCtx = gCanvas.getContext('2d')!;
    gCtx.fillStyle = '#1e293b';
    gCtx.fillRect(0, 0, 512, 512);

    // Add noise grain & grass patches
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const size = 1 + Math.random() * 3;
      gCtx.fillStyle = Math.random() > 0.5 ? '#111827' : '#334155';
      gCtx.fillRect(x, y, size, size);
    }
    // Grid lines on texture
    gCtx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    gCtx.lineWidth = 2;
    for (let c = 0; c <= 512; c += 64) {
      gCtx.beginPath();
      gCtx.moveTo(c, 0); gCtx.lineTo(c, 512);
      gCtx.moveTo(0, c); gCtx.lineTo(512, c);
      gCtx.stroke();
    }
    this.groundTexture = new THREE.CanvasTexture(gCanvas);
    this.groundTexture.wrapS = THREE.RepeatWrapping;
    this.groundTexture.wrapT = THREE.RepeatWrapping;
    this.groundTexture.repeat.set(12, 12);

    // 2. Sky Sunset Gradient Texture
    const sCanvas = document.createElement('canvas');
    sCanvas.width = 1024;
    sCanvas.height = 512;
    const sCtx = sCanvas.getContext('2d')!;
    const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#090d16');
    skyGrad.addColorStop(0.4, '#1e1b4b');
    skyGrad.addColorStop(0.75, '#431407');
    skyGrad.addColorStop(1, '#9a3412');
    sCtx.fillStyle = skyGrad;
    sCtx.fillRect(0, 0, 1024, 512);

    // Draw stars on upper sky
    sCtx.fillStyle = '#ffffff';
    for (let i = 0; i < 150; i++) {
      const sx = Math.random() * 1024;
      const sy = Math.random() * 250;
      const sr = Math.random() * 1.5;
      sCtx.beginPath();
      sCtx.arc(sx, sy, sr, 0, Math.PI * 2);
      sCtx.fill();
    }
    this.skyTexture = new THREE.CanvasTexture(sCanvas);

    // 3. Brushed Metal Canvas Texture
    const mCanvas = document.createElement('canvas');
    mCanvas.width = 256;
    mCanvas.height = 256;
    const mCtx = mCanvas.getContext('2d')!;
    mCtx.fillStyle = '#1e293b';
    mCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 800; i++) {
      mCtx.fillStyle = Math.random() > 0.5 ? '#334155' : '#0f172a';
      mCtx.fillRect(0, Math.random() * 256, 256, 1);
    }
    this.metalTexture = new THREE.CanvasTexture(mCanvas);

    // 4. Wood Plank Canvas Texture
    const wCanvas = document.createElement('canvas');
    wCanvas.width = 256;
    wCanvas.height = 256;
    const wCtx = wCanvas.getContext('2d')!;
    wCtx.fillStyle = '#9a3412';
    wCtx.fillRect(0, 0, 256, 256);
    wCtx.fillStyle = '#7c2d12';
    for (let y = 0; y < 256; y += 32) {
      wCtx.fillRect(0, y, 256, 3);
    }
    this.woodTexture = new THREE.CanvasTexture(wCanvas);
  }

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(450, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTexture,
      side: THREE.BackSide
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyMesh);
  }

  private buildTerrain() {
    // Ground mesh with procedural grass/dirt map
    const groundGeo = new THREE.PlaneGeometry(350, 350, 40, 40);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.groundTexture,
      roughness: 0.8,
      metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 100);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Distance Marker Bands (20m to 90m)
    for (let d = 20; d <= 90; d += 10) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-45, 0.1, d),
        new THREE.Vector3(45, 0.1, d)
      ]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0xef4444,
        dashSize: 1.5,
        gapSize: 1.0,
        opacity: 0.6,
        transparent: true
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      this.scene.add(line);
    }
  }

  private buildCannon() {
    this.cannonBaseGroup = new THREE.Group();
    this.cannonBaseGroup.position.set(0, 0, 0);

    // Swivel Base Mount
    const baseGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.8, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      map: this.metalTexture,
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.3
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.4;
    baseMesh.castShadow = true;
    this.cannonBaseGroup.add(baseMesh);

    // Turret Support Brackets
    const bracketGeo = new THREE.BoxGeometry(0.5, 1.4, 1.2);
    const bracketMat = new THREE.MeshStandardMaterial({
      map: this.metalTexture,
      color: 0x334155,
      metalness: 0.7,
      roughness: 0.4
    });
    const leftBracket = new THREE.Mesh(bracketGeo, bracketMat);
    leftBracket.position.set(-1.1, 1.2, 0);
    leftBracket.castShadow = true;

    const rightBracket = new THREE.Mesh(bracketGeo, bracketMat);
    rightBracket.position.set(1.1, 1.2, 0);
    rightBracket.castShadow = true;

    this.cannonBaseGroup.add(leftBracket, rightBracket);

    // Cannon Barrel Pivot Group (Pitches up/down around Y=1.5, Z=0)
    this.cannonBarrelGroup = new THREE.Group();
    this.cannonBarrelGroup.position.set(0, 1.5, 0);

    // Heavy Metal Barrel Tube Mesh
    const barrelGeo = new THREE.CylinderGeometry(0.5, 0.75, 4.2, 16);
    barrelGeo.rotateX(Math.PI / 2);
    barrelGeo.translate(0, 0, 2.1); // pivot at rear

    const barrelMat = new THREE.MeshStandardMaterial({
      map: this.metalTexture,
      color: 0x1e293b,
      metalness: 0.9,
      roughness: 0.2
    });
    this.cannonMesh = new THREE.Mesh(barrelGeo, barrelMat);
    this.cannonMesh.castShadow = true;
    this.cannonMesh.position.set(0, 0, 0); // initial recoil offset is 0

    // Barrel Gold Ring Detail (attached to cannonMesh so it recoils with barrel)
    const ringGeo = new THREE.TorusGeometry(0.55, 0.08, 8, 16);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(0, 0, 3.8);
    this.cannonMesh.add(ringMesh);

    this.cannonBarrelGroup.add(this.cannonMesh);
    this.cannonBaseGroup.add(this.cannonBarrelGroup);
    this.scene.add(this.cannonBaseGroup);
  }

  public updateTurretOrientation(pitchDeg: number, yawDeg: number) {
    const yawRad = (yawDeg * Math.PI) / 180;
    this.cannonBaseGroup.rotation.y = -yawRad;

    // Pitch rotates barrel group around X-axis
    this.cannonBarrelGroup.rotation.x = -(pitchDeg * Math.PI) / 180;

    // Swing camera directly behind cannon barrel direction
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

  public syncTargets(targets: Map<string, TargetStructure>) {
    targets.forEach((target, id) => {
      let group = this.targetMeshes.get(id);

      if (!group) {
        group = new THREE.Group();

        // Main Target Box Mesh with Wood Texture
        const boxGeo = new THREE.BoxGeometry(target.size.x, target.size.y, target.size.z);
        const boxMat = new THREE.MeshStandardMaterial({
          map: this.woodTexture,
          color: 0xef4444,
          metalness: 0.2,
          roughness: 0.7
        });
        const boxMesh = new THREE.Mesh(boxGeo, boxMat);
        boxMesh.castShadow = true;
        boxMesh.receiveShadow = true;
        group.add(boxMesh);

        // Bullseye Target Ring Decal
        const ringGeo = new THREE.RingGeometry(0.3, 0.9, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(0, 0, target.size.z / 2 + 0.01);
        group.add(ringMesh);

        this.scene.add(group);
        this.targetMeshes.set(id, group);
      }

      group.position.set(target.position.x, target.position.y, target.position.z);

      const boxMesh = group.children[0] as THREE.Mesh;
      const mat = boxMesh.material as THREE.MeshStandardMaterial;

      if (target.isDestroyed) {
        mat.color.setHex(0x334155);
        mat.opacity = 0.4;
        mat.transparent = true;
      } else {
        const hpRatio = target.hp / target.maxHp;
        mat.color.setHSL(0.0 + hpRatio * 0.15, 0.8, 0.45);
      }
    });
  }

  public createCannonballMesh(): THREE.Mesh {
    if (this.ballMesh) this.scene.remove(this.ballMesh);

    const ballGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({
      map: this.metalTexture,
      color: 0x0f172a,
      metalness: 0.95,
      roughness: 0.1,
      emissive: 0xef4444,
      emissiveIntensity: 0.4
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    if (this.ballTrailLine) this.scene.remove(this.ballTrailLine);
    this.ballTrailPoints = [];

    return this.ballMesh;
  }

  public updateCannonball(pos: { x: number; y: number; z: number }) {
    if (!this.ballMesh) return;
    this.ballMesh.position.set(pos.x, pos.y, pos.z);

    this.ballTrailPoints.push(new THREE.Vector3(pos.x, pos.y, pos.z));
    if (this.ballTrailPoints.length > 50) this.ballTrailPoints.shift();

    if (this.ballTrailLine) this.scene.remove(this.ballTrailLine);

    const lineGeo = new THREE.BufferGeometry().setFromPoints(this.ballTrailPoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 });
    this.ballTrailLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.ballTrailLine);

    this.spawnSmokeParticle(pos);
  }

  public triggerRecoil() {
    this.recoilOffset = 0.8;
  }

  public triggerExplosion(pos: { x: number; y: number; z: number }) {
    const craterGeo = new THREE.CircleGeometry(2.2, 16);
    const craterMat = new THREE.MeshBasicMaterial({
      color: 0x090d16,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const crater = new THREE.Mesh(craterGeo, craterMat);
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(pos.x, 0.06, pos.z);
    this.craterGroup.add(crater);

    for (let i = 0; i < 35; i++) {
      const geo = new THREE.SphereGeometry(0.2 + Math.random() * 0.35, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.4 ? 0xef4444 : 0xf59e0b,
        transparent: true,
        opacity: 0.95
      });
      const pMesh = new THREE.Mesh(geo, mat);
      pMesh.position.set(pos.x, pos.y + 0.2, pos.z);

      const vx = (Math.random() - 0.5) * 14;
      const vy = Math.random() * 12 + 5;
      const vz = (Math.random() - 0.5) * 14;

      this.scene.add(pMesh);
      this.particles.push({ mesh: pMesh, velocity: new THREE.Vector3(vx, vy, vz), life: 1.2 });
    }
  }

  private spawnSmokeParticle(pos: { x: number; y: number; z: number }) {
    if (Math.random() > 0.4) return;

    const geo = new THREE.SphereGeometry(0.25, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.6
    });
    const pMesh = new THREE.Mesh(geo, mat);
    pMesh.position.set(pos.x, pos.y, pos.z);

    this.scene.add(pMesh);
    this.particles.push({
      mesh: pMesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        Math.random() * 0.5 + 0.2,
        (Math.random() - 0.5) * 0.5
      ),
      life: 0.6
    });
  }

  public drawGhostTrajectory(history: Array<{ x: number; y: number; z: number }[]>) {
    if (this.trajectoryArcLine) {
      this.scene.remove(this.trajectoryArcLine);
      this.trajectoryArcLine = null;
    }

    if (history.length === 0) return;

    const latestTrajectory = history[history.length - 1];
    const points = latestTrajectory.map((p) => new THREE.Vector3(p.x, p.y, p.z));

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.8,
      gapSize: 0.4,
      linewidth: 2
    });
    this.trajectoryArcLine = new THREE.Line(lineGeo, lineMat);
    this.trajectoryArcLine.computeLineDistances();
    this.scene.add(this.trajectoryArcLine);
  }

  public update(dt: number, activeBallPos: THREE.Vector3 | null) {
    // Update recoil recovery smoothly (recoils along Z axis of cannonMesh)
    if (this.recoilOffset > 0) {
      this.recoilOffset = Math.max(0, this.recoilOffset - dt * 3.5);
      this.cannonMesh.position.z = -this.recoilOffset;
    } else {
      this.cannonMesh.position.z = 0;
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt * 1.5;

      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= 9.8 * dt * 0.3;

      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, p.life);

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    // Camera follow mode when cannonball is active
    if (activeBallPos) {
      const targetCamPos = new THREE.Vector3(
        activeBallPos.x - 4,
        Math.max(4, activeBallPos.y + 3),
        activeBallPos.z - 8
      );
      this.currentCamPos.lerp(targetCamPos, Math.min(1.0, dt * 4.0));
      this.currentCamLookAt.lerp(activeBallPos, Math.min(1.0, dt * 6.0));
    } else {
      this.currentCamPos.lerp(this.defaultCamPos, Math.min(1.0, dt * 3.0));
      this.currentCamLookAt.lerp(this.defaultCamLookAt, Math.min(1.0, dt * 3.0));
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
    if (this.ballMesh) {
      this.scene.remove(this.ballMesh);
      this.ballMesh = null;
    }
    if (this.ballTrailLine) {
      this.scene.remove(this.ballTrailLine);
      this.ballTrailLine = null;
    }
  }

  public resetLevelVisuals() {
    this.clearBallVisuals();
    if (this.trajectoryArcLine) {
      this.scene.remove(this.trajectoryArcLine);
      this.trajectoryArcLine = null;
    }
    this.targetMeshes.forEach((mesh) => this.scene.remove(mesh));
    this.targetMeshes.clear();

    while (this.craterGroup.children.length > 0) {
      this.craterGroup.remove(this.craterGroup.children[0]);
    }
  }
}
