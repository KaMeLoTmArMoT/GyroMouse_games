// Combat simulation types matching deterministic contracts

import type { BroadsideCycle, SkirmishCycle } from "../engine/flightCycles";

export type WeaponType = "beam_laser" | "railgun" | "plasma" | "missile" | "point_defense";
export type HullClass =
  | "carrier"
  | "battleship"
  | "dreadnought"
  | "cruiser"
  | "missile_frigate"
  | "tender"
  | "corvette"
  | "strike_craft";
export type TargetPriority = "capitals" | "screen_and_defend" | "strike_craft" | "nearest";
export type EngagementStance = "max_range" | "optimal_range" | "brawl";
export type WingPhase = "staging" | "attack" | "egress" | "rejoin";
export type FighterPhase = WingPhase | "intercept" | "recover";
export type HavenState = "none" | "seeking" | "approaching" | "tethered" | "releasing";

export type Vector2 = [number, number];

export type CombatAudioCue =
  | "torpedo_launch"
  | "flak_burst"
  | "laser_intercept"
  | "fighter_egress"
  | "warp_ingress";

export interface CombatAudioEvent {
  type: CombatAudioCue;
  time: number;
  pos: Vector2;
  team: number;
  sourceId: string;
  targetId?: string;
}

export interface WeaponDefinition {
  weaponType: WeaponType;
  name: string;
  damage: number;
  cooldown: number;
  range: number;
  projectileSpeed: number; // 0 = hitscan
  fuelDuration?: number; // Guided projectile burn limit in seconds; expires when exhausted.
  projectileHp?: number; // Shared casing durability for interceptable projectiles.
  trackingSpeed: number; // rad/s
  shieldMultiplier: number;
  armorMultiplier: number;
  hullMultiplier: number;
  cost: number;
  flak?: { lifetime: number; triggerRadius: number; blastRadius: number; missileDamage: number };
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
  currentTargetKind?: "ship" | "missile";
  sideTargetId?: string; // Opportunistic firing target; never a flight-navigation assignment.
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
  angularVelocity?: number; // Authoritative heading change per fixed step, in rad/s.
  maxSpeed: number;
  turnRate: number;
  size: number;

  shieldMax: number;
  shieldCurrent: number;
  shieldRegen: number;
  shieldDelayTimer: number;
  shieldRechargeDelay?: number; // Delay in seconds before shield regeneration begins

  armorMax: number;
  armorCurrent: number;
  armorRating: number;

  hullMax: number;
  hullCurrent: number;

  turrets: TurretMountState[];
  cost: number;
  isAlive: boolean;
  isDebris?: boolean;
  debrisLifetime?: number; // Remaining inert wreck lifetime in seconds.
  isDocked?: boolean;
  hangarLaunchAt?: number;
  hangarTurnaroundUntil?: number;
  carrierRecovering?: boolean;

  formationOffset?: Vector2;
  flagshipId?: string;

  fighterPhase?: FighterPhase;
  wingIndex?: number;
  wingSlot?: number;
  fighterLaneAngle?: number;
  fighterLaneIndex?: number;
  fighterPhaseTimer?: number;
  safeHavenId?: string | null;
  safeHavenTimer?: number;
  lastSelectedSector?: number;
  deadlockTimer?: number;
  deadlockBypassAngle?: number;
  dogfightTargetId?: string;
  lastThreatTime?: number;
  recoveryStarted?: number;
  havenParentId?: string | null;
  havenSlotId?: string | null;
  havenState?: HavenState;
  havenGuestCount?: number; // Currently tethered guests, excluding reservations.
  havenRadiusMultiplier?: number; // Strongest live tender aura, refreshed at fixed-step boundaries.
  nextRecoveryAt?: number;
  recoveredHull?: number;
  lastMissionShotTime?: number;
  capitalManeuver?: "bow_acquire" | "broadside_hold" | "bow_reacquire";
  broadsideCycle?: BroadsideCycle;
  skirmishCycle?: SkirmishCycle;
  maneuverTargetId?: string;
  navigationTargetId?: string;
  broadsideSide?: number;
  lastManeuverShot?: number;
  escapeSide?: number;
  escapeUntil?: number;
  evasionUntil?: number;
}

export interface ProjectileState {
  id: string;
  weaponType: WeaponType;
  damage: number;
  ownerId: string;
  ownerTeam: number;
  ownerMountId?: string; // Recorded only when combat telemetry is enabled.
  pos: Vector2;
  velocity: Vector2;
  lifetime: number;
  targetId: string | null;
  hp: number;
  maxHp: number;
  isFlakBurst?: boolean; // Proximity splash munition
  weapon: WeaponDefinition; // Shot-time profile; impacts must preserve configured multipliers.
}

export interface GroupOrder {
  groupId: number;
  priority: TargetPriority;
  stance: EngagementStance;
}

export interface CombatLogEvent {
  id: string;
  time: number;
  text: string;
  team: number;
  type: "kill" | "intercept" | "critical";
}

export interface TeamBattleStats {
  damageDealt: number;
  shieldDamageAbsorbed: number;
  missilesIntercepted: number;
  shipsLost: number;
  recentDamageWindow: Array<{ time: number; damage: number }>;
}
