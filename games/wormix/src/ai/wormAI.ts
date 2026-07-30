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

    // Select target based on difficulty
    let target = aliveTargets[0];
    if (difficulty === 'easy') {
      // Pick random alive target
      target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
    } else {
      // Pick closest target worm
      let minDist = Infinity;
      for (const w of aliveTargets) {
        const dist = Math.hypot(w.x - aiWorm.x, w.y - aiWorm.y);
        if (dist < minDist) {
          minDist = dist;
          target = w;
        }
      }
    }

    const dx = target.x - aiWorm.x;
    const dy = target.y - aiWorm.y;
    const minDist = Math.hypot(dx, dy);
    const g = 0.45; // Gravity per frame

    // Parabolic trajectory solver
    const targetDist = Math.abs(dx);
    let idealAngleDeg = dx >= 0 ? -45 : -135;

    const rad = (idealAngleDeg * Math.PI) / 180;
    const cosTerm = Math.cos(rad);
    const sin2Term = Math.sin(2 * rad);
    const denom = targetDist * sin2Term - 2 * dy * cosTerm * cosTerm;

    let calcPower = 0.5;
    if (denom > 0) {
      const requiredSpeed = Math.sqrt((g * targetDist * targetDist) / denom);
      const maxSpeed = 22.0;
      calcPower = Math.min(1.0, Math.max(0.1, requiredSpeed / maxSpeed));
    }

    // Apply difficulty-specific dispersion & wind compensation
    let angleSpread = 0;
    let powerSpread = 0;

    if (difficulty === 'easy') {
      angleSpread = (Math.random() - 0.5) * 40; // +/- 20 deg
      powerSpread = (Math.random() - 0.5) * 0.35; // +/- 35% power
    } else if (difficulty === 'normal') {
      idealAngleDeg -= windX * 1.2; // Partial wind compensation
      angleSpread = (Math.random() - 0.5) * 12; // +/- 6 deg
      powerSpread = (Math.random() - 0.5) * 0.12;
    } else {
      // 🔥 Hard Mode (Devious AI): Full parabolic wind vector compensation & ultra precision
      idealAngleDeg -= windX * 2.8;
      angleSpread = (Math.random() - 0.5) * 2.5; // +/- 1.25 deg
      powerSpread = (Math.random() - 0.5) * 0.04;
    }

    const finalAngle = Math.max(-175, Math.min(-5, idealAngleDeg + angleSpread));
    const finalPower = Math.min(1.0, Math.max(0.15, calcPower + powerSpread));

    // Tactical AI Weapon Selection
    let weaponId: WeaponId = 'bazooka';
    if (difficulty === 'easy') {
      weaponId = minDist < 90 ? 'shotgun' : 'bazooka';
    } else if (difficulty === 'normal') {
      if (minDist < 100) weaponId = 'shotgun';
      else if (Math.random() > 0.6) weaponId = 'cluster';
      else if (Math.random() > 0.4) weaponId = 'grenade';
    } else {
      // Hard AI smart weapon pick
      const groupedTargets = aliveTargets.filter((w) => w !== target && Math.hypot(w.x - target.x, w.y - target.y) < 120);
      if (minDist < 110) {
        weaponId = 'shotgun';
      } else if (groupedTargets.length > 0) {
        weaponId = 'cluster'; // Multi-target blast
      } else if (dy > 40 && Math.random() > 0.5) {
        weaponId = 'acid_bomb'; // Melt terrain overhead
      } else if (Math.random() > 0.4) {
        weaponId = 'grenade';
      } else {
        weaponId = 'bazooka';
      }
    }

    return {
      targetAngle: finalAngle,
      targetPower: finalPower,
      weaponId
    };
  }
}
