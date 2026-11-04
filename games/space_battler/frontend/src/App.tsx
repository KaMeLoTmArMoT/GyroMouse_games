import {
  Activity,
  Compass,
  Copy,
  RotateCcw,
  ScrollText,
  Shield,
  SkipForward,
  Swords,
  Target,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TacticalCanvas } from "./canvas/TacticalCanvas";
import { FleetBuilder } from "./components/FleetBuilder";
import { spaceAudio } from "./engine/audioEngine";
import { buildFleetFromSlots, type FleetSlot } from "./engine/fleetBuilder";
import { FLEET_PRESETS } from "./engine/fleetPresets";
import { ClientCombatSimulation } from "./engine/simulation";

const SPEED_LEVELS = [0, 0.5, 1, 2, 5];

export default function App() {
  const [activeTab, setActiveTab] = useState<"builder" | "battle">("battle");
  const [speed, setSpeed] = useState<number>(0);
  const [lastActiveSpeed, setLastActiveSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(() => spaceAudio.isMuted());
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<"vessel" | "telemetry" | "log">("vessel");
  const [showVictoryModal, setShowVictoryModal] = useState<boolean>(true);
  const [, setTick] = useState<number>(0);

  useEffect(() => {
    const unlockAudio = () => spaceAudio.unlock();
    document.addEventListener("pointerdown", unlockAudio);
    document.addEventListener("keydown", unlockAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  // 10Hz live update for HUD telemetry and killfeed during combat playback
  useEffect(() => {
    if (speed <= 0) return;
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 100);
    return () => clearInterval(interval);
  }, [speed]);

  // User Fleet Construction State (Blue Task Force)
  const [userSlots, setUserSlots] = useState<FleetSlot[]>([
    { id: "bb_1", hullClass: "battleship", groupId: 1 },
    { id: "cv_1", hullClass: "corvette", groupId: 2 },
    { id: "cv_2", hullClass: "corvette", groupId: 2 },
    { id: "sc_1", hullClass: "strike_craft", groupId: 3 },
    { id: "sc_2", hullClass: "strike_craft", groupId: 3 },
    { id: "sc_3", hullClass: "strike_craft", groupId: 3 },
    { id: "sc_4", hullClass: "strike_craft", groupId: 3 },
  ]);
  const [budgetLimit] = useState<number>(10000);
  const [enemyPresetId, setEnemyPresetId] = useState<string>("swarm");

  // Simulation State
  const [sim, setSim] = useState<ClientCombatSimulation>(() => {
    return assembleSimulation(userSlots, enemyPresetId);
  });
  const [selectedShipId, setSelectedShipId] = useState<string | null>("blue_bb_0");

  // Keyboard Shortcuts: Space (Play/Pause), 1-5 (Groups), < / > or , / . (Speed down/up)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setSpeed((cur) => {
          if (cur > 0) {
            setLastActiveSpeed(cur);
            return 0;
          }
          return lastActiveSpeed > 0 ? lastActiveSpeed : 1;
        });
        return;
      }

      if (e.key === "<" || e.key === "," || e.key === "[") {
        e.preventDefault();
        setSpeed((cur) => {
          const idx = SPEED_LEVELS.indexOf(cur);
          if (idx > 0) return SPEED_LEVELS[idx - 1];
          if (idx === -1) {
            const prev = [...SPEED_LEVELS].reverse().find((s) => s < cur);
            return prev !== undefined ? prev : 0;
          }
          return SPEED_LEVELS[0];
        });
        return;
      }

      if (e.key === ">" || e.key === "." || e.key === "]") {
        e.preventDefault();
        setSpeed((cur) => {
          const idx = SPEED_LEVELS.indexOf(cur);
          if (idx !== -1 && idx < SPEED_LEVELS.length - 1) return SPEED_LEVELS[idx + 1];
          if (idx === -1) {
            const next = SPEED_LEVELS.find((s) => s > cur);
            return next !== undefined ? next : SPEED_LEVELS[SPEED_LEVELS.length - 1];
          }
          return SPEED_LEVELS[SPEED_LEVELS.length - 1];
        });
        return;
      }

      if (e.key >= "1" && e.key <= "5") {
        const groupNum = parseInt(e.key, 10);
        const groupShips = sim.ships.filter(
          (s) => s.team === 0 && s.isAlive && s.groupId === groupNum,
        );
        if (groupShips.length > 0) {
          e.preventDefault();
          setSelectedShipId((curId) => {
            const curIdx = groupShips.findIndex((s) => s.id === curId);
            if (curIdx === -1) return groupShips[0].id;
            return groupShips[(curIdx + 1) % groupShips.length].id;
          });
          setSidebarTab("vessel");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sim, lastActiveSpeed]);

  function assembleSimulation(blueSlots: FleetSlot[], redPresetId: string): ClientCombatSimulation {
    const s = new ClientCombatSimulation();

    // 1. Build Blue Force (Spawn at -800u with wide tactical stance)
    const blueShips = buildFleetFromSlots(blueSlots, 0, -800, 0);
    for (const ship of blueShips) s.addShip(ship);

    // 2. Build Red Force from Preset (Spawn at +800u)
    const redPreset = FLEET_PRESETS.find((p) => p.id === redPresetId) ?? FLEET_PRESETS[0];
    const redSlots: FleetSlot[] = [];
    for (const comp of redPreset.composition) {
      for (let i = 0; i < comp.count; i++) {
        redSlots.push({
          id: `red_${comp.hullClass}_${i}`,
          hullClass: comp.hullClass,
          groupId: comp.groupId,
        });
      }
    }
    const redShips = buildFleetFromSlots(redSlots, 1, 800, Math.PI);
    for (const ship of redShips) s.addShip(ship);

    return s;
  }

  const resetBattle = () => {
    const s = assembleSimulation(userSlots, enemyPresetId);
    setSim(s);
    setSelectedShipId(s.ships[0]?.id ?? null);
    setShowVictoryModal(true);
  };

  const handleStartFromBuilder = () => {
    resetBattle();
    setActiveTab("battle");
    setSpeed(1);
    setShowVictoryModal(true);
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
        team: selectedShip.team === 0 ? "BLUE_TERRAN" : "RED_ALIEN",
        class: selectedShip.hullClass,
        shield: `${Math.round(selectedShip.shieldCurrent)}/${selectedShip.shieldMax}`,
        armor: `${Math.round(selectedShip.armorCurrent)}/${selectedShip.armorMax}`,
        hull: `${Math.round(selectedShip.hullCurrent)}/${selectedShip.hullMax}`,
        turrets: selectedShip.turrets.map((t) => ({
          name: t.weapon.name,
          cooldownRemaining: Number(t.cooldownTimer.toFixed(2)),
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
      <header className="h-14 border-b border-zinc-800/80 px-6 flex items-center justify-between bg-zinc-900/40 backdrop-blur-md shrink-0">
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

        {/* Speed Controls */}
        {activeTab === "battle" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted(spaceAudio.toggleMute())}
              title={muted ? "Unmute sound" : "Mute sound"}
              aria-label={muted ? "Unmute sound" : "Mute sound"}
              aria-pressed={!muted}
              className={`p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer ${muted ? "text-zinc-400 hover:text-zinc-200" : "text-cyan-400"}`}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
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

            <div
              className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1"
              title="Hotkeys: Space (Play/Pause), < / > (Speed down/up), 1-5 (Groups)"
            >
              {SPEED_LEVELS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  title={s === 0 ? "Pause (Space)" : `Speed ${s}x (< / >)`}
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

            {/* Victory / Defeat Modal Overlay */}
            {sim.winner !== null && showVictoryModal && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-30">
                <div
                  className={`max-w-md w-full rounded-2xl border p-6 shadow-2xl bg-zinc-950/95 flex flex-col items-center text-center ${
                    sim.winner === 0
                      ? "border-cyan-500/50 shadow-cyan-950/50"
                      : "border-red-500/50 shadow-red-950/50"
                  }`}
                >
                  <div
                    className={`p-4 rounded-2xl mb-4 border ${
                      sim.winner === 0
                        ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                        : "bg-red-500/10 border-red-500/30 text-red-400"
                    }`}
                  >
                    {sim.winner === 0 ? (
                      <Trophy className="w-10 h-10" />
                    ) : (
                      <Swords className="w-10 h-10" />
                    )}
                  </div>

                  <h2
                    className={`text-xl font-bold tracking-wide uppercase ${
                      sim.winner === 0 ? "text-cyan-400" : "text-red-400"
                    }`}
                  >
                    {sim.winner === 0 ? "Terran Tactical Victory" : "Alien Swarm Victory"}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 font-mono">
                    Engagement resolved in {(sim.winnerDeclaredTime ?? sim.timeElapsed).toFixed(1)}s
                  </p>

                  {/* Summary Comparison Cards */}
                  <div className="grid grid-cols-2 gap-3 w-full my-5 text-left text-xs">
                    <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-800/30">
                      <div className="text-[10px] uppercase font-bold text-cyan-400 mb-1">
                        Terran Fleet
                      </div>
                      <div className="text-zinc-200">
                        Survivors:{" "}
                        <span className="font-bold text-white">
                          {sim.ships.filter((s) => s.team === 0 && s.isAlive).length}
                        </span>{" "}
                        / {sim.ships.filter((s) => s.team === 0).length}
                      </div>
                      <div className="text-zinc-400 text-[11px] mt-0.5">
                        Damage Dealt:{" "}
                        <span className="font-mono text-zinc-200">{sim.stats[0].damageDealt}</span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Intercepts:{" "}
                        <span className="font-mono text-zinc-200">
                          {sim.stats[0].missilesIntercepted}
                        </span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Shield Absorbed:{" "}
                        <span className="font-mono text-zinc-200">
                          {sim.stats[0].shieldDamageAbsorbed}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-red-950/20 border border-red-800/30">
                      <div className="text-[10px] uppercase font-bold text-red-400 mb-1">
                        Alien Swarm
                      </div>
                      <div className="text-zinc-200">
                        Survivors:{" "}
                        <span className="font-bold text-white">
                          {sim.ships.filter((s) => s.team === 1 && s.isAlive).length}
                        </span>{" "}
                        / {sim.ships.filter((s) => s.team === 1).length}
                      </div>
                      <div className="text-zinc-400 text-[11px] mt-0.5">
                        Damage Dealt:{" "}
                        <span className="font-mono text-zinc-200">{sim.stats[1].damageDealt}</span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Intercepts:{" "}
                        <span className="font-mono text-zinc-200">
                          {sim.stats[1].missilesIntercepted}
                        </span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Shield Absorbed:{" "}
                        <span className="font-mono text-zinc-200">
                          {sim.stats[1].shieldDamageAbsorbed}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 w-full">
                    <button
                      type="button"
                      onClick={resetBattle}
                      className="flex-1 py-2 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Rematch
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("builder")}
                      className="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" /> Refit Fleet
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVictoryModal(false)}
                      className="py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs transition-colors cursor-pointer"
                      title="Inspect Battle Grid"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar - Selectable Telemetry, Live DPS & Combat Log */}
          <aside className="w-88 border-l border-zinc-800/80 bg-zinc-900/40 p-4 flex flex-col gap-3 backdrop-blur-sm select-text">
            {/* Sidebar Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab("vessel")}
                className={`py-1.5 px-2 rounded flex items-center justify-center gap-1 font-medium transition-colors cursor-pointer ${
                  sidebarTab === "vessel"
                    ? "bg-zinc-800 text-cyan-400 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>Vessel</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab("telemetry")}
                className={`py-1.5 px-2 rounded flex items-center justify-center gap-1 font-medium transition-colors cursor-pointer ${
                  sidebarTab === "telemetry"
                    ? "bg-zinc-800 text-cyan-400 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Telemetry</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab("log")}
                className={`py-1.5 px-2 rounded flex items-center justify-center gap-1 font-medium transition-colors cursor-pointer ${
                  sidebarTab === "log"
                    ? "bg-zinc-800 text-cyan-400 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                <span>Log ({sim.combatLog.length})</span>
              </button>
            </div>

            {/* Fleet Status Summary Header */}
            <div className="grid grid-cols-2 gap-2 text-xs shrink-0">
              <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-800/40 select-text">
                <div className="flex items-center justify-between text-[10px] text-cyan-400 font-semibold uppercase">
                  <span>Terran</span>
                  <span className="font-mono">{sim.getRollingDPS(0)} DPS</span>
                </div>
                <div className="text-base font-bold text-zinc-100 mt-0.5 select-all">
                  {sim.ships.filter((s) => s.team === 0 && s.isAlive).length}{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    / {sim.ships.filter((s) => s.team === 0).length} active
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-red-950/20 border border-red-800/40 select-text">
                <div className="flex items-center justify-between text-[10px] text-red-400 font-semibold uppercase">
                  <span>Alien</span>
                  <span className="font-mono">{sim.getRollingDPS(1)} DPS</span>
                </div>
                <div className="text-base font-bold text-zinc-100 mt-0.5 select-all">
                  {sim.ships.filter((s) => s.team === 1 && s.isAlive).length}{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    / {sim.ships.filter((s) => s.team === 1).length} active
                  </span>
                </div>
              </div>
            </div>

            {/* TAB 1: Inspected Vessel Details */}
            {sidebarTab === "vessel" && (
              <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col overflow-y-auto select-text">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 select-text">
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
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          selectedShip.team === 0
                            ? "bg-cyan-950 text-cyan-400 border border-cyan-800"
                            : "bg-red-950 text-red-400 border border-red-800"
                        }`}
                      >
                        {selectedShip.team === 0 ? "TERRAN" : "ALIEN"}
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
                          <span className="uppercase text-zinc-300 select-all">
                            {selectedShip.hullClass}
                          </span>
                        </span>
                        <span className="select-all">
                          Heading: {(selectedShip.heading * (180 / Math.PI)).toFixed(0)}°
                        </span>
                      </div>
                    </div>

                    {/* Defense Bars */}
                    <div className="space-y-1.5 text-[10px] font-mono select-text">
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

                    {/* Active Hardpoints with Live Cooldown Indicators */}
                    <div className="pt-2 border-t border-zinc-800/80 select-text">
                      <div className="text-[10px] uppercase font-semibold text-zinc-400 mb-1.5">
                        Hardpoints & Live Cooldowns
                      </div>
                      <div className="space-y-1.5">
                        {selectedShip.turrets.map((t) => {
                          const minDeg = Math.round(t.baseArc[0] * (180 / Math.PI));
                          const maxDeg = Math.round(t.baseArc[1] * (180 / Math.PI));
                          const curDeg = Math.round(t.currentLocalAngle * (180 / Math.PI));
                          const isCoolingDown = t.cooldownTimer > 0;
                          const cdProgress = isCoolingDown
                            ? (t.cooldownTimer / t.weapon.cooldown) * 100
                            : 0;

                          return (
                            <div
                              key={t.id}
                              className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono select-text"
                            >
                              <div className="flex items-center justify-between text-zinc-200 font-medium">
                                <span className="select-all">{t.weapon.name}</span>
                                <span
                                  className={
                                    isCoolingDown ? "text-amber-400" : "text-emerald-400 font-bold"
                                  }
                                >
                                  {isCoolingDown ? `${t.cooldownTimer.toFixed(1)}s` : "READY"}
                                </span>
                              </div>
                              {/* Live Cooldown Bar */}
                              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden my-1">
                                <div
                                  className="h-full bg-amber-500 transition-all"
                                  style={{ width: `${cdProgress}%` }}
                                />
                              </div>
                              <div className="text-[9px] text-zinc-500 flex justify-between select-all">
                                <span>
                                  Arc: [{minDeg}° .. {maxDeg}°] (at {curDeg}°)
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
            )}

            {/* TAB 2: Fleet Battle Telemetry & Real-Time Metrics */}
            {sidebarTab === "telemetry" && (
              <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col gap-3 overflow-y-auto text-xs font-mono select-text">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" /> Combat Telemetry
                  </span>
                  <span className="text-[10px] text-zinc-500 font-normal">
                    {sim.timeElapsed.toFixed(1)}s elapsed
                  </span>
                </div>

                {/* Rolling DPS Comparison Bar */}
                <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                  <div className="flex justify-between text-[11px] font-semibold">
                    <span className="text-cyan-400">Terran: {sim.getRollingDPS(0)} DPS</span>
                    <span className="text-red-400">Alien: {sim.getRollingDPS(1)} DPS</span>
                  </div>
                  {(() => {
                    const totalDPS = sim.getRollingDPS(0) + sim.getRollingDPS(1);
                    const blueShare = totalDPS > 0 ? (sim.getRollingDPS(0) / totalDPS) * 100 : 50;
                    return (
                      <div className="h-2 rounded-full overflow-hidden bg-zinc-800 flex">
                        <div
                          className="bg-cyan-500 transition-all duration-300"
                          style={{ width: `${blueShare}%` }}
                        />
                        <div
                          className="bg-red-500 transition-all duration-300"
                          style={{ width: `${100 - blueShare}%` }}
                        />
                      </div>
                    );
                  })()}
                </div>

                {/* Metric Comparisons */}
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[10px] text-zinc-400 uppercase font-sans mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" /> Total Damage Inflicted
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="text-cyan-400 font-bold">{sim.stats[0].damageDealt} dmg</div>
                      <div className="text-red-400 font-bold text-right">
                        {sim.stats[1].damageDealt} dmg
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[10px] text-zinc-400 uppercase font-sans mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-emerald-400" /> Torpedoes Intercepted (PD)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="text-cyan-400 font-bold">
                        {sim.stats[0].missilesIntercepted} destroyed
                      </div>
                      <div className="text-red-400 font-bold text-right">
                        {sim.stats[1].missilesIntercepted} destroyed
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[10px] text-zinc-400 uppercase font-sans mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Shield className="w-3 h-3 text-cyan-400" /> Shield Damage Absorbed
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="text-cyan-400 font-bold">
                        {sim.stats[0].shieldDamageAbsorbed} absorbed
                      </div>
                      <div className="text-red-400 font-bold text-right">
                        {sim.stats[1].shieldDamageAbsorbed} absorbed
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[10px] text-zinc-400 uppercase font-sans mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Swords className="w-3 h-3 text-purple-400" /> Hulls Lost in Action
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="text-cyan-400 font-bold">
                        {sim.stats[0].shipsLost} casualties
                      </div>
                      <div className="text-red-400 font-bold text-right">
                        {sim.stats[1].shipsLost} casualties
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Live Combat Killfeed & Event Log */}
            {sidebarTab === "log" && (
              <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col overflow-y-auto text-xs font-mono select-text">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between mb-2 pb-1 border-b border-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <ScrollText className="w-3.5 h-3.5 text-cyan-400" /> Tactical Event Log
                  </span>
                  <span className="text-[10px] text-zinc-500 font-normal">
                    {sim.combatLog.length} events
                  </span>
                </div>

                <div className="space-y-1.5 flex-1 overflow-y-auto pr-1">
                  {sim.combatLog.length === 0 ? (
                    <div className="text-center text-zinc-600 text-xs py-8">
                      No combat events recorded yet. Battle in progress...
                    </div>
                  ) : (
                    sim.combatLog.map((event) => {
                      const isTerran = event.team === 0;
                      return (
                        <div
                          key={event.id}
                          className={`p-2 rounded border text-[11px] leading-relaxed ${
                            event.type === "critical"
                              ? "bg-amber-950/30 border-amber-800/50 text-amber-300 font-semibold"
                              : isTerran
                                ? "bg-cyan-950/20 border-cyan-800/30 text-cyan-200"
                                : "bg-red-950/20 border-red-800/30 text-red-200"
                          }`}
                        >
                          {event.text}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
