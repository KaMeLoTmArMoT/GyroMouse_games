import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import { WEAPON_STATS, type WeaponId } from "../types";

/**
 * Result of a single (non-mutating) shot simulation. Damage is accumulated per
 * worm across all blast centers (fuses, cluster children, mortar fragments…).
 */
export interface ShotResult {
	angle: number;
	power: number;
	weaponId: WeaponId;
	endX: number;
	endY: number;
	enemyDamage: number;
	selfDamage: number;
	allyDamage: number;
	chainBonus: number;
	terrainDestruction: number;
	kills: number;
	blockedAtLaunch: boolean;
	waterKnockouts: number;
	crateDestroyed: boolean;
}

const MAX_TICKS = 300;
const DRILL_MAX_FRAMES = 15; // ~0.5s boring budget — keep in sync with projectile.ts
const CANNON_BARREL = 20;

/**
 * Pure, deterministic-ish projectile simulation that mirrors the REAL behavior
 * in projectile.ts but never mutates terrain / worms / objects:
 *  - gravity per weapon (rifle = none), wind for bazooka/cluster/drill/mortar
 *  - fuse timers (grenade/cluster 90, mortar 75, dynamite 120)
 *  - bouncing for grenade/cluster/dynamite (vy·0.6, vx·0.7)
 *  - drill boring (15 frames) then blast; direct-hit 20 dmg pass-through
 *  - mortar airburst (8 fragments, 25 dmg each)
 *  - acid = small terrain blast + acid-pool contact damage, no direct blast
 *  - sand = pure utility (no damage)
 *  - cluster parent = blast + 5 seeded children
 *  - rifle = straight line, 30 dmg impact, no terrain destruction
 *  - shotgun = 250px double-tap raycast (40 + 30)
 *
 * `aimErrorPx` blurs blast distances (used to degrade low-difficulty bots).
 * `shooter` is required so SELF + friendly damage is scored correctly.
 */
export function simulateShot(
	weaponId: WeaponId,
	originX: number,
	originY: number,
	angleDeg: number,
	power: number,
	windX: number,
	terrain: TerrainManager,
	worms: Worm[],
	shooter: Worm,
	mapObjects: MapObject[],
	aimErrorPx: number = 0,
): ShotResult {
	const stats = WEAPON_STATS[weaponId];
	const rad = (angleDeg * Math.PI) / 180;
	const damageMap = new Map<string, number>();

	const shot: ShotResult = {
		angle: angleDeg,
		power,
		weaponId,
		endX: originX,
		endY: originY,
		enemyDamage: 0,
		selfDamage: 0,
		allyDamage: 0,
		chainBonus: 0,
		terrainDestruction: 0,
		kills: 0,
		blockedAtLaunch: false,
		waterKnockouts: 0,
		crateDestroyed: false,
	};

	const addDamage = (w: Worm, dmg: number): void => {
		if (dmg <= 0) return;
		damageMap.set(w.id, (damageMap.get(w.id) ?? 0) + dmg);
	};

	const isEnemy = (w: Worm): boolean => w.team !== shooter.team;
	const isSelf = (w: Worm): boolean => w === shooter;
	const isAlly = (w: Worm): boolean => w.team === shooter.team && w !== shooter;

	const finalize = (): void => {
		for (const w of worms) {
			if (!w.isAlive) continue;
			const dmg = damageMap.get(w.id) ?? 0;
			if (dmg <= 0) continue;
			if (isEnemy(w)) {
				shot.enemyDamage += dmg;
				if (w.health - dmg <= 0) shot.kills++;
			} else if (isSelf(w)) {
				shot.selfDamage += dmg;
			} else if (isAlly(w)) {
				shot.allyDamage += dmg;
			}
		}
	};

	/** Blast damage + chain bonus + terrain utility at a world point. */
	const blast = (
		x: number,
		y: number,
		radius: number,
		baseDamage: number,
		terrainUtility: number = 0,
	): void => {
		shot.endX = x;
		shot.endY = y;
		if (baseDamage > 0) {
			for (const w of worms) {
				if (!w.isAlive) continue;
				const dist = Math.hypot(w.x - x, w.y - y) + aimErrorPx;
				if (dist < radius + w.radius) {
					const force = Math.max(0, 1 - dist / (radius + w.radius));
					addDamage(w, Math.floor(baseDamage * force));
					if (isEnemy(w)) {
						const dx = w.x - x;
						const dy = w.y - y;
						const len = Math.hypot(dx, dy) || 1;
						const estKnockX = w.x + (dx / len) * force * 45;
						const estKnockY = w.y + (dy / len) * force * 35;
						if (
							estKnockY >= terrain.waterY - 10 ||
							estKnockX < 20 ||
							estKnockX > terrain.width - 20
						) {
							shot.waterKnockouts++;
						}
					}
				}
			}
		}
		shot.terrainDestruction += terrainUtility + radius * 0.3;
		for (const obj of mapObjects) {
			if (obj.isDestroyed) continue;
			const dist = Math.hypot(obj.x - x, obj.y - y);
			if (obj.type === "barrel" && dist < radius + 40) {
				shot.chainBonus += 30;
			} else if (obj.type === "health_crate" && dist < radius + 20) {
				shot.crateDestroyed = true;
			}
		}
	};

	const checkLaunchBlock = (hitX: number, hitY: number): void => {
		if (Math.hypot(hitX - originX, hitY - originY) <= 35) {
			shot.blockedAtLaunch = true;
		}
	};

	/** Small impact damage (rifle) — no terrain destruction. */
	const impactDamage = (x: number, y: number, dmg: number): void => {
		shot.endX = x;
		shot.endY = y;
		for (const w of worms) {
			if (!w.isAlive) continue;
			if (Math.hypot(w.x - x, w.y - y) < 20) addDamage(w, dmg);
		}
	};

	/** Cluster parent detonation: parent blast + child mini-bombs. */
	const clusterSplit = (x: number, y: number): void => {
		blast(x, y, stats.blastRadius, stats.baseDamage);
		const childRadius = stats.childBlastRadius ?? 30;
		const childDamage = stats.childBaseDamage ?? 35;
		const childCount = stats.childCount ?? 5;
		for (let c = 0; c < childCount; c++) {
			const childAngle = Math.PI / 4 + (c * Math.PI) / 8;
			const childSpeed = 3 + Math.random() * 4;
			let cx = x;
			let cy = y;
			let cvx = Math.cos(childAngle) * childSpeed;
			let cvy = -Math.sin(childAngle) * childSpeed;
			for (let t = 0; t < 60; t++) {
				if (stats.wind) cvx += windX * 0.05;
				cvy += 0.45;
				cx += cvx;
				cy += cvy;
				if (terrain.isSolidAt(cx, cy)) break;
				if (cy >= terrain.waterY) break;
			}
			blast(cx, cy, childRadius, childDamage);
		}
	};

	/** Mortar airburst: 8 fragments raining shrapnel downward. */
	const mortarBurst = (x: number, y: number): void => {
		shot.endX = x;
		shot.endY = y;
		shot.terrainDestruction += 8 * 15 * 0.3;
		for (let i = 0; i < 8; i++) {
			const spreadX = (Math.random() - 0.5) * 60;
			const fx = x + spreadX;
			for (const w of worms) {
				if (!w.isAlive) continue;
				const dist = Math.hypot(w.x - fx, w.y - y) + aimErrorPx;
				if (dist < 30 + w.radius) {
					const force = Math.max(0, 1 - dist / (30 + w.radius));
					addDamage(w, Math.floor(25 * force));
				}
			}
		}
		for (const obj of mapObjects) {
			if (obj.type === "barrel" && !obj.isDestroyed) {
				if (Math.hypot(obj.x - x, obj.y - y) < 70) shot.chainBonus += 30;
			}
		}
	};

	/** Generic detonation dispatcher used on impact (and fuse for fuses). */
	const explodeAt = (x: number, y: number): void => {
		switch (stats.special) {
			case "split":
				clusterSplit(x, y);
				break;
			case "airburst":
				mortarBurst(x, y);
				break;
			case "bore":
				blast(x, y, stats.blastRadius, stats.baseDamage);
				break;
			case "acid": {
				blast(x, y, stats.blastRadius, 0);
				shot.terrainDestruction += 25;
				for (const w of worms) {
					if (!w.isAlive) continue;
					const dist = Math.hypot(w.x - x, w.y - y) + aimErrorPx;
					if (dist < 55 + w.radius) {
						const force = Math.max(0, 1 - dist / (55 + w.radius));
						addDamage(w, Math.floor(42 * force));
					}
				}
				break;
			}
			case "sand":
				blast(x, y, 45, 30);
				shot.terrainDestruction += 10;
				break;
			default:
				blast(x, y, stats.blastRadius, stats.baseDamage);
				break;
		}
	};

	// ---------------- Raycast weapons (shotgun) ----------------
	if (stats.kind === "raycast") {
		const tipX = originX + Math.cos(rad) * CANNON_BARREL;
		const tipY = originY + Math.sin(rad) * CANNON_BARREL;
		const raycast = (damage: number): void => {
			const hitWormsThisRay = new Set<string>();
			for (let d = 0; d < 250; d += 4) {
				const rx = tipX + Math.cos(rad) * d;
				const ry = tipY + Math.sin(rad) * d;
				if (terrain.isSolidAt(rx, ry)) {
					shot.endX = rx;
					shot.endY = ry;
					shot.terrainDestruction += 18 * 0.3;
					return;
				}
				for (const w of worms) {
					if (!w.isAlive || hitWormsThisRay.has(w.id)) continue;
					if (Math.hypot(w.x - rx, w.y - ry) < 14) {
						hitWormsThisRay.add(w.id);
						addDamage(w, Math.floor(damage));
					}
				}
			}
		};
		raycast(stats.baseDamage);
		raycast(Math.floor(stats.baseDamage * 0.75));
		finalize();
		return shot;
	}

	// ---------------- Projectile flight ----------------
	const maxSpeed = stats.maxSpeed;
	const speed = power * maxSpeed;
	let x = originX + Math.cos(rad) * CANNON_BARREL;
	let y = originY + Math.sin(rad) * CANNON_BARREL;
	let vx = Math.cos(rad) * speed;
	let vy = Math.sin(rad) * speed;
	let fuseTimer = stats.fuseFrames;
	let drillTime = 0;

	for (let t = 0; t < MAX_TICKS; t++) {
		if (stats.wind) vx += windX * 0.05;
		if (stats.gravity !== 0) vy += stats.gravity;
		x += vx;
		y += vy;

		// Fuse countdown → detonate (or airburst) in place
		if (fuseTimer > 0) {
			fuseTimer--;
			if (fuseTimer <= 0) {
				explodeAt(x, y);
				finalize();
				return shot;
			}
		}

		// Map object collision
		for (const obj of mapObjects) {
			if (obj.isDestroyed) continue;
			const dx = x - obj.x;
			const dy = y - obj.y;
			const dist = Math.hypot(dx, dy);
			if (dist < 6 + obj.radius) {
				checkLaunchBlock(x, y);
				if (obj.type === "health_crate") {
					shot.crateDestroyed = true;
				}
				if (obj.type === "landmine" || obj.type === "barrel") {
					// Detonate the mine / barrel explosion
					blast(obj.x, obj.y, 55, 50);
					if (weaponId !== "drill" && !stats.bouncy) {
						finalize();
						return shot;
					}
				}
				if (stats.bouncy) {
					const normLen = dist || 1;
					const normX = dx / normLen;
					const normY = dy / normLen;

					// Push outward off object boundary in simulation
					x = obj.x + normX * (6 + obj.radius + 1);
					y = obj.y + normY * (6 + obj.radius + 1);

					vx = normX * 3.0 + Math.sign(normX || 1) * 1.5;
					vy = -Math.abs(vy) * 0.4 - 0.5;
				} else if (weaponId === "drill") {
					// Drill keeps boring
				} else if (weaponId === "rifle") {
					impactDamage(x, y, 30);
					finalize();
					return shot;
				} else {
					explodeAt(x, y);
					finalize();
					return shot;
				}
			}
		}

		// Direct worm hit
		for (const w of worms) {
			if (!w.isAlive) continue;
			const dist = Math.hypot(x - w.x, y - w.y);
			if (dist < 6 + w.radius) {
				if (weaponId === "rifle") {
					checkLaunchBlock(x, y);
					impactDamage(x, y, 35);
					finalize();
					return shot;
				} else if (weaponId === "drill") {
					checkLaunchBlock(x, y);
					addDamage(w, 40);
					explodeAt(x, y);
					finalize();
					return shot;
				} else {
					checkLaunchBlock(x, y);
					explodeAt(x, y);
					finalize();
					return shot;
				}
			}
		}

		// Terrain collision & Slope Sliding Physics
		const isSolidNow = terrain.isSolidAt(x, y);
		const isSolidNext = terrain.isSolidAt(x + vx, y + vy);
		if (isSolidNow || isSolidNext) {
			if (stats.bouncy) {
				// Probe terrain surface slope around projectile in simulation
				const leftY = terrain.getSurfaceY(x - 8);
				const rightY = terrain.getSurfaceY(x + 8);
				const slope = (rightY - leftY) / 16;

				if (Math.abs(slope) > 0.05) {
					vx += slope * 0.8;
					vx *= 0.94;
				} else {
					vx *= 0.7;
				}
				vy = -vy * 0.6;
			} else if (weaponId === "drill") {
				drillTime++;
				shot.terrainDestruction += 3;
				if (drillTime >= DRILL_MAX_FRAMES) {
					blast(x, y, stats.blastRadius, stats.baseDamage);
					finalize();
					return shot;
				}
			} else if (weaponId === "rifle") {
				impactDamage(x, y, 30);
				finalize();
				return shot;
			} else {
				explodeAt(x, y);
				finalize();
				return shot;
			}
		}

		// Water / out of bounds → silent expiry (no explosion)
		if (y >= terrain.waterY || x < -100 || x > terrain.width + 100) {
			shot.endX = x;
			shot.endY = y;
			finalize();
			return shot;
		}
	}

	// Reached the tick cap without detonating (e.g. drill that never hit a wall)
	shot.endX = x;
	shot.endY = y;
	finalize();
	return shot;
}
