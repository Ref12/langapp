"""Original, unreviewed Hangul pilot composition; no font or diagram tracing."""

from __future__ import annotations

from itertools import combinations
import math
from pathlib import Path

from character_assets import CharacterRecord, sha256
from character_geometry import STYLE, parse_path, sample_path, transform_path
from character_inventory import foundation_characters
from curriculum_yaml import load_yaml


SOURCE_ID = "korean-writing-original-pilot"
JAMO_RECIPE = "characters/recipes/original-jamo.yaml"
LAYOUT_RECIPE = "characters/recipes/original-layouts.yaml"
LEADING = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
MEDIAL = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
TRAILING = ["", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"]


def decompose(character: str) -> tuple[int, int, int]:
    if not isinstance(character, str) or len(character) != 1 or not 0xAC00 <= ord(character) <= 0xD7A3:
        raise ValueError("Expected one modern precomposed Hangul syllable.")
    offset = ord(character) - 0xAC00
    return offset // 588, offset % 588 // 28, offset % 28


def vowel_family(index: int) -> str:
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < 21:
        raise ValueError("Expected a modern medial index.")
    if index in (0, 1, 2, 3, 4, 5, 6, 7, 20):
        return "vertical"
    if index in (8, 12, 13, 17, 18):
        return "horizontal"
    return "mixed"


def placement(paths: list[str], values: list[float]) -> list[str]:
    if (not isinstance(values, list) or len(values) != 3
            or any(type(value) not in (int, float) or not math.isfinite(value) for value in values)
            or values[0] <= 0):
        raise ValueError("Placement requires positive uniform scale and two finite translations.")
    scale, x, y = values
    return [transform_path(path, [scale, 0, 0, scale, x, y]) for path in paths]


def load_recipes(root: Path) -> tuple[dict, dict]:
    jamo, layouts = load_yaml(root / JAMO_RECIPE), load_yaml(root / LAYOUT_RECIPE)
    for recipe in (jamo, layouts):
        if (not isinstance(recipe, dict) or recipe.get("source_id") != SOURCE_ID
                or recipe.get("reviewed") is not False or recipe.get("version") != "1"):
            raise ValueError("Expected versioned original, unreviewed Korean pilot recipes.")
    if set(jamo["consonants"]) != set("ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"):
        raise ValueError("Pilot needs all 14 basic consonant masters.")
    if set(jamo["vowels"]) != set("ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ"):
        raise ValueError("Pilot needs all 10 basic vowel masters.")
    if (set(jamo["double_consonants"]) != set("ㄲㄸㅃㅆㅉ")
            or set(jamo["compound_vowels"]) != set(MEDIAL) - set(jamo["vowels"])
            or set(jamo["final_clusters"]) != set("ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ")):
        raise ValueError("Pilot composite and final-cluster recipes must cover modern foundations.")
    for forms in jamo["consonants"].values():
        if not {"isolated", "side", "wide"} <= set(forms) or set(forms) - set(jamo["frames"]):
            raise ValueError("Every consonant needs explicit isolated, side, and wide forms.")
        for form, paths in forms.items():
            x, y, width, height = jamo["frames"][form]
            for path in paths:
                for _, coordinates in parse_path(path, bounded=False):
                    if any(not x <= coordinates[i] <= x + width
                           or not y <= coordinates[i + 1] <= y + height
                           for i in range(0, len(coordinates), 2)):
                        raise ValueError(f"Original {form} form exceeds its canonical frame.")
    pilot = layouts["pilot_syllables"]
    if not isinstance(pilot, list) or len(pilot) != 54 or len(set(pilot)) != 54:
        raise ValueError("Pilot must remain the explicit 54 distinct syllables; scaling needs approval.")
    for character in pilot:
        decompose(character)
    if layouts["review_gate"]["bulk_generation"] != "prohibited":
        raise ValueError("Pilot must retain its no-bulk-generation gate.")
    return jamo, layouts


def letter_paths(jamo: dict, character: str, form: str = "isolated",
                 stack: tuple[str, ...] = ()) -> list[str]:
    if character in stack:
        raise ValueError(f"Cyclic original letter recipe: {character}")
    if character in jamo["consonants"]:
        return jamo["consonants"][character][form][:]
    if character in jamo["double_consonants"]:
        base = jamo["double_consonants"][character]
        paths = letter_paths(jamo, base, form, (*stack, character))
        return [path for transform in jamo["double_placements"][form]
                for path in placement(paths, transform)]
    if character in jamo["final_clusters"]:
        return [
            path
            for base, transform in zip(jamo["final_clusters"][character],
                                       jamo["cluster_placements"][form], strict=True)
            for path in placement(letter_paths(jamo, base, form, (*stack, character)), transform)
        ]
    if form != "isolated":
        raise ValueError(f"No consonant contextual form for {character!r}.")
    if character in jamo["vowels"]:
        return jamo["vowels"][character][:]
    if character in jamo["compound_vowels"]:
        return [
            path for part in jamo["compound_vowels"][character]
            for path in placement(letter_paths(jamo, part["character"], stack=(*stack, character)),
                                  part["placement"])
        ]
    raise ValueError(f"No original pilot letter template for {character!r}.")


def compose(jamo: dict, layouts: dict, character: str) -> list[dict]:
    leading, medial, trailing = decompose(character)
    family = vowel_family(medial)
    if family == "mixed" and TRAILING[trailing] in jamo["final_clusters"]:
        raise ValueError("Mixed-vowel/final-cluster layout is outside the pilot authoring families.")
    layout = layouts["layouts"][family + ("-final" if trailing else "-open")]
    initial_form = layout.get("initial_form_overrides", {}).get(LEADING[leading], layout["initial_form"])
    parts = [
        {"character": chr(0x1100 + leading), "role": "initial", "paths": placement(
            letter_paths(jamo, LEADING[leading], initial_form), layout["initial"])},
        {"character": chr(0x1161 + medial), "role": "medial", "paths": placement(
            letter_paths(jamo, MEDIAL[medial]), layout["medial"])},
    ]
    if trailing:
        final = TRAILING[trailing]
        bases = jamo["final_clusters"].get(final)
        if final in jamo["double_consonants"]:
            bases = [jamo["double_consonants"][final]] * 2
        if bases:
            paths = []
            for base, transform in zip(bases, layouts["paired_final"], strict=True):
                override = layouts["paired_final_overrides"].get(base, {})
                transform = [*transform[:2], override.get("translate_y", transform[2])]
                paths.extend(placement(letter_paths(jamo, base, override.get("form", "wide")), transform))
        else:
            paths = placement(letter_paths(jamo, final, "wide"), layouts["single_final"])
        parts.append({"character": chr(0x11A7 + trailing), "role": "final", "paths": paths})
    return parts


def compatibility(character: str) -> str:
    codepoint = ord(character)
    if 0x1100 <= codepoint <= 0x1112:
        return LEADING[codepoint - 0x1100]
    if 0x1161 <= codepoint <= 0x1175:
        return MEDIAL[codepoint - 0x1161]
    if 0x11A8 <= codepoint <= 0x11C2:
        return TRAILING[codepoint - 0x11A7]
    if 0x3131 <= codepoint <= 0x3163:
        return character
    raise ValueError("Expected a modern positional or compatibility jamo.")


def context_cells(character: str) -> set[str]:
    leading, medial, trailing = decompose(character)
    family = vowel_family(medial)
    cells = {
        f"initial:U+{0x1100 + leading:04X}:{family}:{bool(trailing)}",
        f"medial:U+{0x1161 + medial:04X}:{bool(trailing)}",
    }
    if trailing:
        cells.add(f"final:U+{0x11A7 + trailing:04X}:{family}")
    return cells


def geometry_flags(parts: list[dict]) -> list[dict]:
    """Conservative review hints, not a recognition score or linguistic approval."""
    flags = []
    width = STYLE["width"]
    sampled = [[sample_path(path) for path in part["paths"]] for part in parts]
    for index, strokes in enumerate(sampled):
        for stroke_index, points in enumerate(strokes):
            if any(min(point) < width / 2 or max(point) > 100 - width / 2 for point in points):
                flags.append({"kind": "cap-envelope", "part": index, "stroke": stroke_index})
            if points[0] == points[-1]:
                spans = [max(p[axis] for p in points) - min(p[axis] for p in points)
                         for axis in (0, 1)]
                if min(spans) - width < width:
                    flags.append({"kind": "small-loop-interior", "part": index,
                                  "stroke": stroke_index, "clearance": round(min(spans) - width, 3)})
        for first, second in combinations(range(len(strokes)), 2):
            a, b = strokes[first], strokes[second]
            for axis in (0, 1):
                if all(max(p[axis] for p in points) - min(p[axis] for p in points) < 0.001
                       for points in (a, b)):
                    overlap = min(max(p[1 - axis] for p in points) for points in (a, b)) - max(
                        min(p[1 - axis] for p in points) for points in (a, b))
                    separation = abs(a[0][axis] - b[0][axis])
                    if overlap > width and 0.001 < separation < width + 2:
                        flags.append({"kind": "near-parallel-strokes", "part": index,
                                      "strokes": [first, second], "clearance": round(separation - width, 3)})
    for first, second in combinations(range(len(parts)), 2):
        distance = min(math.dist(a, b) for sa in sampled[first] for sb in sampled[second]
                       for a in sa for b in sb)
        if distance < width + 1.5:
            flags.append({"kind": "component-proximity", "parts": [first, second],
                          "sampled_centerline_distance": round(distance, 3),
                          "note": "Conservative sampled hint; inspect exact paths and intended contacts."})
    return flags


def pilot_records(root: Path, inventory: dict) -> tuple[dict[str, CharacterRecord], dict]:
    jamo, layouts = load_recipes(root)
    hashes = {name: sha256((root / name).read_bytes()) for name in (JAMO_RECIPE, LAYOUT_RECIPE)}
    foundations = foundation_characters("korean")
    syllables = layouts["pilot_syllables"]
    if not set(syllables) <= set(inventory["required"]):
        raise ValueError("Pilot contains a syllable absent from the authoritative curriculum.")
    records = {}
    details = {}
    for character in sorted(set(foundations) | set(syllables) | set(jamo["signs"])):
        aliases = []
        if character in foundations:
            base = compatibility(character)
            paths = placement(letter_paths(jamo, base), layouts["standalone"]["isolated"])
            parts = [{"character": character, "role": "standalone", "paths": paths}]
            if base != character:
                aliases.append({"text": base, "kind": "compatibility",
                                "policy": "Identity relationship only; retain this scalar's positional role. No normalization or redirect.",
                                "source_id": SOURCE_ID})
        elif character in jamo["signs"]:
            parts = [{"character": character, "role": "sign", "paths": jamo["signs"][character]}]
        else:
            parts = compose(jamo, layouts, character)
            aliases.append({"text": "".join(part["character"] for part in parts),
                            "kind": "canonical-decomposition",
                            "policy": "Orthographic conjoining sequence only; not pronunciation or a key redirect.",
                            "source_id": SOURCE_ID})
        variant = {
            "id": "original-monoline-pilot",
            "locale": "ko-KR",
            "strokes": [{"path": path} for part in parts for path in part["paths"]],
            "provenance": [
                {"source_id": SOURCE_ID, "source_entry": name,
                 "input": name, "sha256": digest} for name, digest in hashes.items()
            ],
            "transform": {"id": "original-contextual-composer", "version": "1",
                          "source_frame": [0, 0, 100, 100], "matrix": [1, 0, 0, 1, 0, 0]},
            "recipe": {"id": "original-korean-pilot", "version": "1",
                       "input": LAYOUT_RECIPE, "sha256": hashes[LAYOUT_RECIPE]},
            "status": {"generated": True, "validated": True, "reviewed": False},
        }
        if character in syllables:
            variant["components"] = [
                {"character": part["character"], "role": part["role"], "source_id": SOURCE_ID}
                for part in parts
            ]
        record = {
            "script": "Common" if character in jamo["signs"] else "Hangul",
            "kind": foundations.get(character, "sign" if character in jamo["signs"] else "character"),
            "default_variant": variant["id"],
            "variants": [variant],
        }
        if aliases:
            record["aliases"] = aliases
        records[character] = record
        details[character] = {"parts": parts, "flags": geometry_flags(parts),
                              "reviewed": False, "stroke_count": len(variant["strokes"])}
    all_syllables = [c for c in inventory["required"] if 0xAC00 <= ord(c) <= 0xD7A3]
    contexts = set().union(*(context_cells(c) for c in all_syllables))
    covered = set().union(*(context_cells(c) for c in syllables))
    report = {
        "version": "1", "authorship": "original-ai-assisted", "reviewed": False,
        "bulk_generation": "prohibited-pending-review",
        "foundation_keys": sorted(foundations), "pilot_syllables": syllables,
        "literal_signs": sorted(jamo["signs"]), "drawable_count": len(records),
        "contextual_assignments": {
            "total": len(contexts), "exercised": len(covered),
            "unexercised": sorted(contexts - covered), "qualified_reviewed": 0,
        },
        "characters": details,
    }
    return records, report
