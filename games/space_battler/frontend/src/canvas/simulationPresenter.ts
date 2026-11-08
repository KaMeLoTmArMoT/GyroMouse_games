import type { PerformanceSamples } from "../components/PerformanceHud";
import type { ShieldHavenSystem } from "../engine/shieldHaven";
import type { ClientCombatSimulation } from "../engine/simulation";
import type { SimulationWorkerClient } from "../engine/simulationWorkerClient";
import type { SimulationWorkerEvent } from "../engine/simulationWorkerMessages";
import type { RenderInterpolationState } from "../engine/simulationWorkerProtocol";
import { interpolateSimulationSnapshot, snapshotBlendAlpha } from "../engine/snapshotInterpolation";
import type { ProjectileState, ShipState } from "../types/combat";

export type TacticalPresentationState = Pick<
  ClientCombatSimulation,
  | "ships"
  | "projectiles"
  | "activeBeams"
  | "mapObstacles"
  | "timeElapsed"
  | "crewVeterancy"
  | "getFighterWingVisuals"
> & { shieldHaven: Pick<ShieldHavenSystem, "getLease"> };

/** A supplied simulation is authoritative only in direct mode. Worker mode
 * owns a separate render model; Float32 presentation values never feed it back.
 * The client is owned by the caller and survives canvas effect/selection changes.
 */
export class SimulationPresenter {
  readonly state: TacticalPresentationState;
  error: Error | null = null;
  private accumulator = 0;
  private inFlight = false;
  private appliedSnapshot: RenderInterpolationState | null = null;
  private ships = new Map<string, ShipState>();
  private definitions = new Map<string, ShipState>();
  private projectiles = new Map<string, ProjectileState>();
  private dynamicKeys = new Map<string, string[]>();
  private readonly simulation: ClientCombatSimulation;
  readonly client: SimulationWorkerClient | undefined;

  constructor(simulation: ClientCombatSimulation, client?: SimulationWorkerClient) {
    this.simulation = simulation;
    this.client = client;
    this.state = client
      ? {
          ships: [],
          projectiles: [],
          activeBeams: [],
          mapObstacles: structuredClone(simulation.mapObstacles),
          timeElapsed: 0,
          crewVeterancy: { ...simulation.crewVeterancy },
          getFighterWingVisuals: () => client.latestSnapshot?.presentation?.wings ?? [],
          shieldHaven: {
            getLease: (id) =>
              client.latestSnapshot?.presentation?.leases.find((lease) => lease.guestId === id) ??
              null,
          },
        }
      : simulation;
    // Handle startup failure even when the canvas mounts before READY.
    void client?.ready.catch((error: Error) => {
      this.error = error;
    });
  }

  frame(
    nowMs: number,
    dt: number,
    speed: number,
    samples?: PerformanceSamples,
    dispatch?: (events: SimulationWorkerEvent[]) => void,
  ): void {
    const client = this.client;
    if (!client) {
      if (speed > 0) this.simulation.update(dt * speed, samples?.addStep);
      return;
    }
    if (client.status === "ready" && speed > 0 && !this.error) {
      this.accumulator += dt * speed;
      const ticks = Math.min(240, Math.floor((this.accumulator + 1e-9) * 60));
      if (ticks > 0 && !this.inFlight) {
        this.accumulator = Math.max(0, this.accumulator - ticks / 60);
        this.inFlight = true;
        void client.step(ticks).then(
          () => {
            this.inFlight = false;
          },
          (error: Error) => {
            this.inFlight = false;
            this.error = error;
          },
        );
      }
    }
    const latest = client.latestSnapshot;
    if (latest?.presentation && latest.views) {
      if (latest !== this.appliedSnapshot) this.applyMetadata(latest);
      const alpha = snapshotBlendAlpha(client.previousSnapshot, latest, nowMs, speed);
      interpolateSimulationSnapshot(
        client.previousSnapshot,
        latest,
        alpha,
        this.state.ships,
        this.state.projectiles,
      );
      this.state.timeElapsed =
        client.previousSnapshot && speed > 0
          ? client.previousSnapshot.timeElapsed +
            (latest.timeElapsed - client.previousSnapshot.timeElapsed) * alpha
          : latest.timeElapsed;
    }
    if (speed > 0 && dispatch) dispatch(client.drainEvents());
    for (const sample of client.drainTransportSamples())
      samples?.addTransport(sample.stepDurationMs, sample.snapshotLatencyMs);
  }

  shipById(id: string): ShipState | undefined {
    return (
      this.ships.get(id) ??
      this.client?.shipDefinitions.get(id) ??
      this.simulation.ships.find((ship) => ship.id === id)
    );
  }

  private applyMetadata(snapshot: RenderInterpolationState): void {
    const metadata = snapshot.presentation;
    const client = this.client;
    if (!metadata || !client) return;
    this.state.ships = metadata.shipIds.map((id, i) => {
      const definition = client.shipDefinitions.get(id);
      if (!definition) throw new Error(`Missing worker ship definition: ${id}`);
      let ship = this.ships.get(id);
      if (!ship || this.definitions.get(id) !== definition) {
        ship = structuredClone(definition);
        this.ships.set(id, ship);
        this.definitions.set(id, definition);
        this.dynamicKeys.delete(id);
      }
      const dynamic = metadata.shipState[i];
      for (const key of this.dynamicKeys.get(id) ?? []) Reflect.deleteProperty(ship, key);
      Object.assign(ship, dynamic);
      this.dynamicKeys.set(id, Object.keys(dynamic));
      ship.turrets.forEach((turret, j) => {
        Object.assign(turret, metadata.turretState[i][j]);
      });
      return ship;
    });
    this.state.projectiles = metadata.projectileIds.map((id, i) => {
      let projectile = this.projectiles.get(id);
      if (!projectile) {
        const definition = client.projectileDefinitions.get(id);
        if (!definition) throw new Error(`Missing worker projectile definition: ${id}`);
        projectile = structuredClone(definition);
        this.projectiles.set(id, projectile);
      }
      Object.assign(projectile, metadata.projectileState[i]);
      return projectile;
    });
    const aliveIds = new Set(metadata.projectileIds);
    for (const id of this.projectiles.keys()) if (!aliveIds.has(id)) this.projectiles.delete(id);
    this.state.activeBeams = metadata.activeBeams;
    this.appliedSnapshot = snapshot;
  }
}
