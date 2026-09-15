"""Resolve Japanese teaching selections against the retained JMdict snapshot."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
import unicodedata

from curriculum_yaml import dump_entries, load_yaml
from generate_curriculum_tokens import label, records, text
from generate_practical_program import (
    dependency_closure, fields, id_list, load_inputs, normalized_surface, placement_rows,
    validate_dependencies, validate_model,
)
from generate_teaching_track import resolve_sequence, teaching_outputs
from import_japanese_curriculum import DICTIONARY_VERSION, KANA, MAPPING_HASHES, applies, digest
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SeedUnit, SurfaceSegment,
)


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "japanese"
LEVELS = ("n5", "n4", "n3", "n2", "n1")
PROFILE = ProgramProfile("japanese", "ja")


def original_paths(root: Path) -> list[Path]:
    # Other features may add their own upstream assets and license notices.
    return [
        *(root / f"jlpt-{level}" / filename
          for level in LEVELS for filename in ("vocabulary.yaml", "grammar.yaml", "syllabus.md")),
        root / "teaching" / "grammar.tsv",
        root / "import-report.yaml",
        *(root / "upstream" / filename for filename in (
            "download-lock.json", "jmdict-selected.json",
            *(f"waller-{level}.csv" for level in reversed(LEVELS)),
        )),
        *(root / "licenses" / filename for filename in (
            "CC-BY-SA-4.0.txt", "EDRDG-license.html", "Waller-sharing.html",
            "yomitan-jlpt-vocab-README.md",
        )),
    ]


def source_manifest(root: Path) -> dict:
    return {str(path.relative_to(root)).replace("\\", "/"): digest(path.read_bytes())
            for path in original_paths(root)}


def verify_sources(root: Path) -> dict:
    manifest = load_yaml(root / "authoring" / "teaching" / "source-lock.yaml")
    if manifest != source_manifest(root):
        raise ValueError("Original Japanese reference/source files differ from the frozen source manifest")
    upstream = root / "upstream"
    lock = json.loads((upstream / "download-lock.json").read_text(encoding="utf-8"))
    raw = (upstream / "jmdict-selected.json").read_bytes()
    if lock["dictionary_release"] != DICTIONARY_VERSION or digest(raw) != lock["selected_dictionary_sha256"]:
        raise ValueError("Japanese dictionary snapshot does not match its pinned release/hash")
    for level, expected in MAPPING_HASHES.items():
        if digest((upstream / f"waller-{level}.csv").read_bytes()) != expected:
            raise ValueError(f"Japanese mapping checksum changed: {level}")
    return json.loads(raw)


def entry_number(parent: dict) -> str:
    match = re.fullmatch(r"JMdict:(\d+);waller-n[1-5]\.csv:line-\d+", parent["source_entry"])
    if not match:
        raise ValueError(f"{parent['id']}: invalid preserved JMdict mapping locator")
    return match[1]


def selected_sense(parent: dict, word: dict, ordinal: int, disambiguator: str,
                   snapshot: str, spelling: str | None = None) -> dict:
    if type(ordinal) is not int or not 1 <= ordinal <= len(word["sense"]):
        raise ValueError(f"{parent['id']}: raw JMdict sense ordinal does not exist")
    identifier = f"{parent['id']}-s{ordinal:03d}"
    label(disambiguator, identifier)
    if str(word["id"]) != entry_number(parent):
        raise ValueError(f"{identifier}: dictionary entry does not match its preserved parent")
    reading = text(parent["reading"], f"{identifier}.reading")
    if not KANA.fullmatch(reading):
        raise ValueError(f"{identifier}: documented pronunciation must be kana")
    matching = [item for item in word["kana"] if item["text"] == reading]
    if not matching:
        raise ValueError(f"{identifier}: parent reading is absent from JMdict")
    target = text(spelling if spelling is not None else parent["target"], f"{identifier}.target")
    written = {item["text"] for item in word["kanji"]}
    if target in written:
        if not any(applies(item["appliesToKanji"], target) for item in matching):
            raise ValueError(f"{identifier}: spelling violates the kana reading restriction")
    elif target != reading:
        raise ValueError(f"{identifier}: teaching spelling is not a verified source form")
    source = word["sense"][ordinal - 1]
    if not applies(source["appliesToKana"], reading) or not applies(source["appliesToKanji"], target):
        raise ValueError(f"{identifier}: sense is incompatible with the selected spelling/reading")
    glosses = [gloss["text"] for gloss in source["gloss"] if gloss["lang"] == "eng"]
    if not glosses or not re.search(r"[A-Za-z]", " ".join(glosses)):
        raise ValueError(f"{identifier}: source sense has no English gloss")
    return {
        "id": identifier, "target": target, "reading": reading,
        "english": "; ".join(glosses), "disambiguator": disambiguator,
        "source_entry": parent["source_entry"], "source_id": parent["source_id"],
        "source_snapshot": snapshot, "raw_sense_ordinal": ordinal,
        "reading_restrictions": [deepcopy(item) for item in matching],
        "source_sense": deepcopy(source),
    }


def reference_selections(root: Path, inputs: dict, dictionary: dict, spellings: dict
                         ) -> tuple[ReferenceBundle, list[dict]]:
    parents, source_grammar = {}, {}
    for level in LEVELS:
        for row in load_yaml(root / f"jlpt-{level}" / "vocabulary.yaml"):
            if row["id"] in parents:
                raise ValueError(f"Duplicate preserved Japanese parent ID: {row['id']}")
            parents[row["id"]] = row
        for row in load_yaml(root / f"jlpt-{level}" / "grammar.yaml"):
            if row["id"] in source_grammar:
                raise ValueError(f"Duplicate original Japanese construction ID: {row['id']}")
            source_grammar[row["id"]] = row
    labels = {}
    for row in placement_rows(inputs["vocabulary"], inputs["program"]):
        identifier = row["id"]
        disambiguator = label(row["ds"], identifier)
        if identifier in labels and labels[identifier] != disambiguator:
            raise ValueError(f"Conflicting Japanese vocabulary selection: {identifier}")
        labels[identifier] = disambiguator
    if not isinstance(inputs["support"], dict):
        raise ValueError("Japanese support labels must be a mapping")
    for identifier, disambiguator in inputs["support"].items():
        label(disambiguator, identifier)
        if identifier in labels and labels[identifier] != disambiguator:
            raise ValueError(f"{identifier}: conflicting Japanese support disambiguator")
        labels[identifier] = disambiguator
    if not isinstance(spellings, dict) or not set(spellings) <= set(labels):
        raise ValueError("Japanese spelling overrides must refer to selected sense IDs")
    for identifier, form in spellings.items():
        text(form, f"{identifier}.teaching_spelling")
    indexed = {str(word["id"]): word for word in dictionary["words"]}
    expanded, words, provenance, lexical, senses, readings, written = {}, {}, {}, {}, {}, {}, {}
    for identifier, disambiguator in labels.items():
        match = re.fullmatch(r"(ja-n[1-5]-\d{5})-s(\d{3})", identifier)
        if not match or match[1] not in parents:
            raise ValueError(f"{identifier}: no preserved Japanese parent for this local sense ID")
        parent = parents[match[1]]
        seq = entry_number(parent)
        if seq not in indexed:
            raise ValueError(f"{identifier}: source dictionary entry is absent")
        sense = selected_sense(parent, indexed[seq], int(match[2]), disambiguator,
                               DICTIONARY_VERSION, spellings.get(identifier))
        expanded.setdefault(parent["id"], {**deepcopy(parent), "senses": []})["senses"].append(sense)
        words[identifier] = {
            "id": identifier, "ch": sense["target"], "pr": sense["reading"], "ds": disambiguator,
        }
        provenance[identifier] = sense
        lexical[identifier] = f"JMdict:{seq}"
        senses[identifier] = f"JMdict:{seq}@{DICTIONARY_VERSION}:raw-sense-{int(match[2])}"
        readings[identifier] = sense["reading"]
        written[identifier] = sense["target"]
    patterns = {}
    for row in placement_rows(inputs["grammar"], inputs["program"], grammar=True):
        identifier = row["id"]
        if identifier not in source_grammar:
            raise ValueError(f"Unknown original Japanese construction: {identifier}")
        label(row["ds"], identifier)
        pattern = {key: row[key] for key in ("id", "ch", "ds")}
        if identifier in patterns and patterns[identifier] != pattern:
            raise ValueError(f"Conflicting original Japanese construction: {identifier}")
        patterns[identifier] = pattern
        original = source_grammar[identifier]
        provenance[identifier] = {
            **deepcopy(original), "source_entry": f"jlpt-{identifier.split('-')[1]}/grammar.yaml#{identifier}",
            "token_form": row["ch"], "disambiguator": row["ds"],
        }
    return ReferenceBundle(words, patterns, lexical, provenance, senses, readings, written), list(expanded.values())


FIXED_CONSTRUCTION_FORMS = {
    "ja-n5-g001": {("\u3067\u3059", "\u3067\u3059")},
    "ja-n5-g003": {("\u304b", "\u304b")},
    "ja-n5-g004": {("\u306f", "\u308f")},
    "ja-n5-g005": {("\u304c", "\u304c")},
    "ja-n5-g006": {("\u3092", "\u304a")},
    "ja-n5-g007": {("\u306e", "\u306e")},
    "ja-n5-g009": {("\u3067", "\u3067")},
    "ja-n5-g010": {("\u306b", "\u306b"), ("\u304c", "\u304c")},
    "ja-n5-g011": {("\u306b", "\u306b"), ("\u304c", "\u304c")},
    "ja-n5-g012": {("\u306b", "\u306b"), ("\u3078", "\u3048")},
    "ja-n5-g013": {("\u3067", "\u3067")},
    "ja-n5-g014": {("\u306b", "\u306b")},
    "ja-n5-g020": {("\u3067\u3059", "\u3067\u3059")},
    "ja-n5-g022": {("\u3067\u3057\u305f", "\u3067\u3057\u305f")},
    "ja-n2-g042": {("\u629c\u304d\u3067", "\u306c\u304d\u3067")},
}
CANONICAL_CONSTRUCTION_POS = {
    "ja-n5-g019": {"adj-pn"},
    "ja-n5-g020": {"adj-i", "adj-ix"},
    "ja-n5-g021": {"adj-na"},
    "ja-n5-g042": {"num", "ctr"},
}
# Whole-word examples documented in grammar-notes.md and the tourist route.
# These are not a rule for concatenating arbitrary numeral/counter readings.
COUNTED_READINGS = {
    (number, counter): (written, reading)
    for counter in ("ja-n5-00572-s005", "ja-n5-00572-s007")
    for number, written, reading in (
        ("ja-n5-00056-s001", "\u4e00\u672c", "\u3044\u3063\u307d\u3093"),
        ("ja-n5-00269-s001", "\u4e09\u672c", "\u3055\u3093\u307c\u3093"),
        ("ja-n5-00673-s001", "\u516d\u672c", "\u308d\u3063\u307d\u3093"),
    )
}
COUNTED_READINGS[("ja-n5-00331-s001", "ja-n3-00170-s001")] = (
    "\u5343\u5186", "\u305b\u3093\u3048\u3093",
)
COUNTED_NOUN_SURFACES = {"\u5186"}


def source_pos(identifier: str, references: ReferenceBundle) -> set[str]:
    source = references.provenance.get(identifier, {}).get("source_sense", {})
    values = source.get("partOfSpeech")
    if not isinstance(values, list) or not values or any(not isinstance(value, str) for value in values):
        raise ValueError(f"{identifier}: a form needs retained raw JMdict part-of-speech evidence")
    return set(values)


def validate_counted_reading(identifier: str, items: tuple[str, ...], written: str,
                             reading: str, references: ReferenceBundle) -> None:
    expected = COUNTED_READINGS.get(items)
    if (expected != (written, reading)
            or written != "".join(references.vocabulary[item]["ch"] for item in items)
            or "num" not in source_pos(items[0], references)):
        raise ValueError(f"{identifier}: quantity needs a licensed whole-word counter/number reading")


def validate_quantity_boundaries(identifier: str, written: str, segments: list[SurfaceSegment],
                                 references: ReferenceBundle) -> None:
    surface = unicodedata.normalize("NFC", written)
    forms = [normalized_surface(segment.ch) for segment in segments]
    if normalized_surface(surface) != "".join(forms):
        raise ValueError(f"{identifier}: uncovered or mismatched Japanese written phrase")
    positions = [index for index, character in enumerate(surface) if normalized_surface(character)]
    offset, previous_end = 0, 0
    pending = []

    def check():
        if len(pending) > 1:
            validate_counted_reading(
                identifier, tuple(item for segment in pending for item in segment.items),
                "".join(segment.ch for segment in pending), "".join(segment.pr for segment in pending),
                references,
            )

    for segment, form in zip(segments, forms):
        if form:
            start = positions[offset]
            # Explicit list/sentence punctuation separates quantities; spacing alone does not.
            if any(not character.isspace() for character in surface[previous_end:start]):
                check()
                pending = []
            offset += len(form)
            previous_end = positions[offset - 1] + 1
        parts = [source_pos(item, references) for item in segment.items]
        if segment.items and (pending or any("num" in part for part in parts)) and all(
            part & {"num", "ctr"}
            or references.vocabulary[item]["ch"] in COUNTED_NOUN_SURFACES
            for item, part in zip(segment.items, parts)
        ):
            pending.append(segment)
        else:
            check()
            pending = []
    check()


def word_inflections(entry: dict, pos: set[str]) -> list[tuple[str, str, set[str], set[str]]]:
    """Derive bounded word forms from a verified whole-word spelling and reading."""
    written, reading = entry["ch"], entry["pr"]
    stem = te = None
    if pos & {"v1", "v1-s"} and written.endswith("\u308b") and reading.endswith("\u308b"):
        stem = (written[:-1], reading[:-1])
        te = (stem[0] + "\u3066", stem[1] + "\u3066")
    elif "vk" in pos and reading.endswith("\u304f\u308b"):
        if written.endswith(("\u6765\u308b", "\u4f86\u308b")):
            stem = (written[:-1], reading[:-2] + "\u304d")
        elif written.endswith("\u304f\u308b"):
            stem = (written[:-2] + "\u304d", reading[:-2] + "\u304d")
        if stem is not None:
            te = (stem[0] + "\u3066", stem[1] + "\u3066")
    elif pos & {"vs", "vs-i", "vs-s"}:
        if written.endswith("\u3059\u308b") and reading.endswith("\u3059\u308b"):
            stem = (written[:-2] + "\u3057", reading[:-2] + "\u3057")
        elif "vs" in pos:
            stem = (written + "\u3057", reading + "\u3057")
        if stem is not None:
            te = (stem[0] + "\u3066", stem[1] + "\u3066")
    else:
        endings = {
            "v5u": ("\u3046", "\u3044", "\u3063\u3066"),
            "v5k": ("\u304f", "\u304d", "\u3044\u3066"),
            "v5k-s": ("\u304f", "\u304d", "\u3063\u3066"),
            "v5g": ("\u3050", "\u304e", "\u3044\u3067"),
            "v5s": ("\u3059", "\u3057", "\u3057\u3066"),
            "v5t": ("\u3064", "\u3061", "\u3063\u3066"),
            "v5n": ("\u306c", "\u306b", "\u3093\u3067"),
            "v5b": ("\u3076", "\u3073", "\u3093\u3067"),
            "v5m": ("\u3080", "\u307f", "\u3093\u3067"),
            "v5r": ("\u308b", "\u308a", "\u3063\u3066"),
            "v5r-i": ("\u308b", "\u308a", "\u3063\u3066"),
        }
        matching = [endings[tag] for tag in pos if tag in endings]
        if len(matching) == 1:
            ending, polite, connective = matching[0]
            if written.endswith(ending) and reading.endswith(ending):
                stem = (written[:-1] + polite, reading[:-1] + polite)
                te = (written[:-1] + connective, reading[:-1] + connective)
    if stem is None or te is None:
        return []
    forms = []

    def add(base, suffix, required, optional=()):
        forms.append((base[0] + suffix, base[1] + suffix, {required}, {required, *optional}))

    existence = ()
    if reading == "\u3042\u308b" and "v5r-i" in pos:
        existence = ("ja-n5-g010",)
    elif reading == "\u3044\u308b" and "v1" in pos:
        existence = ("ja-n5-g011",)
    add(stem, "\u307e\u3059", "ja-n5-g023", existence)
    add(stem, "\u307e\u305b\u3093", "ja-n5-g024", ("ja-n5-g023", *existence))
    add(stem, "\u307e\u3057\u305f", "ja-n5-g025", ("ja-n5-g023", "ja-n5-g024"))
    add(stem, "\u305f\u3044", "ja-n5-g031", ("ja-n5-g023",))
    add(stem, "\u305f\u3044\u3067\u3059", "ja-n5-g031", ("ja-n5-g023", "ja-n5-g020"))
    add(stem, "\u307e\u3057\u3087\u3046", "ja-n5-g034", ("ja-n5-g023",))
    add(te, "", "ja-n5-g041", ("ja-n5-g023",))
    add(te, "\u304f\u3060\u3055\u3044", "ja-n5-g026", ("ja-n5-g041", "ja-n5-g023"))
    add(te, "\u3044\u307e\u3059", "ja-n5-g027", ("ja-n5-g041", "ja-n5-g023"))
    add(te, "\u3044\u307e\u3059", "ja-n4-g042", ("ja-n5-g027", "ja-n5-g041", "ja-n5-g023"))
    return forms


def validate_atomic_form(identifier: str, form: dict, references: ReferenceBundle) -> None:
    grammar = set(form["grammar"])
    if len(form["items"]) > 1 and grammar == {"ja-n5-g042"}:
        validate_counted_reading(
            identifier, tuple(form["items"]), form["ch"], form["pr"], references,
        )
        return
    if not form["items"]:
        if len(grammar) != 1 or (form["ch"], form["pr"]) not in FIXED_CONSTRUCTION_FORMS.get(
                next(iter(grammar)), set()):
            raise ValueError(f"{identifier}: unsupported fixed Japanese construction realization")
        return
    if len(form["items"]) != 1:
        raise ValueError(f"{identifier}: a Japanese inflected form must contain exactly one lexical sense")
    item = form["items"][0]
    candidates = word_inflections(references.vocabulary[item], source_pos(item, references))
    if not any((form["ch"], form["pr"]) == (written, reading) and required <= grammar <= allowed
               for written, reading, required, allowed in candidates):
        raise ValueError(f"{identifier}: form is not a source-backed inflection licensed by its constructions")


def validate_form_annotations(forms: dict, references: ReferenceBundle, source_ids: set[str]) -> None:
    if not isinstance(forms, dict):
        raise ValueError("Japanese form annotations must be an explicit mapping")
    for identifier, form in forms.items():
        text(identifier, "form.id")
        fields(form, {"ch", "pr", "items", "grammar", "source_id", "note"}, identifier)
        for field in ("ch", "pr", "source_id", "note"):
            text(form[field], f"{identifier}.{field}")
        if not KANA.fullmatch(form["pr"]):
            raise ValueError(f"{identifier}: phrase realization reading must be documented kana")
        if form["source_id"] not in source_ids:
            raise ValueError(f"{identifier}: unknown form annotation source")
        for kind, available in (("items", references.vocabulary), ("grammar", references.grammar)):
            values = form[kind]
            if (not isinstance(values, list) or any(not isinstance(item, str) for item in values)
                    or len(values) != len(set(values)) or not set(values) <= set(available)):
                raise ValueError(f"{identifier}: unknown or repeated {kind} links")
        if not form["grammar"]:
            raise ValueError(f"{identifier}: noncanonical Japanese forms must name a licensing construction")
        for construction, written, spoken in (
            ("ja-n5-g004", "\u306f", "\u308f"),
            ("ja-n5-g006", "\u3092", "\u304a"),
            ("ja-n5-g012", "\u3078", "\u3048"),
        ):
            if construction in form["grammar"] and form["ch"] == written and form["pr"] != spoken:
                raise ValueError(f"{identifier}: fixed particle reading differs from its documented pronunciation")
        validate_atomic_form(identifier, form, references)


class JapaneseAdapter:
    profile = PROFILE

    def __init__(self):
        self.forms = {}

    def load(self, root: Path) -> ProgramData:
        dictionary = verify_sources(root)
        inputs = load_inputs(root)
        validate_model(inputs["program"], inputs["mastery"], PROFILE)
        authoring = root / "authoring" / "teaching"
        references, expanded = reference_selections(
            root, inputs, dictionary, load_yaml(authoring / "spellings.yaml"),
        )
        sources = {source["id"] for source in load_yaml(root / "sources.yaml")}
        self.forms = load_yaml(authoring / "forms.yaml")
        validate_form_annotations(self.forms, references, sources)
        coverage = load_yaml(authoring / "coverage.yaml")
        if not isinstance(coverage, dict):
            raise ValueError("Japanese coverage decisions must be a mapping")
        exemplars = coverage.get("core_illustrative_lexemes", {})
        if not isinstance(exemplars, dict):
            raise ValueError("Japanese core illustrations must be a construction-to-lexeme mapping")
        core_ids = {row["id"] for row in inputs["vocabulary"] if type(row["level"]) is int}
        for construction, identifiers in exemplars.items():
            if construction not in references.grammar:
                raise ValueError(f"{construction}: unknown construction in Japanese core illustrations")
            examples = id_list(identifiers, references.vocabulary, f"{construction}.core_illustrations")
            if not set(examples) <= core_ids:
                raise ValueError(f"{construction}: illustrative lexemes must retain explicit core selections")
        dependencies = coverage.get("construction_dependencies", {})
        validate_dependencies(dependencies, references.grammar)
        dependencies = {identifier: tuple(required) for identifier, required in dependencies.items()}
        anchors = {row["id"]: row["anchors"] for row in inputs["grammar"]}
        seed_rows = records(load_yaml(authoring / "beginner.yaml"), "Japanese beginner seeds")
        for row in seed_rows:
            fields(row, {"level", "topic", "unit"}, "Japanese beginner seed")
        beginner = resolve_sequence({
            "schema_version": 1, "id": "ja-beginner", "title": "Practical Japanese beginner",
            "language": "japanese", "level_basis": inputs["program"]["level_basis"],
            "review_policy": inputs["program"]["review_policy"],
            "units": [row["unit"] for row in seed_rows],
        }, references.vocabulary, references.grammar, language="japanese", prefix="ja")
        seeds = tuple(SeedUnit(row["level"], row["topic"], unit)
                      for row, unit in zip(seed_rows, beginner["units"]))
        dependency_closure(beginner["units"], dependencies, anchors)
        tourist = inputs["tourist"]
        tourist_units = resolve_sequence({
            **{key: value for key, value in tourist.items() if key not in ("units", "quick_start")},
            "units": [{key: value for key, value in unit.items() if key != "phrases"}
                      for unit in tourist["units"]],
        }, references.vocabulary, references.grammar, language="japanese", prefix="ja")
        dependency_closure(tourist_units["units"], dependencies, anchors)
        for kind in ("vocabulary", "grammar"):
            placed = {row["id"]: row for row in inputs[kind] if type(row["level"]) is int}
            seed_ids = set()
            for seed in seeds:
                for entry in seed.unit[kind]:
                    row = placed.get(entry["id"])
                    if row is None or row["level"] != seed.level:
                        raise ValueError(f"{entry['id']}: beginner seed differs from its authored placement")
                    seed_ids.add(entry["id"])
            if {row["id"] for row in inputs[kind] if type(row["level"]) is int and row["level"] <= 4} != seed_ids:
                raise ValueError(f"Japanese first-four-level {kind} placements must match beginner introductions")
            inputs[kind] = [row for row in inputs[kind]
                            if type(row["level"]) is not int or row["id"] not in seed_ids]
        source_outputs = {
            root / "reference-senses.yaml": dump_entries(expanded),
            **teaching_outputs(root / "teaching" / "beginner", beginner,
                               references.vocabulary, references.grammar, language="japanese", prefix="ja"),
        }
        return ProgramData(inputs, references, seeds, dependencies, source_outputs)

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        if not KANA.fullmatch(phrase["pr"]):
            raise ValueError(f"{phrase['id']}: phrase reading must be documented kana without pitch accents")
        segments = []
        for segment in phrase["realizations"]:
            form_id = segment.get("form_id")
            if form_id is not None:
                form = self.forms.get(form_id)
                if form is None:
                    raise ValueError(f"{phrase['id']}: unlicensed Japanese form_id {form_id}")
                if {key: form[key] for key in ("ch", "pr", "items", "grammar")} != {
                    key: segment[key] for key in ("ch", "pr", "items", "grammar")
                }:
                    raise ValueError(f"{phrase['id']}: Japanese realization differs from its licensed form")
                validate_atomic_form(form_id, form, context.references)
            else:
                items = segment["items"]
                if len(items) != 1 or items[0] not in context.references.vocabulary:
                    raise ValueError(f"{phrase['id']}: canonical realization needs one known lexical sense")
                canonical = context.references.vocabulary[items[0]]
                if (segment["ch"], segment["pr"]) != (canonical["ch"], canonical["pr"]):
                    raise ValueError(f"{phrase['id']}: inflected Japanese realization needs a licensed form")
                if segment["grammar"]:
                    pos = source_pos(items[0], context.references)
                    if any(not pos & CANONICAL_CONSTRUCTION_POS.get(construction, set())
                           for construction in segment["grammar"]):
                        raise ValueError(f"{phrase['id']}: canonical construction link lacks source POS licensing")
            segments.append(SurfaceSegment(
                segment["ch"], segment["pr"], tuple(segment["items"]),
                tuple(segment["grammar"]), form_id,
            ))
        validate_quantity_boundaries(phrase["id"], phrase["ch"], segments, context.references)
        return PhraseAnalysis(tuple(phrase["items"]), tuple(phrase["grammar"]), tuple(segments))


ADAPTER = JapaneseAdapter()
