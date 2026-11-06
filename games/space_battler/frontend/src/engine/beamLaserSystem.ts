import type {
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
  WeaponDefinition,
} from "../types/combat";
import { inMountArc, mountPosition } from "./fireControl";
import { vecAdd, vecDistance, vecNormalize, vecScale, vecSub } from "./math2d";
import { activeShieldRadius } from "./shieldGeometry";

const BEAM_TICK_FRAMES = 6;
const BEAM_TICKS = 12;

export interface BeamChannel {
  ship: ShipState;
  turret: TurretMountState;
  target: ShipState | ProjectileState;
  kind: "ship" | "missile";
  weapon: WeaponDefinition;
  frames: number;
}

export interface ActiveBeam {
  id: string;
  from: Vector2;
  to: Vector2;
  ownerTeam: number;
  color?: string;
  harmonic?: boolean;
}

export type BeamFireCallback = (
  from: Vector2,
  to: Vector2,
  color: string,
  width: number,
  ownerTeam: number,
  channeled?: boolean,
) => void;

interface BeamLaserContext {
  getTime(): number;
  getProjectiles(): readonly ProjectileState[];
  updateTurretAim(
    turret: TurretMountState,
    dt: number,
    ship: ShipState,
    targetPos: Vector2,
  ): boolean;
  // Shared damage resolution owns layer accounting, impact telemetry and destruction.
  applyShipDamage(channel: BeamChannel, damage: number, origin: Vector2): void;
  damageMissile(channel: BeamChannel, damage: number): void;
  onBeamFire: BeamFireCallback;
}

export class BeamLaserSystem {
  readonly channels = new Map<TurretMountState, BeamChannel>();
  private readonly context: BeamLaserContext;

  constructor(context: BeamLaserContext) {
    this.context = context;
  }

  clear(): void {
    this.channels.clear();
  }

  startBeam(
    ship: ShipState,
    turret: TurretMountState,
    target: ShipState | ProjectileState,
    kind: BeamChannel["kind"],
  ): void {
    this.channels.set(turret, {
      ship,
      turret,
      target,
      kind,
      weapon: { ...turret.weapon },
      frames: 0,
    });
    this.context.onBeamFire(
      mountPosition(ship, turret),
      target.pos,
      ship.team === 0 ? "#38bdf8" : "#ef4444",
      2.8,
      ship.team,
      true,
    );
  }

  prepareBeam(channel: BeamChannel, dt: number): boolean {
    const { ship, turret, target, kind, weapon } = channel;
    const live =
      kind === "ship"
        ? (target as ShipState).isAlive && !(target as ShipState).isDocked
        : (target as ProjectileState).hp > 0 &&
          (target as ProjectileState).lifetime > 0 &&
          this.context.getProjectiles().includes(target as ProjectileState);
    if (
      !live ||
      vecDistance(mountPosition(ship, turret), target.pos) > weapon.range ||
      !inMountArc(ship, turret, target.pos)
    ) {
      this.finishBeam(turret);
      return false;
    }
    turret.currentTargetId = target.id;
    turret.currentTargetKind = kind;
    if (this.context.updateTurretAim(turret, dt, ship, target.pos)) return true;
    this.finishBeam(turret);
    return false;
  }

  updateBeam(channel: BeamChannel, aimed: boolean): void {
    channel.frames++;
    if (aimed && channel.frames % BEAM_TICK_FRAMES === 0) {
      const damage = channel.weapon.damage / BEAM_TICKS;
      if (channel.kind === "ship") {
        this.context.applyShipDamage(channel, damage, mountPosition(channel.ship, channel.turret));
      } else {
        this.context.damageMissile(channel, damage);
      }
    }
    if (channel.frames >= BEAM_TICK_FRAMES * BEAM_TICKS) this.finishBeam(channel.turret);
  }

  finishBeam(turret: TurretMountState): void {
    this.channels.delete(turret);
    turret.cooldownTimer = turret.weapon.cooldown;
    turret.lastFiredTime = this.context.getTime();
  }

  collectActiveBeams(): ActiveBeam[] {
    // Resolve deaths after simultaneous shots, before the renderer observes channel removal.
    for (const [turret, channel] of this.channels) {
      if (
        !channel.ship.isAlive ||
        channel.ship.isDocked ||
        (channel.kind === "ship" && (channel.target as ShipState).isDocked) ||
        (channel.kind === "ship" && !(channel.target as ShipState).isAlive) ||
        (channel.kind === "missile" && (channel.target as ProjectileState).hp <= 0)
      )
        this.finishBeam(turret);
    }
    // Missing active IDs let the effects renderer fade the last visible endpoints.
    return [...this.channels.values()].map((channel) => this.beamVisual(channel));
  }

  private beamVisual(channel: BeamChannel): ActiveBeam {
    const { ship, turret, target, kind } = channel;
    const angle = ship.heading + turret.currentLocalAngle;
    const from = vecAdd(mountPosition(ship, turret), [
      Math.cos(angle) * turret.barrelLength,
      Math.sin(angle) * turret.barrelLength,
    ]);
    const radius = kind === "ship" ? activeShieldRadius(target as ShipState) : 0;
    const direction = vecNormalize(vecSub(from, target.pos));
    const to = vecAdd(
      target.pos,
      vecScale(direction, Math.min(radius, vecDistance(from, target.pos))),
    );
    return { id: `${ship.id}:${turret.id}`, from, to, ownerTeam: ship.team };
  }
}
