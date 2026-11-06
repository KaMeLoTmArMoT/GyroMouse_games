import { describe, expect, it } from "vitest";
import { damageState, VisualEffectsManager } from "../src/canvas/effects";
import { acquireMountTarget, inMountArc, mountPosition, sweptHit } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { FLEET_PRESETS } from "../src/engine/fleetPresets";
import {
  ARENA_HARD_PULL_RADIUS,
  ARENA_RADIUS,
  arenaVelocity,
  capitalIntent,
  escortVelocity,
  orbitVelocity,
  safeRally,
  spinalEscape,
} from "../src/engine/flightControl";
import { normalizeAngle, vecDistance, vecDot, vecSub } from "../src/engine/math2d";
import { shieldEnvelopeRadius } from "../src/engine/shieldGeometry";
import { HULL_PROFILES, projectileMaxHp } from "../src/engine/shipProfiles";
import { ClientCombatSimulation } from "../src/engine/simulation";
import type { HullClass, ProjectileState, ShipState, Vector2 } from "../src/types/combat";

function fleet(hulls: HullClass[], team: number, x: number): ShipState[] {
  return buildFleetFromSlots(
    hulls.map((hullClass, i) => ({ id: `${i}`, hullClass, groupId: team + 1 })),
    team,
    x,
    team ? Math.PI : 0,
  );
}

function ship(hull: HullClass, team: number, pos: Vector2): ShipState {
  const result = fleet([hull], team, pos[0])[0];
  result.pos = pos;
  return result;
}

function simulate(ships: ShipState[]): ClientCombatSimulation {
  const sim = new ClientCombatSimulation();
  for (const s of ships) sim.addShip(s);
  return sim;
}

function advance(sim: ClientCombatSimulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.update(1 / 60);
}

function stationary(s: ShipState): ShipState {
  s.maxSpeed = 0;
  s.turnRate = 0;
  s.shieldRegen = 0;
  return s;
}

function projectile(
  owner: ShipState,
  pos: Vector2,
  velocity: Vector2,
  weaponIndex = 0,
): ProjectileState {
  const weapon = owner.turrets[weaponIndex].weapon;
  return {
    id: `shot_${owner.id}`,
    ownerId: owner.id,
    ownerTeam: owner.team,
    weaponType: weapon.weaponType,
    weapon: { ...weapon },
    damage: weapon.damage,
    pos,
    velocity,
    lifetime: 2,
    hp: projectileMaxHp(weapon),
    maxHp: projectileMaxHp(weapon),
    targetId: null,
    isFlakBurst: Boolean(weapon.flak),
  };
}

describe("stalemate horizon and remnant rounds", () => {
  it("declares a draw at 300 seconds, not before, and stops further combat", () => {
    const blue = stationary(ship("cruiser", 0, [-1100, 0]));
    const red = stationary(ship("cruiser", 1, [1100, 0]));
    blue.turrets = red.turrets = [];
    const sim = simulate([blue, red]);
    const victories: number[] = [];
    sim.onVictory = (winner) => victories.push(winner);
    sim.timeElapsed = 299.98;
    sim.update(1 / 60);
    expect(sim.winner).toBeNull();
    sim.update(1 / 60);
    expect(sim.timeElapsed).toBeGreaterThanOrEqual(300);
    expect(sim.winner).toBe(-1);
    expect(sim.winnerDeclaredTime).toBe(300);
    expect(victories).toEqual([-1]);
    const stoppedAt = sim.timeElapsed;
    sim.update(1);
    expect(sim.timeElapsed).toBe(stoppedAt);
    expect(victories).toEqual([-1]);
  });

  it("keeps decisive destruction and an already declared victory ahead of the time limit", () => {
    const blue = ship("cruiser", 0, [-1100, 0]);
    const red = ship("cruiser", 1, [1100, 0]);
    red.isAlive = false;
    const sim = simulate([blue, red]);
    sim.timeElapsed = 300;
    sim.update(1 / 60);
    expect(sim.winner).toBe(0);
    sim.update(1);
    expect(sim.winner).toBe(0);
  });

  it("reforms only survivors at mirrored group spawns without repairing hull or armor", () => {
    const slots = [
      { id: "bb", hullClass: "battleship" as const, groupId: 1 },
      { id: "cr", hullClass: "cruiser" as const, groupId: 1 },
      { id: "cv", hullClass: "corvette" as const, groupId: 1 },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `fighter_${i}`,
        hullClass: "strike_craft" as const,
        groupId: 3,
      })),
    ];
    const ships = [
      ...buildFleetFromSlots(slots, 0, -1100, 0),
      ...buildFleetFromSlots(slots, 1, 1100, Math.PI),
    ];
    ships[0].isAlive = false;
    ships[slots.length].isAlive = false;
    const survivors = ships.filter((s) => s.isAlive);
    const damage = survivors.map((s, i) => {
      s.pos = [i * 10, i * 20];
      s.velocity = [50, -25];
      s.heading = 1.5;
      s.hullCurrent = s.hullMax * 0.37;
      s.armorCurrent = i % 2 === 0 ? 0 : s.armorMax * 0.42;
      s.shieldCurrent = 0;
      s.recoveryStarted = 299;
      s.nextRecoveryAt = 303;
      s.escapeUntil = 310;
      s.navigationTargetId = "old_target";
      s.turrets[0].cooldownTimer = 10;
      s.turrets[0].lastFiredTime = 299;
      return { id: s.id, hull: s.hullCurrent, armor: s.armorCurrent };
    });
    const expected = [0, 1].flatMap((team) =>
      buildFleetFromSlots(
        survivors.filter((s) => s.team === team),
        team,
        team === 0 ? -1100 : 1100,
        team === 0 ? 0 : Math.PI,
      ).map((s) => s.pos),
    );
    const sim = simulate(ships);
    sim.setGroupOrder({ groupId: 3, priority: "capitals", stance: "brawl" });
    sim.timeElapsed = 300;
    sim.winner = -1;
    sim.winnerDeclaredTime = 300;
    sim.projectiles = [projectile(survivors[0], [0, 0], [100, 0])];
    sim.activeBeams = [{ id: "old_beam", from: [0, 0], to: [100, 0], ownerTeam: 0 }];
    sim.stats[0].recentDamageWindow = [{ time: 299, damage: 50 }];
    sim.continueBattleWithRemnants();

    expect(sim.ships).toEqual(survivors);
    expect(sim.ships.map((s) => s.pos)).toEqual(expected);
    expect(
      sim.ships.map((s) => ({ id: s.id, hull: s.hullCurrent, armor: s.armorCurrent })),
    ).toEqual(damage);
    for (const s of sim.ships) {
      expect(s.velocity).toEqual([0, 0]);
      expect(s.heading).toBe(s.team === 0 ? 0 : Math.PI);
      expect(s.shieldCurrent).toBe(s.shieldMax);
      expect(s.recoveryStarted).toBeUndefined();
      expect(s.nextRecoveryAt).toBeUndefined();
      expect(s.escapeUntil).toBeUndefined();
      expect(s.navigationTargetId).toBeUndefined();
      expect(s.turrets[0].cooldownTimer).toBe(0);
      expect(s.turrets[0].lastFiredTime).toBeUndefined();
      if (s.hullClass === "corvette") {
        expect(sim.ships.find((anchor) => anchor.id === s.flagshipId)?.hullClass).toBe("cruiser");
      }
    }
    expect(sim.projectiles).toEqual([]);
    expect(sim.activeBeams).toEqual([]);
    expect(sim.timeElapsed).toBe(0);
    expect(sim.winner).toBeNull();
    expect(sim.winnerDeclaredTime).toBeNull();
    expect(sim.getRollingDPS(0)).toBe(0);
    expect(sim.orders.get(3)?.stance).toBe("brawl");
    sim.update(1 / 60);
    expect(sim.timeElapsed).toBeCloseTo(1 / 60);
    expect(
      sim.ships
        .filter((s) => s.hullClass === "strike_craft")
        .every((s) => s.wingIndex !== undefined),
    ).toBe(true);
  });

  it("clears real beam channels and pending catch-up time before the next round", () => {
    const blue = stationary(ship("cruiser", 0, [0, 0]));
    const red = stationary(ship("battleship", 1, [500, 0]));
    red.turrets = [];
    const sim = simulate([blue, red]);
    sim.update(1 / 60);
    expect(sim.activeBeams).toHaveLength(1);
    sim.timeElapsed = 300;
    sim.update(1);
    expect(sim.winner).toBe(-1);
    sim.continueBattleWithRemnants();
    sim.update(1 / 60);
    expect(sim.timeElapsed).toBeCloseTo(1 / 60);
    expect(sim.activeBeams).toEqual([]);
    expect(red.shieldCurrent).toBe(red.shieldMax);
  });
});

describe("channeled beam lasers", () => {
  function fixture(hull: "cruiser" | "battleship" = "cruiser") {
    const shooter = stationary(ship(hull, 0, [0, 0]));
    shooter.turrets = [shooter.turrets[hull === "cruiser" ? 0 : 1]];
    const target = stationary(ship("battleship", 1, hull === "cruiser" ? [500, 0] : [0, -500]));
    target.turrets = [];
    target.shieldCurrent = target.shieldMax = 10000;
    return { shooter, target, sim: simulate([shooter, target]) };
  }

  it.each(["cruiser", "battleship"] as const)(
    "delivers twelve evenly spaced %s beam ticks over 1.2 seconds",
    (hull) => {
      const { shooter, target, sim } = fixture(hull);
      const weapon = shooter.turrets[0].weapon;
      const events: Array<{ time: number; damage: number }> = [];
      let before = target.shieldCurrent;
      sim.onWeaponImpact = () => {
        events.push({ time: sim.timeElapsed, damage: before - target.shieldCurrent });
        before = target.shieldCurrent;
      };
      sim.update(1 / 60);
      const start = sim.timeElapsed;
      expect(sim.activeBeams).toHaveLength(1);
      expect(target.shieldCurrent).toBe(target.shieldMax);
      advance(sim, 71 / 60);
      expect(events).toHaveLength(11);
      expect(sim.activeBeams).toHaveLength(1);
      sim.update(1 / 60);
      expect(events).toHaveLength(12);
      expect(sim.activeBeams).toHaveLength(0);
      expect(events[0].time - start).toBeCloseTo(0.1);
      expect(events[11].time - start).toBeCloseTo(1.2);
      for (let i = 0; i < events.length; i++) {
        if (i) expect(events[i].time - events[i - 1].time).toBeCloseTo(0.1);
        expect(events[i].damage).toBeCloseTo((weapon.damage * weapon.shieldMultiplier) / 12);
      }
      expect(target.shieldMax - target.shieldCurrent).toBeCloseTo(
        weapon.damage * weapon.shieldMultiplier,
      );
      expect(sim.stats[0].damageDealt).toBe(Math.round(weapon.damage * weapon.shieldMultiplier));
    },
  );

  it.each(["shield", "armor", "hull"] as const)(
    "preserves the full-cycle %s damage and multipliers",
    (layer) => {
      const { shooter, target, sim } = fixture();
      const weapon = shooter.turrets[0].weapon;
      if (layer !== "shield") target.shieldCurrent = 0;
      if (layer === "hull") target.armorCurrent = 0;
      const before = target[`${layer}Current`];
      advance(sim, 73 / 60);
      const multiplier = weapon[`${layer}Multiplier`];
      const mitigation =
        layer === "armor" ? weapon.damage / (weapon.damage + target.armorRating) : 1;
      expect(before - target[`${layer}Current`]).toBeCloseTo(
        weapon.damage * multiplier * mitigation,
      );
    },
  );

  it("tracks both endpoints, cuts off out of arc, and fades the last beam", () => {
    const { shooter, target, sim } = fixture();
    const effects = new VisualEffectsManager();
    sim.update(1 / 60);
    effects.syncBeams(sim.activeBeams);
    const initial = sim.activeBeams[0];
    shooter.pos = [10, 0];
    target.pos = [500, 20];
    sim.update(1 / 60);
    effects.syncBeams(sim.activeBeams);
    expect(sim.activeBeams[0].from[0]).toBeGreaterThan(initial.from[0]);
    expect(sim.activeBeams[0].to[1]).toBeGreaterThan(initial.to[1]);
    expect(vecDistance(sim.activeBeams[0].to, target.pos)).toBeCloseTo(
      shieldEnvelopeRadius(target),
    );
    expect(effects.beams).toHaveLength(1);
    target.pos = [-500, 0];
    sim.update(1 / 60);
    effects.syncBeams(sim.activeBeams);
    expect(sim.activeBeams).toHaveLength(0);
    effects.update(0.08);
    expect(effects.beams[0].remainingDuration).toBeCloseTo(0.08);
    effects.update(0.09);
    expect(effects.beams).toHaveLength(0);
  });

  it("cuts off on target death and does not transfer remaining damage to another target", () => {
    const { shooter, target, sim } = fixture();
    const other = stationary(ship("battleship", 1, [700, 0]));
    other.id = "other";
    other.turrets = [];
    sim.addShip(other);
    sim.update(1 / 60);
    target.isAlive = false;
    advance(sim, 0.5);
    expect(sim.activeBeams).toHaveLength(0);
    expect(other.shieldCurrent).toBe(other.shieldMax);
    expect(shooter.turrets[0].cooldownTimer).toBeGreaterThan(0);
  });

  it.each(["range", "shooter death"] as const)("stops damage immediately on %s", (reason) => {
    const { shooter, target, sim } = fixture();
    sim.update(1 / 60);
    advance(sim, 0.3);
    const damage = target.shieldMax - target.shieldCurrent;
    expect(damage).toBeCloseTo(
      (shooter.turrets[0].weapon.damage * shooter.turrets[0].weapon.shieldMultiplier) / 4,
    );
    if (reason === "range") target.pos = [2000, 0];
    else shooter.isAlive = false;
    advance(sim, 1);
    expect(target.shieldMax - target.shieldCurrent).toBeCloseTo(damage);
    expect(sim.activeBeams).toHaveLength(0);
  });

  it("keeps tick damage deterministic across different render update sizes", () => {
    const { shooter, target } = fixture();
    const ships = [shooter, target];
    const fine = simulate(structuredClone(ships));
    const coarse = simulate(structuredClone(ships));
    advance(fine, 3);
    for (let i = 0; i < 15; i++) coarse.update(0.2);
    expect(coarse.ships).toEqual(fine.ships);
    expect(coarse.activeBeams).toEqual(fine.activeBeams);
    expect(coarse.stats).toEqual(fine.stats);
  });

  it.each(["cruiser", "battleship"] as const)(
    "starts the full %s cooldown only after the channel completes",
    (hull) => {
      const { shooter, sim } = fixture(hull);
      const turret = shooter.turrets[0];
      sim.update(1 / 60);
      expect(turret.cooldownTimer).toBe(0);
      expect(turret.lastFiredTime).toBeUndefined();
      advance(sim, 71 / 60);
      expect(sim.activeBeams).toHaveLength(1);
      expect(turret.cooldownTimer).toBe(0);
      sim.update(1 / 60);
      expect(sim.activeBeams).toHaveLength(0);
      expect(turret.cooldownTimer).toBe(turret.weapon.cooldown);
      expect(turret.lastFiredTime).toBe(sim.timeElapsed);
      advance(sim, turret.weapon.cooldown - 1 / 60);
      expect(sim.activeBeams).toHaveLength(0);
      advance(sim, 2 / 60);
      expect(sim.activeBeams).toHaveLength(1);
    },
  );

  it.each(["arc", "range", "target death", "shooter death"] as const)(
    "starts a full cooldown when a beam terminates early due to %s",
    (reason) => {
      const { shooter, target, sim } = fixture();
      const turret = shooter.turrets[0];
      advance(sim, 0.3);
      if (reason === "arc") target.pos = [-500, 0];
      if (reason === "range") target.pos = [2000, 0];
      if (reason === "target death") target.isAlive = false;
      if (reason === "shooter death") shooter.isAlive = false;
      sim.update(1 / 60);
      expect(sim.activeBeams).toHaveLength(0);
      expect(turret.cooldownTimer).toBe(turret.weapon.cooldown);
      expect(turret.lastFiredTime).toBe(sim.timeElapsed);
      if (reason !== "shooter death") {
        target.pos = [500, 0];
        target.isAlive = true;
        advance(sim, turret.weapon.cooldown - 1 / 60);
        expect(sim.activeBeams).toHaveLength(0);
      }
    },
  );

  it("measures sustained DPS across channel time plus the post-channel cooldown", () => {
    const { shooter, target, sim } = fixture();
    target.shieldCurrent = target.armorCurrent = 0;
    target.hullCurrent = target.hullMax = 1e7;
    advance(sim, 10);
    const before = target.hullCurrent;
    advance(sim, 120);
    const expected = shooter.turrets[0].weapon.damage / (1.2 + shooter.turrets[0].weapon.cooldown);
    expect(Math.abs((before - target.hullCurrent) / 120 / expected - 1)).toBeLessThan(0.03);
  });
});

describe("damage visuals", () => {
  it("preserves faction ownership for beams and simultaneous flak bursts", () => {
    const blue = stationary(ship("cruiser", 0, [-150, 0]));
    const red = stationary(ship("cruiser", 1, [150, 0]));
    const sim = simulate([blue, red]);
    const beamTeams: number[] = [];
    const flakTeams: number[] = [];
    sim.onBeamFire = (_from, _to, _color, _width, team) => beamTeams.push(team);
    sim.onFlakBurst = (_pos, _radius, team) => flakTeams.push(team);
    const blueFlak = projectile(ship("corvette", 0, [-500, 0]), [-1000, 0], [0, 0]);
    const redFlak = projectile(ship("corvette", 1, [500, 0]), [1000, 0], [0, 0]);
    blueFlak.lifetime = redFlak.lifetime = 1 / 60;
    sim.projectiles = [blueFlak, redFlak];
    advance(sim, 0.5);
    expect(new Set(beamTeams)).toEqual(new Set([0, 1]));
    expect(flakTeams).toEqual([0, 1]);
  });

  it("creates faction-colored flak and missile trails that decay", () => {
    const effects = new VisualEffectsManager();
    effects.addFlakBurst([0, 0], 30, 0);
    effects.addFlakBurst([0, 0], 30, 1);
    expect(effects.flakBursts.map((burst) => burst.ownerTeam)).toEqual([0, 1]);
    expect(
      effects.particles.slice(0, 12).every((p) => ["#fb923c", "#facc15"].includes(p.color)),
    ).toBe(true);
    expect(effects.particles.slice(12).every((p) => ["#ef4444", "#f472b6"].includes(p.color))).toBe(
      true,
    );

    const blueMissile = projectile(ship("cruiser", 0, [0, 0]), [0, 0], [100, 0], 1);
    const redMissile = projectile(ship("cruiser", 1, [0, 0]), [0, 0], [-100, 0], 1);
    effects.update(1, [], [blueMissile, redMissile]);
    expect(effects.smokeParticles).toHaveLength(1);
    expect(effects.particles).toHaveLength(1);
    expect(["#a855f7", "#dc2626"]).toContain(effects.particles[0].color);
    effects.update(2);
    expect(effects.smokeParticles).toHaveLength(0);
    expect(effects.particles).toHaveLength(0);
  });

  it("reports shield, armor and spillover impacts with their projectile origin", () => {
    const owner = ship("battleship", 0, [-500, 0]);
    const target = stationary(ship("battleship", 1, [0, 0]));
    target.turrets = [];
    const sim = simulate([target]);
    const impacts: Array<[Vector2, boolean, boolean, boolean]> = [];
    sim.onWeaponImpact = (_ship, origin, shield, armor, hull) =>
      impacts.push([[...origin], shield, armor, hull]);
    const hit = () => {
      sim.projectiles = [projectile(owner, [-60, 0], [320, 0])];
      sim.update(1 / 60);
    };

    hit();
    expect(impacts[0][0][0]).toBeLessThan(0);
    expect(impacts[0].slice(1)).toEqual([true, false, false]);
    target.shieldCurrent = 1;
    hit();
    expect(impacts[1].slice(1)).toEqual([true, true, false]);
    target.shieldCurrent = 0;
    hit();
    expect(impacts[2].slice(1)).toEqual([false, true, false]);
    target.armorCurrent = 1;
    hit();
    expect(impacts[3].slice(1)).toEqual([false, true, true]);
    hit();
    expect(impacts[4].slice(1)).toEqual([false, false, true]);
  });

  it("creates distinct armor and hull effects and retains ship-local impact decals", () => {
    const effects = new VisualEffectsManager();
    const target = ship("cruiser", 0, [100, 200]);
    target.heading = Math.PI / 2;
    effects.addDamageDecal(target, Math.PI / 2);
    expect(effects.impactDecals.get(target)?.[0][0]).toBeCloseTo(target.size * 0.45);
    effects.addImpactSparks([1, 2], 0);
    expect(effects.sparkParticles.length).toBeGreaterThanOrEqual(16);
    expect(effects.smokeParticles).toHaveLength(0);
    effects.addHullImpact([1, 2], 0);
    expect(effects.smokeParticles).toHaveLength(5);
    expect(effects.debrisShards).toHaveLength(5);
    effects.update(3);
    expect(effects.impactDecals.get(target)).toHaveLength(1);
    expect(effects.smokeParticles).toHaveLength(0);
    expect(effects.debrisShards).toHaveLength(0);
  });

  it("honors damage thresholds and bounds active smoke and spark pools", () => {
    const target = stationary(ship("battleship", 0, [0, 0]));
    expect(damageState(target)).toEqual({ scarred: false, burning: false, critical: false });
    const effects = new VisualEffectsManager();
    effects.update(1, [target]);
    expect(effects.smokeParticles).toHaveLength(0);
    expect(effects.sparkParticles).toHaveLength(0);

    target.armorCurrent = target.armorMax * 0.5;
    expect(damageState(target).scarred).toBe(false);
    target.armorCurrent = target.armorMax * 0.49;
    expect(damageState(target).scarred).toBe(true);
    effects.update(1, [target]);
    expect(effects.smokeParticles.length).toBeGreaterThan(0);
    target.shieldCurrent = 0;
    target.armorCurrent = 0;
    target.hullCurrent = target.hullMax * 0.7;
    expect(damageState(target).burning).toBe(false);
    target.hullCurrent = target.hullMax * 0.3;
    expect(damageState(target).critical).toBe(false);
    target.hullCurrent = target.hullMax * 0.2;
    expect(damageState(target)).toEqual({ scarred: true, burning: true, critical: true });
    effects.update(1, Array(500).fill(target));
    expect(effects.smokeParticles).toHaveLength(400);
    expect(effects.sparkParticles).toHaveLength(400);
    target.isAlive = false;
    effects.update(2, [target]);
    expect(effects.smokeParticles).toHaveLength(0);
    expect(effects.sparkParticles).toHaveLength(0);
  });
});

describe("mount eligibility and projectile contracts", () => {
  it("keeps mutable mount and weapon state isolated from sibling ships and canonical profiles", () => {
    const [first, second] = fleet(["corvette", "corvette"], 0, 0);
    const canonical = structuredClone(HULL_PROFILES.corvette);
    const sibling = structuredClone(second.turrets);
    first.turrets[0].offset[0] += 1;
    first.turrets[0].baseArc[0] += 1;
    first.turrets[0].weapon.damage += 1;
    const flak = first.turrets[0].weapon.flak;
    if (!flak) throw new Error("Corvette profile requires flak");
    flak.blastRadius += 1;
    expect(second.turrets).toEqual(sibling);
    expect(HULL_PROFILES.corvette).toEqual(canonical);
  });

  it("fires forward, port, and starboard mounts at independent valid targets", () => {
    const bb = stationary(ship("battleship", 0, [0, 0]));
    const targets = [
      [800, 0],
      [0, -700],
      [0, 700],
    ].map((pos, i) => {
      const s = stationary(ship("battleship", 1, pos as Vector2));
      s.id = `target_${i}`;
      s.turrets = [];
      return s;
    });
    const sim = simulate([bb, ...targets]);
    const beams: Vector2[] = [];
    sim.onBeamFire = (_from, to) => beams.push([...to]);
    advance(sim, 1.3);
    expect(bb.turrets.map((t) => t.currentTargetId)).toEqual(targets.map((s) => s.id));
    expect(beams).toHaveLength(2);
    expect(targets[1].shieldCurrent).toBeLessThan(targets[1].shieldMax);
    expect(targets[2].shieldCurrent).toBeLessThan(targets[2].shieldMax);
    expect(bb.turrets.every((t) => t.lastFiredTime !== undefined)).toBe(true);
  });

  it("does not spend cooldown or report beams outside true muzzle range", () => {
    const cruiser = stationary(ship("cruiser", 0, [0, 0]));
    cruiser.turrets = [cruiser.turrets[0]];
    const rangeEdge =
      mountPosition(cruiser, cruiser.turrets[0])[0] + cruiser.turrets[0].weapon.range;
    const target = stationary(ship("battleship", 1, [rangeEdge + 0.1, 0]));
    target.turrets = [];
    const sim = simulate([cruiser, target]);
    let beams = 0;
    sim.onBeamFire = () => beams++;
    advance(sim, 1);
    expect(beams).toBe(0);
    expect(cruiser.turrets[0].cooldownTimer).toBe(0);
    target.pos = [rangeEdge - 0.1, 0];
    sim.update(1 / 60);
    expect(beams).toBe(1);
  });

  it("tracks through the allowed cruiser arc instead of crossing its rear exclusion", () => {
    const cruiser = stationary(ship("cruiser", 0, [0, 0]));
    cruiser.turrets = [cruiser.turrets[0]];
    cruiser.turrets[0].currentLocalAngle = (-125 * Math.PI) / 180;
    const bearing = (125 * Math.PI) / 180;
    const target = stationary(
      ship("battleship", 1, [8 + 600 * Math.cos(bearing), 600 * Math.sin(bearing)]),
    );
    target.turrets = [];
    simulate([cruiser, target]).update(1 / 60);
    expect(cruiser.turrets[0].currentLocalAngle).toBeGreaterThan((-125 * Math.PI) / 180);
  });

  it("prioritizes incoming live missiles, leads them, and applies the mount arc", () => {
    const cv = ship("corvette", 0, [0, 0]);
    const enemy = ship("cruiser", 1, [250, 0]);
    const inbound = projectile(enemy, [200, 30], [-320, -40], 1);
    const solution = acquireMountTarget(cv, cv.turrets[0], enemy, [cv, enemy], [inbound]);
    expect(solution?.kind).toBe("missile");
    expect(solution?.aim[0]).toBeLessThan(200);
    inbound.hp = 0;
    expect(acquireMountTarget(cv, cv.turrets[0], enemy, [cv, enemy], [inbound])?.kind).toBe("ship");
    cv.turrets[0].baseArc = [-Math.PI, -Math.PI / 2];
    inbound.hp = inbound.maxHp;
    expect(acquireMountTarget(cv, cv.turrets[0], enemy, [cv, enemy], [inbound])).toBeNull();
  });

  it("gently steers live torpedoes towards their target within the seeker cone", () => {
    const owner = ship("cruiser", 0, [0, 0]);
    const enemy = stationary(ship("battleship", 1, [300, 60]));
    const missile = projectile(owner, [0, 0], [200, 0], 1);
    missile.targetId = enemy.id;
    const sim = simulate([owner, enemy]);
    sim.projectiles = [missile];
    sim.update(0.5);
    expect(missile.velocity[1]).toBeGreaterThan(0);

    // Should not turn backwards if target is behind the seeker cone
    const behind = stationary(ship("battleship", 1, [-300, 0]));
    behind.id = "behind";
    missile.targetId = behind.id;
    sim.ships.push(behind);
    sim.update(0.1);
    expect(missile.velocity[0]).toBeGreaterThan(0);
  });

  it.each([
    {
      label: "heavy torpedo",
      fuelDuration: HULL_PROFILES.cruiser.turrets[1].weapon.fuelDuration,
      expected: 8,
    },
    { label: "light missile", fuelDuration: 5, expected: 5 },
    { label: "unconfigured missile", fuelDuration: undefined, expected: 5 },
  ])("expires a missed $label exactly at its fuel limit", ({ fuelDuration, expected }) => {
    const owner = stationary(ship("cruiser", 0, [0, 0]));
    const launcher = owner.turrets[1];
    launcher.weapon.fuelDuration = fuelDuration;
    owner.turrets = [launcher];
    const target = stationary(ship("battleship", 1, [1200, 0]));
    target.turrets = [];
    const sim = simulate([owner, target]);
    let initialLifetime = 0;
    sim.onProjectileFire = () => {
      initialLifetime = sim.projectiles[0].lifetime;
    };
    sim.update(1 / 60);
    expect(initialLifetime).toBe(expected);
    const missile = sim.projectiles[0];
    expect(missile.lifetime).toBeCloseTo(expected - 1 / 60);
    // Evade outside the seeker cone and disable further launches.
    target.pos = [0, 1000];
    owner.turrets = [];
    advance(sim, expected - 2 / 60);
    expect(sim.projectiles).toEqual([missile]);
    expect(missile.lifetime).toBeCloseTo(1 / 60);
    sim.update(1 / 60);
    expect(sim.projectiles).toEqual([]);
    expect(missile.lifetime).toBeCloseTo(0);
    const finalPosition = [...missile.pos];
    advance(sim, 180);
    expect(sim.projectiles).toEqual([]);
    expect(missile.pos).toEqual(finalPosition);
    expect(target.shieldCurrent).toBe(target.shieldMax);
    expect(sim.stats[0].missilesIntercepted).toBe(0);
  });

  it("clips the final missile movement to fuel remaining rather than hitting after expiry", () => {
    const owner = ship("cruiser", 0, [-500, 0]);
    const target = stationary(ship("battleship", 1, [0, 0]));
    target.turrets = [];
    const missile = projectile(owner, [-80, 0], [1200, 0], 1);
    missile.lifetime = 1 / 120;
    const sim = simulate([target]);
    sim.projectiles = [missile];
    sim.update(1 / 60);
    expect(missile.pos).toEqual([-70, 0]);
    expect(missile.lifetime).toBe(0);
    expect(sim.projectiles).toEqual([]);
    expect(target.shieldCurrent).toBe(target.shieldMax);
  });

  it("rejects intercepts beyond missile fuel while allowing the longer heavy torpedo burn", () => {
    const owner = ship("cruiser", 0, [0, 0]);
    const launcher = owner.turrets[1];
    const target = ship("battleship", 1, [1216, 0]);
    target.velocity = [100, 0];
    launcher.weapon.fuelDuration = 5;
    expect(acquireMountTarget(owner, launcher, target, [owner, target], [])).toBeNull();
    launcher.weapon.fuelDuration = 8;
    expect(acquireMountTarget(owner, launcher, target, [owner, target], [])?.target).toBe(target);
  });

  it("sweeps rails through small targets and selects the first hit", () => {
    const owner = ship("battleship", 0, [-500, 0]);
    const near = stationary(ship("strike_craft", 1, [0, 0]));
    const far = stationary(ship("strike_craft", 1, [80, 0]));
    far.id = "far";
    near.turrets = [];
    far.turrets = [];
    const sim = simulate([far, near]);
    sim.projectiles = [projectile(owner, [-100, 0], [18000, 0])];
    sim.update(1 / 60);
    expect(near.shieldCurrent).toBe(0);
    expect(far.shieldCurrent).toBe(far.shieldMax);
    expect(sim.projectiles).toHaveLength(0);
    expect(sweptHit([-20, 0], [20, 0], 5)).toBeCloseTo(0.375);
  });

  it("preserves the torpedo hull multiplier at impact", () => {
    const owner = ship("cruiser", 0, [-500, 0]);
    const target = stationary(ship("battleship", 1, [0, 0]));
    target.shieldCurrent = 0;
    target.armorCurrent = 0;
    target.turrets = [];
    const sim = simulate([target]);
    sim.projectiles = [projectile(owner, [-60, 0], [320, 0], 1)];
    sim.update(1 / 60);
    const torpedo = HULL_PROFILES.cruiser.turrets[1].weapon;
    expect(target.hullMax - target.hullCurrent).toBeCloseTo(
      torpedo.damage * torpedo.hullMultiplier,
    );
  });

  it("uses a full-damage flak core and linear surface falloff, with an accurate event radius", () => {
    const owner = ship("corvette", 0, [-500, 0]);
    const flak = HULL_PROFILES.corvette.turrets[0].weapon.flak;
    if (!flak) throw new Error("Corvette profile requires flak");
    const targets = [
      flak.triggerRadius,
      (flak.triggerRadius + flak.blastRadius) / 2,
      flak.blastRadius,
    ].map((surface, i) => {
      const target = stationary(ship("strike_craft", 1, [0, 0]));
      target.pos[0] = target.size + surface;
      target.id = `flak_target_${i}`;
      target.turrets = [];
      return target;
    });
    // Separate runs avoid hull separation changing the intended surface distances.
    const damage = targets.map((target) => {
      const sim = simulate([target]);
      const shell = projectile(owner, [0, 0], [0, 0]);
      shell.lifetime = 1 / 60;
      sim.projectiles = [shell];
      let radius = 0;
      sim.onFlakBurst = (_pos, r) => {
        radius = r;
      };
      sim.update(1 / 60);
      expect(radius).toBe(flak.blastRadius);
      return target.shieldMax - target.shieldCurrent;
    });
    const damagePerBurst = HULL_PROFILES.corvette.turrets[0].weapon.damage;
    expect(damage).toEqual([damagePerBurst, damagePerBurst / 2, 0]);
  });

  it("takes two 18-damage flak bursts to intercept a light missile and reports the kill only once", () => {
    const owner = ship("corvette", 0, [-500, 0]);
    const enemy = ship("cruiser", 1, [500, 0]);
    const missile = projectile(enemy, [0, 0], [0, 0], 1);
    missile.hp = missile.maxHp = 25;
    missile.weapon.projectileHp = 25;
    missile.id = "proj_1";
    const sim = simulate([]);
    const burst = (id: string) => ({ ...projectile(owner, [0, 0], [0, 0]), id });
    sim.projectiles = [missile, burst("a")];
    sim.update(1 / 60);
    expect(missile.hp).toBe(
      25 - (HULL_PROFILES.corvette.turrets[0].weapon.flak?.missileDamage ?? 0),
    );
    sim.projectiles.push(burst("b"), burst("c"));
    sim.update(1 / 60);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
  });

  it("lets about 10% of missiles survive repeated flak bursts deterministically", () => {
    const owner = ship("corvette", 0, [-500, 0]);
    const enemy = ship("cruiser", 1, [500, 0]);
    const run = () => {
      const sim = simulate([]);
      const missiles = Array.from({ length: 1000 }, (_, i) => ({
        ...projectile(enemy, [0, 0], [0, 0], 1),
        id: `proj_${i + 1}`,
        hp: 25,
        maxHp: 25,
        weapon: { ...enemy.turrets[1].weapon, projectileHp: 25 },
      }));
      const friendly = { ...projectile(owner, [0, 0], [0, 0]), weaponType: "missile" as const };
      const outside = { ...missiles[0], id: "outside", pos: [100, 0] as Vector2 };
      sim.projectiles = [...missiles, friendly, outside];
      for (let i = 0; i < 5; i++) {
        sim.projectiles.push({ ...projectile(owner, [0, 0], [0, 0]), id: `burst_${i}` });
        sim.update(1 / 60);
      }
      const survivors = missiles.filter((missile) => missile.hp > 0);
      expect(survivors.length).toBeGreaterThanOrEqual(70);
      expect(survivors.length).toBeLessThanOrEqual(130);
      expect(survivors.every((missile) => missile.hp === 25)).toBe(true);
      expect(sim.stats[0].missilesIntercepted).toBe(1000 - survivors.length);
      expect(friendly.hp).toBe(25);
      expect(outside.hp).toBe(25);
      return survivors.map((missile) => missile.id);
    };
    expect(run()).toEqual(run());
  });

  it("gives a fresh fighter a multi-second survival window against one corvette", () => {
    const cv = stationary(ship("corvette", 0, [0, 0]));
    const target = stationary(ship("strike_craft", 1, [200, 0]));
    target.turrets = [];
    const sim = simulate([cv, target]);
    let firstHit: number | undefined;
    while (target.isAlive && sim.timeElapsed < 10) {
      sim.update(1 / 60);
      if (target.shieldCurrent < target.shieldMax && firstHit === undefined)
        firstHit = sim.timeElapsed;
    }
    expect(target.isAlive).toBe(false);
    expect(firstHit).toBeDefined();
    const survival = sim.timeElapsed - (firstHit ?? 0);
    expect(survival).toBeGreaterThan(2.5);
    expect(survival).toBeLessThan(4);
  });
});

describe("tactical maneuvers", () => {
  it("lets every fighter phase defend itself while reserving capital fire for attack", () => {
    const fighter = ship("strike_craft", 0, [0, 0]);
    const enemy = ship("strike_craft", 1, [300, 0]);
    const capital = ship("battleship", 1, [400, 0]);
    for (const phase of [
      "staging",
      "attack",
      "egress",
      "rejoin",
      "intercept",
      "recover",
    ] as const) {
      fighter.fighterPhase = phase;
      expect(
        acquireMountTarget(fighter, fighter.turrets[0], capital, [fighter, enemy, capital], [])
          ?.target.id,
      ).toBe(enemy.id);
      expect(
        Boolean(acquireMountTarget(fighter, fighter.turrets[0], capital, [fighter, capital], [])),
      ).toBe(phase === "attack");
    }
  });

  it("interrupts a capital mission to dogfight without counting the defensive shot as mission completion", () => {
    const fighter = ship("strike_craft", 0, [0, 0]);
    const enemy = ship("strike_craft", 1, [300, 0]);
    const capital = ship("battleship", 1, [1200, 0]);
    const sim = simulate([fighter, enemy, capital]);
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("intercept");
    expect(fighter.dogfightTargetId).toBe(enemy.id);
    expect(fighter.turrets[0].lastFiredTime).toBeDefined();
    expect(fighter.lastMissionShotTime).toBeUndefined();
  });

  it("launches the opening wave directly despite an unreachable rally and cooling weapons", () => {
    const fighters = fleet(Array<HullClass>(4).fill("strike_craft"), 0, -800);
    for (const f of fighters) {
      stationary(f);
      f.turrets[0].cooldownTimer = 10;
    }
    const enemy = stationary(ship("battleship", 1, [1000, 0]));
    enemy.turrets = [];
    const sim = simulate([...fighters, enemy]);
    sim.update(1 / 60);
    expect(fighters.every((f) => f.fighterPhase === "attack")).toBe(true);
  });

  it.each([10, 12])("launches %i craft as three bounded echelons 102 frames apart", (count) => {
    for (const team of [0, 1]) {
      const fighters = fleet(Array<HullClass>(count).fill("strike_craft"), team, team ? 800 : -800);
      for (const fighter of fighters) {
        stationary(fighter);
        fighter.turrets[0].cooldownTimer = 20;
      }
      const target = stationary(ship("battleship", 1 - team, [team ? -1000 : 1000, 0]));
      target.turrets = [];
      const sim = simulate([...fighters, target]);
      const launches = new Map<number, number>();
      for (let frame = 0; frame <= 204; frame++) {
        sim.update(1 / 60);
        for (const fighter of fighters) {
          const index = fighter.wingIndex ?? -1;
          if (fighter.fighterPhase === "attack" && !launches.has(index)) launches.set(index, frame);
        }
        expect(fighters.filter((fighter) => fighter.fighterPhase === "attack")).toHaveLength(
          frame < 102 ? 4 : frame < 204 ? (count === 10 ? 7 : 8) : count,
        );
      }
      expect([...launches.values()]).toEqual([0, 102, 204]);
      expect(
        [...launches.keys()].map(
          (index) => fighters.filter((fighter) => fighter.wingIndex === index).length,
        ),
      ).toEqual(count === 10 ? [4, 3, 3] : [4, 4, 4]);
      expect(fighters.every((fighter) => fighter.navigationTargetId === target.id)).toBe(true);
    }
  });

  it("keeps independent echelons staggered when they complete and rejoin on the same frame", () => {
    const fighters = fleet(Array<HullClass>(10).fill("strike_craft"), 0, -800);
    for (const fighter of fighters) {
      stationary(fighter);
      fighter.turrets[0].cooldownTimer = 100;
    }
    const target = stationary(ship("battleship", 1, [1000, 0]));
    target.turrets = [];
    const sim = simulate([...fighters, target]);
    advance(sim, 205 / 60);
    expect(fighters.every((fighter) => fighter.fighterPhase === "attack")).toBe(true);
    for (const fighter of fighters) fighter.lastMissionShotTime = sim.timeElapsed;
    sim.update(1 / 60);
    expect(fighters.every((fighter) => fighter.fighterPhase === "egress")).toBe(true);
    const launches = new Map<number, number>();
    for (let frame = 0; frame < 60 * 12 && launches.size < 3; frame++) {
      sim.update(1 / 60);
      for (const fighter of fighters) {
        const index = fighter.wingIndex ?? -1;
        if (fighter.fighterPhase === "attack" && !launches.has(index)) launches.set(index, frame);
      }
    }
    const frames = [...launches.values()];
    expect(frames).toHaveLength(3);
    expect(frames[1] - frames[0]).toBe(102);
    expect(frames[2] - frames[1]).toBe(102);
  });

  it("keeps distant ingress outside the six-second engagement timeout", () => {
    const fighter = stationary(ship("strike_craft", 0, [-1100, 0]));
    fighter.turrets[0].cooldownTimer = 20;
    const target = stationary(ship("cruiser", 1, [1100, 0]));
    target.turrets = [];
    const sim = simulate([fighter, target]);
    advance(sim, 12);
    expect(fighter.fighterPhase).toBe("attack");
    expect(fighter.lastMissionShotTime).toBeUndefined();
    fighter.pos = [600, 0];
    advance(sim, 6.1);
    expect(fighter.fighterPhase).toBe("egress");
  });

  it.each([0, 1])(
    "delivers all 30 first-pass payloads with short-range nose guns on team %i",
    (team) => {
      const fighters = buildFleetFromSlots(
        Array.from({ length: 30 }, (_, i) => ({
          id: `${i}`,
          hullClass: "strike_craft" as const,
          groupId: Math.floor(i / 10) + 1,
        })),
        team,
        team ? 1100 : -1100,
        team ? Math.PI : 0,
      );
      for (const fighter of fighters) {
        fighter.maxSpeed = 220;
        fighter.turrets[0].weapon.range = 180;
        fighter.turrets[0].baseArc = [(-27 * Math.PI) / 180, (27 * Math.PI) / 180];
      }
      const targets = [-450, 0, 450].map((y, i) => {
        const target = stationary(ship("cruiser", 1 - team, [team ? -600 : 600, y]));
        target.id = `target_${i}`;
        target.turrets = [];
        target.shieldCurrent = target.shieldMax = 1e6;
        return target;
      });
      const sim = simulate([...fighters, ...targets]);
      const missed = new Set<string>();
      for (let tick = 0; tick < 60 * 20; tick++) {
        sim.update(1 / 60);
        for (const fighter of fighters)
          if (fighter.fighterPhase === "egress" && fighter.lastMissionShotTime === undefined)
            missed.add(fighter.id);
        if (fighters.every((fighter) => fighter.lastMissionShotTime !== undefined)) break;
      }
      expect([...missed]).toEqual([]);
      expect(fighters.filter((fighter) => fighter.lastMissionShotTime !== undefined)).toHaveLength(
        30,
      );
    },
    15000,
  );

  it("resumes fighting after bounded hull-driven recovery", () => {
    const fighter = ship("strike_craft", 0, [0, 0]);
    fighter.hullCurrent = 20;
    const enemy = stationary(ship("strike_craft", 1, [300, 0]));
    enemy.turrets = [];
    enemy.shieldCurrent = enemy.shieldMax = 10000;
    fighter.maxSpeed = 0;
    const sim = simulate([fighter, enemy]);
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("recover");
    advance(sim, 4.1);
    expect(fighter.fighterPhase).toBe("intercept");
  });

  it("keeps the whole staging footprint outside hostile PD", () => {
    const target = ship("battleship", 1, [800, 0]);
    const cv = ship("corvette", 1, [540, 0]);
    const fighters = fleet(Array<HullClass>(6).fill("strike_craft"), 0, -800);
    fighters.forEach((s, i) => {
      s.wingSlot = i - 2.5;
    });
    const rally = safeRally(target, 0, fighters, [target, cv], 520);
    for (const fighter of fighters) {
      const slot: Vector2 = [
        rally[0] - Math.abs(fighter.wingSlot ?? 0) * 30,
        rally[1] + (fighter.wingSlot ?? 0) * 50,
      ];
      for (const turret of cv.turrets)
        expect(vecDistance(slot, mountPosition(cv, turret))).toBeGreaterThan(
          turret.weapon.range + 80,
        );
    }
  });

  it.each([1, 3])(
    "resolves a skirmish with %i fighters per team without staging deadlock",
    (count) => {
      const hulls = Array<HullClass>(count).fill("strike_craft");
      const ships = [...fleet(hulls, 0, -500), ...fleet(hulls, 1, 500)];
      const sim = simulate(ships);
      advance(sim, 60);
      expect(ships.some((s) => !s.isAlive)).toBe(true);
      expect(ships.every((s) => !s.isAlive || s.turrets[0].lastFiredTime !== undefined)).toBe(true);
    },
  );

  it("allows corvette-only mission targets to be attacked", () => {
    const fighter = ship("strike_craft", 0, [0, 0]);
    const enemy = stationary(ship("corvette", 1, [650, 0]));
    enemy.turrets = [];
    const sim = simulate([fighter, enemy]);
    advance(sim, 12);
    expect(fighter.lastMissionShotTime).toBeDefined();
    expect(enemy.shieldCurrent).toBeLessThan(enemy.shieldMax);
  });

  it("uses radial correction around a 300u ring and one stable chirality", () => {
    const cv = ship("corvette", 0, [0, 0]);
    const enemy = ship("corvette", 1, [300, 0]);
    expect(orbitVelocity(cv, enemy)[0]).toBe(0);
    expect(orbitVelocity(cv, enemy)[1]).toBeGreaterThan(0);
    expect(orbitVelocity(enemy, cv)[1]).toBeLessThan(0);
    enemy.pos = [100, 0];
    expect(orbitVelocity(cv, enemy)[0]).toBeLessThan(0);
    enemy.pos = [600, 0];
    expect(orbitVelocity(cv, enemy)[0]).toBeGreaterThan(0);
  });

  it("sustains 3v3 corvette angular motion without hostile clinching", () => {
    const ships = [
      ...fleet(["corvette", "corvette", "corvette"], 0, -220),
      ...fleet(["corvette", "corvette", "corvette"], 1, 220),
    ];
    ships.forEach((s) => {
      s.turrets = [];
    });
    const sim = simulate(ships);
    let angularMotion = 0;
    let contacts = 0;
    let minimum = Infinity;
    for (let i = 0; i < 1200; i++) {
      sim.update(1 / 60);
      if (i < 300) continue;
      for (const s of ships.filter((s) => s.team === 0)) {
        const enemy = ships
          .filter((e) => e.team !== s.team)
          .sort((a, b) => vecDistance(s.pos, a.pos) - vecDistance(s.pos, b.pos))[0];
        const r = vecSub(enemy.pos, s.pos);
        const d = vecDistance(s.pos, enemy.pos);
        minimum = Math.min(minimum, d);
        if (d < (s.size + enemy.size) * 1.4 + 1) contacts++;
        angularMotion +=
          Math.abs(r[0] * s.velocity[1] - r[1] * s.velocity[0]) / Math.max(1, d * d) / 60;
      }
    }
    expect(contacts).toBe(0);
    expect(minimum).toBeGreaterThan(100);
    expect(minimum).toBeLessThan(400);
    expect(angularMotion).toBeGreaterThan(2);
  });

  it("assigns cruiser escorts and reassigns when their anchor dies", () => {
    const ships = fleet(["cruiser", "cruiser", "corvette", "corvette"], 0, -800);
    const escorts = ships.filter((s) => s.hullClass === "corvette");
    expect(new Set(escorts.map((s) => s.flagshipId)).size).toBe(2);
    ships[0].isAlive = false;
    escortVelocity(escorts[0], null, ships);
    expect(escorts[0].flagshipId).toBe(ships[1].id);
  });

  it("sorties to a 550u screen at grand-scale range and falls back below 40% shields", () => {
    const anchor = ship("battleship", 0, [0, 0]);
    const cv = ship("corvette", 0, [0, 0]);
    cv.flagshipId = anchor.id;
    const enemy = ship("battleship", 1, [1600, 0]);
    const ships = [anchor, cv, enemy];
    const outward = escortVelocity(cv, enemy, ships);
    const screen: Vector2 = [outward[0] / 0.6, outward[1] / 0.6];
    expect(vecDistance([0, 0], screen)).toBeCloseTo(550);
    expect(screen[0]).toBeGreaterThan(450);
    expect(Math.abs(screen[1])).toBeGreaterThan(200);
    cv.pos = screen;
    expect(vecDistance([0, 0], escortVelocity(cv, enemy, ships))).toBeCloseTo(0);
    const fighter = ship("strike_craft", 1, [850, screen[1]]);
    const engagement = escortVelocity(cv, fighter, [...ships, fighter]);
    expect(vecDistance([0, 0], engagement)).toBeGreaterThan(0);
    cv.pos = [650, 0];
    expect(escortVelocity(cv, fighter, [...ships, fighter])[0]).toBeLessThan(0);
    cv.pos = screen;
    cv.shieldCurrent = cv.shieldMax * 0.39;
    const fallback = escortVelocity(cv, fighter, [...ships, fighter]);
    expect(vecDot(fallback, screen)).toBeLessThan(0);
    expect(fallback).toEqual(escortVelocity(cv, null, ships));
    cv.shieldCurrent = cv.shieldMax * 0.55;
    cv.pos = [0, 0];
    const recovering = escortVelocity(cv, null, ships);
    expect(vecDistance([0, 0], recovering)).toBeLessThan(vecDistance([0, 0], outward));
    cv.shieldCurrent = cv.shieldMax * 0.71;
    expect(escortVelocity(cv, null, ships)).toEqual(outward);
  });

  it("escapes ready spinal cones and in-flight rails during reload", () => {
    const cv = ship("corvette", 0, [600, 0]);
    const bb = ship("battleship", 1, [0, 0]);
    bb.heading = 0;
    const ready = spinalEscape(cv, [cv, bb], [], 1);
    expect(Math.abs(ready[1])).toBeGreaterThan(cv.maxSpeed);
    bb.turrets[0].cooldownTimer = HULL_PROFILES.battleship.turrets[0].weapon.cooldown;
    expect(spinalEscape(cv, [cv, bb], [], 1.1)).toEqual([0, 0]);
    const rail = projectile(
      bb,
      [300, 0],
      [HULL_PROFILES.battleship.turrets[0].weapon.projectileSpeed, 0],
    );
    expect(Math.abs(spinalEscape(cv, [cv, bb], [rail], 1.2)[1])).toBeGreaterThan(cv.maxSpeed);
  });

  it("repeatedly fires rails and broadsides with stable shallow weaving", () => {
    const bb = ship("battleship", 0, [0, 0]);
    const target = stationary(ship("battleship", 1, [840, 0]));
    target.turrets = [];
    target.shieldCurrent = target.shieldMax = 1e6;
    const sim = simulate([bb, target]);
    let rails = 0;
    let beams = 0;
    let maxOffset = 0;
    const railTimes: number[] = [];
    sim.onProjectileFire = (type) => {
      if (type === "railgun") {
        rails++;
        railTimes.push(sim.timeElapsed);
      }
    };
    sim.onBeamFire = () => beams++;
    for (let i = 0; i < 1200; i++) {
      sim.update(1 / 60);
      const r = vecSub(target.pos, bb.pos);
      maxOffset = Math.max(
        maxOffset,
        Math.abs(normalizeAngle(Math.atan2(r[1], r[0]) - bb.heading)),
      );
    }
    expect(rails).toBeGreaterThanOrEqual(5);
    expect(beams).toBeGreaterThanOrEqual(4);
    expect(
      bb.turrets
        .filter((t) => t.weapon.weaponType === "beam_laser")
        .every((t) => t.lastFiredTime !== undefined),
    ).toBe(true);
    expect(maxOffset).toBeLessThan((51 * Math.PI) / 180);
    expect(maxOffset).toBeGreaterThan((44 * Math.PI) / 180);
    expect(Math.max(...railTimes.slice(1).map((t, i) => t - railTimes[i]))).toBeLessThan(3.7);
  });

  it("keeps cruiser torpedoes active during oblique transits", () => {
    const cruiser = ship("cruiser", 0, [0, 0]);
    const target = stationary(ship("battleship", 1, [740, 0]));
    target.turrets = [];
    const sim = simulate([cruiser, target]);
    let torpedoes = 0;
    let beams = 0;
    sim.onProjectileFire = (type) => {
      if (type === "missile") torpedoes++;
    };
    sim.onBeamFire = () => beams++;
    advance(sim, 18);
    expect(torpedoes).toBeGreaterThanOrEqual(4);
    expect(beams).toBeGreaterThan(5);
    expect(Math.abs(cruiser.pos[1])).toBeGreaterThan(40);
  });

  it.each(["battleship", "cruiser"] as const)(
    "uses both weapon roles across a three-%s line",
    (hull) => {
      const hulls = Array<HullClass>(3).fill(hull);
      const ships = [...fleet(hulls, 0, -800), ...fleet(hulls, 1, 800)];
      const sim = simulate(ships);
      const fired = new Set<string>();
      for (let i = 0; i < 2700; i++) {
        sim.update(1 / 60);
        for (const s of ships)
          for (const turret of s.turrets)
            if (turret.lastFiredTime !== undefined) fired.add(turret.id);
      }
      for (const s of ships) {
        const main = s.turrets.find((t) => t.isSpinalGimbal || t.weapon.weaponType === "missile");
        expect(fired.has(main?.id ?? "")).toBe(true);
        expect(
          s.turrets.some((t) => t.weapon.weaponType === "beam_laser" && fired.has(t.id)),
          JSON.stringify({
            id: s.id,
            pos: s.pos,
            heading: s.heading,
            maneuver: s.capitalManeuver,
            target: s.maneuverTargetId,
            mounts: s.turrets.map((t) => ({
              id: t.id,
              target: t.currentTargetId,
              fired: t.lastFiredTime,
            })),
          }),
        ).toBe(true);
        if (hull === "battleship")
          expect(
            s.turrets
              .filter((t) => t.weapon.weaponType === "beam_laser")
              .every((t) => fired.has(t.id)),
          ).toBe(true);
        expect(s.pos.every(Number.isFinite)).toBe(true);
      }
      if (hull === "battleship") {
        const line = ships.filter((s) => s.team === 0);
        expect(
          Math.max(...line.map((s) => s.pos[0])) - Math.min(...line.map((s) => s.pos[0])),
        ).toBeGreaterThan(15);
      }
    },
  );

  it("keeps opposing battleship screens out of sustained contact", () => {
    const hulls: HullClass[] = ["battleship", "corvette", "corvette", "corvette"];
    const ships = [...fleet(hulls, 0, -800), ...fleet(hulls, 1, 800)];
    const sim = simulate(ships);
    let maxContact = 0;
    let contact = 0;
    for (let i = 0; i < 1800; i++) {
      sim.update(1 / 60);
      const escorts = ships.filter((s) => s.isAlive && s.hullClass === "corvette");
      const clinched = escorts.some((a) =>
        escorts.some(
          (b) => a.team !== b.team && vecDistance(a.pos, b.pos) < (a.size + b.size) * 1.4 + 1,
        ),
      );
      contact = clinched ? contact + 1 / 60 : 0;
      maxContact = Math.max(maxContact, contact);
    }
    expect(maxContact).toBeLessThan(0.5);
  });

  it("distinguishes brawl from max-range stances", () => {
    const bb = ship("battleship", 0, [0, 0]);
    const target = ship("battleship", 1, [900, 0]);
    const brawl = capitalIntent(bb, target, [bb, target], {
      groupId: 1,
      priority: "capitals",
      stance: "brawl",
    });
    const max = capitalIntent(bb, target, [bb, target], {
      groupId: 1,
      priority: "capitals",
      stance: "max_range",
    });
    expect(vecDot(brawl.velocity, [1, 0])).toBeGreaterThan(0);
    expect(vecDot(max.velocity, [1, 0])).toBeLessThan(0);
    expect(inMountArc(bb, bb.turrets[0], target.pos)).toBe(true);
  });
});

describe("arena containment and matchup rebalance", () => {
  it("smoothly bends outward thrust inward and preserves tangential travel", () => {
    const cruiser = ship("cruiser", 0, [ARENA_RADIUS, 0]);
    expect(arenaVelocity(cruiser, [50, 25])).toEqual([50, 25]);
    cruiser.pos[0] = (ARENA_RADIUS + ARENA_HARD_PULL_RADIUS) / 2;
    const soft = arenaVelocity(cruiser, [50, 25]);
    expect(soft[0]).toBeLessThan(0);
    expect(soft[1]).toBe(25);
    cruiser.pos[0] = ARENA_HARD_PULL_RADIUS;
    expect(arenaVelocity(cruiser, [50, 25])[0]).toBeLessThan(soft[0]);
  });

  it.each(["strike_craft", "corvette", "cruiser", "battleship"] as const)(
    "returns an outward-moving %s from beyond the hard pull radius without teleporting",
    (hull) => {
      const start: Vector2 = [ARENA_HARD_PULL_RADIUS + 10, 0];
      const s = ship(hull, 0, [...start]);
      s.velocity = [s.maxSpeed, 0];
      const sim = simulate([s]);
      sim.update(1 / 60);
      expect(vecDistance(s.pos, start)).toBeLessThanOrEqual(s.maxSpeed / 60 + 1e-6);
      advance(sim, 12);
      expect(vecDistance(s.pos, [0, 0])).toBeLessThan(ARENA_HARD_PULL_RADIUS);
    },
  );

  it.each([
    [12, 12],
    [3, 20],
  ])(
    "contains the %i vs %i fleet playtest",
    (blue, red) => {
      const ships = [
        ...fleet(Array<HullClass>(blue).fill(blue === 3 ? "cruiser" : "strike_craft"), 0, -800),
        ...fleet(Array<HullClass>(red).fill("strike_craft"), 1, 800),
      ];
      const sim = simulate(ships);
      let furthest = 0;
      for (let i = 0; i < 60 * 120 && sim.winner === null; i++) {
        sim.update(1 / 60);
        for (const s of ships.filter((s) => s.isAlive))
          furthest = Math.max(furthest, vecDistance(s.pos, [0, 0]));
      }
      expect(furthest).toBeLessThan(ARENA_HARD_PULL_RADIUS + 100);
    },
    60000,
  );

  it("finishes nearby damaged enemies, shares focus in threes, and ignores distant wounded bait", () => {
    const allies = fleet(Array<HullClass>(6).fill("corvette"), 0, 0);
    allies.forEach((s, i) => {
      stationary(s);
      s.pos = [0, (i - 2.5) * 78];
    });
    const enemies = fleet(Array<HullClass>(3).fill("corvette"), 1, 300);
    enemies.forEach((s, i) => {
      stationary(s);
      s.pos = [300, (i - 1) * 100];
      s.turrets = [];
    });
    enemies[1].shieldCurrent = 0;
    enemies[2].pos = [2500, 0];
    enemies[2].shieldCurrent = enemies[2].armorCurrent = 0;
    enemies[2].hullCurrent = 1;
    const sim = simulate([...allies, ...enemies]);
    sim.update(1 / 60);
    expect(allies.filter((s) => s.navigationTargetId === enemies[1].id)).toHaveLength(3);
    expect(allies.filter((s) => s.navigationTargetId === enemies[0].id)).toHaveLength(3);
    expect(allies.every((s) => s.navigationTargetId !== enemies[2].id)).toBe(true);
    const shooter = allies[2];
    enemies[1].armorCurrent = 0;
    enemies[1].hullCurrent = 20;
    expect(
      acquireMountTarget(shooter, shooter.turrets[0], enemies[0], sim.ships, [])?.target.id,
    ).toBe(enemies[1].id);
  });

  it("uses idle broadside beams to finish damaged incoming torpedoes exactly once", () => {
    const bb = stationary(ship("battleship", 0, [0, 0]));
    const enemy = ship("cruiser", 1, [1400, 0]);
    const missile = projectile(enemy, [0, -300], [0, 320], 1);
    missile.hp = 25;
    const sim = simulate([bb]);
    sim.projectiles.push(missile);
    advance(sim, 0.5);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
    expect(sim.projectiles).toHaveLength(0);
    expect(bb.shieldCurrent).toBe(bb.shieldMax);
    const target = stationary(ship("cruiser", 1, [0, -500]));
    missile.hp = missile.maxHp;
    expect(acquireMountTarget(bb, bb.turrets[1], target, [bb, target], [missile])?.kind).toBe(
      "ship",
    );
  });

  it("holds fighter recovery through the old timeout until shields reach 75 percent", () => {
    const fighter = stationary(ship("strike_craft", 0, [0, 0]));
    fighter.shieldCurrent = 0;
    const enemy = stationary(ship("corvette", 1, [700, 0]));
    enemy.turrets = [];
    const sim = simulate([fighter, enemy]);
    advance(sim, 5);
    expect(fighter.fighterPhase).toBe("recover");
    fighter.shieldCurrent = HULL_PROFILES.strike_craft.shieldMax * 0.75 - 1;
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("recover");
    fighter.shieldCurrent = HULL_PROFILES.strike_craft.shieldMax * 0.75;
    sim.update(1 / 60);
    expect(fighter.fighterPhase).not.toBe("recover");
  });

  it("gives all three healthy fighters time to fire in their first pass", () => {
    const fighters = fleet(Array<HullClass>(3).fill("strike_craft"), 0, -500);
    const target = stationary(ship("corvette", 1, [500, 0]));
    target.turrets = [];
    const sim = simulate([...fighters, target]);
    let enteredAttack = false;
    for (let i = 0; i < 60 * 15; i++) {
      sim.update(1 / 60);
      enteredAttack ||= fighters.some((s) => s.fighterPhase === "attack");
      if (enteredAttack && fighters.every((s) => s.fighterPhase === "egress")) break;
    }
    expect(enteredAttack).toBe(true);
    expect(fighters.every((s) => s.lastMissionShotTime !== undefined)).toBe(true);
  });

  it("breaks away immediately while a cooling wingmate completes its own pass", () => {
    const fighters = fleet(Array<HullClass>(3).fill("strike_craft"), 0, -500);
    fighters.forEach((s, i) => {
      stationary(s);
      s.pos = [
        [-45, 0],
        [-250, 0],
        [-330, 70],
      ][i] as Vector2;
    });
    fighters[2].turrets[0].cooldownTimer = 3.1;
    const target = stationary(ship("corvette", 1, [0, 0]));
    target.turrets = [];
    const sim = simulate([...fighters, target]);
    advance(sim, 0.1);
    expect(fighters[0].fighterPhase).toBe("egress");
    expect(fighters[0].lastMissionShotTime).toBeUndefined();
    expect(fighters[1].fighterPhase).toBe("egress");
    expect(fighters[2].fighterPhase).toBe("attack");
    expect(fighters[2].lastMissionShotTime).toBeUndefined();
    advance(sim, 3.1);
    expect(fighters.slice(1).every((s) => s.lastMissionShotTime !== undefined)).toBe(true);
    expect(fighters.every((s) => s.fighterPhase === "egress")).toBe(true);
  });

  it("peels off at full speed before a capital shield even with an unloaded weapon", () => {
    const fighter = ship("strike_craft", 0, [-220, 0]);
    fighter.velocity = [fighter.maxSpeed, 0];
    fighter.turrets[0].cooldownTimer = 10;
    const capital = stationary(ship("battleship", 1, [0, 0]));
    capital.turrets = [];
    const sim = simulate([fighter, capital]);
    let closest = Infinity;
    for (let i = 0; i < 120; i++) {
      sim.update(1 / 60);
      closest = Math.min(closest, vecDistance(fighter.pos, capital.pos));
    }
    expect(fighter.isAlive).toBe(true);
    expect(fighter.hullCurrent).toBe(fighter.hullMax);
    expect(fighter.shieldCurrent).toBe(fighter.shieldMax);
    expect(fighter.lastMissionShotTime).toBeUndefined();
    // Larger capitals can reach the repulsor boundary, still 20u clear of shields.
    expect(closest).toBeGreaterThanOrEqual((fighter.size + capital.size) * 1.4 + 20);
  });

  it("spawns every preset with shield clearance for all hull pairs on both teams", () => {
    for (const preset of FLEET_PRESETS) {
      const slots = preset.composition.flatMap(({ hullClass, count, groupId }) =>
        Array.from({ length: count }, (_, i) => ({ id: `${hullClass}_${i}`, hullClass, groupId })),
      );
      const ships = [
        ...buildFleetFromSlots(slots, 0, -1100, 0),
        ...buildFleetFromSlots(slots, 1, 1100, Math.PI),
      ];
      for (let i = 0; i < ships.length; i++) {
        for (const other of ships.slice(i + 1)) {
          const current = ships[i];
          expect(
            vecDistance(current.pos, other.pos),
            `${preset.id}: ${current.id} / ${other.id}`,
          ).toBeGreaterThan((current.size + other.size) * 1.4 + 20);
        }
      }
    }
  });

  it.each([0, 1])(
    "keeps three ten-fighter spawn groups clear through launch on team %i",
    (team) => {
      const fighters = buildFleetFromSlots(
        Array.from({ length: 30 }, (_, i) => ({
          id: `${i}`,
          hullClass: "strike_craft" as const,
          groupId: Math.floor(i / 10) + 1,
        })),
        team,
        team ? 1100 : -1100,
        team ? Math.PI : 0,
      );
      const target = stationary(ship("cruiser", 1 - team, [team ? -1100 : 1100, 0]));
      target.turrets = [];
      const sim = simulate([...fighters, target]);
      for (let tick = 0; tick < 120; tick++) {
        for (const fighter of fighters)
          for (const other of fighters)
            if (fighter.groupId !== other.groupId)
              expect(vecDistance(fighter.pos, other.pos)).toBeGreaterThan(
                (fighter.size + other.size) * 1.4 + 20,
              );
        sim.update(1 / 60);
      }
    },
  );

  it.each([
    [60, 3],
    [80, 4],
    [120, 10],
  ])("packs %i fighters in %i groups without overlap for either team", (count, groups) => {
    for (const team of [0, 1]) {
      const fighters = buildFleetFromSlots(
        Array.from({ length: count }, (_, i) => ({
          id: `${i}`,
          hullClass: "strike_craft" as const,
          groupId: (i % groups) + 1,
        })),
        team,
        team ? 800 : -800,
        team ? Math.PI : 0,
      );
      for (const fighter of fighters)
        for (const other of fighters)
          if (fighter !== other)
            expect(vecDistance(fighter.pos, other.pos)).toBeGreaterThan(
              (fighter.size + other.size) * 1.4 + 20,
            );
      expect(new Set(fighters.map((s) => s.id)).size).toBe(count);
    }
  });

  it("places each tactical group at its mirrored anchor for both teams", () => {
    for (const team of [0, 1]) {
      const direction = team === 0 ? 1 : -1;
      const anchors = [
        [0, 0],
        [-250 * direction, 450],
        [-250 * direction, -450],
        [-350 * direction, 0],
        [250 * direction, 0],
      ];
      const ships = buildFleetFromSlots(
        anchors.map((_, i) => ({ id: `${i}`, hullClass: "cruiser", groupId: i + 1 })),
        team,
        100,
        team ? Math.PI : 0,
      );
      expect(ships.map((s) => s.pos)).toEqual(anchors.map(([x, y]) => [100 + x, y]));
      expect(new Set(ships.map((s) => s.id)).size).toBe(5);
    }
  });

  it("advances 60 grouped fighters into cohesive, shield-safe strikes against Triple Threat", () => {
    const fighters = buildFleetFromSlots(
      Array.from({ length: 60 }, (_, i) => ({
        id: `${i}`,
        hullClass: "strike_craft" as const,
        groupId: Math.floor(i / 20) + 1,
      })),
      0,
      -800,
      0,
    );
    const preset = FLEET_PRESETS.find((p) => p.id === "test_all_threes");
    if (!preset) throw new Error("Missing Triple Threat preset");
    const enemies = buildFleetFromSlots(
      preset.composition.flatMap(({ hullClass, count, groupId }) =>
        Array.from({ length: count }, (_, i) => ({ id: `${hullClass}_${i}`, hullClass, groupId })),
      ),
      1,
      800,
      Math.PI,
    );
    expect(fighters).toHaveLength(60);
    expect(fighters.every((s) => Math.abs(s.pos[1]) <= 600)).toBe(true);
    const spawnX = fighters.map((s) => s.pos[0]);
    const sim = simulate([...fighters, ...enemies]);
    const capitals = enemies.filter(
      (s) => s.hullClass === "battleship" || s.hullClass === "cruiser",
    );
    let contacts = 0;
    let capitalDamage = 0;
    const nearCapital = (s: ShipState) =>
      capitals.some(
        (enemy) =>
          enemy.isAlive && vecDistance(s.pos, enemy.pos) <= (s.size + enemy.size) * 1.4 + 21,
      );
    // Collision resolution pushes hulls apart before emitting destruction callbacks.
    sim.onShipDestroyed = (s) => {
      if (s.team === 0 && nearCapital(s)) contacts++;
    };
    sim.update(1 / 60);
    for (const groupId of [1, 2, 3]) {
      const group = fighters.filter((s) => s.groupId === groupId);
      expect(new Set(group.map((s) => s.navigationTargetId)).size).toBe(1);
      expect(group.every((s) => s.navigationTargetId !== undefined)).toBe(true);
      expect(group.filter((s) => s.fighterPhase === "attack")).toHaveLength(4);
      expect(group.filter((s) => s.fighterPhase === "staging")).toHaveLength(16);
      expect(new Set(group.map((s) => s.wingIndex)).size).toBe(5);
      for (const fighter of group)
        expect(
          fighters
            .filter((s) => s.wingIndex === fighter.wingIndex)
            .every((s) => s.groupId === groupId),
        ).toBe(true);
      for (const wingIndex of new Set(group.map((s) => s.wingIndex))) {
        const ys = group.filter((s) => s.wingIndex === wingIndex).map((s) => s.pos[1]);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(57);
      }
    }
    for (let tick = 1; tick < 60 * 90 && sim.winner === null; tick++) {
      sim.update(1 / 60);
      capitalDamage = Math.max(
        capitalDamage,
        ...capitals.map((s) => s.armorMax - s.armorCurrent + s.hullMax - s.hullCurrent),
      );
      if (tick < 60)
        fighters.forEach((s, i) => {
          expect(s.pos[0], s.id).toBeGreaterThanOrEqual(spawnX[i]);
        });
      for (const fighter of fighters) if (fighter.isAlive && nearCapital(fighter)) contacts++;
      if (tick % 60 === 0)
        for (const groupId of [1, 2, 3]) {
          const group = fighters.filter((s) => s.isAlive && s.groupId === groupId);
          expect(new Set(group.map((s) => s.navigationTargetId)).size).toBeLessThanOrEqual(1);
        }
    }
    expect(contacts).toBeLessThanOrEqual(2);
    expect(sim.stats[0].damageDealt).toBeGreaterThan(6500);
    expect(sim.stats[1].shipsLost).toBeGreaterThanOrEqual(3);
    expect(capitalDamage).toBeGreaterThan(0);
  }, 60000);

  it("jinks away from an opening inbound torpedo before it reaches close range", () => {
    const fighter = ship("strike_craft", 0, [0, 0]);
    const enemy = stationary(ship("cruiser", 1, [900, 0]));
    enemy.turrets.forEach((t) => {
      t.cooldownTimer = 10;
    });
    const sim = simulate([fighter, enemy]);
    sim.projectiles.push(projectile(enemy, [500, 0], [-320, 0], 1));
    advance(sim, 0.5);
    expect(Math.abs(fighter.pos[1])).toBeGreaterThan(15);
    advance(sim, 1.5);
    expect(fighter.hullCurrent).toBe(fighter.hullMax);
  });

  it.each([1, 7, 29])("two flagships decisively beat three cruisers (seed %i)", (seed) => {
    const ships = [
      ...fleet(["battleship", "battleship"], 0, -800),
      ...fleet(["cruiser", "cruiser", "cruiser"], 1, 800),
    ];
    let state = seed;
    for (const s of ships) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      s.pos[1] += (state / 2 ** 32 - 0.5) * 80;
    }
    const sim = simulate(ships);
    for (let i = 0; i < 60 * 240 && sim.winner === null; i++) sim.update(1 / 60);
    expect(sim.winner).toBe(0);
    expect(ships.filter((s) => s.team === 0 && s.isAlive)).toHaveLength(2);
    expect(ships.filter((s) => s.team === 0).every((s) => s.hullCurrent > s.hullMax * 0.5)).toBe(
      true,
    );
  });

  it("makes one flagship versus three cruisers a costly duel", () => {
    const ships = [
      ...fleet(["battleship"], 0, -800),
      ...fleet(["cruiser", "cruiser", "cruiser"], 1, 800),
    ];
    for (const cruiser of ships.slice(1)) {
      cruiser.pos[0] -= 150;
      cruiser.pos[1] -= 450;
    }
    const sim = simulate(ships);
    for (let i = 0; i < 60 * 120 && sim.winner === null; i++) sim.update(1 / 60);
    expect(sim.winner).not.toBeNull();
    expect(sim.stats[1].shipsLost).toBeGreaterThanOrEqual(1);
    const bb = ships[0];
    expect(bb.shieldCurrent + bb.armorCurrent + bb.hullCurrent).toBeLessThan(
      (bb.shieldMax + bb.armorMax + bb.hullMax) * 0.5,
    );
  });

  it("lets a corvette wolfpack catch and damage an isolated cruiser's armor", () => {
    const corvettes = fleet(["corvette", "corvette", "corvette"], 0, -800);
    const cruiser = fleet(["cruiser"], 1, 800)[0];
    const sim = simulate([...corvettes, cruiser]);
    let closest = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      sim.update(1 / 60);
      for (const s of corvettes.filter((s) => s.isAlive))
        closest = Math.min(closest, vecDistance(s.pos, cruiser.pos));
    }
    expect(cruiser.armorCurrent).toBeLessThan(cruiser.armorMax * 0.8);
    expect(closest).toBeLessThan(300);
  });

  it("resolves the three-corvette carousel instead of indefinitely regenerating", () => {
    const hulls: HullClass[] = ["corvette", "corvette", "corvette"];
    const sim = simulate([...fleet(hulls, 0, -800), ...fleet(hulls, 1, 800)]);
    for (let i = 0; i < 60 * 150 && sim.winner === null; i++) sim.update(1 / 60);
    expect(sim.winner).not.toBeNull();
    expect(sim.stats[0].shipsLost + sim.stats[1].shipsLost).toBeGreaterThanOrEqual(4);
  });
});

describe("fixed ticks and simultaneous combat", () => {
  it("retains pending combat time when a render exceeds the catch-up work limit", () => {
    const sim = simulate([]);
    sim.update(6);
    expect(sim.timeElapsed).toBeCloseTo(4);
    sim.update(1 / 60);
    expect(sim.timeElapsed).toBeCloseTo(6 + 1 / 60);
  });

  it("produces identical results for different render update sizes", () => {
    const initial = [
      ...fleet(["battleship", "corvette", "strike_craft"], 0, -800),
      ...fleet(["battleship", "corvette", "strike_craft"], 1, 800),
    ];
    const fine = simulate(structuredClone(initial));
    const fast = simulate(structuredClone(initial));
    advance(fine, 10);
    for (let i = 0; i < 25; i++) fast.update(0.4);
    expect(fast.ships).toEqual(fine.ships);
    expect(fast.projectiles).toEqual(fine.projectiles);
  });

  it("allows both ships alive at the firing instant to emit lethal beams", () => {
    const ships = [
      stationary(ship("cruiser", 0, [-200, 0])),
      stationary(ship("cruiser", 1, [200, 0])),
    ];
    for (const s of ships) {
      s.shieldCurrent = 0;
      s.armorCurrent = 0;
      s.hullCurrent = 1;
      s.turrets = [s.turrets[0]];
    }
    const sim = simulate(ships);
    let deaths = 0;
    sim.onShipDestroyed = () => deaths++;
    advance(sim, 7 / 60);
    expect(ships.every((s) => !s.isAlive)).toBe(true);
    expect(deaths).toBe(2);
    expect(sim.stats[0].shipsLost).toBe(1);
    expect(sim.stats[1].shipsLost).toBe(1);
  });

  it("removes blue-first movement and firing bias in mirrored capital duels", () => {
    const ships = [ship("battleship", 0, [-420, 0]), ship("battleship", 1, [420, 0])];
    const forward = simulate(structuredClone(ships));
    const reversed = simulate(structuredClone(ships).reverse());
    advance(forward, 20);
    advance(reversed, 20);
    expect(reversed.ships.reverse()).toEqual(forward.ships);
    expect(forward.ships[0].shieldCurrent).toBeCloseTo(forward.ships[1].shieldCurrent);
  });

  it("resolves coincident hostile hulls without frame-rate ramming damage", () => {
    const ships = [
      stationary(ship("corvette", 0, [0, 0])),
      stationary(ship("corvette", 1, [0, 0])),
    ];
    ships.forEach((s) => {
      s.turrets = [];
    });
    const sim = simulate(ships);
    advance(sim, 1);
    expect(vecDistance(ships[0].pos, ships[1].pos)).toBeGreaterThan(56);
    expect(ships.every((s) => s.shieldCurrent > 170)).toBe(true);
  });
});
