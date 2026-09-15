"""Resolve explicitly authored Russian tourist surfaces, not guessed morphology."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from curriculum_yaml import CurriculumLoader, dump_entries, dump_yaml, load_yaml
from generate_curriculum_tokens import label, text
from russian_curriculum_adapter import RussianReferences, grammar_inputs
from russian_source import (
    GENERAL_FIELDS, TABLES, english_source_span, load_selections, reference_outputs, source_reading, unstress,
)


WORD = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")
DESTINATIONS = {
    "polite-repair": (1, "communication"), "food-basics": (3, "food"),
    "finding-your-way": (4, "travel"), "paying": (6, "services"),
    "asking-for-help": (4, "communication"), "transport": (7, "travel"),
    "accommodation": (7, "travel"), "food-restrictions": (6, "food"),
    "shops-services": (6, "services"), "ordinary-health": (6, "health"),
    "timing": (4, "time"), "social-contact": (1, "people"),
}


def fixed_id(binding: dict) -> str:
    owner = binding["grammar_id"].removeprefix("ru-g-")
    return (f"ru-fixed-{owner}-{TABLES[binding['source_table']][0]}"
            f"{binding['source_record']:05d}-{binding['source_field'].replace('_', '-')}")


def matching_selections(selections: list[dict], binding: dict) -> list[dict]:
    return [
        row for row in selections
        if (row["source_table"], row["source_record"]) ==
           (binding["source_table"], binding["source_record"])
        and row["source_gloss"] == binding["source_gloss"]
    ]


def binding_inputs(root: Path) -> tuple[dict, dict]:
    draft = load_yaml(root / "authoring" / "tourist-draft.yaml")
    bindings = load_yaml(root / "authoring" / "tourist-bindings.yaml")
    phrase_ids = [phrase["id"] for unit in draft["units"] for phrase in unit["phrases"]]
    if not isinstance(bindings, dict) or set(bindings) != set(phrase_ids) or len(set(phrase_ids)) != len(phrase_ids):
        raise ValueError("Tourist surface bindings must cover every unique authored phrase exactly")
    for unit in draft["units"]:
        for phrase in unit["phrases"]:
            tokens = WORD.findall(phrase["ch"])
            rows = bindings[phrase["id"]]
            if not isinstance(rows, list) or len(rows) != len(tokens):
                raise ValueError(f"{phrase['id']}: one source binding per written word is required")
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError(f"{phrase['id']}: a source binding must be a mapping")
                base = {"source_table", "source_record", "source_field", "kind"}
                expected = base | ({"source_gloss", "ds"} if row.get("kind") == "lexical" else {"grammar_id"})
                if row.get("kind") not in {"lexical", "grammar"} or set(row) != expected:
                    raise ValueError(f"{phrase['id']}: invalid source surface binding")
                if (not isinstance(row["source_table"], str) or row["source_table"] not in TABLES
                        or type(row["source_record"]) is not int or row["source_record"] < 1):
                    raise ValueError(f"{phrase['id']}: invalid source record locator")
                text(row["source_field"], f"{phrase['id']}.source_field")
                if row["kind"] == "lexical":
                    text(row["source_gloss"], f"{phrase['id']}.source_gloss")
                    label(row["ds"], phrase["id"])
                elif not re.fullmatch(r"ru-g-[a-z0-9]+(?:-[a-z0-9]+)*",
                                      text(row["grammar_id"], f"{phrase['id']}.grammar_id")):
                    raise ValueError(f"{phrase['id']}: invalid construction identity")
    return draft, bindings


def prepare_outputs(root: Path, tables: dict) -> dict[Path, str]:
    draft, bindings = binding_inputs(root)
    primary = load_yaml(root / "authoring" / "vocabulary.yaml")
    primary += load_yaml(root / "authoring" / "grammar-support.yaml")
    support = load_yaml(root / "authoring" / "support-vocabulary.yaml")
    selections = primary + support
    linked = {(row["source_table"], row["source_record"])
              for row in load_yaml(root / "authoring" / "form-links.yaml")}
    fixed, fixed_seen = [], set()
    for unit in draft["units"]:
        level, topic = DESTINATIONS[unit["id"]]
        for phrase in unit["phrases"]:
            for token, binding in zip(WORD.findall(phrase["ch"]), bindings[phrase["id"]]):
                table, number, field = binding["source_table"], binding["source_record"], binding["source_field"]
                if (table not in tables or type(number) is not int or not 1 <= number <= len(tables[table])):
                    raise ValueError(f"{phrase['id']}: unknown source surface record")
                raw = tables[table][number - 1]
                if field not in raw or (field != "accented" and field in GENERAL_FIELDS):
                    raise ValueError(f"{phrase['id']}: source binding must select a reading or inflection column")
                reading, _ = source_reading(raw[field])
                if unstress(reading).casefold() != token.casefold():
                    raise ValueError(f"{phrase['id']}: source field does not spell {token!r}")
                if binding["kind"] == "grammar":
                    identifier = fixed_id(binding)
                    if identifier not in fixed_seen:
                        fixed_seen.add(identifier)
                        fixed.append({
                            "id": identifier, "grammar_id": binding["grammar_id"],
                            "source_table": table, "source_record": number, "source_field": field,
                        })
                    continue
                english_source_span(raw["translations_en"], binding["source_gloss"])
                if (table, number) in linked:
                    continue
                matches = matching_selections(selections, binding)
                if len(matches) > 1:
                    raise ValueError(f"{phrase['id']}: ambiguous selected source sense")
                if matches:
                    continue
                existing = [row for row in selections
                            if (row["source_table"], row["source_record"]) == (table, number)]
                slot = 1 + max((int(row["id"].rsplit("-s", 1)[1]) for row in existing), default=0)
                stem = f"ru-or-{TABLES[table][0]}{number:05d}"
                row = {
                    "id": f"{stem}-s{slot:03d}", "source_table": table, "source_record": number,
                    "source_gloss": binding["source_gloss"], "ds": binding["ds"], "level": level,
                    "topic": topic, "lexical_identity": existing[0]["lexical_identity"] if existing else stem,
                    "part_of_speech": (existing[0]["part_of_speech"] if existing else
                                      {"nouns": "noun", "verbs": "verb", "adjectives": "adjective",
                                       "others": "expression"}[table]),
                    "sense_note": "Explicit essential-travel selection; the concise contextual English hint is independently authored and requires human review.",
                }
                support.append(row)
                selections.append(row)
    outputs = reference_outputs(root, tables, selections=selections, fixed_links=fixed)
    references = RussianReferences(root, source_outputs=outputs)
    patterns, placements, dependencies, grammar_outputs = grammar_inputs(root, references)
    forms = yaml.load(outputs[root / "build" / "grammar-forms.yaml"], Loader=CurriculumLoader)
    plan = tourist_plan(root, references, patterns, placements, dependencies, forms, selections=selections)
    outputs.update(grammar_outputs)
    outputs.update({
        root / "authoring" / "support-vocabulary.yaml": dump_yaml(support),
        root / "authoring" / "fixed-form-links.yaml": dump_yaml(fixed),
        root / "teaching" / "tourist" / "plan.yaml": dump_entries(plan),
    })
    return outputs


def tourist_plan(root: Path, references: RussianReferences, patterns: dict, placements: list,
                 dependencies: dict, grammar_forms: list, *, selections: list | None = None) -> dict:
    draft, bindings = binding_inputs(root)
    if selections is None:
        selections = load_selections(root)
    fixed = {row["id"]: row for row in grammar_forms}
    anchors = {row["id"]: row["anchors"] for row in placements}
    introduced_words, introduced_grammar, units = [], [], []

    def grammar_closure(identifiers: list[str]) -> list[str]:
        result, visiting = [], set()

        def visit(identifier):
            if identifier in visiting:
                raise ValueError(f"Cyclic tourist construction prerequisite: {identifier}")
            if identifier in result:
                return
            if identifier not in patterns:
                raise ValueError(f"Unknown tourist construction: {identifier}")
            visiting.add(identifier)
            for required in dependencies.get(identifier, []):
                visit(required)
            visiting.remove(identifier)
            result.append(identifier)

        for identifier in identifiers:
            visit(identifier)
        return result

    for source_unit in draft["units"]:
        phrases, unit_words, unit_grammar = [], [], []
        for draft_phrase in source_unit["phrases"]:
            items, required, segments = [], list(draft_phrase["grammar_ids"]), []
            for token, binding in zip(WORD.findall(draft_phrase["ch"]), bindings[draft_phrase["id"]]):
                if binding["kind"] == "grammar":
                    identifier = fixed_id(binding)
                    if identifier not in fixed:
                        raise ValueError(f"Missing source-backed fixed construction form: {identifier}")
                    form = fixed[identifier]
                    lexical, grammatical = [], [form["grammar_id"]]
                else:
                    matches = matching_selections(selections, binding)
                    if not matches:
                        linked_id = (f"ru-or-{TABLES[binding['source_table']][0]}"
                                     f"{binding['source_record']:05d}-linked-form")
                        if linked_id not in references.forms:
                            raise ValueError(f"{draft_phrase['id']}: lexical binding has no selected sense or linked form")
                        form = references.forms[linked_id]
                        candidates = [sense for sense in form["sense_ids"]
                                      if references.expanded[sense]["english"] == binding["source_gloss"]
                                      or references.vocabulary[sense]["ds"] == binding["ds"]]
                        if len(candidates) != 1:
                            raise ValueError(f"{draft_phrase['id']}: linked pronoun form needs one intended sense")
                        sense_id, identifier = candidates[0], linked_id
                    else:
                        if len(matches) != 1:
                            raise ValueError(f"{draft_phrase['id']}: lexical binding is ambiguous")
                        sense_id = matches[0]["id"]
                        if binding["source_field"] == "accented":
                            identifier = f"{sense_id}-canonical"
                        else:
                            stem = sense_id.rsplit("-s", 1)[0]
                            identifier = f"{stem}-f-{binding['source_field'].replace('_', '-')}-01"
                        if identifier not in references.forms:
                            raise ValueError(f"Missing source form for {draft_phrase['id']}: {identifier}")
                        form = references.forms[identifier]
                    lexical, grammatical = [sense_id], []
                reading = form["reading"]
                if token[0].isupper():
                    reading = reading[0].upper() + reading[1:]
                if token.casefold() != form["target"].casefold():
                    raise ValueError(f"{draft_phrase['id']}: surface token differs from bound source form")
                segments.append({"ch": token, "pr": reading, "items": lexical,
                                 "grammar": grammatical, "form_id": identifier})
                items.extend(lexical)
                required.extend(grammatical)
            items, required = list(dict.fromkeys(items)), list(dict.fromkeys(required))
            attached = {identifier for segment in segments for identifier in segment["grammar"]}
            target = next((segment for segment in segments if segment["items"]), segments[0])
            target["grammar"].extend(identifier for identifier in required if identifier not in attached)
            phrases.append({
                "id": draft_phrase["id"], "ch": draft_phrase["ch"],
                "pr": " ".join(segment["pr"] for segment in segments), "ds": draft_phrase["ds"],
                "items": items, "grammar": required, "realizations": segments,
            })
            unit_words.extend(items)
            unit_grammar.extend(required)
        required_grammar = grammar_closure(list(dict.fromkeys(unit_grammar)))
        unit_words.extend(anchor for identifier in required_grammar for anchor in anchors[identifier])
        words = [identifier for identifier in dict.fromkeys(unit_words) if identifier not in introduced_words]
        grammar = [identifier for identifier in required_grammar if identifier not in introduced_grammar]
        units.append({
            "id": source_unit["id"], "title": source_unit["title"], "outcome": source_unit["outcome"],
            "vocabulary": words, "grammar": grammar,
            "review_vocabulary": introduced_words[-6:], "review_grammar": introduced_grammar[-3:],
            "phrases": phrases,
        })
        introduced_words.extend(words)
        introduced_grammar.extend(grammar)
    return {
        "schema_version": 1, "id": draft["id"], "title": draft["title"], "language": "russian",
        "level_basis": "Independent travel route with all vocabulary, fixed forms and construction prerequisites introduced within the route; no completed core level required.",
        "review_policy": "Use a few phrases and senses per lesson; retrieve earlier and fragile items on later days. Source-derived lexical stress is a reading aid, not phonetic transcription or audio evidence. Original travel phrases require human review and provide no legal, medical, payment, accessibility or safety guarantees.",
        "quick_start": draft["quick_start"], "units": units,
    }
