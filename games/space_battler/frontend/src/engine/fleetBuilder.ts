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
  const ships: ShipState[] = [];

  const battleships = slots.filter((s) => s.hullClass === "battleship");
  const cruisers = slots.filter((s) => s.hullClass === "cruiser");
  const corvettes = slots.filter((s) => s.hullClass === "corvette");
  const fighters = slots.filter((s) => s.hullClass === "strike_craft");

  // 1. Battleships (Center Core)
  const anchorIds = [
    ...battleships.map((_, i) => `${team === 0 ? "blue" : "red"}_bb_${i}`),
    ...cruisers.map((_, i) => `${team === 0 ? "blue" : "red"}_cr_${i}`),
  ];

  battleships.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_bb_${idx}`;
    const yOff = (idx - (battleships.length - 1) / 2) * 160;
    ships.push({
      id,
      name: `Leviathan BB-0${idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "battleship",
      pos: [baseX, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 38,
      turnRate: 0.75,
      size: 55,
      shieldMax: 1800,
      shieldCurrent: 1800,
      shieldRegen: 40,
      shieldDelayTimer: 0,
      shieldRechargeDelay: 1.5,
      armorMax: 1800,
      armorCurrent: 1800,
      armorRating: 75,
      hullMax: 2500,
      hullCurrent: 2500,
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
            damage: 260,
            cooldown: 3.5,
            range: 1350,
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
            damage: 65,
            cooldown: 1.2,
            range: 950,
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
            damage: 65,
            cooldown: 1.2,
            range: 950,
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
    const id = `${team === 0 ? "blue" : "red"}_cr_${idx}`;
    const sign = idx % 2 === 0 ? 1 : -1;
    const yOff = sign * (140 + Math.floor(idx / 2) * 110);
    const xOff = (heading === 0 ? 1 : -1) * 60;
    ships.push({
      id,
      name: `Vanguard CR-0${idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "cruiser",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 85,
      turnRate: 1.0,
      size: 34,
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
            range: 900,
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
            range: 1450,
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

  // 3. Corvettes (Escorts spawn 140u away from flagship to completely prevent shield overlap!)
  corvettes.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_cv_${idx}`;
    const sign = idx % 2 === 0 ? 1 : -1;
    const yOff = sign * (145 + Math.floor(idx / 2) * 85);
    const xOff = (heading === 0 ? -1 : 1) * 95;
    ships.push({
      id,
      name: `Aegis CV-0${idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "corvette",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 175,
      turnRate: 2.0,
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
      flagshipId: anchorIds[idx % anchorIds.length],
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
            range: 360,
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
            range: 360,
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

  // 4. Strike Crafts (Screen Vanguard)
  fighters.forEach((slot, idx) => {
    const id = `${team === 0 ? "blue" : "red"}_sc_${idx}`;
    const xOff = (heading === 0 ? 1 : -1) * (180 + (idx % 3) * 45);
    const yOff = (idx - (fighters.length - 1) / 2) * 45;
    ships.push({
      id,
      name: `Raider F-${idx + 1}`,
      team,
      groupId: slot.groupId,
      hullClass: "strike_craft",
      pos: [baseX + xOff, yOff],
      velocity: [0, 0],
      heading,
      maxSpeed: 280,
      turnRate: 4.2,
      size: 11,
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
            range: 480,
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

  return ships;
}
