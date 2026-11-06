import type { ShipState, Vector2 } from "../types/combat";
import { rotatePoint, vecAdd, vecDistance, vecScale } from "./math2d";
import { isCapitalShip } from "./shieldGeometry";

// Normalized parent-local coordinates: +x forward, -y port. Side stations clear
// the narrow capital hull while remaining well inside its 1.68x umbrella.
export const SHIELD_HAVEN_SLOTS = {
  "port-forward": [0.65, -1.05],
  "port-mid": [0, -1.05],
  "port-aft": [-0.65, -1.05],
  "starboard-forward": [0.65, 1.05],
  "starboard-mid": [0, 1.05],
  "starboard-aft": [-0.65, 1.05],
} as const;

export type ShieldHavenSlotId = keyof typeof SHIELD_HAVEN_SLOTS;
const SLOT_IDS = Object.keys(SHIELD_HAVEN_SLOTS) as ShieldHavenSlotId[];

export interface ShieldHavenLease {
  readonly guestId: string;
  readonly parentId: string;
  readonly slotId: ShieldHavenSlotId;
}

export function shieldHavenSlotPosition(parent: ShipState, slotId: ShieldHavenSlotId): Vector2 {
  const offset = SHIELD_HAVEN_SLOTS[slotId];
  const local = vecScale([offset[0], offset[1]], parent.size);
  return vecAdd(parent.pos, rotatePoint(local, parent.heading));
}

function eligibleGuest(ship: ShipState): boolean {
  return (
    ship.isAlive &&
    ship.hullCurrent > 0 &&
    (ship.hullClass === "strike_craft" || ship.hullClass === "corvette")
  );
}

function eligibleParent(guest: ShipState, parent: ShipState): boolean {
  return (
    parent.isAlive &&
    parent.hullCurrent > 0 &&
    parent.shieldMax > 0 &&
    parent.team === guest.team &&
    isCapitalShip(parent) &&
    (parent.hullClass !== "cruiser" || guest.hullClass === "strike_craft")
  );
}

/** Fixed-step, atomic leases. Allocation order never depends on fleet storage order. */
export class ShieldHavenSystem {
  private leases = new Map<string, ShieldHavenLease>();

  getLease(guestId: string): ShieldHavenLease | null {
    return this.leases.get(guestId) ?? null;
  }

  release(guestId: string): void {
    this.leases.delete(guestId);
  }

  clear(): void {
    this.leases.clear();
  }

  /** Remove unsafe leases immediately after combat, without starting new episodes. */
  cleanup(ships: readonly ShipState[]): void {
    const byId = new Map(ships.map((ship) => [ship.id, ship]));
    for (const [guestId, lease] of this.leases) {
      const guest = byId.get(guestId);
      const parent = byId.get(lease.parentId);
      if (
        !guest ||
        !eligibleGuest(guest) ||
        !parent ||
        !eligibleParent(guest, parent) ||
        parent.shieldCurrent <= 0 ||
        parent.shieldCurrent < parent.shieldMax * 0.1
      )
        this.release(guestId);
    }
  }

  request(guest: ShipState, ships: readonly ShipState[], time: number): ShieldHavenLease | null {
    this.cleanup(ships);
    if (!eligibleGuest(guest)) return null;
    const existing = this.getLease(guest.id);
    if (existing) return existing;
    const newHullDamage =
      guest.hullCurrent < guest.hullMax * 0.3 &&
      guest.hullCurrent < (guest.recoveredHull ?? Infinity);
    if (guest.recoveryStarted === undefined) {
      if (!newHullDamage && guest.shieldCurrent > 0) return null;
      guest.recoveryStarted = time;
    }
    const parents = ships
      .filter(
        (parent) => eligibleParent(guest, parent) && parent.shieldCurrent > parent.shieldMax * 0.15,
      )
      .sort(
        (a, b) =>
          vecDistance(guest.pos, a.pos) - vecDistance(guest.pos, b.pos) || a.id.localeCompare(b.id),
      );
    for (const parent of parents) {
      const occupied = new Set(
        [...this.leases.values()]
          .filter((lease) => lease.parentId === parent.id)
          .map((lease) => lease.slotId),
      );
      const slot = SLOT_IDS.find((candidate) => !occupied.has(candidate));
      if (!slot) continue;
      const lease = Object.freeze({ guestId: guest.id, parentId: parent.id, slotId: slot });
      this.leases.set(guest.id, lease);
      return lease;
    }
    return null;
  }

  update(ships: readonly ShipState[], time: number): void {
    this.cleanup(ships);
    for (const guest of [...ships].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!eligibleGuest(guest)) continue;
      if (
        guest.recoveryStarted !== undefined &&
        guest.recoveryStarted < time &&
        guest.shieldCurrent >= guest.shieldMax * 0.75
      ) {
        this.release(guest.id);
        guest.recoveredHull = guest.hullCurrent;
        guest.recoveryStarted = undefined;
        continue;
      }
      this.request(guest, ships, time);
    }
  }
}
