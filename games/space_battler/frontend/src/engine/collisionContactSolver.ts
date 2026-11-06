import type { ShipState, Vector2 } from "../types/combat";
import { vecAdd, vecDistance, vecDot, vecNormalize, vecScale, vecSub } from "./math2d";
import {
  activeShieldRadius,
  capitalSeparationDistance,
  shieldRepulsorRadius,
} from "./shieldGeometry";
import { havenHullClearance, sharesShieldHaven } from "./shieldHaven";
import type { ClientCombatSimulation } from "./simulation";

const MAX_REPULSOR_STEP = 4;

function shipMass(hull: ShipState["hullClass"]): number {
  switch (hull) {
    case "carrier":
      return 150;
    case "dreadnought":
      return 160;
    case "battleship":
      return 130;
    case "cruiser":
      return 30;
    case "missile_frigate":
      return 15;
    case "tender":
      return 20;
    case "corvette":
      return 8;
    default:
      return 1;
  }
}

export class CollisionContactSolver {
  private contacts = new Set<string>();
  private readonly context: Pick<ClientCombatSimulation, "shieldHaven" | "observer">;
  private readonly destroyShip: (ship: ShipState, attackerTeam?: number) => void;

  constructor(
    context: Pick<ClientCombatSimulation, "shieldHaven" | "observer">,
    destroyShip: (ship: ShipState, attackerTeam?: number) => void,
  ) {
    this.context = context;
    this.destroyShip = destroyShip;
  }

  clear(): void {
    this.contacts.clear();
  }

  resolveShipCollisions(
    aliveShips: ShipState[],
    dt: number,
    tetheredPass: boolean,
    repulsorSteps = new Map<string, number>(),
  ): void {
    const contacts = tetheredPass ? new Set(this.contacts) : new Set<string>();
    const { observer, shieldHaven } = this.context;
    for (let i = 0; i < aliveShips.length; i++) {
      for (let j = i + 1; j < aliveShips.length; j++) {
        const a = aliveShips[i];
        const b = aliveShips[j];
        if (!a.isAlive || !b.isAlive) continue;
        const tetherA = a.havenState === "tethered";
        const tetherB = b.havenState === "tethered";
        if ((tetherA || tetherB) !== tetheredPass) continue;
        const d = vecDistance(a.pos, b.pos);
        if (observer && a.team !== b.team) observer.onProximity(a, b, d);
        const minBubbleDist = activeShieldRadius(a) + activeShieldRadius(b);
        const nested = sharesShieldHaven(a, b);
        const hullClearance = nested ? havenHullClearance(a, b) : a.size + b.size;
        const repulsorZone = nested
          ? hullClearance
          : Math.max(
              capitalSeparationDistance(a, b),
              shieldRepulsorRadius(a) + shieldRepulsorRadius(b) + 20,
            );
        const pair = [a.id, b.id].sort().join(":");
        if (d < repulsorZone + 5 && this.contacts.has(pair)) contacts.add(pair);
        if (d >= repulsorZone) continue;
        const normal: Vector2 =
          d > 0.001 ? vecNormalize(vecSub(a.pos, b.pos)) : [0, a.id < b.id ? -1 : 1];
        const massA = shipMass(a.hullClass);
        const massB = shipMass(b.hullClass);
        const totalMass = massA + massB;
        // Tethers are kinematic for unrelated contacts; hull penetration breaks attachment.
        if (nested) {
          if (tetherA && (tetherB || a.havenParentId === b.id)) shieldHaven.release(a.id);
          if (tetherB && (tetherA || b.havenParentId === a.id)) shieldHaven.release(b.id);
        }
        const fixedA = a.havenState === "tethered" || (nested && b.havenParentId === a.id);
        const fixedB = b.havenState === "tethered" || (nested && a.havenParentId === b.id);
        const pushRatioA = fixedA ? 0 : fixedB ? 1 : massB / totalMass;
        const pushRatioB = fixedB ? 0 : fixedA ? 1 : massA / totalMass;
        // Cancel only closing normal velocity so hulls slide tangentially.
        const closingSpeed = vecDot(vecSub(a.velocity, b.velocity), normal);
        if (closingSpeed < 0) {
          a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * pushRatioA));
          b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * pushRatioB));
        }
        // Immediate hull exclusion; soft pressure shares one per-ship budget each tick.
        const hullCorrection = Math.max(0, hullClearance - d);
        const softCorrection = Math.min(
          Math.max(0, repulsorZone - d - hullCorrection),
          pushRatioA > 0
            ? Math.max(0, MAX_REPULSOR_STEP - (repulsorSteps.get(a.id) ?? 0)) / pushRatioA
            : Infinity,
          pushRatioB > 0
            ? Math.max(0, MAX_REPULSOR_STEP - (repulsorSteps.get(b.id) ?? 0)) / pushRatioB
            : Infinity,
        );
        repulsorSteps.set(a.id, (repulsorSteps.get(a.id) ?? 0) + softCorrection * pushRatioA);
        repulsorSteps.set(b.id, (repulsorSteps.get(b.id) ?? 0) + softCorrection * pushRatioB);
        const correction = hullCorrection + softCorrection;
        a.pos = vecAdd(a.pos, vecScale(normal, correction * pushRatioA));
        b.pos = vecSub(b.pos, vecScale(normal, correction * pushRatioB));
        if (d > minBubbleDist || a.team === b.team) continue;
        const beforeA = observer ? [a.shieldCurrent, a.armorCurrent, a.hullCurrent] : null;
        const beforeB = observer ? [b.shieldCurrent, b.armorCurrent, b.hullCurrent] : null;
        const ramDamage =
          (this.contacts.has(pair) ? 0 : Math.max(0, -closingSpeed) * 0.25) + 5 * dt;
        contacts.add(pair);
        if (a.shieldCurrent > 0) a.shieldCurrent = Math.max(0, a.shieldCurrent - ramDamage);
        else a.hullCurrent = Math.max(0, a.hullCurrent - ramDamage * 1.5);
        if (b.shieldCurrent > 0) b.shieldCurrent = Math.max(0, b.shieldCurrent - ramDamage);
        else b.hullCurrent = Math.max(0, b.hullCurrent - ramDamage * 1.5);
        if (
          a.hullClass === "strike_craft" &&
          (b.hullClass === "battleship" || b.hullClass === "cruiser")
        )
          a.hullCurrent = 0;
        else if (
          b.hullClass === "strike_craft" &&
          (a.hullClass === "battleship" || a.hullClass === "cruiser")
        )
          b.hullCurrent = 0;
        if (observer && beforeA && beforeB) {
          observer.onDamage(a, b.id, undefined, "ram", beforeA);
          observer.onDamage(b, a.id, undefined, "ram", beforeB);
        }
        if (a.hullCurrent <= 0) this.destroyShip(a, b.team);
        if (b.hullCurrent <= 0) this.destroyShip(b, a.team);
      }
    }
    this.contacts = contacts;
  }

  resolveCruiserClearance(aliveShips: ShipState[]): void {
    const cruisers = aliveShips
      .filter((ship) => ship.isAlive && ship.hullClass === "cruiser")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Revisit crowded chains because resolving one pair can compress a previous pair.
    for (let pass = 0; pass < Math.max(32, cruisers.length * 8); pass++) {
      let corrected = false;
      for (let i = 0; i < cruisers.length; i++) {
        for (let j = i + 1; j < cruisers.length; j++) {
          const a = cruisers[i];
          const b = cruisers[j];
          if (a.team !== b.team) continue;
          const clearance = a.size + b.size;
          const distance = vecDistance(a.pos, b.pos);
          if (distance >= clearance) continue;
          const normal: Vector2 =
            distance > 1e-6 ? vecScale(vecSub(a.pos, b.pos), 1 / distance) : [-1, 0];
          const correction = vecScale(normal, (clearance - distance + 1e-6) * 0.5);
          a.pos = vecAdd(a.pos, correction);
          b.pos = vecSub(b.pos, correction);
          const closingSpeed = Math.min(0, vecDot(vecSub(a.velocity, b.velocity), normal));
          a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * 0.5));
          b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * 0.5));
          corrected = true;
        }
      }
      if (!corrected) break;
    }
  }
}
