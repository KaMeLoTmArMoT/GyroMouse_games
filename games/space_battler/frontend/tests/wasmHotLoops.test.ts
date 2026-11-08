import { describe, expect, it, vi } from "vitest";
import { CollisionContactSolver } from "../src/engine/collisionContactSolver";
import { sweptHit } from "../src/engine/fireControl";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { clamp, vecAdd, vecDistance, vecScale, vecSub } from "../src/engine/math2d";
import { ProjectileEngine } from "../src/engine/projectileEngine";
import { activeShieldRadius, shieldRepulsorRadius } from "../src/engine/shieldGeometry";
import { ClientCombatSimulation } from "../src/engine/simulation";
import { WasmHotLoops } from "../src/engine/wasmHotLoops";
import type { HullClass, ProjectileState, ShipState } from "../src/types/combat";

type SweepArgs = [number, number, number, number, number, number, number, number, number];

function referenceHit(kernel: WasmHotLoops, args: SweepArgs) {
  const [count, sx, sy, ex, ey, fraction, trigger, team, target] = args;
  let victim = -1;
  let first = Infinity;
  let bestDistance = Infinity;
  for (let i = 0; i < count; i++) {
    if (!kernel.shipFlags[i * 2 + 1] || kernel.shipFlags[i * 2] === team) continue;
    const data = kernel.shipSweeps;
    const offset = i * 5;
    const x0 = sx - data[offset],
      y0 = sy - data[offset + 1];
    const x1 = ex - (data[offset] + data[offset + 2] * fraction);
    const y1 = ey - (data[offset + 1] + data[offset + 3] * fraction);
    const radius = data[offset + 4] + trigger;
    if (
      (x0 > radius && x1 > radius) ||
      (x0 < -radius && x1 < -radius) ||
      (y0 > radius && y1 > radius) ||
      (y0 < -radius && y1 < -radius)
    )
      continue;
    const t = sweptHit([x0, y0], [x1, y1], radius);
    if (t === null) continue;
    const distance = Math.sqrt(x0 * x0 + y0 * y0);
    if (
      t < first ||
      (t === first && (i === target || (victim !== -1 && distance < bestDistance)))
    ) {
      victim = i;
      first = t;
      bestDistance = distance;
    }
  }
  return { victim, first };
}

function bits(value: number): bigint {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

function expectHit(kernel: WasmHotLoops, args: SweepArgs) {
  const reference = referenceHit(kernel, args);
  expect(kernel.findProjectileShipHitWasm(...args)).toBe(reference.victim);
  expect(bits(kernel.first)).toBe(bits(reference.first));
  return reference;
}

function randomSource() {
  let state = 0x15b16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function ship(id: string, hullClass: HullClass, x: number, y = 0, team = 0): ShipState {
  const result = buildFleetFromSlots([{ id, hullClass, groupId: 1 }], team, 0, 0)[0];
  result.id = id;
  result.pos = [x, y];
  result.turrets = [];
  return result;
}

describe("embedded WASM flat-buffer kernels", () => {
  it("instantiates natively and preserves packed data through odd-sized >512 memory growth", () => {
    const kernel = new WasmHotLoops();
    expect(kernel.wasmEnabled).toBe(true);
    expect(kernel.memory).toBeInstanceOf(WebAssembly.Memory);
    kernel.ensureCapacity(16);
    kernel.shipSweeps.set([10, 20, 30, 40, 50]);
    kernel.shipFlags.set([1, 1]);
    kernel.collisionShips.set([1, 2, 3]);
    kernel.tetherFlags[0] = 1;
    const oldBuffer = kernel.memory?.buffer;
    kernel.ensureCapacity(513);
    expect(kernel.memory?.buffer).not.toBe(oldBuffer);
    expect([...kernel.shipSweeps.slice(0, 5)]).toEqual([10, 20, 30, 40, 50]);
    expect([...kernel.shipFlags.slice(0, 2)]).toEqual([1, 1]);
    expect([...kernel.collisionShips.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(kernel.tetherFlags[0]).toBe(1);
    expectHit(kernel, [513, 0, 20, 100, 20, 1, 0, 0, -1]);
    expect(kernel.collectCollisionPairsWasm(513, false)).toBe((512 * 511) / 2);
    kernel.ensureCapacity(1200);
    expect([...kernel.shipSweeps.slice(0, 5)]).toEqual([10, 20, 30, 40, 50]);
  });

  it.each([true, false])(
    "matches overlap, tangent, misses, tiny motion and endpoint hits (WASM=%s)",
    (useWasm) => {
      const kernel = new WasmHotLoops(useWasm);
      kernel.ensureCapacity(1);
      kernel.shipFlags.set([1, 1]);
      kernel.shipSweeps.set([0, 0, 0, 0, 1]);
      for (const [sx, sy, ex, ey] of [
        [0, 0, 0, 0],
        [-2, 1, 2, 1],
        [-2, 1.00001, 2, 1.00001],
        [-2, 0, -1, 0],
        [-2, 0, -2 + 1e-6, 0],
        [-2, 2, 2, 2],
        [1, 0, 2, 0],
        [-2, 0, -3, 0],
      ])
        expectHit(kernel, [1, sx, sy, ex, ey, 1, 0, 0, -1]);
      expect(kernel.findProjectileShipHitWasm(0, 0, 0, 1, 1, 1, 0, 0, -1)).toBe(-1);
      expect(kernel.first).toBe(Infinity);
    },
  );

  it.each([true, false])(
    "preserves target and distance tie-breaking in source order (WASM=%s)",
    (useWasm) => {
      const kernel = new WasmHotLoops(useWasm);
      kernel.ensureCapacity(3);
      kernel.shipFlags.set([1, 1, 1, 1, 1, 1]);
      kernel.shipSweeps.set([2, 0, 0, 0, 3, 1, 0, 0, 0, 3, 2, 0, 0, 0, 3]);
      expect(expectHit(kernel, [3, 0, 0, 10, 0, 1, 0, 0, -1]).victim).toBe(1);
      expect(expectHit(kernel, [3, 0, 0, 10, 0, 1, 0, 0, 2]).victim).toBe(2);
      // A later closer ship can supersede the target at equal t: no target lock bias is added.
      expect(expectHit(kernel, [3, 0, 0, 10, 0, 1, 0, 0, 0]).victim).toBe(1);
      kernel.shipSweeps[5] = 2;
      expect(expectHit(kernel, [3, 0, 0, 10, 0, 1, 0, 0, -1]).victim).toBe(0);
    },
  );

  it("matches the TS sweptHit reference bit-for-bit over randomized moving fleets and shortened sweeps", () => {
    const wasm = new WasmHotLoops();
    const fallback = new WasmHotLoops(false);
    const random = randomSource();
    const count = 600;
    for (const kernel of [wasm, fallback]) kernel.ensureCapacity(count);
    for (let i = 0; i < count; i++) {
      wasm.shipSweeps.set(
        [
          (random() - 0.5) * 2000,
          (random() - 0.5) * 2000,
          (random() - 0.5) * 30,
          (random() - 0.5) * 30,
          random() * 100,
        ],
        i * 5,
      );
      wasm.shipFlags.set([i % 3, Number(i % 7 !== 0)], i * 2);
    }
    fallback.shipSweeps.set(wasm.shipSweeps);
    fallback.shipFlags.set(wasm.shipFlags);
    for (let p = 0; p < 1000; p++) {
      const args: SweepArgs = [
        count,
        (random() - 0.5) * 2000,
        (random() - 0.5) * 2000,
        (random() - 0.5) * 2000,
        (random() - 0.5) * 2000,
        random(),
        random() * 30,
        p % 3,
        Math.floor(random() * count),
      ];
      expectHit(wasm, args);
      expectHit(fallback, args);
    }
  });

  it("observes mid-tick shield collapse and deaths immediately", () => {
    const kernel = new WasmHotLoops();
    kernel.ensureCapacity(2);
    kernel.shipFlags.set([1, 1, 1, 1]);
    kernel.shipSweeps.set([10, 0, 0, 0, 4, 15, 0, 0, 0, 4]);
    const args: SweepArgs = [2, 0, 3, 20, 3, 1, 0, 0, -1];
    expect(expectHit(kernel, args).victim).toBe(0);
    kernel.updateShip(0, 2, true);
    expect(expectHit(kernel, args).victim).toBe(1);
    kernel.updateShip(1, 2, false);
    expect(expectHit(kernel, args).victim).toBe(-1);
  });

  it("matches lexicographic collision pairs, pass filters, margins and row suffixes after growth", () => {
    const wasm = new WasmHotLoops();
    const fallback = new WasmHotLoops(false);
    const random = randomSource();
    const count = 650;
    for (const kernel of [wasm, fallback]) kernel.ensureCapacity(count);
    for (let i = 0; i < count; i++) {
      wasm.collisionShips.set(
        [(random() - 0.5) * 1000, (random() - 0.5) * 1000, random() * 200 + 25],
        i * 3,
      );
      wasm.tetherFlags[i] = Number(i % 5 === 0);
    }
    fallback.collisionShips.set(wasm.collisionShips);
    fallback.tetherFlags.set(wasm.tetherFlags);
    for (const pass of [false, true]) {
      for (const margin of [0, 8]) {
        for (const [firstRow, lastRow, firstColumn] of [
          [0, count, 0],
          [20, 21, 50],
        ]) {
          const n = wasm.collectCollisionPairsWasm(
            count,
            pass,
            margin,
            firstRow,
            lastRow,
            firstColumn,
          );
          expect(n).toBe(
            fallback.collectCollisionPairsWasm(count, pass, margin, firstRow, lastRow, firstColumn),
          );
          expect([...wasm.collisionPairs.slice(0, n * 2)]).toEqual([
            ...fallback.collisionPairs.slice(0, n * 2),
          ]);
        }
      }
    }
  });
});

// Brute-force oracle disables candidate rejection, but retains the production narrowphase.
// This independently detects any contact lost by a stale broadphase snapshot or pass filter.
function collisionRun(initial: ShipState[], bruteForce: boolean) {
  const spy = bruteForce
    ? vi.spyOn(WasmHotLoops.prototype, "collectCollisionPairsWasm").mockImplementation(function (
        this: WasmHotLoops,
        count,
        _pass,
        _margin,
        firstRow = 0,
        lastRow = count,
        firstColumn = 0,
      ) {
        let pairs = 0;
        for (let i = firstRow; i < lastRow; i++) {
          for (let j = Math.max(i + 1, firstColumn); j < count; j++) {
            this.collisionPairs[pairs * 2] = i;
            this.collisionPairs[pairs * 2 + 1] = j;
            pairs++;
          }
        }
        return pairs;
      })
    : undefined;
  try {
    const ships = structuredClone(initial);
    const sim = new ClientCombatSimulation();
    for (const vessel of ships) sim.addShip(vessel);
    const proximity: (string | number)[][] = [];
    sim.observer = {
      onShot() {},
      onDamage() {},
      onShieldRegen() {},
      onMountDecision() {},
      onTick() {},
      onProximity(a, b, distance) {
        proximity.push([a.id, b.id, distance]);
      },
    };
    const solver = new CollisionContactSolver(sim, (vessel) => {
      vessel.isAlive = false;
      sim.shieldHaven.releaseGuests(vessel.id);
    });
    const budgets: [string, number][][] = [];
    for (let tick = 0; tick < 4; tick++) {
      const steps = new Map<string, number>();
      solver.resolveShipCollisions(ships, 1 / 60, false, steps);
      solver.resolveShipCollisions(ships, 1 / 60, true, steps);
      budgets.push([...steps]);
    }
    return { ships, budgets, proximity };
  } finally {
    spy?.mockRestore();
  }
}

describe("hot-loop engine integration", () => {
  it("matches legacy flak interpolation and falloff across repeated bursts and already-advanced missiles", () => {
    const dt = 1 / 60;
    const elapsed = 0.005;
    const ships = [
      ship("cruiser", "cruiser", 82, 0, 1),
      ship("corvette", "corvette", 50, 0, 1),
      ship("fighter", "strike_craft", 31, 0, 1),
      ship("far", "cruiser", 10000, 0, 1),
    ];
    const previous = new Map(
      ships.map((vessel, i) => [
        vessel.id,
        [vessel.pos[0] + (i < 2 ? 10 : 0), 0] as [number, number],
      ]),
    );
    const weapon = buildFleetFromSlots(
      [{ id: "flak", hullClass: "corvette", groupId: 1 }],
      0,
      0,
      0,
    )[0].turrets[0].weapon;
    const profile = weapon.flak;
    if (!profile) throw new Error("Missing stock flak profile");
    const makeShell = (id: string): ProjectileState => ({
      id,
      pos: [0, 0],
      velocity: [0, 0],
      weapon,
      weaponType: "point_defense",
      damage: weapon.damage,
      lifetime: elapsed,
      hp: 1,
      maxHp: 1,
      ownerId: "flak",
      ownerTeam: 0,
      targetId: null,
    });
    const missile: ProjectileState = {
      ...makeShell("heavy"),
      pos: [20, 15],
      velocity: [100, 0],
      weapon: { ...weapon, flak: undefined, weaponType: "missile" },
      weaponType: "missile",
      ownerTeam: 1,
      lifetime: 1,
      hp: 120,
      maxHp: 120,
    };
    const expired = { ...missile, id: "expired", lifetime: 0 };
    const dead = { ...missile, id: "dead", hp: 0 };
    const friendly = {
      ...missile,
      id: "friendly",
      ownerTeam: 0,
      pos: [20, -15] as [number, number],
    };
    const expected: (string | number)[][] = [];
    const reference = structuredClone(ships);
    for (let burst = 0; burst < 2; burst++) {
      // Original detonation builds this positions Map before applying any damage.
      const positions = new Map(
        reference.map((vessel) => {
          const old = previous.get(vessel.id) ?? vessel.pos;
          return [vessel.id, vecAdd(old, vecScale(vecSub(vessel.pos, old), elapsed / dt))];
        }),
      );
      for (const vessel of reference) {
        const distance = vecDistance([0, 0], positions.get(vessel.id) ?? vessel.pos);
        const radius = activeShieldRadius(vessel);
        const surface =
          distance >= radius ? distance - radius : Math.max(0, distance - vessel.size);
        const falloff = clamp(
          (profile.blastRadius - surface) / (profile.blastRadius - profile.triggerRadius),
          0,
          1,
        );
        if (falloff <= 0) continue;
        expected.push([vessel.id, weapon.damage * falloff]);
        vessel.shieldCurrent = 0;
      }
    }
    const actual: (string | number)[][] = [];
    const engine = new ProjectileEngine({
      applyShipDamage(vessel, damage, appliedWeapon) {
        actual.push([vessel.id, damage]);
        if (vessel.hullClass === "strike_craft") {
          expect([
            appliedWeapon.shieldMultiplier,
            appliedWeapon.armorMultiplier,
            appliedWeapon.hullMultiplier,
          ]).toEqual([1, 1, 1]);
        }
        vessel.shieldCurrent = 0;
      },
      onMissileIntercept() {},
      onDetonate() {},
      onFlakAudio() {},
    });
    engine.projectiles = [
      makeShell("burst1"),
      missile,
      expired,
      dead,
      friendly,
      makeShell("burst2"),
    ];
    engine.updateProjectiles(dt, ships, previous);
    expect(actual).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(missile.hp).toBe(120 - 2 * profile.missileDamage);
    expect(friendly.hp).toBe(120);
    expect(expired.hp).toBe(120);
    expect(dead.hp).toBe(0);
  });

  it("preserves crowded mixed swarms, contact latching, telemetry and soft budgets", () => {
    const random = randomSource();
    const hulls: HullClass[] = ["cruiser", "corvette", "strike_craft", "battleship"];
    const ships = Array.from({ length: 64 }, (_, i) => {
      const result = ship(
        `swarm-${i}`,
        hulls[i % hulls.length],
        (random() - 0.5) * 600,
        (random() - 0.5) * 600,
        i % 2,
      );
      result.velocity = [(random() - 0.5) * 100, (random() - 0.5) * 100];
      if (i % 11 === 0) result.havenState = "tethered";
      return result;
    });
    expect(collisionRun(ships, false)).toEqual(collisionRun(ships, true));
  });

  it("preserves capital repulsor chains and contacts created outside the initial hull-overlap bound", () => {
    const capital = ship("capital", "battleship", 0);
    const spacing = shieldRepulsorRadius(capital) * 2 + 10;
    const capitals = Array.from({ length: 12 }, (_, i) =>
      ship(`capital-${i}`, "battleship", i * spacing),
    );
    expect(collisionRun(capitals, false)).toEqual(collisionRun(capitals, true));
    // Overlapping equal-mass hulls create a third contact outside the initial contact envelope.
    const overlapping = [
      ship("a", "battleship", 0),
      ship("b", "battleship", 1),
      ship("c", "battleship", 0, 0, 1),
    ];
    overlapping[0].shieldCurrent = overlapping[1].shieldCurrent = overlapping[2].shieldCurrent = 0;
    const clearance =
      shieldRepulsorRadius(overlapping[0]) + shieldRepulsorRadius(overlapping[2]) + 20;
    const hullPush = (overlapping[0].size + overlapping[1].size - 1) / 2;
    overlapping[2].pos = [-clearance - hullPush + 10, 0];
    expect(vecDistance(overlapping[0].pos, overlapping[2].pos)).toBeGreaterThan(clearance);
    const actual = collisionRun(overlapping, false);
    expect(actual).toEqual(collisionRun(overlapping, true));
    expect(actual.budgets[0].some(([id]) => id === "c")).toBe(true);
  });

  it("refreshes the struck slot, a protected parent and global radii after a death", () => {
    const target = ship("target", "corvette", 100, 0, 1);
    const parent = ship("parent", "cruiser", 1000, 0, 1);
    target.havenParentId = parent.id;
    const targets = [target, parent];
    const weapon = buildFleetFromSlots(
      [{ id: "gun", hullClass: "strike_craft", groupId: 1 }],
      0,
      0,
      0,
    )[0].turrets[0].weapon;
    const hits: string[] = [];
    const engine = new ProjectileEngine({
      applyShipDamage(vessel) {
        hits.push(vessel.id);
        if (hits.length === 1) parent.shieldCurrent = 0;
        else if (hits.length === 2) {
          vessel.isAlive = false;
          parent.shieldCurrent = parent.shieldMax;
          parent.havenRadiusMultiplier = 2;
        } else vessel.isAlive = false;
      },
      onMissileIntercept() {},
      onDetonate() {},
      onFlakAudio() {},
    });
    const makeShot = (id: string, x: number, y: number): ProjectileState => ({
      id,
      pos: [x, y],
      velocity: [12000, 0],
      damage: 1,
      lifetime: 1,
      hp: 1,
      maxHp: 1,
      weaponType: "plasma",
      weapon,
      ownerId: "gun",
      ownerTeam: 0,
      targetId: null,
    });
    const grazingY = (activeShieldRadius(parent) + parent.size) / 2;
    engine.projectiles = [
      makeShot("guest-hit", 0, 0),
      makeShot("parent-graze", 900, grazingY),
      makeShot("kill-guest", 0, 0),
      makeShot("refreshed-parent", 900, grazingY),
      makeShot("dead-guest", 0, 0),
    ];
    engine.updateProjectiles(
      1 / 60,
      targets,
      new Map(targets.map((vessel) => [vessel.id, vessel.pos])),
    );
    expect(hits).toEqual(["target", "target", "parent"]);
    expect(engine.projectiles.map((p) => p.id)).toEqual(["parent-graze", "dead-guest"]);
  });
});
