import type { ShipState } from "../types/combat";
import { clamp } from "./math2d";

export function isCapitalShip(ship: Pick<ShipState, "hullClass">): boolean {
  return (
    ship.hullClass === "battleship" ||
    ship.hullClass === "dreadnought" ||
    ship.hullClass === "cruiser"
  );
}

/** Authoritative envelope, including the capital's enlarged haven umbrella. */
export function shieldEnvelopeRadius(ship: Pick<ShipState, "hullClass" | "size">): number {
  return ship.size * (isCapitalShip(ship) ? 1.68 : 1.4);
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
  return isCapitalShip(a) && isCapitalShip(b) ? (a.team === b.team ? 300 : 420) : 0;
}
