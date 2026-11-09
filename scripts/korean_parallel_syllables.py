"""Compose the Hangul syllables the parallel Korean lessons write that the TOPIK 1 file does not have (offline, no network).

Reads curriculum/korean/parallel/{entries,zh-lessons}.yaml, writes curriculum/korean/characters/parallel-syllables.yaml:
ordered stroke paths per syllable, composed by the same composer as the pilot and the TOPIK 1 syllables, pinned to the exact recipe bytes.
The syllables are marked "ai-reviewed" (a vision model checked the sheets), never human-reviewed. The learner decided on 2026-11-08 that
AI review is enough for Korean writing, so the handwriting gate is lifted; human_reviewed stays false as a fact.

  python scripts/korean_parallel_syllables.py [--check]
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from character_assets import sha256
from curriculum_yaml import dump_yaml, load_yaml
from korean_character_composition import JAMO_RECIPE, LAYOUT_RECIPE, RECIPE_VERSION, SOURCE_ID, compose, load_recipes

ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
OUTPUT = "characters/parallel-syllables.yaml"
TOPIK1 = "characters/topik1-syllables.yaml"
REVIEW_RECORD = "characters/recipes/ai-review.yaml"
ENTRIES = "parallel/entries.yaml"
LESSONS = "parallel/zh-lessons.yaml"


def hangul(text: object) -> set[str]:
    return {c for c in str(text or "") if 0xAC00 <= ord(c) <= 0xD7A3}


def parallel_syllables(root: Path) -> list[str]:
    """Every syllable the lessons write (kept words, phrases) that the TOPIK 1 file does not already compose."""
    found: set[str] = set()
    entries = root / ENTRIES
    if entries.is_file():
        for entry in load_yaml(entries).get("vocabulary") or []:
            found |= hangul(entry.get("target"))
    lessons = root / LESSONS
    if lessons.is_file():
        for lesson in load_yaml(lessons).get("lessons") or []:
            for word in lesson.get("words") or []:
                if word.get("entry"):
                    found |= hangul(word.get("form"))
            for phrase in lesson.get("phrases") or []:
                found |= hangul(phrase.get("text"))
    have = set((load_yaml(root / TOPIK1).get("syllables") or {}).keys())
    return sorted(found - have)


def build(root: Path = ROOT) -> str:
    jamo, layouts = load_recipes(root)
    record = load_yaml(root / REVIEW_RECORD)
    excluded = set(record.get("excluded_syllables", []))
    syllables = {}
    for character in parallel_syllables(root):
        if character in excluded:
            continue
        parts = compose(jamo, layouts, character)
        syllables[character] = [path for part in parts for path in part["paths"]]
    document = {
        "version": RECIPE_VERSION,
        "source_id": SOURCE_ID,
        "notice": ("Original AI-assisted Korean monoline syllables composed from the pilot recipes, CC0-1.0 to the extent rights apply. "
                   "AI-reviewed only: a vision model checked the letter, composite and layout sheets. No person has reviewed them "
                   "(human_reviewed stays false); the learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted."),
        "review": "ai-reviewed",
        "human_reviewed": False,
        "inputs": {name: sha256((root / name).read_bytes()) for name in (JAMO_RECIPE, LAYOUT_RECIPE, REVIEW_RECORD)},
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
    print(f"Parallel Korean syllables: {len(load_yaml(path)['syllables'])} AI-reviewed (not human-reviewed)")


if __name__ == "__main__":
    main()
