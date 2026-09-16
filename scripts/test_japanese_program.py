"""Checked-in Japanese curriculum coverage and generated-view conformance."""

from pathlib import Path
import re
import unittest

from curriculum_yaml import load_yaml
from generate_practical_program import normalized_reading, normalized_surface, program_outputs
from japanese_program_adapter import ADAPTER, LEVELS, ROOT, entry_number, source_manifest


class JapaneseProgramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = ADAPTER.load(ROOT)
        cls.outputs = program_outputs(ROOT, cls.data, ADAPTER)
        cls.core = load_yaml(ROOT / "teaching" / "core" / "sequence.yaml")
        cls.levels = [level for phase in cls.core["phases"] for level in phase["levels"]]
        cls.units = [unit for level in cls.levels for unit in level["units"]]
        cls.references = cls.data.references
        cls.placements = load_yaml(ROOT / "authoring" / "teaching" / "grammar.yaml")
        cls.anchors = {row["id"]: set(row["anchors"]) for row in cls.placements}
        cls.parents = {row["id"]: row for level in LEVELS
                       for row in load_yaml(ROOT / f"jlpt-{level}" / "vocabulary.yaml")}

    def assert_closure(self, units):
        words, grammar = set(), set()
        for unit in units:
            self.assertTrue({entry["id"] for entry in unit["review_vocabulary"]} <= words, unit["id"])
            self.assertTrue({entry["id"] for entry in unit["review_grammar"]} <= grammar, unit["id"])
            current_words = {entry["id"] for entry in unit["vocabulary"]}
            current_grammar = {entry["id"] for entry in unit["grammar"]}
            self.assertFalse(current_words & words, unit["id"])
            self.assertFalse(current_grammar & grammar, unit["id"])
            words.update(current_words)
            for identifier in current_grammar:
                self.assertTrue(self.anchors.get(identifier, set()) <= words, unit["id"])
                self.assertTrue(
                    set(self.data.construction_dependencies.get(identifier, ())) <= grammar | current_grammar,
                    unit["id"],
                )
            grammar.update(current_grammar)

    def test_every_committed_view_matches_complete_deterministic_generation(self):
        for path, expected in self.outputs.items():
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertEqual(path.read_text(encoding="utf-8"), expected)
        self.assertEqual(program_outputs(ROOT, self.data, ADAPTER), self.outputs)

    def test_phase_partition_nested_levels_goals_and_checkpoints(self):
        self.assertEqual([phase["id"] for phase in self.core["phases"]],
                         [phase["id"] for phase in self.data.inputs["program"]["phases"]])
        self.assertEqual([level["number"] for level in self.levels], list(range(1, 31)))
        self.assertEqual([len(phase["levels"]) for phase in self.core["phases"]], [4, 4, 5, 5, 6, 6])
        for index, phase in enumerate(self.core["phases"], 1):
            for level in phase["levels"]:
                path = (ROOT / "teaching" / "phases" / f"{index}-{phase['id']}"
                        / "levels" / f"{level['number']:02d}" / "sequence.yaml")
                self.assertEqual(load_yaml(path), level)
                self.assertTrue(2 <= len(level["goals"]) <= 4)
                self.assertEqual(level["checkpoint"]["criteria"], level["goals"])
                self.assertTrue(level["checkpoint"]["task"])
                self.assertEqual(level["prerequisites"],
                                 [f"ja-level-{number:02d}" for number in range(1, level["number"])])
        self.assertFalse((ROOT / "teaching" / "levels").exists())
        self.assert_closure(self.units)

    def test_real_lemma_breadth_separate_from_senses_and_reading_rows(self):
        entries = [entry for unit in self.units for entry in unit["vocabulary"]]
        parents = {entry["id"].rsplit("-s", 1)[0] for entry in entries}
        lemmas = {entry_number(self.parents[parent]) for parent in parents}
        report = load_yaml(ROOT / "teaching" / "inventory.yaml")
        self.assertEqual(report["core"]["headwords"], len(lemmas))
        self.assertGreaterEqual(len(lemmas), 5700)
        self.assertEqual(report["core"]["vocabulary_senses"], len(entries))
        self.assertGreater(len(entries), len(lemmas))
        self.assertEqual(sum(phase["new_headwords"] for phase in report["phases"]), len(lemmas))
        self.assertEqual(report["levels"][-1]["cumulative_headwords"], len(lemmas))
        self.assertGreater(report["phases"][-1]["modules"], report["phases"][1]["modules"])
        for earlier, later in zip(report["phases"], report["phases"][1:]):
            self.assertLess(earlier["new_headwords"], later["new_headwords"])
        self.assertNotIn("learner_mastery", report)
        self.assertNotIn("competency", report)

    def test_practical_secondary_senses_and_higher_source_band_essentials(self):
        destinations = {entry["id"]: level["number"] for level in self.levels
                        for unit in level["units"] for entry in unit["vocabulary"]}
        for identifier, latest in (
            ("ja-n5-00180-s001", 8), ("ja-n5-00180-s002", 8), ("ja-n5-00180-s003", 8),
            ("ja-n5-00150-s003", 8), ("ja-n5-00150-s004", 8), ("ja-n5-00150-s005", 13),
            ("ja-n5-00572-s001", 8), ("ja-n5-00572-s005", 8),
            ("ja-n3-00170-s001", 4), ("ja-n3-00876-s001", 4),
            ("ja-n5-00261-s003", 8), ("ja-n5-00261-s004", 8),
            ("ja-n5-00467-s002", 1), ("ja-n5-00039-s003", 2),
            ("ja-n5-00133-s002", 4), ("ja-n5-00385-s002", 4),
            ("ja-n5-00652-s002", 6),
        ):
            with self.subTest(identifier=identifier):
                self.assertIn(identifier, destinations)
                self.assertLessEqual(destinations[identifier], latest)

    def test_reference_parent_metadata_raw_senses_and_originals_are_preserved(self):
        for parent in load_yaml(ROOT / "reference-senses.yaml"):
            self.assertEqual({key: value for key, value in parent.items() if key != "senses"},
                             self.parents[parent["id"]])
            for sense in parent["senses"]:
                self.assertEqual(sense["id"], f"{parent['id']}-s{sense['raw_sense_ordinal']:03d}")
                self.assertIn("appliesToKana", sense["source_sense"])
                self.assertIn("appliesToKanji", sense["source_sense"])
        self.assertEqual(source_manifest(ROOT),
                         load_yaml(ROOT / "authoring" / "teaching" / "source-lock.yaml"))

    def test_constructs_are_accounted_for_without_counterfeit_particle_senses(self):
        selected = set(self.references.grammar)
        originals = {row["id"] for level in LEVELS for row in load_yaml(ROOT / f"jlpt-{level}" / "grammar.yaml")}
        notes = (ROOT / "teaching" / "grammar-notes.md").read_text(encoding="utf-8")
        self.assertEqual(len(originals), 225)
        self.assertTrue(selected <= originals)
        self.assertTrue(originals - selected <= set(re.findall(r"ja-n[1-5]-g\d{3}", notes)))
        deferred = load_yaml(ROOT / "authoring" / "teaching" / "coverage.yaml")["reference_only_grammar"]
        self.assertFalse(selected & set(deferred))
        self.assertEqual(originals, selected | set(deferred))
        for decision in deferred.values():
            self.assertTrue(decision["reason"])
            self.assertIn(decision["related_selected_id"], selected)
        for identifier in ("ja-n5-g001", "ja-n5-g004", "ja-n5-g006", "ja-n5-g012", "ja-n5-g042"):
            self.assertIn(identifier, selected)
        self.assertTrue(all(re.fullmatch(r"ja-n[1-5]-\d{5}-s\d{3}", identifier)
                            for identifier in self.references.vocabulary))

    def test_compact_and_embedded_introductions_reviews_are_identical(self):
        for path, expected in self.outputs.items():
            if path.name != "sequence.yaml":
                continue
            sequence = load_yaml(path)
            units = self.units if sequence.get("kind") == "program" else sequence["units"]
            expected_records = sum(
                len(unit[kind]) + len(unit[f"review_{kind}"])
                for unit in units for kind in ("vocabulary", "grammar")
            ) + sum(len(unit.get("phrases", [])) for unit in units)
            self.assertEqual(expected_records, len(re.findall(r"^\s*- \{id:", expected, re.MULTILINE)))
            for kind, keys, index in (
                ("vocabulary", {"id", "ch", "pr", "ds"}, self.references.vocabulary),
                ("grammar", {"id", "ch", "ds"}, self.references.grammar),
            ):
                compact_path = path.parent / f"{kind}.min.yaml"
                entries = load_yaml(compact_path)
                self.assertEqual(entries, [entry for unit in units for entry in unit[kind]])
                self.assertEqual(len(entries), sum(line.startswith("- {")
                                                  for line in self.outputs[compact_path].splitlines()))
                for unit in units:
                    for entry in unit[kind] + unit[f"review_{kind}"]:
                        self.assertEqual(set(entry), keys)
                        self.assertEqual(entry, index[entry["id"]])
                        self.assertLessEqual(len(entry["ds"]), 64)

    def test_optional_branches_close_using_only_their_declared_core_prefix(self):
        for definition in self.data.inputs["program"]["extensions"]:
            branch = load_yaml(ROOT / "teaching" / "extensions" / definition["id"] / "sequence.yaml")
            prior = [unit for level in self.levels if level["number"] <= definition["after_level"]
                     for unit in level["units"]]
            self.assertTrue(branch["units"])
            self.assertTrue(any(unit["review_grammar"] for unit in branch["units"]))
            self.assert_closure(prior + branch["units"])

    def test_explicit_core_and_branch_overlap_keeps_each_canonical_selection(self):
        placements = load_yaml(ROOT / "authoring" / "teaching" / "vocabulary.yaml")
        core = {row["id"] for row in placements if type(row["level"]) is int}
        branch_selections = {row["id"] for row in placements if type(row["level"]) is str}
        self.assertTrue(core & branch_selections)
        introduced_core = {entry["id"] for unit in self.units for entry in unit["vocabulary"]}
        self.assertTrue(core & branch_selections <= introduced_core)
        for definition in self.data.inputs["program"]["extensions"]:
            branch = load_yaml(ROOT / "teaching" / "extensions" / definition["id"] / "sequence.yaml")
            present = {entry["id"] for unit in branch["units"]
                       for entry in unit["vocabulary"] + unit["review_vocabulary"]}
            selected = {row["id"] for row in placements if row["level"] == definition["id"]}
            self.assertTrue(selected <= present)

    def test_compact_hints_disambiguate_common_english_homographs(self):
        for identifier, context in (
            ("ja-n5-00203-s001", "financial"),
            ("ja-n3-00364-s001", "shore"),
            ("ja-n3-00339-s001", "medical"),
            ("ja-n5-00510-s001", "season"),
            ("ja-n3-00075-s001", "water"),
            ("ja-n2-00740-s001", "sentence"),
        ):
            self.assertIn(context, self.references.vocabulary[identifier]["ds"])

    def test_inflection_examples_are_not_universal_tourist_lexical_prerequisites(self):
        illustrations = load_yaml(ROOT / "authoring" / "teaching" / "coverage.yaml")["core_illustrative_lexemes"]
        introduced_core = {entry["id"] for unit in self.units for entry in unit["vocabulary"]}
        for construction, examples in illustrations.items():
            self.assertEqual(self.anchors[construction], set())
            self.assertTrue(set(examples) <= introduced_core)
        route = load_yaml(ROOT / "teaching" / "tourist" / "sequence.yaml")
        contact_words = {entry["id"] for entry in route["units"][0]["vocabulary"]}
        self.assertFalse(contact_words & {"ja-n5-00369-s001", "ja-n5-00148-s001", "ja-n5-00322-s001"})

    def test_tourist_utterances_use_the_actual_contextual_senses_and_constructions(self):
        route = load_yaml(ROOT / "teaching" / "tourist" / "sequence.yaml")
        components = {identifier: value for unit in route["units"]
                      for identifier, value in unit["phrase_components"].items()}
        for phrase, correct, incorrect in (
            (7, "ja-n5-00467-s002", "ja-n5-00467-s001"),
            (10, "ja-n5-00039-s003", "ja-n5-00039-s001"),
            (19, "ja-n5-00133-s002", "ja-n5-00133-s001"),
            (27, "ja-n5-00467-s002", "ja-n5-00467-s001"),
            (32, "ja-n5-00652-s002", "ja-n5-00652-s001"),
            (35, "ja-n5-00385-s002", "ja-n5-00385-s001"),
        ):
            self.assertIn(correct, components[f"ja-tourist-p{phrase:03}"]["items"])
            self.assertNotIn(incorrect, components[f"ja-tourist-p{phrase:03}"]["items"])
        self.assertIn("ja-n4-g042", components["ja-tourist-p027"]["grammar"])
        self.assertNotIn("ja-n5-g027", components["ja-tourist-p027"]["grammar"])
        self.assertNotIn("ja-n5-g021", components["ja-tourist-p023"]["grammar"])

    def test_tourist_prefix_is_independent_and_every_phrase_reconstructs(self):
        route = load_yaml(ROOT / "teaching" / "tourist" / "sequence.yaml")
        quick = load_yaml(ROOT / "teaching" / "tourist" / "quick-start" / "sequence.yaml")
        self.assertEqual(len(route["units"]), 12)
        self.assertEqual(len(quick["units"]), 5)
        self.assertEqual(quick["units"], route["units"][:5])
        for sequence in (route, quick):
            self.assert_closure(sequence["units"])
            words, grammar = set(), set()
            for unit in sequence["units"]:
                words.update(entry["id"] for entry in unit["vocabulary"])
                grammar.update(entry["id"] for entry in unit["grammar"])
                self.assertTrue(unit["phrases"], unit["id"])
                for phrase in unit["phrases"]:
                    self.assertEqual(set(phrase), {"id", "ch", "pr", "ds"})
                    components = unit["phrase_components"][phrase["id"]]
                    self.assertTrue(set(components["items"]) <= words)
                    self.assertTrue(set(components["grammar"]) <= grammar)
                    segments = components["realizations"]
                    self.assertTrue(all(len(segment["items"]) <= 1 for segment in segments))
                    self.assertEqual(normalized_surface("".join(row["ch"] for row in segments)),
                                     normalized_surface(phrase["ch"]))
                    self.assertEqual(normalized_reading("".join(row["pr"] for row in segments)),
                                     normalized_reading(phrase["pr"]))


if __name__ == "__main__":
    unittest.main()
