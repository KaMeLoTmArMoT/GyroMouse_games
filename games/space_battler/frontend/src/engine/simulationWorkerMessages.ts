import type {
  CombatAudioEvent,
  EngagementStance,
  GroupOrder,
  TargetPriority,
  Vector2,
  WeaponType,
} from "../types/combat";
import type { BattleMapId } from "./battleMaps";
import type { CrewVeterancy } from "./crewVeterancy";
import type { FleetSlot } from "./fleetBuilder";
import type { SimulationPresentationMetadata } from "./simulationPresentationMetadata";

export interface SimulationWorkerConfig {
  selectedMap?: BattleMapId;
  fleets: Array<{
    slots: FleetSlot[];
    team: number;
    baseX: number;
    heading: number;
    expandedSpacing?: boolean;
  }>;
  orders?: GroupOrder[];
  crewVeterancy?: Partial<Record<number, CrewVeterancy>>;
}

export type SimulationWorkerCommand =
  | { kind: "GROUP_ORDER"; order: GroupOrder }
  | { kind: "STANCE"; groupId: number; stance: EngagementStance }
  | { kind: "TARGET_PRIORITY"; groupId: number; priority: TargetPriority }
  | { kind: "TARGET_OVERRIDE"; shipId: string; targetId: string | null };

export type SimulationWorkerRequest =
  | { type: "INIT"; epoch: number; config: SimulationWorkerConfig; buffers: ArrayBuffer[] }
  | { type: "STEP"; epoch: number; requestId: number; ticks: number }
  | { type: "COMMAND"; epoch: number; requestId: number; command: SimulationWorkerCommand }
  | { type: "RECYCLE"; epoch: number; buffer: ArrayBuffer }
  | { type: "DISPOSE" };

export type SimulationWorkerEventPayload =
  | { kind: "AUDIO"; event: CombatAudioEvent }
  | { kind: "PROJECTILE_FIRE"; weaponType: WeaponType; pos: Vector2 }
  | { kind: "SHIELD_HIT"; pos: Vector2; intensity: number }
  | {
      kind: "WEAPON_IMPACT";
      shipId: string;
      pos: Vector2;
      origin: Vector2;
      shield: boolean;
      armor: boolean;
      hull: boolean;
    }
  | {
      kind: "SHIP_DESTROYED";
      shipId: string;
      pos: Vector2;
      velocity: Vector2;
      heading: number;
      size: number;
      team: number;
    }
  | { kind: "VICTORY"; winnerTeam: number }
  | {
      kind: "BEAM_FIRE";
      from: Vector2;
      to: Vector2;
      color: string;
      width: number;
      team: number;
      channeled: boolean;
    }
  | { kind: "FLAK_BURST"; pos: Vector2; radius: number; team: number };

export type SimulationWorkerEvent = SimulationWorkerEventPayload & {
  epoch: number;
  sequence: number;
  tick: number;
  time: number;
};

export type SimulationWorkerResponse =
  | { type: "READY"; epoch: number }
  | {
      type: "SNAPSHOT";
      epoch: number;
      buffer: ArrayBuffer;
      byteLength: number;
      presentation?: SimulationPresentationMetadata;
      stepDurationMs?: number;
      sentAtMs?: number;
    }
  | { type: "EVENTS"; epoch: number; events: SimulationWorkerEvent[] }
  | { type: "ACK"; epoch: number; requestId: number; tick: number }
  | { type: "ERROR"; epoch: number; requestId?: number; message: string }
  | { type: "DISPOSED" };
