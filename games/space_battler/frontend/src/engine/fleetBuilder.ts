// Assembly builder for translating abstract compositions into concrete positioned ShipStates

import type { HullClass, ShipState, Vector2 } from "../types/combat";
import { HULL_PROFILES, instantiateTurrets } from "./shipProfiles";

export interface FleetSlot {
  id: string;
  hullClass: HullClass;
  groupId: number;
}

export function buildFleetFromSlots(
  slots: FleetSlot[],
  team: number,
  baseX: number,
  heading: number,
): ShipState[] {
  const groups = new Map<number, FleetSlot[]>();
  for (const slot of slots) {
    const group = groups.get(slot.groupId) ?? [];
    group.push(slot);
    groups.set(slot.groupId, group);
  }
  const counts = { battleship: 0, cruiser: 0, corvette: 0, strike_craft: 0 };
  const direction = team === 0 ? 1 : -1;
  const offsets: Record<number, Vector2> = {
    1: [0, 0],
    2: [-250 * direction, 450],
    3: [-250 * direction, -450],
    4: [-350 * direction, 0],
    5: [250 * direction, 0],
    6: [-700 * direction, 0],
    7: [-700 * direction, 450],
    8: [-700 * direction, -450],
    9: [250 * direction, 450],
    10: [250 * direction, -450],
  };
  const placed: ShipState[] = [];
  for (const [groupId, group] of [...groups].sort(([a], [b]) => a - b)) {
    const [x, y] = offsets[groupId] ?? [0, 0];
    const ships = buildGroup(group, team, heading, counts);
    if (ships.length === 0) continue;
    const centerX =
      (Math.min(...ships.map((s) => s.pos[0])) + Math.max(...ships.map((s) => s.pos[0]))) / 2;
    for (const ship of ships) {
      ship.pos[0] += baseX + x - centerX;
      ship.pos[1] += y;
      const [startX, startY] = ship.pos;
      const clear = () =>
        placed.every(
          (other) =>
            Math.hypot(ship.pos[0] - other.pos[0], ship.pos[1] - other.pos[1]) >
            (ship.size + other.size) * 1.4 + 20,
        );
      for (let ring = 1; !clear(); ring++) {
        for (let step = 0; step < 16 && !clear(); step++) {
          const angle = (step * Math.PI) / 8;
          ship.pos = [startX + Math.cos(angle) * ring * 20, startY + Math.sin(angle) * ring * 20];
        }
      }
      placed.push(ship);
    }
  }
  return placed;
}

function buildGroup(
  slots: FleetSlot[],
  team: number,
  heading: number,
  counts: Record<HullClass, number>,
): ShipState[] {
  const ships: ShipState[] = [];
  const battleships = slots.filter((s) => s.hullClass === "battleship");
  const cruisers = slots.filter((s) => s.hullClass === "cruiser");
  const corvettes = slots.filter((s) => s.hullClass === "corvette");
  const fighters = slots.filter((s) => s.hullClass === "strike_craft");
  const prefix = team === 0 ? "blue" : "red";
  const anchorIds = [
    ...battleships.map((_, i) => `${prefix}_bb_${counts.battleship + i}`),
    ...cruisers.map((_, i) => `${prefix}_cr_${counts.cruiser + i}`),
  ];
  const addShip = (slot: FleetSlot, idx: number, code: string, name: string, pos: Vector2) => {
    const profile = HULL_PROFILES[slot.hullClass];
    const id = `${prefix}_${code}_${counts[slot.hullClass] + idx}`;
    ships.push({
      id,
      name,
      team,
      groupId: slot.groupId,
      hullClass: slot.hullClass,
      pos,
      velocity: [0, 0],
      heading,
      maxSpeed: profile.speed,
      turnRate: profile.turnRate,
      size: profile.size,
      shieldMax: profile.shieldMax,
      shieldCurrent: profile.shieldMax,
      shieldRegen: profile.shieldRegen,
      shieldDelayTimer: 0,
      shieldRechargeDelay: profile.shieldRechargeDelay,
      armorMax: profile.armorMax,
      armorCurrent: profile.armorMax,
      armorRating: profile.armorRating,
      hullMax: profile.hullMax,
      hullCurrent: profile.hullMax,
      cost: profile.cost,
      isAlive: true,
      ...(slot.hullClass === "corvette"
        ? { flagshipId: anchorIds.length ? anchorIds[idx % anchorIds.length] : undefined }
        : {}),
      turrets: instantiateTurrets(profile, id, idx),
    });
  };
  // 1. Battleships (Center Core)
  battleships.forEach((slot, idx) => {
    addShip(slot, idx, "bb", `Leviathan BB-0${counts.battleship + idx + 1}`, [
      0,
      (idx - (battleships.length - 1) / 2) * 160,
    ]);
  });
  // 2. Cruisers (Flanking lines)
  cruisers.forEach((slot, idx) => {
    const sign = idx % 2 === 0 ? 1 : -1;
    addShip(slot, idx, "cr", `Vanguard CR-0${counts.cruiser + idx + 1}`, [
      (heading === 0 ? 1 : -1) * 60,
      sign * (140 + Math.floor(idx / 2) * 110),
    ]);
  });
  // 3. Corvette escort columns; shield clearance is applied after assembly.
  corvettes.forEach((slot, idx) => {
    const sign = idx % 2 === 0 ? 1 : -1;
    addShip(slot, idx, "cv", `Aegis CV-0${counts.corvette + idx + 1}`, [
      (heading === 0 ? -1 : 1) * 95,
      sign * (145 + Math.floor(idx / 2) * 85),
    ]);
  });
  // 4. Grouped vanguard blocks. Keep shield repulsor zones clear on the first tick.
  const fighterGroups = new Map<number, FleetSlot[]>();
  for (const slot of fighters) {
    const group = fighterGroups.get(slot.groupId) ?? [];
    group.push(slot);
    fighterGroups.set(slot.groupId, group);
  }
  const spacing = 56;
  const maxRows = Math.max(
    1,
    Math.min(5, Math.floor((2 * 520 + spacing) / (fighterGroups.size * spacing))),
  );
  const totalRows = [...fighterGroups.values()].reduce(
    (sum, group) => sum + Math.min(maxRows, group.length),
    0,
  );
  const positionedFighters: { slot: FleetSlot; xOff: number; yOff: number }[] = [];
  let rowOffset = 0;
  for (const group of fighterGroups.values()) {
    const rows = Math.min(maxRows, group.length);
    group.forEach((slot, index) => {
      positionedFighters.push({
        slot,
        xOff: (heading === 0 ? 1 : -1) * (180 + Math.floor(index / rows) * spacing),
        yOff: (rowOffset + (index % rows) - (totalRows - 1) / 2) * spacing,
      });
    });
    rowOffset += rows;
  }
  positionedFighters.forEach(({ slot, xOff, yOff }, idx) => {
    addShip(slot, idx, "sc", `Raider F-${counts.strike_craft + idx + 1}`, [xOff, yOff]);
  });
  // Preserve formation columns and vertical order using the calibrated shield clearance.
  const ordered = [...ships].sort((a, b) => a.pos[1] - b.pos[1]);
  for (let i = 0; i < ordered.length; i++) {
    const shipB = ordered[i];
    for (const shipA of ordered.slice(0, i)) {
      const spacing = (shipA.size * 1.4 + shipB.size * 1.4) * 1.15 + 20;
      if (Math.abs(shipA.pos[0] - shipB.pos[0]) < spacing) {
        shipB.pos[1] = Math.max(shipB.pos[1], shipA.pos[1] + spacing);
      }
    }
  }
  const center = ordered.length ? (ordered[0].pos[1] + ordered[ordered.length - 1].pos[1]) / 2 : 0;
  for (const ship of ships) ship.pos[1] -= center;
  counts.battleship += battleships.length;
  counts.cruiser += cruisers.length;
  counts.corvette += corvettes.length;
  counts.strike_craft += fighters.length;
  return ships;
}
