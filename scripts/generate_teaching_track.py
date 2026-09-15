"""Generate a teaching track's ordered compact views without changing reference levels."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

import yaml

from curriculum_yaml import dump_pairs, load_yaml
from generate_curriculum_tokens import grammar_pairs, records, text, unique_pairs, vocabulary_pairs


DEFAULT_DIRECTORY = (
    Path(__file__).resolve().parents[1] / "curriculum" / "chinese" / "teaching" / "beginner"
)
TRACK_FIELDS = {"schema_version", "id", "title", "language", "level_basis", "review_policy", "units"}
UNIT_FIELDS = {
    "id", "title", "outcome", "vocabulary", "grammar", "review_vocabulary", "review_grammar",
}


def reference_index(vocabulary: dict[str, list[dict]], grammar: dict[str, list[dict]],
                    additional: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    parents, annotated = {}, []
    for level, rows in vocabulary.items():
        for row in records(rows, f"{level}.vocabulary"):
            identifier = text(row.get("id"), f"{level}.vocabulary.id")
            if identifier in parents:
                raise ValueError(f"Duplicate reference headword ID: {identifier}")
            parents[identifier] = row
            if "senses" in row:
                annotated.append(row)
    additional_rows = [] if additional == [] else records(additional, "additional references")
    for row in additional_rows:
        identifier = text(row.get("id"), "additional reference.id")
        if identifier not in parents:
            raise ValueError(f"Unknown additional reference headword: {identifier}")
        parent = parents[identifier]
        if "senses" in parent:
            raise ValueError(f"{identifier}: use the existing reference sense inventory")
        if {key: value for key, value in row.items() if key != "senses"} != parent:
            raise ValueError(f"{identifier}: additional reference metadata differs from its HSK source")
        annotated.append(row)
    words = vocabulary_pairs(annotated)
    grammar_ids, annotated_grammar = set(), []
    for level, rows in grammar.items():
        for row in records(rows, f"{level}.grammar"):
            identifier = text(row.get("id"), f"{level}.grammar.id")
            if identifier in grammar_ids:
                raise ValueError(f"Duplicate reference grammar ID: {identifier}")
            grammar_ids.add(identifier)
            if "token_form" in row or "disambiguator" in row:
                annotated_grammar.append(row)
    patterns = grammar_pairs(annotated_grammar)
    unique_pairs(words + patterns)
    return dict(words), dict(patterns)


def load_reference_index(language_root: Path) -> tuple[dict[str, str], dict[str, str]]:
    vocabulary, grammar = {}, {}
    for directory in sorted(language_root.glob("hsk-*")):
        if directory.is_dir():
            vocabulary[directory.name] = load_yaml(directory / "vocabulary.yaml")
            grammar[directory.name] = load_yaml(directory / "grammar.yaml")
    if not vocabulary:
        raise ValueError(f"No HSK reference directories found in {language_root}")
    return reference_index(
        vocabulary, grammar, load_yaml(language_root / "reference-senses.yaml"),
    )


def english(value, location: str) -> str:
    value = text(value, location)
    if not re.search(r"[A-Za-z]", value):
        raise ValueError(f"{location}: expected English text")
    return value


def identifiers(value, location: str, available: dict[str, str]) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{location}: expected a list of IDs")
    seen = set()
    for identifier in value:
        text(identifier, location)
        if identifier not in available:
            raise ValueError(f"{location}: unknown ID {identifier!r}")
        if identifier in seen:
            raise ValueError(f"{location}: duplicate ID {identifier!r}")
        seen.add(identifier)
    return value


def sequence_pairs(sequence: dict, vocabulary: dict[str, str], grammar: dict[str, str]
                   ) -> tuple[list[list[str]], list[list[str]]]:
    if not isinstance(sequence, dict) or set(sequence) != TRACK_FIELDS:
        raise ValueError(f"Teaching track fields must be {', '.join(sorted(TRACK_FIELDS))}")
    if type(sequence["schema_version"]) is not int or sequence["schema_version"] != 1:
        raise ValueError("Teaching track schema_version must be 1")
    if sequence["language"] != "chinese":
        raise ValueError("This teaching-track generator expects language: chinese")
    identifier = text(sequence["id"], "track.id")
    if not re.fullmatch(r"zh-[a-z0-9]+(?:-[a-z0-9]+)*", identifier):
        raise ValueError("Track ID must be a zh-prefixed kebab-case identifier")
    for field in ("title", "level_basis", "review_policy"):
        english(sequence[field], f"track.{field}")
    seen_units = set()
    introduced = {"vocabulary": set(), "grammar": set()}
    pairs = {"vocabulary": [], "grammar": []}
    for unit in records(sequence["units"], "track.units"):
        if set(unit) != UNIT_FIELDS:
            raise ValueError(f"Unit fields must be {', '.join(sorted(UNIT_FIELDS))}")
        unit_id = text(unit["id"], "unit.id")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", unit_id) or unit_id in seen_units:
            raise ValueError(f"Invalid or duplicate unit ID: {unit_id}")
        seen_units.add(unit_id)
        for field in ("title", "outcome"):
            english(unit[field], f"{unit_id}.{field}")
        item_count = 0
        for kind, available in (("vocabulary", vocabulary), ("grammar", grammar)):
            new_ids = identifiers(unit[kind], f"{unit_id}.{kind}", available)
            review_ids = identifiers(unit[f"review_{kind}"], f"{unit_id}.review_{kind}", available)
            repeated = introduced[kind].intersection(new_ids)
            if repeated:
                raise ValueError(f"{unit_id}: already introduced {kind} IDs: {sorted(repeated)}")
            untaught = set(review_ids) - introduced[kind]
            if untaught:
                raise ValueError(f"{unit_id}: review requires earlier introductions: {sorted(untaught)}")
            introduced[kind].update(new_ids)
            pairs[kind].extend([item_id, available[item_id]] for item_id in new_ids)
            item_count += len(new_ids) + len(review_ids)
        if not item_count:
            raise ValueError(f"{unit_id}: must introduce or review at least one item")
    unique_pairs(pairs["vocabulary"] + pairs["grammar"])
    return pairs["vocabulary"], pairs["grammar"]


def teaching_outputs(directory: Path, sequence: dict, vocabulary: dict[str, str],
                     grammar: dict[str, str]) -> dict[Path, str]:
    words, patterns = sequence_pairs(sequence, vocabulary, grammar)
    return {
        directory / "vocabulary.min.yaml": dump_pairs(words),
        directory / "grammar.min.yaml": dump_pairs(patterns),
    }


def generate(directory: Path, check: bool = False) -> None:
    words, grammar = load_reference_index(directory.parent.parent)
    outputs = teaching_outputs(directory, load_yaml(directory / "sequence.yaml"), words, grammar)
    for path, expected in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                raise ValueError(f"Missing or stale teaching view: {path}")
        else:
            path.write_text(expected, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--check", action="store_true",
                        help="Check generated views without writing files")
    args = parser.parse_args()
    try:
        generate(args.directory, args.check)
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} teaching views in {args.directory}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
