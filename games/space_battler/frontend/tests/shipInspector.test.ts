import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderShipPreview } from "../src/canvas/shipRenderer";
import { inspectorFeatures } from "../src/components/inspectorFeatures";
import { ShipInspectorModal } from "../src/components/ShipInspectorModal";
import { buildFleetFromSlots } from "../src/engine/fleetBuilder";
import { HULL_PROFILES } from "../src/engine/shipProfiles";

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as (() => undefined | (() => void))[],
  stateChanges: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    hooks.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => undefined | (() => void)) => hooks.effects.push(effect),
  useState: (initial: unknown) => [initial, (value: unknown) => hooks.stateChanges.push(value)],
}));

vi.mock("../src/canvas/shipRenderer", () => ({ renderShipPreview: vi.fn() }));

type Props = {
  children?: ReactNode;
  onClick: (event?: unknown) => void;
  onCancel: (event: unknown) => void;
  onPointerDown: (event: unknown) => void;
  onPointerMove: (event: unknown) => void;
  onPointerUp: (event: unknown) => void;
  onWheel: (event: unknown) => void;
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
    hooks.stateChanges = [];
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
    vi.stubGlobal("performance", { now: () => 200 });
    const surface = {
      getContext: () => ctx,
      setPointerCapture: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 480 }),
      width: 0,
      height: 0,
    };
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const tree = ShipInspectorModal({ hull: "corvette", team: 1, onClose: vi.fn() });
    hooks.refs[0].current = dialog;
    hooks.refs[1].current = surface;
    const cleanups = hooks.effects.map((effect) => effect());
    const canvas = elements(tree).find((element) => element.type === "canvas");
    const recenter = elements(tree).find(
      (element) => element.type === "button" && String(element.props.children).includes("Recenter"),
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
    expect(headings[2]).toBeCloseTo(headings[1] - 1);
    let [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(Math.sin((5 * Math.PI) / 180));
    expect(vi.mocked(renderShipPreview).mock.calls.at(-1)?.[3]).toBeCloseTo((5 * Math.PI) / 180);
    canvas.props.onPointerMove({ ...pointer, clientX: 200, clientY: 2000 });
    step(150);
    [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(Math.sin((85 * Math.PI) / 180));
    expect(vi.mocked(renderShipPreview).mock.calls.at(-1)?.[3]).toBeCloseTo((85 * Math.PI) / 180);
    step(200);
    expect(headings.at(-1)).toBe(headings.at(-2));
    canvas.props.onPointerUp(pointer);
    step(250);
    expect(headings.at(-1)).toBe(headings.at(-2));
    step(6199);
    expect(headings.at(-1)).toBe(headings.at(-2));
    step(6200);
    expect(headings.at(-1)).toBeGreaterThan(headings.at(-2) ?? 0);

    const zoomIn = elements(tree).find((element) => element.props["aria-label"] === "Zoom in");
    zoomIn?.props.onClick();
    step(6250);
    expect((ctx.scale.mock.calls.at(-1) as number[])[0]).toBeCloseTo(
      (160 / HULL_PROFILES.corvette.size) * 1.2,
    );
    canvas.props.onWheel({ deltaY: 10000, preventDefault: vi.fn() });
    step(6300);
    expect((ctx.scale.mock.calls.at(-1) as number[])[0]).toBeCloseTo(
      (160 / HULL_PROFILES.corvette.size) * 0.6,
    );
    const pause = elements(tree).find(
      (element) =>
        element.type === "button" && String(element.props.children).includes("Pause Rotation"),
    );
    pause?.props.onClick();
    expect(hooks.stateChanges).toContain(true);
    step(6350);
    expect(headings.at(-1)).toBe(headings.at(-2));
    pause?.props.onClick();
    step(6400);
    expect(headings.at(-1)).toBeGreaterThan(headings.at(-2) ?? 0);

    recenter.props.onClick();
    step(6450);
    expect(headings.at(-1)).toBeGreaterThan(headings.at(-2) ?? 0);
    for (let time = 6500; time < 9500; time += 50) {
      step(time);
      if (headings.at(-1) === Math.PI / 4) break;
    }
    expect(headings.at(-1)).toBe(Math.PI / 4);
    [xScale, yScale] = ctx.scale.mock.calls.at(-1) as number[];
    expect(yScale / xScale).toBeCloseTo(0.5);
    expect(xScale).toBeCloseTo(160 / HULL_PROFILES.corvette.size);
    step(9500);
    expect(headings.at(-1)).toBeGreaterThan(Math.PI / 4);
    for (const cleanup of cleanups) cleanup?.();
    expect(frames.size).toBe(0);
    expect(dialog.close).toHaveBeenCalledOnce();
  });

  it("selects a turret at its projected canvas position", () => {
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ctx = new Proxy({}, { get: () => vi.fn(), set: () => true });
    const surface = {
      getContext: () => ctx,
      setPointerCapture: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 480 }),
    };
    const tree = ShipInspectorModal({ hull: "corvette", team: 0, onClose: vi.fn() });
    hooks.refs[0].current = { showModal: vi.fn(), close: vi.fn() };
    hooks.refs[1].current = surface;
    hooks.effects.forEach((effect) => {
      effect();
    });
    frame(0);
    const [ship] = buildFleetFromSlots(
      [{ id: "inspector", hullClass: "corvette", groupId: 1 }],
      0,
      0,
      0,
    );
    const turret = inspectorFeatures(ship, Math.PI / 4, Math.PI / 6, 1)[0];
    const canvas = elements(tree).find((element) => element.type === "canvas");
    const pointer = {
      pointerId: 1,
      button: 0,
      clientX: turret.x,
      clientY: turret.y,
      currentTarget: surface,
    };
    canvas?.props.onPointerDown(pointer);
    canvas?.props.onPointerUp(pointer);
    expect(hooks.stateChanges).toContainEqual(
      expect.objectContaining({ id: turret.id, title: ship.turrets[0].weapon.name }),
    );
    const engine = inspectorFeatures(ship, Math.PI / 4, Math.PI / 6, 1).find(
      (feature) => feature.id === "engine-0",
    );
    if (!engine) throw new Error("Engine target missing");
    const enginePointer = { ...pointer, clientX: engine.x, clientY: engine.y };
    canvas?.props.onPointerDown(enginePointer);
    canvas?.props.onPointerUp(enginePointer);
    expect(hooks.stateChanges).toContainEqual(expect.objectContaining({ id: "engine-0" }));
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
