import * as THREE from "three";
import type { BiomeTheme, SceneManager } from "../graphics/sceneManager";

export type ObstacleType =
	| "train"
	| "low_hurdle"
	| "high_hurdle"
	| "coin"
	| "ramp"
	| "powerup_magnet"
	| "powerup_shield"
	| "powerup_jetpack";

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
	private rampPool: THREE.Group[] = [];
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
	private rampMat = new THREE.MeshStandardMaterial({
		color: "#f59e0b",
		roughness: 0.3,
		metalness: 0.6,
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

	/**
	 * Returns floor surface height at the given world position (e.g. 3.2m for train roofs, or sloped for ramps)
	 */
	public getSurfaceHeightAt(
		lane: number,
		posX: number,
		posZ: number,
	): { height: number; isRamp: boolean } {
		const candidates = this.getCandidateObstacles(lane, posZ);
		for (let i = 0; i < candidates.length; i++) {
			const obs = candidates[i];
			if (!obs.active) continue;

			if (obs.type === "ramp") {
				const rampX = obs.mesh.position.x;
				const rampZ = obs.z;
				if (
					Math.abs(posX - rampX) <= 1.15 &&
					posZ >= rampZ - 2.3 &&
					posZ <= rampZ + 2.3
				) {
					const t = Math.max(0, Math.min(1, (posZ - (rampZ - 2.25)) / 4.5));
					return { height: t * 3.2, isRamp: true };
				}
			} else if (obs.type === "train") {
				const trainX = obs.mesh.position.x;
				const trainZ = obs.z;
				if (
					Math.abs(posX - trainX) <= 1.15 &&
					posZ >= trainZ - 4.1 &&
					posZ <= trainZ + 4.1
				) {
					return { height: 3.2, isRamp: false };
				}
			}
		}
		return { height: 0, isRamp: false };
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
		const patternType = Math.random();

		if (patternType < 0.28) {
			// Pattern A: Long Multi-Wagon Convoy with Ramp (2-3 cars in a line to run on roofs)
			const trainLane = lanes[Math.floor(Math.random() * lanes.length)];
			const numCars = Math.random() < 0.5 ? 2 : 3;
			this.createTrain(trainLane, chunkStartZ + 8, true, numCars);

			// Adjacent lane has obstacles on ground
			const otherLanes = lanes.filter((l) => l !== trainLane);
			const hurdleLane = otherLanes[0];
			this.createHurdle(hurdleLane, chunkStartZ + 15, "low_hurdle");
			this.createHurdle(hurdleLane, chunkStartZ + 27, "high_hurdle");

			// 3rd lane has ground coins
			const coinLane = otherLanes[1];
			this.createCoinRing(coinLane, chunkStartZ + 12);
		} else if (patternType < 0.52) {
			// Pattern B: Side-by-Side Staggered Trains (Ramp on 1st train, jump across to 2nd train roof!)
			const rampTrainLane = Math.random() < 0.5 ? -1 : 1;
			const blockerTrainLane = 0;
			// Train 1 has ramp
			this.createTrain(rampTrainLane, chunkStartZ + 6, true, 2);
			// Train 2 has NO ramp (obstacle train or side-jump target)
			this.createTrain(blockerTrainLane, chunkStartZ + 14, false, 2);

			// Free lane has ground coin rings
			const openLane = -rampTrainLane;
			this.createCoinRing(openLane, chunkStartZ + 10);
		} else if (patternType < 0.76) {
			// Pattern C: Classic Obstacle Trains (NO ramp, must dodge or jump)
			const blockerLane1 = lanes[Math.floor(Math.random() * lanes.length)];
			this.createTrain(blockerLane1, chunkStartZ + 10, false, 1);

			const remainingLanes = lanes.filter((l) => l !== blockerLane1);
			const blockerLane2 =
				remainingLanes[Math.floor(Math.random() * remainingLanes.length)];
			this.createTrain(blockerLane2, chunkStartZ + 24, false, 1);

			const openLane = remainingLanes.find((l) => l !== blockerLane2) ?? 0;
			this.createHurdle(openLane, chunkStartZ + 16, "low_hurdle");
			this.createCoinRing(openLane, chunkStartZ + 28);
		} else {
			// Pattern D: Hurdle Slalom & Coin Run
			for (let zOffset = 8; zOffset < this.CHUNK_LENGTH; zOffset += 10) {
				const z = chunkStartZ + zOffset;
				const lane = lanes[Math.floor(Math.random() * lanes.length)];
				if (Math.random() < 0.45) {
					this.createHurdle(
						lane,
						z,
						Math.random() < 0.5 ? "low_hurdle" : "high_hurdle",
					);
				} else {
					this.createCoinRing(lane, z);
				}
			}
		}

		// Spawn rare Power-Up (approx 1 per 160m)
		if (Math.random() < 0.22) {
			const freeLane = lanes[Math.floor(Math.random() * lanes.length)];
			const pZ = chunkStartZ + 20;
			const pTypeRand = Math.random();
			const pType =
				pTypeRand < 0.36
					? ("powerup_magnet" as const)
					: pTypeRand < 0.7
						? ("powerup_shield" as const)
						: ("powerup_jetpack" as const);
			this.createPowerUp(freeLane, pZ, pType);
		}
	}

	private createPowerUp(
		lane: number,
		z: number,
		type: "powerup_magnet" | "powerup_shield" | "powerup_jetpack",
	) {
		const group = new THREE.Group();

		if (type === "powerup_magnet") {
			// Glowing Horseshoe Magnet
			const ringGeo = new THREE.TorusGeometry(0.35, 0.1, 12, 24, Math.PI * 1.3);
			const magnetMat = new THREE.MeshStandardMaterial({
				color: "#38bdf8",
				metalness: 0.8,
				roughness: 0.2,
				emissive: "#0284c7",
				emissiveIntensity: 0.8,
			});
			const ring = new THREE.Mesh(ringGeo, magnetMat);
			ring.rotation.z = Math.PI * 0.35;
			group.add(ring);

			const tipGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
			const tipMat = new THREE.MeshBasicMaterial({ color: "#ef4444" });
			const tip1 = new THREE.Mesh(tipGeo, tipMat);
			tip1.position.set(-0.3, -0.18, 0);
			const tip2 = new THREE.Mesh(tipGeo, tipMat);
			tip2.position.set(0.3, -0.18, 0);
			group.add(tip1);
			group.add(tip2);
		} else if (type === "powerup_shield") {
			// Glowing Emerald Shield Sphere
			const sphereGeo = new THREE.IcosahedronGeometry(0.4, 1);
			const shieldMat = new THREE.MeshStandardMaterial({
				color: "#10b981",
				metalness: 0.5,
				roughness: 0.2,
				emissive: "#059669",
				emissiveIntensity: 0.9,
			});
			const sphere = new THREE.Mesh(sphereGeo, shieldMat);
			group.add(sphere);

			const outerRingGeo = new THREE.TorusGeometry(0.55, 0.04, 8, 24);
			const ringMat = new THREE.MeshBasicMaterial({ color: "#6ee7b7" });
			const outerRing = new THREE.Mesh(outerRingGeo, ringMat);
			outerRing.rotation.x = Math.PI / 2;
			group.add(outerRing);
		} else {
			// Glowing Rocket Jetpack
			const jetGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.6, 8);
			const jetMat = new THREE.MeshStandardMaterial({
				color: "#f97316",
				metalness: 0.8,
				roughness: 0.2,
				emissive: "#ea580c",
				emissiveIntensity: 0.8,
			});
			const tank1 = new THREE.Mesh(jetGeo, jetMat);
			tank1.position.x = -0.18;
			const tank2 = new THREE.Mesh(jetGeo, jetMat);
			tank2.position.x = 0.18;
			group.add(tank1);
			group.add(tank2);

			const coneGeo = new THREE.ConeGeometry(0.14, 0.3, 8);
			const coneMat = new THREE.MeshBasicMaterial({ color: "#fbbf24" });
			const cone1 = new THREE.Mesh(coneGeo, coneMat);
			cone1.rotation.x = Math.PI;
			cone1.position.set(-0.18, -0.4, 0);
			const cone2 = new THREE.Mesh(coneGeo, coneMat);
			cone2.rotation.x = Math.PI;
			cone2.position.set(0.18, -0.4, 0);
			group.add(cone1);
			group.add(cone2);
		}

		group.position.set(lane * this.LANE_DISTANCE, 1.2, z);
		this.scene.add(group);

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

	private createTrain(
		lane: number,
		z: number,
		hasRamp: boolean = false,
		numCars: number = 1,
	) {
		for (let c = 0; c < numCars; c++) {
			const carZ = z + c * 8.4;
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

			train.position.set(lane * this.LANE_DISTANCE, 1.6, carZ);
			const obs: TrackObstacle = {
				type: "train",
				mesh: train,
				lane,
				z: carZ,
				active: true,
			};
			this.activeObstacles.push(obs);
			this.registerSpatialObstacle(obs);

			// Place golden coins along each car's roof
			[-2.0, 0, 2.0].forEach((offset) => {
				let coin: THREE.Mesh;
				const coinZ = carZ + offset;
				if (this.coinPool.length > 0) {
					coin = this.coinPool.pop()!;
					coin.visible = true;
				} else {
					coin = new THREE.Mesh(this.coinGeo, this.coinMat);
					this.scene.add(coin);
				}
				coin.position.set(lane * this.LANE_DISTANCE, 4.0, coinZ);
				const coinObs: TrackObstacle = {
					type: "coin",
					mesh: coin,
					lane,
					z: coinZ,
					active: true,
				};
				this.activeObstacles.push(coinObs);
				this.registerSpatialObstacle(coinObs);
			});
		}

		// Place an inclined launch ramp in front of ONLY the first car if hasRamp is true
		if (hasRamp) {
			this.createRamp(lane, z - 6.25);
		}
	}

	private createRamp(lane: number, z: number) {
		let group: THREE.Group;
		if (this.rampPool.length > 0) {
			group = this.rampPool.pop()!;
			group.visible = true;
		} else {
			group = new THREE.Group();
			// Ramp base box sloped from y=0 to y=3.2 over 4.5m length
			const rampGeo = new THREE.BoxGeometry(1.9, 0.2, 4.5);
			const rampMesh = new THREE.Mesh(rampGeo, this.rampMat);
			rampMesh.rotation.x = -Math.atan2(3.2, 4.5);
			rampMesh.position.set(0, 1.6, 0);
			rampMesh.castShadow = true;
			rampMesh.receiveShadow = true;
			group.add(rampMesh);

			// Neon chevron arrow indicator on ramp
			const chevronGeo = new THREE.ConeGeometry(0.35, 0.6, 4);
			const chevronMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });
			const chevron = new THREE.Mesh(chevronGeo, chevronMat);
			chevron.rotation.x = rampMesh.rotation.x + Math.PI / 2;
			chevron.position.set(0, 1.65, 0);
			group.add(chevron);

			this.scene.add(group);
		}

		group.position.set(lane * this.LANE_DISTANCE, 0, z);
		const obs: TrackObstacle = {
			type: "ramp",
			mesh: group,
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
