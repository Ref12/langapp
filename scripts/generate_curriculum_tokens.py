"""Derive compact [id, token] YAML lists from an expanded curriculum level.

Defaults to the Chinese HSK-1 pilot. No dictionary download or AI call is needed.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

import yaml

from curriculum_yaml import dump_pairs, load_yaml


PILOT_LEVEL = ("chinese", "hsk-1")
MAX_DISAMBIGUATOR_LENGTH = 64
DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / "curriculum" / Path(*PILOT_LEVEL)


def text(value, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{location}: expected a nonempty string")
    if (value != value.strip() or len(value.splitlines()) != 1
            or any(ord(character) < 32 for character in value)):
        raise ValueError(f"{location}: expected trimmed, single-line text")
    if "\ufffd" in value:
        raise ValueError(f"{location}: contains a Unicode replacement character")
    return value


def label(value, location: str) -> str:
    value = text(value, f"{location}.disambiguator")
    if not re.search(r"[A-Za-z]", value):
        raise ValueError(f"{location}.disambiguator: must include English")
    if len(value) > MAX_DISAMBIGUATOR_LENGTH:
        raise ValueError(
            f"{location}.disambiguator: exceeds {MAX_DISAMBIGUATOR_LENGTH} characters"
        )
    return value


def token(form, disambiguator, location: str) -> str:
    form = text(form, f"{location}.form")
    disambiguator = label(disambiguator, location)
    if "/" in form or "/" in disambiguator:
        raise ValueError(f"{location}: '/' is reserved for the token separator")
    return f"{form}/{disambiguator}"


def records(value, location: str) -> list[dict]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{location}: expected a nonempty list")
    if not all(isinstance(row, dict) for row in value):
        raise ValueError(f"{location}: every entry must be a mapping")
    return value


def unique_pairs(pairs: list[list[str]]) -> list[list[str]]:
    ids, tokens = set(), set()
    for identifier, value in pairs:
        text(identifier, "id")
        if identifier in ids:
            raise ValueError(f"Duplicate compact ID: {identifier}")
        if value in tokens:
            raise ValueError(f"Ambiguous duplicate token: {value}")
        ids.add(identifier)
        tokens.add(value)
    return pairs


def unique_entries(entries: list[dict[str, str]]) -> list[dict[str, str]]:
    ids, meanings = set(), set()
    for entry in entries:
        identifier = text(entry.get("id"), "id")
        meaning = (entry["ch"], entry.get("pr"), entry["ds"])
        if identifier in ids:
            raise ValueError(f"Duplicate compact ID: {identifier}")
        if meaning in meanings:
            raise ValueError(f"Ambiguous duplicate entry: {meaning}")
        ids.add(identifier)
        meanings.add(meaning)
    return entries


def vocabulary_entries(entries) -> list[dict[str, str]]:
    result = []
    headword_ids = set()
    source_ids = set()
    for entry in records(entries, "vocabulary"):
        headword_id = text(entry.get("id"), "vocabulary.id")
        if headword_id in headword_ids:
            raise ValueError(f"Duplicate headword ID: {headword_id}")
        headword_ids.add(headword_id)
        target = text(entry.get("target"), f"{headword_id}.target")
        seen_senses = set()
        for sense in records(entry.get("senses"), f"{headword_id}.senses"):
            identifier = text(sense.get("id"), f"{headword_id}.sense.id")
            if not re.fullmatch(re.escape(headword_id) + r"-s[0-9]{3}", identifier):
                raise ValueError(f"{identifier}: sense ID must extend {headword_id}-sNNN")
            references = sense.get("source_sense_ids")
            if (not isinstance(references, list) or not references
                    or references[0] != identifier):
                raise ValueError(f"{identifier}: source_sense_ids must start with the canonical ID")
            for reference in references:
                if (not isinstance(reference, str)
                        or not re.fullmatch(re.escape(headword_id) + r"-s[0-9]{3}", reference)):
                    raise ValueError(f"{identifier}: invalid source sense ID {reference!r}")
                if reference in source_ids:
                    raise ValueError(f"{identifier}: duplicate source sense ID {reference}")
                source_ids.add(reference)
            reading = text(sense.get("reading"), f"{identifier}.reading")
            english = text(sense.get("english"), f"{identifier}.english")
            if not re.search(r"[A-Za-z]", english):
                raise ValueError(f"{identifier}.english: must include English")
            if (reading, english) in seen_senses:
                raise ValueError(f"{identifier}: duplicate reading and dictionary sense")
            seen_senses.add((reading, english))
            result.append({
                "id": identifier, "ch": target, "pr": reading,
                "ds": label(sense.get("disambiguator"), identifier),
            })
    return unique_entries(result)


def grammar_entries(entries) -> list[dict[str, str]]:
    return unique_entries([
        {
            "id": text(entry.get("id"), "grammar.id"),
            "ch": text(entry.get("token_form"), f"{entry.get('id')}.token_form"),
            "ds": label(entry.get("disambiguator"), entry.get("id")),
        }
        for entry in records(entries, "grammar")
    ])


def vocabulary_pairs(entries) -> list[list[str]]:
    return unique_pairs([
        [entry["id"], token(f"{entry['ch']}({entry['pr']})", entry["ds"], entry["id"])]
        for entry in vocabulary_entries(entries)
    ])


def grammar_pairs(entries) -> list[list[str]]:
    return unique_pairs([
        [entry["id"], token(entry["ch"], entry["ds"], entry["id"])]
        for entry in grammar_entries(entries)
    ])


def compact_outputs(directory: Path, vocabulary, grammar) -> dict[Path, str]:
    words, patterns = vocabulary_pairs(vocabulary), grammar_pairs(grammar)
    unique_pairs(words + patterns)
    return {
        directory / "vocabulary.min.yaml": dump_pairs(words),
        directory / "grammar.min.yaml": dump_pairs(patterns),
    }


def generate(directory: Path, check: bool = False) -> None:
    outputs = compact_outputs(
        directory,
        load_yaml(directory / "vocabulary.yaml"),
        load_yaml(directory / "grammar.yaml"),
    )
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Missing or stale compact file: {path}")
        else:
            path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--check", action="store_true",
                        help="Fail on missing or stale outputs without writing files")
    args = parser.parse_args()
    try:
        generate(args.directory, args.check)
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} compact files in {args.directory}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
