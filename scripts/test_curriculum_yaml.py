"""Regression checks for the curriculum YAML data contract."""

from pathlib import Path
import tempfile
import unittest

import yaml

from curriculum_yaml import dump_yaml, load_yaml, write_yaml
from validate_curriculum import Validator, VOCABULARY_FIELDS


class CurriculumYamlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.path = self.root / "sample.yaml"

    def test_round_trip_preserves_strings_types_and_order(self):
        strings = ["", "001", "1.0", "yes", "no", "null", "~", "2026-09-07",
                   "a: b # c", "first\nsecond\n", "\u6211\u559d\u8336\u3002"]
        value = {"strings": strings, "count": 12, "flag": True, "nothing": None,
                 "rows": [{"id": "first"}, {"id": "second"}]}
        write_yaml(self.path, value)
        loaded = load_yaml(self.path)
        self.assertEqual(value, loaded)
        self.assertEqual(list(value), list(loaded))
        self.assertTrue(all(isinstance(item, str) for item in loaded["strings"]))
        self.assertIs(type(loaded["count"]), int)
        self.assertIs(type(loaded["flag"]), bool)
        self.assertEqual(self.path.read_text(encoding="utf-8"), dump_yaml(loaded))
        self.assertIn("\u6211\u559d\u8336\u3002", dump_yaml(value))

    def test_rejects_duplicate_keys_at_any_depth(self):
        for text in ("id: first\nid: second\n",
                     "- examples:\n    - target: first\n      target: second\n"):
            with self.subTest(text=text):
                self.path.write_text(text, encoding="utf-8")
                with self.assertRaisesRegex(yaml.YAMLError, "duplicate key"):
                    load_yaml(self.path)

    def test_rejects_unsafe_tags_and_multiple_documents(self):
        for text in ("!!python/object:builtins.object {}\n",
                     "id: first\n---\nid: second\n"):
            with self.subTest(text=text):
                self.path.write_text(text, encoding="utf-8")
                with self.assertRaises(yaml.YAMLError):
                    load_yaml(self.path)

    def test_validator_reports_invalid_yaml(self):
        self.path.write_text("id: first\nid: second\n", encoding="utf-8")
        validator = Validator(self.root)
        self.assertIsNone(validator.yaml_file(self.path, dict))
        self.assertIn("duplicate key", validator.errors[0])

    def test_vocabulary_accepts_empty_optional_strings(self):
        path = self.root / "korean" / "topik-1" / "vocabulary.yaml"
        path.parent.mkdir(parents=True)
        row = dict.fromkeys(VOCABULARY_FIELDS, "")
        row.update(id="word-1", target="word", english="word", source_id="source",
                   level_basis="teaching estimate")
        write_yaml(path, [row])
        validator = Validator(self.root)
        self.assertEqual(validator.vocabulary("korean", "topik-1", {"source"}, set()), 1)
        self.assertEqual(validator.errors, [])

        row["reading"] = None
        write_yaml(path, [row])
        validator = Validator(self.root)
        validator.vocabulary("korean", "topik-1", {"source"}, set())
        self.assertTrue(any("reading: expected a string" in error for error in validator.errors))

    def test_vocabulary_rejects_non_records_and_missing_fields(self):
        path = self.root / "korean" / "topik-1" / "vocabulary.yaml"
        path.parent.mkdir(parents=True)
        write_yaml(path, ["not a record", {"id": "incomplete"}])
        validator = Validator(self.root)
        validator.vocabulary("korean", "topik-1", set(), set())
        self.assertEqual(len(validator.errors), 2)
        self.assertIn("expected an object", validator.errors[0])
        self.assertIn("fields must be", validator.errors[1])


if __name__ == "__main__":
    unittest.main()
