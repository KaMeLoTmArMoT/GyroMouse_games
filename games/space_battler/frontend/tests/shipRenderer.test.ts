import { afterEach, describe, expect, it, vi } from "vitest";
import { traceHeavyHull } from "../src/canvas/capitalHullDepth";
import { engineNozzles } from "../src/canvas/effects";
import { drawPreviewDeckDetail, previewDeckDetails } from "../src/canvas/previewDeckDetails";
import * as previewDepth from "../src/canvas/previewDepth";
import { previewDepthFactor } from "../src/canvas/previewDepth";
import { renderShip, renderShipPreview } from "../src/canvas/shipRenderer";
import * as turretRenderer from "../src/canvas/turretRenderer";
import { inspectorFeatures } from "../src/components/inspectorFeatures";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { rotatePoint } from "../src/engine/math2d";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cached battlefield hulls", () => {
  it("projects low deck details vertically for every hull and faction", () => {
    for (const team of [0, 1] as const) {
      for (const hullClass of [
        "strike_craft",
        "corvette",
        "missile_frigate",
        "tender",
        "cruiser",
        "battleship",
        "dreadnought",
        "carrier",
      ] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        const details = previewDeckDetails(ship);
        expect(details.length).toBeGreaterThan(0);
        ship.heading = Math.PI / 3;
        for (const detail of details) {
          expect(detail.height).toBeGreaterThan(0);
          expect(detail.height).toBeLessThanOrEqual(0.08);
          const { ctx, calls } = context();
          const depth = previewDepthFactor(Math.PI / 6);
          drawPreviewDeckDetail(ctx, ship, detail, depth);
          const [ux, uy] = rotatePoint([0, -detail.height * ship.size * depth], -ship.heading);
          const [x, y] = detail.points[0];
          expect(calls.get("moveTo")).toHaveBeenCalledWith(x * ship.size + ux, y * ship.size + uy);
          expect(rotatePoint([ux, uy], ship.heading)[1]).toBeCloseTo(
            -detail.height * ship.size * depth,
          );
        }
      }
    }
  });

  it("keeps the corvette bridge clear of its turrets and occludes by camera depth", () => {
    const [ship] = buildFleetFromSlots(
      [{ id: "corvette-bridge", hullClass: "corvette", groupId: 1 }],
      0,
      0,
      0,
    );
    const bridge = previewDepth.previewBridge(ship);
    for (const turret of ship.turrets) {
      expect(turret.offset[0] + turret.baseRadius).toBeLessThan(bridge.x - ship.size * 0.18);
    }
    const order: string[] = [];
    vi.spyOn(previewDepth, "drawPreviewSuperstructure").mockImplementation(() =>
      order.push("bridge"),
    );
    vi.spyOn(turretRenderer, "renderTurret").mockImplementation((_ctx, _ship, turret) => {
      order.push(String(ship.turrets.indexOf(turret)));
    });
    for (const [heading, expected] of [
      [0, ["0", "bridge", "1"]],
      [Math.PI, ["1", "bridge", "0"]],
    ] as const) {
      ship.heading = heading;
      order.length = 0;
      renderShipPreview(context().ctx, ship, 0, Math.PI / 36);
      expect(order).toEqual(expected);
    }
  });

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
        renderShip(ctx, ship, false, [], 0);
        const first = calls.get("drawImage")?.mock.calls[0]?.[0];
        hullSprites.add(first);
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
        const resized = calls.get("drawImage")?.mock.calls[2]?.[0];
        expect(resized).not.toBe(first);
        hullSprites.add(resized);
      }
    }
    expect(hullSprites.size).toBe(32);
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(32);
  });

  it("draws light turret and bridge details at both top-down and tilted elevations", () => {
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
    const turret = vi.spyOn(turretRenderer, "renderTurret");
    const bridge = vi.spyOn(previewDepth, "drawPreviewSuperstructure");
    const { ctx, calls } = context();
    renderShip(ctx, ship);
    expect(offscreens).toHaveLength(1);
    const deckSprite = calls.get("drawImage")?.mock.calls[0]?.[0];
    expect(turret).toHaveBeenCalledTimes(ship.turrets.length);
    expect(turret.mock.calls.find((call) => call[2] === ship.turrets[0])?.[4]).toBeCloseTo(0);
    expect(bridge.mock.calls[0][2]).toBe(1e-9);
    ship.turrets[0].currentLocalAngle = 0.8;
    ship.heading = Math.PI / 2;
    const elevation = Math.PI / 6;
    const depth = previewDepthFactor(elevation);
    renderShip(ctx, ship, false, [], 0, elevation);
    expect(offscreens).toHaveLength(1);
    expect(calls.get("drawImage")?.mock.calls[1]?.[0]).toBe(deckSprite);
    expect(turret).toHaveBeenCalledTimes(ship.turrets.length * 2);
    expect(turret.mock.calls.slice(ship.turrets.length).every((call) => call[4] === depth)).toBe(
      true,
    );
    expect(bridge.mock.calls[1][2]).toBe(depth);
    expect(calls.get("translate")).toHaveBeenCalledWith(
      0,
      -ship.turrets[0].baseRadius * 0.25 * depth,
    );
    expect(calls.get("rotate")).toHaveBeenCalledWith(ship.heading + 0.8);
  });

  it("projects the preview keel vertically at every heading and elevation", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    for (const team of [0, 1] as const) {
      for (const hullClass of ["strike_craft", "corvette", "missile_frigate", "tender"] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        for (const heading of [0, Math.PI / 4, Math.PI / 2]) {
          ship.heading = heading;
          for (const elevation of [Math.PI / 36, Math.PI / 6, Math.PI / 2]) {
            const { ctx, calls } = context();
            renderShipPreview(ctx, ship, 0, elevation);
            const length = ship.size * 0.24 * previewDepthFactor(elevation);
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
            ).toBeCloseTo(ship.size * 0.24 * Math.cos(elevation));
          }
        }
      }
    }
  });

  it("preserves natural depth and turret collar height at shallow elevations", () => {
    expect(previewDepthFactor(Math.PI / 36)).toBeCloseTo(1 / Math.tan(Math.PI / 36));
    expect(previewDepthFactor(Math.PI / 36)).toBeGreaterThan(2);
    expect(previewDepthFactor(Math.PI / 6)).toBeCloseTo(Math.sqrt(3));
    expect(previewDepthFactor(Math.PI / 2)).toBeCloseTo(0);
    vi.stubGlobal("OffscreenCanvas", undefined);
    const [ship] = buildFleetFromSlots(
      [{ id: "profile", hullClass: "battleship", groupId: 1 }],
      0,
      0,
      0,
    );
    ship.heading = 0.6;
    const turret = ship.turrets[0];
    turret.currentLocalAngle = -0.3;
    for (const r of [2.2, 8, 16]) {
      turret.baseRadius = r;
      for (const depth of [0, 1, 2, 1 / Math.tan(Math.PI / 36)]) {
        const { ctx, calls } = context();
        turretRenderer.renderTurret(ctx, ship, turret, "#38bdf8", depth);
        expect(calls.get("translate")).toHaveBeenCalledWith(0, -r * 0.35 * depth);
      }
    }
  });

  it("aligns inspector targets with the restored turret and bridge heights", () => {
    for (const team of [0, 1] as const) {
      for (const hullClass of [
        "corvette",
        "missile_frigate",
        "tender",
        "cruiser",
        "battleship",
        "dreadnought",
        "carrier",
      ] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        for (const heading of [0, Math.PI / 4, -Math.PI / 2]) {
          for (const elevation of [Math.PI / 36, Math.PI / 6, (85 * Math.PI) / 180]) {
            const zoom = 1.5;
            const scale = (160 / ship.size) * zoom;
            const features = inspectorFeatures(ship, heading, elevation, zoom);
            for (const [index, turret] of ship.turrets.entries()) {
              const [x, y] = rotatePoint(turret.offset, heading);
              expect(features[index].x).toBeCloseTo(360 + x * scale);
              expect(features[index].y).toBeCloseTo(
                240 +
                  (y * Math.sin(elevation) -
                    (previewDepth.previewTerraceHeight(ship, turret) + turret.baseRadius * 0.35) *
                      Math.cos(elevation)) *
                    scale,
              );
            }
            const bridge = features.find((feature) => feature.id === "bridge");
            if (!bridge) throw new Error("Bridge target missing");
            const bridgeGeometry = previewDepth.previewBridge(ship);
            const [x, y] = rotatePoint([bridgeGeometry.x, bridgeGeometry.y], heading);
            expect(bridge.x).toBeCloseTo(360 + x * scale);
            expect(bridge.y).toBeCloseTo(
              240 + (y * Math.sin(elevation) - bridgeGeometry.height * Math.cos(elevation)) * scale,
            );
          }
        }
      }
    }
  });

  it("paints turrets and the bridge back-to-front as the ship rotates", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const [ship] = buildFleetFromSlots(
      [{ id: "sorting", hullClass: "battleship", groupId: 1 }],
      0,
      0,
      0,
    );
    const order: string[] = [];
    vi.spyOn(previewDepth, "drawPreviewSuperstructure").mockImplementation(() => {
      order.push("bridge");
    });
    vi.spyOn(turretRenderer, "renderTurret").mockImplementation((_ctx, _ship, turret) => {
      order.push(String(ship.turrets.indexOf(turret)));
    });
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const elevation of [Math.PI / 36, Math.PI / 6, Math.PI / 2]) {
        ship.heading = heading;
        order.length = 0;
        renderShipPreview(context().ctx, ship, 0, elevation);
        const expected = ship.turrets.map((turret, index) => ({
          name: String(index),
          depth:
            (turret.offset[0] * Math.sin(heading) + turret.offset[1] * Math.cos(heading)) *
              Math.cos(elevation) +
            (previewDepth.previewTerraceHeight(ship, turret) + turret.baseRadius * 0.35) *
              Math.sin(elevation),
        }));
        const bridge = previewDepth.previewBridge(ship);
        expected.push({
          name: "bridge",
          depth:
            (bridge.x * Math.sin(heading) + bridge.y * Math.cos(heading)) * Math.cos(elevation) +
            bridge.height * Math.sin(elevation),
        });
        expected.sort((a, b) => a.depth - b.depth);
        expect(order).toEqual(expected.map((element) => element.name));
      }
    }
  });

  it("flares the preview keel at the chine and exposes aft-facing thruster ports", () => {
    const [ship] = buildFleetFromSlots(
      [{ id: "chine", hullClass: "corvette", groupId: 1 }],
      0,
      0,
      0,
    );
    const front = context();
    ship.heading = Math.PI / 2;
    previewDepth.drawPreviewKeel(front.ctx, ship, 1);
    expect(front.calls.get("scale")?.mock.calls[0][0]).toBeCloseTo(0.84);
    expect(front.calls.get("scale")).toHaveBeenCalledWith(1.03, 1.03);
    const aft = context();
    ship.heading = -Math.PI / 2;
    previewDepth.drawPreviewKeel(aft.ctx, ship, 1);
    expect(aft.calls.get("fill")?.mock.calls.length).toBe(
      (front.calls.get("fill")?.mock.calls.length ?? 0) + 4,
    );
  });

  it("uses the tender's actual deck outline and shaded keel for both factions", () => {
    for (const team of [0, 1] as const) {
      const [ship] = buildFleetFromSlots(
        [{ id: "tender", hullClass: "tender", groupId: 1 }],
        team,
        0,
        0,
      );
      const { ctx, calls } = context();
      previewDepth.drawPreviewKeel(ctx, ship, 1);
      expect(calls.get("createLinearGradient")).toHaveBeenCalledTimes(25);
      if (team === 0)
        expect(calls.get("lineTo")).toHaveBeenCalledWith(-ship.size * 0.82, -ship.size * 0.34);
      else expect(calls.get("bezierCurveTo")).toHaveBeenCalled();
    }
  });

  it("sweeps each heavy deck outline through a deeper shaded chine", () => {
    for (const team of [0, 1] as const) {
      for (const hullClass of ["cruiser", "battleship", "dreadnought", "carrier"] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        const outline = context();
        traceHeavyHull(outline.ctx, ship);
        const keel = context();
        previewDepth.drawPreviewKeel(keel.ctx, ship, 1);
        expect(previewDepth.previewKeelHeight(ship)).toBeCloseTo(ship.size * 0.32);
        expect(keel.calls.get("createLinearGradient")).toHaveBeenCalledTimes(25);
        for (const method of ["moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo"]) {
          const deckCalls = outline.calls.get(method)?.mock.calls ?? [];
          const keelCalls = keel.calls.get(method)?.mock.calls ?? [];
          expect(keelCalls.slice(0, deckCalls.length)).toEqual(deckCalls);
        }
      }
    }
  });

  it("aligns aft thruster targets with the recessed stern ports", () => {
    for (const team of [0, 1] as const) {
      for (const hullClass of [
        "strike_craft",
        "corvette",
        "missile_frigate",
        "tender",
        "cruiser",
        "battleship",
        "dreadnought",
        "carrier",
      ] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        const yaw = -Math.PI / 2;
        const elevation = Math.PI / 6;
        const scale = 160 / ship.size;
        const [, y] = engineNozzles(ship)[0];
        const keelScale = 1.03 - (0.6 - 1 / 3) * 0.285;
        const [x, projectedY] = rotatePoint(
          [previewDepth.sternEdge(ship, y) * ship.size * keelScale, y * ship.size * keelScale],
          yaw,
        );
        const engine = inspectorFeatures(ship, yaw, elevation, 1).find(
          (feature) => feature.id === "engine-0",
        );
        expect(engine?.x).toBeCloseTo(360 + x * scale);
        expect(engine?.y).toBeCloseTo(
          240 +
            (projectedY * Math.sin(elevation) +
              previewDepth.previewKeelHeight(ship) * 0.6 * Math.cos(elevation)) *
              scale,
        );
      }
    }
  });

  it("sweeps low-profile light turrets vertically at any turret bearing", () => {
    for (const hullClass of ["corvette", "missile_frigate", "tender"] as const) {
      for (const team of [0, 1] as const) {
        const [ship] = buildFleetFromSlots([{ id: hullClass, hullClass, groupId: 1 }], team, 0, 0);
        ship.heading = 0.7;
        const turret = ship.turrets[0];
        turret.currentLocalAngle = -0.3;
        const depth = previewDepthFactor(Math.PI / 36);
        const { ctx, calls } = context();
        turretRenderer.renderTurret(ctx, ship, turret, "#38bdf8", depth);
        const collar = turret.baseRadius * 0.25 * depth;
        const cupola = turret.baseRadius * 0.1 * depth;
        expect(calls.get("translate")).toHaveBeenCalledWith(0, -collar);
        const [ux, uy] = rotatePoint([0, -cupola], -(ship.heading + turret.currentLocalAngle));
        expect(calls.get("translate")).toHaveBeenCalledWith(ux, uy);
        expect((collar + cupola) * Math.sin(Math.PI / 36)).toBeCloseTo(
          turret.baseRadius * 0.35 * Math.cos(Math.PI / 36),
        );
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
      const turretIndex = translations.mock.calls.findIndex(([x, y]) =>
        ship.turrets.some((turret) => x === turret.offset[0] && y === turret.offset[1]),
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
