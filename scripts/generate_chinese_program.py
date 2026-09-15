"""Generate the practical Mandarin program, level views, extensions, and tourist route."""

from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
import re
import sys
import unicodedata

import yaml

from curriculum_yaml import dump_entries, dump_yaml, load_yaml
from generate_curriculum_tokens import label, records, text
from generate_teaching_track import english, reference_index, resolve_sequence


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
STAGES = ("recognize", "understand", "supported-use", "independent-use")
MODALITIES = ("reading", "listening", "typed-production", "spoken-production", "handwriting")
ENTRY_FIELDS = {"id", "level", "topic", "ds"}
GRAMMAR_FIELDS = ENTRY_FIELDS | {"ch", "anchors"}
BEGINNER_TOPICS = (
    "communication", "food", "services", "description", "people", "home",
    "time", "leisure", "food", "travel", "communication", "communication",
)


def fields(value, expected: set[str], location: str) -> dict:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{location}: fields must be {', '.join(sorted(expected))}")
    return value


def slug(value, location: str) -> str:
    value = text(value, location)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
        raise ValueError(f"{location}: expected a safe kebab-case identifier")
    return value


def english_list(value, location: str, minimum: int = 1) -> list[str]:
    if not isinstance(value, list) or len(value) < minimum:
        raise ValueError(f"{location}: expected at least {minimum} text items")
    for item in value:
        english(item, location)
    return value


def id_list(value, available: dict, location: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{location}: expected a list of IDs")
    seen = set()
    for identifier in value:
        text(identifier, location)
        if identifier not in available:
            raise ValueError(f"{location}: unknown ID {identifier}")
        if identifier in seen:
            raise ValueError(f"{location}: repeated ID {identifier}")
        seen.add(identifier)
    return value


def configured(root: Path) -> bool:
    catalog = load_yaml(root.parent / "catalog.yaml")
    languages = records(catalog["languages"], "catalog.languages")
    chinese = [entry for entry in languages if entry.get("id") == "chinese"]
    if len(chinese) != 1:
        raise ValueError("Catalog must contain Chinese exactly once")
    if "teaching_program" not in chinese[0]:
        return False
    program = chinese[0]["teaching_program"]
    if program != "zh-practical":
        raise ValueError("Unsupported Chinese teaching_program")
    return True


def load_inputs(root: Path) -> dict:
    authoring = root / "authoring" / "teaching"
    return {
        "program": load_yaml(root / "teaching" / "program.yaml"),
        "mastery": load_yaml(root / "teaching" / "mastery.yaml"),
        "vocabulary": load_yaml(authoring / "vocabulary.yaml"),
        "grammar": load_yaml(authoring / "grammar.yaml"),
        "support": load_yaml(authoring / "support.yaml"),
        "tourist": load_yaml(root / "teaching" / "tourist" / "plan.yaml"),
    }


def validate_model(program: dict, mastery: dict) -> None:
    fields(program, {
        "schema_version", "id", "title", "language", "level_basis", "module_size",
        "review_policy", "phases", "levels", "topics", "extensions",
    }, "program")
    if type(program["schema_version"]) is not int or program["schema_version"] != 1:
        raise ValueError("Program schema_version must be 1")
    if program["id"] != "zh-practical" or program["language"] != "chinese":
        raise ValueError("Expected the zh-practical Chinese program")
    for key in ("title", "level_basis", "review_policy"):
        english(program[key], f"program.{key}")
    if type(program["module_size"]) is not int or not 10 <= program["module_size"] <= 30:
        raise ValueError("module_size must be an integer between 10 and 30")
    levels = records(program["levels"], "program.levels")
    if [row.get("number") for row in levels] != list(range(1, 31)):
        raise ValueError("Program must contain levels 1 through 30 in order")
    for row in levels:
        fields(row, {"number", "title", "goals", "checkpoint"}, "level")
        if type(row["number"]) is not int:
            raise ValueError("Level numbers must be integers")
        english(row["title"], "level.title")
        english_list(row["goals"], "level.goals", 2)
        if len(row["goals"]) > 4:
            raise ValueError("A level must have two to four observable goals")
        english(row["checkpoint"], "level.checkpoint")
    phases = records(program["phases"], "program.phases")
    if len(phases) != 6:
        raise ValueError("Program must contain six phases")
    phase_ids, phase_levels = set(), []
    for row in phases:
        fields(row, {"id", "title", "levels", "target_new_headwords"}, "phase")
        identifier = slug(row["id"], "phase.id")
        if identifier in phase_ids:
            raise ValueError(f"Duplicate phase: {identifier}")
        phase_ids.add(identifier)
        english(row["title"], "phase.title")
        if (not isinstance(row["levels"], list) or not row["levels"]
                or any(type(number) is not int for number in row["levels"])):
            raise ValueError("Phase levels must be nonempty integer lists")
        phase_levels.extend(row["levels"])
        if type(row["target_new_headwords"]) is not int or row["target_new_headwords"] <= 0:
            raise ValueError("Phase headword targets must be positive integers")
    if phase_levels != list(range(1, 31)) or phases[0]["levels"] != [1, 2, 3, 4]:
        raise ValueError("Phases must partition ordered levels, with beginner at levels 1-4")
    if not isinstance(program["topics"], dict) or not program["topics"]:
        raise ValueError("Program topics must be a nonempty mapping")
    for identifier, row in program["topics"].items():
        slug(identifier, "topic.id")
        fields(row, {"title", "task"}, f"topic.{identifier}")
        english(row["title"], "topic.title")
        english(row["task"], "topic.task")
    if not set(BEGINNER_TOPICS) <= set(program["topics"]):
        raise ValueError("Program topics must cover the preserved beginner modules")
    extensions = records(program["extensions"], "program.extensions")
    for row in extensions:
        fields(row, {"id", "title", "after_level", "mastery_target", "description"}, "extension")
        slug(row["id"], "extension.id")
        english(row["title"], "extension.title")
        english(row["description"], "extension.description")
        if type(row["after_level"]) is not int or not 1 <= row["after_level"] <= 30:
            raise ValueError("Extension prerequisites must refer to a core level")
        if row["mastery_target"] not in STAGES:
            raise ValueError("Unknown extension mastery target")
    if ({row["id"] for row in extensions} != {"professional", "technical", "scientific", "literary"}
            or len(extensions) != 4):
        raise ValueError("Expected four unique optional extension IDs")
    validate_mastery(mastery)


def validate_mastery(mastery: dict) -> None:
    fields(mastery, {
        "schema_version", "id", "applies_to", "scope", "unassessed", "modalities",
        "stages", "evidence_fields", "evidence_outcomes", "policy",
    }, "mastery")
    if type(mastery["schema_version"]) is not int or mastery["schema_version"] != 1:
        raise ValueError("Mastery schema_version must be 1")
    if mastery["id"] != "zh-item-mastery":
        raise ValueError("Unknown mastery profile")
    if mastery["applies_to"] != ["vocabulary-sense", "grammar-construct", "phrase"]:
        raise ValueError("Mastery must distinguish vocabulary senses, grammar, and phrases")
    if mastery["modalities"] != list(MODALITIES):
        raise ValueError("Mastery must keep the five modalities separate")
    for key in ("scope", "unassessed"):
        english(mastery[key], f"mastery.{key}")
    stages = records(mastery["stages"], "mastery.stages")
    if [row.get("id") for row in stages] != list(STAGES):
        raise ValueError("Mastery must define the four ordered item stages")
    for row in stages:
        fields(row, {"id", "title", "modalities", "outcome", "evidence", "limitation"}, "mastery.stage")
        expected_modalities = list(MODALITIES[:2] if row["id"] in STAGES[:2] else MODALITIES[2:])
        if row["modalities"] != expected_modalities:
            raise ValueError("Mastery stages must distinguish receptive and productive modalities")
        for key in ("title", "outcome", "limitation"):
            english(row[key], f"mastery.stage.{key}")
        english_list(row["evidence"], "mastery.stage.evidence", 2)
    if mastery["evidence_fields"] != [
        "item_id", "stage", "modality", "task_id", "session_id", "observed_at",
        "context", "response", "outcome", "assistance",
    ]:
        raise ValueError("Mastery evidence fields must retain task, time, modality, and assistance")
    if mastery["evidence_outcomes"] != ["successful", "partial", "unsuccessful"]:
        raise ValueError("Unexpected mastery evidence outcomes")
    english_list(mastery["policy"], "mastery.policy")


def placement_rows(value, program: dict, *, grammar: bool = False) -> list[dict]:
    rows = records(value, "grammar placements" if grammar else "vocabulary placements")
    extensions = {row["id"] for row in program["extensions"]}
    seen = set()
    for row in rows:
        fields(row, GRAMMAR_FIELDS if grammar else ENTRY_FIELDS, "placement")
        identifier = text(row["id"], "placement.id")
        if identifier in seen:
            raise ValueError(f"Duplicate placement ID: {identifier}")
        seen.add(identifier)
        level = row["level"]
        if not ((type(level) is int and 5 <= level <= 30)
                or (isinstance(level, str) and level in extensions)):
            raise ValueError(f"{identifier}: invalid level or extension {level!r}")
        if not isinstance(row["topic"], str) or row["topic"] not in program["topics"]:
            raise ValueError(f"{identifier}: unknown topic {row['topic']!r}")
        label(row["ds"], identifier)
        if grammar:
            text(row["ch"], f"{identifier}.ch")
            if not isinstance(row["anchors"], list):
                raise ValueError(f"{identifier}: anchors must be a list of sense IDs")
    return rows


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


def sequence_header(identifier: str, title: str, program: dict) -> dict:
    return {
        "schema_version": 2, "id": identifier, "title": title, "language": "chinese",
        "level_basis": program["level_basis"], "review_policy": program["review_policy"],
    }


def introduction_index(units: list[dict], kind: str) -> dict:
    return {entry["id"]: entry for unit in units for entry in unit[kind]}


def headword(identifier: str) -> str:
    return identifier.rsplit("-s", 1)[0]


def counts(units: list[dict]) -> dict:
    words, grammar = introduction_index(units, "vocabulary"), introduction_index(units, "grammar")
    return {
        "modules": len(units), "vocabulary_senses": len(words),
        "headwords": len({headword(identifier) for identifier in words}),
        "grammar_constructs": len(grammar),
    }


def chunks(values: list, size: int):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def schedule_vocabulary(inputs: dict, words: dict, patterns: dict, beginner: dict
                        ) -> tuple[list[dict], list[dict]]:
    program = inputs["program"]
    placements = placement_rows(inputs["vocabulary"], program)
    grammars = placement_rows(inputs["grammar"], program, grammar=True)
    taught_words = introduction_index(beginner["units"], "vocabulary")
    taught_grammar = introduction_index(beginner["units"], "grammar")
    scheduled = {}
    for row in placements:
        identifier = row["id"]
        if identifier not in words:
            raise ValueError(f"Unknown vocabulary placement: {identifier}")
        if identifier in taught_words:
            raise ValueError(f"{identifier}: already introduced in the preserved beginner sequence")
        if row["ds"] != words[identifier]["ds"]:
            raise ValueError(f"{identifier}: placement label differs from the canonical reference")
        scheduled[identifier] = dict(row)
    adjustments, branch_support = [], {}
    extensions = {row["id"]: row for row in program["extensions"]}
    for grammar in sorted(grammars, key=lambda row: row["level"] if type(row["level"]) is int else 31):
        identifier, destination = grammar["id"], grammar["level"]
        if identifier not in patterns or identifier in taught_grammar:
            raise ValueError(f"Unknown or already introduced grammar placement: {identifier}")
        if (grammar["ch"], grammar["ds"]) != (patterns[identifier]["ch"], patterns[identifier]["ds"]):
            raise ValueError(f"{identifier}: grammar annotation differs from the reference index")
        for anchor in id_list(grammar["anchors"], words, f"{identifier}.anchors"):
            if anchor in taught_words:
                continue
            existing = scheduled.get(anchor)
            old_level = existing["level"] if existing else None
            if type(destination) is int:
                if existing and type(old_level) is int and old_level <= destination:
                    continue
                scheduled[anchor] = {
                    "id": anchor, "level": destination,
                    "topic": existing["topic"] if existing else grammar["topic"],
                    "ds": words[anchor]["ds"],
                }
                adjustments.append({
                    "id": anchor, "from": old_level, "to": destination, "required_by": identifier,
                })
            elif not (
                existing and (old_level == destination or
                              (type(old_level) is int and old_level <= extensions[destination]["after_level"]))
            ):
                branch_support[(destination, anchor)] = {
                    "id": anchor, "level": destination, "topic": grammar["topic"],
                    "ds": words[anchor]["ds"],
                }
                adjustments.append({
                    "id": anchor, "from": old_level, "to": destination, "required_by": identifier,
                })
    result = list(scheduled.values())
    for (destination, identifier), row in branch_support.items():
        if not any(item["id"] == identifier and item["level"] == destination for item in result):
            result.append(row)
    return result, adjustments


def make_units(destination, placements: list[dict], grammars: list[dict], program: dict,
               words: dict, patterns: dict, context: list[tuple[dict, str]]
               ) -> list[tuple[dict, str]]:
    prefix = f"level-{destination:02d}" if type(destination) is int else f"extension-{destination}"
    seen_words = introduction_index([unit for unit, _ in context], "vocabulary")
    seen_grammar = introduction_index([unit for unit, _ in context], "grammar")
    previous_words, previous_grammar = defaultdict(list), defaultdict(list)
    for unit, topic in context:
        previous_words[topic].extend(entry["id"] for entry in unit["vocabulary"])
        previous_grammar[topic].extend(entry["id"] for entry in unit["grammar"])
    grouped_words, grouped_grammar = defaultdict(list), defaultdict(list)
    for row in placements:
        if row["level"] == destination and row["id"] not in seen_words:
            grouped_words[row["topic"]].append(row["id"])
    for row in grammars:
        if row["level"] == destination and row["id"] not in seen_grammar:
            grouped_grammar[row["topic"]].append(row)
    result = []

    def add_unit(topic: str, identifier: str, title: str, word_ids: list, grammar_rows: list):
        grammar_ids = [row["id"] for row in grammar_rows]
        anchors = list(dict.fromkeys(anchor for row in grammar_rows for anchor in row["anchors"]))
        missing = set(anchors) - set(seen_words) - set(word_ids)
        if missing:
            raise ValueError(f"{identifier}: grammar anchors are not yet introduced: {sorted(missing)}")
        review_words = list(dict.fromkeys(
            [anchor for anchor in anchors if anchor not in word_ids] + previous_words[topic][-8:],
        ))
        unit = {
            "id": identifier, "title": title, "outcome": program["topics"][topic]["task"],
            "vocabulary": [dict(words[item]) for item in word_ids],
            "grammar": [dict(patterns[item]) for item in grammar_ids],
            "review_vocabulary": [dict(words[item]) for item in review_words],
            "review_grammar": [dict(patterns[item]) for item in previous_grammar[topic][-3:]],
        }
        result.append((unit, topic))
        seen_words.update((item, words[item]) for item in word_ids)
        seen_grammar.update((item, patterns[item]) for item in grammar_ids)
        previous_words[topic].extend(word_ids)
        previous_grammar[topic].extend(grammar_ids)

    for topic, metadata in program["topics"].items():
        for number, group in enumerate(chunks(grouped_words[topic], program["module_size"]), 1):
            add_unit(topic, f"{prefix}-{topic}-{number:02d}", f"{metadata['title']} - {number}", group, [])
    for topic, metadata in program["topics"].items():
        for number, group in enumerate(chunks(grouped_grammar[topic], 3), 1):
            add_unit(topic, f"{prefix}-{topic}-practice-{number:02d}",
                     f"{metadata['title']} - sentence practice {number}", [], group)
    if not result:
        raise ValueError(f"{prefix}: no curriculum material was selected")
    return result


def compact_views(directory: Path, units: list[dict]) -> dict[Path, str]:
    return {
        directory / f"{kind}.min.yaml": dump_entries(
            [entry for unit in units for entry in unit[kind]],
        )
        for kind in ("vocabulary", "grammar")
    }


def normalized_phrase(value: str) -> str:
    return "".join(character for character in value
                   if unicodedata.category(character)[0] not in ("P", "Z"))


def phrase_is_covered(value: str, forms: list[str]) -> bool:
    value = normalized_phrase(value)
    forms = [normalized_phrase(form) for form in forms]
    reachable = {0}
    for index in range(len(value)):
        if index in reachable:
            reachable.update(index + len(form) for form in forms if form and value.startswith(form, index))
    return len(value) in reachable


def tourist_outputs(root: Path, plan: dict, words: dict, patterns: dict, mastery: dict
                    ) -> tuple[dict[Path, str], dict]:
    fields(plan, {
        "schema_version", "id", "title", "language", "level_basis", "review_policy", "quick_start", "units",
    }, "tourist plan")
    if type(plan["schema_version"]) is not int or plan["schema_version"] != 1:
        raise ValueError("Tourist plan schema_version must be 1")
    if plan["id"] != "zh-tourist" or plan["language"] != "chinese":
        raise ValueError("Expected the zh-tourist Chinese route")
    units = records(plan["units"], "tourist.units")
    basic_units = []
    for unit in units:
        fields(unit, {
            "id", "title", "outcome", "vocabulary", "grammar",
            "review_vocabulary", "review_grammar", "phrases",
        }, "tourist.unit")
        basic_units.append({key: value for key, value in unit.items() if key != "phrases"})
    quick = plan["quick_start"]
    if (not isinstance(quick, list) or not quick
            or quick != [unit["id"] for unit in units[:len(quick)]]):
        raise ValueError("Tourist quick_start must be a nonempty ordered prefix of the route")
    sequence = resolve_sequence({
        **{key: value for key, value in plan.items() if key not in ("quick_start", "units")},
        "units": basic_units,
    }, words, patterns)
    known, phrases, phrase_ids = {}, [], set(words) | set(patterns)
    for source_unit, unit in zip(units, sequence["units"]):
        known.update((entry["id"], entry) for entry in unit["vocabulary"])
        unit["phrases"], unit["phrase_components"] = [], {}
        for phrase in records(source_unit["phrases"], f"{unit['id']}.phrases"):
            fields(phrase, {"id", "ch", "pr", "ds", "items"}, "tourist.phrase")
            identifier = text(phrase["id"], "phrase.id")
            if not re.fullmatch(r"zh-tourist-p[0-9]{3}", identifier) or identifier in phrase_ids:
                raise ValueError(f"Invalid or duplicate tourist phrase ID: {identifier}")
            phrase_ids.add(identifier)
            text(phrase["ch"], f"{identifier}.ch")
            text(phrase["pr"], f"{identifier}.pr")
            label(phrase["ds"], identifier)
            components = id_list(phrase["items"], known, f"{identifier}.items")
            if not components or not phrase_is_covered(phrase["ch"], [known[item]["ch"] for item in components]):
                raise ValueError(f"{identifier}: phrase requires vocabulary not listed in its introduced components")
            entry = {key: phrase[key] for key in ("id", "ch", "pr", "ds")}
            unit["phrases"].append(entry)
            unit["phrase_components"][identifier] = components
            phrases.append(entry)
    sequence.update(
        schema_version=3, kind="route", quick_start=quick,
        mastery_profile=mastery["id"], mastery_target="supported-use",
    )
    directory = root / "teaching" / "tourist"
    outputs = {
        directory / "sequence.yaml": dump_entries(sequence),
        directory / "phrases.min.yaml": dump_entries(phrases),
        **compact_views(directory, sequence["units"]),
    }
    short = deepcopy(sequence)
    short.update(id="zh-tourist-quick-start", title=f"{plan['title']} - quick start")
    short["units"] = short["units"][:len(quick)]
    outputs.update({
        directory / "quick-start" / "sequence.yaml": dump_entries(short),
        directory / "quick-start" / "phrases.min.yaml": dump_entries(
            [entry for unit in short["units"] for entry in unit["phrases"]],
        ),
        **compact_views(directory / "quick-start", short["units"]),
    })
    return outputs, {
        "id": plan["id"], **counts(sequence["units"]), "phrases": len(phrases),
        "quick_start": {**counts(short["units"]),
                        "phrases": sum(len(unit["phrases"]) for unit in short["units"])},
    }


def program_outputs(root: Path, inputs: dict, words: dict, patterns: dict, beginner: dict
                    ) -> dict[Path, str]:
    program, mastery = inputs["program"], inputs["mastery"]
    validate_model(program, mastery)
    beginner = resolve_sequence(beginner, words, patterns, refresh=True)
    if len(beginner["units"]) != 12:
        raise ValueError("The preserved beginner track must contain twelve modules")
    placements, adjustments = schedule_vocabulary(inputs, words, patterns, beginner)
    if not isinstance(inputs["support"], dict):
        raise ValueError("Support labels must map sense IDs to disambiguators")
    for identifier, disambiguator in inputs["support"].items():
        text(identifier, "support.id")
        label(disambiguator, identifier)
        if identifier not in words or words[identifier]["ds"] != disambiguator:
            raise ValueError(f"{identifier}: support label is missing or differs from the canonical reference")
    grammars = inputs["grammar"]
    context, levels, outputs = [], [], {}
    phase_for_level = {number: phase["id"] for phase in program["phases"] for number in phase["levels"]}
    previous_heads = set()
    level_reports = []
    for definition in program["levels"]:
        number = definition["number"]
        if number <= 4:
            start = (number - 1) * 3
            selected = list(zip(
                deepcopy(beginner["units"][start:start + 3]), BEGINNER_TOPICS[start:start + 3],
            ))
        else:
            selected = make_units(number, placements, grammars, program, words, patterns, context)
            if not any(unit["vocabulary"] for unit, _ in selected):
                raise ValueError(f"Level {number}: vocabulary coverage is missing")
        context.extend(selected)
        units = [unit for unit, _ in selected]
        level = {
            **sequence_header(f"zh-level-{number:02d}", definition["title"], program),
            "schema_version": 3, "kind": "level", "number": number, "phase": phase_for_level[number],
            "prerequisites": [f"zh-level-{prior:02d}" for prior in range(1, number)],
            "goals": definition["goals"],
            "checkpoint": {"task": definition["checkpoint"], "criteria": definition["goals"]},
            "mastery_profile": mastery["id"], "mastery_target": "independent-use", "units": units,
        }
        levels.append(level)
        directory = root / "teaching" / "levels" / f"{number:02d}"
        outputs[directory / "sequence.yaml"] = dump_entries(level)
        outputs.update(compact_views(directory, units))
        report = {"number": number, "title": definition["title"], **counts(units)}
        heads = {headword(identifier) for identifier in introduction_index(units, "vocabulary")}
        report["new_headwords"] = len(heads - previous_heads)
        previous_heads.update(heads)
        report["cumulative_headwords"] = len(previous_heads)
        level_reports.append(report)
    core_units = [unit for unit, _ in context]
    resolve_sequence({
        **sequence_header("zh-practical-core", program["title"], program), "units": core_units,
    }, words, patterns)
    phases, phase_reports = [], []
    for phase_number, definition in enumerate(program["phases"], 1):
        selected = [level for level in levels if level["number"] in definition["levels"]]
        phase = {key: value for key, value in definition.items() if key != "levels"}
        phase["levels"] = selected
        phases.append(phase)
        units = [unit for level in selected for unit in level["units"]]
        report = {"id": definition["id"], **counts(units),
                  "new_headwords": sum(row["new_headwords"] for row in level_reports
                                      if row["number"] in definition["levels"]),
                  "target_new_headwords": definition["target_new_headwords"]}
        phase_reports.append(report)
        directory = root / "teaching" / "phases" / f"{phase_number}-{definition['id']}"
        outputs.update(compact_views(directory, units))
    core = {
        **sequence_header(program["id"], program["title"], program),
        "schema_version": 3, "kind": "program", "mastery_profile": mastery["id"], "phases": phases,
    }
    outputs[root / "teaching" / "core" / "sequence.yaml"] = dump_entries(core)
    outputs.update(compact_views(root / "teaching" / "core", core_units))
    extension_reports = []
    for definition in program["extensions"]:
        prerequisite_units = [unit for level in levels if level["number"] <= definition["after_level"]
                              for unit in level["units"]]
        allowed_ids = {unit["id"] for unit in prerequisite_units}
        prior_context = [(unit, topic) for unit, topic in context if unit["id"] in allowed_ids]
        selected = make_units(definition["id"], placements, grammars, program, words, patterns, prior_context)
        units = [unit for unit, _ in selected]
        resolve_sequence({
            **sequence_header(f"zh-extension-{definition['id']}", definition["title"], program),
            "units": prerequisite_units + units,
        }, words, patterns)
        sequence = {
            **sequence_header(f"zh-extension-{definition['id']}", definition["title"], program),
            "schema_version": 3, "kind": "extension",
            "prerequisites": [f"zh-level-{number:02d}" for number in range(1, definition["after_level"] + 1)],
            "description": definition["description"], "mastery_profile": mastery["id"],
            "mastery_target": definition["mastery_target"], "units": units,
        }
        directory = root / "teaching" / "extensions" / definition["id"]
        outputs[directory / "sequence.yaml"] = dump_entries(sequence)
        outputs.update(compact_views(directory, units))
        extension_reports.append({"id": definition["id"], **counts(units)})
    tourist, tourist_report = tourist_outputs(root, inputs["tourist"], words, patterns, mastery)
    outputs.update(tourist)
    inventory = {
        "schema_version": 1, "program": program["id"],
        "interpretation": "Inventory coverage only, not learner mastery or examination readiness. Routes can overlap; their counts must not be summed as unique vocabulary.",
        "core": counts(core_units), "phases": phase_reports, "levels": level_reports,
        "extensions": extension_reports, "tourist": tourist_report,
        "prerequisite_adjustments": adjustments,
    }
    outputs[root / "teaching" / "inventory.yaml"] = dump_yaml(inventory)
    return outputs


def generate(root: Path = ROOT, check: bool = False) -> dict[Path, str]:
    inputs = load_inputs(root)
    validate_model(inputs["program"], inputs["mastery"])
    placement_rows(inputs["grammar"], inputs["program"], grammar=True)
    words, patterns = load_references(root, inputs)
    outputs = program_outputs(
        root, inputs, words, patterns, load_yaml(root / "teaching" / "beginner" / "sequence.yaml"),
    )
    for path, expected in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                raise ValueError(f"Missing or stale program view: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    return outputs


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
