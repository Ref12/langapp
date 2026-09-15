"""Source-neutral program and strict adapter-boundary regressions."""

from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from dataclasses import replace
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from curriculum_yaml import load_yaml, write_yaml
from generate_practical_program import generate, program_outputs, validate_references
from practical_program_registry import get_adapter
from practical_program_types import (
    PhraseAnalysis, ProgramData, ProgramProfile, ReferenceBundle, SeedUnit, SurfaceSegment,
)
from validate_curriculum import LEVELS, Validator


class ExampleAdapter:
    profile = ProgramProfile("french", "fr")

    def __init__(self, data):
        self.data = data
        self.calls = 0
        self.forms = {"example-request": {
            "ch": "changed", "pr": "changed-reading",
            "items": ["local:item:001"], "grammar": ["construction:001"],
            "form_id": "example-request",
        }}

    def load(self, root):
        return self.data

    def validate_phrase(self, phrase, context):
        self.calls += 1
        segments = []
        for segment in phrase["realizations"]:
            form_id = segment.get("form_id")
            if form_id is not None and self.forms.get(form_id) != segment:
                raise ValueError("Unlicensed adapter surface realization")
            segments.append(SurfaceSegment(
                segment["ch"], segment["pr"], tuple(segment["items"]),
                tuple(segment["grammar"]), form_id,
            ))
        return PhraseAnalysis(tuple(phrase["items"]), tuple(phrase["grammar"]), tuple(segments))


class NeutralProgramTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "french"
        baseline = Path(__file__).resolve().parents[1] / "curriculum" / "chinese" / "teaching"
        program = load_yaml(baseline / "program.yaml")
        program.update(id="fr-practical", language="french", title="Example practical curriculum")
        mastery = load_yaml(baseline / "mastery.yaml")
        mastery["id"] = "fr-item-mastery"
        inputs = {"program": program, "mastery": mastery, "vocabulary": [], "grammar": [], "support": {}}
        words, patterns, identities, provenance, senses, readings, spellings = {}, {}, {}, {}, {}, {}, {}
        for number, destination in enumerate(
            [*range(1, 31), "professional", "technical", "scientific", "literary"], 1,
        ):
            identifier, construction = f"local:item:{number:03d}", f"construction:{number:03d}"
            lemma = "lemma:001" if number <= 2 else f"lemma:{number:03d}"
            form = "base" if number <= 2 else f"form{number}"
            words[identifier] = {"id": identifier, "ch": form, "pr": form + "-reading", "ds": f"meaning {number}"}
            patterns[construction] = {"id": construction, "ch": f"V+form{number}", "ds": f"function {number}"}
            identities[identifier] = lemma
            senses[identifier] = f"source-entry/sense/{number}"
            readings[identifier] = lemma + "/reading"
            spellings[identifier] = lemma + "/spelling"
            for item in (identifier, construction):
                provenance[item] = {"source_id": "original-example", "source_entry": f"local:{item}"}
            inputs["vocabulary"].append({
                "id": identifier, "level": destination, "topic": "grammar", "ds": words[identifier]["ds"],
            })
            inputs["grammar"].append({
                **patterns[construction], "level": destination, "topic": "grammar", "anchors": [identifier],
            })
        inputs["tourist"] = {
            "schema_version": 1, "id": "fr-tourist", "title": "Example travel route", "language": "french",
            "level_basis": "Independent travel material.", "review_policy": "Retrieve earlier material.",
            "quick_start": ["contact"], "units": [{
                "id": "contact", "title": "Contact", "outcome": "Make a request.",
                "vocabulary": ["local:item:001"], "grammar": ["construction:001"],
                "review_vocabulary": [], "review_grammar": [],
                "phrases": [{
                    "id": "fr-tourist-p001", "ch": "changed.", "pr": "changed-reading",
                    "ds": "A changed request.", "items": ["local:item:001"], "grammar": ["construction:001"],
                    "realizations": [{
                        "ch": "changed", "pr": "changed-reading",
                        "items": ["local:item:001"], "grammar": ["construction:001"],
                        "form_id": "example-request",
                    }],
                }],
            }],
        }
        self.data = ProgramData(
            inputs, ReferenceBundle(words, patterns, identities, provenance, senses, readings, spellings),
            source_outputs={self.root / "reference-senses.yaml": "[]\n"},
        )
        self.adapter = ExampleAdapter(self.data)

    @property
    def phrase(self):
        return self.data.inputs["tourist"]["units"][0]["phrases"][0]

    def outputs(self):
        return program_outputs(self.root, self.data, self.adapter)

    def document(self, relative):
        import yaml
        return yaml.safe_load(self.outputs()[self.root / relative])

    def test_no_seed_profile_has_all_thirty_levels_in_nested_phase_paths(self):
        outputs = self.outputs()
        self.assertNotIn(self.root / "teaching" / "levels" / "01" / "sequence.yaml", outputs)
        for index, phase in enumerate(self.data.inputs["program"]["phases"], 1):
            for number in phase["levels"]:
                directory = self.root / "teaching" / "phases" / f"{index}-{phase['id']}" / "levels" / f"{number:02d}"
                self.assertIn(directory / "sequence.yaml", outputs)
                self.assertIn(directory / "vocabulary.min.yaml", outputs)
        core = self.document(Path("teaching") / "core" / "sequence.yaml")
        self.assertEqual([level["number"] for phase in core["phases"] for level in phase["levels"]], list(range(1, 31)))

    def test_explicit_identities_count_senses_readings_and_lemmas_without_id_parsing(self):
        report = self.document(Path("teaching") / "inventory.yaml")
        self.assertEqual(report["core"]["headwords"], 29)
        self.assertEqual(report["core"]["vocabulary_senses"], 30)
        self.assertEqual(report["core"]["source_senses"], 30)
        self.assertEqual(report["core"]["readings"], 29)
        self.assertEqual(report["core"]["spellings"], 29)
        self.assertEqual(report["levels"][1]["new_headwords"], 0)
        self.assertEqual(sum(phase["new_headwords"] for phase in report["phases"]), 29)

    def test_configurable_seed_prefix_is_not_twelve_mandarin_units(self):
        core = self.document(Path("teaching") / "core" / "sequence.yaml")
        levels = core["phases"][0]["levels"][:2]
        seeds = tuple(SeedUnit(level["number"], "grammar", unit) for level in levels for unit in level["units"])
        for key in ("vocabulary", "grammar"):
            self.data.inputs[key][:] = [row for row in self.data.inputs[key] if row["level"] not in (1, 2)]
        self.data = replace(self.data, seeds=seeds)
        self.assertTrue(self.outputs())
        self.data = replace(self.data, seeds=(SeedUnit(2, "grammar", seeds[0].unit),))
        with self.assertRaisesRegex(ValueError, "initial level prefix"):
            self.outputs()

    def test_canonical_shapes_labels_and_complete_identity_provenance_are_required(self):
        for mutation in ("identity", "provenance", "label", "grammar-reading", "index-key", "source-identity"):
            with self.subTest(mutation=mutation):
                references = deepcopy(self.data.references)
                if mutation == "identity":
                    references.lexical_identity.pop("local:item:001")
                elif mutation == "provenance":
                    references.provenance.pop("construction:001")
                elif mutation == "label":
                    references.vocabulary["local:item:001"]["ds"] = "x" * 65
                elif mutation == "grammar-reading":
                    references.grammar["construction:001"]["pr"] = "invalid"
                elif mutation == "index-key":
                    references.vocabulary["local:item:001"]["id"] = "different"
                else:
                    references.source_sense_identity["local:item:003"] = references.source_sense_identity["local:item:001"]
                with self.assertRaises(ValueError):
                    validate_references(references, self.adapter.profile)

    def test_homographs_can_share_spelling_identity_without_sharing_lexical_identity(self):
        references = deepcopy(self.data.references)
        references.lexical_identity["local:item:002"] = "different-lemma"
        validate_references(references, self.adapter.profile)
        self.data = replace(self.data, references=references)
        report = self.document(Path("teaching") / "inventory.yaml")
        self.assertEqual(report["core"]["headwords"], 30)
        self.assertEqual(report["core"]["spellings"], 29)

    def test_phrase_callback_is_mandatory_and_cannot_return_success_without_analysis(self):
        self.outputs()
        self.assertGreater(self.adapter.calls, 0)
        for result in (None, True, PhraseAnalysis((), ())):
            with self.subTest(result=result), patch.object(self.adapter, "validate_phrase", return_value=result):
                with self.assertRaisesRegex(ValueError, "invalid phrase analysis"):
                    self.outputs()
        with patch.object(self.adapter, "validate_phrase", None):
            with self.assertRaisesRegex(ValueError, "validator is required"):
                self.outputs()

    def test_phrase_keeps_compact_fields_and_expanded_grammar_realizations(self):
        route = self.document(Path("teaching") / "tourist" / "sequence.yaml")
        unit = route["units"][0]
        self.assertEqual(set(unit["phrases"][0]), {"id", "ch", "pr", "ds"})
        components = unit["phrase_components"]["fr-tourist-p001"]
        self.assertEqual(components["items"], ["local:item:001"])
        self.assertEqual(components["grammar"], ["construction:001"])
        self.assertEqual(components["realizations"], self.phrase["realizations"])
        quick = self.document(Path("teaching") / "tourist" / "quick-start" / "sequence.yaml")
        self.assertEqual(quick["units"], route["units"])

    def test_phrase_reconstruction_does_not_accept_uncovered_text_or_reading(self):
        for key, suffix in (("ch", "extra"), ("pr", "wrong")):
            with self.subTest(key=key):
                previous = self.phrase[key]
                self.phrase[key] += suffix
                with self.assertRaisesRegex(ValueError, "uncovered or mismatched"):
                    self.outputs()
                self.phrase[key] = previous

    def test_inflected_and_fixed_grammar_surfaces_require_licensed_form_annotations(self):
        segment = self.phrase["realizations"][0]
        segment["form_id"] = "invented"
        with self.assertRaisesRegex(ValueError, "Unlicensed"):
            self.outputs()
        segment.pop("form_id")
        with self.assertRaisesRegex(ValueError, "require a validated form_id"):
            self.outputs()

    def test_fixed_construction_can_supply_form_without_unrelated_lexical_credit(self):
        segment = self.phrase["realizations"][0]
        segment["items"] = []
        self.phrase["items"] = []
        self.adapter.forms["example-request"] = deepcopy(segment)
        self.outputs()
        segment["grammar"] = []
        self.phrase["grammar"] = []
        self.adapter.forms["example-request"] = deepcopy(segment)
        with self.assertRaisesRegex(ValueError, "lexical or construction link"):
            self.outputs()

    def test_phrase_dependencies_must_be_taught_and_exactly_used(self):
        self.phrase["grammar"].append("construction:002")
        with self.assertRaisesRegex(ValueError, "unknown ID"):
            self.outputs()
        self.phrase["grammar"].pop()
        self.phrase["items"].append("local:item:002")
        with self.assertRaisesRegex(ValueError, "unknown ID"):
            self.outputs()
        self.data.inputs["tourist"]["units"][0]["vocabulary"].append("local:item:002")
        with self.assertRaisesRegex(ValueError, "union of realization links"):
            self.outputs()

    def test_construction_dependency_graph_rejects_unknown_cycles_and_forward_edges(self):
        for dependencies in (
            {"construction:001": ("missing",)},
            {"construction:001": ("construction:001",)},
            {"construction:001": ("construction:002",), "construction:002": ("construction:001",)},
            {"construction:001": ("construction:002",)},
        ):
            with self.subTest(dependencies=dependencies):
                self.data = replace(self.data, construction_dependencies=dependencies)
                with self.assertRaises(ValueError):
                    self.outputs()
        self.data = replace(self.data, construction_dependencies={"construction:002": ("construction:001",)})
        self.outputs()

    def test_tourist_and_branches_cannot_borrow_undeclared_construction_prerequisites(self):
        self.data = replace(self.data, construction_dependencies={"construction:031": ("construction:032",)})
        with self.assertRaisesRegex(ValueError, "prerequisites not introduced"):
            self.outputs()
        self.data = replace(self.data, construction_dependencies={"construction:002": ("construction:001",)})
        self.data.inputs["tourist"]["units"][0]["grammar"] = ["construction:002"]
        self.data.inputs["tourist"]["units"][0]["vocabulary"].append("local:item:002")
        with self.assertRaisesRegex(ValueError, "prerequisites not introduced"):
            self.outputs()

    def test_acyclic_constructions_may_be_explicitly_cotaught_in_one_module(self):
        row = self.data.inputs["grammar"][2]
        row["level"] = 2
        row["anchors"] = ["local:item:002"]
        self.data = replace(self.data, construction_dependencies={"construction:002": ("construction:003",)})
        self.outputs()

    def test_program_rejects_the_wrong_phase_partition_even_if_levels_are_ordered(self):
        phases = self.data.inputs["program"]["phases"]
        phases[1]["levels"].append(phases[2]["levels"].pop(0))
        with self.assertRaisesRegex(ValueError, "1-4, 5-8"):
            self.outputs()

    def test_source_outputs_are_checked_and_cannot_overwrite_views_or_escape_root(self):
        original = self.data
        for path in (
            self.root.parent / "outside.yaml",
            self.root / "teaching" / "core" / "sequence.yaml",
            self.root,
        ):
            with self.subTest(path=path):
                self.data = replace(original, source_outputs={path: "invalid"})
                with self.assertRaisesRegex(ValueError, "out-of-root"):
                    self.outputs()

    def test_deterministic_generation_readonly_check_and_input_immutability(self):
        before = deepcopy(self.data)
        outputs = generate(self.root, self.adapter)
        originals = {path: path.read_bytes() for path in outputs}
        self.assertEqual(outputs, generate(self.root, self.adapter))
        generate(self.root, self.adapter, check=True)
        self.assertEqual(self.data, before)
        self.assertEqual(originals, {path: path.read_bytes() for path in outputs})
        source = self.root / "reference-senses.yaml"
        source.write_text("stale\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "stale"):
            generate(self.root, self.adapter, check=True)
        self.assertEqual(source.read_text(encoding="utf-8"), "stale\n")

    def test_invalid_adapter_data_writes_nothing(self):
        self.phrase["ch"] += "unexpected"
        with self.assertRaises(ValueError):
            generate(self.root, self.adapter)
        self.assertFalse(self.root.exists())


class RegistryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.catalog = {
            "schema_version": 1,
            "languages": [{"id": name, "standard": "Existing reference collection", "levels": levels}
                          for name, levels in LEVELS.items()],
        }

    def validator(self):
        write_yaml(self.root / "catalog.yaml", self.catalog)
        validator = Validator(self.root)
        validator.catalog()
        return validator

    def test_future_registrations_are_not_required_or_implicitly_activated(self):
        validator = self.validator()
        self.assertFalse(validator.errors)
        self.assertEqual(validator.active_languages, list(LEVELS))
        self.assertFalse(validator.teaching_programs)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(validator.run(["french"]), 1)
        self.assertTrue(any("not enabled: french" in error for error in validator.errors))

    def test_independent_inventory_does_not_require_artificial_exam_bands(self):
        self.catalog["languages"].append({
            "id": "french", "standard": "Independent teaching inventory",
            "reference_inventory": "reference", "teaching_program": "fr-practical",
        })
        validator = self.validator()
        self.assertFalse(validator.errors)
        self.assertEqual(validator.reference_inventories, {"french": "reference"})
        self.assertIn("french", validator.teaching_programs)
        for path in ("../outside", "other"):
            self.catalog["languages"][-1]["reference_inventory"] = path
            self.assertTrue(self.validator().errors)
        self.catalog["languages"][-1]["reference_inventory"] = "reference"
        self.catalog["languages"][-1]["levels"] = ["a1", "a2"]
        self.assertTrue(self.validator().errors)

    def test_adapter_imports_use_registry_not_catalog_and_missing_enabled_adapter_fails(self):
        self.assertEqual(get_adapter("chinese").profile.prefix, "zh")
        with self.assertRaisesRegex(ValueError, "Unregistered"):
            get_adapter("../untrusted")
        error = ModuleNotFoundError("missing", name="french_program_adapter")
        with patch("practical_program_registry.import_module", side_effect=error):
            with self.assertRaisesRegex(ValueError, "Enabled french program requires"):
                get_adapter("french")


if __name__ == "__main__":
    unittest.main()
