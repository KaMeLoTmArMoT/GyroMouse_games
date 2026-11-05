import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceAudioEngine } from "../src/engine/audioEngine";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HULL_PROFILES } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { CombatAudioCue, HullClass, ProjectileState } from "../src/types/combat";

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelAndHoldAtTime = vi.fn();
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static last: FakeAudioContext;
  currentTime = 0;
  sampleRate = 100;
  state = "running";
  destination = new FakeNode();
  sources: FakeNode[] = [];
  gains: FakeNode[] = [];
  constructor() {
    FakeAudioContext.last = this;
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createGain() {
    const gain = new FakeNode();
    this.gains.push(gain);
    return gain;
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(this.sampleRate) };
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createOscillator() {
    const node = new FakeNode();
    this.sources.push(node);
    return node;
  }
  createBufferSource() {
    return this.createOscillator();
  }
}

const events: CombatAudioCue[] = [
  "torpedo_launch",
  "flak_burst",
  "laser_intercept",
  "warp_ingress",
  "fighter_egress",
];

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe("combat audio", () => {
  it.each(events)("plays %s only when unmuted and unlocked", (event) => {
    const audio = new SpaceAudioEngine();
    audio.playCombatEvent(event);
    expect(audio.isMuted()).toBe(true);
    audio.setMuted(false);
    const context = FakeAudioContext.last;
    audio.playCombatEvent(event);
    expect(context.sources.length).toBeGreaterThan(0);
    const count = context.sources.length;
    audio.playCombatEvent(event);
    expect(context.sources).toHaveLength(count); // simultaneous duplicates are throttled
    audio.setMuted(true);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.025);
    context.currentTime = 2;
    audio.playCombatEvent(event);
    expect(context.sources).toHaveLength(count);
  });

  it("shares the persisted mute preference with other games", () => {
    const first = new SpaceAudioEngine();
    first.setMuted(false);
    expect(new SpaceAudioEngine().isMuted()).toBe(false);
    first.setMuted(true);
    expect(new SpaceAudioEngine().isMuted()).toBe(true);
  });
});

function ship(hullClass: HullClass, team: number, x: number) {
  const result = buildFleetFromSlots(
    [{ id: "test", hullClass, groupId: 1 }],
    team,
    x,
    team ? Math.PI : 0,
  )[0];
  result.maxSpeed = result.turnRate = result.shieldRegen = 0;
  return result;
}

describe("combat sound event sources", () => {
  it("queues fleet ingress and emits a flak burst when a shell detonates", () => {
    const defender = ship("corvette", 0, 0);
    const sim = new ClientCombatSimulation();
    sim.addShip(defender);
    expect(sim.drainAudioEvents()).toEqual([
      expect.objectContaining({ type: "warp_ingress", sourceId: defender.id }),
    ]);
    const weapon = defender.turrets[0].weapon;
    sim.projectiles.push({
      id: "flak",
      weaponType: weapon.weaponType,
      weapon,
      damage: weapon.damage,
      ownerId: defender.id,
      ownerTeam: 0,
      pos: [0, 0],
      velocity: [0, 0],
      lifetime: 1 / 60,
      targetId: null,
      hp: 25,
      maxHp: 25,
      isFlakBurst: true,
    });
    const event = vi.fn();
    sim.onAudioEvent = event;
    sim.update(1 / 60);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: "flak_burst" }));
  });

  it("emits named events for torpedo launch and laser interception", () => {
    const cruiser = ship("cruiser", 0, 0);
    cruiser.turrets = [cruiser.turrets[1]];
    const target = ship("battleship", 1, 1000);
    target.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(cruiser);
    sim.addShip(target);
    const shots = vi.fn();
    sim.onAudioEvent = shots;
    sim.update(1 / 60);
    expect(shots).toHaveBeenCalledWith(expect.objectContaining({ type: "torpedo_launch" }));

    const defender = ship("corvette", 0, 0);
    defender.turrets = [defender.turrets[0]];
    defender.turrets[0].offset = [0, 0];
    defender.turrets[0].weapon.flak = undefined;
    defender.turrets[0].weapon.projectileSpeed = 0;
    const weapon = HULL_PROFILES.cruiser.turrets[1].weapon;
    const torpedo: ProjectileState = {
      id: "incoming",
      weaponType: "missile",
      weapon,
      damage: weapon.damage,
      ownerId: "enemy",
      ownerTeam: 1,
      pos: [300, 0],
      velocity: [-100, 0],
      lifetime: 8,
      targetId: null,
      hp: 1,
      maxHp: 120,
    };
    const defense = new ClientCombatSimulation();
    defense.addShip(defender);
    defense.projectiles.push(torpedo);
    const event = vi.fn();
    defense.onAudioEvent = event;
    defense.update(1 / 60);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: "laser_intercept" }));
  });

  it("reports a fighter egress transition once rather than on every simulation tick", () => {
    const fighter = ship("strike_craft", 0, -800);
    fighter.turrets[0].cooldownTimer = 100;
    const target = ship("battleship", 1, 1000);
    target.turrets = [];
    const sim = new ClientCombatSimulation();
    sim.addShip(fighter);
    sim.addShip(target);
    const egress = vi.fn();
    sim.onAudioEvent = (event) => {
      if (event.type === "fighter_egress") egress();
    };
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("attack");
    fighter.lastMissionShotTime = sim.timeElapsed;
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("egress");
    for (let i = 0; i < 20; i++) sim.update(1 / 60);
    expect(egress).toHaveBeenCalledOnce();
  });
});
