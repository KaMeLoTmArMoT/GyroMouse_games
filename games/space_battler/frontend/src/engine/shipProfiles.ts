import type {
  HullClass,
  ProjectileState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";

export interface TurretMountTemplate {
  id: string;
  type: string;
  mountOffset: Vector2;
  firingArc: Vector2;
  trackingSpeed: number;
  currentLocalAngle: number;
  cooldownTimer: number;
  barrelLength: number;
  baseRadius: number;
  isSpinalGimbal?: boolean;
  weapon: WeaponDefinition;
}

export interface HullProfile {
  name: string;
  role: string;
  desc: string;
  cost: number;
  size: number;
  speed: number;
  turnRate: number;
  turnRateDisplay: string;
  shieldMax: number;
  shieldRegen: number;
  shieldRechargeDelay: number;
  armorMax: number;
  armorRating: number;
  hullMax: number;
  turrets: TurretMountTemplate[];
}

export const HULL_PROFILES: Record<HullClass, HullProfile> = {
  carrier: {
    name: "Oceanic Fleet Carrier",
    role: "Fleet Aviation & Mobile Repair",
    desc: "A fleet aviation capital with a flak turret and three defense lasers.",
    cost: 3000,
    size: 84,
    speed: 32,
    turnRate: 0.3,
    turnRateDisplay: "0.30 rad/s",
    shieldMax: 1600,
    shieldRegen: 30,
    shieldRechargeDelay: 3,
    armorMax: 1200,
    armorRating: 45,
    hullMax: 2400,
    turrets: (
      [
        [0, 0],
        [24, -24],
        [-24, 24],
        [-24, -24],
      ] as Vector2[]
    ).map(
      (offset, index): TurretMountTemplate => ({
        id: index === 0 ? "flak" : `laser${index}`,
        type: "Point Defense",
        mountOffset: offset,
        firingArc: [-Math.PI, Math.PI],
        trackingSpeed: 6.28,
        currentLocalAngle: 0,
        cooldownTimer: index * 0.05,
        barrelLength: 6,
        baseRadius: 2.2,
        weapon: {
          weaponType: "point_defense",
          name: index === 0 ? "Flak Turret" : "Light Defense Laser",
          damage: index === 0 ? 10 : 110,
          cooldown: index === 0 ? 0.3 : 0,
          range: 420,
          projectileSpeed: index === 0 ? 1500 : 0,
          trackingSpeed: 6.28,
          shieldMultiplier: 0.35,
          armorMultiplier: 0.45,
          hullMultiplier: 0.45,
          ...(index === 0
            ? { flak: { lifetime: 0.32, triggerRadius: 15, blastRadius: 30, missileDamage: 18 } }
            : {}),
          cost: index === 0 ? 150 : 125,
        },
      }),
    ),
  },
  battleship: {
    name: "Leviathan Battleship",
    role: "Capital Flagship",
    desc: "Devastating spinal railgun + dual broadside beam batteries.",
    cost: 3200,
    size: 68,
    speed: 38,
    turnRate: 0.5,
    turnRateDisplay: "0.50 rad/s",
    shieldMax: 2200,
    shieldRegen: 50,
    shieldRechargeDelay: 1.5,
    armorMax: 2000,
    armorRating: 75,
    hullMax: 2800,
    turrets: [
      {
        id: "spinal",
        type: "Railgun",
        mountOffset: [28, 0],
        firingArc: [-Math.PI / 25, Math.PI / 25],
        trackingSpeed: 0.5,
        currentLocalAngle: 0,
        cooldownTimer: 0,
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
          hullMultiplier: 1,
          cost: 450,
        },
      },
      {
        id: "port",
        type: "Beam Laser",
        mountOffset: [-8, -16],
        firingArc: [-Math.PI * 0.78, -Math.PI * 0.22],
        trackingSpeed: 1.2,
        currentLocalAngle: -Math.PI / 2,
        cooldownTimer: 0,
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
          hullMultiplier: 1,
          cost: 250,
        },
      },
      {
        id: "stbd",
        type: "Beam Laser",
        mountOffset: [-8, 16],
        firingArc: [Math.PI * 0.22, Math.PI * 0.78],
        trackingSpeed: 1.2,
        currentLocalAngle: Math.PI / 2,
        cooldownTimer: 0,
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
          hullMultiplier: 1,
          cost: 250,
        },
      },
    ],
  },
  dreadnought: {
    name: "Bastion Artillery Dreadnought",
    role: "Broadside Linebreaker",
    desc: "Four heavy batteries; three concentrate on either broadside. Requires escorts.",
    cost: 3600,
    size: 76,
    speed: 30,
    turnRate: 0.32,
    turnRateDisplay: "0.32 rad/s",
    shieldMax: 1800,
    shieldRegen: 35,
    shieldRechargeDelay: 2.5,
    armorMax: 2400,
    armorRating: 85,
    hullMax: 3000,
    turrets: [
      { id: "bow", offset: [32, 0], arc: [-140, 140], angle: 0 },
      { id: "port", offset: [-4, -25], arc: [-125, -55], angle: -90 },
      { id: "stbd", offset: [-4, 25], arc: [55, 125], angle: 90 },
      { id: "aft", offset: [-32, 0], arc: [40, -40], angle: 180 },
    ].map(
      ({ id, offset, arc, angle }): TurretMountTemplate => ({
        id,
        type: "Heavy Artillery",
        mountOffset: offset as Vector2,
        firingArc: arc.map((degrees) => (degrees * Math.PI) / 180) as Vector2,
        trackingSpeed: 0.3,
        currentLocalAngle: (angle * Math.PI) / 180,
        cooldownTimer: 0,
        barrelLength: 18,
        baseRadius: 7,
        weapon: {
          weaponType: "railgun",
          name: "380 mm Heavy AP Shell",
          damage: 180,
          cooldown: 4.5,
          range: 1050,
          projectileSpeed: 750,
          trackingSpeed: 0.3,
          shieldMultiplier: 0.85,
          armorMultiplier: 1.35,
          hullMultiplier: 1.2,
          cost: 260,
        },
      }),
    ),
  },
  cruiser: {
    name: "Vanguard Cruiser",
    role: "Medium Combatant",
    desc: "Heavy beam laser turret + prow heavy torpedo launcher.",
    cost: 1100,
    size: 38,
    speed: 85,
    turnRate: 0.75,
    turnRateDisplay: "0.75 rad/s",
    shieldMax: 600,
    shieldRegen: 25,
    shieldRechargeDelay: 1.2,
    armorMax: 500,
    armorRating: 35,
    hullMax: 700,
    turrets: [
      {
        id: "laser",
        type: "Beam Laser",
        mountOffset: [8, 0],
        firingArc: [-Math.PI * 0.7, Math.PI * 0.7],
        trackingSpeed: 1.6,
        currentLocalAngle: 0,
        cooldownTimer: 0,
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
          hullMultiplier: 1,
          cost: 250,
        },
      },
      {
        id: "torp",
        type: "Missile",
        mountOffset: [16, 0],
        firingArc: [-Math.PI / 6, Math.PI / 6],
        trackingSpeed: 1.5,
        currentLocalAngle: 0,
        cooldownTimer: 0,
        barrelLength: 8,
        baseRadius: 3.5,
        weapon: {
          weaponType: "missile",
          name: "Heavy Torpedo Tube",
          damage: 220,
          cooldown: 5.5,
          range: 1800,
          projectileSpeed: 320,
          fuelDuration: 8,
          projectileHp: 120,
          trackingSpeed: 1.5,
          shieldMultiplier: 1,
          armorMultiplier: 1.8,
          hullMultiplier: 1.8,
          cost: 380,
        },
      },
    ],
  },
  missile_frigate: {
    name: "Quiver Missile Frigate",
    role: "Shield Saturation Support",
    desc: "Four light missile tubes strip shields; fragile and ineffective against heavy armor.",
    cost: 700,
    size: 28,
    speed: 100,
    turnRate: 0.9,
    turnRateDisplay: "0.90 rad/s",
    shieldMax: 220,
    shieldRegen: 12,
    shieldRechargeDelay: 3,
    armorMax: 180,
    armorRating: 20,
    hullMax: 260,
    turrets: [
      [8, -10],
      [8, 10],
      [-6, -10],
      [-6, 10],
    ].map(
      (offset, index): TurretMountTemplate => ({
        id: `tube${index + 1}`,
        type: "Missile",
        mountOffset: offset as Vector2,
        firingArc: [-Math.PI * 0.75, Math.PI * 0.75],
        trackingSpeed: 1.2,
        currentLocalAngle: 0,
        cooldownTimer: index * 0.2,
        barrelLength: 5,
        baseRadius: 2.5,
        weapon: {
          weaponType: "missile",
          name: "Light Shieldbreaker Missile",
          damage: 36,
          cooldown: 4.8,
          range: 1450,
          projectileSpeed: 360,
          fuelDuration: 5,
          projectileHp: 18,
          trackingSpeed: 2.5,
          shieldMultiplier: 2,
          armorMultiplier: 0.65,
          hullMultiplier: 0.8,
          cost: 65,
        },
      }),
    ),
  },
  corvette: {
    name: "Aegis Corvette",
    role: "Escort Screen",
    desc: "Dual rapid flak PD turrets (360°). Intercepts missiles, fighters, and fires at enemy ships.",
    cost: 350,
    size: 20,
    speed: 175,
    turnRate: 1.6,
    turnRateDisplay: "1.60 rad/s",
    shieldMax: 180,
    shieldRegen: 15,
    shieldRechargeDelay: 3.5,
    armorMax: 150,
    armorRating: 15,
    hullMax: 220,
    turrets: [
      {
        id: "pd1",
        type: "Point Defense",
        mountOffset: [-4, -4],
        firingArc: [-Math.PI, Math.PI],
        trackingSpeed: 6.28,
        currentLocalAngle: 0,
        cooldownTimer: 0,
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
          shieldMultiplier: 0.35,
          armorMultiplier: 0.45,
          hullMultiplier: 0.45,
          flak: { lifetime: 0.32, triggerRadius: 15, blastRadius: 30, missileDamage: 18 },
          cost: 150,
        },
      },
      {
        id: "pd2",
        type: "Point Defense",
        mountOffset: [-4, 4],
        firingArc: [-Math.PI, Math.PI],
        trackingSpeed: 6.28,
        currentLocalAngle: 0,
        cooldownTimer: 0.15,
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
          shieldMultiplier: 0.35,
          armorMultiplier: 0.45,
          hullMultiplier: 0.45,
          flak: { lifetime: 0.32, triggerRadius: 15, blastRadius: 30, missileDamage: 18 },
          cost: 150,
        },
      },
    ],
  },
  strike_craft: {
    name: "Raider Interceptor",
    role: "Strike Swarm",
    desc: "Agile fighter equipped with forward plasma bolt.",
    cost: 120,
    size: 10,
    speed: 280,
    turnRate: 4.2,
    turnRateDisplay: "4.20 rad/s",
    shieldMax: 60,
    shieldRegen: 10,
    shieldRechargeDelay: 3.5,
    armorMax: 40,
    armorRating: 5,
    hullMax: 70,
    turrets: [
      {
        id: "gun",
        type: "Plasma Bolt",
        mountOffset: [6, 0],
        firingArc: [-Math.PI / 4, Math.PI / 4],
        trackingSpeed: 3.5,
        currentLocalAngle: 0,
        cooldownTimer: 0,
        barrelLength: 6,
        baseRadius: 2,
        weapon: {
          weaponType: "plasma",
          name: "Plasma Blaster",
          damage: 120,
          cooldown: 3,
          range: 550,
          projectileSpeed: 450,
          trackingSpeed: 1.2,
          shieldMultiplier: 1,
          armorMultiplier: 1.1,
          hullMultiplier: 1.5,
          cost: 280,
        },
      },
    ],
  },
};

export function projectileLifetime(weapon: WeaponDefinition): number {
  if (weapon.weaponType === "missile") return weapon.fuelDuration ?? 5;
  return weapon.flak?.lifetime ?? (weapon.range / weapon.projectileSpeed) * 1.25;
}

export function projectileMaxHp(weapon: WeaponDefinition): number {
  return weapon.projectileHp ?? 25;
}

export function isHeavyTorpedo(projectile: ProjectileState): boolean {
  return projectile.weaponType === "missile" && projectile.maxHp >= 120;
}

export function pointDefenseMode(weapon: WeaponDefinition): "flak" | "rotary" | "laser" | null {
  if (weapon.weaponType !== "point_defense") return null;
  return weapon.flak ? "flak" : weapon.projectileSpeed > 0 ? "rotary" : "laser";
}

export function instantiateTurrets(
  profile: HullProfile,
  shipId: string,
  index: number,
): TurretMountState[] {
  return profile.turrets.map(({ id, type: _type, mountOffset, firingArc, weapon, ...mount }) => ({
    ...mount,
    id: `${shipId}_${id}`,
    offset: [...mountOffset],
    baseArc: [...firingArc],
    cooldownTimer: mount.isSpinalGimbal ? (index % 3) * 0.35 : mount.cooldownTimer,
    currentTargetId: null,
    weapon: { ...weapon, ...(weapon.flak ? { flak: { ...weapon.flak } } : {}) },
  }));
}
