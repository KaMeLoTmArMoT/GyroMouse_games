// Visual effects state management (lasers, explosions, shield impacts, engine particles)

import type { ShipState, Vector2 } from "../types/combat";

// Nozzle centers in hull-local coordinates, matching the ship detail artwork.
export function engineNozzles(ship: ShipState): Vector2[] {
  const blue = ship.team === 0;
  switch (ship.hullClass) {
    case "strike_craft":
      return blue
        ? [
            [-0.59, -0.32],
            [-0.59, 0.32],
          ]
        : [
            [-0.43, -0.27],
            [-0.43, 0.27],
          ];
    case "corvette":
      return blue
        ? [
            [-0.65, -0.32],
            [-0.65, 0.32],
          ]
        : [
            [-0.51, -0.3],
            [-0.51, 0.3],
          ];
    case "cruiser":
      return blue
        ? [
            [-0.98, -0.2],
            [-0.98, 0],
            [-0.98, 0.2],
          ]
        : [
            [-0.85, -0.24],
            [-0.85, 0],
            [-0.85, 0.24],
          ];
    case "battleship":
      return blue
        ? [
            [-1.13, -0.27],
            [-1.13, -0.09],
            [-1.13, 0.09],
            [-1.13, 0.27],
          ]
        : [
            [-0.69, -0.42],
            [-0.45, -0.24],
            [-0.45, 0.24],
            [-0.69, 0.42],
          ];
  }
}

export function engineSpeed(ship: ShipState): number {
  return ship.maxSpeed > 0 ? Math.min(1, Math.hypot(...ship.velocity) / ship.maxSpeed) : 0;
}

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

export interface DebrisShard {
  pos: Vector2;
  velocity: Vector2;
  angle: number;
  rotationSpeed: number;
  points: [number, number][];
  color: string;
  accentColor: string;
  size: number;
  remainingDuration: number;
  maxDuration: number;
}

interface ShipExplosionEffect {
  pos: Vector2;
  maxRadius: number;
  delay: number;
  remainingDuration: number;
  maxDuration: number;
}

export class VisualEffectsManager {
  beams: LaserBeamEffect[] = [];
  shieldImpacts: ShieldImpactEffect[] = [];
  particles: ParticleEffect[] = [];
  engineParticles: ParticleEffect[] = [];
  flakBursts: FlakBurstEffect[] = [];
  debrisShards: DebrisShard[] = [];
  shipExplosionCores: ShipExplosionEffect[] = [];
  shipShockwaves: ShipExplosionEffect[] = [];

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

  addShipExplosion(ship: ShipState): void {
    const profiles = {
      strike_craft: { particles: 10, shards: 2, duration: 0.4, cores: 1 },
      corvette: { particles: 25, shards: 6, duration: 0.7, cores: 1 },
      cruiser: { particles: 60, shards: 14, duration: 1.4, cores: 3 },
      battleship: { particles: 80, shards: 30, duration: 1.8, cores: 3 },
    };
    const profile = profiles[ship.hullClass];
    const capital = profile.cores > 1;

    this.shipShockwaves.push({
      pos: [...ship.pos],
      maxRadius: ship.size * 2.5,
      delay: 0,
      remainingDuration: profile.duration,
      maxDuration: profile.duration,
    });

    for (let i = 0; i < profile.cores; i++) {
      const offset = i === 0 ? 0 : (i === 1 ? -0.55 : 0.55) * ship.size;
      const duration = profile.duration * (i === 0 ? 0.75 : 0.65);
      this.shipExplosionCores.push({
        pos: [
          ship.pos[0] + Math.cos(ship.heading) * offset,
          ship.pos[1] + Math.sin(ship.heading) * offset,
        ],
        maxRadius: ship.size * (i === 0 ? 1.1 : 0.8),
        delay: i * 0.18,
        remainingDuration: duration,
        maxDuration: duration,
      });
    }

    for (let i = 0; i < profile.particles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const smoke = capital && i % 3 === 0;
      const speed = (smoke ? 15 : 45) + Math.random() * (smoke ? 35 : 100 + ship.size);
      const lifetime = profile.duration * (0.65 + Math.random() * 0.35);
      this.particles.push({
        pos: [...ship.pos],
        velocity: [
          ship.velocity[0] * 0.25 + Math.cos(angle) * speed,
          ship.velocity[1] * 0.25 + Math.sin(angle) * speed,
        ],
        color: smoke ? (i % 2 === 0 ? "#4a302b" : "#9a3412") : i % 2 === 0 ? "#fb923c" : "#facc15",
        radius: smoke
          ? ship.size * (0.1 + Math.random() * 0.12)
          : 1 + Math.random() * (capital ? 3 : 2),
        remainingDuration: lifetime,
        maxDuration: lifetime,
      });
    }

    const overflow = this.debrisShards.length + profile.shards - 200;
    if (overflow > 0) this.debrisShards.splice(0, overflow);
    for (let i = 0; i < profile.shards; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 25 + Math.random() * (55 + ship.size);
      const lifetime = 1.5 + Math.random() * 2;
      const points: [number, number][] = [
        [-0.9, -0.35 - Math.random() * 0.35],
        [0.35 + Math.random() * 0.65, -0.65],
        [0.8, 0.2 + Math.random() * 0.5],
      ];
      if (i % 2 === 0) points.push([-0.35, 0.5 + Math.random() * 0.5]);
      this.debrisShards.push({
        pos: [...ship.pos],
        velocity: [
          ship.velocity[0] * 0.3 + Math.cos(angle) * speed,
          ship.velocity[1] * 0.3 + Math.sin(angle) * speed,
        ],
        angle: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2.5,
        points,
        color: ship.team === 0 ? "#334155" : "#481c29",
        accentColor: ship.team === 0 ? "#67b9cf" : "#be4053",
        size: Math.max(1.2, ship.size * (0.08 + Math.random() * 0.1)),
        remainingDuration: lifetime,
        maxDuration: lifetime,
      });
    }
  }

  update(dt: number, ships: ShipState[] = []): void {
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

    const updateExplosion = (effect: ShipExplosionEffect) => {
      const activeDt = Math.max(0, dt - effect.delay);
      effect.delay = Math.max(0, effect.delay - dt);
      effect.remainingDuration -= activeDt;
      return effect.remainingDuration > 0;
    };
    this.shipExplosionCores = this.shipExplosionCores.filter(updateExplosion);
    this.shipShockwaves = this.shipShockwaves.filter(updateExplosion);

    const debrisDamping = 0.98 ** (dt * 60);
    this.debrisShards = this.debrisShards.filter((shard) => {
      shard.remainingDuration -= dt;
      shard.pos[0] += shard.velocity[0] * dt;
      shard.pos[1] += shard.velocity[1] * dt;
      shard.angle += shard.rotationSpeed * dt;
      shard.velocity[0] *= debrisDamping;
      shard.velocity[1] *= debrisDamping;
      return shard.remainingDuration > 0;
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

    this.engineParticles = this.engineParticles.filter((p) => {
      p.remainingDuration -= dt;
      p.pos[0] += p.velocity[0] * dt;
      p.pos[1] += p.velocity[1] * dt;
      return p.remainingDuration > 0;
    });

    for (const ship of ships) {
      const speed = engineSpeed(ship);
      if (!ship.isAlive || speed < 0.05) continue;
      const cos = Math.cos(ship.heading);
      const sin = Math.sin(ship.heading);
      for (const [x, y] of engineNozzles(ship)) {
        if (this.engineParticles.length >= 600) return;
        if (Math.random() >= Math.min(1, dt * (8 + 20 * speed))) continue;
        const lifetime = 0.25 + Math.random() * 0.15;
        const exhaustSpeed = 15 + speed * 35;
        this.engineParticles.push({
          pos: [
            ship.pos[0] + (x * cos - y * sin) * ship.size,
            ship.pos[1] + (x * sin + y * cos) * ship.size,
          ],
          velocity: [ship.velocity[0] - cos * exhaustSpeed, ship.velocity[1] - sin * exhaustSpeed],
          color: ship.team === 0 ? "#38bdf8" : "#f97316",
          radius: Math.max(1, ship.size * 0.045) * (0.7 + speed * 0.3),
          remainingDuration: lifetime,
          maxDuration: lifetime,
        });
      }
    }
  }
}
