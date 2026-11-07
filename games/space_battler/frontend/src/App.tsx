import {
  Activity,
  BarChart3,
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
import { useEffect, useRef, useState } from "react";
import { TacticalCanvas } from "./canvas/TacticalCanvas";
import { type CrewVeterancy, FleetBuilder } from "./components/FleetBuilder";
import { PerformanceHud, PerformanceSamples } from "./components/PerformanceHud";
import { spaceAudio } from "./engine/audioEngine";
import { BATTLE_MAPS, type BattleMapId } from "./engine/battleMaps";
import { CARRIER_FABRICATION_INTERVAL, carrierFabricationProgress } from "./engine/carrierHangar";
import { fleetAdvantage } from "./engine/fleetAdvantage";
import { FleetBreakdown } from "./engine/fleetBreakdown";
import { buildFleetFromSlots, type FleetSlot } from "./engine/fleetBuilder";
import { FLEET_PRESETS } from "./engine/fleetPresets";
import {
  HARMONIC_ACTIVE_SECONDS,
  HARMONIC_CYCLE_SECONDS,
  HARMONIC_RANGE,
} from "./engine/harmonicShieldSystem";
import { normalizeAngle } from "./engine/math2d";
import { type FleetComposition, SCENARIOS } from "./engine/scenarios";
import { isCapitalShip } from "./engine/shieldGeometry";
import { SHIELD_HAVEN_SLOTS } from "./engine/shieldHaven";
import { HULL_PROFILES } from "./engine/shipProfiles";
import { ClientCombatSimulation } from "./engine/simulation";

const SPEED_LEVELS = [0, 0.5, 1, 2, 5];

const STORAGE_KEYS = {
  activeTab: "gyromouse_sb_active_tab",
  userSlots: "gyromouse_sb_user_slots",
  redSlots: "gyromouse_sb_red_slots",
  enemyPreset: "gyromouse_sb_enemy_preset",
  selectedMap: "gyromouse_sb_selected_map",
  crewVeterancy: "gyromouse_sb_crew_veterancy",
  performanceHud: "gyromouse_sb_performance_hud",
} as const;

const DEFAULT_USER_SLOTS: FleetSlot[] = [
  { id: "bb_1", hullClass: "battleship", groupId: 1 },
  { id: "cv_1", hullClass: "corvette", groupId: 2 },
  { id: "cv_2", hullClass: "corvette", groupId: 2 },
  { id: "sc_1", hullClass: "strike_craft", groupId: 3 },
  { id: "sc_2", hullClass: "strike_craft", groupId: 3 },
  { id: "sc_3", hullClass: "strike_craft", groupId: 3 },
  { id: "sc_4", hullClass: "strike_craft", groupId: 3 },
];

function isFleetSlots(value: unknown): value is FleetSlot[] {
  return (
    Array.isArray(value) &&
    value.every(
      (slot) =>
        slot !== null &&
        typeof slot === "object" &&
        typeof slot.id === "string" &&
        typeof slot.hullClass === "string" &&
        Object.hasOwn(HULL_PROFILES, slot.hullClass) &&
        Number.isInteger(slot.groupId) &&
        (slot.wingSize === undefined || [0, 8, 16].includes(slot.wingSize)) &&
        (slot.escortCount === undefined || [0, 1, 2].includes(slot.escortCount)) &&
        (slot.carrierAnchorId === undefined || typeof slot.carrierAnchorId === "string"),
    )
  );
}

function isCrewVeterancy(value: unknown): value is CrewVeterancy {
  return value === "recruit" || value === "pilot" || value === "veteran" || value === "ace";
}

function slotsFromComposition(composition: FleetComposition[]): FleetSlot[] {
  return composition.flatMap((entry, index) =>
    Array.from({ length: entry.count }, (_, i) => ({
      id: `${index}-${i}`,
      hullClass: entry.hullClass,
      groupId: entry.groupId,
    })),
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"builder" | "battle">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.activeTab);
      if (saved === "builder" || saved === "battle") return saved;
    } catch {
      // ignore storage errors
    }
    return "battle";
  });
  const [speed, setSpeed] = useState<number>(0);
  const [lastActiveSpeed, setLastActiveSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(() => spaceAudio.isMuted());
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [breakdownNotification, setBreakdownNotification] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"vessel" | "telemetry" | "log">("vessel");
  const [showVictoryModal, setShowVictoryModal] = useState<boolean>(true);
  const [ingressRevision, setIngressRevision] = useState(0);
  const [showPerformance, setShowPerformance] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.performanceHud) === "true";
    } catch {
      return false;
    }
  });
  const performanceSamples = useRef(new PerformanceSamples());
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

  // User Fleet Construction State (Blue Task Force) - Persisted across F5 reloads
  const [blueSlots, setBlueSlots] = useState<FleetSlot[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.userSlots);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isFleetSlots(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_USER_SLOTS;
  });
  const [budgetLimit] = useState<number>(30000);
  const [selectedMap, setSelectedMap] = useState<BattleMapId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.selectedMap);
      const map = BATTLE_MAPS.find((entry) => entry.id === saved);
      if (map) return map.id;
    } catch {
      // ignore storage errors
    }
    return "empty_void";
  });
  const [crewVeterancy, setCrewVeterancy] = useState<Record<"blue" | "red", CrewVeterancy>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.crewVeterancy);
      const saved: unknown = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === "object") {
        const tiers = saved as Partial<Record<"blue" | "red", unknown>>;
        return {
          blue: isCrewVeterancy(tiers.blue) ? tiers.blue : "pilot",
          red: isCrewVeterancy(tiers.red) ? tiers.red : "pilot",
        };
      }
    } catch {
      // ignore storage errors
    }
    return { blue: "pilot", red: "pilot" };
  });
  const [enemyPresetId, setEnemyPresetId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.enemyPreset);
      if (
        saved &&
        (saved === "custom" ||
          FLEET_PRESETS.some((p) => p.id === saved) ||
          SCENARIOS.some((s) => `scenario:${s.id}` === saved))
      )
        return saved;
    } catch {
      // ignore storage errors
    }
    return "combined";
  });
  const [redSlots, setRedSlots] = useState<FleetSlot[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.redSlots);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isFleetSlots(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    const scenario = SCENARIOS.find((s) => `scenario:${s.id}` === enemyPresetId);
    const preset = FLEET_PRESETS.find((p) => p.id === enemyPresetId) ?? FLEET_PRESETS[0];
    return slotsFromComposition(scenario?.red ?? preset.composition);
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.activeTab, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.performanceHud, String(showPerformance));
    } catch {
      // ignore storage errors
    }
  }, [showPerformance]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.userSlots, JSON.stringify(blueSlots));
    } catch {
      // ignore
    }
  }, [blueSlots]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.redSlots, JSON.stringify(redSlots));
    } catch {
      // ignore
    }
  }, [redSlots]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.enemyPreset, enemyPresetId);
    } catch {
      // ignore
    }
  }, [enemyPresetId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.selectedMap, selectedMap);
    } catch {
      // ignore storage errors
    }
  }, [selectedMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.crewVeterancy, JSON.stringify(crewVeterancy));
    } catch {
      // ignore storage errors
    }
  }, [crewVeterancy]);

  // Simulation State
  const [sim, setSim] = useState<ClientCombatSimulation>(() => {
    return assembleSimulation(blueSlots, redSlots);
  });
  const [selectedShipId, setSelectedShipId] = useState<string | null>("blue_bb_0");
  const [selectedProjectileId, setSelectedProjectileId] = useState<string | null>(null);

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
          setSelectedProjectileId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sim, lastActiveSpeed]);

  function assembleSimulation(
    blueSlots: FleetSlot[],
    redSlots: FleetSlot[],
  ): ClientCombatSimulation {
    const s = new ClientCombatSimulation(selectedMap);
    s.crewVeterancy = { 0: crewVeterancy.blue, 1: crewVeterancy.red };

    // 1. Build Blue Force (Spawn at -1100u with wide tactical stance)
    const blueShips = buildFleetFromSlots(blueSlots, 0, -1100, 0);
    for (const ship of blueShips) s.addShip(ship);

    // 2. Build Red Force (Spawn at +1100u)
    const redShips = buildFleetFromSlots(redSlots, 1, 1100, Math.PI);
    for (const ship of redShips) s.addShip(ship);

    s.observer = new FleetBreakdown(s);
    return s;
  }

  const selectEnemyPreset = (id: string) => {
    const scenario = SCENARIOS.find((s) => `scenario:${s.id}` === id);
    const preset = FLEET_PRESETS.find((p) => p.id === id);
    if (scenario) {
      setBlueSlots(slotsFromComposition(scenario.blue));
      setRedSlots(slotsFromComposition(scenario.red));
    } else if (preset) {
      setRedSlots(slotsFromComposition(preset.composition));
    }
    setEnemyPresetId(id);
  };

  const updateBlueSlots = (slots: FleetSlot[]) => {
    setBlueSlots(slots);
    if (enemyPresetId.startsWith("scenario:")) setEnemyPresetId("custom");
  };

  const updateRedSlots = (slots: FleetSlot[]) => {
    setRedSlots(slots);
    setEnemyPresetId("custom");
  };

  const resetBattle = () => {
    const s = assembleSimulation(blueSlots, redSlots);
    setSim(s);
    setSelectedShipId(s.ships[0]?.id ?? null);
    setSelectedProjectileId(null);
    setShowVictoryModal(true);
  };

  const handleStartFromBuilder = () => {
    resetBattle();
    setActiveTab("battle");
    setSpeed(1);
    setShowVictoryModal(true);
  };

  const stepForward = () => {
    sim.update(1 / 30, showPerformance ? performanceSamples.current.addStep : undefined);
    setTick((tick) => (tick + 1) % 10000);
  };

  const selectedShip = sim.ships.find((s) => s.id === selectedShipId);
  const selectedVeterancy = selectedShip
    ? (sim.crewVeterancy?.[selectedShip.team] ??
      (selectedShip.team === 0 ? crewVeterancy.blue : crewVeterancy.red) ??
      "pilot")
    : "pilot";
  const havenGuests =
    selectedShip && isCapitalShip(selectedShip)
      ? sim.ships.filter(
          (ship) =>
            ship.isAlive &&
            ship.havenState === "tethered" &&
            ship.havenParentId === selectedShip.id &&
            sim.shieldHaven.getLease(ship.id)?.parentId === selectedShip.id,
        )
      : [];
  const havenParent = selectedShip?.havenParentId
    ? sim.ships.find((ship) => ship.id === selectedShip.havenParentId)
    : undefined;
  const selectedProjectile = sim.projectiles.find((p) => p.id === selectedProjectileId);
  const projectileTarget = selectedProjectile
    ? sim.ships.find((s) => s.id === selectedProjectile.targetId && s.isAlive)
    : undefined;
  const projectileOwner = selectedProjectile
    ? sim.ships.find((s) => s.id === selectedProjectile.ownerId)
    : undefined;
  const canContinueWithRemnants = [0, 1].every((team) =>
    sim.ships.some((ship) => ship.team === team && ship.isAlive),
  );
  const [terranAdvantage, alienAdvantage] = fleetAdvantage(sim.ships, sim.winner);
  const terranPercent = Math.round(terranAdvantage);
  const alienPercent = terranAdvantage + alienAdvantage === 0 ? 0 : 100 - terranPercent;

  const continueBattle = () => {
    if (!canContinueWithRemnants) return;
    sim.continueBattleWithRemnants();
    sim.observer = new FleetBreakdown(sim);
    setIngressRevision((revision) => revision + 1);
    setSelectedShipId(sim.ships[0]?.id ?? null);
    setSelectedProjectileId(null);
    setShowVictoryModal(true);
    setSpeed(lastActiveSpeed > 0 ? lastActiveSpeed : 1);
    setTick((tick) => (tick + 1) % 10000);
  };

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

  const copyFleetBreakdown = async (team?: number) => {
    if (!(sim.observer instanceof FleetBreakdown)) return;
    try {
      const text =
        team === undefined
          ? [sim.observer.format(0), sim.observer.format(1), sim.observer.format()].join("\n\n")
          : sim.observer.format(team);
      await navigator.clipboard.writeText(text);
      setBreakdownNotification(
        `Copied ${team === undefined ? "Battle State" : team === 0 ? "Terran Fleet" : "Alien Fleet"} to clipboard!`,
      );
    } catch {
      setBreakdownNotification("Unable to copy to clipboard.");
    }
  };

  useEffect(() => {
    if (!breakdownNotification) return;
    const timeout = setTimeout(() => setBreakdownNotification(""), 2000);
    return () => clearTimeout(timeout);
  }, [breakdownNotification]);

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
            <span
              title="Battle elapsed time / 300s limit"
              className={`text-xs font-mono tabular-nums ${sim.timeElapsed >= 240 ? "text-red-500 font-bold animate-pulse" : sim.timeElapsed >= 180 ? "text-amber-400" : "text-zinc-300"}`}
            >
              {sim.timeElapsed.toFixed(1)}s / 300s
            </span>
            <button
              type="button"
              onClick={() => {
                if (showPerformance) performanceSamples.current = new PerformanceSamples();
                setShowPerformance(!showPerformance);
              }}
              aria-pressed={showPerformance}
              className={`px-2 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${showPerformance ? "border-cyan-700 text-cyan-400 bg-cyan-950/40" : "border-zinc-800 text-zinc-400 bg-zinc-900 hover:text-zinc-200"}`}
            >
              <Zap className="w-3.5 h-3.5" /> Perf
            </button>
            {sim.winner !== null && !showVictoryModal && (
              <button
                type="button"
                onClick={() => setShowVictoryModal(true)}
                className="px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-900/70 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <BarChart3 className="w-4 h-4" /> Show Battle Summary
              </button>
            )}
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
          blueSlots={blueSlots}
          redSlots={redSlots}
          onUpdateBlueSlots={updateBlueSlots}
          onUpdateRedSlots={updateRedSlots}
          crewVeterancy={crewVeterancy}
          onUpdateCrewVeterancy={(team, tier) =>
            setCrewVeterancy((current) => ({ ...current, [team]: tier }))
          }
          budgetLimit={budgetLimit}
          enemyPresetId={enemyPresetId}
          onSelectEnemyPreset={selectEnemyPreset}
          selectedMap={selectedMap}
          onSelectMap={setSelectedMap}
          onStartBattle={handleStartFromBuilder}
        />
      ) : (
        <main className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 relative bg-black">
            <TacticalCanvas
              sim={sim}
              speed={speed}
              ingressRevision={ingressRevision}
              performanceSamples={showPerformance ? performanceSamples.current : undefined}
              selectedShipId={selectedShipId}
              selectedProjectileId={selectedProjectileId}
              onSelectShip={(id) => {
                setSelectedShipId(id);
                setSelectedProjectileId(null);
                if (id) setSidebarTab("vessel");
              }}
              onSelectProjectile={(id) => {
                setSelectedProjectileId(id);
                setSelectedShipId(null);
                if (id) setSidebarTab("vessel");
              }}
            />
            {showPerformance && <PerformanceHud samples={performanceSamples.current} />}

            {/* Victory / Defeat Modal Overlay */}
            {sim.winner !== null && showVictoryModal && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-30">
                <div
                  className={`max-w-md w-full rounded-2xl border p-6 shadow-2xl bg-zinc-950/95 flex flex-col items-center text-center ${
                    sim.winner === -1
                      ? "border-amber-500/50 shadow-purple-950/50"
                      : sim.winner === 0
                        ? "border-cyan-500/50 shadow-cyan-950/50"
                        : "border-red-500/50 shadow-red-950/50"
                  }`}
                >
                  <div
                    className={`p-4 rounded-2xl mb-4 border ${
                      sim.winner === -1
                        ? "bg-purple-500/10 border-amber-500/30 text-amber-400"
                        : sim.winner === 0
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
                      sim.winner === -1
                        ? "text-amber-400"
                        : sim.winner === 0
                          ? "text-cyan-400"
                          : "text-red-400"
                    }`}
                  >
                    {sim.winner === -1
                      ? "Tactical Stalemate (300s Limit)"
                      : sim.winner === 0
                        ? "Terran Tactical Victory"
                        : "Alien Swarm Victory"}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 font-mono">
                    Engagement resolved in {(sim.winnerDeclaredTime ?? sim.timeElapsed).toFixed(1)}s
                  </p>

                  {/* Summary Comparison Cards */}
                  <div className="grid grid-cols-2 gap-3 w-full my-5 text-left text-xs">
                    <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-800/30">
                      <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-cyan-400 mb-1">
                        <span>Terran Fleet</span>
                        <button
                          type="button"
                          onClick={() => void copyFleetBreakdown(0)}
                          title="Copy Fleet Breakdown"
                          aria-label="Copy Terran fleet breakdown"
                          className="p-1 rounded hover:bg-cyan-800/50 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
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
                      <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-red-400 mb-1">
                        <span>Alien Swarm</span>
                        <button
                          type="button"
                          onClick={() => void copyFleetBreakdown(1)}
                          title="Copy Fleet Breakdown"
                          aria-label="Copy Alien fleet breakdown"
                          className="p-1 rounded hover:bg-red-800/50 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
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

                  {breakdownNotification && (
                    <p role="status" className="text-xs text-cyan-300 mb-3">
                      {breakdownNotification}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <button
                    type="button"
                    onClick={continueBattle}
                    disabled={!canContinueWithRemnants}
                    title="Continue with Remnants"
                    className="w-full mb-3 py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Swords className="w-4 h-4" /> Продовжити бій
                  </button>
                  <p className="text-[11px] text-zinc-400 mb-4">
                    Continue with Remnants · Hull and armor damage preserved; shields recharged.
                  </p>
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
                  <span className="flex items-center gap-1">
                    Terran
                    <button
                      type="button"
                      onClick={() => void copyFleetBreakdown(0)}
                      title="Copy Terran fleet"
                      aria-label="Copy Terran fleet"
                      className="p-1 rounded hover:bg-cyan-800/50 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </span>
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
                  <span className="flex items-center gap-1">
                    Alien
                    <button
                      type="button"
                      onClick={() => void copyFleetBreakdown(1)}
                      title="Copy Alien fleet"
                      aria-label="Copy Alien fleet"
                      className="p-1 rounded hover:bg-red-800/50 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </span>
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

            <div
              className="shrink-0"
              title="Estimated fleet power based on surviving ships and their condition"
            >
              <div className="flex justify-between text-[10px] font-mono font-semibold mb-1">
                <span className="text-cyan-400">{terranPercent}%</span>
                <span className="text-zinc-500 uppercase tracking-wider">Fleet advantage</span>
                <span className="text-red-400">{alienPercent}%</span>
              </div>
              <div
                className="flex h-1.5 rounded-full bg-zinc-800 shadow-[0_0_10px_rgba(34,211,238,0.15)] overflow-hidden"
                role="progressbar"
                aria-label="Terran fleet advantage"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={terranPercent}
                aria-valuetext={`Terran ${terranPercent}%, Alien ${alienPercent}%`}
              >
                <div
                  className="h-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${terranAdvantage}%` }}
                />
                <div
                  className="h-full bg-red-500 transition-all duration-300"
                  style={{ width: `${alienAdvantage}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void copyFleetBreakdown()}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                title="Copy combined battle state"
              >
                <Copy className="w-3.5 h-3.5" /> Copy battle state
              </button>
              {breakdownNotification && (
                <span role="status" className="text-[11px] text-cyan-300">
                  {breakdownNotification}
                </span>
              )}
            </div>

            {/* TAB 1: Inspected Vessel Details */}
            {sidebarTab === "vessel" && selectedProjectileId && (
              <div className="flex-1 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/50 flex flex-col gap-3 overflow-y-auto text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-cyan-400" /> Projectile Telemetry
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedProjectileId(null)}
                    className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    aria-label="Deselect projectile"
                  >
                    Close
                  </button>
                </div>
                {selectedProjectile ? (
                  (() => {
                    const speed = Math.hypot(...selectedProjectile.velocity);
                    const maxHp = selectedProjectile.maxHp;
                    const integrity = Math.max(0, Math.min(1, selectedProjectile.hp / maxHp));
                    const heading = Math.atan2(
                      selectedProjectile.velocity[1],
                      selectedProjectile.velocity[0],
                    );
                    const lifetime =
                      selectedProjectile.weapon.flak?.lifetime ??
                      (selectedProjectile.weapon.range /
                        selectedProjectile.weapon.projectileSpeed) *
                        1.25;
                    const distance = projectileTarget
                      ? Math.hypot(
                          projectileTarget.pos[0] - selectedProjectile.pos[0],
                          projectileTarget.pos[1] - selectedProjectile.pos[1],
                        )
                      : null;
                    const bearing = projectileTarget
                      ? normalizeAngle(
                          Math.atan2(
                            projectileTarget.pos[1] - selectedProjectile.pos[1],
                            projectileTarget.pos[0] - selectedProjectile.pos[0],
                          ) - heading,
                        )
                      : null;
                    const seeking =
                      bearing !== null &&
                      Math.abs(bearing) < Math.PI / 3 &&
                      distance !== null &&
                      distance > 10 &&
                      speed > 1;
                    return (
                      <div className="space-y-3 font-mono text-zinc-300">
                        <div>
                          <div className="font-semibold text-zinc-100">
                            {selectedProjectile.weapon.name}
                          </div>
                          <div className="text-zinc-500">
                            {selectedProjectile.weaponType} ·{" "}
                            {selectedProjectile.ownerTeam === 0 ? "Terran" : "Alien"}
                          </div>
                          <div className="text-zinc-500">
                            Launched by: {projectileOwner?.name ?? "Unknown"}
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <span>Speed</span>
                          <span>{speed.toFixed(1)} u/s</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Heading</span>
                          <span>{(((heading * 180) / Math.PI + 360) % 360).toFixed(0)}°</span>
                        </div>
                        <div>
                          <div className="flex justify-between mb-1">
                            <span>Lifetime</span>
                            <span>
                              {Math.max(0, selectedProjectile.lifetime).toFixed(1)}s remaining
                            </span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-cyan-400"
                              style={{
                                width: `${Math.max(0, Math.min(100, (selectedProjectile.lifetime / lifetime) * 100))}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between mb-1">
                            <span>Hull / Casing Integrity</span>
                            <span>
                              {Number(Math.max(0, selectedProjectile.hp).toFixed(1))} / {maxHp}
                            </span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${integrity > 0.6 ? "bg-green-400" : integrity >= 0.3 ? "bg-yellow-400" : "bg-red-500"}`}
                              style={{ width: `${integrity * 100}%` }}
                              role="progressbar"
                              aria-label="Hull / Casing Integrity"
                              aria-valuemin={0}
                              aria-valuemax={maxHp}
                              aria-valuenow={Math.max(0, Math.min(maxHp, selectedProjectile.hp))}
                            />
                          </div>
                        </div>
                        <div className="pt-2 border-t border-zinc-800 space-y-1">
                          <div>
                            Target:{" "}
                            {projectileTarget?.name ??
                              (selectedProjectile.targetId ? "Lost" : "None")}
                          </div>
                          {distance !== null && <div>Distance: {distance.toFixed(0)}u</div>}
                          {bearing !== null && (
                            <div>
                              Target bearing: {((bearing * 180) / Math.PI).toFixed(1)}° relative
                            </div>
                          )}
                          <div>Guidance: {seeking ? "Tracking target" : "No active turn"}</div>
                          <div className="text-zinc-500">
                            Direct pursuit · ±60° seeker · max turn 22.9°/s
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-zinc-500">Projectile is no longer in flight.</div>
                )}
              </div>
            )}
            {sidebarTab === "vessel" && !selectedProjectileId && (
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
                      <span
                        className={`inline-block mt-2 rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold ${
                          {
                            recruit: "border-zinc-700 bg-zinc-900/50 text-zinc-400",
                            pilot: "border-emerald-800 bg-emerald-950/50 text-cyan-300",
                            veteran: "border-indigo-800 bg-indigo-950/50 text-indigo-300",
                            ace: "border-amber-700 bg-amber-950/50 text-amber-300",
                          }[selectedVeterancy]
                        }`}
                      >
                        {selectedVeterancy.toUpperCase()}
                      </span>
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

                    {isCapitalShip(selectedShip) ? (
                      <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-2.5 text-[10px] font-mono space-y-1.5">
                        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-cyan-400">
                          <Shield className="w-3.5 h-3.5" /> Shield Haven Umbrella
                        </div>
                        <div className="text-zinc-300">
                          1.68x Envelope{" "}
                          {selectedShip.isAlive && selectedShip.shieldCurrent > 0
                            ? "Active"
                            : "Inactive"}
                        </div>
                        <div className="text-zinc-300">
                          Docked Guests: {havenGuests.length} /{" "}
                          {Object.keys(SHIELD_HAVEN_SLOTS).length}
                        </div>
                        {havenGuests.map((guest) => (
                          <div key={guest.id} className="flex justify-between gap-2 text-zinc-400">
                            <span>
                              {guest.name} ({guest.hullClass})
                            </span>
                            <span className="text-cyan-300 text-right">
                              {Math.round(
                                (guest.shieldCurrent / Math.max(1, guest.shieldMax)) * 100,
                              )}
                              % ·{" "}
                              {guest.shieldCurrent >= guest.shieldMax
                                ? "Full"
                                : guest.shieldDelayTimer > 0
                                  ? `Delay ${guest.shieldDelayTimer.toFixed(1)}s`
                                  : guest.shieldRegen > 0
                                    ? "Recharging"
                                    : "Not recharging"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : selectedShip.havenState && selectedShip.havenState !== "none" ? (
                      <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-2.5 text-[10px] font-mono space-y-1.5">
                        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-cyan-400">
                          <Shield className="w-3.5 h-3.5" /> Haven Status
                        </div>
                        <div className="text-zinc-300">
                          {selectedShip.havenState === "tethered"
                            ? `Tethered (Slot: ${selectedShip.havenSlotId ?? "Unknown"})`
                            : selectedShip.havenState.charAt(0).toUpperCase() +
                              selectedShip.havenState.slice(1)}
                        </div>
                        {selectedShip.havenParentId && (
                          <div className="text-zinc-400">
                            Parent:{" "}
                            {havenParent
                              ? `${havenParent.name} (${havenParent.id})`
                              : selectedShip.havenParentId}
                          </div>
                        )}
                        <div className="text-cyan-300">
                          Shield Recovery:{" "}
                          {Math.round(
                            (selectedShip.shieldCurrent / Math.max(1, selectedShip.shieldMax)) *
                              100,
                          )}
                          % / 75%
                        </div>
                      </div>
                    ) : null}

                    {/* Active Hardpoints with Live Cooldown Indicators */}
                    <div className="pt-2 border-t border-zinc-800/80 select-text">
                      <div className="text-[10px] uppercase font-semibold text-zinc-400 mb-1.5">
                        Hardpoints & Live Cooldowns
                      </div>
                      <div className="space-y-1.5">
                        {selectedShip.hullClass === "tender" &&
                          (() => {
                            const state = sim.harmonicShields.getTenderState(
                              selectedShip.id,
                              sim.timeElapsed,
                            );
                            const recipient = sim.ships.find(
                              (ship) => ship.id === state?.recipientId,
                            );
                            const cooling = !state?.active && (state?.cooldownRemaining ?? 0) > 0;
                            const progress = state?.active
                              ? (state.timeRemaining / HARMONIC_ACTIVE_SECONDS) * 100
                              : cooling
                                ? Math.min(
                                    100,
                                    (state.cooldownRemaining /
                                      (HARMONIC_CYCLE_SECONDS - HARMONIC_ACTIVE_SECONDS)) *
                                      100,
                                  )
                                : 0;
                            return (
                              <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono select-text">
                                <div className="text-zinc-200 font-medium">
                                  Harmonic Shield Conduit
                                </div>
                                <div
                                  className={
                                    state?.active
                                      ? "text-cyan-400"
                                      : cooling
                                        ? "text-amber-400"
                                        : "text-emerald-400"
                                  }
                                >
                                  {state?.active
                                    ? `TRANSFERRING (${state.timeRemaining.toFixed(1)}s remaining)`
                                    : cooling
                                      ? `RECHARGING (${state?.cooldownRemaining.toFixed(1)}s)`
                                      : "STANDBY / READY"}
                                </div>
                                {state?.active && (
                                  <div className="text-cyan-300">
                                    Recipient:{" "}
                                    {recipient
                                      ? `${recipient.name} (${recipient.id})`
                                      : state.recipientId}
                                  </div>
                                )}
                                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden my-1">
                                  <div
                                    className={`h-full transition-all ${state?.active ? "bg-cyan-400" : "bg-amber-500"}`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <div className="text-[9px] text-zinc-500 flex justify-between select-all">
                                  <span>Arc: 360° Omnidirectional</span>
                                  <span>Range: {HARMONIC_RANGE}u</span>
                                </div>
                              </div>
                            );
                          })()}
                        {selectedShip.hullClass === "carrier" &&
                          (() => {
                            const fabrication = carrierFabricationProgress(
                              selectedShip,
                              sim.timeElapsed,
                            );
                            const craft = sim.ships.filter(
                              (ship) =>
                                ship.isAlive &&
                                !ship.isDebris &&
                                ship.team === selectedShip.team &&
                                ship.flagshipId === selectedShip.id &&
                                ship.hullClass === "strike_craft",
                            );
                            const active = craft.filter((ship) => !ship.isDocked).length;
                            const ready = craft.filter(
                              (ship) => ship.isDocked && ship.hangarTurnaroundUntil === undefined,
                            ).length;
                            const full = fabrication.currentWings >= fabrication.maxWings;
                            return (
                              <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono select-text">
                                <div className="text-zinc-200 font-medium">
                                  Strike Wing Fabrication (+2 Viper)
                                </div>
                                <div className={full ? "text-emerald-400" : "text-amber-400"}>
                                  {full
                                    ? `HANGAR AT MAX CAPACITY (${fabrication.currentWings}/${fabrication.maxWings})`
                                    : `FABRICATING (${fabrication.timerRemaining.toFixed(1)}s)`}
                                </div>
                                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden my-1">
                                  <div
                                    className={`h-full transition-all ${full ? "bg-emerald-400" : "bg-cyan-400"}`}
                                    style={{
                                      width: `${full ? 100 : Math.max(0, Math.min(100, (1 - fabrication.timerRemaining / CARRIER_FABRICATION_INTERVAL) * 100))}%`,
                                    }}
                                  />
                                </div>
                                <div className="text-zinc-500">
                                  {active} active / {ready} ready in hangar
                                </div>
                              </div>
                            );
                          })()}
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
