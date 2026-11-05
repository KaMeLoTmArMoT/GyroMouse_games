import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualEffectsManager } from "../src/canvas/effects";
import { renderProjectileThreats } from "../src/canvas/projectileRenderer";
import type { ProjectileState, ShipState } from "../src/types/combat";

const projectile = {
  id: "torpedo",
  weaponType: "missile",
  ownerTeam: 0,
  pos: [100, 50],
  velocity: [100, 0],
  hp: 120,
  maxHp: 120,
} as ProjectileState;

afterEach(() => vi.restoreAllMocks());

describe("projectile feedback", () => {
  it("emits damage smoke and sparks only for damaged missiles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const healthy = new VisualEffectsManager();
    healthy.update(0.1, [], [projectile]);
    expect(healthy.smokeParticles.some((particle) => particle.color === "#353035")).toBe(false);
    expect(healthy.sparkParticles).toHaveLength(0);

    const damaged = new VisualEffectsManager();
    damaged.update(0.1, [], [{ ...projectile, hp: 60 }]);
    expect(damaged.smokeParticles.some((particle) => particle.color === "#353035")).toBe(true);
    expect(damaged.sparkParticles).toHaveLength(1);
    expect(damaged.sparkParticles[0].pos).toEqual([95, 50]);
  });

  it("draws warnings only from living enemy mounts actively targeting the projectile", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const mount = { currentTargetKind: "missile", currentTargetId: "torpedo", offset: [3, 4] };
    const enemy = {
      isAlive: true,
      team: 1,
      pos: [10, 20],
      heading: 0,
      turrets: [mount],
    } as unknown as ShipState;
    const friendly = { ...enemy, team: 0 };
    const dead = { ...enemy, isAlive: false };
    const otherTarget = {
      ...enemy,
      turrets: [{ ...mount, currentTargetKind: "ship" }],
    } as ShipState;

    renderProjectileThreats(ctx, projectile, [friendly, dead, otherTarget], 1);
    expect(ctx.stroke).not.toHaveBeenCalled();
    renderProjectileThreats(ctx, projectile, [friendly, dead, otherTarget, enemy], 1);
    expect(ctx.moveTo).toHaveBeenCalledWith(13, 24);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 50);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });
});
