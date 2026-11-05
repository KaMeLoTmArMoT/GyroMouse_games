import { describe, expect, it } from "vitest";
import { projectileAtPoint } from "../src/canvas/projectileSelection";
import type { ProjectileState } from "../src/types/combat";

function projectile(
  id: string,
  x: number,
  overrides: Partial<ProjectileState> = {},
): ProjectileState {
  return {
    id,
    pos: [x, 0],
    weaponType: "missile",
    hp: 25,
    maxHp: 25,
    lifetime: 1,
    ...overrides,
  } as ProjectileState;
}

describe("projectile selection", () => {
  it("uses the nearest live guided projectile within 25 screen pixels at any zoom", () => {
    const shots = [
      projectile("far", 20),
      projectile("near", 12),
      projectile("dead", 1, { hp: 0 }),
      projectile("bolt", 2, { weaponType: "plasma" }),
    ];
    expect(projectileAtPoint(shots, 0, 0, 1, 1, false)).toBe("near");
    expect(projectileAtPoint(shots, 0, 0, 2, 2, false)).toBe("near");
    expect(projectileAtPoint(shots, 0, 0, 3, 3, false)).toBeNull();
  });

  it("preserves ship selection except for a direct projectile click", () => {
    expect(projectileAtPoint([projectile("shot", 9)], 0, 0, 1, 1, true)).toBeNull();
    expect(projectileAtPoint([projectile("shot", 8)], 0, 0, 1, 1, true)).toBe("shot");
    expect(
      projectileAtPoint([projectile("expired", 0, { lifetime: 0 })], 0, 0, 1, 1, false),
    ).toBeNull();
  });
});
