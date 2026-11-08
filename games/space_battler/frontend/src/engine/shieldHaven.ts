import type { ShipState, Vector2 } from "../types/combat";
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
import { isCapitalShip, shieldEnvelopeRadius } from "./shieldGeometry";

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

export function shieldHavenSlotVelocity(parent: ShipState, slotId: ShieldHavenSlotId): Vector2 {
  const r = vecSub(shieldHavenSlotPosition(parent, slotId), parent.pos);
  return vecAdd(parent.velocity, vecScale([-r[1], r[0]], parent.angularVelocity ?? 0));
}

/** Only authoritative reservations/attachments grant nested shield access. */
export function sharesShieldHaven(a: ShipState, b: ShipState): boolean {
  if (a.team !== b.team) return false;
  const active = (ship: ShipState) =>
    !!ship.havenParentId &&
    !!ship.havenSlotId &&
    (ship.havenState === "approaching" ||
      ship.havenState === "tethered" ||
      ship.havenState === "releasing");
  return (
    (active(a) && a.havenParentId === b.id) ||
    (active(b) && b.havenParentId === a.id) ||
    (active(a) && active(b) && a.havenParentId === b.havenParentId)
  );
}

/** Conservative support bounds: narrow capital ellipse and circular guest hulls. */
export function havenHullClearance(a: ShipState, b: ShipState): number {
  const normal: Vector2 =
    vecDistance(a.pos, b.pos) > 1e-6
      ? vecNormalize(vecSub(a.pos, b.pos))
      : [0, a.id < b.id ? -1 : 1];
  const support = (ship: ShipState) => {
    if (!isCapitalShip(ship)) return ship.size;
    const local = rotatePoint(normal, -ship.heading);
    return ship.size * Math.hypot(local[0], local[1] * 0.75);
  };
  return support(a) + support(b);
}

export function havenAcceleration(ship: ShipState): number {
  return ship.hullClass === "strike_craft" ? 240 : 110;
}

function boundedVector(vector: Vector2, max: number): Vector2 {
  const length = vecDistance([0, 0], vector);
  return length > max ? vecScale(vector, max / length) : vector;
}

function resetHaven(ship: ShipState): void {
  ship.havenParentId = null;
  ship.havenSlotId = null;
  ship.havenState = "none";
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
  private ships = new Map<string, ShipState>();
  private currentShips = new Map<string, ShipState>();
  private tenders = new Map<number, ShipState[]>();
  private amplificationTenders = new Map<number, ShipState[]>();
  private amplificationFleet: ShipState[] = [];

  private tenderTeams(
    ships: Iterable<ShipState>,
    teams: Map<number, ShipState[]>,
  ): Map<number, ShipState[]> {
    for (const team of teams.values()) team.length = 0;
    for (const donor of ships) {
      if (!donor.isAlive || donor.hullClass !== "tender") continue;
      const team = teams.get(donor.team);
      if (team) team.push(donor);
      else teams.set(donor.team, [donor]);
    }
    return teams;
  }

  private hasTenderAura(parent: ShipState, teams = this.tenders): boolean {
    const tenders = teams.get(parent.team);
    if (!tenders || !parent.isAlive || !isCapitalShip(parent)) return false;
    for (const donor of tenders) {
      if (!donor.isAlive) continue;
      const dx = donor.pos[0] - parent.pos[0];
      const dy = donor.pos[1] - parent.pos[1];
      if (dx * dx + dy * dy <= 250000) return true;
    }
    return false;
  }

  private applyAmplification(ships: Iterable<ShipState>, teams: Map<number, ShipState[]>): void {
    for (const ship of ships)
      ship.havenRadiusMultiplier = this.hasTenderAura(ship, teams) ? 1.2 : 1;
  }

  /** One strongest aura, shared by hitboxes, repulsors, rendering and haven corridors. */
  refreshAmplification(ships: Iterable<ShipState> = this.ships.values()): void {
    const fleet = this.amplificationFleet;
    for (const ship of ships) fleet.push(ship);
    this.applyAmplification(fleet, this.tenderTeams(fleet, this.amplificationTenders));
    fleet.length = 0;
  }

  /** Snapshot before shield damage releases the guest's authoritative lease. */
  overflowMultiplier(parent: ShipState): number {
    return this.hasTenderAura(parent) ? 0.9 : 1;
  }

  getLease(guestId: string): ShieldHavenLease | null {
    return this.leases.get(guestId) ?? null;
  }

  protectedParent(guest: ShipState): ShipState | null {
    const lease = this.getLease(guest.id);
    const parent = lease && this.ships.get(lease.parentId);
    return guest.havenState === "tethered" &&
      guest.havenParentId === lease?.parentId &&
      guest.havenSlotId === lease?.slotId &&
      eligibleGuest(guest) &&
      parent &&
      eligibleParent(guest, parent) &&
      parent.shieldCurrent > 0
      ? parent
      : null;
  }

  releaseGuests(parentId: string): void {
    let released = false;
    for (const lease of this.leases.values()) {
      if (lease.parentId !== parentId) continue;
      this.releasePrepared(lease.guestId);
      released = true;
    }
    if (released) this.updateGuestCounts();
  }

  release(guestId: string): void {
    this.releasePrepared(guestId);
    this.updateGuestCounts();
  }

  private releasePrepared(guestId: string): void {
    const guest = this.ships.get(guestId);
    const lease = this.leases.get(guestId);
    const parent = lease && this.ships.get(lease.parentId);
    if (guest) {
      if (
        lease &&
        parent &&
        guest.isAlive &&
        (guest.havenState === "tethered" ||
          vecDistance(guest.pos, parent.pos) < shieldEnvelopeRadius(parent) + guest.size + 25)
      ) {
        guest.havenState = "releasing";
      } else if (guest.havenState !== "releasing") resetHaven(guest);
    }
    this.leases.delete(guestId);
  }

  clear(): void {
    for (const ship of this.ships.values()) {
      resetHaven(ship);
      ship.havenGuestCount = 0;
      ship.havenRadiusMultiplier = 1;
    }
    this.leases.clear();
    this.ships.clear();
    this.currentShips.clear();
    this.tenders.clear();
    this.amplificationTenders.clear();
    this.amplificationFleet.length = 0;
  }

  /** Remove unsafe leases immediately after combat, without starting new episodes. */
  cleanup(ships: readonly ShipState[]): void {
    this.tenderTeams(ships, this.tenders);
    this.applyAmplification(ships, this.tenders);
    // Keep previous objects in this.ships until removed fleet members have been reset.
    const byId = this.currentShips;
    byId.clear();
    for (const ship of ships) {
      byId.set(ship.id, ship);
      this.ships.set(ship.id, ship);
      ship.havenState ??= "none";
      ship.havenParentId ??= null;
      ship.havenSlotId ??= null;
    }
    for (const lease of this.leases.values()) {
      const guest = byId.get(lease.guestId);
      const parent = byId.get(lease.parentId);
      if (
        !guest ||
        !eligibleGuest(guest) ||
        !parent ||
        !eligibleParent(guest, parent) ||
        parent.shieldCurrent <= 0 ||
        parent.shieldCurrent < parent.shieldMax * 0.1
      )
        this.releasePrepared(lease.guestId);
    }
    for (const ship of this.ships.values()) {
      if (!byId.has(ship.id) || !ship.isAlive) {
        resetHaven(ship);
        this.ships.delete(ship.id);
      } else if (ship.havenState === "releasing" && !byId.get(ship.havenParentId ?? "")?.isAlive) {
        resetHaven(ship);
      }
    }
    this.updateGuestCounts();
  }

  request(guest: ShipState, ships: readonly ShipState[], time: number): ShieldHavenLease | null {
    this.cleanup(ships);
    return this.requestPrepared(guest, ships, time);
  }

  private requestPrepared(
    guest: ShipState,
    ships: readonly ShipState[],
    time: number,
  ): ShieldHavenLease | null {
    if (!eligibleGuest(guest)) return null;
    if (guest.havenState === "releasing") return null;
    const existing = this.getLease(guest.id);
    if (existing) return existing;
    const newHullDamage =
      guest.hullCurrent < guest.hullMax * 0.3 &&
      guest.hullCurrent < (guest.recoveredHull ?? Infinity);
    if (guest.recoveryStarted === undefined) {
      if (!newHullDamage && guest.shieldCurrent > 0) return null;
      guest.recoveryStarted = time;
    }
    guest.havenState = "seeking";
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
      guest.havenParentId = parent.id;
      guest.havenSlotId = slot;
      guest.havenState = "approaching";
      guest.safeHavenId = parent.id;
      return lease;
    }
    return null;
  }

  update(ships: readonly ShipState[], time: number): void {
    this.cleanup(ships);
    for (const guest of [...ships].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!eligibleGuest(guest)) continue;
      if (guest.havenState === "releasing") continue;
      if (
        guest.recoveryStarted !== undefined &&
        guest.recoveryStarted < time &&
        guest.shieldCurrent >= guest.shieldMax * 0.75
      ) {
        this.releasePrepared(guest.id);
        guest.recoveredHull = guest.hullCurrent;
        guest.recoveryStarted = undefined;
        continue;
      }
      this.requestPrepared(guest, ships, time);
    }
    this.updateGuestCounts();
  }

  private updateGuestCounts(): void {
    for (const ship of this.ships.values()) ship.havenGuestCount = 0;
    for (const lease of this.leases.values()) {
      if (this.ships.get(lease.guestId)?.havenState !== "tethered") continue;
      const parent = this.ships.get(lease.parentId);
      if (parent) parent.havenGuestCount = (parent.havenGuestCount ?? 0) + 1;
    }
  }

  /** Owns guest flight while reserved, attached, or traversing the release corridor. */
  moveGuest(guest: ShipState, ships: readonly ShipState[], dt: number): boolean {
    const lease = this.getLease(guest.id);
    const parent = ships.find((ship) => ship.id === guest.havenParentId);
    const slotId = lease?.slotId ?? (guest.havenSlotId as ShieldHavenSlotId | null);
    if (!parent || !slotId || !SHIELD_HAVEN_SLOTS[slotId]) return false;
    if (guest.havenState === "tethered") return true;
    if (guest.havenState !== "approaching" && guest.havenState !== "releasing") return false;

    const side = Math.sign(SHIELD_HAVEN_SLOTS[slotId][1]);
    const outward = rotatePoint([0, side], parent.heading);
    let desired: Vector2;
    let targetHeading = Math.atan2(outward[1], outward[0]);
    if (guest.havenState === "releasing") {
      // Keep the shield exemption until beyond the repulsor, not merely the hull.
      const clear = shieldEnvelopeRadius(parent) + shieldEnvelopeRadius(guest) + 30;
      if (vecDistance(guest.pos, parent.pos) >= clear) {
        resetHaven(guest);
        if (guest.hullClass === "strike_craft") guest.fighterPhase = "rejoin";
        guest.pos = vecAdd(guest.pos, vecScale(guest.velocity, dt));
        return true;
      }
      desired = vecAdd(parent.velocity, vecScale(outward, guest.maxSpeed * 0.65));
    } else {
      const local = rotatePoint(vecSub(guest.pos, parent.pos), -parent.heading);
      const slot = shieldHavenSlotPosition(parent, slotId);
      const aft = -parent.size - guest.size - 30;
      const sideClearance = parent.size * 1.05;
      // Route wrong-side arrivals around the stern before entering the side corridor.
      const waypoint: Vector2 =
        local[1] * side < sideClearance - 3
          ? local[0] > aft + 3
            ? [aft, local[1]]
            : [local[0], side * sideClearance]
          : rotatePoint(vecSub(slot, parent.pos), -parent.heading);
      const delta = vecSub(vecAdd(parent.pos, rotatePoint(waypoint, parent.heading)), guest.pos);
      const distance = vecDistance([0, 0], delta);
      targetHeading =
        distance < 35 && vecDistance(guest.pos, slot) < 35
          ? parent.heading
          : Math.atan2(delta[1], delta[0]);
      desired = vecAdd(
        shieldHavenSlotVelocity(parent, slotId),
        boundedVector(
          vecScale(delta, 1.5),
          Math.min(guest.maxSpeed, Math.sqrt(2 * havenAcceleration(guest) * distance) * 0.75),
        ),
      );
    }
    guest.heading = normalizeAngle(
      guest.heading +
        clamp(
          normalizeAngle(targetHeading - guest.heading),
          -guest.turnRate * dt,
          guest.turnRate * dt,
        ),
    );
    const forward: Vector2 = [Math.cos(guest.heading), Math.sin(guest.heading)];
    const forwardSpeed = vecDot(desired, forward);
    desired = vecAdd(
      desired,
      vecScale(forward, Math.max(0, -guest.maxSpeed * 0.35 - forwardSpeed)),
    );
    guest.velocity = vecAdd(
      guest.velocity,
      boundedVector(vecSub(desired, guest.velocity), havenAcceleration(guest) * dt),
    );
    guest.pos = vecAdd(guest.pos, vecScale(guest.velocity, dt));
    return true;
  }

  /** Run after parent motion/collisions so storage order cannot introduce tether drift. */
  attachGuests(ships: readonly ShipState[], dt: number): void {
    for (const lease of this.leases.values()) {
      const guest = ships.find((ship) => ship.id === lease.guestId);
      const parent = ships.find((ship) => ship.id === lease.parentId);
      if (!guest || !parent) continue;
      const pos = shieldHavenSlotPosition(parent, lease.slotId);
      const velocity = shieldHavenSlotVelocity(parent, lease.slotId);
      const wasTethered = guest.havenState === "tethered";
      if (guest.havenState !== "tethered") {
        if (vecDistance(guest.pos, pos) > 2 || vecDistance(guest.velocity, velocity) > 8) continue;
        const candidate = { ...guest, pos };
        if (
          ships.some(
            (peer) =>
              peer.id !== guest.id &&
              peer.isAlive &&
              vecDistance(pos, peer.pos) < havenHullClearance(candidate, peer),
          )
        )
          continue;
        guest.havenState = "tethered";
      }
      guest.pos = pos;
      guest.velocity = velocity;
      if (wasTethered)
        guest.heading = normalizeAngle(
          guest.heading +
            clamp(
              normalizeAngle(parent.heading - guest.heading),
              -guest.turnRate * dt,
              guest.turnRate * dt,
            ),
        );
    }
    this.updateGuestCounts();
  }
}
