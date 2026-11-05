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
    hp: 25,
    targetId: null,
    isFlakBurst: Boolean(weapon.flak),
  };
}

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
    const impacts: Array<[Vector2, boolean, boolean]> = [];
    sim.onWeaponImpact = (_ship, origin, shield, hull) => impacts.push([[...origin], shield, hull]);
    const hit = () => {
      sim.projectiles = [projectile(owner, [-60, 0], [320, 0])];
      sim.update(1 / 60);
    };

    hit();
    expect(impacts[0][0][0]).toBeLessThan(0);
    expect(impacts[0].slice(1)).toEqual([true, false]);
    target.shieldCurrent = 1;
    hit();
    expect(impacts[1].slice(1)).toEqual([true, true]);
    target.shieldCurrent = 0;
    hit();
    expect(impacts[2].slice(1)).toEqual([false, true]);
  });

  it("honors damage thresholds and bounds active smoke and spark pools", () => {
    const target = stationary(ship("battleship", 0, [0, 0]));
    expect(damageState(target)).toEqual({ scarred: false, burning: false, critical: false });
    const effects = new VisualEffectsManager();
    effects.update(1, [target]);
    expect(effects.smokeParticles).toHaveLength(0);
    expect(effects.sparkParticles).toHaveLength(0);

    target.shieldCurrent = 0;
    target.armorCurrent = target.armorMax * 0.6;
    expect(damageState(target).scarred).toBe(false);
    target.armorCurrent = 0;
    target.hullCurrent = target.hullMax * 0.7;
    expect(damageState(target).burning).toBe(false);
    target.hullCurrent = target.hullMax * 0.25;
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
    advance(sim, 0.3);
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
    inbound.hp = 25;
    expect(acquireMountTarget(cv, cv.turrets[0], enemy, [cv, enemy], [inbound])).toBeNull();
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
    expect(target.hullMax - target.hullCurrent).toBeCloseTo(220 * 1.8);
  });

  it("uses a full-damage flak core and linear surface falloff, with an accurate event radius", () => {
    const owner = ship("corvette", 0, [-500, 0]);
    const targets = [18, 26, 34].map((surface, i) => {
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
      expect(radius).toBe(34);
      return target.shieldMax - target.shieldCurrent;
    });
    expect(damage).toEqual([10, 5, 0]);
  });

  it("takes two 18-damage flak bursts to intercept and reports the kill only once", () => {
    const owner = ship("corvette", 0, [-500, 0]);
    const enemy = ship("cruiser", 1, [500, 0]);
    const missile = projectile(enemy, [0, 0], [0, 0], 1);
    const sim = simulate([]);
    const burst = (id: string) => ({ ...projectile(owner, [0, 0], [0, 0]), id });
    sim.projectiles = [missile, burst("a")];
    sim.update(1 / 60);
    expect(missile.hp).toBe(7);
    sim.projectiles.push(burst("b"), burst("c"));
    sim.update(1 / 60);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
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
    const fighters = fleet(Array<HullClass>(5).fill("strike_craft"), 0, -800);
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

  it("escapes ready spinal cones and in-flight rails during reload", () => {
    const cv = ship("corvette", 0, [600, 0]);
    const bb = ship("battleship", 1, [0, 0]);
    bb.heading = 0;
    const ready = spinalEscape(cv, [cv, bb], [], 1);
    expect(Math.abs(ready[1])).toBeGreaterThan(cv.maxSpeed);
    bb.turrets[0].cooldownTimer = 3.5;
    expect(spinalEscape(cv, [cv, bb], [], 1.1)).toEqual([0, 0]);
    const rail = projectile(bb, [300, 0], [1400, 0]);
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
  ])("contains the %i vs %i fleet playtest", (blue, red) => {
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
  });

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

  it("uses idle broadside beams to intercept live incoming torpedoes exactly once", () => {
    const bb = stationary(ship("battleship", 0, [0, 0]));
    const enemy = ship("cruiser", 1, [1400, 0]);
    const missile = projectile(enemy, [0, -300], [0, 320], 1);
    const sim = simulate([bb]);
    sim.projectiles.push(missile);
    advance(sim, 0.2);
    expect(sim.stats[0].missilesIntercepted).toBe(1);
    expect(sim.projectiles).toHaveLength(0);
    expect(bb.shieldCurrent).toBe(bb.shieldMax);
    const target = stationary(ship("cruiser", 1, [0, -500]));
    missile.hp = 25;
    expect(acquireMountTarget(bb, bb.turrets[1], target, [bb, target], [missile])?.kind).toBe(
      "ship",
    );
  });

  it("holds fighter recovery through the old timeout until shields reach 75 percent", () => {
    const fighter = stationary(ship("strike_craft", 0, [0, 0]));
    fighter.shieldCurrent = 5;
    const enemy = stationary(ship("corvette", 1, [700, 0]));
    enemy.turrets = [];
    const sim = simulate([fighter, enemy]);
    advance(sim, 5);
    expect(fighter.fighterPhase).toBe("recover");
    fighter.shieldCurrent = 44;
    sim.update(1 / 60);
    expect(fighter.fighterPhase).toBe("recover");
    fighter.shieldCurrent = 45;
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
        [-100, 0],
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
      expect(fighters.every((s) => Math.abs(s.pos[1]) <= 520)).toBe(true);
      for (const fighter of fighters)
        for (const other of fighters)
          if (fighter !== other)
            expect(vecDistance(fighter.pos, other.pos)).toBeGreaterThan(
              (fighter.size + other.size) * 1.4 + 20,
            );
      const groupBounds = Array.from({ length: groups }, (_, i) => {
        const ys = fighters.filter((s) => s.groupId === i + 1).map((s) => s.pos[1]);
        return [Math.min(...ys), Math.max(...ys)];
      });
      for (let i = 1; i < groups; i++)
        expect(groupBounds[i][0] - groupBounds[i - 1][1]).toBeGreaterThanOrEqual(56);
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
      expect(group.every((s) => s.fighterPhase === "attack")).toBe(true);
      expect(new Set(group.map((s) => s.wingIndex)).size).toBe(4);
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
    expect(sim.stats[1].shipsLost).toBeGreaterThanOrEqual(5);
    expect(capitals.some((s) => !s.isAlive)).toBe(true);
  }, 30000);

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
    const sim = simulate(ships);
    for (let i = 0; i < 60 * 120 && sim.winner === null; i++) sim.update(1 / 60);
    expect(sim.winner).not.toBeNull();
    expect(sim.stats[1].shipsLost).toBeGreaterThanOrEqual(2);
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
    sim.update(1 / 60);
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
