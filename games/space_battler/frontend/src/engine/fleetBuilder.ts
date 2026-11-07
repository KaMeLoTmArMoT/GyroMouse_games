// Assembly builder for translating abstract compositions into concrete positioned ShipStates

import type { HullClass, ShipState, Vector2 } from "../types/combat";
import { storeCarrierAuxiliaries } from "./carrierHangar";
import { clamp } from "./math2d";
import { shieldEnvelopeRadius } from "./shieldGeometry";
import { HULL_PROFILES, instantiateTurrets } from "./shipProfiles";

export interface FleetSlot {
  id: string;
  hullClass: HullClass;
  groupId: number;
  wingSize?: 0 | 8 | 16;
  escortCount?: 0 | 1 | 2;
  carrierAnchorId?: string;
}

export function fleetSlotCost(slot: FleetSlot): number {
  return (
    HULL_PROFILES[slot.hullClass].cost +
    (slot.hullClass === "carrier" ? (slot.wingSize ?? 0) * 120 + (slot.escortCount ?? 0) * 350 : 0)
  );
}

/** Re-form survivors without replacing ship identities or repairing persistent hull damage. */
export function redeployFleetRemnants(ships: ShipState[]): void {
  for (const team of [0, 1]) {
    const survivors = ships.filter((ship) => ship.team === team);
    const formation = buildFleetFromSlots(
      survivors,
      team,
      team === 0 ? -1100 : 1100,
      team === 0 ? 0 : Math.PI,
    );
    const remaining = [...survivors];
    const originalIds = new Map<string, string>();
    const carrierIds = new Set(
      survivors.filter((ship) => ship.hullClass === "carrier").map((ship) => ship.id),
    );
    const carrierAssignments = new Map(
      survivors
        .filter((ship) => ship.flagshipId && carrierIds.has(ship.flagshipId))
        .map((ship) => [ship.id, ship.flagshipId]),
    );
    for (const spawn of formation) {
      const index = remaining.findIndex(
        (ship) => ship.groupId === spawn.groupId && ship.hullClass === spawn.hullClass,
      );
      const [ship] = remaining.splice(index, 1);
      originalIds.set(spawn.id, ship.id);
      ship.pos = spawn.pos;
      ship.velocity = [0, 0];
      ship.heading = spawn.heading;
      ship.shieldCurrent = ship.shieldMax;
      ship.shieldDelayTimer = 0;
      ship.flagshipId = spawn.flagshipId;
      // These describe the previous engagement, whose clock is about to reset.
      ship.fighterPhase = undefined;
      ship.wingIndex = undefined;
      ship.wingSlot = undefined;
      ship.safeHavenId = undefined;
      ship.safeHavenTimer = undefined;
      ship.lastSelectedSector = undefined;
      ship.dogfightTargetId = undefined;
      ship.lastThreatTime = undefined;
      ship.recoveryStarted = undefined;
      ship.nextRecoveryAt = undefined;
      ship.recoveredHull = undefined;
      ship.lastMissionShotTime = undefined;
      ship.capitalManeuver = undefined;
      ship.broadsideCycle = undefined;
      ship.skirmishCycle = undefined;
      ship.maneuverTargetId = undefined;
      ship.navigationTargetId = undefined;
      ship.broadsideSide = undefined;
      ship.lastManeuverShot = undefined;
      ship.escapeSide = undefined;
      ship.escapeUntil = undefined;
      ship.evasionUntil = undefined;
      for (const turret of ship.turrets) {
        turret.cooldownTimer = 0;
        turret.currentLocalAngle = clamp(0, ...turret.baseArc);
        turret.currentTargetId = null;
        turret.currentTargetKind = undefined;
        turret.lastFiredTime = undefined;
      }
    }
    for (const ship of survivors) {
      if (ship.flagshipId) ship.flagshipId = originalIds.get(ship.flagshipId);
      if (carrierAssignments.has(ship.id)) ship.flagshipId = carrierAssignments.get(ship.id);
    }
    storeCarrierAuxiliaries(survivors);
  }
}

// Blue fleet offsets; the opposing fleet mirrors these along the x axis.
export const GROUP_ANCHORS: Record<number, Vector2> = {
  1: [0, 0],
  2: [-250, 450],
  3: [-250, -450],
  4: [-350, 0],
  5: [250, 0],
  6: [-700, 0],
  7: [-700, 450],
  8: [-700, -450],
  9: [250, 450],
  10: [250, -450],
};

export function buildFleetFromSlots(
  slots: FleetSlot[],
  team: number,
  baseX: number,
  heading: number,
  expandedSpacing = false,
): ShipState[] {
  const groups = new Map<number, FleetSlot[]>();
  for (const slot of slots) {
    const group = groups.get(slot.groupId) ?? [];
    group.push(slot);
    groups.set(slot.groupId, group);
  }
  const counts = {
    carrier: 0,
    battleship: 0,
    dreadnought: 0,
    cruiser: 0,
    missile_frigate: 0,
    tender: 0,
    corvette: 0,
    strike_craft: 0,
  };
  const direction = team === 0 ? 1 : -1;
  const placed: ShipState[] = [];
  for (const [groupId, group] of [...groups].sort(([a], [b]) => a - b)) {
    const [anchorX, y] = GROUP_ANCHORS[groupId] ?? [0, 0];
    const x = anchorX * direction;
    const ships = buildGroup(group, team, heading, counts, expandedSpacing);
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
            shieldEnvelopeRadius(ship) + shieldEnvelopeRadius(other) + 20,
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
  storeCarrierAuxiliaries(placed);
  return placed;
}

function buildGroup(
  slots: FleetSlot[],
  team: number,
  heading: number,
  counts: Record<HullClass, number>,
  expandedSpacing: boolean,
): ShipState[] {
  const ships: ShipState[] = [];
  const carriers = slots.filter((s) => s.hullClass === "carrier");
  const prefix = team === 0 ? "blue" : "red";
  const auxiliaries = carriers.flatMap((slot, index) => {
    const flagshipId = `${prefix}_car_${counts.carrier + index}`;
    return [
      ...Array.from(
        { length: slot.wingSize ?? 0 },
        (_, i): FleetSlot => ({
          id: `${slot.id}_wing_${i}`,
          hullClass: "strike_craft",
          groupId: slot.groupId,
          carrierAnchorId: flagshipId,
        }),
      ),
      ...Array.from(
        { length: slot.escortCount ?? 0 },
        (_, i): FleetSlot => ({
          id: `${slot.id}_escort_${i}`,
          hullClass: "corvette",
          groupId: slot.groupId,
          carrierAnchorId: flagshipId,
        }),
      ),
    ];
  });
  slots = [...slots, ...auxiliaries];
  const battleships = slots.filter((s) => s.hullClass === "battleship");
  const dreadnoughts = slots.filter((s) => s.hullClass === "dreadnought");
  const frigates = slots.filter((s) => s.hullClass === "missile_frigate");
  const tenders = slots.filter((s) => s.hullClass === "tender");
  const cruisers = slots.filter((s) => s.hullClass === "cruiser");
  const corvettes = slots.filter((s) => s.hullClass === "corvette");
  const fighters = slots.filter((s) => s.hullClass === "strike_craft");
  const anchorIds = [
    ...carriers.map((_, i) => `${prefix}_car_${counts.carrier + i}`),
    ...dreadnoughts.map((_, i) => `${prefix}_dn_${counts.dreadnought + i}`),
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
      angularVelocity: 0,
      havenParentId: null,
      havenSlotId: null,
      havenState: "none",
      havenGuestCount: 0,
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
      ...(slot.carrierAnchorId || slot.hullClass === "corvette" || slot.hullClass === "tender"
        ? {
            flagshipId:
              slot.carrierAnchorId ??
              (anchorIds.length ? anchorIds[idx % anchorIds.length] : undefined),
          }
        : {}),
      turrets: instantiateTurrets(profile, id, idx),
    });
  };
  carriers.forEach((slot, idx) => {
    addShip(slot, idx, "car", `Oceanic CV-${counts.carrier + idx + 1}`, [
      0,
      (idx - (carriers.length - 1) / 2) * (expandedSpacing ? 370 : 200),
    ]);
  });
  // 1. Battleships (Center Core)
  battleships.forEach((slot, idx) => {
    addShip(slot, idx, "bb", `Leviathan BB-0${counts.battleship + idx + 1}`, [
      0,
      (idx - (battleships.length - 1) / 2) * (expandedSpacing ? 330 : 160),
    ]);
  });
  // 2. Cruisers (Flanking lines)
  dreadnoughts.forEach((slot, idx) => {
    addShip(slot, idx, "dn", `Bastion DN-${counts.dreadnought + idx + 1}`, [
      0,
      (idx - (dreadnoughts.length - 1) / 2) * (expandedSpacing ? 350 : 180),
    ]);
  });
  frigates.forEach((slot, idx) => {
    addShip(slot, idx, "mf", `Quiver MF-${counts.missile_frigate + idx + 1}`, [
      (heading === 0 ? -1 : 1) * 180,
      (idx - (frigates.length - 1) / 2) * 120,
    ]);
  });
  cruisers.forEach((slot, idx) => {
    const sign = idx % 2 === 0 ? 1 : -1;
    addShip(slot, idx, "cr", `Vanguard CR-0${counts.cruiser + idx + 1}`, [
      (heading === 0 ? 1 : -1) * 60,
      sign * (expandedSpacing ? 250 + Math.floor(idx / 2) * 155 : 140 + Math.floor(idx / 2) * 110),
    ]);
  });
  tenders.forEach((slot, idx) => {
    addShip(slot, idx, "td", `Оберіг TD-${counts.tender + idx + 1}`, [
      (heading === 0 ? -1 : 1) * 425,
      (idx - (tenders.length - 1) / 2) * 120,
    ]);
  });
  // 3. Corvette escort columns; shield clearance is applied after assembly.
  corvettes.forEach((slot, idx) => {
    const sign = idx % 2 === 0 ? 1 : -1;
    addShip(slot, idx, "cv", `Aegis CV-0${counts.corvette + idx + 1}`, [
      (heading === 0 ? -1 : 1) * 95,
      sign * (expandedSpacing ? 220 + Math.floor(idx / 2) * 90 : 145 + Math.floor(idx / 2) * 85),
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
        xOff:
          (heading === 0 ? 1 : -1) *
          ((expandedSpacing ? 310 : 180) + Math.floor(index / rows) * spacing),
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
      const spacing = (shieldEnvelopeRadius(shipA) + shieldEnvelopeRadius(shipB)) * 1.15 + 20;
      if (Math.abs(shipA.pos[0] - shipB.pos[0]) < spacing) {
        shipB.pos[1] = Math.max(shipB.pos[1], shipA.pos[1] + spacing);
      }
    }
  }
  const center = ordered.length ? (ordered[0].pos[1] + ordered[ordered.length - 1].pos[1]) / 2 : 0;
  for (const ship of ships) ship.pos[1] -= center;
  counts.battleship += battleships.length;
  counts.carrier += carriers.length;
  counts.dreadnought += dreadnoughts.length;
  counts.missile_frigate += frigates.length;
  counts.tender += tenders.length;
  counts.cruiser += cruisers.length;
  counts.corvette += corvettes.length;
  counts.strike_craft += fighters.length;
  return ships;
}
