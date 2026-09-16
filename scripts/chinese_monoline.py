"""Chinese preprocessing matching the five reviewed prototype stroke recipes.

Ported from docs/mockups/character-monoline.js. Generic terminal detections
produce candidates, never visual approval. Derived artwork retains the ARPHIC
PUBLIC LICENSE independently of the implementation.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import math

from character_geometry import STYLE, finite_number, validate_path


Point = list[float]
TRANSFORM = {
    "id": "hanzi-prototype-padded-em-box",
    "version": "1",
    "source_frame": [0, -124, 1024, 1024],
    "matrix": [0.087890625, 0, 0, -0.087890625, 5, 84.1015625],
}


def normalize_median(points: list[Point]) -> list[Point]:
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError("A source median requires at least two points")
    for point in points:
        if (not isinstance(point, list) or len(point) != 2
                or not all(finite_number(value) for value in point)
                or not 0 <= point[0] <= 1024 or not -124 <= point[1] <= 900):
            raise ValueError("Invalid source median point or original em-box bounds")
    if any(a == b for a, b in zip(points, points[1:])):
        raise ValueError("Consecutive duplicate source median points")
    return [[5 + x * 90 / 1024, 5 + (900 - y) * 90 / 1024] for x, y in points]


def coordinates(point: Point, precision: int = 3) -> str:
    # JS toFixed rounds exact binary halfway values away from zero, unlike
    # Python's default ties-to-even. Preserve the reviewed path strings.
    quantum = Decimal(1).scaleb(-precision)
    result = []
    for value in point:
        rounded = Decimal.from_float(float(value)).quantize(quantum, rounding=ROUND_HALF_UP)
        result.append(format(rounded, "f").rstrip("0").rstrip(".") if rounded else "0")
    return " ".join(result)


def distance(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def direction(a: Point, b: Point) -> Point:
    length = distance(a, b)
    if length == 0:
        raise ValueError("A monoline stroke needs distinct source points")
    return [(b[axis] - a[axis]) / length for axis in (0, 1)]


def project(point: Point, origin: Point, vector: Point) -> Point:
    offset = (point[0] - origin[0]) * vector[0] + (point[1] - origin[1]) * vector[1]
    return [value + offset * vector[axis] for axis, value in enumerate(origin)]


def line_points(points: list[Point], endpoints: list[Point]) -> list[Point]:
    center = [sum(point[axis] for point in points) / len(points) for axis in (0, 1)]
    xx = xy = yy = 0.0
    for point in points:
        x, y = point[0] - center[0], point[1] - center[1]
        xx += x * x
        xy += x * y
        yy += y * y
    angle = math.atan2(2 * xy, xx - yy) / 2
    vector = [math.cos(angle), math.sin(angle)]
    return [project(point, center, vector) for point in endpoints]


def line_path(points: list[Point], endpoints: list[Point]) -> str:
    start, end = line_points(points, endpoints)
    return f"M{coordinates(start)} L{coordinates(end)}"


def length(points: list[Point]) -> float:
    return sum(distance(a, b) for a, b in zip(points, points[1:]))


def prefix(points: list[Point], remaining: float) -> list[Point]:
    result = [points[0][:]]
    for before, point in zip(points, points[1:]):
        segment = distance(before, point)
        if remaining < segment:
            if remaining > 0:
                result.append([
                    value + (point[axis] - value) * remaining / segment
                    for axis, value in enumerate(before)
                ])
            break
        result.append(point[:])
        remaining -= segment
    return result


def correct_terminals(points: list[Point], width: float = 5.5) -> tuple[list[Point], str | None]:
    if not finite_number(width) or not 3 <= width <= 7:
        raise ValueError("Monoline pen width must be between 3 and 7")
    start, end = points[0], points[-1]
    peak_index = max(range(len(points)), key=lambda index: points[index][1])
    if 0 < peak_index < len(points) - 1:
        shaft, tail = points[:peak_index + 1], points[peak_index:]
        peak = points[peak_index]
        height = peak[1] - start[1]
        spread = max(point[0] for point in shaft) - min(point[0] for point in shaft)
        descending = all(b[1] >= a[1] for a, b in zip(shaft, shaft[1:]))
        returning = all(b[0] < a[0] and b[1] < a[1] for a, b in zip(tail, tail[1:]))
        tail_length = length(tail)
        if (height >= 18 and spread <= height * 0.22 and descending and returning
                and length(shaft) <= height * 1.12 and tail_length <= height * 0.45
                and peak[0] - end[0] >= 2 and peak[1] - end[1] >= 1):
            target = max(width * 0.6, height * 0.18 - width / 2)
            if tail_length > target + 0.5:
                return shaft[:-1] + prefix(tail, target), "compact-hook"
    dx, dy = end[0] - start[0], end[1] - start[1]
    total, chord = length(points), distance(start, end)
    falling = all(b[0] >= a[0] and b[1] >= a[1] for a, b in zip(points, points[1:]))
    if (dx < 2 or dy < 2 or dy / dx < 0.25 or dy / dx > 2 or not falling
            or total < 6 or total > 22 or chord / total < 0.9):
        return points, None
    fitted = line_points(prefix(points, total * 0.65), [start, end])
    vector = direction(*fitted)
    deviation = max(distance(point, project(point, fitted[0], vector)) for point in points)
    if deviation > min(3, chord * 0.2):
        return points, None
    inset = min(width / 2, distance(*fitted) * 0.325)
    return [
        [value + vector[axis] * inset * (1 if index == 0 else -1)
         for axis, value in enumerate(point)]
        for index, point in enumerate(fitted)
    ], "short-fall"


def rounded_bends(points: list[Point]) -> str:
    path = f"M{coordinates(points[0])}"
    for before, corner, after in zip(points, points[1:], points[2:]):
        incoming, outgoing = direction(corner, before), direction(corner, after)
        radius = min(3, distance(before, corner) * 0.45, distance(corner, after) * 0.45)
        entry = [value + incoming[axis] * radius for axis, value in enumerate(corner)]
        exit_point = [value + outgoing[axis] * radius for axis, value in enumerate(corner)]
        path += f" L{coordinates(entry)} Q{coordinates(corner)} {coordinates(exit_point)}"
    return f"{path} L{coordinates(points[-1])}"


def curve_path(points: list[Point]) -> str:
    if len(points) == 2:
        return f"M{coordinates(points[0])} L{coordinates(points[1])}"
    offsets = [0.0]
    for a, b in zip(points, points[1:]):
        offsets.append(offsets[-1] + distance(a, b))
    start, end, total = points[0], points[-1], offsets[-1]
    numerator, denominator, samples = [0.0, 0.0], 0.0, []
    for index, point in enumerate(points[1:-1]):
        t = offsets[index + 1] / total
        weight = 2 * t * (1 - t)
        for axis in (0, 1):
            numerator[axis] += weight * (
                point[axis] - (1 - t) ** 2 * start[axis] - t ** 2 * end[axis]
            )
        denominator += weight * weight
        samples.append((point, t))
    control = [value / denominator for value in numerator]
    error = max(distance(point, [
        (1 - t) ** 2 * value + 2 * t * (1 - t) * control[axis] + t ** 2 * end[axis]
        for axis, value in enumerate(start)
    ]) for point, t in samples)
    bounded = all(
        min(point[axis] for point in points) - 2 <= value <= max(point[axis] for point in points) + 2
        for axis, value in enumerate(control)
    )
    if error > 2 or not bounded:
        return rounded_bends(points)
    return f"M{coordinates(start)} Q{coordinates(control)} {coordinates(end)}"


def reviewed_stroke(median: list[Point], recipe: dict, *, correct: bool = True) -> tuple[str, str | None]:
    if not isinstance(recipe, dict) or set(recipe) - {"shape", "from", "to"}:
        raise ValueError("Invalid reviewed monoline recipe fields")
    first, last = recipe.get("from", 0), recipe.get("to", len(median) - 1)
    if (type(first) is not int or type(last) is not int
            or first < 0 or last >= len(median) or last <= first):
        raise ValueError("Invalid reviewed monoline stroke span")
    points = [point[:] for point in median[first:last + 1]]
    endpoints = [median[0], median[-1]]
    if recipe.get("shape") == "line":
        path, rule = line_path(points, endpoints), None
    else:
        start_direction, end_direction = direction(points[0], points[1]), direction(points[-2], points[-1])
        if first > 0:
            points[0] = project(endpoints[0], points[0], start_direction)
        if last < len(median) - 1:
            points[-1] = project(endpoints[1], points[-1], end_direction)
        points, rule = correct_terminals(points, STYLE["width"]) if correct else (points, None)
        if recipe.get("shape") not in ("curve", "bend"):
            raise ValueError("Unknown reviewed monoline stroke shape")
        path = (line_path(points, points) if rule == "short-fall"
                else curve_path(points) if recipe["shape"] == "curve" else rounded_bends(points))
    validate_path(path)
    return path, rule


def source_median_path(points: list[Point]) -> str:
    path = f"M{coordinates(points[0], 6)}"
    if len(points) == 2:
        path += f" L{coordinates(points[1], 6)}"
    else:
        for index in range(len(points) - 1):
            before, start = points[max(0, index - 1)], points[index]
            end, after = points[index + 1], points[min(len(points) - 1, index + 2)]
            c1 = [value + (end[axis] - before[axis]) / 6 for axis, value in enumerate(start)]
            c2 = [value - (after[axis] - start[axis]) / 6 for axis, value in enumerate(end)]
            path += f" C{coordinates(c1, 6)} {coordinates(c2, 6)} {coordinates(end, 6)}"
    validate_path(path)
    return path


def candidate_stroke(points: list[Point]) -> tuple[str, str | None]:
    corrected, rule = correct_terminals(points, STYLE["width"])
    path = line_path(corrected, corrected) if rule == "short-fall" else source_median_path(corrected)
    validate_path(path)
    return path, rule
