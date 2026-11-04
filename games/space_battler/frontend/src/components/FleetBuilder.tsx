// Tactical Fleet Builder Modal & Panel Component with full-height scroll, text selection, and clear roster

import { Plus, Shield, Swords, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import type { FleetSlot } from "../engine/fleetBuilder";
import { FLEET_PRESETS } from "../engine/fleetPresets";
import type { HullClass } from "../types/combat";

interface FleetBuilderProps {
  slots: FleetSlot[];
  onUpdateSlots: (newSlots: FleetSlot[]) => void;
  budgetLimit: number;
  enemyPresetId: string;
  onSelectEnemyPreset: (presetId: string) => void;
  onStartBattle: () => void;
}

interface HullWeaponSpec {
  name: string;
  type: string;
  damage: number;
  range: number;
  cooldown: number;
}

interface HullSpecData {
  name: string;
  cost: number;
  desc: string;
  role: string;
  shield: number;
  armor: number;
  hull: number;
  speed: number;
  turnRate: string;
  weapons: HullWeaponSpec[];
}

const HULL_SPECS: Record<HullClass, HullSpecData> = {
  battleship: {
    name: "Leviathan Battleship",
    cost: 3200,
    desc: "Devastating spinal railgun (180 dmg) + dual broadside beam batteries.",
    role: "Capital Flagship",
    shield: 1800,
    armor: 1600,
    hull: 2200,
    speed: 65,
    turnRate: "0.75 rad/s",
    weapons: [
      { name: "Spinal Heavy Railgun", type: "Railgun", damage: 180, range: 980, cooldown: 3.5 },
      {
        name: "Dual Port/Starboard Batteries",
        type: "Beam Laser",
        damage: 50,
        range: 580,
        cooldown: 1.2,
      },
    ],
  },
  cruiser: {
    name: "Vanguard Cruiser",
    cost: 1100,
    desc: "Heavy 360° beam laser + prow heavy torpedo launcher.",
    role: "Medium Combatant",
    shield: 750,
    armor: 600,
    hull: 850,
    speed: 110,
    turnRate: "1.40 rad/s",
    weapons: [
      { name: "Prow Heavy Torpedo", type: "Missile", damage: 220, range: 850, cooldown: 4.8 },
      { name: "Dorsal Turret Battery", type: "Beam Laser", damage: 35, range: 480, cooldown: 1.0 },
    ],
  },
  corvette: {
    name: "Aegis Corvette",
    cost: 350,
    desc: "Dual rapid flak PD turrets (360°). Intercepts missiles, fighters, and fires at enemy ships.",
    role: "Escort Screen",
    shield: 320,
    armor: 220,
    hull: 350,
    speed: 165,
    turnRate: "2.20 rad/s",
    weapons: [
      {
        name: "Dual Rapid Flak Turrets (360°)",
        type: "Point Defense",
        damage: 14,
        range: 360,
        cooldown: 0.15,
      },
    ],
  },
  strike_craft: {
    name: "Raider Interceptor",
    cost: 120,
    desc: "Agile fighter equipped with forward plasma bolt.",
    role: "Strike Swarm",
    shield: 45,
    armor: 30,
    hull: 65,
    speed: 280,
    turnRate: "4.20 rad/s",
    weapons: [
      { name: "Fixed Plasma Cannon", type: "Plasma Bolt", damage: 18, range: 280, cooldown: 0.8 },
    ],
  },
};

export function ShipSilhouette({
  hullClass,
  className = "w-6 h-6",
}: {
  hullClass: HullClass;
  className?: string;
}) {
  if (hullClass === "battleship") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
        <polygon
          points="24,3 35,13 37,35 31,45 17,45 11,35 13,13"
          fill="currentColor"
          fillOpacity="0.18"
          strokeWidth="1.8"
        />
        <line x1="24" y1="2" x2="24" y2="14" strokeWidth="2.2" strokeLinecap="round" />
        <rect
          x="21"
          y="21"
          width="6"
          height="8"
          rx="1"
          fill="currentColor"
          fillOpacity="0.35"
          strokeWidth="1.2"
        />
        <line x1="10" y1="23" x2="15" y2="23" strokeWidth="1.6" />
        <line x1="33" y1="23" x2="38" y2="23" strokeWidth="1.6" />
      </svg>
    );
  }
  if (hullClass === "cruiser") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
        <polygon
          points="24,5 34,25 32,43 27,39 21,39 16,43 14,25"
          fill="currentColor"
          fillOpacity="0.18"
          strokeWidth="1.8"
        />
        <circle cx="24" cy="22" r="3.5" fill="currentColor" fillOpacity="0.35" strokeWidth="1.2" />
        <line x1="24" y1="5" x2="24" y2="13" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (hullClass === "corvette") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
        <polygon
          points="24,7 32,17 32,33 24,41 16,33 16,17"
          fill="currentColor"
          fillOpacity="0.18"
          strokeWidth="1.8"
        />
        <circle cx="15" cy="25" r="2.2" fill="currentColor" strokeWidth="1.2" />
        <circle cx="33" cy="25" r="2.2" fill="currentColor" strokeWidth="1.2" />
        <line x1="24" y1="12" x2="24" y2="24" strokeWidth="1.4" strokeDasharray="2 2" />
      </svg>
    );
  }
  // Strike Craft: Swept delta fighter
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
      <polygon
        points="24,7 35,37 24,30 13,37"
        fill="currentColor"
        fillOpacity="0.22"
        strokeWidth="1.8"
      />
      <polygon
        points="24,14 29,32 24,28 19,32"
        fill="currentColor"
        fillOpacity="0.35"
        strokeWidth="1"
      />
    </svg>
  );
}

export function FleetBuilder({
  slots,
  onUpdateSlots,
  budgetLimit,
  enemyPresetId,
  onSelectEnemyPreset,
  onStartBattle,
}: FleetBuilderProps) {
  const [selectedGroup, setSelectedGroup] = useState<number>(1);
  const [inspectedHull, setInspectedHull] = useState<HullClass | null>(null);

  const currentCost = slots.reduce((acc, slot) => acc + HULL_SPECS[slot.hullClass].cost, 0);
  const remainingBudget = budgetLimit - currentCost;

  // Group counts calculation
  const groupCounts = slots.reduce<Record<number, number>>((acc, s) => {
    acc[s.groupId] = (acc[s.groupId] || 0) + 1;
    return acc;
  }, {});

  // Hull counts in total fleet & active group
  const hullCounts = slots.reduce<Record<HullClass, { total: number; group: number }>>(
    (acc, s) => {
      acc[s.hullClass].total += 1;
      if (s.groupId === selectedGroup) {
        acc[s.hullClass].group += 1;
      }
      return acc;
    },
    {
      battleship: { total: 0, group: 0 },
      cruiser: { total: 0, group: 0 },
      corvette: { total: 0, group: 0 },
      strike_craft: { total: 0, group: 0 },
    },
  );

  const addShip = (hullClass: HullClass) => {
    if (currentCost + HULL_SPECS[hullClass].cost > budgetLimit) return;
    onUpdateSlots([
      ...slots,
      {
        id: `${hullClass}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        hullClass,
        groupId: selectedGroup,
      },
    ]);
  };

  const removeSlot = (id: string) => {
    onUpdateSlots(slots.filter((s) => s.id !== id));
  };

  const clearAll = () => {
    onUpdateSlots([]);
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row gap-6 p-6 overflow-hidden bg-zinc-950 text-zinc-100 select-text">
      {/* Left: Ship Catalog & Group Selection */}
      <div className="flex-1 space-y-5 overflow-y-auto pr-2">
        <div>
          <h2 className="text-lg font-semibold tracking-wide flex items-center gap-2 select-text">
            <Shield className="w-5 h-5 text-cyan-400" /> Fleet Assembly Hangar
          </h2>
          <p className="text-xs text-zinc-400 mt-1 select-text">
            Assemble your Task Force within the credit allocation. Assign ships to tactical groups
            and inspect armament loadouts.
          </p>
        </div>

        {/* Group Selector with Counts */}
        <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex justify-between select-text">
            <span>Operational Group Assignment</span>
            <span className="text-cyan-400 font-mono">
              Target: Group {selectedGroup} ({groupCounts[selectedGroup] || 0} vessels)
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[1, 2, 3, 4, 5].map((g) => {
              const count = groupCounts[g] || 0;
              const isSelected = selectedGroup === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelectedGroup(g)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-cyan-500 text-zinc-950 font-semibold shadow-sm shadow-cyan-500/20"
                      : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                  }`}
                >
                  <span>GRP {g}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isSelected
                        ? "bg-zinc-950/30 text-zinc-950"
                        : count > 0
                          ? "bg-cyan-500/20 text-cyan-400"
                          : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ship Catalog */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {(Object.keys(HULL_SPECS) as HullClass[]).map((hull) => {
            const spec = HULL_SPECS[hull];
            const canAfford = remainingBudget >= spec.cost;
            const counts = hullCounts[hull];
            const isInspecting = inspectedHull === hull;

            return (
              <div
                key={hull}
                onMouseEnter={() => setInspectedHull(hull)}
                onMouseLeave={() => setInspectedHull((prev) => (prev === hull ? null : prev))}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between select-text relative ${
                  isInspecting
                    ? "border-cyan-500/50 bg-zinc-900/90 shadow-md shadow-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
                        <ShipSilhouette hullClass={hull} className="w-7 h-7" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-zinc-100 select-all">
                          {spec.name}
                        </div>
                        <span className="text-[10px] uppercase font-mono text-cyan-400">
                          {spec.role}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-zinc-200 block select-all">
                        {spec.cost} CR
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {counts.total > 0 ? (
                          <span className="text-cyan-400">
                            {counts.total} in fleet (G{selectedGroup}: {counts.group})
                          </span>
                        ) : (
                          "0 in fleet"
                        )}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 mt-2.5 leading-relaxed select-text">
                    {spec.desc}
                  </p>

                  {/* Compact Stats Row */}
                  <div className="grid grid-cols-4 gap-1.5 mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] font-mono">
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-500 block">SHIELD</span>
                      <span className="text-cyan-400 font-semibold">{spec.shield}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-500 block">ARMOR</span>
                      <span className="text-amber-400 font-semibold">{spec.armor}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-500 block">HULL</span>
                      <span className="text-emerald-400 font-semibold">{spec.hull}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-500 block">SPEED</span>
                      <span className="text-zinc-300 font-semibold">{spec.speed} u/s</span>
                    </div>
                  </div>

                  {/* Permanent Armament Loadout - Fixed height so cards never jump on hover */}
                  <div
                    className={`mt-2.5 p-2 rounded-lg text-[10px] font-mono min-h-[56px] flex flex-col justify-center transition-colors ${
                      isInspecting
                        ? "bg-zinc-950 border border-cyan-500/40 text-cyan-300"
                        : "bg-zinc-950/60 border border-zinc-800/80 text-zinc-400"
                    }`}
                  >
                    <div className="text-zinc-500 font-semibold flex items-center gap-1 text-[9px] uppercase tracking-wider mb-1">
                      <Zap
                        className={`w-2.5 h-2.5 ${isInspecting ? "text-cyan-400" : "text-zinc-500"}`}
                      />{" "}
                      Armament Loadout
                    </div>
                    <div className="space-y-0.5">
                      {spec.weapons.map((w) => (
                        <div
                          key={w.name}
                          className="flex justify-between items-center text-zinc-300"
                        >
                          <span className="truncate pr-2">{w.name}</span>
                          <span className="text-cyan-400 font-semibold shrink-0">
                            {w.damage} dmg / {w.range}u
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!canAfford}
                  onClick={() => addShip(hull)}
                  className={`mt-4 w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    canAfford
                      ? "bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500 text-cyan-300 hover:text-zinc-950 cursor-pointer font-semibold"
                      : "bg-zinc-900 border border-zinc-800 text-zinc-600 cursor-not-allowed"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" /> Enlist in Group {selectedGroup}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Full-Height Roster & Enemy Preset Selector */}
      <div className="w-full md:w-96 flex flex-col gap-4 h-full">
        {/* Budget Bar */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 select-text">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-zinc-400">Budget Allocation</span>
            <span className={remainingBudget < 0 ? "text-red-400" : "text-cyan-400 font-bold"}>
              {currentCost} / {budgetLimit} CR
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${remainingBudget < 0 ? "bg-red-500" : "bg-cyan-400"}`}
              style={{ width: `${Math.min(100, (currentCost / budgetLimit) * 100)}%` }}
            />
          </div>
        </div>

        {/* Selected Fleet Roster - Stretches to fill available height cleanly! */}
        <div className="flex-1 border border-zinc-800 rounded-xl bg-zinc-900/40 p-4 flex flex-col min-h-0 select-text">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 select-all block">
                Active Roster ({slots.length} hulls)
              </span>
              {slots.length > 0 && (
                <span className="text-[10px] font-mono text-zinc-500">
                  {[1, 2, 3, 4, 5]
                    .filter((g) => groupCounts[g] && groupCounts[g] > 0)
                    .map((g) => `G${g}: ${groupCounts[g]}`)
                    .join(" • ")}
                </span>
              )}
            </div>
            {slots.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 py-3 pr-1">
            {slots.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center p-6 text-xs text-zinc-600 select-text">
                Fleet is currently empty. Enlist vessels from the hangar.
              </div>
            ) : (
              slots.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex items-center justify-between select-text hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
                      <ShipSilhouette hullClass={s.hullClass} className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-zinc-800 text-cyan-400 select-all font-semibold">
                          G{s.groupId}
                        </span>
                        <span className="font-medium text-zinc-200 select-all">
                          {HULL_SPECS[s.hullClass].name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-400 select-all">
                      {HULL_SPECS[s.hullClass].cost} CR
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSlot(s.id)}
                      className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Adversary Preset Selector */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 shrink-0 select-text">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Select Opposing Red Force
          </div>
          <select
            value={enemyPresetId}
            onChange={(e) => onSelectEnemyPreset(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
          >
            {FLEET_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.budget} CR)
              </option>
            ))}
          </select>
          <p className="text-[11px] text-zinc-500 italic mt-1 select-text">
            {FLEET_PRESETS.find((p) => p.id === enemyPresetId)?.description}
          </p>
        </div>

        {/* Start Button */}
        <button
          type="button"
          disabled={slots.length === 0}
          onClick={onStartBattle}
          className={`w-full py-3.5 rounded-xl font-semibold text-xs tracking-wide uppercase flex items-center justify-center gap-2 transition-all shrink-0 ${
            slots.length > 0
              ? "bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-lg shadow-cyan-500/20 cursor-pointer"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }`}
        >
          <Swords className="w-4 h-4" /> Engage Fleet Simulator
        </button>
      </div>
    </div>
  );
}
