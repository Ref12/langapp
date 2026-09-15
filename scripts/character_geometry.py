"""Small, deterministic SVG centerline contract; no font fitting or terminal rules."""

from __future__ import annotations

import math
import re
from typing import Sequence


SAMPLING = {
    "id": "explicit-bezier-polyline-arclength",
    "version": 1,
    "curve_subdivisions": 32,
    "spacing": 2.0,
    "precision": 6,
}
STYLE = {
    "id": "source-em-box-monoline",
    "version": 1,
    "view_box": [0, 0, 100, 100],
    "width": 5.5,
    "linecap": "round",
    "linejoin": "round",
    "axis": "y-down",
}
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
TOKEN = re.compile(rf"[MLQC]|{NUMBER}")
ARITY = {"M": 2, "L": 2, "Q": 4, "C": 6}
Point = list[float]
Command = tuple[str, list[float]]


def finite_number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def parse_path(path: str, *, bounded: bool = True) -> list[Command]:
    """Accept explicit absolute M/L/Q/C only, exactly one continuous pen-down."""
    if not isinstance(path, str) or not path.strip() or len(path) > 100_000:
        raise ValueError("path must be a nonempty SVG path string of at most 100000 characters")
    tokens, offset = [], 0
    for match in TOKEN.finditer(path):
        if path[offset:match.start()].strip(" \t\r\n,"):
            raise ValueError("path contains unsupported SVG syntax")
        tokens.append(match.group())
        offset = match.end()
    if path[offset:].strip(" \t\r\n,"):
        raise ValueError("path contains unsupported SVG syntax")
    commands, index = [], 0
    while index < len(tokens):
        op = tokens[index]
        if op not in ARITY or (not commands and op != "M") or (commands and op == "M"):
            raise ValueError("path requires one initial M and explicit continuous L/Q/C segments")
        count = ARITY[op]
        values = tokens[index + 1:index + count + 1]
        if len(values) != count or any(value in ARITY for value in values):
            raise ValueError(f"path {op} has incorrect coordinate count")
        coordinates = [float(value) for value in values]
        if not all(math.isfinite(value) for value in coordinates):
            raise ValueError("path contains nonfinite geometry")
        if bounded and not all(0 <= value <= 100 for value in coordinates):
            raise ValueError("path coordinates/control points must be within the 100-unit frame")
        commands.append((op, coordinates))
        index += count + 1
    if len(commands) < 2:
        raise ValueError("path needs a drawable segment")
    return commands


def _polyline(commands: list[Command]) -> list[Point]:
    points = [commands[0][1][:]]
    for op, values in commands[1:]:
        start = points[-1]
        if op == "L":
            points.append(values[:])
            continue
        controls = [start] + [values[index:index + 2] for index in range(0, len(values), 2)]
        for step in range(1, SAMPLING["curve_subdivisions"] + 1):
            t = step / SAMPLING["curve_subdivisions"]
            work = [point[:] for point in controls]
            while len(work) > 1:
                work = [
                    [a[axis] * (1 - t) + b[axis] * t for axis in (0, 1)]
                    for a, b in zip(work, work[1:])
                ]
            points.append(work[0])
    return points


def validate_path(path: str) -> None:
    points = _polyline(parse_path(path))
    if sum(math.dist(a, b) for a, b in zip(points, points[1:])) < 0.000001:
        raise ValueError("path must have nonzero length")


def sample_path(path: str, spacing: float = 2.0) -> list[Point]:
    """Sample the rendered path, not source medians. Includes both endpoints."""
    if not finite_number(spacing) or spacing <= 0:
        raise ValueError("sample spacing must be finite and positive")
    points = _polyline(parse_path(path))
    offsets = [0.0]
    for a, b in zip(points, points[1:]):
        offsets.append(offsets[-1] + math.dist(a, b))
    length = offsets[-1]
    if length < 0.000001:
        raise ValueError("path must have nonzero length")
    count = max(1, math.ceil(length / spacing))
    if count > 100_000:
        raise ValueError("sample spacing produces too many points")
    result, segment = [], 1
    for index in range(count + 1):
        distance = length * index / count
        while segment < len(offsets) - 1 and offsets[segment] <= distance:
            segment += 1
        span = offsets[segment] - offsets[segment - 1]
        t = (distance - offsets[segment - 1]) / span if span else 0
        point = [
            points[segment - 1][axis] * (1 - t) + points[segment][axis] * t
            for axis in (0, 1)
        ]
        result.append([round(value, SAMPLING["precision"]) for value in point])
    return result


def transform_path(path: str, matrix: Sequence[float]) -> str:
    """Apply SVG affine [a,b,c,d,e,f] to source paths, without per-glyph fitting."""
    if len(matrix) != 6 or not all(finite_number(value) for value in matrix):
        raise ValueError("transform requires six finite affine coefficients")
    a, b, c, d, e, f = matrix
    if abs(a * d - b * c) < 1e-12:
        raise ValueError("transform must not collapse the source frame")
    result = []
    for op, values in parse_path(path, bounded=False):
        transformed = []
        for index in range(0, len(values), 2):
            x, y = values[index:index + 2]
            transformed.extend((a * x + c * y + e, b * x + d * y + f))
        result.append(op + " ".join(format(round(value, 6), ".6f").rstrip("0").rstrip(".")
                                   if round(value, 6) else "0" for value in transformed))
    output = " ".join(result)
    validate_path(output)
    return output


SOURCE_TOKEN = re.compile(rf"[MmLlHhVvCcSsQqTtAaZz]|{NUMBER}")
SOURCE_ARITY = {**ARITY, "H": 1, "V": 1, "S": 4, "T": 2, "A": 7, "Z": 0}


def _arc(start: Point, values: list[float]) -> list[Command]:
    """SVG endpoint arc -> cubic segments spanning at most 22.5 degrees."""
    rx, ry, angle, large, sweep, x, y = values
    if large not in (0, 1) or sweep not in (0, 1):
        raise ValueError("SVG arc flags must be zero or one")
    if start == [x, y]:
        return []
    rx, ry = abs(rx), abs(ry)
    if not rx or not ry:
        return [("L", [x, y])]
    phi = math.radians(angle % 360)
    cosine, sine = math.cos(phi), math.sin(phi)
    dx, dy = (start[0] - x) / 2, (start[1] - y) / 2
    xp, yp = cosine * dx + sine * dy, -sine * dx + cosine * dy
    scale = math.hypot(xp / rx, yp / ry)
    if not math.isfinite(scale):
        raise ValueError("SVG arc radii are numerically ill-conditioned")
    if scale > 1:
        rx, ry = rx * scale, ry * scale
    if max(rx, ry) > 1e12:
        raise ValueError("SVG arc effective radii are excessive")
    numerator = max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp)
    denominator = rx * rx * yp * yp + ry * ry * xp * xp
    if not math.isfinite(denominator) or denominator < 1e-250:
        raise ValueError("SVG arc is numerically ill-conditioned")
    factor = (-1 if large == sweep else 1) * math.sqrt(numerator / denominator)
    cxp, cyp = factor * rx * yp / ry, -factor * ry * xp / rx
    cx = cosine * cxp - sine * cyp + (start[0] + x) / 2
    cy = sine * cxp + cosine * cyp + (start[1] + y) / 2
    theta = math.atan2((yp - cyp) / ry, (xp - cxp) / rx)
    finish = math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx)
    delta = (finish - theta) % (2 * math.pi)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    count = max(1, math.ceil(abs(delta) / (math.pi / 8)))
    step = delta / count

    def point(t):
        return [cx + rx * cosine * math.cos(t) - ry * sine * math.sin(t),
                cy + rx * sine * math.cos(t) + ry * cosine * math.sin(t)]

    def tangent(t):
        return [-rx * cosine * math.sin(t) - ry * sine * math.cos(t),
                -rx * sine * math.sin(t) + ry * cosine * math.cos(t)]

    result = []
    for index in range(count):
        before, after = theta + index * step, theta + (index + 1) * step
        p0, p1 = point(before), point(after)
        d0, d1 = tangent(before), tangent(after)
        alpha = 4 / 3 * math.tan(step / 4)
        controls = [p0[axis] + alpha * d0[axis] for axis in (0, 1)]
        controls += [p1[axis] - alpha * d1[axis] for axis in (0, 1)]
        result.append(("C", controls + ([x, y] if index == count - 1 else p1)))
    return result


def normalize_svg_path(path: str, matrix: Sequence[float] = (1, 0, 0, 1, 0, 0)) -> list[str]:
    """Convert SVG path data to one canonical path per explicit source subpath.

    This does not infer whether animation duplicates represent extra pen lifts.
    Source adapters must resolve that distinction before calling this helper.
    """
    if not isinstance(path, str) or not path.strip() or len(path) > 100_000:
        raise ValueError("source path must be a nonempty bounded-length string")
    tokens, offset = [], 0
    for match in SOURCE_TOKEN.finditer(path):
        if path[offset:match.start()].strip(" \t\r\n,"):
            raise ValueError("unsupported source SVG syntax")
        tokens.append(match.group())
        offset = match.end()
    if path[offset:].strip(" \t\r\n,"):
        raise ValueError("unsupported source SVG syntax")
    subpaths, current = [], [0.0, 0.0]
    index, command, previous = 0, None, None
    cubic_control, quadratic_control = None, None
    while index < len(tokens):
        explicit = tokens[index].upper() in SOURCE_ARITY
        if explicit:
            command = tokens[index]
            index += 1
        elif command is None or command.upper() == "Z":
            raise ValueError("source path is missing a command")
        op = command.upper()
        relative = command.islower()
        if not subpaths and op != "M":
            raise ValueError("source path must begin with a moveto")
        size = SOURCE_ARITY[op]
        if op == "A":
            raw = []
            for position in range(size):
                if index >= len(tokens) or tokens[index].upper() in SOURCE_ARITY:
                    raise ValueError("source A has incorrect coordinate count")
                token = tokens[index]
                if position in (3, 4):
                    if token[0] not in "01":
                        raise ValueError("SVG arc flags must be zero or one")
                    raw.append(token[0])
                    if len(token) > 1:
                        tokens[index] = token[1:]
                    else:
                        index += 1
                else:
                    raw.append(token)
                    index += 1
        else:
            raw = tokens[index:index + size]
            index += size
        if len(raw) != size or any(token.upper() in SOURCE_ARITY for token in raw):
            raise ValueError(f"source {op} has incorrect coordinate count")
        values = [float(token) for token in raw]
        if not all(math.isfinite(value) and abs(value) <= 1e9 for value in values):
            raise ValueError("source path has nonfinite or excessive coordinates")
        if relative:
            if op == "H":
                values[0] += current[0]
            elif op == "V":
                values[0] += current[1]
            elif op == "A":
                values[-2] += current[0]
                values[-1] += current[1]
            else:
                values = [value + current[axis % 2] for axis, value in enumerate(values)]
        output = []
        if op == "M":
            subpaths.append([("M", values)])
            current = values[:]
            command = "l" if relative else "L"
        elif op == "Z":
            start = subpaths[-1][0][1]
            if current != start:
                output = [("L", start[:])]
            current = start[:]
        elif op == "H":
            output = [("L", [values[0], current[1]])]
        elif op == "V":
            output = [("L", [current[0], values[0]])]
        elif op == "S":
            control = [2 * current[axis] - cubic_control[axis] for axis in (0, 1)] \
                if previous in ("C", "S") else current[:]
            output = [("C", control + values)]
        elif op == "T":
            control = [2 * current[axis] - quadratic_control[axis] for axis in (0, 1)] \
                if previous in ("Q", "T") else current[:]
            output = [("Q", control + values)]
        elif op == "A":
            output = _arc(current, values)
        else:
            output = [(op, values)]
        if output:
            subpaths[-1].extend(output)
            current = output[-1][1][-2:]
        cubic_control = output[-1][1][-4:-2] if output and op in ("C", "S") else None
        quadratic_control = output[-1][1][:2] if output and op in ("Q", "T") else None
        previous = op
    result = []
    for commands in subpaths:
        text = " ".join(op + " ".join(repr(value) for value in values) for op, values in commands)
        result.append(transform_path(text, matrix))
    return result
