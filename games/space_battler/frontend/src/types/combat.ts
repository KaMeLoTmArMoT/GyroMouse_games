// Combat simulation types matching deterministic contracts

export type WeaponType = "beam_laser" | "railgun" | "plasma" | "missile" | "point_defense";
export type HullClass = "strike_craft" | "corvette" | "cruiser" | "battleship";
export type TargetPriority = "capitals" | "screen_and_defend" | "strike_craft" | "nearest";
export type EngagementStance = "max_range" | "optimal_range" | "brawl";
export type FighterPhase = "staging" | "attack" | "egress" | "rejoin";

export type Vector2 = [number, number];

export interface WeaponDefinition {
  weaponType: WeaponType;
  name: string;
  damage: number;
  cooldown: number;
  range: number;
  projectileSpeed: number; // 0 = hitscan
  trackingSpeed: number; // rad/s
  shieldMultiplier: number;
  armorMultiplier: number;
  hullMultiplier: number;
  cost: number;
}

export interface TurretMountState {
  id: string;
  offset: Vector2;
  baseArc: [number, number];
  trackingSpeed: number;
  weapon: WeaponDefinition;
  currentLocalAngle: number;
  cooldownTimer: number;
  currentTargetId: string | null;
  barrelLength: number;
  baseRadius: number;
  isSpinalGimbal?: boolean;
  lastFiredTime?: number; // Visual cooldown tracking in UI!
}

export interface ShipState {
  id: string;
  name: string;
  team: number; // 0: Blue (Terran), 1: Red (Alien)
  groupId: number; // 1..10
  hullClass: HullClass;
  pos: Vector2;
  velocity: Vector2;
  heading: number; // radians
  maxSpeed: number;
  turnRate: number;
  size: number;

  shieldMax: number;
  shieldCurrent: number;
  shieldRegen: number;
  shieldDelayTimer: number;

  armorMax: number;
  armorCurrent: number;
  armorRating: number;

  hullMax: number;
  hullCurrent: number;

  turrets: TurretMountState[];
  cost: number;
  isAlive: boolean;

  formationOffset?: Vector2;
  flagshipId?: string;

  fighterPhase?: FighterPhase;
  fighterLaneAngle?: number;
  fighterLaneIndex?: number;
  fighterPhaseTimer?: number;
}

export interface ProjectileState {
  id: string;
  weaponType: WeaponType;
  damage: number;
  ownerId: string;
  ownerTeam: number;
  pos: Vector2;
  velocity: Vector2;
  lifetime: number;
  targetId: string | null;
  hp: number;
  isFlakBurst?: boolean; // Proximity splash munition
}

export interface GroupOrder {
  groupId: number;
  priority: TargetPriority;
  stance: EngagementStance;
}
