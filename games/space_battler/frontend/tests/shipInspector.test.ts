import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderShipPreview } from "../src/canvas/shipRenderer";
import { ShipInspectorModal } from "../src/components/ShipInspectorModal";

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as (() => undefined | (() => void))[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    hooks.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => undefined | (() => void)) => hooks.effects.push(effect),
}));

vi.mock("../src/canvas/shipRenderer", () => ({ renderShipPreview: vi.fn() }));

type Props = {
  children?: ReactNode;
  onClick: (event?: unknown) => void;
  onCancel: (event: unknown) => void;
  onPointerDown: (event: unknown) => void;
  onPointerMove: (event: unknown) => void;
  onPointerUp: (event: unknown) => void;
  "aria-label"?: string;
};

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

describe("ship inspector", () => {
  beforeEach(() => {
    hooks.refs = [];
    hooks.effects = [];
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("orbits with drag, clamps elevation, and smoothly recenters before resuming idle rotation", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const step = (time: number) => {
      const [id, callback] = [...frames][0];
      frames.delete(id);
      callback(time);
    };
    const ctx = new Proxy(
      { scale: vi.fn() },
      {
        get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn()),
        set: () => true,
      },
    );
    const surface = { getContext: () => ctx, setPointerCapture: vi.fn(), width: 0, height: 0 };
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const tree = ShipInspectorModal({ hull: "corvette", team: 1, onClose: vi.fn() });
    hooks.refs[0].current = dialog;
    hooks.refs[1].current = surface;
    const cleanups = hooks.effects.map((effect) => effect());
    const canvas = elements(tree).find((element) => element.type === "canvas");
    const recenter = elements(tree).find(
      (element) => element.type === "button" && element.props["aria-label"] === undefined,
    );
    if (!canvas || !recenter) throw new Error("Inspector controls missing");
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect([surface.width, surface.height]).toEqual([1440, 960]);

    const headings: number[] = [];
    vi.mocked(renderShipPreview).mockImplementation((_ctx, ship) => headings.push(ship.heading));
    step(0);
    step(50);
    expect(headings[1]).toBeGreaterThan(headings[0]);
    const pointer = { pointerId: 1, button: 0, clientX: 100, clientY: 100, currentTarget: surface };
    canvas.props.onPointerDown(pointer);
    canvas.props.onPointerMove({ ...pointer, clientX: 200, clientY: -1000 });
    step(100);
    expect(headings[2]).toBeCloseTo(headings[1] + 1);
    let [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(Math.sin((85 * Math.PI) / 180));
    canvas.props.onPointerMove({ ...pointer, clientX: 200, clientY: 2000 });
    step(150);
    [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(Math.sin((5 * Math.PI) / 180));
    step(200);
    expect(headings.at(-1)).toBe(headings.at(-2));
    canvas.props.onPointerUp(pointer);
    step(250);
    expect(headings.at(-1)).toBeGreaterThan(headings.at(-2) ?? 0);

    recenter.props.onClick();
    step(300);
    expect(headings.at(-1)).toBeLessThan(headings.at(-2) ?? 0);
    for (let time = 350; time < 3000; time += 50) {
      step(time);
      if (headings.at(-1) === Math.PI / 4) break;
    }
    expect(headings.at(-1)).toBe(Math.PI / 4);
    [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(0.5);
    step(3000);
    expect(headings.at(-1)).toBeGreaterThan(Math.PI / 4);
    for (const cleanup of cleanups) cleanup?.();
    expect(frames.size).toBe(0);
    expect(dialog.close).toHaveBeenCalledOnce();
  });

  it("closes via escape, the close button, or an outside click", () => {
    const onClose = vi.fn();
    const tree = ShipInspectorModal({ hull: "carrier", team: 0, onClose });
    const close = elements(tree).find(
      (element) => element.props["aria-label"] === "Close ship inspector",
    );
    close?.props.onClick();
    const preventDefault = vi.fn();
    tree.props.onCancel({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    const target = {
      getBoundingClientRect: () => ({ left: 10, right: 100, top: 20, bottom: 100 }),
    };
    tree.props.onClick({ target, currentTarget: target, clientX: 50, clientY: 50 });
    expect(onClose).toHaveBeenCalledTimes(2);
    tree.props.onClick({ target, currentTarget: target, clientX: 5, clientY: 50 });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
