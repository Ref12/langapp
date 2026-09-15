"""French source identities and explicitly licensed surface realizations."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
import unicodedata

from curriculum_yaml import dump_yaml, load_yaml
from import_french_curriculum import (
    ORIGINAL_SOURCE, ROOT, authoring_fields as fields, authoring_label as label,
    authoring_text as nonempty, compile_grammar, phonetic_ipa, read_projection,
    reference_data, serialize_references, stable_id,
)
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SurfaceSegment,
)


def phones(value: str) -> str:
    """Compare source phonemes without IPA brackets or syllabification."""
    return "".join(character for character in unicodedata.normalize("NFC", value)
                   if not character.isspace() and character not in "/[].")


def compile_realizations(specs: list[dict], words: dict, patterns: dict,
                         expanded: dict, projection: dict) -> dict:
    registry = {}
    source_records = {row["record"]: row for row in projection["kaikki"]}
    phonetic_rows = defaultdict(list)
    for row in projection["lexique"]:
        phonetic_rows[row["ortho"]].append(row)
    for spec in specs:
        fields(spec, {"id", "kind", "ch", "pr", "grammar"},
               {"word", "tags", "next_words", "previous_words", "next_realizations", "previous_realizations"})
        identifier = nonempty(spec["id"], "realization.id")
        if not re.fullmatch(r"fr-f-[a-z0-9]+(?:-[a-z0-9]+)*", identifier) or identifier in registry:
            raise ValueError(f"Invalid or repeated French realization ID: {identifier}")
        nonempty(spec["ch"], identifier)
        nonempty(spec["pr"], identifier)
        if (not isinstance(spec["grammar"], list)
                or len(spec["grammar"]) != len(set(spec["grammar"]))
                or any(item not in patterns for item in spec["grammar"])):
            raise ValueError(f"{identifier}: unknown or repeated construction")
        constraints = {}
        for direction in ("next_words", "previous_words"):
            names = spec.get(direction, [])
            if not isinstance(names, list) or len(names) != len(set(names)):
                raise ValueError(f"{identifier}: invalid slot constraint")
            if any(word not in words for word in names):
                raise ValueError(f"{identifier}: unknown slot word")
            constraints[direction] = tuple(words[word]["id"] for word in names)
            realization_key = direction.replace("_words", "_realizations")
            allowed = spec.get(realization_key, ["canonical"] if names else [])
            if (not isinstance(allowed, list) or len(allowed) != len(set(allowed))
                    or any(not isinstance(value, str) or not value for value in allowed)
                    or bool(allowed) != bool(names)):
                raise ValueError(f"{identifier}: invalid grammatical realization constraint")
            constraints[realization_key] = tuple(allowed)
        kind = spec["kind"]
        lexical = ()
        if kind == "construction":
            if "word" in spec or "tags" in spec or len(spec["grammar"]) != 1:
                raise ValueError(f"{identifier}: a fixed construction has exactly one grammar owner")
            if (spec["ch"] != spec["ch"].strip() or spec["ch"].endswith(("'", "\u2019"))) and not any(constraints.values()):
                raise ValueError(f"{identifier}: non-standalone construction requires a constrained slot")
            evidence = {
                "source_id": ORIGINAL_SOURCE,
                "status": "Original contextual/formula pronunciation; not source-verified or observed audio.",
            }
        elif kind in ("sentence-case", "source-inflection"):
            if spec.get("word") not in words or any(constraints.values()):
                raise ValueError(f"{identifier}: invalid lexical realization owner or slot constraint")
            word = words[spec["word"]]
            lexical = (word["id"],)
            source = expanded[word["id"]]
            if kind == "sentence-case":
                if (spec["ch"] != word["ch"][:1].upper() + word["ch"][1:]
                        or spec["pr"] != word["pr"] or spec["grammar"] or "tags" in spec):
                    raise ValueError(f"{identifier}: only sentence-initial capitalization is licensed")
                evidence = {"source_id": source["source_id"], "status": "Capitalization only; source reading unchanged."}
            else:
                if not spec["grammar"] or not isinstance(spec.get("tags"), list) or not spec["tags"]:
                    raise ValueError(f"{identifier}: inflection needs grammatical licensing and source tags")
                record = source_records[source["source_record"]]
                forms = [form for form in record["forms"]
                         if form.get("form") == spec["ch"] and set(spec["tags"]) <= set(form.get("tags", []))]
                if not forms:
                    raise ValueError(f"{identifier}: written inflection is not attested for its lexical owner")
                direct = any(form.get("ipa") and phones(form["ipa"]) == phones(spec["pr"]) for form in forms)
                base_lemmas = {row["lemme"] for row in phonetic_rows[source["lemma"]]
                               if row["phon"] and phones(phonetic_ipa(row["phon"])) == phones(word["pr"])}
                supporting = [
                    row for row in phonetic_rows[spec["ch"]]
                    if row["lemme"] in base_lemmas and row["phon"]
                    and phones(phonetic_ipa(row["phon"])) == phones(spec["pr"])
                ]
                if not direct and not supporting:
                    raise ValueError(f"{identifier}: inflection pronunciation lacks aligned source support")
                evidence = {
                    "source_id": source["source_id"] if direct else "lexique-3.83",
                    "source_record": source["source_record"] if direct else supporting[0]["record"],
                    "status": "Source-attested inflection and aligned phonology; syllable separators may differ.",
                }
        else:
            raise ValueError(f"{identifier}: unknown realization kind {kind!r}")
        # Authored boundary spaces guide joining; engine segments are trimmed.
        registry[identifier] = {
            "segment": SurfaceSegment(spec["ch"].strip(), spec["pr"].strip(), lexical, tuple(spec["grammar"]), identifier),
            **constraints, "evidence": evidence, "kind": kind,
        }
    for identifier, licensed in registry.items():
        for direction in ("next_words", "previous_words"):
            for form_id in licensed[direction.replace("_words", "_realizations")]:
                if form_id == "canonical":
                    continue
                target = registry.get(form_id)
                if (target is None or len(target["segment"].items) != 1
                        or target["segment"].items[0] not in licensed[direction]):
                    raise ValueError(f"{identifier}: slot realization has an unrelated lexical owner")
    return registry


def compile_tourist(spec: dict, words: dict, registry: dict) -> dict:
    fields(spec, {"schema_version", "id", "title", "language", "level_basis", "review_policy", "quick_start", "units"})
    units = []
    for unit in spec["units"]:
        fields(unit, {
            "id", "title", "outcome", "vocabulary_words", "grammar",
            "review_words", "review_grammar", "phrases",
        })
        resolved = {key: unit[key] for key in ("id", "title", "outcome", "grammar", "review_grammar")}
        for original, target in (("vocabulary_words", "vocabulary"), ("review_words", "review_vocabulary")):
            if not isinstance(unit[original], list) or any(word not in words for word in unit[original]):
                raise ValueError(f"{unit['id']}: unknown or malformed tourist vocabulary")
            resolved[target] = [words[word]["id"] for word in unit[original]]
        phrases = []
        for phrase in unit["phrases"]:
            fields(phrase, {"id", "ds", "segments"})
            segments = []
            for segment in phrase["segments"]:
                if isinstance(segment, dict) and set(segment) == {"word"} and segment["word"] in words:
                    word = words[segment["word"]]
                    segments.append(SurfaceSegment(word["ch"], word["pr"], (word["id"],)))
                elif isinstance(segment, dict) and set(segment) == {"form"} and segment["form"] in registry:
                    segments.append(registry[segment["form"]]["segment"])
                else:
                    raise ValueError(f"{phrase['id']}: unknown tourist segment {segment!r}")
            if not segments:
                raise ValueError(f"{phrase['id']}: empty tourist phrase")
            realizations = [{
                "ch": segment.ch, "pr": segment.pr, "items": list(segment.items),
                "grammar": list(segment.grammar),
                **({"form_id": segment.form_id} if segment.form_id is not None else {}),
            } for segment in segments]
            written = ""
            for segment in segments:
                if (written and not written[-1].isspace() and not segment.ch[0].isspace()
                        and written[-1] not in "'\u2019-" and segment.ch[0] not in ".,!?;:"):
                    written += " "
                written += segment.ch
            phrases.append({
                "id": phrase["id"], "ch": written.strip(),
                "pr": " ".join(segment.pr for segment in segments),
                "ds": label(phrase["ds"], phrase["id"]),
                "items": list(dict.fromkeys(item for segment in segments for item in segment.items)),
                "grammar": list(dict.fromkeys(item for segment in segments for item in segment.grammar)),
                "realizations": realizations,
            })
        resolved["phrases"] = phrases
        units.append(resolved)
    return {**spec, "units": units}


class FrenchAdapter:
    profile = ProgramProfile("french", "fr")

    def __init__(self) -> None:
        self._realizations: dict | None = None

    def load(self, root: Path) -> ProgramData:
        authoring = root / "authoring" / "teaching"
        projection = read_projection(root)
        choices = load_yaml(authoring / "sense-selections.yaml")
        expanded_rows, vocabulary_placements, reference_rows = reference_data(root, projection, choices)
        expanded = {row["id"]: row for row in expanded_rows}
        vocabulary = {row["id"]: {
            "id": row["id"], "ch": row["target"], "pr": row["reading"], "ds": row["disambiguator"],
        } for row in expanded_rows}
        words = {choice["word"]: vocabulary[choice["id"]] for choice in choices if choice["primary"]}
        program = load_yaml(root / "teaching" / "program.yaml")
        definitions = [
            *load_yaml(authoring / "grammar-definitions.yaml"),
            *load_yaml(authoring / "tourist-grammar.yaml"),
        ]
        grammar, grammar_provenance, dependencies, grammar_placements, grammar_rows = compile_grammar(
            definitions, words, program,
        )
        registry = compile_realizations(load_yaml(authoring / "realizations.yaml"), words, grammar, expanded, projection)
        tourist = compile_tourist(load_yaml(authoring / "tourist.yaml"), words, registry)
        known_words, known_grammar = set(), set()
        for unit in tourist["units"]:
            known_words.update(unit["vocabulary"])
            current = set(unit["grammar"])
            if not current <= grammar.keys():
                raise ValueError(f"{unit['id']}: unknown tourist construction")
            for identifier in current:
                if not set(grammar_provenance[identifier]["anchors"]) <= known_words:
                    raise ValueError(f"{unit['id']}: tourist construction anchor has not been introduced")
                if not set(dependencies[identifier]) <= known_grammar | current:
                    raise ValueError(f"{unit['id']}: tourist construction prerequisite has not been introduced")
            known_grammar.update(current)
        provenance = {**{identifier: dict(row) for identifier, row in expanded.items()}, **grammar_provenance}
        for identifier, realization in registry.items():
            segment = realization["segment"]
            for owner in (*segment.items, *segment.grammar):
                provenance[owner].setdefault("surface_realizations", {})[identifier] = {
                    "ch": segment.ch, "pr": segment.pr, **realization["evidence"],
                }
        references = ReferenceBundle(
            vocabulary=vocabulary, grammar=grammar,
            lexical_identity={identifier: row["headword_id"] for identifier, row in expanded.items()},
            provenance=provenance,
            source_sense_identity={identifier: row["source_sense_id"] for identifier, row in expanded.items()},
            reading_identity={identifier: stable_id("reading", row["canonical_lemma"] + "|" + row["reading"])
                              for identifier, row in expanded.items()},
            spelling_identity={identifier: stable_id("spelling", row["canonical_lemma"] + "|" + row["target"])
                               for identifier, row in expanded.items()},
        )
        outputs = serialize_references(root, expanded_rows, vocabulary_placements, reference_rows)
        outputs.update({
            root / "reference" / "grammar.yaml": dump_yaml(grammar_rows),
            root / "realization-provenance.yaml": dump_yaml([{
                "id": identifier, "kind": realization["kind"],
                "ch": realization["segment"].ch, "pr": realization["segment"].pr,
                "items": list(realization["segment"].items), "grammar": list(realization["segment"].grammar),
                "next_words": list(realization["next_words"]), "previous_words": list(realization["previous_words"]),
                "next_realizations": list(realization["next_realizations"]),
                "previous_realizations": list(realization["previous_realizations"]),
                **realization["evidence"],
            } for identifier, realization in registry.items()]),
            authoring / "grammar.yaml": dump_yaml(grammar_placements),
            authoring / "support.yaml": dump_yaml({}),
            root / "teaching" / "tourist" / "plan.yaml": dump_yaml(tourist),
        })
        data = ProgramData(
            inputs={
                "program": program, "mastery": load_yaml(root / "teaching" / "mastery.yaml"),
                "vocabulary": vocabulary_placements, "grammar": grammar_placements,
                "support": {}, "tourist": tourist,
            },
            references=references, construction_dependencies=dependencies, source_outputs=outputs,
        )
        self._realizations = registry
        return data

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        if self._realizations is None or context.profile != self.profile:
            raise ValueError("French phrase validation requires a loaded French adapter")
        segments = []
        for raw in phrase["realizations"]:
            fields(raw, {"ch", "pr", "items", "grammar"}, {"form_id"})
            segment = SurfaceSegment(
                raw["ch"], raw["pr"], tuple(raw["items"]), tuple(raw["grammar"]), raw.get("form_id"),
            )
            if segment.form_id is not None:
                licensed = self._realizations.get(segment.form_id)
                if licensed is None or licensed["segment"] != segment:
                    raise ValueError(f"{phrase['id']}: unlicensed or mismatched French surface/reading")
            elif (len(segment.items) != 1 or segment.grammar
                  or segment.items[0] not in context.references.vocabulary
                  or (segment.ch, segment.pr) != (
                      context.references.vocabulary[segment.items[0]]["ch"],
                      context.references.vocabulary[segment.items[0]]["pr"],
                  )):
                raise ValueError(f"{phrase['id']}: noncanonical French text requires a validated realization")
            if not set(segment.items) <= context.introduced_vocabulary:
                raise ValueError(f"{phrase['id']}: lexical evidence has not been introduced")
            if not set(segment.grammar) <= context.introduced_grammar:
                raise ValueError(f"{phrase['id']}: construction evidence has not been introduced")
            segments.append(segment)
        for index, segment in enumerate(segments):
            if segment.form_id is None:
                continue
            licensed = self._realizations[segment.form_id]
            for key, offset in (("next_words", 1), ("previous_words", -1)):
                allowed = licensed[key]
                if allowed:
                    neighbor = index + offset
                    if (not 0 <= neighbor < len(segments)
                            or len(segments[neighbor].items) != 1
                            or segments[neighbor].items[0] not in allowed):
                        raise ValueError(f"{phrase['id']}: invalid French article, elision, or construction slot")
                    allowed_forms = licensed[key.replace("_words", "_realizations")]
                    if (segments[neighbor].form_id or "canonical") not in allowed_forms:
                        raise ValueError(f"{phrase['id']}: invalid French grammatical realization in construction slot")
        return PhraseAnalysis(
            tuple(dict.fromkeys(item for segment in segments for item in segment.items)),
            tuple(dict.fromkeys(item for segment in segments for item in segment.grammar)),
            tuple(segments),
        )


ADAPTER = FrenchAdapter()


if __name__ == "__main__":
    import argparse
    from generate_practical_program import generate

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = generate(args.root, ADAPTER, check=args.check)
    print(f"{'Checked' if args.check else 'Generated'} {len(generated)} French program files")
