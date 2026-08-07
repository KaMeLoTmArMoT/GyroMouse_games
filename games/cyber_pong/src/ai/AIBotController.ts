import type RAPIER from "@dimforge/rapier3d-compat";

export type AIDifficulty = "easy" | "medium" | "hard" | "extreme" | "adaptive";

export class AIBotController {
	public difficulty: AIDifficulty = "medium";
	private targetZ: number = 0;
	private currentPredictedZ: number = 0;
	private reactionTimer: number = 0;

	constructor(difficulty: AIDifficulty = "medium") {
		this.difficulty = difficulty;
	}

	/**
	 * Predicts future puck Z position at target X using wall bounce physics reflections
	 */
	private predictPuckTargetZ(
		puckPos: { x: number; y: number; z: number },
		puckVel: { x: number; y: number; z: number },
		targetX: number,
		maxBounces: number = 10,
	): number {
		if (puckVel.x <= 0.001) {
			return puckPos.z * 0.3; // Center bias when puck is traveling away
		}

		const timeToReach = (targetX - puckPos.x) / puckVel.x;
		if (timeToReach <= 0) return puckPos.z;

		const minZ = -9.7; // Top wall collision boundary
		const maxZ = 9.7; // Bottom wall collision boundary
		const span = maxZ - minZ;

		if (maxBounces === 0) {
			// Linear prediction without wall bounce reflection
			const rawZ = puckPos.z + puckVel.z * timeToReach;
			return Math.max(minZ, Math.min(maxZ, rawZ));
		}

		const rawZ = puckPos.z + puckVel.z * timeToReach;
		const relZ = rawZ - minZ;

		// Calculate bounce reflections using modular arithmetic
		const cycle = Math.floor(relZ / span);
		let rem = relZ - cycle * span;
		if (rem < 0) rem += span;

		// Limit bounces if maxBounces is specified
		const bounceCount = Math.abs(cycle);
		if (bounceCount > maxBounces) {
			return Math.max(minZ, Math.min(maxZ, rawZ));
		}

		if (bounceCount % 2 === 1) {
			rem = span - rem;
		}

		return minZ + rem;
	}

	public update(
		dt: number,
		paddleBody: RAPIER.RigidBody,
		puckPos: { x: number; y: number; z: number },
		puckVel: { x: number; y: number; z: number },
		scoreDelta: number, // p1Score - p2Score
	) {
		const paddlePos = paddleBody.translation();

		let effectiveDiff = this.difficulty;
		if (this.difficulty === "adaptive") {
			if (scoreDelta >= 4) effectiveDiff = "extreme";
			else if (scoreDelta >= 2) effectiveDiff = "hard";
			else if (scoreDelta <= -3) effectiveDiff = "easy";
			else effectiveDiff = "medium";
		}

		let speedMult = 1.0;
		let reactionInterval = 0.0;
		let maxBouncesAllowed = 10;
		let errorMargin = 0.0;

		switch (effectiveDiff) {
			case "easy":
				speedMult = 0.45;
				reactionInterval = 0.25; // Re-evaluates target every 250ms
				maxBouncesAllowed = 0; // Linear prediction only
				errorMargin = 1.5;
				break;
			case "medium":
				speedMult = 0.7;
				reactionInterval = 0.12; // Re-evaluates target every 120ms
				maxBouncesAllowed = 1; // 1 wall bounce
				errorMargin = 0.7;
				break;
			case "hard":
				speedMult = 0.98;
				reactionInterval = 0.04;
				maxBouncesAllowed = 5;
				errorMargin = 0.2;
				break;
			case "extreme":
				speedMult = 1.25;
				reactionInterval = 0.0; // Immediate frame-by-frame reaction
				maxBouncesAllowed = 20; // Full trajectory math
				errorMargin = 0.0; // Zero error
				break;
		}

		this.reactionTimer += dt;
		if (this.reactionTimer >= reactionInterval) {
			this.reactionTimer = 0;

			if (puckVel.x > 0) {
				const rawPredictedZ = this.predictPuckTargetZ(
					puckPos,
					puckVel,
					paddlePos.x,
					maxBouncesAllowed,
				);

				// Apply difficulty-based error offset
				if (errorMargin > 0) {
					const noise = Math.sin(performance.now() * 0.005) * errorMargin;
					this.currentPredictedZ = rawPredictedZ + noise;
				} else {
					this.currentPredictedZ = rawPredictedZ;
				}
			} else {
				// Anticipatory repositioning when puck is on P1 side
				if (effectiveDiff === "extreme") {
					// Position centrally with slight bias towards incoming puck Z
					this.currentPredictedZ = puckPos.z * 0.4;
				} else {
					this.currentPredictedZ = puckPos.z * 0.2;
				}
			}
		}

		// Clamp target within paddle reachable court bounds
		this.targetZ = Math.max(-8.5, Math.min(8.5, this.currentPredictedZ));

		// Move paddle towards target smoothly
		const currentZ = paddlePos.z;
		const diffZ = this.targetZ - currentZ;
		const moveSpeed = 16 * speedMult;

		let nextZ = currentZ;
		if (Math.abs(diffZ) > 0.05) {
			nextZ += Math.sign(diffZ) * Math.min(Math.abs(diffZ), moveSpeed * dt);
		}

		paddleBody.setNextKinematicTranslation({
			x: paddlePos.x,
			y: paddlePos.y,
			z: nextZ,
		});
	}
}
