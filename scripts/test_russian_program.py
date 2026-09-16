"""Integration of real Russian data with the centrally owned practical engine."""

from copy import deepcopy
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import yaml

from curriculum_yaml import CurriculumLoader, load_yaml
from generate_practical_program import generate, program_outputs
from russian_program_adapter import RussianProgramAdapter
from validate_curriculum import Validator


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "russian"


class RussianGeneratedProgramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = RussianProgramAdapter()
        cls.data = cls.adapter.load(ROOT)
        cls.outputs = program_outputs(ROOT, cls.data, cls.adapter)
        cls.documents = {
            path: yaml.load(content, Loader=CurriculumLoader)
            for path, content in cls.outputs.items()
        }

    def document(self, *parts):
        return self.documents[ROOT.joinpath(*parts)]

    def test_all_generated_views_are_persistent_and_current(self):
        for path, expected in self.outputs.items():
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertTrue(path.is_file())
                self.assertEqual(path.read_text(encoding="utf-8"), expected)

    def test_fresh_adapter_generation_is_identical(self):
        adapter = RussianProgramAdapter()
        self.assertEqual(program_outputs(ROOT, adapter.load(ROOT), adapter), self.outputs)

    def test_all_thirty_levels_are_nested_in_numbered_phases(self):
        core = self.document("teaching", "core", "sequence.yaml")
        self.assertEqual(
            [level["number"] for phase in core["phases"] for level in phase["levels"]],
            list(range(1, 31)),
        )
        for number, phase in enumerate(self.data.inputs["program"]["phases"], 1):
            directory = ROOT / "teaching" / "phases" / f"{number}-{phase['id']}"
            for level in phase["levels"]:
                path = directory / "levels" / f"{level:02d}"
                for filename in ("sequence.yaml", "vocabulary.min.yaml", "grammar.min.yaml"):
                    self.assertIn(path / filename, self.outputs)
            self.assertIn(directory / "vocabulary.min.yaml", self.outputs)
            self.assertIn(directory / "grammar.min.yaml", self.outputs)
        self.assertFalse((ROOT / "teaching" / "levels").exists())

    def test_all_compact_introductions_and_reviews_are_canonical(self):
        canonical = {
            **self.data.references.vocabulary, **self.data.references.grammar,
            **{
                phrase["id"]: {key: phrase[key] for key in ("id", "ch", "pr", "ds")}
                for unit in self.data.inputs["tourist"]["units"] for phrase in unit["phrases"]
            },
        }
        kinds = {
            "vocabulary", "grammar", "phrases",
            "review_vocabulary", "review_grammar", "review_phrases",
        }

        def check_entries(entries):
            for entry in entries:
                self.assertEqual(entry, canonical[entry["id"]])
                self.assertLessEqual(len(entry["ds"]), 64)

        def visit(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in kinds and isinstance(child, list) and all(isinstance(row, dict) for row in child):
                        check_entries(child)
                    else:
                        visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        for path, document in self.documents.items():
            if path.name.endswith(".min.yaml"):
                check_entries(document)
                for line in self.outputs[path].splitlines():
                    self.assertTrue(line.startswith("- {id: "), path)
                    self.assertTrue(line.endswith("}"), path)
            elif path.name == "sequence.yaml":
                visit(document)

    def test_actual_phase_counts_and_module_limits(self):
        core = self.document("teaching", "core", "sequence.yaml")
        inventory = self.document("teaching", "inventory.yaml")
        seen = set()
        for phase, report in zip(core["phases"], inventory["phases"]):
            units = [unit for level in phase["levels"] for unit in level["units"]]
            identities = {
                self.data.references.lexical_identity[entry["id"]]
                for unit in units for entry in unit["vocabulary"]
            }
            self.assertEqual(report["new_headwords"], len(identities - seen))
            seen.update(identities)
            for unit in units:
                self.assertLessEqual(len(unit["vocabulary"]), self.data.inputs["program"]["module_size"])
                self.assertLessEqual(len(unit["grammar"]), 3)
        self.assertEqual(inventory["core"]["headwords"], len(seen))
        breadth = [phase["new_headwords"] for phase in inventory["phases"]]
        for earlier, later in zip(breadth, breadth[1:]):
            self.assertGreater(later, earlier)

    def test_branch_and_quick_start_views_are_real_routes(self):
        for branch in ("professional", "technical", "scientific", "literary"):
            route = self.document("teaching", "extensions", branch, "sequence.yaml")
            self.assertTrue(route["units"])
            self.assertTrue(self.document("teaching", "extensions", branch, "vocabulary.min.yaml"))
            self.assertTrue(self.document("teaching", "extensions", branch, "grammar.min.yaml"))
        tourist = self.document("teaching", "tourist", "sequence.yaml")
        quick = self.document("teaching", "tourist", "quick-start", "sequence.yaml")
        self.assertEqual(quick["units"], tourist["units"][:5])
        self.assertEqual(len(self.document("teaching", "tourist", "phrases.min.yaml")), 60)
        self.assertEqual(len(self.document("teaching", "tourist", "quick-start", "phrases.min.yaml")), 25)

    def test_changed_phrase_alignment_fails_before_any_write(self):
        inputs = deepcopy(self.data.inputs)
        phrase = inputs["tourist"]["units"][0]["phrases"][0]
        phrase["ds"] = "An unapproved replacement meaning."
        broken = replace(self.data, inputs=inputs)
        with patch.object(self.adapter, "load", return_value=broken), patch.object(Path, "write_text") as write:
            with self.assertRaisesRegex(ValueError, "authored sense/form alignment"):
                generate(ROOT, self.adapter)
            write.assert_not_called()

    def test_shared_validator_accepts_independent_registration_without_changing_catalog(self):
        catalog_path = ROOT.parent / "catalog.yaml"
        before = catalog_path.read_bytes()
        catalog = load_yaml(catalog_path)
        if not any(entry["id"] == "russian" for entry in catalog["languages"]):
            catalog["languages"].append({
                "id": "russian",
                "standard": "Independent practical Russian inventory; not a CEFR or TORFL exam specification",
                "reference_inventory": "reference",
                "teaching_program": "ru-practical",
            })
        validator = Validator(ROOT.parent)
        original_reader = validator.yaml_file

        def read_registered_catalog(path, expected_type):
            return deepcopy(catalog) if path == catalog_path else original_reader(path, expected_type)

        with patch.object(validator, "yaml_file", side_effect=read_registered_catalog):
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                status = validator.run(["russian"])
        self.assertEqual(status, 0, "\n".join(validator.errors))
        self.assertEqual(catalog_path.read_bytes(), before)

    def test_stale_check_never_rewrites_or_partially_refreshes_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "russian"
            for directory in ("authoring", "reference", "build"):
                shutil.copytree(ROOT / directory, root / directory)
            (root / "teaching").mkdir()
            for name in ("program.yaml", "mastery.yaml"):
                shutil.copy2(ROOT / "teaching" / name, root / "teaching" / name)
            outputs = generate(root, RussianProgramAdapter())
            stale = root / "teaching" / "core" / "vocabulary.min.yaml"
            stale.write_text(stale.read_text(encoding="utf-8") + "# deliberately stale\n", encoding="utf-8")
            before = {path: path.read_bytes() for path in outputs}
            with self.assertRaisesRegex(ValueError, "Missing or stale program view"):
                generate(root, RussianProgramAdapter(), check=True)
            self.assertEqual({path: path.read_bytes() for path in outputs}, before)


if __name__ == "__main__":
    unittest.main()
