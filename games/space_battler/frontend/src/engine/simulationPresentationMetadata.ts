import type { ProjectileState, ShipState } from "../types/combat";
import type { ShieldHavenLease } from "./shieldHaven";
import type { ClientCombatSimulation, FighterWingVisual } from "./simulation";

export interface SimulationPresentationMetadata {
  shipIds: string[];
  projectileIds: string[];
  newShips: ShipState[];
  newProjectiles: ProjectileState[];
  shipState: Partial<Omit<ShipState, "turrets">>[];
  turretState: Array<
    Array<
      Pick<ShipState["turrets"][number], "currentTargetId" | "currentTargetKind" | "sideTargetId">
    >
  >;
  projectileState: Array<Pick<ProjectileState, "targetId" | "hp" | "maxHp">>;
  activeBeams: ClientCombatSimulation["activeBeams"];
  wings: FighterWingVisual[];
  leases: ShieldHavenLease[];
}

// Definitions/loadouts travel once per entity generation. Motion, health and
// mount scalars remain exclusively in the transferable buffer. Remaining
// optional state is copied each publication so deleted tactical fields disappear.
const DEFINITION_OR_PACKED_KEYS = new Set([
  "id",
  "name",
  "groupId",
  "hullClass",
  "pos",
  "velocity",
  "heading",
  "team",
  "maxSpeed",
  "turnRate",
  "size",
  "shieldMax",
  "shieldCurrent",
  "shieldRegen",
  "armorMax",
  "armorCurrent",
  "armorRating",
  "hullMax",
  "hullCurrent",
  "cost",
  "isAlive",
  "isDocked",
  "isDebris",
  "turrets",
  "formationOffset",
]);

export class SimulationPresentationMetadataPacker {
  private ships = new WeakSet<ShipState>();
  private projectiles = new WeakSet<ProjectileState>();

  pack(sim: ClientCombatSimulation): SimulationPresentationMetadata {
    const newShips: ShipState[] = [];
    const newProjectiles: ProjectileState[] = [];
    for (const ship of sim.ships) {
      if (!this.ships.has(ship)) {
        this.ships.add(ship);
        newShips.push(structuredClone(ship));
      }
    }
    for (const projectile of sim.projectiles) {
      if (!this.projectiles.has(projectile)) {
        this.projectiles.add(projectile);
        newProjectiles.push(structuredClone(projectile));
      }
    }
    return {
      shipIds: sim.ships.map((ship) => ship.id),
      projectileIds: sim.projectiles.map((projectile) => projectile.id),
      newShips,
      newProjectiles,
      shipState: structuredClone(
        sim.ships.map((ship) =>
          Object.fromEntries(
            Object.entries(ship).filter(([key]) => !DEFINITION_OR_PACKED_KEYS.has(key)),
          ),
        ),
      ),
      turretState: sim.ships.map((ship) =>
        ship.turrets.map((turret) => ({
          currentTargetId: turret.currentTargetId,
          currentTargetKind: turret.currentTargetKind,
          sideTargetId: turret.sideTargetId,
        })),
      ),
      projectileState: sim.projectiles.map(({ targetId, hp, maxHp }) => ({ targetId, hp, maxHp })),
      activeBeams: structuredClone(sim.activeBeams),
      wings: sim.getFighterWingVisuals(),
      leases: sim.ships.flatMap((ship) => {
        const lease = sim.shieldHaven.getLease(ship.id);
        return lease ? [{ ...lease }] : [];
      }),
    };
  }
}
