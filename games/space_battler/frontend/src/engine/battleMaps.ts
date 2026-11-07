import type { ShipState, Vector2 } from "../types/combat";

export const BATTLE_MAPS = [
  { id: "empty_void", label: "Empty Void", description: "Open Space" },
  { id: "megaboulder", label: "Megaboulder", description: "Giant Central Asteroid" },
  { id: "twin_pillars", label: "Twin Pillars", description: "Dual Monoliths & Chokepoint" },
  { id: "drifting_field", label: "Drifting Field", description: "Dynamic Asteroid Orbit" },
  { id: "orbital_station", label: "Orbital Station", description: "Rotating Central Station" },
] as const;

export type BattleMapId = (typeof BATTLE_MAPS)[number]["id"];

export interface MapObstacle {
  id: string;
  kind: "asteroid" | "station";
  pos: Vector2;
  previousPos: Vector2;
  velocity: Vector2;
  radius: number;
  rotation: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  rotationSpeed: number;
}

export function createMapObstacles(map: BattleMapId): MapObstacle[] {
  const obstacles: MapObstacle[] = [];
  const add = (
    kind: MapObstacle["kind"],
    radius: number,
    orbitRadius: number,
    orbitPhase: number,
    orbitSpeed = 0,
    rotationSpeed = 0,
  ) => {
    obstacles.push({
      id: `${map}_${obstacles.length}`,
      kind,
      radius,
      pos: [orbitRadius * Math.cos(orbitPhase), orbitRadius * Math.sin(orbitPhase)],
      previousPos: [orbitRadius * Math.cos(orbitPhase), orbitRadius * Math.sin(orbitPhase)],
      velocity: [
        -orbitRadius * orbitSpeed * Math.sin(orbitPhase),
        orbitRadius * orbitSpeed * Math.cos(orbitPhase),
      ],
      rotation: orbitPhase,
      orbitRadius,
      orbitPhase,
      orbitSpeed,
      rotationSpeed,
    });
  };
  switch (map) {
    case "megaboulder":
      add("asteroid", 280, 0, 0);
      break;
    case "twin_pillars":
      add("asteroid", 175, 450, Math.PI);
      add("asteroid", 175, 450, 0);
      break;
    case "drifting_field":
      for (let i = 0; i < 8; i++) {
        const orbitRadius = 600 + (i % 2) * 400;
        add(
          "asteroid",
          80 + (i % 4) * 20,
          orbitRadius,
          (i * Math.PI) / 4,
          (15 + (i % 4) * 5) / orbitRadius,
        );
      }
      break;
    case "orbital_station":
      add("station", 220, 0, 0, 0, 0.05);
      break;
  }
  return obstacles;
}

export function updateMapObstacles(obstacles: MapObstacle[], time: number): void {
  for (const obstacle of obstacles) {
    obstacle.previousPos[0] = obstacle.pos[0];
    obstacle.previousPos[1] = obstacle.pos[1];
    const angle = obstacle.orbitPhase + time * obstacle.orbitSpeed;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    obstacle.pos[0] = obstacle.orbitRadius * cos;
    obstacle.pos[1] = obstacle.orbitRadius * sin;
    obstacle.velocity[0] = -obstacle.orbitRadius * obstacle.orbitSpeed * sin;
    obstacle.velocity[1] = obstacle.orbitRadius * obstacle.orbitSpeed * cos;
    obstacle.rotation = obstacle.orbitPhase + time * obstacle.rotationSpeed;
  }
}

/** Allocation-free swept contact fraction against a circular solid. */
export function circleContactFraction(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
): number {
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  const b = x * dx + y * dy;
  if (a === 0 || b >= 0) return Infinity;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return Infinity;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : Infinity;
}

export function mapObstacleHitFraction(
  obstacles: readonly MapObstacle[],
  from: Vector2,
  to: Vector2,
): number {
  let first = Infinity;
  for (const obstacle of obstacles)
    first = Math.min(
      first,
      circleContactFraction(
        from[0] - obstacle.pos[0],
        from[1] - obstacle.pos[1],
        to[0] - from[0],
        to[1] - from[1],
        obstacle.radius,
      ),
    );
  return first;
}

export function resolveMapContacts(
  ships: ShipState[],
  obstacles: MapObstacle[],
  previousPositions: ReadonlyMap<string, Vector2>,
  dt: number,
  onContact?: (ship: ShipState) => void,
): void {
  for (const ship of ships) {
    if (!ship.isAlive || ship.isDocked) continue;
    const start = previousPositions.get(ship.id) ?? ship.pos;
    for (const obstacle of obstacles) {
      const clearance = ship.size + obstacle.radius;
      const t = circleContactFraction(
        start[0] - obstacle.previousPos[0],
        start[1] - obstacle.previousPos[1],
        ship.pos[0] - start[0] - (obstacle.pos[0] - obstacle.previousPos[0]),
        ship.pos[1] - start[1] - (obstacle.pos[1] - obstacle.previousPos[1]),
        clearance,
      );
      if (!Number.isFinite(t)) continue;
      onContact?.(ship);
      const dx =
        start[0] +
        (ship.pos[0] - start[0]) * t -
        (obstacle.previousPos[0] + (obstacle.pos[0] - obstacle.previousPos[0]) * t);
      const dy =
        start[1] +
        (ship.pos[1] - start[1]) * t -
        (obstacle.previousPos[1] + (obstacle.pos[1] - obstacle.previousPos[1]) * t);
      const distance = Math.hypot(dx, dy);
      const nx = distance > 1e-6 ? dx / distance : 1;
      const ny = distance > 1e-6 ? dy / distance : 0;
      const vx = ship.velocity[0] - obstacle.velocity[0];
      const vy = ship.velocity[1] - obstacle.velocity[1];
      const normal = vx * nx + vy * ny;
      const outward = normal < 0 ? -normal * 0.2 : normal;
      ship.velocity[0] = obstacle.velocity[0] + (vx - normal * nx) * 0.98 + outward * nx;
      ship.velocity[1] = obstacle.velocity[1] + (vy - normal * ny) * 0.98 + outward * ny;
      ship.pos[0] =
        obstacle.pos[0] +
        nx * (clearance + 0.01) +
        (ship.velocity[0] - obstacle.velocity[0]) * dt * (1 - t);
      ship.pos[1] =
        obstacle.pos[1] +
        ny * (clearance + 0.01) +
        (ship.velocity[1] - obstacle.velocity[1]) * dt * (1 - t);
    }
  }
}
