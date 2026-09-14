"""Regression checks for the curriculum YAML data contract."""

from pathlib import Path
import tempfile
import unittest

import yaml

from curriculum_yaml import dump_pairs, dump_yaml, load_yaml, write_yaml
from generate_curriculum_tokens import (
    compact_outputs, generate, grammar_pairs, token, vocabulary_pairs,
)
from import_chinese_curriculum import (
    add_hsk1_token_metadata, group_vocabulary_senses, pronunciation_note, vocabulary_senses,
)
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


class CurriculumTokenTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.words = [{
            "id": "zh-hsk1-00001", "target": "\u7231",
            "senses": [
                {"id": "zh-hsk1-00001-s001", "reading": "ai4",
                 "english": "to love; to be fond of; to like", "disambiguator": "to love",
                 "source_sense_ids": ["zh-hsk1-00001-s001"]},
                {"id": "zh-hsk1-00001-s002", "reading": "ai4",
                 "english": "affection", "disambiguator": "affection",
                 "source_sense_ids": ["zh-hsk1-00001-s002"]},
            ],
        }]
        self.grammar = [{
            "id": "zh-hsk1-g001", "token_form": "S+\u662f+N",
            "disambiguator": "noun-predicate identity",
        }]

    def write_expanded(self):
        write_yaml(self.root / "vocabulary.yaml", self.words)
        write_yaml(self.root / "grammar.yaml", self.grammar)

    def test_pairs_use_sense_ids_not_headword_ids(self):
        self.assertEqual(vocabulary_pairs(self.words), [
            ["zh-hsk1-00001-s001", "\u7231(ai4)/to love"],
            ["zh-hsk1-00001-s002", "\u7231(ai4)/affection"],
        ])
        self.assertEqual(grammar_pairs(self.grammar), [
            ["zh-hsk1-g001", "S+\u662f+N/noun-predicate identity"],
        ])

    def test_pair_yaml_preserves_order_strings_unicode_and_punctuation(self):
        pairs = [["001", "\u7231/love"], ["null", "form/a: b # c [d], \"e\""]]
        content = dump_pairs(pairs)
        self.assertEqual(len(content.splitlines()), 2)
        self.assertTrue(all(line.startswith("- [") for line in content.splitlines()))
        path = self.root / "pairs.yaml"
        path.write_text(content, encoding="utf-8")
        self.assertEqual(load_yaml(path), pairs)
        self.assertEqual(dump_pairs(load_yaml(path)), content)

    def test_disambiguator_is_explicit_not_inferred_from_dictionary_gloss(self):
        self.words[0]["senses"][0]["english"] = "a much longer source definition"
        self.assertEqual(vocabulary_pairs(self.words)[0][1], "\u7231(ai4)/to love")
        del self.words[0]["senses"][0]["disambiguator"]
        with self.assertRaisesRegex(ValueError, "disambiguator"):
            vocabulary_pairs(self.words)

    def test_reading_disambiguates_otherwise_identical_tokens(self):
        self.words[0]["senses"][1].update(reading="ai3", disambiguator="to love")
        self.assertEqual(vocabulary_pairs(self.words), [
            ["zh-hsk1-00001-s001", "\u7231(ai4)/to love"],
            ["zh-hsk1-00001-s002", "\u7231(ai3)/to love"],
        ])

    def test_uses_sense_pronunciation_not_combined_headword_readings(self):
        self.words[0].update(target="\u884c", reading="h\u00e1ng / x\u00edng")
        self.words[0]["senses"][0].update(
            reading="x\u00edng", english="to go", disambiguator="to go",
        )
        self.words[0]["senses"][1].update(
            reading="h\u00e1ng", english="row", disambiguator="row",
        )
        self.assertEqual(vocabulary_pairs(self.words), [
            ["zh-hsk1-00001-s001", "\u884c(x\u00edng)/to go"],
            ["zh-hsk1-00001-s002", "\u884c(h\u00e1ng)/row"],
        ])

    def test_rejects_ambiguous_tokens_with_the_same_reading(self):
        self.words[0]["senses"][1]["disambiguator"] = "to love"
        with self.assertRaisesRegex(ValueError, "Ambiguous duplicate token"):
            vocabulary_pairs(self.words)

    def test_rejects_duplicate_ids_and_duplicate_source_senses(self):
        self.words[0]["senses"][1]["id"] = "zh-hsk1-00001-s001"
        self.words[0]["senses"][1]["source_sense_ids"] = ["zh-hsk1-00001-s001"]
        with self.assertRaisesRegex(ValueError, "duplicate source sense ID"):
            vocabulary_pairs(self.words)
        self.words[0]["senses"][1]["id"] = "zh-hsk1-00001-s002"
        self.words[0]["senses"][1]["source_sense_ids"] = ["zh-hsk1-00001-s002"]
        self.words[0]["senses"][1]["english"] = self.words[0]["senses"][0]["english"]
        with self.assertRaisesRegex(ValueError, "duplicate reading and dictionary sense"):
            vocabulary_pairs(self.words)

    def test_rejects_wrong_parent_sense_ids(self):
        self.words[0]["senses"][0]["id"] = "zh-hsk1-00002-s001"
        with self.assertRaisesRegex(ValueError, "sense ID must extend"):
            vocabulary_pairs(self.words)

    def test_rejects_empty_and_malformed_senses(self):
        for invalid in (None, [], ["not a record"]):
            with self.subTest(senses=invalid):
                self.words[0]["senses"] = invalid
                with self.assertRaises(ValueError):
                    vocabulary_pairs(self.words)

    def test_rejects_missing_readings_and_non_english_sense_glosses(self):
        for field, value in (("reading", ""), ("english", "\u7231"),
                             ("english", None)):
            with self.subTest(field=field, value=value):
                sense = self.words[0]["senses"][0]
                previous = sense[field]
                sense[field] = value
                with self.assertRaises(ValueError):
                    vocabulary_pairs(self.words)
                sense[field] = previous

    def test_pilot_validator_accepts_nested_senses_and_tracks_their_ids(self):
        path = self.root / "chinese" / "hsk-1" / "vocabulary.yaml"
        path.parent.mkdir(parents=True)
        row = dict.fromkeys(VOCABULARY_FIELDS, "")
        row.update(self.words[0])
        row.update(reading="ai4", english="to love; affection", source_id="source",
                   level_basis="teaching estimate")
        write_yaml(path, [row])
        validator = Validator(self.root)
        seen = set()
        self.assertEqual(validator.vocabulary("chinese", "hsk-1", {"source"}, seen), 1)
        self.assertEqual(validator.errors, [])
        self.assertEqual(seen, {"zh-hsk1-00001", "zh-hsk1-00001-s001",
                                "zh-hsk1-00001-s002"})
        del row["senses"]
        write_yaml(path, [row])
        validator = Validator(self.root)
        validator.vocabulary("chinese", "hsk-1", {"source"}, set())
        self.assertTrue(any("senses" in error for error in validator.errors))

    def test_token_rejects_invalid_components(self):
        for label in ("", None, False, " missing trim", "two\nlines", "a/b",
                      "two\u2028lines", "two\x85lines", "\u4e00", "x" * 65, "bad\ufffdtext"):
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    token("form", label, "test")
        for form in ("", None, "a/b", "a\tb", " trailing "):
            with self.subTest(form=form):
                with self.assertRaises(ValueError):
                    token(form, "meaning", "test")
        self.assertEqual(token("form", "x" * 64, "test"), "form/" + "x" * 64)

    def test_generate_is_deterministic_and_check_is_read_only(self):
        self.write_expanded()
        generate(self.root)
        originals = {path: path.read_bytes() for path in self.root.glob("*.min.yaml")}
        generate(self.root)
        generate(self.root, check=True)
        self.assertEqual(originals, {path: path.read_bytes() for path in originals})
        self.words[0]["senses"][0]["disambiguator"] = "to cherish"
        self.write_expanded()
        with self.assertRaisesRegex(ValueError, "stale compact file"):
            generate(self.root, check=True)
        self.assertEqual(originals, {path: path.read_bytes() for path in originals})

    def test_missing_compact_file_fails_check(self):
        self.write_expanded()
        with self.assertRaisesRegex(ValueError, "Missing or stale"):
            generate(self.root, check=True)
        self.assertFalse((self.root / "vocabulary.min.yaml").exists())

    def test_invalid_input_does_not_partially_overwrite_outputs(self):
        self.write_expanded()
        generate(self.root)
        path = self.root / "vocabulary.min.yaml"
        original = path.read_bytes()
        self.words[0]["senses"][0]["disambiguator"] = "to cherish"
        self.grammar[0]["disambiguator"] = "bad/label"
        self.write_expanded()
        with self.assertRaises(ValueError):
            generate(self.root)
        self.assertEqual(path.read_bytes(), original)

    def test_combined_outputs_reject_cross_inventory_collisions(self):
        self.grammar[0]["id"] = "zh-hsk1-00001-s001"
        with self.assertRaisesRegex(ValueError, "Duplicate compact ID"):
            compact_outputs(self.root, self.words, self.grammar)

    def test_validator_detects_stale_compact_artifacts(self):
        self.write_expanded()
        generate(self.root)
        (self.root / "grammar.min.yaml").write_text("[]\n", encoding="utf-8")
        validator = Validator(self.root)
        validator.compact("", "")
        self.assertEqual(len(validator.errors), 1)
        self.assertIn("stale compact file", validator.errors[0])

    def test_source_meaning_boundaries_preserve_synonyms_and_readings(self):
        form = {"transcriptions": {"pinyin": "xing2"},
                "meanings": ["to walk; to go", "profession", "used in \u884c"]}
        entry = {"simplified": "\u884c", "forms": [
            form, form,
            {"transcriptions": {"pinyin": "hang2"}, "meanings": ["profession"]},
        ]}
        senses = vocabulary_senses(entry, "word")
        self.assertEqual(senses, [
            {"id": "word-s001", "reading": "xing2", "english": "to walk; to go"},
            {"id": "word-s002", "reading": "xing2", "english": "profession"},
            {"id": "word-s003", "reading": "hang2", "english": "profession"},
        ])

    def test_source_corrections_remain_authoritative(self):
        entry = {"simplified": "\u4e00\u5757\u513f", "forms": [
            {"transcriptions": {"pinyin": "yi1 kuai4 r5"},
             "meanings": ["used in \u4e00\u5757\u513f"]},
        ]}
        self.assertEqual(vocabulary_senses(entry, "word")[0]["english"],
                         "together; in the same place; at the same time")

    def test_pronunciation_metadata_is_not_a_sense_and_does_not_renumber_ids(self):
        entry = {"simplified": "\u8c01", "forms": [
            {"transcriptions": {"pinyin": "shei2"},
             "meanings": ["who", "also pr. [shui2]", "anyone"]},
        ]}
        self.assertEqual(vocabulary_senses(entry, "word"), [
            {"id": "word-s001", "reading": "shei2", "english": "who"},
            {"id": "word-s003", "reading": "shei2", "english": "anyone"},
        ])
        for note in ("also pr.", "also pr. or in poetry and songs",
                     "also pr. for greater clarity when spelling out numbers digit by digit",
                     "Taiwan pr.", "Taiwan pr. for the behavior-conduct sense",
                     "(Taiwan pr. in some compounds derived from Classical Chinese)"):
            self.assertTrue(pronunciation_note(note), note)
        for meaning in ("(Taiwan pr. ) retainer", "to involve or implicate (Taiwan pr. )"):
            self.assertFalse(pronunciation_note(meaning), meaning)

    def test_synonym_groups_preserve_all_glosses_and_source_ids(self):
        self.words[0]["senses"][1]["english"] = "to cherish"
        group_vocabulary_senses(self.words, {"zh-hsk1-00001-s002": "zh-hsk1-00001-s001"})
        self.assertEqual(len(self.words[0]["senses"]), 1)
        sense = self.words[0]["senses"][0]
        self.assertEqual(sense["id"], "zh-hsk1-00001-s001")
        self.assertEqual(sense["english"], "to love; to be fond of; to like; to cherish")
        self.assertEqual(sense["source_sense_ids"],
                         ["zh-hsk1-00001-s001", "zh-hsk1-00001-s002"])
        self.assertEqual(vocabulary_pairs(self.words),
                         [["zh-hsk1-00001-s001", "\u7231(ai4)/to love"]])

    def test_groups_reject_unknown_forward_self_and_chained_aliases(self):
        for aliases in ([], {"unknown": "zh-hsk1-00001-s001"},
                        {"zh-hsk1-00001-s002": "unknown"},
                        {"zh-hsk1-00001-s001": "zh-hsk1-00001-s001"},
                        {"zh-hsk1-00001-s001": "zh-hsk1-00001-s002"},
                        {"zh-hsk1-00001-s002": "zh-hsk1-00001-s001",
                         "zh-hsk1-00001-s001": "zh-hsk1-00001-s002"}):
            with self.subTest(aliases=aliases):
                with self.assertRaises(ValueError):
                    group_vocabulary_senses(self.words, aliases)

    def test_groups_cannot_merge_different_readings_or_headwords(self):
        aliases = {"zh-hsk1-00001-s002": "zh-hsk1-00001-s001"}
        self.words[0]["senses"][1]["reading"] = "ai3"
        with self.assertRaisesRegex(ValueError, "share a headword and reading"):
            group_vocabulary_senses(self.words, aliases)
        self.words[0]["senses"][1]["reading"] = "ai4"
        second = self.words[0]["senses"].pop()
        self.words.append({"id": "another-word", "senses": [second]})
        with self.assertRaisesRegex(ValueError, "share a headword and reading"):
            group_vocabulary_senses(self.words, aliases)

    def test_source_references_require_the_canonical_id_and_unique_membership(self):
        for references in ([], None, ["zh-hsk1-00001-s002"],
                           ["zh-hsk1-00001-s001", "zh-hsk1-00002-s001"],
                           ["zh-hsk1-00001-s001", "zh-hsk1-00001-s002"]):
            with self.subTest(references=references):
                self.words[0]["senses"][0]["source_sense_ids"] = references
                with self.assertRaises(ValueError):
                    vocabulary_pairs(self.words)

    def test_authored_labels_require_exact_source_coverage(self):
        labels = {sense["id"]: sense["disambiguator"] for sense in self.words[0]["senses"]}
        grammar = {row["id"]: {key: row[key] for key in ("token_form", "disambiguator")}
                   for row in self.grammar}
        write_yaml(self.root / "vocabulary.yaml", labels)
        write_yaml(self.root / "vocabulary-groups.yaml", {})
        write_yaml(self.root / "grammar.yaml", grammar)
        add_hsk1_token_metadata(self.words, self.grammar, self.root)
        self.assertEqual(self.words[0]["senses"][0]["disambiguator"], "to love")
        for invalid in ({}, {**labels, "unknown-s001": "unknown"}, []):
            with self.subTest(labels=invalid):
                write_yaml(self.root / "vocabulary.yaml", invalid)
                with self.assertRaisesRegex(ValueError, "every canonical sense ID exactly"):
                    add_hsk1_token_metadata(self.words, self.grammar, self.root)
        write_yaml(self.root / "vocabulary.yaml", labels)
        write_yaml(self.root / "grammar.yaml", {})
        with self.assertRaisesRegex(ValueError, "every grammar ID exactly"):
            add_hsk1_token_metadata(self.words, self.grammar, self.root)
        write_yaml(self.root / "grammar.yaml", {"zh-hsk1-g001": {"id": "replacement"}})
        with self.assertRaisesRegex(ValueError, "expected token_form and disambiguator"):
            add_hsk1_token_metadata(self.words, self.grammar, self.root)

    def test_checked_in_pilot_views_are_current_and_complete(self):
        directory = Path(__file__).resolve().parents[1] / "curriculum" / "chinese" / "hsk-1"
        words = load_yaml(directory / "vocabulary.yaml")
        grammar = load_yaml(directory / "grammar.yaml")
        self.assertEqual(len(words), 506)
        self.assertEqual(len(vocabulary_pairs(words)), 1644)
        self.assertEqual(sum(len(sense["source_sense_ids"])
                             for row in words for sense in row["senses"]), 2012)
        father = next(row for row in words if row["id"] == "zh-hsk1-00004")
        self.assertEqual(len(father["senses"]), 1)
        self.assertEqual(father["senses"][0]["english"], "father; dad; pa; papa")
        self.assertEqual(father["senses"][0]["source_sense_ids"],
                         [f"zh-hsk1-00004-s{number:03d}" for number in range(1, 5)])
        vehicle = next(row for row in words if row["id"] == "zh-hsk1-00045")
        self.assertEqual(vehicle["senses"][0]["disambiguator"], "in or on a vehicle")
        self.assertEqual(len(grammar_pairs(grammar)), 25)
        for path, expected in compact_outputs(directory, words, grammar).items():
            self.assertEqual(path.read_text(encoding="utf-8"), expected)


if __name__ == "__main__":
    unittest.main()
