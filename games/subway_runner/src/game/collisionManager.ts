import { Runner, BoundingBox3D } from './runner';
import { TrackManager, TrackObstacle } from './trackManager';

export class CollisionManager {
  public checkCollisions(runner: Runner, trackManager: TrackManager, onCoinCollected: () => void): boolean {
    const rBox = runner.getBoundingBox();

    for (const obs of trackManager.obstacles) {
      if (!obs.active) continue;

      // Check Z distance proximity first
      if (Math.abs(obs.z - runner.posZ) > 4.0) continue;

      const oBox = this.getObstacleBoundingBox(obs);
      if (this.boxIntersect(rBox, oBox)) {
        if (obs.type === 'coin') {
          obs.active = false;
          obs.mesh.visible = false;
          onCoinCollected();
        } else {
          // Crash collision!
          return true;
        }
      }
    }
    return false;
  }

  private getObstacleBoundingBox(obs: TrackObstacle): BoundingBox3D {
    const pos = obs.mesh.position;

    if (obs.type === 'train') {
      return {
        minX: pos.x - 1.0, maxX: pos.x + 1.0,
        minY: 0, maxY: 3.2,
        minZ: pos.z - 4.0, maxZ: pos.z + 4.0
      };
    } else if (obs.type === 'low_hurdle') {
      // Must jump over (height 0 to 0.7)
      return {
        minX: pos.x - 1.0, maxX: pos.x + 1.0,
        minY: 0, maxY: 0.7,
        minZ: pos.z - 0.2, maxZ: pos.z + 0.2
      };
    } else if (obs.type === 'high_hurdle') {
      // Must crawl/slide under (space open below y=0.8)
      return {
        minX: pos.x - 1.0, maxX: pos.x + 1.0,
        minY: 0.8, maxY: 2.0,
        minZ: pos.z - 0.2, maxZ: pos.z + 0.2
      };
    } else {
      // Coin
      return {
        minX: pos.x - 0.4, maxX: pos.x + 0.4,
        minY: pos.y - 0.4, maxY: pos.y + 0.4,
        minZ: pos.z - 0.4, maxZ: pos.z + 0.4
      };
    }
  }

  private boxIntersect(a: BoundingBox3D, b: BoundingBox3D): boolean {
    return (
      a.minX <= b.maxX && a.maxX >= b.minX &&
      a.minY <= b.maxY && a.maxY >= b.minY &&
      a.minZ <= b.maxZ && a.maxZ >= b.minZ
    );
  }
}
