import type { ShipState } from "../types/combat";
import { isCapitalShip } from "./shieldGeometry";
import { flakThreatRadius } from "./shipProfiles";

export { CORVETTE_FLAK_THREAT_RADIUS } from "./shipProfiles";

const contexts = new WeakMap<ShipState[], NavigationContext>();

type AssignmentCounts = Map<number, Map<number, Map<string, number>>>;

export class NavigationContext {
  readonly byId = new Map<string, ShipState>();
  readonly teams = new Map<number, ShipState[]>();
  readonly hulls = new Map<ShipState["hullClass"], ShipState[]>();
  readonly anchors = new Map<ShipState, ShipState | undefined>();
  readonly safe = new Map<ShipState, boolean>();
  readonly isolated = new Map<ShipState, boolean>();
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
        if (ship.hullClass === "strike_craft")
          this.isolated.set(
            ship,
            !team.some((peer) => peer.id !== ship.id && distanceSquared(ship, peer) <= 400 * 400),
          );
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

export function prepareNavigationContext(ships: ShipState[]): NavigationContext {
  const context = new NavigationContext(ships);
  contexts.set(ships, context);
  return context;
}

export function navigationContext(ships: ShipState[]): NavigationContext | undefined {
  return contexts.get(ships);
}
