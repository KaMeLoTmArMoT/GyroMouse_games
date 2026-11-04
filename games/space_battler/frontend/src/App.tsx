import {
  Compass,
  Copy,
  RotateCcw,
  Shield,
  SkipForward,
  Swords,
  Target,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { TacticalCanvas } from "./canvas/TacticalCanvas";
import { FleetBuilder } from "./components/FleetBuilder";
import { buildFleetFromSlots, type FleetSlot } from "./engine/fleetBuilder";
import { FLEET_PRESETS } from "./engine/fleetPresets";
import { ClientCombatSimulation } from "./engine/simulation";

export default function App() {
  const [activeTab, setActiveTab] = useState<"builder" | "battle">("battle");
  const [speed, setSpeed] = useState<number>(0);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);

  // User Fleet Construction State (Blue Task Force)
  const [userSlots, setUserSlots] = useState<FleetSlot[]>([
    { hullClass: "battleship", groupId: 1 },
    { hullClass: "corvette", groupId: 2 },
    { hullClass: "corvette", groupId: 2 },
    { hullClass: "strike_craft", groupId: 3 },
    { hullClass: "strike_craft", groupId: 3 },
    { hullClass: "strike_craft", groupId: 3 },
    { hullClass: "strike_craft", groupId: 3 },
  ]);
  const [budgetLimit] = useState<number>(10000);
  const [enemyPresetId, setEnemyPresetId] = useState<string>("swarm");

  // Simulation State
  const [sim, setSim] = useState<ClientCombatSimulation>(() => {
    return assembleSimulation(userSlots, enemyPresetId);
  });
  const [selectedShipId, setSelectedShipId] = useState<string | null>("blue_bb_0");

  function assembleSimulation(blueSlots: FleetSlot[], redPresetId: string): ClientCombatSimulation {
    const s = new ClientCombatSimulation();

    // 1. Build Blue Force
    const blueShips = buildFleetFromSlots(blueSlots, 0, -480, 0);
    for (const ship of blueShips) s.addShip(ship);

    // 2. Build Red Force from Preset
    const redPreset = FLEET_PRESETS.find((p) => p.id === redPresetId) ?? FLEET_PRESETS[0];
    const redSlots: FleetSlot[] = [];
    for (const comp of redPreset.composition) {
      for (let i = 0; i < comp.count; i++) {
        redSlots.push({ hullClass: comp.hullClass, groupId: comp.groupId });
      }
    }
    const redShips = buildFleetFromSlots(redSlots, 1, 480, Math.PI);
    for (const ship of redShips) s.addShip(ship);

    return s;
  }

  const resetBattle = () => {
    const s = assembleSimulation(userSlots, enemyPresetId);
    setSim(s);
    setSelectedShipId(s.ships[0]?.id ?? null);
  };

  const handleStartFromBuilder = () => {
    resetBattle();
    setActiveTab("battle");
    setSpeed(1); // Auto-engage when launching from builder
  };

  const stepForward = () => {
    sim.update(1 / 30);
  };

  const selectedShip = sim.ships.find((s) => s.id === selectedShipId);

  const copyTelemetry = () => {
    if (!selectedShip) return;
    const jsonStr = JSON.stringify(
      {
        id: selectedShip.id,
        name: selectedShip.name,
        team: selectedShip.team === 0 ? "BLUE" : "RED",
        class: selectedShip.hullClass,
        shield: `${Math.round(selectedShip.shieldCurrent)}/${selectedShip.shieldMax}`,
        armor: `${Math.round(selectedShip.armorCurrent)}/${selectedShip.armorMax}`,
        hull: `${Math.round(selectedShip.hullCurrent)}/${selectedShip.hullMax}`,
        turrets: selectedShip.turrets.map((t) => ({
          name: t.weapon.name,
          angleDeg: Math.round(t.currentLocalAngle * (180 / Math.PI)),
          arcDeg: [
            Math.round(t.baseArc[0] * (180 / Math.PI)),
            Math.round(t.baseArc[1] * (180 / Math.PI)),
          ],
        })),
      },
      null,
      2,
    );
    navigator.clipboard.writeText(jsonStr);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/30">
      {/* Header Bar */}
      <header className="h-14 border-b border-zinc-800/80 px-6 flex items-center justify-between bg-zinc-900/40 backdrop-blur-md">
        <div className="flex items-center gap-6">
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

          {/* Navigation Tabs */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setActiveTab("builder")}
              className={`px-3 py-1 text-xs rounded font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === "builder"
                  ? "bg-cyan-500 text-zinc-950 font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Wrench className="w-3.5 h-3.5" /> Fleet Builder
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("battle")}
              className={`px-3 py-1 text-xs rounded font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === "battle"
                  ? "bg-cyan-500 text-zinc-950 font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Compass className="w-3.5 h-3.5" /> Tactical Grid
            </button>
          </div>
        </div>

        {/* Speed & Sim Controls (Visible when on battle tab) */}
        {activeTab === "battle" ? (
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
        ) : (
          <div className="text-xs font-mono text-zinc-500">Fleet Assembly Mode</div>
        )}
      </header>

      {/* Main Content Area */}
      {activeTab === "builder" ? (
        <FleetBuilder
          slots={userSlots}
          onUpdateSlots={setUserSlots}
          budgetLimit={budgetLimit}
          enemyPresetId={enemyPresetId}
          onSelectEnemyPreset={setEnemyPresetId}
          onStartBattle={handleStartFromBuilder}
        />
      ) : (
        <main className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 relative bg-black">
            <TacticalCanvas
              sim={sim}
              speed={speed}
              selectedShipId={selectedShipId}
              onSelectShip={setSelectedShipId}
            />
          </div>

          {/* Right Sidebar - Selectable & Copyable Telemetry */}
          <aside className="w-84 border-l border-zinc-800/80 bg-zinc-900/40 p-4 flex flex-col gap-4 backdrop-blur-sm select-text">
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
                <div className="flex items-center gap-1.5">
                  {selectedShip && (
                    <button
                      type="button"
                      onClick={copyTelemetry}
                      title="Copy Vessel Telemetry as JSON"
                      className="p-1 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  {selectedShip && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${selectedShip.team === 0 ? "bg-cyan-950 text-cyan-400 border border-cyan-800" : "bg-red-950 text-red-400 border border-red-800"}`}
                    >
                      TEAM {selectedShip.team === 0 ? "BLUE" : "RED"}
                    </span>
                  )}
                </div>
              </div>

              {copiedNotification && (
                <div className="text-[10px] text-emerald-400 font-mono mb-2 bg-emerald-950/30 p-1 rounded border border-emerald-800 text-center">
                  Telemetry copied to clipboard!
                </div>
              )}

              {selectedShip ? (
                <div className="space-y-3 text-xs select-text">
                  <div>
                    <div className="font-semibold text-zinc-200 select-all">
                      {selectedShip.name}
                    </div>
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
                        <span className="select-all">
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
                        <span className="select-all">
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
                        <span className="select-all">
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
                            <div className="text-[9px] text-zinc-500 mt-1 flex justify-between select-all">
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
      )}
    </div>
  );
}
