import * as THREE from 'three';
import { MazeData, HoleMovePattern, gateBlockDirection } from '../maze/mazeGenerator';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  public boardGroup: THREE.Group;
  private marbleMesh: THREE.Mesh;
  private coinMeshes: Map<string, THREE.Mesh> = new Map();
  private goalMesh: THREE.Mesh | null = null;
  private particleGroup: THREE.Group;

  private movingHoles: {
    group: THREE.Group;
    baseX: number;
    baseZ: number;
    pattern: HoleMovePattern;
    speed: number;
    range: number;
    elapsed: number;
  }[] = [];

  private checkpointMeshes: Map<string, THREE.Mesh> = new Map();
  private activeCheckpointId: string | null = null;

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

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.ambientLight);

    this.shadowLight = new THREE.DirectionalLight(0xffffff, 2.2);
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

    public buildMazeMesh(maze: MazeData, debugPathEnabled: boolean = false) {
     console.log(`[SCENE DEBUG] Building maze mesh for ${maze.width}x${maze.height} maze`);
     
     while (this.boardGroup.children.length > 0) {
       const child = this.boardGroup.children[0];
       this.boardGroup.remove(child);
     }
      this.coinMeshes.clear();
      this.movingHoles = [];
      this.removeDebugPath();

     // Configure Theme Background & Fog & Lighting
     this.applyThemeEnvironment(maze.theme);

    // Re-add marbleMesh to boardGroup after clearing
    this.boardGroup.add(this.marbleMesh);

    const cellSize = maze.cellSize;
    const halfCell = cellSize / 2;
    const mazeWorldWidth = maze.width * cellSize;
    const mazeWorldHeight = maze.height * cellSize;

    const frameGeo = new THREE.BoxGeometry(mazeWorldWidth + 1.2, 0.6, mazeWorldHeight + 1.2);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2d3a4a, roughness: 0.8 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(0, -0.4, 0);
    frameMesh.receiveShadow = true;
    this.boardGroup.add(frameMesh);

    const tileGeo = new THREE.BoxGeometry(cellSize, 0.4, cellSize);
    const wallGeoY = new THREE.BoxGeometry(cellSize, 0.8, 0.3);
    const wallGeoX = new THREE.BoxGeometry(0.3, 0.8, cellSize);

    // Materials Palette
    const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x5a6e8a, roughness: 0.8, metalness: 0.1 });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xe8a830, roughness: 0.9, metalness: 0.0 });
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0x6fd4ff,
      roughness: 0.05,
      metalness: 0.2,
      transmission: 0.6,
      opacity: 0.9,
      transparent: true
    });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf8faff, roughness: 0.6, metalness: 0.05 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x33cc55, roughness: 0.8, metalness: 0.0 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x9d5b2a, roughness: 0.95, metalness: 0.0 });
    const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.5, metalness: 0.2 });

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xbcc4d0, roughness: 0.5, metalness: 0.3 });
    const pitMat = new THREE.MeshBasicMaterial({ color: 0x020208 });
    const pitRingMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    const pitMovingRingMat = new THREE.MeshBasicMaterial({ color: 0x00ffee });
     const goalMat = new THREE.MeshStandardMaterial({ color: 0x00ff66, roughness: 0.2, emissive: 0x00cc44 });

     // Counters for debugging
     let floorTiles = 0;
     let wallSegments = 0;
     let guardrailSegments = 0;
     let gatesRendered = 0;
     let coinsRendered = 0;
     let holesRendered = 0;
     let bridgesRendered = 0;

     for (let z = 0; z < maze.height; z++) {
       for (let x = 0; x < maze.width; x++) {
         const cell = maze.cells[z][x];
         const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
         const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;

        let mat = asphaltMat;
        switch (cell.terrain) {
          case 'sand': mat = sandMat; break;
          case 'ice': mat = iceMat; break;
          case 'snow': mat = snowMat; break;
          case 'grass': mat = grassMat; break;
          case 'dirt': mat = dirtMat; break;
          case 'cobblestone': mat = cobbleMat; break;
          case 'asphalt': default: mat = asphaltMat; break;
        }
        if (cell.isGoal) mat = goalMat;

        if (!cell.isBridge) {
          const tileMesh = new THREE.Mesh(tileGeo, mat);
          tileMesh.position.set(cellCenterX, -0.2, cellCenterZ);
          tileMesh.receiveShadow = true;
          tileMesh.castShadow = true;
          this.boardGroup.add(tileMesh);
        }

         if (cell.isBridge) {
           const cfg = cell.bridgeConfig!;
           const bridgeWidth = cellSize / 3;
           const halfBridge = bridgeWidth / 2;
           const isZ = cfg.axis === 'z';
           bridgesRendered++;

          const holes: { offset: number; halfW: number }[] = [];
          let bridgeOff: number;

          switch (cfg.lane) {
            case 'left':
              bridgeOff = -halfCell + halfBridge;
              holes.push({ offset: halfBridge, halfW: halfCell - halfBridge });
              break;
            case 'center':
              bridgeOff = 0;
              holes.push({ offset: -halfCell + halfBridge, halfW: halfBridge });
              holes.push({ offset: halfCell - halfBridge, halfW: halfBridge });
              break;
            case 'right':
              bridgeOff = halfCell - halfBridge;
              holes.push({ offset: -halfBridge, halfW: halfCell - halfBridge });
              break;
          }

          if (isZ) {
            const bridgeGeo = new THREE.BoxGeometry(bridgeWidth * 0.9, 0.4, cellSize * 0.9);
            const bridgeMesh = new THREE.Mesh(bridgeGeo, mat);
            bridgeMesh.position.set(cellCenterX + bridgeOff, -0.2, cellCenterZ);
            bridgeMesh.receiveShadow = true;
            bridgeMesh.castShadow = true;
            this.boardGroup.add(bridgeMesh);

            for (const h of holes) {
              const pitGeo = new THREE.BoxGeometry(h.halfW * 1.8, 0.45, cellSize * 0.9);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(cellCenterX + h.offset, -0.18, cellCenterZ);
              this.boardGroup.add(pitMesh);

              const ringEdgeX = h.offset > bridgeOff
                ? bridgeOff + halfBridge
                : bridgeOff - halfBridge;
              const ringGeo = new THREE.BoxGeometry(0.05, 0.04, cellSize * 0.85);
              const ringMesh = new THREE.Mesh(ringGeo, pitRingMat);
              ringMesh.position.set(cellCenterX + ringEdgeX, 0.02, cellCenterZ);
              this.boardGroup.add(ringMesh);
            }
          } else {
            const bridgeGeo = new THREE.BoxGeometry(cellSize * 0.9, 0.4, bridgeWidth * 0.9);
            const bridgeMesh = new THREE.Mesh(bridgeGeo, mat);
            bridgeMesh.position.set(cellCenterX, -0.2, cellCenterZ + bridgeOff);
            bridgeMesh.receiveShadow = true;
            bridgeMesh.castShadow = true;
            this.boardGroup.add(bridgeMesh);

            for (const h of holes) {
              const pitGeo = new THREE.BoxGeometry(cellSize * 0.9, 0.45, h.halfW * 1.8);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(cellCenterX, -0.18, cellCenterZ + h.offset);
              this.boardGroup.add(pitMesh);

              const ringEdgeZ = h.offset > bridgeOff
                ? bridgeOff + halfBridge
                : bridgeOff - halfBridge;
              const ringGeo = new THREE.BoxGeometry(cellSize * 0.85, 0.04, 0.05);
              const ringMesh = new THREE.Mesh(ringGeo, pitRingMat);
              ringMesh.position.set(cellCenterX, 0.02, cellCenterZ + ringEdgeZ);
              this.boardGroup.add(ringMesh);
            }
          }
         } else if (cell.isHole) {
           const defaultCfg = { shape: 'round' as const, radius: 0.5, size: 0, offsetX: 0, offsetZ: 0, movePattern: 'static' as HoleMovePattern, moveSpeed: 0, moveRange: 0 };
           const cfg = cell.holeConfig || defaultCfg;
           const holeWorldX = cellCenterX + cfg.offsetX;
           const holeWorldZ = cellCenterZ + cfg.offsetZ;
           const isSquare = cfg.shape === 'square';
           const halfExtent = isSquare ? cfg.size / 2 : cfg.radius;
           const isMoving = cfg.movePattern !== 'static';
           holesRendered++;

          if (isMoving) {
            // Moving hole: render tile normally + pit group on top that moves
            const tileMesh = new THREE.Mesh(tileGeo, mat);
            tileMesh.position.set(cellCenterX, -0.2, cellCenterZ);
            tileMesh.receiveShadow = true;
            tileMesh.castShadow = true;
            this.boardGroup.add(tileMesh);

            const holeGroup = new THREE.Group();
            holeGroup.position.set(holeWorldX, 0, holeWorldZ);

            if (isSquare) {
              const pitGeo = new THREE.BoxGeometry(cfg.size, 0.45, cfg.size);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(0, -0.18, 0);
              holeGroup.add(pitMesh);

              const ringThickness = 0.05;
              const ringHeight = 0.04;
              const horizGeo = new THREE.BoxGeometry(cfg.size + ringThickness * 2, ringHeight, ringThickness);
              const topRing = new THREE.Mesh(horizGeo, pitMovingRingMat);
              topRing.position.set(0, 0, -halfExtent - ringThickness / 2);
              holeGroup.add(topRing);
              const botRing = new THREE.Mesh(horizGeo, pitMovingRingMat);
              botRing.position.set(0, 0, halfExtent + ringThickness / 2);
              holeGroup.add(botRing);
              const vertGeo = new THREE.BoxGeometry(ringThickness, ringHeight, cfg.size);
              const leftRing = new THREE.Mesh(vertGeo, pitMovingRingMat);
              leftRing.position.set(-halfExtent - ringThickness / 2, 0, 0);
              holeGroup.add(leftRing);
              const rightRing = new THREE.Mesh(vertGeo, pitMovingRingMat);
              rightRing.position.set(halfExtent + ringThickness / 2, 0, 0);
              holeGroup.add(rightRing);
            } else {
              const pitGeo = new THREE.CylinderGeometry(halfExtent, halfExtent, 0.45, 32);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(0, -0.18, 0);
              holeGroup.add(pitMesh);

              const pitRingGeo = new THREE.TorusGeometry(halfExtent, 0.05, 16, 32);
              const ringMesh = new THREE.Mesh(pitRingGeo, pitMovingRingMat);
              ringMesh.rotation.x = Math.PI / 2;
              ringMesh.position.set(0, 0.02, 0);
              holeGroup.add(ringMesh);
            }

            this.boardGroup.add(holeGroup);
            this.movingHoles.push({
              group: holeGroup,
              baseX: holeWorldX,
              baseZ: holeWorldZ,
              pattern: cfg.movePattern,
              speed: cfg.moveSpeed,
              range: cfg.moveRange,
              elapsed: 0,
            });
          } else {
            // Static hole: no tile, pit directly on board
            if (isSquare) {
              const pitGeo = new THREE.BoxGeometry(cfg.size, 0.45, cfg.size);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(holeWorldX, -0.18, holeWorldZ);
              this.boardGroup.add(pitMesh);

              const ringThickness = 0.05;
              const ringHeight = 0.04;
              const ringGroup = new THREE.Group();

              const horizGeo = new THREE.BoxGeometry(cfg.size + ringThickness * 2, ringHeight, ringThickness);
              const topRing = new THREE.Mesh(horizGeo, pitRingMat);
              topRing.position.set(0, 0, -halfExtent - ringThickness / 2);
              ringGroup.add(topRing);
              const botRing = new THREE.Mesh(horizGeo, pitRingMat);
              botRing.position.set(0, 0, halfExtent + ringThickness / 2);
              ringGroup.add(botRing);

              const vertGeo = new THREE.BoxGeometry(ringThickness, ringHeight, cfg.size);
              const leftRing = new THREE.Mesh(vertGeo, pitRingMat);
              leftRing.position.set(-halfExtent - ringThickness / 2, 0, 0);
              ringGroup.add(leftRing);
              const rightRing = new THREE.Mesh(vertGeo, pitRingMat);
              rightRing.position.set(halfExtent + ringThickness / 2, 0, 0);
              ringGroup.add(rightRing);

              ringGroup.position.set(holeWorldX, 0.02, holeWorldZ);
              this.boardGroup.add(ringGroup);
            } else {
              const pitGeo = new THREE.CylinderGeometry(halfExtent, halfExtent, 0.45, 32);
              const pitMesh = new THREE.Mesh(pitGeo, pitMat);
              pitMesh.position.set(holeWorldX, -0.18, holeWorldZ);
              this.boardGroup.add(pitMesh);

              const pitRingGeo = new THREE.TorusGeometry(halfExtent, 0.05, 16, 32);
              const ringMesh = new THREE.Mesh(pitRingGeo, pitRingMat);
              ringMesh.rotation.x = Math.PI / 2;
              ringMesh.position.set(holeWorldX, 0.02, holeWorldZ);
              this.boardGroup.add(ringMesh);
            }
          }
        }

         if (cell.hasCoin && !cell.isHole && !cell.isBridge) {
           const coinId = `coin_${x}_${z}`;
           const coinGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16);
           const coinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.2 });
           const coinMesh = new THREE.Mesh(coinGeo, coinMat);
           coinMesh.rotation.x = Math.PI / 2;
           coinMesh.position.set(cellCenterX, 0.4, cellCenterZ);
           coinMesh.castShadow = true;
           this.boardGroup.add(coinMesh);
           this.coinMeshes.set(coinId, coinMesh);
           coinsRendered++;
         }

         const g = cell.hasGuardrail;

         if (g.top) {
           const wMesh = new THREE.Mesh(wallGeoY, wallMat);
           wMesh.position.set(cellCenterX, 0.4, cellCenterZ - halfCell);
           wMesh.castShadow = true;
           wMesh.receiveShadow = true;
           this.boardGroup.add(wMesh);
           guardrailSegments++;
         }
         if (g.bottom) {
           const wMesh = new THREE.Mesh(wallGeoY, wallMat);
           wMesh.position.set(cellCenterX, 0.4, cellCenterZ + halfCell);
           wMesh.castShadow = true;
           wMesh.receiveShadow = true;
           this.boardGroup.add(wMesh);
           guardrailSegments++;
         }
         if (g.left) {
           const wMesh = new THREE.Mesh(wallGeoX, wallMat);
           wMesh.position.set(cellCenterX - halfCell, 0.4, cellCenterZ);
           wMesh.castShadow = true;
           wMesh.receiveShadow = true;
           this.boardGroup.add(wMesh);
           guardrailSegments++;
         }
         if (g.right) {
           const wMesh = new THREE.Mesh(wallGeoX, wallMat);
           wMesh.position.set(cellCenterX + halfCell, 0.4, cellCenterZ);
           wMesh.castShadow = true;
           wMesh.receiveShadow = true;
           this.boardGroup.add(wMesh);
           guardrailSegments++;
         }
      }
    }

    // Gate meshes
    for (let z = 0; z < maze.height; z++) {
      for (let x = 0; x < maze.width; x++) {
        const cell = maze.cells[z][x];
         if (cell.isGate) {
           const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
           const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;
           // Use the stored main path from maze generator to ensure consistency
           const mainPath = maze.mainPath;
           const pathIndex = new Map<string, number>();
           mainPath.forEach((p, i) => pathIndex.set(`${p.x},${p.z}`, i));
           
          const currentIdx = pathIndex.get(`${x},${z}`);
          
          // Gates should always be on main path now that we use stored mainPath
          // Keep this check as safety net but remove verbose logging
          if (currentIdx === undefined) {
            console.warn(`Gate at (${x},${z}) not on main path - this shouldn't happen`);
          }
          
            // Gate wall — placed on the wall side blocking forward path exit
            const gateMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x330000 });
            const blockDir = gateBlockDirection(x, z, maze.mainPath);
            const wallMesh = (blockDir === 'top' || blockDir === 'bottom')
              ? new THREE.Mesh(wallGeoY, gateMat)
              : new THREE.Mesh(wallGeoX, gateMat);
            wallMesh.position.set(
              blockDir === 'left' ? cellCenterX - halfCell :
                blockDir === 'right' ? cellCenterX + halfCell : cellCenterX,
              0.4,
              blockDir === 'top' ? cellCenterZ - halfCell :
                blockDir === 'bottom' ? cellCenterZ + halfCell : cellCenterZ
            );
            wallMesh.userData = { type: 'gate', x, z };
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            this.boardGroup.add(wallMesh);
           gatesRendered++;
           
            // Cost text
            const cost = maze.cells[z][x].gateCost || 5;
            this.addGateCostText(cellCenterX, 0.5, cellCenterZ, x, z, cost);
         }
      }
    }

    // Checkpoint meshes — all start inactive (blue)
    this.checkpointMeshes.clear();
    this.activeCheckpointId = null;
    for (let z = 0; z < maze.height; z++) {
      for (let x = 0; x < maze.width; x++) {
        const cell = maze.cells[z][x];
        if (cell.isCheckpoint) {
          const cellCenterX = x * cellSize + halfCell - mazeWorldWidth / 2;
          const cellCenterZ = z * cellSize + halfCell - mazeWorldHeight / 2;
          const checkpointId = `checkpoint_${x}_${z}`;

          const ringMat = new THREE.MeshStandardMaterial({
            color: 0x3366ff,
            emissive: 0x0033cc,
            emissiveIntensity: 0.3
          });
          const pillarMat = new THREE.MeshStandardMaterial({ color: 0x6688cc, roughness: 0.6 });

          const group = new THREE.Group();
          group.position.set(cellCenterX, 0, cellCenterZ);

          const ringGeo = new THREE.TorusGeometry(0.6, 0.08, 16, 32);
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = Math.PI / 2;
          ringMesh.position.y = 0.05;
          group.add(ringMesh);

          const pillarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8);
          const positions = [
            [-0.55, 0.25, 0], [0.55, 0.25, 0],
            [0, 0.25, -0.55], [0, 0.25, 0.55]
          ];
          for (const [px, py, pz] of positions) {
            const pillar = new THREE.Mesh(pillarGeo, pillarMat);
            pillar.position.set(px, py, pz);
            group.add(pillar);
          }

          this.boardGroup.add(group);
          this.checkpointMeshes.set(checkpointId, ringMesh);
         }
       }
     }

     // Debug summary
      console.log(`[SCENE DEBUG] Rendered: ${floorTiles} floor tiles, ${guardrailSegments} guardrail segments, ${wallSegments} wall segments`);
      console.log(`[SCENE DEBUG] Elements: ${coinsRendered} coins, ${gatesRendered} gates, ${holesRendered} holes, ${bridgesRendered} bridges`);
      console.log(`[SCENE DEBUG] Main path length: ${maze.mainPath.length}`);

        if (debugPathEnabled) {
          this.createDebugPath(maze);
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

  private createDebugPath(mazeData: MazeData) {
    if (!mazeData.mainPath || mazeData.mainPath.length === 0) {
      console.warn('[SCENE DEBUG] No main path available for debug rendering');
      return;
    }

    const cellSize = mazeData.cellSize;
    const halfCell = cellSize / 2;

    const linePoints: THREE.Vector3[] = [];
    for (const pathCell of mazeData.mainPath) {
      const worldX = (pathCell.x - mazeData.width / 2) * cellSize + halfCell;
      const worldZ = (pathCell.z - mazeData.height / 2) * cellSize + halfCell;
      linePoints.push(new THREE.Vector3(worldX, 0.08, worldZ));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x64C8FF, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;
    line.renderOrder = 1;
    this.boardGroup.add(line);
  }

  private removeDebugPath() {
    const lines = this.boardGroup.children.filter(c => c.type === 'Line');
    for (const line of lines) {
      this.boardGroup.remove(line);
      (line as THREE.Line).geometry.dispose();
    }
  }

  public setCheckpointActiveState(checkpointId: string, state: 'inactive' | 'active' | 'claimed') {
    const mesh = this.checkpointMeshes.get(checkpointId);
    if (!mesh) return;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    switch (state) {
      case 'inactive':
        mat.color.setHex(0x3366ff);
        mat.emissive.setHex(0x0033cc);
        mat.emissiveIntensity = 0.3;
        break;
      case 'active':
        mat.color.setHex(0x00ff88);
        mat.emissive.setHex(0x00ff66);
        mat.emissiveIntensity = 1.2;
        this.activeCheckpointId = checkpointId;
        break;
      case 'claimed':
        mat.color.setHex(0x445577);
        mat.emissive.setHex(0x112244);
        mat.emissiveIntensity = 0.15;
        break;
    }
  }

  /** Demote current active checkpoint to claimed, activate a new one */
  public activateCheckpoint(checkpointId: string) {
    if (this.activeCheckpointId) {
      this.setCheckpointActiveState(this.activeCheckpointId, 'claimed');
    }
    this.setCheckpointActiveState(checkpointId, 'active');
  }

  /** Reset all checkpoints to inactive */
  public resetCheckpoints() {
    this.checkpointMeshes.forEach((_, id) => {
      this.setCheckpointActiveState(id, 'inactive');
    });
    this.activeCheckpointId = null;
  }

  public updateDebugPathVisibility(visible: boolean) {
    const lines = this.boardGroup.children.filter(c => c.type === 'Line');
    for (const line of lines) {
      line.visible = visible;
    }
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

  public updateMovingHoles(dt: number) {
    for (const mh of this.movingHoles) {
      mh.elapsed += dt;
      let dx = 0;
      let dz = 0;
      const t = mh.elapsed * mh.speed;

      switch (mh.pattern) {
        case 'horizontal':
          dx = Math.sin(t) * mh.range;
          break;
        case 'vertical':
          dz = Math.sin(t) * mh.range;
          break;
        case 'circular':
          dx = Math.cos(t) * mh.range;
          dz = Math.sin(t) * mh.range;
          break;
      }

      mh.group.position.set(mh.baseX + dx, 0, mh.baseZ + dz);
    }
  }

  public removeCoinMesh(coinId: string) {
    const mesh = this.coinMeshes.get(coinId);
    if (mesh) {
      this.createParticleBurst(mesh.position, 0xfacc15);
      this.boardGroup.remove(mesh);
      this.coinMeshes.delete(coinId);
    }
  }

  public removeGateMesh(gateId: string) {
    const parts = gateId.split('_');
    const x = parseInt(parts[1], 10);
    const z = parseInt(parts[2], 10);
    
    // Remove all gate parts (top, bottom, pillars)
    this.boardGroup.children.forEach((child) => {
      if (child.userData.type === 'gate' && child.userData.x === x && child.userData.z === z) {
        this.boardGroup.remove(child);
      }
    });
    
    // Remove cost text
    const costText = this.boardGroup.children.find((child) => {
      return child.userData.type === 'gateCost' && child.userData.x === x && child.userData.z === z;
    }) as THREE.Object3D | undefined;
    
    if (costText) {
      this.boardGroup.remove(costText);
    }
  }

  private addGateCostText(x: number, height: number, z: number, gridX: number, gridZ: number, cost: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 40px Arial';
    ctx.fillStyle = '#ffcc00';
    ctx.textAlign = 'center';
    ctx.fillText(`${cost}⭐`, canvas.width / 2, 48);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, height + 0.5, z);
    sprite.scale.set(0.5, 0.25, 1);
    sprite.userData = { type: 'gateCost', x: gridX, z: gridZ };
    this.boardGroup.add(sprite);
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

  private applyThemeEnvironment(theme: 'winter' | 'city' | 'forest') {
    let bgColor = '#060912';
    let fogDensity = 0.008;
    let lightColor = 0xffffff;

    if (theme === 'winter') {
      bgColor = '#080c1a';
      fogDensity = 0.007;
      lightColor = 0xffeedd;
    } else if (theme === 'city') {
      bgColor = '#080b14';
      fogDensity = 0.009;
      lightColor = 0xffbb33;
    } else if (theme === 'forest') {
      bgColor = '#060912';
      fogDensity = 0.008;
      lightColor = 0xffcc55;
    }

    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.FogExp2(bgColor, fogDensity);
    this.shadowLight.color.setHex(lightColor);
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
