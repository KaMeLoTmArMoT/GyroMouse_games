// 2D Vector & Angular Math utilities for deterministic client simulation

import type { Vector2 } from "../types/combat";

export function vecAdd(a: Vector2, b: Vector2): Vector2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function vecSub(a: Vector2, b: Vector2): Vector2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function vecScale(v: Vector2, s: number): Vector2 {
  return [v[0] * s, v[1] * s];
}

export function vecDot(a: Vector2, b: Vector2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function vecLengthSq(v: Vector2): number {
  return v[0] * v[0] + v[1] * v[1];
}

export function vecLength(v: Vector2): number {
  return Math.sqrt(vecLengthSq(v));
}

export function vecDistanceSq(a: Vector2, b: Vector2): number {
  return vecLengthSq(vecSub(a, b));
}

export function vecDistance(a: Vector2, b: Vector2): number {
  return Math.sqrt(vecDistanceSq(a, b));
}

export function vecNormalize(v: Vector2): Vector2 {
  const len = vecLength(v);
  if (len < 1e-6) return [0, 0];
  return [v[0] / len, v[1] / len];
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function rotatePoint(point: Vector2, angle: number): Vector2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos];
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
