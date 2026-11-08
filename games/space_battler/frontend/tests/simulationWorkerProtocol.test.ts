import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";
import {
  acknowledgeSimulationSnapshotEvents,
  appendSimulationSnapshotEvent,
  createSimulationSnapshotBuffer,
  EVENT_BYTE_OFFSET,
  EVENT_STRIDE,
  EventFlags,
  EventType,
  EventWord,
  HEADER_WORDS,
  MAX_WORKER_EVENTS,
  MAX_WORKER_MOUNTS,
  MAX_WORKER_PROJECTILES,
  MAX_WORKER_SHIPS,
  MOUNT_BYTE_OFFSET,
  MOUNT_STRIDE,
  MountWord,
  PROJECTILE_BYTE_OFFSET,
  PROJECTILE_STRIDE,
  ProjectileFlags,
  ProjectileWord,
  packSimulationSnapshot,
  prepareSimulationSnapshotBuffer,
  RenderInterpolationState,
  SHIP_BYTE_OFFSET,
  SHIP_STRIDE,
  ShipFlags,
  ShipWord,
  SIMULATION_SNAPSHOT_BYTE_LENGTH,
  SIMULATION_SNAPSHOT_VERSION,
  SnapshotHeader,
  unpackSimulationSnapshot,
  WORKER_HULL_CLASSES,
  WORKER_WEAPON_TYPES,
} from "../src/engine/simulationWorkerProtocol";
import type { ProjectileState } from "../src/types/combat";

function mixedSimulation(): ClientCombatSimulation {
  const sim = new ClientCombatSimulation();
  for (const team of [0, 1]) {
    const ships = buildFleetFromSlots(
      WORKER_HULL_CLASSES.map((hullClass, index) => ({
        id: `${team}_${index}`,
        hullClass,
        groupId: index + 1,
      })),
      team,
      team === 0 ? -700 : 700,
      team === 0 ? 0 : Math.PI,
    );
    for (const ship of ships) sim.addShip(ship);
  }
  for (let i = 0; i < sim.ships.length; i++) {
    const ship = sim.ships[i];
    ship.pos = [-1200 + i * 143.7, 0.1 - i * 28.3];
    ship.velocity = [Math.sin(i) * 13.2, Math.cos(i) * -9.7];
    ship.heading = Math.PI / (i + 1);
    ship.hullCurrent -= i * 0.3;
    ship.shieldCurrent -= i * 0.7;
    ship.armorCurrent -= i * 0.9;
    for (let j = 0; j < ship.turrets.length; j++) {
      ship.turrets[j].currentLocalAngle = 0.1 + (j * Math.PI) / 9;
      ship.turrets[j].cooldownTimer = 0.2 + j * 0.07;
      if (j % 2 === 0) ship.turrets[j].lastFiredTime = 3.1 + j;
    }
  }
  sim.ships[1].isDocked = true;
  sim.ships[2].isAlive = false;
  sim.spawnCapitalWrecks(sim.ships[0]);
  sim.timeElapsed = 123.1234567890123;
  sim.projectiles = WORKER_WEAPON_TYPES.map((weaponType, index): ProjectileState => {
    const owner = sim.ships[index];
    const weapon = owner.turrets[0].weapon;
    return {
      id: `shot_${index}`,
      weaponType,
      weapon,
      damage: weapon.damage,
      ownerId: owner.id,
      ownerTeam: owner.team,
      pos: [7.1 + index * 53.9, -index * 17.3],
      velocity: [987.1 - index * 73.4, index * 51.6],
      lifetime: 0.37 + index * 1.1,
      targetId: null,
      hp: 10,
      maxHp: 10,
      isFlakBurst: index % 2 === 0,
    };
  });
  return sim;
}

afterEach(() => vi.unstubAllGlobals());

describe("transferable simulation snapshot protocol", () => {
  it("lays out aligned, contiguous overlapping views on a single backing buffer", () => {
    const buffer = createSimulationSnapshotBuffer();
    const views = prepareSimulationSnapshotBuffer(buffer);
    expect(MAX_WORKER_SHIPS).toBe(2048);
    expect(MAX_WORKER_PROJECTILES).toBe(4096);
    expect(MAX_WORKER_MOUNTS).toBe(16384);
    expect(MAX_WORKER_EVENTS).toBe(1024);
    expect(SIMULATION_SNAPSHOT_BYTE_LENGTH).toBe(589888);
    expect(SHIP_BYTE_OFFSET).toBe(HEADER_WORDS * 4);
    expect(MOUNT_BYTE_OFFSET).toBe(SHIP_BYTE_OFFSET + MAX_WORKER_SHIPS * SHIP_STRIDE * 4);
    expect(PROJECTILE_BYTE_OFFSET).toBe(MOUNT_BYTE_OFFSET + MAX_WORKER_MOUNTS * MOUNT_STRIDE * 4);
    expect(EVENT_BYTE_OFFSET).toBe(
      PROJECTILE_BYTE_OFFSET + MAX_WORKER_PROJECTILES * PROJECTILE_STRIDE * 4,
    );
    expect(buffer.byteLength).toBe(EVENT_BYTE_OFFSET + MAX_WORKER_EVENTS * EVENT_STRIDE * 4);
    expect(buffer.byteLength).toBe(SIMULATION_SNAPSHOT_BYTE_LENGTH);
    for (const view of [
      views.header,
      views.time,
      views.shipsFloat,
      views.shipsInt,
      views.mountsFloat,
      views.mountsInt,
      views.projectilesFloat,
      views.projectilesInt,
      views.eventsFloat,
      views.eventsInt,
      views.eventsTime,
    ]) {
      expect(view.buffer).toBe(buffer);
      expect(view.byteOffset % view.BYTES_PER_ELEMENT).toBe(0);
    }
    expect(views.shipsFloat.byteOffset).toBe(views.shipsInt.byteOffset);
    expect(views.eventsFloat.byteOffset).toBe(views.eventsTime.byteOffset);
    expect(prepareSimulationSnapshotBuffer(buffer)).toBe(views);
  });

  it("round-trips every ship class, all turret spans and projectile types with exact Float32 fidelity", () => {
    const sim = mixedSimulation();
    const before = structuredClone({ ships: sim.ships, projectiles: sim.projectiles });
    const buffer = createSimulationSnapshotBuffer();
    const views = prepareSimulationSnapshotBuffer(buffer);
    views.header[SnapshotHeader.epoch] = 7;
    views.header[SnapshotHeader.snapshotSequence] = 92;
    views.header[SnapshotHeader.tick] = 7387;
    views.header[SnapshotHeader.metadataRevision] = 3;
    views.header[SnapshotHeader.lastCommandSequence] = 19;
    expect(packSimulationSnapshot(sim, buffer).byteLength).toBe(buffer.byteLength);
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(buffer, state);
    expect(state.views).toBe(views);
    expect(state.shipCount).toBe(sim.ships.length);
    expect(state.projectileCount).toBe(sim.projectiles.length);
    expect(state.timeElapsed).toBe(sim.timeElapsed); // Float64, no quantization.
    expect(views.header[SnapshotHeader.version]).toBe(SIMULATION_SNAPSHOT_VERSION);
    expect(views.header[SnapshotHeader.epoch]).toBe(7);
    expect(views.header[SnapshotHeader.snapshotSequence]).toBe(92);
    expect(views.header[SnapshotHeader.tick]).toBe(7387);
    expect(views.header[SnapshotHeader.metadataRevision]).toBe(3);
    expect(views.header[SnapshotHeader.lastCommandSequence]).toBe(19);
    let mountIndex = 0;
    for (let i = 0; i < sim.ships.length; i++) {
      const ship = sim.ships[i];
      const row = i * SHIP_STRIDE;
      const floatFields = [
        [ShipWord.posX, ship.pos[0]],
        [ShipWord.posY, ship.pos[1]],
        [ShipWord.velX, ship.velocity[0]],
        [ShipWord.velY, ship.velocity[1]],
        [ShipWord.heading, ship.heading],
        [ShipWord.hullCurrent, ship.hullCurrent],
        [ShipWord.hullMax, ship.hullMax],
        [ShipWord.shieldCurrent, ship.shieldCurrent],
        [ShipWord.shieldMax, ship.shieldMax],
        [ShipWord.armorCurrent, ship.armorCurrent],
        [ShipWord.armorMax, ship.armorMax],
      ];
      for (const [offset, value] of floatFields)
        expect(views.shipsFloat[row + offset]).toBe(Math.fround(value));
      expect(views.shipsInt[row + ShipWord.team]).toBe(ship.team);
      expect(WORKER_HULL_CLASSES[views.shipsInt[row + ShipWord.hullClassIndex]]).toBe(
        ship.hullClass,
      );
      expect(views.shipsInt[row + ShipWord.flags]).toBe(
        (ship.isAlive ? ShipFlags.alive : 0) |
          (ship.isDocked ? ShipFlags.docked : 0) |
          (ship.isDebris ? ShipFlags.debris : 0),
      );
      expect(views.shipsInt[row + ShipWord.mountStart]).toBe(mountIndex);
      expect(views.shipsInt[row + ShipWord.mountCount]).toBe(ship.turrets.length);
      for (const mount of ship.turrets) {
        const offset = mountIndex++ * MOUNT_STRIDE;
        expect(views.mountsFloat[offset + MountWord.angle]).toBe(
          Math.fround(mount.currentLocalAngle),
        );
        expect(views.mountsFloat[offset + MountWord.cooldown]).toBe(
          Math.fround(mount.cooldownTimer),
        );
        expect(views.mountsFloat[offset + MountWord.lastFiredTime]).toBe(
          mount.lastFiredTime === undefined ? Number.NaN : Math.fround(mount.lastFiredTime),
        );
        expect(WORKER_WEAPON_TYPES[views.mountsInt[offset + MountWord.weaponType]]).toBe(
          mount.weapon.weaponType,
        );
      }
    }
    expect(state.mountCount).toBe(mountIndex);
    for (let i = 0; i < sim.projectiles.length; i++) {
      const shot = sim.projectiles[i];
      const row = i * PROJECTILE_STRIDE;
      expect(views.projectilesFloat[row + ProjectileWord.posX]).toBe(Math.fround(shot.pos[0]));
      expect(views.projectilesFloat[row + ProjectileWord.posY]).toBe(Math.fround(shot.pos[1]));
      expect(views.projectilesFloat[row + ProjectileWord.velX]).toBe(Math.fround(shot.velocity[0]));
      expect(views.projectilesFloat[row + ProjectileWord.velY]).toBe(Math.fround(shot.velocity[1]));
      expect(views.projectilesFloat[row + ProjectileWord.lifetime]).toBe(
        Math.fround(shot.lifetime),
      );
      expect(views.projectilesInt[row + ProjectileWord.team]).toBe(shot.ownerTeam);
      expect(WORKER_WEAPON_TYPES[views.projectilesInt[row + ProjectileWord.type]]).toBe(
        shot.weaponType,
      );
      expect(views.projectilesInt[row + ProjectileWord.flags]).toBe(
        shot.isFlakBurst ? ProjectileFlags.flakBurst : 0,
      );
    }
    expect({ ships: sim.ships, projectiles: sim.projectiles }).toEqual(before);
  });

  it("preserves signed zero and representable values, quantizing only the render copy", () => {
    const sim = mixedSimulation();
    sim.ships[0].pos = [-0, 1024.125];
    sim.ships[0].velocity = [0.1, -0.1];
    const buffer = createSimulationSnapshotBuffer();
    packSimulationSnapshot(sim, buffer);
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(buffer, state);
    const views = prepareSimulationSnapshotBuffer(buffer);
    expect(Object.is(views.shipsFloat[ShipWord.posX], -0)).toBe(true);
    expect(views.shipsFloat[ShipWord.posY]).toBe(1024.125);
    expect(views.shipsFloat[ShipWord.velX]).toBe(Math.fround(0.1));
    expect(views.shipsFloat[ShipWord.velX]).not.toBe(0.1);
    expect(sim.ships[0].velocity[0]).toBe(0.1);
    views.shipsFloat[ShipWord.posY] = 64;
    expect(state.views?.shipsFloat[ShipWord.posY]).toBe(64); // Decode is zero-copy.
    expect(sim.ships[0].pos[1]).toBe(1024.125);
  });

  it("supports maximum capacities and ignores stale rows after the snapshot shrinks", () => {
    const sim = mixedSimulation();
    const ship = sim.ships[0];
    sim.ships = Array(MAX_WORKER_SHIPS).fill(ship);
    sim.projectiles = Array(MAX_WORKER_PROJECTILES).fill(sim.projectiles[0]);
    const buffer = createSimulationSnapshotBuffer();
    const state = new RenderInterpolationState();
    packSimulationSnapshot(sim, buffer);
    unpackSimulationSnapshot(buffer, state);
    expect(state.shipCount).toBe(MAX_WORKER_SHIPS);
    expect(state.projectileCount).toBe(MAX_WORKER_PROJECTILES);
    const views = prepareSimulationSnapshotBuffer(buffer);
    expect(views.shipsFloat[(MAX_WORKER_SHIPS - 1) * SHIP_STRIDE + ShipWord.posX]).toBe(
      Math.fround(ship.pos[0]),
    );
    sim.ships.length = 1;
    sim.projectiles.length = 0;
    packSimulationSnapshot(sim, buffer);
    unpackSimulationSnapshot(buffer, state);
    expect(state.shipCount).toBe(1);
    expect(state.projectileCount).toBe(0);
    expect(state.mountCount).toBe(ship.turrets.length);
    sim.ships.length = 0;
    packSimulationSnapshot(sim, buffer);
    unpackSimulationSnapshot(buffer, state);
    expect(state.shipCount).toBe(0);
    expect(state.mountCount).toBe(0);
    ship.turrets = Array(MAX_WORKER_MOUNTS).fill(ship.turrets[0]);
    sim.ships = [ship];
    packSimulationSnapshot(sim, buffer);
    unpackSimulationSnapshot(buffer, state);
    expect(state.mountCount).toBe(MAX_WORKER_MOUNTS);
    expect(views.mountsFloat[(MAX_WORKER_MOUNTS - 1) * MOUNT_STRIDE + MountWord.angle]).toBe(
      Math.fround(ship.turrets[0].currentLocalAngle),
    );
  });

  it.each(["ships", "projectiles", "mounts"] as const)(
    "rejects overflowing %s without corrupting the last complete snapshot",
    (kind) => {
      const sim = mixedSimulation();
      const buffer = createSimulationSnapshotBuffer();
      packSimulationSnapshot(sim, buffer);
      const before = new Uint8Array(buffer.slice(0));
      if (kind === "ships") sim.ships = Array(MAX_WORKER_SHIPS + 1).fill(sim.ships[0]);
      if (kind === "projectiles")
        sim.projectiles = Array(MAX_WORKER_PROJECTILES + 1).fill(sim.projectiles[0]);
      if (kind === "mounts")
        sim.ships[0].turrets = Array(MAX_WORKER_MOUNTS + 1).fill(sim.ships[0].turrets[0]);
      expect(() => packSimulationSnapshot(sim, buffer)).toThrow(RangeError);
      expect(new Uint8Array(buffer)).toEqual(before);
    },
  );

  it("rebinds views on actual transfer and rejects detached sender buffers", () => {
    const sim = mixedSimulation();
    const buffer = createSimulationSnapshotBuffer();
    packSimulationSnapshot(sim, buffer);
    appendSimulationSnapshotEvent(buffer, EventType.shipExplosion, sim.timeElapsed, 0, 0, 32, 64);
    const senderViews = prepareSimulationSnapshotBuffer(buffer);
    const received = structuredClone(buffer, { transfer: [buffer] });
    expect(buffer.byteLength).toBe(0);
    expect(senderViews.shipsFloat.length).toBe(0);
    expect(() => packSimulationSnapshot(sim, buffer)).toThrow(RangeError);
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(received, state);
    expect(state.timeElapsed).toBe(sim.timeElapsed);
    expect(state.views?.buffer).toBe(received);
    expect(state.views).not.toBe(senderViews);
    expect(state.eventCount).toBe(1);
    expect(state.views?.eventsInt[EventWord.type]).toBe(EventType.shipExplosion);
    const recycled = structuredClone(received, { transfer: [received] });
    expect(() => unpackSimulationSnapshot(received, state)).toThrow(RangeError);
    packSimulationSnapshot(sim, recycled);
    unpackSimulationSnapshot(recycled, state);
    expect(state.shipCount).toBe(sim.ships.length);
  });

  it("rejects malformed buffers, counts and mount spans before changing the destination", () => {
    const buffer = createSimulationSnapshotBuffer();
    const sim = mixedSimulation();
    packSimulationSnapshot(sim, buffer);
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(buffer, state);
    const goodViews = state.views;
    expect(() => unpackSimulationSnapshot(new ArrayBuffer(16), state)).toThrow(RangeError);
    const bad = buffer.slice(0);
    const badViews = prepareSimulationSnapshotBuffer(bad);
    for (const [field, value] of [
      [SnapshotHeader.version, 100],
      [SnapshotHeader.byteLength, 0],
      [SnapshotHeader.shipCount, -1],
      [SnapshotHeader.shipCount, MAX_WORKER_SHIPS + 1],
      [SnapshotHeader.projectileCount, MAX_WORKER_PROJECTILES + 1],
      [SnapshotHeader.mountCount, MAX_WORKER_MOUNTS + 1],
      [SnapshotHeader.eventCount, MAX_WORKER_EVENTS + 1],
      [SnapshotHeader.eventHead, MAX_WORKER_EVENTS],
    ]) {
      const original = badViews.header[field];
      badViews.header[field] = value;
      expect(() => unpackSimulationSnapshot(bad, state)).toThrow(RangeError);
      expect(state.views).toBe(goodViews);
      badViews.header[field] = original;
    }
    badViews.shipsInt[ShipWord.mountStart] = state.mountCount;
    expect(() => unpackSimulationSnapshot(bad, state)).toThrow(RangeError);
    expect(state.views).toBe(goodViews);
  });

  it("reuses buffers, all views and the result object across 400-ship hot-path publications", () => {
    const sim = mixedSimulation();
    sim.ships = Array(400).fill(sim.ships[0]);
    sim.projectiles = Array(300).fill(sim.projectiles[0]);
    const buffer = createSimulationSnapshotBuffer();
    const state = new RenderInterpolationState();
    const result = packSimulationSnapshot(sim, buffer);
    unpackSimulationSnapshot(buffer, state);
    const views = state.views;
    const allocations = vi.fn(() => {
      throw new Error("Unexpected hot-path allocation");
    });
    for (const name of ["ArrayBuffer", "Float32Array", "Float64Array", "Int32Array"])
      vi.stubGlobal(name, allocations);
    let reused = true;
    for (let i = 0; i < 1000; i++) {
      reused = reused && packSimulationSnapshot(sim, buffer) === result;
      appendSimulationSnapshotEvent(buffer, EventType.hit, i / 60, 0, 0, i, -i);
      acknowledgeSimulationSnapshotEvents(buffer, i + 1);
      unpackSimulationSnapshot(buffer, state);
      reused = reused && state.views === views;
    }
    vi.unstubAllGlobals();
    expect(allocations).not.toHaveBeenCalled();
    expect(reused).toBe(true);
    expect(prepareSimulationSnapshotBuffer(buffer)).toBe(views);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("leaves authoritative combat parity and synchronous callbacks unchanged", () => {
    function battle(): ClientCombatSimulation {
      const sim = new ClientCombatSimulation();
      for (const team of [0, 1])
        for (const ship of buildFleetFromSlots(
          [{ id: "cruiser", hullClass: "cruiser", groupId: 1 }],
          team,
          team === 0 ? -400 : 400,
          team === 0 ? 0 : Math.PI,
        ))
          sim.addShip(ship);
      return sim;
    }
    const reference = battle();
    const observed = battle();
    const buffer = createSimulationSnapshotBuffer();
    const state = new RenderInterpolationState();
    let referenceBeams = 0;
    let observedBeams = 0;
    reference.onBeamFire = () => {
      referenceBeams++;
    };
    observed.onBeamFire = () => {
      observedBeams++;
    };
    const callback = observed.onBeamFire;
    for (let i = 0; i < 12; i++) {
      reference.update(1 / 60);
      observed.update(1 / 60);
      packSimulationSnapshot(observed, buffer);
      unpackSimulationSnapshot(buffer, state);
    }
    expect(observed.ships).toEqual(reference.ships);
    expect(observed.projectiles).toEqual(reference.projectiles);
    expect(observed.activeBeams).toEqual(reference.activeBeams);
    expect(observed.stats).toEqual(reference.stats);
    expect(observed.timeElapsed).toBe(reference.timeElapsed);
    expect(observed.winner).toBe(reference.winner);
    expect(observed.audioEvents).toEqual(reference.audioEvents);
    expect(observed.combatLog.map(({ id: _id, ...entry }) => entry)).toEqual(
      reference.combatLog.map(({ id: _id, ...entry }) => entry),
    );
    expect(observed.onBeamFire).toBe(callback);
    expect(referenceBeams).toBeGreaterThan(0);
    expect(reference.projectiles.length).toBeGreaterThan(0);
    expect(observedBeams).toBe(referenceBeams);
  });
});

describe("snapshot combat event ring", () => {
  it("round-trips event-time impact, shield, explosion and beam scalars independently of packing", () => {
    const sim = mixedSimulation();
    const buffer = createSimulationSnapshotBuffer();
    const time = 12.1234567890123;
    for (const type of [
      EventType.hit,
      EventType.shieldImpact,
      EventType.shipExplosion,
      EventType.beamStrike,
    ])
      expect(
        appendSimulationSnapshotEvent(
          buffer,
          type,
          time,
          2,
          -1,
          19.1,
          -9.7,
          27.3,
          15.9,
          0.3,
          EventFlags.shield | EventFlags.hull,
          Math.PI,
          68,
          1.3,
          -7.1,
        ),
      ).toBe(true);
    sim.ships[2].pos[0] = 999;
    packSimulationSnapshot(sim, buffer);
    packSimulationSnapshot(sim, buffer); // No event consumption or replay production.
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(buffer, state);
    expect(state.eventCount).toBe(4);
    const views = prepareSimulationSnapshotBuffer(buffer);
    for (let i = 0; i < 4; i++) {
      const row = i * EVENT_STRIDE;
      expect(views.eventsInt[row + EventWord.type]).toBe(i + 1);
      expect(views.eventsInt[row + EventWord.sequence]).toBe(i + 1);
      expect(views.eventsInt[row + EventWord.shipIndex]).toBe(2);
      expect(views.eventsInt[row + EventWord.team]).toBe(-1);
      expect(views.eventsInt[row + EventWord.flags]).toBe(EventFlags.shield | EventFlags.hull);
      for (const [word, value] of [
        [EventWord.posX, 19.1],
        [EventWord.posY, -9.7],
        [EventWord.otherX, 27.3],
        [EventWord.otherY, 15.9],
        [EventWord.magnitude, 0.3],
        [EventWord.heading, Math.PI],
        [EventWord.size, 68],
        [EventWord.velX, 1.3],
        [EventWord.velY, -7.1],
      ])
        expect(views.eventsFloat[row + word]).toBe(Math.fround(value));
      expect(views.eventsTime[(i * EVENT_STRIDE) / 2 + 7]).toBe(time);
    }
  });

  it("wraps in order and applies acknowledgements without overwriting undelivered events", () => {
    const buffer = createSimulationSnapshotBuffer();
    for (let i = 0; i < MAX_WORKER_EVENTS; i++)
      expect(appendSimulationSnapshotEvent(buffer, EventType.hit, i / 60, 0, 0, i, 0)).toBe(true);
    const before = buffer.slice(0);
    expect(appendSimulationSnapshotEvent(buffer, EventType.shipExplosion, 5, 0, 0, 1000, 0)).toBe(
      false,
    );
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(before));
    acknowledgeSimulationSnapshotEvents(buffer, 192);
    acknowledgeSimulationSnapshotEvents(buffer, 192); // Duplicate ack is harmless.
    for (let i = MAX_WORKER_EVENTS; i < MAX_WORKER_EVENTS + 192; i++)
      expect(appendSimulationSnapshotEvent(buffer, EventType.hit, i / 60, 0, 0, i, 0)).toBe(true);
    const state = new RenderInterpolationState();
    unpackSimulationSnapshot(buffer, state);
    expect(state.eventHead).toBe(192);
    expect(state.eventCount).toBe(MAX_WORKER_EVENTS);
    const views = prepareSimulationSnapshotBuffer(buffer);
    for (let i = 0; i < state.eventCount; i++) {
      const index = (state.eventHead + i) % MAX_WORKER_EVENTS;
      expect(views.eventsInt[index * EVENT_STRIDE + EventWord.sequence]).toBe(193 + i);
      expect(views.eventsFloat[index * EVENT_STRIDE + EventWord.posX]).toBe(192 + i);
    }
    acknowledgeSimulationSnapshotEvents(buffer, MAX_WORKER_EVENTS + 192);
    unpackSimulationSnapshot(buffer, state);
    expect(state.eventCount).toBe(0);
    appendSimulationSnapshotEvent(buffer, EventType.shieldImpact, 8, -1, 1, 0, 0);
    expect(views.eventsInt[state.eventHead * EVENT_STRIDE + EventWord.sequence]).toBe(
      MAX_WORKER_EVENTS + 193,
    );
  });
});
