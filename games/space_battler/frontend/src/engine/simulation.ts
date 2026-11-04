// Deterministic client combat simulation runner with anti-drift physics, separation, and formation anchors

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
      this.updateShipMovement(ship, target, order, aliveShips, dt);

      // Turrets aim & fire
      for (const turret of ship.turrets) {
        let targetPos = target ? target.pos : null;

        // Point Defense targeting against incoming missiles
        if (turret.weapon.weaponType === "point_defense") {
          const missile = this.findMissileTarget(ship, turret.weapon.range);
          if (missile) {
            targetPos = missile.pos;
          }
        }

        const isAimed = this.updateTurretAim(turret, dt, ship, targetPos);
        if (isAimed && turret.cooldownTimer <= 0 && targetPos) {
          this.fireWeapon(ship, turret, targetPos, target);
        }
      }
    }

    // 3. Projectiles & Collision Resolution
    this.updateProjectiles(dt, aliveShips);
  }

  private findTargetForShip(
    ship: ShipState,
    order: GroupOrder,
    aliveShips: ShipState[],
  ): ShipState | null {
    let enemies = aliveShips.filter((s) => s.team !== ship.team);
    if (enemies.length === 0) return null;

    if (order.priority === "capitals") {
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
    order: GroupOrder,
    aliveShips: ShipState[],
    dt: number,
  ): void {
    // 1. Formation Anchor: If ship is an escort with a flagship, follow flagship position
    let targetHeading = ship.heading;
    let desiredSpeed = 0;

    if (ship.flagshipId) {
      const flagship = aliveShips.find((s) => s.id === ship.flagshipId);
      if (flagship && ship.formationOffset) {
        // Compute world position of formation slot
        const slotOffset = rotatePoint(ship.formationOffset, flagship.heading);
        const formationSlotPos = vecAdd(flagship.pos, slotOffset);

        const toSlot = vecSub(formationSlotPos, ship.pos);
        const distToSlot = vecDistance(ship.pos, formationSlotPos);

        if (distToSlot > 30) {
          targetHeading = Math.atan2(toSlot[1], toSlot[0]);
          desiredSpeed = clamp(distToSlot * 1.5, 0, ship.maxSpeed);
        } else {
          // Match flagship heading when in slot
          targetHeading = flagship.heading;
          desiredSpeed = vecDistance([0, 0], flagship.velocity);
        }
      }
    } else if (target) {
      // Free combat movement (flagship, independent cruisers, or strike craft)
      const toTarget = vecSub(target.pos, ship.pos);
      const dist = vecDistance(ship.pos, target.pos);
      const desiredDist = order.stance === "max_range" ? 550 : 220;

      let targetAngle = Math.atan2(toTarget[1], toTarget[0]);

      if (ship.hullClass === "battleship") {
        // Dreadnought: align nose for spinal railgun if far, broadside if close
        if (dist < desiredDist * 1.4) {
          targetAngle += Math.PI / 2; // Broadside
        }
        desiredSpeed =
          dist > desiredDist ? ship.maxSpeed : dist < desiredDist * 0.7 ? -ship.maxSpeed * 0.4 : 0;
      } else if (ship.hullClass === "strike_craft") {
        // Fighters: strafe runs with evasion
        if (dist < 120) {
          targetAngle += Math.PI / 3; // Break off on strafe exit
          desiredSpeed = ship.maxSpeed;
        } else {
          desiredSpeed = ship.maxSpeed;
        }
      } else {
        // Cruiser / Escort
        desiredSpeed =
          dist > desiredDist
            ? ship.maxSpeed * 0.8
            : dist < desiredDist * 0.7
              ? -ship.maxSpeed * 0.3
              : 0;
      }

      targetHeading = targetAngle;
    }

    // 2. Smooth Angular Alignment (No instant snap)
    const angleDiff = normalizeAngle(targetHeading - ship.heading);
    const turnStep = clamp(angleDiff, -ship.turnRate * dt, ship.turnRate * dt);
    ship.heading = normalizeAngle(ship.heading + turnStep);

    // 3. Thrust Vector & Anti-Drift Physics (Damp lateral slip, thrust strictly along heading)
    const forwardVector: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
    const rightVector: Vector2 = [-Math.sin(ship.heading), Math.cos(ship.heading)];

    // Decompose current velocity into forward and lateral components
    const currentForwardSpeed = vecDot(ship.velocity, forwardVector);
    const currentLateralSpeed = vecDot(ship.velocity, rightVector);

    // Damp lateral slip (RCS thrusters kill drift)
    const newLateralSpeed = currentLateralSpeed * Math.max(0, 1 - dt * 6.0);

    // Accelerate toward desired forward speed
    const forwardAccel = 120.0;
    const speedError = desiredSpeed - currentForwardSpeed;
    const forwardStep = clamp(speedError, -forwardAccel * dt, forwardAccel * dt);
    const newForwardSpeed = currentForwardSpeed + forwardStep;

    // Reconstruct velocity
    let newVelocity = vecAdd(
      vecScale(forwardVector, newForwardSpeed),
      vecScale(rightVector, newLateralSpeed),
    );

    // 4. Separation & Avoidance (Keep ships from merging into single point)
    let separationForce: Vector2 = [0, 0];
    for (const other of aliveShips) {
      if (other.id === ship.id) continue;
      const d = vecDistance(ship.pos, other.pos);
      const minSafeDist = ship.size + other.size + 15;
      if (d < minSafeDist && d > 0.001) {
        const pushDir = vecNormalize(vecSub(ship.pos, other.pos));
        const pushMag = (minSafeDist - d) * 3.5;
        separationForce = vecAdd(separationForce, vecScale(pushDir, pushMag));
      }
    }
    newVelocity = vecAdd(newVelocity, vecScale(separationForce, dt));

    ship.velocity = newVelocity;
    ship.pos = vecAdd(ship.pos, vecScale(ship.velocity, dt));
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
    const alignTolerance = turret.isSpinalGimbal ? 0.03 : 0.08;
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

    // Hitscan
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

    // Physical projectile
    this.projectileCounter += 1;
    const toTarget = vecNormalize(vecSub(targetPos, spawnPos));
    const velocity = vecScale(toTarget, turret.weapon.projectileSpeed);
    const lifetime = (turret.weapon.range / turret.weapon.projectileSpeed) * 1.2;

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

    // 1. Shield
    if (ship.shieldCurrent > 0) {
      const shieldDmg = remaining * weapon.shieldMultiplier;
      if (ship.shieldCurrent >= shieldDmg) {
        ship.shieldCurrent -= shieldDmg;
        return;
      }
      remaining -= ship.shieldCurrent / weapon.shieldMultiplier;
      ship.shieldCurrent = 0;
    }

    // 2. Armor
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

    // 3. Hull
    if (remaining > 0) {
      const hullDmg = remaining * weapon.hullMultiplier;
      ship.hullCurrent = Math.max(0, ship.hullCurrent - hullDmg);
      if (ship.hullCurrent <= 0) {
        ship.isAlive = false;
      }
    }
  }
}
