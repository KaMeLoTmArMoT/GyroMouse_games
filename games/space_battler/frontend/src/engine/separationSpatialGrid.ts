import type { ShipState } from "../types/combat";
import { ARENA_RADIUS } from "./arenaBoundary";
import { shieldEnvelopeRadius } from "./shieldGeometry";

// Index geometry only; this does not change any physical clearance or arena bound.
const CELL_SIZE = 256;

/** Battle-local scratch storage. Rebuild once per movement snapshot, query without allocating. */
export class SeparationSpatialGrid {
  ships: ShipState[] | undefined;
  private width = 0;
  private origin = 0;
  private heads = new Int32Array(0);
  private next = new Int32Array(256);
  private candidates = new Uint32Array(8);
  private wordCount = 0;
  private maxSize = 0;
  private maxEnvelope = 0;
  private maxVelocityX = 0;
  private maxVelocityY = 0;

  rebuild(ships: ShipState[]): void {
    this.ships = ships;
    const width = Math.max(1, Math.ceil((2 * ARENA_RADIUS) / CELL_SIZE));
    if (width !== this.width) {
      this.width = width;
      this.heads = new Int32Array(width * width);
    }
    this.origin = ARENA_RADIUS;
    if (ships.length > this.next.length) {
      const capacity = Math.max(ships.length, this.next.length * 2);
      this.next = new Int32Array(capacity);
      this.candidates = new Uint32Array(Math.ceil(capacity / 32));
    }
    this.wordCount = Math.ceil(ships.length / 32);
    this.heads.fill(-1);
    this.maxSize = 0;
    this.maxEnvelope = 0;
    this.maxVelocityX = 0;
    this.maxVelocityY = 0;
    // Include docked, debris and dead entries: separation's eligibility remains live.
    for (let index = 0; index < ships.length; index++) {
      const ship = ships[index];
      const cell = this.cell(ship.pos[1]) * width + this.cell(ship.pos[0]);
      this.next[index] = this.heads[cell];
      this.heads[cell] = index;
      this.maxSize = Math.max(this.maxSize, ship.size);
      this.maxEnvelope = Math.max(this.maxEnvelope, ship.size, shieldEnvelopeRadius(ship));
      this.maxVelocityX = Math.max(this.maxVelocityX, Math.abs(ship.velocity[0]));
      this.maxVelocityY = Math.max(this.maxVelocityY, Math.abs(ship.velocity[1]));
    }
  }

  query(ship: ShipState): void {
    const envelope = Math.max(ship.size, shieldEnvelopeRadius(ship));
    // Upper bounds of the existing pairwise capital/escort/envelope clearance and
    // L1 closing-speed early-out, including the escort's additional braking buffer.
    const clearance = Math.max(
      420,
      220,
      ship.size + this.maxSize + 90,
      envelope + this.maxEnvelope + 30,
    );
    const closing =
      Math.abs(ship.velocity[0]) +
      this.maxVelocityX +
      Math.abs(ship.velocity[1]) +
      this.maxVelocityY;
    const radius = clearance + (closing * closing) / 440 + closing * 0.15 + 90;
    // Round outward so a cell-edge rounding difference cannot omit a narrowphase peer.
    const padding = Math.max(1, radius) * Number.EPSILON * 8;
    const minX = this.cell(ship.pos[0] - radius - padding);
    const maxX = this.cell(ship.pos[0] + radius + padding);
    const minY = this.cell(ship.pos[1] - radius - padding);
    const maxY = this.cell(ship.pos[1] + radius + padding);
    this.candidates.fill(0, 0, this.wordCount);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        for (let index = this.heads[y * this.width + x]; index !== -1; index = this.next[index]) {
          this.candidates[index >>> 5] |= 1 << (index & 31);
        }
      }
    }
  }

  /** Ascending source indices preserve the full scan's exact floating-point addition order. */
  nextIndex(start: number): number {
    let word = start >>> 5;
    let bits = this.candidates[word] & (-1 << (start & 31));
    while (word < this.wordCount) {
      if (bits !== 0) return word * 32 + 31 - Math.clz32(bits & -bits);
      bits = this.candidates[++word];
    }
    return this.ships?.length ?? 0;
  }

  private cell(position: number): number {
    // Clamping both insertion and query is monotonic, hence conservative even for
    // hulls far outside the arena: overflow shares the corresponding edge bucket.
    return Math.max(0, Math.min(this.width - 1, Math.floor((position + this.origin) / CELL_SIZE)));
  }
}
