import type { ProjectileState, ShipState } from "../types/combat";
import { carrierFabricationProgress } from "./carrierHangar";
import { FleetBreakdown } from "./fleetBreakdown";
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
  winner: number | null;
  winnerDeclaredTime: number | null;
  stats: ClientCombatSimulation["stats"];
  combatLog: ClientCombatSimulation["combatLog"];
  rollingDps: [number, number];
  tenderStates: Record<
    string,
    ReturnType<ClientCombatSimulation["harmonicShields"]["getTenderState"]>
  >;
  carrierFabrication: Record<string, ReturnType<typeof carrierFabricationProgress>>;
  fleetBreakdownText?: { team0: string; team1: string; full: string };
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
      winner: sim.winner,
      winnerDeclaredTime: sim.winnerDeclaredTime,
      stats: structuredClone(sim.stats),
      combatLog: structuredClone(sim.combatLog),
      rollingDps: [sim.getRollingDPS(0), sim.getRollingDPS(1)],
      tenderStates: Object.fromEntries(
        sim.ships
          .filter((ship) => ship.hullClass === "tender" && !ship.isDebris)
          .map((ship) => [ship.id, sim.harmonicShields.getTenderState(ship.id, sim.timeElapsed)]),
      ),
      carrierFabrication: Object.fromEntries(
        sim.ships
          .filter((ship) => ship.hullClass === "carrier" && !ship.isDebris)
          .map((ship) => [ship.id, carrierFabricationProgress(ship, sim.timeElapsed)]),
      ),
      fleetBreakdownText:
        sim.observer instanceof FleetBreakdown
          ? {
              team0: sim.observer.format(0),
              team1: sim.observer.format(1),
              full: sim.observer.format(),
            }
          : undefined,
      leases: sim.ships.flatMap((ship) => {
        const lease = sim.shieldHaven.getLease(ship.id);
        return lease ? [{ ...lease }] : [];
      }),
    };
  }
}
