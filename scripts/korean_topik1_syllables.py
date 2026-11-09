"""Compose the Hangul syllables of TOPIK 1 vocabulary from the original pilot recipes (offline, no network).

Writes curriculum/korean/characters/topik1-syllables.yaml: ordered stroke paths per syllable, composed by the same
composer as the 54-syllable pilot (korean_character_composition.compose), pinned to the exact recipe bytes.
The syllables are marked "ai-reviewed" (a vision model checked the review sheets and a contact sheet of these syllables), never
human-reviewed (human_reviewed: false). The learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted. See characters/recipes/ai-review.yaml.

  python scripts/korean_topik1_syllables.py [--check]
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from character_assets import sha256
from curriculum_yaml import dump_yaml, load_yaml
from korean_character_composition import JAMO_RECIPE, LAYOUT_RECIPE, RECIPE_VERSION, SOURCE_ID, compose, load_recipes

ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
OUTPUT = "characters/topik1-syllables.yaml"
REVIEW_RECORD = "characters/recipes/ai-review.yaml"
VOCABULARY = "topik-1/vocabulary.yaml"
EXCLUDED = "characters/recipes/ai-review.yaml"


def topik1_syllables(root: Path) -> list[str]:
    entries = load_yaml(root / VOCABULARY)
    return sorted({c for entry in entries for c in entry["target"] if 0xAC00 <= ord(c) <= 0xD7A3})


def build(root: Path = ROOT) -> str:
    jamo, layouts = load_recipes(root)
    record = load_yaml(root / REVIEW_RECORD)
    excluded = set(record.get("excluded_syllables", []))
    syllables = {}
    for character in topik1_syllables(root):
        if character in excluded:
            continue
        parts = compose(jamo, layouts, character)
        syllables[character] = [path for part in parts for path in part["paths"]]
    document = {
        "version": RECIPE_VERSION,
        "source_id": SOURCE_ID,
        "notice": ("Original AI-assisted Korean monoline syllables composed from the pilot recipes, CC0-1.0 to the extent rights apply. "
                   "AI-reviewed only: a vision model checked the letter, composite and layout sheets and a contact sheet of these syllables "
                   "for stroke order and direction. No person has reviewed them (human_reviewed stays false); the learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted."),
        "review": "ai-reviewed",
        "human_reviewed": False,
        "inputs": {name: sha256((root / name).read_bytes()) for name in (JAMO_RECIPE, LAYOUT_RECIPE, REVIEW_RECORD, VOCABULARY)},
        "syllables": syllables,
    }
    return dump_yaml(document)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = build()
    path = ROOT / OUTPUT
    current = path.read_bytes().decode("utf-8") if path.is_file() else None
    if current != text:
        if args.check:
            print("Stale: " + OUTPUT, file=sys.stderr)
            raise SystemExit(1)
        path.write_text(text, encoding="utf-8", newline="\n")
    print(f"TOPIK 1 syllables: {len(load_yaml(path)['syllables'])} AI-reviewed (not human-reviewed)")


if __name__ == "__main__":
    main()
