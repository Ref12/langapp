"""Export the original Korean pilot letters and sample syllables as JSON for review sheets (offline, read-only).

Usage: python scripts/korean_review_data.py OUT.json
Every shape comes from the recipes through the same composer the shipped syllables use, so the sheets show the real paths.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from korean_character_composition import compose, load_recipes, letter_paths

ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
# One sample per block layout family, then the finals the layouts do not show by themselves.
LAYOUT_SAMPLES = [
    ("vertical-open", "가"), ("vertical-final", "간"), ("horizontal-open", "고"),
    ("horizontal-final", "곤"), ("mixed-open", "과"), ("mixed-final", "괜"),
    ("vertical + paired final", "값"), ("vertical + doubled final", "깎"),
    ("horizontal + cluster final", "읊"), ("hieuh initial, mixed", "횡"),
]


def export() -> dict:
    jamo, layouts = load_recipes(ROOT)
    masters = []
    for letter, forms in jamo["consonants"].items():
        masters.append({"letter": letter, "kind": "consonant",
                        "forms": [{"name": name, "paths": paths} for name, paths in forms.items()]})
    for letter, paths in jamo["vowels"].items():
        forms = [{"name": "isolated", "paths": paths}]
        forms += [{"name": name, "paths": value} for name, value in jamo["vowel_forms"].get(letter, {}).items()]
        masters.append({"letter": letter, "kind": "vowel", "forms": forms})
    composites = []
    for letter in jamo["double_consonants"]:
        composites.append({"letter": letter, "kind": "double consonant", "forms": [
            {"name": form, "paths": letter_paths(jamo, letter, form)} for form in ("isolated", "side", "wide")]})
    for letter in jamo["compound_vowels"]:
        composites.append({"letter": letter, "kind": "compound vowel", "forms": [
            {"name": "isolated", "paths": letter_paths(jamo, letter)}]})
    for letter in jamo["final_clusters"]:
        composites.append({"letter": letter, "kind": "final cluster", "forms": [
            {"name": form, "paths": letter_paths(jamo, letter, form)} for form in ("isolated", "wide")]})
    samples = [{"layout": label, "letter": character,
                "parts": [{"role": part["role"], "character": part["character"], "paths": part["paths"]}
                          for part in compose(jamo, layouts, character)]}
               for label, character in LAYOUT_SAMPLES]
    return {"frames": jamo["frames"], "masters": masters, "composites": composites, "samples": samples}


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(json.dumps(export(), ensure_ascii=False, indent=1), encoding="utf-8")
