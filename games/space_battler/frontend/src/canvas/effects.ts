// Visual effects state management (lasers, explosions, shield impacts, engine particles)

import type { ActiveBeam } from "../engine/simulation";
import type { ProjectileState, ShipState, Vector2 } from "../types/combat";

// Nozzle centers in hull-local coordinates, matching the ship detail artwork.
export function engineNozzles(ship: ShipState): Vector2[] {
  const blue = ship.team === 0;
  switch (ship.hullClass) {
    case "dreadnought":
      return [
        [-1.05, -0.3],
        [-1.05, -0.1],
        [-1.05, 0.1],
        [-1.05, 0.3],
      ];
    case "missile_frigate":
      return [
        [-0.82, -0.25],
        [-0.82, 0.25],
      ];
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

export function hasFighterHazard(ship: ShipState): boolean {
  return (
    ship.isAlive &&
    ship.hullClass === "strike_craft" &&
    (ship.fighterPhase === "recover" || (ship.hullMax > 0 && ship.hullCurrent < ship.hullMax * 0.4))
  );
}

export function damageState(ship: ShipState): {
  scarred: boolean;
  burning: boolean;
  critical: boolean;
} {
  const critical = ship.hullMax > 0 && ship.hullCurrent < ship.hullMax * 0.3;
  return {
    scarred: ship.armorMax > 0 && ship.armorCurrent < ship.armorMax * 0.5,
    burning: ship.armorCurrent <= 0 && ship.hullCurrent < ship.hullMax * 0.7,
    critical,
  };
}

export interface LaserBeamEffect {
  id: string;
  from: Vector2;
  to: Vector2;
  color: string;
  width: number;
  ownerTeam: number;
  remainingDuration: number;
  maxDuration: number;
  active?: boolean;
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

export interface WarpGateEffect {
  id: string;
  pos: Vector2;
  heading: number;
  radius: number;
  team: number;
  remainingDuration: number;
  maxDuration: number;
  shipId?: string;
}

export interface FlakBurstEffect {
  pos: Vector2;
  ownerTeam: number;
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
  warpGates: WarpGateEffect[] = [];
  beams: LaserBeamEffect[] = [];
  shieldImpacts: ShieldImpactEffect[] = [];
  particles: ParticleEffect[] = [];
  engineParticles: ParticleEffect[] = [];
  smokeParticles: ParticleEffect[] = [];
  sparkParticles: ParticleEffect[] = [];
  flakBursts: FlakBurstEffect[] = [];
  debrisShards: DebrisShard[] = [];
  shipExplosionCores: ShipExplosionEffect[] = [];
  shipShockwaves: ShipExplosionEffect[] = [];
  impactDecals = new WeakMap<ShipState, Vector2[]>();

  addWarpGate(pos: Vector2, heading: number, radius: number, team: number): void {
    this.warpGates.push({
      id: Math.random().toString(36).substring(2, 9),
      pos: [...pos],
      heading,
      radius,
      team,
      remainingDuration: 0.8,
      maxDuration: 0.8,
    });
  }

  triggerFleetWarpIn(ships: ShipState[]): void {
    this.warpGates = [];
    for (const ship of ships) {
      if (!ship.isAlive) continue;
      this.addWarpGate(ship.pos, ship.heading, ship.size * 1.5, ship.team);
      this.warpGates[this.warpGates.length - 1].shipId = ship.id;
    }
  }

  updateWarpGates(dt: number): void {
    this.warpGates = this.warpGates.filter((gate) => {
      const elapsed = gate.maxDuration - gate.remainingDuration;
      gate.remainingDuration -= dt;
      if (elapsed < 0.5 && elapsed + dt >= 0.5) {
        for (let i = 0; i < 5 && this.sparkParticles.length < 400; i++) {
          const angle = gate.heading + (i - 2) * 0.16;
          const speed = 140 + i * 15;
          this.sparkParticles.push({
            pos: [...gate.pos],
            velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
            color: gate.team === 0 ? "#00f0ff" : "#c084fc",
            radius: 1,
            remainingDuration: 0.25,
            maxDuration: 0.25,
          });
        }
      }
      return gate.remainingDuration > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const gate of this.warpGates) {
      const elapsed = gate.maxDuration - gate.remainingDuration;
      const opening = Math.min(1, elapsed / 0.2);
      const closing = Math.min(1, gate.remainingDuration / 0.3);
      const scale = opening * closing;
      if (scale <= 0) continue;
      const primary = gate.team === 0 ? "#00f0ff" : "#c084fc";
      const secondary = gate.team === 0 ? "#38bdf8" : "#f43f5e";
      ctx.save();
      ctx.translate(gate.pos[0], gate.pos[1]);
      ctx.rotate(gate.heading);
      ctx.globalAlpha = Math.min(1, opening * 2) * closing;
      ctx.shadowColor = primary;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = primary;
      ctx.lineWidth = Math.max(1.5, gate.radius * 0.045);
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        gate.radius * (0.05 + 0.28 * scale),
        gate.radius * scale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = secondary;
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        gate.radius * (0.1 + 0.38 * scale),
        gate.radius * scale * 1.12,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      if (elapsed >= 0.2 && elapsed < 0.5) {
        ctx.globalAlpha *= 0.65 + 0.35 * Math.sin(elapsed * 42);
        ctx.beginPath();
        for (const side of [-1, 1]) {
          ctx.moveTo(-gate.radius * 0.18, side * gate.radius * 0.7);
          ctx.lineTo(gate.radius * 0.18, side * gate.radius * 1.1);
        }
        ctx.stroke();
      }
      if (elapsed >= 0.5) {
        ctx.globalAlpha = (1 - closing) * closing * 3;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          gate.radius * 0.16 * closing,
          gate.radius * 0.55 * closing,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  addBeam(
    from: Vector2,
    to: Vector2,
    color: string,
    width: number,
    ownerTeam: number,
    duration = 0.12,
  ): void {
    if (this.beams.length >= 300) this.beams.shift();
    this.beams.push({
      id: Math.random().toString(36).substring(2, 9),
      from: [...from],
      to: [...to],
      color,
      width,
      ownerTeam,
      remainingDuration: duration,
      maxDuration: duration,
    });
  }

  syncBeams(beams: ActiveBeam[]): void {
    for (const effect of this.beams) effect.active = false;
    for (const beam of beams) {
      let effect = this.beams.find((entry) => entry.id === beam.id);
      if (!effect) {
        if (this.beams.length >= 300) this.beams.shift();
        effect = {
          id: beam.id,
          from: beam.from,
          to: beam.to,
          color: beam.ownerTeam === 0 ? "#38bdf8" : "#ef4444",
          width: 2.8,
          ownerTeam: beam.ownerTeam,
          remainingDuration: 0.16,
          maxDuration: 0.16,
        };
        this.beams.push(effect);
      }
      effect.from = [...beam.from];
      effect.to = [...beam.to];
      effect.remainingDuration = effect.maxDuration;
      effect.active = true;
    }
  }

  addShieldImpact(shipId: string, pos: Vector2, shipRadius: number, impactAngle: number): void {
    if (this.shieldImpacts.length >= 200) this.shieldImpacts.shift();
    this.shieldImpacts.push({
      id: Math.random().toString(36).substring(2, 9),
      shipId,
      pos: [...pos],
      shipRadius,
      impactAngle,
      remainingDuration: 0.35,
    });
  }

  addImpactSparks(pos: Vector2, impactAngle: number): void {
    const count = 16 + Math.floor(Math.random() * 9);
    for (let i = 0; i < count && this.sparkParticles.length < 400; i++) {
      const angle = impactAngle + (Math.random() - 0.5) * Math.PI;
      const speed = 55 + Math.random() * 120;
      const lifetime = 0.15 + Math.random() * 0.2;
      this.sparkParticles.push({
        pos: [...pos],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        color: i % 2 === 0 ? "#fff7c2" : "#fb923c",
        radius: 1,
        remainingDuration: lifetime,
        maxDuration: lifetime,
      });
    }
    this.addParticle({
      pos: [...pos],
      velocity: [0, 0],
      color: "#fbbf24",
      radius: 5,
      remainingDuration: 0.18,
      maxDuration: 0.18,
    });
  }

  addDamageDecal(ship: ShipState, impactAngle: number): void {
    const angle = impactAngle - ship.heading;
    const decals = this.impactDecals.get(ship) ?? [];
    if (decals.length >= 12) decals.shift();
    decals.push([Math.cos(angle) * ship.size * 0.45, Math.sin(angle) * ship.size * 0.22]);
    this.impactDecals.set(ship, decals);
  }

  addHullImpact(pos: Vector2, impactAngle: number): void {
    this.addExplosion(pos, 18, "#ef4420");
    for (let i = 0; i < 5 && this.smokeParticles.length < 400; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 35;
      const lifetime = 0.7 + Math.random() * 0.5;
      this.smokeParticles.push({
        pos: [...pos],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        color: "#202127",
        radius: 3 + Math.random() * 4,
        remainingDuration: lifetime,
        maxDuration: lifetime,
      });
    }
    for (let i = 0; i < 5 && this.debrisShards.length < 200; i++) {
      const angle = impactAngle + (Math.random() - 0.5) * Math.PI * 2;
      const speed = 40 + Math.random() * 100;
      const lifetime = 0.8 + Math.random() * 0.7;
      this.debrisShards.push({
        pos: [...pos],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        angle,
        rotationSpeed: (Math.random() - 0.5) * 6,
        points: [
          [-1, -0.4],
          [0.8, -0.6],
          [1, 0.4],
          [-0.5, 0.6],
        ],
        color: "#475569",
        accentColor: "#fb923c",
        size: 2 + Math.random() * 3,
        remainingDuration: lifetime,
        maxDuration: lifetime,
      });
    }
  }

  private addParticle(particle: ParticleEffect): void {
    if (this.particles.length < 1200) this.particles.push(particle);
  }

  addFlakBurst(pos: Vector2, maxRadius: number, ownerTeam: number): void {
    if (this.flakBursts.length >= 200) this.flakBursts.shift();
    this.flakBursts.push({
      pos: [...pos],
      ownerTeam,
      radius: 4,
      maxRadius,
      remainingDuration: 0.35,
      maxDuration: 0.35,
    });

    const shrapnelCount = 12;
    for (let i = 0; i < shrapnelCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 170;
      this.addParticle({
        pos: [pos[0], pos[1]],
        velocity: [Math.cos(angle) * speed, Math.sin(angle) * speed],
        color:
          ownerTeam === 0
            ? Math.random() > 0.45
              ? "#fb923c"
              : "#facc15"
            : Math.random() > 0.45
              ? "#ef4444"
              : "#f472b6",
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
      this.addParticle({
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
      missile_frigate: { particles: 35, shards: 8, duration: 0.9, cores: 2 },
      cruiser: { particles: 60, shards: 14, duration: 1.4, cores: 3 },
      battleship: { particles: 80, shards: 30, duration: 1.8, cores: 3 },
      dreadnought: { particles: 110, shards: 45, duration: 2.2, cores: 4 },
    };
    const profile = profiles[ship.hullClass] ?? profiles.cruiser;
    const capital = profile.cores > 1;

    if (this.shipShockwaves.length >= 100) this.shipShockwaves.shift();
    this.shipShockwaves.push({
      pos: [...ship.pos],
      maxRadius: ship.size * 2.5,
      delay: 0,
      remainingDuration: profile.duration,
      maxDuration: profile.duration,
    });

    for (let i = 0; i < profile.cores; i++) {
      if (this.shipExplosionCores.length >= 300) this.shipExplosionCores.shift();
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
      this.addParticle({
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

  update(dt: number, ships: ShipState[] = [], projectiles: ProjectileState[] = []): void {
    // Beams decay
    this.beams = this.beams.filter((b) => {
      if (!b.active) b.remainingDuration -= dt;
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

    this.smokeParticles = this.smokeParticles.filter((p) => {
      p.remainingDuration -= dt;
      p.pos[0] += p.velocity[0] * dt;
      p.pos[1] += p.velocity[1] * dt;
      p.radius += dt * 3;
      return p.remainingDuration > 0;
    });

    this.sparkParticles = this.sparkParticles.filter((p) => {
      p.remainingDuration -= dt;
      p.pos[0] += p.velocity[0] * dt;
      p.pos[1] += p.velocity[1] * dt;
      const damping = 0.95 ** (dt * 60);
      p.velocity[0] *= damping;
      p.velocity[1] *= damping;
      return p.remainingDuration > 0;
    });

    for (const projectile of projectiles) {
      if (projectile.weaponType === "missile" && projectile.hp < projectile.maxHp) {
        const speed = Math.hypot(...projectile.velocity);
        const dx = speed > 0 ? projectile.velocity[0] / speed : 0;
        const dy = speed > 0 ? projectile.velocity[1] / speed : 0;
        const damage = Math.min(1, 1 - projectile.hp / projectile.maxHp);
        const pos: Vector2 = [projectile.pos[0] - dx * 5, projectile.pos[1] - dy * 5];
        if (
          this.smokeParticles.length < 400 &&
          Math.random() < Math.min(1, dt * (4 + damage * 12))
        ) {
          const lifetime = 0.4 + Math.random() * 0.3;
          this.smokeParticles.push({
            pos: [...pos],
            velocity: [-dx * 12, -dy * 12],
            color: "#353035",
            radius: 1.5,
            remainingDuration: lifetime,
            maxDuration: lifetime,
          });
        }
        if (
          this.sparkParticles.length < 400 &&
          Math.random() < Math.min(1, dt * (2 + damage * 8))
        ) {
          const lifetime = 0.15 + Math.random() * 0.15;
          this.sparkParticles.push({
            pos: [...pos],
            velocity: [
              -dx * 25 + (Math.random() - 0.5) * 20,
              -dy * 25 + (Math.random() - 0.5) * 20,
            ],
            color: "#fb923c",
            radius: 1,
            remainingDuration: lifetime,
            maxDuration: lifetime,
          });
        }
      }
      if (projectile.weaponType !== "missile" || Math.random() >= Math.min(1, dt * 24)) continue;
      const speed = Math.hypot(...projectile.velocity);
      if (speed === 0) continue;
      const dx = projectile.velocity[0] / speed;
      const dy = projectile.velocity[1] / speed;
      const blue = projectile.ownerTeam === 0;
      const lifetime = 0.3 + Math.random() * 0.25;
      const particle: ParticleEffect = {
        pos: [projectile.pos[0] - dx * 10, projectile.pos[1] - dy * 10],
        velocity: [-dx * 18 + (Math.random() - 0.5) * 12, -dy * 18 + (Math.random() - 0.5) * 12],
        color: blue
          ? Math.random() < 0.5
            ? "#e2e8f0"
            : "#94a3b8"
          : Math.random() < 0.5
            ? "#a855f7"
            : "#dc2626",
        radius: blue ? 2.5 : 1.5,
        remainingDuration: lifetime,
        maxDuration: lifetime,
      };
      if (blue) {
        if (this.smokeParticles.length < 400) this.smokeParticles.push(particle);
      } else {
        this.addParticle(particle);
      }
    }

    for (const ship of ships) {
      if (!ship.isAlive) continue;
      const { scarred, burning, critical } = damageState(ship);
      const cos = Math.cos(ship.heading);
      const sin = Math.sin(ship.heading);
      if ((scarred || burning || critical) && this.smokeParticles.length < 400) {
        if (Math.random() < Math.min(1, dt * (critical ? 16 : 4))) {
          const localX = (Math.random() * 0.6 - 0.3) * ship.size;
          const localY = (Math.random() * 0.4 - 0.2) * ship.size;
          const lifetime = 0.8 + Math.random() * 0.6;
          this.smokeParticles.push({
            pos: [
              ship.pos[0] + localX * cos - localY * sin,
              ship.pos[1] + localX * sin + localY * cos,
            ],
            velocity: [ship.velocity[0] - cos * 18, ship.velocity[1] - sin * 18],
            color: critical ? "#08090c" : "#64656a",
            radius: Math.max(2, ship.size * (critical ? 0.2 : 0.07)),
            remainingDuration: lifetime,
            maxDuration: lifetime,
          });
        }
      }
      if ((scarred || critical) && Math.random() < Math.min(1, dt * (critical ? 5 : 0.8))) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const pos: Vector2 = [
          ship.pos[0] + (0.25 * cos - side * 0.2 * sin) * ship.size,
          ship.pos[1] + (0.25 * sin + side * 0.2 * cos) * ship.size,
        ];
        this.addImpactSparks(pos, ship.heading + side * Math.PI * 0.5);
      }
      const speed = engineSpeed(ship);
      if (speed < 0.05) continue;
      for (const [x, y] of engineNozzles(ship)) {
        if (this.engineParticles.length >= 600) break;
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
