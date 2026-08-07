import type { TerrainManager } from "../terrain/terrainManager";
import type { AIPersonality, Vector2D } from "../types";

export type WormTeam = "player" | "ai";

export class Worm {
	public id: string;
	public name: string;
	public team: WormTeam;
	public personality?: AIPersonality;
	public x: number;
	public y: number;
	public vx: number = 0;
	public vy: number = 0;
	public radius: number = 12;
	public health: number = 100;
	public maxHealth: number = 100;

	// Oxygen & Water Submersion
	public oxygen: number = 100;
	public maxOxygen: number = 100;
	public isInWater: boolean = false;

	public aimAngle: number = 0; // Degrees (-90 = straight up, 0 = right, 180 = left)
	public facingRight: boolean = true;
	public isGrounded: boolean = false;
	public isAlive: boolean = true;
	public isDrowned: boolean = false;
	public fallStartY: number = 0;
	public tookDamageThisTurn: boolean = false;

	constructor(
		id: string,
		name: string,
		team: WormTeam,
		x: number,
		y: number,
		personality?: AIPersonality,
	) {
		this.id = id;
		this.name = name;
		this.team = team;
		this.personality = personality;
		this.x = x;
		this.y = y;
		this.fallStartY = y;
		this.isGrounded = true;
		this.aimAngle = team === "player" ? -30 : -150;
		this.facingRight = team === "player";
	}

	public update(terrain: TerrainManager): void {
		if (!this.isAlive) return;

		// 1. Water Density & Submersion Check
		const waterCells = terrain.getWaterDensityAt(this.x, this.y, 22);
		if (waterCells > 2 || this.y >= terrain.waterY - 10) {
			this.isInWater = true;
			this.vy += 0.1; // Reduced effective gravity in water
			this.vy -= Math.min(0.5, waterCells * 0.04); // Buoyancy force upward!
			this.vx *= 0.75; // Fluid drag
			this.vy *= 0.8;

			// Deplete oxygen while submerged
			this.oxygen = Math.max(0, this.oxygen - 0.5);
			if (this.oxygen <= 0) {
				this.takeDamage(0.4); // Gradual drowning damage per tick
			}
		} else {
			this.isInWater = false;
			this.oxygen = Math.min(this.maxOxygen, this.oxygen + 2.0); // Replenish breath
			this.vy += 0.5; // Normal gravity
			this.vx *= 0.85; // Normal friction
		}

		// 2. Ceiling / Head Collision (when jumping or swimming upward)
		if (this.vy < 0) {
			if (terrain.isSolidAt(this.x, this.y - this.radius)) {
				this.vy = Math.max(0, this.vy);
			}
		}

		// 3. Horizontal Movement & Slope / Cliff Collision Check
		const nextX = this.x + this.vx;
		const feetY = this.y + this.radius;

		if (Math.abs(this.vx) > 0.01) {
			const maxStepHeight = 10; // Max climbable step height in pixels
			const headBlocked = terrain.isSolidAt(nextX, this.y - 4);
			const wallBlocked = terrain.isSolidAt(nextX, feetY - maxStepHeight);

			if (headBlocked || wallBlocked) {
				// High wall / cliff or overhead obstacle blocks horizontal movement
				this.vx = 0;
			} else {
				// Probe local step surface height at nextX
				const localStepY = terrain.getLocalGroundY(
					nextX,
					feetY,
					12,
					maxStepHeight + 2,
				);
				if (localStepY !== null) {
					const stepDiff = feetY - localStepY;
					if (stepDiff > 0 && stepDiff <= maxStepHeight) {
						// Smoothly step up slope over frames
						const maxClimbPerTick = 3.0;
						this.y -= Math.min(stepDiff, maxClimbPerTick);
						this.x = nextX;
					} else if (stepDiff <= 0 && stepDiff >= -10 && this.isGrounded) {
						// Smoothly step down slope
						const maxDescentPerTick = 3.0;
						this.y += Math.min(Math.abs(stepDiff), maxDescentPerTick);
						this.x = nextX;
					} else {
						this.x = nextX;
					}
				} else {
					this.x = nextX;
				}
			}
		}

		// 4. Vertical Position & Landing Collision
		this.y += this.vy;
		const currentFeetY = this.y + this.radius;
		const localGroundY = terrain.getLocalGroundY(this.x, currentFeetY, 15, 12);

		if (localGroundY !== null && currentFeetY >= localGroundY) {
			// Landing on local ground surface
			if (!this.isGrounded && this.vy > 8 && !this.isInWater) {
				const fallDist = Math.max(0, this.y - this.fallStartY);
				if (fallDist > 120) {
					const dmg = Math.floor((fallDist - 120) * 0.35);
					this.takeDamage(dmg);
				}
			}

			this.y = localGroundY - this.radius;
			this.vy = 0;
			this.isGrounded = true;
		} else {
			if (this.isGrounded) {
				this.fallStartY = this.y;
			}
			this.isGrounded = false;
		}

		// Screen Bounds
		this.x = Math.max(
			this.radius,
			Math.min(terrain.width - this.radius, this.x),
		);

		// Bottom Ocean Void Death Check
		if (this.y > terrain.height + 20) {
			this.isDrowned = true;
			this.health = 0;
			this.isAlive = false;
		}
	}

	public walk(direction: number): void {
		if (!this.isAlive) return;
		const speed = this.isInWater ? 1.5 : 2.5;
		if (this.isGrounded || this.isInWater) {
			this.vx = direction * speed;
		}
		if (direction !== 0) {
			this.facingRight = direction > 0;
		}
	}

	public jump(): void {
		if (!this.isAlive) return;
		if (this.isInWater) {
			this.vy = -4.5; // Swim upward!
			this.vx = (this.facingRight ? 1 : -1) * 2.0;
		} else if (this.isGrounded) {
			this.vy = -6.5;
			this.vx = (this.facingRight ? 1 : -1) * 3.0;
			this.isGrounded = false;
		}
	}

	public takeDamage(amount: number): void {
		if (!this.isAlive) return;
		if (amount > 0) {
			this.tookDamageThisTurn = true;
		}
		this.health = Math.max(0, this.health - amount);
		if (this.health <= 0) {
			this.isAlive = false;
		}
	}

	public resetTurnFlags(): void {
		this.tookDamageThisTurn = false;
	}

	public getCannonTip(): Vector2D {
		const rad = (this.aimAngle * Math.PI) / 180;
		const barrelLength = 22;
		return {
			x: this.x + Math.cos(rad) * barrelLength,
			y: this.y + Math.sin(rad) * barrelLength,
		};
	}

	public draw(ctx: CanvasRenderingContext2D, isActive: boolean): void {
		if (!this.isAlive) return;

		ctx.save();
		ctx.translate(this.x, this.y);

		// Waddle rotation during movement
		if (Math.abs(this.vx) > 0.1 && this.isGrounded) {
			const walkWaddle = Math.sin(Date.now() * 0.018) * 0.12;
			ctx.rotate(walkWaddle);
		}

		// Determine colors by team & personality
		const isGoblinLooter = this.team === "ai" && this.personality === "looter";
		const bodyColor = isGoblinLooter
			? "#10b981"
			: this.team === "player"
				? "#ef4444"
				: "#3b82f6";
		const accentColor = isGoblinLooter
			? "#047857"
			: this.team === "player"
				? "#b91c1c"
				: "#1d4ed8";
		const bellyColor = isGoblinLooter
			? "#a7f3d0"
			: this.team === "player"
				? "#fca5a5"
				: "#93c5fd";

		const facingDir = this.facingRight ? 1 : -1;

		// Active Arrow Indicator above head
		if (isActive) {
			const floatY = -this.radius - 24 + Math.sin(Date.now() * 0.008) * 3;
			ctx.fillStyle = "#facc15";
			ctx.beginPath();
			ctx.moveTo(-6, floatY);
			ctx.lineTo(6, floatY);
			ctx.lineTo(0, floatY + 8);
			ctx.closePath();
			ctx.fill();
			ctx.strokeStyle = "#78350f";
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// --- 1. Tail Segment (behind body) ---
		const tailX = -facingDir * (this.radius * 0.8);
		const tailY = this.radius * 0.3 + Math.sin(Date.now() * 0.01) * 1.5;
		const tailR = this.radius * 0.55;
		ctx.fillStyle = bodyColor;
		ctx.beginPath();
		ctx.arc(tailX, tailY, tailR, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = accentColor;
		ctx.lineWidth = 2;
		ctx.stroke();

		// --- 2. Goblin Ears (for Looter bot) ---
		if (isGoblinLooter) {
			ctx.fillStyle = "#059669";
			ctx.strokeStyle = "#047857";
			ctx.lineWidth = 1.5;

			// Left ear (pointing out/back)
			ctx.beginPath();
			ctx.moveTo(-this.radius + 2, -2);
			ctx.lineTo(-this.radius - 8, -6);
			ctx.lineTo(-this.radius + 1, 3);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();

			// Right ear
			ctx.beginPath();
			ctx.moveTo(this.radius - 2, -2);
			ctx.lineTo(this.radius + 8, -6);
			ctx.lineTo(this.radius - 1, 3);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}

		// --- 3. Main Worm Body (Circle + 3D Depth) ---
		ctx.fillStyle = bodyColor;
		ctx.beginPath();
		ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = accentColor;
		ctx.lineWidth = 3;
		ctx.stroke();

		// 3D Soft Belly
		ctx.fillStyle = bellyColor;
		ctx.beginPath();
		ctx.ellipse(0, 3, this.radius * 0.75, this.radius * 0.5, 0, 0, Math.PI);
		ctx.fill();

		// 3D Gloss Highlight on top-left
		ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
		ctx.beginPath();
		ctx.arc(
			-this.radius * 0.35,
			-this.radius * 0.35,
			this.radius * 0.35,
			0,
			Math.PI * 2,
		);
		ctx.fill();

		// --- 4. Eyes & Dynamic Pupil Tracking ---
		const aimRad = (this.aimAngle * Math.PI) / 180;
		const pupilOffsetX = Math.cos(aimRad) * 1.8;
		const pupilOffsetY = Math.sin(aimRad) * 1.8;

		if (this.personality === "chaotic") {
			// Crazy Eyes (one big, one tiny)
			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(facingDir * 4, -4, 5.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#000000";
			ctx.beginPath();
			ctx.arc(
				facingDir * 4 + pupilOffsetX,
				-4 + pupilOffsetY,
				2,
				0,
				Math.PI * 2,
			);
			ctx.fill();

			// Small eye
			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(facingDir * -2, -6, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#000000";
			ctx.beginPath();
			ctx.arc(facingDir * -2, -6, 1.2, 0, Math.PI * 2);
			ctx.fill();
		} else {
			// Standard / Expressive Eyes
			const eye1X = facingDir * 4;
			const eye1Y = -3;
			const eye2X = facingDir * -1;
			const eye2Y = -4;

			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(eye1X, eye1Y, 4.5, 0, Math.PI * 2);
			ctx.arc(eye2X, eye2Y, 3.5, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = "#000000";
			ctx.beginPath();
			ctx.arc(eye1X + pupilOffsetX, eye1Y + pupilOffsetY, 2.2, 0, Math.PI * 2);
			ctx.arc(eye2X + pupilOffsetX, eye2Y + pupilOffsetY, 1.7, 0, Math.PI * 2);
			ctx.fill();
		}

		// --- 5. Eyebrows ---
		if (this.personality === "aggressive") {
			// Angry V-eyebrows
			ctx.strokeStyle = "#7f1d1d";
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(facingDir * 1, -9);
			ctx.lineTo(facingDir * 8, -6);
			ctx.stroke();
		} else if (this.personality === "sniper") {
			// Focused straight brow
			ctx.strokeStyle = "#1e293b";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(facingDir * 0, -8);
			ctx.lineTo(facingDir * 7, -8);
			ctx.stroke();
		}

		// --- 6. Unique Accessories per Personality & Team ---
		if (this.team === "player") {
			// Player: General / Commander Cap with Gold Visor & Star Badge
			ctx.fillStyle = "#b91c1c";
			ctx.beginPath();
			ctx.ellipse(
				0,
				-this.radius - 1,
				this.radius * 1.1,
				5,
				0,
				Math.PI,
				Math.PI * 2,
			);
			ctx.fill();

			// Visor Brim
			ctx.fillStyle = "#1e293b";
			ctx.fillRect(facingDir * 2, -this.radius, facingDir * 9, 3);

			// Gold Star Badge
			ctx.fillStyle = "#facc15";
			ctx.beginPath();
			ctx.arc(0, -this.radius - 3, 3, 0, Math.PI * 2);
			ctx.fill();
		} else if (this.personality === "aggressive") {
			// Aggressive: Red Rambo Bandana + Fluttering Ribbon Tails + War Paint
			ctx.fillStyle = "#dc2626";
			ctx.beginPath();
			ctx.rect(-this.radius * 0.95, -8, this.radius * 1.9, 4.5);
			ctx.fill();

			// Ribbon tails behind head
			const ribbonX = -facingDir * (this.radius * 0.9);
			const ribbonWiggle = Math.sin(Date.now() * 0.012) * 2;
			ctx.fillStyle = "#b91c1c";
			ctx.beginPath();
			ctx.moveTo(ribbonX, -7);
			ctx.lineTo(ribbonX - facingDir * 8, -10 + ribbonWiggle);
			ctx.lineTo(ribbonX - facingDir * 7, -4 + ribbonWiggle);
			ctx.closePath();
			ctx.fill();

			// Cheek War Paint
			ctx.fillStyle = "#7f1d1d";
			ctx.fillRect(facingDir * 3, 2, 4, 1.5);
			ctx.fillRect(facingDir * 4, 4.5, 4, 1.5);
		} else if (this.personality === "sniper") {
			// Sniper: Navy Beret + Laser Crosshair Monocle
			ctx.fillStyle = "#1e3a8a";
			ctx.beginPath();
			ctx.ellipse(
				facingDir * 2,
				-this.radius - 1,
				10,
				5,
				-facingDir * 0.3,
				0,
				Math.PI * 2,
			);
			ctx.fill();

			// Gold emblem on beret
			ctx.fillStyle = "#f59e0b";
			ctx.beginPath();
			ctx.arc(facingDir * 4, -this.radius - 3, 2, 0, Math.PI * 2);
			ctx.fill();

			// Cyber Reticle / Monocle over front eye
			const eyeX = facingDir * 4;
			ctx.strokeStyle = "#ef4444";
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(eyeX, -3, 6, 0, Math.PI * 2);
			ctx.moveTo(eyeX - 8, -3);
			ctx.lineTo(eyeX + 8, -3);
			ctx.moveTo(eyeX, -11);
			ctx.lineTo(eyeX, 5);
			ctx.stroke();

			ctx.fillStyle = "#ef4444";
			ctx.beginPath();
			ctx.arc(eyeX + pupilOffsetX, -3 + pupilOffsetY, 1.5, 0, Math.PI * 2);
			ctx.fill();
		} else if (this.personality === "looter") {
			// Goblin Looter: Brass Goggles on Forehead + Gold Coin Bag
			ctx.fillStyle = "#d97706"; // Brass frames
			ctx.strokeStyle = "#78350f";
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(facingDir * 3, -7, 4.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();

			// Cyan glass lens
			ctx.fillStyle = "#06b6d4";
			ctx.beginPath();
			ctx.arc(facingDir * 3, -7, 2.5, 0, Math.PI * 2);
			ctx.fill();

			// Gold Coin Bag icon near hip/back
			const bagX = -facingDir * 8;
			ctx.fillStyle = "#eab308";
			ctx.beginPath();
			ctx.arc(bagX, 5, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#78350f";
			ctx.font = "bold 7px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("$", bagX, 7.5);
		} else if (this.personality === "chaotic") {
			// Chaotic: Fiery Punk Mohawk
			const mohawkColors = ["#ef4444", "#f97316", "#a855f7"];
			mohawkColors.forEach((col, idx) => {
				ctx.fillStyle = col;
				ctx.beginPath();
				const px = -6 + idx * 5;
				ctx.moveTo(px, -this.radius + 1);
				ctx.lineTo(px + 2, -this.radius - 9 - (idx % 2 === 0 ? 3 : 0));
				ctx.lineTo(px + 5, -this.radius + 1);
				ctx.closePath();
				ctx.fill();
			});
		} else {
			// Default Bot: Slate Military Helmet + Gold Badge
			ctx.fillStyle = "#475569";
			ctx.beginPath();
			ctx.arc(0, -2, this.radius + 1, Math.PI, 0);
			ctx.fill();
			ctx.strokeStyle = "#1e293b";
			ctx.lineWidth = 2;
			ctx.stroke();

			// Helmet strap
			ctx.strokeStyle = "#334155";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(0, 0, this.radius + 1.5, Math.PI * 0.15, Math.PI * 0.85);
			ctx.stroke();

			// Star emblem
			ctx.fillStyle = "#facc15";
			ctx.beginPath();
			ctx.arc(0, -this.radius + 2, 2.5, 0, Math.PI * 2);
			ctx.fill();
		}

		// Aim Barrel Line
		if (isActive) {
			const rad = (this.aimAngle * Math.PI) / 180;
			ctx.strokeStyle = "#facc15";
			ctx.lineWidth = 4;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(Math.cos(rad) * 20, Math.sin(rad) * 20);
			ctx.stroke();
		}

		ctx.restore();

		// Floating Health & Oxygen Bar
		const barWidth = 32;
		const barHeight = 5;
		const barX = this.x - barWidth / 2;
		const barY = this.y - this.radius - 16;

		ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
		ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

		const hpRatio = Math.max(0, this.health / this.maxHealth);
		ctx.fillStyle =
			hpRatio > 0.5 ? "#22c55e" : hpRatio > 0.25 ? "#eab308" : "#ef4444";
		ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

		// Oxygen Bubble Bar when submerged
		if (this.oxygen < 100) {
			const oxyRatio = Math.max(0, this.oxygen / this.maxOxygen);
			ctx.fillStyle = "#38bdf8";
			ctx.fillRect(barX, barY - 4, barWidth * oxyRatio, 3);
		}

		// Name Label
		ctx.font = "10px sans-serif";
		ctx.fillStyle = "#ffffff";
		ctx.textAlign = "center";
		ctx.fillText(this.name, this.x, barY - 5);
	}
}
