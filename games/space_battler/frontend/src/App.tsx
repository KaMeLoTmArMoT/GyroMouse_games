import { RotateCcw, Shield, SkipForward, Swords } from "lucide-react";
import { useState } from "react";
import { TacticalCanvas } from "./canvas/TacticalCanvas";
import { ClientCombatSimulation } from "./engine/simulation";
import { createClientTestFleets } from "./engine/testFleets";

export default function App() {
  const [speed, setSpeed] = useState<number>(1);
  const [sim, setSim] = useState<ClientCombatSimulation>(() => {
    const s = new ClientCombatSimulation();
    for (const ship of createClientTestFleets()) {
      s.addShip(ship);
    }
    return s;
  });
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);

  const resetBattle = () => {
    const s = new ClientCombatSimulation();
    for (const ship of createClientTestFleets()) {
      s.addShip(ship);
    }
    setSim(s);
    setSelectedShipId(null);
  };

  const stepForward = () => {
    sim.update(1 / 30);
  };

  const _selectedShip = sim.ships.find((s) => s.id === selectedShipId);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetBattle}
            title="Reset Battle"
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={stepForward}
            title="Step 1 Frame"
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
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
        </div>
      </header>

      {/* Main Tactical Space */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Tactical Canvas Viewport */}
        <div className="flex-1 relative bg-black">
          <TacticalCanvas
            sim={sim}
            speed={speed}
            selectedShipId={selectedShipId}
            onSelectShip={setSelectedShipId}
          />
        </div>

        {/* Right Sidebar - Fleet HUD & Telemetry */}
        <aside className="w-80 border-l border-zinc-800/80 bg-zinc-900/40 p-4 flex flex-col gap-4 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-cyan-400" /> Tactical Monitor
            </span>
            <span className="text-xs font-mono text-zinc-500">Live Telemetry</span>
          </div>

          {/* Fleet Status Summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-800/40">
              <div className="text-[10px] text-cyan-400 font-semibold uppercase">
                Task Force Blue
              </div>
              <div className="text-base font-bold text-zinc-100 mt-0.5">
                {sim.ships.filter((s) => s.team === 0 && s.isAlive).length}{" "}
                <span className="text-xs font-normal text-zinc-500">hulls</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">1 Battleship + 2 PD Corvettes</div>
            </div>

            <div className="p-2.5 rounded-lg bg-red-950/20 border border-red-800/40">
              <div className="text-[10px] text-red-400 font-semibold uppercase">
                Strike Force Red
              </div>
              <div className="text-base font-bold text-zinc-100 mt-0.5">
                {sim.ships.filter((s) => s.team === 1 && s.isAlive).length}{" "}
                <span className="text-xs font-normal text-zinc-500">hulls</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">14 Plasma Raiders</div>
            </div>
          </div>

          {/* Selected Ship Detail View */}
          <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Capital Ship Telemetry
            </span>
            {(() => {
              const bb = sim.ships.find((s) => s.hullClass === "battleship");
              if (!bb) return <div className="text-xs text-zinc-600">No capital ship active</div>;
              return (
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="font-semibold text-zinc-200">{bb.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      Heading: {(bb.heading * (180 / Math.PI)).toFixed(1)}°
                    </div>
                  </div>

                  {/* Defense Bars */}
                  <div className="space-y-1.5 text-[10px] font-mono">
                    <div>
                      <div className="flex justify-between text-zinc-400 mb-0.5">
                        <span>Shields</span>
                        <span>
                          {Math.round(bb.shieldCurrent)} / {bb.shieldMax}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 transition-all"
                          style={{
                            width: `${Math.max(0, (bb.shieldCurrent / bb.shieldMax) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-zinc-400 mb-0.5">
                        <span>Armor</span>
                        <span>
                          {Math.round(bb.armorCurrent)} / {bb.armorMax}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 transition-all"
                          style={{
                            width: `${Math.max(0, (bb.armorCurrent / bb.armorMax) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-zinc-400 mb-0.5">
                        <span>Hull</span>
                        <span>
                          {Math.round(bb.hullCurrent)} / {bb.hullMax}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all"
                          style={{ width: `${Math.max(0, (bb.hullCurrent / bb.hullMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Active Turrets */}
                  <div className="pt-2 border-t border-zinc-800/80">
                    <div className="text-[10px] uppercase font-semibold text-zinc-400 mb-1.5">
                      Turret Hardpoints
                    </div>
                    <div className="space-y-1">
                      {bb.turrets.map((t) => (
                        <div
                          key={t.id}
                          className="p-1.5 rounded bg-zinc-900 border border-zinc-800/60 text-[10px] font-mono flex items-center justify-between"
                        >
                          <span className="text-zinc-300">{t.weapon.name}</span>
                          <span className="text-cyan-400">
                            {(t.currentLocalAngle * (180 / Math.PI)).toFixed(0)}°
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </aside>
      </main>
    </div>
  );
}
