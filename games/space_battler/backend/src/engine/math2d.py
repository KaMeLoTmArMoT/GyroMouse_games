"""2D Vector math and angle helpers for deterministic combat simulation."""

import math

Vector2 = tuple[float, float]


def vec_add(a: Vector2, b: Vector2) -> Vector2:
    return (a[0] + b[0], a[1] + b[1])


def vec_sub(a: Vector2, b: Vector2) -> Vector2:
    return (a[0] - b[0], a[1] - b[1])


def vec_scale(v: Vector2, s: float) -> Vector2:
    return (v[0] * s, v[1] * s)


def vec_length_sq(v: Vector2) -> float:
    return v[0] * v[0] + v[1] * v[1]


def vec_length(v: Vector2) -> float:
    return math.sqrt(vec_length_sq(v))


def vec_distance_sq(a: Vector2, b: Vector2) -> float:
    return vec_length_sq(vec_sub(a, b))


def vec_distance(a: Vector2, b: Vector2) -> float:
    return math.sqrt(vec_distance_sq(a, b))


def vec_normalize(v: Vector2) -> Vector2:
    length = vec_length(v)
    if length < 1e-6:
        return (0.0, 0.0)
    return (v[0] / length, v[1] / length)


def normalize_angle(angle: float) -> float:
    """Normalize angle to [-pi, pi]."""
    while angle > math.pi:
        angle -= 2.0 * math.pi
    while angle < -math.pi:
        angle += 2.0 * math.pi
    return angle


def rotate_point(point: Vector2, angle: float) -> Vector2:
    """Rotate point (dx, dy) by angle in radians."""
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    return (point[0] * cos_a - point[1] * sin_a, point[0] * sin_a + point[1] * cos_a)


def clamp(val: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, val))


def dist_to_segment(p: Vector2, a: Vector2, b: Vector2) -> float:
    """Distance from point p to line segment [a, b]."""
    ab = vec_sub(b, a)
    ab_len_sq = vec_length_sq(ab)
    if ab_len_sq < 1e-6:
        return vec_distance(p, a)
    ap = vec_sub(p, a)
    t = clamp((ap[0] * ab[0] + ap[1] * ab[1]) / ab_len_sq, 0.0, 1.0)
    proj = (a[0] + ab[0] * t, a[1] + ab[1] * t)
    return vec_distance(p, proj)
