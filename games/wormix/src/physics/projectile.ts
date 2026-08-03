import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import { CELL_ACID, type WeaponId } from "../types";

export class Projectile {
	public weaponId: WeaponId;
	public x: number;
	public y: number;
	public vx: number;
	public vy: number;
	public radius: number = 6;
	public fuseTimer: number; // in frames (30fps)
	public isClusterChild: boolean = false;
	public isExpired: boolean = false;
	public bounciness: number = 0.6;
	public teamId: string;

	// Drill-specific state
	public drillPenetrated: boolean = false;

	// Mortar-specific state
	public mortarFragments: boolean = false;

	constructor(
		weaponId: WeaponId,
		x: number,
		y: number,
		vx: number,
		vy: number,
		teamId: string,
		fuseSeconds: number = 3,
		isClusterChild: boolean = false,
	) {
		this.weaponId = weaponId;
		this.x = x;
		this.y = y;
		this.vx = vx;
		this.vy = vy;
		this.teamId = teamId;
		this.isClusterChild = isClusterChild;

		if (
			weaponId === "grenade" ||
			weaponId === "cluster" ||
			weaponId === "dynamite"
		) {
			this.bounciness = 0.6;
		}
		if (weaponId === "dynamite") {
			this.radius = 8;
			this.fuseTimer = Math.round(4 * 30); // 4 seconds
		} else if (weaponId === "mortar") {
			this.radius = 7;
			this.fuseTimer = Math.round(fuseSeconds * 30);
		} else {
			this.fuseTimer = Math.round(fuseSeconds * 30);
		}
	}

	public update(
		terrain: TerrainManager,
		worms: Worm[],
		mapObjects: MapObject[],
		windX: number,
		onExplode: (proj: Projectile, x: number, y: number) => void,
	): void {
		if (this.isExpired) return;

		// Apply Wind Force (bazooka, cluster, drill, mortar only)
		if (
			this.weaponId === "bazooka" ||
			this.weaponId === "cluster" ||
			this.weaponId === "drill" ||
			this.weaponId === "mortar"
		) {
			this.vx += windX * 0.05;
		}

		// Apply Gravity — NOT for rifle (straight line)
		if (this.weaponId !== "rifle") {
			this.vy += 0.45;
		}

		// Position Step
		this.x += this.vx;
		this.y += this.vy;

		// Fuse Timer countdown for Grenade / Cluster / Dynamite / Mortar
		const hasFuse =
			this.weaponId === "grenade" ||
			(this.weaponId === "cluster" && !this.isClusterChild) ||
			this.weaponId === "dynamite" ||
			this.weaponId === "mortar";
		if (hasFuse) {
			this.fuseTimer--;
			if (this.fuseTimer <= 0) {
				this.triggerExplosion(terrain, worms, mapObjects, onExplode);
				return;
			}
		}

		// === Collision with Map Objects (barrels, mines, crates) ===
		for (const obj of mapObjects) {
			if (obj.isDestroyed) continue;
			const dist = Math.hypot(this.x - obj.x, this.y - obj.y);
			if (dist < this.radius + obj.radius) {
				if (
					this.weaponId === "grenade" ||
					this.weaponId === "cluster" ||
					this.weaponId === "dynamite"
				) {
					// Bounce off map objects
					this.vy = -Math.abs(this.vy) * this.bounciness;
					this.vx *= 0.7;
				} else if (this.weaponId === "drill" && !this.drillPenetrated) {
					// Drill: destroy the object but keep going
					obj.takeDamage(100);
					this.drillPenetrated = true;
					// Don't stop — drill continues through
				} else if (this.weaponId === "rifle") {
					// Rifle: hits and damages but no terrain destruction
					obj.takeDamage(30);
					this.triggerImpactDamage(terrain, worms, mapObjects, onExplode);
					return;
				} else {
					// Bazooka, Cluster child, Sand Bomb: impact detonation
					this.triggerExplosion(terrain, worms, mapObjects, onExplode);
					return;
				}
			}
		}

		// Collision with Worms (direct hit)
		for (const worm of worms) {
			if (!worm.isAlive) continue;
			const dist = Math.hypot(this.x - worm.x, this.y - worm.y);
			if (dist < this.radius + worm.radius) {
				if (this.weaponId === "rifle") {
					worm.takeDamage(30);
					this.triggerImpactDamage(terrain, worms, mapObjects, onExplode);
					return;
				} else if (this.weaponId === "drill") {
					// Drill: damages worm but keeps going through terrain
					worm.takeDamage(20);
					this.drillPenetrated = true;
				} else {
					this.triggerExplosion(terrain, worms, mapObjects, onExplode);
					return;
				}
			}
		}

		// === Terrain Collision ===
		const isSolidNow = terrain.isSolidAt(this.x, this.y);
		const isSolidNext = terrain.isSolidAt(this.x + this.vx, this.y + this.vy);

		if (isSolidNow || isSolidNext) {
			if (
				this.weaponId === "grenade" ||
				(this.weaponId === "cluster" && !this.isClusterChild) ||
				this.weaponId === "dynamite"
			) {
				// Bounce off terrain
				this.vy = -this.vy * this.bounciness;
				this.vx *= 0.7;
			} else if (this.weaponId === "drill") {
				if (!this.drillPenetrated) {
					// First terrain hit: penetrate through ~30px, mark as used
					this.drillPenetrated = true;
					// Destroy a narrow tunnel through terrain (6px wide, 30px deep in movement direction)
					const angle = Math.atan2(this.vy, this.vx);
					const tunnelLen = 30;
					const tunnelWidth = 6;
					for (let d = 0; d < tunnelLen; d += 3) {
						const px = this.x + Math.cos(angle) * d;
						const py = this.y + Math.sin(angle) * d;
						const gx = Math.floor(px / terrain.cellScale);
						const gy = Math.floor(py / terrain.cellScale);
						// Clear a narrow band perpendicular to movement
						for (
							let w = -Math.ceil(tunnelWidth / terrain.cellScale);
							w <= Math.ceil(tunnelWidth / terrain.cellScale);
							w++
						) {
							const ngx = gx + Math.round(Math.cos(angle + Math.PI / 2) * w);
							const ngy = gy + Math.round(Math.sin(angle + Math.PI / 2) * w);
							terrain.setCell(ngx, ngy, 0); // CELL_AIR
						}
					}
					terrain.rebuildSurfaceCache();
					// Continue through — don't explode yet
				} else {
					// Second terrain hit: NOW explode
					this.triggerExplosion(terrain, worms, mapObjects, onExplode);
					return;
				}
			} else if (this.weaponId === "rifle") {
				// Rifle: small impact, no terrain destruction
				this.triggerImpactDamage(terrain, worms, mapObjects, onExplode);
				return;
			} else {
				// Standard impact detonation (bazooka, cluster child, sand bomb)
				this.triggerExplosion(terrain, worms, mapObjects, onExplode);
				return;
			}
		}

		// Out of Bounds or Drowning
		if (
			this.y >= terrain.waterY ||
			this.x < -100 ||
			this.x > terrain.width + 100
		) {
			this.isExpired = true;
		}
	}

	/**
	 * Small impact damage (rifle) — damages entities in small radius, no terrain destruction.
	 */
	private triggerImpactDamage(
		_terrain: TerrainManager,
		worms: Worm[],
		mapObjects: MapObject[],
		onExplode: (proj: Projectile, x: number, y: number) => void,
	): void {
		if (this.isExpired) return;
		this.isExpired = true;

		// Damage worms in small radius
		for (const worm of worms) {
			if (!worm.isAlive) continue;
			const dist = Math.hypot(worm.x - this.x, worm.y - this.y);
			if (dist < 20) {
				worm.takeDamage(30);
				const angle = Math.atan2(worm.y - this.y, worm.x - this.x);
				worm.vx += Math.cos(angle) * 4;
				worm.vy += Math.sin(angle) * 3 - 2;
			}
		}
		// Damage objects
		for (const obj of mapObjects) {
			if (!obj.isDestroyed && Math.hypot(obj.x - this.x, obj.y - this.y) < 20) {
				obj.takeDamage(30);
			}
		}

		onExplode(this, this.x, this.y);
	}

	public triggerExplosion(
		terrain: TerrainManager,
		worms: Worm[],
		mapObjects: MapObject[],
		onExplode: (proj: Projectile, x: number, y: number) => void,
	): void {
		if (this.isExpired) return;
		this.isExpired = true;

		if (this.weaponId === "sand_bomb") {
			terrain.depositSand(this.x, 35);
		} else if (this.weaponId === "acid_bomb") {
			// Buffed: small terrain explosion + large acid pool
			terrain.explode(this.x, this.y, 20);
			terrain.spawnElementStream(this.x, this.y, CELL_ACID, 30);
		} else if (this.weaponId === "mortar") {
			// Airburst: explode at current position, rain 8 fragments downward
			const fragCount = 8;
			for (let i = 0; i < fragCount; i++) {
				const spreadX = (Math.random() - 0.5) * 60;
				terrain.explode(this.x + spreadX, this.y, 15);
				// Damage worms below
				for (const worm of worms) {
					if (!worm.isAlive) continue;
					const dist = Math.hypot(worm.x - (this.x + spreadX), worm.y - this.y);
					if (dist < 30) {
						const force = 1 - dist / 30;
						worm.takeDamage(Math.floor(25 * force));
						worm.vy -= force * 5; // knock down
					}
				}
			}
		} else if (this.weaponId === "dynamite") {
			// Massive explosion
			const blastRadius = 65;
			const baseDamage = 55;
			terrain.explode(this.x, this.y, blastRadius);
			for (const worm of worms) {
				if (!worm.isAlive) continue;
				const dist = Math.hypot(worm.x - this.x, worm.y - this.y);
				if (dist < blastRadius + worm.radius) {
					const force = 1 - dist / (blastRadius + worm.radius);
					worm.takeDamage(Math.floor(baseDamage * force));
					const angle = Math.atan2(worm.y - this.y, worm.x - this.x);
					worm.vx += Math.cos(angle) * force * 14;
					worm.vy += Math.sin(angle) * force * 10 - 4;
					worm.isGrounded = false;
				}
			}
		} else if (this.weaponId === "rifle") {
			// Rifle: no terrain destruction, just entity damage
			this.triggerImpactDamage(terrain, worms, mapObjects, onExplode);
			return;
		} else {
			// Standard Explosions (Bazooka, Grenade, Cluster, Drill)
			const blastRadius =
				this.weaponId === "bazooka"
					? 42
					: this.weaponId === "cluster"
						? 30
						: this.weaponId === "drill"
							? 35
							: 38;
			const baseDamage =
				this.weaponId === "bazooka" ? 45 : this.weaponId === "drill" ? 40 : 35;

			terrain.explode(this.x, this.y, blastRadius);

			// Damage & Knockback to worms
			for (const worm of worms) {
				if (!worm.isAlive) continue;
				const dist = Math.hypot(worm.x - this.x, worm.y - this.y);
				if (dist < blastRadius + worm.radius) {
					const force = 1.0 - dist / (blastRadius + worm.radius);
					const dmg = Math.floor(baseDamage * force);
					worm.takeDamage(dmg);
					const angle = Math.atan2(worm.y - this.y, worm.x - this.x);
					worm.vx += Math.cos(angle) * force * 10;
					worm.vy += Math.sin(angle) * force * 8 - 3;
					worm.isGrounded = false;
				}
			}
		}

		onExplode(this, this.x, this.y);
	}

	public draw(ctx: CanvasRenderingContext2D): void {
		if (this.isExpired) return;

		ctx.save();
		ctx.translate(this.x, this.y);

		const colors: Record<WeaponId, string> = {
			bazooka: "#ef4444",
			grenade: "#22c55e",
			cluster: "#eab308",
			acid_bomb: "#84cc16",
			sand_bomb: "#f59e0b",
			drill: "#6366f1",
			mortar: "#a855f7",
			dynamite: "#ef4444",
			rifle: "#06b6d4",
			shotgun: "#94a3b8",
		};

		ctx.fillStyle = colors[this.weaponId] || "#ffffff";
		ctx.beginPath();
		ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// Drill visual: draw rotation lines
		if (this.weaponId === "drill") {
			ctx.strokeStyle = "rgba(255,255,255,0.5)";
			ctx.lineWidth = 1;
			const angle = Math.atan2(this.vy, this.vx);
			for (let i = 0; i < 3; i++) {
				const a = angle + (i * Math.PI * 2) / 3;
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(
					Math.cos(a) * (this.radius + 3),
					Math.sin(a) * (this.radius + 3),
				);
				ctx.stroke();
			}
		}

		ctx.restore();
	}
}
