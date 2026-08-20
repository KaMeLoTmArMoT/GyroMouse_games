import type { DungeonLevel } from "./level";
import type { Player } from "./player";
import {
	DIR_ANGLES,
	type EnemyEntity,
	type ProjectileEntity,
	TILE_SIZE,
	TileType,
} from "./types";

export interface SparkParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	color: string;
}

export class EnemyManager {
	public enemies: EnemyEntity[] = [];
	public projectiles: ProjectileEntity[] = [];
	public sparks: SparkParticle[] = [];
	private shootCooldown: number = 0;

	public spawnEnemies(level: DungeonLevel, count: number = 8): void {
		this.enemies = [];
		this.projectiles = [];
		this.sparks = [];

		const validTiles: { x: number; y: number }[] = [];
		for (let y = 3; y < level.height - 3; y++) {
			for (let x = 3; x < level.width - 3; x++) {
				if (level.getTile(x, y) === TileType.FLOOR) {
					// Don't spawn right on player start
					const distToSpawn = Math.hypot(
						x - level.spawnTile.x,
						y - level.spawnTile.y,
					);
					if (distToSpawn > 6) {
						validTiles.push({ x, y });
					}
				}
			}
		}

		// Shuffle and pick
		for (let i = validTiles.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
		}

		const spawnCount = Math.min(count, validTiles.length);
		for (let i = 0; i < spawnCount; i++) {
			const tile = validTiles[i];
			const angle = Math.random() * Math.PI * 2;
			const speed = 40 + Math.random() * 20;

			this.enemies.push({
				id: `enemy_${i}_${Date.now()}`,
				x: (tile.x + 0.5) * TILE_SIZE,
				y: (tile.y + 0.5) * TILE_SIZE,
				radius: 11,
				speed,
				hp: 2,
				maxHp: 2,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				changeDirTimer: 1.5 + Math.random() * 2.5,
				hitFlashTimer: 0,
				isDead: false,
			});
		}
	}

	public fireMagicBolt(player: Player, level: DungeonLevel): boolean {
		if (this.shootCooldown > 0) return false;
		this.shootCooldown = 0.22; // Seconds cooldown

		const baseAngle = DIR_ANGLES[player.aimDirection];
		let targetAngle = baseAngle;

		// Hard Auto-Aim (90-degree forward vision cone = ±45 degrees)
		let closestEnemy: EnemyEntity | null = null;
		let minDistance = 380; // max auto-aim range in pixels

		for (const enemy of this.enemies) {
			if (enemy.isDead) continue;

			const dx = enemy.x - player.x;
			const dy = enemy.y - player.y;
			const dist = Math.hypot(dx, dy);

			if (dist > minDistance) continue;

			const enemyAngle = Math.atan2(dy, dx);
			let angleDiff = enemyAngle - baseAngle;

			// Normalize angle diff to [-PI, PI]
			while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
			while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

			// Within 90-degree forward sector (±45 deg = ±PI/4)
			if (Math.abs(angleDiff) <= Math.PI / 4) {
				// Line of sight raycast check
				if (this.hasLineOfSight(player.x, player.y, enemy.x, enemy.y, level)) {
					minDistance = dist;
					closestEnemy = enemy;
					targetAngle = enemyAngle; // Snap directly onto enemy!
				}
			}
		}

		const projSpeed = 420;
		this.projectiles.push({
			id: `proj_${Date.now()}_${Math.random()}`,
			x: player.x + Math.cos(targetAngle) * (player.radius + 4),
			y: player.y + Math.sin(targetAngle) * (player.radius + 4),
			vx: Math.cos(targetAngle) * projSpeed,
			vy: Math.sin(targetAngle) * projSpeed,
			life: 1.2,
			radius: 4,
			color: closestEnemy ? "#a855f7" : "#38bdf8", // Purple when auto-aim lock, cyan otherwise
		});

		return true;
	}

	private hasLineOfSight(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		level: DungeonLevel,
	): boolean {
		const steps = 12;
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			const cx = x1 + (x2 - x1) * t;
			const cy = y1 + (y2 - y1) * t;
			const tx = Math.floor(cx / TILE_SIZE);
			const ty = Math.floor(cy / TILE_SIZE);
			if (!level.isWalkable(tx, ty)) {
				return false;
			}
		}
		return true;
	}

	public update(dt: number, level: DungeonLevel): void {
		if (this.shootCooldown > 0) {
			this.shootCooldown -= dt;
		}

		// 1. Update Enemies
		for (const enemy of this.enemies) {
			if (enemy.isDead) continue;

			if (enemy.hitFlashTimer > 0) {
				enemy.hitFlashTimer -= dt;
			}

			enemy.changeDirTimer -= dt;
			if (enemy.changeDirTimer <= 0) {
				const angle = Math.random() * Math.PI * 2;
				enemy.vx = Math.cos(angle) * enemy.speed;
				enemy.vy = Math.sin(angle) * enemy.speed;
				enemy.changeDirTimer = 1.5 + Math.random() * 3.0;
			}

			const nextX = enemy.x + enemy.vx * dt;
			const nextY = enemy.y + enemy.vy * dt;

			if (!level.checkBoundingCollision(nextX, enemy.y, enemy.radius)) {
				enemy.x = nextX;
			} else {
				enemy.vx = -enemy.vx;
			}

			if (!level.checkBoundingCollision(enemy.x, nextY, enemy.radius)) {
				enemy.y = nextY;
			} else {
				enemy.vy = -enemy.vy;
			}
		}

		// 2. Update Projectiles
		for (let p = this.projectiles.length - 1; p >= 0; p--) {
			const proj = this.projectiles[p];
			proj.life -= dt;

			if (proj.life <= 0) {
				this.projectiles.splice(p, 1);
				continue;
			}

			proj.x += proj.vx * dt;
			proj.y += proj.vy * dt;

			// Collision against walls
			if (level.checkBoundingCollision(proj.x, proj.y, proj.radius)) {
				this.createSparks(proj.x, proj.y, proj.color, 5);
				this.projectiles.splice(p, 1);
				continue;
			}

			// Collision against enemies
			let hitEnemy = false;
			for (const enemy of this.enemies) {
				if (enemy.isDead) continue;

				const dist = Math.hypot(proj.x - enemy.x, proj.y - enemy.y);
				if (dist <= proj.radius + enemy.radius) {
					enemy.hp -= 1;
					enemy.hitFlashTimer = 0.15;
					this.createSparks(enemy.x, enemy.y, "#ef4444", 8);

					if (enemy.hp <= 0) {
						enemy.isDead = true;
						this.createSparks(enemy.x, enemy.y, "#a855f7", 18);
					}

					hitEnemy = true;
					break;
				}
			}

			if (hitEnemy) {
				this.projectiles.splice(p, 1);
			}
		}

		// 3. Update Sparks
		for (let s = this.sparks.length - 1; s >= 0; s--) {
			const spark = this.sparks[s];
			spark.life -= dt;
			if (spark.life <= 0) {
				this.sparks.splice(s, 1);
				continue;
			}
			spark.x += spark.vx * dt;
			spark.y += spark.vy * dt;
		}
	}

	private createSparks(
		x: number,
		y: number,
		color: string,
		count: number = 8,
	): void {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 40 + Math.random() * 120;
			const life = 0.2 + Math.random() * 0.3;
			this.sparks.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life,
				maxLife: life,
				color,
			});
		}
	}

	public render(
		ctx: CanvasRenderingContext2D,
		isTileVisible: (tx: number, ty: number) => boolean,
	): void {
		// 1. Render Enemies
		for (const enemy of this.enemies) {
			if (enemy.isDead) continue;

			const tx = Math.floor(enemy.x / TILE_SIZE);
			const ty = Math.floor(enemy.y / TILE_SIZE);
			if (!isTileVisible(tx, ty)) continue;

			ctx.save();

			// Glow / Shadow
			ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
			ctx.beginPath();
			ctx.ellipse(
				enemy.x,
				enemy.y + 6,
				enemy.radius,
				enemy.radius * 0.5,
				0,
				0,
				Math.PI * 2,
			);
			ctx.fill();

			// Enemy Body (Phantom Orb)
			const isHit = enemy.hitFlashTimer > 0;
			ctx.fillStyle = isHit ? "#ffffff" : "#dc2626";
			ctx.beginPath();
			ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = isHit ? "#ef4444" : "#991b1b";
			ctx.lineWidth = 2;
			ctx.stroke();

			// Glowing Core Eye
			ctx.fillStyle = "#fef08a";
			ctx.beginPath();
			ctx.arc(enemy.x, enemy.y - 1, 3.5, 0, Math.PI * 2);
			ctx.fill();

			// HP bar
			if (enemy.hp < enemy.maxHp) {
				const barW = 18;
				const barH = 3;
				const hpRatio = enemy.hp / enemy.maxHp;
				ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
				ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.radius - 6, barW, barH);
				ctx.fillStyle = "#22c55e";
				ctx.fillRect(
					enemy.x - barW / 2,
					enemy.y - enemy.radius - 6,
					barW * hpRatio,
					barH,
				);
			}

			ctx.restore();
		}

		// 2. Render Projectiles
		for (const proj of this.projectiles) {
			ctx.save();
			ctx.fillStyle = proj.color;
			ctx.shadowColor = proj.color;
			ctx.shadowBlur = 8;
			ctx.beginPath();
			ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		// 3. Render Sparks
		for (const spark of this.sparks) {
			ctx.save();
			const alpha = spark.life / spark.maxLife;
			ctx.fillStyle = spark.color;
			ctx.globalAlpha = alpha;
			ctx.fillRect(spark.x - 1.5, spark.y - 1.5, 3, 3);
			ctx.restore();
		}
	}
}
