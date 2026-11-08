// Research candidates only: NOT registered in the live roster.
// Aft min > max denotes a wrapped arc; live fireControl does not yet support it.
import type { HullProfile, TurretMountTemplate } from "../src/engine/shipProfiles";
import type { Vector2, WeaponDefinition } from "../src/types/combat";

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const shell: WeaponDefinition = {
  weaponType: "railgun", // Existing unguided kinetic transport; no spinal gimbal.
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
};
const missile: WeaponDefinition = {
  weaponType: "missile",
  name: "Light Shieldbreaker Missile",
  damage: 36,
  cooldown: 4.8,
  range: 1450,
  projectileSpeed: 360,
  fuelDuration: 5,
  projectileHp: 18,
  trackingSpeed: 0.4, // Documents actual hardcoded projectile homing, not mount slew.
  shieldMultiplier: 2,
  armorMultiplier: 0.65,
  hullMultiplier: 0.8,
  cost: 65,
};
function mount(
  id: string,
  offset: Vector2,
  arc: Vector2,
  angle: number,
  weapon: WeaponDefinition,
  cooldownTimer = 0,
): TurretMountTemplate {
  const heavy = weapon === shell;
  return {
    id,
    type: heavy ? "Heavy Artillery" : "Missile",
    mountOffset: offset,
    firingArc: [radians(arc[0]), radians(arc[1])],
    trackingSpeed: heavy ? 0.3 : 1.2,
    currentLocalAngle: radians(angle),
    cooldownTimer,
    barrelLength: heavy ? 18 : 5,
    baseRadius: heavy ? 7 : 2.5,
    weapon: { ...weapon },
  };
}

export const ROSTER_CANDIDATES = {
  broadside_dreadnought: {
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
      mount("bow", [32, 0], [-140, 140], 0, shell),
      mount("port", [-4, -25], [-125, -55], -90, shell),
      mount("stbd", [-4, 25], [55, 125], 90, shell),
      mount("aft", [-32, 0], [40, -40], 180, shell),
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
      mount("tube1", [8, -10], [-135, 135], 0, missile),
      mount("tube2", [8, 10], [-135, 135], 0, missile, 0.2),
      mount("tube3", [-6, -10], [-135, 135], 0, missile, 0.4),
      mount("tube4", [-6, 10], [-135, 135], 0, missile, 0.6),
    ],
  },
} satisfies Record<string, HullProfile>;
