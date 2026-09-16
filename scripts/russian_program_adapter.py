"""Bind the Russian curriculum to the centrally maintained practical engine."""

from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import re
import sys
import unicodedata

import yaml

from curriculum_yaml import dump_entries, load_yaml
from practical_program_types import (
    PhraseAnalysis, PhraseContext, ProgramData, ProgramProfile, ReferenceBundle, SurfaceSegment,
)
from russian_curriculum_adapter import RussianReferences, grammar_inputs
from russian_source import SOURCE_ID, fingerprint, load_selections, source_reading
from russian_tourist import tourist_plan


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "russian"
WORD = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")


class RussianProgramAdapter:
    profile = ProgramProfile(language="russian", prefix="ru")

    def load(self, root: Path) -> ProgramData:
        self.references = RussianReferences(root)
        selections = load_selections(root)
        self.references.validate_curation(selections)
        patterns, placements, dependencies, source_outputs = grammar_inputs(root, self.references)
        program = load_yaml(root / "teaching" / "program.yaml")
        mastery = load_yaml(root / "teaching" / "mastery.yaml")
        authored_grammar = load_yaml(root / "authoring" / "grammar.yaml")
        fixed_texts = {row["id"]: row["fixed_forms"] for row in authored_grammar}
        grammar_forms = load_yaml(root / "build" / "grammar-forms.yaml")
        if not isinstance(grammar_forms, list):
            raise ValueError("Russian fixed-construction forms must be a list")
        self.grammar_forms = {}
        for form in grammar_forms:
            if form["id"] in self.grammar_forms or form["grammar_id"] not in patterns:
                raise ValueError("Unknown or repeated fixed-construction form")
            raw = form["source_data"]
            if (form["source_id"] != SOURCE_ID or fingerprint(raw) != form["source_record_sha256"]
                    or source_reading(raw[form["source_field"]], target=form["target"])[0] != form["reading"]):
                raise ValueError(f"{form['id']}: fixed-form source reading differs")
            target_words = WORD.findall(form["target"].casefold())
            licensed = False
            for fixed in fixed_texts[form["grammar_id"]]:
                words = WORD.findall(fixed.casefold())
                licensed |= any(words[index:index + len(target_words)] == target_words
                                for index in range(len(words)))
            if not target_words or not licensed:
                raise ValueError(f"{form['id']}: surface is not owned by the stated fixed construction")
            self.grammar_forms[form["id"]] = form
        tourist = tourist_plan(root, self.references, patterns, placements, dependencies, grammar_forms)
        source_outputs[root / "teaching" / "tourist" / "plan.yaml"] = dump_entries(tourist)
        self.phrases = deepcopy({
            phrase["id"]: phrase for unit in tourist["units"] for phrase in unit["phrases"]
        })
        inputs = {
            "program": program, "mastery": mastery,
            "vocabulary": [{key: row[key] for key in ("id", "level", "topic", "ds")}
                           for row in selections],
            "grammar": placements, "support": {}, "tourist": tourist,
        }
        provenance = dict(self.references.expanded)
        for row in authored_grammar:
            provenance[row["id"]] = {
                "source_id": "original-ru", "source_entry": f"local:authoring/grammar.yaml#{row['id']}",
                "authoring": row,
            }
        bundle = ReferenceBundle(
            vocabulary=self.references.vocabulary, grammar=patterns,
            lexical_identity=self.references.lexical_identity, provenance=provenance,
            source_sense_identity=self.references.source_sense_identity,
            reading_identity=self.references.reading_identity,
            spelling_identity=self.references.spelling_identity,
        )
        return ProgramData(
            inputs=inputs, references=bundle, source_outputs=source_outputs,
            construction_dependencies={key: tuple(value) for key, value in dependencies.items()},
        )

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis:
        if phrase["id"] not in self.phrases or phrase != self.phrases[phrase["id"]]:
            raise ValueError("Russian phrase differs from its authored sense/form alignment")
        segments = []
        for segment in phrase["realizations"]:
            lexical, grammar = segment["items"], segment["grammar"]
            form_id = segment.get("form_id")
            if lexical:
                if len(lexical) != 1:
                    raise ValueError("A Russian lexical realization must identify one intended sense")
                identifier = lexical[0]
                if form_id is None:
                    canonical = context.references.vocabulary[identifier]
                    if (segment["ch"], segment["pr"]) != (canonical["ch"], canonical["pr"]):
                        raise ValueError("Noncanonical Russian realization requires a source form")
                else:
                    self.references.validate_form(identifier, form_id, segment["ch"], segment["pr"])
            else:
                if form_id not in self.grammar_forms:
                    raise ValueError("Fixed Russian grammar needs an explicitly sourced construction form")
                form = self.grammar_forms[form_id]
                if (form["grammar_id"] not in grammar or
                        (segment["ch"].casefold(), segment["pr"].casefold()) !=
                        (form["target"].casefold(), form["reading"].casefold())):
                    raise ValueError("Fixed Russian grammar realization differs from its source/linkage")
            segments.append(SurfaceSegment(
                segment["ch"], segment["pr"], tuple(lexical), tuple(grammar), form_id,
            ))
        phrase_words = WORD.findall(unicodedata.normalize("NFC", phrase["ch"]))
        segment_words = [word for segment in segments
                         for word in WORD.findall(unicodedata.normalize("NFC", segment.ch))]
        if phrase_words != segment_words:
            raise ValueError("Russian phrase alignment changes word boundaries")
        return PhraseAnalysis(tuple(phrase["items"]), tuple(phrase["grammar"]), tuple(segments))


ADAPTER = RussianProgramAdapter()


def main() -> int:
    from generate_practical_program import generate

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="Check every generated view without writing")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, ADAPTER, check=args.check)
    except (OSError, UnicodeError, ValueError, KeyError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} Russian program views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
