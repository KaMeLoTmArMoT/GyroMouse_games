import type {
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";
import type { BeamChannel, BeamLaserSystem } from "./beamLaserSystem";
import type { FighterMissionSystem } from "./fighterMissionSystem";
import { inMountArc, mountPosition, slewTurret } from "./fireControl";
import {
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";
import type { ProjectileEngine } from "./projectileEngine";
import { pointDefenseMode, projectileLifetime, projectileMaxHp } from "./shipProfiles";
import type { ClientCombatSimulation } from "./simulation";

type WeaponContext = Pick<
  ClientCombatSimulation,
  | "timeElapsed"
  | "projectiles"
  | "observer"
  | "shieldHaven"
  | "stats"
  | "addCombatLog"
  | "onWeaponImpact"
  | "onShieldHit"
  | "onShipDestroyed"
  | "onBeamFire"
  | "onProjectileFire"
  | "spawnCapitalWrecks"
>;

const FIXED_STEP = 1 / 60;

export class ShipWeaponSystem {
  private projectileCounter = 0;
  private damageTotals = [0, 0];
  private shieldTotals = [0, 0];
  private readonly context: WeaponContext;
  private readonly missions: FighterMissionSystem;
  private readonly beams: BeamLaserSystem;
  private readonly projectiles: ProjectileEngine;
  private readonly onTorpedoLaunch: (
    ship: ShipState,
    turret: TurretMountState,
    pos: Vector2,
  ) => void;

  constructor(
    context: WeaponContext,
    missions: FighterMissionSystem,
    beams: BeamLaserSystem,
    projectiles: ProjectileEngine,
    onTorpedoLaunch: (ship: ShipState, turret: TurretMountState, pos: Vector2) => void,
  ) {
    this.context = context;
    this.missions = missions;
    this.beams = beams;
    this.projectiles = projectiles;
    this.onTorpedoLaunch = onTorpedoLaunch;
  }

  resetDamageTotals(): void {
    this.damageTotals = [0, 0];
    this.shieldTotals = [0, 0];
  }

  updateTurretAim(
    turret: TurretMountState,
    dt: number,
    ship: ShipState,
    targetPos: Vector2 | null,
  ): boolean {
    if (!targetPos) return false;
    const rotatedOffset = rotatePoint(turret.offset, ship.heading);
    const turretWorldPos = vecAdd(ship.pos, rotatedOffset);
    const toTarget = vecSub(targetPos, turretWorldPos);
    const desiredWorldAngle = Math.atan2(toTarget[1], toTarget[0]);
    const desiredLocal = normalizeAngle(desiredWorldAngle - ship.heading);
    slewTurret(turret, desiredLocal, dt);
    const isInArc = inMountArc(ship, turret, targetPos);
    const alignTolerance = turret.isSpinalGimbal ? 0.08 : 0.15;
    const isAligned =
      Math.abs(normalizeAngle(desiredLocal - turret.currentLocalAngle)) < alignTolerance;
    return isInArc && isAligned;
  }

  fireWeapon(
    ship: ShipState,
    turret: TurretMountState,
    targetPos: Vector2,
    targetShip: ShipState | null,
    targetMissile: ProjectileState | null = null,
  ): void {
    const context = this.context;
    const spawnPos = mountPosition(ship, turret);
    const isBeam = turret.weapon.projectileSpeed <= 0;
    const laserPD = pointDefenseMode(turret.weapon) === "laser";
    const beamTarget = targetShip ?? targetMissile;
    if (
      isBeam &&
      (!beamTarget ||
        (targetMissile && (targetMissile.hp <= 0 || targetMissile.lifetime <= 0)) ||
        vecDistance(spawnPos, beamTarget.pos) > turret.weapon.range ||
        !inMountArc(ship, turret, beamTarget.pos))
    )
      return;
    if ((!isBeam || turret.weapon.weaponType !== "beam_laser") && !laserPD) {
      turret.cooldownTimer = turret.weapon.cooldown;
      turret.lastFiredTime = context.timeElapsed;
    }
    if (laserPD) turret.lastFiredTime = context.timeElapsed;
    context.observer?.onShot(context.timeElapsed, ship, turret);
    this.missions.onShot(ship, targetShip);
    // Other zero-speed weapons retain their existing instantaneous hitscan behavior.
    if (isBeam) {
      if (turret.weapon.weaponType === "beam_laser" && beamTarget) {
        this.beams.startBeam(ship, turret, beamTarget, targetShip ? "ship" : "missile");
        return;
      }
      if (targetShip) {
        const beamColor = ship.team === 0 ? "#38bdf8" : "#ef4444";
        this.applyDamage(
          targetShip,
          laserPD ? 110 * FIXED_STEP : turret.weapon.damage,
          turret.weapon,
          ship.team,
          ship.id,
          turret.id,
          spawnPos,
        );
        if (context.onBeamFire)
          context.onBeamFire(spawnPos, targetShip.pos, beamColor, 2.8, ship.team);
      } else if (targetMissile) {
        this.projectiles.damageProjectile(
          targetMissile,
          laserPD ? 110 * FIXED_STEP : turret.weapon.damage,
          ship.team,
          laserPD ? "laser PD" : "beam battery",
          ship,
        );
        context.onBeamFire?.(
          spawnPos,
          targetMissile.pos,
          ship.team === 0 ? "#38bdf8" : "#ef4444",
          2.8,
          ship.team,
        );
      }
      return;
    }
    this.projectileCounter += 1;
    const toTarget = vecNormalize(vecSub(targetPos, spawnPos));
    const tubeIndex = ship.turrets.indexOf(turret);
    const launchSpread =
      ship.hullClass === "missile_frigate" && turret.weapon.weaponType === "missile"
        ? (([5, -5, 30, -30][tubeIndex] ?? 0) * Math.PI) / 180
        : 0;
    const flakSpread = turret.weapon.flak ? Math.sin(this.projectileCounter * 12.9898) * 0.035 : 0;
    const velocity = vecScale(
      rotatePoint(toTarget, launchSpread + flakSpread),
      turret.weapon.projectileSpeed,
    );
    const lifetime = projectileLifetime(turret.weapon);
    context.projectiles.push({
      id: `proj_${this.projectileCounter}`,
      weaponType: turret.weapon.weaponType,
      weapon: {
        ...turret.weapon,
        flak: turret.weapon.flak ? { ...turret.weapon.flak } : undefined,
      },
      damage: turret.weapon.damage,
      ownerId: ship.id,
      ownerTeam: ship.team,
      ...(context.observer ? { ownerMountId: turret.id } : {}),
      pos: spawnPos,
      velocity,
      lifetime,
      targetId: turret.currentTargetId,
      hp: projectileMaxHp(turret.weapon),
      maxHp: projectileMaxHp(turret.weapon),
      isFlakBurst: Boolean(turret.weapon.flak),
    });
    context.onProjectileFire?.(turret.weapon.weaponType, [...spawnPos]);
    if (turret.weapon.weaponType === "missile") this.onTorpedoLaunch(ship, turret, spawnPos);
  }

  applyDamage(
    ship: ShipState,
    rawDamage: number,
    weapon: WeaponDefinition,
    attackerTeam?: number,
    attackerId?: string,
    mountId?: string,
    impactOrigin?: Vector2,
    channel?: BeamChannel,
  ): void {
    const context = this.context;
    if (!ship.isAlive || ship.isDocked) return;
    if (ship.isDebris) {
      ship.hullCurrent = Math.max(0, ship.hullCurrent - rawDamage * weapon.hullMultiplier);
      if (impactOrigin) context.onWeaponImpact?.(ship, impactOrigin, false, false, true);
      if (ship.hullCurrent <= 0) this.destroyShip(ship);
      return;
    }
    const parent = weapon.shieldMultiplier > 0 ? context.shieldHaven.protectedParent(ship) : null;
    if (parent && rawDamage > 0) {
      const overflowMultiplier = context.shieldHaven.overflowMultiplier(parent);
      const before = context.observer
        ? [parent.shieldCurrent, parent.armorCurrent, parent.hullCurrent]
        : null;
      this.resetShieldDelay(parent);
      const shieldDamage = rawDamage * weapon.shieldMultiplier;
      const absorbed = this.applyShieldDamage(parent, shieldDamage);
      this.recordAttackerDamage(attackerTeam, absorbed);
      if (before)
        context.observer?.onDamage(parent, attackerId, mountId, weapon.weaponType, before);
      if (impactOrigin) context.onWeaponImpact?.(parent, impactOrigin, true, false, false);
      rawDamage = absorbed >= shieldDamage ? 0 : rawDamage - absorbed / weapon.shieldMultiplier;
      rawDamage *= overflowMultiplier;
      if (rawDamage <= 0) return;
    }
    if (!context.observer && !context.onWeaponImpact) {
      this.applyDamageInternal(ship, rawDamage, weapon, attackerTeam, channel);
      return;
    }
    const before = [ship.shieldCurrent, ship.armorCurrent, ship.hullCurrent];
    this.applyDamageInternal(ship, rawDamage, weapon, attackerTeam, channel);
    context.observer?.onDamage(ship, attackerId, mountId, weapon.weaponType, before);
    if (impactOrigin) {
      const shield = ship.shieldCurrent < before[0];
      const armor = ship.armorCurrent < before[1];
      const hull = ship.hullCurrent < before[2];
      if (shield || armor || hull)
        context.onWeaponImpact?.(ship, impactOrigin, shield, armor, hull);
    }
  }

  private applyDamageInternal(
    ship: ShipState,
    rawDamage: number,
    weapon: WeaponDefinition,
    attackerTeam?: number,
    channel?: BeamChannel,
  ): void {
    if (!ship.isAlive) return;
    this.resetShieldDelay(ship);
    let remaining = rawDamage;
    let totalAbsorbedOrDealt = 0;
    if (ship.shieldCurrent > 0) {
      const shieldDmg = remaining * weapon.shieldMultiplier;
      const absorbed = this.applyShieldDamage(ship, shieldDmg);
      totalAbsorbedOrDealt += absorbed;
      if (absorbed >= shieldDmg) {
        this.recordAttackerDamage(attackerTeam, totalAbsorbedOrDealt);
        return;
      }
      remaining -= absorbed / weapon.shieldMultiplier;
    }
    if (ship.armorCurrent > 0 && remaining > 0) {
      // A beam's armor penetration is based on its full pulse, not the tiny tick size.
      const penetration = channel ? weapon.damage : remaining;
      const mitigation = penetration / (penetration + ship.armorRating);
      const mitigated = remaining * weapon.armorMultiplier * mitigation;
      if (ship.armorCurrent >= mitigated) {
        ship.armorCurrent -= mitigated;
        totalAbsorbedOrDealt += mitigated;
        this.recordAttackerDamage(attackerTeam, totalAbsorbedOrDealt);
        return;
      }
      totalAbsorbedOrDealt += ship.armorCurrent;
      remaining -= ship.armorCurrent / (weapon.armorMultiplier * mitigation);
      ship.armorCurrent = 0;
    }
    if (remaining > 0) {
      const hullDmg = remaining * weapon.hullMultiplier;
      totalAbsorbedOrDealt += Math.min(ship.hullCurrent, hullDmg);
      ship.hullCurrent = Math.max(0, ship.hullCurrent - hullDmg);
      if (ship.hullCurrent <= 0) this.destroyShip(ship, attackerTeam);
    }
    this.recordAttackerDamage(attackerTeam, totalAbsorbedOrDealt);
  }

  private resetShieldDelay(ship: ShipState): void {
    ship.shieldDelayTimer =
      ship.shieldRechargeDelay ??
      (ship.hullClass === "battleship" ? 1.5 : ship.hullClass === "cruiser" ? 1.2 : 3.5);
  }

  private applyShieldDamage(ship: ShipState, damage: number): number {
    const absorbed = Math.min(ship.shieldCurrent, damage);
    ship.shieldCurrent -= absorbed;
    this.shieldTotals[ship.team] += absorbed;
    this.context.stats[ship.team].shieldDamageAbsorbed = Math.round(this.shieldTotals[ship.team]);
    if (absorbed > 0) this.context.onShieldHit?.([...ship.pos], Math.min(1, absorbed / 100));
    if (ship.shieldCurrent <= 0) this.context.shieldHaven.releaseGuests(ship.id);
    return absorbed;
  }

  destroyShip(ship: ShipState, attackerTeam?: number): void {
    if (!ship.isAlive) return;
    ship.isAlive = false;
    if (ship.isDebris) return;
    this.context.spawnCapitalWrecks(ship);
    this.context.shieldHaven.refreshAmplification();
    this.context.shieldHaven.releaseGuests(ship.id);
    this.context.stats[ship.team].shipsLost += 1;
    this.context.onShipDestroyed?.(ship);
    const killerName = attackerTeam === 0 ? "Terran fleet" : "Alien swarm";
    this.context.addCombatLog(
      `${ship.name} eliminated by ${killerName}!`,
      attackerTeam ?? (ship.team === 0 ? 1 : 0),
      "kill",
    );
  }

  private recordAttackerDamage(attackerTeam: number | undefined, amount: number): void {
    if (attackerTeam === undefined || amount <= 0) return;
    const teamStats = this.context.stats[attackerTeam];
    if (!teamStats) return;
    this.damageTotals[attackerTeam] += amount;
    teamStats.damageDealt = Math.round(this.damageTotals[attackerTeam]);
    teamStats.recentDamageWindow.push({ time: this.context.timeElapsed, damage: amount });
  }
}
