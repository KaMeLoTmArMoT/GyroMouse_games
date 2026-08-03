import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import { CELL_ACID, PROJECTILE_GRAVITY, type WeaponId } from "../types";

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
	public age: number = 0;

	// Drill-specific state
	public drillPenetrated: boolean = false;
	public drillTime: number = 0; // frames spent actively boring (30fps)
	public prevX: number = 0;
	public prevY: number = 0;
	private drillEngaged: boolean = false;
	private static readonly MAX_DRILL_FRAMES: number = 15; // ~0.5 seconds

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

		if (weaponId === "drill" || weaponId === "bazooka") {
			console.log(
				`[proj] ${weaponId} spawn @ ${x.toFixed(1)},${y.toFixed(1)} v=${vx.toFixed(1)},${vy.toFixed(1)}`,
			);
		}

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
		this.age++;
		this.drillEngaged = false;
		this.prevX = this.x;
		this.prevY = this.y;

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
			this.vy += PROJECTILE_GRAVITY[this.weaponId];
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
				// Begin/continue boring — carving & drill-time budget handled after terrain collision
				if (!this.drillPenetrated) {
					console.log(
						`[drill] engage @ ${this.x.toFixed(1)},${this.y.toFixed(1)} frame ${this.age}`,
					);
				}
				this.drillPenetrated = true;
				this.drillEngaged = true;
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

		// Drill: bore through terrain while engaged, up to a max total drill duration.
		// The timer persists across wall exits — it only accumulates while boring.
		if (this.weaponId === "drill" && this.drillEngaged) {
			this.drillTime++;
			this.carveDrillTunnel(terrain, this.prevX, this.prevY);
			if (this.drillTime % 5 === 0) {
				console.log(
					`[drill] boring ${this.drillTime}/${Projectile.MAX_DRILL_FRAMES} @ ${this.x.toFixed(1)},${this.y.toFixed(1)}`,
				);
			}
			if (this.drillTime >= Projectile.MAX_DRILL_FRAMES) {
				console.log(
					`[drill] explode (budget) @ ${this.x.toFixed(1)},${this.y.toFixed(1)}`,
				);
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
			if (this.weaponId === "drill" || this.weaponId === "bazooka") {
				console.log(
					`[proj] ${this.weaponId} expire @ ${this.x.toFixed(1)},${this.y.toFixed(1)}`,
				);
			}
			this.isExpired = true;
		}
	}

	/**
	 * Carve a clean, continuous bore through terrain along the path traveled this frame.
	 * Clears every cell within a capsule (segment + radius) so consecutive frames leave a
	 * smooth tunnel instead of scalloped tire-track ridges.
	 */
	private carveDrillTunnel(
		terrain: TerrainManager,
		fromX: number,
		fromY: number,
	): void {
		const cellScale = terrain.cellScale;
		const boreRadius = 7;
		const lead = 14;
		const angle = Math.atan2(this.y - fromY, this.x - fromX);
		const endX = this.x + Math.cos(angle) * lead;
		const endY = this.y + Math.sin(angle) * lead;

		const minGX = Math.floor((Math.min(fromX, endX) - boreRadius) / cellScale);
		const maxGX = Math.floor((Math.max(fromX, endX) + boreRadius) / cellScale);
		const minGY = Math.floor((Math.min(fromY, endY) - boreRadius) / cellScale);
		const maxGY = Math.floor((Math.max(fromY, endY) + boreRadius) / cellScale);

		const segDX = endX - fromX;
		const segDY = endY - fromY;
		const segLenSq = segDX * segDX + segDY * segDY || 1;

		for (let gy = minGY; gy <= maxGY; gy++) {
			for (let gx = minGX; gx <= maxGX; gx++) {
				const cx = (gx + 0.5) * cellScale;
				const cy = (gy + 0.5) * cellScale;
				const t = Math.max(
					0,
					Math.min(1, ((cx - fromX) * segDX + (cy - fromY) * segDY) / segLenSq),
				);
				const px = fromX + segDX * t;
				const py = fromY + segDY * t;
				if (Math.hypot(cx - px, cy - py) <= boreRadius) {
					terrain.setCell(gx, gy, 0); // CELL_AIR
				}
			}
		}
		terrain.rebuildSurfaceCache();
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
		ctx.rotate(Math.atan2(this.vy, this.vx));

		switch (this.weaponId) {
			case "bazooka":
				this.drawBazooka(ctx);
				break;
			case "grenade":
				this.drawGrenade(ctx);
				break;
			case "cluster":
				this.drawCluster(ctx);
				break;
			case "acid_bomb":
				this.drawAcidBomb(ctx);
				break;
			case "sand_bomb":
				this.drawSandBomb(ctx);
				break;
			case "drill":
				this.drawDrill(ctx);
				break;
			case "mortar":
				this.drawMortar(ctx);
				break;
			case "dynamite":
				this.drawDynamite(ctx);
				break;
			case "rifle":
				this.drawRifle(ctx);
				break;
			default:
				this.drawFallback(ctx);
		}

		ctx.restore();
	}

	private drawGlow(ctx: CanvasRenderingContext2D, rgb: string): void {
		const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius * 2.2);
		grad.addColorStop(0, `rgba(${rgb}, 0.35)`);
		grad.addColorStop(1, `rgba(${rgb}, 0)`);
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(0, 0, this.radius * 2.2, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawBazooka(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "239, 68, 68");

		ctx.fillStyle = "#ef4444";
		ctx.strokeStyle = "#b91c1c";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.roundRect(-8, -3.5, 16, 7, 3);
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = "#fca5a5";
		ctx.beginPath();
		ctx.moveTo(10, 0);
		ctx.lineTo(6, -3.5);
		ctx.lineTo(6, 3.5);
		ctx.closePath();
		ctx.fill();

		ctx.fillStyle = "#ffffff";
		ctx.fillRect(-2, -3.5, 3, 7);

		ctx.fillStyle = "#7f1d1d";
		ctx.beginPath();
		ctx.moveTo(-8, -3);
		ctx.lineTo(-12, -6);
		ctx.lineTo(-8, -1);
		ctx.closePath();
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(-8, 3);
		ctx.lineTo(-12, 6);
		ctx.lineTo(-8, 1);
		ctx.closePath();
		ctx.fill();

		ctx.globalAlpha = 0.7;
		ctx.fillStyle = "#fbbf24";
		ctx.beginPath();
		ctx.arc(-12, 0, 2.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
	}

	private drawGrenade(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "34, 197, 94");
		const r = this.radius;

		ctx.fillStyle = "#16a34a";
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#065f46";
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(-r, 0);
		ctx.lineTo(0, -r);
		ctx.lineTo(r, 0);
		ctx.lineTo(0, r);
		ctx.closePath();
		ctx.stroke();

		ctx.fillStyle = "#4b5563";
		ctx.fillRect(-2, -r - 4, 4, 5);
		ctx.fillStyle = "#fbbf24";
		ctx.beginPath();
		ctx.arc(0, -r - 5, 2.5, 0, Math.PI * 2);
		ctx.fill();
		if (this.age % 10 < 5) {
			ctx.fillStyle = "#fef08a";
			ctx.beginPath();
			ctx.arc(0, -r - 8, 2, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawCluster(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "234, 179, 8");
		const r = this.radius;

		ctx.fillStyle = "#ca8a04";
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#854d0e";
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.save();
		ctx.rotate(this.age * 0.3);
		ctx.strokeStyle = "#fef08a";
		ctx.lineWidth = 2;
		for (let i = 0; i < 3; i++) {
			const a = (i * Math.PI * 2) / 3;
			ctx.beginPath();
			ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
			ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
			ctx.stroke();
		}
		ctx.restore();

		ctx.fillStyle = "rgba(255,255,255,0.4)";
		ctx.beginPath();
		ctx.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawAcidBomb(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "132, 204, 22");
		const r = this.radius;
		const wob = Math.sin(this.age * 0.3) * 0.3;

		ctx.fillStyle = "#4d7c0f";
		ctx.beginPath();
		ctx.arc(0, 0, r + wob, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#365314";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, r);
		grad.addColorStop(0, "#d9f99d");
		grad.addColorStop(0.5, "#a3e635");
		grad.addColorStop(1, "#4d7c0f");
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = "rgba(255,255,255,0.5)";
		ctx.beginPath();
		ctx.arc(-r * 0.3, -r * 0.3, 2.5, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawSandBomb(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "245, 158, 11");
		const r = this.radius;

		ctx.fillStyle = "#d97706";
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#92400e";
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.fillStyle = "#fbbf24";
		ctx.fillRect(-r, -1.5, r * 2, 3);
		ctx.fillStyle = "#fde68a";
		ctx.fillRect(-r, -1.5, r * 2, 1);
	}

	private drawDrill(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "99, 102, 241");
		const r = this.radius;

		ctx.fillStyle = "#6366f1";
		ctx.beginPath();
		ctx.roundRect(-r - 2, -r * 0.7, r * 2 + 4, r * 1.4, r * 0.7);
		ctx.fill();
		ctx.strokeStyle = "#3730a3";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.fillStyle = "#c7d2fe";
		ctx.beginPath();
		ctx.moveTo(r + 6, 0);
		ctx.lineTo(r - 1, -r * 0.7);
		ctx.lineTo(r - 1, r * 0.7);
		ctx.closePath();
		ctx.fill();

		ctx.save();
		ctx.rotate(this.age * 0.5);
		ctx.strokeStyle = "#a5b4fc";
		ctx.lineWidth = 2;
		for (let i = 0; i < 3; i++) {
			const a = (i * Math.PI * 2) / 3;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1));
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawMortar(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "168, 85, 247");
		const r = this.radius;

		ctx.fillStyle = "#9333ea";
		ctx.beginPath();
		ctx.roundRect(-r - 2, -r * 0.6, r * 2 + 4, r * 1.2, r * 0.5);
		ctx.fill();
		ctx.strokeStyle = "#6b21a8";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.fillStyle = "#c4b5fd";
		ctx.beginPath();
		ctx.arc(r + 1, 0, r * 0.5, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = "#581c87";
		ctx.beginPath();
		ctx.moveTo(-r - 2, -r * 0.4);
		ctx.lineTo(-r - 6, -r);
		ctx.lineTo(-r - 2, -r * 0.1);
		ctx.closePath();
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(-r - 2, r * 0.4);
		ctx.lineTo(-r - 6, r);
		ctx.lineTo(-r - 2, r * 0.1);
		ctx.closePath();
		ctx.fill();

		if (this.fuseTimer < 30 && this.age % 6 < 3) {
			ctx.fillStyle = "#f87171";
			ctx.beginPath();
			ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawDynamite(ctx: CanvasRenderingContext2D): void {
		this.drawGlow(ctx, "239, 68, 68");
		const r = this.radius;

		for (let i = 0; i < 3; i++) {
			ctx.save();
			ctx.rotate(i === 0 ? -0.15 : i === 2 ? 0.15 : 0);
			ctx.fillStyle = "#ef4444";
			ctx.strokeStyle = "#7f1d1d";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.roundRect(-4, -r - 2, 8, r * 2 + 4, 2);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = "#fde68a";
			ctx.beginPath();
			ctx.roundRect(-4, r + 1, 8, 3, 1);
			ctx.fill();
			ctx.restore();
		}

		ctx.fillStyle = "#78350f";
		ctx.beginPath();
		ctx.roundRect(-8, -3, 16, 6, 2);
		ctx.fill();
		ctx.strokeStyle = "#451a03";
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.strokeStyle = "#78350f";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(-2, -r - 2);
		ctx.quadraticCurveTo(-6, -r - 8, -2, -r - 11);
		ctx.stroke();

		ctx.fillStyle = this.age % 6 < 3 ? "#fef08a" : "#fbbf24";
		ctx.beginPath();
		ctx.arc(-2, -r - 12, 2.5, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawRifle(ctx: CanvasRenderingContext2D): void {
		const len = 18;
		const grad = ctx.createLinearGradient(0, 0, len, 0);
		grad.addColorStop(0, "rgba(6, 182, 212, 0.1)");
		grad.addColorStop(0.6, "rgba(6, 182, 212, 0.9)");
		grad.addColorStop(1, "rgba(165, 243, 252, 1)");
		ctx.strokeStyle = grad;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(len, 0);
		ctx.stroke();

		ctx.fillStyle = "#cffafe";
		ctx.beginPath();
		ctx.arc(len, 0, 3, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawFallback(ctx: CanvasRenderingContext2D): void {
		ctx.fillStyle = "#94a3b8";
		ctx.beginPath();
		ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
		ctx.fill();
	}
}
