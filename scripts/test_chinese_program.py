"""Regression checks for the independent Mandarin progression and travel route."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

import yaml

from curriculum_yaml import dump_entries, load_yaml, write_yaml
from generate_chinese_program import (
    annotated_grammar, apply_hsk_vocabulary, augment_beginner, configured, generate,
    load_hsk_references, load_hsk_vocabulary, load_inputs, load_references, phrase_is_covered,
    program_outputs, schedule_vocabulary, tourist_outputs, validate_model,
    vocabulary_labels,
)


class ProgramTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "chinese"
        source = Path(__file__).resolve().parents[1] / "curriculum" / "chinese" / "teaching"
        self.inputs = {
            "program": load_yaml(source / "program.yaml"),
            "mastery": load_yaml(source / "mastery.yaml"),
            "vocabulary": [], "grammar": [], "support": {},
        }
        self.words, self.patterns = {}, {}
        self.beginner = {
            "schema_version": 2, "id": "zh-beginner", "title": "First exchanges",
            "language": "chinese", "level_basis": "Independent teaching selection",
            "review_policy": "Review earlier material in later sessions.", "units": [],
        }
        for number in range(1, 13):
            identifier = f"zh-hsk1-{number:05d}-s001"
            form = ["\u6211", "\u4f60", "\u548c"][number - 1] if number <= 3 else f"known{number}"
            entry = self.word(identifier, form, f"known meaning {number}")
            unit = {
                "id": f"beginner-{number}", "title": f"First topic {number}",
                "outcome": "Exchange familiar information.", "vocabulary": [entry], "grammar": [],
                "review_vocabulary": [], "review_grammar": [],
            }
            self.beginner["units"].append(unit)
        self.base_grammar = self.pattern("zh-hsk1-g001", "S+V", "simple statement")
        self.beginner["units"][0]["grammar"] = [self.base_grammar]
        for number in range(5, 31):
            identifier = f"zh-hsk2-{number:05d}-s001"
            entry = self.word(identifier, f"form{number}", f"meaning {number}")
            self.inputs["vocabulary"].append(
                {"id": identifier, "level": number, "topic": "grammar", "ds": entry["ds"]},
            )
            pattern = self.pattern(f"zh-hsk2-g{number:03d}", f"Pattern{number}", f"function {number}")
            self.inputs["grammar"].append({
                **pattern, "level": number, "topic": "grammar", "anchors": [identifier],
            })
        for number, (extension, topic) in enumerate(
            (("professional", "work"), ("technical", "technology"),
             ("scientific", "science"), ("literary", "literature")), 100,
        ):
            identifier = f"zh-hsk3-{number:05d}-s001"
            entry = self.word(identifier, f"special{number}", f"special meaning {number}")
            self.inputs["vocabulary"].append(
                {"id": identifier, "level": extension, "topic": topic, "ds": entry["ds"]},
            )
            pattern = self.pattern(f"zh-hsk3-g{number:03d}", f"Special{number}", f"special function {number}")
            self.inputs["grammar"].append({
                **pattern, "level": extension, "topic": topic, "anchors": [identifier],
            })
        first = "zh-hsk1-00001-s001"
        second = "zh-hsk1-00002-s001"
        third = "zh-hsk1-00003-s001"
        self.inputs["tourist"] = {
            "schema_version": 1, "id": "zh-tourist", "title": "Travel Mandarin",
            "language": "chinese", "level_basis": "Independent travel selection",
            "review_policy": "Revisit earlier phrases.", "quick_start": ["greetings"],
            "units": [
                {"id": "greetings", "title": "Greetings", "outcome": "Identify yourself.",
                 "vocabulary": [first], "grammar": [self.base_grammar["id"]],
                 "review_vocabulary": [], "review_grammar": [],
                 "phrases": [{"id": "zh-tourist-p001", "ch": "\u6211", "pr": "wo3",
                              "ds": "I", "items": [first]}]},
                {"id": "contact", "title": "Contact", "outcome": "Identify people.",
                 "vocabulary": [second, third], "grammar": [],
                 "review_vocabulary": [first], "review_grammar": [self.base_grammar["id"]],
                 "phrases": [{"id": "zh-tourist-p002", "ch": "\u4f60\u548c\u6211\u3002",
                              "pr": "ni3 he2 wo3", "ds": "you and me",
                              "items": [second, third, first]}]},
            ],
        }

    def word(self, identifier, form, meaning):
        entry = {"id": identifier, "ch": form, "pr": "reading", "ds": meaning}
        self.words[identifier] = entry
        return entry

    def pattern(self, identifier, form, meaning):
        entry = {"id": identifier, "ch": form, "ds": meaning}
        self.patterns[identifier] = entry
        return entry

    def outputs(self):
        return program_outputs(self.root, self.inputs, self.words, self.patterns, self.beginner)

    def write_inputs(self):
        locations = {
            "program": self.root / "teaching" / "program.yaml",
            "mastery": self.root / "teaching" / "mastery.yaml",
            "vocabulary": self.root / "authoring" / "teaching" / "vocabulary.yaml",
            "grammar": self.root / "authoring" / "teaching" / "grammar.yaml",
            "support": self.root / "authoring" / "teaching" / "support.yaml",
            "tourist": self.root / "teaching" / "tourist" / "plan.yaml",
        }
        for name, path in locations.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            write_yaml(path, self.inputs[name])
        path = self.root / "teaching" / "beginner" / "sequence.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump_entries(self.beginner), encoding="utf-8")
        directory = self.root / "hsk-1"
        directory.mkdir()
        write_yaml(directory / "vocabulary.yaml", [
            {"id": entry["id"].rsplit("-s", 1)[0], "target": entry["ch"],
             "senses": [{"id": entry["id"], "reading": entry["pr"], "english": entry["ds"],
                         "disambiguator": entry["ds"], "source_sense_ids": [entry["id"]]}]}
            for entry in self.words.values()
        ])
        write_yaml(directory / "grammar.yaml", [
            {"id": entry["id"], "pattern": entry["ch"], "english": entry["ds"],
             **({"token_form": entry["ch"], "disambiguator": entry["ds"]}
                if entry["id"] == self.base_grammar["id"] else {})}
            for entry in self.patterns.values()
        ])
        write_yaml(self.root / "reference-senses.yaml", [])

    def test_thirty_levels_keep_beginner_order_and_hierarchical_metadata(self):
        outputs = self.outputs()
        self.assertEqual(len(outputs), 126)
        core = yaml.safe_load(outputs[self.root / "teaching" / "core" / "sequence.yaml"])
        levels = [level for phase in core["phases"] for level in phase["levels"]]
        self.assertEqual([level["number"] for level in levels], list(range(1, 31)))
        self.assertEqual([unit for level in levels[:4] for unit in level["units"]],
                         self.beginner["units"])
        self.assertEqual(levels[4]["prerequisites"], [f"zh-level-{number:02d}" for number in range(1, 5)])
        self.assertEqual(levels[4]["mastery_profile"], "zh-item-mastery")
        self.assertEqual(levels[4]["checkpoint"]["criteria"], levels[4]["goals"])

    def test_inventory_counts_headwords_separately_from_senses(self):
        source = self.inputs["vocabulary"][0]
        identifier = source["id"].replace("-s001", "-s002")
        self.word(identifier, self.words[source["id"]]["ch"], "another meaning")
        self.inputs["vocabulary"].append({**source, "id": identifier, "ds": "another meaning", "level": 6})
        outputs = self.outputs()
        inventory = yaml.safe_load(outputs[self.root / "teaching" / "inventory.yaml"])
        self.assertEqual(inventory["core"]["vocabulary_senses"], inventory["core"]["headwords"] + 1)
        self.assertEqual(inventory["levels"][5]["new_headwords"], 1)
        self.assertEqual(sum(phase["new_headwords"] for phase in inventory["phases"]),
                         inventory["core"]["headwords"])
        self.assertNotIn("competency", inventory)

    def test_all_compact_entries_equal_their_introduced_sequence_entries(self):
        outputs = self.outputs()
        for number in range(1, 31):
            directory = self.root / "teaching" / "levels" / f"{number:02d}"
            sequence = yaml.safe_load(outputs[directory / "sequence.yaml"])
            for kind, expected in (("vocabulary", {"id", "ch", "pr", "ds"}),
                                   ("grammar", {"id", "ch", "ds"})):
                entries = yaml.safe_load(outputs[directory / f"{kind}.min.yaml"])
                self.assertEqual(entries, [entry for unit in sequence["units"] for entry in unit[kind]])
                self.assertTrue(all(set(entry) == expected for entry in entries))

    def test_anchor_moves_a_later_sense_earlier_without_changing_its_id(self):
        later = self.inputs["vocabulary"][-5]["id"]
        self.inputs["grammar"][0]["anchors"].append(later)
        scheduled, adjustments = schedule_vocabulary(
            self.inputs, self.words, self.patterns, self.beginner,
        )
        self.assertEqual(next(row for row in scheduled if row["id"] == later)["level"], 5)
        self.assertTrue(any(row["id"] == later and row["to"] == 5 for row in adjustments))
        self.assertEqual(self.inputs["vocabulary"][-5]["level"], 30)
        # Keep the later level populated to exercise the complete output path.
        entry = self.word("zh-hsk2-00999-s001", "later", "later meaning")
        self.inputs["vocabulary"].append({"id": entry["id"], "level": 30, "topic": "grammar", "ds": entry["ds"]})
        self.outputs()

    def test_missing_lexical_anchor_is_an_explicit_error(self):
        self.inputs["grammar"][0]["anchors"] = ["unknown"]
        with self.assertRaisesRegex(ValueError, "unknown ID"):
            self.outputs()

    def test_unknown_duplicate_and_beginner_placements_are_rejected(self):
        for mutation in ("unknown", "duplicate", "beginner", "bad-label", "bad-topic", "bad-level"):
            with self.subTest(mutation=mutation):
                original = deepcopy(self.inputs["vocabulary"])
                row = self.inputs["vocabulary"][0]
                if mutation == "unknown":
                    row["id"] = "unknown"
                elif mutation == "duplicate":
                    self.inputs["vocabulary"].append(dict(row))
                elif mutation == "beginner":
                    row["id"] = self.beginner["units"][0]["vocabulary"][0]["id"]
                elif mutation == "bad-label":
                    row["ds"] = "different meaning"
                elif mutation == "bad-topic":
                    row["topic"] = "../outside"
                else:
                    row["level"] = True
                with self.assertRaises(ValueError):
                    self.outputs()
                self.inputs["vocabulary"] = original

    def test_empty_level_and_empty_extension_cannot_look_complete(self):
        for destination in (15, "technical"):
            with self.subTest(destination=destination):
                original = deepcopy(self.inputs)
                for kind in ("vocabulary", "grammar"):
                    self.inputs[kind] = [row for row in self.inputs[kind] if row["level"] != destination]
                with self.assertRaisesRegex(ValueError, "no curriculum material"):
                    self.outputs()
                self.inputs = original

    def test_model_rejects_invalid_levels_phases_targets_and_mastery(self):
        cases = [
            ("program", lambda value: value["phases"][0]["levels"].append(5)),
            ("program", lambda value: value["levels"][0].update(number=True)),
            ("program", lambda value: value["phases"][0].update(id="../outside")),
            ("program", lambda value: value["extensions"][0].update(after_level=31)),
            ("program", lambda value: value["extensions"][0].update(mastery_target="fluent")),
            ("mastery", lambda value: value["modalities"].remove("listening")),
            ("mastery", lambda value: value["stages"][0].update(id="mastered")),
            ("mastery", lambda value: value["stages"][0].update(modalities=["spoken-production"])),
        ]
        for key, mutate in cases:
            with self.subTest(key=key):
                original = deepcopy(self.inputs[key])
                mutate(self.inputs[key])
                with self.assertRaises(ValueError):
                    validate_model(self.inputs["program"], self.inputs["mastery"])
                self.inputs[key] = original

    def test_tourist_quick_start_is_a_self_contained_prefix(self):
        outputs, report = tourist_outputs(
            self.root, self.inputs["tourist"], self.words, self.patterns, self.inputs["mastery"],
        )
        quick = yaml.safe_load(outputs[self.root / "teaching" / "tourist" / "quick-start" / "sequence.yaml"])
        self.assertEqual(len(quick["units"]), 1)
        self.assertEqual(report["quick_start"]["vocabulary_senses"], 1)
        self.inputs["tourist"]["quick_start"] = ["contact"]
        with self.assertRaisesRegex(ValueError, "ordered prefix"):
            self.outputs()

    def test_tourist_phrase_components_must_be_introduced_and_cover_its_text(self):
        phrase = self.inputs["tourist"]["units"][0]["phrases"][0]
        phrase["items"].append("zh-hsk1-00002-s001")
        with self.assertRaisesRegex(ValueError, "unknown ID"):
            self.outputs()
        phrase["items"].pop()
        phrase["ch"] += "\u4f60"
        with self.assertRaisesRegex(ValueError, "phrase requires vocabulary"):
            self.outputs()
        self.assertTrue(phrase_is_covered("\u4f60\u548c\u6211\u3002", ["\u4f60", "\u548c", "\u6211"]))
        self.assertFalse(phrase_is_covered("\u4f60\u548c\u6211", ["\u4f60", "\u6211"]))

    def test_tourist_duplicate_phrase_ids_and_forward_reviews_are_rejected(self):
        tourist = self.inputs["tourist"]
        tourist["units"][1]["phrases"][0]["id"] = "zh-tourist-p001"
        with self.assertRaisesRegex(ValueError, "duplicate tourist phrase"):
            self.outputs()
        tourist["units"][1]["phrases"][0]["id"] = "zh-tourist-p002"
        tourist["units"][0]["review_vocabulary"] = ["zh-hsk1-00002-s001"]
        with self.assertRaisesRegex(ValueError, "review requires earlier"):
            self.outputs()

    def test_source_grammar_annotations_do_not_mutate_or_reclassify_references(self):
        source = {"hsk-2": [{"id": "g1", "pattern": "pattern", "level_basis": "source band"}]}
        original = deepcopy(source)
        result = annotated_grammar(source, [{"id": "g1", "ch": "P", "ds": "a function"}])
        self.assertEqual(source, original)
        self.assertEqual(result["hsk-2"][0]["level_basis"], "source band")
        self.assertEqual(result["hsk-2"][0]["token_form"], "P")
        with self.assertRaisesRegex(ValueError, "Unknown source grammar"):
            annotated_grammar(source, [{"id": "unknown", "ch": "P", "ds": "a function"}])

    def test_reference_labels_cannot_overwrite_existing_canonical_senses(self):
        first = self.inputs["vocabulary"][0]
        vocabulary = {"hsk-1": [{"senses": [{"id": first["id"], "disambiguator": first["ds"]}]}]}
        result = vocabulary_labels(self.inputs, vocabulary, {})
        self.assertNotIn(first["id"], result)
        self.inputs["support"][first["id"]] = "different"
        with self.assertRaisesRegex(ValueError, "preserve the existing"):
            vocabulary_labels(self.inputs, vocabulary, {})

    def test_support_label_changes_cannot_bypass_offline_validation(self):
        first = next(iter(self.words))
        self.inputs["support"][first] = "a conflicting label"
        with self.assertRaisesRegex(ValueError, "support label"):
            self.outputs()

    def test_optional_branch_can_supply_an_anchor_without_requiring_a_later_core_level(self):
        late = self.inputs["vocabulary"][25]["id"]
        technical = next(row for row in self.inputs["grammar"] if row["level"] == "technical")
        technical["anchors"].append(late)
        scheduled, adjustments = schedule_vocabulary(
            self.inputs, self.words, self.patterns, self.beginner,
        )
        self.assertEqual({row["level"] for row in scheduled if row["id"] == late}, {30, "technical"})
        self.assertTrue(any(row["id"] == late and row["to"] == "technical" for row in adjustments))
        outputs = self.outputs()
        branch = yaml.safe_load(outputs[
            self.root / "teaching" / "extensions" / "technical" / "vocabulary.min.yaml"
        ])
        self.assertIn(late, {entry["id"] for entry in branch})

    def test_grammar_support_can_add_a_previously_unselected_sense(self):
        entry = self.word("zh-hsk3-00888-s001", "support", "support meaning")
        self.inputs["support"][entry["id"]] = entry["ds"]
        self.inputs["grammar"][0]["anchors"].append(entry["id"])
        scheduled, adjustments = schedule_vocabulary(
            self.inputs, self.words, self.patterns, self.beginner,
        )
        self.assertEqual(next(row for row in scheduled if row["id"] == entry["id"])["level"], 5)
        self.assertTrue(any(row["id"] == entry["id"] and row["from"] is None for row in adjustments))
        self.outputs()

    def test_generation_is_deterministic_and_check_never_repairs_a_stale_file(self):
        self.write_inputs()
        outputs = generate(self.root)
        originals = {path: path.read_bytes() for path in outputs}
        self.assertEqual(outputs, generate(self.root))
        generate(self.root, check=True)
        self.assertEqual(originals, {path: path.read_bytes() for path in originals})
        path = self.root / "teaching" / "core" / "vocabulary.min.yaml"
        path.write_text("[]\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "stale program view"):
            generate(self.root, check=True)
        self.assertEqual(path.read_text(encoding="utf-8"), "[]\n")

    def test_invalid_input_does_not_write_partial_program_outputs(self):
        self.write_inputs()
        self.inputs["tourist"]["units"][-1]["phrases"][0]["id"] = "invalid"
        write_yaml(self.root / "teaching" / "tourist" / "plan.yaml", self.inputs["tourist"])
        with self.assertRaises(ValueError):
            generate(self.root)
        self.assertFalse((self.root / "teaching" / "core").exists())
        self.assertFalse((self.root / "teaching" / "levels").exists())

    def test_catalog_program_is_explicit_and_cannot_redirect_paths(self):
        self.root.mkdir()
        path = self.root.parent / "catalog.yaml"
        for value, expected in ((None, False), ("zh-practical", True), ("../outside", None)):
            entry = {"id": "chinese"}
            if value is not None:
                entry["teaching_program"] = value
            write_yaml(path, {"languages": [entry]})
            if expected is None:
                with self.assertRaises(ValueError):
                    configured(self.root)
            else:
                self.assertIs(configured(self.root), expected)
        write_yaml(path, {"languages": [{"id": "chinese", "teaching_program": None}]})
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            configured(self.root)


class CheckedInProgramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
        cls.teaching = cls.root / "teaching"
        cls.hsk_vocabulary = load_hsk_vocabulary(cls.root)
        cls.inputs = apply_hsk_vocabulary(load_inputs(cls.root), cls.hsk_vocabulary)
        cls.words, cls.patterns = load_references(cls.root, cls.inputs)
        cls.source_beginner = load_yaml(cls.teaching / "beginner" / "sequence.yaml")
        cls.beginner = augment_beginner(
            cls.source_beginner, cls.hsk_vocabulary, cls.words,
        )
        cls.outputs = program_outputs(
            cls.root, cls.inputs, cls.words, cls.patterns, cls.beginner,
        )
        cls.documents = {}
        cls.core = cls.document(cls.teaching / "core" / "sequence.yaml")
        cls.levels = [level for phase in cls.core["phases"] for level in phase["levels"]]
        cls.units = [unit for level in cls.levels for unit in level["units"]]
        cls.anchors = {row["id"]: set(row["anchors"]) for row in cls.inputs["grammar"]}

    @classmethod
    def document(cls, path):
        if path not in cls.documents:
            cls.documents[path] = load_yaml(path)
        return cls.documents[path]

    def assert_dependencies(self, units):
        words, grammar = set(), set()
        for unit in units:
            self.assertTrue({row["id"] for row in unit["review_vocabulary"]} <= words, unit["id"])
            self.assertTrue({row["id"] for row in unit["review_grammar"]} <= grammar, unit["id"])
            for entry in unit["vocabulary"]:
                self.assertNotIn(entry["id"], words, unit["id"])
                words.add(entry["id"])
            for entry in unit["grammar"]:
                self.assertNotIn(entry["id"], grammar, unit["id"])
                self.assertTrue(self.anchors.get(entry["id"], set()) <= words, unit["id"])
                grammar.add(entry["id"])

    def test_enabled_program_reproduces_every_checked_in_view(self):
        self.assertTrue(configured(self.root))
        self.assertEqual(len(self.outputs), 126)
        for path, expected in self.outputs.items():
            with self.subTest(path=path.relative_to(self.root)):
                self.assertEqual(path.read_text(encoding="utf-8"), expected)

    def test_all_levels_have_goals_and_preserve_the_beginner_modules(self):
        self.assertEqual(len(self.core["phases"]), 6)
        self.assertEqual([level["number"] for level in self.levels], list(range(1, 31)))
        self.assertEqual([unit for level in self.levels[:4] for unit in level["units"]],
                         self.beginner["units"])
        for source, expanded in zip(
            self.source_beginner["units"], self.beginner["units"],
        ):
            self.assertEqual(
                expanded["vocabulary"][:len(source["vocabulary"])],
                source["vocabulary"],
            )
        for level in self.levels:
            self.assertTrue(level["units"])
            self.assertTrue(2 <= len(level["goals"]) <= 4)
            self.assertEqual(level["checkpoint"]["criteria"], level["goals"])
            self.assertTrue(level["checkpoint"]["task"])
            self.assertEqual(level["prerequisites"],
                             [f"zh-level-{n:02d}" for n in range(1, level["number"])])
            self.assertEqual(self.document(
                self.teaching / "levels" / f"{level['number']:02d}" / "sequence.yaml",
            ), level)
        self.assert_dependencies(self.units)

    def test_core_breadth_is_real_headwords_not_inflated_sense_counts(self):
        entries = [entry for unit in self.units for entry in unit["vocabulary"]]
        sense_ids = {entry["id"] for entry in entries}
        headwords = {identifier.rsplit("-s", 1)[0] for identifier in sense_ids}
        report = self.document(self.teaching / "inventory.yaml")
        self.assertGreaterEqual(len(headwords), 5800)
        self.assertGreater(len(sense_ids), len(headwords))
        self.assertEqual(len(headwords), len({entry["ch"] for entry in entries}))
        self.assertEqual(report["core"]["headwords"], len(headwords))
        self.assertEqual(report["core"]["vocabulary_senses"], len(sense_ids))
        self.assertEqual(sum(row["new_headwords"] for row in report["phases"]), len(headwords))
        self.assertEqual(report["levels"][-1]["cumulative_headwords"], len(headwords))
        self.assertGreater(report["phases"][-1]["modules"], report["phases"][1]["modules"])
        self.assertNotIn("competency", report)
        self.assertNotIn("learner_mastery", report)

    def test_hsk_evidence_overlay_is_cumulative_and_source_attributed(self):
        self.assertEqual(len(self.hsk_vocabulary), 2762)
        self.assertEqual(
            sum(row["course_level"] <= 4 for row in self.hsk_vocabulary), 152,
        )
        cutoffs = [4, 8, 13, 18, 24, 30]
        self.assertTrue(all(
            row["course_level"] <= cutoffs[row["hsk_level"] - 1]
            for row in self.hsk_vocabulary
        ))
        supplemental = load_hsk_references(self.root)
        self.assertEqual(len(supplemental), 390)
        self.assertTrue(set(supplemental) <= self.words.keys())

    def test_phase_folders_sort_in_curriculum_order(self):
        directory = self.teaching / "phases"
        expected = [f"{number}-{phase['id']}"
                    for number, phase in enumerate(self.core["phases"], 1)]
        self.assertEqual(sorted(path.name for path in directory.iterdir() if path.is_dir()), expected)
        for folder, phase in zip(expected, self.core["phases"]):
            for kind in ("vocabulary", "grammar"):
                self.assertEqual(self.document(directory / folder / f"{kind}.min.yaml"),
                                 [entry for level in phase["levels"] for unit in level["units"]
                                  for entry in unit[kind]])

    def test_compact_and_embedded_entries_keep_the_user_selected_shapes(self):
        for path in self.outputs:
            if path.name != "sequence.yaml":
                continue
            sequence = self.document(path)
            units = self.units if sequence["kind"] == "program" else sequence["units"]
            for kind, keys, references in (
                ("vocabulary", {"id", "ch", "pr", "ds"}, self.words),
                ("grammar", {"id", "ch", "ds"}, self.patterns),
            ):
                compact_path = path.parent / f"{kind}.min.yaml"
                compact = self.document(compact_path)
                self.assertEqual(compact, [entry for unit in units for entry in unit[kind]])
                self.assertEqual(len(compact), sum(
                    line.startswith("- {") for line in self.outputs[compact_path].splitlines()
                ))
                for unit in units:
                    for entry in unit[kind] + unit[f"review_{kind}"]:
                        self.assertEqual(set(entry), keys)
                        self.assertEqual(entry, references[entry["id"]])

    def test_practical_senses_and_alternate_readings_are_not_lost(self):
        placements = {entry["id"]: level["number"] for level in self.levels
                      for unit in level["units"] for entry in unit["vocabulary"]}
        for identifier, latest in (
            ("zh-hsk1-00308-s003", 7),  # Hot weather, not only heating something.
            ("zh-hsk2-00690-s002", 5),  # Long, not only growing.
            ("zh-hsk1-00113-s015", 5),  # Working, not only dry.
            ("zh-hsk1-00134-s015", 6),  # Returning, not only still.
            ("zh-hsk1-00194-s006", 8),  # Reading, not only watching.
            ("zh-hsk1-00057-s016", 8),  # Playing a game, not only striking.
            ("zh-hsk1-00190-s003", 5),  # Operating or switching on.
            ("zh-hsk2-00706-s006", 5),  # Classifier, not only the adverb.
            ("zh-hsk3-00763-s001", 6),  # Cash belongs with everyday transactions.
            ("zh-hsk4-00165-s001", 7),
            ("zh-hsk5-00309-s003", 6),
            ("zh-hsk1-00319-s006", 5),
            ("zh-hsk1-00393-s003", 5),
            ("zh-hsk1-00133-s002", 7),  # Crossing, not only elapsed time or aspect.
            ("zh-hsk1-00404-s003", 8),  # Thinking that, not only wanting.
            ("zh-hsk1-00427-s004", 6),
        ):
            self.assertLessEqual(placements[identifier], latest)
        for identifier, reading in (
            ("zh-hsk1-00113-s002", "g\u0101n"),
            ("zh-hsk1-00113-s015", "g\u00e0n"),
            ("zh-hsk1-00134-s002", "h\u00e1i"),
            ("zh-hsk1-00134-s015", "hu\u00e1n"),
            ("zh-hsk2-00690-s002", "ch\u00e1ng"),
            ("zh-hsk2-00690-s009", "zh\u01ceng"),
        ):
            self.assertIn(identifier, placements)
            self.assertEqual(self.words[identifier]["pr"], reading)

    def test_grammar_coverage_accounts_for_source_gaps_and_reference_variants(self):
        core_ids = {entry["id"] for unit in self.units for entry in unit["grammar"]}
        selected = set(core_ids)
        for branch in self.inputs["program"]["extensions"]:
            sequence = self.document(
                self.teaching / "extensions" / branch["id"] / "sequence.yaml",
            )
            selected.update(entry["id"] for unit in sequence["units"] for entry in unit["grammar"])
        source_ids = {row["id"] for directory in self.root.glob("hsk-*")
                      for row in load_yaml(directory / "grammar.yaml")}
        variants = {
            "zh-hsk4-g007", "zh-hsk5-g005", "zh-hsk6-g021",
            "zh-hsk7-9-g007", "zh-hsk7-9-g011", "zh-hsk7-9-g014",
        }
        self.assertEqual(selected, source_ids - variants)
        for identifier in ("zh-hsk3-g001", "zh-hsk4-g009", "zh-hsk4-g011"):
            self.assertIn(identifier, core_ids)
            self.assertIn("\u628a", self.patterns[identifier]["ch"])
            self.assertTrue(all(self.words[anchor]["ch"] != "\u628a"
                                for anchor in self.anchors[identifier]))
        notes = (self.teaching / "grammar-notes.md").read_text(encoding="utf-8")
        for identifier in variants | {"zh-hsk3-g001"}:
            self.assertIn(identifier, notes)

    def test_extensions_use_only_their_declared_core_prerequisites(self):
        for branch in self.inputs["program"]["extensions"]:
            sequence = self.document(
                self.teaching / "extensions" / branch["id"] / "sequence.yaml",
            )
            prior = [unit for level in self.levels if level["number"] <= branch["after_level"]
                     for unit in level["units"]]
            self.assertTrue(sequence["units"])
            self.assertTrue(any(unit["vocabulary"] for unit in sequence["units"]))
            self.assertEqual(sequence["prerequisites"],
                             [f"zh-level-{n:02d}" for n in range(1, branch["after_level"] + 1)])
            self.assert_dependencies(prior + sequence["units"])

    def test_tourist_quick_start_stands_alone_and_phrases_keep_their_components(self):
        route = self.document(self.teaching / "tourist" / "sequence.yaml")
        quick = self.document(self.teaching / "tourist" / "quick-start" / "sequence.yaml")
        self.assertEqual(len(route["units"]), 12)
        self.assertEqual(len(quick["units"]), 5)
        self.assertEqual(quick["units"], route["units"][:5])
        self.assertEqual(sum(len(unit["phrases"]) for unit in route["units"]), 59)
        for sequence in (route, quick):
            known_words, known_grammar = set(), set()
            for unit in sequence["units"]:
                self.assertTrue({r["id"] for r in unit["review_vocabulary"]} <= known_words)
                self.assertTrue({r["id"] for r in unit["review_grammar"]} <= known_grammar)
                known_words.update(entry["id"] for entry in unit["vocabulary"])
                known_grammar.update(entry["id"] for entry in unit["grammar"])
                for phrase in unit["phrases"]:
                    self.assertEqual(set(phrase), {"id", "ch", "pr", "ds"})
                    components = unit["phrase_components"][phrase["id"]]
                    self.assertTrue(set(components) <= known_words)
                    self.assertTrue(phrase_is_covered(
                        phrase["ch"], [self.words[item]["ch"] for item in components],
                    ))
                    self.assertTrue(phrase["pr"])


if __name__ == "__main__":
    unittest.main()
