import { Compass, Play, Shield, Swords } from "lucide-react";
import { useState } from "react";

export default function App() {
  const [speed, setSpeed] = useState<number>(1);

  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/30">
      {/* Header Bar */}
      <header className="h-14 border-b border-zinc-800/80 px-6 flex items-center justify-between bg-zinc-900/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Swords className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-wide text-zinc-100 flex items-center gap-2">
              SPACE BATTLER{" "}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                2.5D SIM
              </span>
            </h1>
            <p className="text-xs text-zinc-400">Tactical Fleet Auto-Battler</p>
          </div>
        </div>

        {/* Speed & Sim Controls */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {[0, 0.5, 1, 2, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1 text-xs rounded font-mono transition-colors ${
                speed === s
                  ? "bg-cyan-500 text-zinc-950 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {s === 0 ? "PAUSE" : `${s}x`}
            </button>
          ))}
        </div>
      </header>

      {/* Main Tactical Space */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Canvas viewport container */}
        <div className="flex-1 relative bg-black flex items-center justify-center">
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px] opacity-40 pointer-events-none" />
          <div className="text-center space-y-2 z-10">
            <Compass className="w-10 h-10 text-cyan-500/60 mx-auto animate-pulse" />
            <p className="text-sm font-mono text-zinc-400">Tactical Canvas Initialized</p>
            <p className="text-xs text-zinc-600">Awaiting Fleet Deployment...</p>
          </div>
        </div>

        {/* Right Sidebar - Fleet & Doctrines */}
        <aside className="w-80 border-l border-zinc-800/80 bg-zinc-900/30 p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-cyan-400" /> Operational Groups
            </span>
            <span className="text-xs font-mono text-zinc-500">Cap: 10,000 CR</span>
          </div>

          <div className="flex-1 flex items-center justify-center border border-dashed border-zinc-800 rounded-lg p-6 text-center">
            <p className="text-xs text-zinc-500">
              Group doctrines & fleet assembly arriving in Step 2 & 4
            </p>
          </div>

          <button
            type="button"
            className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Engage Simulation
          </button>
        </aside>
      </main>
    </div>
  );
}
