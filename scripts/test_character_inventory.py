"""Active teaching views contribute exact writing text, not arbitrary program metadata."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yaml

from character_assets import build_outputs, sha256
from character_inventory import TEACHING_INPUT_FILES, extract_inventory
from curriculum_yaml import load_yaml, write_yaml
from generate_practical_program import program_outputs
from generate_teaching_track import load_reference_index, teaching_outputs
from practical_program_registry import ProgramRegistration, REGISTRATIONS
from practical_program_types import PhraseAnalysis, ProgramData, ProgramProfile, ReferenceBundle, SurfaceSegment


class FixtureAdapter:
    def __init__(self, profile, data, form):
        self.profile, self.data, self.form = profile, data, form

    def load(self, root):
        return self.data

    def validate_phrase(self, phrase, context):
        for segment in phrase["realizations"]:
            if segment != self.form:
                raise ValueError("Unlicensed fixture realization")
        return PhraseAnalysis(tuple(phrase["items"]), tuple(phrase["grammar"]), tuple(
            SurfaceSegment(segment["ch"], segment["pr"], tuple(segment["items"]),
                           tuple(segment["grammar"]), segment.get("form_id"))
            for segment in phrase["realizations"]
        ))


class CharacterTeachingInventoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.language = "japanese"

    def setup_reference(self, language="japanese"):
        self.language = language
        self.language_root = self.root / language
        level = {"japanese": "jlpt-n5", "korean": "topik-1", "chinese": "hsk-1"}[language]
        directory = self.language_root / level
        directory.mkdir(parents=True)
        self.declaration = {"id": language, "levels": [level]}
        write_yaml(self.root / "catalog.yaml", {"schema_version": 1, "languages": [self.declaration]})
        write_yaml(directory / "vocabulary.yaml", [
            {"id": "reference-word", "target": "\u4e00" if language != "korean" else "\uac00",
             "reading": "\u3044\u3061", "english": "Never harvest \u9f8d"},
        ])
        write_yaml(directory / "grammar.yaml", [
            {"id": "reference-grammar", "pattern": "V+\u3067\u3059" if language != "korean" else "V+\ub2e4",
             "examples": [{"target": "\u4e8c" if language != "korean" else "\ub098",
                           "english": "Never harvest \u9f8d"}]},
        ])
        write_yaml(self.language_root / "sources.yaml", [])
        if language == "korean":
            (self.language_root / "README.md").write_text(
                "\ud559\uad50 [\ud559\uaf9c]\n\uc637 [\uc62b]\n", encoding="utf-8",
            )

    def configure(self, *, tracks=(), program=False):
        self.declaration["teaching_tracks"] = list(tracks)
        if program:
            self.declaration["teaching_program"] = REGISTRATIONS[self.language].program_id
        else:
            self.declaration.pop("teaching_program", None)
        write_yaml(self.root / "catalog.yaml", {"schema_version": 1, "languages": [self.declaration]})

    def setup_adapter(self):
        prefix = REGISTRATIONS[self.language].prefix
        baseline = Path(__file__).resolve().parents[1] / "curriculum" / "chinese" / "teaching"
        program = load_yaml(baseline / "program.yaml")
        program.update(id=f"{prefix}-practical", language=self.language,
                       title="Ignore metadata \u9f8d", review_policy="Ignore metadata \u9f8d")
        mastery = load_yaml(baseline / "mastery.yaml")
        mastery["id"] = f"{prefix}-item-mastery"
        inputs = {"program": program, "mastery": mastery, "vocabulary": [], "grammar": [], "support": {}}
        words, patterns, identities, provenance = {}, {}, {}, {}
        for number, destination in enumerate([*range(1, 31), "professional", "technical", "scientific", "literary"], 1):
            identifier, construction = f"word-{number}", f"grammar-{number}"
            words[identifier] = {
                "id": identifier, "ch": "\u3400" if self.language != "korean" else "\uac01",
                "pr": "\u3090" if self.language == "japanese" else "romanization-\ubd93",
                "ds": f"Meaning {number} \u9f8d",
            }
            patterns[construction] = {
                "id": construction, "ch": "V+\u3401" if self.language != "korean" else "V+\uac02",
                "ds": f"Construction {number} \u9f8d",
            }
            inputs["vocabulary"].append({
                "id": identifier, "level": destination, "topic": "grammar", "ds": words[identifier]["ds"],
            })
            inputs["grammar"].append({
                **patterns[construction], "level": destination, "topic": "grammar", "anchors": [identifier],
            })
            identities[identifier] = identifier
            for item in (identifier, construction):
                provenance[item] = {"source_id": "fixture", "source_entry": "Do not scan \u9f8d"}
        # Unselected references are available for resolution, not automatically teaching requirements.
        words["inactive-word"] = {"id": "inactive-word", "ch": "\u9f8d", "pr": "\u3068", "ds": "Inactive"}
        identities["inactive-word"] = "inactive-word"
        provenance["inactive-word"] = {"source_id": "fixture", "source_entry": "unused"}
        self.form = {
            "ch": "\uf900" if self.language != "korean" else "\uac03",
            "pr": "\u3091" if self.language == "japanese" else "spoken-\ubd93",
            "items": ["word-1"], "grammar": ["grammar-1"], "form_id": "fixture-form",
        }
        phrase = {
            "id": f"{prefix}-tourist-p001",
            "ch": "\u8c48\uff27\u3002" if self.language != "korean" else "\uac03\u3002",
            "pr": self.form["pr"], "ds": "Tourist phrase \u9f8d",
            "items": self.form["items"], "grammar": self.form["grammar"],
            "realizations": [self.form],
        }
        if self.language != "korean":
            self.form["ch"] += "\uff27"
        inputs["tourist"] = {
            "schema_version": 1, "id": f"{prefix}-tourist", "title": "Tourist \u9f8d",
            "language": self.language, "level_basis": "Fixture.", "review_policy": "Review.",
            "quick_start": ["first"], "units": [{
                "id": "first", "title": "First \u9f8d", "outcome": "Ignore \u9f8d",
                "vocabulary": ["word-1"], "grammar": ["grammar-1"],
                "review_vocabulary": [], "review_grammar": [], "phrases": [phrase],
            }, {
                "id": "second", "title": "Second", "outcome": "Review.",
                "vocabulary": ["word-2"], "grammar": ["grammar-2"],
                "review_vocabulary": ["word-1"], "review_grammar": ["grammar-1"],
                "phrases": [{**deepcopy(phrase), "id": f"{prefix}-tourist-p002"}],
            }],
        }
        references = ReferenceBundle(words, patterns, identities, provenance,
                                     dict(identities), dict(identities), dict(identities))
        self.data = ProgramData(inputs, references)
        self.adapter = FixtureAdapter(ProgramProfile(self.language, prefix), self.data, self.form)
        for path, key in zip(TEACHING_INPUT_FILES, ("program", "mastery", "vocabulary", "grammar", "support", "tourist")):
            output = self.language_root / path
            output.parent.mkdir(parents=True, exist_ok=True)
            write_yaml(output, inputs[key])

    def write_outputs(self, outputs):
        for path, value in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8", newline="\n")

    def write_program(self):
        self.write_outputs(program_outputs(self.language_root, self.data, self.adapter))

    def write_track(self):
        prefix = REGISTRATIONS[self.language].prefix
        sequence = {
            "schema_version": 1, "id": f"{prefix}-beginner", "title": "Beginner \u9f8d",
            "language": self.language, "level_basis": "Fixture.", "review_policy": "Review.",
            "units": [{key: value for key, value in unit.items() if key != "phrases"}
                      for unit in self.data.inputs["tourist"]["units"]],
        }
        self.write_outputs(teaching_outputs(
            self.language_root / "teaching" / "beginner", sequence,
            self.data.references.vocabulary, self.data.references.grammar,
            language=self.language, prefix=prefix,
        ))

    def inventory(self):
        with patch("character_inventory.get_adapter", return_value=self.adapter):
            return extract_inventory(self.root, self.language)

    def test_active_non_chinese_track_resolves_new_forms_and_reviews(self):
        self.setup_reference()
        self.setup_adapter()
        self.configure(tracks=["beginner"])
        self.write_track()
        result = self.inventory()
        self.assertTrue({"\u4e00", "\u4e8c", "\u3400", "\u3401", "\u3090"} <= set(result["required"]))
        self.assertNotIn("\u9f8d", result["characters"])
        self.assertIn("V", result["notation"])
        self.assertNotIn("V", result["literal_cross_script"])
        rows = result["characters"]["\u3400"]["evidence"]
        self.assertTrue(any(row["scope"] == "teaching:beginner"
                            and row["field"] == "review_vocabulary.ch" for row in rows))
        self.assertEqual(result["components"], ["\u3099", "\u309a"])
        self.assertFalse(any("teaching:program:" in key for key in result["scopes"]))

    def test_active_program_preserves_exact_core_extension_tourist_and_realization_text(self):
        self.setup_reference()
        self.setup_adapter()
        self.configure(program=True)
        self.write_program()
        result = self.inventory()
        self.assertTrue({"\u3400", "\u3401", "\u8c48", "\uf900", "\u3090", "\u3091"} <= set(result["required"]))
        self.assertIn("\uff27", result["literal_cross_script"])
        self.assertNotIn("\u9f8d", result["characters"])
        self.assertIn("V", result["notation"])
        self.assertEqual(result["components"], ["\u3099", "\u309a"])
        scopes = result["scopes"]
        self.assertIn("teaching:program:ja-practical:level-01", scopes)
        self.assertIn("teaching:program:ja-practical:extension:literary", scopes)
        self.assertIn("teaching:program:ja-practical:tourist", scopes)
        evidence = result["characters"]["\u8c48"]["evidence"]
        self.assertEqual([(row["field"], row["occurrences"]) for row in evidence], [("phrases.ch", 2)])
        rows = result["characters"]["\uf900"]["evidence"]
        self.assertEqual(rows[0]["field"], "phrase_components.realizations.ch")
        self.assertEqual(rows[0]["occurrences"], 2)
        self.assertFalse(any("quick-start" in scope for scope in scopes))
        pins = {row["path"]: row["sha256"] for row in result["inputs"]}
        for relative in (*TEACHING_INPUT_FILES, "sources.yaml", "teaching/core/sequence.yaml", "teaching/tourist/sequence.yaml"):
            self.assertEqual(pins["japanese/" + relative], sha256((self.language_root / relative).read_bytes()))
        tools = {row["file"] for row in result["tool_inputs"]}
        self.assertTrue({"generate_practical_program.py", "practical_program_types.py",
                         "japanese_program_adapter.py", "import_japanese_curriculum.py"} <= tools)
        manifest = yaml.safe_load(build_outputs(
            self.language_root, {}, result, [], adapter="fixture", adapter_version="1",
        )["manifest.yaml"])
        self.assertTrue(tools <= {row["file"] for row in manifest["shared_tools"]})
        result["tool_inputs"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "stale inventory tool checksum"):
            build_outputs(self.language_root, {}, result, [], adapter="fixture", adapter_version="1")

    def test_literal_digits_and_punctuation_keep_distinct_grammar_notation_evidence(self):
        self.setup_reference()
        self.setup_adapter()
        digits = "".join(chr(codepoint) for codepoint in range(0xff10, 0xff1a))
        self.data.references.vocabulary["word-1"]["ch"] += digits + "?"
        self.data.references.grammar["grammar-1"]["ch"] += "[\uff11]?"
        self.configure(tracks=["beginner"])
        self.write_track()
        result = self.inventory()
        self.assertEqual(set(result["literal_signs"]), set(digits + "?"))
        self.assertTrue(set("V+[]?\uff11") <= set(result["notation"]))
        self.assertFalse(result["literal_cross_script"])
        self.assertFalse(set("0123456789") & set(result["characters"]))
        rows = result["characters"]["\uff11"]["evidence"]
        self.assertTrue(any(row["field"] == "review_vocabulary.ch"
                            and row["classification"] == "literal_sign" for row in rows))
        self.assertTrue(any(row["field"] == "grammar.ch"
                            and row["classification"] == "notation" for row in rows))

    def test_inactive_programs_and_views_do_not_add_requirements_or_pins(self):
        self.setup_reference()
        self.setup_adapter()
        self.write_program()
        self.write_track()
        with patch("character_inventory.get_adapter", side_effect=AssertionError("inactive adapter loaded")):
            result = extract_inventory(self.root, self.language)
        self.assertNotIn("\u3400", result["required"])
        self.assertNotIn("\u8c48", result["required"])
        self.assertEqual(len(result["inputs"]), 3)
        self.assertFalse(any(row["file"] == "japanese_program_adapter.py" for row in result["tool_inputs"]))

    def test_missing_stale_and_invalid_active_views_fail_without_writes(self):
        self.setup_reference()
        self.setup_adapter()
        self.configure(program=True)
        self.write_program()
        path = self.language_root / "teaching" / "core" / "sequence.yaml"
        original = path.read_bytes()
        path.write_bytes(original.replace("\u3400".encode(), "\u3402".encode()))
        with self.assertRaisesRegex(ValueError, "stale teaching view"):
            self.inventory()
        self.assertNotEqual(path.read_bytes(), original)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.inventory()
        path.write_bytes(original)
        self.form["ch"] = "\u9f8d"
        with self.assertRaisesRegex(ValueError, "mismatched written surface"):
            self.inventory()

    def test_invalid_active_catalog_and_unknown_adapter_fail(self):
        self.setup_reference("korean")
        self.configure(program=True)
        with patch.dict(REGISTRATIONS, {"korean": ProgramRegistration("ko", "missing_character_inventory_fixture_adapter")}):
            with self.assertRaisesRegex(ValueError, "missing adapter missing_character_inventory_fixture_adapter"):
                extract_inventory(self.root, "korean")
        self.declaration["teaching_program"] = "ja-practical"
        write_yaml(self.root / "catalog.yaml", {"schema_version": 1, "languages": [self.declaration]})
        with self.assertRaisesRegex(ValueError, "expected ko-practical"):
            extract_inventory(self.root, "korean")
        self.configure(tracks=["beginner", "beginner"])
        with self.assertRaisesRegex(ValueError, "invalid teaching track"):
            extract_inventory(self.root, "korean")

    def test_registered_korean_program_excludes_pronunciation_from_writing_scope(self):
        self.setup_reference("korean")
        self.setup_adapter()
        self.configure(program=True)
        self.write_program()
        # The production Korean adapter is not activated yet; exercise the same registered boundary.
        with patch.dict(REGISTRATIONS, {"korean": ProgramRegistration("ko", "generate_chinese_program")}):
            result = self.inventory()
        self.assertTrue({"\uac00", "\uac01", "\uac02", "\uac03"} <= set(result["required"]))
        self.assertNotIn("\ubd93", result["characters"])
        self.assertFalse(result["literal_cross_script"])
        self.assertEqual(len(result["components"]), 67)

    def test_japanese_canonical_romanization_is_not_treated_as_kana(self):
        self.setup_reference()
        self.setup_adapter()
        self.configure(tracks=["beginner"])
        self.data.references.vocabulary["word-1"]["pr"] = "romanization"
        self.write_track()
        with self.assertRaisesRegex(ValueError, "canonical reading must be kana"):
            self.inventory()

    def test_active_track_rejects_missing_and_stale_canonical_entries(self):
        self.setup_reference()
        self.setup_adapter()
        self.configure(tracks=["beginner"])
        with self.assertRaises(FileNotFoundError):
            self.inventory()
        self.write_track()
        path = self.language_root / "teaching" / "beginner" / "sequence.yaml"
        sequence = load_yaml(path)
        sequence["units"][0]["vocabulary"][0]["ch"] = "\u9f8d"
        write_yaml(path, sequence)
        with self.assertRaisesRegex(ValueError, "stale entry"):
            self.inventory()

    def test_reference_only_korean_does_not_load_inactive_adapter_or_program(self):
        self.setup_reference("korean")
        with patch("character_inventory.get_adapter", side_effect=AssertionError("inactive adapter loaded")):
            result = extract_inventory(self.root, "korean")
        self.assertTrue({"\uac00", "\ub098", "\uaf9c", "\uc62b"} <= set(result["required"]))
        self.assertEqual(len(result["components"]), 67)
        self.assertFalse(any(scope.startswith("teaching:") for scope in result["scopes"]))

    def test_legacy_chinese_track_keeps_selected_expanded_examples_and_pinyin_out(self):
        self.setup_reference("chinese")
        self.configure(tracks=["beginner"])
        directory = self.language_root / "hsk-1"
        write_yaml(directory / "vocabulary.yaml", [{
            "id": "word", "target": "\u4e00", "reading": "yi", "senses": [{
                "id": "word-s001", "reading": "yi", "english": "one", "disambiguator": "one",
                "source_sense_ids": ["word-s001"],
            }],
        }])
        write_yaml(directory / "grammar.yaml", [{
            "id": "grammar", "pattern": "V+\u4e8c", "token_form": "V+\u4e8c", "disambiguator": "fixture",
            "examples": [{"target": "\u4e09", "english": "Never scan \u9f8d"}],
        }])
        write_yaml(self.language_root / "reference-senses.yaml", [])
        words, grammar = load_reference_index(self.language_root)
        sequence = {
            "schema_version": 1, "id": "zh-beginner", "title": "Legacy", "language": "chinese",
            "level_basis": "Fixture.", "review_policy": "Review.", "units": [{
                "id": "one", "title": "One", "outcome": "Learn.",
                "vocabulary": ["word-s001"], "grammar": ["grammar"],
                "review_vocabulary": [], "review_grammar": [],
            }],
        }
        self.write_outputs(teaching_outputs(self.language_root / "teaching" / "beginner", sequence, words, grammar))
        with patch("character_inventory.get_adapter", side_effect=AssertionError("legacy adapter loaded")):
            result = extract_inventory(self.root, "chinese")
        self.assertEqual(result["required"], ["\u4e00", "\u4e09", "\u4e8c"])
        self.assertEqual(result["counts"]["teaching"], 3)
        self.assertEqual(result["counts"]["teaching_only"], 0)
        self.assertFalse(result["literal_cross_script"])
        self.assertTrue(any(row["scope"] == "teaching:beginner" and row["field"] == "examples.target"
                            for row in result["characters"]["\u4e09"]["evidence"]))


if __name__ == "__main__":
    unittest.main()
