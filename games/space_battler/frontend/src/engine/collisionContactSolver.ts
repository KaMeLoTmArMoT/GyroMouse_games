import type { ShipState, Vector2 } from "../types/combat";
import { sharesCarrierCorridor } from "./carrierHangar";
import { vecAdd, vecDistance, vecDot, vecNormalize, vecScale, vecSub } from "./math2d";
import {
  activeShieldRadius,
  isCapitalShip,
  shieldEnvelopeRadius,
  shieldRepulsorRadius,
} from "./shieldGeometry";
import { havenHullClearance, sharesShieldHaven } from "./shieldHaven";
import { HULL_PROFILES } from "./shipProfiles";
import type { ClientCombatSimulation } from "./simulation";
import { WasmHotLoops } from "./wasmHotLoops";

const MAX_REPULSOR_STEP = 4;
// Two soft-displacement budgets plus rounding slack; this only widens candidate discovery.
const COLLISION_SCAN_MARGIN = 2 * MAX_REPULSOR_STEP + 1e-6;

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

/** Fragments retain their parent density; 2D collider area determines their remaining mass. */
export function wreckMassFactor(wreck: ShipState): number {
  return shipMass(wreck.hullClass) * (wreck.size / HULL_PROFILES[wreck.hullClass].size) ** 2;
}

export function wreckImpactDamage(wreck: ShipState, relativeSpeed: number): number {
  return 0.5 * wreckMassFactor(wreck) * relativeSpeed ** 1.5;
}

export class CollisionContactSolver {
  private readonly hotLoops = new WasmHotLoops();
  private contacts = new Set<number>();
  private readonly contactIds = new WeakMap<ShipState, number>();
  private nextContactId = 0;
  private readonly context: Pick<
    ClientCombatSimulation,
    "shieldHaven" | "observer" | "onWeaponImpact"
  >;
  private readonly destroyShip: (ship: ShipState, attackerTeam?: number) => void;

  constructor(
    context: Pick<ClientCombatSimulation, "shieldHaven" | "observer" | "onWeaponImpact">,
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
    const contacts = tetheredPass ? new Set(this.contacts) : new Set<number>();
    const ids = aliveShips.map((ship) => {
      let id = this.contactIds.get(ship);
      if (id === undefined) {
        id = this.nextContactId++;
        this.contactIds.set(ship, id);
      }
      return id;
    });
    // Conservative bounds include shield pressure, contact hysteresis and telemetry.
    const envelopes = aliveShips.map(
      (ship) => Math.max(isCapitalShip(ship) ? 210 : 0, ship.size, shieldEnvelopeRadius(ship)) + 25,
    );
    const hotLoops = this.hotLoops;
    hotLoops.ensureCapacity(aliveShips.length);
    const positions = hotLoops.collisionShips;
    const tethers = hotLoops.tetherFlags;
    for (let i = 0; i < aliveShips.length; i++) {
      positions[i * 3] = aliveShips[i].pos[0];
      positions[i * 3 + 1] = aliveShips[i].pos[1];
      positions[i * 3 + 2] = envelopes[i];
      tethers[i] = Number(aliveShips[i].havenState === "tethered");
    }
    const { observer, shieldHaven } = this.context;
    for (let i = 0; i < aliveShips.length; i++) {
      // Scan live rows, not a stale whole-pass snapshot. Each ship's total soft
      // displacement is <= 4; hull corrections and lease changes refresh the suffix.
      let pairCount = hotLoops.collectCollisionPairsWasm(
        aliveShips.length,
        tetheredPass,
        COLLISION_SCAN_MARGIN,
        i,
        i + 1,
      );
      let cursor = 0;
      let nextColumn = i + 1;
      let refresh = false;
      while (true) {
        if (refresh) {
          // Damage can release guests other than the two ships in this pair.
          for (let k = 0; k < aliveShips.length; k++)
            tethers[k] = Number(aliveShips[k].havenState === "tethered");
          pairCount = hotLoops.collectCollisionPairsWasm(
            aliveShips.length,
            tetheredPass,
            COLLISION_SCAN_MARGIN,
            i,
            i + 1,
            nextColumn,
          );
          cursor = 0;
          refresh = false;
        }
        if (cursor >= pairCount) break;
        const j = hotLoops.collisionPairs[cursor++ * 2 + 1];
        nextColumn = j + 1;
        const a = aliveShips[i];
        const b = aliveShips[j];
        if (!a.isAlive || !b.isAlive) continue;
        const dx = a.pos[0] - b.pos[0];
        const dy = a.pos[1] - b.pos[1];
        const envelope = envelopes[i] + envelopes[j];
        if (dx * dx + dy * dy > envelope * envelope) continue;
        if (sharesCarrierCorridor(a, b)) continue;
        const tetherA = a.havenState === "tethered";
        const tetherB = b.havenState === "tethered";
        if ((tetherA || tetherB) !== tetheredPass) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        const debrisContact = a.isDebris || b.isDebris;
        if (observer && !debrisContact && a.team !== b.team) observer.onProximity(a, b, d);
        const minBubbleDist = activeShieldRadius(a) + activeShieldRadius(b);
        const nested = sharesShieldHaven(a, b);
        const hullClearance = nested ? havenHullClearance(a, b) : a.size + b.size;
        const repulsorZone = debrisContact
          ? hullClearance
          : nested
            ? hullClearance
            : shieldRepulsorRadius(a) + shieldRepulsorRadius(b) + 20;
        const low = Math.min(ids[i], ids[j]);
        const high = Math.max(ids[i], ids[j]);
        const pair = (high * (high + 1)) / 2 + low;
        if (d < repulsorZone + 5 && this.contacts.has(pair)) contacts.add(pair);
        if (d >= repulsorZone) continue;
        const normal: Vector2 =
          d > 0.001 ? vecNormalize(vecSub(a.pos, b.pos)) : [0, a.id < b.id ? -1 : 1];
        const massA = a.isDebris ? wreckMassFactor(a) : shipMass(a.hullClass);
        const massB = b.isDebris ? wreckMassFactor(b) : shipMass(b.hullClass);
        const totalMass = massA + massB;
        // Tethers are kinematic for unrelated contacts; hull penetration breaks attachment.
        if (nested) {
          if (tetherA && (tetherB || a.havenParentId === b.id)) shieldHaven.release(a.id);
          if (tetherB && (tetherA || b.havenParentId === a.id)) shieldHaven.release(b.id);
        }
        const fixedA =
          a.havenState === "tethered" ||
          (nested && b.havenParentId === a.id) ||
          (!a.isDebris && isCapitalShip(a) && b.hullClass === "strike_craft" && !b.isDebris);
        const fixedB =
          b.havenState === "tethered" ||
          (nested && a.havenParentId === b.id) ||
          (!b.isDebris && isCapitalShip(b) && a.hullClass === "strike_craft" && !a.isDebris);
        const pushRatioA = fixedA ? 0 : fixedB ? 1 : massB / totalMass;
        const pushRatioB = fixedB ? 0 : fixedA ? 1 : massA / totalMass;
        // Cancel only closing normal velocity so hulls slide tangentially.
        const closingSpeed = vecDot(vecSub(a.velocity, b.velocity), normal);
        if (
          debrisContact &&
          a.isDebris !== b.isDebris &&
          closingSpeed < 0 &&
          !this.contacts.has(pair)
        ) {
          const wreck = a.isDebris ? a : b;
          const vessel = a.isDebris ? b : a;
          if (isCapitalShip(wreck)) {
            const relSpeed = Math.hypot(
              a.velocity[0] - b.velocity[0],
              a.velocity[1] - b.velocity[1],
            );
            this.applyWreckImpact(vessel, wreck, wreckImpactDamage(wreck, relSpeed));
            contacts.add(pair);
          }
        }
        if (closingSpeed < 0) {
          a.velocity = vecSub(a.velocity, vecScale(normal, closingSpeed * pushRatioA));
          b.velocity = vecAdd(b.velocity, vecScale(normal, closingSpeed * pushRatioB));
        }
        // Immediate hull exclusion; soft pressure shares one per-ship budget each tick.
        const hullCorrection = Math.max(0, hullClearance - d);
        refresh =
          hullCorrection > 0 ||
          nested ||
          debrisContact ||
          (d <= minBubbleDist && a.team !== b.team);
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
        positions[i * 3] = a.pos[0];
        positions[i * 3 + 1] = a.pos[1];
        positions[j * 3] = b.pos[0];
        positions[j * 3 + 1] = b.pos[1];
        if (debrisContact || d > minBubbleDist || a.team === b.team) continue;
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

  private applyWreckImpact(ship: ShipState, wreck: ShipState, damage: number): void {
    const { observer, shieldHaven, onWeaponImpact } = this.context;
    const before = [ship.shieldCurrent, ship.armorCurrent, ship.hullCurrent];
    const shieldDamage = Math.min(ship.shieldCurrent, damage);
    ship.shieldCurrent -= shieldDamage;
    const armorDamage = Math.min(ship.armorCurrent, damage - shieldDamage);
    ship.armorCurrent -= armorDamage;
    ship.hullCurrent = Math.max(0, ship.hullCurrent - (damage - shieldDamage - armorDamage));
    ship.shieldDelayTimer =
      ship.shieldRechargeDelay ?? HULL_PROFILES[ship.hullClass].shieldRechargeDelay;
    wreck.hullCurrent = Math.max(0, wreck.hullCurrent - damage);
    observer?.onDamage(ship, wreck.id, undefined, "ram", before);
    onWeaponImpact?.(
      ship,
      wreck.pos,
      shieldDamage > 0,
      armorDamage > 0,
      ship.hullCurrent < before[2],
    );
    if (ship.shieldCurrent <= 0) shieldHaven.releaseGuests(ship.id);
    if (wreck.hullCurrent <= 0) this.destroyShip(wreck);
    if (ship.hullCurrent <= 0) this.destroyShip(ship);
  }

  resolveCruiserClearance(aliveShips: ShipState[]): void {
    const cruisers = aliveShips
      .filter((ship) => ship.isAlive && !ship.isDebris && ship.hullClass === "cruiser")
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
