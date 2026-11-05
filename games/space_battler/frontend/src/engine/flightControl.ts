import type {
  GroupOrder,
  ProjectileState,
  ShipState,
  TurretMountState,
  Vector2,
} from "../types/combat";
import {
  damagedTargetPriority,
  fullCircle,
  interceptTime,
  mountPosition,
  squadFocusPriority,
} from "./fireControl";
import {
  clamp,
  normalizeAngle,
  rotatePoint,
  vecAdd,
  vecDistance,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub,
} from "./math2d";

export let ARENA_RADIUS = 1900;
export let ARENA_HARD_PULL_RADIUS = 2200;

export function configureArena(radius: number, hardPullRadius: number): void {
  ARENA_RADIUS = radius;
  ARENA_HARD_PULL_RADIUS = hardPullRadius;
}

// Preserve tangential motion while smoothly replacing outward thrust with inward steering.
export function arenaVelocity(ship: ShipState, desired: Vector2): Vector2 {
  const distance = vecDistance([0, 0], ship.pos);
  if (distance <= ARENA_RADIUS) return desired;
  const outward = vecScale(ship.pos, 1 / distance);
  const t = clamp((distance - ARENA_RADIUS) / (ARENA_HARD_PULL_RADIUS - ARENA_RADIUS), 0, 1);
  const blend = t * t * (3 - 2 * t);
  const radial = vecDot(desired, outward);
  return limitVelocity(
    vecSub(desired, vecScale(outward, blend * (Math.max(0, radial) + ship.maxSpeed))),
    ship.maxSpeed,
  );
}

export function limitVelocity(velocity: Vector2, max: number): Vector2 {
  const speed = vecDistance([0, 0], velocity);
  return speed > max ? vecScale(velocity, max / speed) : velocity;
}

export function separation(ship: ShipState, ships: ShipState[]): Vector2 {
  let result: Vector2 = [0, 0];
  for (const peer of ships) {
    if (!peer.isAlive || peer.id === ship.id) continue;
    const distance = vecDistance(ship.pos, peer.pos);
    const away: Vector2 =
      distance > 1e-6
        ? vecScale(vecSub(ship.pos, peer.pos), 1 / distance)
        : [0, ship.id < peer.id ? -1 : 1];
    const closing = Math.max(0, -vecDot(vecSub(ship.velocity, peer.velocity), away));
    const wingmate =
      ship.hullClass === "strike_craft" &&
      peer.hullClass === "strike_craft" &&
      ship.team === peer.team;
    const clearance =
      ship.size * (ship.shieldCurrent > 0 ? 1.4 : 1) +
      peer.size * (peer.shieldCurrent > 0 ? 1.4 : 1) +
      (wingmate ? 8 : 30);
    const margin = clearance + (closing * closing) / 440 + closing * 0.15;
    if (distance < margin)
      result = vecAdd(result, vecScale(away, ship.maxSpeed * 2 * (1 - distance / margin)));
  }
  return result;
}

export const FIGHTER_DISPERSAL_RADIUS = 200;

export function fighterIngressHeading(bearing: number, wingIndex: number): number {
  const flank = [0, 1, -1][wingIndex % 3];
  return normalizeAngle(bearing + (flank * 40 * Math.PI) / 180);
}

// Sample wing density at echelon centers so every wingmate receives the same soft push.
// Short-range hull separation still handles individual craft without breaking the echelon.
export function fighterDispersal(ship: ShipState, ships: ShipState[]): Vector2 {
  if (ship.hullClass !== "strike_craft") return [0, 0];
  const key = (craft: ShipState) => `${craft.groupId}:${craft.wingIndex ?? "unassigned"}`;
  const wings = new Map<string, { sum: Vector2; count: number }>();
  for (const peer of ships) {
    if (!peer.isAlive || peer.team !== ship.team || peer.hullClass !== "strike_craft") continue;
    const wingKey = key(peer);
    const wing = wings.get(wingKey) ?? { sum: [0, 0], count: 0 };
    wing.sum = vecAdd(wing.sum, peer.pos);
    wing.count++;
    wings.set(wingKey, wing);
  }
  const ownKey = key(ship);
  const own = wings.get(ownKey);
  if (!own) return [0, 0];
  const center = vecScale(own.sum, 1 / own.count);
  let repulsion: Vector2 = [0, 0];
  for (const [wingKey, wing] of wings) {
    if (wingKey === ownKey) continue;
    const delta = vecSub(center, vecScale(wing.sum, 1 / wing.count));
    const distance = vecDistance([0, 0], delta);
    if (distance >= FIGHTER_DISPERSAL_RADIUS) continue;
    const away: Vector2 =
      distance > 1e-6 ? vecScale(delta, 1 / distance) : [0, ownKey < wingKey ? -1 : 1];
    const falloff = (1 - distance / FIGHTER_DISPERSAL_RADIUS) ** 2;
    repulsion = vecAdd(repulsion, vecScale(away, ship.maxSpeed * 0.8 * falloff));
  }
  return limitVelocity(repulsion, ship.maxSpeed);
}

// Same world-space chirality for reciprocal opponents; never derived from heading error.
export function orbitVelocity(ship: ShipState, target: ShipState, radius = 300): Vector2 {
  const distance = vecDistance(ship.pos, target.pos);
  const n: Vector2 =
    distance > 1e-6
      ? vecScale(vecSub(target.pos, ship.pos), 1 / distance)
      : [ship.id < target.id ? 1 : -1, 0];
  const error = distance - radius;
  const radial = clamp(
    0.7 * Math.sign(error) * Math.max(Math.abs(error) - 25, 0),
    -ship.maxSpeed * 0.65,
    ship.maxSpeed * 0.7,
  );
  const tangent = ship.maxSpeed * 0.55 * clamp(1 - Math.abs(error) / radius, 0.25, 1);
  // Limited feed-forward prevents mutually chasing velocities from saturating both ships.
  return vecAdd(
    vecScale(target.velocity, 0.35),
    vecAdd(vecScale(n, radial), vecScale([-n[1], n[0]], tangent)),
  );
}

export function escortVelocity(
  ship: ShipState,
  target: ShipState | null,
  ships: ShipState[],
): Vector2 {
  let anchor = ships.find((s) => s.isAlive && s.team === ship.team && s.id === ship.flagshipId);
  if (!anchor) {
    const capitals = ships.filter(
      (s) =>
        s.isAlive &&
        s.team === ship.team &&
        (s.hullClass === "battleship" ||
          s.hullClass === "dreadnought" ||
          s.hullClass === "cruiser"),
    );
    capitals.sort(
      (a, b) =>
        ships.filter((s) => s.flagshipId === a.id).length -
          ships.filter((s) => s.flagshipId === b.id).length || a.id.localeCompare(b.id),
    );
    anchor = capitals[0];
    ship.flagshipId = anchor?.id;
  }
  if (!anchor)
    return target
      ? orbitVelocity(ship, target, target.hullClass === "cruiser" ? 230 : 300)
      : [0, 0];
  const index = Number(ship.id.split("_").at(-1)) || 0;
  const side = index % 2 === 0 ? 1 : -1;
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  const sortie = clamp((shieldRatio - 0.4) / 0.3, 0, 1);
  const tether = 380 + sortie * 220;
  const closeOffset: Vector2 = [
    120 - Math.floor(index / 2) * 45,
    side * (150 + Math.floor(index / 2) * 45),
  ];
  // Healthy pickets occupy a forward/lateral screen even when capitals fight at long range.
  const screenOffset = vecScale(
    vecNormalize([1, side * (0.5 + Math.floor(index / 2) * 0.15)]),
    550,
  );
  const station = vecAdd(
    anchor.pos,
    rotatePoint(
      vecAdd(vecScale(closeOffset, 1 - sortie), vecScale(screenOffset, sortie)),
      anchor.heading,
    ),
  );
  const stationVelocity = vecAdd(anchor.velocity, vecScale(vecSub(station, ship.pos), 0.6));
  if (
    !target ||
    shieldRatio <= 0.4 ||
    vecDistance(target.pos, anchor.pos) > 600 + sortie * 600 ||
    vecDistance(target.pos, ship.pos) > 600 ||
    vecDistance(ship.pos, anchor.pos) > tether
  )
    return stationVelocity;
  return vecAdd(vecScale(stationVelocity, 0.65), vecScale(orbitVelocity(ship, target), 0.35));
}

// Instant beams can fire again while a capital turns, so include a buffer beyond both arc and range.
function beamEscape(ship: ShipState, enemy: ShipState, turret: TurretMountState): Vector2 {
  const muzzle = mountPosition(enemy, turret);
  const relative = vecSub(ship.pos, muzzle);
  const future = vecAdd(relative, vecScale(vecSub(ship.velocity, enemy.velocity), 0.7));
  const range = turret.weapon.range + ship.size * 1.4 + 80;
  const [minArc, maxArc] = turret.baseArc;
  const center = (minArc + maxArc) / 2;
  const halfArc = (maxArc - minArc) / 2;
  const turnBuffer = 0.12 + Math.min(0.3, enemy.turnRate * 0.4);
  let best: Vector2 = [0, 0];
  let bestDepth = -Infinity;
  for (const point of [relative, future]) {
    const distance = vecDistance([0, 0], point);
    if (distance > range) continue;
    const bearing = Math.atan2(point[1], point[0]);
    const angle = normalizeAngle(bearing - enemy.heading - center);
    const margin = turnBuffer + Math.asin(clamp((ship.size * 1.4) / Math.max(1, distance), 0, 1));
    const angularDepth = halfArc + margin - Math.abs(angle);
    if (!fullCircle(turret) && angularDepth < 0) continue;
    const radialDepth = range - distance;
    const depth = fullCircle(turret) ? radialDepth : Math.min(radialDepth, distance * angularDepth);
    if (depth <= bestDepth) continue;
    bestDepth = depth;
    const outward: Vector2 = distance > 1e-6 ? vecScale(point, 1 / distance) : [1, 0];
    const side = Math.sign(angle) || ((Number(ship.id.split("_").at(-1)) || 0) % 2 ? -1 : 1);
    const direction: Vector2 =
      fullCircle(turret) || radialDepth <= distance * angularDepth
        ? outward
        : [-outward[1] * side, outward[0] * side];
    best = vecScale(direction, ship.maxSpeed * 0.25);
  }
  return best;
}

// Predict the finite gimbal corridor before firing, and also avoid shells already in flight.
export function spinalEscape(
  ship: ShipState,
  ships: ShipState[],
  projectiles: ProjectileState[],
  time: number,
): Vector2 {
  let avoidance: Vector2 = [0, 0];
  let beamAvoidance: Vector2 = [0, 0];
  let closestBeam = Infinity;
  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.team === ship.team) continue;
    for (const turret of enemy.turrets) {
      if (
        (ship.hullClass === "corvette" || ship.hullClass === "strike_craft") &&
        (enemy.hullClass === "cruiser" || enemy.hullClass === "battleship") &&
        turret.weapon.weaponType === "beam_laser"
      ) {
        const beam = beamEscape(ship, enemy, turret);
        const distance = vecDistance(ship.pos, mountPosition(enemy, turret));
        if (vecDot(beam, beam) > 0 && distance < closestBeam) {
          closestBeam = distance;
          beamAvoidance = beam;
        }
      }
      if (!turret.isSpinalGimbal) continue;
      const muzzle = mountPosition(enemy, turret);
      const forward: Vector2 = [Math.cos(enemy.heading), Math.sin(enemy.heading)];
      const lateral: Vector2 = [-forward[1], forward[0]];
      const relative = vecSub(ship.pos, muzzle);
      const x = vecDot(relative, forward);
      const arrival =
        Math.max(0, turret.cooldownTimer) + Math.max(0, x) / turret.weapon.projectileSpeed;
      if (arrival > 1.5) continue;
      const predicted = vecAdd(
        relative,
        vecScale(vecSub(ship.velocity, enemy.velocity), clamp(arrival, 0.2, 1.5)),
      );
      const futureX = vecDot(predicted, forward);
      const y = vecDot(relative, lateral);
      const futureY = vecDot(predicted, lateral);
      const lateralDistance = y * futureY < 0 ? 0 : Math.min(Math.abs(y), Math.abs(futureY));
      const width =
        ship.size * 1.4 +
        35 +
        Math.max(x, futureX) * Math.tan(Math.max(...turret.baseArc.map(Math.abs)) + 0.05);
      if (
        Math.max(x, futureX) <= 0 ||
        Math.min(x, futureX) > turret.weapon.range + ship.size ||
        lateralDistance > width + 50
      )
        continue;
      if ((ship.escapeUntil ?? 0) <= time) {
        ship.escapeSide =
          Math.abs(y) > 5
            ? Math.sign(y)
            : (Number(ship.id.split("_").at(-1)) || 0) % 2 === 0
              ? 1
              : -1;
        ship.escapeUntil = time + 1;
      }
      avoidance = vecAdd(avoidance, vecScale(lateral, (ship.escapeSide ?? 1) * ship.maxSpeed * 2));
    }
  }
  for (const p of projectiles) {
    if (
      p.ownerTeam === ship.team ||
      (p.weaponType !== "railgun" &&
        !(ship.hullClass === "strike_craft" && p.weaponType === "missile")) ||
      p.hp <= 0 ||
      p.lifetime <= 0
    )
      continue;
    const relative = vecSub(ship.pos, p.pos);
    const v = vecSub(ship.velocity, p.velocity);
    const t = clamp(-vecDot(relative, v) / Math.max(1, vecDot(v, v)), 0, Math.min(1.5, p.lifetime));
    const closest = vecAdd(relative, vecScale(v, t));
    if (vecDistance([0, 0], closest) > ship.size + 45) continue;
    const direction = vecNormalize(p.velocity);
    const lateral: Vector2 = [-direction[1], direction[0]];
    const side = Math.sign(vecDot(relative, lateral)) || ship.escapeSide || 1;
    avoidance = vecAdd(avoidance, vecScale(lateral, side * ship.maxSpeed * 2));
  }
  return vecAdd(avoidance, beamAvoidance);
}

export function capitalIntent(
  ship: ShipState,
  target: ShipState,
  ships: ShipState[],
  order: GroupOrder,
  time = 0,
  projectiles: ProjectileState[] = [],
): { heading: number; velocity: Vector2 } {
  const dreadnought = ship.hullClass === "dreadnought";
  const frigate = ship.hullClass === "missile_frigate";
  const battleship = ship.hullClass === "battleship" || dreadnought;
  const slot = Number(ship.id.split("_").at(-1)) || 0;
  const gun = ship.turrets.find((t) =>
    battleship ? t.isSpinalGimbal : t.weapon.weaponType === "missile",
  );
  const delta = vecSub(target.pos, ship.pos);
  const distance = vecDistance(ship.pos, target.pos);
  const n = vecNormalize(delta);
  const bearing = Math.atan2(delta[1], delta[0]);
  let aimBearing = bearing;
  if (gun) {
    const intercept = interceptTime(
      vecSub(target.pos, mountPosition(ship, gun)),
      target.velocity,
      gun.weapon.projectileSpeed,
    );
    if (intercept !== null) {
      const aim = vecSub(vecAdd(target.pos, vecScale(target.velocity, intercept)), ship.pos);
      aimBearing = Math.atan2(aim[1], aim[0]);
    }
  }
  const newShot = gun?.lastFiredTime !== undefined && gun.lastFiredTime !== ship.lastManeuverShot;
  if (ship.maneuverTargetId !== target.id) {
    ship.maneuverTargetId = target.id;
    ship.capitalManeuver = "bow_acquire";
    ship.broadsideSide ??= slot % 2 === 0 ? 1 : -1;
    ship.lastManeuverShot = gun?.lastFiredTime;
  }
  if (newShot) {
    ship.lastManeuverShot = gun?.lastFiredTime;
    ship.capitalManeuver = "broadside_hold";
    if (battleship) ship.broadsideSide = -(ship.broadsideSide ?? 1);
  }
  const returnTime =
    Math.abs(normalizeAngle(aimBearing - ship.heading)) / Math.max(ship.turnRate, 0.01);
  const relative = vecSub(target.velocity, ship.velocity);
  const bearingRate =
    Math.abs(delta[0] * relative[1] - delta[1] * relative[0]) / Math.max(1, distance * distance);
  if (
    ship.capitalManeuver === "broadside_hold" &&
    (!gun || gun.cooldownTimer <= returnTime + 0.25 + bearingRate * 2)
  )
    ship.capitalManeuver = "bow_reacquire";
  const side = ship.broadsideSide ?? 1;
  const angle = ((dreadnought ? 90 : battleship ? 48 : 40) * Math.PI) / 180;
  const offensiveMounts = ship.turrets.filter((t) => t.weapon.weaponType !== "point_defense");
  const primaryRange =
    gun?.weapon.range ?? Math.max(0, ...offensiveMounts.map((t) => t.weapon.range));
  const secondaryRange =
    Math.max(0, ...offensiveMounts.filter((t) => t !== gun).map((t) => t.weapon.range)) ||
    primaryRange;
  const nominal = frigate
    ? 1150
    : order.stance === "max_range"
      ? Math.min(primaryRange * 0.85, 1500)
      : order.stance === "brawl"
        ? battleship
          ? 800
          : 750
        : Math.min(secondaryRange * 0.9, 1150);
  const shieldRatio = ship.shieldCurrent / Math.max(1, ship.shieldMax);
  const radius =
    nominal +
    (order.stance === "optimal_range" ? 60 * clamp((0.35 - shieldRatio) / 0.35, 0, 1) : 0);
  const error = distance - radius;
  const closing = !battleship && error > 200;
  const weaving =
    dreadnought || (!frigate && ship.capitalManeuver === "broadside_hold" && !closing);
  let heading = normalizeAngle(aimBearing - (weaving ? side * angle : 0));
  let radial = clamp(
    0.35 * Math.sign(error) * Math.max(0, Math.abs(error) - 25),
    -ship.maxSpeed * 0.65,
    ship.maxSpeed * 0.85,
  );
  const boundary = clamp((vecDistance([0, 0], ship.pos) - (ARENA_RADIUS - 200)) / 200, 0, 1);
  if (!battleship && radial < 0) radial *= 1 - boundary;
  const line =
    battleship &&
    ships.some(
      (peer) =>
        peer.isAlive &&
        peer.team === ship.team &&
        peer.id !== ship.id &&
        (peer.hullClass === "battleship" || peer.hullClass === "dreadnought"),
    );
  const phase = time * 0.35 + slot * 2.1;
  if (line) radial += ship.maxSpeed * 0.2 * Math.sin(phase);
  const tangential =
    (weaving ? ship.maxSpeed * 0.3 * side : 0) +
    (line ? ship.maxSpeed * 0.25 * Math.cos(phase) : boundary * ship.maxSpeed * 0.6 * side);
  let velocity = vecAdd(vecScale(n, radial), vecScale([-n[1], n[0]], tangential));
  velocity = vecAdd(velocity, separation(ship, ships));
  if (closing && vecDot(velocity, velocity) > 1e-6) heading = Math.atan2(velocity[1], velocity[0]);
  const forward: Vector2 = [Math.cos(ship.heading), Math.sin(ship.heading)];
  const right: Vector2 = [-forward[1], forward[0]];
  velocity = vecAdd(
    vecScale(forward, vecDot(velocity, forward)),
    vecScale(right, clamp(vecDot(velocity, right), -ship.maxSpeed * 0.35, ship.maxSpeed * 0.35)),
  );
  // Slow flagships bank early across a torpedo's course rather than trying to outrun it.
  if (battleship) {
    for (const missile of projectiles) {
      if (
        missile.ownerTeam === ship.team ||
        missile.weaponType !== "missile" ||
        missile.hp <= 0 ||
        missile.lifetime <= 0
      )
        continue;
      const relative = vecSub(ship.pos, missile.pos);
      const closing = vecSub(ship.velocity, missile.velocity);
      const arrival = -vecDot(relative, closing) / Math.max(1, vecDot(closing, closing));
      if (arrival <= 0 || arrival > Math.min(1.5, missile.lifetime)) continue;
      const closest = vecAdd(relative, vecScale(closing, arrival));
      if (vecDistance([0, 0], closest) > ship.size + 25) continue;
      const direction = vecNormalize(missile.velocity);
      const lateral: Vector2 = [-direction[1], direction[0]];
      const escapeSign = Math.sign(vecDot(relative, lateral)) || side;
      velocity = vecAdd(velocity, vecScale(lateral, escapeSign * ship.maxSpeed * 2));
    }
  }
  return { heading, velocity: limitVelocity(velocity, ship.maxSpeed) };
}

export function dogfightTarget(
  ship: ShipState,
  ships: ShipState[],
  time: number,
): ShipState | null {
  let best: ShipState | null = null;
  let bestScore = -Infinity;
  let current: ShipState | null = null;
  let currentScore = -Infinity;
  for (const enemy of ships) {
    if (!enemy.isAlive || enemy.team === ship.team || enemy.hullClass !== "strike_craft") continue;
    const r = vecSub(enemy.pos, ship.pos);
    const v = vecSub(enemy.velocity, ship.velocity);
    const distance = vecDistance([0, 0], r);
    const t = clamp(-vecDot(r, v) / Math.max(1e-6, vecDot(v, v)), 0, 1.5);
    const approach = vecDistance([0, 0], vecAdd(r, vecScale(v, t)));
    const threat = distance <= 600 || (t > 0 && approach < 120);
    const retained =
      enemy.id === ship.dogfightTargetId &&
      distance <= 720 &&
      time - (ship.lastThreatTime ?? 0) < 1;
    if (!threat && !retained) continue;
    const angle = Math.abs(normalizeAngle(Math.atan2(r[1], r[0]) - ship.heading));
    const assignments = ships.filter(
      (s) =>
        s.isAlive &&
        s.id !== ship.id &&
        s.team === ship.team &&
        s.groupId === ship.groupId &&
        s.dogfightTargetId === enemy.id,
    ).length;
    const score =
      3 * clamp(1 - approach / 600, 0, 1) +
      2 * clamp(1 - angle / (Math.PI / 4), 0, 1) +
      damagedTargetPriority(enemy) +
      squadFocusPriority(assignments) -
      distance / 600;
    if (enemy.id === ship.dogfightTargetId) {
      current = enemy;
      currentScore = score;
      if (threat) ship.lastThreatTime = time;
    }
    if (score > bestScore) {
      best = enemy;
      bestScore = score;
    }
  }
  if (current && bestScore <= currentScore + 0.2 * Math.max(1, Math.abs(currentScore)))
    return current;
  if (best) ship.lastThreatTime = time;
  ship.dogfightTargetId = best?.id;
  return best;
}

export function safeRally(
  target: ShipState,
  heading: number,
  members: ShipState[],
  enemies: ShipState[],
  standoff: number,
): Vector2 {
  const backwards = rotatePoint([-1, 0], heading);
  const footprint = Math.max(...members.map((s) => Math.abs(s.wingSlot ?? 0) * 60 + s.size), 0);
  let distance = standoff;
  for (const enemy of enemies) {
    if (!enemy.isAlive || enemy.team === members[0]?.team) continue;
    for (const mount of enemy.turrets) {
      if (mount.weapon.weaponType !== "point_defense") continue;
      const offset = vecSub(mountPosition(enemy, mount), target.pos);
      const along = vecDot(offset, backwards);
      const crossSq = Math.max(0, vecDot(offset, offset) - along * along);
      const radius = mount.weapon.range + 80 + footprint;
      if (crossSq < radius * radius)
        distance = Math.max(distance, along + Math.sqrt(radius * radius - crossSq));
    }
  }
  return vecAdd(target.pos, vecScale(backwards, distance));
}
