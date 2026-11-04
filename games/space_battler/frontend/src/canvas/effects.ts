// Visual effects state management (lasers, explosions, shield impacts, engine particles)

import type { Vector2 } from "../types/combat";

export interface LaserBeamEffect {
  id: string;
  from: Vector2;
  to: Vector2;
  color: string;
  width: number;
  remainingDuration: number;
  maxDuration: number;
}

export interface ShieldImpactEffect {
  id: string;
  shipId: string;
  pos: Vector2;
  shipRadius: number;
  impactAngle: number;
  remainingDuration: number;
}

export interface ParticleEffect {
  pos: Vector2;
  velocity: Vector2;
  color: string;
  radius: number;
  remainingDuration: number;
  maxDuration: number;
}

export interface FlakBurstEffect {
  pos: Vector2;
  radius: number;
  maxRadius: number;
  remainingDuration: number;
  maxDuration: number;
}

export class VisualEffectsManager {
  beams: LaserBeamEffect[] = [];
  shieldImpacts: ShieldImpactEffect[] = [];
  particles: ParticleEffect[] = [];
  flakBursts: FlakBurstEffect[] = [];

  addBeam(from: Vector2, to: Vector2, color = "#38bdf8", width = 2.5, duration = 0.12): void {
    this.beams.push({
      id: Math.random().toString(36).substring(2, 9),
      from: [...from],
      to: [...to],
      color,
      width,
      remainingDuration: duration,
      maxDuration: duration,
    });
  }

  addShieldImpact(shipId: string, pos: Vector2, shipRadius: number, impactAngle: number): void {
    this.shieldImpacts.push({
      id: Math.random().toString(36).substring(2, 9),
      shipId,
      pos: [...pos],
      shipRadius,
      impactAngle,
      remainingDuration: 0.25,
    });
  }

  addFlakBurst(pos: Vector2, maxRadius = 60): void {
    this.flakBursts.push({
      pos: [...pos],
      radius: 4,
      maxRadius,
      remainingDuration: 0.35,
      maxDuration: 0.35,
    });

    const shrapnelCount = 12;
    for (let i = 0; i < shrapnelCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 170;
      this.particles.push({
        pos: [pos[0], pos[1]],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        color: Math.random() > 0.45 ? "#fb923c" : "#facc15",
        radius: 1.2 + Math.random() * 2.0,
        remainingDuration: 0.25 + Math.random() * 0.3,
        maxDuration: 0.55,
      });
    }
  }

  addExplosion(pos: Vector2, count = 18, color = "#f97316"): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.particles.push({
        pos: [pos[0], pos[1]],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        color: Math.random() > 0.4 ? color : "#facc15",
        radius: 1.5 + Math.random() * 2.5,
        remainingDuration: 0.3 + Math.random() * 0.4,
        maxDuration: 0.7,
      });
    }
  }

  update(dt: number): void {
    // Beams decay
    this.beams = this.beams.filter((b) => {
      b.remainingDuration -= dt;
      return b.remainingDuration > 0;
    });

    // Shield impacts decay
    this.shieldImpacts = this.shieldImpacts.filter((s) => {
      s.remainingDuration -= dt;
      return s.remainingDuration > 0;
    });

    // Flak bursts expand outward & decay
    this.flakBursts = this.flakBursts.filter((f) => {
      f.remainingDuration -= dt;
      const progress = 1 - Math.max(0, f.remainingDuration) / f.maxDuration;
      f.radius = 4 + (f.maxRadius - 4) * progress;
      return f.remainingDuration > 0;
    });

    // Particles update & decay
    this.particles = this.particles.filter((p) => {
      p.remainingDuration -= dt;
      p.pos[0] += p.velocity[0] * dt;
      p.pos[1] += p.velocity[1] * dt;
      p.velocity[0] *= 0.95;
      p.velocity[1] *= 0.95;
      return p.remainingDuration > 0;
    });
  }
}
