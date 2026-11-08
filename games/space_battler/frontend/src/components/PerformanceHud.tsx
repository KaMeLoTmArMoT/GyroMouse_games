import { useEffect, useRef, useState } from "react";

const HISTORY_SIZE = 160;
const GRAPH_SAMPLE_MS = 50;

export class PerformanceSamples {
  frames: number[] = [];
  steps: number[] = [];
  workerSteps: number[] = [];
  renderFrames: number[] = [];
  snapshotLatencies: number[] = [];
  graphFrames: number[] = [];
  realTimeFactor: number | null = null;
  private rtfStart: { wallMs: number; simTime: number } | null = null;
  private graphElapsed = 0;
  private graphFrameCount = 0;

  addFrame = (duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.frames.push(duration);
    if (this.frames.length > HISTORY_SIZE) this.frames.shift();
    let remaining = duration;
    while (remaining > 0) {
      const portion = Math.min(remaining, GRAPH_SAMPLE_MS - this.graphElapsed);
      this.graphElapsed += portion;
      this.graphFrameCount += portion / duration;
      remaining -= portion;
      if (this.graphElapsed < GRAPH_SAMPLE_MS - 1e-9) break;
      // Integrate frame intervals over each time window, avoiding phase aliasing
      // while preserving the duration and magnitude of long stalls.
      this.graphFrames.push(this.graphElapsed / this.graphFrameCount);
      this.graphElapsed = 0;
      this.graphFrameCount = 0;
      const fullWindows = Math.floor(remaining / GRAPH_SAMPLE_MS);
      remaining -= fullWindows * GRAPH_SAMPLE_MS;
      for (let i = 0; i < Math.min(fullWindows, HISTORY_SIZE); i++) {
        this.graphFrames.push(duration);
      }
      if (this.graphFrames.length > HISTORY_SIZE) {
        this.graphFrames.splice(0, this.graphFrames.length - HISTORY_SIZE);
      }
    }
  };

  addStep = (duration: number) => {
    this.steps.push(duration);
    if (this.steps.length > HISTORY_SIZE) this.steps.shift();
  };

  addRender = (duration: number) => {
    this.renderFrames.push(duration);
    if (this.renderFrames.length > HISTORY_SIZE) this.renderFrames.shift();
  };

  addTransport = (stepDurationMs: number, snapshotLatencyMs: number) => {
    this.addStep(stepDurationMs);
    this.workerSteps.push(stepDurationMs);
    this.snapshotLatencies.push(snapshotLatencyMs);
    if (this.workerSteps.length > HISTORY_SIZE) this.workerSteps.shift();
    if (this.snapshotLatencies.length > HISTORY_SIZE) this.snapshotLatencies.shift();
  };

  resetSimulationClock = () => {
    this.rtfStart = null;
    this.realTimeFactor = null;
  };

  addSimulationTime = (wallMs: number, simTime: number) => {
    if (!this.rtfStart || simTime < this.rtfStart.simTime || wallMs < this.rtfStart.wallMs) {
      this.rtfStart = { wallMs, simTime };
      this.realTimeFactor = null;
      return;
    }
    const wallDelta = wallMs - this.rtfStart.wallMs;
    if (wallDelta >= 500) {
      this.realTimeFactor = ((simTime - this.rtfStart.simTime) * 1000) / wallDelta;
      this.rtfStart = { wallMs, simTime };
    }
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

export function PerformanceHud({ samples, speed }: { samples: PerformanceSamples; speed: number }) {
  const graphRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState({
    frames: [] as number[],
    steps: [] as number[],
    graphFrames: [] as number[],
    workerStep: null as number | null,
    renderFrame: null as number | null,
    snapshotLatency: null as number | null,
    realTimeFactor: null as number | null,
  });

  useEffect(() => {
    const update = () =>
      setSnapshot({
        frames: [...samples.frames],
        steps: [...samples.steps],
        graphFrames: [...samples.graphFrames],
        workerStep: samples.workerSteps.at(-1) ?? null,
        renderFrame: samples.renderFrames.at(-1) ?? null,
        snapshotLatency: samples.snapshotLatencies.at(-1) ?? null,
        realTimeFactor: samples.realTimeFactor,
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

  const frame = snapshot.graphFrames.at(-1);
  const sorted = [...snapshot.frames].sort((a, b) => b - a);
  const step = snapshot.steps.length
    ? (snapshot.steps.reduce((sum, value) => sum + value, 0) * 1000) / snapshot.steps.length
    : null;

  return (
    <div className="absolute top-4 left-4 z-10 pointer-events-none w-64 rounded-lg border border-zinc-700/80 bg-zinc-950/85 p-3 font-mono tabular-nums text-[11px] text-zinc-400 shadow-lg backdrop-blur-sm">
      <div className="mb-2 font-semibold uppercase tracking-wider text-cyan-400">Performance</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="col-span-2" title="Simulated time / wall time, followed by selected speed">
          RTF{" "}
          <span className="text-zinc-100">
            {snapshot.realTimeFactor === null ? "—" : `${snapshot.realTimeFactor.toFixed(1)}x`} /{" "}
            {speed.toFixed(1)}x
          </span>
        </span>
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
        {snapshot.workerStep !== null && (
          <>
            <span className="col-span-2">
              Worker step <span className="text-zinc-100">{snapshot.workerStep.toFixed(2)} ms</span>
            </span>
            <span className="col-span-2">
              Render{" "}
              <span className="text-zinc-100">{snapshot.renderFrame?.toFixed(2) ?? "—"} ms</span>
            </span>
            <span className="col-span-2">
              Snapshot latency{" "}
              <span className="text-zinc-100">
                {snapshot.snapshotLatency?.toFixed(2) ?? "—"} ms
              </span>
            </span>
          </>
        )}
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
