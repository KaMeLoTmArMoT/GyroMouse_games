"""Normalized renderer hull metrics (filled outlines, excluding strokes/turrets).

Read the actual Canvas paths rather than maintaining a second coordinate table.
The deliberately narrow parser fails on unsupported syntax instead of silently
measuring an incomplete hull. Run this development validator from the repository.
"""

import math
import re
from pathlib import Path
from typing import Any

HULL_CLASSES = ("strike_craft", "corvette", "cruiser", "battleship")
TEAMS = ("terran", "alien")
SHIELD_RADIUS = 1.40
BEZIER_SAMPLES = 100
RENDERER_PATH = Path(__file__).resolve().parents[3] / "frontend/src/canvas/shipRenderer.ts"
type Point = tuple[float, float]


def renderer_hull_function(team: str) -> str:
    """Return the renderer function containing this team's hull and details."""
    if team not in TEAMS:
        raise ValueError(f"Unknown team: {team}")
    source = RENDERER_PATH.read_text(encoding="utf-8")
    return source.split(f"function draw{team.title()}Hull(", 1)[1].split("\nfunction ", 1)[0]


def normalized_coordinate(expression: str) -> float:
    """Accept only the renderer's literal zero or signed size * coefficient."""
    expression = expression.strip()
    if expression == "0":
        return 0.0
    match = re.fullmatch(r"(-?)s\s*\*\s*(\d+(?:\.\d+)?)", expression)
    if match is None:
        raise ValueError(f"Unsupported hull coordinate: {expression}")
    return float(match[2]) * (-1 if match[1] else 1)


def hull_commands(team: str, hull_class: str) -> list[tuple[str, list[Point]]]:
    """Extract every command from one switch arm; reject unrecognized drawing."""
    if hull_class not in HULL_CLASSES:
        raise ValueError(f"Unknown hull class: {hull_class}")
    function = renderer_hull_function(team)
    label = "default:" if hull_class == "battleship" else f'case "{hull_class}":'
    arm = function.split(label, 1)[1].split("break;", 1)[0]
    arm = re.sub(r"//[^\n]*", "", arm)
    commands = []
    for statement in arm.split(";"):
        if not statement.strip():
            continue
        match = re.fullmatch(
            r"\s*ctx\.(moveTo|lineTo|quadraticCurveTo|closePath)\((.*?)\)\s*",
            statement,
            re.DOTALL,
        )
        if match is None:
            raise ValueError(f"Unsupported hull statement: {statement}")
        operation, arguments = match.groups()
        values = [normalized_coordinate(arg) for arg in arguments.split(",")] if arguments else []
        expected = {"moveTo": 2, "lineTo": 2, "quadraticCurveTo": 4, "closePath": 0}
        if len(values) != expected[operation]:
            raise ValueError(f"Invalid arguments: {statement}")
        commands.append((operation, list(zip(values[::2], values[1::2], strict=True))))
    if not commands or commands[0][0] != "moveTo" or commands[-1][0] != "closePath":
        raise ValueError("Hull must start with moveTo and end with closePath")
    if any(op in ("moveTo", "closePath") for op, _ in commands[1:-1]):
        raise ValueError("Hull must be a single closed path")
    return commands


def hull_polygon(team: str, hull_class: str, samples: int = BEZIER_SAMPLES) -> list[Point]:
    """Construct an explicitly closed normalized outline with sampled quadratics."""
    if samples < 20:
        raise ValueError("Quadratic curves require at least 20 samples")
    polygon: list[Point] = []
    for operation, points in hull_commands(team, hull_class):
        if operation in ("moveTo", "lineTo"):
            polygon.append(points[0])
        elif operation == "quadraticCurveTo":
            start = polygon[-1]
            control, end = points
            for step in range(1, samples + 1):
                t = step / samples
                coordinates = [
                    (1 - t) ** 2 * start[axis] + 2 * (1 - t) * t * control[axis] + t**2 * end[axis]
                    for axis in (0, 1)
                ]
                polygon.append((coordinates[0], coordinates[1]))
        elif polygon[-1] != polygon[0]:
            polygon.append(polygon[0])
    return polygon


def shoelace_area(polygon: list[Point]) -> float:
    """Unsigned area; accepts either implicit or explicit closure."""
    signed_double_area = math.fsum(
        a[0] * b[1] - b[0] * a[1] for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True)
    )
    return abs(signed_double_area) / 2


def max_vertex_radius(polygon: list[Point]) -> float:
    return max(math.hypot(x, y) for x, y in polygon)


def compute_hull_metrics() -> dict[str, Any]:
    """Areas in size², radii in size; delta = |A-B|/max(A,B).

    shield_ratio is maximum sampled radius / shield radius. Control-point
    containment is additionally tested to certify the entire continuous curve.
    """
    metrics = {}
    for hull_class in HULL_CLASSES:
        variants = {}
        for team in TEAMS:
            polygon = hull_polygon(team, hull_class)
            radius = max_vertex_radius(polygon)
            variants[team] = {
                "area": shoelace_area(polygon),
                "max_radius": radius,
                "shield_ratio": radius / SHIELD_RADIUS,
            }
        a, b = (variants[team]["area"] for team in TEAMS)
        delta = abs(a - b) / max(a, b)
        metrics[hull_class] = {**variants, "area_delta": delta, "delta_percentage": 100 * delta}
    return metrics
