import { afterEach, describe, expect, it, vi } from "vitest";
import { renderShip } from "../src/canvas/shipRenderer";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import type { ShipState } from "../src/types/combat";

function context() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        const name = String(property);
        if (!calls.has(name))
          calls.set(
            name,
            vi.fn(() => {
              if (name === "getTransform") return { a: 2.5, b: 0 };
              if (name.includes("Gradient")) return { addColorStop: vi.fn() };
            }),
          );
        return calls.get(name);
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("cached battlefield hulls", () => {
  it("reuses every hull/team sprite while drawing turrets and HUD at frame time", () => {
    const create = vi.fn();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          create();
          return context().ctx;
        }
      },
    );
    const hulls: ShipState["hullClass"][] = [
      "strike_craft",
      "corvette",
      "cruiser",
      "battleship",
      "dreadnought",
      "missile_frigate",
      "tender",
      "carrier",
    ];
    for (const team of [0, 1] as const) {
      const ships = buildFleetFromSlots(
        hulls.map((hullClass) => ({ id: hullClass, hullClass, groupId: 1 })),
        team,
        0,
        0,
      );
      for (const ship of ships) {
        const { ctx, calls } = context();
        renderShip(ctx, ship, false, [], 0);
        const first = calls.get("drawImage")?.mock.calls[0]?.[0];
        ship.heading += 0.7;
        ship.velocity = [ship.maxSpeed, 0];
        ship.turrets[0].currentLocalAngle += 0.3;
        renderShip(ctx, ship, false, [], 2);
        expect(calls.get("drawImage")).toHaveBeenCalledTimes(2);
        expect(calls.get("drawImage")?.mock.calls[1]?.[0]).toBe(first);
        expect(calls.get("rotate")).toHaveBeenCalledWith(ship.heading);
        expect(calls.get("rotate")).toHaveBeenCalledWith(
          ship.heading + ship.turrets[0].currentLocalAngle,
        );
        expect(calls.get("fillRect")).toHaveBeenCalled();
        // Static mounts and fixed-width strokes must not be reused after layout/size changes.
        ship.turrets[0].offset[0] += 1;
        ship.size += 0.5;
        renderShip(ctx, ship);
        expect(calls.get("drawImage")?.mock.calls[2]?.[0]).not.toBe(first);
      }
    }
    expect(create).toHaveBeenCalledTimes(32);
  });

  it("retains procedural hulls when offscreen rendering is unavailable", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const [ship] = buildFleetFromSlots(
      [{ id: "fallback", hullClass: "cruiser", groupId: 1 }],
      0,
      0,
      0,
    );
    const { ctx, calls } = context();
    renderShip(ctx, ship);
    expect(calls.get("drawImage")).toBeUndefined();
    expect(calls.get("lineTo")).toHaveBeenCalledWith(ship.size * 0.6, -ship.size * 0.38);
  });
});
