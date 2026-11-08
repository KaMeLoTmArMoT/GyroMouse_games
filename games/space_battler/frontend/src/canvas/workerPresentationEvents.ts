import type { spaceAudio } from "../engine/audioEngine";
import { shieldEnvelopeRadius } from "../engine/shieldGeometry";
import type { SimulationWorkerEvent } from "../engine/simulationWorkerMessages";
import type { ShipState } from "../types/combat";
import type { VisualEffectsManager } from "./effects";

export function dispatchWorkerPresentationEvents(
  events: readonly SimulationWorkerEvent[],
  shipById: (id: string) => ShipState | undefined,
  effects: VisualEffectsManager,
  audio: Pick<
    typeof spaceAudio,
    "playWeapon" | "playCombatEvent" | "playShieldHit" | "playExplosion" | "playVictory"
  >,
): void {
  const ingress: ShipState[] = [];
  for (const event of events) {
    switch (event.kind) {
      case "AUDIO":
        if (event.event.type === "warp_ingress") {
          const ship = shipById(event.event.sourceId);
          if (ship) ingress.push({ ...ship, pos: [...event.event.pos] });
        } else audio.playCombatEvent(event.event.type);
        break;
      case "PROJECTILE_FIRE":
        if (event.weaponType !== "missile") audio.playWeapon(event.weaponType);
        break;
      case "SHIELD_HIT":
        audio.playShieldHit(event.intensity);
        break;
      case "WEAPON_IMPACT": {
        const ship = shipById(event.shipId);
        if (!ship) break;
        const angle = Math.atan2(event.origin[1] - event.pos[1], event.origin[0] - event.pos[0]);
        if (event.shield)
          effects.addShieldImpact(ship.id, event.pos, shieldEnvelopeRadius(ship), angle);
        if (event.armor || event.hull) {
          const pos: [number, number] = [
            event.pos[0] + Math.cos(angle) * ship.size * 0.5,
            event.pos[1] + Math.sin(angle) * ship.size * 0.5,
          ];
          effects.addDamageDecal(ship, angle);
          if (event.armor) effects.addImpactSparks(pos, angle);
          if (event.hull) effects.addHullImpact(pos, angle);
        }
        break;
      }
      case "SHIP_DESTROYED": {
        const definition = shipById(event.shipId);
        if (!definition) break;
        // Effects use event-time geometry, even when snapshots were coalesced.
        const ship = {
          ...definition,
          pos: event.pos,
          velocity: event.velocity,
          heading: event.heading,
          size: event.size,
          team: event.team,
        };
        effects.addShipExplosion(ship);
        audio.playExplosion(ship);
        break;
      }
      case "VICTORY":
        audio.playVictory(event.winnerTeam);
        break;
      case "BEAM_FIRE":
        if (!event.channeled)
          effects.addBeam(event.from, event.to, event.color, event.width, event.team, 0.16);
        audio.playWeapon("beam_laser");
        break;
      case "FLAK_BURST":
        effects.addFlakBurst(event.pos, event.radius, event.team);
        break;
    }
  }
  if (ingress.length > 0) {
    effects.triggerFleetWarpIn(ingress);
    audio.playCombatEvent("warp_ingress");
  }
}
