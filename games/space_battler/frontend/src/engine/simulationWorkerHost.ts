import { FleetBreakdown } from "./fleetBreakdown";
import { buildFleetFromSlots } from "./fleetBuilder";
import { ClientCombatSimulation } from "./simulation";
import { SimulationPresentationMetadataPacker } from "./simulationPresentationMetadata";
import type {
  SimulationWorkerCommand,
  SimulationWorkerEvent,
  SimulationWorkerEventPayload,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./simulationWorkerMessages";
import {
  packSimulationSnapshot,
  prepareSimulationSnapshotBuffer,
  SnapshotHeader,
} from "./simulationWorkerProtocol";

/** Shared by the module worker and synchronous headless fallback. The browser
 * host yields after EVERY fixed tick, even for a multi-tick STEP request.
 */
export class SimulationWorkerHost {
  simulation: ClientCombatSimulation | null = null;
  private epoch = 0;
  private tick = 0;
  private snapshotSequence = 0;
  private commandSequence = 0;
  private eventSequence = 0;
  private readonly presentation = new SimulationPresentationMetadataPacker();
  private stepDurationMs = 0;
  private events: SimulationWorkerEvent[] = [];
  private buffers: ArrayBuffer[] = [];
  private steps: Array<{ requestId: number; remaining: number }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private disposed = false;
  private readonly send: (message: SimulationWorkerResponse, transfer?: ArrayBuffer[]) => void;
  private readonly synchronous: boolean;

  constructor(
    send: (message: SimulationWorkerResponse, transfer?: ArrayBuffer[]) => void,
    synchronous = false,
  ) {
    this.send = send;
    this.synchronous = synchronous;
  }

  receive(message: SimulationWorkerRequest): void {
    if (this.disposed) return;
    try {
      if (message.type === "DISPOSE") {
        this.dispose();
        this.send({ type: "DISPOSED" });
        return;
      }
      if (message.type === "INIT") {
        if (this.simulation) throw new Error("Simulation worker is already initialized");
        this.epoch = message.epoch;
        this.buffers = message.buffers;
        for (const buffer of this.buffers) prepareSimulationSnapshotBuffer(buffer);
        const sim = new ClientCombatSimulation(message.config.selectedMap);
        this.simulation = sim;
        sim.crewVeterancy = { ...message.config.crewVeterancy };
        this.attachEvents(sim);
        for (const fleet of message.config.fleets) {
          for (const ship of buildFleetFromSlots(
            fleet.slots,
            fleet.team,
            fleet.baseX,
            fleet.heading,
            fleet.expandedSpacing,
          ))
            sim.addShip(ship);
        }
        for (const ship of message.config.ships ?? []) sim.addShip(structuredClone(ship));
        sim.observer = new FleetBreakdown(sim);
        for (const order of message.config.orders ?? []) sim.setGroupOrder({ ...order });
        this.dirty = true;
        this.publish();
        this.send({ type: "READY", epoch: this.epoch });
        return;
      }
      if (!this.simulation) throw new Error("Simulation worker is not initialized");
      if (message.epoch !== this.epoch) throw new Error("Stale simulation worker epoch");
      switch (message.type) {
        case "RECYCLE":
          prepareSimulationSnapshotBuffer(message.buffer);
          this.buffers.push(message.buffer);
          this.publish();
          break;
        case "COMMAND":
          this.applyCommand(message.command);
          this.commandSequence = message.requestId;
          this.dirty = true;
          this.publish();
          this.send({
            type: "ACK",
            epoch: this.epoch,
            requestId: message.requestId,
            tick: this.tick,
          });
          break;
        case "STEP":
          if (!Number.isSafeInteger(message.ticks) || message.ticks < 1)
            throw new RangeError("STEP ticks must be a positive safe integer");
          this.steps.push({ requestId: message.requestId, remaining: message.ticks });
          if (this.synchronous) {
            try {
              while (this.steps.length > 0) this.advance();
            } catch (error) {
              this.fail(error);
            }
          } else this.schedule();
          break;
      }
    } catch (error) {
      this.send({
        type: "ERROR",
        epoch: this.epoch,
        ...("requestId" in message ? { requestId: message.requestId } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.steps = [];
    this.events = [];
    this.buffers = [];
    this.simulation = null;
  }

  private applyCommand(command: SimulationWorkerCommand): void {
    const sim = this.simulation;
    if (!sim) return;
    if (command.kind === "TARGET_OVERRIDE")
      throw new Error("Explicit target-ID overrides are not supported by the combat engine");
    if (command.kind === "GROUP_ORDER") {
      sim.setGroupOrder({ ...command.order });
      return;
    }
    const order = sim.orders.get(command.groupId) ?? {
      groupId: command.groupId,
      priority: "nearest",
      stance: "optimal_range",
    };
    sim.setGroupOrder({
      ...order,
      ...(command.kind === "STANCE" ? { stance: command.stance } : { priority: command.priority }),
    });
  }

  private schedule(): void {
    if (this.disposed || this.timer !== null || this.steps.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.advance();
        this.schedule();
      } catch (error) {
        this.fail(error);
      }
    }, 0);
  }

  private advance(): void {
    const step = this.steps[0];
    const sim = this.simulation;
    if (!step || !sim) return;
    if (sim.winner !== -1) {
      this.tick++;
      sim.update(1 / 60, (duration) => {
        this.stepDurationMs = duration;
      });
      this.dirty = true;
    }
    this.publish();
    if (--step.remaining === 0 || sim.winner === -1) {
      this.steps.shift();
      this.send({ type: "ACK", epoch: this.epoch, requestId: step.requestId, tick: this.tick });
    }
  }

  private fail(error: unknown): void {
    // A tick/pack failure may leave partially advanced authoritative state.
    // Both transports stop instead of continuing or reconstructing from Float32.
    this.dispose();
    this.send({
      type: "ERROR",
      epoch: this.epoch,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private publish(): void {
    // Reliable events have independent ownership: snapshot starvation/coalescing
    // cannot lose a whole-tick burst larger than the codec's event ring.
    if (this.events.length > 0) {
      const events = this.events;
      this.events = [];
      this.send({ type: "EVENTS", epoch: this.epoch, events });
    }
    this.simulation?.drainAudioEvents();
    if (!this.dirty || !this.simulation || this.buffers.length === 0) return;
    const buffer = this.buffers.pop();
    if (!buffer) return;
    const { header } = prepareSimulationSnapshotBuffer(buffer);
    header[SnapshotHeader.epoch] = this.epoch;
    header[SnapshotHeader.snapshotSequence] = ++this.snapshotSequence;
    header[SnapshotHeader.tick] = this.tick;
    header[SnapshotHeader.lastCommandSequence] = this.commandSequence;
    header[SnapshotHeader.nextEventSequence] = this.eventSequence + 1;
    const { byteLength } = packSimulationSnapshot(this.simulation, buffer);
    this.dirty = false;
    this.send(
      {
        type: "SNAPSHOT",
        epoch: this.epoch,
        buffer,
        byteLength,
        presentation: this.presentation.pack(this.simulation),
        stepDurationMs: this.stepDurationMs,
        sentAtMs: performance.timeOrigin + performance.now(),
      },
      [buffer],
    );
  }

  private emit(payload: SimulationWorkerEventPayload): void {
    this.events.push({
      ...payload,
      epoch: this.epoch,
      sequence: ++this.eventSequence,
      tick: this.tick,
      time: this.simulation?.timeElapsed ?? 0,
    });
  }

  private attachEvents(sim: ClientCombatSimulation): void {
    sim.onAudioEvent = (event) =>
      this.emit({ kind: "AUDIO", event: { ...event, pos: [...event.pos] } });
    sim.onProjectileFire = (weaponType, pos) =>
      this.emit({ kind: "PROJECTILE_FIRE", weaponType, pos: [...pos] });
    sim.onShieldHit = (pos, intensity) =>
      this.emit({ kind: "SHIELD_HIT", pos: [...pos], intensity });
    sim.onWeaponImpact = (ship, origin, shield, armor, hull) =>
      this.emit({
        kind: "WEAPON_IMPACT",
        shipId: ship.id,
        pos: [...ship.pos],
        origin: [...origin],
        shield,
        armor,
        hull,
      });
    sim.onShipDestroyed = (ship) =>
      this.emit({
        kind: "SHIP_DESTROYED",
        shipId: ship.id,
        pos: [...ship.pos],
        velocity: [...ship.velocity],
        heading: ship.heading,
        size: ship.size,
        team: ship.team,
      });
    sim.onVictory = (winnerTeam) => this.emit({ kind: "VICTORY", winnerTeam });
    sim.onBeamFire = (from, to, color, width, team, channeled = false) =>
      this.emit({ kind: "BEAM_FIRE", from: [...from], to: [...to], color, width, team, channeled });
    sim.onFlakBurst = (pos, radius, team) =>
      this.emit({ kind: "FLAK_BURST", pos: [...pos], radius, team });
  }
}
