import { SimulationWorkerHost } from "./simulationWorkerHost";
import type {
  SimulationWorkerCommand,
  SimulationWorkerConfig,
  SimulationWorkerEvent,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./simulationWorkerMessages";
import {
  createSimulationSnapshotBuffer,
  RenderInterpolationState,
  SIMULATION_SNAPSHOT_BYTE_LENGTH,
  SnapshotHeader,
  unpackSimulationSnapshot,
} from "./simulationWorkerProtocol";

export class SimulationWorkerClient {
  readonly epoch = 1;
  readonly ready: Promise<void>;
  mode: "worker" | "synchronous" = "worker";
  status: "starting" | "ready" | "failed" | "disposing" | "disposed" = "starting";
  error: Error | null = null;
  // Endpoints remain owned here until the next response. Consumers must not
  // retain typed views across worker messages; copy long-lived React telemetry.
  latestSnapshot: RenderInterpolationState | null = null;
  previousSnapshot: RenderInterpolationState | null = null;
  private worker: Worker | null = null;
  private localHost: SimulationWorkerHost | null = null;
  private buffers: ArrayBuffer[] = [];
  private events: SimulationWorkerEvent[] = [];
  private requestSequence = 0;
  private pending = new Map<
    number,
    { resolve: (tick: number) => void; reject: (error: Error) => void }
  >();
  private resolveReady: () => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private disposal: Promise<void> | null = null;
  private disposalTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveDisposal: () => void = () => {};

  constructor(config: SimulationWorkerConfig) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    try {
      if (typeof Worker !== "undefined") {
        this.worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
          type: "module",
        });
        this.worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) =>
          this.receive(event.data);
        this.worker.onerror = (event) =>
          this.fail(new Error(event.message || "Simulation worker failed"));
        this.worker.onmessageerror = () =>
          this.fail(new Error("Simulation worker message decoding failed"));
      }
    } catch {
      // Construction can be unavailable in headless environments or blocked by
      // browser policy. No ticks have run, so reconstruction here is exact.
      this.worker?.terminate();
      this.worker = null;
    }
    if (!this.worker) {
      this.mode = "synchronous";
      this.localHost = new SimulationWorkerHost((message) => this.receive(message), true);
    }
    const buffers = Array.from({ length: 3 }, () => createSimulationSnapshotBuffer());
    try {
      this.send(
        { type: "INIT", epoch: this.epoch, config: structuredClone(config), buffers },
        buffers,
      );
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  step(ticks = 1): Promise<number> {
    return this.request((requestId) => ({ type: "STEP", epoch: this.epoch, requestId, ticks }));
  }

  command(command: SimulationWorkerCommand): Promise<number> {
    return this.request((requestId) => ({
      type: "COMMAND",
      epoch: this.epoch,
      requestId,
      command: structuredClone(command),
    }));
  }

  drainEvents(): SimulationWorkerEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    if (this.status === "disposed" || this.status === "failed") return Promise.resolve();
    this.disposal = new Promise((resolve) => {
      this.resolveDisposal = resolve;
    });
    this.status = "disposing";
    this.rejectRequests(new Error("Simulation worker disposed"));
    this.rejectReady(new Error("Simulation worker disposed before readiness"));
    // A crashed/unresponsive worker must not leave teardown waiting forever.
    this.disposalTimer = setTimeout(() => this.finishDisposal(), 1000);
    try {
      this.send({ type: "DISPOSE" });
    } catch {
      this.finishDisposal();
    }
    return this.disposal;
  }

  private request(create: (requestId: number) => SimulationWorkerRequest): Promise<number> {
    if (this.status === "failed" || this.status === "disposing" || this.status === "disposed")
      return Promise.reject(this.error ?? new Error("Simulation worker is disposed"));
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.send(create(requestId));
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: SimulationWorkerRequest, transfer: ArrayBuffer[] = []): void {
    if (this.worker) this.worker.postMessage(message, transfer);
    else this.localHost?.receive(message);
  }

  private receive(message: SimulationWorkerResponse): void {
    if (this.status === "disposed" || this.status === "failed") return;
    if (message.type === "DISPOSED") {
      this.finishDisposal();
      return;
    }
    if (message.epoch !== this.epoch || this.status === "disposing") return;
    switch (message.type) {
      case "READY":
        this.status = "ready";
        this.resolveReady();
        break;
      case "SNAPSHOT": {
        try {
          if (message.byteLength !== SIMULATION_SNAPSHOT_BYTE_LENGTH)
            throw new RangeError("Incorrect simulation snapshot byte length");
          const state = new RenderInterpolationState();
          unpackSimulationSnapshot(message.buffer, state);
          if (state.views?.header[SnapshotHeader.epoch] !== this.epoch)
            throw new RangeError("Incorrect simulation snapshot epoch");
          const recycled = this.previousSnapshot?.views?.buffer;
          this.previousSnapshot = this.latestSnapshot;
          this.latestSnapshot = state;
          if (recycled) this.buffers.push(recycled);
          while (this.buffers.length > 0) {
            const buffer = this.buffers.pop();
            if (buffer) this.send({ type: "RECYCLE", epoch: this.epoch, buffer }, [buffer]);
          }
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
        break;
      }
      case "EVENTS":
        this.events.push(...message.events);
        break;
      case "ACK":
        this.pending.get(message.requestId)?.resolve(message.tick);
        this.pending.delete(message.requestId);
        break;
      case "ERROR": {
        const error = new Error(message.message);
        if (message.requestId !== undefined) {
          this.pending.get(message.requestId)?.reject(error);
          this.pending.delete(message.requestId);
        } else this.fail(error);
        break;
      }
    }
  }

  private rejectRequests(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private fail(error: Error): void {
    if (this.status === "disposed" || this.status === "failed") return;
    this.error = error;
    this.status = "failed";
    this.rejectReady(error);
    this.rejectRequests(error);
    this.cleanup();
    this.resolveDisposal();
  }

  private cleanup(): void {
    if (this.disposalTimer !== null) clearTimeout(this.disposalTimer);
    this.disposalTimer = null;
    this.worker?.terminate();
    this.worker = null;
    this.localHost?.dispose();
    this.localHost = null;
    this.latestSnapshot = null;
    this.previousSnapshot = null;
    this.buffers = [];
    this.events = [];
  }

  private finishDisposal(): void {
    this.cleanup();
    this.status = "disposed";
    this.resolveDisposal();
  }
}
