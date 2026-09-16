"""Russian lexical identity, source readings, and construction input adaptation."""

from __future__ import annotations

from collections import defaultdict
import hashlib
from pathlib import Path
import re
import yaml

from curriculum_yaml import CurriculumLoader, dump_yaml, load_yaml
from generate_curriculum_tokens import label, text, unique_entries
from russian_source import (
    SOURCE_ID, TABLES, expanded_selection, fingerprint, form_records, normalized_reference,
    source_locator, source_reading,
)


def identity_key(kind: str, value: str) -> str:
    return f"ru-{kind}-{hashlib.sha256(value.encode('utf-8')).hexdigest()[:24]}"


class RussianReferences:
    """Build canonical entries and a separately addressed source-form index."""

    def __init__(self, root: Path, *, source_outputs: dict[Path, str] | None = None):
        self.root = root
        def document(relative: Path):
            path = root / relative
            return (load_yaml(path) if source_outputs is None
                    else yaml.load(source_outputs[path], Loader=CurriculumLoader))

        entries = document(Path("build") / "lexical-records.yaml")
        if not isinstance(entries, list) or not entries:
            raise ValueError("Russian expanded vocabulary must be a nonempty list")
        normalized = document(Path("reference") / "vocabulary.yaml")
        if normalized != [normalized_reference(entry) for entry in entries]:
            raise ValueError("Russian normalized vocabulary differs from its selected build records")
        self.expanded, self.vocabulary, self.forms = {}, {}, {}
        self.lexical_identity, self.source_sense_identity = {}, {}
        self.reading_identity, self.spelling_identity = {}, {}
        parents = defaultdict(list)
        for entry in entries:
            identifier = text(entry["id"], "reference.id")
            if identifier in self.expanded:
                raise ValueError(f"Repeated Russian reference ID: {identifier}")
            raw, locator = entry["source_data"], entry["source_record"]
            if entry["source_id"] != SOURCE_ID or fingerprint(raw) != locator["sha256"]:
                raise ValueError(f"{identifier}: source identity/fingerprint differs")
            table, record = locator["table"], locator["record"]
            if (table not in TABLES or type(record) is not int or record < 1
                    or entry["source_entry"] != source_locator(table, record)
                    or not re.fullmatch(f"ru-or-{TABLES[table][0]}{record:05d}-s[0-9]{{3}}", identifier)):
                raise ValueError(f"{identifier}: pinned source locator or local identity differs")
            if entry["target"] != raw["bare"]:
                raise ValueError(f"{identifier}: canonical spelling differs from source")
            reading, kind = source_reading(raw["accented"], target=entry["target"])
            if (entry["reading"] != reading or entry["reading_provenance"]["kind"] != kind
                    or entry["reading_provenance"]["field"] != "accented"
                    or entry["reading_provenance"]["value"] != raw["accented"]):
                raise ValueError(f"{identifier}: canonical reading differs from source")
            span = entry["selected_source_span"]
            if (span["field"] != "translations_en"
                    or type(span["start"]) is not int or type(span["end"]) is not int
                    or not 0 <= span["start"] < span["end"] <= len(raw["translations_en"])
                    or raw["translations_en"][span["start"]:span["end"]] != entry["english"]):
                raise ValueError(f"{identifier}: selected English source span differs")
            compact = {"id": identifier, "ch": entry["target"], "pr": reading,
                       "ds": label(entry["disambiguator"], identifier)}
            self.vocabulary[identifier] = compact
            self.expanded[identifier] = entry
            self.lexical_identity[identifier] = text(entry["lexical_identity"], "lexical identity")
            self.source_sense_identity[identifier] = (
                f"{entry['source_entry']}:translations_en:{span['start']}:{span['end']}"
            )
            self.reading_identity[identifier] = identity_key("reading", reading)
            self.spelling_identity[identifier] = identity_key("spelling", entry["target"])
            self.forms[f"{identifier}-canonical"] = {
                "id": f"{identifier}-canonical", "target": entry["target"], "reading": reading,
                "lexical_identity": entry["lexical_identity"], "sense_ids": [identifier],
                "source_id": entry["source_id"], "source_entry": entry["source_entry"],
                "source_field": "accented", "source_value": raw["accented"],
                "features": {"canonical": True},
            }
            parents[(locator["table"], locator["record"])].append(entry)
        unique_entries(list(self.vocabulary.values()))
        for (table, record), senses in parents.items():
            derived, _ = form_records(table, record, senses[0]["source_data"], senses)
            for form in derived:
                self.forms[form["id"]] = form
        linked = document(Path("build") / "linked-forms.yaml")
        if not isinstance(linked, list):
            raise ValueError("Russian linked forms must be a list")
        for form in linked:
            if (form["id"] in self.forms or fingerprint(form["source_data"]) != form["source_record_sha256"]
                    or source_reading(form["source_data"]["accented"], target=form["target"])[0] != form["reading"]):
                raise ValueError(f"{form['id']}: invalid linked source form")
            if not form["sense_ids"] or any(
                sense not in self.expanded
                or self.lexical_identity[sense] != form["lexical_identity"]
                for sense in form["sense_ids"]
            ):
                raise ValueError(f"{form['id']}: linked form has an unknown or unrelated lexical identity")
            self.forms[form["id"]] = form

    def validate_curation(self, selections: list[dict]) -> None:
        identifiers = [row["id"] for row in selections]
        if len(set(identifiers)) != len(identifiers) or set(identifiers) != set(self.expanded):
            raise ValueError("Russian curated selections differ from normalized references; rerun the importer")
        for selection in selections:
            entry = self.expanded[selection["id"]]
            expected = expanded_selection(selection, entry["source_data"])
            if any(entry.get(key) != value for key, value in expected.items()):
                raise ValueError(f"{entry['id']}: curated source sense differs; rerun the importer")

    def resolve_anchor(self, lemma: str, hint: str) -> str:
        bindings = load_yaml(self.root / "authoring" / "anchor-bindings.yaml")
        if not isinstance(bindings, dict):
            raise ValueError("Russian anchor bindings must be an explicit mapping")
        key = f"{lemma}|{hint}"
        if key in bindings:
            identifier = bindings[key]
            if identifier not in self.expanded or self.expanded[identifier]["target"] != lemma:
                raise ValueError(f"Invalid authored anchor binding: {key}")
            return identifier
        candidates = [
            entry for entry in self.expanded.values()
            if entry["target"] == lemma and (
                entry["disambiguator"].casefold() == hint.casefold()
                or entry["english"].casefold() == hint.casefold()
            )
        ]
        if len(candidates) != 1:
            raise ValueError(f"Lexical anchor needs one exact intended sense: {lemma!r} / {hint!r}")
        return candidates[0]["id"]

    def validate_form(self, identifier: str, form_id: str, surface: str, reading: str) -> None:
        if identifier not in self.vocabulary or form_id not in self.forms:
            raise ValueError(f"Unknown phrase sense/form: {identifier} / {form_id}")
        form = self.forms[form_id]
        if identifier not in form["sense_ids"]:
            raise ValueError(f"{form_id}: form does not belong to the intended sense {identifier}")
        if (form["target"].casefold(), form["reading"].casefold()) != (
            surface.casefold(), reading.casefold(),
        ):
            raise ValueError(f"{form_id}: phrase surface/reading differs from the source form")


def grammar_inputs(root: Path, references: RussianReferences) -> tuple[dict, list, dict, dict]:
    rows = load_yaml(root / "authoring" / "grammar.yaml")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Russian grammar must contain original constructions")
    fields = {"id", "ch", "ds", "level", "topic", "english", "examples",
              "lexical_anchors", "fixed_forms", "grammar_prerequisites"}
    patterns, placements, dependencies, expanded = {}, [], {}, []
    for row in rows:
        if not isinstance(row, dict) or set(row) != fields:
            raise ValueError("Russian authored grammar has invalid fields")
        identifier = text(row["id"], "grammar.id")
        if identifier in patterns or not re.fullmatch(r"ru-g-[a-z0-9]+(?:-[a-z0-9]+)*", identifier):
            raise ValueError(f"Invalid or repeated Russian construction: {identifier}")
        compact = {"id": identifier, "ch": text(row["ch"], identifier),
                   "ds": label(row["ds"], identifier)}
        text(row["english"], f"{identifier}.english")
        if not isinstance(row["examples"], list) or len(row["examples"]) < 2:
            raise ValueError(f"{identifier}: two original bilingual examples are required")
        for example in row["examples"]:
            if not isinstance(example, dict) or set(example) != {"target", "english"}:
                raise ValueError(f"{identifier}: invalid bilingual example")
            text(example["target"], f"{identifier}.example.target")
            text(example["english"], f"{identifier}.example.english")
        if not isinstance(row["lexical_anchors"], list):
            raise ValueError(f"{identifier}: lexical anchors must be a list")
        anchors = []
        for anchor in row["lexical_anchors"]:
            if not isinstance(anchor, dict) or set(anchor) != {"lemma", "hint"}:
                raise ValueError(f"{identifier}: an anchor must identify a lemma and intended English sense")
            anchors.append(references.resolve_anchor(anchor["lemma"], anchor["hint"]))
        for field in ("fixed_forms", "grammar_prerequisites"):
            if not isinstance(row[field], list) or any(not isinstance(item, str) for item in row[field]):
                raise ValueError(f"{identifier}: {field} must be a list of strings")
        patterns[identifier] = compact
        placements.append({**compact, "level": row["level"], "topic": row["topic"], "anchors": anchors})
        dependencies[identifier] = list(row["grammar_prerequisites"])
        expanded.append({
            "id": identifier, "pattern": row["ch"], "english": row["ds"], "note": row["english"],
            "level_basis": "Original independently placed Russian construction; not an examination mapping.",
            "examples": row["examples"], "source_id": "original-ru",
        })
    unique_entries(list(patterns.values()))
    return patterns, placements, dependencies, {
        root / "reference" / "grammar.yaml": dump_yaml(expanded),
    }
