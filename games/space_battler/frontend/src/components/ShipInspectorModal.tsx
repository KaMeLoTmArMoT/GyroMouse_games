import { Pause, Play, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renderShipPreview } from "../canvas/shipRenderer";
import { buildFleetFromSlots } from "../engine/fleetBuilder";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { HullClass } from "../types/combat";
import { hitInspectorFeature, type InspectorFeature, inspectorFeatures } from "./inspectorFeatures";

const WIDTH = 720;
const HEIGHT = 480;
const DEFAULT_YAW = Math.PI / 4;
const MAX_PITCH = Math.PI / 3;

export function ShipInspectorModal({
  hull,
  team,
  onClose,
}: {
  hull: HullClass;
  team: 0 | 1;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({
    yaw: DEFAULT_YAW,
    pitch: 0,
    pointer: null as number | null,
    x: 0,
    y: 0,
    resetting: false,
    zoom: 1,
    paused: false,
    resumeAt: 0,
    dragged: false,
    startX: 0,
    startY: 0,
  });
  const features = useRef<InspectorFeature[]>([]);
  const hover = useRef<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<InspectorFeature | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.round(WIDTH * pixelRatio);
    element.height = Math.round(HEIGHT * pixelRatio);
    ctx.setTransform(element.width / WIDTH, 0, 0, element.height / HEIGHT, 0, 0);
    ctx.imageSmoothingQuality = "high";
    // React's delegated wheel listener is passive; prevent the dialog from scrolling while zooming.
    const preventWheelScroll = (event: WheelEvent) => event.preventDefault();
    element.addEventListener("wheel", preventWheelScroll, { passive: false });

    const [ship] = buildFleetFromSlots(
      [{ id: "inspector", hullClass: hull, groupId: 1 }],
      team,
      0,
      0,
    );
    ship.velocity = [ship.maxSpeed * 0.65, 0];
    let frame: number;
    let previousTime: number | undefined;
    const draw = (time: number) => {
      const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const current = view.current;
      if (current.resetting) {
        const yawDelta = Math.atan2(
          Math.sin(DEFAULT_YAW - current.yaw),
          Math.cos(DEFAULT_YAW - current.yaw),
        );
        const blend = 1 - Math.exp(-6 * delta);
        current.yaw += yawDelta * blend;
        current.pitch += -current.pitch * blend;
        current.zoom += (1 - current.zoom) * blend;
        if (
          Math.abs(yawDelta) < 0.002 &&
          Math.abs(current.pitch) < 0.002 &&
          Math.abs(current.zoom - 1) < 0.002
        ) {
          current.yaw = DEFAULT_YAW;
          current.pitch = 0;
          current.zoom = 1;
          current.resetting = false;
        }
      } else if (current.pointer === null && !current.paused && time >= current.resumeAt) {
        current.yaw += delta * 0.2;
      }

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.save();
      ctx.translate(WIDTH / 2, HEIGHT / 2);
      // The procedural model is a 2.5D deck. Keep its projection above the horizon
      // while mapping the full drag range to a 5°–85° view, centered on 30°.
      const elevation = Math.PI / 6 + current.pitch * (current.pitch < 0 ? 25 / 60 : 55 / 60);
      const scale = (160 / ship.size) * current.zoom;
      ctx.scale(scale, scale * Math.sin(elevation));

      const pulse = 0.5 + 0.5 * Math.sin(time / 700);
      ctx.strokeStyle =
        team === 0
          ? `rgba(56, 189, 248, ${0.12 + pulse * 0.12})`
          : `rgba(248, 113, 113, ${0.12 + pulse * 0.12})`;
      ctx.lineWidth = ship.size * 0.012;
      ctx.beginPath();
      ctx.arc(0, 0, ship.size * (1.42 + pulse * 0.03), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = team === 0 ? "#7dd3fc" : "#fda4af";
      ctx.globalAlpha = 0.35 + pulse * 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(0, side * ship.size * 1.42, ship.size * (0.025 + pulse * 0.015), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ship.heading = current.yaw;
      renderShipPreview(ctx, ship, time / 1000, elevation);
      ctx.restore();
      features.current = inspectorFeatures(ship, current.yaw, elevation, current.zoom);
      const highlighted = features.current.find((feature) => feature.id === hover.current);
      if (highlighted) {
        ctx.save();
        ctx.strokeStyle = team === 0 ? "#7dd3fc" : "#fda4af";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(highlighted.x, highlighted.y, highlighted.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", preventWheelScroll);
    };
  }, [hull, team]);

  const endDrag = (pointerId: number) => {
    if (view.current.pointer !== pointerId) return;
    if (view.current.dragged) view.current.resumeAt = performance.now() + 6000;
    view.current.pointer = null;
  };
  const setZoom = (value: number) => {
    view.current.zoom = Math.max(0.6, Math.min(2.5, value));
    view.current.resetting = false;
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * WIDTH) / rect.width,
      ((event.clientY - rect.top) * HEIGHT) / rect.height,
    ] as const;
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="ship-inspector-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
      className={`m-auto w-[min(48rem,calc(100%-2rem))] max-h-[90vh] overflow-y-auto rounded-xl border bg-zinc-950 p-0 text-zinc-100 shadow-2xl shadow-black/70 backdrop:bg-black/80 ${team === 1 ? "border-red-500/40" : "border-cyan-500/40"}`}
    >
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-3">
        <div>
          <p
            className={`text-[10px] font-mono uppercase tracking-[0.2em] ${team === 1 ? "text-red-400" : "text-cyan-400"}`}
          >
            {team === 1 ? "Opposing Force" : "Terran Task Force"} / Vessel inspection
          </p>
          <h2 id="ship-inspector-title" className="mt-1 text-lg font-semibold">
            {HULL_PROFILES[hull].name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close ship inspector"
          className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="relative overflow-hidden bg-[radial-gradient(ellipse_at_center,#112334_0%,#090d15_55%,#030508_100%)]">
        <canvas
          ref={canvas}
          width={WIDTH}
          height={HEIGHT}
          aria-label={`${HULL_PROFILES[hull].name} interactive ship preview. Drag to rotate.`}
          className="block w-full h-auto cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0 || view.current.pointer !== null) return;
            view.current.pointer = event.pointerId;
            view.current.x = event.clientX;
            view.current.y = event.clientY;
            view.current.startX = event.clientX;
            view.current.startY = event.clientY;
            view.current.dragged = false;
            view.current.resetting = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = view.current;
            if (current.pointer !== event.pointerId) {
              const [x, y] = point(event);
              hover.current = hitInspectorFeature(features.current, x, y)?.id ?? null;
              return;
            }
            if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 3)
              current.dragged = true;
            current.yaw -= (event.clientX - current.x) * 0.01;
            current.pitch = Math.max(
              -MAX_PITCH,
              Math.min(MAX_PITCH, current.pitch + (event.clientY - current.y) * 0.01),
            );
            current.x = event.clientX;
            current.y = event.clientY;
          }}
          onPointerUp={(event) => {
            if (view.current.pointer === event.pointerId && !view.current.dragged) {
              const [x, y] = point(event);
              setSelected(hitInspectorFeature(features.current, x, y) ?? null);
            }
            endDrag(event.pointerId);
          }}
          onPointerCancel={(event) => endDrag(event.pointerId)}
          onLostPointerCapture={(event) => endDrag(event.pointerId)}
          onPointerLeave={() => {
            hover.current = null;
          }}
          onWheel={(event) => {
            setZoom(view.current.zoom * Math.exp(-event.deltaY * 0.001));
          }}
        />
        {selected && (
          <aside className="absolute right-3 top-3 max-w-60 rounded-lg border border-zinc-700 bg-zinc-950/90 p-3 text-xs text-zinc-300 shadow-lg">
            <h3 className="mb-1 font-semibold text-cyan-300">{selected.title}</h3>
            {selected.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </aside>
        )}
        <span className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          Drag to orbit · Click a subsystem · Scroll to zoom
        </span>
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(view.current.zoom / 1.2)}
          className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(view.current.zoom * 1.2)}
          className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            view.current.paused = !view.current.paused;
            setPaused(view.current.paused);
          }}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{" "}
          {paused ? "Resume Rotation" : "Pause Rotation"}
        </button>
        <button
          type="button"
          onClick={() => {
            view.current.pointer = null;
            view.current.resetting = true;
            view.current.resumeAt = performance.now() + 6000;
          }}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${team === 1 ? "border-red-900 text-red-300 hover:bg-red-950" : "border-cyan-800 text-cyan-300 hover:bg-cyan-950"}`}
        >
          <RotateCcw className="h-4 w-4" /> Recenter
        </button>
      </footer>
    </dialog>
  );
}
