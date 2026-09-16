"""Source-faithful extraction for the independent Russian reference inventory."""

from __future__ import annotations

from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import urllib.request

from curriculum_yaml import dump_yaml, load_yaml
from generate_curriculum_tokens import label, text


REVISION = "50e210c4803237779cb562bc1abcea529066031c"
SOURCE_ID = "openrussian-backup"
SOURCE_BASE = f"https://raw.githubusercontent.com/Badestrand/russian-dictionary/{REVISION}"
TABLES = {
    "nouns": ("n", "c388f9e6dde51932832be8d7e9afdbe9f0acee72fcf70677f0fe25ea61293c84"),
    "verbs": ("v", "8659de6799b949fb35f080b08088fb7d347ed300490954ebb380a31642646e1d"),
    "adjectives": ("a", "89ab5d10dcd2f21f6b485de704aef372f32251468e3aa96f18b21e259f26b80a"),
    "others": ("o", "9f22a16b17fc9a564298112168b667fced11aafb254ccebf5b7544fc37cdaa92"),
}
VOWELS = frozenset("аеёиоуыэюя")
ACUTE = "\u0301"
CYRILLIC_WORD = re.compile(r"[А-Яа-яЁё]+")
SOURCE_TOKEN = re.compile(r"[А-Яа-яЁё'\u0301]+")
GENERAL_FIELDS = {
    "bare", "accented", "translations_en", "translations_de", "gender",
    "partner", "animate", "indeclinable", "sg_only", "pl_only", "aspect",
}
SELECTION_FIELDS = {
    "id", "source_table", "source_record", "source_gloss", "ds", "level",
    "topic", "lexical_identity", "part_of_speech",
}
SELECTION_OPTIONAL = {"sense_note", "aliases"}
BRANCHES = {"professional", "technical", "scientific", "literary"}
REFERENCE_FIELDS = (
    "id", "target", "reading", "english", "part_of_speech", "topic",
    "source_id", "source_entry", "level_basis",
)
FIXTURE_RECORDS = {
    "nouns": (29, 1154, 26428, 26429, 26432),
    "verbs": (4, 6, 9, 48, 363),
    "others": (1967, 4978, 4991),
}


def fingerprint(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def source_bytes(table: str, directory: Path | None = None) -> bytes:
    if table not in TABLES:
        raise ValueError(f"Unknown OpenRussian table: {table}")
    if directory is None:
        request = urllib.request.Request(
            f"{SOURCE_BASE}/{table}.csv", headers={"User-Agent": "langapp-russian-import/1"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read(12_000_001)
        if len(payload) > 12_000_000:
            raise ValueError(f"{table}: source exceeds the expected bounded download")
    else:
        candidates = [directory / f"{table}.csv", directory / f"openrussian-{table}.csv"]
        present = [path for path in candidates if path.is_file()]
        if len(present) != 1:
            raise ValueError(f"{table}: expected exactly one source file in {directory}")
        payload = present[0].read_bytes()
    expected = TABLES[table][1]
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected:
        raise ValueError(f"{table}: source SHA-256 mismatch: expected {expected}, got {actual}")
    return payload


def parse_table(payload: bytes, table: str) -> list[dict[str, str]]:
    stream = io.StringIO(payload.decode("utf-8-sig"), newline="")
    reader = csv.reader(stream, delimiter="\t", quoting=csv.QUOTE_NONE, strict=True)
    headers = next(reader, None)
    if (not headers or len(set(headers)) != len(headers)
            or not {"bare", "accented", "translations_en", "translations_de"} <= set(headers)):
        raise ValueError(f"{table}: missing or repeated source columns")
    rows = []
    for number, values in enumerate(reader, 1):
        # The pinned export has one unescaped tab inside its final German field.
        if (table == "others" and number == 2676 and len(values) == 5
                and values[0] == "переборот" and values[3] == "Siehe :"):
            values = values[:3] + ["\t".join(values[3:])]
        if len(values) != len(headers):
            raise ValueError(f"{table} record {number}: wrong number of TSV fields")
        row = dict(zip(headers, values))
        if not row["bare"]:
            raise ValueError(f"{table} record {number}: missing headword")
        rows.append(row)
    if not rows:
        raise ValueError(f"{table}: source table is empty")
    return rows


def load_tables(directory: Path | None = None) -> dict[str, list[dict[str, str]]]:
    payloads = {table: source_bytes(table, directory) for table in TABLES}
    return {table: parse_table(payload, table) for table, payload in payloads.items()}


def unstress(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("'", "").replace(ACUTE, ""))


def source_reading(value: str, *, target: str | None = None) -> tuple[str, str]:
    """Convert source stress notation, never infer a multisyllabic stress."""
    value = text(value, "source reading")
    parts = re.split(r"([ -])", value)
    tokens = parts[::2]
    kinds, converted = [], []
    for token in tokens:
        if not SOURCE_TOKEN.fullmatch(token):
            raise ValueError(f"Unsupported source reading notation: {value!r}")
        bare = unstress(token)
        marks = [(index, char) for index, char in enumerate(token) if char in ("'", ACUTE)]
        for index, _ in marks:
            if index == 0 or token[index - 1].lower() not in VOWELS:
                raise ValueError(f"Stress mark does not follow a vowel: {value!r}")
        if len(marks) > 1:
            raise ValueError(f"Conflicting source stress marks: {value!r}")
        if marks:
            kind = "source-marked-stress"
        elif bare.lower().count("ё") == 1:
            kind = "source-yo-reading"
        elif sum(char.lower() in VOWELS for char in bare) <= 1:
            kind = "source-monosyllabic-or-nonsyllabic"
        else:
            raise ValueError(f"Unresolved multisyllabic source stress: {value!r}")
        kinds.append(kind)
        converted.append(unicodedata.normalize("NFC", token.replace("'", ACUTE)))
    reading = "".join(part if index % 2 else converted[index // 2]
                      for index, part in enumerate(parts))
    if target is not None and unstress(reading) != unicodedata.normalize("NFC", target):
        raise ValueError(f"Source spelling/reading conflict: {target!r} versus {value!r}")
    return reading, kinds[0] if len(kinds) == 1 else "source-wordwise-reading"


def source_locator(table: str, record: int) -> str:
    return f"{SOURCE_BASE}/{table}.csv#data-record={record}"


def english_source_span(value: str, gloss: str) -> tuple[int, int]:
    gloss = text(gloss, "English source gloss")
    match = re.search(r"(?<![A-Za-z0-9'-])" + re.escape(gloss) + r"(?![A-Za-z0-9'-])", value)
    if not re.search(r"[A-Za-z]", gloss) or match is None:
        raise ValueError("Selected gloss is not an exact English source span with word boundaries")
    return match.span()


def validate_selection(selection: dict, tables: dict, topics: set[str]) -> dict:
    if (not isinstance(selection, dict) or not SELECTION_FIELDS <= set(selection)
            or set(selection) - SELECTION_FIELDS - SELECTION_OPTIONAL):
        raise ValueError("Vocabulary selection has missing or unsupported fields")
    identifier = text(selection["id"], "selection.id")
    table, record = selection["source_table"], selection["source_record"]
    if (not isinstance(table, str) or table not in TABLES or type(record) is not int
            or not 1 <= record <= len(tables[table])):
        raise ValueError(f"{identifier}: unknown source record")
    prefix = f"ru-or-{TABLES[table][0]}{record:05d}"
    if not re.fullmatch(re.escape(prefix) + r"-s[0-9]{3}", identifier):
        raise ValueError(f"{identifier}: local sense ID does not match its pinned source record")
    identity = text(selection["lexical_identity"], f"{identifier}.lexical_identity")
    if not re.fullmatch(r"ru-[a-z0-9]+(?:-[a-z0-9]+)*", identity):
        raise ValueError(f"{identifier}: invalid explicit lexical identity")
    label(selection["ds"], identifier)
    text(selection["part_of_speech"], f"{identifier}.part_of_speech")
    if not isinstance(selection["topic"], str) or selection["topic"] not in topics:
        raise ValueError(f"{identifier}: unknown topic")
    level = selection["level"]
    if not ((type(level) is int and 1 <= level <= 30) or
            (isinstance(level, str) and level in BRANCHES)):
        raise ValueError(f"{identifier}: invalid teaching destination")
    row = tables[table][record - 1]
    english_source_span(row["translations_en"], selection["source_gloss"])
    if "sense_note" in selection:
        text(selection["sense_note"], f"{identifier}.sense_note")
    aliases = selection.get("aliases", [])
    if not isinstance(aliases, list) or aliases:
        raise ValueError(f"{identifier}: aliases require a separately evidenced identity repair")
    return row


def expanded_selection(selection: dict, row: dict) -> dict:
    identifier = selection["id"]
    target = text(row["bare"], f"{identifier}.target")
    reading, reading_kind = source_reading(row["accented"], target=target)
    gloss = selection["source_gloss"]
    start, end = english_source_span(row["translations_en"], gloss)
    return {
        "id": identifier,
        "lexical_identity": selection["lexical_identity"],
        "target": target,
        "reading": reading,
        "english": gloss,
        "disambiguator": selection["ds"],
        "part_of_speech": selection["part_of_speech"],
        "topic": selection["topic"],
        "level_basis": "Independent authored teaching placement; not a reference examination band.",
        "source_id": SOURCE_ID,
        "source_entry": source_locator(selection["source_table"], selection["source_record"]),
        "source_record": {
            "table": selection["source_table"], "record": selection["source_record"],
            "sha256": fingerprint(row),
        },
        "source_data": dict(row),
        "selected_source_span": {"field": "translations_en", "start": start, "end": end},
        "reading_provenance": {
            "kind": reading_kind, "field": "accented", "value": row["accented"],
            "transformation": "Source vowel-following apostrophes become combining acute accents; yo is preserved.",
            "limitation": "Lexical reading aid, not full phonetic transcription or observed pronunciation.",
        },
        "selection_note": selection.get(
            "sense_note", "AI-assisted source-sense selection and concise English hint; human review required.",
        ),
    }


def normalized_reference(entry: dict) -> dict:
    result = {field: entry[field] for field in REFERENCE_FIELDS}
    result["english"] = entry["disambiguator"]
    return result


def form_records(table: str, record: int, row: dict, entries: list[dict]) -> tuple[list, list]:
    prefix = f"ru-or-{TABLES[table][0]}{record:05d}"
    identities = {entry["lexical_identity"] for entry in entries}
    if not identities:
        raise ValueError(f"{prefix}: source morphology needs selected lexical identities")
    if len(identities) > 1:
        return [], [{
            "source_entry": source_locator(table, record), "field": "source morphology",
            "value": row["bare"],
            "reason": "Several lexical homographs share this source row; inflections need an explicit sense-specific linkage.",
        }]
    result, gaps = [], []
    for column, value in row.items():
        if column in GENERAL_FIELDS or not value:
            continue
        for number, marked in enumerate(value.split(","), 1):
            marked = marked.strip()
            try:
                reading, kind = source_reading(marked)
            except ValueError as exc:
                gaps.append({"source_entry": source_locator(table, record), "field": column,
                             "value": marked, "reason": str(exc)})
                continue
            result.append({
                "id": f"{prefix}-f-{column.replace('_', '-')}-{number:02d}",
                "target": unstress(marked), "reading": reading, "reading_kind": kind,
                "lexical_identity": next(iter(identities)),
                "sense_ids": [entry["id"] for entry in entries],
                "source_id": SOURCE_ID, "source_entry": source_locator(table, record),
                "source_field": column, "source_value": marked,
                "features": {"source_form_column": column},
                "limitation": "Source-reported morphology; phrase selection must check intended sense and grammar.",
            })
    return result, gaps


def load_selections(root: Path) -> list[dict]:
    primary = load_yaml(root / "authoring" / "vocabulary.yaml")
    support = load_yaml(root / "authoring" / "support-vocabulary.yaml")
    grammar = load_yaml(root / "authoring" / "grammar-support.yaml")
    if not isinstance(primary, list) or not isinstance(support, list) or not isinstance(grammar, list):
        raise ValueError("Russian primary/support selections must be lists")
    return primary + grammar + support


def reference_outputs(root: Path, tables: dict, *, selections: list | None = None,
                      fixed_links: list | None = None) -> dict[Path, str]:
    program = load_yaml(root / "teaching" / "program.yaml")
    if selections is None:
        selections = load_selections(root)
    if not isinstance(selections, list) or not selections:
        raise ValueError("Russian vocabulary selections must be a nonempty list")
    entries, ids, compact_meanings = [], set(), set()
    parents = defaultdict(list)
    for selection in selections:
        row = validate_selection(selection, tables, set(program["topics"]))
        entry = expanded_selection(selection, row)
        if entry["id"] in ids:
            raise ValueError(f"Duplicate vocabulary sense: {entry['id']}")
        meaning = (entry["target"], entry["reading"], entry["disambiguator"])
        if meaning in compact_meanings:
            raise ValueError(f"Duplicate compact vocabulary meaning: {meaning}")
        ids.add(entry["id"])
        compact_meanings.add(meaning)
        entries.append(entry)
        parents[(selection["source_table"], selection["source_record"])].append(entry)
    forms, gaps = [], []
    for (table, record), senses in parents.items():
        derived, excluded = form_records(table, record, tables[table][record - 1], senses)
        forms.extend(derived)
        gaps.extend(excluded)
    identity_spellings = defaultdict(set)
    for entry in entries:
        identity_spellings[entry["lexical_identity"]].add(entry["target"])
    identity_groups = load_yaml(root / "authoring" / "identity-groups.yaml")
    if not isinstance(identity_groups, list):
        raise ValueError("Russian identity groups must be an authored list")
    for group in identity_groups:
        if (set(group) != {"forms", "source_id", "note"} or group["source_id"] != "original-ru"
                or not isinstance(group["forms"], list) or len(group["forms"]) < 2):
            raise ValueError("An identity group needs explicit forms and original linkage provenance")
        for form in group["forms"]:
            text(form, "identity-group.form")
        text(group["note"], "identity-group.note")
    # Different spellings need an explicit, bounded grammatical identity decision.
    for identity, spellings in identity_spellings.items():
        if len(spellings) != 1:
            matching = [group for group in identity_groups if spellings <= set(group["forms"])]
            if len(matching) != 1:
                raise ValueError(f"{identity}: multiple canonical spellings require explicit identity evidence")
            for entry in entries:
                if entry["lexical_identity"] == identity:
                    entry["identity_provenance"] = matching[0]
    linked = linked_forms(root, tables, entries)
    fixed = fixed_grammar_forms(root, tables, links=fixed_links)
    canonical = {(entry["lexical_identity"], entry["target"], entry["reading"]) for entry in entries}
    surface_readings = {(form["lexical_identity"], form["target"], form["reading"]) for form in forms + linked}
    report = {
        "schema_version": 1,
        "source": SOURCE_ID,
        "revision": REVISION,
        "source_rows": {table: len(rows) for table, rows in tables.items()},
        "selected_source_records": len(parents),
        "selected_vocabulary_senses": len(entries),
        "selected_source_sense_spans": len({
            (entry["source_entry"], entry["selected_source_span"]["start"], entry["selected_source_span"]["end"])
            for entry in entries
        }),
        "selected_lexical_headwords": len(identity_spellings),
        "selected_canonical_spellings": len({entry["target"] for entry in entries}),
        "selected_canonical_readings": len({entry["reading"] for entry in entries}),
        "selected_orthographic_aliases": 0,
        "retained_source_form_records": len(forms),
        "linked_pronoun_form_records": len(linked),
        "distinct_noncanonical_lexical_forms": len(surface_readings - canonical),
        "fixed_construction_form_records": len(fixed),
        "reading_kinds": dict(Counter(entry["reading_provenance"]["kind"] for entry in entries)),
        "excluded_source_form_reading_count": len(gaps),
        "excluded_source_form_reading_examples": gaps[:50],
        "form_gap_reporting": "At most fifty examples are retained here; rerunning the source adapter reproduces every exclusion.",
        "interpretation": "Selected reference coverage, not learner knowledge. Source forms and aliases add no headwords.",
        "form_counting": "Source form records count column/alternative attestations. Distinct noncanonical lexical forms count lexical-identity/spelling/reading triples, exclude canonical readings, and include linked pronoun forms; these are reference morphology, not separate taught words.",
        "source_limitations": [
            "The old composite source has incomplete metadata and mixed senses; source fidelity is not linguistic certification.",
            "Part of speech, selected meanings, concise hints and teaching placement are separately authored judgments.",
            "No source word/sense IDs, corpus frequency ranks or underlying Wiktionary revision are supplied by this export.",
            "TSV quotes are literal. The known extra tab in others data-record 2676 is retained within its final German field; no source records are reordered.",
        ],
    }
    return {
        root / "reference" / "vocabulary.yaml": dump_yaml([normalized_reference(entry) for entry in entries]),
        root / "build" / "lexical-records.yaml": dump_yaml(entries),
        root / "build" / "linked-forms.yaml": dump_yaml(linked),
        root / "build" / "grammar-forms.yaml": dump_yaml(fixed),
        root / "normalization-report.yaml": dump_yaml(report),
        **fixture_outputs(root, tables),
    }


def fixed_grammar_forms(root: Path, tables: dict, *, links: list | None = None) -> list[dict]:
    if links is None:
        links = load_yaml(root / "authoring" / "fixed-form-links.yaml")
    if not isinstance(links, list):
        raise ValueError("Fixed construction form links must be an authored list")
    result, seen = [], set()
    for link in links:
        if set(link) != {"id", "grammar_id", "source_table", "source_record", "source_field"}:
            raise ValueError("Fixed construction form link has invalid fields")
        table, record = link["source_table"], link["source_record"]
        if (not isinstance(table, str) or table not in tables or type(record) is not int
                or not 1 <= record <= len(tables[table])):
            raise ValueError("Fixed construction form has an invalid source record")
        identifier = text(link["id"], "fixed-form.id")
        grammar_id = text(link["grammar_id"], "fixed-form.grammar_id")
        if not re.fullmatch(r"ru-g-[a-z0-9]+(?:-[a-z0-9]+)*", grammar_id) or identifier in seen:
            raise ValueError("Fixed construction form has an invalid or repeated identity")
        seen.add(identifier)
        raw = tables[table][record - 1]
        field = link["source_field"]
        if not isinstance(field, str) or (field != "accented" and field in GENERAL_FIELDS) or field not in raw:
            raise ValueError("Fixed construction form must identify a source reading/form column")
        reading, kind = source_reading(raw[field])
        result.append({
            "id": identifier, "grammar_id": grammar_id, "target": unstress(reading),
            "reading": reading, "reading_kind": kind, "source_id": SOURCE_ID,
            "source_entry": source_locator(table, record), "source_field": field,
            "source_data": dict(raw), "source_record_sha256": fingerprint(raw),
            "linkage_source_id": "original-ru",
            "limitation": "Source-backed spelling/reading with original construction linkage; no lexical sense credit.",
        })
    return result


def linked_forms(root: Path, tables: dict, entries: list[dict]) -> list[dict]:
    links = load_yaml(root / "authoring" / "form-links.yaml")
    if not isinstance(links, list):
        raise ValueError("Form links must be an authored list")
    result, seen = [], set()
    for link in links:
        if set(link) != {"source_table", "source_record", "lemma", "features", "note"}:
            raise ValueError("Form link has invalid fields")
        table, record = link["source_table"], link["source_record"]
        if (not isinstance(table, str) or table not in tables or type(record) is not int
                or not 1 <= record <= len(tables[table])):
            raise ValueError("Form link has an invalid source record")
        row = tables[table][record - 1]
        senses = [entry for entry in entries if entry["target"] == link["lemma"]
                  and entry["part_of_speech"] == "pronoun"]
        identities = {sense["lexical_identity"] for sense in senses}
        if len(identities) != 1:
            raise ValueError(f"Form link needs one selected pronoun identity: {link['lemma']}")
        if (not isinstance(link["features"], list) or not link["features"]
                or any(feature not in {"genitive", "accusative", "dative", "prepositional"}
                       for feature in link["features"])):
            raise ValueError("Form link has invalid case features")
        note = text(link["note"], "form-link.note")
        identifier = f"ru-or-{TABLES[table][0]}{record:05d}-linked-form"
        if identifier in seen:
            raise ValueError(f"Repeated form link: {identifier}")
        seen.add(identifier)
        reading, kind = source_reading(row["accented"], target=row["bare"])
        result.append({
            "id": identifier, "target": row["bare"], "reading": reading, "reading_kind": kind,
            "lexical_identity": next(iter(identities)), "sense_ids": [sense["id"] for sense in senses],
            "source_id": SOURCE_ID, "source_entry": source_locator(table, record),
            "source_data": dict(row), "source_record_sha256": fingerprint(row),
            "features": {"cases": link["features"]},
            "linkage_provenance": {"source_id": "original-ru", "note": note},
            "limitation": "Source spelling/reading with separately authored grammatical linkage; adds no lexical headword.",
        })
    return result


def fixture_outputs(root: Path, tables: dict) -> dict[Path, str]:
    records = []
    for table, numbers in FIXTURE_RECORDS.items():
        for number in numbers:
            row = tables[table][number - 1]
            records.append({
                "table": table, "record": number, "row_sha256": fingerprint(row),
                "source_entry": source_locator(table, number), "source_data": dict(row),
            })
    document = {
        "schema_version": 1, "source_id": SOURCE_ID, "revision": REVISION,
        "attribution": "OpenRussian and upstream contributors; CC-BY-SA-4.0. See ../sources.yaml and ../licenses/CC-BY-SA-4.0.txt.",
        "purpose": "Small real-source conformance fixture, not a vocabulary inventory or source-verified teaching selection.",
        "records": records,
    }
    return {root / "source-snapshots" / "openrussian-fixture.yaml": dump_yaml(document)}


def write_outputs(outputs: dict[Path, str], *, check: bool = False) -> None:
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Missing or stale Russian view: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
