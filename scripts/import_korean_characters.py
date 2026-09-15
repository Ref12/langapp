"""Build the bounded original, unreviewed Korean writing pilot offline."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from character_assets import InputPin, build_outputs, sha256, write_outputs
from character_inventory import extract_inventory
from curriculum_yaml import dump_yaml, load_yaml
from korean_character_composition import JAMO_RECIPE, LAYOUT_RECIPE, SOURCE_ID, pilot_records
from korean_character_preview import render_preview


ROOT = Path(__file__).resolve().parents[1] / "curriculum"
ADAPTER_VERSION = "1"
ASSESSMENT = "upstream/writing/source-assessment.yaml"
NOTICE = "licenses/WRITING-NOTICE.md"
ORIGINAL_NOTICE = "licenses/ORIGINAL-WRITING-PILOT.md"
SOURCE_VERSION = "935483f7e93d24aa2ec990bca1b43664307768d2"
REFERENCE_INPUTS = {
    "upstream/writing/hangeul-stroke-order-README.md":
        "fd088366e6603c5244796f9b3f94f0f330ae24b4740553de1f0bf4b12c846935",
    "licenses/hangeul-stroke-order-CC-BY-SA-4.0.txt":
        "b33c50a56ba8eee79789357bfe45d6e8067171830fb718e4c68988b3eeeea90a",
}
GAP_REASON = (
    "Outside the explicitly approved 54-syllable original pilot. No assessed upstream "
    "supplies licensed ordered Hangul centerlines and contextual recipes; original "
    "template/context review gates further authoring and scaling."
)
GENERATED_NOTICE = (
    "Original AI-assisted Korean monoline pilot, 2026-09-15; CC0-1.0 to the extent rights apply.\n"
    "Unreviewed: no qualified Korean handwriting approval. No font/diagram tracing or source-derived paths.\n"
    "See licenses/ORIGINAL-WRITING-PILOT.md. No warranty; bulk scaling remains gated on review."
)


def input_pins(language_root: Path) -> list[InputPin]:
    assessment = load_yaml(language_root / ASSESSMENT)
    if (not isinstance(assessment, dict)
            or assessment.get("assessment_kind") != "original-source-feasibility-audit"
            or not isinstance(assessment.get("assessment_version"), str)
            or not assessment["assessment_version"].strip()):
        raise ValueError("Expected an explicit versioned source-feasibility assessment.")
    pins: list[InputPin] = [
        {"path": name, "sha256": digest, "source_id": "hangeul-stroke-order-reference",
         "source_version": SOURCE_VERSION}
        for name, digest in REFERENCE_INPUTS.items()
    ]
    pins.extend({
        "path": name, "sha256": sha256((language_root / name).read_bytes()),
        "source_id": "korean-writing-source-audit",
        "source_version": assessment["assessment_version"],
    } for name in (ASSESSMENT, NOTICE))
    pins.extend({
        "path": name, "sha256": sha256((language_root / name).read_bytes()),
        "source_id": SOURCE_ID, "source_version": "1",
    } for name in (JAMO_RECIPE, LAYOUT_RECIPE, ORIGINAL_NOTICE))
    return pins


def generate(curriculum_root: Path = ROOT, *, check: bool = False) -> list[str]:
    language_root = curriculum_root / "korean"
    inventory = extract_inventory(curriculum_root, "korean")
    pins = input_pins(language_root)
    records, report = pilot_records(language_root, inventory)
    expected = set(inventory["required"]) | set(inventory["components"])
    outputs = build_outputs(
        language_root, records, inventory, pins,
        adapter="original-korean-pilot", adapter_version=ADAPTER_VERSION,
        blocked={character: GAP_REASON for character in sorted(expected - records.keys())},
        notice=GENERATED_NOTICE,
    )
    report["manifest_sha256"] = sha256(outputs["manifest.yaml"].encode("utf-8"))
    report["adapter_inputs"] = {
        name: sha256((Path(__file__).parent / name).read_bytes().replace(b"\r\n", b"\n"))
        for name in ("import_korean_characters.py", "korean_character_composition.py",
                     "korean_character_preview.py")
    }
    supplemental = {
        "pilot-review.yaml": dump_yaml(report),
        "pilot-preview.html": render_preview(inventory, records, report, report["manifest_sha256"]),
    }
    stale = write_outputs(language_root, outputs, check=check)
    for name, text in supplemental.items():
        path = language_root / "characters" / name
        if not path.is_file() or path.read_bytes() != text.encode("utf-8"):
            stale.append(name)
            if not check:
                path.write_text(text, encoding="utf-8", newline="\n")
    return sorted(stale)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Report stale outputs without writing.")
    args = parser.parse_args()
    stale = generate(check=args.check)
    if args.check and stale:
        print("Stale Korean writing outputs: " + ", ".join(stale), file=sys.stderr)
        raise SystemExit(1)
    print("Korean original pilot is current: 54 syllables, 118 foundation keys, 2 signs; all unreviewed.")


if __name__ == "__main__":
    main()
