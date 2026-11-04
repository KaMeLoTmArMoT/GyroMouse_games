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
const FIGHTER_CLEARANCE = 45;
const FIGHTER_EGRESS_DISTANCE = 200;
const CRUISER_STANDOFF = 480;
const CRUISER_CLEARANCE = 100;
const CRUISER_BOW_LIMIT = (12 * Math.PI) / 180;

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
            // Strike craft take priority over other hulls, regardless of distance.
            const enemiesInRange = aliveShips.filter(
              (e) => e.team !== ship.team && vecDistance(ship.pos, e.pos) <= maxPDRange,
            );
            if (enemiesInRange.length > 0) {
              const strikeCraft = enemiesInRange.filter((e) => e.hullClass === "strike_craft");
              const candidates = strikeCraft.length > 0 ? strikeCraft : enemiesInRange;
              const nearestEnemy = candidates.reduce((prev, curr) =>
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
    this.resolveCruiserClearance(aliveShips);

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
    aliveShips: ShipState[],
  ): { heading: number; speed: number } {
    // 1. Safe Haven Management: Damaged craft or craft seeking cover lock onto friendly capital
    const friendlyAnchors = aliveShips.filter(
      (s) =>
        s.team === ship.team &&
        s.isAlive &&
        (s.hullClass === "battleship" || s.hullClass === "cruiser" || s.hullClass === "corvette"),
    );

    if (
      ship.safeHavenTimer === undefined ||
      ship.safeHavenTimer <= 0 ||
      !friendlyAnchors.some((a) => a.id === ship.safeHavenId)
    ) {
      if (friendlyAnchors.length > 0) {
        // Evaluate havens based on shield health, distance, and current occupancy (max 3 per anchor)
        let bestAnchor = friendlyAnchors[0];
        let bestScore = -Infinity;
        for (const anchor of friendlyAnchors) {
          const occupancy = aliveShips.filter(
            (s) => s.team === ship.team && s.isAlive && s.safeHavenId === anchor.id,
          ).length;
          const shieldRatio = anchor.shieldMax > 0 ? anchor.shieldCurrent / anchor.shieldMax : 0;
          const distToAnchor = vecDistance(ship.pos, anchor.pos);
          const score = shieldRatio * 80 - distToAnchor * 0.15 - occupancy * 50;
          if (score > bestScore) {
            bestScore = score;
            bestAnchor = anchor;
          }
        }
        ship.safeHavenId = bestAnchor.id;
        ship.safeHavenTimer = 2.0;
      } else {
        ship.safeHavenId = null;
        ship.safeHavenTimer = 1.0;
      }
    } else {
      ship.safeHavenTimer = (ship.safeHavenTimer ?? 0) - dt;
    }

    const safeHaven = friendlyAnchors.find((a) => a.id === ship.safeHavenId) ?? null;
    const isDamaged = ship.hullCurrent < ship.hullMax * 0.4 || ship.shieldCurrent < 10;
    const laneIndex = ship.fighterLaneIndex ?? 0;
    let phase = ship.fighterPhase ?? "staging";

    // Emergency egress if badly damaged
    if (isDamaged && phase === "attack") {
      phase = "egress";
      ship.fighterPhase = "egress";
      ship.fighterPhaseTimer = 2.0;
    }

    // 2. High-level intent / phase progression
    let intentTarget: Vector2;
    const attackOffset = target.size + 35;
    const flankSign = laneIndex % 2 === 0 ? 1 : -1;
    const attackPoint: Vector2 = [
      target.pos[0] + Math.cos(angleToTarget + flankSign * 0.4) * attackOffset,
      target.pos[1] + Math.sin(angleToTarget + flankSign * 0.4) * attackOffset,
    ];

    switch (phase) {
      case "staging": {
        // Assemble in loose formation on the friendly side of the target
        const stagingDist = FIGHTER_STANDOFF + ((laneIndex % 3) - 1) * 40;
        const stagingAngle = safeHaven
          ? Math.atan2(safeHaven.pos[1] - target.pos[1], safeHaven.pos[0] - target.pos[0])
          : angleToTarget + Math.PI;
        intentTarget = [
          target.pos[0] + Math.cos(stagingAngle + flankSign * 0.3) * stagingDist,
          target.pos[1] + Math.sin(stagingAngle + flankSign * 0.3) * stagingDist,
        ];

        ship.fighterPhaseTimer = (ship.fighterPhaseTimer ?? 0) - dt;
        const gun = ship.turrets[0];
        const gunReady = !gun || gun.cooldownTimer <= 0.2;
        if ((ship.fighterPhaseTimer ?? 0) <= 0 && gunReady && !isDamaged) {
          ship.fighterPhase = "attack";
          ship.fighterPhaseTimer = 0;
        }
        break;
      }

      case "attack": {
        intentTarget = attackPoint;
        if (dist <= FIGHTER_EGRESS_DISTANCE) {
          ship.fighterPhase = "egress";
          ship.fighterPhaseTimer = 1.4;
        }
        break;
      }

      case "egress": {
        // Peel towards safe haven if present, or away at sharp angle
        if (safeHaven) {
          intentTarget = safeHaven.pos;
        } else {
          intentTarget = [
            ship.pos[0] + Math.cos(angleToTarget + flankSign * Math.PI * 0.7) * 300,
            ship.pos[1] + Math.sin(angleToTarget + flankSign * Math.PI * 0.7) * 300,
          ];
        }

        ship.fighterPhaseTimer = (ship.fighterPhaseTimer ?? 0) - dt;
        if ((ship.fighterPhaseTimer ?? 0) <= 0 || dist > 380) {
          ship.fighterPhase = "rejoin";
          ship.fighterPhaseTimer = 0;
        }
        break;
      }

      case "rejoin": {
        if (safeHaven && vecDistance(ship.pos, safeHaven.pos) > 180) {
          intentTarget = safeHaven.pos;
        } else {
          ship.fighterPhase = "staging";
          ship.fighterPhaseTimer = 0.5 + ((laneIndex * 0.9) % 2.5);
          intentTarget = target.pos;
        }
        break;
      }
    }

    const toIntent = vecSub(intentTarget, ship.pos);
    const intentDir = vecNormalize(toIntent);

    // 3. 16-Sector Reachable Context Steering (Interest vs Danger maps)
    const SECTORS = 16;
    let bestSector = ship.lastSelectedSector ?? 0;
    let maxScore = -Infinity;
    let maxDangerObserved = 0;

    for (let k = 0; k < SECTORS; k++) {
      const sectorAngle = (k * 2 * Math.PI) / SECTORS;
      const candidateDir: Vector2 = [Math.cos(sectorAngle), Math.sin(sectorAngle)];

      // A. Interest score: progress towards intent goal
      const interestScore = vecDot(candidateDir, intentDir);

      // B. Threat & missile danger: predict closest approach of incoming missiles
      let dangerScore = 0;
      for (const p of this.projectiles) {
        if (p.ownerTeam === ship.team || p.weaponType !== "missile") continue;
        const r = vecSub(ship.pos, p.pos);
        const distToMissile = vecDistance([0, 0], r);
        if (distToMissile > 240) continue;

        // Relative velocity if ship takes this candidate heading
        const candidateVel = vecScale(candidateDir, ship.maxSpeed);
        const u = vecSub(candidateVel, p.velocity);
        const uSq = vecDot(u, u) + 1e-4;
        const tStar = clamp(-vecDot(r, u) / uSq, 0, 1.4);
        const rStar = vecAdd(r, vecScale(u, tStar));
        const dStar = vecDistance([0, 0], rStar);

        // Danger if time to closest approach is in near future and distance is lethal
        if (tStar > 0.04 && dStar < 75) {
          const missileDanger = ((75 - dStar) / 75) * (1 - tStar / 1.4) * 4.5;
          dangerScore += missileDanger;
        }
      }

      if (dangerScore > maxDangerObserved) {
        maxDangerObserved = dangerScore;
      }

      // C. Congestion & Friendly Fighter Separation
      let congestionScore = 0;
      for (const peer of aliveShips) {
        if (peer.id === ship.id || peer.team !== ship.team || peer.hullClass !== "strike_craft") {
          continue;
        }
        const toPeer = vecSub(peer.pos, ship.pos);
        const peerDist = vecDistance([0, 0], toPeer);
        if (peerDist < FIGHTER_CLEARANCE) {
          const headingTowardPeer = vecDot(candidateDir, vecNormalize(toPeer));
          if (headingTowardPeer > 0) {
            congestionScore += headingTowardPeer * (1 - peerDist / FIGHTER_CLEARANCE) * 1.8;
          }
        }
      }

      // D. Hysteresis / Anti-flicker: penalty for large changes from previous selected heading
      let flickerPenalty = 0;
      if (ship.lastSelectedSector !== undefined) {
        const prevAngle = (ship.lastSelectedSector * 2 * Math.PI) / SECTORS;
        const angleDiff = normalizeAngle(sectorAngle - prevAngle);
        flickerPenalty = 0.35 * (1 - Math.cos(angleDiff));
      }

      // E. Total utility evaluation
      const interestWeight = isDamaged ? 0.6 : 1.2;
      const dangerWeight = isDamaged ? 3.5 : 2.2;
      const score =
        interestScore * interestWeight -
        dangerScore * dangerWeight -
        congestionScore -
        flickerPenalty;

      if (score > maxScore) {
        maxScore = score;
        bestSector = k;
      }
    }

    ship.lastSelectedSector = bestSector;
    const finalHeading = (bestSector * 2 * Math.PI) / SECTORS;
    const speed =
      maxDangerObserved > 0.4 || phase === "attack" || phase === "egress"
        ? ship.maxSpeed
        : ship.maxSpeed * 0.7;

    return { heading: finalHeading, speed };
  }

  private updateShipMovement(
    ship: ShipState,
    target: ShipState | null,
    aliveShips: ShipState[],
    dt: number,
  ): void {
    let targetHeading = ship.heading;
    let desiredSpeed = 0;
    let cruiserVelocity: Vector2 | null = null;
    let corvetteVelocity: Vector2 | null = null;
    const flagship = aliveShips.find((s) => s.id === ship.flagshipId && s.team === ship.team);

    // 1. Independent Escorts (Corvettes with or without flagship)
    if (ship.hullClass === "corvette" && flagship) {
      const escorts = aliveShips.filter(
        (s) => s.team === ship.team && s.hullClass === "corvette" && s.flagshipId === flagship.id,
      );
      const index = escorts.findIndex((s) => s.id === ship.id);
      const slotAngle = flagship.heading + (index - (escorts.length - 1) / 2) * 0.45;
      const slot: Vector2 = [
        flagship.pos[0] + 260 * Math.cos(slotAngle),
        flagship.pos[1] + 260 * Math.sin(slotAngle),
      ];
      const toSlot = vecSub(slot, ship.pos);
      corvetteVelocity = vecAdd(flagship.velocity, vecScale(toSlot, 0.6));
      const speed = vecDistance([0, 0], corvetteVelocity);
      if (speed > ship.maxSpeed) {
        corvetteVelocity = vecScale(corvetteVelocity, ship.maxSpeed / speed);
      }

      const missile = this.findMissileTarget(ship, 360);
      const strikeCraft = aliveShips.filter(
        (s) =>
          s.team !== ship.team &&
          s.hullClass === "strike_craft" &&
          vecDistance(ship.pos, s.pos) <= 360,
      );
      const threat =
        missile ??
        (strikeCraft.length > 0
          ? strikeCraft.reduce((prev, curr) =>
              vecDistanceSq(ship.pos, curr.pos) < vecDistanceSq(ship.pos, prev.pos) ? curr : prev,
            )
          : null);
      targetHeading = slotAngle;
      if (vecDistance(ship.pos, flagship.pos) > 360) {
        // Regain the screen before turning outward to engage threats.
        targetHeading = Math.atan2(toSlot[1], toSlot[0]);
      } else if (threat) {
        const toThreat = vecSub(threat.pos, ship.pos);
        targetHeading = Math.atan2(toThreat[1], toThreat[0]);
      }
    } else if (
      ship.hullClass !== "corvette" &&
      ship.flagshipId &&
      aliveShips.some((s) => s.id === ship.flagshipId)
    ) {
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

        // Mutual repulsion between friendly battleships to prevent clumping
        if (friendlyBattleships.length > 1) {
          for (const peer of friendlyBattleships) {
            if (peer.id === ship.id) continue;
            const bsDist = vecDistance(ship.pos, peer.pos);
            const BS_CLEARANCE = 150;
            if (bsDist < BS_CLEARANCE) {
              const pushAway: Vector2 =
                bsDist > 1e-4
                  ? vecScale(vecSub(ship.pos, peer.pos), 1 / bsDist)
                  : [ship.id < peer.id ? 1 : -1, 0];
              const pushAngle = Math.atan2(pushAway[1], pushAway[0]);
              targetHeading = normalizeAngle(targetHeading * 0.7 + pushAngle * 0.3);
            }
          }
        }
      } else if (ship.hullClass === "cruiser") {
        // Navigate geometric arc slots with lateral thrusters while keeping the prow aimed.
        const friendlyCruisers = aliveShips
          .filter((s) => s.team === ship.team && s.hullClass === "cruiser")
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const cruiserIndex = friendlyCruisers.findIndex((s) => s.id === ship.id);
        const slotAngle = angleToTarget + (cruiserIndex - (friendlyCruisers.length - 1) / 2) * 0.38;
        const slot: Vector2 = [
          target.pos[0] - CRUISER_STANDOFF * Math.cos(slotAngle),
          target.pos[1] - CRUISER_STANDOFF * Math.sin(slotAngle),
        ];
        cruiserVelocity = vecScale(vecSub(slot, ship.pos), 0.6);

        for (const peer of friendlyCruisers) {
          if (peer.id === ship.id) continue;
          const distance = vecDistance(ship.pos, peer.pos);
          if (distance >= CRUISER_CLEARANCE) continue;
          const away: Vector2 =
            distance > 1e-6
              ? vecScale(vecSub(ship.pos, peer.pos), 1 / distance)
              : [ship.id < peer.id ? 1 : -1, 0];
          cruiserVelocity = vecAdd(
            cruiserVelocity,
            vecScale(away, ship.maxSpeed * (1 - distance / CRUISER_CLEARANCE)),
          );
        }

        // Continuous radial arrival avoids a thrust sign switch at the 360u reverse threshold.
        const toward: Vector2 = [Math.cos(angleToTarget), Math.sin(angleToTarget)];
        const radialSpeed = vecDot(cruiserVelocity, toward);
        const standoffSpeed = clamp(
          (dist - CRUISER_STANDOFF) * 0.6,
          -ship.maxSpeed * 0.5,
          ship.maxSpeed * 0.85,
        );
        cruiserVelocity = vecAdd(
          cruiserVelocity,
          vecScale(toward, Math.min(radialSpeed, standoffSpeed) - radialSpeed),
        );
        const speed = vecDistance([0, 0], cruiserVelocity);
        if (speed > ship.maxSpeed * 0.85) {
          cruiserVelocity = vecScale(cruiserVelocity, (ship.maxSpeed * 0.85) / speed);
        }
        targetHeading = angleToTarget;
      } else if (ship.hullClass === "corvette") {
        const peers = aliveShips.filter(
          (s) =>
            s.team === ship.team &&
            s.hullClass === "corvette" &&
            !aliveShips.some((leader) => leader.id === s.flagshipId && leader.team === s.team),
        );
        const index = peers.findIndex((s) => s.id === ship.id);
        targetHeading = angleToTarget + Math.PI * 0.4 + (index - (peers.length - 1) / 2) * 0.42;
        desiredSpeed = ship.maxSpeed * 0.75;
        let direction: Vector2 = [Math.cos(targetHeading), Math.sin(targetHeading)];
        for (const peer of aliveShips) {
          if (peer.id === ship.id || peer.team !== ship.team || peer.hullClass !== "corvette")
            continue;
          const distance = vecDistance(ship.pos, peer.pos);
          if (distance >= 65) continue;
          const away: Vector2 =
            distance > 1e-6
              ? vecScale(vecSub(ship.pos, peer.pos), 1 / distance)
              : [ship.id < peer.id ? 1 : -1, 0];
          direction = vecAdd(direction, vecScale(away, 2 * (1 - distance / 65)));
        }
        targetHeading = Math.atan2(direction[1], direction[0]);
      } else if (ship.hullClass === "strike_craft") {
        // Staggered staged attack runs: staging -> attack -> egress -> rejoin
        const maneuver = this.updateFighterCycle(ship, target, angleToTarget, dist, dt, aliveShips);
        targetHeading = maneuver.heading;
        desiredSpeed = maneuver.speed;
      } else {
        targetHeading = angleToTarget;
        desiredSpeed = ship.maxSpeed * 0.6;
      }
    }

    // Friendly ship spatial avoidance (breaks up conga lines & collisions between teammates)
    const nearbyFriendly = aliveShips.find((other) => {
      // Cruiser thrusters and physical clearance handle avoidance without changing bow aim.
      if (cruiserVelocity || corvetteVelocity) return false;
      if (other.id === ship.id || other.team !== ship.team) return false;
      if (ship.hullClass === "corvette" && other.hullClass === "corvette" && target) return false;
      // Fighter peers already use all-neighbor separation during non-attack maneuvers.
      if (
        ship.hullClass === "strike_craft" &&
        other.hullClass === "strike_craft" &&
        target &&
        ship.fighterPhase !== "attack"
      ) {
        return false;
      }
      const d = vecDistance(ship.pos, other.pos);
      return d < (ship.size + other.size) * 1.35;
    });
    if (nearbyFriendly) {
      const avoidVec = vecSub(ship.pos, nearbyFriendly.pos);
      const pushAngle = Math.atan2(avoidVec[1], avoidVec[0]);
      targetHeading = normalizeAngle(targetHeading * 0.65 + pushAngle * 0.35);
      desiredSpeed = Math.max(desiredSpeed * 0.5, ship.maxSpeed * 0.2);
    }

    // Deadlock detection & resolution: break up head-on jams, parallel lines & "triangles of fools"
    const isCapital = ship.hullClass === "battleship" || ship.hullClass === "cruiser";
    if (isCapital) {
      const collidingCapital = aliveShips.find(
        (other) =>
          other.id !== ship.id &&
          (other.hullClass === "battleship" || other.hullClass === "cruiser") &&
          vecDistance(ship.pos, other.pos) < (ship.size + other.size) * 1.35,
      );

      const forwardSpeed = vecDot(ship.velocity, [Math.cos(ship.heading), Math.sin(ship.heading)]);
      const isStuck = collidingCapital && Math.abs(forwardSpeed) < 15.0;

      if (isStuck) {
        ship.deadlockTimer = (ship.deadlockTimer ?? 0) + dt;
        if (ship.deadlockTimer > 0.8) {
          if (ship.deadlockBypassAngle === undefined) {
            const side = ship.id < collidingCapital.id ? 1 : -1;
            ship.deadlockBypassAngle = side * Math.PI * 0.6;
          }
          const bypassAngle = normalizeAngle(ship.heading + ship.deadlockBypassAngle);
          const bypassDir: Vector2 = [Math.cos(bypassAngle), Math.sin(bypassAngle)];
          if (cruiserVelocity) {
            cruiserVelocity = vecAdd(cruiserVelocity, vecScale(bypassDir, ship.maxSpeed * 0.9));
          } else {
            targetHeading = bypassAngle;
            desiredSpeed = ship.maxSpeed * 0.7;
          }
        }
      } else {
        ship.deadlockTimer = Math.max(0, (ship.deadlockTimer ?? 0) - dt * 2);
        if (ship.deadlockTimer <= 0) {
          ship.deadlockBypassAngle = undefined;
        }
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

    if (cruiserVelocity && target) {
      const toTarget = vecSub(target.pos, ship.pos);
      const bowError = normalizeAngle(Math.atan2(toTarget[1], toTarget[0]) - ship.heading);
      // Brake during initial acquisition instead of reversing in the wrong direction.
      const alignment = clamp(
        1 - Math.max(0, Math.abs(bowError) - CRUISER_BOW_LIMIT) / CRUISER_BOW_LIMIT,
        0,
        1,
      );
      cruiserVelocity = vecScale(cruiserVelocity, alignment);
      desiredSpeed = vecDot(cruiserVelocity, forwardVector);
    }

    if (corvetteVelocity) desiredSpeed = vecDot(corvetteVelocity, forwardVector);
    const thrusterVelocity = corvetteVelocity ?? cruiserVelocity;
    const lateralDamping = ship.hullClass === "strike_craft" ? 2.5 : 5.0;
    const newLateralSpeed = thrusterVelocity
      ? currentLateralSpeed +
        clamp(vecDot(thrusterVelocity, rightVector) - currentLateralSpeed, -110 * dt, 110 * dt)
      : currentLateralSpeed * Math.max(0, 1 - dt * lateralDamping);

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
        if (a.team === b.team && a.hullClass === "cruiser" && b.hullClass === "cruiser") continue;
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

  private resolveCruiserClearance(aliveShips: ShipState[]): void {
    const cruisers = aliveShips
      .filter((ship) => ship.hullClass === "cruiser")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // Revisit crowded chains because resolving one pair can compress a previous pair.
    for (let pass = 0; pass < Math.max(32, cruisers.length * 8); pass++) {
      let corrected = false;
      for (let i = 0; i < cruisers.length; i++) {
        for (let j = i + 1; j < cruisers.length; j++) {
          const a = cruisers[i];
          const b = cruisers[j];
          if (a.team !== b.team) continue;
          const clearance = Math.max(
            CRUISER_CLEARANCE,
            a.size * (a.shieldCurrent > 0 ? 1.4 : 1) + b.size * (b.shieldCurrent > 0 ? 1.4 : 1),
          );
          const distance = vecDistance(a.pos, b.pos);
          if (distance >= clearance) continue;
          const normal: Vector2 =
            distance > 1e-6 ? vecScale(vecSub(a.pos, b.pos), 1 / distance) : [-1, 0];
          const correction = vecScale(normal, (clearance - distance + 1e-6) * 0.5);
          a.pos = vecAdd(a.pos, correction);
          b.pos = vecSub(b.pos, correction);
          const closingSpeed = Math.min(0, vecDot(vecSub(a.velocity, b.velocity), normal));
          a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * 0.5));
          b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * 0.5));
          corrected = true;
        }
      }
      if (!corrected) break;
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

    // Asymmetric shield recharge delay: Capitals have massive continuous generators (0s delay),
    // cruisers have high-capacity cells (1.2s delay), light escorts have 2.5s-3.5s delay
    const delay =
      ship.shieldRechargeDelay ??
      (ship.hullClass === "battleship"
        ? 0.0
        : ship.hullClass === "cruiser"
          ? 1.2
          : ship.hullClass === "corvette"
            ? 2.5
            : 3.5);
    ship.shieldDelayTimer = delay;
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
