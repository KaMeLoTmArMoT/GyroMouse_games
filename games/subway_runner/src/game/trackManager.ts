import * as THREE from 'three';

export type ObstacleType = 'train' | 'low_hurdle' | 'high_hurdle' | 'coin';

export interface TrackObstacle {
  type: ObstacleType;
  mesh: THREE.Object3D;
  lane: number;
  z: number;
  active: boolean;
}

export class TrackManager {
  private scene: THREE.Scene;
  private trackChunks: THREE.Group[] = [];
  public obstacles: TrackObstacle[] = [];

  private nextSpawnZ: number = 0;
  private readonly CHUNK_LENGTH: number = 40;
  private readonly LANE_DISTANCE: number = 2.4;

  // Shared Geometries & Materials
  private trackMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7 });
  private railMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
  private trainMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, metalness: 0.7 });
  private coinMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.2, metalness: 0.9 });
  private coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.coinGeo.rotateX(Math.PI / 2);

    // Initial track chunks
    for (let i = 0; i < 5; i++) {
      this.spawnChunk(i === 0); // No obstacles on first chunk
    }
  }

  private spawnChunk(safe: boolean) {
    const chunk = new THREE.Group();
    chunk.position.z = this.nextSpawnZ;

    // Track ground slab
    const groundGeo = new THREE.BoxGeometry(9, 0.2, this.CHUNK_LENGTH);
    const ground = new THREE.Mesh(groundGeo, this.trackMat);
    ground.position.set(0, -0.1, this.CHUNK_LENGTH / 2);
    ground.receiveShadow = true;
    chunk.add(ground);

    // Glowing Neon Rails for 3 Lanes
    [-2.4, 0, 2.4].forEach(x => {
      const railGeo = new THREE.BoxGeometry(0.08, 0.05, this.CHUNK_LENGTH);
      const railL = new THREE.Mesh(railGeo, this.railMat);
      railL.position.set(x - 0.6, 0.02, this.CHUNK_LENGTH / 2);
      const railR = new THREE.Mesh(railGeo, this.railMat);
      railR.position.set(x + 0.6, 0.02, this.CHUNK_LENGTH / 2);
      chunk.add(railL);
      chunk.add(railR);
    });

    this.scene.add(chunk);
    this.trackChunks.push(chunk);

    // Populate obstacles on non-safe chunks
    if (!safe) {
      this.populateObstacles(this.nextSpawnZ);
    }

    this.nextSpawnZ += this.CHUNK_LENGTH;
  }

  private populateObstacles(chunkStartZ: number) {
    const lanes = [-1, 0, 1];

    for (let zOffset = 10; zOffset < this.CHUNK_LENGTH; zOffset += 12) {
      const z = chunkStartZ + zOffset;
      const rand = Math.random();

      if (rand < 0.35) {
        // Train obstacle (tall, block full lane)
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        this.createTrain(lane, z);
      } else if (rand < 0.6) {
        // Low hurdle (Must JUMP over)
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        this.createHurdle(lane, z, 'low_hurdle');
      } else if (rand < 0.8) {
        // High hurdle (Must SLIDE/CRAWL under)
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        this.createHurdle(lane, z, 'high_hurdle');
      } else {
        // Coin Ring Arc
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        this.createCoinRing(lane, z);
      }
    }
  }

  private createTrain(lane: number, z: number) {
    const trainGeo = new THREE.BoxGeometry(2.0, 3.2, 8.0);
    const train = new THREE.Mesh(trainGeo, this.trainMat);
    train.position.set(lane * this.LANE_DISTANCE, 1.6, z);
    train.castShadow = true;
    train.receiveShadow = true;

    this.scene.add(train);
    this.obstacles.push({ type: 'train', mesh: train, lane, z, active: true });
  }

  private createHurdle(lane: number, z: number, type: 'low_hurdle' | 'high_hurdle') {
    const group = new THREE.Group();
    const posX = lane * this.LANE_DISTANCE;

    if (type === 'low_hurdle') {
      // LOW HURDLE: Ground barrier with legs (JUMP OVER)
      const mat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.3, metalness: 0.5 });
      const barGeo = new THREE.BoxGeometry(2.1, 0.5, 0.2);
      const bar = new THREE.Mesh(barGeo, mat);
      bar.position.set(0, 0.35, 0);
      bar.castShadow = true;
      group.add(bar);

      // Support posts
      const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
      const legL = new THREE.Mesh(legGeo, mat);
      legL.position.set(-0.9, 0.3, 0);
      const legR = new THREE.Mesh(legGeo, mat);
      legR.position.set(0.9, 0.3, 0);
      group.add(legL);
      group.add(legR);

      // Glowing top strip
      const stripMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
      const stripGeo = new THREE.BoxGeometry(2.1, 0.1, 0.22);
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(0, 0.6, 0);
      group.add(strip);
    } else {
      // HIGH HURDLE: Overhead Arch / Gate (SLIDE UNDER)
      const postMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.5 });
      const bannerMat = new THREE.MeshStandardMaterial({ color: '#a855f7', roughness: 0.2, metalness: 0.8 });
      const glowMat = new THREE.MeshBasicMaterial({ color: '#c084fc' });

      // Side Posts going all the way up to height 2.6
      const postGeo = new THREE.BoxGeometry(0.2, 2.6, 0.2);
      const postL = new THREE.Mesh(postGeo, postMat);
      postL.position.set(-0.95, 1.3, 0);
      postL.castShadow = true;
      const postR = new THREE.Mesh(postGeo, postMat);
      postR.position.set(0.95, 1.3, 0);
      postR.castShadow = true;
      group.add(postL);
      group.add(postR);

      // High Overhead Banner Board (Clearance below: 1.1m)
      const bannerGeo = new THREE.BoxGeometry(2.1, 1.0, 0.2);
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.set(0, 1.9, 0);
      banner.castShadow = true;
      group.add(banner);

      // Downward Glowing Neon Arrows on the banner pointing DOWN (indicating SLIDE)
      const arrowGeo = new THREE.ConeGeometry(0.25, 0.4, 4);
      arrowGeo.rotateZ(Math.PI); // Point down
      const arrow1 = new THREE.Mesh(arrowGeo, glowMat);
      arrow1.position.set(-0.5, 1.8, 0.12);
      const arrow2 = new THREE.Mesh(arrowGeo, glowMat);
      arrow2.position.set(0.5, 1.8, 0.12);
      group.add(arrow1);
      group.add(arrow2);
    }

    group.position.set(posX, 0, z);
    this.scene.add(group);
    this.obstacles.push({ type, mesh: group, lane, z, active: true });
  }

  private createCoinRing(lane: number, z: number) {
    for (let i = 0; i < 4; i++) {
      const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
      const coinZ = z + i * 1.5;
      coin.position.set(lane * this.LANE_DISTANCE, 0.8, coinZ);

      this.scene.add(coin);
      this.obstacles.push({ type: 'coin', mesh: coin, lane, z: coinZ, active: true });
    }
  }

  public update(runnerZ: number) {
    // Spin coins & recycle passed chunks/obstacles
    this.obstacles.forEach(obs => {
      if (obs.type === 'coin' && obs.active) {
        obs.mesh.rotation.z += 0.05;
      }
    });

    // Recycle chunks behind runner
    if (this.trackChunks.length > 0 && runnerZ - this.trackChunks[0].position.z > this.CHUNK_LENGTH * 2) {
      const oldChunk = this.trackChunks.shift();
      if (oldChunk) this.scene.remove(oldChunk);
      this.spawnChunk(false);
    }

    // Cleanup old active obstacles far behind camera
    this.obstacles = this.obstacles.filter(obs => {
      if (obs.z < runnerZ - 15) {
        this.scene.remove(obs.mesh);
        return false;
      }
      return true;
    });
  }

  public reset() {
    this.trackChunks.forEach(c => this.scene.remove(c));
    this.obstacles.forEach(o => this.scene.remove(o.mesh));
    this.trackChunks = [];
    this.obstacles = [];
    this.nextSpawnZ = 0;

    for (let i = 0; i < 5; i++) {
      this.spawnChunk(i === 0);
    }
  }
}
