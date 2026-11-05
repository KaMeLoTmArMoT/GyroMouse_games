// Assembly builder for translating abstract compositions into concrete positioned ShipStates

import type { HullClass, ShipState } from "../types/combat";

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
  const offsets: Record<number, [number, number]> = {
    1: [0, 0],
    2: [-150 * direction, 450],
    3: [-150 * direction, -450],
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
  const baseX = 0;
  const ships: ShipState[] = [];

  const battleships = slots.filter((s) => s.hullClass === "battleship");
  const cruisers = slots.filter((s) => s.hullClass === "cruiser");
  const corvettes = slots.filter((s) => s.hullClass === "corvette");
  const fighters = slots.filter((s) => s.hullClass === "strike_craft");

  // 1. Battleships (Center Core)
  const anchorIds = [
    ...battleships.map((_, i) => `${team === 0 ? "blue" : "red"}_bb_${counts.battleship + i}`),
    ...cruisers.map((_, i) => `${team === 0 ? "blue" : "red"}_cr_${counts.cruiser + i}`),
  ];

  battleships.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_bb_${counts.battleship + idx}`;
    const yOff = (idx - (battleships.length - 1) / 2) * 160;
    ships.push({
      id,
      name: `Leviathan BB-0${counts.battleship + idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "battleship",
      pos: [baseX, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 38,
      turnRate: 0.5,
      size: 68,
      shieldMax: 2200,
      shieldCurrent: 2200,
      shieldRegen: 50,
      shieldDelayTimer: 0,
      shieldRechargeDelay: 1.5,
      armorMax: 2000,
      armorCurrent: 2000,
      armorRating: 75,
      hullMax: 2800,
      hullCurrent: 2800,
      cost: 3200,
      isAlive: true,
      turrets: [
        {
          id: `${id}_spinal`,
          offset: [28, 0],
          baseArc: [-Math.PI / 25, Math.PI / 25],
          trackingSpeed: 0.5,
          currentLocalAngle: 0,
          cooldownTimer: (idx % 3) * 0.35,
          currentTargetId: null,
          barrelLength: 26,
          baseRadius: 8,
          isSpinalGimbal: true,
          weapon: {
            weaponType: "railgun",
            name: "Spinal Heavy Railgun",
            damage: 300,
            cooldown: 3.5,
            range: 1800,
            projectileSpeed: 1400,
            trackingSpeed: 0.5,
            shieldMultiplier: 1.6,
            armorMultiplier: 0.75,
            hullMultiplier: 1.0,
            cost: 450,
          },
        },
        {
          id: `${id}_port`,
          offset: [-8, -16],
          baseArc: [-Math.PI * 0.78, -Math.PI * 0.22],
          trackingSpeed: 1.2,
          currentLocalAngle: -Math.PI / 2,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 13,
          baseRadius: 5,
          weapon: {
            weaponType: "beam_laser",
            name: "Port Laser Battery",
            damage: 75,
            cooldown: 1.2,
            range: 1200,
            projectileSpeed: 0,
            trackingSpeed: 1.4,
            shieldMultiplier: 0.5,
            armorMultiplier: 1.6,
            hullMultiplier: 1.0,
            cost: 250,
          },
        },
        {
          id: `${id}_stbd`,
          offset: [-8, 16],
          baseArc: [Math.PI * 0.22, Math.PI * 0.78],
          trackingSpeed: 1.2,
          currentLocalAngle: Math.PI / 2,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 13,
          baseRadius: 5,
          weapon: {
            weaponType: "beam_laser",
            name: "Starboard Laser Battery",
            damage: 75,
            cooldown: 1.2,
            range: 1200,
            projectileSpeed: 0,
            trackingSpeed: 1.4,
            shieldMultiplier: 0.5,
            armorMultiplier: 1.6,
            hullMultiplier: 1.0,
            cost: 250,
          },
        },
      ],
    });
  });

  // 2. Cruisers (Flanking lines)
  cruisers.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_cr_${counts.cruiser + idx}`;
    const sign = idx % 2 === 0 ? 1 : -1;
    const yOff = sign * (140 + Math.floor(idx / 2) * 110);
    const xOff = (heading === 0 ? 1 : -1) * 60;
    ships.push({
      id,
      name: `Vanguard CR-0${counts.cruiser + idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "cruiser",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 85,
      turnRate: 0.75,
      size: 38,
      shieldMax: 600,
      shieldCurrent: 600,
      shieldRegen: 25,
      shieldDelayTimer: 0,
      armorMax: 500,
      armorCurrent: 500,
      armorRating: 35,
      hullMax: 700,
      hullCurrent: 700,
      cost: 1100,
      isAlive: true,
      turrets: [
        {
          id: `${id}_laser`,
          offset: [8, 0],
          baseArc: [-Math.PI * 0.7, Math.PI * 0.7],
          trackingSpeed: 1.6,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 12,
          baseRadius: 4.5,
          weapon: {
            weaponType: "beam_laser",
            name: "Heavy Beam Turret",
            damage: 45,
            cooldown: 1.2,
            range: 1100,
            projectileSpeed: 0,
            trackingSpeed: 1.6,
            shieldMultiplier: 0.5,
            armorMultiplier: 1.6,
            hullMultiplier: 1.0,
            cost: 250,
          },
        },
        {
          id: `${id}_torp`,
          offset: [16, 0],
          baseArc: [-Math.PI / 6, Math.PI / 6],
          trackingSpeed: 1.5,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 8,
          baseRadius: 3.5,
          weapon: {
            weaponType: "missile",
            name: "Heavy Torpedo Tube",
            damage: 220,
            cooldown: 5.5,
            range: 1800,
            projectileSpeed: 320,
            trackingSpeed: 1.5,
            shieldMultiplier: 1.0,
            armorMultiplier: 1.8,
            hullMultiplier: 1.8,
            cost: 380,
          },
        },
      ],
    });
  });

  // 3. Corvette escort columns; shield clearance is applied after assembly.
  corvettes.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_cv_${counts.corvette + idx}`;
    const sign = idx % 2 === 0 ? 1 : -1;
    const yOff = sign * (145 + Math.floor(idx / 2) * 85);
    const xOff = (heading === 0 ? -1 : 1) * 95;
    ships.push({
      id,
      name: `Aegis CV-0${counts.corvette + idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "corvette",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 175,
      turnRate: 1.6,
      size: 20,
      shieldMax: 180,
      shieldCurrent: 180,
      shieldRegen: 15,
      shieldDelayTimer: 0,
      shieldRechargeDelay: 3.5,
      armorMax: 150,
      armorCurrent: 150,
      armorRating: 15,
      hullMax: 220,
      hullCurrent: 220,
      cost: 350,
      isAlive: true,
      flagshipId: anchorIds.length ? anchorIds[idx % anchorIds.length] : undefined,
      turrets: [
        {
          id: `${id}_pd1`,
          offset: [-4, -4],
          baseArc: [-Math.PI, Math.PI],
          trackingSpeed: 6.28,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 6,
          baseRadius: 2.2,
          weapon: {
            weaponType: "point_defense",
            name: "Rapid Flak Alpha",
            damage: 10,
            cooldown: 0.3,
            range: 420,
            projectileSpeed: 1500,
            trackingSpeed: 6.28,
            shieldMultiplier: 0.25,
            armorMultiplier: 0.22,
            hullMultiplier: 0.3,
            flak: { lifetime: 0.32, triggerRadius: 18, blastRadius: 34, missileDamage: 18 },
            cost: 150,
          },
        },
        {
          id: `${id}_pd2`,
          offset: [-4, 4],
          baseArc: [-Math.PI, Math.PI],
          trackingSpeed: 6.28,
          currentLocalAngle: 0,
          cooldownTimer: 0.15,
          currentTargetId: null,
          barrelLength: 6,
          baseRadius: 2.2,
          weapon: {
            weaponType: "point_defense",
            name: "Rapid Flak Beta",
            damage: 10,
            cooldown: 0.3,
            range: 420,
            projectileSpeed: 1500,
            trackingSpeed: 6.28,
            shieldMultiplier: 0.25,
            armorMultiplier: 0.22,
            hullMultiplier: 0.3,
            flak: { lifetime: 0.32, triggerRadius: 18, blastRadius: 34, missileDamage: 18 },
            cost: 150,
          },
        },
      ],
    });
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
    const id = `${team === 0 ? "blue" : "red"}_sc_${counts.strike_craft + idx}`;
    ships.push({
      id,
      name: `Raider F-${counts.strike_craft + idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "strike_craft",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 280,
      turnRate: 4.2,
      size: 10,
      shieldMax: 60,
      shieldCurrent: 60,
      shieldRegen: 10,
      shieldDelayTimer: 0,
      armorMax: 40,
      armorCurrent: 40,
      armorRating: 5,
      hullMax: 70,
      hullCurrent: 70,
      cost: 120,
      isAlive: true,
      turrets: [
        {
          id: `${id}_gun`,
          offset: [6, 0],
          baseArc: [-Math.PI / 4, Math.PI / 4],
          trackingSpeed: 3.5,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          barrelLength: 6,
          baseRadius: 2.0,
          weapon: {
            weaponType: "plasma",
            name: "Plasma Blaster",
            damage: 120,
            cooldown: 3.0,
            range: 550,
            projectileSpeed: 450,
            trackingSpeed: 1.2,
            shieldMultiplier: 1.0,
            armorMultiplier: 1.1,
            hullMultiplier: 1.5,
            cost: 280,
          },
        },
      ],
    });
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
