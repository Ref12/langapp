"""Generate the practical Mandarin program, level views, extensions, and tourist route."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import yaml

from curriculum_yaml import load_yaml
from generate_curriculum_tokens import label, records, text
import generate_practical_program as engine
from generate_practical_program import load_inputs, phrase_is_covered
from generate_teaching_track import reference_index, resolve_sequence
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SeedUnit,
)


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
PROFILE = ProgramProfile("chinese", "zh", "flat", "literal", "legacy")
BEGINNER_TOPICS = (
    "communication", "food", "services", "description", "people", "home",
    "time", "leisure", "food", "travel", "communication", "communication",
)


def configured(root: Path) -> bool:
    catalog = load_yaml(root.parent / "catalog.yaml")
    languages = records(catalog["languages"], "catalog.languages")
    chinese = [entry for entry in languages if entry.get("id") == "chinese"]
    if len(chinese) != 1:
        raise ValueError("Catalog must contain Chinese exactly once")
    if "teaching_program" not in chinese[0]:
        return False
    if chinese[0]["teaching_program"] != "zh-practical":
        raise ValueError("Unsupported Chinese teaching_program")
    return True


def validate_model(program: dict, mastery: dict) -> None:
    engine.validate_model(program, mastery, PROFILE)
    if not set(BEGINNER_TOPICS) <= set(program["topics"]):
        raise ValueError("Program topics must cover the preserved beginner modules")


def validate_mastery(mastery: dict) -> None:
    engine.validate_mastery(mastery, PROFILE)


def placement_rows(value, program: dict, *, grammar: bool = False) -> list[dict]:
    return engine.placement_rows(value, program, grammar=grammar, first_level=5)


def vocabulary_labels(inputs: dict, vocabulary: dict[str, list[dict]], baseline: dict) -> dict:
    validate_model(inputs["program"], inputs["mastery"])
    placements = placement_rows(inputs["vocabulary"], inputs["program"])
    placement_rows(inputs["grammar"], inputs["program"], grammar=True)
    annotated = {
        sense["id"]: sense["disambiguator"]
        for rows in vocabulary.values() for row in rows for sense in row.get("senses", [])
    }
    support = inputs["support"]
    if not isinstance(support, dict):
        raise ValueError("Support labels must map sense IDs to English disambiguators")
    if not isinstance(baseline, dict):
        raise ValueError("Baseline reference labels must be a mapping")
    result = dict(baseline)
    for identifier, disambiguator in [
        *[(row["id"], row["ds"]) for row in placements], *support.items(),
    ]:
        text(identifier, "reference label.id")
        label(disambiguator, identifier)
        if identifier in annotated:
            if disambiguator != annotated[identifier]:
                raise ValueError(f"{identifier}: preserve the existing canonical disambiguator")
        elif identifier in result and result[identifier] != disambiguator:
            raise ValueError(f"{identifier}: conflicting authored reference labels")
        else:
            result[identifier] = disambiguator
    return result


def annotated_grammar(grammar: dict[str, list[dict]], placements: list[dict]) -> dict[str, list[dict]]:
    originals = {row["id"]: row for rows in grammar.values() for row in rows}
    overlays = {}
    for row in placements:
        identifier = row["id"]
        if identifier not in originals:
            raise ValueError(f"Unknown source grammar ID: {identifier}")
        if "token_form" in originals[identifier] or "disambiguator" in originals[identifier]:
            raise ValueError(f"{identifier}: preserve the existing beginner grammar selection")
        overlays[identifier] = {"token_form": row["ch"], "disambiguator": row["ds"]}
    return {
        level: [{**row, **overlays.get(row["id"], {})} for row in rows]
        for level, rows in grammar.items()
    }


def load_references(root: Path, inputs: dict) -> tuple[dict, dict]:
    vocabulary, grammar = {}, {}
    for directory in sorted(root.glob("hsk-*")):
        if directory.is_dir():
            vocabulary[directory.name] = load_yaml(directory / "vocabulary.yaml")
            grammar[directory.name] = load_yaml(directory / "grammar.yaml")
    return reference_index(
        vocabulary, annotated_grammar(grammar, inputs["grammar"]),
        load_yaml(root / "reference-senses.yaml"),
    )


def _references(words: dict, patterns: dict) -> ReferenceBundle:
    return ReferenceBundle(
        words, patterns, {identifier: identifier.rsplit("-s", 1)[0] for identifier in words},
    )


def _data(inputs: dict, words: dict, patterns: dict, beginner: dict) -> ProgramData:
    validate_model(inputs["program"], inputs["mastery"])
    beginner = resolve_sequence(beginner, words, patterns, refresh=True)
    if len(beginner["units"]) != 12:
        raise ValueError("The preserved beginner track must contain twelve modules")
    return ProgramData(
        inputs, _references(words, patterns),
        tuple(SeedUnit(index // 3 + 1, topic, unit)
              for index, (topic, unit) in enumerate(zip(BEGINNER_TOPICS, beginner["units"]))),
    )


class ChineseAdapter:
    profile = PROFILE

    def load(self, root: Path) -> ProgramData:
        inputs = load_inputs(root)
        validate_model(inputs["program"], inputs["mastery"])
        placement_rows(inputs["grammar"], inputs["program"], grammar=True)
        words, patterns = load_references(root, inputs)
        return _data(
            inputs, words, patterns, load_yaml(root / "teaching" / "beginner" / "sequence.yaml"),
        )

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        items = phrase["items"]
        if not items or not phrase_is_covered(
            phrase["ch"], [context.references.vocabulary[item]["ch"] for item in items],
        ):
            raise ValueError(
                f"{phrase['id']}: phrase requires vocabulary not listed in its introduced components"
            )
        return PhraseAnalysis(tuple(items))


ADAPTER = ChineseAdapter()


def schedule_vocabulary(inputs: dict, words: dict, patterns: dict, beginner: dict
                        ) -> tuple[list[dict], list[dict]]:
    return engine.schedule_vocabulary(inputs, words, patterns, beginner, first_level=5)


def tourist_outputs(root: Path, plan: dict, words: dict, patterns: dict, mastery: dict
                    ) -> tuple[dict[Path, str], dict]:
    return engine.tourist_outputs(root, plan, _references(words, patterns), mastery, ADAPTER)


def program_outputs(root: Path, inputs: dict, words: dict, patterns: dict, beginner: dict
                    ) -> dict[Path, str]:
    return engine.program_outputs(root, _data(inputs, words, patterns, beginner), ADAPTER)


def generate(root: Path = ROOT, check: bool = False) -> dict[Path, str]:
    return engine.generate(root, ADAPTER, check)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="Check all program views without writing")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, args.check)
    except (OSError, UnicodeError, ValueError, KeyError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} practical Mandarin program views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
