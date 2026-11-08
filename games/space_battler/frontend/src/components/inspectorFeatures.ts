import { engineNozzles } from "../canvas/effects";
import { previewDepthFactor } from "../canvas/previewDepth";
import { rotatePoint } from "../engine/math2d";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { ShipState, Vector2 } from "../types/combat";

export interface InspectorFeature {
  id: string;
  title: string;
  details: string[];
  x: number;
  y: number;
  radius: number;
}

export function inspectorFeatures(
  ship: ShipState,
  yaw: number,
  elevation: number,
  zoom: number,
): InspectorFeature[] {
  const scale = (160 / ship.size) * zoom;
  const depth = previewDepthFactor(elevation);
  const project = (offset: Vector2, height: number): [number, number] => {
    const [x, y] = rotatePoint(offset, yaw);
    return [360 + x * scale, 240 + (y - height * depth) * scale * Math.sin(elevation)];
  };
  const feature = (
    id: string,
    title: string,
    details: string[],
    offset: Vector2,
    height: number,
    radius: number,
  ): InspectorFeature => {
    const [x, y] = project(offset, height);
    return { id, title, details, x, y, radius: Math.max(10, radius * scale) };
  };
  const profile = HULL_PROFILES[ship.hullClass];
  const turrets = ship.turrets.map((turret, index) => {
    const { weapon, baseArc } = turret;
    const arc = Math.min(360, (Math.abs(baseArc[1] - baseArc[0]) * 180) / Math.PI);
    return feature(
      `turret-${index}`,
      weapon.name,
      [
        `Type: ${weapon.weaponType.replaceAll("_", " ")}`,
        `Damage: ${weapon.damage}`,
        weapon.cooldown > 0 ? `Cooldown: ${weapon.cooldown} s` : "Cooldown: continuous",
        `Range: ${weapon.range} u`,
        `Firing arc: ${Math.round(arc)}°`,
      ],
      turret.offset,
      turret.baseRadius * 1.1,
      turret.baseRadius * 1.3,
    );
  });
  const nozzles = engineNozzles(ship).map(([x, y], index) =>
    feature(
      `engine-${index}`,
      "Main thruster",
      [
        `Max speed: ${ship.maxSpeed} u/s`,
        `Propulsion: ${ship.hullClass.replaceAll("_", " ")} drive array`,
      ],
      [x * ship.size, y * ship.size],
      0,
      ship.size * 0.08,
    ),
  );
  return [
    ...turrets,
    feature(
      "bridge",
      "Command bridge",
      [
        profile.name,
        `Role: ${profile.role}`,
        `Turn rate: ${profile.turnRateDisplay}`,
        `Doctrine: ${profile.desc}`,
      ],
      [-ship.size * 0.3, 0],
      ship.size * 0.12,
      ship.size * 0.12,
    ),
    ...nozzles,
    feature(
      "hull",
      "Hull & shields",
      [`Hull: ${ship.hullMax}`, `Armor: ${ship.armorMax}`, `Shield: ${ship.shieldMax}`],
      [ship.size * 0.7, 0],
      0,
      ship.size * 0.1,
    ),
  ];
}

export function hitInspectorFeature(
  features: InspectorFeature[],
  x: number,
  y: number,
): InspectorFeature | undefined {
  return features
    .map((feature) => ({ feature, distance: Math.hypot(feature.x - x, feature.y - y) }))
    .filter(({ feature, distance }) => distance <= feature.radius)
    .sort((a, b) => a.distance / a.feature.radius - b.distance / b.feature.radius)[0]?.feature;
}
