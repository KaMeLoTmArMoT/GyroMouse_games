import type { SharedInputManager } from "../../../shared/inputManager";
import type { Direction } from "./types";

export class DungeonInputManager {
	public sharedInput: SharedInputManager;
	private aimDirIndex: number = 0; // Index in 8 directions: E, SE, S, SW, W, NW, N, NE
	private readonly directions: Direction[] = [
		"E",
		"SE",
		"S",
		"SW",
		"W",
		"NW",
		"N",
		"NE",
	];

	// One-shot debounce tracking
	private prevKeys: Set<string> = new Set();
	private currentKeys: Set<string> = new Set();

	constructor(sharedInput: SharedInputManager) {
		this.sharedInput = sharedInput;
	}

	public update(): void {
		this.prevKeys = new Set(this.currentKeys);
		this.currentKeys = new Set(this.sharedInput.keysPressed);

		// Handle P2 discrete aim rotation with Arrow Left / Arrow Right if pressed as single hits or held
		if (this.isKeyJustPressed("ArrowLeft")) {
			this.aimDirIndex = (this.aimDirIndex - 1 + 8) % 8;
		}
		if (this.isKeyJustPressed("ArrowRight")) {
			this.aimDirIndex = (this.aimDirIndex + 1) % 8;
		}

		// Also check absolute arrow key combinations for direct 8-direction aiming
		const up = this.sharedInput.isKeyPressed("ArrowUp");
		const down = this.sharedInput.isKeyPressed("ArrowDown");
		const left = this.sharedInput.isKeyPressed("ArrowLeft");
		const right = this.sharedInput.isKeyPressed("ArrowRight");

		if (up || down || left || right) {
			if (up && right) this.setAimDirection("NE");
			else if (up && left) this.setAimDirection("NW");
			else if (down && right) this.setAimDirection("SE");
			else if (down && left) this.setAimDirection("SW");
			else if (up) this.setAimDirection("N");
			else if (down) this.setAimDirection("S");
			else if (left) this.setAimDirection("W");
			else if (right) this.setAimDirection("E");
		}
	}

	public setAimDirection(dir: Direction): void {
		const idx = this.directions.indexOf(dir);
		if (idx !== -1) {
			this.aimDirIndex = idx;
		}
	}

	public getAimDirection(): Direction {
		return this.directions[this.aimDirIndex];
	}

	/**
	 * Player 1 movement vector: WASD or gyro/steering fallback
	 */
	public getMovement(): { dx: number; dy: number } {
		let dx = 0;
		let dy = 0;

		if (
			this.sharedInput.isKeyPressed("KeyD") ||
			this.sharedInput.isKeyPressed("d")
		)
			dx += 1;
		if (
			this.sharedInput.isKeyPressed("KeyA") ||
			this.sharedInput.isKeyPressed("a")
		)
			dx -= 1;
		if (
			this.sharedInput.isKeyPressed("KeyS") ||
			this.sharedInput.isKeyPressed("s")
		)
			dy += 1;
		if (
			this.sharedInput.isKeyPressed("KeyW") ||
			this.sharedInput.isKeyPressed("w")
		)
			dy -= 1;

		// Normalize diagonal movement
		if (dx !== 0 && dy !== 0) {
			const invSqrt2 = 1 / Math.sqrt(2);
			dx *= invSqrt2;
			dy *= invSqrt2;
		}

		return { dx, dy };
	}

	/**
	 * P1 Action 1 (Space key) - Interact / Pick up / Push box
	 */
	public isInteractPressed(): boolean {
		return (
			this.isKeyJustPressed("Space") ||
			this.isKeyJustPressed(" ") ||
			this.isKeyJustPressed("KeySpace")
		);
	}

	/**
	 * P2 Action 2 (Enter / Shift key) - Sonar / Shoot action
	 */
	public isShootPressed(): boolean {
		return (
			this.isKeyJustPressed("Enter") ||
			this.isKeyJustPressed("ShiftLeft") ||
			this.isKeyJustPressed("ShiftRight")
		);
	}

	/**
	 * Helper for checking edge triggers (just pressed this frame)
	 */
	public isKeyJustPressed(codeOrKey: string): boolean {
		return (
			(this.currentKeys.has(codeOrKey) ||
				this.sharedInput.keysPressed.has(codeOrKey)) &&
			!this.prevKeys.has(codeOrKey)
		);
	}
}
