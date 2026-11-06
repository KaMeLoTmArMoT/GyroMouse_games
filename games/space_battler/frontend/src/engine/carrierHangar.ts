import type { ShipState, Vector2 } from "../types/combat";
import { fighterRecoveryDirection, recoveryApproachVelocity } from "./fighterRecovery";
import { rotatePoint, vecAdd, vecDistance, vecScale, vecSub } from "./math2d";
import { shieldHavenSlotPosition } from "./shieldHaven";

export const HANGAR_TURNAROUND = 4.5;
export const TRACTOR_DURATION = 0.7;
export const CATAPULT_DURATION = 0.75;
export const LAUNCH_BOOST = 180;
const tractors = new WeakMap<ShipState, { started: number; local: Vector2 }>();
const launches = new WeakMap<ShipState, { started: number; side: number }>();

export function sharesCarrierCorridor(a: ShipState, b: ShipState): boolean {
  const guest = (craft: ShipState, carrier: ShipState) =>
    carrier.hullClass === "carrier" &&
    craft.flagshipId === carrier.id &&
    (craft.carrierRecovering === true || launches.has(craft));
  return a.team === b.team && (guest(a, b) || guest(b, a));
}

function deckSide(craft: ShipState): number {
  return (Number(craft.id.split("_").at(-1)) || 0) % 2 === 0 ? 1 : -1;
}

export function carrierRecoveryPoint(carrier: ShipState, craft: ShipState): Vector2 {
  return shieldHavenSlotPosition(carrier, deckSide(craft) > 0 ? "starboard-aft" : "port-aft");
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
      tractors.delete(craft);
      launches.delete(craft);
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
      tractors.delete(craft);
      launches.delete(craft);
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
      const tractor = tractors.get(craft);
      if (tractor && time + 1e-9 >= tractor.started + TRACTOR_DURATION) {
        tractors.delete(craft);
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
    craft.velocity = [...carrier.velocity];
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
    const side = deckSide(craft);
    craft.pos = shieldHavenSlotPosition(carrier, side > 0 ? "starboard-forward" : "port-forward");
    craft.heading = carrier.heading;
    craft.velocity = vecAdd(carrier.velocity, rotatePoint([LAUNCH_BOOST, 0], carrier.heading));
    launches.set(craft, { started: time, side });
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
  let tractor = tractors.get(craft);
  if (
    !tractor &&
    vecDistance(craft.pos, destination) <= 60 &&
    vecDistance(craft.velocity, carrier.velocity) < 40
  ) {
    tractor = {
      started: time,
      local: rotatePoint(vecSub(craft.pos, carrier.pos), -carrier.heading),
    };
    tractors.set(craft, tractor);
  }
  if (tractor) {
    const progress = Math.min(1, (time + dt - tractor.started) / TRACTOR_DURATION);
    const bay: Vector2 = [-carrier.size * 0.35, deckSide(craft) * carrier.size * 0.45];
    const local = vecAdd(vecScale(tractor.local, 1 - progress), vecScale(bay, progress));
    craft.pos = vecAdd(
      vecAdd(carrier.pos, vecScale(carrier.velocity, dt)),
      rotatePoint(local, carrier.heading),
    );
    craft.velocity = vecAdd(
      carrier.velocity,
      rotatePoint(
        vecScale(vecSub(bay, tractor.local), progress < 1 ? 1 / TRACTOR_DURATION : 0),
        carrier.heading,
      ),
    );
    craft.heading = carrier.heading;
    return true;
  }
  const direction = fighterRecoveryDirection(craft, destination, ships, time);
  craft.velocity = recoveryApproachVelocity(craft, carrier, destination, direction, dt);
  craft.heading = Math.atan2(direction[1], direction[0]);
  craft.pos = vecAdd(craft.pos, vecScale(craft.velocity, dt));
  return true;
}

export function moveCarrierLaunch(
  craft: ShipState,
  ships: ShipState[],
  dt: number,
  time: number,
): boolean {
  const launch = launches.get(craft);
  if (!launch) return false;
  const carrier = ships.find((ship) => ship.id === craft.flagshipId && ship.isAlive);
  const elapsed = time - launch.started;
  if (!carrier || craft.isDocked || craft.carrierRecovering || elapsed >= CATAPULT_DURATION) {
    launches.delete(craft);
    return false;
  }
  const fan = launch.side * 0.35 * Math.max(0, elapsed / CATAPULT_DURATION);
  craft.heading = carrier.heading + fan;
  craft.velocity = vecAdd(carrier.velocity, rotatePoint([LAUNCH_BOOST, 0], craft.heading));
  craft.pos = vecAdd(craft.pos, vecScale(craft.velocity, dt));
  return true;
}
