import { describe, expect, it } from "vitest";
import { acquireMountTarget, inMountArc, mountPosition, sweptHit } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import {
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
    const target = stationary(ship("battleship", 1, [908.1, 0]));
    target.turrets = [];
    const sim = simulate([cruiser, target]);
    let beams = 0;
    sim.onBeamFire = () => beams++;
    advance(sim, 1);
    expect(beams).toBe(0);
    expect(cruiser.turrets[0].cooldownTimer).toBe(0);
    target.pos = [907.9, 0];
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
      const target = stationary(ship("strike_craft", 1, [11 + surface, 0]));
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

  it("launches a wave after timeout despite an unreachable rally and cooling weapons", () => {
    const fighters = fleet(Array<HullClass>(5).fill("strike_craft"), 0, -800);
    for (const f of fighters) {
      stationary(f);
      f.turrets[0].cooldownTimer = 10;
    }
    const enemy = stationary(ship("battleship", 1, [1000, 0]));
    enemy.turrets = [];
    const sim = simulate([...fighters, enemy]);
    advance(sim, 2.7);
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
        expect(s.pos.every(Number.isFinite)).toBe(true);
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
