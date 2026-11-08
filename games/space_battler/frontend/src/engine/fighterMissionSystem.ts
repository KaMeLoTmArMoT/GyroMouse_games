import type { FighterPhase, ShipState, Vector2, WingPhase } from "../types/combat";
import { CREW_TACTICS, type CrewContext } from "./crewVeterancy";
import { fighterRecoveryDirection, friendlyShieldRecoveryDirection } from "./fighterRecovery";
import {
  dogfightTarget,
  FIGHTER_DISPERSAL_RADIUS,
  fighterIngressHeading,
  limitVelocity,
  safeRally,
  separation,
  spinalEscape,
  withinPursuitTheater,
} from "./flightControl";
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
import { navigationContext, prepareNavigationContext } from "./navigationContext";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import {
  fighterShieldWaypoint,
  fighterTacticalTick,
  findNavigationTarget,
  hostileFlakThreats,
} from "./shipNavigationSystem";
import { flakThreatRadius } from "./shipProfiles";
import type { ClientCombatSimulation } from "./simulation";

const FIGHTER_STANDOFF = 520;
const FIGHTER_CLEARANCE = 45;
const WING_SIZE = 4;
export const WING_WAVE_DELAY = 1.7;
const WING_RELAUNCH_DELAY = 0.25;
const WING_RALLY_TOLERANCE = 65;

/** Only committed, healthy attackers lend courage; recovery craft do not count. */
export function swarmFlakFear(ship: ShipState, corvette: ShipState, ships: ShipState[]): number {
  if (
    ship.fighterPhase !== "attack" ||
    ship.carrierRecovering ||
    ship.recoveryStarted !== undefined
  )
    return 1;
  let attackers = 0;
  const radius = flakThreatRadius(corvette);
  const radiusSquared = radius * radius;
  for (const peer of ships) {
    if (
      !peer.isAlive ||
      peer.isDocked ||
      peer.isDebris ||
      peer.team !== ship.team ||
      peer.hullClass !== "strike_craft" ||
      peer.fighterPhase !== "attack" ||
      peer.carrierRecovering ||
      peer.recoveryStarted !== undefined
    )
      continue;
    const dx = peer.pos[0] - corvette.pos[0];
    const dy = peer.pos[1] - corvette.pos[1];
    if (peer.navigationTargetId === corvette.id || dx * dx + dy * dy <= radiusSquared) attackers++;
  }
  return attackers >= 4 ? Math.max(0.2, (0.5 * 4) / attackers) : 1;
}

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

type MissionContext = Pick<ClientCombatSimulation, "timeElapsed" | "orders" | "projectiles"> &
  CrewContext;

export class FighterMissionSystem {
  private wings: FighterWing[] = [];
  private readonly context: MissionContext;
  private readonly onEgress: (ship: ShipState) => void;
  private decisions = new WeakMap<ShipState, number>();
  private steering = new WeakMap<
    ShipState,
    {
      tick: number;
      phase: FighterPhase;
      heading: number;
      speed: number;
      committedAt: number;
      evaluatedAt: number;
      evasive: boolean;
    }
  >();

  constructor(context: MissionContext, onEgress: (ship: ShipState) => void) {
    this.context = context;
    this.onEgress = onEgress;
  }

  clear(): void {
    this.wings = [];
    this.decisions = new WeakMap();
    this.steering = new WeakMap();
  }

  getVisuals(): FighterWingVisual[] {
    const groupCounts = new Map<string, number>();
    return this.wings.map((wing) => {
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

  targetId(ship: ShipState): string | null {
    return (
      this.wings.find((w) => w.team === ship.team && w.index === ship.wingIndex)?.targetId ?? null
    );
  }

  onShot(ship: ShipState, target: ShipState | null): void {
    if (ship.hullClass !== "strike_craft" || ship.fighterPhase !== "attack") return;
    if (target?.id === this.targetId(ship) && target?.hullClass !== "strike_craft")
      ship.lastMissionShotTime = this.context.timeElapsed;
    this.setPhase(ship, "egress");
  }

  ensureWings(aliveShips: ShipState[]): void {
    const fighterGroups = new Map<string, ShipState[]>();
    const assigned = new Set(this.wings.flatMap((wing) => wing.members));
    for (const ship of aliveShips) {
      if (ship.hullClass !== "strike_craft" || assigned.has(ship.id)) continue;
      const key = `${ship.team}:${ship.groupId}:${ship.flagshipId ?? "free"}`;
      const wing = fighterGroups.get(key) ?? [];
      wing.push(ship);
      fighterGroups.set(key, wing);
    }
    for (const fighters of fighterGroups.values()) {
      fighters.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
      const { team, groupId } = fighters[0];
      const count = Math.ceil(fighters.length / WING_SIZE);
      const firstIndex = this.wings.filter((wing) => wing.team === team).length;
      let offset = 0;
      for (let i = 0; i < count; i++) {
        const size = Math.ceil((fighters.length - offset) / (count - i));
        const members = fighters.slice(offset, offset + size);
        const index = firstIndex + i;
        this.wings.push({
          team,
          groupId,
          index,
          members: members.map((ship) => ship.id),
          phase: "staging",
          phaseStarted: this.context.timeElapsed,
          launchAt: this.context.timeElapsed + i * WING_WAVE_DELAY,
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

  private needsCover(ship: ShipState): boolean {
    return ship.carrierRecovering === true || ship.recoveryStarted !== undefined;
  }

  private setPhase(ship: ShipState, phase: FighterPhase): void {
    const wasRetreating = ship.fighterPhase === "egress" || ship.fighterPhase === "recover";
    if (!wasRetreating && (phase === "egress" || phase === "recover")) this.onEgress(ship);
    ship.fighterPhase = phase;
  }

  private rallySlot(wing: FighterWing, ship: ShipState): Vector2 {
    const slot = ship.wingSlot ?? 0;
    return vecAdd(wing.rally, rotatePoint([-Math.abs(slot) * 30, slot * 50], wing.heading));
  }

  private wingDispersal(ship: ShipState, aliveShips: ShipState[]): Vector2 {
    if (ship.hullClass !== "strike_craft") return [0, 0];
    const navigation = navigationContext(aliveShips) ?? prepareNavigationContext(aliveShips);
    const centers = navigation.wingCenters ?? navigation.updateWingCenters(aliveShips);
    const wings = centers.get(ship.team);
    const ownKey = `${ship.groupId}:${ship.wingIndex ?? "unassigned"}`;
    const own = wings?.get(ownKey);
    if (!own || !wings) return [0, 0];
    let repulsion: Vector2 = [0, 0];
    for (const [wingKey, wing] of wings) {
      if (wingKey === ownKey) continue;
      const delta = vecSub(own.pos, wing.pos);
      const distance = vecDistance([0, 0], delta);
      if (distance >= FIGHTER_DISPERSAL_RADIUS) continue;
      const away: Vector2 =
        distance > 1e-6 ? vecScale(delta, 1 / distance) : [0, ownKey < wingKey ? -1 : 1];
      const falloff = (1 - distance / FIGHTER_DISPERSAL_RADIUS) ** 2;
      repulsion = vecAdd(repulsion, vecScale(away, ship.maxSpeed * 0.8 * falloff));
    }
    return limitVelocity(repulsion, ship.maxSpeed);
  }

  updateWings(aliveShips: ShipState[]): void {
    const navigation = navigationContext(aliveShips) ?? prepareNavigationContext(aliveShips);
    navigation.updateWingCenters(aliveShips);
    const wingMembers = new Map<string, ShipState[]>();
    const wingsByGroup = new Map<string, FighterWing[]>();
    const memberWings = new Map<string, string>();
    for (const wing of this.wings) {
      const key = `${wing.team}:${wing.groupId}`;
      const group = wingsByGroup.get(key) ?? [];
      group.push(wing);
      wingsByGroup.set(key, group);
      const wingKey = `${key}:${wing.index}`;
      for (const id of wing.members) memberWings.set(id, wingKey);
    }
    for (const ship of aliveShips) {
      const key = memberWings.get(ship.id);
      if (!key) continue;
      const members = wingMembers.get(key) ?? [];
      members.push(ship);
      wingMembers.set(key, members);
    }
    const { timeElapsed, orders } = this.context;
    const reassess = new Set<ShipState>();
    const flak = new Map<ShipState, ShipState[]>();
    for (const ship of aliveShips) {
      if (ship.hullClass !== "strike_craft") continue;
      const threats = hostileFlakThreats(ship, aliveShips);
      flak.set(ship, threats);
      const tick = fighterTacticalTick(
        ship,
        timeElapsed,
        aliveShips,
        this.context.crewVeterancy?.[ship.team],
      );
      if (tick !== this.decisions.get(ship)) {
        this.decisions.set(ship, tick);
        reassess.add(ship);
        if (!threats.length) dogfightTarget(ship, aliveShips, timeElapsed);
      }
      if (threats.length) {
        navigation.adjust(navigation.dogfightAssignments, ship, ship.dogfightTargetId, -1);
        ship.dogfightTargetId = undefined;
        if (threats.length >= 2 || ship.fighterPhase === "intercept") this.setPhase(ship, "egress");
      }
    }
    const groupTargets = new Map<string, ShipState | undefined>();
    for (const wing of this.wings) {
      const members = wingMembers.get(`${wing.team}:${wing.groupId}:${wing.index}`) ?? [];
      if (members.length === 0) continue;
      const leader = members[0];
      const groupKey = `${wing.team}:${wing.groupId}`;
      const groupWings = wingsByGroup.get(groupKey) ?? [];
      const groupIndex = groupWings.indexOf(wing);
      let target = groupTargets.get(groupKey);
      if (!groupTargets.has(groupKey)) {
        const retained = wing.targetId ? navigation.byId.get(wing.targetId) : undefined;
        target =
          (!reassess.has(leader) && retained && withinPursuitTheater(leader, retained, aliveShips)
            ? retained
            : undefined) ??
          findNavigationTarget(
            leader,
            orders.get(wing.groupId) ?? {
              groupId: leader.groupId,
              priority: "capitals",
              stance: "optimal_range",
            },
            aliveShips,
            undefined,
            this.targetId(leader),
          ) ??
          undefined;
        groupTargets.set(groupKey, target);
      }
      if (wing.targetId !== (target?.id ?? null)) {
        wing.targetId = target?.id ?? null;
        wing.phase = "staging";
        wing.phaseStarted = timeElapsed;
        wing.launchAt = timeElapsed + groupIndex * WING_WAVE_DELAY;
        wing.assembledAt = undefined;
        wing.engagementStarted = undefined;
        if (!target) continue;
        const anchor = navigation.anchorsByTeam
          .get(wing.team)
          ?.find((ship) => ship.hullClass === "battleship" || ship.hullClass === "cruiser");
        const approach = vecSub(target.pos, anchor?.pos ?? leader.pos);
        // Freeze each corridor's bearing for the pass, even while individual craft jink.
        wing.heading = fighterIngressHeading(Math.atan2(approach[1], approach[0]), wing.index);
      }
      if (!target) continue;
      wing.rally = safeRally(target, wing.heading, members, aliveShips, FIGHTER_STANDOFF);
      const healthy = members.filter(
        (ship) =>
          !this.needsCover(ship) && !ship.dogfightTargetId && (flak.get(ship)?.length ?? 0) < 2,
      );
      const ready = healthy.filter(
        (ship) => vecDistance(ship.pos, this.rallySlot(wing, ship)) <= WING_RALLY_TOLERANCE,
      );
      if (ready.length > 0 && wing.assembledAt === undefined) wing.assembledAt = timeElapsed;
      const assembled = healthy.length > 0 && ready.length / healthy.length >= 0.6;
      const elapsed = timeElapsed - wing.phaseStarted;
      let phase = wing.phase;
      const forward = rotatePoint([1, 0], wing.heading);
      const rallyAhead = healthy.every(
        (ship) => vecDot(vecSub(this.rallySlot(wing, ship), ship.pos), forward) >= 0,
      );
      // Each pilot breaks independently; a spent leader must not cancel a wingmate's shot.
      if (phase === "attack") {
        if (
          wing.engagementStarted === undefined &&
          healthy.some((ship) => vecDistance(ship.pos, target.pos) <= 600)
        )
          wing.engagementStarted = timeElapsed;
        for (const ship of healthy) {
          const distance = vecDistance(ship.pos, target.pos);
          const gunReady = ship.turrets.some((turret) => turret.cooldownTimer <= 0);
          if (
            (ship.lastMissionShotTime ?? -Infinity) >= wing.phaseStarted ||
            distance < target.size + 30 ||
            (!gunReady &&
              (distance <= shieldEnvelopeRadius(target) + 75 ||
                timeElapsed - (wing.engagementStarted ?? timeElapsed) >= 6)) ||
            (ship.maxSpeed > 0 &&
              (flak.get(ship)?.length ?? 0) > 0 &&
              target.hullClass === "corvette" &&
              (timeElapsed - (wing.engagementStarted ?? timeElapsed) >= 1.5 ||
                vecDot(vecSub(target.pos, ship.pos), rotatePoint([1, 0], ship.heading)) < 0))
          )
            this.setPhase(ship, "egress");
        }
      }
      // Keep later passes staggered even when independent echelons rejoin together.
      let lastGroupLaunch = -Infinity;
      for (const peer of groupWings)
        lastGroupLaunch = Math.max(lastGroupLaunch, peer.lastLaunchAt ?? -Infinity);
      if (
        phase === "staging" &&
        healthy.length > 0 &&
        (!wing.hasLaunched ||
          rallyAhead ||
          assembled ||
          timeElapsed - (wing.assembledAt ?? wing.phaseStarted) >= 2.5) &&
        timeElapsed + 1e-9 >= Math.max(wing.launchAt, lastGroupLaunch + WING_WAVE_DELAY)
      ) {
        phase = "attack";
        wing.hasLaunched = true;
        wing.lastLaunchAt = timeElapsed;
      } else if (
        phase === "attack" &&
        (healthy.length === 0 || healthy.every((ship) => ship.fighterPhase === "egress"))
      ) {
        phase = "egress";
      } else if (phase === "egress" && elapsed >= 1.4) {
        phase = "rejoin";
      } else if (phase === "rejoin" && (assembled || elapsed >= 2.5)) {
        phase = "staging";
        wing.launchAt = timeElapsed + WING_RELAUNCH_DELAY;
      }
      if (phase !== wing.phase) {
        wing.phase = phase;
        wing.phaseStarted = timeElapsed;
        wing.assembledAt = undefined;
        wing.engagementStarted = undefined;
        if (phase === "attack")
          for (const ship of healthy)
            this.setPhase(
              ship,
              vecDistance(ship.pos, target.pos) < target.size + 30 ? "egress" : "attack",
            );
      }
      for (const ship of members)
        this.setPhase(
          ship,
          this.needsCover(ship)
            ? "recover"
            : (flak.get(ship)?.length ?? 0) >= 2
              ? "egress"
              : ship.dogfightTargetId
                ? "intercept"
                : wing.phase === "attack" && ship.fighterPhase === "egress"
                  ? "egress"
                  : wing.phase,
        );
    }
  }

  updateCycle(
    ship: ShipState,
    target: ShipState,
    dt: number,
    aliveShips: ShipState[],
  ): { heading: number; speed: number } {
    const { timeElapsed, projectiles } = this.context;
    const threats = hostileFlakThreats(ship, aliveShips);
    if (threats.length >= 2 || (threats.length && ship.fighterPhase === "intercept")) {
      ship.dogfightTargetId = undefined;
      this.setPhase(ship, "egress");
    }
    const wing = this.wings.find((w) => w.team === ship.team && w.index === ship.wingIndex);
    if (!wing) return { heading: ship.heading, speed: 0 };
    const phase = ship.havenState === "seeking" ? "recover" : (ship.fighterPhase ?? wing.phase);
    const tier = this.context.crewVeterancy?.[ship.team] ?? "pilot";
    const tactics = CREW_TACTICS[tier];
    const tick = fighterTacticalTick(ship, timeElapsed, aliveShips, tier);
    const previous = this.steering.get(ship);
    if (previous && previous.tick === tick && previous.phase === phase) return previous;
    // Safe haven management retains shield health, distance, and occupancy scoring.
    const navigation = navigationContext(aliveShips) ?? prepareNavigationContext(aliveShips);
    let safeHaven =
      ship.safeHavenId !== undefined && ship.safeHavenId !== null
        ? navigation.byId.get(ship.safeHavenId)
        : undefined;
    if (
      safeHaven &&
      (safeHaven.team !== ship.team ||
        !safeHaven.isAlive ||
        (!isCapitalShip(safeHaven) && safeHaven.hullClass !== "corvette"))
    )
      safeHaven = undefined;
    const criticallyWounded = ship.hullCurrent < ship.hullMax * 0.3;
    if (
      criticallyWounded ||
      ship.safeHavenTimer === undefined ||
      ship.safeHavenTimer <= 0 ||
      !safeHaven
    ) {
      const friendlyAnchors = navigation.anchorsByTeam.get(ship.team) ?? [];
      const safeHavenOccupancy = navigation.havenOccupancyByTeam.get(ship.team);
      if (friendlyAnchors.length > 0) {
        let bestAnchor = friendlyAnchors[0];
        let bestScore = -Infinity;
        for (const anchor of friendlyAnchors) {
          const occupancy = safeHavenOccupancy?.get(anchor.id) ?? 0;
          const shieldRatio = anchor.shieldMax > 0 ? anchor.shieldCurrent / anchor.shieldMax : 0;
          const dx = ship.pos[0] - anchor.pos[0];
          const dy = ship.pos[1] - anchor.pos[1];
          const distToAnchor = Math.sqrt(dx * dx + dy * dy);
          const score = criticallyWounded
            ? -distToAnchor
            : shieldRatio * 80 - distToAnchor * 0.15 - occupancy * 50;
          if (score > bestScore) {
            bestScore = score;
            bestAnchor = anchor;
          }
        }
        navigation.setSafeHaven(ship, bestAnchor.id);
        ship.safeHavenTimer = 2.0;
        safeHaven = bestAnchor;
      } else {
        navigation.setSafeHaven(ship, null);
        ship.safeHavenTimer = 1.0;
        safeHaven = undefined;
      }
    } else {
      ship.safeHavenTimer =
        (ship.safeHavenTimer ?? 0) - (previous ? timeElapsed - previous.evaluatedAt : dt);
    }
    const isDamaged = this.needsCover(ship);
    const targetDistance = vecDistance(ship.pos, target.pos);
    const liningUp =
      phase === "attack" &&
      ship.turrets.some(
        (turret) => turret.cooldownTimer <= 0 && targetDistance <= turret.weapon.range + 120,
      );
    const attackSpeed = ship.maxSpeed;
    let intentTarget: Vector2;
    const slot = ship.wingSlot ?? 0;
    const rallySlot = this.rallySlot(wing, ship);
    switch (phase) {
      case "intercept": {
        const opponent =
          (ship.dogfightTargetId
            ? navigationContext(aliveShips)?.byId.get(ship.dogfightTargetId)
            : undefined) ??
          aliveShips.find((s) => s.id === ship.dogfightTargetId) ??
          target;
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
      case "rejoin":
        intentTarget = rallySlot;
        break;
      case "attack": {
        const standoff = shieldEnvelopeRadius(target) + 95;
        const forward = rotatePoint([1, 0], wing.heading);
        const toRally = vecSub(rallySlot, ship.pos);
        const acquiringCorridor =
          vecDot(toRally, forward) > WING_RALLY_TOLERANCE &&
          Math.abs(vecDot(toRally, [-forward[1], forward[0]])) > WING_RALLY_TOLERANCE;
        intentTarget = acquiringCorridor
          ? rallySlot
          : isCapitalShip(target) || target.hullClass === "corvette"
            ? fighterShieldWaypoint(ship, target, wing.index % 2 === 0 ? 1 : -1, true)
            : vecAdd(target.pos, rotatePoint([-standoff, slot * 35], wing.heading));
        break;
      }
      case "egress":
      case "recover": {
        const peelSign = wing.index % 2 === 0 ? 1 : -1;
        intentTarget = safeHaven
          ? phase === "egress" && isCapitalShip(safeHaven)
            ? fighterShieldWaypoint(ship, safeHaven, peelSign)
            : vecAdd(
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
    const laneAvoidance = spinalEscape(ship, aliveShips, projectiles, timeElapsed);
    const avoid = vecAdd(
      laneAvoidance,
      vecAdd(separation(ship, aliveShips), this.wingDispersal(ship, aliveShips)),
    );
    const recoveryDir =
      phase === "recover" || phase === "egress"
        ? fighterRecoveryDirection(ship, intentTarget, aliveShips, timeElapsed)
        : friendlyShieldRecoveryDirection(ship, intentTarget, aliveShips, vecNormalize(toIntent));
    const intentDir = vecNormalize(vecAdd(vecScale(recoveryDir, ship.maxSpeed), avoid));
    // Score reachable trajectories rather than hypothetical instant maximum-speed turns.
    const SECTORS = 16;
    const candidateSpeed = Math.min(attackSpeed, vecDistance([0, 0], ship.velocity) + 120);
    const projectileThreats = projectiles
      .filter(
        (p) =>
          p.ownerTeam !== ship.team &&
          (p.weaponType === "missile" || p.weaponType === "railgun") &&
          p.hp > 0 &&
          p.lifetime > 0 &&
          vecDistance(ship.pos, p.pos) <= 650,
      )
      .map((p) => ({
        velocity: p.velocity,
        relative: vecSub(ship.pos, p.pos),
        horizon: Math.min(2, p.lifetime),
      }));
    const craftRadius = shieldEnvelopeRadius(ship);
    const projectileMargin = 75 * tactics.margin;
    const obstacles = aliveShips
      .filter(
        (s) =>
          s.isAlive &&
          !s.isDocked &&
          !s.isDebris &&
          s.id !== ship.id &&
          !(s.team === ship.team && s.hullClass === "strike_craft") &&
          (s.pos[0] - ship.pos[0]) ** 2 + (s.pos[1] - ship.pos[1]) ** 2 <=
            Math.max(800, flakThreatRadius(s)) ** 2,
      )
      .map((obstacle) => {
        const capital = isCapitalShip(obstacle);
        const missionTarget = liningUp && obstacle.id === target.id;
        return {
          obstacle,
          capital,
          relative: vecSub(obstacle.pos, ship.pos),
          distance: vecDistance(ship.pos, obstacle.pos),
          clearance:
            craftRadius + shieldEnvelopeRadius(obstacle) + (missionTarget ? 20 : capital ? 95 : 40),
          horizon: missionTarget ? 0.25 : 1,
          flak: obstacle.team !== ship.team && obstacle.hullClass === "corvette",
          flakDenialRadius: Math.max(0, flakThreatRadius(obstacle) - obstacle.size * 3),
          flakFear:
            obstacle.team !== ship.team && obstacle.hullClass === "corvette"
              ? swarmFlakFear(ship, obstacle, aliveShips)
              : 1,
          pdRange:
            obstacle.team !== ship.team &&
            (phase === "staging" || phase === "rejoin" || phase === "recover")
              ? Math.max(
                  0,
                  ...obstacle.turrets
                    .filter((t) => t.weapon.weaponType === "point_defense")
                    .map((t) => t.weapon.range + 80),
                )
              : 0,
        };
      });
    const peers = aliveShips
      .filter(
        (peer) =>
          peer.isAlive &&
          !peer.isDocked &&
          peer.id !== ship.id &&
          peer.team === ship.team &&
          peer.hullClass === "strike_craft",
      )
      .map((peer) => ({
        direction: vecNormalize(vecSub(peer.pos, ship.pos)),
        distance: vecDistance(peer.pos, ship.pos),
      }))
      .filter((peer) => peer.distance < FIGHTER_CLEARANCE);
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
      const candidateX = Math.cos(reachable);
      const candidateY = Math.sin(reachable);
      const velocityX = candidateX * candidateSpeed;
      const velocityY = candidateY * candidateSpeed;
      // Recovery values the eventual sanctuary bearing even when it requires a full turn.
      const interestScore =
        phase === "recover"
          ? Math.cos(sectorAngle) * intentDir[0] + Math.sin(sectorAngle) * intentDir[1]
          : candidateX * intentDir[0] + candidateY * intentDir[1];
      let dangerScore = 0;
      for (const p of projectileThreats) {
        const r = p.relative;
        const ux = velocityX - p.velocity[0];
        const uy = velocityY - p.velocity[1];
        const uSq = ux * ux + uy * uy + 1e-4;
        const horizon = p.horizon;
        const tStar = clamp(-(r[0] * ux + r[1] * uy) / uSq, 0, horizon);
        const rx = r[0] + ux * tStar;
        const ry = r[1] + uy * tStar;
        const dStar = Math.sqrt(rx * rx + ry * ry);
        if (tStar > 0.04 && dStar < projectileMargin) {
          const missileDanger =
            ((projectileMargin - dStar) / projectileMargin) * (1 - tStar / horizon) * 4.5;
          dangerScore += missileDanger;
        }
      }
      for (const entry of obstacles) {
        const { obstacle, relative, capital, clearance, horizon, pdRange } = entry;
        const vx = obstacle.velocity[0] - velocityX;
        const vy = obstacle.velocity[1] - velocityY;
        const t = clamp(
          -(relative[0] * vx + relative[1] * vy) / Math.max(1, vx * vx + vy * vy),
          0,
          horizon,
        );
        const dx = relative[0] + vx * t;
        const dy = relative[1] + vy * t;
        const distance = t === 0 ? entry.distance : Math.sqrt(dx * dx + dy * dy);
        if (distance < clearance) dangerScore += (capital ? 14 : 6) * (1 - distance / clearance);
        if (distance < pdRange) dangerScore += 3 * (1 - distance / pdRange);
        if (entry.flak && distance < entry.flakDenialRadius)
          dangerScore +=
            (phase === "attack" && obstacle.id === target.id && threats.length === 1 ? 0.5 : 8) *
            entry.flakFear *
            (1 - distance / entry.flakDenialRadius);
      }
      if (dangerScore > maxDangerObserved) maxDangerObserved = dangerScore;
      let congestionScore = 0;
      for (const peer of peers) {
        const peerDist = peer.distance;
        const headingTowardPeer = candidateX * peer.direction[0] + candidateY * peer.direction[1];
        if (headingTowardPeer > 0)
          congestionScore += headingTowardPeer * (1 - peerDist / FIGHTER_CLEARANCE) * 1.8;
      }
      let flickerPenalty = 0;
      if (ship.lastSelectedSector !== undefined) {
        const prevAngle = (ship.lastSelectedSector * 2 * Math.PI) / SECTORS;
        const angleDiff = normalizeAngle(sectorAngle - prevAngle);
        flickerPenalty = 0.35 * (1 - Math.cos(angleDiff));
      }
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
    // Commitment is tier-specific; mission phase changes still break the hold.
    const hold =
      previous?.evasive &&
      previous.phase === phase &&
      timeElapsed - previous.committedAt < tactics.hold;
    if (hold && ship.lastSelectedSector !== undefined) bestSector = ship.lastSelectedSector;
    const changed = ship.lastSelectedSector !== bestSector || previous?.phase !== phase;
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
    const decision = {
      tick,
      phase,
      heading: finalHeading,
      speed,
      committedAt: changed ? timeElapsed : (previous?.committedAt ?? timeElapsed),
      evaluatedAt: timeElapsed,
      evasive: Boolean(hold) || maxDangerObserved > 0.4,
    };
    ship.evasionUntil = decision.evasive ? decision.committedAt + tactics.hold : undefined;
    this.steering.set(ship, decision);
    return decision;
  }
}
