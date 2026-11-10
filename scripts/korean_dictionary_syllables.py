"""Compose the Hangul syllables of the Korean dictionary headwords that no other file composes (offline, no network).

Reads src/data/dictionary/ko.json (headwords) and src/data/packs/ko/*.json (lesson words, sentences, word forms), writes curriculum/korean/characters/dictionary-syllables.yaml: ordered stroke paths per
syllable, composed by the same composer as the pilot, the TOPIK 1 and the parallel syllables, pinned to the exact recipe bytes. A syllable the
composer cannot make (or the AI review rejected) is written to curriculum/korean/characters/dictionary-accepted.yaml with a reason instead.
The syllables are marked "ai-reviewed" (a vision model checked contact sheets in batches, see characters/recipes/ai-review-dictionary.yaml),
never human-reviewed. The learner decided on 2026-11-08 that AI review is enough for Korean writing.

  python scripts/korean_dictionary_syllables.py [--check]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from character_assets import sha256
from curriculum_yaml import dump_yaml, load_yaml
from korean_character_composition import JAMO_RECIPE, LAYOUT_RECIPE, RECIPE_VERSION, SOURCE_ID, compose, load_recipes

ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
DICTIONARY = Path(__file__).resolve().parents[1] / "src" / "data" / "dictionary" / "ko.json"
OUTPUT = "characters/dictionary-syllables.yaml"
ACCEPTED = "characters/dictionary-accepted.yaml"
REVIEW_RECORD = "characters/recipes/ai-review-dictionary.yaml"
EARLIER = ("characters/topik1-syllables.yaml", "characters/parallel-syllables.yaml")


def hangul(text: object) -> set[str]:
    return {c for c in str(text or "") if 0xAC00 <= ord(c) <= 0xD7A3}


PACKS = Path(__file__).resolve().parents[1] / "src" / "data" / "packs" / "ko"


def strings(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)


def headword_syllables(dictionary: Path = DICTIONARY, packs: Path = PACKS) -> set[str]:
    """The syllables of the dictionary headwords and of every string of the Korean lesson pack (words, sentences, word forms)."""
    words = json.loads(dictionary.read_text(encoding="utf-8"))["words"]
    found: set[str] = set()
    for word in words:
        found |= hangul(word[1])
    for path in sorted(packs.glob("*.json")) if packs.is_dir() else []:
        for text in strings(json.loads(path.read_text(encoding="utf-8"))):
            found |= hangul(text)
    return found


def missing_syllables(root: Path, dictionary: Path = DICTIONARY) -> list[str]:
    have: set[str] = set()
    for page in sorted((root / "characters").glob("u[0-9a-f][0-9a-f][0-9a-f][0-9a-f].yaml")):  # the 54-syllable pilot
        have |= hangul("".join((load_yaml(page) or {}).keys()))
    for name in EARLIER:
        path = root / name
        if path.is_file():
            have |= set((load_yaml(path).get("syllables") or {}).keys())
    return sorted(headword_syllables(dictionary) - have)


def build(root: Path = ROOT, dictionary: Path = DICTIONARY) -> tuple[str, str]:
    jamo, layouts = load_recipes(root)
    record = load_yaml(root / REVIEW_RECORD)
    rejected = dict(record.get("rejected_syllables") or {})
    syllables: dict[str, list[str]] = {}
    accepted: dict[str, str] = {}
    for character in missing_syllables(root, dictionary):
        if character in rejected:
            accepted[character] = str(rejected[character])
            continue
        try:
            parts = compose(jamo, layouts, character)
        except ValueError as error:
            accepted[character] = f"The composer cannot make it: {error}"
            continue
        syllables[character] = [path for part in parts for path in part["paths"]]
    document = {
        "version": RECIPE_VERSION,
        "source_id": SOURCE_ID,
        "notice": ("Original AI-assisted Korean monoline syllables composed from the pilot recipes, CC0-1.0 to the extent rights apply. "
                   "AI-reviewed only: a vision model checked contact sheets of these syllables in batches for stroke order and direction. "
                   "No person has reviewed them (human_reviewed stays false); the learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted."),
        "review": "ai-reviewed",
        "human_reviewed": False,
        "inputs": {name: sha256((root / name).read_bytes()) for name in (JAMO_RECIPE, LAYOUT_RECIPE, REVIEW_RECORD)},
        "syllables": syllables,
    }
    gaps = {
        "version": "1",
        "statement": ("Dictionary headword syllables that have no guide, each with the reason. The generator's coverage check accepts "
                      "exactly these; a syllable that gets a guide must leave this list."),
        "gaps": accepted,
    }
    return dump_yaml(document), dump_yaml(gaps)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = dict(zip((OUTPUT, ACCEPTED), build()))
    for name, text in outputs.items():
        path = ROOT / name
        current = path.read_bytes().decode("utf-8") if path.is_file() else None
        if current != text:
            if args.check:
                print("Stale: " + name, file=sys.stderr)
                raise SystemExit(1)
            path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Dictionary Korean syllables: {len(load_yaml(ROOT / OUTPUT)['syllables'])} AI-reviewed, {len(load_yaml(ROOT / ACCEPTED)['gaps'])} accepted gaps")


if __name__ == "__main__":
    main()
