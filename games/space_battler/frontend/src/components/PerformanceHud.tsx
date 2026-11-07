import { useEffect, useRef, useState } from "react";

const HISTORY_SIZE = 160;
const GRAPH_SAMPLE_MS = 50;

export class PerformanceSamples {
  frames: number[] = [];
  steps: number[] = [];
  graphFrames: number[] = [];
  private graphElapsed = 0;

  addFrame = (duration: number) => {
    this.frames.push(duration);
    if (this.frames.length > HISTORY_SIZE) this.frames.shift();
    this.graphElapsed += duration;
    const count = Math.floor(this.graphElapsed / GRAPH_SAMPLE_MS);
    this.graphElapsed %= GRAPH_SAMPLE_MS;
    for (let i = 0; i < Math.min(count, HISTORY_SIZE); i++) this.graphFrames.push(duration);
    if (this.graphFrames.length > HISTORY_SIZE) {
      this.graphFrames.splice(0, this.graphFrames.length - HISTORY_SIZE);
    }
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
  const [snapshot, setSnapshot] = useState({
    frames: [] as number[],
    steps: [] as number[],
    graphFrames: [] as number[],
  });

  useEffect(() => {
    const update = () =>
      setSnapshot({
        frames: [...samples.frames],
        steps: [...samples.steps],
        graphFrames: [...samples.graphFrames],
      });
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [samples]);

  useEffect(() => {
    const canvas = graphRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = canvas.width / HISTORY_SIZE;
    snapshot.graphFrames.forEach((frame, index) => {
      const height = Math.max(1, Math.min(canvas.height, (frame / 50) * canvas.height));
      ctx.fillStyle = frame <= 16.7 ? "#34d399" : frame <= 33 ? "#fbbf24" : "#ef4444";
      ctx.fillRect(
        canvas.width - (snapshot.graphFrames.length - index) * barWidth,
        canvas.height - height,
        barWidth,
        height,
      );
    });
  }, [snapshot.graphFrames]);

  const frame = snapshot.frames.at(-1);
  const sorted = [...snapshot.frames].sort((a, b) => b - a);
  const step = snapshot.steps.length
    ? (snapshot.steps.reduce((sum, value) => sum + value, 0) * 1000) / snapshot.steps.length
    : null;

  return (
    <div className="absolute top-4 left-4 z-10 pointer-events-none w-64 rounded-lg border border-zinc-700/80 bg-zinc-950/85 p-3 font-mono tabular-nums text-[11px] text-zinc-400 shadow-lg backdrop-blur-sm">
      <div className="mb-2 font-semibold uppercase tracking-wider text-cyan-400">Performance</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="whitespace-nowrap">
          FPS <span className="text-zinc-100">{frame ? (1000 / frame).toFixed(1) : "—"}</span>
        </span>
        <span className="whitespace-nowrap">
          Frame <span className="text-zinc-100">{frame?.toFixed(1) ?? "—"} ms</span>
        </span>
        <span className="whitespace-nowrap">
          1% low <span className="text-zinc-100">{lowFps(sorted, 0.01)}</span>
        </span>
        <span className="whitespace-nowrap">
          0.1% low <span className="text-zinc-100">{lowFps(sorted, 0.001)}</span>
        </span>
        <span className="col-span-2">
          Sim step avg{" "}
          <span className="text-zinc-100">
            {step === null
              ? "—"
              : step >= 1000
                ? `${(step / 1000).toFixed(2)} ms`
                : `${step.toFixed(1)} μs`}
          </span>
        </span>
      </div>
      <canvas
        ref={graphRef}
        width={232}
        height={36}
        className="mt-2 block w-full h-9 bg-zinc-900/80 rounded"
        aria-label="Recent frame times"
      />
    </div>
  );
}
