"""Preview one source-driven Chinese stroke-fitting candidate; never publish it."""

from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
import io
import sys
import zipfile

import yaml

from character_assets import sha256
from character_geometry import STYLE, finite_number, parse_path, sample_path, transform_path, validate_path
from chinese_monoline import (
    coordinates, curve_path, direction, distance, length, line_points,
    normalize_median, project, rounded_bends, source_median_path,
)
from curriculum_yaml import load_yaml
from import_chinese_writing import (
    ARCHIVE, LICENSE, LICENSE_SHA256, LOCK, REVISION, ROOT, SOURCE_SHA256, SOURCE_URL, local,
)


VERSION = "median-simple-models:13"
LIMITS = {
    "terminal_inset": STYLE["width"],
    "line_core_error": STYLE["width"] * 0.2,
    "corner_tolerance": STYLE["width"] * 0.6,
    "minimum_corner_degrees": 35,
    "maximum_deviation": STYLE["width"] * 0.75,
    "maximum_endpoint_shift": STYLE["width"],
    "maximum_segments": 5,
    "maximum_terminal_deviation": STYLE["width"],
    "maximum_hook_length_ratio": 0.35,
    "maximum_cubic_error": STYLE["width"] * 0.3,
    "maximum_cubic_segments": 2,
    "minimum_sustained_turn_degrees": 8,
    "maximum_curve_line_error_ratio": 0.5,
}
ENTRY_FLICK_MAXIMUM_DEGREES = 60
BEND_MINIMUM_TOTAL_DEGREES = 150
BEND_MAXIMUM_RADIUS = 8
BEND_MAXIMUM_SOURCE_TURN = 45
FOLD_TOLERANCES = (2.75, 2.2)
FOLD_MINIMUM_DEGREES = 25
FOLD_MINIMUM_LIMB_WIDTHS = 2
HOOK_AFTER_CHAMFER_RATIO = 0.6
COMPACTION = {
    "id": "explicit-stroke-compaction:1",
    "line_end_fraction": 0.1,
    "maximum_line_end_inset": STYLE["width"] / 2,
    "hook_length_ratio": 2 / 3,
}
NOTICE = (
    "MODIFIED 2026-10-01: Experimental line, quadratic, connected-line, mixed line/curve, rounded return-hook "
    "and tangent-connected cubic fits, preserving supported sustained curvature "
    "of pinned Hanzi Writer medians, with explicitly selected compaction, positioning and line-start trimming. "
    "Preview only: not selected, visually approved "
    "or professionally reviewed. Copyright (C) 1999 Arphic Technology Co., Ltd.; "
    "via Make Me a Hanzi and Hanzi Writer Data. Derived artwork is freely available "
    "under the ARPHIC PUBLIC LICENSE, AS IS, without warranty. Retain original "
    "copyright, license and modification notices."
)


# Original em-box (0..1024 x, y up) to the shared 100-unit frame; same mapping as the medians.
SOURCE_FRAME_MATRIX = [90 / 1024, 0, 0, -90 / 1024, 5, 5 + 900 * 90 / 1024]

def polyline(points: list[list[float]]) -> str:
    return "M" + coordinates(points[0], 6) + "".join(
        " L" + coordinates(point, 6) for point in points[1:]
    )


def segment_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    squared = dx * dx + dy * dy
    if not squared:
        return distance(point, start)
    t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared))
    return distance(point, [start[0] + t * dx, start[1] + t * dy])


def core(points):
    total = length(points)
    inset = min(LIMITS["terminal_inset"], total * 0.2)
    offsets = [0.0]
    for before, after in zip(points, points[1:]):
        offsets.append(offsets[-1] + distance(before, after))

    def at(offset):
        for index in range(1, len(points)):
            if offsets[index] >= offset:
                t = (offset - offsets[index - 1]) / (offsets[index] - offsets[index - 1])
                return [a + (b - a) * t for a, b in zip(points[index - 1], points[index])]
        raise ValueError("Cannot locate fitting interval")

    interior = [at(inset)]
    interior.extend(point[:] for point, offset in zip(points, offsets) if inset < offset < total - inset)
    interior.append(at(total - inset))
    return sample_path(polyline(interior), spacing=1)


def corner_indices(points, first=0, last=None):
    last = len(points) - 1 if last is None else last
    if last - first <= 1:
        return [first, last]
    farthest = max(range(first + 1, last), key=lambda i: segment_distance(points[i], points[first], points[last]))
    if segment_distance(points[farthest], points[first], points[last]) <= LIMITS["corner_tolerance"]:
        return [first, last]
    return corner_indices(points, first, farthest)[:-1] + corner_indices(points, farthest, last)


def intersection(first, second):
    a, b = first
    c, d = second
    u, v = [b[i] - a[i] for i in (0, 1)], [d[i] - c[i] for i in (0, 1)]
    denominator = u[0] * v[1] - u[1] * v[0]
    if abs(denominator) < 1e-8:
        return None
    t = ((c[0] - a[0]) * v[1] - (c[1] - a[1]) * v[0]) / denominator
    return [a[i] + t * u[i] for i in (0, 1)]


def deviation(first, second):
    def directed(a, b):
        return max(min(segment_distance(point, start, end) for start, end in zip(b, b[1:])) for point in a)
    return max(directed(first, second), directed(second, first))


def forward_primitive(commands):
    start = commands[0][1]
    values = commands[1][1]
    vertices = [start] + [values[i:i + 2] for i in range(0, len(values), 2)]
    chord = [vertices[-1][i] - start[i] for i in (0, 1)]
    return all(sum((b[i] - a[i]) * chord[i] for i in (0, 1)) > 0
               for a, b in zip(vertices, vertices[1:]))


def quadratic_fit(points, interior):
    start = project(points[0], interior[0], direction(interior[0], interior[1]))
    end = project(points[-1], interior[-1], direction(interior[-2], interior[-1]))
    curve_points = []
    for point in [start, *interior, end]:
        if not curve_points or point != curve_points[-1]:
            curve_points.append(point)
    # The existing fitter can return rounded bends, not a single-curve success.
    curve = curve_path(curve_points)
    commands = parse_path(curve, bounded=False)
    if [command for command, _ in commands] == ["M", "Q"] and forward_primitive(commands):
        return curve
    return None


def straight_fit(points, interior):
    fitted = line_points(interior, [points[0], points[-1]])
    if distance(*fitted) <= 1e-6:
        return None
    axis = direction(*fitted)
    error = max(distance(point, project(point, fitted[0], axis)) for point in interior)
    return polyline(fitted) if error <= LIMITS["line_core_error"] else None


def sustained_curve(points, interior, line):
    """Distinguish a gentle, one-way bow from a straight core with terminal kinks."""
    vectors = [direction(a, b) for a, b in zip(points, points[1:])]
    turns = [math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0],
                                    sum(x * y for x, y in zip(a, b))))
             for a, b in zip(vectors, vectors[1:])]
    if not turns or max(abs(turn) for turn in turns) >= LIMITS["minimum_corner_degrees"]:
        return None
    positive = any(turn > 1e-4 for turn in turns)
    negative = any(turn < -1e-4 for turn in turns)
    if positive == negative:
        return None

    core_commands = parse_path(curve_path(interior), bounded=False)
    if [op for op, _ in core_commands] != ["M", "Q"] or not forward_primitive(core_commands):
        return None
    start = core_commands[0][1]
    control, end = core_commands[1][1][:2], core_commands[1][1][2:]
    a, b = direction(start, control), direction(control, end)
    core_turn = math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0],
                                       sum(x * y for x, y in zip(a, b))))
    if abs(core_turn) < LIMITS["minimum_sustained_turn_degrees"] or core_turn * sum(turns) <= 0:
        return None

    original = sample_path(polyline(points), spacing=1)
    commands = parse_path(curve_path(original), bounded=False)
    if [op for op, _ in commands] != ["M", "Q"] or not forward_primitive(commands):
        return None
    control = commands[1][1][:2]
    if any(not 0 <= value <= 100 for value in control):
        return None
    path = "M" + coordinates(points[0], 6) + " Q" + coordinates(control, 6) + " " + coordinates(points[-1], 6)
    if not forward_primitive(parse_path(path)):
        return None
    curve_error = deviation(original, sample_path(path, spacing=1))
    line_error = deviation(original, sample_path(line, spacing=1))
    if line_error <= 1e-8 or curve_error > line_error * LIMITS["maximum_curve_line_error_ratio"]:
        return None
    return {
        "path": path, "core_turn_degrees": round(core_turn, 3),
        "source_turn_degrees": round(sum(turns), 3),
        "line_candidate_path": line, "line_deviation": round(line_error, 3),
        "curve_line_error_ratio": round(curve_error / line_error, 3),
    }


def joined_models(points):
    """Try one true turn between two simple primitives, including curved limbs."""
    def primitives(span):
        interior = core(span)
        return [parse_path(path, bounded=False) for path in
                (straight_fit(span, interior), quadratic_fit(span, interior)) if path]

    for split in range(1, len(points) - 1):
        spans = [points[:split + 1], points[split:]]
        if min(length(span) for span in spans) < STYLE["width"]:
            continue
        for first in primitives(spans[0]):
            for second in primitives(spans[1]):
                incoming = first[1][1][:2] if first[1][0] == "Q" else first[0][1]
                outgoing = second[1][1][:2]
                join = intersection([incoming, first[1][1][-2:]], [second[0][1], outgoing])
                if join is None or distance(join, points[split]) > LIMITS["maximum_endpoint_shift"]:
                    continue
                left = [first[0], (first[1][0], first[1][1][:-2] + join)]
                right = [("M", join), second[1]]
                if not forward_primitive(left) or not forward_primitive(right):
                    continue
                a, b = direction(incoming, join), direction(join, outgoing)
                angle = math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))
                if angle < LIMITS["minimum_corner_degrees"]:
                    continue
                commands = [*left, right[1]]
                path = " ".join(op + " ".join(coordinates(values[i:i + 2], 6)
                                             for i in range(0, len(values), 2))
                                for op, values in commands)
                yield {
                    "path": path, "source_corner_indices": [split],
                    "corner_angles": [round(angle, 1)],
                    "corner_shifts": [round(distance(join, points[split]), 3)],
                    "segments": [first[1][0], second[1][0]],
                }


def rounded_return_hook(path):
    """Soften a short return after a long shaft, not ordinary folds or elbows."""
    commands = parse_path(path)
    if [op for op, _ in commands] != ["M", "L", "L"]:
        return None
    start, corner, end = [values for _, values in commands]
    shaft, hook = distance(start, corner), distance(corner, end)
    if shaft < STYLE["width"] * 3 or not STYLE["width"] <= hook <= shaft * LIMITS["maximum_hook_length_ratio"]:
        return None
    incoming, outgoing = direction(start, corner), direction(corner, end)
    if sum(a * b for a, b in zip(incoming, outgoing)) >= -0.15:
        return None
    # Reuse the bounded fillet (at most 3 units and 45% of either limb).
    # Preserve the fitted endpoints at their original precision.
    rounded = parse_path(rounded_bends([start, corner, end]))
    rounded[0] = ("M", start)
    rounded[-1] = ("L", end)
    return " ".join(op + " ".join(coordinates(values[i:i + 2], 6)
                                 for i in range(0, len(values), 2))
                    for op, values in rounded)


def tangent_cubic(points, start, end, incoming, outgoing):
    """Fit positive tangent handles inside their triangle: no loops or inflections."""
    meeting = intersection([start, [start[i] + incoming[i] for i in (0, 1)]],
                           [end, [end[i] - outgoing[i] for i in (0, 1)]])
    if meeting is None:
        return None
    bounds = [sum((meeting[i] - start[i]) * incoming[i] for i in (0, 1)),
              sum((end[i] - meeting[i]) * outgoing[i] for i in (0, 1))]
    bounds = [min(value, length(points)) for value in bounds]
    if min(bounds) <= 1e-6:
        return None

    samples = sample_path(polyline(points), spacing=1)
    aa = ab = bb = ar = br = 0.0
    for index, point in enumerate(samples):
        t = index / (len(samples) - 1)
        w0, w1, w2, w3 = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        a, b = [w1 * value for value in incoming], [-w2 * value for value in outgoing]
        residual = [point[i] - (w0 + w1) * start[i] - (w2 + w3) * end[i] for i in (0, 1)]
        aa += sum(value * value for value in a)
        ab += sum(x * y for x, y in zip(a, b))
        bb += sum(value * value for value in b)
        ar += sum(x * y for x, y in zip(a, residual))
        br += sum(x * y for x, y in zip(b, residual))
    determinant = aa * bb - ab * ab
    if determinant <= 1e-10:
        return None
    choices = [((ar * bb - br * ab) / determinant, (br * aa - ar * ab) / determinant)]
    # The constrained least-squares minimum is either interior or on an edge.
    choices.extend((a, max(0, min(bounds[1], (br - ab * a) / bb))) for a in (0, bounds[0]))
    choices.extend((max(0, min(bounds[0], (ar - ab * b) / aa)), b) for b in (0, bounds[1]))
    choices = [(a, b) for a, b in choices if 0 <= a <= bounds[0] and 0 <= b <= bounds[1]]
    alpha, beta = min(choices, key=lambda pair:
                      aa * pair[0] ** 2 + 2 * ab * pair[0] * pair[1] + bb * pair[1] ** 2
                      - 2 * ar * pair[0] - 2 * br * pair[1])
    if min(alpha, beta) <= 1e-6:
        return None
    controls = [start, [start[i] + alpha * incoming[i] for i in (0, 1)],
                [end[i] - beta * outgoing[i] for i in (0, 1)], end]
    command = "C" + " ".join(coordinates(point, 6) for point in controls[1:])
    path = "M" + coordinates(start, 6) + " " + command
    # Check the serialized geometry too, not only the full-precision fit.
    if any(not 0 <= value <= 100 for point in controls for value in point):
        return None
    commands = parse_path(path)
    controls = [commands[0][1]] + [commands[1][1][i:i + 2] for i in range(0, 6, 2)]
    error = 0.0
    for index, point in enumerate(samples):
        t = index / (len(samples) - 1)
        weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3]
        fitted = [sum(weight * control[i] for weight, control in zip(weights, controls)) for i in (0, 1)]
        error = max(error, distance(point, fitted))
    if error > LIMITS["maximum_cubic_error"]:
        return None
    return {"command": command, "ordered_error": error}


def sampled_self_crossing(path):
    samples = sample_path(path, spacing=0.5)
    segments = list(zip(samples, samples[1:]))
    for index, first in enumerate(segments):
        for second in segments[index + 2:]:
            crossing = intersection(first, second)
            if crossing is not None and all(
                min(a[axis], b[axis]) - 1e-8 <= crossing[axis] <= max(a[axis], b[axis]) + 1e-8
                for a, b in (first, second) for axis in (0, 1)
            ):
                return True
    return False


def curved_hook_models(points):
    """A real fold followed by at most two smooth, tangent-connected bends."""
    for split in range(1, len(points) - 2):
        prefix, span = points[:split + 1], points[split:]
        if min(length(prefix), length(span)) < STYLE["width"]:
            continue
        line = straight_fit(prefix, core(prefix))
        if not line:
            continue
        start, line_end = [values for _, values in parse_path(line, bounded=False)]
        interior = core(span)
        incoming, outgoing = direction(interior[0], interior[1]), direction(interior[-2], interior[-1])
        join = intersection([start, line_end], [span[0], [span[0][i] + incoming[i] for i in (0, 1)]])
        if join is None or distance(join, span[0]) > LIMITS["maximum_endpoint_shift"]:
            continue
        if (distance(start, join) < STYLE["width"]
                or sum((join[i] - start[i]) * (line_end[i] - start[i]) for i in (0, 1)) <= 0):
            continue
        axis = direction(start, join)
        angle = math.degrees(math.acos(max(-1, min(1, sum(a * b for a, b in zip(axis, incoming))))))
        if angle < LIMITS["minimum_corner_degrees"]:
            continue
        choices = []
        single = tangent_cubic(span, join, span[-1], incoming, outgoing)
        if single:
            choices.append(([single], []))
        if LIMITS["maximum_cubic_segments"] >= 2:
            for middle in range(2, len(span) - 2):
                left, right = span[:middle + 1], span[middle:]
                if min(length(left), length(right)) < STYLE["width"]:
                    continue
                if distance(span[middle - 1], span[middle + 1]) <= 1e-6:
                    continue
                tangent = direction(span[middle - 1], span[middle + 1])
                # The common tangent must advance through both source limbs.
                if any(sum((b[i] - a[i]) * tangent[i] for i in (0, 1)) <= 0
                       for a, b in ((span[middle - 1], span[middle]), (span[middle], span[middle + 1]))):
                    continue
                turns = [a[0] * b[1] - a[1] * b[0] for a, b in
                         ((incoming, tangent), (tangent, outgoing))]
                if turns[0] * turns[1] <= 0:
                    continue
                first = tangent_cubic(left, join, span[middle], incoming, tangent)
                second = tangent_cubic(right, span[middle], span[-1], tangent, outgoing)
                if first and second:
                    choices.append(([first, second], [split + middle]))
        entry_flick = angle < ENTRY_FLICK_MAXIMUM_DEGREES and distance(start, join) < STYLE["width"] * 3
        for curves, smooth_joins in choices:
            if len(curves) + 1 > LIMITS["maximum_segments"]:
                continue
            if entry_flick:
                # A short shallow entry is a flick, not a fold: start the smooth body at the join.
                bare = "M" + coordinates(join, 6) + " " + " ".join(curve["command"] for curve in curves)
                if not any(not 0 <= value <= 100 for value in join) and not sampled_self_crossing(bare):
                    yield {
                        "path": bare, "entry_flick_removed": True,
                        "source_corner_indices": [], "corner_angles": [],
                        "corner_shifts": [round(distance(join, span[0]), 3)],
                        "smooth_join_indices": smooth_joins, "segments": ["C"] * len(curves),
                        "ordered_curve_error": max(curve["ordered_error"] for curve in curves),
                    }
            path = polyline([start, join]) + " " + " ".join(curve["command"] for curve in curves)
            if any(not 0 <= value <= 100 for value in start) or sampled_self_crossing(path):
                continue
            yield {
                "path": path,
                "source_corner_indices": [split], "corner_angles": [round(angle, 1)],
                "corner_shifts": [round(distance(join, span[0]), 3)],
                "smooth_join_indices": smooth_joins, "segments": ["L"] + ["C"] * len(curves),
                "ordered_curve_error": max(curve["ordered_error"] for curve in curves),
            }


def candidate_metrics(points, path, *, terminal_adjusted=False):
    validate_path(path)
    samples = sample_path(path, spacing=1)
    error = deviation(sample_path(polyline(points), spacing=1), samples)
    shifts = [distance(points[0], samples[0]), distance(points[-1], samples[-1])]
    limit = LIMITS["maximum_terminal_deviation"] if terminal_adjusted else LIMITS["maximum_deviation"]
    if error > limit or max(shifts) > LIMITS["maximum_endpoint_shift"]:
        raise ValueError("deviation or endpoint shift exceeds the pilot limit")
    metrics = {"maximum_deviation": round(error, 3), "endpoint_shifts": [round(value, 3) for value in shifts]}
    if terminal_adjusted:
        central_error = max(min(segment_distance(point, a, b) for a, b in zip(samples, samples[1:]))
                            for point in core(points))
        if central_error > LIMITS["line_core_error"]:
            raise ValueError("central stroke would move beyond the straight-core limit")
        metrics.update({
            "terminal_adjustment": True, "central_deviation": round(central_error, 3),
            "review_notes": ["Terminal-only displacement exceeds the ordinary fit limit; review the start and end."],
        })
    return metrics


def merged_corner_fit(points):
    """Fallback for hooks and falling strokes whose medians round their corners.

    Runs only after every other model has failed, so no accepted fit can change.
    A sub-width segment between two longer limbs is a rounded corner, not a limb:
    it is dropped and its neighbours are intersected. A bend under the minimum
    corner angle is not a corner: its two limbs are refitted as one line. The
    resulting lines must pass the same intersection, direction and angle checks
    and the ordinary deviation and endpoint gates as connected-lines.
    """
    corners = corner_indices(points)
    spans = list(zip(corners, corners[1:]))
    if len(spans) < 3:
        return None

    def span_line(span):
        return line_points(core(points[span[0]:span[1] + 1]), [points[span[0]], points[span[1]]])

    for _ in range(2 * len(spans)):
        lines = [span_line(span) for span in spans]
        shortest = [i for i in range(1, len(spans) - 1)
                    if distance(lines[i][0], lines[i][-1]) < STYLE["width"]]
        if shortest:
            del spans[shortest[0]]
            continue
        merge = None
        for i in range(len(spans) - 1):
            if spans[i][1] != spans[i + 1][0]:
                continue
            a, b = direction(lines[i][0], lines[i][-1]), direction(lines[i + 1][0], lines[i + 1][-1])
            angle = math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))
            if angle < LIMITS["minimum_corner_degrees"]:
                merge = i
                break
        if merge is None:
            break
        spans[merge:merge + 2] = [(spans[merge][0], spans[merge + 1][1])]
    lines = [span_line(span) for span in spans]
    if len(spans) < 2 or len(spans) == len(corner_indices(points)) - 1:
        return None
    # Hooks and falling strokes have at most two turns (entry to body, body to hook);
    # more turns belong to curved or wandering strokes this fallback must not flatten.
    if len(spans) > 3:
        return None
    # A dropped corner may only replace a section shorter than one stroke width;
    # anything longer is a real part of the stroke (a curve), not a rounded corner.
    for (_, end), (start, _) in zip(spans, spans[1:]):
        if end != start and length(points[end:start + 1]) >= STYLE["width"]:
            return None
    # Only straight limbs: a curved stroke must never be silently flattened.
    for (first, last), line in zip(spans, lines):
        if any(segment_distance(p, line[0], line[-1]) > LIMITS["line_core_error"]
               for p in core(points[first:last + 1])):
            return None
    joins = []
    for i, (first, second) in enumerate(zip(lines, lines[1:])):
        join = intersection(first, second)
        # The join may lie anywhere on the median section it replaces (a dropped
        # rounded corner), within the ordinary endpoint-shift bound.
        section = points[spans[i][1]:spans[i + 1][0] + 1]
        pieces = list(zip(section, section[1:])) or [(section[0], section[0])]
        if join is None or min(segment_distance(join, p, q) for p, q in pieces) > LIMITS["maximum_endpoint_shift"]:
            return None
        joins.append(join)
    vertices = [lines[0][0], *joins, lines[-1][-1]]
    segments = list(zip(vertices, vertices[1:]))
    if any(sum((b[i] - a[i]) * (line[-1][i] - line[0][i]) for i in (0, 1)) <= 0
           for (a, b), line in zip(segments, lines)):
        return None
    lengths = [distance(a, b) for a, b in segments]
    if min(lengths[1:]) < STYLE["width"]:
        return None
    vectors = [direction(a, b) for a, b in segments]
    angles = [math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))
              for a, b in zip(vectors, vectors[1:])]
    if min(angles) < LIMITS["minimum_corner_degrees"]:
        return None
    if any(not 0 <= value <= 100 for vertex in vertices for value in vertex) or sampled_self_crossing(polyline(vertices)):
        return None
    return {"path": polyline(vertices), "short_entry": lengths[0] < STYLE["width"],
            "info": {"rule": "merged-corner-lines:1", "merged_spans": [list(s) for s in spans],
                     "corner_angles": [round(value, 1) for value in angles],
                     "review_notes": ["Rounded corner or near-straight bend in the source median merged into clean limbs; "
                                      "ordinary deviation and endpoint gates retained."]}}


def sustained_fold_corners(points, corners):
    """Keep a genuine fold the coarse corner pass merged (rule sustained-fold-retention:1).

    A finer corner pass may add vertices only where the turn is at least FOLD_MINIMUM_DEGREES and
    both neighbouring limbs are at least FOLD_MINIMUM_LIMB_WIDTHS pen widths long, so incidental
    wiggles and short entry crooks are not re-introduced. The caller still applies every gate.
    """
    limit = LIMITS["maximum_segments"] + 1
    for tolerance in FOLD_TOLERANCES:
        original = LIMITS["corner_tolerance"]
        LIMITS["corner_tolerance"] = tolerance
        try:
            finer = corner_indices(points)
        finally:
            LIMITS["corner_tolerance"] = original
        if len(finer) <= len(corners) or len(finer) > limit:
            continue
        vertices = [points[index] for index in finer]
        limbs = [distance(a, b) for a, b in zip(vertices, vertices[1:])]
        if min(limbs) < STYLE["width"] * FOLD_MINIMUM_LIMB_WIDTHS:
            continue
        vectors = [direction(a, b) for a, b in zip(vertices, vertices[1:])]
        turns = [math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))
                 for a, b in zip(vectors, vectors[1:])]
        if min(turns) >= FOLD_MINIMUM_DEGREES:
            return finer
    return corners


def fit_stroke_raw(points: list[list[float]]) -> dict:
    """Fit simple models without character-specific coordinates or stroke labels."""
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError("A stroke needs at least two points")
    if any(not isinstance(point, list) or len(point) != 2
           or any(isinstance(value, bool) or not isinstance(value, (float, int))
                  or not math.isfinite(value) or not 0 <= value <= 100 for value in point)
           for point in points):
        raise ValueError("Fitting points must be finite coordinates in the 100-unit frame")
    if any(a == b for a, b in zip(points, points[1:])):
        raise ValueError("Consecutive duplicate fitting points")
    failures = []

    def candidate(path, model, *, terminal_adjusted=False):
        try:
            metrics = candidate_metrics(points, path, terminal_adjusted=terminal_adjusted)
        except ValueError as error:
            failures.append(f"{model}: {error}")
            return None
        return {"status": "candidate", "model": model, "path": path, **metrics}

    def finish_joined(result):
        rounded = rounded_return_hook(result["path"])
        if rounded is None:
            return result
        fitted = candidate(rounded, "rounded-hook")
        if fitted is None:
            return None
        return {
            **result, **fitted, "unrounded_path": result["path"],
            "corner_treatment": "bounded-quadratic-fillet",
            "review_notes": ["Short returning hook: the centerline turn is rounded; shaft and tip are retained."],
        }

    if distance(points[0], points[-1]) < STYLE["width"] and length(points) > STYLE["width"] * 2:
        return {"status": "unresolved", "path": None, "reasons": ["Loop-like stroke needs a different model"]}
    interior = core(points)
    line = straight_fit(points, interior)
    if line:
        result = candidate(line, "line")
        if result:
            model = sustained_curve(points, interior, line)
            if model:
                curved = candidate(model["path"], "sustained-curve")
                if curved:
                    return {
                        **curved, **model,
                        "review_notes": ["Sustained source curvature retained instead of a line; original endpoints preserved."],
                    }
            return result
    else:
        failures.append("line: the central stroke is not sufficiently straight")

    curve = quadratic_fit(points, interior)
    if curve:
        result = candidate(curve, "quadratic")
        if result:
            return result
    failures.append("quadratic: no bounded, forward-moving single-curve fit")

    corners = corner_indices(points)
    folded = sustained_fold_corners(points, corners)
    fold_retained, corners = folded != corners, folded
    if 2 < len(corners) <= LIMITS["maximum_segments"] + 1:
        lines = [line_points(core(points[a:b + 1]), [points[a], points[b]]) for a, b in zip(corners, corners[1:])]
        joins = [intersection(a, b) for a, b in zip(lines, lines[1:])]
        if all(join is not None and distance(join, points[index]) <= LIMITS["maximum_endpoint_shift"]
               for join, index in zip(joins, corners[1:-1])):
            vertices = [lines[0][0], *joins, lines[-1][-1]]
            segments = list(zip(vertices, vertices[1:]))
            nonzero = all(distance(a, b) >= STYLE["width"] for a, b in segments)
            forward = all(sum((b[i] - a[i]) * (line[1][i] - line[0][i]) for i in (0, 1)) > 0
                          for (a, b), line in zip(segments, lines))
            if nonzero and forward:
                vectors = [direction(a, b) for a, b in segments]
                angles = [math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))
                          for a, b in zip(vectors, vectors[1:])]
                if min(angles) >= (FOLD_MINIMUM_DEGREES if fold_retained else LIMITS["minimum_corner_degrees"]):
                    result = candidate(polyline(vertices), "connected-lines")
                    if result:
                        if fold_retained:
                            result["rule"] = "sustained-fold-retention:1"
                        result["source_corner_indices"] = corners[1:-1]
                        result["corner_angles"] = [round(value, 1) for value in angles]
                        result["corner_shifts"] = [round(distance(join, points[index]), 3)
                                                   for join, index in zip(joins, corners[1:-1])]
                        softened = finish_joined(result)
                        if softened:
                            return softened
    failures.append("connected-lines: no stable sequence of distinct intentional turns")

    # New models run only after the original models fail, preserving accepted fits.
    if line:
        result = candidate(line, "line", terminal_adjusted=True)
        if result:
            return result
    joined = []
    for model in joined_models(points):
        curved = model["segments"].count("Q")
        name = "joined-curves" if curved == 2 else "line-curve" if curved else "connected-lines"
        result = candidate(model["path"], name)
        if result:
            joined.append((curved, result["maximum_deviation"], {**result, **model}))
    if joined:
        softened = finish_joined(min(joined, key=lambda item: item[:2])[2])
        if softened:
            return softened
    failures.append("joined-primitives: no bounded fit with one distinct turn")
    curved = []
    for model in curved_hook_models(points):
        result = candidate(model["path"], "curved-hook")
        if result:
            curved.append({**result, **model})
    if curved:
        result = min(curved, key=lambda item: (len(item["segments"]), item["ordered_curve_error"],
                                               item["maximum_deviation"]))
        result["ordered_curve_error"] = round(result["ordered_curve_error"], 3)
        result["review_notes"] = ["Fitted fold and smooth cubic bends; the final hook follows the source tangent."]
        return result
    failures.append("curved-hook: no bounded tangent-connected fit without loops or inflections")
    # Last resort, so every stroke fitted by an earlier model is unchanged.
    merged = merged_corner_fit(points)
    if merged:
        result = candidate(merged["path"], "connected-lines")
        if result:
            result.update(merged["info"])
            if not merged["short_entry"]:
                return result
            smoothed = smooth_entry_flick(points, result)
            if smoothed is not result:
                return smoothed
            failures.append("merged-corners: short entry segment was not a removable entry flick")
    else:
        failures.append("merged-corners: no clean limbs after merging rounded corners and near-straight bends")
    return {"status": "unresolved", "path": None, "reasons": failures}


def smooth_entry_flick(points, fitted):
    """Remove a short down-right entry before a long down/left body, not folds/hooks."""
    if not fitted.get("path"):
        return fitted
    commands = parse_path(fitted["path"])
    if len(commands) < 3 or commands[1][0] != "L" or commands[2][0] not in ("L", "C"):
        return fitted
    start, fold = commands[0][1], commands[1][1]
    following = commands[2][1]
    tangent = direction(fold, following[:2] if commands[2][0] == "C" else following)
    entry = distance(start, fold)
    body = sample_path(polyline([fold]) + " " + " ".join(
        op + " " + " ".join(f"{value:.6f}" for value in values) for op, values in commands[2:]), spacing=1)
    angle = math.degrees(math.acos(max(-1, min(1, sum(
        a * b for a, b in zip(direction(start, fold), tangent))))))
    if not (0 < entry <= STYLE["width"] * 1.5 and length(body) >= entry * 4
            and fold[0] > start[0] and fold[1] > start[1]
            and tangent[0] <= 0.15 and tangent[1] >= 0.6 and 35 <= angle <= 90):
        return fitted
    # Split the mismatch between original start and backward body projection.
    # This avoids either over-extending the body or dragging it to the flick tip.
    projected = [fold[0] + (points[0][1] - fold[1]) / tangent[1] * tangent[0], points[0][1]]
    replacement = [(a + b) / 2 for a, b in zip(points[0], projected)]
    path = polyline([replacement]) + " " + " ".join(
        op + " " + " ".join(f"{value:.6f}" for value in values) for op, values in commands[2:])
    try:
        metrics = candidate_metrics(points, path)
    except ValueError:
        return fitted
    return {"status": "candidate", "model": "entry-smoothed-line" if commands[2][0] == "L" else "entry-smoothed-curve",
            "path": path, **metrics, "unsmoothed_path": fitted["path"],
            "rule": "short-entry-flick:1",
            "review_notes": ["Short down-right entry flick removed before a long descending body; ordinary gates retained."]}


def signed_turn_degrees(a, b, c):
    first, second = direction(a, b), direction(b, c)
    return math.degrees(math.atan2(first[0] * second[1] - first[1] * second[0],
                                   sum(x * y for x, y in zip(first, second))))


def sustained_bend_fillet(points, fitted, v, turns):
    """Round a sustained same-direction bend built from sharp straight joins (rule sustained-bend-fillet:1).

    A vertical-bend-hook style stroke turns the same way at every vertex for at least
    BEND_MINIMUM_TOTAL_DEGREES in total; it is a smooth curve, not facets. Each vertex gets a
    quadratic fillet of up to BEND_MAXIMUM_RADIUS, shared fairly between adjacent limbs, and the
    ordinary deviation and endpoint gates still apply (a rejected fillet leaves the fit unchanged).
    """
    count = len(v)
    if count < 4 or not turns or any(turn * turns[0] <= 0 for turn in turns):
        return fitted
    if sum(abs(turn) for turn in turns) < BEND_MINIMUM_TOTAL_DEGREES:
        return fitted
    # A sustained curve turns gently everywhere; one sharp source turn is a genuine corner.
    source = [signed_turn_degrees(a, b, c) for a, b, c in zip(points, points[1:], points[2:])]
    if not source or max(abs(turn) for turn in source) > BEND_MAXIMUM_SOURCE_TURN:
        return fitted
    radius = {i: min(BEND_MAXIMUM_RADIUS, 0.45 * distance(v[i - 1], v[i]), 0.45 * distance(v[i], v[i + 1]))
              for i in range(1, count - 1)}
    for i in range(1, count - 2):
        limb = distance(v[i], v[i + 1])
        if radius[i] + radius[i + 1] > 0.9 * limb:
            share = 0.9 * limb / (radius[i] + radius[i + 1])
            radius[i] *= share
            radius[i + 1] *= share
    point = lambda p: coordinates(p, 6)
    pieces = [f"M{point(v[0])}"]
    for i in range(1, count - 1):
        before, after = direction(v[i], v[i - 1]), direction(v[i], v[i + 1])
        pieces.append(f"L{point([v[i][a] + before[a] * radius[i] for a in (0, 1)])} "
                      f"Q{point(v[i])} {point([v[i][a] + after[a] * radius[i] for a in (0, 1)])}")
    pieces.append(f"L{point(v[-1])}")
    path = " ".join(pieces)
    try:
        metrics = candidate_metrics(points, path)
    except ValueError:
        return fitted
    rule = "sustained-bend-fillet:1"
    previous = fitted.get("rule")
    return {**fitted, "status": "candidate", "model": "softened-lines", **metrics, "path": path,
            "unsoftened_path": fitted["path"], "rule": f"{previous}+{rule}" if previous else rule,
            "softening": "sustained-bend-fillet",
            "review_notes": [*fitted.get("review_notes", []),
                             "Sustained same-direction bend rounded with large-radius fillets; ordinary gates retained."]}


def soften_hook_and_bends(points, fitted):
    """Soften angular hooks and bowls built from straight joins (rule hook-and-bend-softening:1).

    Applies only to a fitted all-line polyline, and only to: (1) a short chamfer between a
    long shaft and a final return hook, replaced by one tangent-continuous quadratic bend;
    (2) the final hook corner, rounded by the bounded fillet; (3) runs of two or more shallow
    same-direction bends, replaced by a smooth midpoint-quadratic curve. Joins elsewhere stay
    sharp. The result must pass the ordinary deviation and endpoint gates or the fit is kept.
    """
    if not fitted.get("path"):
        return fitted
    commands = parse_path(fitted["path"])
    if len(commands) < 3 or any(op not in ("M", "L") for op, _ in commands):
        return fitted
    v = [values for _, values in commands]
    count, width = len(v), STYLE["width"]

    def signed_turn(a, b, c):
        first, second = direction(a, b), direction(b, c)
        return math.degrees(math.atan2(first[0] * second[1] - first[1] * second[0],
                                       sum(x * y for x, y in zip(first, second))))

    turns = [signed_turn(v[i - 1], v[i], v[i + 1]) for i in range(1, count - 1)]  # turns[i - 1] at v[i]
    mid = lambda a, b: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    point = lambda p: coordinates(p, 6)
    path = None
    # (1) chamfer before the final hook: shaft, short diagonal, hook.
    if count >= 4:
        shaft, chamfer, hook = (distance(v[-4], v[-3]), distance(v[-3], v[-2]), distance(v[-2], v[-1]))
        t1, t2 = turns[-2], turns[-1]
        if (shaft >= width * 3 and chamfer < width * 2.5 and chamfer < hook and width <= hook <= shaft * HOOK_AFTER_CHAMFER_RATIO
                and t1 * t2 > 0 and sum(a * b for a, b in zip(direction(v[-4], v[-3]), direction(v[-2], v[-1]))) < -0.15):
            join = intersection([v[-4], v[-3]], [v[-2], v[-1]])
            if (join is not None and sum((join[i] - v[-3][i]) * direction(v[-4], v[-3])[i] for i in (0, 1)) >= 0
                    and sum((v[-2][i] - join[i]) * direction(v[-2], v[-1])[i] for i in (0, 1)) >= 0):
                path = polyline(v[:-2]) + f" Q{point(join)} {point(v[-2])} L{point(v[-1])}"
                kind = "chamfer-to-quadratic"
    if path is None:
        soft = [abs(turn) <= 60 for turn in turns]
        in_run = [False] * count
        for i in range(1, count - 2):
            if soft[i - 1] and soft[i] and turns[i - 1] * turns[i] > 0:
                in_run[i] = in_run[i + 1] = True
        hook = False
        if count >= 3 and turns[-1] and sum(a * b for a, b in zip(direction(v[-3], v[-2]), direction(v[-2], v[-1]))) < -0.15:
            shaft, tail = distance(v[-3], v[-2]), distance(v[-2], v[-1])
            hook = (shaft >= width * 3 and width <= tail
                    and (tail <= shaft * LIMITS["maximum_hook_length_ratio"] or in_run[count - 3]))
        if not hook and not any(in_run):
            return sustained_bend_fillet(points, fitted, v, turns)
        pieces = [f"M{point(v[0])}"]
        for i in range(1, count - 1):
            if in_run[i]:
                if not in_run[i - 1]:
                    pieces.append(f"L{point(mid(v[i - 1], v[i]))}")
                pieces.append(f"Q{point(v[i])} {point(mid(v[i], v[i + 1]))}")
            elif hook and i == count - 2:
                radius = min(3, distance(v[i - 1], v[i]) * 0.45, distance(v[i], v[i + 1]) * 0.45)
                before, after = direction(v[i], v[i - 1]), direction(v[i], v[i + 1])
                pieces.append(f"L{point([v[i][a] + before[a] * radius for a in (0, 1)])} "
                              f"Q{point(v[i])} {point([v[i][a] + after[a] * radius for a in (0, 1)])}")
            else:
                pieces.append(f"L{point(v[i])}")
        pieces.append(f"L{point(v[-1])}")
        path = " ".join(pieces)
        kind = "smooth-bowl" if any(in_run) else "rounded-hook"
    try:
        metrics = candidate_metrics(points, path)
    except ValueError:
        return fitted
    rule = "hook-and-bend-softening:1"
    previous = fitted.get("rule")
    return {**fitted, "status": "candidate", "model": "softened-lines", **metrics, "path": path,
            "unsoftened_path": fitted["path"], "rule": f"{previous}+{rule}" if previous else rule,
            "softening": kind,
            "review_notes": [*fitted.get("review_notes", []),
                             "Angular hook or bowl softened with tangent-continuous quadratics; ordinary gates retained."]}


def fit_stroke(points: list[list[float]]) -> dict:
    return soften_hook_and_bends(points, smooth_entry_flick(points, fit_stroke_raw(points)))


def stroke_gap(path, others):
    samples = sample_path(path, spacing=0.5)
    return min(segment_distance(point, a, b)
               for other in others for a, b in zip(other, other[1:]) for point in samples)


def space_isolated_dots(medians, strokes):
    """Compact short down-right curves only when disjoint neighbors crowd the ink."""
    result = list(strokes)
    for index, (points, fitted) in enumerate(zip(medians, strokes)):
        if (fitted.get("model") != "sustained-curve" or length(points) > STYLE["width"] * 2
                or points[-1][0] <= points[0][0] or points[-1][1] <= points[0][1]):
            continue
        others = [sample_path(stroke["path"], spacing=0.5)
                  for i, stroke in enumerate(strokes) if i != index and stroke.get("path")]
        source_others = [sample_path(polyline(p), spacing=0.5) for i, p in enumerate(medians) if i != index]
        if not others:
            continue
        source_gap = stroke_gap(polyline(points), source_others)
        original_gap = stroke_gap(fitted["path"], others)
        target = STYLE["width"] * 1.1
        # Never reinterpret a source intersection or a genuinely attached mark as a dot.
        if source_gap <= STYLE["width"] * 0.5 or original_gap >= target:
            continue
        samples = sample_path(fitted["path"], spacing=0.5)
        center = [sum(p[k] for p in samples) / len(samples) for k in (0, 1)]
        candidates = []
        for fraction in (0.1, 0.2, 0.3, 0.4, 0.5):
            path = " ".join(op + " " + " ".join(
                f"{center[j % 2] + (1 - fraction) * (v - center[j % 2]):.6f}"
                for j, v in enumerate(values)) for op, values in parse_path(fitted["path"]))
            try:
                metrics = candidate_metrics(points, path)
            except ValueError:
                continue
            gap = stroke_gap(path, others)
            if gap > original_gap + 0.1:
                candidates.append((gap, path, fraction, metrics))
                if gap >= target:
                    break
        if not candidates:
            continue
        gap, path, fraction, metrics = max(candidates, key=lambda item: item[0])
        result[index] = {**fitted, **metrics, "path": path, "model": "spaced-dot",
                         "unspaced_path": fitted["path"], "rule": "isolated-dot-clearance:1",
                         "compaction_fraction": fraction,
                         "original_centerline_gap": round(original_gap, 3), "centerline_gap": round(gap, 3),
                         "review_notes": ["Crowded disjoint short down-right dot compacted about its center; no translation or gate relaxation.",
                                          "Dot size and desired clearance remain a supervised style choice."]}
    return result


def compact_stroke(points, fitted):

    """Apply an explicit style choice; do not infer that a stroke is too long."""
    if fitted["status"] != "candidate":
        raise ValueError("Compaction requires a fitted candidate, not an unresolved or retained stroke")
    commands = parse_path(fitted["path"])
    if fitted["model"] == "line" and [op for op, _ in commands] == ["M", "L"]:
        start, end = [values for _, values in commands]
        span = distance(start, end)
        inset = min(COMPACTION["maximum_line_end_inset"], span * COMPACTION["line_end_fraction"])
        axis = direction(start, end)
        vertices = [[value + axis[i] * inset * sign for i, value in enumerate(point)]
                    for point, sign in ((start, 1), (end, -1))]
        path = polyline(vertices)
        compact_start, compact_end = [values for _, values in parse_path(path)]
        if distance(compact_start, compact_end) < STYLE["width"]:
            raise ValueError("Compacted line would be shorter than one pen width")
        details = {"end_inset": round(inset, 3)}
        model = "compact-line"
        note = "Explicit compaction: line shortened equally at both ends; center and direction retained."
    elif fitted["model"] == "rounded-hook":
        unrounded = fitted["unrounded_path"]
        if rounded_return_hook(unrounded) != fitted["path"]:
            raise ValueError("Compaction requires a recognized rounded returning hook")
        start, corner, end = [values for _, values in parse_path(unrounded)]
        tip = [a + (b - a) * COMPACTION["hook_length_ratio"] for a, b in zip(corner, end)]
        compact_unrounded = polyline([start, corner, tip])
        path = rounded_return_hook(compact_unrounded)
        if path is None:
            raise ValueError("Compacted hook no longer meets the returning-hook limits")
        details = {
            "unrounded_path": compact_unrounded,
            "hook_length_before": round(distance(corner, end), 3),
            "hook_length_after": round(distance(corner, parse_path(path)[-1][1]), 3),
        }
        model = "compact-hook"
        note = "Explicit compaction: returning limb shortened by one third; shaft, fold and hook direction retained."
    else:
        raise ValueError("Compaction supports only fitted lines and rounded returning hooks")
    metrics = candidate_metrics(points, path)
    return {
        "status": "candidate", "model": model, "path": path, **metrics,
        "compaction": {"policy": COMPACTION["id"], "uncompacted_fit": fitted, **details},
        "review_notes": [note + " Needs visual review; not an automatic fitting correction."],
    }


def validate_translation(dx, dy):
    if (not all(finite_number(value) for value in (dx, dy))
            or not 0 < math.hypot(dx, dy) <= LIMITS["maximum_endpoint_shift"]):
        raise ValueError("Translation must be a finite, nonzero offset of at most one endpoint-shift limit")


def translate_stroke(points, fitted, dx, dy):
    """Move a reviewed selection without changing its shape or silently refitting."""
    validate_translation(dx, dy)
    if fitted["status"] != "candidate" or "placement" in fitted:
        raise ValueError("Translation requires an unpositioned fitted candidate, not an unresolved or retained stroke")
    path = transform_path(fitted["path"], [1, 0, 0, 1, dx, dy])
    metrics = candidate_metrics(points, path)
    return {
        "status": "candidate", "model": fitted["model"], "path": path, **metrics,
        "placement": {"policy": "explicit-stroke-translation:1", "dx": dx, "dy": dy,
                      "unpositioned_fit": fitted},
        "review_notes": [*fitted.get("review_notes", []),
                         f"Explicit positioning: dx {dx:g}, dy {dy:g}; shape and size retained. Needs visual review."],
    }


def validate_start_trim(amount):
    if not finite_number(amount) or not 0 < amount <= COMPACTION["maximum_line_end_inset"]:
        raise ValueError("Start trim must be a finite positive distance of at most half a pen width")


def trim_line_start(points, fitted, amount):
    """Shorten only the start of a positioned line, retaining its end and angle."""
    validate_start_trim(amount)
    if fitted["status"] != "candidate" or "start_trim" in fitted:
        raise ValueError("Start trim requires an untrimmed fitted candidate")
    commands = parse_path(fitted["path"])
    if [op for op, _ in commands] != ["M", "L"]:
        raise ValueError("Start trim supports only a single fitted line")
    start, end = [values for _, values in commands]
    axis = direction(start, end)
    path = polyline([[value + amount * axis[i] for i, value in enumerate(start)], end])
    shortened = [values for _, values in parse_path(path)]
    if distance(*shortened) < STYLE["width"]:
        raise ValueError("Start-trimmed line would be shorter than one pen width")
    metrics = candidate_metrics(points, path)
    return {
        "status": "candidate", "model": "start-trimmed-line", "path": path, **metrics,
        "start_trim": {"policy": "explicit-line-start-trim:1", "amount": amount, "untrimmed_fit": fitted},
        "review_notes": [*fitted.get("review_notes", []),
                         f"Explicit start trim: {amount:g} units along the line; end and angle retained. Needs visual review."],
    }


def retained_current_stroke(points, path):
    validate_path(path)
    samples = sample_path(path, spacing=1)
    return {
        "status": "retained-current", "model": "current-guide", "path": path,
        "maximum_deviation": round(deviation(sample_path(polyline(points), spacing=1), samples), 3),
        "endpoint_shifts": [round(distance(points[0], samples[0]), 3),
                            round(distance(points[-1], samples[-1]), 3)],
        "review_notes": ["Current guide retained by explicit selection; not a newly fitted replacement."],
    }


def prepare_context(root: Path = ROOT) -> dict:
    """Preview context: pinned source lock/archive and page index only.

    Deliberately does not extract the curriculum inventory or load curriculum
    YAML beyond the lock, manifest and the requested character pages. Full
    inventory validation belongs to characters:check, the importer and the
    all-characters run.
    """
    lock = load_yaml(local(root, LOCK))
    if (not isinstance(lock, dict) or lock.get("schema_version") != 1
            or lock.get("revision") != REVISION or lock.get("upstream_sha256") != SOURCE_SHA256
            or lock.get("upstream_url") != SOURCE_URL
            or lock.get("archive") != ARCHIVE or lock.get("license") != LICENSE
            or lock.get("license_sha256") != LICENSE_SHA256
            or not isinstance(lock.get("members"), dict)):
        raise ValueError("Invalid Chinese writing source lock or changed upstream pin")
    archive_bytes = local(root, ARCHIVE).read_bytes()
    if sha256(archive_bytes) != lock["archive_sha256"]:
        raise ValueError("Selected source archive checksum mismatch")
    if sha256(local(root, LICENSE).read_bytes()) != LICENSE_SHA256:
        raise ValueError("Original ARPHIC license checksum mismatch")
    manifest_bytes = (root / "characters" / "manifest.yaml").read_bytes()
    manifest = load_yaml(root / "characters" / "manifest.yaml")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("chunks"), list):
        raise ValueError("Character manifest has no page index")
    lock_bytes = local(root, LOCK).read_bytes()
    return {
        "root": root.resolve(), "lock": lock, "manifest": manifest,
        "archive": zipfile.ZipFile(io.BytesIO(archive_bytes)), "pages": {},
        "source_inputs": [
            {"path": ARCHIVE, "sha256": lock["archive_sha256"]},
            {"path": LICENSE, "sha256": LICENSE_SHA256},
            {"path": LOCK, "sha256": sha256(lock_bytes)},
            {"path": "characters/manifest.yaml", "sha256": sha256(manifest_bytes)},
        ],
    }


def source_character(context: dict, character: str) -> dict:
    name = f"data/{character}.json"
    expected = context["lock"]["members"].get(name)
    if expected is None:
        raise ValueError(f"Character is not in the pinned Chinese writing source: {character}")
    archive = context["archive"]
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise ValueError(f"Source archive is missing member {name}") from None
    if (info.is_dir() or info.file_size > 1_000_000
            or (info.external_attr >> 16) & 0o170000 not in (0, 0o100000)):
        raise ValueError(f"Selected member is not a bounded regular file: {name}")
    raw = archive.read(info)
    if expected != {"sha256": sha256(raw), "bytes": len(raw)}:
        raise ValueError(f"Selected member checksum mismatch: {name}")
    return json.loads(raw)


def current_character(context: dict, character: str) -> tuple[dict, str, str]:
    page = f"u{ord(character) >> 8:04x}.yaml"
    chunks = [entry for entry in context["manifest"]["chunks"] if entry.get("file") == page]
    if len(chunks) != 1:
        raise ValueError(f"Character manifest has no unique index entry for {page}")
    chunk = chunks[0]
    if page not in context["pages"]:
        path = context["root"] / "characters" / page
        if sha256(path.read_bytes()) != chunk["sha256"]:
            raise ValueError("Current character page does not match its manifest")
        context["pages"][page] = load_yaml(path)
    records = context["pages"][page]
    if character not in records:
        raise ValueError(f"Character {character} is not on its indexed page {page}")
    return records[character], page, chunk["sha256"]


def build_report(character:
 str, root: Path = ROOT, *, retain_current_strokes: list[int] | None = None,
                 compact_strokes: list[int] | None = None,
                 translate_strokes: list[tuple[int, float, float]] | None = None,
                 trim_line_starts: list[tuple[int, float]] | None = None,
                 _context: dict | None = None) -> dict:
    if len(character) != 1 or 0xD800 <= ord(character) <= 0xDFFF:
        raise ValueError("Choose exactly one Unicode character per report")
    retained = [] if retain_current_strokes is None else retain_current_strokes
    compacted = [] if compact_strokes is None else compact_strokes
    translations = [] if translate_strokes is None else translate_strokes
    trims = [] if trim_line_starts is None else trim_line_starts
    if (not isinstance(translations, list)
            or any(not isinstance(row, (list, tuple)) or len(row) != 3 for row in translations)):
        raise ValueError("Translations must be a list of (stroke number, dx, dy) triples")
    if (not isinstance(trims, list)
            or any(not isinstance(row, (list, tuple)) or len(row) != 2 for row in trims)):
        raise ValueError("Start trims must be a list of (stroke number, amount) pairs")
    translated = [row[0] for row in translations]
    trimmed = [row[0] for row in trims]
    for name, indices in (("Retained", retained), ("Compacted", compacted), ("Translated", translated),
                          ("Start-trimmed", trimmed)):
        if (not isinstance(indices, list) or any(type(index) is not int or index < 1 for index in indices)
                or len(set(indices)) != len(indices)):
            raise ValueError(f"{name} stroke numbers must be unique positive integers (one-based)")
    for _, dx, dy in translations:
        validate_translation(dx, dy)
    for _, amount in trims:
        validate_start_trim(amount)
    if set(retained) & (set(compacted) | set(translated) | set(trimmed)):
        raise ValueError("A stroke cannot be both retained exactly and compacted, translated or start-trimmed")
    context = prepare_context(root) if _context is None else _context
    if context["root"] != root.resolve():
        raise ValueError("Fitting context belongs to another curriculum root")
    lock = context["lock"]
    source_record = source_character(context, character)
    record, page, page_sha256 = current_character(context, character)
    selected = next(variant for variant in record["variants"] if variant["id"] == record["default_variant"])
    medians = [normalize_median(points) for points in source_record["medians"]]
    current_paths = [stroke["path"] for stroke in selected["strokes"]]
    if (len(current_paths) != len(medians)
            or any(index > len(medians) for index in retained + compacted + translated + trimmed)):
        raise ValueError("Selected stroke number or current guide stroke count does not match the source")
    strokes = space_isolated_dots(medians, [
        retained_current_stroke(points, current_paths[index]) if index + 1 in retained
        else fit_stroke(points) for index, points in enumerate(medians)])
    for index in compacted:
        try:
            strokes[index - 1] = compact_stroke(medians[index - 1], strokes[index - 1])
        except ValueError as error:
            raise ValueError(f"Stroke {index} compaction failed: {error}") from error
    for index, dx, dy in translations:
        try:
            strokes[index - 1] = translate_stroke(medians[index - 1], strokes[index - 1], dx, dy)
        except ValueError as error:
            raise ValueError(f"Stroke {index} translation failed: {error}") from error
    for index, amount in trims:
        try:
            strokes[index - 1] = trim_line_start(medians[index - 1], strokes[index - 1], amount)
        except ValueError as error:
            raise ValueError(f"Stroke {index} start trim failed: {error}") from error
    return {
        "schema_version": 5, "character": character, "algorithm": VERSION, "limits": LIMITS,
        "compaction_policy": COMPACTION,
        "notice": NOTICE, "reviewed": False, "applied": False,
        "selection": {"policy": "explicit-stroke-selection:4", "retain_current_strokes": sorted(retained),
                      "compact_strokes": sorted(compacted),
                      "translate_strokes": [{"stroke": index, "dx": dx, "dy": dy}
                                            for index, dx, dy in sorted(translations)],
                      "trim_line_starts": [{"stroke": index, "amount": amount} for index, amount in sorted(trims)]},
        "tool_inputs": {
            name: sha256(Path(__file__).with_name(name).read_bytes().replace(b"\r\n", b"\n"))
            for name in ("fit_chinese_strokes.py", "chinese_monoline.py", "character_geometry.py")
        },
        "source": {"revision": lock["revision"], "archive": ARCHIVE, "sha256": lock["archive_sha256"],
                   "member": f"data/{character}.json", "member_sha256": lock["members"][f"data/{character}.json"]["sha256"]},
        "current": {"variant": selected["id"], "reviewed": selected["status"]["reviewed"],
                    "page": page, "page_sha256": page_sha256},
        "source_inputs": context["source_inputs"],
        "medians": medians,
        "source_paths": [source_median_path(points) for points in medians],
        "source_outlines": source_record["strokes"],
        "source_outline_matrix": SOURCE_FRAME_MATRIX,
        "current_paths": current_paths,
        "strokes": strokes,
    }


def render_preview(report: dict, license_text: str) -> str:
    payload = json.dumps(report, ensure_ascii=False).replace("<", "\\u003c")
    return """<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supervised stroke fitting</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0 auto;padding:24px;max-width:1280px;font:16px/1.5 system-ui;background:#101720;color:#e7eef7}
h1{margin:0}h2{font-size:18px;margin:0 0 8px}.muted{color:#aebed1}header p{max-width:85ch}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:22px 0}
button,select{background:#243548;color:inherit;border:1px solid #596e86;border-radius:8px;padding:10px;font:inherit}
button{cursor:pointer}label{display:flex;gap:7px;align-items:center}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
article{min-width:0}article h2{min-height:2.8em;line-height:1.4}.pad{width:100%;background:#151e29;border:1px solid #53657b;border-radius:12px}.grid{fill:none;stroke:#7e92aa;stroke-width:.2;stroke-dasharray:1.5;opacity:.5}
.stroke{fill:none;stroke:#dce8f7;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}.point{fill:#fa927d;stroke:#151e29;stroke-width:.15}
.sample-label{fill:#ffc2b2;font:2px system-ui}.hint{min-height:3em;color:#aebed1;font-size:14px}.warning{color:#ffcb79}
table{width:100%;border-collapse:collapse;margin:22px 0;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #344459}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin:20px 0}#status{min-height:1.5em}
@media(max-width:560px){body{padding:16px}.columns{grid-template-columns:1fr}.pad{max-height:390px}table{font-size:12px}td,th{padding:6px}}
</style>
<header><h1 id="title"></h1><p class="muted">Compare one character before changing any defaults. Candidate strokes are fitted from source medians unless explicitly marked as a retained current guide. Explicit compaction is a separate style choice, identified below, as are stroke positioning and line-start trimming. All panels use the same 100-unit frame, width 5.5 and stroke order.</p>
<p id="selection-note" class="warning"></p>
<p class="warning">Experiment only. Nothing here has been applied or approved. Geometric error is sampled at one-unit spacing, not a handwriting-quality score.</p></header>
<div class="controls"><label>Stroke <select id="stroke"><option value="all">All strokes</option></select></label><button id="next">Next stroke</button><button id="replay">Replay all</button><label><input id="points" type="checkbox">Show source points</label></div>
<p id="status" role="status"></p><div class="columns">
<article><h2>1. Source medians</h2><svg class="pad" id="source" viewBox="0 0 100 100" aria-label="Original source median paths"></svg><p class="hint">Existing interpolation, including terminal wiggles.</p></article>
<article><h2>2. Current guide</h2><svg class="pad" id="current" viewBox="0 0 100 100" aria-label="Current application guide"></svg><p class="hint" id="current-label"></p></article>
<article><h2 id="candidate-label">3. Programmatic candidate</h2><svg class="pad" id="candidate" viewBox="0 0 100 100" aria-label="Unapplied review candidate"></svg><p class="hint">Unresolved strokes are absent, not silently substituted. Explicitly retained current strokes are identified below.</p></article>
</div><table><thead><tr><th>Stroke</th><th>Model</th><th>Max deviation</th><th>Endpoint movement</th><th>Review status</th></tr></thead><tbody id="metrics"></tbody></table>
<details><summary>Algorithm limits and reproducible report</summary><pre id="report"></pre></details>
<details><summary>Artwork modification notice and original license</summary><pre>""" + html.escape(report["notice"] + "\n\n" + license_text) + """</pre></details>
<script>
const report = """ + payload + """;
const ns='http://www.w3.org/2000/svg', select=document.querySelector('#stroke');
let timer=null, active=null;
document.querySelector('#title').textContent=report.character+' — supervised stroke fitting';
document.title=report.character+' — '+report.algorithm;
const retained=report.selection?.retain_current_strokes??[];
const compacted=report.selection?.compact_strokes??[];
const translated=report.selection?.translate_strokes??[];
const trimmed=report.selection?.trim_line_starts??[];
const selectionNotes=[];
if(retained.length){
 selectionNotes.push('Kept from current guide: stroke '+retained.join(', ')+'.');
 document.title+=' — retained stroke '+retained.join(', ');
}
if(compacted.length){
 selectionNotes.push('Explicitly compacted: stroke '+compacted.join(', ')+'.');
 document.title+=' — compacted strokes '+compacted.join(', ');
}
if(translated.length){
 selectionNotes.push('Explicitly positioned: '+translated.map(item=>'stroke '+item.stroke+' (dx '+item.dx+', dy '+item.dy+')').join('; ')+'.');
 document.title+=' — positioned strokes '+translated.map(item=>item.stroke).join(', ');
}
if(trimmed.length){
 selectionNotes.push('Start trimmed: '+trimmed.map(item=>'stroke '+item.stroke+' ('+item.amount+' units)').join('; ')+'.');
 document.title+=' — start-trimmed strokes '+trimmed.map(item=>item.stroke).join(', ');
}
if(selectionNotes.length){
 document.querySelector('#selection-note').textContent=selectionNotes.join(' ')+' Unselected strokes are unchanged. No component resizing.';
 document.querySelector('#candidate-label').textContent='3. Review candidate';
}
document.querySelector('#current-label').textContent=report.current.variant+'; '+(report.current.reviewed?'retains prior review':'unreviewed reference')+'. Not changed by this experiment.';
document.querySelector('#report').textContent=JSON.stringify(report,null,2);
report.strokes.forEach((stroke,index)=>{
  const option=document.createElement('option');option.value=String(index);option.textContent='Stroke '+(index+1);select.append(option);
  const row=document.createElement('tr');
  const notes=stroke.reasons?.join('; ')??stroke.review_notes?.join('; ')??'Needs your review';
  const values=[index+1,stroke.model??'UNRESOLVED',stroke.maximum_deviation===undefined?'—':stroke.maximum_deviation+' units',stroke.endpoint_shifts?.join(' / ')??'—',notes];
  if(stroke.terminal_adjustment)row.className='warning';
  values.forEach(value=>{const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)});document.querySelector('#metrics').append(row);
});
function element(tag,attrs){const node=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));return node}
function draw(){
 const selected=select.value==='all'?null:Number(select.value);
 const sets={source:report.source_paths,current:report.current_paths,candidate:report.strokes.map(stroke=>stroke.path)};
 Object.entries(sets).forEach(([id,paths])=>{
  const svg=document.getElementById(id);svg.replaceChildren(element('path',{d:'M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100',class:'grid'}));
  paths.forEach((path,index)=>{
   if(!path||(active!==null?index>active:selected!==null&&index!==selected))return;
   const node=element('path',{d:path,class:'stroke','data-stroke':index});svg.append(node);
   if(active===index&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const len=node.getTotalLength();node.style.strokeDasharray=String(len);node.animate([{strokeDashoffset:len},{strokeDashoffset:0}],{duration:850,fill:'forwards'});
   }
   if(document.querySelector('#points').checked)report.medians[index].forEach((point,i)=>{
    svg.append(element('circle',{cx:point[0],cy:point[1],r:.65,class:'point'}));
    const label=element('text',{x:point[0]+1,y:point[1]-1,class:'sample-label'});label.textContent=String(i);svg.append(label);
   });
  });
 });
 document.querySelector('#status').textContent=active===null?(selected===null?'All '+report.strokes.length+' logical strokes.':'Stroke '+(selected+1)+' — one continuous pen-down.'):'Replaying stroke '+(active+1)+' of '+report.strokes.length;
}
function stop(){clearTimeout(timer);timer=null;active=null;document.querySelector('#replay').textContent='Replay all'}
select.onchange=()=>{stop();draw()};
document.querySelector('#next').onclick=()=>{stop();select.value=select.value==='all'?'0':Number(select.value)+1<report.strokes.length?String(Number(select.value)+1):'all';draw()};
document.querySelector('#points').onchange=draw;
document.querySelector('#replay').onclick=()=>{
 if(active!==null){stop();draw();return}
 select.value='all';active=0;document.querySelector('#replay').textContent='Stop replay';
 const tick=()=>{draw();timer=setTimeout(()=>{active++;if(active>=report.strokes.length){stop();draw()}else tick()},1050)};tick();
};
addEventListener('keydown',event=>{if(event.key==='Escape'){stop();draw()}});
draw();
</script></html>
"""


def outline_panel(report: dict) -> str:
    """The upstream filled stroke outlines, unmodified, in the candidate's frame."""
    matrix = " ".join(f"{value:.9g}" for value in report["source_outline_matrix"])
    shapes = "".join(f'<path d="{html.escape(path, quote=True)}"/>' for path in report["source_outlines"])
    return ('<figure><svg viewBox="0 0 100 100"><g class="grid"><path d="M0 50H100M50 0V100M0 0L100 100M100 0L0 100"/></g>'
            f'<g class="outline" transform="matrix({matrix})">{shapes}</g></svg>'
            '<figcaption>Original source image (Hanzi Writer filled outlines)</figcaption></figure>')


def render_batch(reports: list[dict], filenames: list[str], license_text: str) -> str:
    tiles = []
    for index, (report, filename) in enumerate(zip(reports, filenames), 1):
        def panel(paths, label):
            return ('<figure><svg viewBox="0 0 100 100"><g class="grid"><path d="M0 50H100M50 0V100M0 0L100 100M100 0L0 100"/></g>'
                    f'<g class="strokes">{"".join(f'<path d="{html.escape(p, quote=True)}"/>' for p in paths if p)}</g></svg>'
                    f'<figcaption>{label}</figcaption></figure>')
        missing = [i + 1 for i, stroke in enumerate(report["strokes"]) if not stroke.get("path")]
        status = f"Unresolved strokes: {missing}" if missing else "All strokes fitted • Needs your review"
        link = html.escape(filename, quote=True)
        tiles.append(f'<article><h2>{index}. {html.escape(report["character"])}</h2>'
                     f'<a class="pair" href="{link}">{outline_panel(report)}'
                     f'{panel([s.get("path") for s in report["strokes"]], "Candidate")}</a><p>{status}</p>'
                     f'<a href="{link}">Individual source / current / candidate preview →</a></article>')
    return """<!doctype html><html lang="en"><meta charset="utf-8">
<title>Supervised Chinese writing batch</title><style>
body{background:#101720;color:#e7eef7;font:16px system-ui;margin:0;padding:20px}
h1{font-size:24px}.sheet{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
article{background:#151e29;border:1px solid #425369;border-radius:10px;padding:12px}
h2{font-size:21px;margin:0 0 8px}svg{width:100%;display:block}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}figcaption{font-size:12px;color:#b8c8dc;text-align:center}
.outline path{fill:#dce8f7;stroke:none}
.grid path{fill:none;stroke:#53657b;stroke-width:.2;stroke-dasharray:1.5}
.strokes path{fill:none;stroke:#dce8f7;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}
p,a{font-size:13px}a{color:#9bcaff}pre{white-space:pre-wrap}
</style><h1>Original source beside current-rule candidate — no character-specific adjustments</h1>
<p>Preview only. Click each character for individual comparisons and stroke controls.
Missing strokes are flagged, never substituted.</p><section class="sheet">""" + "".join(tiles) + (
        '</section><p>' + html.escape(NOTICE) + '</p><details><summary>Original license</summary><pre>'
        + html.escape(license_text) + '</pre></details></html>'
    )


def requested_characters(single: list[str] | None, joined: str | None) -> list[str]:
    characters = list(joined) if joined is not None else (single or [])
    if (not characters or len(characters) > 9 or len(set(characters)) != len(characters)
            or any(len(ch) != 1 or 0xD800 <= ord(ch) <= 0xDFFF for ch in characters)):
        raise ValueError("Choose 1–9 distinct single Unicode characters; scale fitting is not enabled")
    return characters


def main() -> int:

    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--character", action="append", help="One source character; repeat for a supervised batch (maximum 9)")
    group.add_argument("--characters", help="1–9 source characters, e.g. 你好学家国中我小大")

    parser.add_argument("--output", required=True, type=Path, help="Preview .html path; also writes a sibling .json report")
    parser.add_argument("--retain-current-stroke", type=int, action="append",
                        help="Keep this one-based stroke exactly from the pinned current guide; repeat for more strokes")
    parser.add_argument("--compact-stroke", type=int, action="append",
                        help="Explicitly shorten a fitted line or returning hook; one-based, repeatable, preview only")
    parser.add_argument("--translate-stroke", nargs=3, action="append", metavar=("STROKE", "DX", "DY"),
                        help="Explicitly move one fitted stroke after compaction; negative dx is left, negative dy is up")
    parser.add_argument("--trim-line-start", nargs=2, action="append", metavar=("STROKE", "AMOUNT"),
                        help="Shorten only a line's start after positioning, in 100-unit frame units; end stays fixed")
    args = parser.parse_args()
    try:
        output = args.output.resolve()
        repository = Path(__file__).resolve().parents[1]
        if output.suffix.lower() != ".html" or any(output.is_relative_to(repository / name) for name in ("curriculum", "public", "src")):
            raise ValueError("Use a preview .html path outside curriculum, public and src; no application assets will be written")
        characters = requested_characters(args.character, args.characters)
        selections = {}
        if args.retain_current_stroke is not None:
            selections["retain_current_strokes"] = args.retain_current_stroke
        if args.compact_stroke is not None:
            selections["compact_strokes"] = args.compact_stroke
        if args.translate_stroke is not None:
            selections["translate_strokes"] = [(int(index), float(dx), float(dy))
                                               for index, dx, dy in args.translate_stroke]
        if args.trim_line_start is not None:
            selections["trim_line_starts"] = [(int(index), float(amount)) for index, amount in args.trim_line_start]
        if len(characters) > 1 and selections:
            raise ValueError("Batch previews use current rules only; stroke adjustments require a single character")
        # Validate the entire batch before writing any preview.
        if len(characters) == 1:
            reports = [build_report(characters[0], **selections)]
            outputs = [output]
        else:
            context = prepare_context()
            reports = [build_report(ch, _context=context) for ch in characters]
            outputs = [output.with_name(f"{output.stem}-{index:02d}-u{ord(ch):04x}.html")
                       for index, ch in enumerate(characters, 1)]
        license_text = local(ROOT, "licenses/hanzi-writer-ARPHICPL.TXT").read_text(encoding="utf-8")
        pages = [render_preview(report, license_text) for report in reports]
        sheet = render_batch(reports, [path.name for path in outputs], license_text) if len(reports) > 1 else None
        output.parent.mkdir(parents=True, exist_ok=True)
        for path, report, page in zip(outputs, reports, pages):
            path.write_text(page, encoding="utf-8", newline="\n")
            path.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                                encoding="utf-8", newline="\n")
        if sheet is not None:
            output.write_text(sheet, encoding="utf-8", newline="\n")
            output.with_suffix(".json").write_text(json.dumps({
                "characters": characters, "previews": [path.name for path in outputs],
                "applied": False, "reviewed": False,
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(json.dumps({"preview": str(output), "characters": characters,
                          "models": [[stroke.get("model", "unresolved") for stroke in report["strokes"]]
                                     for report in reports], "applied": False}))
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError, zipfile.BadZipFile) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
