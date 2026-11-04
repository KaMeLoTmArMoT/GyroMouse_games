// Factory for spawning client test fleets

import type { ShipState } from "../types/combat";

export function createClientTestFleets(): ShipState[] {
  const ships: ShipState[] = [];

  // Team 0 (Blue) - Task Force on the Left (-400, 0)
  // 1 Heavy Battleship with spinal railgun & broadsides
  ships.push({
    id: "blue_bb_1",
    name: "Leviathan BB-01",
    team: 0,
    groupId: 1,
    hullClass: "battleship",
    pos: [-450, 0],
    velocity: [0, 0],
    heading: 0,
    maxSpeed: 45,
    turnRate: 0.45,
    size: 55,
    shieldMax: 1800,
    shieldCurrent: 1800,
    shieldRegen: 40,
    shieldDelayTimer: 0,
    armorMax: 1600,
    armorCurrent: 1600,
    armorRating: 75,
    hullMax: 2200,
    hullCurrent: 2200,
    cost: 3200,
    isAlive: true,
    turrets: [
      {
        id: "bb_rg",
        offset: [25, 0],
        baseArc: [-Math.PI / 2, Math.PI / 2],
        trackingSpeed: 0.6,
        currentLocalAngle: 0,
        cooldownTimer: 0,
        currentTargetId: null,
        weapon: {
          weaponType: "railgun",
          name: "Heavy Railgun",
          damage: 85,
          cooldown: 2.5,
          range: 950,
          projectileSpeed: 1200,
          trackingSpeed: 0.8,
          shieldMultiplier: 1.6,
          armorMultiplier: 0.75,
          hullMultiplier: 1.0,
          cost: 320,
        },
      },
      {
        id: "bb_bs_port",
        offset: [-10, -15],
        baseArc: [-Math.PI + 0.2, -0.2],
        trackingSpeed: 1.2,
        currentLocalAngle: -Math.PI / 2,
        cooldownTimer: 0,
        currentTargetId: null,
        weapon: {
          weaponType: "beam_laser",
          name: "Port Beam Battery",
          damage: 45,
          cooldown: 1.2,
          range: 600,
          projectileSpeed: 0,
          trackingSpeed: 1.8,
          shieldMultiplier: 0.5,
          armorMultiplier: 1.6,
          hullMultiplier: 1.0,
          cost: 250,
        },
      },
      {
        id: "bb_bs_stbd",
        offset: [-10, 15],
        baseArc: [0.2, Math.PI - 0.2],
        trackingSpeed: 1.2,
        currentLocalAngle: Math.PI / 2,
        cooldownTimer: 0,
        currentTargetId: null,
        weapon: {
          weaponType: "beam_laser",
          name: "Starboard Beam Battery",
          damage: 45,
          cooldown: 1.2,
          range: 600,
          projectileSpeed: 0,
          trackingSpeed: 1.8,
          shieldMultiplier: 0.5,
          armorMultiplier: 1.6,
          hullMultiplier: 1.0,
          cost: 250,
        },
      },
    ],
  });

  // 2 Point Defense Corvettes flanking the battleship
  for (let i = 0; i < 2; i++) {
    const yOff = i === 0 ? -90 : 90;
    ships.push({
      id: `blue_cv_${i}`,
      name: `Aegis CV-0${i + 1}`,
      team: 0,
      groupId: 2,
      hullClass: "corvette",
      pos: [-420, yOff],
      velocity: [0, 0],
      heading: 0,
      maxSpeed: 150,
      turnRate: 2.2,
      size: 18,
      shieldMax: 180,
      shieldCurrent: 180,
      shieldRegen: 15,
      shieldDelayTimer: 0,
      armorMax: 150,
      armorCurrent: 150,
      armorRating: 15,
      hullMax: 220,
      hullCurrent: 220,
      cost: 350,
      isAlive: true,
      turrets: [
        {
          id: `cv_${i}_pd`,
          offset: [0, 0],
          baseArc: [-Math.PI, Math.PI],
          trackingSpeed: 6.28,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          weapon: {
            weaponType: "point_defense",
            name: "Flak PD",
            damage: 12,
            cooldown: 0.15,
            range: 350,
            projectileSpeed: 0,
            trackingSpeed: 6.28,
            shieldMultiplier: 0.1,
            armorMultiplier: 0.1,
            hullMultiplier: 0.2,
            cost: 150,
          },
        },
      ],
    });
  }

  // Team 1 (Red) - Strike Swarm on the Right (+450, 0)
  for (let i = 0; i < 14; i++) {
    const yOff = (i - 6.5) * 35;
    ships.push({
      id: `red_sc_${i}`,
      name: `Raider F-${i + 1}`,
      team: 1,
      groupId: 1,
      hullClass: "strike_craft",
      pos: [450 + (i % 2) * 40, yOff],
      velocity: [0, 0],
      heading: Math.PI, // Facing left
      maxSpeed: 240,
      turnRate: 3.5,
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
          id: `sc_${i}_gun`,
          offset: [6, 0],
          baseArc: [-Math.PI / 4, Math.PI / 4],
          trackingSpeed: 4.0,
          currentLocalAngle: 0,
          cooldownTimer: 0,
          currentTargetId: null,
          weapon: {
            weaponType: "plasma",
            name: "Plasma Bolt",
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
  }

  return ships;
}
