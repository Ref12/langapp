"""Normalize selected French dictionary records and independently authored grammar.

Source acquisition is separate from offline regeneration. Only selected source
fields are retained; quotations, dictionary examples, and audio are not copied.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import quote

from curriculum_yaml import dump_yaml, load_yaml


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "french"
KAIKKI_URL = "https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz"
KAIKKI_HASH = "efae9ffb69cb74e4376711c05df77b9571d76dff70bd14bd094562dc00cd81f7"
LEXIQUE_URL = "http://www.lexique.org/databases/Lexique383/Lexique383.tsv"
LEXIQUE_HASH = "637ba37a767a66679c48371d673ece50cbf541b49a4e40e598963d4f3fbce52b"
SOURCE_ID = "kaikki-enwiktionary-french-20260902"
LEXIQUE_ID = "lexique-3.83"
ORIGINAL_SOURCE = "original-fr"
EXCLUDED_TAGS = {
    "archaic", "obsolete", "dated", "rare", "historical", "offensive",
    "derogatory", "vulgar", "slur", "nonstandard", "misspelling",
    "form-of", "alt-of", "taxonomic",
}
POS_MAP = {
    "NOM": "noun", "VER": "verb", "AUX": "verb", "ADJ": "adj",
    "ADV": "adv", "PRO": "pron", "PRE": "prep", "CON": "conj",
    "ART": "article", "ADJ:num": "num",
}
POS_PRIORITY = ("verb", "noun", "adj", "adv", "pron", "article", "det",
                "prep", "conj", "intj", "num", "particle", "phrase",
                "prep_phrase", "contraction")
SENSE_FIELDS = ("id", "glosses", "raw_glosses", "tags", "topics", "form_of", "alt_of")
LEXIQUE_FIELDS = (
    "ortho", "phon", "lemme", "cgram", "genre", "nombre", "infover", "islem",
    "freqlemfilms2", "freqlemlivres",
)
CORE_FIELDS = ("id", "ch", "pr", "ds")
PHONETIC_SYMBOLS = {
    **{symbol: symbol for symbol in "abdefijklmnopstuvwyz"},
    "g": "ɡ", "R": "ʁ", "E": "ɛ", "O": "ɔ", "S": "ʃ", "Z": "ʒ",
    "N": "ɲ", "G": "ŋ", "x": "x", "2": "ø", "9": "œ", "8": "ɥ",
    "5": "ɛ̃", "1": "œ̃", "@": "ɑ̃", "§": "ɔ̃", "°": "ə", "3": "ə",
}


def phonetic_ipa(value: str) -> str:
    if not value or set(value) - PHONETIC_SYMBOLS.keys():
        raise ValueError(f"Unknown or empty Lexique phonetic code: {value!r}")
    return "/" + "".join(PHONETIC_SYMBOLS[symbol] for symbol in value) + "/"


def lexical_pos(value: str) -> str | None:
    if value.startswith("PRO:"):
        return "pron"
    if value.startswith("ART:"):
        return "article"
    if value in ("ADJ:dem", "ADJ:ind", "ADJ:int", "ADJ:pos"):
        return "det"
    if value == "ONO":
        return "intj"
    return POS_MAP.get(value)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stable_id(kind: str, identity: str) -> str:
    suffix = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"fr-{kind}-{suffix}"


def authoring_fields(value: dict, required: set[str], optional: set[str] | frozenset[str] = frozenset()) -> None:
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - optional:
        raise ValueError(f"French authored record requires {sorted(required)}; got {value!r}")


def authoring_text(value: str, location: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\ufffd" in value:
        raise ValueError(f"{location}: expected nonempty, uncorrupted text")
    return value


def authoring_label(value: str, location: str) -> str:
    authoring_text(value, location)
    if len(value) > 64 or not re.search(r"[A-Za-z]", value):
        raise ValueError(f"{location}: English disambiguator must have at most 64 characters")
    return value


def compile_grammar(definitions: list[dict], words: dict, program: dict) -> tuple:
    patterns, provenance, dependencies, placements, references = {}, {}, {}, [], []
    required = {"id", "level", "topic", "ch", "ds", "note", "examples", "anchor_words", "requires"}
    for row in definitions:
        authoring_fields(row, required)
        identifier = authoring_text(row["id"], "grammar.id")
        if not re.fullmatch(r"fr-g-[a-z0-9]+(?:-[a-z0-9]+)*", identifier) or identifier in patterns:
            raise ValueError(f"Invalid or repeated French construction ID: {identifier}")
        if row["topic"] not in program["topics"]:
            raise ValueError(f"{identifier}: unknown topic")
        pattern = authoring_text(row["ch"], identifier)
        disambiguator = authoring_label(row["ds"], identifier)
        authoring_text(row["note"], identifier)
        if not isinstance(row["examples"], list) or len(row["examples"]) < 2:
            raise ValueError(f"{identifier}: two original bilingual examples are required")
        for example in row["examples"]:
            authoring_fields(example, {"target", "english"})
            authoring_text(example["target"], identifier)
            authoring_text(example["english"], identifier)
        if not isinstance(row["anchor_words"], list) or not isinstance(row["requires"], list):
            raise ValueError(f"{identifier}: anchors and prerequisites must be lists")
        if len(row["anchor_words"]) != len(set(row["anchor_words"])):
            raise ValueError(f"{identifier}: repeated lexical anchor")
        anchors = []
        for word in row["anchor_words"]:
            if word not in words:
                raise ValueError(f"{identifier}: unknown lexical anchor {word}")
            anchors.append(words[word]["id"])
        patterns[identifier] = {"id": identifier, "ch": pattern, "ds": disambiguator}
        dependencies[identifier] = tuple(row["requires"])
        source_file = "tourist-grammar.yaml" if row["level"] == "tourist" else "grammar-definitions.yaml"
        provenance[identifier] = {
            "source_id": ORIGINAL_SOURCE,
            "source_entry": f"local:curriculum/french/authoring/teaching/{source_file}#{identifier}",
            "note": row["note"], "examples": row["examples"],
            "anchors": anchors, "requires": row["requires"], "level": row["level"],
            "status": "Original AI-assisted teaching explanation and examples; not human certified.",
        }
        references.append({
            "id": identifier, "pattern": pattern, "english": disambiguator,
            "note": row["note"], "examples": row["examples"], "source_id": ORIGINAL_SOURCE,
            "level_basis": "Independent original teaching construction; no official proficiency band.",
        })
        if row["level"] != "tourist":
            placements.append({
                "id": identifier, "level": row["level"], "topic": row["topic"],
                "ch": pattern, "ds": disambiguator, "anchors": anchors,
            })
    return patterns, provenance, dependencies, placements, references


def authored_groups(root: Path) -> list[dict]:
    groups = load_yaml(root / "authoring" / "teaching" / "lemma-groups.yaml")
    if not isinstance(groups, list) or not groups:
        raise ValueError("French lemma groups must be a nonempty list")
    exclusions_path = root / "authoring" / "teaching" / "exclusions.yaml"
    exclusions = load_yaml(exclusions_path) if exclusions_path.exists() else {}
    if not isinstance(exclusions, dict) or any(
        not isinstance(reason, str) or not reason.strip() for reason in exclusions.values()
    ):
        raise ValueError("Every excluded candidate requires an explicit reason")
    gaps_path = root / "authoring" / "teaching" / "source-gaps.yaml"
    if gaps_path.exists():
        for gap in load_yaml(gaps_path):
            if set(gap) != {"reason", "words"} or not gap["reason"].strip():
                raise ValueError("French source gaps require explicit reasons and candidate words")
            for word in gap["words"].split("|"):
                word = unicodedata.normalize("NFC", word.strip())
                if not word or word in exclusions:
                    raise ValueError(f"Duplicate or empty excluded French candidate: {word!r}")
                exclusions[word] = gap["reason"]
    result, seen = [], set()
    for group in sorted(groups, key=lambda item: item["level"] if type(item["level"]) is int else 31):
        if set(group) != {"level", "topic", "words"}:
            raise ValueError("French lemma groups require level, topic, and words")
        level = group["level"]
        if not ((type(level) is int and 1 <= level <= 30)
                or level in ("professional", "technical", "scientific", "literary")):
            raise ValueError(f"Invalid French placement: {level!r}")
        for word in group["words"].split("|"):
            word = unicodedata.normalize("NFC", word.strip())
            if not word or "\ufffd" in word:
                raise ValueError("Empty or corrupt French authored lemma")
            if word in exclusions:
                continue
            key = (word, level if isinstance(level, str) else "core")
            if key not in seen:
                result.append({"word": word, "level": level, "topic": group["topic"]})
                seen.add(key)
    return result


def project_sources(kaikki: Path, lexique: Path, wanted: set[str]) -> dict:
    for path, expected in ((kaikki, KAIKKI_HASH), (lexique, LEXIQUE_HASH)):
        if digest(path) != expected:
            raise ValueError(f"Source hash mismatch: {path}")
    projected = []
    with gzip.open(kaikki, "rt", encoding="utf-8") as stream:
        for record_index, line in enumerate(stream):
            row = json.loads(line)
            if row.get("word") not in wanted or row.get("lang_code") != "fr":
                continue
            senses = []
            for index, sense in enumerate(row.get("senses", [])):
                senses.append({
                    "index": index,
                    **{key: sense[key] for key in SENSE_FIELDS if key in sense},
                })
            projected.append({
                "record": record_index, "word": row["word"], "pos": row["pos"],
                "etymology_number": row.get("etymology_number"),
                "senses": senses,
                "sounds": [
                    {key: sound[key] for key in ("ipa", "tags", "note") if key in sound}
                    for sound in row.get("sounds", []) if "ipa" in sound
                ],
                "forms": row.get("forms", []),
                "head_templates": row.get("head_templates", []),
            })
    forms = []
    with lexique.open(encoding="utf-8-sig", newline="") as stream:
        for record_index, row in enumerate(csv.DictReader(stream, delimiter="\t")):
            if row["ortho"] in wanted or row["lemme"] in wanted:
                forms.append({
                    "record": record_index,
                    **{key: row[key] for key in LEXIQUE_FIELDS},
                })
    return {
        "schema_version": 1,
        "kaikki_source_sha256": KAIKKI_HASH,
        "lexique_source_sha256": LEXIQUE_HASH,
        "projection_policy": "Selected exact lexical fields only; no quotations, examples, or audio.",
        "kaikki": projected, "lexique": forms,
    }


def source_json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"


def read_projection(root: Path) -> dict:
    path = root / "source-data" / "selected-records.json"
    lock = load_yaml(root / "source-lock.yaml")
    if (lock.get("schema_version") != 1 or lock["kaikki"]["sha256"] != KAIKKI_HASH
            or lock["lexique"]["sha256"] != LEXIQUE_HASH
            or lock["kaikki"]["bytes"] != 56996718 or lock["lexique"]["bytes"] != 25850780):
        raise ValueError("French source lock identifies unexpected source snapshots")
    if digest(path) != lock["projection_sha256"]:
        raise ValueError("French selected source projection hash mismatch")
    projection = json.loads(path.read_text(encoding="utf-8"))
    if (projection["kaikki_source_sha256"] != KAIKKI_HASH
            or projection["lexique_source_sha256"] != LEXIQUE_HASH):
        raise ValueError("French projection belongs to unexpected source snapshots")
    return projection


def eligible_senses(
    row: dict, *, allow_marked: bool = False, allowed_tags: tuple[str, ...] = (),
) -> list[dict]:
    if set(allowed_tags) - {"derogatory"}:
        raise ValueError("Only an explicit contextual derogatory-label exception is supported")
    excluded = EXCLUDED_TAGS - set(allowed_tags) - (
        {"archaic", "obsolete", "dated", "rare", "historical"} if allow_marked else set()
    )
    return [
        sense for sense in row["senses"]
        if sense.get("id") and sense.get("glosses")
        and not sense.get("form_of") and not sense.get("alt_of")
        and not excluded.intersection(sense.get("tags", []))
    ]


def reading_candidates(row: dict) -> list[tuple[int, str]]:
    result = []
    excluded = {"Quebec", "Louisiana", "Canada", "Belgium", "Switzerland", "Acadian", "Cajun"}
    for index, sound in enumerate(row["sounds"]):
        reading = sound["ipa"]
        tags = set(sound.get("tags", []))
        if (tags.intersection({"archaic", "obsolete", "historical"})
                or (tags.intersection(excluded) and "France" not in tags)
                or not reading.startswith("/")):
            continue
        if "letter" in tags or "name" in tags:
            continue
        result.append((index, reading))
    return result


def concise_label(glosses: list[str]) -> str:
    gloss = glosses[-1].strip()
    if re.search(r"[A-Za-z]", gloss) and len(gloss) <= 64:
        return gloss
    candidates = [gloss.split(";")[0].strip(), gloss.split(",")[0].strip()]
    for candidate in candidates:
        if (re.search(r"[A-Za-z]", candidate) and len(candidate) <= 64
                and candidate.count("(") == candidate.count(")")
                and candidate.count("[") == candidate.count("]")):
            return candidate
    raise ValueError("Needs an authored English label of at most 64 characters")


def discover_choices(groups: list[dict], projection: dict, overrides: dict) -> tuple[list[dict], list[dict]]:
    by_word, forms = defaultdict(list), defaultdict(list)
    for row in projection["kaikki"]:
        by_word[row["word"]].append(row)
    for row in projection["lexique"]:
        if row["islem"] == "1":
            forms[row["ortho"]].append(row)
    choices, gaps, done = [], [], set()
    selected_by_id = {}
    for group in groups:
        word = group["word"]
        explicit = group.get("selection", {})
        if not explicit:
            if word in done:
                continue
            done.add(word)
        override = {**overrides.get(word, {}), **explicit}
        ranks = {}
        for row in forms[word]:
            pos = lexical_pos(row["cgram"])
            if pos:
                ranks[pos] = max(ranks.get(pos, 0), float(row["freqlemfilms2"]))
        rows = sorted(by_word[word], key=lambda row: (
            0 if row["pos"] == override.get("pos") else 1,
            -ranks.get(row["pos"], 0),
            POS_PRIORITY.index(row["pos"]) if row["pos"] in POS_PRIORITY else 100,
            row["record"],
        ))
        candidates = [
            (row, sense) for row in rows if row["pos"] in POS_PRIORITY
            for sense in eligible_senses(
                row, allow_marked=group["level"] == "literary" or bool(override.get("allow_marked")),
                allowed_tags=tuple(override.get("allow_tags", [])),
            )
            if (not override.get("source_sense_id")
                or sense["id"] == override["source_sense_id"])
            and (not override.get("pos") or row["pos"] == override["pos"])
        ]
        if not candidates:
            gaps.append({"word": word, "reason": "No eligible source sense", "level": group["level"]})
            continue
        row, sense = candidates[0]
        readings = reading_candidates(row)
        source_reading = {
            "reading_source_id": SOURCE_ID, "reading_record": row["record"],
        }
        if readings:
            reading_index, reading = readings[0]
            source_reading.update(reading_index=reading_index, reading_raw=reading)
        else:
            phonetic_rows = [
                item for item in forms[word]
                if lexical_pos(item["cgram"]) == row["pos"]
                and item["lemme"] == word and item["phon"]
            ]
            codes = {item["phon"] for item in phonetic_rows}
            if len(codes) != 1:
                gaps.append({"word": word, "reason": "Missing or ambiguous lexical pronunciation",
                             "level": group["level"]})
                continue
            phonetic = phonetic_rows[0]
            reading = phonetic_ipa(phonetic["phon"])
            source_reading = {
                "reading_source_id": LEXIQUE_ID, "reading_record": phonetic["record"],
                "reading_index": None, "reading_raw": phonetic["phon"],
            }
        try:
            label = override["ds"] if "ds" in override else concise_label(sense["glosses"])
        except ValueError:
            gaps.append({"word": word, "reason": "Needs concise English label",
                         "glosses": sense["glosses"], "level": group["level"]})
            continue
        if "reading" in override:
            matching = [(index, value) for index, value in readings if value == override["reading"]]
            if not matching:
                raise ValueError(f"{word}: authored reading is not a source candidate")
            reading_index, reading = matching[0]
            source_reading.update(reading_source_id=SOURCE_ID, reading_record=row["record"],
                                  reading_index=reading_index, reading_raw=reading)
        choice = {
            "id": stable_id("v", sense["id"]), "word": word, "pos": row["pos"],
            "source_sense_id": sense["id"], "record": row["record"],
            "sense_index": sense["index"], **source_reading, "pr": reading, "ds": label,
            "primary": not bool(explicit),
            **({"allowed_tags": override["allow_tags"]} if override.get("allow_tags") else {}),
            **({"allow_marked": True} if group["level"] == "literary" or override.get("allow_marked") else {}),
            **({"target": override["target"]} if "target" in override else {}),
        }
        existing = selected_by_id.get(choice["id"])
        if existing is not None:
            canonical = {
                "word", "pos", "source_sense_id", "record", "sense_index", "pr", "ds",
                "reading_source_id", "reading_record", "reading_index", "reading_raw",
            }
            if (any(existing[key] != choice[key] for key in canonical)
                    or existing.get("target", word) != choice.get("target", word)):
                raise ValueError(f"{word}: repeated source sense has inconsistent canonical content")
            existing["primary"] = existing["primary"] or choice["primary"]
        else:
            choices.append(choice)
            selected_by_id[choice["id"]] = choice
    return choices, gaps


def reference_data(root: Path, projection: dict, choices: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    by_record = {row["record"]: row for row in projection["kaikki"]}
    by_word = defaultdict(list)
    for row in projection["lexique"]:
        by_word[row["ortho"]].append(row)
    lexique_records = {row["record"]: row for row in projection["lexique"]}
    equivalences_path = root / "authoring" / "teaching" / "headword-equivalences.yaml"
    equivalences = load_yaml(equivalences_path) if equivalences_path.exists() else {}
    for word, equivalence in equivalences.items():
        if (set(equivalence) != {"lemma", "relation"}
                or equivalence["lemma"] in equivalences
                or equivalence["relation"] not in ("feminine", "masculine", "plural")):
            raise ValueError(f"{word}: invalid headword equivalence")
        bases = [by_record[choice["record"]] for choice in choices
                 if choice["word"] == equivalence["lemma"]]
        if not any(form.get("form") == word and equivalence["relation"] in form.get("tags", [])
                   for base in bases for form in base["forms"]):
            raise ValueError(f"{word}: headword equivalence lacks an attested source form")
    references, seen, word_choices = [], set(), {}
    for choice in choices:
        identifier = choice["id"]
        if identifier in seen:
            raise ValueError(f"Duplicate French sense selection: {identifier}")
        seen.add(identifier)
        if type(choice.get("primary")) is not bool:
            raise ValueError(f"{identifier}: explicit primary-sense flag required; prepare selections again")
        row = by_record[choice["record"]]
        sense = row["senses"][choice["sense_index"]]
        if (row["word"] != choice["word"] or row["pos"] != choice["pos"]
                or sense["id"] != choice["source_sense_id"]):
            raise ValueError(f"{identifier}: selection differs from the pinned source")
        if choice["reading_source_id"] == SOURCE_ID:
            raw_reading = row["sounds"][choice["reading_index"]]["ipa"]
            if (choice["reading_record"] != row["record"]
                    or raw_reading != choice["reading_raw"] or raw_reading != choice["pr"]):
                raise ValueError(f"{identifier}: dictionary pronunciation differs from source")
            if (choice["reading_index"], raw_reading) not in reading_candidates(row):
                raise ValueError(f"{identifier}: dictionary reading is outside the documented selection policy")
        elif choice["reading_source_id"] == LEXIQUE_ID:
            phonetic = lexique_records[choice["reading_record"]]
            if (phonetic["ortho"] != choice["word"] or phonetic["lemme"] != choice["word"]
                    or lexical_pos(phonetic["cgram"]) != row["pos"]
                    or phonetic["phon"] != choice["reading_raw"]
                    or phonetic_ipa(phonetic["phon"]) != choice["pr"]):
                raise ValueError(f"{identifier}: Lexique reading is not aligned with the selected lemma")
        else:
            raise ValueError(f"{identifier}: unknown reading source")
        if (not isinstance(choice["ds"], str) or not 1 <= len(choice["ds"]) <= 64
                or not re.search(r"[A-Za-z]", choice["ds"])):
            raise ValueError(f"{identifier}: invalid English disambiguator")
        if sense not in eligible_senses(
            row, allow_marked=choice.get("allow_marked", False),
            allowed_tags=tuple(choice.get("allowed_tags", [])),
        ):
            raise ValueError(f"{identifier}: inflection/variant cannot be a lexical sense")
        if identifier != stable_id("v", sense["id"]):
            raise ValueError(f"{identifier}: stable ID differs from its selected source sense")
        target = choice.get("target", choice["word"])
        if target != choice["word"] and (
            "plural-only" not in sense.get("tags", [])
            or not any(form.get("form") == target and "plural" in form.get("tags", [])
                       for form in row["forms"])
        ):
            raise ValueError(f"{identifier}: unsupported noncanonical teaching form")
        lemma = choice["word"]
        canonical_lemma = equivalences.get(lemma, {}).get("lemma", lemma)
        reference = {
            "id": identifier, "target": target, "reading": choice["pr"],
            "english": "; ".join(sense["glosses"]), "disambiguator": choice["ds"],
            "part_of_speech": row["pos"], "headword_id": stable_id("lemma", canonical_lemma),
            "lemma": lemma, "canonical_lemma": canonical_lemma,
            "headword_relation": equivalences.get(lemma, {}).get("relation", "canonical"),
            "source_id": SOURCE_ID,
            "source_entry": "https://en.wiktionary.org/wiki/" + quote(choice["word"], safe="") + "#French",
            "source_history": "https://en.wiktionary.org/w/index.php?title=" + quote(choice["word"], safe="") + "&action=history",
            "source_sense_id": sense["id"], "source_record": row["record"],
            "source_sense_index": sense["index"],
            "source_sha256": KAIKKI_HASH,
            "source_glosses": sense["glosses"],
            "tags": sense.get("tags", []), "topics": sense.get("topics", []),
            "reading_source": {
                "source_id": choice["reading_source_id"], "record": choice["reading_record"],
                "sound_index": choice["reading_index"], "source_reading": choice["reading_raw"],
                "status": ("source-reported lexical IPA; not a human or audio assessment"
                           if choice["reading_source_id"] == SOURCE_ID
                           else "documented Lexique phonetic-code conversion; not observed audio"),
                "alternatives": row["sounds"],
                "selection_policy": (
                    "Maintained sound-index choice; preparation proposes the first eligible unmarked/France lexical reading. "
                    "This is not a universal connected-speech rule or comprehensive human review."
                    if choice["reading_source_id"] == SOURCE_ID else
                    "Unique phonetic code aligned to the selected lexical lemma and part of speech."
                ),
            },
            "forms": row["forms"],
            "morphology": by_word[choice["word"]],
            "label_provenance": "Independently selected concise English teaching label; source glosses retained separately.",
            "human_review": "Not comprehensively human reviewed.",
        }
        references.append(reference)
        word_choices.setdefault(choice["word"], []).append(choice)
    placements, assigned = [], set()
    for group in authored_groups(root):
        primary = [choice for choice in word_choices.get(group["word"], []) if choice["primary"]]
        if len(primary) != 1:
            raise ValueError(f"Expected exactly one primary teaching sense for {group['word']}")
        for choice in primary:
            key = (choice["id"], group["level"] if isinstance(group["level"], str) else "core")
            if key not in assigned:
                placements.append({
                    "id": choice["id"], "level": group["level"],
                    "topic": group["topic"], "ds": choice["ds"],
                })
                assigned.add(key)
    by_sense = {choice["source_sense_id"]: choice for choice in choices}
    additional_path = root / "authoring" / "teaching" / "additional-senses.yaml"
    additional = load_yaml(additional_path) if additional_path.exists() else []
    for selection in additional:
        choice = by_sense.get(selection["selection"]["source_sense_id"])
        if choice is None or choice["word"] != selection["word"]:
            raise ValueError(f"{selection['word']}: missing explicit source-sense selection")
        for name, key in (("ds", "ds"), ("pos", "pos"), ("reading", "pr")):
            if name in selection["selection"] and selection["selection"][name] != choice[key]:
                raise ValueError(f"{selection['word']}: route annotation differs from canonical source selection")
        destination = selection["level"]
        key = (choice["id"], destination if isinstance(destination, str) else "core")
        if key in assigned:
            raise ValueError(f"{choice['id']}: repeated source-sense placement in {key[1]}")
        assigned.add(key)
        placements.append({
            "id": choice["id"], "level": destination, "topic": selection["topic"], "ds": choice["ds"],
        })
    topics = {row["word"]: row["topic"] for row in reversed(authored_groups(root))}
    reference_rows = [{
        **{key: row[key] for key in (
            "id", "target", "reading", "english", "part_of_speech", "source_id", "source_entry",
        )},
        "topic": topics[row["lemma"]],
        "level_basis": "Independent selected dictionary references; not CEFR bands or assessed mastery.",
    } for row in references]
    return references, placements, reference_rows


def reference_outputs(root: Path, projection: dict, choices: list[dict]) -> dict[Path, str]:
    outputs = serialize_references(root, *reference_data(root, projection, choices))
    authoring = root / "authoring" / "teaching"
    words = {row["word"]: {"id": row["id"]} for row in choices if row["primary"]}
    _, _, _, placements, references = compile_grammar([
        *load_yaml(authoring / "grammar-definitions.yaml"),
        *load_yaml(authoring / "tourist-grammar.yaml"),
    ], words, load_yaml(root / "teaching" / "program.yaml"))
    outputs.update({
        root / "reference" / "grammar.yaml": dump_yaml(references),
        authoring / "grammar.yaml": dump_yaml(placements),
        authoring / "support.yaml": dump_yaml({}),
    })
    return outputs


def serialize_references(
    root: Path, references: list[dict], placements: list[dict], reference_rows: list[dict],
) -> dict[Path, str]:
    by_id = {row["id"]: row for row in references}
    core_ids = {row["id"] for row in placements if type(row["level"]) is int}

    def counts(identifiers: set[str]) -> dict:
        selected = [by_id[identifier] for identifier in identifiers]
        return {
            "selected_senses": len(selected),
            "source_senses": len({row["source_sense_id"] for row in selected}),
            "headword_identities": len({row["headword_id"] for row in selected}),
            "written_realizations": len({(row["headword_id"], row["target"]) for row in selected}),
            "selected_readings": len({(row["headword_id"], row["reading"]) for row in selected}),
        }

    form_strings = {
        (row["headword_id"], form["form"])
        for row in references for form in row["forms"] if form.get("form")
    }
    noncanonical_forms = {
        (row["headword_id"], form["form"])
        for row in references for form in row["forms"]
        if form.get("form") and form["form"] != row["lemma"]
        and set(form.get("tags", [])) & {
            "feminine", "masculine", "plural", "participle", "first-person", "second-person", "third-person",
        }
    }
    return {
        root / "reference" / "vocabulary.yaml": dump_yaml(reference_rows),
        root / "reference-senses.yaml": dump_yaml(references),
        root / "authoring" / "teaching" / "vocabulary.yaml": dump_yaml(placements),
        root / "normalization-report.yaml": dump_yaml({
            "schema_version": 1, "source_hashes": {"kaikki": KAIKKI_HASH, "lexique": LEXIQUE_HASH},
            "all_selected": counts(set(by_id)), "core": counts(core_ids),
            "source_metadata": {
                "attested_form_strings": len(form_strings),
                "noncanonical_gender_number_conjugation_forms": len(noncanonical_forms),
                "interpretation": "Metadata only; these forms are not additional introduced lemmas or learner evidence.",
            },
            "explicit_exclusions": [
                "authoring/teaching/exclusions.yaml", "authoring/teaching/source-gaps.yaml",
            ],
            "counting_policy": (
                "Conservative canonical headword identities; distinct source senses, written forms and readings remain separate. "
                "Core and optional routes overlap and their inventories must not be added."
            ),
            "editorial_limit": (
                "Source fidelity is not comprehensive human linguistic or pedagogical review. "
                "No learner state, CEFR mapping or examination readiness is inferred."
            ),
        }),
    }


def write_outputs(outputs: dict[Path, str], check: bool) -> None:
    for path, expected in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                raise ValueError(f"Missing or stale French output: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--kaikki", type=Path)
    parser.add_argument("--lexique", type=Path)
    parser.add_argument("--prepare", action="store_true",
                        help="Prepare explicit sense choices for editorial review; not normal regeneration")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check and args.prepare:
        parser.error("--check is read-only and cannot prepare selections")
    if bool(args.kaikki) != bool(args.lexique):
        parser.error("--kaikki and --lexique must be supplied together")
    groups = authored_groups(args.root)
    if args.kaikki:
        projection = project_sources(args.kaikki, args.lexique, {row["word"] for row in groups})
        serialized = source_json(projection)
        outputs = {
            args.root / "source-data" / "selected-records.json": serialized,
            args.root / "source-lock.yaml": dump_yaml({
                "schema_version": 1,
                "kaikki": {"url": KAIKKI_URL, "sha256": KAIKKI_HASH, "bytes": 56996718,
                           "dump": "2026-09-02", "extracted": "2026-09-09"},
                "lexique": {"url": LEXIQUE_URL, "sha256": LEXIQUE_HASH, "bytes": 25850780},
                "projection_sha256": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
            }),
        }
    else:
        projection = read_projection(args.root)
        outputs = {}
    selections_path = args.root / "authoring" / "teaching" / "sense-selections.yaml"
    if args.prepare:
        overrides_path = args.root / "authoring" / "teaching" / "sense-overrides.yaml"
        overrides = load_yaml(overrides_path) if overrides_path.exists() else {}
        additional_path = args.root / "authoring" / "teaching" / "additional-senses.yaml"
        additional = load_yaml(additional_path) if additional_path.exists() else []
        choices, gaps = discover_choices([*groups, *additional], projection, overrides)
        report = {
            "candidate_spellings": len({row["word"] for row in groups}),
            "selected_senses": len(choices),
            "selected_canonical_spellings": len({row["word"] for row in choices}),
            "gaps": gaps,
            "review_required": "Check each chosen common sense and label; discovery is not pedagogical or human validation.",
        }
        if args.report:
            args.report.write_text(dump_yaml(report), encoding="utf-8", newline="\n")
        outputs[selections_path] = dump_yaml(choices)
        write_outputs(outputs, False)
        print(f"Prepared {len(choices)} choices; {len(gaps)} explicit gaps")
        return 1 if gaps else 0
    choices = load_yaml(selections_path)
    outputs.update(reference_outputs(args.root, projection, choices))
    write_outputs(outputs, args.check)
    print(f"{'Checked' if args.check else 'Generated'} {len(choices)} French reference senses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
