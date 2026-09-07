"""Rebuild the Japanese teaching collection using pinned, attributed open data.

Only the Python standard library is needed. Network access is opt-in (--download).
The local source subset excludes sentence corpora and unrelated dictionary entries.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import tarfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "japanese"
LEVELS = ("n5", "n4", "n3", "n2", "n1")
MAPPING_COMMIT = "b062d4e38c4bdd0950ae1d4ec55f04b176182e03"
MAPPING_BASE = (
    "https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/"
    + MAPPING_COMMIT + "/"
)
DICTIONARY_VERSION = "3.6.2+20260831182826"
DICTIONARY_URL = (
    "https://github.com/scriptin/jmdict-simplified/releases/download/"
    "3.6.2%2B20260831182826/jmdict-eng-3.6.2%2B20260831182826.json.tgz"
)
DICTIONARY_SHA256 = "3c842741e2c4f1b780ad4aff6833df308866a8b7dfb9ee59a085e23dd201a65f"
MAPPING_HASHES = {
    "n5": "07dc6f197b51cc076c65c3c9f23218d10c2b67f76545f5c1c4d9e3750495533a",
    "n4": "a14dcc7fdc02259b22331a486c6ff66df74c16472c8aeb5a0ebe7e5fa8ee8eb4",
    "n3": "bd4d68c59cfee861351e1bdf9d99818e434392201eabbed4d3657225fe53a3ac",
    "n2": "42a4413326e857d701dc9659b2711637ab612304a339fe0d09f4f0f042d3a214",
    "n1": "7a58f0584e9ec2b0299ccb9b109f3bd03e08b90d129a714307c0a1cb72f07b32",
}
HEADER = [
    "id", "target", "reading", "english", "part_of_speech", "topic",
    "source_id", "source_entry", "level_basis",
]
KANA = re.compile(r"[ぁ-ゖァ-ヺー・･〜～\s]+")
TOPICS = [
    ("food-and-dining", r"\b(food|eat|drink|meal|rice|tea|coffee|cook|fruit|vegetable|fish|meat|restaurant|flavour|taste)\b"),
    ("health-and-body", r"\b(body|head|hand|foot|eye|ear|nose|mouth|heart|health|illness|disease|hospital|medicine|doctor|pain)\b"),
    ("time-and-quantity", r"\b(time|hour|minute|second|day|week|month|year|morning|night|number|count|quantity)\b"),
    ("people-and-relationships", r"\b(person|people|family|mother|father|child|parent|friend|wife|husband|sister|brother|relationship)\b"),
    ("travel-and-places", r"\b(place|travel|train|station|road|street|car|bus|airport|hotel|town|city|village|country|direction)\b"),
    ("home-and-daily-life", r"\b(house|home|room|door|window|furniture|clothes|clothing|wear|clean|wash|bath|sleep)\b"),
    ("study-work-and-communication", r"\b(study|school|student|teacher|university|work|job|company|business|meeting|read|write|speak|language|book|letter|information)\b"),
    ("society-and-economy", r"\b(society|government|politic|political|law|legal|economy|economic|money|price|tax|trade|election|public|industry)\b"),
    ("nature-and-science", r"\b(nature|weather|rain|snow|wind|water|fire|earth|mountain|river|sea|animal|plant|science|energy|technology)\b"),
    ("thought-and-feeling", r"\b(think|thought|idea|feeling|emotion|happy|sad|fear|hope|believe|belief|opinion|reason|understand|mind)\b"),
]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, expected: str | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Langapp-curriculum-importer/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if expected and digest(data) != expected:
        raise ValueError(f"Checksum mismatch: {url}; review upstream before changing the pin")
    return data


def download() -> None:
    upstream = ROOT / "upstream"
    licenses = ROOT / "licenses"
    upstream.mkdir(parents=True, exist_ok=True)
    licenses.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.now(timezone.utc).isoformat()
    locks = []
    wanted = set()
    for level in LEVELS:
        url = MAPPING_BASE + f"original_data/{level}.csv"
        raw = fetch(url, MAPPING_HASHES[level])
        (upstream / f"waller-{level}.csv").write_bytes(raw)
        rows = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        wanted.update(row["jmdict_seq"] for row in rows if row["jmdict_seq"].isdigit())
        locks.append({"url": url, "sha256": digest(raw), "bytes": len(raw)})
    raw = fetch(DICTIONARY_URL, DICTIONARY_SHA256)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        members = [member for member in archive if member.isfile() and member.name.endswith(".json")]
        if len(members) != 1:
            raise ValueError("Unexpected dictionary archive structure")
        with archive.extractfile(members[0]) as stream:
            data = json.load(stream)
    subset = {
        "version": data["version"],
        "dictDate": data["dictDate"],
        "dictRevisions": data["dictRevisions"],
        "tags": data["tags"],
        "words": [word for word in data["words"] if str(word["id"]) in wanted],
    }
    write_json(upstream / "jmdict-selected.json", subset)
    locks.append({"url": DICTIONARY_URL, "sha256": digest(raw), "bytes": len(raw)})
    license_urls = {
        "CC-BY-SA-4.0.txt": MAPPING_BASE + "LICENSE.txt",
        "yomitan-jlpt-vocab-README.md": MAPPING_BASE + "README.md",
        "EDRDG-license.html": "https://www.edrdg.org/edrdg/licence.html",
        "Waller-sharing.html": "https://www.tanos.co.uk/jlpt/sharing/",
    }
    for filename, url in license_urls.items():
        expected = "7abe19ec9bb73b36141b999b861d24ad855e808bafe0f81e84cce28556f6c297" if filename == "CC-BY-SA-4.0.txt" else None
        raw = fetch(url, expected)
        (licenses / filename).write_bytes(raw)
        locks.append({"url": url, "sha256": digest(raw), "bytes": len(raw), "local": "licenses/" + filename})
    write_json(upstream / "download-lock.json", {
        "retrieved_on": retrieved,
        "mapping_commit": MAPPING_COMMIT,
        "dictionary_release": DICTIONARY_VERSION,
        "selected_dictionary_sha256": digest((upstream / "jmdict-selected.json").read_bytes()),
        "downloads": locks,
    })


def applies(restrictions: list[str], form: str) -> bool:
    return "*" in restrictions or form in restrictions


def classify(english: str) -> str:
    for topic, pattern in TOPICS:
        if re.search(pattern, english, re.I):
            return topic
    return "general-language"


def import_vocabulary() -> dict:
    upstream = ROOT / "upstream"
    lock = json.loads((upstream / "download-lock.json").read_text(encoding="utf-8"))
    raw = (upstream / "jmdict-selected.json").read_bytes()
    if digest(raw) != lock["selected_dictionary_sha256"]:
        raise ValueError("Local dictionary subset changed; review provenance before rebuilding")
    data = json.loads(raw)
    dictionary = {str(word["id"]): word for word in data["words"]}
    tags = data["tags"]
    seen = {}
    report = {"levels": {}, "excluded": [], "overlaps": [], "normalizations": []}
    for level in LEVELS:
        path = upstream / f"waller-{level}.csv"
        if digest(path.read_bytes()) != MAPPING_HASHES[level]:
            raise ValueError(f"Local mapping changed: {path}")
        source_rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
        output = []
        for index, row in enumerate(source_rows, 1):
            seq, reading = row["jmdict_seq"], row["kana"].strip()
            details = {"level": level, "mapping_row": index + 1, "entry": seq,
                       "target": row["kanji"] or reading, "reading": reading,
                       "english": row["waller_definition"]}
            word = dictionary.get(seq)
            if not word:
                report["excluded"].append({**details, "reason": "No current JMdict entry for mapping ID"})
                continue
            readings = [item for item in word["kana"] if item["text"] == reading]
            if not readings or not KANA.fullmatch(reading):
                report["excluded"].append({**details, "reason": "Mapping reading not verified against current JMdict"})
                continue
            key = (seq, reading)
            if key in seen:
                report["overlaps"].append({**details, "retained_id": seen[key]})
                continue
            possible_kanji = [
                item for item in word["kanji"]
                if any(applies(kana["appliesToKanji"], item["text"]) for kana in readings)
            ]
            mapped = [item for item in possible_kanji if item["text"] == row["kanji"]]
            common = [item for item in possible_kanji if item["common"]]
            chosen = mapped or common or possible_kanji
            target = chosen[0]["text"] if row["kanji"] and chosen else reading
            senses = [
                sense for sense in word["sense"]
                if applies(sense["appliesToKana"], reading)
                and applies(sense["appliesToKanji"], target)
            ]
            definitions, parts = [], []
            for sense in senses:
                glosses = [gloss["text"] for gloss in sense["gloss"] if gloss["lang"] == "eng"]
                if not glosses:
                    continue
                labels = [tags.get(tag, tag) for field in ("field", "misc", "dialect") for tag in sense[field]]
                meaning = "; ".join(glosses)
                if labels:
                    meaning += " [" + "; ".join(labels) + "]"
                english_notes = [
                    note for note in sense["info"]
                    if not re.search(r"[ぁ-ゖァ-ヺ一-龯]", note)
                ]
                if english_notes:
                    meaning += " (" + "; ".join(english_notes) + ")"
                definitions.append(meaning)
                parts.extend(tags.get(tag, tag) for tag in sense["partOfSpeech"])
            if not definitions or not re.search(r"[A-Za-z]", " ".join(definitions)):
                report["excluded"].append({**details, "reason": "No English senses compatible with selected spelling and reading"})
                continue
            english = " | ".join(f"{n}. {text}" for n, text in enumerate(definitions, 1))
            identifier = f"ja-{level}-{index:05d}"
            seen[key] = identifier
            if target != details["target"]:
                report["normalizations"].append({**details, "selected_target": target, "reason": "Verified spelling compatible with selected JMdict reading"})
            output.append({
                "id": identifier, "target": target, "reading": reading, "english": english,
                "part_of_speech": "; ".join(dict.fromkeys(parts)), "topic": classify(definitions[0]),
                "source_id": "jmdict-waller",
                "source_entry": f"JMdict:{seq};waller-{level}.csv:line-{index + 1}",
                "level_basis": "Community estimate: Waller via stephenmk; not an official JLPT word list",
            })
        level_dir = ROOT / f"jlpt-{level}"
        level_dir.mkdir(parents=True, exist_ok=True)
        with (level_dir / "vocabulary.csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=HEADER)
            writer.writeheader()
            writer.writerows(output)
        report["levels"][level] = {"source_rows": len(source_rows), "vocabulary_rows": len(output)}
    write_json(ROOT / "import-report.json", report)
    return report


def import_grammar() -> dict[str, int]:
    path = ROOT / "teaching" / "grammar.tsv"
    counts = {}
    grouped = {level: [] for level in LEVELS}
    with path.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream, delimiter="\t"):
            level = row["level"]
            identifier = f"ja-{level}-g{len(grouped[level]) + 1:03d}"
            grouped[level].append({
                "id": identifier, "pattern": row["pattern"], "english": row["english"],
                "note": row["note"],
                "examples": [{"target": row[f"ja{n}"], "english": row[f"en{n}"]} for n in (1, 2)],
                "source_id": "original-ja",
                "level_basis": "Original teaching selection; estimated JLPT band, not an official or exhaustive grammar syllabus",
            })
    for level, entries in grouped.items():
        write_json(ROOT / f"jlpt-{level}" / "grammar.json", entries)
        counts[level] = len(entries)
    return counts


def require(condition: object, message: str) -> None:
    if not condition:
        raise ValueError(f"Japanese curriculum validation failed: {message}")


def require_text_fields(record: object, fields: tuple[str, ...], context: str) -> None:
    require(isinstance(record, dict), f"{context}: expected an object")
    for field in fields:
        value = record.get(field)
        require(isinstance(value, str) and value.strip(),
                f"{context}: '{field}' must be a nonempty string")


def validate() -> None:
    ids = set()
    source_data = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    require(isinstance(source_data, list), "sources.json: expected an array")
    sources = set()
    for index, source in enumerate(source_data, 1):
        context = f"sources.json entry {index}"
        require_text_fields(source, ("id", "title", "url", "license", "usage", "attribution", "retrieved_on"), context)
        require(source["id"] not in sources, f"{context}: duplicate source ID '{source['id']}'")
        require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", source["retrieved_on"]),
                f"{context}: 'retrieved_on' must use YYYY-MM-DD")
        try:
            datetime.strptime(source["retrieved_on"], "%Y-%m-%d")
        except ValueError as error:
            raise ValueError(f"Japanese curriculum validation failed: {context}: invalid retrieval date") from error
        sources.add(source["id"])
    summaries = []
    for level in LEVELS:
        path = ROOT / f"jlpt-{level}"
        with (path / "vocabulary.csv").open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            require(reader.fieldnames == HEADER,
                    f"{level}/vocabulary.csv: expected header {HEADER}, got {reader.fieldnames}")
            vocab = list(reader)
        require(vocab, f"{level}/vocabulary.csv: no vocabulary rows")
        for index, row in enumerate(vocab, 2):
            context = f"{level}/vocabulary.csv line {index}"
            require(None not in row, f"{context}: unexpected extra CSV columns")
            require_text_fields(row, ("id", "target", "reading", "english", "source_id", "level_basis"), context)
            require(row["source_id"] in sources,
                    f"{context} ({row['id']}): unknown source ID '{row['source_id']}'")
            require(KANA.fullmatch(row["reading"]),
                    f"{context} ({row['id']}): reading must contain kana only")
            require(re.search(r"[A-Za-z]", row["english"]),
                    f"{context} ({row['id']}): English gloss must contain English letters")
            require(row["id"] not in ids, f"{context}: duplicate ID '{row['id']}'")
            ids.add(row["id"])
        grammar = json.loads((path / "grammar.json").read_text(encoding="utf-8"))
        require(isinstance(grammar, list), f"{level}/grammar.json: expected an array")
        minimum = 30 if level in ("n5", "n4") else 40
        require(len(grammar) >= minimum,
                f"{level}/grammar.json: expected at least {minimum} entries, got {len(grammar)}")
        syllabus = (path / "syllabus.md").read_text(encoding="utf-8")
        for index, item in enumerate(grammar, 1):
            context = f"{level}/grammar.json entry {index}"
            require_text_fields(item, ("id", "pattern", "english", "note", "source_id", "level_basis"), context)
            require(item["source_id"] in sources,
                    f"{context} ({item['id']}): unknown source ID '{item['source_id']}'")
            require(item["id"] not in ids, f"{context}: duplicate ID '{item['id']}'")
            ids.add(item["id"])
            require(item["id"] in syllabus,
                    f"{level}/syllabus.md: missing grammar reference '{item['id']}'")
            examples = item.get("examples")
            require(isinstance(examples, list) and len(examples) >= 2,
                    f"{context} ({item['id']}): expected at least two examples")
            for example_index, example in enumerate(examples, 1):
                example_context = f"{context} ({item['id']}) example {example_index}"
                require_text_fields(example, ("target", "english"), example_context)
                require(re.search(r"[A-Za-z]", example["english"]),
                        f"{example_context}: English translation must contain English letters")
        summaries.append(f"{level.upper()}: {len(vocab)} vocabulary; {len(grammar)} grammar; validated")
    for summary in summaries:
        print(summary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Download and verify pinned inputs (11.5 MB dictionary); retain only selected entries")
    parser.add_argument("--validate-only", action="store_true", help="Validate committed outputs without modifying them")
    args = parser.parse_args()
    if not args.validate_only:
        if args.download:
            download()
        report = import_vocabulary()
        counts = import_grammar()
        for level in LEVELS:
            report["levels"][level]["grammar_entries"] = counts[level]
        write_json(ROOT / "import-report.json", report)
    validate()


if __name__ == "__main__":
    main()
