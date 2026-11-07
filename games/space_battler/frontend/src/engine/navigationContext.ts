import type { ShipState } from "../types/combat";
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";
import { flakThreatRadius, HULL_PROFILES } from "./shipProfiles";

export { CORVETTE_FLAK_THREAT_RADIUS } from "./shipProfiles";

const contexts = new WeakMap<ShipState[], NavigationContext>();

type AssignmentCounts = Map<number, Map<number, Map<string, number>>>;

export class NavigationContext {
  readonly byId = new Map<string, ShipState>();
  readonly teams = new Map<number, ShipState[]>();
  readonly teamEnemies = new Map<number, ShipState[]>();
  readonly hulls = new Map<ShipState["hullClass"], ShipState[]>();
  readonly anchors = new Map<ShipState, ShipState | undefined>();
  readonly safe = new Map<ShipState, boolean>();
  readonly isolated = new Map<ShipState, boolean>();
  readonly localDensity = new Map<ShipState, Map<number, number>>();
  readonly packs = new Map<ShipState, ShipState[]>();
  readonly capitalAssignments = new Map<number, Map<string, number>>();
  readonly navigationAssignments: AssignmentCounts = new Map();
  readonly dogfightAssignments: AssignmentCounts = new Map();

  constructor(ships: ShipState[]) {
    for (const ship of ships) {
      this.byId.set(ship.id, ship);
      if (!ship.isAlive) continue;
      this.adjust(this.dogfightAssignments, ship, ship.dogfightTargetId, 1);
      if (ship.isDocked || ship.isDebris) continue;
      const team = this.teams.get(ship.team) ?? [];
      team.push(ship);
      this.teams.set(ship.team, team);
      const hull = this.hulls.get(ship.hullClass) ?? [];
      hull.push(ship);
      this.hulls.set(ship.hullClass, hull);
      this.adjust(this.navigationAssignments, ship, ship.navigationTargetId, 1);
    }
    // Preserve source order for scoring ties, including enemies from multiple teams.
    // Eligibility remains live: a hull can dock or die after this context is prepared.
    for (const team of this.teams.keys())
      this.teamEnemies.set(
        team,
        ships.filter((ship) => ship.team !== team),
      );
    for (const team of this.teams.values()) {
      const capitals = team.filter(isCapitalShip);
      const flak = team.filter((ship) => ship.hullClass === "corvette");
      for (const ship of team) {
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
        const density = countTacticalDensity(ship, ships);
        this.localDensity.set(ship, density);
        this.isolated.set(ship, (density.get(ship.team) ?? 0) <= 2);
      }
    }
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
  const stockRange = Math.max(...profile.turrets.map((turret) => turret.weapon.range));
  const weaponScale = ship.turrets.length
    ? Math.max(...ship.turrets.map((turret) => turret.weapon.range)) / stockRange
    : envelopeScale;
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
  const radiusSquared = tacticalSupportRadius(ship) ** 2;
  for (const peer of ships) {
    if (
      !peer.isAlive ||
      peer.isDocked ||
      peer.isDebris ||
      distanceSquared(ship, peer) > radiusSquared
    )
      continue;
    density.set(peer.team, (density.get(peer.team) ?? 0) + 1);
  }
  return density;
}

export function prepareNavigationContext(ships: ShipState[]): NavigationContext {
  const context = new NavigationContext(ships);
  contexts.set(ships, context);
  return context;
}

export function navigationContext(ships: ShipState[]): NavigationContext | undefined {
  return contexts.get(ships);
}
