"""Preserve Korean source senses and derive a separately pinned reading overlay.

The TOPIK reference files are inputs only. Normal teaching generation does not
download either source; this explicit import command is the network boundary.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import urllib.request
import zipfile

import yaml

from curriculum_yaml import dump_yaml, load_yaml
from import_korean_curriculum import (
    BANDS, ENGLISH_OVERRIDES, FIELDS, POS, REVISION, SHA256, URL,
)


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
OFFICIAL_URL = "https://krdict.korean.go.kr/dicBatchDownload?seq=214"
OFFICIAL_POPUP = "https://krdict.korean.go.kr/download/downloadPopup"
OFFICIAL_SHA256 = "7cf41e62a2a36158a8be2b6d2f84c086221e9b29d4345c44e5497eebf21c8c40"
OFFICIAL_SOURCE = "nikl-official-20260819"
RAW_COLUMNS = {
    "Form", "Part of Speech", "Korean Definition", "English Definition",
    "Usages", "Vocabulary Level", "Semantic Category",
}


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def verify_bytes(raw: bytes, expected: str, location: str) -> None:
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected:
        raise ValueError(f"{location}: checksum {actual}; expected {expected}")


def definitions(value: str, location: str) -> list[str]:
    result = ast.literal_eval(value)
    if (not isinstance(result, list) or not result
            or any(not isinstance(item, str) or not item.strip() for item in result)):
        raise ValueError(f"{location}: expected a nonempty list of definition strings")
    return result


def reference_parents(root: Path) -> dict[str, tuple[str, dict]]:
    result = {}
    for number in range(1, 7):
        level = f"topik-{number}"
        for row in load_yaml(root / level / "vocabulary.yaml"):
            if set(row) != set(FIELDS) or row["id"] in result:
                raise ValueError(f"{level}: invalid or duplicate reference record")
            result[row["id"]] = (level, row)
    return result


def extract_senses(raw: bytes, parents: dict, support_ids: list[str]) -> dict:
    """Keep source positions, even when two English translations are identical."""
    verify_bytes(raw, SHA256, "January 2024 CSV")
    if (not isinstance(support_ids, list)
            or any(not isinstance(item, str) for item in support_ids)
            or len(set(support_ids)) != len(support_ids)):
        raise ValueError("Support parents must be a list of distinct IDs")
    if set(support_ids) & set(parents):
        raise ValueError("Support parents must not repeat the banded inventory")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    if set(reader.fieldnames or []) != RAW_COLUMNS:
        raise ValueError("Unexpected January 2024 source columns")
    entries, found, bands = [], set(), Counter()
    total = 0
    for number, source in enumerate(reader, 1):
        total = number
        identifier = f"ko-nikl-{number:05d}"
        band = BANDS.get(source["Vocabulary Level"])
        if band is None and identifier not in support_ids:
            continue
        if band is None and source["Vocabulary Level"]:
            raise ValueError(f"{identifier}: unsupported source band")
        english = definitions(source["English Definition"], f"{identifier}.English Definition")
        korean = definitions(source["Korean Definition"], f"{identifier}.Korean Definition")
        if len(english) != len(korean):
            raise ValueError(f"{identifier}: English/Korean sense-position mismatch")
        target, source_pos = source["Form"].strip(), source["Part of Speech"]
        if source_pos not in POS:
            raise ValueError(f"{identifier}: unsupported source POS {source_pos!r}")
        pos = POS[source_pos]
        level = None
        if band is not None:
            if identifier not in parents:
                raise ValueError(f"{identifier}: banded source parent is missing")
            level, parent = parents[identifier]
            joined = " / ".join(dict.fromkeys(normalized(value) for value in english))
            if re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ一-龥]", joined):
                joined = ENGLISH_OVERRIDES[(target, pos)]
            expected = {
                "target": target, "reading": "", "english": joined,
                "part_of_speech": pos, "source_id": "nikl-2024-mirror",
                "source_entry": f"{URL}#record={number}",
            }
            if any(parent[key] != value for key, value in expected.items()):
                raise ValueError(f"{identifier}: original reference differs from its pinned source")
            if f"NIKL source band: {band};" not in parent["level_basis"]:
                raise ValueError(f"{identifier}: source band was changed")
        found.add(identifier)
        bands[band or "unbanded-support"] += 1
        entries.append({
            "id": identifier, "target": target, "part_of_speech": pos,
            "source_part_of_speech": source_pos,
            "source_band": band or "unbanded", "reference_level": level,
            "source_entry": f"{URL}#record={number}",
            "senses": [
                {
                    "id": f"{identifier}-s{position:03d}",
                    "source_position": position, "english": en, "korean": ko,
                }
                for position, (en, ko) in enumerate(zip(english, korean), 1)
            ],
        })
    if found != set(parents) | set(support_ids):
        raise ValueError(f"Source parents missing: {sorted((set(parents) | set(support_ids)) - found)}")
    return {
        "schema_version": 1, "source_id": "nikl-2024-mirror",
        "source_revision": REVISION, "source_sha256": SHA256,
        "identity_policy": (
            "Project IDs use original CSV record and definition-list ordinals, not official NIKL IDs. "
            "Raw bilingual definitions retain their source positions; equal English is not deduplicated."
        ),
        "source_records": total, "band_counts": dict(bands), "entries": entries,
    }


def many(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def features(value, keys: set[str] | None = None) -> dict:
    result = {}
    for feature in many(value):
        if not isinstance(feature, dict) or "att" not in feature:
            raise ValueError("Invalid official feature record")
        key = feature["att"]
        if keys is not None and key not in keys:
            continue
        if key in result:
            raise ValueError(f"Duplicate official feature: {key}")
        # The official archive deliberately omits val for unavailable readings.
        result[key] = feature.get("val")
    return result


def official_record(entry: dict) -> dict:
    lemma = {}
    for item in many(entry["Lemma"]):
        for key, value in features(item["feat"], {"writtenForm"}).items():
            if key in lemma and lemma[key] != value:
                raise ValueError(f"{entry['val']}: conflicting lemma feature {key}")
            lemma[key] = value
    metadata = features(entry["feat"], {"partOfSpeech"})
    pos = metadata.get("partOfSpeech")
    if pos == "품사 없음":
        pos = ""
    readings = []
    for word_form in many(entry.get("WordForm")):
        values = many(word_form.get("feat"))
        kinds = [value.get("val") for value in values if value["att"] == "type"]
        if len(kinds) != 1:
            raise ValueError(f"{entry['val']}: ambiguous WordForm type")
        if kinds[0] != "발음":
            continue
        # Pronunciation and sound features can repeat within one WordForm.
        for value in values:
            if value["att"] == "pronunciation" and value.get("val"):
                reading = value["val"]
                if not isinstance(reading, str):
                    raise ValueError(f"{entry['val']}: invalid pronunciation")
                if reading not in readings:
                    readings.append(reading)
    senses = []
    for sense in many(entry.get("Sense")):
        values = features(sense.get("feat"), {"definition"})
        if values.get("definition"):
            senses.append({"id": str(sense["val"]), "korean": values["definition"]})
    if not isinstance(lemma.get("writtenForm"), str) or not senses:
        raise ValueError(f"{entry['val']}: missing official lemma or definitions")
    return {
        "official_entry_id": str(entry["val"]),
        "target": lemma["writtenForm"], "source_part_of_speech": pos,
        "pronunciations": readings, "senses": senses,
    }


def official_index(path: Path, needed: set[tuple[str, str]]) -> tuple[dict, int]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != OFFICIAL_SHA256:
        raise ValueError("Official archive checksum mismatch")
    result, count = defaultdict(list), 0
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            if not re.fullmatch(r"\d+_\d+_20260819\.json", member.filename):
                raise ValueError(f"Unexpected official archive member: {member.filename}")
            document = json.loads(archive.read(member))
            for entry in many(document["LexicalResource"]["Lexicon"]["LexicalEntry"]):
                count += 1
                record = official_record(entry)
                key = (record["target"], record["source_part_of_speech"])
                if key in needed:
                    result[key].append(record)
    return dict(result), count


def match_readings(registry: dict, index: dict, decisions: dict) -> dict:
    if not isinstance(decisions, dict):
        raise ValueError("Reading matches must be a mapping keyed by project parent ID")
    entries, unresolved, candidates, used = {}, [], {}, set()
    for parent in registry["entries"]:
        identifier = parent["id"]
        options = index.get((parent["target"], parent["source_part_of_speech"]), [])
        definitions_ko = [normalized(s["korean"]) for s in parent["senses"]]
        exact = [
            candidate for candidate in options
            if [normalized(s["korean"]) for s in candidate["senses"]] == definitions_ko
        ]
        decision, matched = decisions.get(identifier), None
        method = "exact-ordered-korean-definitions"
        if decision is not None:
            if set(decision) != {"official_entry_id", "reason"}:
                raise ValueError(f"{identifier}: a reading match needs an official ID and reason")
            if not isinstance(decision["reason"], str) or not decision["reason"].strip():
                raise ValueError(f"{identifier}: empty reading-match rationale")
            selected = [row for row in options if row["official_entry_id"] == decision["official_entry_id"]]
            if len(selected) != 1:
                raise ValueError(f"{identifier}: manual match is not one exact spelling/POS candidate")
            if len(exact) == 1 and selected[0] != exact[0]:
                raise ValueError(f"{identifier}: manual match conflicts with exact source identity")
            matched, method = selected[0], "explicit-crosswalk"
            used.add(identifier)
        elif len(exact) == 1:
            matched = exact[0]
        if matched is not None:
            entries[identifier] = {
                "method": "official-text", "match_method": method,
                "official_entry_id": matched["official_entry_id"],
                "source_entry": (
                    "https://krdict.korean.go.kr/eng/dicSearch/SearchView?"
                    f"ParaWordNo={matched['official_entry_id']}"
                ),
                "pronunciations": matched["pronunciations"],
                **({"match_reason": decision["reason"]} if decision is not None else {}),
            }
        if matched is None or not matched["pronunciations"]:
            status = (
                "official-text-missing" if matched is not None
                else "ambiguous-exact-match" if len(exact) > 1 else "no-exact-match"
            )
            unresolved.append({
                "id": identifier, "target": parent["target"], "status": status,
                "candidate_ids": [row["official_entry_id"] for row in options],
            })
            candidates[identifier] = options
    if used != set(decisions):
        raise ValueError(f"Unknown reading-match decisions: {sorted(set(decisions) - used)}")
    return {
        "schema_version": 1, "source_id": OFFICIAL_SOURCE,
        "source_url": OFFICIAL_URL, "source_sha256": OFFICIAL_SHA256,
        "policy": (
            "Citation pronunciation text only, matched independently of original parent IDs and bands. "
            "Preserve length marks and alternatives. No audio, inflections, or spelling-copy fallback."
        ),
        "entries": entries, "unresolved": unresolved, "candidates": candidates,
    }


def download_csv() -> bytes:
    request = urllib.request.Request(URL, headers={"User-Agent": "langapp-curriculum-import/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        raw = response.read()
    verify_bytes(raw, SHA256, "January 2024 CSV")
    return raw


def source_outputs(root: Path, raw: bytes, archive: Path) -> dict[Path, str]:
    authoring = root / "authoring" / "teaching"
    support = load_yaml(authoring / "support-parents.yaml")
    decisions = load_yaml(authoring / "reading-matches.yaml")
    registry = extract_senses(raw, reference_parents(root), support)
    needed = {(row["target"], row["source_part_of_speech"]) for row in registry["entries"]}
    index, official_count = official_index(archive, needed)
    readings = match_readings(registry, index, decisions)
    readings["official_archive_entries"] = official_count
    return {
        root / "source-senses.yaml": dump_yaml(registry),
        root / "reading-overlay.yaml": dump_yaml(readings),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--source-file", type=Path)
    parser.add_argument("--official-archive", type=Path, required=True,
                        help="Explicit locally retained official 20260819 JSON ZIP; checksum enforced")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        raw = args.source_file.read_bytes() if args.source_file else download_csv()
        outputs = source_outputs(args.root, raw, args.official_archive)
        for path, content in outputs.items():
            if args.check:
                if not path.exists() or path.read_text(encoding="utf-8") != content:
                    raise ValueError(f"Missing or stale Korean source view: {path}")
            else:
                path.write_text(content, encoding="utf-8", newline="\n")
    except (OSError, UnicodeError, ValueError, KeyError, SyntaxError, yaml.YAMLError,
            zipfile.BadZipFile) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} Korean source senses and official readings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
