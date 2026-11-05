// Tactical Fleet Builder Modal & Panel Component with full-height scroll, text selection, and clear roster

import { ChevronDown, ChevronUp, Copy, Plus, Shield, Swords, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FleetSlot } from "../engine/fleetBuilder";
import { FLEET_PRESETS } from "../engine/fleetPresets";
import { SCENARIOS } from "../engine/scenarios";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { HullClass } from "../types/combat";
import { GroupPreview, ShipPreview, useDelayedPreview } from "./FleetPreviews";

interface FleetBuilderProps {
  blueSlots: FleetSlot[];
  redSlots: FleetSlot[];
  onUpdateBlueSlots: (newSlots: FleetSlot[]) => void;
  onUpdateRedSlots: (newSlots: FleetSlot[]) => void;
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

export const GROUP_THEMES: Record<
  number,
  {
    name: string;
    border: string;
    bg: string;
    text: string;
    badgeBg: string;
    badgeText: string;
    activeBg: string;
    activeText: string;
    glow: string;
  }
> = {
  1: {
    name: "Alpha",
    border: "border-cyan-500/40",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    badgeBg: "bg-cyan-500/20",
    badgeText: "text-cyan-300",
    activeBg: "bg-cyan-500",
    activeText: "text-zinc-950",
    glow: "shadow-cyan-500/25",
  },
  2: {
    name: "Bravo",
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    activeBg: "bg-emerald-500",
    activeText: "text-zinc-950",
    glow: "shadow-emerald-500/25",
  },
  3: {
    name: "Charlie",
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-300",
    activeBg: "bg-amber-500",
    activeText: "text-zinc-950",
    glow: "shadow-amber-500/25",
  },
  4: {
    name: "Delta",
    border: "border-purple-500/40",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-300",
    activeBg: "bg-purple-500",
    activeText: "text-zinc-950",
    glow: "shadow-purple-500/25",
  },
  5: {
    name: "Echo",
    border: "border-rose-500/40",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    badgeBg: "bg-rose-500/20",
    badgeText: "text-rose-300",
    activeBg: "bg-rose-500",
    activeText: "text-zinc-950",
    glow: "shadow-rose-500/25",
  },
};

const HULL_SIZE_ORDER: Record<HullClass, number> = {
  battleship: 1,
  cruiser: 2,
  corvette: 3,
  strike_craft: 4,
};

export const HULL_SPECS = Object.fromEntries(
  Object.entries(HULL_PROFILES).map(([hull, profile]): [string, HullSpecData] => [
    hull,
    {
      name: profile.name,
      cost: profile.cost,
      desc: profile.desc,
      role: profile.role,
      shield: profile.shieldMax,
      armor: profile.armorMax,
      hull: profile.hullMax,
      speed: profile.speed,
      turnRate: profile.turnRateDisplay,
      weapons: profile.turrets.map(({ type, weapon }) => ({ ...weapon, type })),
    },
  ]),
) as Record<HullClass, HullSpecData>;

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
        <path
          d="M21 8 L21 22 M27 8 L27 22 M24 4 L24 21 M20 12 L28 12 M20 16 L28 16"
          strokeWidth="1"
        />
        <path
          d="M12 22 L14 20 L17 20 L19 22 L19 25 L17 27 L14 27 L12 25 Z M29 22 L31 20 L34 20 L36 22 L36 25 L34 27 L31 27 L29 25 Z"
          fill="currentColor"
          fillOpacity="0.3"
          strokeWidth="1"
        />
        <rect
          x="20"
          y="27"
          width="8"
          height="7"
          rx="1"
          fill="currentColor"
          fillOpacity="0.35"
          strokeWidth="1.2"
        />
        <path
          d="M22 29 L26 29 M19 34 L29 34 M17 38 L17 42 M22 38 L22 43 M26 38 L26 43 M31 38 L31 42"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (hullClass === "cruiser") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
        <polygon
          points="24,4 33,16 34,32 31,42 17,42 14,32 15,16"
          fill="currentColor"
          fillOpacity="0.18"
          strokeWidth="1.8"
        />
        <path d="M20 13 L20 19 M28 13 L28 19 M24 8 L24 18" strokeWidth="1.2" />
        <path d="M18 22 L18 32 L30 32 L30 22" strokeWidth="1" />
        <circle cx="24" cy="25" r="4" fill="currentColor" fillOpacity="0.35" strokeWidth="1.2" />
        <path
          d="M18 38 L18 41 M24 37 L24 41 M30 38 L30 41"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (hullClass === "corvette") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
        <polygon
          points="24,4 33,17 36,32 31,41 24,37 17,41 12,32 15,17"
          fill="currentColor"
          fillOpacity="0.18"
          strokeWidth="1.8"
        />
        <path
          d="M24 7 L19 18 L24 21 L29 18 Z M15 23 L19 27 L19 33 M33 23 L29 27 L29 33"
          strokeWidth="1"
        />
        <circle cx="20" cy="25" r="2.5" fill="currentColor" fillOpacity="0.35" strokeWidth="1.2" />
        <circle cx="28" cy="25" r="2.5" fill="currentColor" fillOpacity="0.35" strokeWidth="1.2" />
        <path d="M16 33 L16 38 M32 33 L32 38" strokeWidth="3" strokeLinecap="round" />
        <path d="M16 34 L16 38 M32 34 L32 38" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  // Strike Craft: Swept delta fighter
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
      <polygon
        points="24,5 37,39 29,35 24,42 19,35 11,39"
        fill="currentColor"
        fillOpacity="0.22"
        strokeWidth="1.8"
      />
      <polygon
        points="24,12 27,18 24,22 21,18"
        fill="currentColor"
        fillOpacity="0.35"
        strokeWidth="1"
      />
      <path d="M20 25 L15 35 M28 25 L33 35" strokeWidth="1" />
      <path d="M19 36 L19 39 M29 36 L29 39" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function calculateMaxAffordable(
  count: number,
  remainingBudget: number,
  unitCost: number,
): number {
  if (unitCost <= 0) return count;
  return Math.max(0, count + Math.floor(remainingBudget / unitCost));
}

export function clampTargetCount(parsedValue: number, maxAffordable: number): number {
  const safe = Number.isNaN(parsedValue) ? 0 : Math.max(0, Math.floor(parsedValue));
  return Math.max(0, Math.min(safe, maxAffordable));
}

export function updateSlotsForStackCount(
  slots: FleetSlot[],
  groupId: number,
  hullClass: HullClass,
  targetCount: number,
): FleetSlot[] {
  const matchingIndices: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].groupId === groupId && slots[i].hullClass === hullClass) {
      matchingIndices.push(i);
    }
  }
  const currentCount = matchingIndices.length;
  const clampedTarget = Math.max(0, Math.floor(targetCount));

  if (clampedTarget === currentCount) {
    return slots;
  }

  if (clampedTarget > currentCount) {
    const diff = clampedTarget - currentCount;
    const addedSlots: FleetSlot[] = Array.from({ length: diff }, (_, i) => ({
      id: `${hullClass}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
      hullClass,
      groupId,
    }));
    return [...slots, ...addedSlots];
  }

  const toRemove = currentCount - clampedTarget;
  const indicesToRemove = new Set(matchingIndices.slice(matchingIndices.length - toRemove));
  return slots.filter((_, idx) => !indicesToRemove.has(idx));
}

export interface RosterCountInputProps {
  count: number;
  maxAffordable: number;
  themeText: string;
  hullName: string;
  groupId: number;
  onChangeCount: (newCount: number) => void;
}

export function RosterCountInput({
  count,
  maxAffordable,
  themeText,
  hullName,
  groupId,
  onChangeCount,
}: RosterCountInputProps) {
  const [localValue, setLocalValue] = useState(String(count));
  const isCanceledRef = useRef(false);
  const initialCountRef = useRef(count);

  useEffect(() => {
    setLocalValue(String(count));
  }, [count]);

  const commit = (valueStr: string) => {
    const digitsOnly = valueStr.replace(/[^\d]/g, "");
    const parsed = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10);
    const parsedValue = Number.isNaN(parsed) ? 0 : parsed;
    const targetCount = clampTargetCount(parsedValue, maxAffordable);
    setLocalValue(String(targetCount));
    if (targetCount !== count) {
      onChangeCount(targetCount);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      setLocalValue("");
      return;
    }
    const digitsOnly = raw.replace(/[^\d]/g, "");
    if (digitsOnly === "") {
      setLocalValue("");
      return;
    }
    const parsed = parseInt(digitsOnly, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    const clamped = clampTargetCount(parsed, maxAffordable);
    setLocalValue(String(clamped));
    if (clamped > 0 && clamped !== count) {
      onChangeCount(clamped);
    }
  };

  const handleBlur = () => {
    if (isCanceledRef.current) {
      isCanceledRef.current = false;
      return;
    }
    commit(localValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      isCanceledRef.current = true;
      setLocalValue(String(initialCountRef.current));
      if (count !== initialCountRef.current) {
        onChangeCount(initialCountRef.current);
      }
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (count < maxAffordable) {
        onChangeCount(count + 1);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (count > 0) {
        onChangeCount(count - 1);
      }
    } else if (
      e.key.length === 1 &&
      !/^[0-9]$/.test(e.key) &&
      !((e.ctrlKey || e.metaKey) && !e.altKey)
    ) {
      e.preventDefault();
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        isCanceledRef.current = false;
        initialCountRef.current = count;
        e.target.select();
      }}
      title="Click or type to edit quantity"
      aria-label={`Quantity of ${hullName} in Group ${groupId}`}
      className={`font-mono text-xs font-bold w-9 min-w-[24px] text-center bg-transparent border-0 outline-none focus:bg-zinc-900 focus:ring-1 focus:ring-cyan-500/50 rounded px-0.5 py-0 m-0 ${themeText}`}
    />
  );
}

export function FleetBuilder({
  blueSlots,
  redSlots,
  onUpdateBlueSlots,
  onUpdateRedSlots,
  budgetLimit,
  enemyPresetId,
  onSelectEnemyPreset,
  onStartBattle,
}: FleetBuilderProps) {
  const [activeTeam, setActiveTeam] = useState<"blue" | "red">("blue");
  const [selectedGroup, setSelectedGroup] = useState<number>(1);
  const shipPreview = useDelayedPreview<HullClass>(250);
  const groupPreview = useDelayedPreview<number>(200);
  const slots = activeTeam === "blue" ? blueSlots : redSlots;
  const onUpdateSlots = activeTeam === "blue" ? onUpdateBlueSlots : onUpdateRedSlots;
  const selectedScenario = SCENARIOS.find((s) => `scenario:${s.id}` === enemyPresetId);
  const selectedPreset = FLEET_PRESETS.find((p) => p.id === enemyPresetId);

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

  const addShip = (hullClass: HullClass, targetGroup = selectedGroup) => {
    if (currentCost + HULL_SPECS[hullClass].cost > budgetLimit) return;
    onUpdateSlots([
      ...slots,
      {
        id: `${hullClass}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        hullClass,
        groupId: targetGroup,
      },
    ]);
  };

  const setStackCount = (groupId: number, hullClass: HullClass, targetCount: number) => {
    const unitCost = HULL_SPECS[hullClass].cost;
    const currentCount = slots.filter(
      (s) => s.groupId === groupId && s.hullClass === hullClass,
    ).length;
    const maxAffordable = calculateMaxAffordable(currentCount, remainingBudget, unitCost);
    const clampedTarget = clampTargetCount(targetCount, maxAffordable);
    const updated = updateSlotsForStackCount(slots, groupId, hullClass, clampedTarget);
    onUpdateSlots(updated);
  };

  const decrementStack = (groupId: number, hullClass: HullClass) => {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].groupId === groupId && slots[i].hullClass === hullClass) {
        onUpdateSlots([...slots.slice(0, i), ...slots.slice(i + 1)]);
        return;
      }
    }
  };

  const removeStack = (groupId: number, hullClass: HullClass) => {
    onUpdateSlots(slots.filter((s) => !(s.groupId === groupId && s.hullClass === hullClass)));
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="Fleet to edit">
          <button
            type="button"
            onClick={() => setActiveTeam("blue")}
            aria-pressed={activeTeam === "blue"}
            className={`px-3 py-2.5 rounded-lg border text-xs font-semibold text-left transition-colors cursor-pointer ${
              activeTeam === "blue"
                ? "bg-cyan-950/50 border-cyan-500 text-cyan-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-cyan-800"
            }`}
          >
            🔵 Terran Task Force (Blue)
          </button>
          <button
            type="button"
            onClick={() => setActiveTeam("red")}
            aria-pressed={activeTeam === "red"}
            className={`px-3 py-2.5 rounded-lg border text-xs font-semibold text-left transition-colors cursor-pointer ${
              activeTeam === "red"
                ? "bg-red-950/50 border-red-500 text-red-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-red-800"
            }`}
          >
            🔴 Opposing Force (Red)
          </button>
        </div>

        {/* Group Selector with Counts */}
        <div className="relative p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex justify-between select-text">
            <span>Operational Group Assignment</span>
            <span className="text-cyan-400 font-mono">
              Target: Group {selectedGroup} ({groupCounts[selectedGroup] || 0} vessels)
            </span>
            {groupPreview.active !== null && <GroupPreview group={groupPreview.active} />}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[1, 2, 3, 4, 5].map((g) => {
              const count = groupCounts[g] || 0;
              const isSelected = selectedGroup === g;
              const theme = GROUP_THEMES[g] || GROUP_THEMES[1];
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelectedGroup(g)}
                  onMouseEnter={() => groupPreview.show(g)}
                  onMouseLeave={groupPreview.hide}
                  onFocus={() => groupPreview.show(g)}
                  onBlur={groupPreview.hide}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer flex items-center gap-2 border ${
                    isSelected
                      ? `${theme.activeBg} ${theme.activeText} font-bold ${theme.glow} shadow-md border-transparent`
                      : count > 0
                        ? `${theme.bg} ${theme.border} ${theme.text} hover:bg-zinc-800`
                        : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSelected ? "bg-zinc-950" : count > 0 ? theme.activeBg : "bg-zinc-700"
                      }`}
                    />
                    GRP {g}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[11px] font-bold ${
                      isSelected
                        ? "bg-zinc-950/30 text-zinc-950"
                        : count > 0
                          ? `${theme.badgeBg} ${theme.badgeText}`
                          : "bg-zinc-800 text-zinc-600"
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
            const isInspecting = shipPreview.active === hull;
            const activeTheme = GROUP_THEMES[selectedGroup] || GROUP_THEMES[1];

            return (
              <div
                key={hull}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between select-text relative ${
                  isInspecting
                    ? "border-cyan-500/50 bg-zinc-900/90 shadow-md shadow-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                {isInspecting && <ShipPreview hull={hull} />}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        onMouseEnter={() => shipPreview.show(hull)}
                        onMouseLeave={shipPreview.hide}
                        className="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-cyan-400 shrink-0"
                      >
                        <ShipSilhouette hullClass={hull} className="w-7 h-7" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-zinc-100 select-all">
                          {spec.name}
                        </div>
                        <span className="text-[11px] uppercase font-mono text-cyan-300">
                          {spec.role}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="text-xs font-mono font-bold text-zinc-200 block select-all">
                        {spec.cost} CR
                      </span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold transition-colors ${
                            counts.group > 0
                              ? `${activeTheme.bg} ${activeTheme.border} ${activeTheme.text}`
                              : "bg-zinc-950/60 border-zinc-800 text-zinc-500"
                          }`}
                          title={`Assigned to Group ${selectedGroup}`}
                        >
                          GRP {selectedGroup}: {counts.group}
                        </span>
                        <span
                          className="text-[10px] font-mono text-zinc-400"
                          title="Total across all groups"
                        >
                          ({counts.total} total)
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 mt-2.5 leading-relaxed select-text">
                    {spec.desc}
                  </p>

                  {/* Compact Stats Row */}
                  <div className="grid grid-cols-4 gap-1.5 mt-3 pt-2.5 border-t border-zinc-800/80 text-[11px] font-mono">
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">SHIELD</span>
                      <span className="text-cyan-400 font-semibold">{spec.shield}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">ARMOR</span>
                      <span className="text-amber-400 font-semibold">{spec.armor}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">HULL</span>
                      <span className="text-emerald-400 font-semibold">{spec.hull}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">SPEED</span>
                      <span className="text-zinc-300 font-semibold">{spec.speed} u/s</span>
                    </div>
                  </div>

                  {/* Permanent Armament Loadout - Fixed height so cards never jump on hover */}
                  <div
                    className={`mt-2.5 p-2 rounded-lg text-[11px] font-mono min-h-[56px] flex flex-col justify-center transition-colors ${
                      isInspecting
                        ? "bg-zinc-950 border border-cyan-500/40 text-cyan-300"
                        : "bg-zinc-950/60 border border-zinc-800/80 text-zinc-400"
                    }`}
                  >
                    <div className="text-zinc-300 font-semibold flex items-center gap-1 text-[11px] uppercase tracking-wider mb-1">
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
      <div className="w-full md:w-96 md:shrink-0 flex flex-col gap-4 min-h-0 md:h-full">
        {/* Budget Bar */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 select-text">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-zinc-400">{activeTeam === "blue" ? "Blue" : "Red"} Budget</span>
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
          <div className="pb-3 border-b border-zinc-800 shrink-0 space-y-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 select-all block">
                {activeTeam === "blue" ? "Blue" : "Red"} Active Roster ({slots.length} hulls)
              </span>
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[1, 2, 3, 4, 5]
                    .filter((g) => groupCounts[g] && groupCounts[g] > 0)
                    .map((g) => {
                      const theme = GROUP_THEMES[g];
                      return (
                        <span
                          key={g}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${theme.bg} ${theme.border} ${theme.text} font-bold`}
                        >
                          G{g}: {groupCounts[g]}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={slots.length === 0}
                title="Remove all vessels from the active roster"
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-red-950/30 border-red-800/50 text-red-400 hover:bg-red-900/40 hover:border-red-700 transition-colors cursor-pointer disabled:bg-zinc-900 disabled:border-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3 h-3" /> Clear All
              </button>
              <button
                type="button"
                onClick={() => onUpdateRedSlots(blueSlots.map((slot) => ({ ...slot })))}
                disabled={blueSlots.length === 0}
                title="Copy the Blue fleet to Red"
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-cyan-700 hover:text-cyan-300 transition-colors cursor-pointer disabled:border-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
              >
                <Copy className="w-3 h-3" /> Mirror Fleet
              </button>
            </div>
          </div>

          <div key={activeTeam} className="flex-1 overflow-y-auto space-y-2 py-3 pr-1">
            {slots.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center p-6 text-xs text-zinc-600 select-text">
                Fleet is currently empty. Enlist vessels from the hangar.
              </div>
            ) : (
              (() => {
                const stackMap = new Map<
                  string,
                  { groupId: number; hullClass: HullClass; count: number }
                >();
                for (const s of slots) {
                  const key = `${s.groupId}_${s.hullClass}`;
                  const existing = stackMap.get(key);
                  if (existing) {
                    existing.count += 1;
                  } else {
                    stackMap.set(key, {
                      groupId: s.groupId,
                      hullClass: s.hullClass,
                      count: 1,
                    });
                  }
                }

                const sortedStacks = [...stackMap.values()].sort((a, b) => {
                  if (a.groupId !== b.groupId) {
                    return a.groupId - b.groupId;
                  }
                  return HULL_SIZE_ORDER[a.hullClass] - HULL_SIZE_ORDER[b.hullClass];
                });

                return sortedStacks.map((stack, idx) => {
                  const theme = GROUP_THEMES[stack.groupId] || GROUP_THEMES[1];
                  const isFirstOfGroup =
                    idx === 0 || sortedStacks[idx - 1].groupId !== stack.groupId;
                  const unitCost = HULL_SPECS[stack.hullClass].cost;
                  const totalStackCost = stack.count * unitCost;
                  const canAddOne = remainingBudget >= unitCost;
                  const maxAffordable = calculateMaxAffordable(
                    stack.count,
                    remainingBudget,
                    unitCost,
                  );

                  return (
                    <div key={`${stack.groupId}_${stack.hullClass}`} className="space-y-1">
                      {isFirstOfGroup && (
                        <div className="flex items-center justify-between pt-1 pb-0.5 px-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider">
                          <span className={theme.text}>
                            Group {stack.groupId} ({theme.name})
                          </span>
                          <span className="text-zinc-500">
                            {groupCounts[stack.groupId]}{" "}
                            {groupCounts[stack.groupId] === 1 ? "vessel" : "vessels"}
                          </span>
                        </div>
                      )}
                      <div
                        className={`p-2.5 rounded-lg bg-zinc-900 border ${theme.border} text-xs flex items-center justify-between select-text hover:bg-zinc-800/60 transition-colors gap-2`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
                            <ShipSilhouette hullClass={stack.hullClass} className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold tracking-wide border ${theme.bg} ${theme.border} ${theme.text} select-all shrink-0`}
                              >
                                G{stack.groupId}
                              </span>
                              <span className="font-semibold text-zinc-100 select-all text-xs truncate">
                                {HULL_SPECS[stack.hullClass].name}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Up/Down Quantity Stepper with Direct Numeric Input */}
                          <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-md px-1.5 py-0.5">
                            <RosterCountInput
                              count={stack.count}
                              maxAffordable={maxAffordable}
                              themeText={theme.text}
                              hullName={HULL_SPECS[stack.hullClass].name}
                              groupId={stack.groupId}
                              onChangeCount={(newCount) =>
                                setStackCount(stack.groupId, stack.hullClass, newCount)
                              }
                            />
                            <div className="flex flex-col -my-0.5">
                              <button
                                type="button"
                                disabled={!canAddOne}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => addShip(stack.hullClass, stack.groupId)}
                                title={
                                  canAddOne
                                    ? `Add 1 ${HULL_SPECS[stack.hullClass].name} to Group ${stack.groupId}`
                                    : "Insufficient budget"
                                }
                                className={`p-0.5 rounded transition-colors ${
                                  canAddOne
                                    ? "text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800 cursor-pointer"
                                    : "text-zinc-700 cursor-not-allowed"
                                }`}
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => decrementStack(stack.groupId, stack.hullClass)}
                                title={`Remove 1 ${HULL_SPECS[stack.hullClass].name} from Group ${stack.groupId}`}
                                className="p-0.5 rounded text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <span className="font-mono text-xs font-semibold text-zinc-200 select-all min-w-[58px] text-right">
                            {totalStackCost} CR
                          </span>

                          <button
                            type="button"
                            onClick={() => removeStack(stack.groupId, stack.hullClass)}
                            title="Remove entire group stack"
                            className="text-zinc-500 hover:text-red-400 p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
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
            <option value="custom">Custom (Build Opposing Fleet)</option>
            <optgroup label="Opposing Fleet Presets">
              {FLEET_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.budget} CR)
                </option>
              ))}
            </optgroup>
            <optgroup label="Tactical Scenarios (Load Both Fleets)">
              {SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={`scenario:${scenario.id}`}>
                  {scenario.label.replace(/\bSC\b/g, "Fighters")}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="text-[11px] text-zinc-500 italic mt-1 select-text">
            {selectedPreset?.description ??
              (selectedScenario
                ? "Loads the suggested Blue and Red fleets for this matchup."
                : "Edit either fleet in the hangar to build your own matchup.")}
          </p>
        </div>

        {/* Start Button */}
        <button
          type="button"
          disabled={blueSlots.length === 0 || redSlots.length === 0}
          onClick={onStartBattle}
          className={`w-full py-3.5 rounded-xl font-semibold text-xs tracking-wide uppercase flex items-center justify-center gap-2 transition-all shrink-0 ${
            blueSlots.length > 0 && redSlots.length > 0
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
