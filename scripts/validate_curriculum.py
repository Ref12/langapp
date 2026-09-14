"""Validate the bilingual YAML curriculum files."""

import argparse
from datetime import date
from pathlib import Path
import re
import sys

import yaml

from curriculum_yaml import load_yaml
from generate_curriculum_tokens import PILOT_LEVEL, compact_outputs, vocabulary_pairs


LEVELS = {
    "chinese": [*(f"hsk-{level}" for level in range(1, 7)), "hsk-7-9"],
    "korean": [f"topik-{level}" for level in range(1, 7)],
    "japanese": [f"jlpt-n{level}" for level in range(5, 0, -1)],
}
VOCABULARY_FIELDS = [
    "id", "target", "reading", "english", "part_of_speech", "topic",
    "source_id", "source_entry", "level_basis",
]
SOURCE_FIELDS = [
    "id", "title", "url", "license", "usage", "attribution", "retrieved_on",
]
PLACEHOLDERS = {"todo", "tbd", "n/a", "unknown", "translation needed",
                "translation pending", "pending", "[english]", "..."}


class Validator:
    def __init__(self, root):
        self.root = root
        self.errors = []
        self.counts = []

    def error(self, location, message):
        self.errors.append(f"{location}: {message}")

    def text(self, value, location, required=True):
        if not isinstance(value, str):
            self.error(location, "expected a string")
            return False
        if required and not value.strip():
            self.error(location, "must not be empty")
            return False
        if "\ufffd" in value:
            self.error(location, "contains a Unicode replacement character")
            return False
        return True

    def english(self, value, location):
        if not self.text(value, location):
            return
        if value.strip().lower() in PLACEHOLDERS:
            self.error(location, "contains a placeholder rather than an equivalent")
        if not re.search(r"[A-Za-z]", value):
            self.error(location, "must include an English gloss")

    def yaml_file(self, path, expected_type):
        try:
            value = load_yaml(path)
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            self.error(path, str(exc))
            return None
        if not isinstance(value, expected_type):
            self.error(path, f"expected a YAML {expected_type.__name__}")
            return None
        return value

    def document(self, path):
        try:
            content = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as exc:
            self.error(path, str(exc))
            return
        self.text(content, path)

    def identifier(self, value, seen, location):
        if self.text(value, location):
            if value in seen:
                self.error(location, f"duplicate ID {value!r}")
            seen.add(value)

    def source_reference(self, value, sources, location):
        if isinstance(value, str) and value not in sources:
            self.error(location, f"unknown source ID {value!r}")

    def catalog(self):
        catalog = self.yaml_file(self.root / "catalog.yaml", dict)
        if catalog is None:
            return
        if catalog.get("schema_version") != 1:
            self.error("catalog.yaml", "schema_version must be 1")
        languages = catalog.get("languages")
        if not isinstance(languages, list):
            self.error("catalog.yaml", "languages must be an array")
            return
        seen = set()
        for index, entry in enumerate(languages):
            location = f"catalog.yaml languages[{index}]"
            if not isinstance(entry, dict):
                self.error(location, "expected an object")
                continue
            language = entry.get("id")
            self.identifier(language, seen, location)
            if not isinstance(language, str) or language not in LEVELS:
                self.error(location, f"unrecognized language {language!r}")
                continue
            if entry.get("levels") != LEVELS[language]:
                self.error(location, "levels must match the standard learning order")
            self.text(entry.get("standard"), f"{location}.standard")
        if seen != set(LEVELS):
            self.error("catalog.yaml", "must include all three languages exactly once")

    def sources(self, language):
        path = self.root / language / "sources.yaml"
        entries = self.yaml_file(path, list)
        seen = set()
        if entries is None:
            return seen
        if not entries:
            self.error(path, "source list must not be empty")
        for index, entry in enumerate(entries):
            location = f"{path}[{index}]"
            if not isinstance(entry, dict):
                self.error(location, "expected an object")
                continue
            for field in SOURCE_FIELDS:
                self.text(entry.get(field), f"{location}.{field}")
            self.identifier(entry.get("id"), seen, f"{location}.id")
            retrieved = entry.get("retrieved_on")
            if isinstance(retrieved, str):
                try:
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", retrieved):
                        raise ValueError("Expected a dashed ISO date")
                    date.fromisoformat(retrieved)
                except ValueError:
                    self.error(location, "retrieved_on must be an ISO date YYYY-MM-DD")
        return seen

    def vocabulary(self, language, level, sources, seen):
        path = self.root / language / level / "vocabulary.yaml"
        count = 0
        entries = self.yaml_file(path, list)
        if entries is None:
            return count
        for index, row in enumerate(entries):
            count += 1
            location = f"{path}[{index}]"
            if not isinstance(row, dict):
                self.error(location, "expected an object")
                continue
            fields = VOCABULARY_FIELDS + (["senses"] if (language, level) == PILOT_LEVEL else [])
            if set(row) != set(fields):
                self.error(location, f"fields must be {', '.join(fields)}")
                continue
            required = {"id", "target", "english", "source_id", "level_basis"}
            if language != "korean":
                required.add("reading")
            for field in VOCABULARY_FIELDS:
                self.text(row[field], f"{location}.{field}", field in required)
            self.english(row["english"], f"{location}.english")
            self.identifier(row["id"], seen, f"{location}.id")
            self.source_reference(row["source_id"], sources, location)
        if not count:
            self.error(path, "vocabulary must not be empty")
        if (language, level) == PILOT_LEVEL:
            try:
                pairs = vocabulary_pairs(entries)
            except ValueError as exc:
                self.error(path, str(exc))
            else:
                for identifier, _ in pairs:
                    self.identifier(identifier, seen, f"{path}.senses")
        return count

    def grammar(self, language, level, sources, seen):
        path = self.root / language / level / "grammar.yaml"
        entries = self.yaml_file(path, list)
        example_count = 0
        if entries is None:
            return 0, 0
        if not entries:
            self.error(path, "grammar must not be empty")
        for index, entry in enumerate(entries):
            location = f"{path}[{index}]"
            if not isinstance(entry, dict):
                self.error(location, "expected an object")
                continue
            for field in ("id", "pattern", "english", "note", "source_id", "level_basis"):
                self.text(entry.get(field), f"{location}.{field}", field != "note")
            self.english(entry.get("english"), f"{location}.english")
            self.identifier(entry.get("id"), seen, f"{location}.id")
            self.source_reference(entry.get("source_id"), sources, location)
            examples = entry.get("examples")
            if not isinstance(examples, list):
                self.error(location, "examples must be an array")
                continue
            if len(examples) < 2:
                self.error(location, "at least two bilingual examples are required")
            for example_index, example in enumerate(examples):
                example_location = f"{location}.examples[{example_index}]"
                if not isinstance(example, dict):
                    self.error(example_location, "expected an object")
                    continue
                example_count += 1
                self.text(example.get("target"), f"{example_location}.target")
                self.english(example.get("english"), f"{example_location}.english")
                if "reading" in example:
                    self.text(example["reading"], f"{example_location}.reading")
        return len(entries), example_count

    def compact(self, language, level):
        directory = self.root / language / level
        words = self.yaml_file(directory / "vocabulary.yaml", list)
        patterns = self.yaml_file(directory / "grammar.yaml", list)
        if words is None or patterns is None:
            return
        try:
            outputs = compact_outputs(directory, words, patterns)
        except ValueError as exc:
            self.error(directory, str(exc))
            return
        for path, expected in outputs.items():
            try:
                actual = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                self.error(path, str(exc))
                continue
            if actual != expected:
                self.error(path, "stale compact file; regenerate from expanded YAML")

    def language(self, language):
        directory = self.root / language
        self.document(directory / "README.md")
        sources = self.sources(language)
        seen = set()
        for level in LEVELS[language]:
            self.document(directory / level / "syllabus.md")
            vocabulary_count = self.vocabulary(language, level, sources, seen)
            grammar_count, example_count = self.grammar(language, level, sources, seen)
            if (language, level) == PILOT_LEVEL:
                self.compact(language, level)
            self.counts.append((language, level, vocabulary_count, grammar_count, example_count))

    def run(self, languages):
        self.document(self.root / "README.md")
        self.document(self.root / "TUTOR_GUIDE.md")
        self.catalog()
        for language in languages:
            self.language(language)
        print(f"{'Language':<12} {'Level':<12} {'Vocabulary':>11} {'Grammar':>9} {'Examples':>10}")
        for language, level, vocabulary, grammar, examples in self.counts:
            print(f"{language:<12} {level:<12} {vocabulary:>11,} {grammar:>9,} {examples:>10,}")
        totals = [sum(row[index] for row in self.counts) for index in (2, 3, 4)]
        print(f"{'TOTAL':<25} {totals[0]:>11,} {totals[1]:>9,} {totals[2]:>10,}")
        if self.errors:
            for error in self.errors:
                print(f"ERROR: {error}", file=sys.stderr)
            print(f"{len(self.errors)} validation error(s).", file=sys.stderr)
            return 1
        print("All selected curriculum files are structurally valid.")
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=list(LEVELS),
                        help="Validate one language instead of the complete collection.")
    parser.add_argument("--root", type=Path,
                        default=Path(__file__).resolve().parents[1] / "curriculum",
                        help="Curriculum root (defaults to this repository's curriculum directory).")
    args = parser.parse_args()
    validator = Validator(args.root)
    return validator.run([args.language] if args.language else list(LEVELS))


if __name__ == "__main__":
    sys.exit(main())
