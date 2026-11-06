// Tactical Fleet Builder Modal & Panel Component with full-height scroll, text selection, and clear roster

import { ChevronDown, ChevronUp, Copy, Plus, Shield, Swords, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type FleetSlot, fleetSlotCost } from "../engine/fleetBuilder";
import { FLEET_PRESETS } from "../engine/fleetPresets";
import { SCENARIOS } from "../engine/scenarios";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { HullClass } from "../types/combat";
import { DoctrineDialog } from "./DoctrineDialog";
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
  mountId: string;
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

const RED_THEME = {
  border: "border-red-900/40",
  bg: "bg-red-950/50",
  text: "text-red-400",
  badgeBg: "bg-red-950/50",
  badgeText: "text-red-300",
  activeBg: "bg-red-900/70",
  activeText: "text-rose-300",
  glow: "shadow-red-950/40",
};

const HULL_SIZE_ORDER: Record<HullClass, number> = {
  dreadnought: 0,
  carrier: 1,
  battleship: 2,
  cruiser: 3,
  tender: 4,
  missile_frigate: 5,
  corvette: 6,
  strike_craft: 7,
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
      weapons: profile.turrets.map(({ id, type, weapon }) => ({ ...weapon, type, mountId: id })),
    },
  ]),
) as Record<HullClass, HullSpecData>;

const HULL_CATALOG = (Object.keys(HULL_SPECS) as HullClass[]).sort(
  (a, b) => HULL_SIZE_ORDER[a] - HULL_SIZE_ORDER[b],
);

export function ShipSilhouette({
  hullClass,
  team = 0,
  className = "w-6 h-6",
}: {
  hullClass: HullClass;
  team?: 0 | 1;
  className?: string;
}) {
  const hulls: Record<0 | 1, Record<HullClass, string>> = {
    0: {
      carrier:
        "M1.25 0 L.75 -.35 L.35 -.42 L.12 -.68 L-.82 -.68 L-1.08 -.48 L-1.08 .48 L-.82 .68 L.12 .68 L.35 .42 L.75 .35 Z",
      strike_craft: "M1.1 0 L-.7 -.55 L-.5 -.2 L-.85 0 L-.5 .2 L-.7 .55 Z",
      corvette: "M1.15 0 L.4 -.45 L-.5 -.58 L-.95 -.32 L-.75 0 L-.95 .32 L-.5 .58 L.4 .45 Z",
      tender:
        "M1.04 0 L.58 -.4 L.25 -.5 L.08 -.82 L-.55 -.82 L-.66 -.48 L-.82 -.34 L-.82 .34 L-.66 .48 L-.55 .82 L.08 .82 L.25 .5 L.58 .4 Z",
      cruiser:
        "M1.22 0 L.6 -.38 L.2 -.38 L-.65 -.5 L-1.1 -.28 L-1.1 .28 L-.65 .5 L.2 .38 L.6 .38 Z",
      battleship:
        "M1.28 0 L.8 -.38 L.25 -.58 L-.85 -.62 L-1.2 -.35 L-1.2 .35 L-.85 .62 L.25 .58 L.8 .38 Z",
      dreadnought:
        "M1.25 0 L.85 -.4 L.3 -.48 L.14 -.67 L-.58 -.67 L-.78 -.52 L-1.12 -.42 L-1.12 .42 L-.78 .52 L-.58 .67 L.14 .67 L.3 .48 L.85 .4 Z",
      missile_frigate: "M1.2 0 L.4 -.3 L-.55 -.46 L-.95 -.34 L-.78 0 L-.95 .34 L-.55 .46 L.4 .3 Z",
    },
    1: {
      carrier:
        "M1.25 0 C.9 -.18 .45 -.7 -.2 -.67 C-.65 -.7 -1.18 -.57 -1.08 -.35 C-.78 -.18 -.78 .18 -1.08 .35 C-1.18 .57 -.65 .7 -.2 .67 C.45 .7 .9 .18 1.25 0 Z",
      strike_craft:
        "M.85 -.6884 Q.15 -.1252 -.65 -.3505 L-.35 0 L-.65 .3505 Q.15 .1252 .85 .6884 Q.55 0 .85 -.6884 Z",
      corvette: "M1.15 0 Q.25 -.7916 -.75 -.548 Q-.45 0 -.75 .548 Q.25 .7916 1.15 0 Z",
      tender:
        "M.92 0 C.65 -.25 .1 -.68 -.58 -.52 C-.92 -.36 -.85 -.14 -.8 0 C-.85 .14 -.92 .36 -.58 .52 C.1 .68 .65 .25 .92 0 Z M-.5 -.38 C-.25 -.82 .55 -.95 .85 -.68 C.5 -.81 .05 -.65 -.18 -.38 Z M-.5 .38 C-.25 .82 .55 .95 .85 .68 C.5 .81 .05 .65 -.18 .38 Z",
      cruiser:
        "M1.22 -.2411 L.9 0 L1.22 .2411 Q.35 .5479 -.85 .3945 Q-1.1 0 -.85 -.3945 Q.35 -.5479 1.22 -.2411 Z",
      battleship: "M1.28 0 Q.5 -.892 -1.15 -.6559 Q-.4 0 -1.15 .6559 Q.5 .892 1.28 0 Z",
      dreadnought:
        "M1.25 0 Q.85 -.42 .25 -.46 L0 -.68 L-.52 -.64 Q-.9 -.55 -1.12 -.42 L-1.12 .42 Q-.9 .55 -.52 .64 L0 .68 L.25 .46 Q.85 .42 1.25 0 Z",
      missile_frigate:
        "M1.2 0 Q.35 -.48 -.85 -.42 L-.92 -.15 L-.65 0 L-.92 .15 L-.85 .42 Q.35 .48 1.2 0 Z",
    },
  };
  const details: Record<0 | 1, Record<HullClass, string>> = {
    0: {
      carrier:
        "M-.58 -.16 H.5 V.16 H-.58 Z M-.7 -.48 H.1 M-.7 .48 H.1 M-.46 -.1 H.28 L.42 0 L.28 .1 H-.46",
      strike_craft: "M.8 0 L.4 -.12 L.25 0 L.4 .12 Z M-.1 -.12 L-.55 -.35 M-.1 .12 L-.55 .35",
      corvette: "M.8 0 L.4 -.2 L.15 0 L.4 .2 Z M.1 -.3 L-.5 -.4 M.1 .3 L-.5 .4",
      tender:
        "M.42 0 L.25 -.32 H-.3 L-.48 0 L-.3 .32 H.25 Z M-.55 -.66 H.03 M-.55 .66 H.03 M.52 0 H.67",
      cruiser:
        "M.75 0 L-.7 0 M.2 -.22 L-.6 -.3 M.2 .22 L-.6 .3 M-.4 -.14 L-.65 -.14 L-.65 .14 L-.4 .14 Z",
      battleship:
        "M.95 0 L.25 0 M.25 -.3 L-.65 -.35 M.25 .3 L-.65 .35 M-.2 -.16 L-.5 -.16 L-.5 .16 L-.2 .16 Z",
      dreadnought:
        "M.9 0 L-.8 0 M.25 -.3 L-.6 -.42 M.25 .3 L-.6 .42 M0 -.15 L-.3 -.15 L-.3 .15 L0 .15 Z",
      missile_frigate: "M.9 0 L.4 -.13 L.25 0 L.4 .13 Z M.1 -.23 L-.55 -.33 M.1 .23 L-.55 .33",
    },
    1: {
      carrier:
        "M.65 0 C.3 -.22 -.45 -.22 -.6 0 C-.45 .22 .3 .22 .65 0 M-.7 -.48 H.1 M-.7 .48 H.1 M-.75 -.25 Q.3 -.32 .94 0 Q.3 .32 -.75 .25",
      tender: "M.48 0 C.3 -.3 -.3 -.3 -.48 0 C-.3 .3 .3 .3 .48 0 Z M.52 0 H.67",
      strike_craft:
        "M.65 -.45 Q.05 -.1 -.4 -.22 M.65 .45 Q.05 .1 -.4 .22 M.6 0 Q.4 -.1 .25 0 Q.4 .1 .6 0 Z",
      corvette:
        "M.85 0 Q.2 -.35 -.55 -.35 M.85 0 Q.2 .35 -.55 .35 M.45 0 Q.3 -.12 .15 0 Q.3 .12 .45 0 Z",
      cruiser: "M.8 0 Q.2 -.25 -.65 -.25 M.8 0 Q.2 .25 -.65 .25 M.4 0 Q.25 -.1 .1 0 Q.25 .1 .4 0 Z",
      battleship:
        "M.95 0 Q.2 -.45 -.8 -.4 M.95 0 Q.2 .45 -.8 .4 M0 0 Q-.15 -.14 -.3 0 Q-.15 .14 0 0 Z",
      dreadnought:
        "M.9 0 Q.2 -.3 -.8 -.35 M.9 0 Q.2 .3 -.8 .35 M0 0 Q-.15 -.14 -.3 0 Q-.15 .14 0 0 Z",
      missile_frigate:
        "M.9 0 Q.2 -.25 -.7 -.3 M.9 0 Q.2 .25 -.7 .3 M.7 0 Q.55 -.1 .4 0 Q.55 .1 .7 0 Z",
    },
  };
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor">
      <g transform="translate(24 24) rotate(-90) scale(16)">
        <path d={hulls[team][hullClass]} fill="currentColor" fillOpacity="0.18" strokeWidth="0.1" />
        <path d={details[team][hullClass]} strokeWidth="0.06" />
      </g>
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
  redTeam?: boolean;
  hullName: string;
  groupId: number;
  onChangeCount: (newCount: number) => void;
}

export function RosterCountInput({
  count,
  maxAffordable,
  themeText,
  redTeam = false,
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
      className={`font-mono text-xs font-bold w-9 min-w-[24px] text-center bg-transparent border-0 outline-none focus:bg-zinc-900 focus:ring-1 rounded px-0.5 py-0 m-0 ${redTeam ? "focus:ring-red-500/50" : "focus:ring-cyan-500/50"} ${themeText}`}
    />
  );
}

export function FleetBuilder(props: FleetBuilderProps) {
  const [activeTeam, setActiveTeam] = useState<"blue" | "red">("blue");
  return (
    <div className="flex-1 flex gap-2 p-3 overflow-hidden bg-zinc-950 text-zinc-100 select-text">
      <FleetBuilderPanel
        {...props}
        team={activeTeam}
        activeTeam={activeTeam}
        setActiveTeam={setActiveTeam}
      />
      <FleetBuilderPanel
        {...props}
        team={activeTeam === "blue" ? "red" : "blue"}
        activeTeam={activeTeam}
        setActiveTeam={setActiveTeam}
      />
    </div>
  );
}

function FleetBuilderPanel({
  blueSlots,
  redSlots,
  onUpdateBlueSlots,
  onUpdateRedSlots,
  budgetLimit,
  enemyPresetId,
  onSelectEnemyPreset,
  onStartBattle,
  team,
  activeTeam,
  setActiveTeam,
}: FleetBuilderProps & {
  team: "blue" | "red";
  activeTeam: "blue" | "red";
  setActiveTeam: (team: "blue" | "red") => void;
}) {
  const isActive = team === activeTeam;
  const redTeam = team === "red";
  const previewTeam = redTeam ? 1 : 0;
  const [selectedGroup, setSelectedGroup] = useState<number>(1);
  const [doctrineHull, setDoctrineHull] = useState<HullClass | null>(null);
  const shipPreview = useDelayedPreview<HullClass>(250);
  const groupPreview = useDelayedPreview<number>(200);
  const slots = team === "blue" ? blueSlots : redSlots;
  const onUpdateSlots = team === "blue" ? onUpdateBlueSlots : onUpdateRedSlots;
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const carriers = slots.filter((slot) => slot.hullClass === "carrier");
  const selectedCarrier = carriers.find((slot) => slot.id === selectedCarrierId) ?? carriers[0];
  const selectedScenario = SCENARIOS.find((s) => `scenario:${s.id}` === enemyPresetId);
  const selectedPreset = FLEET_PRESETS.find((p) => p.id === enemyPresetId);

  const currentCost = slots.reduce((acc, slot) => acc + fleetSlotCost(slot), 0);
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
      carrier: { total: 0, group: 0 },
      battleship: { total: 0, group: 0 },
      dreadnought: { total: 0, group: 0 },
      cruiser: { total: 0, group: 0 },
      missile_frigate: { total: 0, group: 0 },
      tender: { total: 0, group: 0 },
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

  const updateCarrier = (slot: FleetSlot, changes: Partial<FleetSlot>) => {
    const updated = { ...slot, ...changes };
    if (currentCost - fleetSlotCost(slot) + fleetSlotCost(updated) > budgetLimit) return;
    onUpdateSlots(slots.map((entry) => (entry.id === slot.id ? updated : entry)));
  };

  return (
    <div
      className={
        isActive
          ? "flex-1 min-w-0 flex flex-col md:flex-row gap-2 overflow-hidden"
          : "hidden min-[1536px]:flex w-80 shrink-0 overflow-hidden"
      }
    >
      {/* Left: Ship Catalog & Group Selection */}
      <div className={isActive ? "flex-1 min-w-0 space-y-2 overflow-y-auto pr-1" : "hidden"}>
        <div>
          <h2 className="text-lg font-semibold tracking-wide flex items-center gap-2 select-text">
            <Shield className={`w-5 h-5 ${redTeam ? "text-red-400" : "text-cyan-400"}`} /> Fleet
            Assembly Hangar
          </h2>
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
                ? "bg-zinc-900/90 border-red-900/40 text-rose-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-red-800"
            }`}
          >
            🔴 Opposing Force (Red)
          </button>
        </div>

        {/* Group Selector with Counts */}
        <div className="relative p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex justify-between select-text">
            <span>Operational Group Assignment</span>
            <span className={`font-mono ${redTeam ? "text-red-400" : "text-cyan-400"}`}>
              Target: Group {selectedGroup} ({groupCounts[selectedGroup] || 0} vessels)
            </span>
            {groupPreview.active !== null && (
              <GroupPreview group={groupPreview.active} team={previewTeam} />
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[1, 2, 3, 4, 5].map((g) => {
              const count = groupCounts[g] || 0;
              const isSelected = selectedGroup === g;
              const theme = redTeam ? RED_THEME : GROUP_THEMES[g] || GROUP_THEMES[1];
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
                        isSelected
                          ? redTeam
                            ? "bg-red-400"
                            : "bg-zinc-950"
                          : count > 0
                            ? theme.activeBg
                            : "bg-zinc-700"
                      }`}
                    />
                    GRP {g}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[11px] font-bold ${
                      isSelected
                        ? redTeam
                          ? "bg-red-950/50 text-red-300"
                          : "bg-zinc-950/30 text-zinc-950"
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {HULL_CATALOG.map((hull) => {
            const spec = HULL_SPECS[hull];
            const canAfford = remainingBudget >= spec.cost;
            const counts = hullCounts[hull];
            const groupedWeapons = spec.weapons.reduce<(HullWeaponSpec & { count: number })[]>(
              (groups, weapon) => {
                const match = groups.find(
                  (group) =>
                    group.name === weapon.name &&
                    group.type === weapon.type &&
                    group.damage === weapon.damage &&
                    group.range === weapon.range &&
                    group.cooldown === weapon.cooldown,
                );
                if (match) match.count++;
                else groups.push({ ...weapon, count: 1 });
                return groups;
              },
              [],
            );
            const isInspecting = shipPreview.active === hull;
            const activeTheme = redTeam
              ? RED_THEME
              : GROUP_THEMES[selectedGroup] || GROUP_THEMES[1];

            return (
              <div
                key={hull}
                className={`p-2 rounded-xl border transition-all flex flex-col justify-between select-text relative ${
                  isInspecting
                    ? redTeam
                      ? "border-red-900/40 bg-zinc-900/90 shadow-md shadow-red-950/40"
                      : "border-cyan-500/50 bg-zinc-900/90 shadow-md shadow-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                {isInspecting && <ShipPreview hull={hull} team={previewTeam} />}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        onMouseEnter={() => shipPreview.show(hull)}
                        onMouseLeave={shipPreview.hide}
                        className={`w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0 ${redTeam ? "text-red-400" : "text-cyan-400"}`}
                      >
                        <ShipSilhouette hullClass={hull} team={previewTeam} className="w-7 h-7" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-zinc-100 select-all">
                          {spec.name}
                        </div>
                        <span
                          className={`text-[11px] uppercase font-mono ${redTeam ? "text-red-300" : "text-cyan-300"}`}
                        >
                          {spec.role}
                        </span>
                        <span
                          className="ml-2 text-[10px] font-mono text-zinc-500"
                          title="Hull size"
                        >
                          SIZE {HULL_PROFILES[hull].size}u
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="text-xs font-mono font-bold text-zinc-200 block select-all">
                        {spec.cost.toLocaleString("en-US")} CR
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

                  <p className="text-xs text-zinc-300 mt-1.5 select-text">{spec.desc}</p>
                  {hull === "tender" && (
                    <div className="text-[10px] text-cyan-300">
                      HARMONIC 65 SP/s · 500u · HAVEN +20% · ECM IN RESEARCH
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setDoctrineHull(hull)}
                    aria-label={`View doctrine and states for ${spec.name}`}
                    className={`mt-1.5 rounded border px-2 py-1 text-[11px] font-medium cursor-pointer ${redTeam ? "border-red-900/40 text-red-400 hover:bg-red-950 hover:text-rose-300" : "border-cyan-800/70 text-cyan-400 hover:bg-cyan-950 hover:text-cyan-200"}`}
                  >
                    Doctrine &amp; States
                  </button>

                  {/* Compact Stats Row */}
                  <div className="grid grid-cols-4 gap-1 mt-1.5 pt-1.5 border-t border-zinc-800/80 text-[11px] font-mono">
                    <div className="bg-zinc-950/60 p-0.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">SHIELD</span>
                      <span
                        className={`font-semibold ${redTeam ? "text-red-400" : "text-cyan-400"}`}
                      >
                        {spec.shield}
                      </span>
                    </div>
                    <div className="bg-zinc-950/60 p-0.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">ARMOR</span>
                      <span className="text-amber-400 font-semibold">{spec.armor}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-0.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">HULL</span>
                      <span className="text-emerald-400 font-semibold">{spec.hull}</span>
                    </div>
                    <div className="bg-zinc-950/60 p-0.5 rounded border border-zinc-800/60 text-center">
                      <span className="text-zinc-400 block">SPEED</span>
                      <span className="text-zinc-300 font-semibold">{spec.speed} u/s</span>
                    </div>
                  </div>

                  {/* Permanent Armament Loadout - Fixed height so cards never jump on hover */}
                  <div
                    className={`mt-1.5 p-1.5 rounded-lg text-[11px] font-mono min-h-[56px] flex flex-col justify-center transition-colors ${
                      isInspecting
                        ? redTeam
                          ? "bg-zinc-950 border border-red-950/60 text-red-300"
                          : "bg-zinc-950 border border-cyan-500/40 text-cyan-300"
                        : "bg-zinc-950/60 border border-zinc-800/80 text-zinc-400"
                    }`}
                  >
                    <div className="text-zinc-300 font-semibold flex items-center gap-1 text-[11px] uppercase tracking-wider mb-1">
                      <Zap
                        className={`w-2.5 h-2.5 ${isInspecting ? (redTeam ? "text-red-400" : "text-cyan-400") : "text-zinc-500"}`}
                      />{" "}
                      Armament Loadout
                    </div>
                    <div className="space-y-0.5">
                      {groupedWeapons.map((w) => (
                        <div
                          key={`${w.mountId ?? w.name}`}
                          className="flex justify-between items-center text-zinc-300"
                        >
                          <span className="flex min-w-0 pr-2">
                            <span className="truncate">{w.name}</span>
                            {w.count > 1 && (
                              <span className="ml-1 shrink-0 text-zinc-400">×{w.count}</span>
                            )}
                          </span>
                          <span
                            className={`font-semibold shrink-0 ${redTeam ? "text-red-400" : "text-cyan-400"}`}
                          >
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
                  className={`mt-1.5 w-full py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    canAfford
                      ? redTeam
                        ? "bg-red-950/50 border border-red-900/40 hover:bg-red-900/60 text-red-300 cursor-pointer font-semibold"
                        : "bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500 text-cyan-300 hover:text-zinc-950 cursor-pointer font-semibold"
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
      <div className="w-full md:w-96 min-[1536px]:w-80 md:shrink-0 flex flex-col gap-2 min-h-0 md:h-full">
        {/* Budget Bar */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 select-text">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-zinc-400">{team === "blue" ? "Blue" : "Red"} Budget</span>
            <span
              className={
                remainingBudget < 0 || redTeam
                  ? "text-red-400 font-bold"
                  : "text-cyan-400 font-bold"
              }
            >
              {currentCost} / {budgetLimit} CR
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${remainingBudget < 0 ? "bg-red-500" : redTeam ? "bg-red-700" : "bg-cyan-400"}`}
              style={{ width: `${Math.min(100, (currentCost / budgetLimit) * 100)}%` }}
            />
          </div>
        </div>

        {/* Selected Fleet Roster - Stretches to fill available height cleanly! */}
        <div
          className={`flex-1 border rounded-xl bg-zinc-900/40 p-4 flex flex-col min-h-0 select-text ${redTeam ? "border-red-900/40" : "border-zinc-800"}`}
        >
          <div
            className={`pb-3 border-b shrink-0 space-y-2 ${redTeam ? "border-red-900/40" : "border-zinc-800"}`}
          >
            <div>
              <span
                className={`text-xs font-semibold uppercase tracking-wider select-all block ${redTeam ? "text-red-400" : "text-zinc-400"}`}
              >
                {team === "blue" ? "Blue" : "Red"} Active Roster ({slots.length} hulls)
              </span>
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[1, 2, 3, 4, 5]
                    .filter((g) => groupCounts[g] && groupCounts[g] > 0)
                    .map((g) => {
                      const theme = redTeam ? RED_THEME : GROUP_THEMES[g];
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
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-zinc-900 border-zinc-700 text-zinc-300 transition-colors cursor-pointer disabled:border-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed ${redTeam ? "hover:border-red-700 hover:text-red-300" : "hover:border-cyan-700 hover:text-cyan-300"}`}
              >
                <Copy className="w-3 h-3" /> Mirror Fleet
              </button>
            </div>
          </div>

          <div key={team} className="flex-1 overflow-y-auto space-y-2 py-3 pr-1">
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
                  const groupTheme = GROUP_THEMES[stack.groupId] || GROUP_THEMES[1];
                  const theme = redTeam ? { ...RED_THEME, name: groupTheme.name } : groupTheme;
                  const isFirstOfGroup =
                    idx === 0 || sortedStacks[idx - 1].groupId !== stack.groupId;
                  const unitCost = HULL_SPECS[stack.hullClass].cost;
                  const totalStackCost = slots
                    .filter(
                      (slot) =>
                        slot.groupId === stack.groupId && slot.hullClass === stack.hullClass,
                    )
                    .reduce((total, slot) => total + fleetSlotCost(slot), 0);
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
                          <div
                            className={`w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0 ${redTeam ? "text-red-400" : "text-cyan-400"}`}
                          >
                            <ShipSilhouette
                              hullClass={stack.hullClass}
                              team={previewTeam}
                              className="w-5 h-5"
                            />
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
                              redTeam={redTeam}
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
                                    ? redTeam
                                      ? "text-zinc-400 hover:text-red-400 hover:bg-zinc-800 cursor-pointer"
                                      : "text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800 cursor-pointer"
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
          {selectedCarrier && (
            <div className="overflow-y-auto border-t border-zinc-800 pt-3 space-y-3">
              {(() => {
                const slot = selectedCarrier;
                return (
                  <div
                    key={slot.id}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 space-y-2 text-xs"
                  >
                    <div className="font-semibold text-zinc-200">
                      Carrier · Group {slot.groupId} · {fleetSlotCost(slot)} CR
                    </div>
                    {carriers.length > 1 && (
                      <label className="block text-zinc-400">
                        Select carrier
                        <select
                          aria-label={`${team} carrier`}
                          value={slot.id}
                          onChange={(event) => setSelectedCarrierId(event.target.value)}
                          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-200"
                        >
                          {carriers.map((carrier, index) => (
                            <option key={carrier.id} value={carrier.id}>
                              #{index + 1} · Group {carrier.groupId}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block text-zinc-400">
                      Strike wing
                      <select
                        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-200"
                        value={slot.wingSize ?? 0}
                        onChange={(event) =>
                          updateCarrier(slot, {
                            wingSize: Number(event.target.value) as 0 | 8 | 16,
                          })
                        }
                      >
                        {[0, 8, 16].map((size) => (
                          <option
                            key={size}
                            value={size}
                            disabled={
                              currentCost -
                                fleetSlotCost(slot) +
                                fleetSlotCost({ ...slot, wingSize: size as 0 | 8 | 16 }) >
                              budgetLimit
                            }
                          >
                            {size === 0
                              ? "Empty Hangar (0 craft)"
                              : size === 8
                                ? "Half Wing (+8 craft)"
                                : "Full Wing (+16 craft)"}{" "}
                            · +{size * 120} CR · {3000 + size * 120} CR base
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-zinc-400">
                      Corvette escorts
                      <select
                        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-200"
                        value={slot.escortCount ?? 0}
                        onChange={(event) =>
                          updateCarrier(slot, {
                            escortCount: Number(event.target.value) as 0 | 1 | 2,
                          })
                        }
                      >
                        {[0, 1, 2].map((count) => (
                          <option
                            key={count}
                            value={count}
                            disabled={
                              currentCost -
                                fleetSlotCost(slot) +
                                fleetSlotCost({ ...slot, escortCount: count as 0 | 1 | 2 }) >
                              budgetLimit
                            }
                          >
                            {count === 0 ? "No Escort" : `${count}x Escort Corvette`} · +
                            {count * 350} CR
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Adversary Preset Selector */}
        {isActive && (
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 shrink-0 select-text">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Opposing Fleet Presets
              <select
                value={selectedPreset ? enemyPresetId : "custom"}
                onChange={(e) => onSelectEnemyPreset(e.target.value)}
                className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="custom">
                  {selectedScenario ? "Select a preset" : "Custom Fleet"}
                </option>
                {FLEET_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.budget} CR)
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Tactical Scenarios
              <select
                value={selectedScenario ? enemyPresetId : "custom"}
                onChange={(e) => onSelectEnemyPreset(e.target.value)}
                className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="custom">
                  {selectedPreset ? "Select a scenario" : "Custom Fleet"}
                </option>
                {SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={`scenario:${scenario.id}`}>
                    {scenario.label.replace(/\bSC\b/g, "Fighters")}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-zinc-500 italic mt-1 select-text">
              {selectedPreset?.description ??
                (selectedScenario
                  ? "Loads the suggested Blue and Red fleets for this matchup."
                  : "Edit either fleet in the hangar to build your own matchup.")}
            </p>
          </div>
        )}

        {/* Start Button */}
        {isActive && (
          <button
            type="button"
            disabled={blueSlots.length === 0 || redSlots.length === 0}
            onClick={onStartBattle}
            className={`w-full py-3.5 rounded-xl font-semibold text-xs tracking-wide uppercase flex items-center justify-center gap-2 transition-all shrink-0 ${
              blueSlots.length > 0 && redSlots.length > 0
                ? redTeam
                  ? "bg-red-700 hover:bg-red-600 text-white shadow-lg shadow-red-950/40 cursor-pointer"
                  : "bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-lg shadow-cyan-500/20 cursor-pointer"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            }`}
          >
            <Swords className="w-4 h-4" /> Engage Fleet Simulator
          </button>
        )}
      </div>
      {doctrineHull && (
        <DoctrineDialog
          hull={doctrineHull}
          redTeam={redTeam}
          onClose={() => setDoctrineHull(null)}
        />
      )}
    </div>
  );
}
