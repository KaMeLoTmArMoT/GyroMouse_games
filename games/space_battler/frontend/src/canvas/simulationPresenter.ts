import type { PerformanceSamples } from "../components/PerformanceHud";
import { carrierFabricationProgress } from "../engine/carrierHangar";
import { FleetBreakdown } from "../engine/fleetBreakdown";
import type { ShieldHavenSystem } from "../engine/shieldHaven";
import type { ClientCombatSimulation } from "../engine/simulation";
import type { SimulationWorkerClient } from "../engine/simulationWorkerClient";
import type { SimulationWorkerEvent } from "../engine/simulationWorkerMessages";
import {
  PROJECTILE_STRIDE,
  ProjectileWord,
  type RenderInterpolationState,
  SHIP_STRIDE,
  ShipWord,
} from "../engine/simulationWorkerProtocol";
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
> & {
  shieldHaven: Pick<ShieldHavenSystem, "getLease">;
  getCarrierFabrication: (ship: ShipState) => ReturnType<typeof carrierFabricationProgress>;
};

// Add the velocity-dependent part of cubic Hermite interpolation to a linear
// interpolation. Endpoint velocities are in world units per simulation second.
function hermiteCorrection(a: number, interval: number, delta: number, v0: number, v1: number) {
  const tangent = delta / interval;
  const a2 = a * a;
  const a3 = a2 * a;
  return interval * ((a3 - 2 * a2 + a) * (v0 - tangent) + (a3 - a2) * (v1 - tangent));
}

/** A supplied simulation is authoritative only in direct mode. Worker mode
 * mirrors its render model onto the supplied simulation for existing HUD reads;
 * Float32 presentation values never feed the worker's authoritative simulation.
 * The client is owned by the caller and survives canvas effect/selection changes.
 */
export class SimulationPresenter {
  readonly state: TacticalPresentationState;
  error: Error | null = null;
  private accumulator = 0;
  private inFlight = false;
  private lastSpeed = 0;
  private blendedSnapshot: RenderInterpolationState | null = null;
  private blendAlpha = 0;
  private appliedSnapshot: RenderInterpolationState | null = null;
  private indexedSnapshot: RenderInterpolationState | null = null;
  private previousShipRows = new Map<string, number>();
  private previousProjectileRows = new Map<string, number>();
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
          getCarrierFabrication: (ship) =>
            client.latestSnapshot?.presentation?.carrierFabrication[ship.id] ??
            carrierFabricationProgress(ship, this.state.timeElapsed),
          shieldHaven: {
            getLease: (id) =>
              client.latestSnapshot?.presentation?.leases.find((lease) => lease.guestId === id) ??
              null,
          },
        }
      : Object.assign(simulation, {
          getCarrierFabrication: (ship: ShipState) =>
            carrierFabricationProgress(ship, simulation.timeElapsed),
        });
    if (client) {
      simulation.getRollingDPS = (team) =>
        client.latestSnapshot?.presentation?.rollingDps[team] ?? 0;
      simulation.getFighterWingVisuals = this.state.getFighterWingVisuals;
      simulation.harmonicShields.getTenderState = (id) =>
        client.latestSnapshot?.presentation?.tenderStates[id] ?? null;
      simulation.shieldHaven.getLease = this.state.shieldHaven.getLease;
      const breakdown = new FleetBreakdown(simulation);
      breakdown.format = (team) => {
        const text = client.latestSnapshot?.presentation?.fleetBreakdownText;
        return text ? (team === undefined ? text.full : team === 0 ? text.team0 : text.team1) : "";
      };
      simulation.observer = breakdown;
    }
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
    if (speed !== this.lastSpeed) {
      this.accumulator = 0;
      if (this.lastSpeed > 0 && this.inFlight && client.status === "ready") {
        void client.cancelSteps().catch((error: Error) => {
          if (client.status === "ready") this.error = error;
        });
      }
      this.lastSpeed = speed;
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
      if (latest !== this.blendedSnapshot) {
        this.blendedSnapshot = latest;
        this.blendAlpha = 0;
      }
      const alpha = Math.max(
        this.blendAlpha,
        snapshotBlendAlpha(client.previousSnapshot, latest, nowMs, speed),
      );
      this.blendAlpha = alpha;
      interpolateSimulationSnapshot(
        client.previousSnapshot,
        latest,
        alpha,
        this.state.ships,
        this.state.projectiles,
      );
      this.interpolatePositions(client.previousSnapshot, latest, alpha);
      this.state.timeElapsed =
        client.previousSnapshot && speed > 0
          ? client.previousSnapshot.timeElapsed +
            (latest.timeElapsed - client.previousSnapshot.timeElapsed) * alpha
          : latest.timeElapsed;
      this.simulation.ships = this.state.ships;
      this.simulation.projectiles = this.state.projectiles;
      this.simulation.activeBeams = this.state.activeBeams;
      this.simulation.timeElapsed = this.state.timeElapsed;
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

  private interpolatePositions(
    previous: RenderInterpolationState | null,
    latest: RenderInterpolationState,
    alpha: number,
  ): void {
    const old = previous?.views;
    const current = latest.views;
    const interval = previous ? latest.timeElapsed - previous.timeElapsed : 0;
    if (!previous || !old || !current || interval <= 0 || alpha <= 0 || alpha >= 1) return;
    if (this.indexedSnapshot !== previous) {
      this.previousShipRows = new Map(previous.presentation?.shipIds.map((id, i) => [id, i]));
      this.previousProjectileRows = new Map(
        previous.presentation?.projectileIds.map((id, i) => [id, i]),
      );
      this.indexedSnapshot = previous;
    }
    this.state.ships.forEach((ship, i) => {
      const previousIndex = this.previousShipRows.get(ship.id);
      if (previousIndex === undefined) return;
      const before = previousIndex * SHIP_STRIDE;
      const row = i * SHIP_STRIDE;
      if (old.shipsInt[before + ShipWord.flags] !== current.shipsInt[row + ShipWord.flags]) return;
      for (const [axis, position, velocity] of [
        [0, ShipWord.posX, ShipWord.velX],
        [1, ShipWord.posY, ShipWord.velY],
      ] as const) {
        ship.pos[axis] += hermiteCorrection(
          alpha,
          interval,
          current.shipsFloat[row + position] - old.shipsFloat[before + position],
          old.shipsFloat[before + velocity],
          current.shipsFloat[row + velocity],
        );
      }
    });
    this.state.projectiles.forEach((projectile, i) => {
      const previousIndex = this.previousProjectileRows.get(projectile.id);
      if (previousIndex === undefined) return;
      const before = previousIndex * PROJECTILE_STRIDE;
      const row = i * PROJECTILE_STRIDE;
      for (const [axis, position, velocity] of [
        [0, ProjectileWord.posX, ProjectileWord.velX],
        [1, ProjectileWord.posY, ProjectileWord.velY],
      ] as const) {
        projectile.pos[axis] += hermiteCorrection(
          alpha,
          interval,
          current.projectilesFloat[row + position] - old.projectilesFloat[before + position],
          old.projectilesFloat[before + velocity],
          current.projectilesFloat[row + velocity],
        );
      }
    });
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
    this.simulation.winner = metadata.winner;
    this.simulation.winnerDeclaredTime = metadata.winnerDeclaredTime;
    this.simulation.stats = structuredClone(metadata.stats);
    this.simulation.combatLog = structuredClone(metadata.combatLog);
    this.appliedSnapshot = snapshot;
  }
}
