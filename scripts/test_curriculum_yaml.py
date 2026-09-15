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
    add_hsk1_token_metadata, additional_reference_senses, group_vocabulary_senses,
    pronunciation_note, vocabulary_senses,
)
from generate_teaching_track import (
    generate as generate_track, load_reference_index, reference_index, sequence_pairs, teaching_outputs,
)
from validate_curriculum import LEVELS, Validator, VOCABULARY_FIELDS


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


class TeachingTrackTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.track = self.root / "teaching" / "beginner"
        self.word_id = "zh-hsk1-00001-s001"
        self.coffee_id = "zh-hsk3-00396-s001"
        self.grammar_id = "zh-hsk1-g001"
        self.vocabulary = {
            "hsk-1": [{
                "id": "zh-hsk1-00001", "target": "\u7231", "reading": "ai4",
                "english": "to love", "senses": [{
                    "id": self.word_id, "reading": "ai4", "english": "to love",
                    "source_sense_ids": [self.word_id], "disambiguator": "to love",
                }],
            }],
            "hsk-3": [{
                "id": "zh-hsk3-00396", "target": "\u5496\u5561",
                "reading": "ka1 fei1", "english": "coffee",
                "source_entry": "pinned-source#/0",
                "level_basis": "2021-standard-derived upstream new-3; not 2025 exam",
            }],
        }
        self.grammar = {
            "hsk-1": [{
                "id": self.grammar_id, "token_form": "S+\u662f+N",
                "disambiguator": "identity",
            }],
            "hsk-3": [{"id": "zh-hsk3-g001", "pattern": "legacy pattern"}],
        }
        self.additional = [{
            **self.vocabulary["hsk-3"][0], "senses": [{
                "id": self.coffee_id, "reading": "ka1 fei1", "english": "coffee",
                "source_sense_ids": [self.coffee_id], "disambiguator": "coffee",
            }],
        }]
        self.sequence = {
            "schema_version": 1, "id": "zh-beginner", "title": "Beginner",
            "language": "chinese", "level_basis": "Independent teaching selection",
            "review_policy": "Review earlier material before introducing new items.",
            "units": [
                {"id": "first", "title": "First", "outcome": "Identify people.",
                 "vocabulary": [self.word_id], "grammar": [self.grammar_id],
                 "review_vocabulary": [], "review_grammar": []},
                {"id": "drinks", "title": "Drinks", "outcome": "Order a drink.",
                 "vocabulary": [self.coffee_id], "grammar": [],
                 "review_vocabulary": [self.word_id], "review_grammar": [self.grammar_id]},
            ],
        }

    def index(self):
        return reference_index(self.vocabulary, self.grammar, self.additional)

    def write_inputs(self):
        for level, rows in self.vocabulary.items():
            directory = self.root / level
            directory.mkdir(exist_ok=True)
            write_yaml(directory / "vocabulary.yaml", rows)
            write_yaml(directory / "grammar.yaml", self.grammar[level])
        write_yaml(self.root / "reference-senses.yaml", self.additional)
        self.track.mkdir(parents=True, exist_ok=True)
        write_yaml(self.track / "sequence.yaml", self.sequence)

    def test_cross_level_sense_keeps_source_identity_and_metadata(self):
        words, grammar = self.index()
        pairs, patterns = sequence_pairs(self.sequence, words, grammar)
        self.assertEqual(pairs, [
            [self.word_id, "\u7231(ai4)/to love"],
            [self.coffee_id, "\u5496\u5561(ka1 fei1)/coffee"],
        ])
        self.assertEqual(patterns, [[self.grammar_id, "S+\u662f+N/identity"]])
        self.assertEqual(self.vocabulary["hsk-3"][0]["level_basis"],
                         self.additional[0]["level_basis"])
        self.assertNotIn("senses", self.vocabulary["hsk-3"][0])

    def test_extra_reference_metadata_cannot_relabel_source_level(self):
        self.additional[0]["level_basis"] = "HSK 1"
        with self.assertRaisesRegex(ValueError, "metadata differs"):
            self.index()

    def test_additional_reference_rejects_unknown_and_existing_parents(self):
        self.additional[0]["id"] = "unknown"
        with self.assertRaisesRegex(ValueError, "Unknown additional reference headword"):
            self.index()
        self.additional[0]["id"] = "zh-hsk1-00001"
        with self.assertRaisesRegex(ValueError, "existing reference sense inventory"):
            self.index()

    def test_no_additional_references_is_valid_but_wrong_shapes_are_not(self):
        self.additional = []
        words, _ = self.index()
        self.assertEqual(set(words), {self.word_id})
        for invalid in ({}, None, "not records"):
            with self.subTest(value=invalid):
                self.additional = invalid
                with self.assertRaises(ValueError):
                    self.index()

    def test_reference_index_rejects_duplicate_heads_and_grammar(self):
        self.vocabulary["hsk-3"].append(self.vocabulary["hsk-1"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate reference headword"):
            self.index()
        self.vocabulary["hsk-3"].pop()
        self.grammar["hsk-3"].append(self.grammar["hsk-1"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate reference grammar"):
            self.index()

    def test_introductions_cannot_repeat_across_units(self):
        self.sequence["units"][1]["vocabulary"].append(self.word_id)
        with self.assertRaisesRegex(ValueError, "already introduced"):
            sequence_pairs(self.sequence, *self.index())

    def test_ids_cannot_repeat_inside_an_introduction_or_review_list(self):
        for field, identifier in (("vocabulary", self.coffee_id),
                                  ("review_vocabulary", self.word_id)):
            with self.subTest(field=field):
                values = self.sequence["units"][1][field]
                values.append(identifier)
                with self.assertRaisesRegex(ValueError, "duplicate ID"):
                    sequence_pairs(self.sequence, *self.index())
                values.pop()

    def test_review_cannot_reference_current_or_future_introductions(self):
        for unit in self.sequence["units"]:
            with self.subTest(unit=unit["id"]):
                unit["review_vocabulary"] = [self.coffee_id]
                with self.assertRaisesRegex(ValueError, "review requires earlier"):
                    sequence_pairs(self.sequence, *self.index())
                unit["review_vocabulary"] = []

    def test_headword_ids_unknown_ids_and_wrong_categories_are_rejected(self):
        for identifier in ("zh-hsk1-00001", "unknown", self.grammar_id):
            with self.subTest(identifier=identifier):
                self.sequence["units"][0]["vocabulary"] = [identifier]
                with self.assertRaisesRegex(ValueError, "unknown ID"):
                    sequence_pairs(self.sequence, *self.index())

    def test_units_require_unique_safe_ids_and_complete_metadata(self):
        self.sequence["units"][1]["id"] = "first"
        with self.assertRaisesRegex(ValueError, "duplicate unit ID"):
            sequence_pairs(self.sequence, *self.index())
        self.sequence["units"][1]["id"] = "../outside"
        with self.assertRaisesRegex(ValueError, "Invalid"):
            sequence_pairs(self.sequence, *self.index())
        self.sequence["units"][1]["id"] = "drinks"
        del self.sequence["units"][1]["outcome"]
        with self.assertRaisesRegex(ValueError, "Unit fields"):
            sequence_pairs(self.sequence, *self.index())

    def test_schema_version_must_be_an_integer_not_a_boolean(self):
        self.sequence["schema_version"] = True
        with self.assertRaisesRegex(ValueError, "schema_version"):
            sequence_pairs(self.sequence, *self.index())

    def test_empty_pair_lists_are_valid_yaml(self):
        self.assertEqual(dump_pairs([]), "[]\n")
        self.sequence["units"][0]["grammar"] = []
        self.sequence["units"][1]["review_grammar"] = []
        outputs = teaching_outputs(self.track, self.sequence, *self.index())
        self.assertEqual(outputs[self.track / "grammar.min.yaml"], "[]\n")

    def test_generate_is_deterministic_and_check_does_not_repair_stale_views(self):
        self.write_inputs()
        generate_track(self.track)
        originals = {path: path.read_bytes() for path in self.track.glob("*.min.yaml")}
        generate_track(self.track)
        generate_track(self.track, check=True)
        self.assertEqual(originals, {path: path.read_bytes() for path in originals})
        path = self.track / "vocabulary.min.yaml"
        path.write_text("[]\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Missing or stale teaching view"):
            generate_track(self.track, check=True)
        self.assertEqual(path.read_text(encoding="utf-8"), "[]\n")

    def test_missing_view_or_invalid_sequence_does_not_write_partial_outputs(self):
        self.write_inputs()
        with self.assertRaisesRegex(ValueError, "Missing or stale teaching view"):
            generate_track(self.track, check=True)
        self.assertFalse((self.track / "vocabulary.min.yaml").exists())
        self.sequence["units"][1]["vocabulary"] = ["unknown"]
        write_yaml(self.track / "sequence.yaml", self.sequence)
        with self.assertRaisesRegex(ValueError, "unknown ID"):
            generate_track(self.track)
        self.assertFalse((self.track / "vocabulary.min.yaml").exists())

    def test_validator_reports_stale_teaching_views(self):
        self.write_inputs()
        generate_track(self.track)
        (self.track / "README.md").write_text("Teaching guide.\n", encoding="utf-8")
        (self.track / "grammar.min.yaml").write_text("[]\n", encoding="utf-8")
        validator = Validator(self.root)
        validator.teaching_track(self.track, *self.index())
        self.assertEqual(len(validator.errors), 1)
        self.assertIn("stale teaching view", validator.errors[0])

    def test_additional_senses_are_derived_from_exact_pinned_source_entries(self):
        source = [{
            "simplified": "\u5496\u5561",
            "forms": [{"transcriptions": {"pinyin": "ka1 fei1"}, "meanings": ["coffee"]}],
        }]
        result = additional_reference_senses(
            source, self.vocabulary, {self.coffee_id: "coffee"},
        )
        self.assertEqual(result, self.additional)
        with self.assertRaisesRegex(ValueError, "Unknown additional reference sense IDs"):
            additional_reference_senses(source, self.vocabulary,
                                        {"zh-hsk3-00396-s999": "invented"})
        with self.assertRaisesRegex(ValueError, "existing sense inventory"):
            additional_reference_senses(source, self.vocabulary, {self.word_id: "to love"})

    def test_catalog_declares_teaching_tracks_separately_from_reference_levels(self):
        catalog = {
            "schema_version": 1,
            "languages": [{"id": language, "standard": "Reference standard", "levels": levels}
                          for language, levels in LEVELS.items()],
        }
        catalog["languages"][0]["teaching_tracks"] = ["beginner"]
        write_yaml(self.root / "catalog.yaml", catalog)
        validator = Validator(self.root)
        validator.catalog()
        self.assertEqual(validator.errors, [])
        self.assertEqual(validator.teaching_tracks["chinese"], ["beginner"])
        for invalid in (["../outside"], ["beginner", "beginner"], "beginner", [None]):
            with self.subTest(value=invalid):
                catalog["languages"][0]["teaching_tracks"] = invalid
                write_yaml(self.root / "catalog.yaml", catalog)
                validator = Validator(self.root)
                validator.catalog()
                self.assertTrue(any("teaching_tracks" in error for error in validator.errors))


class PracticalBeginnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
        cls.track = cls.root / "teaching" / "beginner"
        cls.sequence = load_yaml(cls.track / "sequence.yaml")
        cls.words, cls.patterns = load_reference_index(cls.root)
        cls.word_pairs, cls.grammar_pairs = sequence_pairs(
            cls.sequence, cls.words, cls.patterns,
        )
        cls.introductions = {
            identifier: number
            for number, unit in enumerate(cls.sequence["units"], 1)
            for identifier in unit["vocabulary"]
        }

    def test_twelve_modules_keep_new_material_manageable(self):
        self.assertEqual(len(self.sequence["units"]), 12)
        self.assertGreaterEqual(len(self.word_pairs), 170)
        self.assertLessEqual(len(self.word_pairs), 210)
        for unit in self.sequence["units"]:
            with self.subTest(unit=unit["id"]):
                self.assertGreaterEqual(len(unit["vocabulary"]), 12)
                self.assertLessEqual(len(unit["vocabulary"]), 20)
                self.assertLessEqual(len(unit["grammar"]), 3)

    def test_coffee_and_basic_colors_are_early_without_sibling_senses(self):
        self.assertEqual(self.introductions["zh-hsk3-00396-s001"], 2)
        for identifier in (
            "zh-hsk1-00007-s002", "zh-hsk2-00212-s001", "zh-hsk2-00215-s002",
            "zh-hsk2-00229-s002", "zh-hsk2-00322-s002", "zh-hsk2-00353-s001",
            "zh-hsk2-00609-s001",
        ):
            with self.subTest(identifier=identifier):
                self.assertLessEqual(self.introductions[identifier], 4)
        white_senses = {identifier for identifier in self.introductions
                        if identifier.startswith("zh-hsk1-00007-s")}
        self.assertEqual(white_senses, {"zh-hsk1-00007-s002"})

    def test_all_twenty_five_grammar_constructs_are_introduced_once(self):
        self.assertEqual(len(self.grammar_pairs), 25)
        self.assertEqual({identifier for identifier, _ in self.grammar_pairs}, set(self.patterns))

    def test_additional_senses_are_selected_without_changing_reference_metadata(self):
        labels = load_yaml(self.root / "authoring" / "reference-senses.yaml")
        self.assertEqual(len(labels), 11)
        self.assertTrue(set(labels) <= set(self.introductions))
        parents = {
            row["id"]: row
            for path in self.root.glob("hsk-*/vocabulary.yaml")
            for row in load_yaml(path)
        }
        for row in load_yaml(self.root / "reference-senses.yaml"):
            with self.subTest(headword=row["id"]):
                self.assertEqual({key: value for key, value in row.items() if key != "senses"},
                                 parents[row["id"]])
                self.assertNotIn("senses", parents[row["id"]])

    def test_compact_views_follow_introductions_not_review_or_reference_order(self):
        expected = teaching_outputs(self.track, self.sequence, self.words, self.patterns)
        for path, content in expected.items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_text(encoding="utf-8"), content)
        self.assertEqual(load_yaml(self.track / "vocabulary.min.yaml"), self.word_pairs)
        self.assertEqual(load_yaml(self.track / "grammar.min.yaml"), self.grammar_pairs)

    def test_grammar_introductions_have_their_core_lexical_senses(self):
        anchors = {
            "g001": ["00340-s001"], "g002": ["00148-s001"], "g003": ["00031-s002"],
            "g004": ["00445-s001"], "g005": ["00239-s004"], "g006": ["00230-s002"],
            "g008": ["00273-s001"], "g009": ["00071-s001", "00071-s002"],
            "g010": ["00431-s001", "00122-s001"], "g014": ["00183-s001"],
            "g012": ["00461-s002"], "g013": ["00445-s001"],
            "g015": ["00461-s002"], "g016": ["00428-s002"], "g017": ["00091-s002"],
            "g018": ["00147-s002"], "g019": ["00404-s004"], "g020": ["00161-s001"],
            "g021": ["00300-s003"], "g022": ["00031-s002"], "g025": ["00026-s005"],
        }
        alternatives = {
            "g007": ["00348-s001", "00331-s001", "00255-s001"],
            "g011": ["00470-s003", "00258-s003"],
            "g023": ["00166-s003", "00097-s004"],
            "g024": ["00306-s001", "00207-s001"],
        }
        known = set()
        for unit in self.sequence["units"]:
            known.update(unit["vocabulary"])
            for identifier in unit["grammar"]:
                suffix = identifier.rsplit("-", 1)[1]
                with self.subTest(unit=unit["id"], grammar=identifier):
                    self.assertTrue({f"zh-hsk1-{item}" for item in anchors.get(suffix, [])}
                                    <= known)
                    if suffix in alternatives:
                        self.assertTrue({f"zh-hsk1-{item}" for item in alternatives[suffix]}
                                        & known)


if __name__ == "__main__":
    unittest.main()
