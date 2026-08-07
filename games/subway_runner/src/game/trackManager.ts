import * as THREE from "three";
import type { BiomeTheme, SceneManager } from "../graphics/sceneManager";

export type ObstacleType = "train" | "low_hurdle" | "high_hurdle" | "coin";

export interface TrackObstacle {
	type: ObstacleType;
	mesh: THREE.Object3D;
	lane: number;
	z: number;
	active: boolean;
}

export class TrackManager {
	private scene: THREE.Scene;
	private sceneManager?: SceneManager;
	private trackChunks: THREE.Group[] = [];
	public activeObstacles: TrackObstacle[] = [];

	// Object Pools (Reuse Three.js Meshes & Groups to prevent GC spikes)
	private trainPool: THREE.Mesh[] = [];
	private hurdleLowPool: THREE.Group[] = [];
	private hurdleHighPool: THREE.Group[] = [];
	private coinPool: THREE.Mesh[] = [];
	private chunkPool: THREE.Group[] = [];

	// Spatial Grid Bucket Lookup: Map<"lane:zBucket", TrackObstacle[]>
	private spatialGrid: Map<string, TrackObstacle[]> = new Map();

	private nextSpawnZ: number = 0;
	private readonly CHUNK_LENGTH: number = 40;
	private readonly LANE_DISTANCE: number = 2.4;
	private readonly GRID_BUCKET_SIZE: number = 10;

	// Shared Geometries & Materials
	private trackMat = new THREE.MeshStandardMaterial({
		color: "#1e293b",
		roughness: 0.7,
	});
	private railMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
	private trainMat = new THREE.MeshStandardMaterial({
		color: "#ef4444",
		roughness: 0.3,
		metalness: 0.7,
	});
	private coinMat = new THREE.MeshStandardMaterial({
		color: "#fbbf24",
		roughness: 0.2,
		metalness: 0.9,
	});
	private coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16);

	constructor(sceneManager: SceneManager) {
		this.sceneManager = sceneManager;
		this.scene = sceneManager.scene;
		this.coinGeo.rotateX(Math.PI / 2);

		// Apply world bending shaders to shared materials
		this.sceneManager.applyWorldBending(this.trackMat);
		this.sceneManager.applyWorldBending(this.railMat);
		this.sceneManager.applyWorldBending(this.trainMat);
		this.sceneManager.applyWorldBending(this.coinMat);

		// Initial track chunks
		for (let i = 0; i < 5; i++) {
			this.spawnChunk(i === 0);
		}
	}

	public updateBiomeTheme(theme: BiomeTheme) {
		this.trackMat.color.set(theme.trackColor);
		this.railMat.color.set(theme.railColor);
	}

	private getSpatialKey(lane: number, z: number): string {
		const bucket = Math.floor(z / this.GRID_BUCKET_SIZE);
		return `${lane}:${bucket}`;
	}

	private registerSpatialObstacle(obs: TrackObstacle) {
		const key = this.getSpatialKey(obs.lane, obs.z);
		let list = this.spatialGrid.get(key);
		if (!list) {
			list = [];
			this.spatialGrid.set(key, list);
		}
		list.push(obs);
	}

	/**
	 * Spatial Query: Returns only obstacles present in relevant spatial grid cells
	 */
	public getCandidateObstacles(lane: number, runnerZ: number): TrackObstacle[] {
		const candidates: TrackObstacle[] = [];
		const minBucket = Math.floor((runnerZ - 3) / this.GRID_BUCKET_SIZE);
		const maxBucket = Math.floor((runnerZ + 7) / this.GRID_BUCKET_SIZE);

		// Inspect target lane and adjacent lanes if steering
		const checkLanes = [lane - 1, lane, lane + 1];

		for (const l of checkLanes) {
			if (l < -1 || l > 1) continue;
			for (let b = minBucket; b <= maxBucket; b++) {
				const key = `${l}:${b}`;
				const bucketObs = this.spatialGrid.get(key);
				if (bucketObs) {
					for (let i = 0; i < bucketObs.length; i++) {
						if (bucketObs[i].active) {
							candidates.push(bucketObs[i]);
						}
					}
				}
			}
		}
		return candidates;
	}

	private spawnChunk(safe: boolean) {
		let chunk: THREE.Group;

		if (this.chunkPool.length > 0) {
			chunk = this.chunkPool.pop()!;
			chunk.visible = true;
		} else {
			chunk = new THREE.Group();

			// 1. Track ground slab
			const groundGeo = new THREE.BoxGeometry(9, 0.2, this.CHUNK_LENGTH);
			const ground = new THREE.Mesh(groundGeo, this.trackMat);
			ground.position.set(0, -0.1, this.CHUNK_LENGTH / 2);
			ground.receiveShadow = true;
			chunk.add(ground);

			// 2. Glowing Neon Rails for 3 Lanes
			[-2.4, 0, 2.4].forEach((x) => {
				const railGeo = new THREE.BoxGeometry(0.08, 0.05, this.CHUNK_LENGTH);
				const railL = new THREE.Mesh(railGeo, this.railMat);
				railL.position.set(x - 0.6, 0.02, this.CHUNK_LENGTH / 2);
				const railR = new THREE.Mesh(railGeo, this.railMat);
				railR.position.set(x + 0.6, 0.02, this.CHUNK_LENGTH / 2);
				chunk.add(railL);
				chunk.add(railR);
			});

			// 3. Side Environment: Barrier Walls
			const wallMat = new THREE.MeshStandardMaterial({
				color: "#334155",
				roughness: 0.6,
			});
			if (this.sceneManager) this.sceneManager.applyWorldBending(wallMat);

			const wallGeo = new THREE.BoxGeometry(0.3, 1.2, this.CHUNK_LENGTH);
			const wallL = new THREE.Mesh(wallGeo, wallMat);
			wallL.position.set(-4.7, 0.5, this.CHUNK_LENGTH / 2);
			const wallR = new THREE.Mesh(wallGeo, wallMat);
			wallR.position.set(4.7, 0.5, this.CHUNK_LENGTH / 2);
			chunk.add(wallL);
			chunk.add(wallR);

			// Glowing Neon Strips along side walls
			const stripGeo = new THREE.BoxGeometry(0.08, 0.1, this.CHUNK_LENGTH);
			const stripL = new THREE.Mesh(stripGeo, this.railMat);
			stripL.position.set(-4.52, 1.0, this.CHUNK_LENGTH / 2);
			const stripR = new THREE.Mesh(stripGeo, this.railMat);
			stripR.position.set(4.52, 1.0, this.CHUNK_LENGTH / 2);
			chunk.add(stripL);
			chunk.add(stripR);

			// 4. Side Street Lamps & Cyber Billboards (No overhead beams)
			const poleMat = new THREE.MeshStandardMaterial({
				color: "#1e293b",
				roughness: 0.4,
				metalness: 0.7,
			});
			if (this.sceneManager) this.sceneManager.applyWorldBending(poleMat);

			const billboardMat = new THREE.MeshStandardMaterial({
				color: "#0f172a",
				emissive: "#38bdf8",
				emissiveIntensity: 0.7,
				roughness: 0.2,
			});
			if (this.sceneManager) this.sceneManager.applyWorldBending(billboardMat);

			[10, 30].forEach((zPos) => {
				// Sleek Side Street Lamps (Angled inward over track, but open overhead)
				const postGeo = new THREE.BoxGeometry(0.2, 3.2, 0.2);
				const armGeo = new THREE.BoxGeometry(1.2, 0.15, 0.15);
				const lampHeadGeo = new THREE.BoxGeometry(0.4, 0.15, 0.3);
				const lampGlowMat = new THREE.MeshBasicMaterial({ color: "#fef08a" });
				if (this.sceneManager) this.sceneManager.applyWorldBending(lampGlowMat);

				// Left Street Lamp
				const postL = new THREE.Mesh(postGeo, poleMat);
				postL.position.set(-5.0, 1.6, zPos);
				const armL = new THREE.Mesh(armGeo, poleMat);
				armL.position.set(-4.5, 3.1, zPos);
				const headL = new THREE.Mesh(lampHeadGeo, lampGlowMat);
				headL.position.set(-4.0, 3.0, zPos);
				chunk.add(postL);
				chunk.add(armL);
				chunk.add(headL);

				// Right Street Lamp
				const postR = new THREE.Mesh(postGeo, poleMat);
				postR.position.set(5.0, 1.6, zPos);
				const armR = new THREE.Mesh(armGeo, poleMat);
				armR.position.set(4.5, 3.1, zPos);
				const headR = new THREE.Mesh(lampHeadGeo, lampGlowMat);
				headR.position.set(4.0, 3.0, zPos);
				chunk.add(postR);
				chunk.add(armR);
				chunk.add(headR);
			});

			// Side Cyber Hologram Billboard at mid-chunk
			const boardGeo = new THREE.BoxGeometry(0.1, 1.8, 4.0);
			const boardL = new THREE.Mesh(boardGeo, billboardMat);
			boardL.position.set(-5.1, 2.2, 20);
			const boardR = new THREE.Mesh(boardGeo, billboardMat);
			boardR.position.set(5.1, 2.2, 20);
			chunk.add(boardL);
			chunk.add(boardR);

			this.scene.add(chunk);
		}

		chunk.position.z = this.nextSpawnZ;
		this.trackChunks.push(chunk);

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
				const lane = lanes[Math.floor(Math.random() * lanes.length)];
				this.createTrain(lane, z);
			} else if (rand < 0.6) {
				const lane = lanes[Math.floor(Math.random() * lanes.length)];
				this.createHurdle(lane, z, "low_hurdle");
			} else if (rand < 0.8) {
				const lane = lanes[Math.floor(Math.random() * lanes.length)];
				this.createHurdle(lane, z, "high_hurdle");
			} else {
				const lane = lanes[Math.floor(Math.random() * lanes.length)];
				this.createCoinRing(lane, z);
			}
		}
	}

	private createTrain(lane: number, z: number) {
		let train: THREE.Mesh;
		if (this.trainPool.length > 0) {
			train = this.trainPool.pop()!;
			train.visible = true;
		} else {
			const trainGeo = new THREE.BoxGeometry(2.0, 3.2, 8.0);
			train = new THREE.Mesh(trainGeo, this.trainMat);
			train.castShadow = true;
			train.receiveShadow = true;
			this.scene.add(train);
		}

		train.position.set(lane * this.LANE_DISTANCE, 1.6, z);
		const obs: TrackObstacle = {
			type: "train",
			mesh: train,
			lane,
			z,
			active: true,
		};
		this.activeObstacles.push(obs);
		this.registerSpatialObstacle(obs);
	}

	private createHurdle(
		lane: number,
		z: number,
		type: "low_hurdle" | "high_hurdle",
	) {
		let group: THREE.Group;
		const pool =
			type === "low_hurdle" ? this.hurdleLowPool : this.hurdleHighPool;

		if (pool.length > 0) {
			group = pool.pop()!;
			group.visible = true;
		} else {
			group = new THREE.Group();
			if (type === "low_hurdle") {
				const mat = new THREE.MeshStandardMaterial({
					color: "#f97316",
					roughness: 0.3,
					metalness: 0.5,
				});
				if (this.sceneManager) this.sceneManager.applyWorldBending(mat);

				const barGeo = new THREE.BoxGeometry(2.1, 0.5, 0.2);
				const bar = new THREE.Mesh(barGeo, mat);
				bar.position.set(0, 0.35, 0);
				group.add(bar);

				const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
				const legL = new THREE.Mesh(legGeo, mat);
				legL.position.set(-0.9, 0.3, 0);
				const legR = new THREE.Mesh(legGeo, mat);
				legR.position.set(0.9, 0.3, 0);
				group.add(legL);
				group.add(legR);

				const stripMat = new THREE.MeshBasicMaterial({ color: "#ef4444" });
				if (this.sceneManager) this.sceneManager.applyWorldBending(stripMat);
				const stripGeo = new THREE.BoxGeometry(2.1, 0.1, 0.22);
				const strip = new THREE.Mesh(stripGeo, stripMat);
				strip.position.set(0, 0.6, 0);
				group.add(strip);
			} else {
				const postMat = new THREE.MeshStandardMaterial({
					color: "#334155",
					roughness: 0.5,
				});
				const bannerMat = new THREE.MeshStandardMaterial({
					color: "#a855f7",
					roughness: 0.2,
					metalness: 0.8,
				});
				const glowMat = new THREE.MeshBasicMaterial({ color: "#c084fc" });
				if (this.sceneManager) {
					this.sceneManager.applyWorldBending(postMat);
					this.sceneManager.applyWorldBending(bannerMat);
					this.sceneManager.applyWorldBending(glowMat);
				}

				const postGeo = new THREE.BoxGeometry(0.2, 2.6, 0.2);
				const postL = new THREE.Mesh(postGeo, postMat);
				postL.position.set(-0.95, 1.3, 0);
				const postR = new THREE.Mesh(postGeo, postMat);
				postR.position.set(0.95, 1.3, 0);
				group.add(postL);
				group.add(postR);

				const bannerGeo = new THREE.BoxGeometry(2.1, 1.0, 0.2);
				const banner = new THREE.Mesh(bannerGeo, bannerMat);
				banner.position.set(0, 1.9, 0);
				group.add(banner);

				const arrowGeo = new THREE.ConeGeometry(0.25, 0.4, 4);
				arrowGeo.rotateZ(Math.PI);
				const arrow1 = new THREE.Mesh(arrowGeo, glowMat);
				arrow1.position.set(-0.5, 1.8, 0.12);
				const arrow2 = new THREE.Mesh(arrowGeo, glowMat);
				arrow2.position.set(0.5, 1.8, 0.12);
				group.add(arrow1);
				group.add(arrow2);
			}
			this.scene.add(group);
		}

		group.position.set(lane * this.LANE_DISTANCE, 0, z);
		const obs: TrackObstacle = {
			type,
			mesh: group,
			lane,
			z,
			active: true,
		};
		this.activeObstacles.push(obs);
		this.registerSpatialObstacle(obs);
	}

	private createCoinRing(lane: number, z: number) {
		for (let i = 0; i < 4; i++) {
			let coin: THREE.Mesh;
			const coinZ = z + i * 1.5;

			if (this.coinPool.length > 0) {
				coin = this.coinPool.pop()!;
				coin.visible = true;
			} else {
				coin = new THREE.Mesh(this.coinGeo, this.coinMat);
				this.scene.add(coin);
			}

			coin.position.set(lane * this.LANE_DISTANCE, 0.8, coinZ);
			const obs: TrackObstacle = {
				type: "coin",
				mesh: coin,
				lane,
				z: coinZ,
				active: true,
			};
			this.activeObstacles.push(obs);
			this.registerSpatialObstacle(obs);
		}
	}

	public update(runnerZ: number) {
		// Spin active coins
		for (let i = 0; i < this.activeObstacles.length; i++) {
			const obs = this.activeObstacles[i];
			if (obs.type === "coin" && obs.active) {
				obs.mesh.rotation.z += 0.05;
			}
		}

		// Recycle track chunks behind runner to pool
		if (
			this.trackChunks.length > 0 &&
			runnerZ - this.trackChunks[0].position.z > this.CHUNK_LENGTH * 2
		) {
			const oldChunk = this.trackChunks.shift();
			if (oldChunk) {
				oldChunk.visible = false;
				this.chunkPool.push(oldChunk);
			}
			this.spawnChunk(false);
		}

		// Recycle passed obstacles to Object Pools & cleanup spatial grid
		this.activeObstacles = this.activeObstacles.filter((obs) => {
			if (obs.z < runnerZ - 15) {
				obs.active = false;
				obs.mesh.visible = false;

				// Push to respective pool
				if (obs.type === "train") {
					this.trainPool.push(obs.mesh as THREE.Mesh);
				} else if (obs.type === "low_hurdle") {
					this.hurdleLowPool.push(obs.mesh as THREE.Group);
				} else if (obs.type === "high_hurdle") {
					this.hurdleHighPool.push(obs.mesh as THREE.Group);
				} else if (obs.type === "coin") {
					this.coinPool.push(obs.mesh as THREE.Mesh);
				}
				return false;
			}
			return true;
		});
	}

	public reset() {
		// Hide and return all active obstacles to object pools
		this.activeObstacles.forEach((obs) => {
			obs.active = false;
			obs.mesh.visible = false;
			if (obs.type === "train") this.trainPool.push(obs.mesh as THREE.Mesh);
			else if (obs.type === "low_hurdle")
				this.hurdleLowPool.push(obs.mesh as THREE.Group);
			else if (obs.type === "high_hurdle")
				this.hurdleHighPool.push(obs.mesh as THREE.Group);
			else if (obs.type === "coin") this.coinPool.push(obs.mesh as THREE.Mesh);
		});

		// Hide and return track chunks to pool
		this.trackChunks.forEach((c) => {
			c.visible = false;
			this.chunkPool.push(c);
		});

		this.trackChunks = [];
		this.activeObstacles = [];
		this.spatialGrid.clear();
		this.nextSpawnZ = 0;

		for (let i = 0; i < 5; i++) {
			this.spawnChunk(i === 0);
		}
	}
}
