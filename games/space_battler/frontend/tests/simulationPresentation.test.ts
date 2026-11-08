import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualEffectsManager } from "../src/canvas/effects";
import { SimulationPresenter } from "../src/canvas/simulationPresenter";
import { dispatchWorkerPresentationEvents } from "../src/canvas/workerPresentationEvents";
import { PerformanceSamples } from "../src/components/PerformanceHud";
import { carrierFabricationProgress } from "../src/engine/carrierHangar";
import { FleetBreakdown } from "../src/engine/fleetBreakdown";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { ClientCombatSimulation } from "../src/engine/simulation";
import { SimulationPresentationMetadataPacker } from "../src/engine/simulationPresentationMetadata";
import { SimulationWorkerClient } from "../src/engine/simulationWorkerClient";
import { SimulationWorkerHost } from "../src/engine/simulationWorkerHost";
import type {
  SimulationWorkerConfig,
  SimulationWorkerEvent,
  SimulationWorkerEventPayload,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../src/engine/simulationWorkerMessages";
import {
  createSimulationSnapshotBuffer,
  packSimulationSnapshot,
  RenderInterpolationState,
  unpackSimulationSnapshot,
} from "../src/engine/simulationWorkerProtocol";
import {
  interpolateAngle,
  interpolateSimulationSnapshot,
  snapshotBlendAlpha,
} from "../src/engine/snapshotInterpolation";
import type { ProjectileState } from "../src/types/combat";

const config: SimulationWorkerConfig = {
  fleets: [0, 1].map((team) => ({
    slots: [{ id: `ship_${team}`, hullClass: "cruiser", groupId: 1 }],
    team,
    baseX: team === 0 ? -260 : 260,
    heading: team === 0 ? 0 : Math.PI,
  })),
};

function simulation() {
  const sim = new ClientCombatSimulation();
  for (const fleet of config.fleets) {
    for (const ship of buildFleetFromSlots(fleet.slots, fleet.team, fleet.baseX, fleet.heading))
      sim.addShip(ship);
  }
  return sim;
}

function projectile(sim: ClientCombatSimulation, id = "shot"): ProjectileState {
  const owner = sim.ships[0];
  const weapon = owner.turrets[0].weapon;
  return {
    id,
    weaponType: weapon.weaponType,
    weapon,
    damage: weapon.damage,
    ownerId: owner.id,
    ownerTeam: owner.team,
    pos: [10, 20],
    velocity: [30, 40],
    lifetime: 1,
    targetId: null,
    hp: 10,
    maxHp: 10,
  };
}

function snapshot(sim: ClientCombatSimulation): RenderInterpolationState {
  const buffer = createSimulationSnapshotBuffer();
  packSimulationSnapshot(sim, buffer);
  const state = new RenderInterpolationState();
  unpackSimulationSnapshot(buffer, state);
  state.presentation = new SimulationPresentationMetadataPacker().pack(sim);
  return state;
}

class PresentationWorker {
  static instances: PresentationWorker[] = [];
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  readonly host = new SimulationWorkerHost((message, transfer = []) => {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent<SimulationWorkerResponse>);
    });
  });
  constructor() {
    PresentationWorker.instances.push(this);
  }
  postMessage(message: SimulationWorkerRequest, transfer: ArrayBuffer[] = []) {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.terminated) this.host.receive(data);
    });
  }
  terminate() {
    this.terminated = true;
    this.host.dispose();
  }
}

function audioSpies() {
  return {
    playWeapon: vi.fn(),
    playCombatEvent: vi.fn(),
    playShieldHit: vi.fn(),
    playExplosion: vi.fn(),
    playVictory: vi.fn(),
  };
}

afterEach(() => {
  for (const worker of PresentationWorker.instances) worker.terminate();
  PresentationWorker.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("snapshot interpolation", () => {
  it.each([-1, 0, 0.25, 0.5, 1, 2])(
    "blends motion at alpha %s and preserves input buffers",
    (alpha) => {
      const sim = simulation();
      sim.projectiles = [projectile(sim)];
      sim.ships[0].pos = [0, 10];
      sim.ships[0].heading = 0;
      sim.ships[0].turrets[0].currentLocalAngle = 0;
      const previous = snapshot(sim);
      sim.ships[0].pos = [100, -10];
      sim.ships[0].heading = 1;
      sim.ships[0].turrets[0].currentLocalAngle = 1;
      sim.projectiles[0].pos = [30, 60];
      const latest = snapshot(sim);
      const bytes = latest.views?.buffer.slice(0);
      const ships = structuredClone(sim.ships);
      const shots = structuredClone(sim.projectiles);
      interpolateSimulationSnapshot(previous, latest, alpha, ships, shots);
      const blend = Math.max(0, Math.min(1, alpha));
      expect(ships[0].pos).toEqual([100 * blend, 10 - 20 * blend]);
      expect(ships[0].heading).toBeCloseTo(blend);
      expect(ships[0].turrets[0].currentLocalAngle).toBeCloseTo(blend);
      expect(shots[0].pos).toEqual([10 + 20 * blend, 20 + 40 * blend]);
      expect(new Uint8Array(latest.views?.buffer ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array(bytes ?? new ArrayBuffer(0)),
      );
    },
  );

  it.each([
    [Math.PI - 0.1, -Math.PI + 0.1],
    [-Math.PI + 0.1, Math.PI - 0.1],
  ])("takes the shortest arc through ±pi (%s to %s)", (a, b) => {
    expect(Math.abs(interpolateAngle(a, b, 0.5))).toBeCloseTo(Math.PI);
    expect(interpolateAngle(a, b, -1)).toBe(a);
    expect(interpolateAngle(a, b, 2)).toBe(b);
    const delta = Math.atan2(
      Math.sin(interpolateAngle(a, b, 0.25) - a),
      Math.cos(interpolateAngle(a, b, 0.25) - a),
    );
    expect(Math.abs(delta)).toBeCloseTo(0.05);
  });

  it("wraps both ship and turret angles", () => {
    const sim = simulation();
    sim.ships[0].heading = Math.PI - 0.1;
    sim.ships[0].turrets[0].currentLocalAngle = -Math.PI + 0.1;
    const previous = snapshot(sim);
    sim.ships[0].heading = -Math.PI + 0.1;
    sim.ships[0].turrets[0].currentLocalAngle = Math.PI - 0.1;
    const ships = structuredClone(sim.ships);
    interpolateSimulationSnapshot(previous, snapshot(sim), 0.5, ships, []);
    expect(Math.abs(ships[0].heading)).toBeCloseTo(Math.PI);
    expect(Math.abs(ships[0].turrets[0].currentLocalAngle)).toBeCloseTo(Math.PI);
  });

  it("joins reordered ships/projectiles by ID and snaps newly spawned entities", () => {
    const sim = simulation();
    sim.ships[0].pos = [0, 0];
    sim.ships[1].pos = [100, 100];
    sim.projectiles = [projectile(sim, "a"), { ...projectile(sim, "b"), pos: [100, 100] }];
    const previous = snapshot(sim);
    sim.ships.reverse();
    sim.ships[0].pos = [200, 200];
    sim.ships[1].pos = [20, 20];
    sim.projectiles = [
      { ...sim.projectiles[1], pos: [200, 200] },
      { ...projectile(sim, "new"), pos: [400, 400] },
    ];
    const latest = snapshot(sim);
    interpolateSimulationSnapshot(previous, latest, 0.5, sim.ships, sim.projectiles);
    expect(sim.ships.map((ship) => ship.pos)).toEqual([
      [150, 150],
      [10, 10],
    ]);
    expect(sim.projectiles.map((shot) => shot.pos)).toEqual([
      [150, 150],
      [400, 400],
    ]);
  });

  it("snaps docking transitions, missing endpoints and zero-time command snapshots", () => {
    const sim = simulation();
    const previous = snapshot(sim);
    sim.ships[0].isDocked = true;
    sim.ships[0].pos = [500, 500];
    const latest = snapshot(sim);
    interpolateSimulationSnapshot(previous, latest, 0, sim.ships, []);
    expect(sim.ships[0].pos).toEqual([500, 500]);
    interpolateSimulationSnapshot(null, latest, 0, sim.ships, []);
    expect(sim.ships[0].pos).toEqual([500, 500]);
    expect(snapshotBlendAlpha(previous, latest, 0, 1)).toBe(1);
  });

  it("uses snapshot simulation time, receive time and speed independently of refresh rate", () => {
    const sim = simulation();
    const previous = snapshot(sim);
    sim.timeElapsed = 1 / 60;
    const latest = snapshot(sim);
    latest.receivedAtMs = 100;
    expect(snapshotBlendAlpha(previous, latest, 100, 1)).toBe(0);
    expect(snapshotBlendAlpha(previous, latest, 100 + 1000 / 120, 1)).toBeCloseTo(0.5);
    expect(snapshotBlendAlpha(previous, latest, 100 + 1000 / 240, 2)).toBeCloseTo(0.5);
    expect(snapshotBlendAlpha(previous, latest, 500, 1)).toBe(1);
    expect(snapshotBlendAlpha(previous, latest, 0, 1)).toBe(0);
    expect(snapshotBlendAlpha(previous, latest, 100, 0)).toBe(1);
    expect(snapshotBlendAlpha(null, latest, 100, 1)).toBe(1);
  });
});

describe("worker presentation event dispatch", () => {
  it("routes every cue and impact using event-time geometry", () => {
    const sim = simulation();
    const ship = sim.ships[0];
    const effects = new VisualEffectsManager();
    const audio = audioSpies();
    const explosion = vi.spyOn(effects, "addShipExplosion");
    const decal = vi.spyOn(effects, "addDamageDecal");
    const payloads: SimulationWorkerEventPayload[] = [
      {
        kind: "AUDIO",
        event: { type: "warp_ingress", sourceId: ship.id, pos: [1, 2], team: 0, time: 0 },
      },
      {
        kind: "AUDIO",
        event: { type: "warp_ingress", sourceId: sim.ships[1].id, pos: [3, 4], team: 1, time: 0 },
      },
      {
        kind: "AUDIO",
        event: { type: "torpedo_launch", sourceId: ship.id, pos: [1, 2], team: 0, time: 0 },
      },
      { kind: "PROJECTILE_FIRE", weaponType: "railgun", pos: [0, 0] },
      { kind: "PROJECTILE_FIRE", weaponType: "missile", pos: [0, 0] },
      { kind: "SHIELD_HIT", pos: [0, 0], intensity: 0.7 },
      {
        kind: "WEAPON_IMPACT",
        shipId: ship.id,
        pos: [10, 20],
        origin: [10, 30],
        shield: true,
        armor: true,
        hull: true,
      },
      {
        kind: "SHIP_DESTROYED",
        shipId: ship.id,
        pos: [50, 60],
        velocity: [7, 8],
        heading: 1,
        size: ship.size,
        team: ship.team,
      },
      { kind: "VICTORY", winnerTeam: 0 },
      {
        kind: "BEAM_FIRE",
        from: [0, 0],
        to: [10, 10],
        color: "#fff",
        width: 2,
        team: 0,
        channeled: false,
      },
      {
        kind: "BEAM_FIRE",
        from: [0, 0],
        to: [10, 10],
        color: "#fff",
        width: 2,
        team: 0,
        channeled: true,
      },
      { kind: "FLAK_BURST", pos: [4, 5], radius: 10, team: 1 },
    ];
    dispatchWorkerPresentationEvents(
      payloads.map((event, i) => ({ ...event, epoch: 1, sequence: i + 1, tick: 1, time: 1 })),
      (id) => sim.ships.find((s) => s.id === id),
      effects,
      audio,
    );
    expect(audio.playCombatEvent.mock.calls).toEqual([["torpedo_launch"], ["warp_ingress"]]);
    expect(effects.warpGates.map((gate) => gate.pos)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(audio.playWeapon.mock.calls).toEqual([["railgun"], ["beam_laser"], ["beam_laser"]]);
    expect(audio.playShieldHit).toHaveBeenCalledWith(0.7);
    expect(effects.shieldImpacts[0].pos).toEqual([10, 20]);
    expect(effects.shieldImpacts[0].impactAngle).toBeCloseTo(Math.PI / 2);
    expect(decal).toHaveBeenCalledWith(ship, Math.PI / 2);
    expect(explosion.mock.calls[0][0].pos).toEqual([50, 60]);
    expect(audio.playExplosion.mock.calls[0][0].velocity).toEqual([7, 8]);
    expect(audio.playVictory).toHaveBeenCalledWith(0);
    expect(effects.beams).toHaveLength(1);
    expect(effects.flakBursts).toHaveLength(1);
  });
});

describe("dual-mode simulation presenter", () => {
  it.each([0, 0.5, 1, 2, 5])("advances the worker at %sx over wall time", async (speed) => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const presenter = new SimulationPresenter(simulation(), client);
    for (let i = 0; i < 20; i++) {
      presenter.frame((i + 1) * 50, 1 / 20, speed);
      await Promise.resolve();
    }
    expect(client.latestSnapshot?.timeElapsed).toBeCloseTo(speed, 5);
    await client.dispose();
  });

  it("cancels queued playback on pause and allows manual stepping before resuming", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", PresentationWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const presenter = new SimulationPresenter(simulation(), client);
    const host = PresentationWorker.instances[0].host;
    presenter.frame(0, 1, 2);
    await vi.advanceTimersByTimeAsync(5);
    expect(host.simulation?.timeElapsed).toBeGreaterThan(0);
    presenter.frame(5, 0, 0);
    await vi.runAllTimersAsync();
    const pausedTime = host.simulation?.timeElapsed ?? 0;
    expect(pausedTime).toBeLessThan(2);
    presenter.frame(100, 1, 0);
    const pausedPosition = [...presenter.state.ships[0].pos];
    const presentedTime = presenter.state.timeElapsed;
    await vi.runAllTimersAsync();
    expect(host.simulation?.timeElapsed).toBe(pausedTime);
    presenter.frame(150, 1, 0);
    expect(presenter.state.timeElapsed).toBe(presentedTime);
    expect(presenter.state.ships[0].pos).toEqual(pausedPosition);
    const stepped = client.step(2);
    await vi.runAllTimersAsync();
    await stepped;
    presenter.frame(200, 0, 0);
    expect(presenter.state.timeElapsed).toBeCloseTo(pausedTime + 2 / 60);
    presenter.frame(300, 1 / 60, 1);
    await vi.runAllTimersAsync();
    expect(host.simulation?.timeElapsed).toBeCloseTo(pausedTime + 3 / 60);
    await client.dispose();
  });

  it("discards a fast playback backlog when switching to a slower speed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", PresentationWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const presenter = new SimulationPresenter(simulation(), client);
    const host = PresentationWorker.instances[0].host;
    presenter.frame(0, 1, 2);
    await vi.advanceTimersByTimeAsync(5);
    presenter.frame(5, 0, 0.5);
    await vi.runAllTimersAsync();
    const changedTime = host.simulation?.timeElapsed ?? 0;
    expect(changedTime).toBeLessThan(2);
    presenter.frame(1005, 1, 0.5);
    await vi.runAllTimersAsync();
    expect(host.simulation?.timeElapsed).toBeCloseTo(changedTime + 0.5);
    await client.dispose();
  });

  it("does not move a snapshot backwards when playback speed is reduced", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    await client.step(1);
    const presenter = new SimulationPresenter(simulation(), client);
    const received = client.latestSnapshot?.receivedAtMs ?? 0;
    presenter.frame(received + 5, 0, 2);
    const presentedTime = presenter.state.timeElapsed;
    presenter.frame(received + 6, 0, 0.5);
    expect(presenter.state.timeElapsed).toBe(presentedTime);
    await client.dispose();
  });

  it("measures achieved simulation time against wall time and resets on a new battle", () => {
    const samples = new PerformanceSamples();
    samples.addSimulationTime(0, 0);
    samples.addSimulationTime(500, 0.6);
    expect(samples.realTimeFactor).toBeCloseTo(1.2);
    samples.addSimulationTime(1000, 0.6);
    expect(samples.realTimeFactor).toBe(0);
    samples.addSimulationTime(1500, 1.6);
    expect(samples.realTimeFactor).toBeCloseTo(2);
    samples.addSimulationTime(1600, 0);
    expect(samples.realTimeFactor).toBeNull();
    samples.addSimulationTime(2100, 0.25);
    expect(samples.realTimeFactor).toBeCloseTo(0.5);
    samples.resetSimulationClock();
    expect(samples.realTimeFactor).toBeNull();
  });

  it("keeps direct simulation updates and timing in synchronous mode", () => {
    const sim = simulation();
    const presenter = new SimulationPresenter(sim);
    const samples = new PerformanceSamples();
    presenter.frame(100, 1 / 60, 1, samples);
    expect(presenter.state).toBe(sim);
    expect(sim.timeElapsed).toBe(1 / 60);
    expect(samples.steps).toHaveLength(1);
    presenter.frame(110, 1 / 60, 0, samples);
    expect(sim.timeElapsed).toBe(1 / 60);
  });

  it("reads fabrication from the direct simulation's current time", () => {
    const sim = simulation();
    const [carrier] = buildFleetFromSlots(
      [{ id: "carrier", hullClass: "carrier", groupId: 1 }],
      0,
      -500,
      0,
    );
    sim.addShip(carrier);
    const presenter = new SimulationPresenter(sim);
    presenter.frame(0, 1 / 60, 1);
    sim.timeElapsed = 7;
    expect(presenter.state.getCarrierFabrication(carrier)).toEqual(
      carrierFabricationProgress(carrier, sim.timeElapsed),
    );
    expect(presenter.state.getCarrierFabrication(carrier).timerRemaining).toBeLessThan(20);
  });

  it("uses a separate render model with the client's unavailable-worker fallback", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const sim = simulation();
    const presenter = new SimulationPresenter(sim, client);
    const dispatch = vi.fn();
    const samples = new PerformanceSamples();
    presenter.frame(performance.now(), 1 / 60, 1, samples, dispatch);
    expect(client.mode).toBe("synchronous");
    expect(sim.timeElapsed).toBe(presenter.state.timeElapsed);
    expect(presenter.state.ships).toBe(sim.ships);
    expect(presenter.state.ships[0]).not.toBe(
      client.shipDefinitions.get(presenter.state.ships[0].id),
    );
    expect(samples.workerSteps.length).toBeGreaterThan(0);
    expect(samples.snapshotLatencies.every((value) => value >= 0)).toBe(true);
    expect(
      dispatch.mock.calls[0][0].filter(
        (event: SimulationWorkerEvent) =>
          event.kind === "AUDIO" && event.event.type === "warp_ingress",
      ),
    ).toHaveLength(2);
    expect(client.drainEvents()).toEqual([]);
    expect(client.drainTransportSamples()).toEqual([]);
    await client.dispose();
  });

  it("renders 120 Hz frames without awaiting worker steps, preserving ownership and effects identity", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", PresentationWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const sim = simulation();
    const presenter = new SimulationPresenter(sim, client);
    const audio = audioSpies();
    const effects = new VisualEffectsManager();
    const dispatch = (events: SimulationWorkerEvent[]) =>
      dispatchWorkerPresentationEvents(events, (id) => presenter.shipById(id), effects, audio);
    presenter.frame(performance.now(), 0, 1, undefined, dispatch);
    const ship = presenter.state.ships[0];
    const now = performance.now();
    presenter.frame(now, 1 / 120, 1, undefined, dispatch);
    expect(client.latestSnapshot?.timeElapsed).toBe(0);
    presenter.frame(now + 1000 / 120, 1 / 120, 1, undefined, dispatch);
    expect(client.latestSnapshot?.timeElapsed).toBe(0);
    await vi.runAllTimersAsync();
    const latest = client.latestSnapshot;
    const previous = client.previousSnapshot;
    if (!latest || !previous) throw new Error("Missing interpolation endpoints");
    presenter.frame(latest.receivedAtMs + 1000 / 120, 0, 1, undefined, dispatch);
    expect(presenter.state.timeElapsed).toBeCloseTo(1 / 120);
    expect(presenter.state.ships[0]).toBe(ship);
    expect(sim.timeElapsed).toBeCloseTo(1 / 120);
    expect(audio.playCombatEvent.mock.calls.filter(([cue]) => cue === "warp_ingress")).toHaveLength(
      1,
    );
    expect(client.drainEvents()).toEqual([]);
    await client.dispose();
  });

  it("keeps one request in flight and retains accumulated simulation time", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    let finish: (tick: number) => void = () => {};
    const step = vi.spyOn(client, "step").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const presenter = new SimulationPresenter(simulation(), client);
    for (let i = 0; i < 5; i++) presenter.frame(i * 17, 1 / 60, 1);
    expect(step).toHaveBeenCalledTimes(1);
    finish(1);
    await Promise.resolve();
    presenter.frame(100, 0, 1);
    expect(step).toHaveBeenLastCalledWith(4);
    finish(5);
    await Promise.resolve();
    await client.dispose();
  });

  it("holds queued ingress while paused and dispatches it exactly once after resuming", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const presenter = new SimulationPresenter(simulation(), client);
    const dispatch = vi.fn();
    presenter.frame(0, 1, 0, undefined, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(presenter.state.ships).toHaveLength(2);
    presenter.frame(10, 0, 1, undefined, dispatch);
    expect(dispatch.mock.calls[0][0]).toHaveLength(2);
    presenter.frame(20, 0, 1, undefined, dispatch);
    expect(dispatch.mock.calls[1][0]).toEqual([]);
    await client.dispose();
  });

  it("retains definitions when render frames skip multiple transferred snapshots", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    await client.step(5);
    expect(client.latestSnapshot?.presentation?.newShips).toEqual([]);
    const presenter = new SimulationPresenter(simulation(), client);
    presenter.frame(performance.now(), 0, 0);
    expect(presenter.state.ships).toHaveLength(2);
    expect(presenter.state.timeElapsed).toBe(5 / 60);
    await client.dispose();
  });

  it("mirrors READY and manual two-tick snapshots onto the HUD while paused", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const sim = simulation();
    const update = vi.spyOn(sim, "update");
    const presenter = new SimulationPresenter(sim, client);
    presenter.frame(0, 0, 0);
    expect(sim.ships).toBe(presenter.state.ships);
    expect(sim.timeElapsed).toBe(0);
    const ship = sim.ships[0];
    await client.step(2);
    presenter.frame(performance.now(), 0, 0);
    expect(sim.timeElapsed).toBe(2 / 60);
    expect(sim.ships[0]).toBe(ship);
    expect(sim.projectiles).toBe(presenter.state.projectiles);
    expect(sim.activeBeams).toBe(presenter.state.activeBeams);
    expect(update).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("mirrors authoritative summary, DPS, support and fabrication telemetry", async () => {
    vi.stubGlobal("Worker", PresentationWorker);
    const supportConfig: SimulationWorkerConfig = {
      fleets: [
        {
          team: 0,
          baseX: -500,
          heading: 0,
          slots: ["carrier", "tender", "cruiser"].map((hullClass, i) => ({
            id: `support_${i}`,
            hullClass: hullClass as "carrier" | "tender" | "cruiser",
            groupId: 1,
          })),
        },
        config.fleets[1],
      ],
    };
    const client = new SimulationWorkerClient(supportConfig);
    await client.ready;
    const hostSim = PresentationWorker.instances[0].host.simulation;
    if (!hostSim) throw new Error("Missing authoritative simulation");
    const sim = simulation();
    const presenter = new SimulationPresenter(sim, client);
    const carrier = hostSim.ships.find((ship) => ship.hullClass === "carrier")!;
    const tender = hostSim.ships.find((ship) => ship.hullClass === "tender")!;
    const recipient = hostSim.ships.find(
      (ship) => ship.hullClass === "cruiser" && ship.team === 0,
    )!;
    recipient.pos = [tender.pos[0] + 100, tender.pos[1]];
    recipient.shieldCurrent = 0;
    const stepped = client.step(2);
    await stepped;
    hostSim.timeElapsed = 7;
    hostSim.winner = 0;
    hostSim.winnerDeclaredTime = 6.5;
    hostSim.stats[0].damageDealt = 123;
    hostSim.stats[1].missilesIntercepted = 4;
    hostSim.stats[0].recentDamageWindow = [{ time: 7, damage: 125 }];
    hostSim.addCombatLog("Worker telemetry", 0);
    const lease = { guestId: recipient.id, parentId: carrier.id, slotId: "port-mid" as const };
    vi.spyOn(hostSim.shieldHaven, "getLease").mockImplementation((id) =>
      id === recipient.id ? lease : null,
    );
    await client.command({ kind: "STANCE", groupId: 1, stance: "brawl" });
    presenter.frame(performance.now(), 0, 0);
    expect(sim.winner).toBe(0);
    expect(sim.winnerDeclaredTime).toBe(6.5);
    expect(sim.stats).toEqual(hostSim.stats);
    expect(sim.stats).not.toBe(hostSim.stats);
    expect(sim.combatLog).toEqual(hostSim.combatLog);
    expect(sim.getRollingDPS(0)).toBe(50);
    expect(sim.getRollingDPS(1)).toBe(hostSim.getRollingDPS(1));
    expect(sim.harmonicShields.getTenderState(tender.id, sim.timeElapsed)).toEqual(
      hostSim.harmonicShields.getTenderState(tender.id, hostSim.timeElapsed),
    );
    expect(sim.shieldHaven.getLease(recipient.id)).toEqual(lease);
    expect(client.latestSnapshot?.presentation?.carrierFabrication[carrier.id]).toEqual(
      carrierFabricationProgress(carrier, hostSim.timeElapsed),
    );
    const renderedCarrier = presenter.state.ships.find((ship) => ship.id === carrier.id);
    if (!renderedCarrier) throw new Error("Missing rendered carrier");
    expect(presenter.state.getCarrierFabrication(renderedCarrier)).toEqual(
      client.latestSnapshot?.presentation?.carrierFabrication[carrier.id],
    );
    expect(presenter.state.getCarrierFabrication(renderedCarrier)).not.toEqual(
      carrierFabricationProgress(renderedCarrier, presenter.state.timeElapsed),
    );
    expect(
      client.latestSnapshot?.presentation?.carrierFabrication[carrier.id].timerRemaining,
    ).toBeLessThan(20);
    expect(sim.observer).toBeInstanceOf(FleetBreakdown);
    for (const team of [0, 1, undefined]) {
      expect((sim.observer as FleetBreakdown).format(team)).toBe(
        (hostSim.observer as FleetBreakdown).format(team),
      );
    }
    hostSim.stats[0].damageDealt = 999;
    expect(sim.stats[0].damageDealt).toBe(123);
    await client.dispose();
  });

  it("captures rejected steps without advancing the direct fallback from render values", async () => {
    vi.stubGlobal("Worker", undefined);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const step = vi.spyOn(client, "step").mockRejectedValue(new Error("transport failed"));
    const sim = simulation();
    const presenter = new SimulationPresenter(sim, client);
    presenter.frame(0, 1 / 60, 1);
    await Promise.resolve();
    expect(presenter.error?.message).toBe("transport failed");
    presenter.frame(20, 1 / 60, 1);
    expect(step).toHaveBeenCalledTimes(1);
    expect(sim.timeElapsed).toBe(0);
    await client.dispose();
  });

  it("bounds transport and render metrics history", () => {
    const samples = new PerformanceSamples();
    for (let i = 0; i < 200; i++) {
      samples.addTransport(i, i + 1);
      samples.addRender(i + 2);
    }
    expect(samples.workerSteps).toHaveLength(160);
    expect(samples.steps).toHaveLength(160);
    expect(samples.renderFrames).toHaveLength(160);
    expect(samples.snapshotLatencies).toHaveLength(160);
    expect(samples.snapshotLatencies.at(-1)).toBe(200);
  });

  it("refreshes and clears tactical metadata without replacing stable render ships", async () => {
    vi.stubGlobal("Worker", PresentationWorker);
    const client = new SimulationWorkerClient(config);
    await client.ready;
    const hostSim = PresentationWorker.instances[0].host.simulation;
    if (!hostSim) throw new Error("Missing host simulation");
    const presenter = new SimulationPresenter(simulation(), client);
    presenter.frame(0, 0, 0);
    const ship = presenter.state.ships[0];
    hostSim.ships[0].navigationTargetId = "target";
    hostSim.ships[0].flagshipId = "anchor";
    hostSim.ships[0].turrets[0].currentTargetId = "target";
    hostSim.projectiles = [projectile(hostSim)];
    await client.command({ kind: "STANCE", groupId: 1, stance: "brawl" });
    presenter.frame(1, 0, 0);
    expect(presenter.state.ships[0]).toBe(ship);
    expect(ship.navigationTargetId).toBe("target");
    expect(ship.flagshipId).toBe("anchor");
    expect(ship.turrets[0].currentTargetId).toBe("target");
    const shot = presenter.state.projectiles[0];
    expect(shot).not.toBe(hostSim.projectiles[0]);
    expect(shot.hp).toBe(10);
    delete hostSim.ships[0].navigationTargetId;
    delete hostSim.ships[0].flagshipId;
    hostSim.ships[0].turrets[0].currentTargetId = null;
    hostSim.projectiles[0].hp = 5;
    await client.command({ kind: "STANCE", groupId: 1, stance: "optimal_range" });
    presenter.frame(2, 0, 0);
    expect(ship.navigationTargetId).toBeUndefined();
    expect(ship.flagshipId).toBeUndefined();
    expect(ship.turrets[0].currentTargetId).toBeNull();
    expect(presenter.state.projectiles[0]).toBe(shot);
    expect(shot.hp).toBe(5);
    await client.dispose();
  });

  it("copies optional state and definitions independently of local authoritative mutations", () => {
    const sim = simulation();
    const packer = new SimulationPresentationMetadataPacker();
    sim.ships[0].broadsideCycle = { phase: "broadside_hold", targetId: "target", side: 1 };
    const metadata = packer.pack(sim);
    const originalPosition = metadata.newShips[0].pos[0];
    sim.ships[0].pos[0] = 999;
    sim.ships[0].broadsideCycle.side = -1;
    delete sim.ships[0].broadsideCycle;
    expect(metadata.newShips[0].pos[0]).toBe(originalPosition);
    expect(metadata.shipState[0].broadsideCycle).toBeDefined();
    expect(metadata.shipState[0].broadsideCycle?.side).toBe(1);
    expect(metadata.shipState[0]).not.toHaveProperty("pos");
    expect(metadata.shipState[0]).not.toHaveProperty("turrets");
    expect(packer.pack(sim).newShips).toEqual([]);
  });
});
