export type EffectType =
	| "smoke"
	| "spark"
	| "flash"
	| "shockwave"
	| "fireball"
	| "acid_drip"
	| "sand_puff"
	| "tracer"
	| "muzzle_flash";

export interface Effect {
	type: EffectType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	size: number;
	color: string;
	angle?: number;
}

export class EffectSystem {
	public effects: Effect[] = [];

	private add(e: Effect): void {
		if (this.effects.length >= 350) return;
		this.effects.push(e);
	}

	public spawnSmoke(
		x: number,
		y: number,
		vx: number,
		vy: number,
		size: number,
	): void {
		this.add({
			type: "smoke",
			x,
			y,
			vx,
			vy,
			life: 0,
			maxLife: 35 + Math.floor(Math.random() * 25),
			size,
			color: "#64748b",
		});
	}

	public spawnSparks(
		x: number,
		y: number,
		count: number,
		spread: number,
		speed: number,
		color: string,
	): void {
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = speed * (0.3 + Math.random() * 0.7);
			this.add({
				type: "spark",
				x,
				y,
				vx: Math.cos(a) * s * spread,
				vy: Math.sin(a) * s * spread - 1,
				life: 0,
				maxLife: 12 + Math.floor(Math.random() * 16),
				size: 1.5 + Math.random() * 2,
				color,
			});
		}
	}

	public spawnFlash(x: number, y: number, radius: number): void {
		this.add({
			type: "flash",
			x,
			y,
			vx: 0,
			vy: 0,
			life: 0,
			maxLife: 8,
			size: radius,
			color: "#ffffff",
		});
	}

	public spawnShockwave(x: number, y: number, radius: number): void {
		this.add({
			type: "shockwave",
			x,
			y,
			vx: 0,
			vy: 0,
			life: 0,
			maxLife: 14,
			size: radius,
			color: "rgba(255, 255, 255, 0.9)",
		});
	}

	public spawnFireball(x: number, y: number, radius: number): void {
		this.add({
			type: "fireball",
			x,
			y,
			vx: 0,
			vy: 0,
			life: 0,
			maxLife: 16,
			size: radius,
			color: "#fbbf24",
		});
		this.spawnSparks(x, y, 12, 1, 4, "#f97316");
	}

	public spawnAcidDrip(x: number, y: number): void {
		this.add({
			type: "acid_drip",
			x,
			y,
			vx: (Math.random() - 0.5) * 2,
			vy: -Math.random() * 2,
			life: 0,
			maxLife: 28 + Math.floor(Math.random() * 22),
			size: 2 + Math.random() * 2.5,
			color: "#a3e635",
		});
	}

	public spawnSandPuff(x: number, y: number): void {
		this.add({
			type: "sand_puff",
			x,
			y,
			vx: (Math.random() - 0.5) * 4,
			vy: -Math.random() * 3,
			life: 0,
			maxLife: 30,
			size: 2 + Math.random() * 3,
			color: "#f59e0b",
		});
	}

	public spawnTracer(
		x: number,
		y: number,
		angle: number,
		length: number,
		color: string,
	): void {
		this.add({
			type: "tracer",
			x,
			y,
			vx: 0,
			vy: 0,
			angle,
			life: 0,
			maxLife: 5,
			size: length,
			color,
		});
	}

	public spawnMuzzleFlash(x: number, y: number, angle: number): void {
		this.add({
			type: "muzzle_flash",
			x,
			y,
			vx: 0,
			vy: 0,
			angle,
			life: 0,
			maxLife: 5,
			size: 12,
			color: "#fde047",
		});
	}

	public update(): void {
		for (let i = this.effects.length - 1; i >= 0; i--) {
			const e = this.effects[i];
			e.life++;
			if (e.life >= e.maxLife) {
				this.effects.splice(i, 1);
				continue;
			}

			if (e.type === "smoke") {
				e.vy -= 0.05;
				e.vx *= 0.95;
				e.size += 0.4;
			} else if (e.type === "spark") {
				e.vy += 0.3;
				e.vx *= 0.97;
			} else if (e.type === "acid_drip") {
				e.vy += 0.2;
			} else if (e.type === "sand_puff") {
				e.vy += 0.1;
				e.vx *= 0.96;
			}
			e.x += e.vx;
			e.y += e.vy;
		}
	}

	public draw(ctx: CanvasRenderingContext2D): void {
		for (const e of this.effects) {
			const t = e.life / e.maxLife;
			const alpha = 1 - t;

			switch (e.type) {
				case "smoke":
					ctx.globalAlpha = alpha * 0.6;
					ctx.fillStyle = e.color;
					ctx.beginPath();
					ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
					ctx.fill();
					break;
				case "spark":
					ctx.globalAlpha = alpha;
					ctx.strokeStyle = e.color;
					ctx.lineWidth = e.size * 0.6;
					ctx.beginPath();
					ctx.moveTo(e.x, e.y);
					ctx.lineTo(e.x - e.vx * 1.5, e.y - e.vy * 1.5);
					ctx.stroke();
					break;
				case "flash": {
					const r = e.size * (0.4 + t * 1.2);
					ctx.globalAlpha = alpha;
					const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
					grad.addColorStop(0, "rgba(255,255,255,0.95)");
					grad.addColorStop(0.4, "rgba(253, 224, 71, 0.7)");
					grad.addColorStop(1, "rgba(249, 115, 22, 0)");
					ctx.fillStyle = grad;
					ctx.beginPath();
					ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
					ctx.fill();
					break;
				}
				case "shockwave":
					ctx.globalAlpha = alpha;
					ctx.strokeStyle = e.color;
					ctx.lineWidth = 3 * alpha + 1;
					ctx.beginPath();
					ctx.arc(e.x, e.y, e.size * (0.3 + t), 0, Math.PI * 2);
					ctx.stroke();
					break;
				case "fireball": {
					const r = e.size * (0.5 + t * 1.1);
					ctx.globalAlpha = alpha;
					const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
					grad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
					grad.addColorStop(0.3, "rgba(251, 191, 36, 0.9)");
					grad.addColorStop(0.7, "rgba(249, 115, 22, 0.7)");
					grad.addColorStop(1, "rgba(239, 68, 68, 0)");
					ctx.fillStyle = grad;
					ctx.beginPath();
					ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
					ctx.fill();
					break;
				}
				case "acid_drip":
					ctx.globalAlpha = alpha;
					ctx.fillStyle = e.color;
					ctx.beginPath();
					ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
					ctx.fill();
					break;
				case "sand_puff":
					ctx.globalAlpha = alpha * 0.9;
					ctx.fillStyle = e.color;
					ctx.beginPath();
					ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
					ctx.fill();
					break;
				case "tracer": {
					const a = e.angle ?? 0;
					ctx.globalAlpha = alpha;
					const grad = ctx.createLinearGradient(
						e.x,
						e.y,
						e.x + Math.cos(a) * e.size,
						e.y + Math.sin(a) * e.size,
					);
					grad.addColorStop(0, e.color);
					grad.addColorStop(1, "rgba(6, 182, 212, 0)");
					ctx.strokeStyle = grad;
					ctx.lineWidth = 3;
					ctx.beginPath();
					ctx.moveTo(e.x, e.y);
					ctx.lineTo(e.x + Math.cos(a) * e.size, e.y + Math.sin(a) * e.size);
					ctx.stroke();
					break;
				}
				case "muzzle_flash": {
					const a = e.angle ?? 0;
					ctx.globalAlpha = alpha;
					ctx.strokeStyle = e.color;
					ctx.lineWidth = 3;
					ctx.beginPath();
					ctx.moveTo(e.x, e.y);
					ctx.lineTo(e.x + Math.cos(a) * e.size, e.y + Math.sin(a) * e.size);
					ctx.stroke();
					ctx.strokeStyle = "rgba(255,255,255,0.9)";
					ctx.lineWidth = 5;
					ctx.beginPath();
					ctx.moveTo(e.x, e.y);
					ctx.lineTo(
						e.x + Math.cos(a) * (e.size * 0.5),
						e.y + Math.sin(a) * (e.size * 0.5),
					);
					ctx.stroke();
					break;
				}
			}
		}
		ctx.globalAlpha = 1;
	}
}
