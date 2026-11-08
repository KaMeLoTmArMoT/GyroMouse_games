import { afterEach, describe, expect, it, vi } from "vitest";
import { previewDepthFactor } from "../src/canvas/previewDepth";
import { renderShip, renderShipPreview } from "../src/canvas/shipRenderer";
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
              if (name === "getTransform") return { a: 2.5, b: 0, c: 0, d: 2.5 };
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
    const hullSprites = new Set<unknown>();
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
        const light = ["strike_craft", "corvette", "missile_frigate"].includes(ship.hullClass);
        const deckIndex = light ? 4 : 0;
        renderShip(ctx, ship, false, [], 0);
        const first = calls.get("drawImage")?.mock.calls[deckIndex]?.[0];
        hullSprites.add(first);
        ship.heading += 0.7;
        ship.velocity = [ship.maxSpeed, 0];
        ship.turrets[0].currentLocalAngle += 0.3;
        renderShip(ctx, ship, false, [], 2);
        const imagesPerFrame = 1 + (light ? 4 + ship.turrets.length * 2 : 0);
        expect(calls.get("drawImage")).toHaveBeenCalledTimes(imagesPerFrame * 2);
        expect(calls.get("drawImage")?.mock.calls[imagesPerFrame + deckIndex]?.[0]).toBe(first);
        expect(calls.get("rotate")).toHaveBeenCalledWith(ship.heading);
        expect(calls.get("rotate")).toHaveBeenCalledWith(
          ship.heading + ship.turrets[0].currentLocalAngle,
        );
        expect(calls.get("fillRect")).toHaveBeenCalled();
        // Static mounts and fixed-width strokes must not be reused after layout/size changes.
        ship.turrets[0].offset[0] += 1;
        ship.size += 0.5;
        renderShip(ctx, ship);
        const resized = calls.get("drawImage")?.mock.calls[imagesPerFrame * 2 + deckIndex]?.[0];
        expect(resized).not.toBe(first);
        hullSprites.add(resized);
      }
    }
    expect(hullSprites.size).toBe(32);
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(32);
  });

  it("caches the stationary barbette and rotating turret separately without canvas shadows", () => {
    const offscreens: ReturnType<typeof context>[] = [];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          const value = context();
          offscreens.push(value);
          return value.ctx;
        }
      },
    );
    const [ship] = buildFleetFromSlots(
      [{ id: "light-depth", hullClass: "strike_craft", groupId: 1 }],
      0,
      0,
      0,
    );
    ship.turrets[0].baseRadius = 2.73;
    const { ctx, calls } = context();
    renderShip(ctx, ship);
    expect(offscreens).toHaveLength(4);
    const keelSprite = calls.get("drawImage")?.mock.calls[0]?.[0];
    const barbetteSprite = calls.get("drawImage")?.mock.calls[5]?.[0];
    const turretSprite = calls.get("drawImage")?.mock.calls[6]?.[0];
    expect(offscreens[2].calls.get("scale")).toHaveBeenCalledWith(4, 4);
    expect(offscreens[2].calls.get("ellipse")).toHaveBeenCalled();
    expect(offscreens[2].calls.get("arc")).toHaveBeenCalled();
    expect(offscreens.every(({ ctx: canvas }) => !("shadowBlur" in canvas))).toBe(true);
    const strokes = offscreens[3].calls.get("stroke")?.mock.calls.length;
    ship.turrets[0].currentLocalAngle = 0.8;
    ship.heading = Math.PI / 2;
    renderShip(ctx, ship);
    expect(offscreens).toHaveLength(4);
    expect(offscreens[3].calls.get("stroke")?.mock.calls.length).toBe(strokes);
    const secondKeel = calls.get("drawImage")?.mock.calls[7];
    expect(secondKeel?.[0]).toBe(keelSprite);
    const keelWidth = (keelSprite as { width: number }).width / 4;
    expect(secondKeel?.[1]).toBeCloseTo(-keelWidth / 2 + ship.size * 0.24);
    expect(secondKeel?.[2]).toBeCloseTo(-keelWidth / 2);
    expect(calls.get("drawImage")?.mock.calls[12]?.[0]).toBe(barbetteSprite);
    expect(calls.get("drawImage")?.mock.calls[13]?.[0]).toBe(turretSprite);
    expect(calls.get("translate")).toHaveBeenCalledWith(0, -ship.turrets[0].baseRadius * 0.7);
    expect(calls.get("rotate")).toHaveBeenCalledWith(ship.heading + 0.8);
  });

  it("projects the preview keel vertically at every heading and elevation", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    for (const team of [0, 1] as const) {
      for (const hullClass of ["strike_craft", "corvette", "missile_frigate"] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        for (const heading of [0, Math.PI / 4, Math.PI / 2]) {
          ship.heading = heading;
          for (const elevation of [Math.PI / 36, Math.PI / 6, Math.PI / 2]) {
            const { ctx, calls } = context();
            renderShipPreview(ctx, ship, 0, elevation);
            const length = ship.size * 0.3 * previewDepthFactor(elevation);
            const x = Math.sin(heading) * length;
            const y = Math.cos(heading) * length;
            if (elevation === Math.PI / 2) {
              expect(Math.abs(length)).toBeLessThan(1e-10);
              continue;
            }
            expect(
              calls.get("translate")?.mock.calls.some(([tx, ty]) => {
                return Math.abs(tx - x) < 1e-10 && Math.abs(ty - y) < 1e-10;
              }),
            ).toBe(true);
            expect(
              (x * Math.sin(heading) + y * Math.cos(heading)) * Math.sin(elevation),
            ).toBeCloseTo(ship.size * 0.3 * Math.cos(elevation));
          }
        }
      }
    }
  });

  it("retains the hull clip for Terran capital details after preview lighting", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    for (const hullClass of ["cruiser", "battleship"] as const) {
      const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], 0, 0, 0);
      ship.heading = 0;
      const { ctx, calls } = context();
      renderShipPreview(ctx, ship, 0);

      const moves = calls.get("moveTo");
      const translations = calls.get("translate");
      expect(moves).toBeDefined();
      expect(translations).toBeDefined();
      if (!moves || !translations) throw new Error("Preview did not draw the hull or turret");
      const lightIndex = moves.mock.calls.findIndex(
        ([x, y]) => x === -ship.size * 0.8 && y === ship.size * 0.31,
      );
      const turretIndex = translations.mock.calls.findIndex(
        ([x, y]) => x === ship.turrets[0].offset[0] && y === ship.turrets[0].offset[1],
      );
      expect(lightIndex).toBeGreaterThanOrEqual(0);
      expect(turretIndex).toBeGreaterThanOrEqual(0);
      const lightOrder = moves.mock.invocationCallOrder[lightIndex];
      const turretOrder = translations.mock.invocationCallOrder[turretIndex];
      expect(
        calls
          .get("clip")
          ?.mock.invocationCallOrder.filter((order) => order > lightOrder && order < turretOrder),
      ).toEqual([]);
    }
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
