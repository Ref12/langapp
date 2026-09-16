"""Real Spanish course coverage, compact equality and independent-route closure."""

from copy import deepcopy
import unittest

from curriculum_yaml import load_yaml
from generate_practical_program import program_outputs
from practical_program_types import PhraseContext
from spanish_program_adapter import ADAPTER
from spanish_sources import ROOT
from spanish_tourist import written


class SpanishProgramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = ADAPTER.load(ROOT)
        cls.outputs = program_outputs(ROOT, cls.data, ADAPTER)
        cls.program = load_yaml(ROOT / "teaching" / "core" / "sequence.yaml")
        cls.levels = [level for phase in cls.program["phases"] for level in phase["levels"]]
        cls.grammar = load_yaml(ROOT / "authoring" / "grammar.yaml")
        cls.route = load_yaml(ROOT / "teaching" / "tourist" / "sequence.yaml")
        cls.quick = load_yaml(ROOT / "teaching" / "tourist" / "quick-start" / "sequence.yaml")

    def test_all_views_reproduce_the_checked_in_teaching_product(self):
        for path, expected in self.outputs.items():
            self.assertEqual(path.read_text(encoding="utf-8"), expected, str(path.relative_to(ROOT)))

    def test_six_numbered_phases_contain_all_thirty_visible_levels(self):
        expected = [list(range(1, 5)), list(range(5, 9)), list(range(9, 14)),
                    list(range(14, 19)), list(range(19, 25)), list(range(25, 31))]
        self.assertEqual([[level["number"] for level in phase["levels"]]
                          for phase in self.program["phases"]], expected)
        self.assertFalse((ROOT / "teaching" / "levels").exists())
        for number, phase in enumerate(self.program["phases"], 1):
            directory = ROOT / "teaching" / "phases" / f"{number}-{phase['id']}"
            for level in phase["levels"]:
                self.assertTrue((directory / "levels" / f"{level['number']:02d}" / "sequence.yaml").is_file())
                self.assertTrue(2 <= len(level["goals"]) <= 4)
                self.assertTrue(level["checkpoint"]["task"])
                self.assertEqual(level["checkpoint"]["task"],
                                 self.data.inputs["program"]["levels"][level["number"] - 1]["checkpoint"])
                self.assertEqual(level["checkpoint"]["criteria"], level["goals"])
                self.assertTrue(any(unit["vocabulary"] for unit in level["units"]))

    def test_compact_and_embedded_introductions_and_reviews_are_identical(self):
        for path, content in self.outputs.items():
            if path.name != "sequence.yaml":
                continue
            sequence = load_yaml(path)
            units = ([unit for phase in sequence["phases"] for level in phase["levels"] for unit in level["units"]]
                     if sequence.get("kind") == "program" else sequence["units"])
            for kind, index, fields in (
                ("vocabulary", self.data.references.vocabulary, {"id", "ch", "pr", "ds"}),
                ("grammar", self.data.references.grammar, {"id", "ch", "ds"}),
            ):
                compact_path = path.parent / f"{kind}.min.yaml"
                compact = load_yaml(compact_path)
                self.assertEqual(compact, [item for unit in units for item in unit[kind]])
                self.assertEqual(len(compact), sum(line.startswith("- {")
                                                   for line in compact_path.read_text(encoding="utf-8").splitlines()))
                for unit in units:
                    for entry in unit[kind] + unit[f"review_{kind}"]:
                        self.assertEqual(set(entry), fields)
                        self.assertEqual(entry, index[entry["id"]])
                        self.assertLessEqual(len(entry["ds"]), 64)

    def assert_closure(self, units, prior_words=(), prior_patterns=()):
        words, patterns = set(prior_words), set(prior_patterns)
        dependencies = self.data.construction_dependencies
        anchors = {row["id"]: row["anchors"] for row in self.data.inputs["grammar"]}
        for unit in units:
            self.assertTrue({row["id"] for row in unit["review_vocabulary"]} <= words)
            self.assertTrue({row["id"] for row in unit["review_grammar"]} <= patterns)
            words.update(row["id"] for row in unit["vocabulary"])
            local_grammar = {row["id"] for row in unit["grammar"]}
            for identifier in local_grammar:
                self.assertTrue(set(anchors[identifier]) <= words)
                self.assertTrue(set(dependencies.get(identifier, ())) <= patterns | local_grammar)
            patterns.update(local_grammar)
        return words, patterns

    def test_core_prerequisites_and_review_order_close(self):
        self.assert_closure([unit for level in self.levels for unit in level["units"]])

    def test_independent_branches_require_only_declared_core_material(self):
        for branch in self.data.inputs["program"]["extensions"]:
            sequence = load_yaml(ROOT / "teaching" / "extensions" / branch["id"] / "sequence.yaml")
            prior = [unit for level in self.levels if level["number"] <= branch["after_level"]
                     for unit in level["units"]]
            words, patterns = self.assert_closure(prior)
            self.assert_closure(sequence["units"], words, patterns)
            self.assertTrue(any(unit["vocabulary"] for unit in sequence["units"]))
            self.assertGreaterEqual(len(sequence["units"]), 2)

    def test_quick_start_stands_alone_with_original_phrases(self):
        self.assertEqual(len(self.route["units"]), 12)
        self.assertEqual(len(self.quick["units"]), 5)
        self.assertEqual(self.quick["units"], self.route["units"][:5])
        self.assertEqual(sum(len(unit["phrases"]) for unit in self.route["units"]), 60)
        self.assertEqual(sum(len(unit["phrases"]) for unit in self.quick["units"]), 25)
        self.assert_closure(self.quick["units"])
        self.assert_closure(self.route["units"])
        for unit in self.route["units"]:
            for phrase in unit["phrases"]:
                self.assertEqual(set(phrase), {"id", "ch", "pr", "ds"})
                self.assertTrue(phrase["id"].startswith("es-tourist-p"))

    def test_noncanonical_forms_are_licensed_and_not_new_lemmas(self):
        authored_route = self.data.inputs["tourist"]
        context = PhraseContext(
            profile=ADAPTER.profile, references=self.data.references,
            introduced_vocabulary=frozenset(self.data.references.vocabulary),
            introduced_grammar=frozenset(self.data.references.grammar),
        )
        seen = set()
        for unit in authored_route["units"]:
            for phrase in unit["phrases"]:
                analysis = ADAPTER.validate_phrase(phrase, context)
                self.assertEqual(written(phrase["ch"]), written(" ".join(segment.ch for segment in analysis.realizations)))
                self.assertEqual(phrase["pr"], " ".join(segment.pr for segment in analysis.realizations))
                seen.update(segment.form_id for segment in analysis.realizations)
        for key in ("entiendo", "quiero", "puedo", "hay", "al", "escribirlo", "ayudarme", "perdido"):
            self.assertIn("es-realization-" + key, seen)
        headwords = {row["ch"] for row in self.data.references.vocabulary.values()}
        self.assertFalse({"quiero", "puedo", "entiendo", "escribirlo", "ayudarme"} & headwords)

    def test_altered_forms_readings_and_component_links_are_rejected(self):
        context = PhraseContext(
            profile=ADAPTER.profile, references=self.data.references,
            introduced_vocabulary=frozenset(self.data.references.vocabulary),
            introduced_grammar=frozenset(self.data.references.grammar),
        )
        phrase = self.data.inputs["tourist"]["units"][1]["phrases"][0]
        for field, value in (("ch", "invented"), ("pr", "/wrong/"),
                             ("form_id", "es-realization-missing"), ("items", [])):
            changed = deepcopy(phrase)
            changed["realizations"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                ADAPTER.validate_phrase(changed, context)

    def test_grammar_examples_and_modality_boundaries_are_real(self):
        for row in self.grammar:
            self.assertGreaterEqual(len(row["examples"]), 2)
            self.assertNotEqual(row["examples"][0]["target"], row["examples"][1]["target"])
            self.assertTrue(row["note"])
            self.assertLessEqual(len(row["ds"]), 64)
            for example in row["examples"]:
                self.assertTrue(example["target"])
                self.assertTrue(example["english"])
        stages = self.data.inputs["mastery"]["stages"]
        self.assertEqual([stage["id"] for stage in stages],
                         ["recognize", "understand", "supported-use", "independent-use"])
        self.assertTrue(all(stage["modalities"] == ["reading", "listening"] for stage in stages[:2]))
        self.assertTrue(all("reading" not in stage["modalities"] for stage in stages[2:]))

    def test_inventory_counts_lexical_breadth_separately(self):
        report = load_yaml(ROOT / "teaching" / "inventory.yaml")
        words = {entry["id"] for level in self.levels for unit in level["units"] for entry in unit["vocabulary"]}
        self.assertEqual(report["core"]["headwords"],
                         len({self.data.references.lexical_identity[word] for word in words}))
        self.assertEqual(report["core"]["vocabulary_senses"], len(words))
        self.assertGreater(len(words), report["core"]["headwords"])
        self.assertGreater(report["phases"][-1]["new_headwords"], report["phases"][0]["new_headwords"])
        self.assertNotIn("observations", report)
        self.assertNotIn("mastery", report)


if __name__ == "__main__":
    unittest.main()
