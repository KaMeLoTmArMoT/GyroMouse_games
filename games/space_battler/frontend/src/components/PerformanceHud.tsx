import { useEffect, useRef, useState } from "react";

const HISTORY_SIZE = 160;

export class PerformanceSamples {
  frames: number[] = [];
  steps: number[] = [];

  addFrame = (duration: number) => {
    this.frames.push(duration);
    if (this.frames.length > HISTORY_SIZE) this.frames.shift();
  };

  addStep = (duration: number) => {
    this.steps.push(duration);
    if (this.steps.length > HISTORY_SIZE) this.steps.shift();
  };
}

function lowFps(sortedSlowestFirst: number[], fraction: number): string {
  if (!sortedSlowestFirst.length) return "—";
  const slowest = sortedSlowestFirst.slice(
    0,
    Math.max(1, Math.ceil(sortedSlowestFirst.length * fraction)),
  );
  return (1000 / (slowest.reduce((sum, frame) => sum + frame, 0) / slowest.length)).toFixed(1);
}

export function PerformanceHud({ samples }: { samples: PerformanceSamples }) {
  const graphRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState({ frames: [] as number[], steps: [] as number[] });

  useEffect(() => {
    const update = () => setSnapshot({ frames: [...samples.frames], steps: [...samples.steps] });
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [samples]);

  useEffect(() => {
    const canvas = graphRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    snapshot.frames.forEach((frame, index) => {
      const height = Math.max(1, Math.min(canvas.height, (frame / 50) * canvas.height));
      ctx.fillStyle = frame <= 16.7 ? "#34d399" : frame <= 33 ? "#fbbf24" : "#ef4444";
      ctx.fillRect(
        canvas.width - snapshot.frames.length + index,
        canvas.height - height,
        1,
        height,
      );
    });
  }, [snapshot.frames]);

  const frame = snapshot.frames.at(-1);
  const sorted = [...snapshot.frames].sort((a, b) => b - a);
  const step = snapshot.steps.length
    ? (snapshot.steps.reduce((sum, value) => sum + value, 0) * 1000) / snapshot.steps.length
    : null;

  return (
    <div className="absolute top-4 left-4 z-10 pointer-events-none rounded-lg border border-zinc-700/80 bg-zinc-950/85 p-3 font-mono text-[11px] text-zinc-400 shadow-lg backdrop-blur-sm">
      <div className="mb-2 font-semibold uppercase tracking-wider text-cyan-400">Performance</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span>
          FPS <span className="text-zinc-100">{frame ? (1000 / frame).toFixed(1) : "—"}</span>
        </span>
        <span>
          Frame <span className="text-zinc-100">{frame?.toFixed(1) ?? "—"} ms</span>
        </span>
        <span>
          1% low <span className="text-zinc-100">{lowFps(sorted, 0.01)}</span>
        </span>
        <span>
          0.1% low <span className="text-zinc-100">{lowFps(sorted, 0.001)}</span>
        </span>
        <span className="col-span-2">
          Sim step avg <span className="text-zinc-100">{step?.toFixed(1) ?? "—"} μs</span>
        </span>
      </div>
      <canvas
        ref={graphRef}
        width={160}
        height={36}
        className="mt-2 block w-full h-9 bg-zinc-900/80 rounded"
        aria-label="Recent frame times"
      />
    </div>
  );
}
