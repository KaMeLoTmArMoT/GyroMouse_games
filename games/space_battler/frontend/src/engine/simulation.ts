// Fixed-step coordinator: missions, navigation, contacts, and weapons share one firing instant.
import type {
  CombatAudioCue,
  CombatAudioEvent,
  CombatLogEvent,
  GroupOrder,
  ProjectileState,
  ShipState,
  TeamBattleStats,
  TurretMountState,
  Vector2,
  WeaponType,
} from "../types/combat";
import {
  type BattleMapId,
  createMapObstacles,
  type MapObstacle,
  resolveMapContacts,
  updateMapObstacles,
} from "./battleMaps";
import {
  type ActiveBeam,
  type BeamChannel,
  type BeamFireCallback,
  BeamLaserSystem,
} from "./beamLaserSystem";
import { moveCarrierRecovery, updateCarrierHangars } from "./carrierHangar";
import { CollisionContactSolver } from "./collisionContactSolver";
import type { CombatObserver } from "./combatTelemetry";
import type { CrewVeterancy } from "./crewVeterancy";
import { FighterMissionSystem, type FighterWingVisual } from "./fighterMissionSystem";
import { acquireMountTarget, prepareFireControlContext } from "./fireControl";
import { redeployFleetRemnants } from "./fleetBuilder";
import { HarmonicShieldSystem } from "./harmonicShieldSystem";
import { normalizeAngle, vecAdd, vecScale } from "./math2d";
import { navigationContext, prepareNavigationContext } from "./navigationContext";
import { type FlakBurstCallback, ProjectileEngine } from "./projectileEngine";
import { isCapitalShip } from "./shieldGeometry";
import { ShieldHavenSystem } from "./shieldHaven";
import { findNavigationTarget, updateShipNavigation } from "./shipNavigationSystem";
import { ShipWeaponSystem } from "./shipWeaponSystem";

export type { ActiveBeam, BeamFireCallback } from "./beamLaserSystem";
export { type FighterWingVisual, WING_WAVE_DELAY } from "./fighterMissionSystem";
export type { FlakBurstCallback } from "./projectileEngine";

const FIXED_STEP = 1 / 60;

export class ClientCombatSimulation {
  mapObstacles: MapObstacle[];
  readonly selectedMap: BattleMapId;
  constructor(selectedMap: BattleMapId = "empty_void") {
    this.selectedMap = selectedMap;
    this.mapObstacles = createMapObstacles(selectedMap);
  }
  readonly shieldHaven = new ShieldHavenSystem();
  private readonly releaseMapGuest = (ship: ShipState): void => {
    if (ship.havenState === "tethered") this.shieldHaven.release(ship.id);
  };
  readonly harmonicShields = new HarmonicShieldSystem();
  ships: ShipState[] = [];
  get projectiles(): ProjectileState[] {
    return this.projectileEngine.projectiles;
  }
  set projectiles(projectiles: ProjectileState[]) {
    this.projectileEngine.projectiles = projectiles;
  }
  activeBeams: ActiveBeam[] = [];
  orders: Map<number, GroupOrder> = new Map();
  crewVeterancy: Partial<Record<number, CrewVeterancy>> = {};
  timeElapsed = 0;
  private accumulator = 0;
  private previousPositions = new Map<string, Vector2>();
  private readonly fighterMissions = new FighterMissionSystem(this, (ship) =>
    this.emitAudioEvent("fighter_egress", ship.pos, ship.team, ship.id),
  );
  private readonly contactSolver = new CollisionContactSolver(this, (ship, team) =>
    this.weapons.destroyShip(ship, team),
  );
  private readonly projectileEngine = new ProjectileEngine({
    applyShipDamage: (...args) => this.weapons.applyDamage(...args),
    onMissileIntercept: (projectile, team, source, laserSource) => {
      this.stats[team].missilesIntercepted++;
      this.addCombatLog(`Hostile torpedo intercepted by ${source}!`, team, "intercept");
      if (laserSource)
        this.emitAudioEvent("laser_intercept", projectile.pos, team, laserSource.id, projectile.id);
    },
    onDetonate: (...args) => this.onFlakBurst?.(...args),
    onFlakAudio: (flak) =>
      this.emitAudioEvent("flak_burst", flak.pos, flak.ownerTeam, flak.ownerId),
  });
  private readonly beamLaserSystem = new BeamLaserSystem({
    getTime: () => this.timeElapsed,
    getProjectiles: () => this.projectiles,
    getMapObstacles: () => this.mapObstacles,
    updateTurretAim: (turret, dt, ship, targetPos) =>
      this.weapons.updateTurretAim(turret, dt, ship, targetPos),
    applyShipDamage: (channel, damage, origin) =>
      this.weapons.applyDamage(
        channel.target as ShipState,
        damage,
        channel.weapon,
        channel.ship.team,
        channel.ship.id,
        channel.turret.id,
        origin,
        channel,
      ),
    damageMissile: (channel, damage) =>
      this.projectileEngine.damageProjectile(
        channel.target as ProjectileState,
        damage,
        channel.ship.team,
        "beam battery",
        channel.ship,
      ),
    onBeamFire: (...args) => this.onBeamFire?.(...args),
  });
  private readonly weapons = new ShipWeaponSystem(
    this,
    this.fighterMissions,
    this.beamLaserSystem,
    this.projectileEngine,
    (ship, turret, pos) =>
      this.emitAudioEvent(
        "torpedo_launch",
        pos,
        ship.team,
        ship.id,
        turret.currentTargetId ?? undefined,
      ),
  );
  private get beamChannels(): Map<TurretMountState, BeamChannel> {
    return this.beamLaserSystem.channels;
  }
  onBeamFire: BeamFireCallback | null = null;
  onFlakBurst: FlakBurstCallback | null = null;
  onProjectileFire?: (type: WeaponType, pos: Vector2) => void;
  onShieldHit?: (pos: Vector2, intensity: number) => void;
  onWeaponImpact?: (
    ship: ShipState,
    origin: Vector2,
    shield: boolean,
    armor: boolean,
    hull: boolean,
  ) => void;
  onShipDestroyed?: (ship: ShipState) => void;
  onVictory?: (winnerTeam: number) => void;
  onAudioEvent?: (event: CombatAudioEvent) => void;
  // Bounded pending cues remain available when a consumer attaches after fleet creation.
  audioEvents: CombatAudioEvent[] = [];
  observer?: CombatObserver;
  stats: Record<number, TeamBattleStats> = {
    0: {
      damageDealt: 0,
      shieldDamageAbsorbed: 0,
      missilesIntercepted: 0,
      shipsLost: 0,
      recentDamageWindow: [],
    },
    1: {
      damageDealt: 0,
      shieldDamageAbsorbed: 0,
      missilesIntercepted: 0,
      shipsLost: 0,
      recentDamageWindow: [],
    },
  };
  combatLog: CombatLogEvent[] = [];
  winner: number | null = null;
  winnerDeclaredTime: number | null = null;

  getFighterWingVisuals(): FighterWingVisual[] {
    return this.fighterMissions.getVisuals();
  }

  getRollingDPS(team: number): number {
    const window = this.stats[team]?.recentDamageWindow ?? [];
    if (window.length === 0) return 0;
    const totalDmg = window.reduce((sum, w) => sum + w.damage, 0);
    return Math.round(totalDmg / 2.5);
  }

  addCombatLog(text: string, team: number, type: "kill" | "intercept" | "critical" = "kill"): void {
    const mins = Math.floor(this.timeElapsed / 60);
    const secs = Math.floor(this.timeElapsed % 60);
    const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    this.combatLog.unshift({
      id: `log_${this.combatLog.length}_${Math.random().toString(36).substring(2, 6)}`,
      time: this.timeElapsed,
      text: `[${timeStr}] ${text}`,
      team,
      type,
    });
    if (this.combatLog.length > 30) this.combatLog.pop();
  }

  addShip(ship: ShipState): void {
    ship.havenParentId ??= null;
    ship.havenSlotId ??= null;
    ship.havenState ??= "none";
    ship.havenGuestCount ??= 0;
    this.ships.push(ship);
    if (ship.isAlive) this.emitAudioEvent("warp_ingress", ship.pos, ship.team, ship.id);
  }

  spawnCapitalWrecks(ship: ShipState): void {
    if (ship.isDebris || !isCapitalShip(ship)) return;
    const count = ship.hullClass === "cruiser" ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const angle = ship.heading + (i * Math.PI * 2) / count;
      const direction: Vector2 = [Math.cos(angle), Math.sin(angle)];
      this.ships.push({
        id: `${ship.id}_wreck_${i}`,
        name: `${ship.name} wreck`,
        team: -1,
        groupId: -1,
        hullClass: ship.hullClass,
        pos: vecAdd(ship.pos, vecScale(direction, ship.size * 0.35)),
        velocity: vecAdd(ship.velocity, vecScale(direction, 8)),
        heading: angle,
        angularVelocity: i % 2 === 0 ? 0.12 : -0.16,
        maxSpeed: 0,
        turnRate: 0,
        size: ship.size * 0.28,
        shieldMax: 0,
        shieldCurrent: 0,
        shieldRegen: 0,
        shieldDelayTimer: 0,
        armorMax: 0,
        armorCurrent: 0,
        armorRating: 0,
        hullMax: 75,
        hullCurrent: 75,
        turrets: [],
        cost: 0,
        isAlive: true,
        isDebris: true,
        debrisLifetime: 16 + i,
      });
    }
  }

  drainAudioEvents(): CombatAudioEvent[] {
    const events = this.audioEvents;
    this.audioEvents = [];
    return events;
  }

  private emitAudioEvent(
    type: CombatAudioCue,
    pos: Vector2,
    team: number,
    sourceId: string,
    targetId?: string,
  ): void {
    const event: CombatAudioEvent = {
      type,
      time: this.timeElapsed,
      pos: [...pos],
      team,
      sourceId,
      ...(targetId ? { targetId } : {}),
    };
    this.audioEvents.push(event);
    if (this.audioEvents.length > 256) this.audioEvents.shift();
    this.onAudioEvent?.(event);
  }

  setGroupOrder(order: GroupOrder): void {
    this.orders.set(order.groupId, order);
  }

  continueBattleWithRemnants(): void {
    this.ships = this.ships.filter((ship) => ship.isAlive && !ship.isDebris);
    redeployFleetRemnants(this.ships);
    this.projectiles = [];
    this.activeBeams = [];
    this.beamLaserSystem.clear();
    this.harmonicShields.clear();
    this.shieldHaven.clear();
    this.fighterMissions.clear();
    this.contactSolver.clear();
    this.previousPositions.clear();
    this.accumulator = 0;
    this.timeElapsed = 0;
    this.mapObstacles = createMapObstacles(this.selectedMap);
    this.audioEvents = [];
    for (const ship of this.ships)
      this.emitAudioEvent("warp_ingress", ship.pos, ship.team, ship.id);
    this.winner = null;
    this.winnerDeclaredTime = null;
    this.combatLog = [];
    this.weapons.resetDamageTotals();
    for (const team of [0, 1]) {
      this.stats[team] = {
        damageDealt: 0,
        shieldDamageAbsorbed: 0,
        missilesIntercepted: 0,
        shipsLost: 0,
        recentDamageWindow: [],
      };
    }
  }

  update(dt: number, onStepDuration?: (durationMs: number) => void): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.winner === -1) return;
    this.accumulator += dt;
    // Bound catch-up work after a suspended render; retain the remaining combat time.
    let steps = 0;
    while (this.accumulator + 1e-9 >= FIXED_STEP && steps++ < 240 && this.winner !== -1) {
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      if (onStepDuration) {
        const start = performance.now();
        this.tick(FIXED_STEP);
        onStepDuration(performance.now() - start);
      } else {
        this.tick(FIXED_STEP);
      }
    }
  }

  private tick(dt: number): void {
    this.timeElapsed += dt;
    updateMapObstacles(this.mapObstacles, this.timeElapsed);
    this.ships = this.ships.filter((ship) => !ship.isDebris || ship.isAlive);
    updateCarrierHangars(this.ships, this.timeElapsed, (ship, amount) =>
      this.observer?.onShieldRegen(ship, amount),
    );
    const combatShips = this.ships.filter((ship) => !ship.isDebris);
    const wrecks = this.ships.filter((ship) => ship.isDebris);
    const wreckStarts = new Map(wrecks.map((ship) => [ship.id, [...ship.pos] as Vector2]));
    for (const wreck of wrecks) {
      wreck.debrisLifetime = Math.max(0, (wreck.debrisLifetime ?? 0) - dt);
      wreck.isAlive = wreck.debrisLifetime > 0;
      wreck.pos = vecAdd(wreck.pos, vecScale(wreck.velocity, dt));
      wreck.heading = normalizeAngle(wreck.heading + (wreck.angularVelocity ?? 0) * dt);
    }
    // Observe broken shields before this step's regeneration can obscure the entry trigger.
    const externalShips = combatShips.filter((ship) => !ship.isDocked && !ship.carrierRecovering);
    this.shieldHaven.update(externalShips, this.timeElapsed);
    for (const ship of combatShips) {
      if (!ship.isAlive || ship.isDocked) continue;
      for (const turret of ship.turrets)
        if (!this.beamChannels.has(turret))
          turret.cooldownTimer = Math.max(0, turret.cooldownTimer - dt);
      if (ship.shieldDelayTimer > 0) {
        ship.shieldDelayTimer = Math.max(0, ship.shieldDelayTimer - dt);
      } else if (ship.shieldCurrent < ship.shieldMax) {
        const before = this.observer ? ship.shieldCurrent : 0;
        ship.shieldCurrent = Math.min(ship.shieldMax, ship.shieldCurrent + ship.shieldRegen * dt);
        this.observer?.onShieldRegen(ship, ship.shieldCurrent - before);
      }
    }
    // Reaching full shields ends support before subsequent impacts can reopen the deficit.
    this.harmonicShields.cleanup(combatShips, this.timeElapsed - dt);
    const aliveShips = combatShips.filter((s) => s.isAlive && !s.isDocked);
    this.previousPositions = new Map([
      ...wreckStarts,
      ...aliveShips.map((ship) => [ship.id, [...ship.pos] as Vector2] as const),
    ]);
    this.ensureFighterWings(aliveShips);
    this.fighterMissions.updateWings(aliveShips);
    const navigationTargets = new Map<string, ShipState | null>();
    const movements = new Map<
      string,
      { pos: Vector2; velocity: Vector2; heading: number; angularVelocity: number }
    >();
    // Allocate small focus squads in stable order, independent of the render/storage order.
    const previousTargets = new Map(aliveShips.map((ship) => [ship.id, ship.navigationTargetId]));
    for (const ship of aliveShips) ship.navigationTargetId = undefined;
    const navigation = navigationContext(aliveShips) ?? prepareNavigationContext(aliveShips);
    navigation.navigationAssignments.clear();
    navigation.capitalAssignments.clear();
    for (const ship of [...aliveShips].sort((a, b) => a.id.localeCompare(b.id))) {
      const order = this.orders.get(ship.groupId) ?? {
        groupId: ship.groupId,
        priority: "nearest",
        stance: "optimal_range",
      };
      const target = findNavigationTarget(
        ship,
        order,
        aliveShips,
        previousTargets.get(ship.id),
        this.fighterMissions.targetId(ship),
      );
      ship.navigationTargetId = target?.id;
      navigation.adjust(navigation.navigationAssignments, ship, target?.id, 1);
      navigationTargets.set(ship.id, target);
    }
    for (const ship of aliveShips) {
      const target = navigationTargets.get(ship.id) ?? null;
      const previous = { pos: ship.pos, velocity: ship.velocity, heading: ship.heading };
      if (!moveCarrierRecovery(ship, aliveShips, dt, this.timeElapsed, this.projectiles))
        this.updateShipMovement(ship, target, aliveShips, dt);
      movements.set(ship.id, {
        pos: ship.pos,
        velocity: ship.velocity,
        heading: ship.heading,
        angularVelocity: normalizeAngle(ship.heading - previous.heading) / dt,
      });
      Object.assign(ship, previous);
    }
    for (const ship of aliveShips) Object.assign(ship, movements.get(ship.id));
    this.shieldHaven.refreshAmplification(combatShips);
    const repulsorSteps = new Map<string, number>();
    const collisionShips = [...aliveShips, ...wrecks.filter((ship) => ship.isAlive)];
    this.resolveShipCollisions(collisionShips, dt, false, repulsorSteps);
    this.contactSolver.resolveCruiserClearance(aliveShips);
    this.shieldHaven.attachGuests(aliveShips, dt);
    this.resolveShipCollisions(collisionShips, dt, true, repulsorSteps);
    resolveMapContacts(
      collisionShips,
      this.mapObstacles,
      this.previousPositions,
      dt,
      this.releaseMapGuest,
    );
    this.shieldHaven.refreshAmplification(combatShips);
    // All mounts decide at one common firing instant, before simultaneous shots resolve.
    const shots: Array<() => void> = [];
    prepareFireControlContext(aliveShips);
    const missileLocks: Array<{ targetId: string; weapon: TurretMountState["weapon"] }> = [];
    for (const ship of aliveShips) {
      if (!ship.isAlive) continue;
      for (const turret of ship.turrets) {
        const channel = this.beamChannels.get(turret);
        if (channel) {
          if (this.beamLaserSystem.prepareBeam(channel, dt))
            shots.push(() => this.updateBeam(channel, true));
          continue;
        }
        const solution = acquireMountTarget(
          ship,
          turret,
          navigationTargets.get(ship.id) ?? null,
          aliveShips,
          this.projectiles,
          missileLocks,
        );
        turret.currentTargetId = solution?.target.id ?? null;
        turret.currentTargetKind = solution?.kind;
        const trackingTarget = navigationTargets.get(ship.id);
        const aimed = this.weapons.updateTurretAim(
          turret,
          dt,
          ship,
          solution?.aim ?? trackingTarget?.pos ?? null,
        );
        if (this.observer && (turret.id.endsWith("_port") || turret.id.endsWith("_stbd")))
          this.observer.onMountDecision(ship, turret, Boolean(solution), aimed, dt);
        if (!solution || !aimed || turret.cooldownTimer > 0) continue;
        const targetShip = solution.kind === "ship" ? (solution.target as ShipState) : null;
        const targetMissile =
          solution.kind === "missile" ? (solution.target as ProjectileState) : null;
        if (targetShip && turret.weapon.weaponType === "missile")
          missileLocks.push({ targetId: targetShip.id, weapon: turret.weapon });
        shots.push(() => this.fireWeapon(ship, turret, solution.aim, targetShip, targetMissile));
      }
    }
    for (const fire of shots) fire();
    this.updateProjectiles(
      dt,
      this.ships.filter((ship) => ship.isAlive && !ship.isDocked),
    );
    this.harmonicShields.update(
      combatShips,
      this.timeElapsed,
      dt,
      this.onBeamFire,
      (recipient, amount) => this.observer?.onShieldRegen(recipient, amount),
    );
    this.shieldHaven.cleanup(combatShips);
    this.activeBeams = [
      ...this.beamLaserSystem.collectActiveBeams(),
      ...this.harmonicShields.collectActiveBeams(),
    ];
    const cutoff = this.timeElapsed - 2.5;
    for (const team of [0, 1]) {
      this.stats[team].recentDamageWindow = this.stats[team].recentDamageWindow.filter(
        (w) => w.time > cutoff,
      );
    }
    this.updateWinnerState();
    this.observer?.onTick(this.timeElapsed, dt, this.ships, this.projectiles);
  }

  private updateWinnerState(): void {
    if (this.winner === null && this.timeElapsed > 1.0) {
      const blueAlive = this.ships.some((s) => s.team === 0 && s.isAlive);
      const redAlive = this.ships.some((s) => s.team === 1 && s.isAlive);
      if (!blueAlive && redAlive) {
        this.winner = 1;
        this.winnerDeclaredTime = this.timeElapsed;
        this.addCombatLog("Alien fleet destroyed all Terran vessels!", 1, "critical");
      } else if (!redAlive && blueAlive) {
        this.winner = 0;
        this.winnerDeclaredTime = this.timeElapsed;
        this.addCombatLog("Terran fleet achieved complete tactical victory!", 0, "critical");
      }
      if (this.timeElapsed >= 300.0 && this.winner === null) {
        this.winner = -1;
        this.winnerDeclaredTime = 300.0;
        this.addCombatLog("Tactical Stalemate: 300s combat limit reached.", -1, "critical");
      }
      if (this.winner !== null) this.onVictory?.(this.winner);
    }
  }

  private ensureFighterWings(aliveShips: ShipState[]): void {
    this.fighterMissions.ensureWings(aliveShips);
  }

  private updateFighterCycle(
    ship: ShipState,
    target: ShipState,
    dt: number,
    aliveShips: ShipState[],
  ): { heading: number; speed: number } {
    return this.fighterMissions.updateCycle(ship, target, dt, aliveShips);
  }

  private updateShipMovement(
    ship: ShipState,
    target: ShipState | null,
    aliveShips: ShipState[],
    dt: number,
  ): void {
    updateShipNavigation(ship, target, aliveShips, dt, this, (...args) =>
      this.updateFighterCycle(...args),
    );
  }

  private resolveShipCollisions(
    aliveShips: ShipState[],
    dt: number,
    tetheredPass: boolean,
    repulsorSteps = new Map<string, number>(),
  ): void {
    this.contactSolver.resolveShipCollisions(aliveShips, dt, tetheredPass, repulsorSteps);
  }

  private fireWeapon(
    ship: ShipState,
    turret: TurretMountState,
    targetPos: Vector2,
    targetShip: ShipState | null,
    targetMissile: ProjectileState | null = null,
  ): void {
    this.weapons.fireWeapon(ship, turret, targetPos, targetShip, targetMissile);
  }

  private updateBeam(channel: BeamChannel, aimed: boolean): void {
    this.beamLaserSystem.updateBeam(channel, aimed);
  }

  private updateProjectiles(dt: number, aliveShips: ShipState[]): void {
    this.projectileEngine.updateProjectiles(
      dt,
      aliveShips,
      this.previousPositions,
      this.mapObstacles,
    );
  }
}
