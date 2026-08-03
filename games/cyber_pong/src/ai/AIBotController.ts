import type RAPIER from "@dimforge/rapier3d-compat";

export type AIDifficulty = "easy" | "medium" | "hard" | "adaptive";

export class AIBotController {
	public difficulty: AIDifficulty = "medium";
	private targetZ: number = 0;

	constructor(difficulty: AIDifficulty = "medium") {
		this.difficulty = difficulty;
	}

	public update(
		dt: number,
		paddleBody: RAPIER.RigidBody,
		puckPos: { x: number; y: number; z: number },
		puckVel: { x: number; y: number; z: number },
		scoreDelta: number, // p1Score - p2Score
	) {
		const paddlePos = paddleBody.translation();

		// Determine target position based on difficulty
		let speedMult = 1.0;
		let predictionFactor = 0.5;

		let effectiveDiff = this.difficulty;
		if (this.difficulty === "adaptive") {
			if (scoreDelta > 3) effectiveDiff = "hard";
			else if (scoreDelta < -3) effectiveDiff = "easy";
			else effectiveDiff = "medium";
		}

		switch (effectiveDiff) {
			case "easy":
				speedMult = 0.45;
				predictionFactor = 0.2;
				break;
			case "medium":
				speedMult = 0.7;
				predictionFactor = 0.5;
				break;
			case "hard":
				speedMult = 0.95;
				predictionFactor = 0.85;
				break;
		}

		// Only track aggressively when puck is heading towards AI side (puckVel.x > 0)
		if (puckVel.x > 0) {
			const timeToReach = Math.max(
				0,
				(paddlePos.x - puckPos.x) / (puckVel.x || 1),
			);
			this.targetZ = puckPos.z + puckVel.z * timeToReach * predictionFactor;
		} else {
			// Return towards center when puck is on player's half
			this.targetZ = puckPos.z * 0.3;
		}

		// Clamp target within court boundaries
		this.targetZ = Math.max(-8.5, Math.min(8.5, this.targetZ));

		// Move paddle towards target
		const currentZ = paddlePos.z;
		const diffZ = this.targetZ - currentZ;
		const moveSpeed = 16 * speedMult;

		let nextZ = currentZ;
		if (Math.abs(diffZ) > 0.1) {
			nextZ += Math.sign(diffZ) * Math.min(Math.abs(diffZ), moveSpeed * dt);
		}

		paddleBody.setNextKinematicTranslation({
			x: paddlePos.x,
			y: paddlePos.y,
			z: nextZ,
		});
	}
}
