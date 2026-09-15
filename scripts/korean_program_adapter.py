"""Korean source, reading, lexical-identity, and realization adapter."""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import re
import sys

import yaml

from curriculum_yaml import dump_yaml, load_yaml
from generate_curriculum_tokens import label, text
from generate_practical_program import generate, load_inputs, schedule_vocabulary
from korean_sources import OFFICIAL_SHA256, SHA256
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SurfaceSegment,
)


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
CATEGORIES = {"free-lemma", "bound-form", "function-item"}
FORM_FIELDS = {"ch", "pr", "items", "grammar", "rationale", "review_status"}
CORRECTION_REVIEW_STATUS = "AI-authored interpretation; requires qualified Korean-teacher review"
IDENTITY_FIELDS = {"lemma", "category", "members", "source_parents", "rationale"}


def prose(value: str, location: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{location}: expected nonempty explanatory prose")


def citation_reading(identifier: str, overlay: dict, decisions: dict) -> tuple[str, dict]:
    official = overlay["entries"].get(identifier)
    authored = decisions.get(identifier)
    if official is not None and official["pronunciations"]:
        if authored is not None:
            raise ValueError(f"{identifier}: authored reading conflicts with available official text")
        readings = official["pronunciations"]
        provenance = {"source_id": overlay["source_id"], **official}
    elif authored is not None:
        if set(authored) != {"pronunciations", "method", "reason", "review_status"}:
            raise ValueError(f"{identifier}: invalid authored reading decision fields")
        if authored["method"] != "authored-broad-hangul" or authored["review_status"] != "unreviewed":
            raise ValueError(f"{identifier}: authored readings must remain explicitly unverified")
        prose(authored["reason"], f"{identifier}.reading rationale")
        readings = authored["pronunciations"]
        provenance = {"source_id": "original-ko", **authored}
    else:
        raise ValueError(f"{identifier}: selected entry has no supported citation reading")
    if not isinstance(readings, list) or not readings:
        raise ValueError(f"{identifier}: expected nonempty pronunciation alternatives")
    if official is not None and official["pronunciations"]:
        display = [reading.strip() if isinstance(reading, str) else reading for reading in readings]
        if display != readings:
            provenance["display_normalization"] = "trim-surrounding-whitespace-only"
            provenance["display_pronunciations"] = display
        readings = display
    for reading in readings:
        text(reading, f"{identifier}.pronunciation")
        if not re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ]", reading):
            raise ValueError(f"{identifier}: broad Hangul reading required, not romanization")
    if len(set(readings)) != len(readings):
        raise ValueError(f"{identifier}: duplicate pronunciation alternatives")
    return " / ".join(readings), provenance


def sense_index(registry: dict) -> tuple[dict, dict]:
    if registry["source_sha256"] != SHA256 or registry["source_records"] != 53172:
        raise ValueError("Korean sense registry does not identify the pinned source")
    parents, senses = {}, {}
    for parent in registry["entries"]:
        identifier = parent["id"]
        if identifier in parents or not re.fullmatch(r"ko-nikl-\d{5}", identifier):
            raise ValueError(f"Invalid or duplicate Korean source parent: {identifier}")
        parents[identifier] = parent
        for number, sense in enumerate(parent["senses"], 1):
            expected = f"{identifier}-s{number:03d}"
            if sense["source_position"] != number or sense["id"] != expected or expected in senses:
                raise ValueError(f"{identifier}: source positions were changed")
            if not sense["english"].strip() or not sense["korean"].strip():
                raise ValueError(f"{expected}: missing original bilingual definition")
            senses[expected] = (parent, sense)
    return parents, senses


def validate_lexical_group(identity: str, group: dict) -> None:
    text(identity, "lexical identity")
    if not isinstance(group, dict) or set(group) != IDENTITY_FIELDS:
        raise ValueError(f"{identity}: invalid lexical-identity fields")
    text(group["lemma"], f"{identity}.lemma")
    prose(group["rationale"], f"{identity}.rationale")
    if not isinstance(group["category"], str) or group["category"] not in CATEGORIES:
        raise ValueError(f"{identity}: invalid lexical count category")
    for field in ("members", "source_parents"):
        values = group[field]
        if (not isinstance(values, list) or not values
                or any(not isinstance(value, str) or not value.strip() for value in values)
                or len(set(values)) != len(values)):
            raise ValueError(f"{identity}: expected distinct {field}")


def load_selections(authoring: Path, base_vocabulary: list) -> tuple[list, dict]:
    manifest = load_yaml(authoring / "selection-files.yaml")
    if (not isinstance(manifest, dict)
            or set(manifest) != {"schema_version", "vocabulary", "lexical_identities"}
            or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1):
        raise ValueError("Invalid Korean selection-file manifest")
    for field, base in (
        ("vocabulary", "vocabulary.yaml"), ("lexical_identities", "lexical-identities.yaml"),
    ):
        names = manifest[field]
        if (not isinstance(names, list) or not names
                or any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]*\.yaml", name)
                       for name in names)
                or len(set(names)) != len(names) or names[0] != base):
            raise ValueError(f"{field}: expected distinct local selection files with {base} first")
        for name in names:
            if (authoring / name).resolve().parent != authoring.resolve():
                raise ValueError(f"{name}: selection file escapes its authoring directory")
    placements = []
    for name in manifest["vocabulary"]:
        rows = base_vocabulary if name == "vocabulary.yaml" else load_yaml(authoring / name)
        if not isinstance(rows, list):
            raise ValueError(f"{name}: expected explicit vocabulary placements")
        placements.extend(rows)
    groups = {}
    for name in manifest["lexical_identities"]:
        additions = load_yaml(authoring / name)
        if not isinstance(additions, dict):
            raise ValueError(f"{name}: expected an explicit lexical-identity mapping")
        for identity, fragment in additions.items():
            validate_lexical_group(identity, fragment)
            if identity not in groups:
                groups[identity] = {
                    **fragment, "members": list(fragment["members"]),
                    "source_parents": list(fragment["source_parents"]),
                }
                continue
            group = groups[identity]
            if any(group[field] != fragment[field] for field in ("lemma", "category")):
                raise ValueError(f"{name}: conflicting lexical identity {identity}")
            if set(group["members"]) & set(fragment["members"]):
                raise ValueError(f"{name}: duplicate sense members in {identity}")
            group["members"].extend(fragment["members"])
            group["source_parents"].extend(
                parent for parent in fragment["source_parents"] if parent not in group["source_parents"]
            )
            group["rationale"] += f"\n\nAdditional selection ({name}): {fragment['rationale']}"
    return placements, groups


def lexical_members(groups: dict, selected: dict, senses: dict) -> tuple[dict, dict]:
    if not isinstance(groups, dict):
        raise ValueError("Lexical identities must be an explicit mapping")
    identities, categories = {}, {}
    for identity, group in groups.items():
        validate_lexical_group(identity, group)
        actual_parents = set()
        for member in group["members"]:
            if member not in senses or member in identities:
                raise ValueError(f"{identity}: unknown or multiply assigned sense {member}")
            if member not in selected:
                raise ValueError(f"{identity}: unselected identity member {member}")
            actual_parents.add(senses[member][0]["id"])
            identities[member] = identity
        if set(group["source_parents"]) != actual_parents:
            raise ValueError(f"{identity}: parent membership differs from its source senses")
        categories[identity] = group["category"]
    if set(identities) != set(selected):
        raise ValueError(f"Missing lexical identities: {sorted(set(selected) - set(identities))}")
    return identities, categories


def source_corrections(ledger: dict, senses: dict, labels: dict) -> dict:
    if (not isinstance(ledger, dict)
            or set(ledger) != {"schema_version", "review_status", "policy", "corrections"}
            or type(ledger["schema_version"]) is not int or ledger["schema_version"] != 1
            or ledger["review_status"] != CORRECTION_REVIEW_STATUS
            or not isinstance(ledger["corrections"], dict)):
        raise ValueError("Invalid or falsely verified Korean source-correction ledger")
    prose(ledger["policy"], "source-correction policy")
    result = {}
    for identifier, correction in ledger["corrections"].items():
        if identifier not in senses:
            raise ValueError(f"Unknown corrected Korean source sense: {identifier}")
        if set(correction) != {
            "source_korean", "source_english", "authored_interpretation", "rationale",
        }:
            raise ValueError(f"{identifier}: invalid source-correction fields")
        source = senses[identifier][1]
        for language in ("english", "korean"):
            if correction[f"source_{language}"] != source[language]:
                raise ValueError(f"{identifier}: correction differs from preserved source {language}")
        interpretation = label(correction["authored_interpretation"], identifier)
        prose(correction["rationale"], f"{identifier}.correction rationale")
        if identifier in labels and labels[identifier] != interpretation:
            raise ValueError(f"{identifier}: selected label disagrees with documented correction")
        result[identifier] = {
            **correction, "method": "authored-interpretation", "review_status": "unreviewed",
        }
    return result


def inventory_counts(identifiers: set[str], references: ReferenceBundle,
                     categories: dict, senses: dict) -> dict:
    identities = {references.lexical_identity[item] for item in identifiers}
    kinds = Counter(categories[identity] for identity in identities)
    return {
        "dictionary_entries": len({senses[item][0]["id"] for item in identifiers}),
        "selected_senses": len(identifiers),
        "distinct_spellings": len({references.vocabulary[item]["ch"] for item in identifiers}),
        "spelling_pos_pairs": len({
            (senses[item][0]["target"], senses[item][0]["part_of_speech"]) for item in identifiers
        }),
        "lexical_identities": len(identities),
        "free_lemmas": kinds["free-lemma"],
        "bound_forms": kinds["bound-form"],
        "function_items": kinds["function-item"],
        "unbanded_support_entries": len({
            senses[item][0]["id"] for item in identifiers
            if senses[item][0]["source_band"] == "unbanded"
        }),
        "reading_methods_by_sense": dict(Counter(
            references.provenance[item]["reading"]["method"] for item in sorted(identifiers)
        )),
    }


def phase_inventory(phases: list[dict], scheduled: list[dict], references: ReferenceBundle,
                    categories: dict, senses: dict) -> list[dict]:
    reports, seen = [], set()
    for phase in phases:
        identifiers = {row["id"] for row in scheduled if row["level"] in phase["levels"]}
        identities = {references.lexical_identity[item] for item in identifiers}
        new_identities = identities - seen
        reports.append({
            "id": phase["id"], "levels": phase["levels"],
            **inventory_counts(identifiers, references, categories, senses),
            "new_lexical_identities": len(new_identities),
            "new_free_lemmas": sum(categories[item] == "free-lemma" for item in new_identities),
        })
        seen.update(identities)
    return reports


class KoreanAdapter:
    profile = ProgramProfile("korean", "ko")

    def __init__(self):
        self.forms = {}

    def load(self, root: Path) -> ProgramData:
        inputs = load_inputs(root)
        authoring = root / "authoring" / "teaching"
        inputs["vocabulary"], groups = load_selections(authoring, inputs["vocabulary"])
        registry = load_yaml(root / "source-senses.yaml")
        parents, senses = sense_index(registry)
        readings = load_yaml(root / "reading-overlay.yaml")
        if readings["source_sha256"] != OFFICIAL_SHA256:
            raise ValueError("Korean reading overlay does not identify the pinned official archive")
        reading_decisions = load_yaml(authoring / "reading-decisions.yaml")
        if not isinstance(reading_decisions, dict):
            raise ValueError("Reading decisions must be an explicit mapping")
        if set(reading_decisions) - set(parents):
            raise ValueError("Authored reading decision refers to an unknown source parent")
        labels = dict(inputs["support"])
        for row in inputs["vocabulary"]:
            identifier = row["id"]
            if identifier in labels and labels[identifier] != row["ds"]:
                raise ValueError(f"{identifier}: vocabulary/support labels disagree")
            labels[identifier] = row["ds"]
        corrections = source_corrections(
            load_yaml(authoring / "source-corrections.yaml"), senses, labels,
        )
        words, provenance = {}, {}
        parents_without_readings = {
            parent["id"] for parent, _ in (senses[item] for item in labels if item in senses)
            if not readings["entries"].get(parent["id"], {}).get("pronunciations")
            and parent["id"] not in reading_decisions
        }
        if parents_without_readings:
            raise ValueError(
                "Selected Korean parents require explicit reading decisions: "
                + ", ".join(sorted(parents_without_readings))
            )
        for identifier, disambiguator in labels.items():
            if identifier not in senses:
                raise ValueError(f"Unknown selected Korean source sense: {identifier}")
            parent, sense = senses[identifier]
            pronunciation, reading_source = citation_reading(parent["id"], readings, reading_decisions)
            words[identifier] = {
                "id": identifier, "ch": parent["target"], "pr": pronunciation,
                "ds": label(disambiguator, identifier),
            }
            provenance[identifier] = {
                "source_id": registry["source_id"], "source_entry": parent["source_entry"],
                "source_parent": parent["id"], "source_position": sense["source_position"],
                "source_band": parent["source_band"], "reference_level": parent["reference_level"],
                "source_english": sense["english"], "source_korean": sense["korean"],
                "reading": reading_source,
            }
            if identifier in corrections:
                provenance[identifier]["source_correction"] = corrections[identifier]
        source_grammar = {}
        for number in range(1, 7):
            location = root / f"topik-{number}" / "grammar.yaml"
            for row in load_yaml(location):
                if row["id"] in source_grammar:
                    raise ValueError(f"Duplicate Korean construction: {row['id']}")
                source_grammar[row["id"]] = (row, f"topik-{number}/grammar.yaml#{row['id']}")
        for row in load_yaml(authoring / "grammar-extra.yaml"):
            if row["id"] in source_grammar or not re.fullmatch(r"ko-teaching-g\d{3}", row["id"]):
                raise ValueError(f"Invalid original Korean construction: {row['id']}")
            if len(row["examples"]) < 2:
                raise ValueError(f"{row['id']}: original construction needs bilingual examples")
            source_grammar[row["id"]] = (
                row, f"authoring/teaching/grammar-extra.yaml#{row['id']}",
            )
        patterns = {}
        for row in inputs["grammar"]:
            identifier = row["id"]
            if identifier not in source_grammar or identifier in patterns:
                raise ValueError(f"Unknown or duplicate selected Korean construction: {identifier}")
            original, location = source_grammar[identifier]
            patterns[identifier] = {
                "id": identifier, "ch": text(row["ch"], f"{identifier}.ch"),
                "ds": label(row["ds"], identifier),
            }
            provenance[identifier] = {
                "source_id": original["source_id"], "source_entry": location,
                "source_pattern": original["pattern"], "source_english": original["english"],
                "source_note": original["note"], "reference_level_basis": original["level_basis"],
            }
        identities, categories = lexical_members(groups, words, senses)
        for identifier, identity in identities.items():
            provenance[identifier]["lexical_identity"] = identity
            provenance[identifier]["lexical_category"] = categories[identity]
        references = ReferenceBundle(
            words, patterns, identities, provenance,
            {identifier: f"{SHA256}:{identifier}" for identifier in words},
            {identifier: f"hangul-reading:{entry['pr']}" for identifier, entry in words.items()},
            {identifier: f"hangul-spelling:{entry['ch']}" for identifier, entry in words.items()},
        )
        self.forms = load_yaml(authoring / "phrase-forms.yaml")
        if not isinstance(self.forms, dict):
            raise ValueError("Phrase forms must be an explicit mapping")
        dependencies = load_yaml(authoring / "construction-dependencies.yaml")
        if not isinstance(dependencies, dict):
            raise ValueError("Construction dependencies must be a mapping")
        scheduled, _ = schedule_vocabulary(inputs, words, patterns, {"units": []})
        core_ids = {row["id"] for row in scheduled if type(row["level"]) is int}
        core_counts = inventory_counts(core_ids, references, categories, senses)
        report = {
            "schema_version": 1, "program": "ko-practical",
            "interpretation": (
                "Curated inventory, not learner mastery. Shared inventory headwords are lexical identities; "
                "free_lemmas excludes bound forms and separately categorized function items. "
                "Source entries, senses, spelling/POS pairs, and lexical breadth are distinct counts."
            ),
            "original_banded_dictionary_entries": 11028,
            "original_banded_source_sense_positions": 19661,
            "selected_reference_pool": inventory_counts(set(words), references, categories, senses),
            "core": core_counts,
            "core_free_lemma_planning_range": [5800, 6000],
            "core_free_lemma_gap_to_lower_guide": max(0, 5800 - core_counts["free_lemmas"]),
            "planning_limit": (
                "The range is a planning guide, never a quota or mastery threshold. "
                "Report a shortfall rather than fill it with uncurated entries or extra senses."
            ),
            "lexical_identity_review_status": "unreviewed",
            "phases": phase_inventory(inputs["program"]["phases"], scheduled, references, categories, senses),
            "phase_count_limit": (
                "Phase inventories count senses selected in that phase. The same lexeme may occur "
                "in later phases through another sense; only new_free_lemmas counts its first introduction."
            ),
            "reading_limit": (
                "Authored readings and original phrase realizations are unverified. "
                "Even official citation text does not assess actual audio or verify a whole phrase."
            ),
        }
        for name in ("professional", "technical", "scientific", "literary"):
            ids = {row["id"] for row in scheduled if row["level"] == name}
            report[name] = inventory_counts(ids, references, categories, senses)
        source_report = {
            "schema_version": 1, "program": "ko-practical",
            "interpretation": (
                "Source and authorship evidence, not learner performance or official sense numbering. "
                "Original source meanings and bands remain independent of teaching placement. "
                "Authored interpretations, lexical groups, and phrase readings require qualified review."
            ),
            "source_checksums": {registry["source_id"]: SHA256, readings["source_id"]: OFFICIAL_SHA256},
            "items": provenance,
            "phrases": {
                phrase["id"]: {
                    "source_id": "original-ko",
                    "source_entry": f"teaching/tourist/plan.yaml#{phrase['id']}",
                    "reading_method": "authored-broad-hangul", "review_status": "unreviewed",
                    "vocabulary_senses": phrase["items"], "constructions": phrase["grammar"],
                    "form_ids": [part["form_id"] for part in phrase["realizations"] if "form_id" in part],
                }
                for unit in inputs["tourist"]["units"] for phrase in unit["phrases"]
            },
        }
        return ProgramData(
            inputs, references, construction_dependencies=dependencies,
            source_outputs={
                root / "teaching" / "coverage.yaml": dump_yaml(report),
                root / "teaching" / "source-provenance.yaml": dump_yaml(source_report),
            },
        )

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        segments = []
        for segment in phrase["realizations"]:
            form_id = segment.get("form_id")
            if form_id is not None:
                if form_id not in self.forms:
                    raise ValueError(f"{phrase['id']}: unknown authored Korean realization {form_id}")
                form = self.forms[form_id]
                if set(form) != FORM_FIELDS or form["review_status"] != "unreviewed":
                    raise ValueError(f"{form_id}: invalid or falsely verified form annotation")
                if any(form[key] != segment[key] for key in ("ch", "pr", "items", "grammar")):
                    raise ValueError(f"{form_id}: realization differs from its authored form")
                prose(form["rationale"], f"{form_id}.rationale")
                if not re.fullmatch(r"[가-힣ㄱ-ㅎㅏ-ㅣ]+", form["ch"]):
                    raise ValueError(f"{form_id}: license one orthographic word, not an arbitrary sentence")
                if not form["items"] and not form["grammar"]:
                    raise ValueError(f"{form_id}: a form needs lexical or construction evidence")
            elif (len(segment["items"]) != 1
                  or segment["items"][0] not in context.references.vocabulary
                  or any(segment[key] != context.references.vocabulary[segment["items"][0]][key]
                         for key in ("ch", "pr"))):
                raise ValueError(f"{phrase['id']}: noncanonical Korean form needs an annotation")
            segments.append(SurfaceSegment(
                segment["ch"], segment["pr"], tuple(segment["items"]),
                tuple(segment["grammar"]), form_id,
            ))
        written_words = re.sub(r"[.,!?;:、。！？；：]", "", phrase["ch"]).split()
        if written_words != [segment.ch for segment in segments]:
            raise ValueError(f"{phrase['id']}: realization boundaries do not match authored Korean spacing")
        return PhraseAnalysis(tuple(phrase["items"]), tuple(phrase["grammar"]), tuple(segments))


ADAPTER = KoreanAdapter()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, ADAPTER, check=args.check)
    except (OSError, ValueError, KeyError, UnicodeError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} Korean teaching views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
