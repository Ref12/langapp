"""Build Spanish references from explicit selections; acquisition is authoring-only."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys

import yaml

from curriculum_yaml import dump_entries, dump_yaml, load_yaml
from spanish_sources import (
    FREQUENCY_SHA256, ROOT, SOURCE_BYTES, SOURCE_ID, SOURCE_SHA256, SOURCE_URL,
    canonical_vocabulary, effective_selections, local_id, source_candidates, short_label, verify,
)


def topic_for(row: dict, sense: dict, policy: dict) -> str:
    for topic, words in policy.get("topic_overrides", {}).items():
        if row["word"] in words.split():
            return topic
    text = " ".join([short_label(sense) or "", *sense.get("topics", [])]).lower()
    scores = {
        topic: sum(bool(re.search(r"\b" + re.escape(word) + r"\b", text))
                   for word in words.split())
        for topic, words in policy["topic_keywords"].items()
    }
    best = max(scores, key=scores.get)
    if scores[best]:
        return best
    if row["pos"] in {"prep", "pron", "det", "conj", "article", "particle", "num"}:
        return "grammar"
    if row["pos"] == "verb":
        return "actions"
    if row["pos"] == "intj":
        return "communication"
    return "description"


def flow_rows(rows: list[dict]) -> str:
    return "".join("- " + yaml.dump(
        row, Dumper=getattr(yaml, "CSafeDumper", yaml.SafeDumper),
        allow_unicode=True, default_flow_style=True, sort_keys=False, width=100000,
    ) for row in rows)


def bootstrap(root: Path, source: Path, frequency: Path) -> None:
    """Materialize an editable candidate selection once, never on ordinary builds."""
    if (root / "authoring" / "vocabulary.yaml").exists():
        raise ValueError("Authoring selections already exist; edit them explicitly instead of reseeding")
    verify(frequency, FREQUENCY_SHA256)
    policy = load_yaml(root / "authoring" / "selection-policy.yaml")
    frequencies = dict((word, int(count)) for word, count in (
        line.rsplit(" ", 1) for line in frequency.read_text(encoding="utf-8").splitlines()
    ))
    early = {}
    for level, words in policy["early"].items():
        for word in words.split():
            early.setdefault(word, level)
    branch_words = {word for words in policy["branch_words"].values() for word in words.split()}
    alias_words = {value["lemma"] for value in policy["essential_aliases"].values()}
    wanted = set(frequencies) | set(early) | branch_words | alias_words
    rows, _ = source_candidates(source, wanted)
    candidates = defaultdict(list)
    verbal_lemmas = {row["word"] for row in rows if row["pos"] == "verb"}
    for row in rows:
        word = row["word"]
        if not word.islower() or word in policy["excluded_words"].split():
            continue
        if not re.fullmatch(r"[a-záéíóúüñ]+", word):
            continue
        preferred = policy["preferred_pos"].get(word)
        if preferred and row["pos"] != preferred:
            continue
        if word.endswith(("ar", "er", "ir")) and word in verbal_lemmas:
            if row["pos"] != "verb":
                continue
        for sense in row["senses"]:
            ds = short_label(sense)
            if ds:
                candidates[word].append((row, sense, ds))
    aliases = {}
    for alias, definition in policy["essential_aliases"].items():
        matches = [(row, sense) for row in rows
                   if row["word"] == definition["lemma"] and row["pos"] == definition["pos"]
                   for sense in row["senses"]
                   if definition["contains"].lower() in " ".join(sense["glosses"]).lower()]
        if not matches:
            raise ValueError(f"Essential alias has no suitable source sense: {alias}")
        aliases[alias] = matches[0]
    choices = {}
    for word in candidates:
        available = candidates[word]
        # Unqualified senses precede explicitly regional or specialist alternatives.
        available.sort(key=lambda item: bool(
            {"slang", "figuratively", "colloquial", "regional", "dialectal"}.intersection(item[1].get("tags", []))
        ))
        choices[word] = available[0]
    for alias, (row, sense) in aliases.items():
        word = row["word"]
        if not any(other_row["word"] == word for other_row, _ in list(aliases.values())[:list(aliases).index(alias)]):
            choices[word] = (row, sense, policy["essential_aliases"][alias]["ds"])
    required = [word for word in early if word in choices]
    ranked = sorted((word for word in choices if word not in required),
                    key=lambda word: (-frequencies.get(word, 0), word))
    selected_words = required + ranked[:max(0, policy["core_scale"] - len(required))]
    if len(selected_words) < policy["core_scale"]:
        raise ValueError("The available source does not support the planned selection scale")
    selections, records = {}, {}

    def add(row, sense, ds, level, alias=None):
        identifier = local_id(sense["id"])
        existing = selections.get(identifier)
        if existing is None:
            existing = {
                "id": identifier, "lemma": row["word"], "part_of_speech": row["pos"],
                "source_sense_id": sense["id"], "level": level,
                "topic": topic_for(row, sense, policy), "ds": ds,
            }
            selections[identifier] = existing
        if alias:
            existing.setdefault("aliases", []).append(alias)
            existing["ds"] = ds
        record_key = row["source_record_sha256"]
        if record_key not in records:
            records[record_key] = {**row, "senses": []}
        if sense not in records[record_key]["senses"]:
            records[record_key]["senses"].append(sense)

    # Explicit early task words; remaining candidates are distributed by topic.
    for word in selected_words:
        row, sense, ds = choices[word]
        add(row, sense, ds, early.get(word, 0))
    unplaced = defaultdict(list)
    for row in selections.values():
        if row["level"] == 0:
            unplaced[row["topic"]].append(row)
    weights = [50] * 4 + [125] * 4 + [160] * 5 + [220] * 5 + [242] * 6 + [308] * 6
    occupancy = Counter(row["level"] for row in selections.values() if row["level"])
    for topic, group in unplaced.items():
        minimum = max(5, policy["topic_minimum"].get(topic, 5))
        for row in group:
            destination = min(range(minimum, 31), key=lambda level: (occupancy[level] / weights[level - 1], level))
            row["level"] = destination
            occupancy[destination] += 1
    alias_late = {"querer-love": 5, "banco-bench": 5, "mujer-wife": 5, "orden-command": 11}
    for alias, (row, sense) in aliases.items():
        level = alias_late.get(alias, early.get(row["word"], 4))
        add(row, sense, policy["essential_aliases"][alias]["ds"], level, alias)
    missing_branch = {}
    branch_topics = {"professional": {"work", "money", "institutions"},
                     "technical": {"technology"}, "scientific": {"science", "nature", "health"},
                     "literary": {"literature", "arts", "register"}}
    for branch, words in policy["branch_words"].items():
        missing_branch[branch] = []
        additions = [word for word in ranked if word not in selected_words
                     and topic_for(choices[word][0], choices[word][1], policy) in branch_topics[branch]]
        for word in [*words.split(), *additions]:
            if sum(row["level"] == branch for row in selections.values()) >= 100:
                break
            if word not in choices:
                missing_branch[branch].append(word)
                continue
            row, sense, ds = choices[word]
            if local_id(sense["id"]) in selections:
                # Prefer another usable meaning for specialist contextual depth.
                alternatives = [item for item in candidates[word]
                                if local_id(item[1]["id"]) not in selections
                                and (item[0]["word"], item[2]) not in {
                                    (existing["lemma"], existing["ds"]) for existing in selections.values()
                                }
                                and topic_for(item[0], item[1], policy) in branch_topics[branch]]
                if alternatives:
                    row, sense, ds = alternatives[0]
                else:
                    continue
            add(row, sense, ds, branch)
    compact_labels = set()
    for selection in selections.values():
        key = (selection["lemma"], selection["ds"])
        if key in compact_labels:
            suffix = f" ({selection['part_of_speech']})"
            if len(selection["ds"] + suffix) > 64:
                raise ValueError(f"Ambiguous authored label needs an explicit edit: {selection['id']}")
            selection["ds"] += suffix
        compact_labels.add((selection["lemma"], selection["ds"]))
    output_rows = sorted(selections.values(), key=lambda row: (
        row["level"] if type(row["level"]) is int else 31, row["topic"],
        -frequencies.get(row["lemma"], 0), row["id"],
    ))
    data = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                   for row in records.values()).encode("utf-8")
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as stream:
        stream.write(data)
    projection = buffer.getvalue()
    lock = {
        "schema_version": 1,
        "source": {"id": SOURCE_ID, "url": SOURCE_URL, "dump": "2026-09-02",
                   "extracted_on": "2026-09-09", "bytes": SOURCE_BYTES, "sha256": SOURCE_SHA256},
        "frequency": {"revision": "525f9b560de45753a5ea01069454e72e9aa541c6", "sha256": FREQUENCY_SHA256},
        "projection": {
            "file": "selected-records.jsonl.gz", "sha256": hashlib.sha256(projection).hexdigest(),
            "policy": "Selected lexical glosses, tags, IPA and inflection facts only; no quotations, audio, etymology, categories or merged semantic links.",
        },
        "authoring": {
            "method": "Explicit early task words and semantic aliases; source-assisted topic and frequency candidate ordering, then editable teaching placements. AI-assisted, not human-reviewed.",
            "unavailable_early_candidates": [word for word in early if word not in choices],
            "unavailable_branch_candidates": missing_branch,
        },
    }
    (root / "upstream").mkdir(parents=True, exist_ok=True)
    (root / "upstream" / "selected-records.jsonl.gz").write_bytes(projection)
    (root / "upstream" / "source-lock.yaml").write_text(dump_yaml(lock), encoding="utf-8", newline="\n")
    (root / "authoring" / "vocabulary.yaml").write_text(flow_rows(output_rows), encoding="utf-8", newline="\n")


def add_selected_senses(root: Path, source: Path) -> None:
    from spanish_sources import load_projection

    requested = load_yaml(root / "authoring" / "lexical-additions.yaml")
    rows, _ = source_candidates(source, {row["lemma"] for row in requested})
    selections = load_yaml(root / "authoring" / "vocabulary.yaml")
    projection = load_projection(root)
    source_rows = {row["source_record_sha256"]: row for row in projection}
    for definition in requested:
        matches = [(row, sense) for row in rows
                   if row["word"] == definition["lemma"] and row["pos"] == definition["pos"]
                   for sense in row["senses"]
                   if definition["contains"].lower() in " ".join(sense["glosses"]).lower()]
        if not matches:
            raise ValueError(f"Additional sense absent from pinned source: {definition['alias']}")
        row, sense = matches[0]
        identifier = local_id(sense["id"])
        existing = next((entry for entry in selections if entry["id"] == identifier), None)
        if existing is None:
            existing = {
                "id": identifier, "lemma": row["word"], "part_of_speech": row["pos"],
                "source_sense_id": sense["id"], "level": definition["level"],
                "topic": definition["topic"], "ds": definition["ds"],
            }
            selections.append(existing)
        aliases = existing.setdefault("aliases", [])
        if definition["alias"] not in aliases:
            aliases.append(definition["alias"])
        existing.update(ds=definition["ds"], topic=definition["topic"])
        if type(existing["level"]) is not int or existing["level"] > definition["level"]:
            existing["level"] = definition["level"]
        source_row = source_rows.setdefault(row["source_record_sha256"], {**row, "senses": []})
        if sense not in source_row["senses"]:
            source_row["senses"].append(sense)
    # These grammatical/repair words are useful long before an advanced reading task.
    early = {"ayuda": 1, "dónde": 2, "cuánto": 3, "sin": 3, "con": 3, "el": 2,
             "la": 2, "un": 2, "de": 2, "por": 4, "para": 4, "policía": 7}
    for row in selections:
        if row["lemma"] in early and type(row["level"]) is int:
            row["level"] = min(row["level"], early[row["lemma"]])
        if "haber-existential" in row.get("aliases", []):
            row["level"] = 2
    data = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                   for row in source_rows.values()).encode("utf-8")
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as stream:
        stream.write(data)
    compressed = buffer.getvalue()
    lock = load_yaml(root / "upstream" / "source-lock.yaml")
    lock["projection"]["sha256"] = hashlib.sha256(compressed).hexdigest()
    (root / "upstream" / "selected-records.jsonl.gz").write_bytes(compressed)
    (root / "upstream" / "source-lock.yaml").write_text(dump_yaml(lock), encoding="utf-8", newline="\n")
    (root / "authoring" / "vocabulary.yaml").write_text(flow_rows(selections), encoding="utf-8", newline="\n")


def reference_outputs(root: Path) -> dict[Path, str]:
    vocabulary, aliases = canonical_vocabulary(root)
    selections = effective_selections(root)
    outputs = {
        root / "reference" / "vocabulary.yaml": dump_yaml([
            {key: value for key, value in group.items() if key != "senses"} for group in vocabulary
        ]),
        root / "reference" / "senses.yaml": dump_yaml([
            {"lexical_id": group["id"], **sense} for group in vocabulary for sense in group["senses"]
        ]),
        root / "authoring" / "teaching" / "vocabulary.yaml": dump_entries([
            {key: row[key] for key in ("id", "level", "topic", "ds")} for row in selections
        ]),
    }
    grammar_path = root / "authoring" / "grammar.yaml"
    if grammar_path.exists():
        authored = load_yaml(grammar_path)
        patterns, placements = [], []
        for row in authored:
            missing = set(row["anchors"]) - set(aliases)
            if missing:
                raise ValueError(f"{row['id']}: unknown lexical aliases {sorted(missing)}")
            patterns.append({
                "id": row["id"], "pattern": row["ch"], "token_form": row["ch"],
                "english": row["ds"], "disambiguator": row["ds"], "note": row["note"],
                "examples": row["examples"], "fixed_forms": row["fixed_forms"],
                "source_id": "es-original-teaching", "level_basis": "Original independent Spanish teaching progression.",
            })
            placements.append({**{key: row[key] for key in ("id", "level", "topic", "ch", "ds")},
                               "anchors": [aliases[alias] for alias in row["anchors"]]})
        outputs[root / "reference" / "grammar.yaml"] = dump_yaml(patterns)
        outputs[root / "authoring" / "teaching" / "grammar.yaml"] = dump_entries(placements)
    outputs[root / "authoring" / "teaching" / "support.yaml"] = "{}\n"
    return outputs


def generate(root: Path = ROOT, check: bool = False) -> None:
    outputs = reference_outputs(root)
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Missing or stale Spanish reference: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--bootstrap", action="store_true", help="One-time editable candidate selection from pinned inputs")
    parser.add_argument("--add-selected-senses", action="store_true", help="Resolve explicit lexical-additions against the pinned source")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--frequency", type=Path)
    args = parser.parse_args()
    if args.frequency is not None and not args.bootstrap:
        parser.error("--frequency is only used with --bootstrap")
    if args.source is not None and not (args.bootstrap or args.add_selected_senses):
        parser.error("--source requires an explicit authoring operation")
    if args.bootstrap:
        if args.check or args.source is None or args.frequency is None:
            parser.error("--bootstrap requires --source and --frequency and cannot use --check")
        bootstrap(args.root, args.source, args.frequency)
    if args.add_selected_senses:
        if args.check or args.source is None:
            parser.error("--add-selected-senses requires --source and cannot use --check")
        add_selected_senses(args.root, args.source)
    generate(args.root, args.check)
    return 0


if __name__ == "__main__":
    sys.exit(main())
