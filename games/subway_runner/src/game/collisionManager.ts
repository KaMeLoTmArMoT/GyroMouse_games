import type { BoundingBox3D, Runner } from "./runner";
import type { TrackManager, TrackObstacle } from "./trackManager";

export class CollisionManager {
	public checkCollisions(
		runner: Runner,
		trackManager: TrackManager,
		onCoinCollected: () => void,
		onPowerUpCollected?: (type: "magnet" | "shield" | "jetpack") => void,
	): boolean {
		const rBox = runner.getBoundingBox();

		// Query candidates from Spatial Grid
		const candidates = trackManager.getCandidateObstacles(
			runner.currentLane,
			runner.posZ,
		);

		for (let i = 0; i < candidates.length; i++) {
			const obs = candidates[i];
			if (!obs.active) continue;

			// Distance check
			const distZ = Math.abs(obs.z - runner.posZ);
			if (distZ > 4.5) continue;

			if (obs.type === "ramp") {
				// Walkable ramp
				continue;
			}

			if (obs.type === "train") {
				// 1. Running on train roof or jumped above roof level
				if (runner.posY >= 2.5) {
					continue;
				}
				// 2. Climbing the attached front ramp onto the train (posZ entering train from front)
				if (runner.posZ <= obs.z - 3.5 && runner.posY >= 0.5) {
					continue;
				}
			}

			const oBox = this.getObstacleBoundingBox(obs);
			if (this.boxIntersect(rBox, oBox)) {
				if (obs.type === "coin") {
					obs.active = false;
					obs.mesh.visible = false;
					onCoinCollected();
				} else if (
					obs.type === "powerup_magnet" ||
					obs.type === "powerup_shield" ||
					obs.type === "powerup_jetpack"
				) {
					obs.active = false;
					obs.mesh.visible = false;
					const pType = obs.type.replace("powerup_", "") as
						| "magnet"
						| "shield"
						| "jetpack";
					runner.activatePowerUp(pType);
					if (onPowerUpCollected) onPowerUpCollected(pType);
				} else {
					// Shield Absorption
					if (runner.hasShield) {
						runner.hasShield = false;
						runner.triggerStumble(2.0);
						return false; // Shield saved the player!
					}

					// Check Stumble Grace System (7 seconds window)
					if (runner.stumbleTimer <= 0) {
						runner.triggerStumble(7.0);
						// Push runner back slightly on lateral impact
						return false; // Survived first stumble!
					}
					// Second hit during stumble -> GAME OVER!
					return true;
				}
			}
		}
		return false;
	}

	private getObstacleBoundingBox(obs: TrackObstacle): BoundingBox3D {
		const pos = obs.mesh.position;

		if (obs.type === "train") {
			return {
				minX: pos.x - 1.0,
				maxX: pos.x + 1.0,
				minY: 0,
				maxY: 3.2,
				minZ: pos.z - 4.0,
				maxZ: pos.z + 4.0,
			};
		} else if (obs.type === "low_hurdle") {
			// Must jump over (height 0 to 0.7)
			return {
				minX: pos.x - 1.0,
				maxX: pos.x + 1.0,
				minY: 0,
				maxY: 0.7,
				minZ: pos.z - 0.2,
				maxZ: pos.z + 0.2,
			};
		} else if (obs.type === "high_hurdle") {
			// Must crawl/slide under (space open below y=0.8)
			return {
				minX: pos.x - 1.0,
				maxX: pos.x + 1.0,
				minY: 0.8,
				maxY: 2.0,
				minZ: pos.z - 0.2,
				maxZ: pos.z + 0.2,
			};
		} else {
			// Coin
			return {
				minX: pos.x - 0.4,
				maxX: pos.x + 0.4,
				minY: pos.y - 0.4,
				maxY: pos.y + 0.4,
				minZ: pos.z - 0.4,
				maxZ: pos.z + 0.4,
			};
		}
	}

	private boxIntersect(a: BoundingBox3D, b: BoundingBox3D): boolean {
		return (
			a.minX <= b.maxX &&
			a.maxX >= b.minX &&
			a.minY <= b.maxY &&
			a.maxY >= b.minY &&
			a.minZ <= b.maxZ &&
			a.maxZ >= b.minZ
		);
	}
}
