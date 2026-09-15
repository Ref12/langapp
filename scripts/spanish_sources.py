"""Pinned Spanish lexical extraction and explicit teaching selection."""

from __future__ import annotations

from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote

from curriculum_yaml import load_yaml


SOURCE_ID = "es-kaikki-20260909"
SOURCE_SHA256 = "ae1615d6cde1ef09725d3fabca5fb2851b0f845e22ef4d45911b1ff6560e76a1"
FREQUENCY_SHA256 = "dcff3ad4316192f4dc4ff7d26e637c6ff314ef1ca0f3f720c5649018a71056c0"
SOURCE_URL = "https://kaikki.org/dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl.gz"
SOURCE_BYTES = 92_091_654
EXPANDED_LIMIT = 1_200_000_000
ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "spanish"
POS = {"noun", "verb", "adj", "adv", "prep", "pron", "det", "conj", "article", "intj", "num", "particle"}
EXCLUDED = {
    "form-of", "alt-of", "archaic", "obsolete", "rare", "dated", "historical",
    "name", "abbreviation", "initialism", "misspelling", "nonstandard",
    "vulgar", "offensive", "derogatory", "pejorative",
}
GLOSS_EXCLUSIONS = re.compile(
    r"\b(?:initialism|acronym|abbreviation|surname|given name|"
    r"taxonomic|taxon|genus|species of|extinct|diminutive of|augmentative of|"
    r"alternative (?:form|spelling)|inflection of|plural of|feminine of|"
    r"masculine of|superlative of|past participle of|comparative of|"
    r"obsolete spelling|misspelling|roman numeral)\b"
    r"|\bletter\b.{0,40}\balphabet\b", re.I,
)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(path: Path, expected: str) -> None:
    actual = digest(path)
    if actual != expected:
        raise ValueError(f"{path.name}: SHA-256 mismatch: {actual}; expected {expected}")


def normalized(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def local_id(source_sense_id: str) -> str:
    return "es-v-" + hashlib.sha256(source_sense_id.encode("utf-8")).hexdigest()[:16]


def lexical_id(lemma: str) -> str:
    return "es-lemma-" + hashlib.sha256(normalized(lemma).encode("utf-8")).hexdigest()[:16]


def source_readings(row: dict) -> list[dict]:
    result = []
    for sound in row.get("sounds", []):
        if not isinstance(sound, dict) or not sound.get("ipa", "").startswith("/"):
            continue
        value = {key: sound[key] for key in ("ipa", "tags", "note") if key in sound}
        if value not in result:
            result.append(value)
    return result


def reading_text(readings: list[dict]) -> str:
    if not readings:
        raise ValueError("Selected vocabulary has no broad source IPA or authored override")
    parts = []
    for reading in readings:
        qualifier = "; ".join([*reading.get("tags", []), *([reading["note"]] if reading.get("note") else [])])
        text = f"{reading['ipa']} ({qualifier})" if qualifier else reading["ipa"]
        if text not in parts:
            parts.append(text)
    return " | ".join(parts)


def usable_senses(row: dict) -> list[dict]:
    return [
        sense for sense in row.get("senses", [])
        if sense.get("id") and sense.get("glosses")
        and not sense.get("form_of") and not sense.get("alt_of")
        and not EXCLUDED.intersection(sense.get("tags", []))
        and not GLOSS_EXCLUSIONS.search(" ".join(sense["glosses"]))
    ]


def short_label(sense: dict) -> str | None:
    """Select a complete short gloss clause; never cut through a word or sense."""
    for gloss in reversed(sense["glosses"]):
        clean = re.sub(r"\([^()]*\)", "", gloss).strip()
        clean = re.sub(r"\s+", " ", clean).rstrip(".,;:")
        options = [clean, *[part.strip() for part in clean.split(";")]]
        for option in options:
            if 1 <= len(option) <= 64 and re.search(r"[A-Za-z]", option):
                return option
    return None


def projected_record(row: dict, selected: list[dict], raw_hash: str) -> dict:
    return {
        "word": row["word"], "pos": row["pos"],
        "etymology_number": row.get("etymology_number"),
        "source_record_sha256": raw_hash,
        "readings": source_readings(row),
        "senses": [
            {key: sense[key] for key in ("id", "glosses", "tags", "topics", "form_of", "alt_of")
             if key in sense}
            for sense in selected
        ],
        "forms": [
            {key: form[key] for key in ("form", "tags", "source") if key in form}
            for form in row.get("forms", [])
            if isinstance(form.get("form"), str) and form["form"]
            and "table-tags" not in form.get("tags", [])
        ],
    }


def source_candidates(source: Path, wanted: set[str]) -> tuple[list[dict], dict]:
    verify(source, SOURCE_SHA256)
    if source.stat().st_size != SOURCE_BYTES:
        raise ValueError("Unexpected source byte count")
    result, counts, expanded = [], Counter(), 0
    with gzip.open(source, "rb") as stream:
        for raw in stream:
            expanded += len(raw)
            if expanded > EXPANDED_LIMIT:
                raise ValueError("Source exceeds the expanded-byte limit")
            row = json.loads(raw)
            counts["records"] += 1
            if row.get("lang_code") != "es":
                raise ValueError("The pinned source contains a non-Spanish entry")
            word = normalized(row["word"])
            if word not in wanted or row.get("pos") not in POS:
                continue
            senses = usable_senses(row)
            if not senses:
                continue
            if not source_readings(row):
                counts["without_broad_ipa"] += 1
                continue
            result.append(projected_record(row, senses, hashlib.sha256(raw).hexdigest()))
    counts.update(candidate_records=len(result), expanded_bytes=expanded)
    return result, dict(counts)


def load_projection(root: Path = ROOT) -> list[dict]:
    lock = load_yaml(root / "upstream" / "source-lock.yaml")
    path = root / "upstream" / "selected-records.jsonl.gz"
    verify(path, lock["projection"]["sha256"])
    if lock["source"]["sha256"] != SOURCE_SHA256:
        raise ValueError("Unexpected pinned Spanish source revision")
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def record_index(rows: list[dict]) -> dict[str, tuple[dict, dict]]:
    result = {}
    for row in rows:
        for sense in row["senses"]:
            identifier = sense["id"]
            if identifier in result:
                old_row, old_sense = result[identifier]
                if old_sense != sense or old_row["word"] != row["word"] or old_row["pos"] != row["pos"]:
                    raise ValueError(f"Conflicting source sense identity: {identifier}")
                continue
            result[identifier] = (row, sense)
    return result


def surface_forms(row: dict) -> list[dict]:
    return [
        form for form in row["forms"]
        if not {"inflection-template", "class"}.intersection(form.get("tags", []))
    ]


def selected_inflections(row: dict) -> list[dict]:
    """Keep noun/adjective forms and verb headline forms, not full paradigms."""
    return [
        form for form in surface_forms(row)
        if row["pos"] != "verb" or form.get("source") != "conjugation"
        or "gerund" in form.get("tags", [])
    ]


def effective_selections(root: Path = ROOT) -> list[dict]:
    selections = load_yaml(root / "authoring" / "vocabulary.yaml")
    path = root / "authoring" / "lexical-review.yaml"
    if not path.exists():
        return selections
    review = load_yaml(path)
    expected = {"topic_groups", "sense_overrides", "level_overrides",
                "breadth_groups", "exclude", "exclusion_notes"}
    if set(review) != expected:
        raise ValueError("Unexpected Spanish lexical-review fields")
    ids = {row["id"] for row in selections}
    senses = {row["source_sense_id"] for row in selections}
    lemmas = {row["lemma"] for row in selections}
    excluded = set(review["exclude"])
    if (len(excluded) != len(review["exclude"]) or excluded - ids
            or set(review["exclusion_notes"]) != excluded
            or any(not str(note).strip() for note in review["exclusion_notes"].values())):
        raise ValueError("Lexical exclusions require unique known IDs and explicit reasons")
    if set(review["sense_overrides"]) - senses or set(review["level_overrides"]) - lemmas:
        raise ValueError("Lexical review refers to unavailable senses or lemmas")
    policy = load_yaml(root / "authoring" / "selection-policy.yaml")
    topics = set(policy["topic_keywords"]) | set(policy["topic_minimum"]) | {"actions", "description", "grammar", "communication"}
    topic_by_lemma = {}
    for topic, words in review["topic_groups"].items():
        if topic not in topics:
            raise ValueError(f"Unknown lexical-review topic: {topic}")
        for lemma in words.split():
            if lemma not in lemmas or lemma in topic_by_lemma:
                raise ValueError(f"Unknown or repeated themed lemma: {lemma}")
            topic_by_lemma[lemma] = topic
    breadth = {}
    for lemma, variants in review["breadth_groups"].items():
        if lemma not in lemmas:
            raise ValueError(f"Unknown breadth lemma: {lemma}")
        for variant in variants.split():
            if variant not in lemmas or variant == lemma or variant in breadth:
                raise ValueError(f"Unknown or repeated breadth variant: {variant}")
            breadth[variant] = lemma
    if set(breadth) & set(breadth.values()):
        raise ValueError("Breadth groups cannot be chained or cyclic")
    primary = {}
    for row in selections:
        if type(row["level"]) is int:
            primary.setdefault(row["lemma"], row["id"])
    result = []
    for original in selections:
        if original["id"] in excluded:
            continue
        row = dict(original)
        lemma = row["lemma"]
        if primary.get(lemma) == row["id"]:
            row["topic"] = topic_by_lemma.get(lemma, row["topic"])
            row["level"] = review["level_overrides"].get(lemma, row["level"])
        override = review["sense_overrides"].get(row["source_sense_id"], {})
        if set(override) - {"topic", "ds", "level"}:
            raise ValueError(f"{row['id']}: unknown sense-review fields")
        row.update(override)
        if row["topic"] not in topics:
            raise ValueError(f"{row['id']}: unknown reviewed topic")
        level = row["level"]
        if not ((type(level) is int and 1 <= level <= 30)
                or level in ("professional", "technical", "scientific", "literary")):
            raise ValueError(f"{row['id']}: invalid reviewed destination")
        if lemma in breadth:
            row["breadth_lemma"] = breadth[lemma]
        result.append(row)
    return result


def canonical_vocabulary(root: Path = ROOT) -> tuple[list[dict], dict[str, str]]:
    references = record_index(load_projection(root))
    selections = effective_selections(root)
    groups, aliases, seen, meanings = {}, {}, set(), set()
    for selection in selections:
        identifier = selection["id"]
        if identifier in seen or identifier != local_id(selection["source_sense_id"]):
            raise ValueError(f"Invalid, duplicated or changed local identity: {identifier}")
        seen.add(identifier)
        if selection["source_sense_id"] not in references:
            raise ValueError(f"Missing source sense: {selection['source_sense_id']}")
        row, sense = references[selection["source_sense_id"]]
        if selection["lemma"] != row["word"] or selection["part_of_speech"] != row["pos"]:
            raise ValueError(f"{identifier}: authored lexical metadata differs from its source")
        ds = selection["ds"]
        if not isinstance(ds, str) or not ds.strip() or len(ds) > 64 or ds != ds.strip() or "\n" in ds:
            raise ValueError(f"{identifier}: invalid English disambiguator")
        if not re.search(r"[A-Za-z]", ds):
            raise ValueError(f"{identifier}: English disambiguator required")
        reading = reading_text(row["readings"])
        meaning = (row["word"], reading, ds)
        if meaning in meanings:
            raise ValueError(f"{identifier}: ambiguous duplicated compact meaning")
        meanings.add(meaning)
        group_id = lexical_id(selection.get("breadth_lemma", row["word"]))
        group = groups.setdefault(group_id, {
            "id": group_id, "target": selection.get("breadth_lemma", row["word"]),
            "reading": "", "english": "", "part_of_speech": "", "topic": selection["topic"],
            "source_id": SOURCE_ID, "source_entry": "https://en.wiktionary.org/wiki/" + quote(row["word"]) + "#Spanish",
            "level_basis": "Independent task-based teaching selection; not an exam band.",
            "senses": [],
        })
        group["senses"].append({
            "id": identifier, "target": row["word"], "part_of_speech": row["pos"],
            "reading": reading, "readings": row["readings"],
            "reading_origin": "Unmodified broad IPA from the pinned Kaikki extraction; unlabeled readings have unspecified regional scope.",
            "english": " / ".join(sense["glosses"]), "source_glosses": sense["glosses"],
            "disambiguator": ds, "tags": sense.get("tags", []),
            "inflections": selected_inflections(row),
            "inflection_scope": "Source noun/adjective forms or verb headline forms and gerund; not a complete paradigm or a separate headword count.",
            "inflection_classes": [form for form in row["forms"] if "class" in form.get("tags", [])],
            "source_id": SOURCE_ID, "source_sense_id": sense["id"],
            "source_record_sha256": row["source_record_sha256"],
            "source_entry": "https://en.wiktionary.org/wiki/" + quote(row["word"]) + "#Spanish",
            "etymology_number": row["etymology_number"],
        })
        for alias in selection.get("aliases", []):
            if alias in aliases:
                raise ValueError(f"Duplicated lexical alias: {alias}")
            aliases[alias] = identifier
    for group in groups.values():
        group["reading"] = " | ".join(dict.fromkeys(sense["reading"] for sense in group["senses"]))
        group["english"] = "; ".join(dict.fromkeys(sense["english"] for sense in group["senses"]))
        group["part_of_speech"] = " / ".join(dict.fromkeys(sense["part_of_speech"] for sense in group["senses"]))
    return list(groups.values()), aliases
