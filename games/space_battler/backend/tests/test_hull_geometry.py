"""Geometry regression tests against the actual TypeScript renderer paths."""

import math
import re

import pytest

from src.balance.hull_geometry import (
    HULL_CLASSES,
    RENDERER_PATH,
    SHIELD_RADIUS,
    TEAMS,
    compute_hull_metrics,
    hull_commands,
    hull_polygon,
    max_vertex_radius,
    normalized_coordinate,
    renderer_hull_function,
    shoelace_area,
)


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_intersect(a, b, c, d):
    """Include collinear overlaps and non-adjacent endpoint touches."""
    turns = (cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b))
    if turns[0] * turns[1] < 0 and turns[2] * turns[3] < 0:
        return True
    for turn, p, q, r in (
        (turns[0], a, b, c),
        (turns[1], a, b, d),
        (turns[2], c, d, a),
        (turns[3], c, d, b),
    ):
        if abs(turn) <= 1e-12 and (
            min(p[0], q[0]) - 1e-12 <= r[0] <= max(p[0], q[0]) + 1e-12
            and min(p[1], q[1]) - 1e-12 <= r[1] <= max(p[1], q[1]) + 1e-12
        ):
            return True
    return False


@pytest.mark.parametrize("hull_class", HULL_CLASSES)
def test_terran_alien_area_delta_within_5_percent(hull_class):
    metrics = compute_hull_metrics()[hull_class]
    assert metrics["area_delta"] <= 0.05, metrics
    # Refinement guards against passing only because of discretization error.
    areas = [shoelace_area(hull_polygon(team, hull_class, 400)) for team in TEAMS]
    assert abs(areas[0] - areas[1]) / max(areas) <= 0.05
    for team, area in zip(TEAMS, areas, strict=True):
        assert metrics[team]["area"] == pytest.approx(area, rel=0.0002)


@pytest.mark.parametrize("team", TEAMS)
@pytest.mark.parametrize("hull_class", HULL_CLASSES)
def test_all_hulls_contained_within_shield_bubble(team, hull_class):
    assert max_vertex_radius(hull_polygon(team, hull_class)) <= SHIELD_RADIUS
    # A Bézier lies in the convex hull of its controls. The disk is convex,
    # so this certifies every curve point, including between sampled vertices.
    controls = [point for _, points in hull_commands(team, hull_class) for point in points]
    assert max_vertex_radius(controls) <= SHIELD_RADIUS


def test_shield_radius_and_engine_nozzles_match_renderer():
    source = RENDERER_PATH.read_text(encoding="utf-8")
    radius = re.search(r"const shieldBubbleRadius = ship.size \* ([\d.]+);", source)
    assert radius is not None
    assert float(radius[1]) == SHIELD_RADIUS
    # Rectangular engine nozzles are drawn separately from the filled hull.
    rectangles = re.findall(r"ctx.fillRect\(([^)]+)\)", renderer_hull_function("terran"))
    assert len(rectangles) == 2
    for arguments in rectangles:
        x, y, width, height = [normalized_coordinate(arg) for arg in arguments.split(",")]
        corners = [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]
        assert max_vertex_radius(corners) <= SHIELD_RADIUS


@pytest.mark.parametrize("team", TEAMS)
@pytest.mark.parametrize("hull_class", HULL_CLASSES)
def test_polygon_convexity_and_validity(team, hull_class):
    """Concave wings/notches are intentional; require a simple closed polygon."""
    polygon = hull_polygon(team, hull_class)
    assert polygon[0] == polygon[-1]
    assert len(set(polygon[:-1])) == len(polygon) - 1
    assert all(math.isfinite(value) for point in polygon for value in point)
    assert shoelace_area(polygon) > 0
    edges = list(zip(polygon[:-1], polygon[1:], strict=True))
    for i, (a, b) in enumerate(edges):
        assert a != b
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1:
                continue  # First and last edges are adjacent at the closure.
            assert not segments_intersect(a, b, *edges[j]), (team, hull_class, i, j)


def test_geometry_primitives():
    square: list[tuple[float, float]] = [(0, 0), (2, 0), (2, 2), (0, 2)]
    assert shoelace_area(square) == 4
    assert shoelace_area(list(reversed(square))) == 4
    assert shoelace_area(square + [square[0]]) == 4
    assert shoelace_area([(0, 0), (1, 0), (2, 0)]) == 0
    assert shoelace_area([(0, 0), (2, 0), (1, 1), (2, 2), (0, 2)]) == 3
    assert max_vertex_radius([(0, 0), (3, 4)]) == 5
    assert segments_intersect((0, 0), (2, 2), (0, 2), (2, 0))
    assert segments_intersect((0, 0), (2, 0), (1, 0), (3, 0))
    assert segments_intersect((0, 0), (2, 0), (2, 0), (3, 1))
    assert not segments_intersect((0, 0), (1, 0), (2, 0), (3, 0))


def test_quadratic_discretization():
    polygon = hull_polygon("alien", "corvette", 20)
    commands = hull_commands("alien", "corvette")
    start = commands[0][1][0]
    control, end = commands[1][1]
    assert polygon[10] == pytest.approx(
        tuple(0.25 * start[axis] + 0.5 * control[axis] + 0.25 * end[axis] for axis in (0, 1))
    )
    assert polygon[20] == end
    with pytest.raises(ValueError, match="at least 20"):
        hull_polygon("alien", "corvette", 19)


def test_unknown_coordinate_syntax_fails_loudly():
    with pytest.raises(ValueError, match="Unsupported hull coordinate"):
        normalized_coordinate("s * 1.2 + 0.5")
