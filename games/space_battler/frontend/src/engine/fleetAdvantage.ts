import type { HullClass, ShipState } from "../types/combat";

const FLEET_POWER: Record<HullClass, number> = {
  dreadnought: 100,
  battleship: 75,
  carrier: 70,
  cruiser: 40,
  tender: 30,
  missile_frigate: 25,
  corvette: 15,
  strike_craft: 4,
};

function healthFraction(current: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
}

export function fleetAdvantage(ships: ShipState[], winner: number | null): [number, number] {
  if (winner === 0) return [100, 0];
  if (winner === 1) return [0, 100];

  const power = [0, 0];
  for (const ship of ships) {
    if (!ship.isAlive || ship.isDebris || (ship.team !== 0 && ship.team !== 1)) continue;
    const condition =
      0.2 * healthFraction(ship.shieldCurrent, ship.shieldMax) +
      0.35 * healthFraction(ship.armorCurrent, ship.armorMax) +
      0.45 * healthFraction(ship.hullCurrent, ship.hullMax);
    power[ship.team] += FLEET_POWER[ship.hullClass] * condition;
  }

  const total = power[0] + power[1];
  if (total === 0) return [0, 0];
  const terran = (power[0] / total) * 100;
  return [terran, 100 - terran];
}
