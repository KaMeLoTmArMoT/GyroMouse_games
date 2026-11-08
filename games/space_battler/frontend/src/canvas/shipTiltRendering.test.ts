import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFleetFromSlots } from "../engine/fleetBuilder";
import * as previewDepth from "./previewDepth";
import { renderShip } from "./shipRenderer";

function context() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const ctx = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        const name = String(property);
        if (!calls.has(name)) {
          calls.set(
            name,
            vi.fn(() => {
              if (name === "getTransform") return { a: 1, b: 0, c: 0, d: 0.5 };
              if (name.includes("Gradient")) return { addColorStop: vi.fn() };
            }),
          );
        }
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

describe("tilted battlefield rendering", () => {
  it("reuses a carrier deck across headings under a nonuniform projection", () => {
    const create = vi.fn();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          create();
          return context().ctx;
        }
      },
    );
    const [ship] = buildFleetFromSlots(
      [{ id: "tilt-cache", hullClass: "carrier", groupId: 1 }],
      0,
      0,
      0,
    );
    ship.size += 0.123;
    const { ctx, calls } = context();
    void ctx.getTransform;
    const transform = calls.get("getTransform");
    // getTransform is requested before and after the hull rotation in each frame.
    const unrotated = { a: 1, b: 0, c: 0, d: 0.5 };
    transform
      ?.mockReturnValueOnce(unrotated)
      .mockReturnValueOnce(unrotated)
      .mockReturnValueOnce(unrotated)
      .mockReturnValueOnce({ a: 0, b: 0.5, c: -1, d: 0 });
    const keel = vi.spyOn(previewDepth, "drawPreviewKeel");

    renderShip(ctx, ship, false, [], 0, Math.PI / 6);
    ship.heading = Math.PI / 2;
    renderShip(ctx, ship, false, [], 0, Math.PI / 6);

    expect(create).toHaveBeenCalledTimes(1);
    const images = calls.get("drawImage")?.mock.calls ?? [];
    expect(images).toHaveLength(2);
    expect(images[1][0]).toBe(images[0][0]);
    expect(keel).toHaveBeenCalledTimes(2);
  });

  it("keeps vector rendering available and reduces keel slices for small projected ships", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const [ship] = buildFleetFromSlots(
      [{ id: "tilt-fallback", hullClass: "strike_craft", groupId: 1 }],
      0,
      0,
      0,
    );
    const { ctx, calls } = context();
    vi.mocked(ctx.getTransform).mockReturnValue({ a: 0.3, b: 0, c: 0, d: 0.15 } as DOMMatrix);
    const keel = vi.spyOn(previewDepth, "drawPreviewKeel");

    renderShip(ctx, ship, false, [], 0, Math.PI / 6);

    expect(keel.mock.calls[0][3]).toBeLessThan(24);
    expect(calls.get("drawImage")).toBeUndefined();
    expect(calls.get("fill")).toHaveBeenCalled();
  });
});
