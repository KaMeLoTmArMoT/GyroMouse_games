// Tactical Fleet Builder Modal & Panel Component

import { Plus, Shield, Swords, Trash2 } from "lucide-react";
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

const HULL_SPECS: Record<HullClass, { name: string; cost: number; desc: string; role: string }> = {
  battleship: {
    name: "Leviathan Battleship",
    cost: 3200,
    desc: "Devastating spinal railgun (180 dmg) + dual broadside beam batteries.",
    role: "Capital Flagship",
  },
  cruiser: {
    name: "Vanguard Cruiser",
    cost: 1100,
    desc: "Heavy 360° beam laser + prow heavy torpedo launcher.",
    role: "Medium Combatant",
  },
  corvette: {
    name: "Aegis Corvette",
    cost: 350,
    desc: "Dual rapid flak PD turrets (360°). Intercepts missiles and fighters.",
    role: "Escort Screen",
  },
  strike_craft: {
    name: "Raider Interceptor",
    cost: 120,
    desc: "Agile fighter equipped with forward plasma bolt.",
    role: "Strike Swarm",
  },
};

export function FleetBuilder({
  slots,
  onUpdateSlots,
  budgetLimit,
  enemyPresetId,
  onSelectEnemyPreset,
  onStartBattle,
}: FleetBuilderProps) {
  const [selectedGroup, setSelectedGroup] = useState<number>(1);

  const currentCost = slots.reduce((acc, slot) => acc + HULL_SPECS[slot.hullClass].cost, 0);
  const remainingBudget = budgetLimit - currentCost;

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
    <div className="flex-1 flex flex-col md:flex-row gap-6 p-6 overflow-y-auto bg-zinc-950 text-zinc-100">
      {/* Left: Ship Catalog & Group Selection */}
      <div className="flex-1 space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-wide flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" /> Fleet Assembly Hangar
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Assemble your Task Force within the credit allocation. Assign ships to tactical groups.
          </p>
        </div>

        {/* Group Selector */}
        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex justify-between">
            <span>Operational Group Assignment</span>
            <span className="text-cyan-400 font-mono">Active: Group {selectedGroup}</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[1, 2, 3, 4, 5].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGroup(g)}
                className={`px-3 py-1.5 rounded text-xs font-mono transition-colors cursor-pointer ${
                  selectedGroup === g
                    ? "bg-cyan-500 text-zinc-950 font-medium"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                GRP {g}
              </button>
            ))}
          </div>
        </div>

        {/* Ship Catalog */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(HULL_SPECS) as HullClass[]).map((hull) => {
            const spec = HULL_SPECS[hull];
            const canAfford = remainingBudget >= spec.cost;

            return (
              <div
                key={hull}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-zinc-100">{spec.name}</div>
                      <span className="text-[10px] uppercase font-mono text-cyan-400">
                        {spec.role}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-zinc-200">
                      {spec.cost} CR
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed">{spec.desc}</p>
                </div>

                <button
                  type="button"
                  disabled={!canAfford}
                  onClick={() => addShip(hull)}
                  className={`mt-4 w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    canAfford
                      ? "bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500 text-cyan-300 hover:text-zinc-950 cursor-pointer"
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

      {/* Right: Roster & Enemy Preset Selector */}
      <div className="w-full md:w-96 flex flex-col gap-4">
        {/* Budget Bar */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
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

        {/* Selected Fleet Roster */}
        <div className="flex-1 border border-zinc-800 rounded-xl bg-zinc-900/40 p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Active Roster ({slots.length} hulls)
            </span>
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

          <div className="flex-1 overflow-y-auto space-y-2 py-3 max-h-60">
            {slots.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center p-6 text-xs text-zinc-600">
                Fleet is currently empty. Enlist vessels from the hangar.
              </div>
            ) : (
              slots.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-zinc-800 text-cyan-400">
                      G{s.groupId}
                    </span>
                    <span className="font-medium text-zinc-200">
                      {HULL_SPECS[s.hullClass].name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-400">
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
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
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
          <p className="text-[11px] text-zinc-500 italic mt-1">
            {FLEET_PRESETS.find((p) => p.id === enemyPresetId)?.description}
          </p>
        </div>

        {/* Start Button */}
        <button
          type="button"
          disabled={slots.length === 0}
          onClick={onStartBattle}
          className={`w-full py-3.5 rounded-xl font-semibold text-xs tracking-wide uppercase flex items-center justify-center gap-2 transition-all ${
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
