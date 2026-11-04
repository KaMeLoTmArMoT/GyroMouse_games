// Deterministic client combat simulation runner with dynamic combat maneuvering, spring-damping escorts, and active broadside tracking

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

export class ClientCombatSimulation {
  ships: ShipState[] = [];
  projectiles: ProjectileState[] = [];
  orders: Map<number, GroupOrder> = new Map();
  timeElapsed = 0;
  private projectileCounter = 0;

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

        // Smart Turret Assignment: Capital Spinal Railguns & Heavy Torpedoes IGNORE fast strike craft
        if (turret.isSpinalGimbal || turret.weapon.range > 800) {
          const capitalEnemies = aliveShips.filter(
            (e) =>
              e.team !== ship.team && (e.hullClass === "cruiser" || e.hullClass === "battleship"),
          );
          if (capitalEnemies.length > 0) {
            turretTarget = capitalEnemies.reduce((prev, curr) =>
              vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
            );
          } else if (target?.hullClass === "strike_craft") {
            turretTarget = target;
          }
        }

        let targetPos = turretTarget ? turretTarget.pos : null;

        // Point Defense targeting against incoming missiles
        if (turret.weapon.weaponType === "point_defense") {
          const missile = this.findMissileTarget(ship, turret.weapon.range);
          if (missile) {
            targetPos = missile.pos;
          }
        }

        const isAimed = this.updateTurretAim(turret, dt, ship, targetPos);
        if (isAimed && turret.cooldownTimer <= 0 && targetPos) {
          this.fireWeapon(ship, turret, targetPos, turretTarget);
        }
      }
    }

    // 3. Resolve Ship Collisions & Ramming (3-Tier Impact System)
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

    // 1. Organic Escort Movement (Soft Spring Anchor, not glued like a tail!)
    if (ship.flagshipId) {
      const flagship = aliveShips.find((s) => s.id === ship.flagshipId);
      if (flagship) {
        // Escort orbits or floats flexibly in the defense perimeter (110-180u around flagship)
        const toFlagship = vecSub(ship.pos, flagship.pos);
        const distFromFlagship = vecDistance(ship.pos, flagship.pos);
        const _idealDistance = 140;

        // If hostile missiles or fighters exist nearby, escort breaks off slightly to intercept!
        const nearbyThreat = aliveShips.find(
          (e) => e.team !== ship.team && vecDistance(ship.pos, e.pos) < 280,
        );

        if (nearbyThreat && distFromFlagship < 240) {
          // Patrol toward threat
          const toThreat = vecSub(nearbyThreat.pos, ship.pos);
          targetHeading = Math.atan2(toThreat[1], toThreat[0]);
          desiredSpeed = ship.maxSpeed * 0.7;
        } else if (distFromFlagship > 220) {
          // Catch up to flagship smoothly
          targetHeading = Math.atan2(-toFlagship[1], -toFlagship[0]);
          desiredSpeed = ship.maxSpeed;
        } else if (distFromFlagship < 80) {
          // Push away slightly (don't crowd the flagship)
          targetHeading = Math.atan2(toFlagship[1], toFlagship[0]);
          desiredSpeed = ship.maxSpeed * 0.4;
        } else {
          // Cruise flexibly in formation alongside flagship
          targetHeading = flagship.heading + Math.sin(this.timeElapsed * 0.8) * 0.2;
          desiredSpeed = Math.max(ship.maxSpeed * 0.4, vecDistance([0, 0], flagship.velocity));
        }
      }
    } else if (target) {
      // 2. Active Battleship / Cruiser Combat Navigation
      const toTarget = vecSub(target.pos, ship.pos);
      const dist = vecDistance(ship.pos, target.pos);
      const angleToTarget = Math.atan2(toTarget[1], toTarget[0]);

      if (ship.hullClass === "battleship") {
        // Check if spinal railgun is ready to fire
        const spinalTurret = ship.turrets.find((t) => t.isSpinalGimbal);
        const spinalReady = spinalTurret && spinalTurret.cooldownTimer <= 0.6;

        if (spinalReady || dist > 600) {
          // 1. Nose-in: Turn directly to face enemy for devastating spinal railgun shot!
          targetHeading = angleToTarget;
          desiredSpeed = dist > 500 ? ship.maxSpeed * 0.8 : ship.maxSpeed * 0.3;
        } else {
          // 2. Broadside Maneuver: Turn 75 degrees to fire side laser batteries while reloading
          // Pick left or right broadside depending on which battery faces target best
          const currentDiff = normalizeAngle(angleToTarget - ship.heading);
          const broadsideOffset = currentDiff > 0 ? Math.PI * 0.42 : -Math.PI * 0.42;
          targetHeading = normalizeAngle(angleToTarget + broadsideOffset);
          // Keep cruising slowly in wide combat circle, NEVER freeze!
          desiredSpeed = ship.maxSpeed * 0.55;
        }
      } else if (ship.hullClass === "cruiser") {
        // Cruisers maintain continuous flanking speed (circling at 320u)
        targetHeading = angleToTarget + Math.PI * 0.35;
        desiredSpeed = ship.maxSpeed * 0.75;
      } else if (ship.hullClass === "strike_craft") {
        // Strike craft strafe runs
        if (dist < 120) {
          targetHeading = angleToTarget + Math.PI * 0.7; // sharp peel away
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

    // 3. Smooth Turn (Responsive turning, preventing stall locks)
    const angleDiff = normalizeAngle(targetHeading - ship.heading);
    const turnStep = clamp(angleDiff, -ship.turnRate * dt, ship.turnRate * dt);
    ship.heading = normalizeAngle(ship.heading + turnStep);

    // 4. Thrust & Lateral Control
    const forwardVector: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
    const rightVector: Vector2 = [-Math.sin(ship.heading), Math.cos(ship.heading)];

    const currentForwardSpeed = vecDot(ship.velocity, forwardVector);
    const currentLateralSpeed = vecDot(ship.velocity, rightVector);

    const lateralDamping = ship.hullClass === "strike_craft" ? 2.5 : 5.0;
    const newLateralSpeed = currentLateralSpeed * Math.max(0, 1 - dt * lateralDamping);

    const forwardAccel = ship.hullClass === "strike_craft" ? 240.0 : 90.0;
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
    for (let i = 0; i < aliveShips.length; i++) {
      for (let j = i + 1; j < aliveShips.length; j++) {
        const a = aliveShips[i];
        const b = aliveShips[j];
        const d = vecDistance(a.pos, b.pos);
        const contactDist = a.size + b.size;
        const repulsorZone = contactDist + 30;

        if (d < repulsorZone && d > 0.001) {
          const normal = vecNormalize(vecSub(a.pos, b.pos));

          const repulsorForce = (repulsorZone - d) * 55;
          a.pos = vecAdd(a.pos, vecScale(normal, (repulsorForce * dt) / Math.max(1, a.size * 0.1)));
          b.pos = vecSub(b.pos, vecScale(normal, (repulsorForce * dt) / Math.max(1, b.size * 0.1)));

          if (d <= contactDist) {
            const relVel = vecDistance(a.velocity, b.velocity);
            const ramDamage = Math.max(20, relVel * 0.8);

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
    const alignTolerance = turret.isSpinalGimbal ? 0.05 : 0.12;
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
    const rotatedOffset = rotatePoint(turret.offset, ship.heading);
    const spawnPos = vecAdd(ship.pos, rotatedOffset);

    if (turret.weapon.projectileSpeed <= 0) {
      if (turret.weapon.weaponType === "point_defense") {
        const missile = this.findMissileTarget(ship, turret.weapon.range);
        if (missile) {
          missile.hp -= turret.weapon.damage * 6.0;
        }
      } else if (targetShip?.isAlive) {
        const dist = vecDistance(spawnPos, targetShip.pos);
        if (dist <= turret.weapon.range) {
          this.applyDamage(targetShip, turret.weapon.damage, turret.weapon);
        }
      }
      return;
    }

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
