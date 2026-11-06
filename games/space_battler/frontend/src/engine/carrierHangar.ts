import type { ShipState, Vector2 } from "../types/combat";
import { fighterRecoveryDirection } from "./fighterRecovery";
import { rotatePoint, vecAdd, vecDistance, vecScale, vecSub } from "./math2d";
import { shieldEnvelopeRadius } from "./shieldGeometry";

export const HANGAR_TURNAROUND = 4.5;

export function carrierRecoveryPoint(carrier: ShipState, craft: ShipState): Vector2 {
  return vecAdd(
    carrier.pos,
    rotatePoint(
      [-shieldEnvelopeRadius(carrier) - shieldEnvelopeRadius(craft) - 40, 0],
      carrier.heading,
    ),
  );
}

export function storeCarrierAuxiliaries(ships: ShipState[]): void {
  for (const carrier of ships.filter((ship) => ship.hullClass === "carrier")) {
    let fighter = 0;
    for (const craft of ships.filter((ship) => ship.flagshipId === carrier.id)) {
      if (craft.hullClass !== "strike_craft" && craft.hullClass !== "corvette") continue;
      craft.isDocked = true;
      craft.hangarLaunchAt =
        craft.hullClass === "corvette" ? 0.5 : 1 + Math.floor(fighter++ / 8) * 2.5;
      craft.hangarTurnaroundUntil = undefined;
      craft.carrierRecovering = false;
      craft.pos = [...carrier.pos];
      craft.velocity = [0, 0];
    }
  }
}

export function updateCarrierHangars(ships: ShipState[], time: number): void {
  for (const craft of ships) {
    if (!craft.isAlive || !craft.flagshipId) continue;
    const carrier = ships.find(
      (ship) =>
        ship.id === craft.flagshipId && ship.team === craft.team && ship.hullClass === "carrier",
    );
    if (!carrier) continue;
    if (!carrier.isAlive) {
      if (craft.isDocked) {
        craft.isAlive = false;
        craft.hullCurrent = 0;
      }
      craft.carrierRecovering = false;
      continue;
    }
    if (
      !craft.isDocked &&
      craft.hullClass === "strike_craft" &&
      (craft.hullCurrent < craft.hullMax * 0.7 || craft.shieldCurrent <= 0)
    )
      craft.carrierRecovering = true;
    if (craft.carrierRecovering && !craft.isDocked) {
      craft.fighterPhase = "recover";
      if (vecDistance(craft.pos, carrierRecoveryPoint(carrier, craft)) <= 35) {
        craft.isDocked = true;
        craft.hangarTurnaroundUntil = time + HANGAR_TURNAROUND;
        craft.hangarLaunchAt = undefined;
        craft.navigationTargetId = undefined;
        craft.dogfightTargetId = undefined;
        for (const turret of craft.turrets) turret.currentTargetId = null;
      }
    }
    if (!craft.isDocked) continue;
    craft.pos = [...carrier.pos];
    craft.velocity = [0, 0];
    craft.heading = carrier.heading;
    const launchAt = craft.hangarTurnaroundUntil ?? craft.hangarLaunchAt ?? Infinity;
    if (time + 1e-9 < launchAt) continue;
    if (craft.hangarTurnaroundUntil !== undefined) {
      craft.shieldCurrent = craft.shieldMax;
      craft.shieldDelayTimer = 0;
      craft.armorCurrent = Math.min(craft.armorMax, craft.armorCurrent + craft.armorMax * 0.5);
      craft.hullCurrent = Math.min(craft.hullMax, craft.hullCurrent + craft.hullMax * 0.5);
    }
    craft.isDocked = false;
    craft.hangarLaunchAt = undefined;
    craft.hangarTurnaroundUntil = undefined;
    craft.carrierRecovering = false;
    craft.recoveryStarted = undefined;
    craft.fighterPhase = "staging";
    const peers = ships.filter(
      (ship) => ship.flagshipId === carrier.id && ship.hullClass === craft.hullClass,
    );
    const slot = peers.indexOf(craft);
    const side = slot % 2 === 0 ? 1 : -1;
    craft.pos = vecAdd(
      carrier.pos,
      rotatePoint(
        [
          craft.hullClass === "corvette" ? 0 : 70 + Math.floor(slot / 2) * 32,
          side * (shieldEnvelopeRadius(carrier) + shieldEnvelopeRadius(craft) + 45),
        ],
        carrier.heading,
      ),
    );
    craft.velocity = [...carrier.velocity];
  }
}

export function moveCarrierRecovery(
  craft: ShipState,
  ships: ShipState[],
  dt: number,
  time = 0,
): boolean {
  if (!craft.carrierRecovering) return false;
  const carrier = ships.find((ship) => ship.id === craft.flagshipId && ship.isAlive);
  if (!carrier) return false;
  const destination = carrierRecoveryPoint(carrier, craft);
  const delta = vecSub(destination, craft.pos);
  const direction = fighterRecoveryDirection(craft, destination, ships, time);
  craft.velocity = vecScale(direction, Math.min(craft.maxSpeed, vecDistance([0, 0], delta) / dt));
  craft.heading = Math.atan2(direction[1], direction[0]);
  craft.pos = vecAdd(craft.pos, vecScale(craft.velocity, dt));
  return true;
}
