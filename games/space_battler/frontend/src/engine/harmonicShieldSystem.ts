import type { ShipState } from "../types/combat";
import type { ActiveBeam, BeamFireCallback } from "./beamLaserSystem";
import { vecDistance } from "./math2d";

export const HARMONIC_RANGE = 500;
export const HARMONIC_RATE = 65;
export const HARMONIC_ACTIVE_SECONDS = 6;
export const HARMONIC_CYCLE_SECONDS = 10;

// NOTE: Tracking-only ECM (-45% turn rate) was benchmarked by Astra and proved
// insufficient to stop light missile swarms against large capital envelopes
// (+0% misses against Quivers). Future ECM pulse implementation must incorporate
// seeker lock disruption or fuse detonation to effectively neutralize swarm salvos.

interface HarmonicCycle {
  donor: ShipState;
  recipient: ShipState | null;
  activeUntil: number;
  readyAt: number;
}

export function eligibleHarmonicRecipient(donor: ShipState, recipient: ShipState): boolean {
  return (
    donor.isAlive &&
    donor.hullClass === "tender" &&
    recipient.isAlive &&
    recipient.id !== donor.id &&
    recipient.hullClass !== "tender" &&
    recipient.team === donor.team &&
    recipient.shieldCurrent < recipient.shieldMax &&
    vecDistance(donor.pos, recipient.pos) <= HARMONIC_RANGE
  );
}

/** One 390-SP capacitor budget: six seconds of transfer, then four of recharge.
 * Interruptions discard the remainder and preserve the original ten-second cycle.
 */
export class HarmonicShieldSystem {
  private cycles = new Map<string, HarmonicCycle>();

  clear(): void {
    this.cycles.clear();
  }

  cleanup(ships: readonly ShipState[], time: number): void {
    const present = new Set(ships);
    for (const [id, cycle] of this.cycles) {
      if (!present.has(cycle.donor) || !cycle.donor.isAlive) {
        this.cycles.delete(id);
      } else if (
        cycle.recipient &&
        (!present.has(cycle.recipient) ||
          time >= cycle.activeUntil - 1e-9 ||
          !eligibleHarmonicRecipient(cycle.donor, cycle.recipient))
      ) {
        cycle.recipient = null;
      }
    }
  }

  update(
    ships: readonly ShipState[],
    time: number,
    dt: number,
    onBeamFire?: BeamFireCallback | null,
    onRestore?: (recipient: ShipState, amount: number) => void,
  ): void {
    const start = time - dt;
    this.cleanup(ships, start);
    // Reserve existing channels first, then allocate in ID order regardless of fleet storage.
    const occupied = new Set(
      [...this.cycles.values()].flatMap((cycle) => (cycle.recipient ? [cycle.recipient.id] : [])),
    );
    const donors = ships
      .filter((ship) => ship.isAlive && ship.hullClass === "tender")
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const donor of donors) {
      let cycle = this.cycles.get(donor.id);
      if (!cycle || start >= cycle.readyAt - 1e-9) {
        const recipient = ships
          .filter((ship) => !occupied.has(ship.id) && eligibleHarmonicRecipient(donor, ship))
          .sort(
            (a, b) =>
              a.shieldCurrent / a.shieldMax - b.shieldCurrent / b.shieldMax ||
              vecDistance(donor.pos, a.pos) - vecDistance(donor.pos, b.pos) ||
              a.id.localeCompare(b.id),
          )[0];
        if (!recipient) continue;
        cycle = {
          donor,
          recipient,
          activeUntil: start + HARMONIC_ACTIVE_SECONDS,
          readyAt: start + HARMONIC_CYCLE_SECONDS,
        };
        this.cycles.set(donor.id, cycle);
        occupied.add(recipient.id);
        onBeamFire?.(
          donor.pos,
          recipient.pos,
          donor.team === 0 ? "#22d3ee" : "#f43f5e",
          2.8,
          donor.team,
          true,
        );
      }
      if (!cycle.recipient) continue;
      const recipient = cycle.recipient;
      const amount = Math.min(
        recipient.shieldMax - recipient.shieldCurrent,
        HARMONIC_RATE * Math.max(0, Math.min(time, cycle.activeUntil) - start),
      );
      recipient.shieldCurrent += amount;
      onRestore?.(recipient, amount);
    }
    this.cleanup(ships, time);
  }

  collectActiveBeams(): ActiveBeam[] {
    return [...this.cycles.values()].flatMap(({ donor, recipient }): ActiveBeam[] =>
      recipient
        ? [
            {
              id: `${donor.id}:harmonic`,
              from: [...donor.pos],
              to: [...recipient.pos],
              ownerTeam: donor.team,
              color: donor.team === 0 ? "#22d3ee" : "#f43f5e",
              harmonic: true,
            },
          ]
        : [],
    );
  }
}
