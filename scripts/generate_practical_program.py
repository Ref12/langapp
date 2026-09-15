"""Generate practical curricula from source-validated language adapters."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from pathlib import Path
import re
import unicodedata

from curriculum_yaml import dump_entries, dump_yaml, load_yaml
from generate_curriculum_tokens import label, records, text, unique_entries
from generate_teaching_track import english, resolve_sequence
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramAdapter, ProgramData, ProgramProfile,
    ReferenceBundle, SeedUnit, SurfaceSegment,
)


STAGES = ("recognize", "understand", "supported-use", "independent-use")
MODALITIES = ("reading", "listening", "typed-production", "spoken-production", "handwriting")
ENTRY_FIELDS = {"id", "level", "topic", "ds"}
GRAMMAR_FIELDS = ENTRY_FIELDS | {"ch", "anchors"}
PHASE_LEVELS = (
    [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12, 13],
    [14, 15, 16, 17, 18], [19, 20, 21, 22, 23, 24], [25, 26, 27, 28, 29, 30],
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


def validate_model(program: dict, mastery: dict, profile: ProgramProfile) -> None:
    slug(profile.language, "profile.language")
    slug(profile.prefix, "profile.prefix")
    if (profile.level_layout not in ("flat", "phase-nested")
            or profile.phrase_mode not in ("literal", "realizations")
            or profile.inventory_schema not in ("legacy", "identity-aware")):
        raise ValueError("Unknown program profile policy")
    fields(program, {
        "schema_version", "id", "title", "language", "level_basis", "module_size",
        "review_policy", "phases", "levels", "topics", "extensions",
    }, "program")
    if type(program["schema_version"]) is not int or program["schema_version"] != 1:
        raise ValueError("Program schema_version must be 1")
    if program["id"] != f"{profile.prefix}-practical" or program["language"] != profile.language:
        raise ValueError(f"Expected the {profile.prefix}-practical {profile.language} program")
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
    if profile.inventory_schema != "legacy" and [row["levels"] for row in phases] != list(PHASE_LEVELS):
        raise ValueError("Phases must partition levels as 1-4, 5-8, 9-13, 14-18, 19-24, 25-30")
    if not isinstance(program["topics"], dict) or not program["topics"]:
        raise ValueError("Program topics must be a nonempty mapping")
    for identifier, row in program["topics"].items():
        slug(identifier, "topic.id")
        fields(row, {"title", "task"}, f"topic.{identifier}")
        english(row["title"], "topic.title")
        english(row["task"], "topic.task")
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
    validate_mastery(mastery, profile)


def validate_mastery(mastery: dict, profile: ProgramProfile) -> None:
    fields(mastery, {
        "schema_version", "id", "applies_to", "scope", "unassessed", "modalities",
        "stages", "evidence_fields", "evidence_outcomes", "policy",
    }, "mastery")
    if type(mastery["schema_version"]) is not int or mastery["schema_version"] != 1:
        raise ValueError("Mastery schema_version must be 1")
    if mastery["id"] != f"{profile.prefix}-item-mastery":
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


def placement_rows(value, program: dict, *, grammar: bool = False, first_level: int = 1) -> list[dict]:
    rows = [] if value == [] else records(value, "grammar placements" if grammar else "vocabulary placements")
    extensions = {row["id"] for row in program["extensions"]}
    seen = set()
    for row in rows:
        fields(row, GRAMMAR_FIELDS if grammar else ENTRY_FIELDS, "placement")
        identifier = text(row["id"], "placement.id")
        if identifier in seen:
            raise ValueError(f"Duplicate placement ID: {identifier}")
        seen.add(identifier)
        level = row["level"]
        if not ((type(level) is int and first_level <= level <= 30)
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


def sequence_header(identifier: str, title: str, program: dict) -> dict:
    return {
        "schema_version": 2, "id": identifier, "title": title, "language": program["language"],
        "level_basis": program["level_basis"], "review_policy": program["review_policy"],
    }


def introduction_index(units: list[dict], kind: str) -> dict:
    return {entry["id"]: entry for unit in units for entry in unit[kind]}


def counts(units: list[dict], references: ReferenceBundle, profile: ProgramProfile) -> dict:
    words, grammar = introduction_index(units, "vocabulary"), introduction_index(units, "grammar")
    result = {
        "modules": len(units), "vocabulary_senses": len(words),
        "headwords": len({references.lexical_identity[identifier] for identifier in words}),
        "grammar_constructs": len(grammar),
    }
    if profile.inventory_schema == "identity-aware":
        result.update(
            source_senses=len({references.source_sense_identity[item] for item in words}),
            readings=len({references.reading_identity[item] for item in words}),
            spellings=len({references.spelling_identity[item] for item in words}),
        )
    return result


def chunks(values: list, size: int):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def schedule_vocabulary(inputs: dict, words: dict, patterns: dict, beginner: dict,
                        *, first_level: int = 1, seed_vocabulary_levels: dict[str, int] | None = None
                        ) -> tuple[list[dict], list[dict]]:
    program = inputs["program"]
    placements = placement_rows(inputs["vocabulary"], program, first_level=first_level)
    grammars = placement_rows(inputs["grammar"], program, grammar=True, first_level=first_level)
    taught_words = introduction_index(beginner["units"], "vocabulary")
    taught_grammar = introduction_index(beginner["units"], "grammar")
    seed_levels = seed_vocabulary_levels if seed_vocabulary_levels is not None else {}
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
            if anchor in taught_words and (
                type(destination) is int or seed_levels.get(anchor, 0) <= extensions[destination]["after_level"]
            ):
                continue
            existing = scheduled.get(anchor)
            old_level = existing["level"] if existing else seed_levels.get(anchor)
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


def validate_references(references: ReferenceBundle, profile: ProgramProfile) -> None:
    if not isinstance(references, ReferenceBundle):
        raise ValueError("Adapter references must be a ReferenceBundle")
    for kind, index in (("vocabulary", references.vocabulary), ("grammar", references.grammar)):
        if not isinstance(index, dict):
            raise ValueError(f"{kind}: expected a canonical index")
        expected = {"id", "ch", "pr", "ds"} if kind == "vocabulary" else {"id", "ch", "ds"}
        for identifier, entry in index.items():
            fields(entry, expected, f"{kind}.{identifier}")
            if entry["id"] != identifier:
                raise ValueError(f"{kind}: index key differs from entry ID {identifier}")
            for name, value in entry.items():
                text(value, f"{identifier}.{name}")
            label(entry["ds"], identifier)
    unique_entries([*references.vocabulary.values(), *references.grammar.values()])
    words = set(references.vocabulary)
    mappings = {"lexical_identity": references.lexical_identity}
    if profile.inventory_schema == "identity-aware":
        mappings.update(
            source_sense_identity=references.source_sense_identity,
            reading_identity=references.reading_identity,
            spelling_identity=references.spelling_identity,
        )
        if (not isinstance(references.provenance, dict)
                or set(references.provenance) != words | set(references.grammar)):
            raise ValueError("Provenance must cover every vocabulary and construction ID exactly")
        for identifier, source in references.provenance.items():
            if not isinstance(source, dict):
                raise ValueError(f"{identifier}: expected expanded provenance")
            for name in ("source_id", "source_entry"):
                text(source.get(name), f"{identifier}.provenance.{name}")
    for name, mapping in mappings.items():
        if not isinstance(mapping, dict) or set(mapping) != words:
            raise ValueError(f"{name}: must cover vocabulary IDs exactly")
        identity_values = {}
        for identifier, identity in mapping.items():
            text(identity, f"{identifier}.{name}")
            if name == "lexical_identity":
                continue
            value = (references.lexical_identity[identifier],)
            if name in ("reading_identity", "spelling_identity"):
                value = (references.vocabulary[identifier]["pr" if name == "reading_identity" else "ch"],)
            if identity in identity_values and identity_values[identity] != value:
                raise ValueError(f"{name}: conflicting identity {identity}")
            identity_values[identity] = value


def validate_dependencies(dependencies: dict, grammar: dict) -> None:
    if not isinstance(dependencies, dict):
        raise ValueError("Construction dependencies must be a mapping")
    graph = {}
    for identifier, required in dependencies.items():
        if identifier not in grammar:
            raise ValueError(f"Unknown construction dependency owner: {identifier}")
        if not isinstance(required, (list, tuple)):
            raise ValueError(f"{identifier}: construction dependencies must be a list or tuple")
        graph[identifier] = id_list(list(required), grammar, f"{identifier}.dependencies")
    pending, complete = set(), set()

    def visit(identifier):
        if identifier in pending:
            raise ValueError(f"Cyclic construction dependency: {identifier}")
        if identifier in complete:
            return
        pending.add(identifier)
        for required in graph.get(identifier, []):
            visit(required)
        pending.remove(identifier)
        complete.add(identifier)

    for identifier in graph:
        visit(identifier)


def dependency_closure(units: list[dict], dependencies: dict, anchors: dict) -> None:
    known_words, known_grammar = set(), set()
    for unit in units:
        known_words.update(entry["id"] for entry in unit["vocabulary"])
        current = {entry["id"] for entry in unit["grammar"]}
        for identifier in current:
            missing = set(dependencies.get(identifier, ())) - known_grammar - current
            if missing:
                raise ValueError(f"{unit['id']}: construction prerequisites not introduced: {sorted(missing)}")
            missing_words = set(anchors.get(identifier, ())) - known_words
            if missing_words:
                raise ValueError(f"{unit['id']}: grammar anchors are not yet introduced: {sorted(missing_words)}")
        known_grammar.update(current)


def normalized_surface(value: str) -> str:
    # Preserve apostrophes, hyphens, accents, and other meaningful spelling distinctions.
    return "".join(character for character in unicodedata.normalize("NFC", value)
                   if not character.isspace() and character not in ".,!?;:\u00bf\u00a1\u3001\u3002\uff01\uff1f\uff1b\uff1a")


def normalized_reading(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFC", value)
                   if not character.isspace())


def analyze_phrase(phrase: dict, context: PhraseContext, adapter: ProgramAdapter) -> PhraseAnalysis:
    words, patterns = context.references.vocabulary, context.references.grammar
    items = id_list(phrase["items"], {key: words[key] for key in context.introduced_vocabulary},
                    f"{phrase['id']}.items")
    required = [] if context.profile.phrase_mode == "literal" else id_list(
        phrase["grammar"], {key: patterns[key] for key in context.introduced_grammar},
        f"{phrase['id']}.grammar",
    )
    checker = getattr(adapter, "validate_phrase", None)
    if not callable(checker):
        raise ValueError("A strict adapter phrase validator is required")
    result = checker(deepcopy(phrase), context)
    if (not isinstance(result, PhraseAnalysis) or result.items != tuple(items)
            or result.grammar != tuple(required)):
        raise ValueError(f"{phrase['id']}: adapter returned an invalid phrase analysis")
    if context.profile.phrase_mode == "literal":
        if not items or not phrase_is_covered(phrase["ch"], [words[item]["ch"] for item in items]):
            raise ValueError(f"{phrase['id']}: phrase requires vocabulary not listed in its introduced components")
        return result
    raw = records(phrase["realizations"], f"{phrase['id']}.realizations")
    segments = []
    item_links, grammar_links = set(), set()
    for segment in raw:
        expected = {"ch", "pr", "items", "grammar"}
        fields(segment, expected | ({"form_id"} if "form_id" in segment else set()), "realization")
        for name in ("ch", "pr"):
            text(segment[name], f"realization.{name}")
        lexical = id_list(segment["items"], {key: words[key] for key in items}, "realization.items")
        grammatical = id_list(segment["grammar"], {key: patterns[key] for key in required}, "realization.grammar")
        if not lexical and not grammatical:
            raise ValueError("Every surface realization must have a lexical or construction link")
        canonical = (
            len(lexical) == 1 and segment["ch"] == words[lexical[0]]["ch"]
            and segment["pr"] == words[lexical[0]]["pr"]
        )
        form_id = segment.get("form_id")
        if form_id is not None:
            text(form_id, "realization.form_id")
        elif not canonical:
            raise ValueError("Noncanonical or fixed-grammar realizations require a validated form_id")
        segments.append(SurfaceSegment(segment["ch"], segment["pr"], tuple(lexical), tuple(grammatical), form_id))
        item_links.update(lexical)
        grammar_links.update(grammatical)
    if result.realizations != tuple(segments):
        raise ValueError("Adapter phrase analysis must preserve the authored surface realizations")
    if item_links != set(items) or grammar_links != set(required):
        raise ValueError("Phrase components must exactly match the union of realization links")
    if normalized_surface("".join(segment.ch for segment in segments)) != normalized_surface(phrase["ch"]):
        raise ValueError("Phrase has uncovered or mismatched written surface")
    if normalized_reading("".join(segment.pr for segment in segments)) != normalized_reading(phrase["pr"]):
        raise ValueError("Phrase has uncovered or mismatched reading")
    return result


def tourist_outputs(root: Path, plan: dict, references: ReferenceBundle, mastery: dict,
                    adapter: ProgramAdapter, dependencies: dict | None = None, anchors: dict | None = None
                    ) -> tuple[dict[Path, str], dict]:
    words, patterns, profile = references.vocabulary, references.grammar, adapter.profile
    fields(plan, {
        "schema_version", "id", "title", "language", "level_basis", "review_policy", "quick_start", "units",
    }, "tourist plan")
    if type(plan["schema_version"]) is not int or plan["schema_version"] != 1:
        raise ValueError("Tourist plan schema_version must be 1")
    if plan["id"] != f"{profile.prefix}-tourist" or plan["language"] != profile.language:
        raise ValueError(f"Expected the {profile.prefix}-tourist {profile.language} route")
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
    }, words, patterns, language=profile.language, prefix=profile.prefix)
    dependency_closure(sequence["units"], dependencies or {}, anchors or {})
    known, known_grammar, phrases, phrase_ids = {}, set(), [], set(words) | set(patterns)
    for source_unit, unit in zip(units, sequence["units"]):
        known.update((entry["id"], entry) for entry in unit["vocabulary"])
        known_grammar.update(entry["id"] for entry in unit["grammar"])
        unit["phrases"], unit["phrase_components"] = [], {}
        for phrase in records(source_unit["phrases"], f"{unit['id']}.phrases"):
            expected = {"id", "ch", "pr", "ds", "items"}
            if profile.phrase_mode == "realizations":
                expected.update(("grammar", "realizations"))
            fields(phrase, expected, "tourist.phrase")
            identifier = text(phrase["id"], "phrase.id")
            if not re.fullmatch(re.escape(profile.prefix) + r"-tourist-p[0-9]{3}", identifier) or identifier in phrase_ids:
                raise ValueError(f"Invalid or duplicate tourist phrase ID: {identifier}")
            phrase_ids.add(identifier)
            text(phrase["ch"], f"{identifier}.ch")
            text(phrase["pr"], f"{identifier}.pr")
            label(phrase["ds"], identifier)
            analysis = analyze_phrase(phrase, PhraseContext(
                profile, references, frozenset(known), frozenset(known_grammar),
            ), adapter)
            entry = {key: phrase[key] for key in ("id", "ch", "pr", "ds")}
            unit["phrases"].append(entry)
            unit["phrase_components"][identifier] = (
                list(analysis.items) if profile.phrase_mode == "literal" else {
                    "items": list(analysis.items), "grammar": list(analysis.grammar),
                    "realizations": deepcopy(phrase["realizations"]),
                }
            )
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
    short.update(id=f"{profile.prefix}-tourist-quick-start", title=f"{plan['title']} - quick start")
    short["units"] = short["units"][:len(quick)]
    outputs.update({
        directory / "quick-start" / "sequence.yaml": dump_entries(short),
        directory / "quick-start" / "phrases.min.yaml": dump_entries(
            [entry for unit in short["units"] for entry in unit["phrases"]],
        ),
        **compact_views(directory / "quick-start", short["units"]),
    })
    return outputs, {
        "id": plan["id"], **counts(sequence["units"], references, profile), "phrases": len(phrases),
        "quick_start": {**counts(short["units"], references, profile),
                        "phrases": sum(len(unit["phrases"]) for unit in short["units"])},
    }


def program_outputs(root: Path, data: ProgramData, adapter: ProgramAdapter) -> dict[Path, str]:
    if not isinstance(data, ProgramData) or not isinstance(getattr(adapter, "profile", None), ProgramProfile):
        raise ValueError("Adapter must supply ProgramData and a ProgramProfile")
    fields(data.inputs, {"program", "mastery", "vocabulary", "grammar", "support", "tourist"}, "inputs")
    if not isinstance(data.seeds, tuple) or not all(isinstance(seed, SeedUnit) for seed in data.seeds):
        raise ValueError("Seeds must be a tuple of SeedUnit records")
    inputs, references, profile = data.inputs, data.references, adapter.profile
    program, mastery = inputs["program"], inputs["mastery"]
    validate_model(program, mastery, profile)
    validate_references(references, profile)
    words, patterns = references.vocabulary, references.grammar
    validate_dependencies(data.construction_dependencies, patterns)
    seed_levels = [seed.level for seed in data.seeds]
    if any(type(number) is not int or not 1 <= number <= 30 for number in seed_levels):
        raise ValueError("Seed levels must be integers from 1 through 30")
    if seed_levels != sorted(seed_levels) or sorted(set(seed_levels)) != list(range(1, max(seed_levels, default=0) + 1)):
        raise ValueError("Seeds must form an ordered contiguous initial level prefix")
    for seed in data.seeds:
        if seed.topic not in program["topics"]:
            raise ValueError(f"Unknown seed topic: {seed.topic}")
    beginner = {"units": []}
    if data.seeds:
        beginner = resolve_sequence({
            **sequence_header(f"{profile.prefix}-beginner", "Beginner", program),
            "units": [deepcopy(seed.unit) for seed in data.seeds],
        }, words, patterns, refresh=True, language=profile.language, prefix=profile.prefix)
    placements, adjustments = schedule_vocabulary(
        inputs, words, patterns, beginner, first_level=max(seed_levels, default=0) + 1,
        seed_vocabulary_levels={
            entry["id"]: seed.level
            for seed, unit in zip(data.seeds, beginner["units"]) for entry in unit["vocabulary"]
        },
    )
    if not isinstance(inputs["support"], dict):
        raise ValueError("Support labels must map sense IDs to disambiguators")
    for identifier, disambiguator in inputs["support"].items():
        text(identifier, "support.id")
        label(disambiguator, identifier)
        if identifier not in words or words[identifier]["ds"] != disambiguator:
            raise ValueError(f"{identifier}: support label is missing or differs from the canonical reference")
    grammars = inputs["grammar"]
    anchors = {row["id"]: row["anchors"] for row in grammars}
    context, levels, outputs = [], [], {}
    phase_for_level = {number: phase["id"] for phase in program["phases"] for number in phase["levels"]}
    previous_heads = set()
    level_reports = []
    for definition in program["levels"]:
        number = definition["number"]
        if number in seed_levels:
            selected = [
                (deepcopy(unit), seed.topic)
                for seed, unit in zip(data.seeds, beginner["units"]) if seed.level == number
            ]
        else:
            selected = make_units(number, placements, grammars, program, words, patterns, context)
            if not any(unit["vocabulary"] for unit, _ in selected):
                raise ValueError(f"Level {number}: vocabulary coverage is missing")
        context.extend(selected)
        units = [unit for unit, _ in selected]
        level = {
            **sequence_header(f"{profile.prefix}-level-{number:02d}", definition["title"], program),
            "schema_version": 3, "kind": "level", "number": number, "phase": phase_for_level[number],
            "prerequisites": [f"{profile.prefix}-level-{prior:02d}" for prior in range(1, number)],
            "goals": definition["goals"],
            "checkpoint": {"task": definition["checkpoint"], "criteria": definition["goals"]},
            "mastery_profile": mastery["id"], "mastery_target": "independent-use", "units": units,
        }
        levels.append(level)
        directory = root / "teaching" / "levels" / f"{number:02d}"
        if profile.level_layout == "phase-nested":
            phase_number = next(index for index, phase in enumerate(program["phases"], 1)
                                if number in phase["levels"])
            directory = (root / "teaching" / "phases"
                         / f"{phase_number}-{phase_for_level[number]}" / "levels" / f"{number:02d}")
        outputs[directory / "sequence.yaml"] = dump_entries(level)
        outputs.update(compact_views(directory, units))
        report = {"number": number, "title": definition["title"], **counts(units, references, profile)}
        heads = {references.lexical_identity[identifier] for identifier in introduction_index(units, "vocabulary")}
        report["new_headwords"] = len(heads - previous_heads)
        previous_heads.update(heads)
        report["cumulative_headwords"] = len(previous_heads)
        level_reports.append(report)
    core_units = [unit for unit, _ in context]
    resolve_sequence({
        **sequence_header(f"{profile.prefix}-practical-core", program["title"], program), "units": core_units,
    }, words, patterns, language=profile.language, prefix=profile.prefix)
    dependency_closure(core_units, data.construction_dependencies, anchors)
    phases, phase_reports = [], []
    for phase_number, definition in enumerate(program["phases"], 1):
        selected = [level for level in levels if level["number"] in definition["levels"]]
        phase = {key: value for key, value in definition.items() if key != "levels"}
        phase["levels"] = selected
        phases.append(phase)
        units = [unit for level in selected for unit in level["units"]]
        report = {"id": definition["id"], **counts(units, references, profile),
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
            **sequence_header(f"{profile.prefix}-extension-{definition['id']}", definition["title"], program),
            "units": prerequisite_units + units,
        }, words, patterns, language=profile.language, prefix=profile.prefix)
        dependency_closure(prerequisite_units + units, data.construction_dependencies, anchors)
        sequence = {
            **sequence_header(f"{profile.prefix}-extension-{definition['id']}", definition["title"], program),
            "schema_version": 3, "kind": "extension",
            "prerequisites": [f"{profile.prefix}-level-{number:02d}" for number in range(1, definition["after_level"] + 1)],
            "description": definition["description"], "mastery_profile": mastery["id"],
            "mastery_target": definition["mastery_target"], "units": units,
        }
        directory = root / "teaching" / "extensions" / definition["id"]
        outputs[directory / "sequence.yaml"] = dump_entries(sequence)
        outputs.update(compact_views(directory, units))
        extension_reports.append({"id": definition["id"], **counts(units, references, profile)})
    tourist, tourist_report = tourist_outputs(
        root, inputs["tourist"], references, mastery, adapter,
        data.construction_dependencies, anchors if profile.inventory_schema != "legacy" else {},
    )
    outputs.update(tourist)
    inventory = {
        "schema_version": 1, "program": program["id"],
        "interpretation": "Inventory coverage only, not learner mastery or examination readiness. Routes can overlap; their counts must not be summed as unique vocabulary.",
        "core": counts(core_units, references, profile), "phases": phase_reports, "levels": level_reports,
        "extensions": extension_reports, "tourist": tourist_report,
        "prerequisite_adjustments": adjustments,
    }
    outputs[root / "teaching" / "inventory.yaml"] = dump_yaml(inventory)
    seen_paths = set()
    base = root.resolve()
    for collection in (outputs, data.source_outputs):
        if not isinstance(collection, dict):
            raise ValueError("Adapter source_outputs must be a path-to-text mapping")
        for path, content in collection.items():
            if not isinstance(path, Path) or not isinstance(content, str):
                raise ValueError("Output paths must be Path objects and contents must be text")
            resolved = path.resolve()
            if resolved == base or not resolved.is_relative_to(base) or resolved in seen_paths:
                raise ValueError(f"Colliding or out-of-root output path: {path}")
            seen_paths.add(resolved)
    for path in seen_paths:
        if path.is_dir():
            raise ValueError(f"Output file path is an existing directory: {path}")
        for parent in path.parents:
            if parent == base:
                break
            if parent in seen_paths or parent.is_file():
                raise ValueError(f"Output file/directory ancestor conflict: {parent} and {path}")
    outputs.update(data.source_outputs)
    return outputs


def generate(root: Path, adapter: ProgramAdapter, check: bool = False) -> dict[Path, str]:
    outputs = program_outputs(root, adapter.load(root), adapter)
    for path, expected in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                raise ValueError(f"Missing or stale program view: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    return outputs
