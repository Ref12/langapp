"""Spanish canonical records and phrase morphology for the neutral program engine."""

from __future__ import annotations

import hashlib
from pathlib import Path

from curriculum_yaml import dump_entries, load_yaml
from import_spanish_curriculum import reference_outputs
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SurfaceSegment,
)
from spanish_sources import canonical_vocabulary, effective_selections
from spanish_tourist import compile_route, written


def identity(kind: str, value: str) -> str:
    return f"es-{kind}-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


class SpanishAdapter:
    profile = ProgramProfile(language="spanish", prefix="es")

    def load(self, root: Path) -> ProgramData:
        expanded, _ = canonical_vocabulary(root)
        authored_grammar = load_yaml(root / "authoring" / "grammar.yaml")
        words, lexemes, sources, readings, spellings, provenance = {}, {}, {}, {}, {}, {}
        for group in expanded:
            for sense in group["senses"]:
                identifier = sense["id"]
                words[identifier] = {
                    "id": identifier, "ch": sense["target"], "pr": sense["reading"],
                    "ds": sense["disambiguator"],
                }
                lexemes[identifier] = group["id"]
                sources[identifier] = sense["source_id"] + ":" + sense["source_sense_id"]
                readings[identifier] = identity("reading", sense["reading"])
                spellings[identifier] = identity("spelling", sense["target"])
                provenance[identifier] = {
                    "source_id": sense["source_id"], "source_entry": sense["source_entry"],
                    "source_sense_id": sense["source_sense_id"],
                }
        patterns = {}
        for row in authored_grammar:
            identifier = row["id"]
            if identifier in patterns or identifier in words:
                raise ValueError(f"Repeated Spanish construction identity: {identifier}")
            patterns[identifier] = {key: row[key] for key in ("id", "ch", "ds")}
            provenance[identifier] = {
                "source_id": "es-original-teaching",
                "source_entry": "authoring/grammar.yaml#" + identifier,
            }
        route, licenses = compile_route(root, words, patterns, authored_grammar)
        for identifier, license_record in licenses.items():
            for owner in [*license_record["items"], *license_record["grammar"]]:
                provenance[owner].setdefault("realizations", {})[identifier] = license_record
        references = ReferenceBundle(
            vocabulary=words, grammar=patterns, lexical_identity=lexemes, provenance=provenance,
            source_sense_identity=sources, reading_identity=readings, spelling_identity=spellings,
        )
        outputs = reference_outputs(root)
        vocabulary_placements = [
            {key: row[key] for key in ("id", "level", "topic", "ds")}
            for row in effective_selections(root)
        ]
        _, aliases = canonical_vocabulary(root)
        grammar_placements = [
            {**{key: row[key] for key in ("id", "level", "topic", "ch", "ds")},
             "anchors": [aliases[alias] for alias in row["anchors"]]}
            for row in authored_grammar
        ]
        inputs = {
            "program": load_yaml(root / "teaching" / "program.yaml"),
            "mastery": load_yaml(root / "teaching" / "mastery.yaml"),
            "vocabulary": vocabulary_placements, "grammar": grammar_placements,
            "support": {}, "tourist": route,
        }
        outputs[root / "teaching" / "tourist" / "plan.yaml"] = dump_entries(route)
        return ProgramData(
            inputs=inputs, references=references,
            construction_dependencies={row["id"]: tuple(row["prerequisites"]) for row in authored_grammar},
            source_outputs=outputs,
        )

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        segments = []
        for segment in phrase["realizations"]:
            identifier = segment.get("form_id")
            if not identifier:
                raise ValueError(f"{phrase['id']}: an explicit licensed realization is required")
            owners = [*segment["items"], *segment["grammar"]]
            licenses = [
                context.references.provenance[owner].get("realizations", {}).get(identifier)
                for owner in owners if owner in context.references.provenance
            ]
            if not licenses or any(license_record is None for license_record in licenses):
                raise ValueError(f"{phrase['id']}: unknown or unlicensed form {identifier}")
            for license_record in licenses:
                if (
                    written(segment["ch"]) != written(license_record["ch"])
                    or segment["pr"] != license_record["pr"]
                    or segment["items"] != license_record["items"]
                    or segment["grammar"] != license_record["grammar"]
                ):
                    raise ValueError(f"{phrase['id']}: altered or mislinked realization {identifier}")
            segments.append(SurfaceSegment(
                ch=segment["ch"], pr=segment["pr"], items=tuple(segment["items"]),
                grammar=tuple(segment["grammar"]), form_id=identifier,
            ))
        return PhraseAnalysis(
            items=tuple(phrase["items"]), grammar=tuple(phrase["grammar"]),
            realizations=tuple(segments),
        )


ADAPTER = SpanishAdapter()
