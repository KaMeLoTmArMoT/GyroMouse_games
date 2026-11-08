import type { ProjectileState, ShipState, TurretMountState, WeaponType } from "../types/combat";
import { ARENA_HARD_PULL_RADIUS, ARENA_RADIUS } from "./flightControl";
import { shieldEnvelopeRadius } from "./shieldGeometry";

export interface CombatObserver {
  onShot(time: number, ship: Readonly<ShipState>, mount: Readonly<TurretMountState>): void;
  onDamage(
    target: Readonly<ShipState>,
    sourceId: string | undefined,
    mountId: string | undefined,
    weapon: WeaponType | "ram" | "radiation",
    before: readonly number[],
  ): void;
  onShieldRegen(ship: Readonly<ShipState>, amount: number): void;
  onMountDecision(
    ship: Readonly<ShipState>,
    mount: Readonly<TurretMountState>,
    eligible: boolean,
    aimed: boolean,
    dt: number,
  ): void;
  onProximity(a: Readonly<ShipState>, b: Readonly<ShipState>, distance: number): void;
  onTick(
    time: number,
    dt: number,
    ships: readonly Readonly<ShipState>[],
    projectiles: readonly Readonly<ProjectileState>[],
  ): void;
}

export interface LayerDamage {
  shield: number;
  armor: number;
  hull: number;
}
export interface DamageRecord extends LayerDamage {
  sourceId: string | null;
  mountId: string | null;
  targetId: string;
  weapon: WeaponType | "ram" | "radiation";
}
export interface BatteryTelemetry {
  shipId: string;
  mountId: string;
  shots: number;
  eligibleSeconds: number;
  readyTrackingSeconds: number;
  longestReadyTrackingSeconds: number;
}
export interface TelemetryReport {
  firstShot: number | null;
  shots: number;
  damage: DamageRecord[];
  shieldRegenerated: Record<string, number>;
  batteries: BatteryTelemetry[];
  ramProximityPairTicks: number;
  maxRadius: number;
  shipSecondsOutsideArena: number;
  shipSecondsOutsideHardPull: number;
  hardPullEntries: number;
  peakProjectiles: number;
  stalls: Array<{
    time: number;
    kind: "no-fire" | "low-progress" | "shield-equilibrium" | "carousel";
  }>;
  errors: string[];
}

/** Event-based damage and shot counters; state-based containment and stall sampling. */
export class CombatTelemetry implements CombatObserver {
  firstShot: number | null = null;
  shots = 0;
  damage: Record<string, DamageRecord> = {};
  shieldRegenerated: Record<string, number> = {};
  batteries: Record<string, BatteryTelemetry> = {};
  ramProximityPairTicks = 0;
  maxRadius = 0;
  shipSecondsOutsideArena = 0;
  shipSecondsOutsideHardPull = 0;
  hardPullEntries = 0;
  peakProjectiles = 0;
  stalls: Array<{
    time: number;
    kind: "no-fire" | "low-progress" | "shield-equilibrium" | "carousel";
  }> = [];
  errors: string[] = [];
  private outside = new Set<string>();
  private readyIntervals: Record<string, number> = {};
  private windowStart = 0;
  private windowDamage = 0;
  private windowShieldDamage = 0;
  private windowShieldRegen = 0;
  private windowShots = 0;
  private windowDeaths = 0;
  private lowProgressWindows = 0;
  private initialStructure = 0;
  private previousAngles = new Map<string, number>();
  private previousTargets = new Map<string, string>();
  private winding = new Map<string, number>();

  constructor(ships: ShipState[]) {
    this.initialStructure = ships.reduce((sum, ship) => sum + ship.armorMax + ship.hullMax, 0);
    const ids = new Set<string>();
    for (const ship of ships) {
      if (ids.has(ship.id)) this.errors.push(`Duplicate ship id: ${ship.id}`);
      ids.add(ship.id);
      for (const mount of ship.turrets) {
        if (ids.has(mount.id)) this.errors.push(`Duplicate entity id: ${mount.id}`);
        ids.add(mount.id);
        if (mount.id.endsWith("_port") || mount.id.endsWith("_stbd")) {
          this.batteries[mount.id] = {
            shipId: ship.id,
            mountId: mount.id,
            shots: 0,
            eligibleSeconds: 0,
            readyTrackingSeconds: 0,
            longestReadyTrackingSeconds: 0,
          };
        }
      }
    }
  }

  report(): TelemetryReport {
    return {
      firstShot: this.firstShot,
      shots: this.shots,
      damage: Object.values(this.damage),
      shieldRegenerated: this.shieldRegenerated,
      batteries: Object.values(this.batteries),
      ramProximityPairTicks: this.ramProximityPairTicks,
      maxRadius: this.maxRadius,
      shipSecondsOutsideArena: this.shipSecondsOutsideArena,
      shipSecondsOutsideHardPull: this.shipSecondsOutsideHardPull,
      hardPullEntries: this.hardPullEntries,
      peakProjectiles: this.peakProjectiles,
      stalls: this.stalls,
      errors: this.errors,
    };
  }

  onShot(time: number, _ship: Readonly<ShipState>, mount: Readonly<TurretMountState>): void {
    this.firstShot ??= time;
    this.shots++;
    this.windowShots++;
    if (this.batteries[mount.id]) this.batteries[mount.id].shots++;
  }

  onDamage(
    target: Readonly<ShipState>,
    sourceId: string | undefined,
    mountId: string | undefined,
    weapon: WeaponType | "ram" | "radiation",
    before: readonly number[],
  ): void {
    const shield = Math.max(0, before[0] - target.shieldCurrent);
    const armor = Math.max(0, before[1] - target.armorCurrent);
    const hull = Math.max(0, before[2] - target.hullCurrent);
    if (shield + armor + hull === 0) return;
    const key = JSON.stringify([sourceId ?? null, mountId ?? null, target.id, weapon]);
    this.damage[key] ??= {
      sourceId: sourceId ?? null,
      mountId: mountId ?? null,
      targetId: target.id,
      weapon,
      shield: 0,
      armor: 0,
      hull: 0,
    };
    const record = this.damage[key];
    record.shield += shield;
    record.armor += armor;
    record.hull += hull;
    this.windowDamage += armor + hull;
    this.windowShieldDamage += shield;
    if (before[2] > 0 && target.hullCurrent <= 0) this.windowDeaths++;
  }

  onShieldRegen(ship: Readonly<ShipState>, amount: number): void {
    this.shieldRegenerated[ship.id] = (this.shieldRegenerated[ship.id] ?? 0) + amount;
    this.windowShieldRegen += amount;
  }

  onMountDecision(
    _ship: Readonly<ShipState>,
    mount: Readonly<TurretMountState>,
    eligible: boolean,
    aimed: boolean,
    dt: number,
  ): void {
    const battery = this.batteries[mount.id];
    if (!battery) return;
    if (eligible) battery.eligibleSeconds += dt;
    // A legal target exists, but tracking has not yet aligned the ready mount.
    if (eligible && mount.cooldownTimer <= 0 && !aimed) {
      battery.readyTrackingSeconds += dt;
      const interval = (this.readyIntervals[mount.id] ?? 0) + dt;
      this.readyIntervals[mount.id] = interval;
      battery.longestReadyTrackingSeconds = Math.max(battery.longestReadyTrackingSeconds, interval);
    } else this.readyIntervals[mount.id] = 0;
  }

  onProximity(a: Readonly<ShipState>, b: Readonly<ShipState>, distance: number): void {
    const capital = (s: Readonly<ShipState>) =>
      s.hullClass === "battleship" || s.hullClass === "cruiser";
    const light = (s: Readonly<ShipState>) =>
      s.hullClass === "strike_craft" || s.hullClass === "corvette";
    if (
      (capital(a) && light(b) && a.shieldCurrent > 0 && distance < shieldEnvelopeRadius(a) + 18) ||
      (capital(b) && light(a) && b.shieldCurrent > 0 && distance < shieldEnvelopeRadius(b) + 18)
    ) {
      this.ramProximityPairTicks++;
    }
  }

  onTick(
    time: number,
    dt: number,
    ships: readonly Readonly<ShipState>[],
    projectiles: readonly Readonly<ProjectileState>[],
  ): void {
    this.peakProjectiles = Math.max(this.peakProjectiles, projectiles.length);
    const ids = new Set(ships.map((ship) => ship.id));
    for (const projectile of projectiles) {
      if (ids.has(projectile.id) && this.errors.length === 0) {
        this.errors.push(`Duplicate entity id: ${projectile.id}`);
      }
      ids.add(projectile.id);
      if (
        ![...projectile.pos, ...projectile.velocity, projectile.hp, projectile.lifetime].every(
          Number.isFinite,
        ) &&
        this.errors.length === 0
      ) {
        this.errors.push(`Invalid projectile: ${projectile.id} at ${time.toFixed(2)}s`);
      }
    }
    const byId = new Map(ships.map((ship) => [ship.id, ship]));
    for (const ship of ships) {
      const values = [
        ...ship.pos,
        ...ship.velocity,
        ship.heading,
        ship.shieldCurrent,
        ship.armorCurrent,
        ship.hullCurrent,
      ];
      if (
        (!values.every(Number.isFinite) ||
          ship.shieldCurrent < -1e-6 ||
          ship.shieldCurrent > ship.shieldMax + 1e-6 ||
          ship.armorCurrent < -1e-6 ||
          ship.armorCurrent > ship.armorMax + 1e-6 ||
          ship.hullCurrent < -1e-6 ||
          ship.hullCurrent > ship.hullMax + 1e-6) &&
        this.errors.length === 0
      ) {
        this.errors.push(`Invalid state: ${ship.id} at ${time.toFixed(2)}s`);
      }
      if (!ship.isAlive) {
        this.outside.delete(ship.id);
        continue;
      }
      const radius = Math.hypot(...ship.pos);
      this.maxRadius = Math.max(this.maxRadius, radius);
      if (radius > ARENA_RADIUS) this.shipSecondsOutsideArena += dt;
      if (radius > ARENA_HARD_PULL_RADIUS) {
        this.shipSecondsOutsideHardPull += dt;
        if (!this.outside.has(ship.id)) this.hardPullEntries++;
        this.outside.add(ship.id);
      } else this.outside.delete(ship.id);
      const target = ship.navigationTargetId ? byId.get(ship.navigationTargetId) : undefined;
      if (!target?.isAlive) {
        this.previousAngles.delete(ship.id);
        this.previousTargets.delete(ship.id);
        continue;
      }
      if (this.previousTargets.get(ship.id) !== target.id) {
        this.previousAngles.delete(ship.id);
        this.winding.delete(ship.id);
        this.previousTargets.set(ship.id, target.id);
      }
      const angle = Math.atan2(ship.pos[1] - target.pos[1], ship.pos[0] - target.pos[0]);
      const previous = this.previousAngles.get(ship.id);
      if (previous !== undefined) {
        const delta = Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
        this.winding.set(ship.id, (this.winding.get(ship.id) ?? 0) + delta);
      }
      this.previousAngles.set(ship.id, angle);
    }
    if (time - this.windowStart >= 20 - 1e-6) {
      const lowProgress =
        this.windowDeaths === 0 && this.windowDamage < this.initialStructure * 0.01;
      this.lowProgressWindows = lowProgress ? this.lowProgressWindows + 1 : 0;
      if (this.lowProgressWindows >= 2) {
        const carousel = [...this.winding.values()].some((angle) => Math.abs(angle) >= 2 * Math.PI);
        this.stalls.push({
          time,
          kind: carousel
            ? "carousel"
            : this.windowShots === 0
              ? "no-fire"
              : this.windowShieldDamage > 0 && this.windowShieldRegen > 0
                ? "shield-equilibrium"
                : "low-progress",
        });
      }
      this.windowStart = time;
      this.windowDamage = 0;
      this.windowShieldDamage = 0;
      this.windowShieldRegen = 0;
      this.windowShots = 0;
      this.windowDeaths = 0;
      this.winding.clear();
    }
  }
}
