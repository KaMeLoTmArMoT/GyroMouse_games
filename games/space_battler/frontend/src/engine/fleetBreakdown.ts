import type { HullClass, ShipState } from "../types/combat";
import type { CombatObserver } from "./combatTelemetry";
import type { ClientCombatSimulation } from "./simulation";

const CLASS_NAMES: Record<HullClass, string> = {
  dreadnought: "Dreadnought",
  carrier: "Carrier",
  battleship: "Battleship",
  cruiser: "Cruiser",
  missile_frigate: "Missile Frigate",
  tender: "Tender",
  corvette: "Corvette",
  strike_craft: "Strike Craft",
};

/** Lightweight per-battle telemetry; shield restoration is attributed to its recipient. */
export class FleetBreakdown implements CombatObserver {
  private initialIds: Set<string>;
  private damage = new Map<string, number>();
  private restored = new Map<string, number>();
  private sim: ClientCombatSimulation;

  constructor(sim: ClientCombatSimulation) {
    this.sim = sim;
    this.initialIds = new Set(sim.ships.filter((s) => !s.isDebris).map((s) => s.id));
  }

  onShot(): void {}
  onMountDecision(): void {}
  onProximity(): void {}
  onTick(): void {}

  onDamage(
    target: Readonly<ShipState>,
    sourceId: string | undefined,
    _mountId: string | undefined,
    _weapon: string,
    before: readonly number[],
  ): void {
    if (!sourceId) return;
    const amount =
      Math.max(0, before[0] - target.shieldCurrent) +
      Math.max(0, before[1] - target.armorCurrent) +
      Math.max(0, before[2] - target.hullCurrent);
    this.damage.set(sourceId, (this.damage.get(sourceId) ?? 0) + amount);
  }

  onShieldRegen(ship: Readonly<ShipState>, amount: number): void {
    this.restored.set(ship.id, (this.restored.get(ship.id) ?? 0) + amount);
  }

  format(team?: number): string {
    const ships = this.sim.ships.filter(
      (s) => (team === undefined || s.team === team) && !s.isDebris,
    );
    const lines = [
      `## ${team === undefined ? "Battle" : team === 0 ? "Terran Fleet" : "Alien Swarm"} Breakdown`,
      "| Class | Count (initial → active; added, lost) | Hull HP | Armor | Shields | Shields Restored | Damage Dealt (avg DPS) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ];
    let currentHp = 0;
    let maxHp = 0;
    const row = (name: string, group: ShipState[]) => {
      const initial = group.filter((s) => this.initialIds.has(s.id)).length;
      const active = group.filter((s) => s.isAlive).length;
      const added = group.length - initial;
      const lost = group.length - active;
      const layer = (
        current: "hullCurrent" | "armorCurrent" | "shieldCurrent",
        max: "hullMax" | "armorMax" | "shieldMax",
      ) => {
        const value = group.reduce((sum, s) => sum + (s.isAlive ? s[current] : 0), 0);
        const total = group.reduce((sum, s) => sum + s[max], 0);
        if (name === "Total") {
          currentHp += value;
          maxHp += total;
        }
        return `${Math.round(value)} / ${Math.round(total)}`;
      };
      const hull = layer("hullCurrent", "hullMax");
      const armor = layer("armorCurrent", "armorMax");
      const shields = layer("shieldCurrent", "shieldMax");
      const restored = group.reduce((sum, s) => sum + (this.restored.get(s.id) ?? 0), 0);
      const damage = group.reduce((sum, s) => sum + (this.damage.get(s.id) ?? 0), 0);
      const duration = this.sim.timeElapsed;
      lines.push(
        `| ${name} | ${initial} → ${active} (+${added}, -${lost}) | ${hull} | ${armor} | ${shields} | ${Math.round(restored)} | ${Math.round(damage)} (${duration > 0 ? (damage / duration).toFixed(1) : "0.0"} DPS) |`,
      );
    };
    for (const hullClass of Object.keys(CLASS_NAMES) as HullClass[]) {
      const group = ships.filter((s) => s.hullClass === hullClass);
      if (group.length) row(CLASS_NAMES[hullClass], group);
    }
    row("Total", ships);
    lines.push(
      `\nFleet HP remaining: ${maxHp > 0 ? ((currentHp / maxHp) * 100).toFixed(1) : "0.0"}% (hull + armor + shields; includes added craft).`,
      "Shields restored includes regeneration, harmonic support and carrier repairs received.",
    );
    return lines.join("\n");
  }
}
