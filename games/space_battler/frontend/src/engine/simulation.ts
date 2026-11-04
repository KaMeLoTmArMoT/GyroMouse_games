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
export type FlakBurstCallback = (pos: Vector2) => void;

const FIGHTER_STANDOFF = 385;
const FIGHTER_EGRESS_DISTANCE = 200;
const FIGHTER_ORBIT_RATE = 0.25;

const FLAK_PROJECTILE_SPEED = 1500;
const FLAK_PROJECTILE_LIFETIME = 0.35;
const FLAK_PROXIMITY_RADIUS = 28;
const FLAK_BLAST_RADIUS = 60;
const FLAK_BLAST_DAMAGE = 18;

const FLAK_BLAST_WEAPON: WeaponDefinition = {
  weaponType: "point_defense",
  name: "Flak Burst",
  damage: FLAK_BLAST_DAMAGE,
  cooldown: 1,
  range: FLAK_BLAST_RADIUS,
  projectileSpeed: FLAK_PROJECTILE_SPEED,
  trackingSpeed: 0,
  shieldMultiplier: 0.15, // Heavily deflected by capital shields
  armorMultiplier: 0.1, // Absorbed by heavy armor plating
  hullMultiplier: 0.15,
  cost: 0,
};

export class ClientCombatSimulation {
  ships: ShipState[] = [];
  projectiles: ProjectileState[] = [];
  orders: Map<number, GroupOrder> = new Map();
  timeElapsed = 0;
  private projectileCounter = 0;
  onBeamFire: BeamFireCallback | null = null;
  onFlakBurst: FlakBurstCallback | null = null;

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
    this.ensureFighterLanes(aliveShips);
    for (const ship of aliveShips) {
      const order = this.orders.get(ship.groupId) ?? {
        groupId: ship.groupId,
        priority: "nearest",
        stance: "optimal_range",
      };
      const target = this.findTargetForShip(ship, order, aliveShips);
      this.updateShipMovement(ship, target, aliveShips, dt);

      // Turrets aim & fire (strike craft only fire during their attack dive)
      const canFire = ship.hullClass !== "strike_craft" || ship.fighterPhase === "attack";
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
        // 1. Prioritize hostile incoming missiles in range (+10% buffer)
        // 2. If NO missiles exist, prioritize enemy strike crafts / nearest ships in range
        // 3. If NO enemies in range, remain idle (no blind fire at infinite range!)
        if (turret.weapon.weaponType === "point_defense") {
          const maxPDRange = turret.weapon.range * 1.1;
          const missile = this.findMissileTarget(ship, maxPDRange);
          if (missile) {
            targetPos = missile.pos;
            turretTarget = null;
          } else {
            // Find nearest enemy in 360-degree range
            const enemiesInRange = aliveShips.filter(
              (e) => e.team !== ship.team && vecDistance(ship.pos, e.pos) <= maxPDRange,
            );
            if (enemiesInRange.length > 0) {
              const nearestEnemy = enemiesInRange.reduce((prev, curr) =>
                vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
              );
              targetPos = nearestEnemy.pos;
              turretTarget = nearestEnemy;
            } else {
              // Out of range: keep guns ready but do not engage
              targetPos = null;
              turretTarget = null;
            }
          }
        }

        let aimPos = targetPos;
        // Lead targeting for ballistic/projectile weapons
        if (turretTarget && targetPos && turret.weapon.projectileSpeed > 0) {
          const targetSpeedSq = vecDot(turretTarget.velocity, turretTarget.velocity);
          if (targetSpeedSq > 25) {
            const dist = vecDistance(ship.pos, targetPos);
            const leadTime = dist / turret.weapon.projectileSpeed;
            aimPos = vecAdd(targetPos, vecScale(turretTarget.velocity, leadTime));
          }
        }

        const isAimed = this.updateTurretAim(turret, dt, ship, aimPos);
        const maxEngagementRange = turret.weapon.range * 1.1;
        const inEngagementRange = Boolean(
          targetPos && vecDistance(ship.pos, targetPos) <= maxEngagementRange,
        );
        if (canFire && isAimed && inEngagementRange && turret.cooldownTimer <= 0 && aimPos) {
          this.fireWeapon(ship, turret, aimPos, turretTarget);
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
    } else if (ship.hullClass === "strike_craft") {
      // Fighter wings default to attack runs against capital hulls
      const capitals = enemies.filter(
        (s) => s.hullClass === "cruiser" || s.hullClass === "battleship",
      );
      if (capitals.length > 0) enemies = capitals;
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

  private ensureFighterLanes(aliveShips: ShipState[]): void {
    const fightersByTeam = new Map<number, ShipState[]>();

    for (const ship of aliveShips) {
      if (ship.hullClass !== "strike_craft") continue;
      const wing = fightersByTeam.get(ship.team) ?? [];
      wing.push(ship);
      fightersByTeam.set(ship.team, wing);
    }

    for (const wing of fightersByTeam.values()) {
      wing.forEach((ship, index) => {
        if (ship.fighterLaneAngle !== undefined) return;

        ship.fighterLaneAngle = (index * 2 * Math.PI) / wing.length;
        ship.fighterLaneIndex = index;
        ship.fighterPhase = "staging";
        ship.fighterPhaseTimer = (index * 1.7) % 5.0;
      });
    }
  }

  private updateFighterCycle(
    ship: ShipState,
    target: ShipState,
    angleToTarget: number,
    dist: number,
    dt: number,
  ): { heading: number; speed: number } {
    // Evasive maneuver: detect incoming heavy torpedoes and perform rapid jink!
    const nearbyMissile = this.projectiles.find(
      (p) =>
        p.ownerTeam !== ship.team &&
        p.weaponType === "missile" &&
        vecDistance(ship.pos, p.pos) < 180,
    );
    if (nearbyMissile) {
      const toMissile = vecSub(ship.pos, nearbyMissile.pos);
      const escapeHeading = Math.atan2(toMissile[1], toMissile[0]);
      return { heading: escapeHeading, speed: ship.maxSpeed * 1.25 };
    }

    const laneAngle = ship.fighterLaneAngle ?? 0;
    const laneIndex = ship.fighterLaneIndex ?? 0;
    const phase = ship.fighterPhase ?? "staging";
    const orbitAngle = laneAngle + this.timeElapsed * FIGHTER_ORBIT_RATE;

    const bearing = Math.atan2(ship.pos[1] - target.pos[1], ship.pos[0] - target.pos[0]);
    const bearingDiff = normalizeAngle(orbitAngle - bearing);
    const radialError = dist - FIGHTER_STANDOFF;

    let heading = ship.heading;
    let speed = 0;

    switch (phase) {
      case "staging": {
        if (dist > FIGHTER_STANDOFF + 70) {
          // Close to the standoff perimeter first, then orbit to the assigned lane
          heading = angleToTarget;
          speed = ship.maxSpeed * 0.8;
        } else {
          heading = this.computeOrbitHeading(bearing, bearingDiff, radialError);
          speed = ship.maxSpeed * 0.5;
        }

        const gun = ship.turrets[0];
        const gunReady = !gun || gun.cooldownTimer <= 0.2;
        const onLane = Math.abs(bearingDiff) < 0.25;
        const onRadius = Math.abs(radialError) < 90;

        if (onLane && onRadius) {
          ship.fighterPhaseTimer = (ship.fighterPhaseTimer ?? 0) - dt;
        }

        if (onLane && onRadius && (ship.fighterPhaseTimer ?? 0) <= 0 && gunReady) {
          ship.fighterPhase = "attack";
          ship.fighterPhaseTimer = 0;
        }
        break;
      }

      case "attack": {
        // Each wing member dives down its own radial lane instead of a shared point
        const laneOffset = target.size + 30;
        const attackPoint: Vector2 = [
          target.pos[0] + Math.cos(laneAngle) * laneOffset,
          target.pos[1] + Math.sin(laneAngle) * laneOffset,
        ];
        const toAttackPoint = vecSub(attackPoint, ship.pos);
        heading = Math.atan2(toAttackPoint[1], toAttackPoint[0]);
        speed = ship.maxSpeed;

        if (dist <= FIGHTER_EGRESS_DISTANCE) {
          ship.fighterPhase = "egress";
          ship.fighterPhaseTimer = 1.2;
        }
        break;
      }

      case "egress": {
        const peelSide = laneIndex % 2 === 0 ? 1 : -1;
        heading = normalizeAngle(angleToTarget + peelSide * Math.PI * 0.66);
        speed = ship.maxSpeed;

        ship.fighterPhaseTimer = (ship.fighterPhaseTimer ?? 0) - dt;
        if ((ship.fighterPhaseTimer ?? 0) <= 0 || dist > 360) {
          ship.fighterPhase = "rejoin";
          ship.fighterPhaseTimer = 0;
        }
        break;
      }

      case "rejoin": {
        if (dist < FIGHTER_STANDOFF - 40) {
          // Boost radially back out to the staging perimeter
          heading = normalizeAngle(bearing + Math.PI);
          speed = ship.maxSpeed;
        } else {
          ship.fighterPhase = "staging";
          ship.fighterPhaseTimer = 0.4 + ((laneIndex * 1.3) % 3.0);
          heading = this.computeOrbitHeading(bearing, bearingDiff, radialError);
          speed = ship.maxSpeed * 0.5;
        }
        break;
      }
    }

    return { heading, speed };
  }

  private computeOrbitHeading(bearing: number, bearingDiff: number, radialError: number): number {
    const orbitDirection = bearingDiff >= 0 ? 1 : -1;
    const tangentHeading = bearing + orbitDirection * (Math.PI / 2);
    const radialHeading = radialError > 0 ? bearing + Math.PI : bearing;
    const radialWeight = clamp(Math.abs(radialError) / 120, 0, 1);

    const tangentX = Math.cos(tangentHeading);
    const tangentY = Math.sin(tangentHeading);
    const radialX = Math.cos(radialHeading);
    const radialY = Math.sin(radialHeading);

    const dirX = tangentX * (1 - radialWeight) + radialX * radialWeight;
    const dirY = tangentY * (1 - radialWeight) + radialY * radialWeight;

    if (Math.abs(dirX) + Math.abs(dirY) < 1e-6) return tangentHeading;
    return Math.atan2(dirY, dirX);
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
        const optimalCombatDist = 600;

        const friendlyBattleships = aliveShips.filter(
          (s) => s.team === ship.team && s.hullClass === "battleship",
        );
        const bsIndex = friendlyBattleships.findIndex((s) => s.id === ship.id);
        const totalBs = Math.max(1, friendlyBattleships.length);
        const bsSpread = totalBs > 1 ? (bsIndex - (totalBs - 1) / 2) * 0.22 : 0;

        if (dist < optimalCombatDist * 0.75) {
          // Reverse thrust to keep stand-off distance
          targetHeading = angleToTarget;
          desiredSpeed = -ship.maxSpeed * 0.5;
        } else if (spinalReady || dist > optimalCombatDist * 1.2) {
          targetHeading = normalizeAngle(angleToTarget + bsSpread);
          desiredSpeed = dist > optimalCombatDist ? ship.maxSpeed * 0.6 : 0;
        } else {
          const relAngle = normalizeAngle(angleToTarget - ship.heading);
          const chosenBroadside = relAngle < 0 ? -Math.PI * 0.48 : Math.PI * 0.48;
          targetHeading = normalizeAngle(angleToTarget + chosenBroadside);
          desiredSpeed = ship.maxSpeed * 0.35;
        }
      } else if (ship.hullClass === "cruiser") {
        // Cruisers: form a concave firing fan facing the target
        // Keep fixed prow heavy torpedoes and dorsal beams bearing at all times!
        const friendlyCruisers = aliveShips.filter(
          (s) => s.team === ship.team && s.hullClass === "cruiser",
        );
        const cruiserIndex = friendlyCruisers.findIndex((s) => s.id === ship.id);
        const totalCruisers = Math.max(1, friendlyCruisers.length);
        const spreadOffset =
          totalCruisers > 1 ? (cruiserIndex - (totalCruisers - 1) / 2) * 0.35 : 0;

        const optimalCombatDist = 480;
        targetHeading = normalizeAngle(angleToTarget + spreadOffset * 0.45);

        if (dist < optimalCombatDist * 0.75) {
          // Reverse thrust to prevent collision & maintain torpedo standoff!
          desiredSpeed = -ship.maxSpeed * 0.5;
        } else if (dist > optimalCombatDist * 1.2) {
          desiredSpeed = ship.maxSpeed * 0.85;
        } else {
          desiredSpeed = ship.maxSpeed * 0.25;
        }
      } else if (ship.hullClass === "corvette") {
        // Aggressive wolf-pack escort: circle targets at 260u and fire flak continuously
        targetHeading = angleToTarget + Math.PI * 0.4;
        desiredSpeed = ship.maxSpeed * 0.75;
      } else if (ship.hullClass === "strike_craft") {
        // Staggered staged attack runs: staging -> attack -> egress -> rejoin
        const maneuver = this.updateFighterCycle(ship, target, angleToTarget, dist, dt);
        targetHeading = maneuver.heading;
        desiredSpeed = maneuver.speed;
      } else {
        targetHeading = angleToTarget;
        desiredSpeed = ship.maxSpeed * 0.6;
      }
    }

    // Friendly ship spatial avoidance (breaks up conga lines & collisions between teammates)
    const nearbyFriendly = aliveShips.find((other) => {
      if (other.id === ship.id || other.team !== ship.team) return false;
      const d = vecDistance(ship.pos, other.pos);
      return d < (ship.size + other.size) * 1.35;
    });
    if (nearbyFriendly) {
      const avoidVec = vecSub(ship.pos, nearbyFriendly.pos);
      const pushAngle = Math.atan2(avoidVec[1], avoidVec[0]);
      targetHeading = normalizeAngle(targetHeading * 0.65 + pushAngle * 0.35);
      desiredSpeed = Math.max(desiredSpeed * 0.5, ship.maxSpeed * 0.2);
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

        // Effective Shield Perimeter: calibrated 1.40x shield bubble
        const shieldA = a.size * (a.shieldCurrent > 0 ? 1.4 : 1.0);
        const shieldB = b.size * (b.shieldCurrent > 0 ? 1.4 : 1.0);
        const minBubbleDist = shieldA + shieldB;
        const repulsorZone = minBubbleDist + 20;

        if (d < repulsorZone && d > 0.001) {
          const normal = vecNormalize(vecSub(a.pos, b.pos));

          const massA = getShipMass(a.hullClass);
          const massB = getShipMass(b.hullClass);
          const totalMass = massA + massB;

          const pushRatioA = massB / totalMass;
          const pushRatioB = massA / totalMass;

          // Cancel only closing normal velocity so hulls slide tangentially past each other
          const relVel = vecSub(a.velocity, b.velocity);
          const closingSpeed = vecDot(relVel, normal);
          if (closingSpeed < 0) {
            a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * pushRatioA));
            b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * pushRatioB));
          }

          // Strong repulsor prevents capitals from overlapping bubbles
          const repulsorForce = (repulsorZone - d) * 120;
          a.pos = vecAdd(a.pos, vecScale(normal, repulsorForce * pushRatioA * dt));
          b.pos = vecSub(b.pos, vecScale(normal, repulsorForce * pushRatioB * dt));

          // Physical shield clash & ramming (hostile ships only!)
          if (d <= minBubbleDist && a.team !== b.team) {
            const relSpeed = vecDistance(a.velocity, b.velocity);
            const ramDamage = Math.max(30, relSpeed * 1.2);

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

    // Physical proximity-fused flak shell (Point Defense)
    if (turret.weapon.weaponType === "point_defense") {
      this.projectileCounter += 1;
      const toTarget = vecNormalize(vecSub(targetPos, spawnPos));

      this.projectiles.push({
        id: `proj_${this.projectileCounter}`,
        weaponType: "point_defense",
        damage: FLAK_BLAST_DAMAGE,
        ownerId: ship.id,
        ownerTeam: ship.team,
        pos: spawnPos,
        velocity: vecScale(toTarget, FLAK_PROJECTILE_SPEED),
        lifetime: FLAK_PROJECTILE_LIFETIME,
        targetId: targetShip ? targetShip.id : null,
        hp: 25.0,
        isFlakBurst: true,
      });
      return;
    }

    // Hitscan (Beam Laser)
    if (turret.weapon.projectileSpeed <= 0) {
      if (targetShip?.isAlive) {
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
      const isFlak = p.isFlakBurst === true;
      p.lifetime -= dt;

      if (p.hp <= 0) continue;
      if (p.lifetime <= 0) {
        if (isFlak) this.detonateFlak(p, aliveShips);
        continue;
      }

      p.pos = vecAdd(p.pos, vecScale(p.velocity, dt));

      if (isFlak) {
        if (this.shouldDetonateFlak(p, aliveShips)) {
          this.detonateFlak(p, aliveShips);
        } else {
          active.push(p);
        }
        continue;
      }

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

  private shouldDetonateFlak(flak: ProjectileState, aliveShips: ShipState[]): boolean {
    for (const ship of aliveShips) {
      if (ship.team === flak.ownerTeam) continue;
      if (vecDistance(flak.pos, ship.pos) <= ship.size + FLAK_PROXIMITY_RADIUS) return true;
    }

    for (const other of this.projectiles) {
      if (other.weaponType !== "missile" || other.ownerTeam === flak.ownerTeam) continue;
      if (vecDistance(flak.pos, other.pos) <= FLAK_PROXIMITY_RADIUS) return true;
    }

    return false;
  }

  private detonateFlak(flak: ProjectileState, aliveShips: ShipState[]): void {
    for (const ship of aliveShips) {
      if (ship.team === flak.ownerTeam) continue;
      if (vecDistance(flak.pos, ship.pos) <= FLAK_BLAST_RADIUS + ship.size) {
        if (ship.hullClass === "strike_craft") {
          const swarmWeapon: WeaponDefinition = {
            ...FLAK_BLAST_WEAPON,
            shieldMultiplier: 1.0,
            armorMultiplier: 1.0,
            hullMultiplier: 1.0,
          };
          this.applyDamage(ship, FLAK_BLAST_DAMAGE, swarmWeapon);
        } else {
          this.applyDamage(ship, FLAK_BLAST_DAMAGE, FLAK_BLAST_WEAPON);
        }
      }
    }

    for (const other of this.projectiles) {
      if (other.weaponType !== "missile" || other.ownerTeam === flak.ownerTeam) continue;
      if (vecDistance(flak.pos, other.pos) <= FLAK_BLAST_RADIUS) {
        other.hp -= FLAK_BLAST_DAMAGE;
      }
    }

    if (this.onFlakBurst) this.onFlakBurst([...flak.pos]);
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
