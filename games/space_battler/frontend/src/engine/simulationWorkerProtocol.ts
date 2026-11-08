import type { HullClass, WeaponType } from "../types/combat";
import type { ClientCombatSimulation } from "./simulation";
import type { SimulationPresentationMetadata } from "./simulationPresentationMetadata";

// Presentation-only, native-endian protocol for same-browser transfer. Never feed
// Float32 render values back into the double-precision authoritative simulation.
export const SIMULATION_SNAPSHOT_VERSION = 1;
export const MAX_WORKER_SHIPS = 2048;
export const MAX_WORKER_PROJECTILES = 4096;
export const MAX_WORKER_EVENTS = 1024;
export const MAX_WORKER_MOUNTS = MAX_WORKER_SHIPS * 8;

// Strides/field offsets are in 32-bit words. Float and integer views OVERLAP;
// integer fields must only be read/written through the integer view.
export const SHIP_STRIDE = 16;
export const PROJECTILE_STRIDE = 8;
export const MOUNT_STRIDE = 4;
export const EVENT_STRIDE = 16;
export const HEADER_WORDS = 16;

export const SnapshotHeader = {
  version: 0,
  byteLength: 1,
  shipCount: 2,
  projectileCount: 3,
  mountCount: 4,
  eventCount: 5,
  eventHead: 6,
  nextEventSequence: 7,
  // The future host owns these stamps; packing preserves them.
  epoch: 8,
  snapshotSequence: 9,
  tick: 10,
  metadataRevision: 11,
  lastCommandSequence: 12,
  // Words 14..15 contain Float64 simulation time.
} as const;

export const ShipWord = {
  posX: 0,
  posY: 1,
  velX: 2,
  velY: 3,
  heading: 4,
  hullCurrent: 5,
  hullMax: 6,
  shieldCurrent: 7,
  shieldMax: 8,
  armorCurrent: 9,
  armorMax: 10,
  team: 11,
  hullClassIndex: 12,
  flags: 13,
  mountStart: 14,
  mountCount: 15,
} as const;

export const ShipFlags = { alive: 1, docked: 2, debris: 4 } as const;
export const ProjectileWord = {
  posX: 0,
  posY: 1,
  velX: 2,
  velY: 3,
  type: 4,
  team: 5,
  lifetime: 6,
  flags: 7,
} as const;
export const ProjectileFlags = { flakBurst: 1 } as const;
export const MountWord = { angle: 0, cooldown: 1, lastFiredTime: 2, weaponType: 3 } as const;

export const EventType = { hit: 1, shieldImpact: 2, shipExplosion: 3, beamStrike: 4 } as const;
export type SimulationEventType = (typeof EventType)[keyof typeof EventType];
export const EventFlags = { shield: 1, armor: 2, hull: 4, channeled: 8 } as const;
export const EventWord = {
  type: 0,
  sequence: 1,
  shipIndex: 2,
  team: 3,
  posX: 4,
  posY: 5,
  otherX: 6,
  otherY: 7,
  magnitude: 8,
  flags: 9,
  heading: 10,
  size: 11,
  velX: 12,
  velY: 13,
  // Words 14..15 contain Float64 event time (eventsTime[row * 8 + 7]).
} as const;

export const WORKER_HULL_CLASSES = [
  "carrier",
  "battleship",
  "dreadnought",
  "cruiser",
  "missile_frigate",
  "tender",
  "corvette",
  "strike_craft",
] as const;
const HULL_INDEX: Record<HullClass, number> = {
  carrier: 0,
  battleship: 1,
  dreadnought: 2,
  cruiser: 3,
  missile_frigate: 4,
  tender: 5,
  corvette: 6,
  strike_craft: 7,
};
export const WORKER_WEAPON_TYPES = [
  "beam_laser",
  "railgun",
  "plasma",
  "missile",
  "point_defense",
] as const;
const WEAPON_INDEX: Record<WeaponType, number> = {
  beam_laser: 0,
  railgun: 1,
  plasma: 2,
  missile: 3,
  point_defense: 4,
};

export const SHIP_BYTE_OFFSET = HEADER_WORDS * 4;
export const MOUNT_BYTE_OFFSET = SHIP_BYTE_OFFSET + MAX_WORKER_SHIPS * SHIP_STRIDE * 4;
export const PROJECTILE_BYTE_OFFSET = MOUNT_BYTE_OFFSET + MAX_WORKER_MOUNTS * MOUNT_STRIDE * 4;
export const EVENT_BYTE_OFFSET =
  PROJECTILE_BYTE_OFFSET + MAX_WORKER_PROJECTILES * PROJECTILE_STRIDE * 4;
export const SIMULATION_SNAPSHOT_BYTE_LENGTH =
  EVENT_BYTE_OFFSET + MAX_WORKER_EVENTS * EVENT_STRIDE * 4;

export interface SimulationSnapshotViews {
  readonly buffer: ArrayBuffer;
  readonly header: Int32Array;
  readonly time: Float64Array;
  readonly shipsFloat: Float32Array;
  readonly shipsInt: Int32Array;
  readonly mountsFloat: Float32Array;
  readonly mountsInt: Int32Array;
  readonly projectilesFloat: Float32Array;
  readonly projectilesInt: Int32Array;
  readonly eventsFloat: Float32Array;
  readonly eventsInt: Int32Array;
  readonly eventsTime: Float64Array;
  readonly packResult: Readonly<{ byteLength: number }>;
}

const bufferViews = new WeakMap<ArrayBuffer, SimulationSnapshotViews>();

/** Allocation boundary: prepare once per owned buffer, including after transfer.
 * Transfer detaches sender views; the receiver must construct its own views.
 * The codec does not allocate views, objects or temporary arrays on warmed buffers.
 */
export function prepareSimulationSnapshotBuffer(buffer: ArrayBuffer): SimulationSnapshotViews {
  if (buffer.byteLength !== SIMULATION_SNAPSHOT_BYTE_LENGTH)
    throw new RangeError("Incorrect or detached simulation snapshot buffer");
  const cached = bufferViews.get(buffer);
  if (cached) return cached;
  const views: SimulationSnapshotViews = {
    buffer,
    header: new Int32Array(buffer, 0, HEADER_WORDS),
    time: new Float64Array(buffer, (HEADER_WORDS - 2) * 4, 1),
    shipsFloat: new Float32Array(buffer, SHIP_BYTE_OFFSET, MAX_WORKER_SHIPS * SHIP_STRIDE),
    shipsInt: new Int32Array(buffer, SHIP_BYTE_OFFSET, MAX_WORKER_SHIPS * SHIP_STRIDE),
    mountsFloat: new Float32Array(buffer, MOUNT_BYTE_OFFSET, MAX_WORKER_MOUNTS * MOUNT_STRIDE),
    mountsInt: new Int32Array(buffer, MOUNT_BYTE_OFFSET, MAX_WORKER_MOUNTS * MOUNT_STRIDE),
    projectilesFloat: new Float32Array(
      buffer,
      PROJECTILE_BYTE_OFFSET,
      MAX_WORKER_PROJECTILES * PROJECTILE_STRIDE,
    ),
    projectilesInt: new Int32Array(
      buffer,
      PROJECTILE_BYTE_OFFSET,
      MAX_WORKER_PROJECTILES * PROJECTILE_STRIDE,
    ),
    eventsFloat: new Float32Array(buffer, EVENT_BYTE_OFFSET, MAX_WORKER_EVENTS * EVENT_STRIDE),
    eventsInt: new Int32Array(buffer, EVENT_BYTE_OFFSET, MAX_WORKER_EVENTS * EVENT_STRIDE),
    eventsTime: new Float64Array(buffer, EVENT_BYTE_OFFSET, (MAX_WORKER_EVENTS * EVENT_STRIDE) / 2),
    packResult: Object.freeze({ byteLength: SIMULATION_SNAPSHOT_BYTE_LENGTH }),
  };
  bufferViews.set(buffer, views);
  return views;
}

export function createSimulationSnapshotBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(SIMULATION_SNAPSHOT_BYTE_LENGTH);
  const { header } = prepareSimulationSnapshotBuffer(buffer);
  header[SnapshotHeader.version] = SIMULATION_SNAPSHOT_VERSION;
  header[SnapshotHeader.byteLength] = SIMULATION_SNAPSHOT_BYTE_LENGTH;
  header[SnapshotHeader.nextEventSequence] = 1;
  return buffer;
}

/** Rows follow current simulation array order; IDs/loadouts and stable entity
 * handles/generations belong to host metadata, not this compact Phase 1 payload.
 * Counts delimit valid rows: unused capacity is intentionally not cleared.
 * Capacity failure leaves the last complete snapshot untouched, never truncates.
 */
export function packSimulationSnapshot(
  sim: ClientCombatSimulation,
  targetBuffer: ArrayBuffer,
): { byteLength: number } {
  const views = prepareSimulationSnapshotBuffer(targetBuffer);
  if (sim.ships.length > MAX_WORKER_SHIPS || sim.projectiles.length > MAX_WORKER_PROJECTILES)
    throw new RangeError("Simulation snapshot entity capacity exceeded");
  let mountCount = 0;
  for (let i = 0; i < sim.ships.length; i++) mountCount += sim.ships[i].turrets.length;
  if (mountCount > MAX_WORKER_MOUNTS)
    throw new RangeError("Simulation snapshot mount capacity exceeded");

  const sf = views.shipsFloat;
  const si = views.shipsInt;
  let mountIndex = 0;
  for (let i = 0; i < sim.ships.length; i++) {
    const ship = sim.ships[i];
    const row = i * SHIP_STRIDE;
    sf[row + ShipWord.posX] = ship.pos[0];
    sf[row + ShipWord.posY] = ship.pos[1];
    sf[row + ShipWord.velX] = ship.velocity[0];
    sf[row + ShipWord.velY] = ship.velocity[1];
    sf[row + ShipWord.heading] = ship.heading;
    sf[row + ShipWord.hullCurrent] = ship.hullCurrent;
    sf[row + ShipWord.hullMax] = ship.hullMax;
    sf[row + ShipWord.shieldCurrent] = ship.shieldCurrent;
    sf[row + ShipWord.shieldMax] = ship.shieldMax;
    sf[row + ShipWord.armorCurrent] = ship.armorCurrent;
    sf[row + ShipWord.armorMax] = ship.armorMax;
    si[row + ShipWord.team] = ship.team; // Preserve neutral (-1) wrecks, too.
    si[row + ShipWord.hullClassIndex] = HULL_INDEX[ship.hullClass];
    si[row + ShipWord.flags] =
      (ship.isAlive ? ShipFlags.alive : 0) |
      (ship.isDocked ? ShipFlags.docked : 0) |
      (ship.isDebris ? ShipFlags.debris : 0);
    si[row + ShipWord.mountStart] = mountIndex;
    si[row + ShipWord.mountCount] = ship.turrets.length;
    for (let j = 0; j < ship.turrets.length; j++, mountIndex++) {
      const mount = ship.turrets[j];
      const offset = mountIndex * MOUNT_STRIDE;
      views.mountsFloat[offset + MountWord.angle] = mount.currentLocalAngle;
      views.mountsFloat[offset + MountWord.cooldown] = mount.cooldownTimer;
      views.mountsFloat[offset + MountWord.lastFiredTime] = mount.lastFiredTime ?? Number.NaN;
      views.mountsInt[offset + MountWord.weaponType] = WEAPON_INDEX[mount.weapon.weaponType];
    }
  }
  for (let i = 0; i < sim.projectiles.length; i++) {
    const projectile = sim.projectiles[i];
    const row = i * PROJECTILE_STRIDE;
    views.projectilesFloat[row + ProjectileWord.posX] = projectile.pos[0];
    views.projectilesFloat[row + ProjectileWord.posY] = projectile.pos[1];
    views.projectilesFloat[row + ProjectileWord.velX] = projectile.velocity[0];
    views.projectilesFloat[row + ProjectileWord.velY] = projectile.velocity[1];
    views.projectilesInt[row + ProjectileWord.type] = WEAPON_INDEX[projectile.weaponType];
    views.projectilesInt[row + ProjectileWord.team] = projectile.ownerTeam;
    views.projectilesFloat[row + ProjectileWord.lifetime] = projectile.lifetime;
    views.projectilesInt[row + ProjectileWord.flags] = projectile.isFlakBurst
      ? ProjectileFlags.flakBurst
      : 0;
  }
  views.header[SnapshotHeader.version] = SIMULATION_SNAPSHOT_VERSION;
  views.header[SnapshotHeader.byteLength] = SIMULATION_SNAPSHOT_BYTE_LENGTH;
  views.header[SnapshotHeader.shipCount] = sim.ships.length;
  views.header[SnapshotHeader.projectileCount] = sim.projectiles.length;
  views.header[SnapshotHeader.mountCount] = mountCount;
  views.time[0] = sim.timeElapsed;
  // Packing neither produces nor consumes events. The host supplies callback
  // scalars via appendSimulationSnapshotEvent and acknowledges delivered batches.
  return views.packResult;
}

/** One instance per pinned interpolation endpoint; no reconstructed ShipState
 * objects. Views remain valid only while their buffer is owned and not recycled.
 * Metadata joins/interpolation write into separately owned presentation objects.
 */
export class RenderInterpolationState {
  presentation: SimulationPresentationMetadata | null = null;
  receivedAtMs = 0;
  views: SimulationSnapshotViews | null = null;
  shipCount = 0;
  projectileCount = 0;
  mountCount = 0;
  eventCount = 0;
  eventHead = 0;
  timeElapsed = 0;
}

function validCount(value: number, capacity: number): boolean {
  return value >= 0 && value <= capacity;
}

export function unpackSimulationSnapshot(
  buffer: ArrayBuffer,
  destination: RenderInterpolationState,
): void {
  const views = prepareSimulationSnapshotBuffer(buffer);
  const h = views.header;
  if (
    h[SnapshotHeader.version] !== SIMULATION_SNAPSHOT_VERSION ||
    h[SnapshotHeader.byteLength] !== SIMULATION_SNAPSHOT_BYTE_LENGTH ||
    !validCount(h[SnapshotHeader.shipCount], MAX_WORKER_SHIPS) ||
    !validCount(h[SnapshotHeader.projectileCount], MAX_WORKER_PROJECTILES) ||
    !validCount(h[SnapshotHeader.mountCount], MAX_WORKER_MOUNTS) ||
    !validCount(h[SnapshotHeader.eventCount], MAX_WORKER_EVENTS) ||
    !validCount(h[SnapshotHeader.eventHead], MAX_WORKER_EVENTS - 1)
  )
    throw new RangeError("Invalid simulation snapshot header");
  for (let i = 0; i < h[SnapshotHeader.shipCount]; i++) {
    const row = i * SHIP_STRIDE;
    const start = views.shipsInt[row + ShipWord.mountStart];
    const count = views.shipsInt[row + ShipWord.mountCount];
    if (start < 0 || count < 0 || start + count > h[SnapshotHeader.mountCount])
      throw new RangeError("Invalid simulation snapshot mount span");
  }
  destination.views = views;
  destination.shipCount = h[SnapshotHeader.shipCount];
  destination.projectileCount = h[SnapshotHeader.projectileCount];
  destination.mountCount = h[SnapshotHeader.mountCount];
  destination.eventCount = h[SnapshotHeader.eventCount];
  destination.eventHead = h[SnapshotHeader.eventHead];
  destination.timeElapsed = views.time[0];
}

/** Copies event-time scalars into a ring row without constructing an event DTO.
 * shipIndex is metadata-revision scoped (-1 when no ship is identified).
 * Full rings return false WITHOUT overwriting unacknowledged events; the future
 * host must drain/backpressure before advancing again. Repacking never drains it.
 * magnitude means impact intensity or beam width; otherX/Y are origin/endpoints.
 */
export function appendSimulationSnapshotEvent(
  buffer: ArrayBuffer,
  type: SimulationEventType,
  time: number,
  shipIndex: number,
  team: number,
  posX: number,
  posY: number,
  otherX = 0,
  otherY = 0,
  magnitude = 0,
  flags = 0,
  heading = 0,
  size = 0,
  velX = 0,
  velY = 0,
): boolean {
  const views = prepareSimulationSnapshotBuffer(buffer);
  const h = views.header;
  const count = h[SnapshotHeader.eventCount];
  if (count === MAX_WORKER_EVENTS) return false;
  const sequence = h[SnapshotHeader.nextEventSequence] || 1;
  if (sequence === 0x7fffffff) throw new RangeError("Event sequence exhausted; start a new epoch");
  const index = (h[SnapshotHeader.eventHead] + count) % MAX_WORKER_EVENTS;
  const row = index * EVENT_STRIDE;
  const ei = views.eventsInt;
  const ef = views.eventsFloat;
  ei[row + EventWord.type] = type;
  ei[row + EventWord.sequence] = sequence;
  ei[row + EventWord.shipIndex] = shipIndex;
  ei[row + EventWord.team] = team;
  ef[row + EventWord.posX] = posX;
  ef[row + EventWord.posY] = posY;
  ef[row + EventWord.otherX] = otherX;
  ef[row + EventWord.otherY] = otherY;
  ef[row + EventWord.magnitude] = magnitude;
  ei[row + EventWord.flags] = flags;
  ef[row + EventWord.heading] = heading;
  ef[row + EventWord.size] = size;
  ef[row + EventWord.velX] = velX;
  ef[row + EventWord.velY] = velY;
  views.eventsTime[index * (EVENT_STRIDE / 2) + 7] = time;
  h[SnapshotHeader.nextEventSequence] = sequence + 1;
  h[SnapshotHeader.eventCount] = count + 1;
  return true;
}

/** Acknowledge only events actually delivered, independently of visual decoding. */
export function acknowledgeSimulationSnapshotEvents(
  buffer: ArrayBuffer,
  throughSequence: number,
): void {
  const views = prepareSimulationSnapshotBuffer(buffer);
  const h = views.header;
  let head = h[SnapshotHeader.eventHead];
  let count = h[SnapshotHeader.eventCount];
  while (
    count > 0 &&
    views.eventsInt[head * EVENT_STRIDE + EventWord.sequence] <= throughSequence
  ) {
    head = (head + 1) % MAX_WORKER_EVENTS;
    count--;
  }
  h[SnapshotHeader.eventHead] = head;
  h[SnapshotHeader.eventCount] = count;
}
