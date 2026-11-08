import type { ShipState } from "../types/combat";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import { flakThreatRadius, HULL_PROFILES } from "./shipProfiles";

export { CORVETTE_FLAK_THREAT_RADIUS } from "./shipProfiles";

const contexts = new WeakMap<ShipState[], NavigationContext>();

interface CachedNeighborhood {
  tick: number;
  posX: number;
  posY: number;
  fleetSignature: number;
  anchor: ShipState | undefined;
  safe: boolean;
  density: Map<number, number>;
  isolated: boolean;
}

/** Battle-local cadence and exact membership invalidation, including same-count replacements. */
export class NavigationNeighborhoodCache {
  readonly neighborhoods = new WeakMap<ShipState, CachedNeighborhood>();
  tick = 0;
  fleetSignature = 0;
  private members: Array<{
    ship: ShipState;
    team: number;
    hullClass: ShipState["hullClass"];
    flagshipId: ShipState["flagshipId"];
    havenRadiusMultiplier: ShipState["havenRadiusMultiplier"];
  }> = [];

  advance(ships: ShipState[]): void {
    this.tick++;
    const unchanged =
      ships.length === this.members.length &&
      ships.every((ship, index) => {
        const previous = this.members[index];
        return (
          previous.ship === ship &&
          previous.team === ship.team &&
          previous.hullClass === ship.hullClass &&
          previous.flagshipId === ship.flagshipId &&
          previous.havenRadiusMultiplier === ship.havenRadiusMultiplier
        );
      });
    if (unchanged) return;
    this.fleetSignature++;
    this.members = ships.map((ship) => ({
      ship,
      team: ship.team,
      hullClass: ship.hullClass,
      flagshipId: ship.flagshipId,
      havenRadiusMultiplier: ship.havenRadiusMultiplier,
    }));
  }
}

type AssignmentCounts = Map<number, Map<number, Map<string, number>>>;

export class NavigationContext {
  readonly byId = new Map<string, ShipState>();
  readonly teams = new Map<number, ShipState[]>();
  readonly teamEnemies = new Map<number, ShipState[]>();
  readonly teamEnemyCapitals = new Map<number, ShipState[]>();
  readonly hulls = new Map<ShipState["hullClass"], ShipState[]>();
  readonly anchors = new Map<ShipState, ShipState | undefined>();
  readonly anchorsByTeam = new Map<number, ShipState[]>();
  readonly havenOccupancyByTeam = new Map<number, Map<string, number>>();
  readonly safe = new Map<ShipState, boolean>();
  readonly isolated = new Map<ShipState, boolean>();
  readonly localDensity = new Map<ShipState, Map<number, number>>();
  readonly packs = new Map<ShipState, ShipState[]>();
  readonly capitalAssignments = new Map<number, Map<string, number>>();
  readonly navigationAssignments: AssignmentCounts = new Map();
  readonly dogfightAssignments: AssignmentCounts = new Map();
  readonly activeWrecks: ShipState[];

  constructor(
    ships: ShipState[],
    cache = new NavigationNeighborhoodCache(),
    activeWrecks?: ShipState[],
  ) {
    this.activeWrecks = activeWrecks ?? [];
    const activeShips: ShipState[] = [];
    for (const ship of ships) {
      this.byId.set(ship.id, ship);
      if (!ship.isAlive) continue;
      if (ship.isDebris && !activeWrecks) this.activeWrecks.push(ship);
      if (!ship.isDebris) {
        if (isCapitalShip(ship) || ship.hullClass === "corvette") {
          const anchors = this.anchorsByTeam.get(ship.team) ?? [];
          anchors.push(ship);
          this.anchorsByTeam.set(ship.team, anchors);
        }
        if (ship.safeHavenId !== undefined && ship.safeHavenId !== null) {
          const occupancy = this.havenOccupancyByTeam.get(ship.team) ?? new Map<string, number>();
          occupancy.set(ship.safeHavenId, (occupancy.get(ship.safeHavenId) ?? 0) + 1);
          this.havenOccupancyByTeam.set(ship.team, occupancy);
        }
      }
      this.adjust(this.dogfightAssignments, ship, ship.dogfightTargetId, 1);
      if (ship.isDocked || ship.isDebris) continue;
      activeShips.push(ship);
      const team = this.teams.get(ship.team) ?? [];
      team.push(ship);
      this.teams.set(ship.team, team);
      const hull = this.hulls.get(ship.hullClass) ?? [];
      hull.push(ship);
      this.hulls.set(ship.hullClass, hull);
      this.adjust(this.navigationAssignments, ship, ship.navigationTargetId, 1);
    }
    cache.advance(activeShips);
    const shipOrder = new Map(activeShips.map((ship, index) => [ship, index]));
    // Preserve source order for scoring ties, including enemies from multiple teams.
    // Eligibility remains live: a hull can dock or die after this context is prepared.
    for (const team of this.teams.keys()) {
      this.teamEnemies.set(
        team,
        ships.filter((ship) => ship.team !== team),
      );
      this.teamEnemyCapitals.set(
        team,
        activeShips.filter((ship) => ship.team !== team && isCapitalShip(ship)),
      );
    }
    for (const team of this.teams.values()) {
      const capitals = team.filter(isCapitalShip);
      const capitalSet = new Set(capitals);
      const flak = team.filter((ship) => ship.hullClass === "corvette");
      for (const ship of team) {
        const cached = cache.neighborhoods.get(ship);
        const dx = ship.pos[0] - (cached?.posX ?? 0);
        const dy = ship.pos[1] - (cached?.posY ?? 0);
        if (
          cached &&
          cached.fleetSignature === cache.fleetSignature &&
          (!cached.anchor || capitalSet.has(cached.anchor)) &&
          cache.tick - cached.tick < 6 &&
          (shipOrder.get(ship) ?? 0) % 6 !== cache.tick % 6 &&
          dx * dx + dy * dy <= 324
        ) {
          this.anchors.set(ship, cached.anchor);
          this.safe.set(ship, cached.safe);
          this.localDensity.set(ship, cached.density);
          this.isolated.set(ship, cached.isolated);
          continue;
        }
        let anchor: ShipState | undefined;
        let bestDistance = Infinity;
        for (const capital of capitals) {
          if (capital.id === ship.id) continue;
          const distance = distanceSquared(ship, capital);
          if (capital.id === ship.flagshipId) {
            anchor = capital;
            break;
          }
          if (
            distance < bestDistance ||
            (distance === bestDistance && anchor && capital.id.localeCompare(anchor.id) < 0)
          ) {
            anchor = capital;
            bestDistance = distance;
          }
        }
        this.anchors.set(ship, anchor);
        let threats = 0;
        for (const peer of flak) {
          const radius = flakThreatRadius(peer);
          if (radius > 0 && distanceSquared(ship, peer) <= radius ** 2 && ++threats >= 2) break;
        }
        this.safe.set(ship, threats < 2);
        const density = countTacticalDensity(ship, activeShips);
        this.localDensity.set(ship, density);
        this.isolated.set(ship, (density.get(ship.team) ?? 0) <= 2);
        cache.neighborhoods.set(ship, {
          tick: cache.tick,
          posX: ship.pos[0],
          posY: ship.pos[1],
          fleetSignature: cache.fleetSignature,
          anchor,
          safe: threats < 2,
          density,
          isolated: (density.get(ship.team) ?? 0) <= 2,
        });
      }
    }
  }

  setSafeHaven(ship: ShipState, targetId: string | null): void {
    if (ship.safeHavenId === targetId) return;
    const occupancy = this.havenOccupancyByTeam.get(ship.team) ?? new Map<string, number>();
    if (ship.safeHavenId !== undefined && ship.safeHavenId !== null)
      occupancy.set(ship.safeHavenId, (occupancy.get(ship.safeHavenId) ?? 0) - 1);
    if (targetId !== null) occupancy.set(targetId, (occupancy.get(targetId) ?? 0) + 1);
    this.havenOccupancyByTeam.set(ship.team, occupancy);
    ship.safeHavenId = targetId;
  }

  adjust(
    counts: AssignmentCounts,
    ship: ShipState,
    targetId: string | undefined,
    delta: number,
  ): void {
    if (!targetId) return;
    const groups = counts.get(ship.team) ?? new Map<number, Map<string, number>>();
    const targets = groups.get(ship.groupId) ?? new Map<string, number>();
    targets.set(targetId, (targets.get(targetId) ?? 0) + delta);
    groups.set(ship.groupId, targets);
    counts.set(ship.team, groups);
    if (
      counts === this.navigationAssignments &&
      (ship.hullClass === "dreadnought" || ship.hullClass === "battleship")
    ) {
      const team = this.capitalAssignments.get(ship.team) ?? new Map<string, number>();
      team.set(targetId, (team.get(targetId) ?? 0) + delta);
      this.capitalAssignments.set(ship.team, team);
    }
  }

  count(
    counts: AssignmentCounts,
    ship: ShipState,
    targetId: string,
    ownId: string | undefined,
  ): number {
    return (
      (counts.get(ship.team)?.get(ship.groupId)?.get(targetId) ?? 0) - Number(ownId === targetId)
    );
  }
}

export function distanceSquared(a: ShipState, b: ShipState): number {
  const dx = a.pos[0] - b.pos[0];
  const dy = a.pos[1] - b.pos[1];
  return dx * dx + dy * dy;
}

// Stock doctrine horizons are calibration points, not caps on refitted/scaled hulls.
const SUPPORT_HORIZONS: Record<ShipState["hullClass"], number> = {
  strike_craft: 400,
  corvette: 400,
  missile_frigate: 500,
  cruiser: 500,
  battleship: 600,
  dreadnought: 600,
  carrier: 600,
  tender: 600,
};

/** Blend physical coverage and weapon reach; either can change independently. */
export function navigationSpatialScale(ship: ShipState): number {
  const profile = HULL_PROFILES[ship.hullClass];
  const envelopeScale =
    shieldEnvelopeRadius(ship) /
    shieldEnvelopeRadius({ hullClass: ship.hullClass, size: profile.size });
  let stockRange = -Infinity;
  for (const turret of profile.turrets) stockRange = Math.max(stockRange, turret.weapon.range);
  let weaponRange = -Infinity;
  for (const turret of ship.turrets) weaponRange = Math.max(weaponRange, turret.weapon.range);
  const weaponScale = ship.turrets.length ? weaponRange / stockRange : envelopeScale;
  return (envelopeScale + weaponScale) / 2;
}

export function tacticalSupportRadius(ship: ShipState): number {
  return SUPPORT_HORIZONS[ship.hullClass] * navigationSpatialScale(ship);
}

/** Preserve the stock theater while reserving more pursuit reach for faster hulls. */
export function antiKitePursuitLimit(ship: ShipState): number {
  const speedScale = ship.maxSpeed / HULL_PROFILES[ship.hullClass].speed;
  return 900 * (navigationSpatialScale(ship) * 0.75 + speedScale * 0.25);
}

/** Includes the vessel itself; inactive hulls provide neither support nor pressure. */
export function tacticalDensity(ship: ShipState, ships: ShipState[]): Map<number, number> {
  const cached = navigationContext(ships)?.localDensity.get(ship);
  if (cached) return cached;
  return countTacticalDensity(ship, ships);
}

function countTacticalDensity(ship: ShipState, ships: ShipState[]): Map<number, number> {
  const density = new Map<number, number>();
  const radius = tacticalSupportRadius(ship);
  const radiusSquared = radius ** 2;
  for (const peer of ships) {
    if (!peer.isAlive || peer.isDocked || peer.isDebris) continue;
    const dx = ship.pos[0] - peer.pos[0];
    const dy = ship.pos[1] - peer.pos[1];
    if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
    if (dx * dx + dy * dy > radiusSquared) continue;
    density.set(peer.team, (density.get(peer.team) ?? 0) + 1);
  }
  return density;
}

/** Supply the battle's cache for cadence reuse; standalone snapshots remain fresh. */
export function prepareNavigationContext(
  ships: ShipState[],
  cache = new NavigationNeighborhoodCache(),
  activeWrecks?: ShipState[],
  sourceShips?: ShipState[],
): NavigationContext {
  const context = new NavigationContext(ships, cache, activeWrecks);
  contexts.set(ships, context);
  if (sourceShips) contexts.set(sourceShips, context);
  return context;
}

export function navigationContext(ships: ShipState[]): NavigationContext | undefined {
  return contexts.get(ships);
}
