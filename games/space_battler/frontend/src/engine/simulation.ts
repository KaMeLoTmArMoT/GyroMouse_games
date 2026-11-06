// Fixed-step combat simulation with independent mount acquisition and coordinated fleet maneuvers.

import type {
  CombatAudioCue,
  CombatAudioEvent,
  CombatLogEvent,
  FighterPhase,
  GroupOrder,
  ProjectileState,
  ShipState,
  TeamBattleStats,
  TurretMountState,
  Vector2,
  WeaponDefinition,
  WeaponType,
  WingPhase,
} from "../types/combat";
import type { CombatObserver } from "./combatTelemetry";
import {
  acquireMountTarget,
  damagedTargetPriority,
  inMountArc,
  mountPosition,
  slewTurret,
  squadFocusPriority,
  sweptHit,
} from "./fireControl";
import { buildFleetFromSlots } from "./fleetBuilder";
import { clampLateralVelocity } from "./flightBehaviors";
import {
  ARENA_HARD_PULL_RADIUS,
  ARENA_RADIUS,
  arenaVelocity,
  capitalIntent,
  dogfightTarget,
  escortVelocity,
  fighterDispersal,
  fighterIngressHeading,
  limitVelocity,
  safeRally,
  separation,
  spinalEscape,
} from "./flightControl";
import type { RangePhase } from "./flightCycles";
import {
  clamp,
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";
import {
  activeShieldRadius,
  capitalSeparationDistance,
  shieldEnvelopeRadius,
  shieldRepulsorRadius,
} from "./shieldGeometry";
import { havenHullClearance, ShieldHavenSystem, sharesShieldHaven } from "./shieldHaven";
import { SHIP_DOCTRINES } from "./shipDoctrines";
import {
  isHeavyTorpedo,
  pointDefenseMode,
  projectileLifetime,
  projectileMaxHp,
} from "./shipProfiles";

export type BeamFireCallback = (
  from: Vector2,
  to: Vector2,
  color: string,
  width: number,
  ownerTeam: number,
  channeled?: boolean,
) => void;
export type FlakBurstCallback = (pos: Vector2, radius: number, ownerTeam: number) => void;

const FIGHTER_STANDOFF = 520;
const FIGHTER_CLEARANCE = 45;
const WING_SIZE = 4;
export const WING_WAVE_DELAY = 1.7;
const WING_RELAUNCH_DELAY = 0.25;
const WING_RALLY_TOLERANCE = 65;

interface FighterWing {
  team: number;
  groupId: number;
  index: number;
  members: string[];
  phase: WingPhase;
  phaseStarted: number;
  launchAt: number;
  lastLaunchAt?: number;
  targetId: string | null;
  heading: number;
  rally: Vector2;
  assembledAt?: number;
  engagementStarted?: number;
  hasLaunched?: boolean;
}

export interface FighterWingVisual {
  team: number;
  groupId: number;
  wave: number;
  members: readonly string[];
  phase: WingPhase;
  targetId: string | null;
  heading: number;
}
const FIXED_STEP = 1 / 60;
const MAX_REPULSOR_STEP = 4;
const BEAM_TICK_FRAMES = 6;
const BEAM_TICKS = 12;

interface BeamChannel {
  ship: ShipState;
  turret: TurretMountState;
  target: ShipState | ProjectileState;
  kind: "ship" | "missile";
  weapon: WeaponDefinition;
  frames: number;
}

export interface ActiveBeam {
  id: string;
  from: Vector2;
  to: Vector2;
  ownerTeam: number;
}

export class ClientCombatSimulation {
  readonly shieldHaven = new ShieldHavenSystem();
  ships: ShipState[] = [];
  projectiles: ProjectileState[] = [];
  activeBeams: ActiveBeam[] = [];
  orders: Map<number, GroupOrder> = new Map();
  timeElapsed = 0;
  private projectileCounter = 0;
  private fighterWings: FighterWing[] = [];
  private accumulator = 0;
  private contacts = new Set<string>();
  private previousPositions = new Map<string, Vector2>();
  private beamChannels = new Map<TurretMountState, BeamChannel>();
  private damageTotals = [0, 0];
  private shieldTotals = [0, 0];
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
    const groupCounts = new Map<string, number>();
    return this.fighterWings.map((wing) => {
      const key = `${wing.team}:${wing.groupId}`;
      const wave = (groupCounts.get(key) ?? 0) + 1;
      groupCounts.set(key, wave);
      return {
        team: wing.team,
        groupId: wing.groupId,
        wave,
        members: [...wing.members],
        phase: wing.phase,
        targetId: wing.targetId,
        heading: wing.heading,
      };
    });
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
    if (this.combatLog.length > 30) {
      this.combatLog.pop();
    }
  }

  addShip(ship: ShipState): void {
    ship.havenParentId ??= null;
    ship.havenSlotId ??= null;
    ship.havenState ??= "none";
    ship.havenGuestCount ??= 0;
    this.ships.push(ship);
    if (ship.isAlive) this.emitAudioEvent("warp_ingress", ship.pos, ship.team, ship.id);
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
    this.ships = this.ships.filter((ship) => ship.isAlive);
    for (const team of [0, 1]) {
      const survivors = this.ships.filter((ship) => ship.team === team);
      const formation = buildFleetFromSlots(
        survivors,
        team,
        team === 0 ? -1100 : 1100,
        team === 0 ? 0 : Math.PI,
      );
      const remaining = [...survivors];
      const originalIds = new Map<string, string>();
      for (const spawn of formation) {
        const index = remaining.findIndex(
          (ship) => ship.groupId === spawn.groupId && ship.hullClass === spawn.hullClass,
        );
        const [ship] = remaining.splice(index, 1);
        originalIds.set(spawn.id, ship.id);
        ship.pos = spawn.pos;
        ship.velocity = [0, 0];
        ship.heading = spawn.heading;
        ship.shieldCurrent = ship.shieldMax;
        ship.shieldDelayTimer = 0;
        ship.flagshipId = spawn.flagshipId;
        // All of these describe the previous engagement, whose clock is about to reset.
        ship.fighterPhase = undefined;
        ship.wingIndex = undefined;
        ship.wingSlot = undefined;
        ship.safeHavenId = undefined;
        ship.safeHavenTimer = undefined;
        ship.lastSelectedSector = undefined;
        ship.dogfightTargetId = undefined;
        ship.lastThreatTime = undefined;
        ship.recoveryStarted = undefined;
        ship.nextRecoveryAt = undefined;
        ship.recoveredHull = undefined;
        ship.lastMissionShotTime = undefined;
        ship.capitalManeuver = undefined;
        ship.broadsideCycle = undefined;
        ship.skirmishCycle = undefined;
        ship.maneuverTargetId = undefined;
        ship.navigationTargetId = undefined;
        ship.broadsideSide = undefined;
        ship.lastManeuverShot = undefined;
        ship.escapeSide = undefined;
        ship.escapeUntil = undefined;
        for (const turret of ship.turrets) {
          turret.cooldownTimer = 0;
          turret.currentLocalAngle = clamp(0, ...turret.baseArc);
          turret.currentTargetId = null;
          turret.currentTargetKind = undefined;
          turret.lastFiredTime = undefined;
        }
      }
      for (const ship of survivors) {
        if (ship.flagshipId) ship.flagshipId = originalIds.get(ship.flagshipId);
      }
    }
    this.projectiles = [];
    this.activeBeams = [];
    this.beamChannels.clear();
    this.shieldHaven.clear();
    this.fighterWings = [];
    this.contacts.clear();
    this.previousPositions.clear();
    this.accumulator = 0;
    this.timeElapsed = 0;
    this.audioEvents = [];
    for (const ship of this.ships)
      this.emitAudioEvent("warp_ingress", ship.pos, ship.team, ship.id);
    this.winner = null;
    this.winnerDeclaredTime = null;
    this.combatLog = [];
    this.damageTotals = [0, 0];
    this.shieldTotals = [0, 0];
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

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.winner === -1) return;
    this.accumulator += dt;
    // Bound catch-up work after a suspended render; retain the remaining combat time.
    let steps = 0;
    while (this.accumulator + 1e-9 >= FIXED_STEP && steps++ < 240 && this.winner !== -1) {
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      this.tick(FIXED_STEP);
    }
  }

  private tick(dt: number): void {
    this.timeElapsed += dt;
    // Observe broken shields before this step's regeneration can obscure the entry trigger.
    this.shieldHaven.update(this.ships, this.timeElapsed);

    // 1. Defenses & Shield Regeneration
    for (const ship of this.ships) {
      if (!ship.isAlive) continue;
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

    // 2. Tactical Movement & Targeting AI
    const aliveShips = this.ships.filter((s) => s.isAlive);
    this.previousPositions = new Map(aliveShips.map((ship) => [ship.id, [...ship.pos] as Vector2]));
    this.ensureFighterWings(aliveShips);
    this.updateFighterWings(aliveShips);
    const navigationTargets = new Map<string, ShipState | null>();
    const movements = new Map<
      string,
      { pos: Vector2; velocity: Vector2; heading: number; angularVelocity: number }
    >();
    // Allocate small focus squads in stable order, independent of the render/storage order.
    const previousTargets = new Map(aliveShips.map((ship) => [ship.id, ship.navigationTargetId]));
    for (const ship of aliveShips) ship.navigationTargetId = undefined;
    for (const ship of [...aliveShips].sort((a, b) => a.id.localeCompare(b.id))) {
      const order = this.orders.get(ship.groupId) ?? {
        groupId: ship.groupId,
        priority: "nearest",
        stance: "optimal_range",
      };
      const target = this.findTargetForShip(ship, order, aliveShips, previousTargets.get(ship.id));
      ship.navigationTargetId = target?.id;
      navigationTargets.set(ship.id, target);
    }
    for (const ship of aliveShips) {
      const target = navigationTargets.get(ship.id) ?? null;
      const previous = { pos: ship.pos, velocity: ship.velocity, heading: ship.heading };
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
    const repulsorSteps = new Map<string, number>();
    this.resolveShipCollisions(aliveShips, dt, false, repulsorSteps);
    this.resolveCruiserClearance(aliveShips);
    this.shieldHaven.attachGuests(aliveShips, dt);
    this.resolveShipCollisions(aliveShips, dt, true, repulsorSteps);

    // All mounts decide at one common firing instant, before simultaneous shots resolve.
    const shots: Array<() => void> = [];
    const missileLocks: Array<{ targetId: string; weapon: TurretMountState["weapon"] }> = [];
    for (const ship of aliveShips) {
      if (!ship.isAlive) continue;
      for (const turret of ship.turrets) {
        const channel = this.beamChannels.get(turret);
        if (channel) {
          const target = channel.target;
          const live =
            channel.kind === "ship"
              ? (target as ShipState).isAlive
              : (target as ProjectileState).hp > 0 &&
                (target as ProjectileState).lifetime > 0 &&
                this.projectiles.includes(target as ProjectileState);
          if (
            !live ||
            vecDistance(mountPosition(ship, turret), target.pos) > channel.weapon.range ||
            !inMountArc(ship, turret, target.pos)
          ) {
            this.finishBeam(turret);
            continue;
          }
          turret.currentTargetId = target.id;
          turret.currentTargetKind = channel.kind;
          const aimed = this.updateTurretAim(turret, dt, ship, target.pos);
          if (!aimed) {
            this.finishBeam(turret);
            continue;
          }
          shots.push(() => this.updateBeam(channel, aimed));
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
        const aimed = this.updateTurretAim(
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

    for (const [turret, channel] of this.beamChannels) {
      if (
        !channel.ship.isAlive ||
        (channel.kind === "ship" && !(channel.target as ShipState).isAlive) ||
        (channel.kind === "missile" && (channel.target as ProjectileState).hp <= 0)
      )
        this.finishBeam(turret);
    }
    this.activeBeams = [...this.beamChannels.values()].map((channel) => this.beamVisual(channel));

    // 4. Projectiles & Collision Resolution
    this.updateProjectiles(dt, aliveShips);
    this.shieldHaven.cleanup(this.ships);

    // 5. Victory Assessment & Window Pruning
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

  private findTargetForShip(
    ship: ShipState,
    order: GroupOrder,
    aliveShips: ShipState[],
    previousTargetId?: string,
  ): ShipState | null {
    let enemies = aliveShips.filter((s) => s.isAlive && s.team !== ship.team);
    if (enemies.length === 0) return null;

    if (ship.hullClass === "strike_craft") {
      const wing = this.fighterWings.find(
        (w) => w.team === ship.team && w.index === ship.wingIndex,
      );
      const wingTarget = enemies.find((enemy) => enemy.id === wing?.targetId);
      if (wingTarget) return wingTarget;
    }

    if (
      ship.hullClass === "battleship" ||
      ship.hullClass === "dreadnought" ||
      ship.hullClass === "missile_frigate" ||
      ship.hullClass === "cruiser" ||
      order.priority === "capitals"
    ) {
      const capitals = enemies.filter(
        (s) =>
          s.hullClass === "cruiser" ||
          s.hullClass === "battleship" ||
          s.hullClass === "dreadnought",
      );
      if (capitals.length > 0) enemies = capitals;
      const mainGun = ship.turrets.find(
        (t) => t.isSpinalGimbal || t.weapon.weaponType === "missile",
      );
      const firedTarget = enemies.find((e) => e.id === mainGun?.currentTargetId);
      if (
        firedTarget &&
        mainGun?.lastFiredTime !== undefined &&
        mainGun.lastFiredTime !==
          (ship.hullClass === "missile_frigate"
            ? ship.skirmishCycle?.lastSalvoShot
            : (ship.broadsideCycle?.lastShot ?? ship.lastManeuverShot))
      )
        return firedTarget;
    } else if (order.priority === "strike_craft") {
      const crafts = enemies.filter(
        (s) => s.hullClass === "strike_craft" || s.hullClass === "corvette",
      );
      if (crafts.length > 0) enemies = crafts;
    } else if (ship.hullClass === "strike_craft") {
      // Fighter wings default to attack runs against capital hulls
      const capitals = enemies.filter(
        (s) =>
          s.hullClass === "cruiser" ||
          s.hullClass === "battleship" ||
          s.hullClass === "dreadnought",
      );
      if (capitals.length > 0) enemies = capitals;
    }

    const anchor =
      order.priority === "screen_and_defend"
        ? (aliveShips.find((s) => s.id === ship.flagshipId && s.isAlive) ?? ship)
        : ship;
    const range = Math.max(360, ...ship.turrets.map((turret) => turret.weapon.range));
    const score = (enemy: ShipState): number => {
      const distance = vecDistance(anchor.pos, enemy.pos);
      const nearby = clamp(2 - distance / range, 0, 1);
      const assignments = aliveShips.filter(
        (peer) =>
          peer.id !== ship.id &&
          peer.team === ship.team &&
          peer.groupId === ship.groupId &&
          peer.navigationTargetId === enemy.id,
      ).length;
      return (
        (-distance / range) * 2 +
        nearby * damagedTargetPriority(enemy) +
        squadFocusPriority(assignments) +
        (enemy.id === (previousTargetId ?? ship.maneuverTargetId) ? 0.45 : 0)
      );
    };
    return enemies.reduce((best, enemy) => (score(enemy) > score(best) ? enemy : best));
  }

  private ensureFighterWings(aliveShips: ShipState[]): void {
    const fighterGroups = new Map<string, ShipState[]>();
    const assigned = new Set(this.fighterWings.flatMap((wing) => wing.members));
    for (const ship of aliveShips) {
      if (ship.hullClass !== "strike_craft" || assigned.has(ship.id)) continue;
      const key = `${ship.team}:${ship.groupId}`;
      const wing = fighterGroups.get(key) ?? [];
      wing.push(ship);
      fighterGroups.set(key, wing);
    }

    for (const fighters of fighterGroups.values()) {
      fighters.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
      const { team, groupId } = fighters[0];
      const count = Math.ceil(fighters.length / WING_SIZE);
      const firstIndex = this.fighterWings.filter((wing) => wing.team === team).length;
      let offset = 0;
      for (let i = 0; i < count; i++) {
        const size = Math.ceil((fighters.length - offset) / (count - i));
        const members = fighters.slice(offset, offset + size);
        const index = firstIndex + i;
        this.fighterWings.push({
          team,
          groupId,
          index,
          members: members.map((ship) => ship.id),
          phase: "staging",
          phaseStarted: this.timeElapsed,
          launchAt: this.timeElapsed + i * WING_WAVE_DELAY,
          targetId: null,
          heading: members[0].heading,
          rally: [...members[0].pos],
        });
        members.forEach((ship, slot) => {
          ship.wingIndex = index;
          ship.wingSlot = slot - (size - 1) / 2;
          ship.fighterPhase = "staging";
        });
        offset += size;
      }
    }
  }

  private fighterNeedsCover(ship: ShipState): boolean {
    return ship.recoveryStarted !== undefined;
  }

  private setFighterPhase(ship: ShipState, phase: FighterPhase): void {
    const wasRetreating = ship.fighterPhase === "egress" || ship.fighterPhase === "recover";
    if (!wasRetreating && (phase === "egress" || phase === "recover"))
      this.emitAudioEvent("fighter_egress", ship.pos, ship.team, ship.id);
    ship.fighterPhase = phase;
  }

  private fighterRallySlot(wing: FighterWing, ship: ShipState): Vector2 {
    const slot = ship.wingSlot ?? 0;
    return vecAdd(wing.rally, rotatePoint([-Math.abs(slot) * 30, slot * 50], wing.heading));
  }

  private updateFighterWings(aliveShips: ShipState[]): void {
    for (const ship of aliveShips) {
      if (ship.hullClass !== "strike_craft") continue;
      dogfightTarget(ship, aliveShips, this.timeElapsed);
    }
    const groupTargets = new Map<string, ShipState | undefined>();
    for (const wing of this.fighterWings) {
      const members = aliveShips.filter((ship) => wing.members.includes(ship.id));
      if (members.length === 0) continue;
      const leader = members[0];
      const groupKey = `${wing.team}:${wing.groupId}`;
      const groupWings = this.fighterWings.filter(
        (peer) => peer.team === wing.team && peer.groupId === wing.groupId,
      );
      const groupIndex = groupWings.indexOf(wing);
      let target = groupTargets.get(groupKey);
      if (!groupTargets.has(groupKey)) {
        target =
          aliveShips.find((ship) => ship.id === wing.targetId) ??
          this.findTargetForShip(
            leader,
            this.orders.get(wing.groupId) ?? {
              groupId: leader.groupId,
              priority: "capitals",
              stance: "optimal_range",
            },
            aliveShips,
          ) ??
          undefined;
        groupTargets.set(groupKey, target);
      }
      if (wing.targetId !== (target?.id ?? null)) {
        wing.targetId = target?.id ?? null;
        wing.phase = "staging";
        wing.phaseStarted = this.timeElapsed;
        wing.launchAt = this.timeElapsed + groupIndex * WING_WAVE_DELAY;
        wing.assembledAt = undefined;
        wing.engagementStarted = undefined;
        if (!target) continue;
        const anchor = aliveShips.find(
          (ship) =>
            ship.team === wing.team &&
            (ship.hullClass === "battleship" || ship.hullClass === "cruiser"),
        );
        const approach = vecSub(target.pos, anchor?.pos ?? leader.pos);
        // Freeze each corridor's bearing for the pass, even while individual craft jink.
        wing.heading = fighterIngressHeading(Math.atan2(approach[1], approach[0]), wing.index);
      }
      if (!target) continue;
      wing.rally = safeRally(target, wing.heading, members, aliveShips, FIGHTER_STANDOFF);
      const healthy = members.filter(
        (ship) => !this.fighterNeedsCover(ship) && !ship.dogfightTargetId,
      );
      const ready = healthy.filter(
        (ship) => vecDistance(ship.pos, this.fighterRallySlot(wing, ship)) <= WING_RALLY_TOLERANCE,
      );
      if (ready.length > 0 && wing.assembledAt === undefined) wing.assembledAt = this.timeElapsed;
      const assembled = healthy.length > 0 && ready.length / healthy.length >= 0.6;
      const elapsed = this.timeElapsed - wing.phaseStarted;
      let phase = wing.phase;
      const forward = rotatePoint([1, 0], wing.heading);
      const rallyAhead = healthy.every(
        (ship) => vecDot(vecSub(this.fighterRallySlot(wing, ship), ship.pos), forward) >= 0,
      );
      // Each pilot breaks independently; a spent leader must not cancel a wingmate's shot.
      if (phase === "attack") {
        if (
          wing.engagementStarted === undefined &&
          healthy.some((ship) => vecDistance(ship.pos, target.pos) <= 600)
        )
          wing.engagementStarted = this.timeElapsed;
        for (const ship of healthy) {
          const distance = vecDistance(ship.pos, target.pos);
          const gunReady = ship.turrets.some((turret) => turret.cooldownTimer <= 0);
          if (
            (ship.lastMissionShotTime ?? -Infinity) >= wing.phaseStarted ||
            distance < target.size + 30 ||
            (!gunReady &&
              (distance <= shieldEnvelopeRadius(target) + 75 ||
                this.timeElapsed - (wing.engagementStarted ?? this.timeElapsed) >= 6))
          )
            this.setFighterPhase(ship, "egress");
        }
      }
      // Keep later passes staggered even when independent echelons rejoin together.
      const lastGroupLaunch = Math.max(
        -Infinity,
        ...groupWings.map((peer) => peer.lastLaunchAt ?? -Infinity),
      );
      if (
        phase === "staging" &&
        healthy.length > 0 &&
        (!wing.hasLaunched ||
          rallyAhead ||
          assembled ||
          this.timeElapsed - (wing.assembledAt ?? wing.phaseStarted) >= 2.5) &&
        this.timeElapsed + 1e-9 >= Math.max(wing.launchAt, lastGroupLaunch + WING_WAVE_DELAY)
      ) {
        phase = "attack";
        wing.hasLaunched = true;
        wing.lastLaunchAt = this.timeElapsed;
      } else if (
        phase === "attack" &&
        (healthy.length === 0 || healthy.every((ship) => ship.fighterPhase === "egress"))
      ) {
        phase = "egress";
      } else if (phase === "egress" && elapsed >= 1.4) {
        phase = "rejoin";
      } else if (phase === "rejoin" && (assembled || elapsed >= 2.5)) {
        phase = "staging";
        wing.launchAt = this.timeElapsed + WING_RELAUNCH_DELAY;
      }
      if (phase !== wing.phase) {
        wing.phase = phase;
        wing.phaseStarted = this.timeElapsed;
        wing.assembledAt = undefined;
        wing.engagementStarted = undefined;
        if (phase === "attack")
          for (const ship of healthy)
            this.setFighterPhase(
              ship,
              vecDistance(ship.pos, target.pos) < target.size + 30 ? "egress" : "attack",
            );
      }
      for (const ship of members)
        this.setFighterPhase(
          ship,
          this.fighterNeedsCover(ship)
            ? "recover"
            : ship.dogfightTargetId
              ? "intercept"
              : wing.phase === "attack" && ship.fighterPhase === "egress"
                ? "egress"
                : wing.phase,
        );
    }
  }

  private updateFighterCycle(
    ship: ShipState,
    target: ShipState,
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
    const criticallyWounded = ship.hullCurrent < ship.hullMax * 0.3;

    if (
      criticallyWounded ||
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
          const score = criticallyWounded
            ? -distToAnchor
            : shieldRatio * 80 - distToAnchor * 0.15 - occupancy * 50;
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
    const isDamaged = this.fighterNeedsCover(ship);
    const wing = this.fighterWings.find((w) => w.team === ship.team && w.index === ship.wingIndex);
    if (!wing) return { heading: ship.heading, speed: 0 };
    const phase = ship.havenState === "seeking" ? "recover" : (ship.fighterPhase ?? wing.phase);
    const liningUp =
      phase === "attack" &&
      ship.turrets.some(
        (turret) =>
          turret.cooldownTimer <= 0 &&
          vecDistance(ship.pos, target.pos) <= turret.weapon.range + 120,
      );
    const attackSpeed = liningUp ? ship.maxSpeed * 0.45 : ship.maxSpeed;

    // 2. Shared corridor intent; local steering remains free to break formation.
    let intentTarget: Vector2;
    const slot = ship.wingSlot ?? 0;
    const rallySlot = this.fighterRallySlot(wing, ship);

    switch (phase) {
      case "intercept": {
        const opponent = aliveShips.find((s) => s.id === ship.dogfightTargetId) ?? target;
        const distance = vecDistance(ship.pos, opponent.pos);
        const n = vecNormalize(vecSub(opponent.pos, ship.pos));
        const pursuit = vecAdd(
          opponent.pos,
          vecScale(opponent.velocity, Math.min(0.8, distance / ship.maxSpeed)),
        );
        intentTarget =
          distance < 160
            ? vecAdd(
                ship.pos,
                vecAdd(vecScale(n, distance < 70 ? -100 : 50), vecScale([-n[1], n[0]], 180)),
              )
            : pursuit;
        break;
      }
      case "staging":
      case "rejoin": {
        intentTarget = rallySlot;
        break;
      }

      case "attack": {
        const standoff = shieldEnvelopeRadius(target) + 95;
        const forward = rotatePoint([1, 0], wing.heading);
        const toRally = vecSub(rallySlot, ship.pos);
        const acquiringCorridor =
          vecDot(toRally, forward) > WING_RALLY_TOLERANCE &&
          Math.abs(vecDot(toRally, [-forward[1], forward[0]])) > WING_RALLY_TOLERANCE;
        intentTarget = acquiringCorridor
          ? rallySlot
          : vecDistance(ship.pos, target.pos) <= 600
            ? target.pos
            : vecAdd(target.pos, rotatePoint([-standoff, slot * 35], wing.heading));
        break;
      }

      case "egress":
      case "recover": {
        const peelSign = wing.index % 2 === 0 ? 1 : -1;
        intentTarget = safeHaven
          ? vecAdd(
              safeHaven.pos,
              rotatePoint(
                [-safeHaven.size - 55, slot * 28],
                phase === "recover" ? safeHaven.heading : wing.heading,
              ),
            )
          : vecAdd(rallySlot, rotatePoint([0, peelSign * 150], wing.heading));
        break;
      }
    }

    const toIntent = vecSub(intentTarget, ship.pos);
    const laneAvoidance = spinalEscape(ship, aliveShips, this.projectiles, this.timeElapsed);
    const avoid = vecAdd(
      laneAvoidance,
      vecAdd(separation(ship, aliveShips), fighterDispersal(ship, aliveShips)),
    );
    const intentDir = vecNormalize(vecAdd(vecScale(vecNormalize(toIntent), ship.maxSpeed), avoid));

    // Score reachable trajectories rather than hypothetical instant maximum-speed turns.
    const SECTORS = 16;
    let bestSector = ship.lastSelectedSector ?? 0;
    let maxScore = -Infinity;
    let maxDangerObserved = 0;

    for (let k = 0; k < SECTORS; k++) {
      const sectorAngle = (k * 2 * Math.PI) / SECTORS;
      const reachable =
        ship.heading +
        clamp(
          normalizeAngle(sectorAngle - ship.heading),
          -ship.turnRate * 0.5,
          ship.turnRate * 0.5,
        );
      const candidateDir: Vector2 = [Math.cos(reachable), Math.sin(reachable)];
      const candidateVel = vecScale(
        candidateDir,
        Math.min(attackSpeed, vecDistance([0, 0], ship.velocity) + 120),
      );

      // A. Interest score: progress towards intent goal
      // Recovery values the eventual sanctuary bearing even when it requires a full turn.
      const interestDir: Vector2 =
        phase === "recover" ? [Math.cos(sectorAngle), Math.sin(sectorAngle)] : candidateDir;
      const interestScore = vecDot(interestDir, intentDir);

      // B. Threat & missile danger: predict closest approach of incoming missiles
      let dangerScore = 0;
      for (const p of this.projectiles) {
        if (
          p.ownerTeam === ship.team ||
          (p.weaponType !== "missile" && p.weaponType !== "railgun") ||
          p.hp <= 0 ||
          p.lifetime <= 0
        )
          continue;
        const r = vecSub(ship.pos, p.pos);
        const distToMissile = vecDistance([0, 0], r);
        if (distToMissile > 650) continue;

        // Relative velocity if ship takes this candidate heading
        const u = vecSub(candidateVel, p.velocity);
        const uSq = vecDot(u, u) + 1e-4;
        const horizon = Math.min(2, p.lifetime);
        const tStar = clamp(-vecDot(r, u) / uSq, 0, horizon);
        const rStar = vecAdd(r, vecScale(u, tStar));
        const dStar = vecDistance([0, 0], rStar);

        // Danger if time to closest approach is in near future and distance is lethal
        if (tStar > 0.04 && dStar < 75) {
          const missileDanger = ((75 - dStar) / 75) * (1 - tStar / horizon) * 4.5;
          dangerScore += missileDanger;
        }
      }

      for (const obstacle of aliveShips) {
        if (obstacle.id === ship.id) continue;
        // Wingmates use local flock separation below, not the capital-sized exclusion zone.
        if (obstacle.team === ship.team && obstacle.hullClass === "strike_craft") continue;
        const relative = vecSub(obstacle.pos, ship.pos);
        const velocity = vecSub(obstacle.velocity, candidateVel);
        const missionTarget = liningUp && obstacle.id === target.id;
        const t = clamp(
          -vecDot(relative, velocity) / Math.max(1, vecDot(velocity, velocity)),
          0,
          missionTarget ? 0.25 : 1,
        );
        const distance = vecDistance([0, 0], vecAdd(relative, vecScale(velocity, t)));
        const capital = obstacle.hullClass === "battleship" || obstacle.hullClass === "cruiser";
        const clearance =
          shieldEnvelopeRadius(ship) +
          shieldEnvelopeRadius(obstacle) +
          (missionTarget ? 20 : capital ? 95 : 40);
        if (distance < clearance) dangerScore += (capital ? 14 : 6) * (1 - distance / clearance);
        if (
          obstacle.team !== ship.team &&
          (phase === "staging" || phase === "rejoin" || phase === "recover")
        ) {
          const pdRange = Math.max(
            0,
            ...obstacle.turrets
              .filter((turret) => turret.weapon.weaponType === "point_defense")
              .map((turret) => turret.weapon.range + 80),
          );
          if (distance < pdRange) dangerScore += 3 * (1 - distance / pdRange);
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
      maxDangerObserved > 0.4 ||
      vecDistance([0, 0], avoid) > 1 ||
      phase === "attack" ||
      phase === "egress" ||
      phase === "intercept" ||
      phase === "recover"
        ? attackSpeed
        : Math.min(ship.maxSpeed * 0.7, vecDistance(ship.pos, intentTarget) * 1.5);

    return { heading: finalHeading, speed };
  }

  private updateShipMovement(
    ship: ShipState,
    target: ShipState | null,
    aliveShips: ShipState[],
    dt: number,
  ): void {
    if (this.shieldHaven.moveGuest(ship, aliveShips, dt)) return;
    let targetHeading = ship.heading;
    let desiredSpeed = 0;
    let thrusterVelocity: Vector2 | null = null;
    let rangePhase: RangePhase | undefined;
    let evadingOrdnance = false;
    if (ship.hullClass === "corvette") {
      const orbit = escortVelocity(ship, target, aliveShips);
      const avoid = vecAdd(
        separation(ship, aliveShips),
        spinalEscape(ship, aliveShips, this.projectiles, this.timeElapsed),
      );
      thrusterVelocity = limitVelocity(vecAdd(orbit, avoid), ship.maxSpeed);
      targetHeading = Math.atan2(thrusterVelocity[1], thrusterVelocity[0]);
    } else if (target && ship.hullClass === "strike_craft") {
      const maneuver = this.updateFighterCycle(ship, target, dt, aliveShips);
      targetHeading = maneuver.heading;
      desiredSpeed = maneuver.speed;
    } else if (target) {
      const order = this.orders.get(ship.groupId) ?? {
        groupId: ship.groupId,
        priority: "nearest",
        stance: "optimal_range",
      };
      const intent = capitalIntent(
        ship,
        target,
        aliveShips,
        order,
        this.timeElapsed,
        this.projectiles,
      );
      targetHeading = intent.heading;
      thrusterVelocity = intent.velocity;
      rangePhase = intent.rangePhase;
      evadingOrdnance = intent.evadingOrdnance ?? false;
    }

    if (thrusterVelocity) {
      thrusterVelocity = arenaVelocity(ship, thrusterVelocity);
    } else if (vecDistance([0, 0], ship.pos) > ARENA_RADIUS) {
      const inward = arenaVelocity(ship, [
        Math.cos(targetHeading) * desiredSpeed,
        Math.sin(targetHeading) * desiredSpeed,
      ]);
      targetHeading = Math.atan2(inward[1], inward[0]);
      desiredSpeed = vecDistance([0, 0], inward);
    }

    const turnRate = ship.turnRate;
    const angleDiff = normalizeAngle(targetHeading - ship.heading);
    const turnStep = clamp(angleDiff, -turnRate * dt, turnRate * dt);
    ship.heading = normalizeAngle(ship.heading + turnStep);

    // 4. Thrust & Lateral Control
    const forwardVector: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
    const rightVector: Vector2 = [-Math.sin(ship.heading), Math.cos(ship.heading)];

    const currentForwardSpeed = vecDot(ship.velocity, forwardVector);
    const currentLateralSpeed = vecDot(ship.velocity, rightVector);

    if (thrusterVelocity) desiredSpeed = vecDot(thrusterVelocity, forwardVector);
    desiredSpeed = Math.max(desiredSpeed, -ship.maxSpeed * 0.35);
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

    // Emergency acceleration beyond the soft band; no teleporting or position clamping.
    const containedVelocity =
      vecDistance([0, 0], ship.pos) > ARENA_HARD_PULL_RADIUS
        ? vecSub(newVelocity, vecScale(vecNormalize(ship.pos), 600 * dt))
        : newVelocity;
    let controlledVelocity = containedVelocity;
    if (rangePhase && !evadingOrdnance) {
      const flight = SHIP_DOCTRINES[ship.hullClass].flight;
      if (flight.kind === "capital" || flight.kind === "skirmish")
        controlledVelocity = clampLateralVelocity(
          ship,
          controlledVelocity,
          flight.lateralSpeedRatio,
          rangePhase,
        );
    }
    ship.velocity = limitVelocity(controlledVelocity, ship.maxSpeed);
    ship.pos = vecAdd(ship.pos, vecScale(ship.velocity, dt));
  }

  private resolveShipCollisions(
    aliveShips: ShipState[],
    dt: number,
    tetheredPass: boolean,
    repulsorSteps = new Map<string, number>(),
  ): void {
    const contacts = tetheredPass ? new Set(this.contacts) : new Set<string>();
    const getShipMass = (hull: string): number => {
      switch (hull) {
        case "dreadnought":
          return 160.0;
        case "battleship":
          return 130.0;
        case "cruiser":
          return 30.0;
        case "missile_frigate":
          return 15.0;
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
        if (!a.isAlive || !b.isAlive) continue;
        const tetherA = a.havenState === "tethered";
        const tetherB = b.havenState === "tethered";
        if ((tetherA || tetherB) !== tetheredPass) continue;
        const d = vecDistance(a.pos, b.pos);
        if (this.observer && a.team !== b.team) this.observer.onProximity(a, b, d);

        const shieldA = activeShieldRadius(a);
        const shieldB = activeShieldRadius(b);
        const minBubbleDist = shieldA + shieldB;
        const nested = sharesShieldHaven(a, b);
        const hullClearance = nested ? havenHullClearance(a, b) : a.size + b.size;
        const repulsorZone = nested
          ? hullClearance
          : Math.max(
              capitalSeparationDistance(a, b),
              shieldRepulsorRadius(a) + shieldRepulsorRadius(b) + 20,
            );
        const pair = [a.id, b.id].sort().join(":");
        if (d < repulsorZone + 5 && this.contacts.has(pair)) contacts.add(pair);

        if (d < repulsorZone) {
          const normal: Vector2 =
            d > 0.001 ? vecNormalize(vecSub(a.pos, b.pos)) : [0, a.id < b.id ? -1 : 1];

          const massA = getShipMass(a.hullClass);
          const massB = getShipMass(b.hullClass);
          const totalMass = massA + massB;

          // Tethers are kinematic for unrelated contacts. Hull penetration breaks the
          // offending attachment so exclusion can correct it without moving its parent.
          if (nested) {
            if (tetherA && (tetherB || a.havenParentId === b.id)) this.shieldHaven.release(a.id);
            if (tetherB && (tetherA || b.havenParentId === a.id)) this.shieldHaven.release(b.id);
          }
          const fixedA = a.havenState === "tethered" || (nested && b.havenParentId === a.id);
          const fixedB = b.havenState === "tethered" || (nested && a.havenParentId === b.id);
          const pushRatioA = fixedA ? 0 : fixedB ? 1 : massB / totalMass;
          const pushRatioB = fixedB ? 0 : fixedA ? 1 : massA / totalMass;

          // Cancel only closing normal velocity so hulls slide tangentially past each other
          const relVel = vecSub(a.velocity, b.velocity);
          const closingSpeed = vecDot(relVel, normal);
          if (closingSpeed < 0) {
            a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * pushRatioA));
            b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * pushRatioB));
          }

          // Resolve hull penetration immediately; shield inflation and tactical pressure
          // share a bounded per-ship budget across every contact in this tick.
          const hullCorrection = Math.max(0, hullClearance - d);
          const softCorrection = Math.min(
            Math.max(0, repulsorZone - d - hullCorrection),
            pushRatioA > 0
              ? Math.max(0, MAX_REPULSOR_STEP - (repulsorSteps.get(a.id) ?? 0)) / pushRatioA
              : Infinity,
            pushRatioB > 0
              ? Math.max(0, MAX_REPULSOR_STEP - (repulsorSteps.get(b.id) ?? 0)) / pushRatioB
              : Infinity,
          );
          repulsorSteps.set(a.id, (repulsorSteps.get(a.id) ?? 0) + softCorrection * pushRatioA);
          repulsorSteps.set(b.id, (repulsorSteps.get(b.id) ?? 0) + softCorrection * pushRatioB);
          const correction = hullCorrection + softCorrection;
          a.pos = vecAdd(a.pos, vecScale(normal, correction * pushRatioA));
          b.pos = vecSub(b.pos, vecScale(normal, correction * pushRatioB));

          // Physical shield clash & ramming (hostile ships only!)
          if (d <= minBubbleDist && a.team !== b.team) {
            const beforeA = this.observer ? [a.shieldCurrent, a.armorCurrent, a.hullCurrent] : null;
            const beforeB = this.observer ? [b.shieldCurrent, b.armorCurrent, b.hullCurrent] : null;
            const ramDamage =
              (this.contacts.has(pair) ? 0 : Math.max(0, -closingSpeed) * 0.25) + 5 * dt;
            contacts.add(pair);

            if (a.shieldCurrent > 0) a.shieldCurrent = Math.max(0, a.shieldCurrent - ramDamage);
            else a.hullCurrent = Math.max(0, a.hullCurrent - ramDamage * 1.5);

            if (b.shieldCurrent > 0) b.shieldCurrent = Math.max(0, b.shieldCurrent - ramDamage);
            else b.hullCurrent = Math.max(0, b.hullCurrent - ramDamage * 1.5);

            if (
              a.hullClass === "strike_craft" &&
              (b.hullClass === "battleship" || b.hullClass === "cruiser")
            ) {
              a.hullCurrent = 0;
            } else if (
              b.hullClass === "strike_craft" &&
              (a.hullClass === "battleship" || a.hullClass === "cruiser")
            ) {
              b.hullCurrent = 0;
            }

            if (this.observer && beforeA && beforeB) {
              this.observer.onDamage(a, b.id, undefined, "ram", beforeA);
              this.observer.onDamage(b, a.id, undefined, "ram", beforeB);
            }

            if (a.hullCurrent <= 0) this.destroyShip(a, b.team);
            if (b.hullCurrent <= 0) this.destroyShip(b, a.team);
          }
        }
      }
    }
    this.contacts = contacts;
  }

  private resolveCruiserClearance(aliveShips: ShipState[]): void {
    const cruisers = aliveShips
      .filter((ship) => ship.isAlive && ship.hullClass === "cruiser")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // Revisit crowded chains because resolving one pair can compress a previous pair.
    for (let pass = 0; pass < Math.max(32, cruisers.length * 8); pass++) {
      let corrected = false;
      for (let i = 0; i < cruisers.length; i++) {
        for (let j = i + 1; j < cruisers.length; j++) {
          const a = cruisers[i];
          const b = cruisers[j];
          if (a.team !== b.team) continue;
          const clearance = a.size + b.size;
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

  private fireWeapon(
    ship: ShipState,
    turret: TurretMountState,
    targetPos: [number, number],
    targetShip: ShipState | null,
    targetMissile: ProjectileState | null = null,
  ): void {
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
      turret.lastFiredTime = this.timeElapsed;
    }
    if (laserPD) turret.lastFiredTime = this.timeElapsed;
    this.observer?.onShot(this.timeElapsed, ship, turret);
    if (ship.hullClass === "strike_craft" && ship.fighterPhase === "attack") {
      const wing = this.fighterWings.find(
        (w) => w.team === ship.team && w.index === ship.wingIndex,
      );
      if (targetShip?.id === wing?.targetId && targetShip?.hullClass !== "strike_craft")
        ship.lastMissionShotTime = this.timeElapsed;
      this.setFighterPhase(ship, "egress");
    }

    // Other zero-speed weapons retain their existing instantaneous hitscan behavior.
    if (isBeam) {
      if (turret.weapon.weaponType === "beam_laser" && beamTarget) {
        this.beamChannels.set(turret, {
          ship,
          turret,
          target: beamTarget,
          kind: targetShip ? "ship" : "missile",
          weapon: { ...turret.weapon },
          frames: 0,
        });
        this.onBeamFire?.(
          spawnPos,
          beamTarget.pos,
          ship.team === 0 ? "#38bdf8" : "#ef4444",
          2.8,
          ship.team,
          true,
        );
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
        if (this.onBeamFire) this.onBeamFire(spawnPos, targetShip.pos, beamColor, 2.8, ship.team);
      } else if (targetMissile) {
        this.damageProjectile(
          targetMissile,
          laserPD ? 110 * FIXED_STEP : turret.weapon.damage,
          ship.team,
          laserPD ? "laser PD" : "beam battery",
          ship,
        );
        this.onBeamFire?.(
          spawnPos,
          targetMissile.pos,
          ship.team === 0 ? "#38bdf8" : "#ef4444",
          2.8,
          ship.team,
        );
      }
      return;
    }

    // Physical projectile (Railgun, Plasma, Missile)
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

    this.projectiles.push({
      id: `proj_${this.projectileCounter}`,
      weaponType: turret.weapon.weaponType,
      weapon: {
        ...turret.weapon,
        flak: turret.weapon.flak ? { ...turret.weapon.flak } : undefined,
      },
      damage: turret.weapon.damage,
      ownerId: ship.id,
      ownerTeam: ship.team,
      ...(this.observer ? { ownerMountId: turret.id } : {}),
      pos: spawnPos,
      velocity,
      lifetime,
      targetId: turret.currentTargetId,
      hp: projectileMaxHp(turret.weapon),
      maxHp: projectileMaxHp(turret.weapon),
      isFlakBurst: Boolean(turret.weapon.flak),
    });
    this.onProjectileFire?.(turret.weapon.weaponType, [...spawnPos]);
    if (turret.weapon.weaponType === "missile")
      this.emitAudioEvent(
        "torpedo_launch",
        spawnPos,
        ship.team,
        ship.id,
        turret.currentTargetId ?? undefined,
      );
  }

  private beamVisual(channel: BeamChannel): ActiveBeam {
    const { ship, turret, target, kind } = channel;
    const angle = ship.heading + turret.currentLocalAngle;
    const from = vecAdd(mountPosition(ship, turret), [
      Math.cos(angle) * turret.barrelLength,
      Math.sin(angle) * turret.barrelLength,
    ]);
    const radius = kind === "ship" ? activeShieldRadius(target as ShipState) : 0;
    const direction = vecNormalize(vecSub(from, target.pos));
    const to = vecAdd(
      target.pos,
      vecScale(direction, Math.min(radius, vecDistance(from, target.pos))),
    );
    return { id: `${ship.id}:${turret.id}`, from, to, ownerTeam: ship.team };
  }

  private finishBeam(turret: TurretMountState): void {
    this.beamChannels.delete(turret);
    turret.cooldownTimer = turret.weapon.cooldown;
    turret.lastFiredTime = this.timeElapsed;
  }

  private updateBeam(channel: BeamChannel, aimed: boolean): void {
    channel.frames++;
    if (aimed && channel.frames % BEAM_TICK_FRAMES === 0) {
      const { ship, turret, target, weapon } = channel;
      const damage = weapon.damage / BEAM_TICKS;
      if (channel.kind === "ship") {
        this.applyDamage(
          target as ShipState,
          damage,
          weapon,
          ship.team,
          ship.id,
          turret.id,
          mountPosition(ship, turret),
          channel,
        );
      } else {
        const missile = target as ProjectileState;
        this.damageProjectile(missile, damage, ship.team, "beam battery", ship);
      }
    }
    if (channel.frames >= BEAM_TICK_FRAMES * BEAM_TICKS) this.finishBeam(channel.turret);
  }

  private updateProjectiles(dt: number, aliveShips: ShipState[]): void {
    const active: ProjectileState[] = [];
    const starts = new Map(this.projectiles.map((p) => [p.id, p.pos]));
    for (const p of this.projectiles) {
      if (p.hp <= 0 || p.lifetime <= 0) continue;
      const step = Math.min(dt, p.lifetime);

      // Lost locks acquire the closest hostile within a forward 60-degree seeker arc.
      if (p.weaponType === "missile" && p.targetId) {
        const currentAngle = Math.atan2(p.velocity[1], p.velocity[0]);
        let target = aliveShips.find(
          (s) => s.id === p.targetId && s.isAlive && s.team !== p.ownerTeam,
        );
        if (!target) {
          let closest = Infinity;
          for (const candidate of aliveShips) {
            if (!candidate.isAlive || candidate.team === p.ownerTeam) continue;
            const delta = vecSub(candidate.pos, p.pos);
            const angle = normalizeAngle(Math.atan2(delta[1], delta[0]) - currentAngle);
            const distance = vecDot(delta, delta);
            if (Math.abs(angle) <= Math.PI / 6 && distance < closest) {
              target = candidate;
              closest = distance;
            }
          }
          if (target) p.targetId = target.id;
        }
        if (target) {
          const toTarget = vecSub(target.pos, p.pos);
          const distSq = toTarget[0] * toTarget[0] + toTarget[1] * toTarget[1];
          if (distSq > 100) {
            const curSpeed = Math.hypot(p.velocity[0], p.velocity[1]);
            if (curSpeed > 1) {
              const desiredAngle = Math.atan2(toTarget[1], toTarget[0]);
              const angleDiff = normalizeAngle(desiredAngle - currentAngle);
              if (!isHeavyTorpedo(p) || Math.abs(angleDiff) < Math.PI / 3) {
                const maxTurn = (isHeavyTorpedo(p) ? 0.8 : 2.5) * step;
                const turn = clamp(angleDiff, -maxTurn, maxTurn);
                const newAngle = currentAngle + turn;
                p.velocity = [Math.cos(newAngle) * curSpeed, Math.sin(newAngle) * curSpeed];
              }
            }
          }
        }
      }

      const start = starts.get(p.id) ?? p.pos;
      const end = vecAdd(start, vecScale(p.velocity, step));
      const flak = p.weapon.flak;
      let first = Infinity;
      let victim: ShipState | null = null;
      let intercepted: ProjectileState | null = null;
      for (const ship of aliveShips) {
        if (!ship.isAlive || ship.team === p.ownerTeam) continue;
        const old = this.previousPositions.get(ship.id) ?? ship.pos;
        const finish = vecAdd(old, vecScale(vecSub(ship.pos, old), step / dt));
        const t = sweptHit(
          vecSub(start, old),
          vecSub(end, finish),
          activeShieldRadius(ship) + (flak?.triggerRadius ?? 0),
        );
        if (t !== null) {
          const distToShip = vecDistance(start, old);
          const isBetter =
            t < first ||
            (t === first &&
              (ship.id === p.targetId ||
                (victim !== null &&
                  distToShip <
                    vecDistance(start, this.previousPositions.get(victim.id) ?? victim.pos))));
          if (isBetter) {
            first = t;
            victim = ship;
          }
        }
      }
      if (flak || pointDefenseMode(p.weapon) === "rotary") {
        for (const missile of this.projectiles) {
          if (
            missile.weaponType !== "missile" ||
            missile.ownerTeam === p.ownerTeam ||
            missile.hp <= 0 ||
            missile.lifetime <= 0
          )
            continue;
          const old = starts.get(missile.id) ?? missile.pos;
          const finish = vecAdd(old, vecScale(missile.velocity, Math.min(step, missile.lifetime)));
          const t = sweptHit(vecSub(start, old), vecSub(end, finish), flak?.triggerRadius ?? 5);
          if (t !== null && t < first) {
            first = t;
            victim = null;
            intercepted = missile;
          }
        }
      }
      // Motion is clipped to remaining fuel; no missile can steer or survive beyond it.
      p.lifetime = Math.max(0, p.lifetime - dt);
      p.pos = vecAdd(start, vecScale(vecSub(end, start), Math.min(first, 1)));
      if (flak && (Number.isFinite(first) || p.lifetime <= 1e-9)) {
        const elapsed = step * Math.min(first, 1);
        const positions = new Map<string, Vector2>();
        for (const ship of aliveShips) {
          const old = this.previousPositions.get(ship.id) ?? ship.pos;
          positions.set(ship.id, vecAdd(old, vecScale(vecSub(ship.pos, old), elapsed / dt)));
        }
        for (const missile of this.projectiles)
          positions.set(
            missile.id,
            vecAdd(starts.get(missile.id) ?? missile.pos, vecScale(missile.velocity, elapsed)),
          );
        this.detonateFlak(p, aliveShips, positions);
      } else if (intercepted) {
        this.damageProjectile(intercepted, 15, p.ownerTeam, "rotary PD");
        p.hp = 0;
      } else if (victim) {
        this.applyDamage(victim, p.damage, p.weapon, p.ownerTeam, p.ownerId, p.ownerMountId, p.pos);
        p.hp = 0;
      } else if (p.lifetime > 1e-9) {
        active.push(p);
      }
    }
    this.projectiles = active.filter((p) => p.hp > 0);
  }

  private detonateFlak(
    flak: ProjectileState,
    aliveShips: ShipState[],
    positions: Map<string, Vector2>,
  ): void {
    const profile = flak.weapon.flak;
    if (!profile) return;
    for (const ship of aliveShips) {
      if (!ship.isAlive || ship.team === flak.ownerTeam) continue;
      const dist = vecDistance(flak.pos, positions.get(ship.id) ?? ship.pos);
      const shield = activeShieldRadius(ship);
      const surface = dist >= shield ? dist - shield : Math.max(0, dist - ship.size);
      const falloff = clamp(
        (profile.blastRadius - surface) / (profile.blastRadius - profile.triggerRadius),
        0,
        1,
      );
      if (falloff <= 0) continue;
      const weapon =
        ship.hullClass === "strike_craft"
          ? { ...flak.weapon, shieldMultiplier: 1, armorMultiplier: 1, hullMultiplier: 1 }
          : flak.weapon;
      this.applyDamage(
        ship,
        flak.damage * falloff,
        weapon,
        flak.ownerTeam,
        flak.ownerId,
        flak.ownerMountId,
        flak.pos,
      );
    }

    for (const other of this.projectiles) {
      if (
        other.weaponType !== "missile" ||
        other.ownerTeam === flak.ownerTeam ||
        other.hp <= 0 ||
        other.lifetime <= 0
      )
        continue;
      if (vecDistance(flak.pos, positions.get(other.id) ?? other.pos) <= profile.blastRadius) {
        if (!isHeavyTorpedo(other)) {
          // Light missiles retain their stable dispersion cap; armored torpedoes take every hit.
          let dispersion = 2166136261;
          for (let i = 0; i < other.id.length; i++)
            dispersion = Math.imul(dispersion ^ other.id.charCodeAt(i), 16777619);
          dispersion ^= dispersion >>> 16;
          dispersion = Math.imul(dispersion, 0x85ebca6b);
          dispersion ^= dispersion >>> 13;
          dispersion = Math.imul(dispersion, 0xc2b2ae35);
          dispersion ^= dispersion >>> 16;
          if ((dispersion >>> 0) / 0x100000000 >= 0.9) continue;
        }
        this.damageProjectile(other, profile.missileDamage, flak.ownerTeam, "flak burst");
      }
    }

    if (this.onFlakBurst) this.onFlakBurst([...flak.pos], profile.blastRadius, flak.ownerTeam);
    this.emitAudioEvent("flak_burst", flak.pos, flak.ownerTeam, flak.ownerId);
  }

  private damageProjectile(
    projectile: ProjectileState,
    damage: number,
    team: number,
    source: string,
    laserSource?: ShipState,
  ): void {
    if (projectile.hp <= 0 || projectile.lifetime <= 0) return;
    projectile.hp = Math.max(0, projectile.hp - damage);
    if (projectile.hp > 0) return;
    projectile.lifetime = 0;
    this.stats[team].missilesIntercepted++;
    this.addCombatLog(`Hostile torpedo intercepted by ${source}!`, team, "intercept");
    if (laserSource)
      this.emitAudioEvent("laser_intercept", projectile.pos, team, laserSource.id, projectile.id);
  }

  private applyDamage(
    ship: ShipState,
    rawDamage: number,
    weapon: WeaponDefinition,
    attackerTeam?: number,
    attackerId?: string,
    mountId?: string,
    impactOrigin?: Vector2,
    channel?: BeamChannel,
  ): void {
    if (!ship.isAlive) return;
    const parent = weapon.shieldMultiplier > 0 ? this.shieldHaven.protectedParent(ship) : null;
    if (parent && rawDamage > 0) {
      const before = this.observer
        ? [parent.shieldCurrent, parent.armorCurrent, parent.hullCurrent]
        : null;
      this.resetShieldDelay(parent);
      const shieldDamage = rawDamage * weapon.shieldMultiplier;
      const absorbed = this.applyShieldDamage(parent, shieldDamage);
      this.recordAttackerDamage(attackerTeam, absorbed);
      if (before) this.observer?.onDamage(parent, attackerId, mountId, weapon.weaponType, before);
      if (impactOrigin) this.onWeaponImpact?.(parent, impactOrigin, true, false, false);
      rawDamage = absorbed >= shieldDamage ? 0 : rawDamage - absorbed / weapon.shieldMultiplier;
      if (rawDamage <= 0) return;
    }
    if (!this.observer && !this.onWeaponImpact) {
      this.applyDamageInternal(ship, rawDamage, weapon, attackerTeam, channel);
      return;
    }
    const before = [ship.shieldCurrent, ship.armorCurrent, ship.hullCurrent];
    this.applyDamageInternal(ship, rawDamage, weapon, attackerTeam, channel);
    this.observer?.onDamage(ship, attackerId, mountId, weapon.weaponType, before);
    if (impactOrigin) {
      const shield = ship.shieldCurrent < before[0];
      const armor = ship.armorCurrent < before[1];
      const hull = ship.hullCurrent < before[2];
      if (shield || armor || hull) this.onWeaponImpact?.(ship, impactOrigin, shield, armor, hull);
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
      if (ship.hullCurrent <= 0) {
        this.destroyShip(ship, attackerTeam);
      }
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
    this.stats[ship.team].shieldDamageAbsorbed = Math.round(this.shieldTotals[ship.team]);
    if (absorbed > 0) this.onShieldHit?.([...ship.pos], Math.min(1, absorbed / 100));
    if (ship.shieldCurrent <= 0) this.shieldHaven.releaseGuests(ship.id);
    return absorbed;
  }

  private destroyShip(ship: ShipState, attackerTeam?: number): void {
    if (!ship.isAlive) return;
    ship.isAlive = false;
    this.shieldHaven.releaseGuests(ship.id);
    this.stats[ship.team].shipsLost += 1;
    this.onShipDestroyed?.(ship);
    const killerName = attackerTeam === 0 ? "Terran fleet" : "Alien swarm";
    this.addCombatLog(
      `${ship.name} eliminated by ${killerName}!`,
      attackerTeam ?? (ship.team === 0 ? 1 : 0),
      "kill",
    );
  }

  private recordAttackerDamage(attackerTeam: number | undefined, amount: number): void {
    if (attackerTeam === undefined || amount <= 0) return;
    const teamStats = this.stats[attackerTeam];
    if (!teamStats) return;
    this.damageTotals[attackerTeam] += amount;
    teamStats.damageDealt = Math.round(this.damageTotals[attackerTeam]);
    teamStats.recentDamageWindow.push({ time: this.timeElapsed, damage: amount });
  }
}
