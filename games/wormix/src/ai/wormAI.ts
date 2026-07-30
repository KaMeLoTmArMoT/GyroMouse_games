import { Worm } from '../entities/worm';
import { AIDifficulty, WeaponId } from '../types';

export interface AITurnPlan {
  targetAngle: number; // In degrees
  targetPower: number; // 0 to 1.0
  weaponId: WeaponId;
}

export class WormAI {
  public static calculateTurn(
    aiWorm: Worm,
    playerWorms: Worm[],
    difficulty: AIDifficulty,
    windX: number
  ): AITurnPlan {
    const aliveTargets = playerWorms.filter((w) => w.isAlive);
    if (aliveTargets.length === 0) {
      return { targetAngle: -45, targetPower: 0.5, weaponId: 'bazooka' };
    }

    // Pick closest target worm
    let target = aliveTargets[0];
    let minDist = Infinity;
    for (const w of aliveTargets) {
      const dist = Math.hypot(w.x - aiWorm.x, w.y - aiWorm.y);
      if (dist < minDist) {
        minDist = dist;
        target = w;
      }
    }

    const dx = target.x - aiWorm.x;
    const dy = target.y - aiWorm.y;
    const g = 0.45; // Gravity per frame

    // Standard 45 degree parabolic trajectory solver
    const targetDist = Math.abs(dx);
    let idealAngleDeg = dx >= 0 ? -45 : -135;

    // Launch speed calculation: v = sqrt( g * x^2 / (x * sin(2*theta) - 2*y*cos^2(theta)) )
    const rad = (idealAngleDeg * Math.PI) / 180;
    const cosTerm = Math.cos(rad);
    const sin2Term = Math.sin(2 * rad);
    const denom = targetDist * sin2Term - 2 * dy * cosTerm * cosTerm;

    let calcPower = 0.5;
    if (denom > 0) {
      const requiredSpeed = Math.sqrt((g * targetDist * targetDist) / denom);
      const maxSpeed = 22.0; // Max launch speed
      calcPower = Math.min(1.0, Math.max(0.1, requiredSpeed / maxSpeed));
    }

    // Apply difficulty dispersion
    let angleSpread = 0;
    let powerSpread = 0;

    if (difficulty === 'easy') {
      angleSpread = (Math.random() - 0.5) * 30; // +/- 15 deg
      powerSpread = (Math.random() - 0.5) * 0.4;
    } else if (difficulty === 'normal') {
      angleSpread = (Math.random() - 0.5) * 12; // +/- 6 deg
      powerSpread = (Math.random() - 0.5) * 0.15;
    } else {
      // Hard mode: compensate for wind
      idealAngleDeg -= windX * 2.5;
      angleSpread = (Math.random() - 0.5) * 3; // +/- 1.5 deg
      powerSpread = (Math.random() - 0.5) * 0.05;
    }

    const finalAngle = Math.max(-175, Math.min(-5, idealAngleDeg + angleSpread));
    const finalPower = Math.min(1.0, Math.max(0.15, calcPower + powerSpread));

    // AI Weapon Selection
    let weaponId: WeaponId = 'bazooka';
    if (minDist < 100) weaponId = 'shotgun';
    else if (difficulty === 'hard' && Math.random() > 0.6) weaponId = 'cluster';

    return {
      targetAngle: finalAngle,
      targetPower: finalPower,
      weaponId
    };
  }
}
