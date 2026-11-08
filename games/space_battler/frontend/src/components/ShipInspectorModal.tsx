import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { renderShipPreview } from "../canvas/shipRenderer";
import { buildFleetFromSlots } from "../engine/fleetBuilder";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { HullClass } from "../types/combat";

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
  });

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
        if (Math.abs(yawDelta) < 0.002 && Math.abs(current.pitch) < 0.002) {
          current.yaw = DEFAULT_YAW;
          current.pitch = 0;
          current.resetting = false;
        }
      } else if (current.pointer === null) {
        current.yaw += delta * 0.2;
      }

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.save();
      ctx.translate(WIDTH / 2, HEIGHT / 2);
      // The procedural model is a 2.5D deck. Keep its projection above the horizon
      // while mapping the full drag range to a 5°–85° view, centered on 30°.
      const elevation = Math.PI / 6 + current.pitch * (current.pitch < 0 ? 25 / 60 : 55 / 60);
      const scale = 160 / ship.size;
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
      renderShipPreview(ctx, ship, time / 1000);
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [hull, team]);

  const endDrag = (pointerId: number) => {
    if (view.current.pointer === pointerId) view.current.pointer = null;
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
            view.current.resetting = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = view.current;
            if (current.pointer !== event.pointerId) return;
            current.yaw += (event.clientX - current.x) * 0.01;
            current.pitch = Math.max(
              -MAX_PITCH,
              Math.min(MAX_PITCH, current.pitch - (event.clientY - current.y) * 0.01),
            );
            current.x = event.clientX;
            current.y = event.clientY;
          }}
          onPointerUp={(event) => endDrag(event.pointerId)}
          onPointerCancel={(event) => endDrag(event.pointerId)}
          onLostPointerCapture={(event) => endDrag(event.pointerId)}
        />
        <span className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          Drag to orbit · Release to rotate
        </span>
      </div>
      <footer className="flex justify-end border-t border-zinc-800 px-5 py-3">
        <button
          type="button"
          onClick={() => {
            view.current.pointer = null;
            view.current.resetting = true;
          }}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${team === 1 ? "border-red-900 text-red-300 hover:bg-red-950" : "border-cyan-800 text-cyan-300 hover:bg-cyan-950"}`}
        >
          <RotateCcw className="h-4 w-4" /> Recenter
        </button>
      </footer>
    </dialog>
  );
}
