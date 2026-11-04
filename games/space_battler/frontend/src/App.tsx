import { RotateCcw, Shield, SkipForward, Swords, Target } from "lucide-react";
import { useState } from "react";
import { TacticalCanvas } from "./canvas/TacticalCanvas";
import { createShowcaseDemoFleets } from "./engine/showcaseDemo";
import { ClientCombatSimulation } from "./engine/simulation";

export default function App() {
  const [speed, setSpeed] = useState<number>(0);
  const [sim, setSim] = useState<ClientCombatSimulation>(() => {
    const s = new ClientCombatSimulation();
    for (const ship of createShowcaseDemoFleets()) {
      s.addShip(ship);
    }
    return s;
  });
  const [selectedShipId, setSelectedShipId] = useState<string | null>("blue_bb");

  const resetBattle = () => {
    const s = new ClientCombatSimulation();
    for (const ship of createShowcaseDemoFleets()) {
      s.addShip(ship);
    }
    setSim(s);
    setSelectedShipId("blue_bb");
  };

  const stepForward = () => {
    sim.update(1 / 30);
  };

  const selectedShip = sim.ships.find((s) => s.id === selectedShipId);

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
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={stepForward}
            title="Step 1 Frame"
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            {[0, 0.5, 1, 2, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-2.5 py-1 text-xs rounded font-mono transition-colors cursor-pointer ${
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
        <div className="flex-1 relative bg-black">
          <TacticalCanvas
            sim={sim}
            speed={speed}
            selectedShipId={selectedShipId}
            onSelectShip={setSelectedShipId}
          />
        </div>

        {/* Right Sidebar - Dynamic Fleet & Selected Ship Telemetry */}
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
                <span className="text-xs font-normal text-zinc-500">active</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-red-950/20 border border-red-800/40">
              <div className="text-[10px] text-red-400 font-semibold uppercase">
                Strike Force Red
              </div>
              <div className="text-base font-bold text-zinc-100 mt-0.5">
                {sim.ships.filter((s) => s.team === 1 && s.isAlive).length}{" "}
                <span className="text-xs font-normal text-zinc-500">active</span>
              </div>
            </div>
          </div>

          {/* Dynamic Clicked Ship Telemetry */}
          <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-cyan-400" /> Inspected Vessel
              </span>
              {selectedShip && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${selectedShip.team === 0 ? "bg-cyan-950 text-cyan-400 border border-cyan-800" : "bg-red-950 text-red-400 border border-red-800"}`}
                >
                  TEAM {selectedShip.team === 0 ? "BLUE" : "RED"}
                </span>
              )}
            </div>

            {selectedShip ? (
              <div className="space-y-3 text-xs">
                <div>
                  <div className="font-semibold text-zinc-200">{selectedShip.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono flex items-center justify-between mt-0.5">
                    <span>
                      Class:{" "}
                      <span className="uppercase text-zinc-300">{selectedShip.hullClass}</span>
                    </span>
                    <span>Heading: {(selectedShip.heading * (180 / Math.PI)).toFixed(0)}°</span>
                  </div>
                </div>

                {/* Defense Bars */}
                <div className="space-y-1.5 text-[10px] font-mono">
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-0.5">
                      <span>Shields</span>
                      <span>
                        {Math.round(selectedShip.shieldCurrent)} / {selectedShip.shieldMax}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all"
                        style={{
                          width: `${Math.max(0, (selectedShip.shieldCurrent / selectedShip.shieldMax) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-zinc-400 mb-0.5">
                      <span>Armor</span>
                      <span>
                        {Math.round(selectedShip.armorCurrent)} / {selectedShip.armorMax}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{
                          width: `${Math.max(0, (selectedShip.armorCurrent / selectedShip.armorMax) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-zinc-400 mb-0.5">
                      <span>Hull</span>
                      <span>
                        {Math.round(selectedShip.hullCurrent)} / {selectedShip.hullMax}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all"
                        style={{
                          width: `${Math.max(0, (selectedShip.hullCurrent / selectedShip.hullMax) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Active Hardpoints with Sector Angles */}
                <div className="pt-2 border-t border-zinc-800/80">
                  <div className="text-[10px] uppercase font-semibold text-zinc-400 mb-1.5">
                    Hardpoints & Fire Sectors
                  </div>
                  <div className="space-y-1.5">
                    {selectedShip.turrets.map((t) => {
                      const minDeg = Math.round(t.baseArc[0] * (180 / Math.PI));
                      const maxDeg = Math.round(t.baseArc[1] * (180 / Math.PI));
                      const curDeg = Math.round(t.currentLocalAngle * (180 / Math.PI));

                      return (
                        <div
                          key={t.id}
                          className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono"
                        >
                          <div className="flex items-center justify-between text-zinc-200 font-medium">
                            <span>{t.weapon.name}</span>
                            <span className="text-cyan-400">{curDeg}°</span>
                          </div>
                          <div className="text-[9px] text-zinc-500 mt-1 flex justify-between">
                            <span>
                              Arc: [{minDeg}° .. {maxDeg}°]
                            </span>
                            <span>Range: {t.weapon.range}u</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-4">
                <span className="text-xs text-zinc-500">
                  Click any vessel on the battlefield to inspect hardpoints and sectors
                </span>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
