import type { ShipState } from "../types/combat";
import { clamp } from "./math2d";

export function isCapitalShip(ship: Pick<ShipState, "hullClass">): boolean {
  return (
    ship.hullClass === "carrier" ||
    ship.hullClass === "battleship" ||
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "cruiser"
  );
}

/** Authoritative envelope, including the capital's enlarged haven umbrella. */
export function shieldEnvelopeRadius(
  ship: Pick<ShipState, "hullClass" | "size" | "havenRadiusMultiplier">,
): number {
  return ship.size * (isCapitalShip(ship) ? 1.68 * (ship.havenRadiusMultiplier ?? 1) : 1.4);
}

export function activeShieldRadius(ship: ShipState): number {
  return ship.shieldCurrent > 0 ? shieldEnvelopeRadius(ship) : ship.size;
}

/** Contact pressure grows with shield charge without changing the damage hitbox. */
export function shieldRepulsorRadius(ship: ShipState): number {
  const charge = clamp(ship.shieldCurrent / Math.max(1, ship.shieldMax), 0, 1);
  return ship.size + (shieldEnvelopeRadius(ship) - ship.size) * charge;
}

export function capitalSeparationDistance(a: ShipState, b: ShipState): number {
  return isCapitalShip(a) && isCapitalShip(b)
    ? (a.size + b.size) * (a.team === b.team ? 1.8 : 2.5) + 30
    : 0;
}

export function isHeavyCapitalShip(ship: Pick<ShipState, "hullClass">): boolean {
  return isCapitalShip(ship) && ship.hullClass !== "cruiser";
}

/** Physical escort buffer is independent of shield charge and applies to either pair order. */
export function escortCapitalStandoff(a: ShipState, b: ShipState): number {
  const escort = (ship: ShipState) =>
    ship.hullClass === "corvette" ||
    ship.hullClass === "missile_frigate" ||
    ship.hullClass === "tender";
  return (escort(a) && isCapitalShip(b)) || (escort(b) && isCapitalShip(a))
    ? Math.max(220, a.size + b.size + 90)
    : 0;
}
