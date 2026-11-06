import type { ShipState } from "../types/combat";

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
