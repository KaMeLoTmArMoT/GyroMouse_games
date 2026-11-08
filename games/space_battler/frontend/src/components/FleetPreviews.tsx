import { useEffect, useRef, useState } from "react";
import { renderShipPreview } from "../canvas/shipRenderer";
import { buildFleetFromSlots, GROUP_ANCHORS } from "../engine/fleetBuilder";
import type { HullClass } from "../types/combat";

export function useDelayedPreview<T>(delay: number) {
  const [active, setActive] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const show = (value: T) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setActive(null);
    timer.current = setTimeout(() => {
      setActive(value);
      timer.current = null;
    }, delay);
  };
  const hide = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setActive(null);
  };
  return { active, show, hide };
}

export function ShipPreview({ hull, team }: { hull: HullClass; team: 0 | 1 }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.round(280 * pixelRatio);
    element.height = Math.round(168 * pixelRatio);
    ctx.setTransform(element.width / 280, 0, 0, element.height / 168, 0, 0);
    ctx.imageSmoothingQuality = "high";
    const ship = buildFleetFromSlots(
      [{ id: "preview", hullClass: hull, groupId: 1 }],
      team,
      0,
      0,
    )[0];
    ship.velocity = [ship.maxSpeed * 0.65, 0];
    let frame: number;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, 280, 168);
      ctx.save();
      const halo = ctx.createRadialGradient(140, 84, 4, 140, 84, 116);
      halo.addColorStop(0, team === 1 ? "rgba(220, 38, 38, 0.18)" : "rgba(8, 145, 178, 0.18)");
      halo.addColorStop(1, team === 1 ? "rgba(220, 38, 38, 0)" : "rgba(8, 145, 178, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, 280, 168);
      ctx.translate(140, 79);
      // Orthographic projection at 30° above the deck, with a rotating three-quarter view.
      ctx.scale(58 / ship.size, (58 * Math.sin(Math.PI / 6)) / ship.size);
      ship.heading = Math.PI / 4 + time / 5000;
      renderShipPreview(ctx, ship, time / 1000);
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [hull, team]);

  return (
    <div
      className={`absolute z-20 top-2 right-2 w-72 pointer-events-none rounded-lg border bg-zinc-950/95 shadow-xl ${team === 1 ? "border-red-500/50 shadow-red-950/40" : "border-cyan-500/50 shadow-cyan-950/40"}`}
    >
      <canvas
        ref={canvas}
        width={280}
        height={168}
        className="w-full h-auto rounded-lg"
        aria-hidden="true"
      />
    </div>
  );
}

const GROUP_ROLES = [
  "Center Vanguard",
  "Lower Flank",
  "Upper Flank",
  "Rear Guard",
  "Forward Spear",
];
const GROUP_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];

export function GroupPreview({ group, team }: { group: number; team: 0 | 1 }) {
  return (
    <div
      className={`absolute z-30 right-2 top-full mt-1 pointer-events-none rounded-lg border bg-zinc-950 p-3 shadow-xl normal-case tracking-normal ${team === 1 ? "border-red-500/40" : "border-cyan-500/40"}`}
    >
      <div
        className={`text-xs font-semibold whitespace-nowrap ${team === 1 ? "text-red-200" : "text-cyan-200"}`}
      >
        {GROUP_NAMES[group - 1]}: {GROUP_ROLES[group - 1]}
      </div>
      <svg
        viewBox="0 0 160 110"
        className="w-40 h-28"
        role="img"
        aria-label="Fleet spawn anchors, facing right"
      >
        <circle cx="80" cy="55" r="48" fill="none" stroke="#334155" />
        <path d="M 24 55 H 136 M 80 5 V 105" stroke="#334155" strokeDasharray="3 4" />
        <path d="M 136 50 L 142 55 L 136 60" fill="none" stroke="#64748b" />
        {[1, 2, 3, 4, 5].map((id) => {
          const [x, y] = GROUP_ANCHORS[id];
          return (
            <circle
              key={id}
              cx={80 + x * 0.12}
              cy={55 + y * 0.09}
              r={id === group ? 5 : 3}
              fill={id === group ? (team === 1 ? "#f87171" : "#67e8f9") : "#475569"}
            />
          );
        })}
      </svg>
      <div className="text-[10px] text-zinc-400 font-mono text-right">ENEMY →</div>
    </div>
  );
}
