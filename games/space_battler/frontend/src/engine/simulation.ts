// Deterministic client combat simulation runner with point defense ship bombardment, cruiser forward torpedo tracking, and shield bounce physics

import type {
  GroupOrder,
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";
import {
  clamp,
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDistanceSq,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";

export type BeamFireCallback = (from: Vector2, to: Vector2, color: string, width: number) => void;

export class ClientCombatSimulation {
  ships: ShipState[] = [];
  projectiles: ProjectileState[] = [];
  orders: Map<number, GroupOrder> = new Map();
  timeElapsed = 0;
  private projectileCounter = 0;
  onBeamFire: BeamFireCallback | null = null;

  addShip(ship: ShipState): void {
    this.ships.push(ship);
  }

  setGroupOrder(order: GroupOrder): void {
    this.orders.set(order.groupId, order);
  }

  update(dt: number): void {
    this.timeElapsed += dt;

    // 1. Defenses & Shield Regeneration
    for (const ship of this.ships) {
      if (!ship.isAlive) continue;
      if (ship.shieldDelayTimer > 0) {
        ship.shieldDelayTimer = Math.max(0, ship.shieldDelayTimer - dt);
      } else if (ship.shieldCurrent < ship.shieldMax) {
        ship.shieldCurrent = Math.min(ship.shieldMax, ship.shieldCurrent + ship.shieldRegen * dt);
      }
    }

    // 2. Tactical Movement & Targeting AI
    const aliveShips = this.ships.filter((s) => s.isAlive);
    for (const ship of aliveShips) {
      const order = this.orders.get(ship.groupId) ?? {
        groupId: ship.groupId,
        priority: "nearest",
        stance: "optimal_range",
      };
      const target = this.findTargetForShip(ship, order, aliveShips);
      this.updateShipMovement(ship, target, aliveShips, dt);

      // Turrets aim & fire
      for (const turret of ship.turrets) {
        let turretTarget = target;

        // Spinal guns and torpedoes ignore strike crafts if capitals exist
        if (turret.isSpinalGimbal || turret.weapon.range > 800) {
          const capitalEnemies = aliveShips.filter(
            (e) =>
              e.team !== ship.team && (e.hullClass === "cruiser" || e.hullClass === "battleship"),
          );
          if (capitalEnemies.length > 0) {
            turretTarget = capitalEnemies.reduce((prev, curr) =>
              vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
            );
          } else {
            turretTarget = target;
          }
        }

        let targetPos = turretTarget ? turretTarget.pos : null;

        // POINT DEFENSE (CORVETTES):
        // 1. Prioritize hostile incoming missiles in range
        // 2. If NO missiles exist, prioritize enemy strike crafts / nearest ships!
        // (Aegis Corvettes NEVER sit idle, they hose down enemy ships with flak!)
        if (turret.weapon.weaponType === "point_defense") {
          const missile = this.findMissileTarget(ship, turret.weapon.range);
          if (missile) {
            targetPos = missile.pos;
          } else {
            // Find nearest enemy in 360-degree range
            const enemiesInRange = aliveShips.filter(
              (e) => e.team !== ship.team && vecDistance(ship.pos, e.pos) <= turret.weapon.range,
            );
            if (enemiesInRange.length > 0) {
              const nearestEnemy = enemiesInRange.reduce((prev, curr) =>
                vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
              );
              targetPos = nearestEnemy.pos;
              turretTarget = nearestEnemy;
            }
          }
        }

        const isAimed = this.updateTurretAim(turret, dt, ship, targetPos);
        if (isAimed && turret.cooldownTimer <= 0 && targetPos) {
          this.fireWeapon(ship, turret, targetPos, turretTarget);
        }
      }
    }

    // 3. Resolve Shield-to-Shield Physical Repulsion (Zero shield clipping between capitals!)
    this.resolveShipCollisions(aliveShips, dt);

    // 4. Projectiles & Collision Resolution
    this.updateProjectiles(dt, aliveShips);
  }

  private findTargetForShip(
    ship: ShipState,
    order: GroupOrder,
    aliveShips: ShipState[],
  ): ShipState | null {
    let enemies = aliveShips.filter((s) => s.team !== ship.team);
    if (enemies.length === 0) return null;

    if (ship.hullClass === "battleship" || order.priority === "capitals") {
      const capitals = enemies.filter(
        (s) => s.hullClass === "cruiser" || s.hullClass === "battleship",
      );
      if (capitals.length > 0) enemies = capitals;
    } else if (order.priority === "strike_craft") {
      const crafts = enemies.filter(
        (s) => s.hullClass === "strike_craft" || s.hullClass === "corvette",
      );
      if (crafts.length > 0) enemies = crafts;
    }

    return enemies.reduce((prev, curr) =>
      vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
    );
  }

  private findMissileTarget(ship: ShipState, maxRange: number): ProjectileState | null {
    const hostileMissiles = this.projectiles.filter(
      (p) =>
        p.ownerTeam !== ship.team &&
        p.weaponType === "missile" &&
        vecDistance(ship.pos, p.pos) <= maxRange,
    );
    if (hostileMissiles.length === 0) return null;

    return hostileMissiles.reduce((prev, curr) =>
      vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
    );
  }

  private updateShipMovement(
    ship: ShipState,
    target: ShipState | null,
    aliveShips: ShipState[],
    dt: number,
  ): void {
    let targetHeading = ship.heading;
    let desiredSpeed = 0;

    // 1. Independent Escorts (Corvettes with or without flagship)
    if (ship.flagshipId && aliveShips.some((s) => s.id === ship.flagshipId)) {
      const flagship = aliveShips.find((s) => s.id === ship.flagshipId);
      if (flagship) {
        const toFlagship = vecSub(ship.pos, flagship.pos);
        const distFromFlagship = vecDistance(ship.pos, flagship.pos);

        const nearbyThreat = aliveShips.find(
          (e) => e.team !== ship.team && vecDistance(ship.pos, e.pos) < 320,
        );

        if (nearbyThreat && distFromFlagship < 280) {
          const toThreat = vecSub(nearbyThreat.pos, ship.pos);
          targetHeading = Math.atan2(toThreat[1], toThreat[0]);
          desiredSpeed = ship.maxSpeed * 0.8;
        } else if (distFromFlagship > 250) {
          targetHeading = Math.atan2(-toFlagship[1], -toFlagship[0]);
          desiredSpeed = ship.maxSpeed;
        } else if (distFromFlagship < 130) {
          targetHeading = Math.atan2(toFlagship[1], toFlagship[0]);
          desiredSpeed = ship.maxSpeed * 0.5;
        } else {
          targetHeading = flagship.heading + Math.sin(this.timeElapsed * 0.8) * 0.25;
          desiredSpeed = Math.max(ship.maxSpeed * 0.4, vecDistance([0, 0], flagship.velocity));
        }
      }
    } else if (target) {
      // 2. Active Combat Maneuvers
      const toTarget = vecSub(target.pos, ship.pos);
      const dist = vecDistance(ship.pos, target.pos);
      const angleToTarget = Math.atan2(toTarget[1], toTarget[0]);

      if (ship.hullClass === "battleship") {
        const spinalTurret = ship.turrets.find((t) => t.isSpinalGimbal);
        const spinalReady = spinalTurret && spinalTurret.cooldownTimer <= 0.8;
        const optimalCombatDist = 540;

        if (dist < optimalCombatDist * 0.75) {
          // Reverse thrust to keep stand-off distance
          targetHeading = angleToTarget;
          desiredSpeed = -ship.maxSpeed * 0.45;
        } else if (spinalReady || dist > optimalCombatDist * 1.2) {
          targetHeading = angleToTarget;
          desiredSpeed = dist > optimalCombatDist ? ship.maxSpeed * 0.6 : 0;
        } else {
          const relAngle = normalizeAngle(angleToTarget - ship.heading);
          const chosenBroadside = relAngle < 0 ? -Math.PI * 0.48 : Math.PI * 0.48;
          targetHeading = normalizeAngle(angleToTarget + chosenBroadside);
          desiredSpeed = ship.maxSpeed * 0.35;
        }
      } else if (ship.hullClass === "cruiser") {
        // Cruisers: align forward bow-on for prow heavy torpedo tube when ready, flank otherwise!
        const torpTurret = ship.turrets.find((t) => t.weapon.weaponType === "missile");
        const torpReady = torpTurret && torpTurret.cooldownTimer <= 0.5;

        if (torpReady && dist <= 1000) {
          // Direct nose attack to launch torpedoes!
          targetHeading = angleToTarget;
          desiredSpeed = dist > 400 ? ship.maxSpeed * 0.8 : -ship.maxSpeed * 0.3;
        } else {
          // Flank with beam lasers
          targetHeading = angleToTarget + Math.PI * 0.35;
          desiredSpeed = ship.maxSpeed * 0.7;
        }
      } else if (ship.hullClass === "corvette") {
        // Aggressive wolf-pack escort: circle targets at 260u and fire flak continuously
        targetHeading = angleToTarget + Math.PI * 0.4;
        desiredSpeed = ship.maxSpeed * 0.75;
      } else if (ship.hullClass === "strike_craft") {
        // Swarm hit-and-run
        if (dist < 130) {
          targetHeading = angleToTarget + Math.PI * 0.7;
          desiredSpeed = ship.maxSpeed;
        } else {
          targetHeading = angleToTarget;
          desiredSpeed = ship.maxSpeed;
        }
      } else {
        targetHeading = angleToTarget;
        desiredSpeed = ship.maxSpeed * 0.6;
      }
    }

    // 3. Smooth Turn
    const turnRate = ship.hullClass === "battleship" ? 0.75 : ship.turnRate;
    const angleDiff = normalizeAngle(targetHeading - ship.heading);
    const turnStep = clamp(angleDiff, -turnRate * dt, turnRate * dt);
    ship.heading = normalizeAngle(ship.heading + turnStep);

    // 4. Thrust & Lateral Control
    const forwardVector: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
    const rightVector: Vector2 = [-Math.sin(ship.heading), Math.cos(ship.heading)];

    const currentForwardSpeed = vecDot(ship.velocity, forwardVector);
    const currentLateralSpeed = vecDot(ship.velocity, rightVector);

    const lateralDamping = ship.hullClass === "strike_craft" ? 2.5 : 5.0;
    const newLateralSpeed = currentLateralSpeed * Math.max(0, 1 - dt * lateralDamping);

    const forwardAccel = ship.hullClass === "strike_craft" ? 240.0 : 110.0;
    const speedError = desiredSpeed - currentForwardSpeed;
    const forwardStep = clamp(speedError, -forwardAccel * dt, forwardAccel * dt);
    const newForwardSpeed = currentForwardSpeed + forwardStep;

    const newVelocity = vecAdd(
      vecScale(forwardVector, newForwardSpeed),
      vecScale(rightVector, newLateralSpeed),
    );

    ship.velocity = newVelocity;
    ship.pos = vecAdd(ship.pos, vecScale(ship.velocity, dt));
  }

  private resolveShipCollisions(aliveShips: ShipState[], dt: number): void {
    const getShipMass = (hull: string): number => {
      switch (hull) {
        case "battleship":
          return 130.0;
        case "cruiser":
          return 30.0;
        case "corvette":
          return 8.0;
        default:
          return 1.0;
      }
    };

    for (let i = 0; i < aliveShips.length; i++) {
      for (let j = i + 1; j < aliveShips.length; j++) {
        const a = aliveShips[i];
        const b = aliveShips[j];
        const d = vecDistance(a.pos, b.pos);

        // Effective Shield Perimeter: uses full 1.5x shield bubble radius so shields NEVER clip!
        const shieldA = a.size * (a.shieldCurrent > 0 ? 1.5 : 1.0);
        const shieldB = b.size * (b.shieldCurrent > 0 ? 1.5 : 1.0);
        const minBubbleDist = shieldA + shieldB;
        const repulsorZone = minBubbleDist + 20;

        if (d < repulsorZone && d > 0.001) {
          const normal = vecNormalize(vecSub(a.pos, b.pos));

          const massA = getShipMass(a.hullClass);
          const massB = getShipMass(b.hullClass);
          const totalMass = massA + massB;

          const pushRatioA = massB / totalMass;
          const pushRatioB = massA / totalMass;

          // Strong repulsor prevents capitals from overlapping bubbles
          const repulsorForce = (repulsorZone - d) * 120;
          a.pos = vecAdd(a.pos, vecScale(normal, repulsorForce * pushRatioA * dt));
          b.pos = vecSub(b.pos, vecScale(normal, repulsorForce * pushRatioB * dt));

          // Physical shield clash & ramming
          if (d <= minBubbleDist) {
            const relVel = vecDistance(a.velocity, b.velocity);
            const ramDamage = Math.max(30, relVel * 1.2);

            if (a.shieldCurrent > 0) a.shieldCurrent = Math.max(0, a.shieldCurrent - ramDamage);
            else a.hullCurrent = Math.max(0, a.hullCurrent - ramDamage * 1.5);

            if (b.shieldCurrent > 0) b.shieldCurrent = Math.max(0, b.shieldCurrent - ramDamage);
            else b.hullCurrent = Math.max(0, b.hullCurrent - ramDamage * 1.5);

            if (
              a.hullClass === "strike_craft" &&
              (b.hullClass === "battleship" || b.hullClass === "cruiser")
            ) {
              a.hullCurrent = 0;
              a.isAlive = false;
            } else if (
              b.hullClass === "strike_craft" &&
              (a.hullClass === "battleship" || a.hullClass === "cruiser")
            ) {
              b.hullCurrent = 0;
              b.isAlive = false;
            }

            if (a.hullCurrent <= 0) a.isAlive = false;
            if (b.hullCurrent <= 0) b.isAlive = false;
          }
        }
      }
    }
  }

  private updateTurretAim(
    turret: TurretMountState,
    dt: number,
    ship: ShipState,
    targetPos: [number, number] | null,
  ): boolean {
    if (turret.cooldownTimer > 0) {
      turret.cooldownTimer = Math.max(0, turret.cooldownTimer - dt);
    }
    if (!targetPos) return false;

    const rotatedOffset = rotatePoint(turret.offset, ship.heading);
    const turretWorldPos = vecAdd(ship.pos, rotatedOffset);

    const toTarget = vecSub(targetPos, turretWorldPos);
    const desiredWorldAngle = Math.atan2(toTarget[1], toTarget[0]);
    const desiredLocal = normalizeAngle(desiredWorldAngle - ship.heading);

    const [minArc, maxArc] = turret.baseArc;
    const clampedLocal = clamp(desiredLocal, minArc, maxArc);

    const diff = normalizeAngle(clampedLocal - turret.currentLocalAngle);
    const maxStep = turret.trackingSpeed * dt;
    const step = clamp(diff, -maxStep, maxStep);
    turret.currentLocalAngle = normalizeAngle(turret.currentLocalAngle + step);

    const isInArc = desiredLocal >= minArc && desiredLocal <= maxArc;
    const alignTolerance = turret.isSpinalGimbal ? 0.08 : 0.15;
    const isAligned = Math.abs(diff) < alignTolerance;
    return isInArc && isAligned;
  }

  private fireWeapon(
    ship: ShipState,
    turret: TurretMountState,
    targetPos: [number, number],
    targetShip: ShipState | null,
  ): void {
    turret.cooldownTimer = turret.weapon.cooldown;
    turret.lastFiredTime = this.timeElapsed; // Track fired time for UI cooldown bars!

    const rotatedOffset = rotatePoint(turret.offset, ship.heading);
    const spawnPos = vecAdd(ship.pos, rotatedOffset);

    // Hitscan (Beam Laser or Flak Point Defense)
    if (turret.weapon.projectileSpeed <= 0) {
      if (turret.weapon.weaponType === "point_defense") {
        const missile = this.findMissileTarget(ship, turret.weapon.range);
        if (missile) {
          missile.hp -= turret.weapon.damage * 6.0;
          if (this.onBeamFire) this.onBeamFire(spawnPos, missile.pos, "#facc15", 2.0);
        } else if (targetShip?.isAlive) {
          // Corvettes actively barrage enemy hulls with flak!
          this.applyDamage(targetShip, turret.weapon.damage, turret.weapon);
          if (this.onBeamFire) this.onBeamFire(spawnPos, targetShip.pos, "#facc15", 1.8);
        }
      } else if (targetShip?.isAlive) {
        const dist = vecDistance(spawnPos, targetShip.pos);
        if (dist <= turret.weapon.range) {
          const beamColor = ship.team === 0 ? "#38bdf8" : "#f87171";
          this.applyDamage(targetShip, turret.weapon.damage, turret.weapon);
          if (this.onBeamFire) this.onBeamFire(spawnPos, targetShip.pos, beamColor, 3.2);
        }
      }
      return;
    }

    // Physical projectile (Railgun, Plasma, Missile)
    this.projectileCounter += 1;
    const toTarget = vecNormalize(vecSub(targetPos, spawnPos));
    const velocity = vecScale(toTarget, turret.weapon.projectileSpeed);
    const lifetime = (turret.weapon.range / turret.weapon.projectileSpeed) * 1.25;

    this.projectiles.push({
      id: `proj_${this.projectileCounter}`,
      weaponType: turret.weapon.weaponType,
      damage: turret.weapon.damage,
      ownerId: ship.id,
      ownerTeam: ship.team,
      pos: spawnPos,
      velocity,
      lifetime,
      targetId: targetShip ? targetShip.id : null,
      hp: 25.0,
    });
  }

  private updateProjectiles(dt: number, aliveShips: ShipState[]): void {
    const active: ProjectileState[] = [];

    for (const p of this.projectiles) {
      p.lifetime -= dt;
      if (p.lifetime <= 0 || p.hp <= 0) continue;

      p.pos = vecAdd(p.pos, vecScale(p.velocity, dt));

      let hit = false;
      for (const ship of aliveShips) {
        if (ship.team === p.ownerTeam) continue;
        if (vecDistance(p.pos, ship.pos) <= ship.size) {
          const weaponDef: WeaponDefinition = {
            weaponType: p.weaponType,
            name: p.weaponType,
            damage: p.damage,
            cooldown: 1,
            range: 1000,
            projectileSpeed: 500,
            trackingSpeed: 2,
            shieldMultiplier: p.weaponType === "railgun" ? 1.6 : 1.0,
            armorMultiplier: p.weaponType === "missile" ? 1.8 : 0.75,
            hullMultiplier: p.weaponType === "plasma" ? 1.5 : 1.0,
            cost: 100,
          };
          this.applyDamage(ship, p.damage, weaponDef);
          hit = true;
          break;
        }
      }

      if (!hit) {
        active.push(p);
      }
    }

    this.projectiles = active;
  }

  private applyDamage(ship: ShipState, rawDamage: number, weapon: WeaponDefinition): void {
    if (!ship.isAlive) return;

    ship.shieldDelayTimer = 3.0;
    let remaining = rawDamage;

    if (ship.shieldCurrent > 0) {
      const shieldDmg = remaining * weapon.shieldMultiplier;
      if (ship.shieldCurrent >= shieldDmg) {
        ship.shieldCurrent -= shieldDmg;
        return;
      }
      remaining -= ship.shieldCurrent / weapon.shieldMultiplier;
      ship.shieldCurrent = 0;
    }

    if (ship.armorCurrent > 0 && remaining > 0) {
      const armorDmg = remaining * weapon.armorMultiplier;
      const mitigation = remaining / (remaining + ship.armorRating);
      const mitigated = armorDmg * mitigation;
      if (ship.armorCurrent >= mitigated) {
        ship.armorCurrent -= mitigated;
        return;
      }
      remaining -= ship.armorCurrent / (weapon.armorMultiplier * mitigation);
      ship.armorCurrent = 0;
    }

    if (remaining > 0) {
      const hullDmg = remaining * weapon.hullMultiplier;
      ship.hullCurrent = Math.max(0, ship.hullCurrent - hullDmg);
      if (ship.hullCurrent <= 0) {
        ship.isAlive = false;
      }
    }
  }
}
