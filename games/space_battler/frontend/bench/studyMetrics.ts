import type { ShipState, TurretMountState, WeaponType } from "../src/types/combat";
import { CombatTelemetry } from "../src/engine/combatTelemetry";
import type { ClientCombatSimulation } from "../src/engine/simulation";

/** Extra observations only: never changes simulation state or decisions. */
export class StudyMetrics extends CombatTelemetry {
  firstHit: number | null = null;
  firstWeaponHit: number | null = null;
  lastShot: number | null = null;
  lastHit: number | null = null;
  lastStructuralHit: number | null = null;
  firstShotByClass: Record<string, number> = {};
  firstHitByClass: Record<string, number> = {};
  mountShots: Record<string, number> = {};
  weaponHits: Record<string, number> = {};
  aliveSeconds: Record<string, number> = {};
  openingRailShots: Record<string, number> = {};
  firstShortRangeShot: number | null = null;
  rearPairSeconds = 0;
  flankPairSeconds = 0;
  nearbyPairSeconds = 0;
  longestRearSeconds = 0;
  ramFighterDeaths = 0;
  minimumSpawnShieldGap = Infinity;
  spawnPairs: Array<{ a: string; b: string; distance: number; hullGap: number; bubbleGap: number; repulsorGap: number }> = [];
  private rearIntervals = new Map<string, number>();
  private simulation: ClientCombatSimulation;
  private initialShips: ShipState[];

  constructor(ships: ShipState[], simulation: ClientCombatSimulation) {
    super(ships);
    this.simulation = simulation;
    this.initialShips = ships;
    for (let i = 0; i < ships.length; i++) {
      for (const b of ships.slice(i + 1)) {
        const a = ships[i];
        const distance = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
        const hullGap = distance - a.size - b.size;
        const bubbleGap = distance - 1.4 * (a.size + b.size);
        this.minimumSpawnShieldGap = Math.min(this.minimumSpawnShieldGap, bubbleGap);
        const repulsorGap = bubbleGap - 20;
        if (repulsorGap < 0) this.spawnPairs.push({ a: a.id, b: b.id, distance, hullGap, bubbleGap, repulsorGap });
      }
    }
  }

  override onShot(time: number, ship: Readonly<ShipState>, mount: Readonly<TurretMountState>): void {
    super.onShot(time, ship, mount);
    this.lastShot = time;
    this.firstShotByClass[ship.hullClass] ??= time;
    this.mountShots[mount.id] = (this.mountShots[mount.id] ?? 0) + 1;
    if (mount.weapon.range < 1000) this.firstShortRangeShot ??= time;
    if (mount.weapon.weaponType === "railgun" && this.firstShortRangeShot === null)
      this.openingRailShots[ship.id] = (this.openingRailShots[ship.id] ?? 0) + 1;
  }

  override onDamage(target: Readonly<ShipState>, sourceId: string | undefined, mountId: string | undefined, weapon: WeaponType | "ram", before: readonly number[]): void {
    super.onDamage(target, sourceId, mountId, weapon, before);
    if (before[0] + before[1] + before[2] <= target.shieldCurrent + target.armorCurrent + target.hullCurrent) return;
    this.firstHit ??= this.simulation.timeElapsed;
    this.lastHit = this.simulation.timeElapsed;
    if (before[1] + before[2] > target.armorCurrent + target.hullCurrent)
      this.lastStructuralHit = this.simulation.timeElapsed;
    if (weapon !== "ram") {
      this.firstWeaponHit ??= this.simulation.timeElapsed;
      const source = this.initialShips.find((ship) => ship.id === sourceId);
      if (source) this.firstHitByClass[source.hullClass] ??= this.simulation.timeElapsed;
      const key = `${mountId ?? weapon}->${target.hullClass}`;
      this.weaponHits[key] = (this.weaponHits[key] ?? 0) + 1;
    } else if (target.hullClass === "strike_craft" && before[2] > 0 && target.hullCurrent === 0) {
      this.ramFighterDeaths++;
    }
  }

  override onTick(...args: Parameters<CombatTelemetry["onTick"]>): void {
    super.onTick(...args);
    const [, dt, ships] = args;
    const current = new Set<string>();
    for (const ship of ships) {
      if (!ship.isAlive) continue;
      this.aliveSeconds[ship.id] = (this.aliveSeconds[ship.id] ?? 0) + dt;
      if (ship.hullClass !== "battleship") continue;
      for (const enemy of ships) {
        if (!enemy.isAlive || enemy.team === ship.team || !["corvette", "strike_craft"].includes(enemy.hullClass)) continue;
        const dx = enemy.pos[0] - ship.pos[0];
        const dy = enemy.pos[1] - ship.pos[1];
        if (Math.hypot(dx, dy) > 950) continue;
        this.nearbyPairSeconds += dt;
        const angle = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - ship.heading), Math.cos(Math.atan2(dy, dx) - ship.heading)));
        if (angle >= Math.PI * 0.22 && angle <= Math.PI * 0.78) this.flankPairSeconds += dt;
        if (angle <= Math.PI * 0.78) continue;
        this.rearPairSeconds += dt;
        const key = `${ship.id}:${enemy.id}`;
        current.add(key);
        const interval = (this.rearIntervals.get(key) ?? 0) + dt;
        this.rearIntervals.set(key, interval);
        this.longestRearSeconds = Math.max(this.longestRearSeconds, interval);
      }
    }
    for (const key of this.rearIntervals.keys()) if (!current.has(key)) this.rearIntervals.delete(key);
  }

  summary() {
    return {
      firstHit: this.firstHit, firstWeaponHit: this.firstWeaponHit,
      lastShot: this.lastShot, lastHit: this.lastHit, lastStructuralHit: this.lastStructuralHit,
      firstShotByClass: this.firstShotByClass, firstHitByClass: this.firstHitByClass,
      mountShots: this.mountShots, weaponHits: this.weaponHits, aliveSeconds: this.aliveSeconds,
      openingRailShots: this.openingRailShots, firstShortRangeShot: this.firstShortRangeShot,
      nearbyPairSeconds: this.nearbyPairSeconds, rearPairSeconds: this.rearPairSeconds,
      flankPairSeconds: this.flankPairSeconds, longestRearSeconds: this.longestRearSeconds,
      ramFighterDeaths: this.ramFighterDeaths, spawnPairs: this.spawnPairs,
      spawnShieldOverlaps: this.spawnPairs.filter((pair) => pair.bubbleGap < 0).length,
      minimumSpawnShieldGap: Number.isFinite(this.minimumSpawnShieldGap) ? this.minimumSpawnShieldGap : null,
      finalState: this.initialShips.filter((s) => s.isAlive).map((s) => ({ id: s.id, pos: s.pos, heading: s.heading, velocity: s.velocity, shield: s.shieldCurrent, armor: s.armorCurrent, hull: s.hullCurrent, target: s.navigationTargetId, maneuver: s.capitalManeuver })),
    };
  }
}
