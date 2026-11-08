import { createHash } from "node:crypto";
import { Worker as NodeWorker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetBreakdown } from "../src/engine/fleetBreakdown";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";
import { SimulationWorkerClient } from "../src/engine/simulationWorkerClient";
import { SimulationWorkerHost } from "../src/engine/simulationWorkerHost";
import type {
  SimulationWorkerConfig,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../src/engine/simulationWorkerMessages";
import {
  createSimulationSnapshotBuffer,
  HEADER_WORDS,
  MOUNT_BYTE_OFFSET,
  MOUNT_STRIDE,
  PROJECTILE_BYTE_OFFSET,
  PROJECTILE_STRIDE,
  packSimulationSnapshot,
  prepareSimulationSnapshotBuffer,
  SHIP_BYTE_OFFSET,
  SHIP_STRIDE,
  SIMULATION_SNAPSHOT_BYTE_LENGTH,
  SnapshotHeader,
} from "../src/engine/simulationWorkerProtocol";

const config: SimulationWorkerConfig = {
  fleets: [0, 1].map((team) => ({
    slots: (["cruiser", "corvette", "missile_frigate"] as const).map((hullClass, index) => ({
      id: `${team}_${index}`,
      hullClass,
      groupId: index + 1,
    })),
    team,
    baseX: team === 0 ? -260 : 260,
    heading: team === 0 ? 0 : Math.PI,
  })),
};

// Run the real host through asynchronous messages and real buffer detachment.
class TransferWorker {
  static instances: TransferWorker[] = [];
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  detachedSnapshots = 0;
  snapshots = 0;
  readonly host: SimulationWorkerHost;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    TransferWorker.instances.push(this);
    this.host = new SimulationWorkerHost((message, transfer = []) => {
      const cloned = structuredClone(message, { transfer });
      if (message.type === "SNAPSHOT") {
        this.snapshots++;
        if (message.buffer.byteLength === 0) this.detachedSnapshots++;
      }
      queueMicrotask(() => {
        if (!this.terminated)
          this.onmessage?.({ data: cloned } as MessageEvent<SimulationWorkerResponse>);
      });
    });
  }

  postMessage(message: SimulationWorkerRequest, transfer: ArrayBuffer[] = []): void {
    const cloned = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.terminated) this.host.receive(cloned);
    });
  }

  terminate(): void {
    this.terminated = true;
    this.host.dispose();
  }
}

function baseline(): ClientCombatSimulation {
  const sim = new ClientCombatSimulation(config.selectedMap);
  for (const fleet of config.fleets)
    for (const ship of buildFleetFromSlots(fleet.slots, fleet.team, fleet.baseX, fleet.heading))
      sim.addShip(ship);
  sim.observer = new FleetBreakdown(sim);
  return sim;
}

function combatHash(sim: ClientCombatSimulation): string {
  // Only pre-existing cosmetic log IDs use Math.random and need normalization.
  return createHash("sha256")
    .update(
      JSON.stringify({
        ships: sim.ships,
        projectiles: sim.projectiles,
        beams: sim.activeBeams,
        obstacles: sim.mapObstacles,
        stats: sim.stats,
        time: sim.timeElapsed,
        winner: sim.winner,
        winnerDeclaredTime: sim.winnerDeclaredTime,
        orders: [...sim.orders],
        log: sim.combatLog.map(({ id: _id, ...event }) => event),
      }),
    )
    .digest("hex");
}

function expectRenderParity(actual: ArrayBuffer, expected: ArrayBuffer): void {
  const actualViews = prepareSimulationSnapshotBuffer(actual);
  const expectedViews = prepareSimulationSnapshotBuffer(expected);
  const header = expected.slice(0, HEADER_WORDS * 4);
  // Publication cadence depends on returned-buffer availability, not combat.
  new Int32Array(header)[SnapshotHeader.snapshotSequence] =
    actualViews.header[SnapshotHeader.snapshotSequence];
  expect(new Uint8Array(actual, 0, HEADER_WORDS * 4)).toEqual(new Uint8Array(header));
  for (const [offset, countWord, stride] of [
    [SHIP_BYTE_OFFSET, SnapshotHeader.shipCount, SHIP_STRIDE],
    [MOUNT_BYTE_OFFSET, SnapshotHeader.mountCount, MOUNT_STRIDE],
    [PROJECTILE_BYTE_OFFSET, SnapshotHeader.projectileCount, PROJECTILE_STRIDE],
  ]) {
    const length = expectedViews.header[countWord] * stride * 4;
    expect(new Uint8Array(actual, offset, length)).toEqual(
      new Uint8Array(expected, offset, length),
    );
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  TransferWorker.instances = [];
});
afterEach(() => {
  for (const worker of TransferWorker.instances) worker.terminate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("simulation worker host and client", () => {
  it("starts a fresh worker from redeployed survivors with damage and loadouts preserved", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const previous = baseline();
    previous.ships[0].hullCurrent -= 50;
    previous.ships[0].armorCurrent -= 20;
    previous.ships[0].shieldCurrent = 0;
    previous.ships[1].isAlive = false;
    previous.timeElapsed = 300;
    previous.winner = -1;
    previous.continueBattleWithRemnants();
    const expected = structuredClone(previous.ships);
    const client = new SimulationWorkerClient({
      fleets: [],
      ships: previous.ships,
      crewVeterancy: { 0: "ace", 1: "veteran" },
    });
    await client.ready;
    const authoritative = TransferWorker.instances[0].host.simulation;
    expect(authoritative?.ships).toEqual(expected);
    expect(authoritative?.ships).not.toBe(previous.ships);
    expect(authoritative?.ships[0].hullCurrent).toBe(previous.ships[0].hullMax - 50);
    expect(authoritative?.ships[0].armorCurrent).toBe(previous.ships[0].armorMax - 20);
    expect(authoritative?.ships[0].shieldCurrent).toBe(previous.ships[0].shieldMax);
    expect(authoritative?.crewVeterancy).toEqual({ 0: "ace", 1: "veteran" });
    expect(authoritative?.observer).toBeInstanceOf(FleetBreakdown);
    expect(client.latestSnapshot?.presentation?.winner).toBeNull();
    expect(client.latestSnapshot?.presentation?.combatLog).toEqual([]);
    expect(client.latestSnapshot?.timeElapsed).toBe(0);
    const stepped = client.step(2);
    await vi.runAllTimersAsync();
    expect(await stepped).toBe(2);
    await client.dispose();
  });
  it("runs the production worker entry on an OS thread with snapshot and event parity", async () => {
    vi.useRealTimers();
    class ThreadWorker {
      onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      readonly thread = new NodeWorker(
        new URL("./fixtures/simulationWorkerThread.mjs", import.meta.url),
      );
      constructor() {
        this.thread.on("message", (data) =>
          this.onmessage?.({ data } as MessageEvent<SimulationWorkerResponse>),
        );
        this.thread.on("error", (error) => this.onerror?.({ message: error.message }));
        this.thread.on("messageerror", () => this.onmessageerror?.());
      }
      postMessage(message: SimulationWorkerRequest, transfer: ArrayBuffer[]): void {
        this.thread.postMessage(message, transfer);
      }
      terminate(): void {
        void this.thread.terminate();
      }
    }
    vi.stubGlobal("Worker", ThreadWorker);
    const remote = new SimulationWorkerClient(config);
    vi.stubGlobal("Worker", undefined);
    const local = new SimulationWorkerClient(config);
    try {
      await Promise.all([remote.ready, local.ready]);
      const order = { groupId: 1, stance: "brawl", priority: "capitals" } as const;
      await Promise.all([
        remote.command({ kind: "GROUP_ORDER", order }),
        local.command({ kind: "GROUP_ORDER", order }),
      ]);
      expect(await remote.step(180)).toBe(await local.step(180));
      await vi.waitFor(() =>
        expect(remote.latestSnapshot?.views?.header[SnapshotHeader.tick]).toBe(180),
      );
      const actual = remote.latestSnapshot?.views?.buffer;
      const expected = local.latestSnapshot?.views?.buffer;
      if (!actual || !expected) throw new Error("Missing threaded snapshots");
      expectRenderParity(actual, expected);
      expect(remote.drainEvents()).toEqual(local.drainEvents());
    } finally {
      await Promise.all([remote.dispose(), local.dispose()]);
    }
  });

  it("dispatches group policies at tick boundaries and streams transferred snapshots", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const worker = TransferWorker.instances[0];
    expect(worker.url.pathname).toContain("simulation.worker.ts");
    expect(worker.options).toEqual({ type: "module" });
    expect(client.status).toBe("ready");
    expect(client.latestSnapshot?.shipCount).toBe(6);
    expect(client.drainEvents().filter((event) => event.kind === "AUDIO")).toHaveLength(6);
    await client.command({ kind: "STANCE", groupId: 1, stance: "brawl" });
    await client.command({ kind: "TARGET_PRIORITY", groupId: 1, priority: "capitals" });
    expect(worker.host.simulation?.orders.get(1)).toEqual({
      groupId: 1,
      stance: "brawl",
      priority: "capitals",
    });
    const oldBuffer = client.previousSnapshot?.views?.buffer;
    const stepped = client.step(4);
    await vi.runAllTimersAsync();
    expect(await stepped).toBe(4);
    expect(oldBuffer?.byteLength).toBe(0);
    expect(client.latestSnapshot?.timeElapsed).toBe(4 / 60);
    expect(client.previousSnapshot?.views?.buffer.byteLength).toBe(SIMULATION_SNAPSHOT_BYTE_LENGTH);
    expect(client.latestSnapshot?.views?.header[SnapshotHeader.tick]).toBe(4);
    expect(client.latestSnapshot?.views?.header[SnapshotHeader.lastCommandSequence]).toBe(2);
    expect(worker.snapshots).toBe(7);
    expect(worker.detachedSnapshots).toBe(worker.snapshots);
    await client.dispose();
    expect(client.status).toBe("disposed");
    expect(worker.terminated).toBe(true);
    expect(worker.host.simulation).toBeNull();
  });

  it("matches synchronous authoritative combat bit-for-bit and preserves event order", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const remote = new SimulationWorkerClient(config);
    await remote.ready;
    vi.stubGlobal("Worker", undefined);
    const local = new SimulationWorkerClient(config);
    await local.ready;
    const reference = baseline();
    expect(local.mode).toBe("synchronous");
    expect(remote.drainEvents()).toEqual(local.drainEvents());
    for (const ticks of [120, 60]) {
      const order = { groupId: 1, stance: "brawl", priority: "nearest" } as const;
      await remote.command({ kind: "GROUP_ORDER", order });
      await local.command({ kind: "GROUP_ORDER", order });
      reference.setGroupOrder(order);
      const advanced = remote.step(ticks);
      await local.step(ticks);
      for (let i = 0; i < ticks; i++) reference.update(1 / 60);
      await vi.runAllTimersAsync();
      await advanced;
      const authoritative = TransferWorker.instances[0].host.simulation;
      if (!authoritative) throw new Error("Missing authoritative worker simulation");
      expect(combatHash(authoritative)).toBe(combatHash(reference));
      const events = remote.drainEvents();
      expect(events).toEqual(local.drainEvents());
      expect(
        events.some((event) => event.kind === "BEAM_FIRE" || event.kind === "PROJECTILE_FIRE"),
      ).toBe(true);
      const sequences = events.map((event) => event.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      const buffer = remote.latestSnapshot?.views?.buffer;
      if (!buffer) throw new Error("Missing snapshot");
      // Preserve unused capacity and host stamps, repack active fields from the
      // independent full-precision reference, and compare every backing byte.
      const expected = buffer.slice(0);
      packSimulationSnapshot(reference, expected);
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array(expected));
      expect(new Uint8Array(local.latestSnapshot?.views?.buffer ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array(buffer),
      );
    }
    expect(reference.stats[0].damageDealt + reference.stats[1].damageDealt).toBeGreaterThan(0);
    await remote.dispose();
    await local.dispose();
  });

  it("continues ticks without free buffers and never drops event bursts", async () => {
    const responses: SimulationWorkerResponse[] = [];
    const host = new SimulationWorkerHost((message, transfer = []) => {
      responses.push(structuredClone(message, { transfer }));
    });
    host.receive({ type: "INIT", epoch: 8, config, buffers: [createSimulationSnapshotBuffer()] });
    const initial = responses.find((message) => message.type === "SNAPSHOT");
    if (!initial || initial.type !== "SNAPSHOT") throw new Error("Missing initial snapshot");
    const pos: [number, number] = [10, 20];
    for (let i = 0; i < 300; i++) host.simulation?.onShieldHit?.(pos, i);
    pos[0] = 999;
    host.receive({ type: "STEP", epoch: 8, requestId: 1, ticks: 3 });
    await vi.runAllTimersAsync();
    expect(host.simulation?.timeElapsed).toBe(3 / 60);
    expect(responses.filter((message) => message.type === "SNAPSHOT")).toHaveLength(1);
    const events = responses.flatMap((message) =>
      message.type === "EVENTS" ? message.events : [],
    );
    expect(events.filter((event) => event.kind === "SHIELD_HIT")).toHaveLength(300);
    expect(
      events.find((event) => event.kind === "SHIELD_HIT" && event.pos[0] === 10),
    ).toBeDefined();
    host.receive({ type: "RECYCLE", epoch: 8, buffer: initial.buffer });
    const snapshots = responses.filter((message) => message.type === "SNAPSHOT");
    expect(snapshots).toHaveLength(2);
    expect(prepareSimulationSnapshotBuffer(snapshots[1].buffer).header[SnapshotHeader.tick]).toBe(
      3,
    );
    host.receive({ type: "DISPOSE" });
    expect(responses.at(-1)).toEqual({ type: "DISPOSED" });
  });

  it("rejects invalid commands and stale epochs, and supports construction fallback", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("Unsupported worker");
        }
      },
    );
    const client = new SimulationWorkerClient(config);
    await client.ready;
    expect(client.mode).toBe("synchronous");
    await expect(client.step(0)).rejects.toThrow("positive safe integer");
    await expect(
      client.command({ kind: "TARGET_OVERRIDE", shipId: "0_0", targetId: "1_0" }),
    ).rejects.toThrow("not supported");
    expect(await client.step()).toBe(1);
    const responses: SimulationWorkerResponse[] = [];
    const host = new SimulationWorkerHost((message) => responses.push(message), true);
    host.receive({ type: "INIT", epoch: 4, config, buffers: [] });
    host.receive({ type: "STEP", epoch: 3, requestId: 9, ticks: 1 });
    expect(responses.at(-1)).toMatchObject({
      type: "ERROR",
      requestId: 9,
      message: "Stale simulation worker epoch",
    });
    expect(host.simulation?.timeElapsed).toBe(0);
    host.dispose();
    await client.dispose();
    await expect(client.step()).rejects.toThrow("disposed");
  });

  it("cancels in-flight steps and makes disposal idempotent", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const rejected = expect(client.step(100)).rejects.toThrow("disposed");
    const disposal = client.dispose();
    expect(client.dispose()).toBe(disposal);
    await rejected;
    await disposal;
    await vi.runAllTimersAsync();
    expect(client.latestSnapshot).toBeNull();
    expect(client.previousSnapshot).toBeNull();
    expect(client.drainEvents()).toEqual([]);
    expect(TransferWorker.instances[0].host.simulation).toBeNull();
    await client.dispose();
  });

  it("fails closed on runtime errors without restarting from a render snapshot", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const rejected = expect(client.step(2)).rejects.toThrow("decoding");
    TransferWorker.instances[0].onmessageerror?.();
    await rejected;
    expect(client.status).toBe("failed");
    expect(TransferWorker.instances[0].terminated).toBe(true);
    await client.dispose();
  });

  it("terminates an unresponsive worker after the graceful shutdown deadline", async () => {
    vi.stubGlobal("Worker", TransferWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    vi.spyOn(TransferWorker.instances[0], "postMessage").mockImplementation(() => {});
    const disposed = client.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await disposed;
    expect(client.status).toBe("disposed");
    expect(TransferWorker.instances[0].terminated).toBe(true);
  });
});
