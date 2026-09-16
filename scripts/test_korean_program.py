"""Strict Korean adapter and checked-in curriculum regressions."""

from collections import Counter
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import yaml

from curriculum_yaml import load_yaml
from generate_practical_program import (
    analyze_phrase, generate, program_outputs, tourist_outputs,
    validate_dependencies, validate_model, validate_references,
)
from korean_program_adapter import (
    CORRECTION_REVIEW_STATUS, KoreanAdapter, citation_reading, inventory_counts,
    lexical_members, load_selections, phase_inventory, sense_index, source_corrections,
)
from practical_program_types import PhraseContext, ReferenceBundle


class KoreanSelectionFilesTests(unittest.TestCase):
    def setUp(self):
        self.authoring = Path("korean-selection-fixture")
        self.base = [{"id": "s1", "level": 2, "topic": "actions", "ds": "write"}]
        self.extra = [{"id": "s2", "level": 9, "topic": "communication", "ds": "compose"}]
        self.files = {
            "selection-files.yaml": {
                "schema_version": 1,
                "vocabulary": ["vocabulary.yaml", "extra-vocabulary.yaml"],
                "lexical_identities": ["lexical-identities.yaml", "extra-identities.yaml"],
            },
            "extra-vocabulary.yaml": self.extra,
            "lexical-identities.yaml": {"write": {
                "lemma": "쓰다", "category": "free-lemma", "members": ["s1"],
                "source_parents": ["p1"], "rationale": "Initial written-production sense.",
            }},
            "extra-identities.yaml": {"write": {
                "lemma": "쓰다", "category": "free-lemma", "members": ["s2"],
                "source_parents": ["p1"], "rationale": "Composition sense of the same predicate.",
            }},
        }

    def load(self):
        def read(path):
            if path.name not in self.files:
                raise FileNotFoundError(path)
            return self.files[path.name]
        with patch("korean_program_adapter.load_yaml", side_effect=read):
            return load_selections(self.authoring, self.base)

    def test_ordered_fragments_preserve_one_identity_and_do_not_mutate_sources(self):
        original = deepcopy(self.files)
        self.files["unregistered-vocabulary.yaml"] = [{"id": "must-not-load"}]
        placements, groups = self.load()
        self.assertEqual(placements, self.base + self.extra)
        self.assertEqual(groups["write"]["members"], ["s1", "s2"])
        self.assertEqual(groups["write"]["source_parents"], ["p1"])
        self.assertIn("Initial written-production", groups["write"]["rationale"])
        self.assertIn("Composition sense", groups["write"]["rationale"])
        for name, content in original.items():
            self.assertEqual(self.files[name], content)
        senses = {item: ({"id": "p1"}, {}) for item in ("s1", "s2")}
        identities, categories = lexical_members(groups, {row["id"]: row for row in placements}, senses)
        self.assertEqual(identities, {"s1": "write", "s2": "write"})
        self.assertEqual(categories, {"write": "free-lemma"})

    def test_fragment_cannot_reclassify_or_repeat_an_existing_identity_member(self):
        for field, value, message in (
            ("lemma", "쓰이다", "conflicting lexical identity"),
            ("category", "function-item", "conflicting lexical identity"),
            ("members", ["s1"], "duplicate sense members"),
            ("source_parents", "p1", "expected distinct source_parents"),
            ("category", [], "invalid lexical count category"),
        ):
            with self.subTest(field=field):
                fragment = self.files["extra-identities.yaml"]["write"]
                original = fragment[field]
                fragment[field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.load()
                fragment[field] = original

    def test_manifest_rejects_implicit_replacement_escaping_paths_and_repeated_files(self):
        manifest = self.files["selection-files.yaml"]
        for names in (
            [], ["extra-vocabulary.yaml"], ["vocabulary.yaml", "vocabulary.yaml"],
            ["vocabulary.yaml", "../outside.yaml"], ["vocabulary.yaml", r"C:\outside.yaml"],
            ["vocabulary.yaml", "nested/extra.yaml"], ["vocabulary.yaml", None],
        ):
            with self.subTest(names=names):
                manifest["vocabulary"] = names
                with self.assertRaisesRegex(ValueError, "distinct local selection files"):
                    self.load()

    def test_declared_missing_files_fail_instead_of_becoming_an_empty_selection(self):
        del self.files["extra-vocabulary.yaml"]
        with self.assertRaises(FileNotFoundError):
            self.load()

    def test_route_placements_are_not_deduplicated_by_the_korean_loader(self):
        self.extra[:] = [{**self.base[0], "level": "literary"}]
        self.files["extra-identities.yaml"] = {}
        placements, groups = self.load()
        self.assertEqual([row["level"] for row in placements], [2, "literary"])
        self.assertEqual(groups["write"]["members"], ["s1"])

    def test_manifest_schema_and_collection_types_are_explicit(self):
        original = deepcopy(self.files)
        for filename, content in (
            ("selection-files.yaml", {**original["selection-files.yaml"], "schema_version": True}),
            ("selection-files.yaml", {**original["selection-files.yaml"], "unexpected": []}),
            ("extra-vocabulary.yaml", {}),
            ("extra-identities.yaml", []),
        ):
            with self.subTest(filename=filename, content=content):
                self.files = deepcopy(original)
                self.files[filename] = content
                with self.assertRaises(ValueError):
                    self.load()


class KoreanAdapterTests(unittest.TestCase):
    def setUp(self):
        self.identifier = "ko-nikl-11667-s001"
        self.grammar = "ko-topik1-g016"
        self.word = {"id": self.identifier, "ch": "읽다", "pr": "익따", "ds": "read aloud"}
        self.pattern = {"id": self.grammar, "ch": "V-어요", "ds": "polite predicate"}
        self.references = ReferenceBundle(
            {self.identifier: self.word}, {self.grammar: self.pattern},
            {self.identifier: "ko-lex-read"},
        )
        self.adapter = KoreanAdapter()
        self.form = {
            "ch": "읽어요", "pr": "일거요",
            "items": [self.identifier], "grammar": [self.grammar],
            "rationale": "The vowel ending follows the stem; the final cluster splits across the syllables.",
            "review_status": "unreviewed",
        }
        self.adapter.forms = {"read-polite": self.form}
        self.phrase = {
            "id": "ko-tourist-p001", "ch": "읽어요.", "pr": "일거요", "ds": "Read it.",
            "items": [self.identifier], "grammar": [self.grammar],
            "realizations": [{key: value for key, value in self.form.items()
                              if key in {"ch", "pr", "items", "grammar"}} | {"form_id": "read-polite"}],
        }
        self.context = PhraseContext(
            self.adapter.profile, self.references, frozenset({self.identifier}),
            frozenset({self.grammar}),
        )

    def test_reading_never_defaults_to_spelling(self):
        with self.assertRaisesRegex(ValueError, "no supported"):
            citation_reading("missing", {"entries": {}}, {})

    def test_official_alternatives_and_length_are_preserved(self):
        overlay = {"source_id": "official", "entries": {
            "parent": {"pronunciations": ["눈ː", "눈"], "method": "official-text"},
        }}
        reading, evidence = citation_reading("parent", overlay, {})
        self.assertEqual(reading, "눈ː / 눈")
        self.assertEqual(evidence["method"], "official-text")
        with self.assertRaisesRegex(ValueError, "conflicts"):
            citation_reading("parent", overlay, {"parent": {}})

    def test_official_display_whitespace_is_normalized_without_losing_raw_evidence(self):
        overlay = {"source_id": "official", "entries": {
            "baseball": {"pronunciations": ["야ː구 "], "method": "official-text"},
        }}
        reading, evidence = citation_reading("baseball", overlay, {})
        self.assertEqual(reading, "야ː구")
        self.assertEqual(evidence["pronunciations"], ["야ː구 "])
        self.assertEqual(evidence["display_pronunciations"], ["야ː구"])
        self.assertEqual(evidence["display_normalization"], "trim-surrounding-whitespace-only")
        self.assertEqual(overlay["entries"]["baseball"]["pronunciations"], ["야ː구 "])

    def test_authored_reading_needs_explicit_method_rationale_and_status(self):
        decision = {
            "pronunciations": ["택씨"], "method": "authored-broad-hangul",
            "reason": "Final stop followed by tensed sibilant.", "review_status": "unreviewed",
        }
        reading, evidence = citation_reading("taxi", {"entries": {}}, {"taxi": decision})
        self.assertEqual(reading, "택씨")
        self.assertEqual(evidence["review_status"], "unreviewed")
        for field, value in (
            ("method", "dictionary-verified"), ("reason", ""),
            ("review_status", "verified"), ("pronunciations", ["taeksi"]),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                citation_reading("taxi", {"entries": {}}, {"taxi": {**decision, field: value}})

    def test_inflected_realization_has_precise_form_and_construction_evidence(self):
        analysis = self.adapter.validate_phrase(self.phrase, self.context)
        self.assertEqual(analysis.items, (self.identifier,))
        self.assertEqual(analysis.grammar, (self.grammar,))
        self.assertEqual(analysis.realizations[0].pr, "일거요")
        self.assertEqual(analysis.realizations[0].form_id, "read-polite")

    def test_wrong_surface_reading_or_links_cannot_reuse_form_license(self):
        for key, value in (
            ("ch", "먹어요"), ("pr", "익따"), ("items", []), ("grammar", []),
            ("form_id", "unknown"),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                phrase = deepcopy(self.phrase)
                phrase["realizations"][0][key] = value
                self.adapter.validate_phrase(phrase, self.context)

    def test_sentence_wide_form_cannot_hide_unknown_vocabulary(self):
        self.form["ch"] = "모르는 문장을 읽어요"
        self.phrase["ch"] = self.form["ch"]
        self.phrase["realizations"][0]["ch"] = self.form["ch"]
        with self.assertRaisesRegex(ValueError, "one orthographic word"):
            self.adapter.validate_phrase(self.phrase, self.context)

    def test_korean_spacing_is_not_erased_by_generic_surface_normalization(self):
        self.phrase["ch"] = "읽어 요."
        with self.assertRaisesRegex(ValueError, "spacing"):
            self.adapter.validate_phrase(self.phrase, self.context)

    def test_unannotated_spelling_change_is_not_a_canonical_segment(self):
        self.phrase["realizations"][0].pop("form_id")
        with self.assertRaisesRegex(ValueError, "noncanonical"):
            self.adapter.validate_phrase(self.phrase, self.context)

    def test_polysemy_counts_once_and_bound_forms_are_separate(self):
        first, second, bound = "s1", "s2", "s3"
        parent = {"id": "p1", "target": "쓰다", "part_of_speech": "verb", "source_band": "beginner"}
        parent2 = {"id": "p2", "target": "것", "part_of_speech": "bound noun", "source_band": "beginner"}
        senses = {first: (parent, {}), second: (parent, {}), bound: (parent2, {})}
        words = {
            first: {"ch": "쓰다"}, second: {"ch": "쓰다"}, bound: {"ch": "것"},
        }
        groups = {
            "write": {"lemma": "쓰다", "category": "free-lemma", "members": [first, second],
                      "source_parents": ["p1"], "rationale": "Two senses of the same writing lexeme."},
            "thing": {"lemma": "것", "category": "bound-form", "members": [bound],
                      "source_parents": ["p2"], "rationale": "Dependent noun, counted separately."},
        }
        identities, categories = lexical_members(groups, words, senses)
        provenance = {item: {"reading": {"method": "official-text"}} for item in words}
        references = ReferenceBundle(words, {}, identities, provenance)
        counts = inventory_counts(set(words), references, categories, senses)
        self.assertEqual(counts["selected_senses"], 3)
        self.assertEqual(counts["dictionary_entries"], 2)
        self.assertEqual(counts["free_lemmas"], 1)
        self.assertEqual(counts["bound_forms"], 1)
        self.assertEqual(counts["distinct_spellings"], 2)
        phases = phase_inventory(
            [{"id": "first", "levels": [1]}, {"id": "second", "levels": [2]}],
            [{"id": first, "level": 1}, {"id": second, "level": 2}, {"id": bound, "level": 2}],
            references, categories, senses,
        )
        self.assertEqual([phase["new_free_lemmas"] for phase in phases], [1, 0])
        self.assertEqual([phase["free_lemmas"] for phase in phases], [1, 1])
        self.assertEqual(phases[1]["bound_forms"], 1)
        groups["write"]["members"].remove(second)
        with self.assertRaisesRegex(ValueError, "Missing lexical identities"):
            lexical_members(groups, words, senses)

    def test_authored_corrections_preserve_bilingual_source_and_selected_label(self):
        source = {"english": "a physical spring", "korean": "힘이나 기운이 솟아나게 하는 원천"}
        correction = {
            "source_english": source["english"], "source_korean": source["korean"],
            "authored_interpretation": "a source of strength",
            "rationale": "The Korean definition is figurative, unlike the repeated English wording.",
        }
        ledger = {
            "schema_version": 1, "review_status": CORRECTION_REVIEW_STATUS,
            "policy": "Preserve source text and document authored interpretations separately.",
            "corrections": {"s1": correction},
        }
        senses, labels = {"s1": ({}, source)}, {"s1": correction["authored_interpretation"]}
        resolved = source_corrections(ledger, senses, labels)
        self.assertEqual(resolved["s1"]["review_status"], "unreviewed")
        self.assertEqual(source["english"], "a physical spring")
        with self.assertRaisesRegex(ValueError, "selected label"):
            source_corrections(ledger, senses, {"s1": "a physical spring"})
        invalid = deepcopy(ledger)
        invalid["corrections"]["s1"]["source_korean"] = "a different source meaning"
        with self.assertRaisesRegex(ValueError, "preserved source korean"):
            source_corrections(invalid, senses, labels)
        invalid = deepcopy(ledger)
        invalid["review_status"] = "dictionary-verified"
        with self.assertRaisesRegex(ValueError, "falsely verified"):
            source_corrections(invalid, senses, labels)


class KoreanSourceArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
        cls.registry = load_yaml(cls.root / "source-senses.yaml")
        cls.parents, cls.senses = sense_index(cls.registry)
        cls.readings = load_yaml(cls.root / "reading-overlay.yaml")

    def test_all_banded_positions_preserve_original_parent_metadata(self):
        banded = [row for row in self.parents.values() if row["source_band"] != "unbanded"]
        self.assertEqual(len(banded), 11028)
        self.assertEqual(sum(len(parent["senses"]) for parent in banded), 19661)
        for number in range(1, 7):
            for reference in load_yaml(self.root / f"topik-{number}" / "vocabulary.yaml"):
                parent = self.parents[reference["id"]]
                self.assertEqual(reference["target"], parent["target"])
                self.assertEqual(reference["part_of_speech"], parent["part_of_speech"])
                self.assertEqual(reference["source_entry"], parent["source_entry"])
                self.assertEqual(reference["reading"], "")
                self.assertEqual(parent["reference_level"], f"topik-{number}")

    def test_duplicate_english_source_positions_are_not_merged(self):
        for parent_id, positions in (
            ("ko-nikl-07948", (1, 2)), ("ko-nikl-09462", (1, 2)),
            ("ko-nikl-26461", (1, 2)), ("ko-nikl-34299", (2, 5)),
        ):
            with self.subTest(parent=parent_id):
                entries = [self.senses[f"{parent_id}-s{number:03d}"][1] for number in positions]
                self.assertEqual(entries[0]["english"], entries[1]["english"])
                self.assertNotEqual(entries[0]["korean"], entries[1]["korean"])

    def test_figurative_spring_correction_matches_the_actual_pinned_definition(self):
        ledger = load_yaml(self.root / "authoring" / "teaching" / "source-corrections.yaml")
        labels = {"ko-nikl-09462-s003": "a source of strength or vitality (figurative)"}
        result = source_corrections(ledger, self.senses, labels)
        self.assertEqual(result["ko-nikl-09462-s003"]["authored_interpretation"], labels["ko-nikl-09462-s003"])
        self.assertEqual(result["ko-nikl-09462-s003"]["method"], "authored-interpretation")

    def test_essential_support_is_explicitly_unbanded(self):
        for identifier in load_yaml(self.root / "authoring" / "teaching" / "support-parents.yaml"):
            self.assertEqual(self.parents[identifier]["source_band"], "unbanded")
            self.assertIsNone(self.parents[identifier]["reference_level"])
        self.assertNotIn("ko-nikl-26498", self.parents)

    def test_actual_official_sound_changes_and_homographs_survive(self):
        for parent, reading in (
            ("ko-nikl-11667", "익따"), ("ko-nikl-46845", "업ː따"),
            ("ko-nikl-15420", "눈"), ("ko-nikl-15508", "눈ː"),
            ("ko-nikl-36444", "마싣따"), ("ko-nikl-39509", "방물관"),
        ):
            with self.subTest(parent=parent):
                self.assertIn(reading, self.readings["entries"][parent]["pronunciations"])
        self.assertEqual(self.readings["entries"]["ko-nikl-20539"]["pronunciations"], [])
        self.assertEqual(self.readings["entries"]["ko-nikl-41632"]["match_method"], "explicit-crosswalk")


class KoreanGrammarArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
        authoring = cls.root / "authoring" / "teaching"
        cls.program = load_yaml(cls.root / "teaching" / "program.yaml")
        cls.mastery = load_yaml(cls.root / "teaching" / "mastery.yaml")
        cls.grammar = {row["id"]: row for row in load_yaml(authoring / "grammar.yaml")}
        cls.dependencies = load_yaml(authoring / "construction-dependencies.yaml")
        cls.extra = load_yaml(authoring / "grammar-extra.yaml")

    def test_thirty_goal_driven_levels_have_exact_six_phase_partition(self):
        validate_model(self.program, self.mastery, KoreanAdapter.profile)
        self.assertEqual(
            [phase["levels"] for phase in self.program["phases"]],
            [list(range(start, end + 1)) for start, end in
             ((1, 4), (5, 8), (9, 13), (14, 18), (19, 24), (25, 30))],
        )
        self.assertEqual([level["number"] for level in self.program["levels"]], list(range(1, 31)))
        self.assertTrue(all(2 <= len(level["goals"]) <= 4 for level in self.program["levels"]))
        self.assertEqual(
            {branch["id"]: branch["after_level"] for branch in self.program["extensions"]},
            {"professional": 18, "technical": 18, "scientific": 24, "literary": 24},
        )

    def test_receptive_and_productive_evidence_remain_distinct(self):
        stages = {stage["id"]: set(stage["modalities"]) for stage in self.mastery["stages"]}
        self.assertEqual(stages["recognize"], {"reading", "listening"})
        self.assertEqual(stages["understand"], {"reading", "listening"})
        productive = {"typed-production", "spoken-production", "handwriting"}
        self.assertEqual(stages["supported-use"], productive)
        self.assertEqual(stages["independent-use"], productive)
        self.assertTrue(
            {"item_id", "modality", "assistance", "observed_at", "context", "outcome"}
            <= set(self.mastery["evidence_fields"])
        )
        self.assertNotIn("learner_progress", self.mastery)

    def test_every_original_construction_has_an_explicit_non_exam_classification(self):
        originals = {
            row["id"]
            for number in range(1, 7)
            for row in load_yaml(self.root / f"topik-{number}" / "grammar.yaml")
        }
        notes = (self.root / "teaching" / "grammar-notes.md").read_text(encoding="utf-8")
        rows = re.findall(
            r"\| (ko-topik[1-6]-g\d{3}) \| (selected core|optional|reference variant) \| ([^|]+) \|",
            notes,
        )
        self.assertEqual(len(rows), len(originals))
        self.assertEqual({row[0] for row in rows}, originals)
        for identifier, classification, placement in rows:
            with self.subTest(construction=identifier):
                if classification == "reference variant":
                    self.assertNotIn(identifier, self.grammar)
                else:
                    self.assertEqual(str(self.grammar[identifier]["level"]), placement.strip())
                    self.assertEqual(type(self.grammar[identifier]["level"]) is int,
                                     classification == "selected core")
        self.assertEqual({row["id"] for row in self.extra},
                         {f"ko-teaching-g{number:03d}" for number in range(1, 10)})
        for row in self.extra:
            self.assertEqual(row["source_id"], "original-ko")
            self.assertGreaterEqual(len(row["examples"]), 2)
            self.assertTrue(all(set(example) == {"target", "english"} for example in row["examples"]))
        validate_dependencies(self.dependencies, self.grammar)
        self.assertEqual(set(self.dependencies), set(self.grammar))
        for identifier, required in self.dependencies.items():
            destination = self.grammar[identifier]["level"]
            if type(destination) is int:
                for dependency in required:
                    self.assertIs(type(self.grammar[dependency]["level"]), int)
                    self.assertLessEqual(self.grammar[dependency]["level"], destination)


class KoreanCourseArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
        cls.adapter = KoreanAdapter()
        cls.data = cls.adapter.load(cls.root)
        cls.references = cls.data.references
        cls.outputs = program_outputs(cls.root, cls.data, cls.adapter)
        cls.core = yaml.safe_load(cls.outputs[cls.root / "teaching" / "core" / "sequence.yaml"])

    def route_directories(self):
        teaching = self.root / "teaching"
        result = {}
        core_units = []
        for number, phase in enumerate(self.core["phases"], 1):
            directory = teaching / "phases" / f"{number}-{phase['id']}"
            phase_units = []
            for level in phase["levels"]:
                result[directory / "levels" / f"{level['number']:02d}"] = level["units"]
                phase_units.extend(level["units"])
            result[directory] = phase_units
            core_units.extend(phase_units)
        result[teaching / "core"] = core_units
        for path, content in self.outputs.items():
            if path.name == "sequence.yaml":
                sequence = yaml.safe_load(content)
                if sequence["kind"] in {"extension", "route"}:
                    result[path.parent] = sequence["units"]
        return result

    def assert_route_closes(self, units):
        words, grammar = set(), set()
        anchors = {row["id"]: set(row["anchors"]) for row in self.data.inputs["grammar"]}
        for unit in units:
            with self.subTest(module=unit["id"]):
                self.assertLessEqual(len(unit["vocabulary"]), 25)
                self.assertLessEqual(len(unit["grammar"]), 3)
                for field, canonical, seen in (
                    ("vocabulary", self.references.vocabulary, words),
                    ("grammar", self.references.grammar, grammar),
                ):
                    introduced = {row["id"] for row in unit[field]}
                    self.assertFalse(introduced & seen)
                    self.assertTrue({row["id"] for row in unit[f"review_{field}"]} <= seen)
                    for row in unit[field] + unit[f"review_{field}"]:
                        self.assertEqual(row, canonical[row["id"]])
                words.update(row["id"] for row in unit["vocabulary"])
                grammar.update(row["id"] for row in unit["grammar"])
                for construction in unit["grammar"]:
                    identifier = construction["id"]
                    self.assertTrue(anchors[identifier] <= words)
                    self.assertTrue(set(self.data.construction_dependencies.get(identifier, ())) <= grammar)

    def test_full_program_has_thirty_nested_levels_and_unchanged_phase_partition(self):
        expected = [list(range(start, stop + 1)) for start, stop in (
            (1, 4), (5, 8), (9, 13), (14, 18), (19, 24), (25, 30),
        )]
        self.assertEqual([[level["number"] for level in phase["levels"]]
                          for phase in self.core["phases"]], expected)
        definitions = {row["number"]: row for row in self.data.inputs["program"]["levels"]}
        for phase_number, phase in enumerate(self.core["phases"], 1):
            for level in phase["levels"]:
                number = level["number"]
                path = (self.root / "teaching" / "phases" / f"{phase_number}-{phase['id']}"
                        / "levels" / f"{number:02d}" / "sequence.yaml")
                with self.subTest(level=number):
                    self.assertEqual(yaml.safe_load(self.outputs[path]), level)
                    self.assertEqual(level["goals"], definitions[number]["goals"])
                    self.assertEqual(level["checkpoint"]["criteria"], level["goals"])
                    self.assertTrue(level["checkpoint"]["task"])
                    self.assertTrue(any(unit["vocabulary"] for unit in level["units"]))
                    self.assertEqual(level["prerequisites"],
                                     [f"ko-level-{prior:02d}" for prior in range(1, number)])
        self.assertFalse((self.root / "teaching" / "levels").exists())

    def test_actual_core_branch_and_independent_tourist_routes_close_in_emitted_order(self):
        levels = [level for phase in self.core["phases"] for level in phase["levels"]]
        self.assert_route_closes([unit for level in levels for unit in level["units"]])
        for definition in self.data.inputs["program"]["extensions"]:
            path = self.root / "teaching" / "extensions" / definition["id"] / "sequence.yaml"
            extension = yaml.safe_load(self.outputs[path])
            with self.subTest(branch=definition["id"]):
                self.assertEqual(extension["prerequisites"], [
                    f"ko-level-{number:02d}" for number in range(1, definition["after_level"] + 1)
                ])
                self.assertTrue(extension["units"])
                inherited = [unit for level in levels if level["number"] <= definition["after_level"]
                             for unit in level["units"]]
                self.assert_route_closes(inherited + extension["units"])
        for relative in (Path("tourist"), Path("tourist") / "quick-start"):
            sequence = yaml.safe_load(self.outputs[self.root / "teaching" / relative / "sequence.yaml"])
            self.assertEqual(sequence["kind"], "route")
            self.assertNotIn("prerequisites", sequence)
            self.assert_route_closes(sequence["units"])

    def test_all_compact_views_equal_full_canonical_introductions(self):
        directories = self.route_directories()
        self.assertEqual(len(directories), 43)
        for directory, units in directories.items():
            sequence = directory / "sequence.yaml"
            if sequence in self.outputs:
                expected_records = sum(
                    len(unit.get(field, [])) for unit in units
                    for field in ("vocabulary", "grammar", "review_vocabulary", "review_grammar",
                                  "phrases", "review_phrases")
                )
                with self.subTest(sequence=sequence):
                    self.assertEqual(sum(line.lstrip().startswith("- {id:")
                                         for line in self.outputs[sequence].splitlines()), expected_records)
            for kind in ("vocabulary", "grammar", "phrases"):
                path = directory / f"{kind}.min.yaml"
                if kind == "phrases" and path not in self.outputs:
                    continue
                fields = ("id", "ch", "ds") if kind == "grammar" else ("id", "ch", "pr", "ds")
                expected = [{key: row[key] for key in fields}
                            for unit in units for row in unit.get(kind, [])]
                content = self.outputs[path]
                with self.subTest(path=path):
                    self.assertEqual(yaml.safe_load(content), expected)
                    self.assertEqual(sum(line.startswith("- {id:") for line in content.splitlines()),
                                     len(expected))

    def test_all_checked_in_views_match_actual_generation(self):
        for path, expected in self.outputs.items():
            with self.subTest(path=path):
                self.assertEqual(path.read_text(encoding="utf-8"), expected)

    def test_real_data_generation_is_deterministic_and_check_never_repairs_stale_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "korean"
            data = replace(self.data, source_outputs={
                root / path.relative_to(self.root): content
                for path, content in self.data.source_outputs.items()
            })
            before = deepcopy(data)
            with patch.object(self.adapter, "load", return_value=data):
                first = generate(root, self.adapter)
                original = {path: path.read_bytes() for path in first}
                self.assertEqual(first, generate(root, self.adapter))
                generate(root, self.adapter, check=True)
                self.assertEqual(original, {path: path.read_bytes() for path in first})
                self.assertEqual(data, before)
                stale = root / "teaching" / "source-provenance.yaml"
                stale.write_text("stale\n", encoding="utf-8")
                expected = {path: path.read_bytes() for path in first}
                with self.assertRaisesRegex(ValueError, "stale program view"):
                    generate(root, self.adapter, check=True)
                self.assertEqual(expected, {path: path.read_bytes() for path in first})

    def test_late_invalid_real_tourist_form_writes_no_partial_program(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "korean"
            inputs = deepcopy(self.data.inputs)
            inputs["tourist"]["units"][-1]["phrases"][-1]["realizations"][-1]["form_id"] = "unknown-test-form"
            data = replace(self.data, inputs=inputs, source_outputs={
                root / path.relative_to(self.root): content
                for path, content in self.data.source_outputs.items()
            })
            with patch.object(self.adapter, "load", return_value=data), self.assertRaises(ValueError):
                generate(root, self.adapter)
            self.assertFalse(root.exists())

    def test_all_selected_canonical_records_have_explicit_source_and_reading_evidence(self):
        validate_references(self.references, self.adapter.profile)
        selected = {row["id"] for row in self.data.inputs["vocabulary"]} | set(self.data.inputs["support"])
        self.assertEqual(set(self.references.vocabulary), selected)
        for identifier, record in self.references.vocabulary.items():
            with self.subTest(sense=identifier):
                self.assertEqual(set(record), {"id", "ch", "pr", "ds"})
                evidence = self.references.provenance[identifier]
                self.assertEqual(identifier, f"{evidence['source_parent']}-s{evidence['source_position']:03d}")
                self.assertTrue(evidence["source_english"] and evidence["source_korean"])
                self.assertIn(evidence["reading"]["method"], {"official-text", "authored-broad-hangul"})
                if evidence["reading"]["method"] == "authored-broad-hangul":
                    self.assertEqual(evidence["reading"]["review_status"], "unreviewed")
                self.assertLessEqual(len(record["ds"]), 64)
        for record in self.references.grammar.values():
            self.assertEqual(set(record), {"id", "ch", "ds"})

    def test_selected_homographs_and_practical_senses_remain_distinct(self):
        identities = self.references.lexical_identity
        words = self.references.vocabulary
        write, wear, use, bitter = (
            "ko-nikl-03918-s001", "ko-nikl-03919-s001",
            "ko-nikl-03920-s001", "ko-nikl-03921-s001",
        )
        self.assertEqual({words[item]["ch"] for item in (write, wear, use, bitter)}, {"쓰다"})
        self.assertEqual(len({identities[item] for item in (write, wear, use, bitter)}), 4)
        self.assertEqual(identities[write], identities["ko-nikl-03918-s003"])
        self.assertNotEqual(identities["ko-nikl-15420-s001"], identities["ko-nikl-15508-s001"])
        self.assertIn("payment", words["ko-nikl-20539-s006"]["ds"])
        self.assertIn("yes", words["ko-nikl-35345-s002"]["ds"])
        self.assertIn("grateful", words["ko-nikl-26499-s001"]["ds"])
        self.assertNotIn("ko-nikl-26498-s001", words)

    def test_essential_predicates_and_ordinal_cha_use_real_unbanded_sources(self):
        for parent, spelling in (
            ("02914", "시작하다"), ("06699", "부탁하다"), ("08289", "사랑하다"),
            ("11654", "일하다"), ("16978", "대답하다"), ("23542", "피곤하다"),
            ("23722", "필요하다"), ("24830", "행복하다"), ("29792", "공부하다"),
            ("38953", "미안하다"), ("41722", "주문하다"), ("43838", "차"),
        ):
            identifier = f"ko-nikl-{parent}-s001"
            with self.subTest(sense=identifier):
                self.assertEqual(self.references.vocabulary[identifier]["ch"], spelling)
                source = self.references.provenance[identifier]
                self.assertEqual(source["source_band"], "unbanded")
                self.assertIsNone(source["reference_level"])
                self.assertEqual(source["reading"]["method"], "official-text")
                self.assertEqual(source["reading"]["match_method"], "exact-ordered-korean-definitions")
        ordinal = self.references.lexical_identity["ko-nikl-43838-s001"]
        self.assertEqual(self.references.provenance["ko-nikl-43838-s001"]["lexical_category"], "bound-form")
        for parent in ("43833", "43835", "43837"):
            self.assertNotEqual(ordinal, self.references.lexical_identity[f"ko-nikl-{parent}-s001"])

    def test_project_and_literary_support_has_exact_original_and_official_evidence(self):
        for parent, spelling, official_id, reading in (
            ("13016", "재검토", "76430", "재ː검토"),
            ("15352", "누락", "24480", "누ː락"),
            ("38489", "문체", "56941", "문체"),
            ("41767", "주석", "76957", "주ː석"),
            ("45112", "초안", "79619", "초안"),
            ("50947", "은유", "71180", "으뉴"),
        ):
            identifier = f"ko-nikl-{parent}-s001"
            with self.subTest(sense=identifier):
                self.assertEqual(self.references.vocabulary[identifier]["ch"], spelling)
                self.assertEqual(self.references.vocabulary[identifier]["pr"], reading)
                source = self.references.provenance[identifier]
                self.assertEqual(source["source_band"], "unbanded")
                self.assertIsNone(source["reference_level"])
                self.assertEqual(source["reading"]["match_method"], "exact-ordered-korean-definitions")
                self.assertEqual(source["reading"]["official_entry_id"], official_id)
        self.assertNotIn("ko-nikl-41766-s001", self.references.vocabulary)
        self.assertEqual(self.references.lexical_identity["ko-nikl-45112-s001"],
                         self.references.lexical_identity["ko-nikl-45112-s002"])

    def test_actual_reading_exceptions_keep_their_evidence_boundaries(self):
        words, provenance = self.references.vocabulary, self.references.provenance
        self.assertEqual(words["ko-nikl-04942-s001"]["pr"], "야ː구")
        baseball = provenance["ko-nikl-04942-s001"]["reading"]
        self.assertEqual(baseball["pronunciations"], ["야ː구 "])
        self.assertEqual(baseball["display_normalization"], "trim-surrounding-whitespace-only")
        self.assertEqual(words["ko-nikl-12867-s001"]["pr"], "장느")
        self.assertEqual(provenance["ko-nikl-12867-s001"]["reading"]["method"], "authored-broad-hangul")
        self.assertEqual(provenance["ko-nikl-12867-s001"]["reading"]["review_status"], "unreviewed")
        corrected = provenance["ko-nikl-09462-s003"]
        self.assertIn("spring water", corrected["source_english"])
        self.assertIn("strength", corrected["source_correction"]["authored_interpretation"])
        self.assertEqual(corrected["source_correction"]["review_status"], "unreviewed")
        download = self.references.provenance["ko-nikl-16230-s001"]["reading"]
        self.assertEqual(self.references.vocabulary["ko-nikl-16230-s001"]["pr"], "다운로드")
        self.assertEqual(download["method"], "authored-broad-hangul")
        self.assertEqual(download["review_status"], "unreviewed")
        self.assertIn("hankookilbo.com/news/article/201606091433486974", download["reason"])
        self.assertIn("not a fallback", download["reason"])

    def test_early_number_forms_and_counters_do_not_inflate_lexical_breadth(self):
        identities = self.references.lexical_identity
        for independent, attributive in (
            ("18823", "18696"), ("00561", "00354"), ("35372", "35343"),
            ("16185", "16186"), ("47109", "47110"), ("11372", "11373"),
            ("47042", "47043"), ("04320", "04322"), ("02436", "02434"),
            ("09742", "09743"), ("35960", "35961"), ("02397", "02398"),
            ("48017", "48018"), ("11661", "11662"), ("47057", "47058"),
            ("04329", "04330"), ("44782", "44783"), ("18843", "18846"),
            ("00567", "00568"),
        ):
            first, second = f"ko-nikl-{independent}-s001", f"ko-nikl-{attributive}-s001"
            with self.subTest(pair=(first, second)):
                self.assertEqual(identities[first], identities[second])
                self.assertEqual(self.references.provenance[second]["lexical_category"], "function-item")
        for parent in ("08818", "00360", "11151", "16872"):
            self.assertEqual(
                self.references.provenance[f"ko-nikl-{parent}-s001"]["lexical_category"], "bound-form",
            )
        self.assertNotEqual(identities["ko-nikl-35343-s001"], identities["ko-nikl-35345-s002"])
        self.assertNotEqual(identities["ko-nikl-00354-s001"], identities["ko-nikl-00360-s001"])
        self.assertNotEqual(identities["ko-nikl-08818-s001"], identities["ko-nikl-00360-s001"])
        self.assertEqual(identities["ko-nikl-37110-s001"], identities["ko-nikl-37110-s002"])
        self.assertEqual(self.references.provenance["ko-nikl-37110-s001"]["lexical_category"], "function-item")

    def test_early_selection_meanings_and_calendar_readings_have_independent_evidence(self):
        authoring = self.root / "authoring" / "teaching"
        rows = load_yaml(authoring / "early-vocabulary.yaml")
        notes = load_yaml(authoring / "early-notes.yaml")
        self.assertEqual({row["id"] for row in rows}, set(notes["source_evidence"]))
        for row in rows:
            source = self.references.provenance[row["id"]]
            with self.subTest(sense=row["id"]):
                for language in ("korean", "english"):
                    self.assertEqual(
                        notes["source_evidence"][row["id"]][language].strip(),
                        source[f"source_{language}"].strip(),
                    )
                self.assertEqual(source["reading"]["method"], "official-text")
        for decision in notes["reading_evidence"]["entries"]:
            identifier = f"{decision['parent_id']}-s001"
            source = self.references.provenance[identifier]["reading"]
            self.assertEqual(source["official_entry_id"], decision["official_entry_id"])
            self.assertEqual(source["match_method"], "explicit-crosswalk")
            self.assertEqual(self.references.vocabulary[identifier]["pr"], decision["citation"])
        for noun, adverb in (("32142", "32143"), ("37428", "37429"), ("04034", "04035")):
            self.assertEqual(
                self.references.lexical_identity[f"ko-nikl-{noun}-s001"],
                self.references.lexical_identity[f"ko-nikl-{adverb}-s001"],
            )

    def test_expanded_common_polysemy_retains_selected_source_positions_and_route_scope(self):
        placements = {row["id"]: row for row in self.data.inputs["vocabulary"]}
        for identifier, english, korean in (
            ("ko-nikl-11667-s004", "sign", "기호"),
            ("ko-nikl-11667-s005", "situation", "상황"),
            ("ko-nikl-34855-s014", "documents", "서류"),
            ("ko-nikl-34855-s017", "money", "돈"),
            ("ko-nikl-34855-s021", "time", "시간"),
            ("ko-nikl-34855-s025", "leave", "휴가"),
            ("ko-nikl-02844-s002", "attention", "주의"),
        ):
            with self.subTest(sense=identifier):
                self.assertIn(english, self.references.vocabulary[identifier]["ds"])
                self.assertIn(korean, self.references.provenance[identifier]["source_korean"])
        identities = self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-11667-s001"], identities["ko-nikl-11667-s005"])
        self.assertEqual(identities["ko-nikl-11667-s005"], identities["ko-nikl-11667-s008"])
        self.assertEqual(placements["ko-nikl-11667-s008"]["level"], "technical")
        self.assertEqual(identities["ko-nikl-02844-s001"], identities["ko-nikl-02844-s002"])
        self.assertEqual(identities["ko-nikl-04150-s001"], identities["ko-nikl-04151-s001"])
        actual = {identities[f"ko-nikl-{parent}-s001"] for parent in ("03509", "03510", "03511")}
        self.assertEqual(len(actual), 1)

    def test_expansion_corrections_are_explicit_unreviewed_overrides_not_source_replacements(self):
        for filename in (
            "expansion-notes.yaml", "breadth-notes.yaml", "community-notes.yaml",
            "kitchen-notes.yaml", "personal-notes.yaml", "content-notes.yaml",
            "expression-notes.yaml",
            "society-notes.yaml",
            "predicate-notes.yaml",
            "interpretation-notes.yaml",
            "procedure-notes.yaml",
            "nature-notes.yaml",
            "qualities-notes.yaml",
            "natural-support-notes.yaml",
            "quality-support-notes.yaml",
            "analysis-notes.yaml",
            "stance-notes.yaml",
            "rapport-notes.yaml",
            "evaluation-notes.yaml",
            "infrastructure-notes.yaml",
            "infrastructure-support-notes.yaml",
            "cognition-notes.yaml",
            "representation-notes.yaml",
            "circumstance-notes.yaml",
            "governance-notes.yaml",
            "governance-support-notes.yaml",
            "interaction-notes.yaml",
            "culture-notes.yaml",
            "pantry-notes.yaml",
            "stance-qualifiers-notes.yaml",
            "demeanor-notes.yaml",
            "argumentation-notes.yaml",
            "argumentation-support-notes.yaml",
            "measurement-notes.yaml",
            "interpretive-actions-notes.yaml",
            "practical-descriptors-notes.yaml",
            "financial-exchanges-notes.yaml",
            "culture-loanwords-notes.yaml",
            "environmental-resources-notes.yaml",
            "movement-actions-notes.yaml",
        ):
            notes = load_yaml(self.root / "authoring" / "teaching" / filename)
            field = ("source_correction_proposals" if filename in {
                "governance-notes.yaml", "argumentation-notes.yaml",
            }
                     else "source_correction_requests")
            for identifier, request in notes[field].items():
                with self.subTest(sense=identifier):
                    source = self.references.provenance[identifier]
                    correction = source["source_correction"]
                    self.assertEqual(self.references.vocabulary[identifier]["ds"], request["authored_interpretation"])
                    for language in ("korean", "english"):
                        self.assertEqual(source[f"source_{language}"], request[f"source_{language}"])
                        self.assertEqual(correction[f"source_{language}"], source[f"source_{language}"])
                    self.assertEqual(correction["method"], "authored-interpretation")
                    self.assertEqual(correction["review_status"], "unreviewed")
        polarity = self.references.vocabulary["ko-nikl-43882-s001"]
        self.assertIn("negative predicate", polarity["ds"])
        self.assertIn("compelled", self.references.provenance[polarity["id"]]["source_english"])

    def test_everyday_homographs_and_related_forms_have_explicit_distinct_identities(self):
        identities = self.references.lexical_identity
        for first, second in (
            ("ko-nikl-19621-s001", "ko-nikl-19622-s001"),
            ("ko-nikl-33272-s001", "ko-nikl-33276-s001"),
            ("ko-nikl-33521-s003", "ko-nikl-33523-s001"),
            ("ko-nikl-03368-s001", "ko-nikl-03373-s001"),
            ("ko-nikl-26019-s001", "ko-nikl-26023-s001"),
            ("ko-nikl-00055-s001", "ko-nikl-00056-s001"),
            ("ko-nikl-11587-s001", "ko-nikl-11588-s001"),
            ("ko-nikl-21830-s001", "ko-nikl-21831-s001"),
            ("ko-nikl-37379-s001", "ko-nikl-37380-s001"),
        ):
            with self.subTest(pair=(first, second)):
                self.assertEqual(self.references.vocabulary[first]["ch"], self.references.vocabulary[second]["ch"])
                self.assertNotEqual(identities[first], identities[second])
        self.assertEqual(identities["ko-nikl-33523-s001"], identities["ko-nikl-33526-s001"])
        self.assertEqual(identities["ko-nikl-11672-s001"], "ko-lex-11671")
        self.assertEqual(identities["ko-nikl-11967-s001"], "ko-lex-11966")
        for identifier in ("ko-nikl-03373-s001", "ko-nikl-26023-s001", "ko-nikl-37379-s001"):
            self.assertEqual(self.references.provenance[identifier]["lexical_category"], "bound-form")

    def test_community_meaning_distinctions_preserve_source_roles_and_shared_counts(self):
        words, source, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        self.assertIn("line marking", words["ko-nikl-43894-s001"]["ds"])
        self.assertIn("traffic lane", words["ko-nikl-43894-s002"]["ds"])
        self.assertIn("being fixed", words["ko-nikl-11587-s001"]["ds"])
        self.assertIn("schedule", words["ko-nikl-11588-s001"]["ds"])
        self.assertEqual(identities["ko-nikl-43894-s001"], identities["ko-nikl-43894-s002"])
        self.assertEqual(identities["ko-nikl-21831-s001"], identities["ko-nikl-21831-s002"])
        self.assertEqual(source["ko-nikl-21831-s002"]["lexical_category"], "free-lemma")
        self.assertIn("boarding and alighting", words["ko-nikl-02601-s001"]["ds"])
        self.assertIn("sitting", words["ko-nikl-10193-s001"]["ds"])
        self.assertIn("applying", source["ko-nikl-10193-s001"]["source_english"])
        self.assertIn("entered", words["ko-nikl-10025-s002"]["ds"])
        self.assertIn("graduated", source["ko-nikl-10025-s002"]["source_english"])
        self.assertIn("입학", source["ko-nikl-10025-s002"]["source_korean"])

    def test_vapor_condensation_and_dissolved_gas_are_not_replaced_by_source_english_errors(self):
        words, source = self.references.vocabulary, self.references.provenance
        self.assertIn("cools", words["ko-nikl-33272-s002"]["ds"])
        self.assertIn("frozen", source["ko-nikl-33272-s002"]["source_english"])
        self.assertIn("dissolved", words["ko-nikl-33272-s004"]["ds"])
        self.assertIn("melted", source["ko-nikl-33272-s004"]["source_english"])
        identities = {self.references.lexical_identity[f"ko-nikl-33272-s{number:03d}"]
                      for number in range(1, 5)}
        self.assertEqual(len(identities), 1)

    def test_pending_readings_retain_source_without_canonical_guesses(self):
        _, original = sense_index(load_yaml(self.root / "source-senses.yaml"))
        for filename, identifier, official_ids in (
            ("community-notes.yaml", "ko-nikl-48419-s001", {"93471", "515681"}),
            ("society-notes.yaml", "ko-nikl-22209-s001", {"82681", "515514"}),
        ):
            notes = load_yaml(self.root / "authoring" / "teaching" / filename)
            pending = notes["pending_reading_exclusions"]
            self.assertEqual([row["id"] for row in pending], [identifier])
            for row in pending:
                parent, sense = original[row["id"]]
                self.assertNotIn(row["id"], self.references.vocabulary)
                self.assertNotIn(row["provisional_identity"], self.references.lexical_identity.values())
                self.assertEqual(row["source_parent"], parent["id"])
                self.assertEqual(row["lemma"], parent["target"])
                self.assertEqual(row["source_position"], sense["source_position"])
                for key in ("source_band", "reference_level", "source_entry"):
                    self.assertEqual(row[key], parent[key])
                for language in ("korean", "english"):
                    self.assertEqual(row[f"source_{language}"], sense[language])
                self.assertNotIn("pr", row)
                self.assertEqual(row["status"], "excluded-pending-qualified-pronunciation-review")
                self.assertEqual(
                    {entry["official_entry_id"] for entry in row["consulted_reading_sources"]},
                    official_ids,
                )

    def test_pantry_support_and_related_meanings_preserve_source_and_breadth(self):
        words, evidence, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        for parent, spelling in (
            ("09490", "생강"), ("16215", "다시마"), ("17329", "대파"),
            ("19185", "들기름"), ("22364", "파전"), ("24789", "햄"),
            ("25277", "현미"), ("33408", "깍두기"), ("35581", "녹말"),
            ("35860", "마요네즈"), ("38826", "미나리"), ("44098", "참깨"),
            ("52831", "흰자"),
        ):
            identifier = f"ko-nikl-{parent}-s001"
            with self.subTest(sense=identifier):
                self.assertEqual(words[identifier]["ch"], spelling)
                self.assertEqual(evidence[identifier]["source_band"], "unbanded")
                self.assertIsNone(evidence[identifier]["reference_level"])
                self.assertTrue(evidence[identifier]["source_entry"].endswith(f"#record={int(parent)}"))
        for parent in ("00631", "07920", "31215", "35454", "26388", "33408", "35581", "52831", "43803"):
            with self.subTest(parent=parent):
                self.assertEqual(identities[f"ko-nikl-{parent}-s001"],
                                 identities[f"ko-nikl-{parent}-s002"])
        self.assertEqual(identities["ko-nikl-33509-s001"], identities["ko-nikl-44098-s001"])
        self.assertNotEqual(words["ko-nikl-33509-s001"]["ch"], words["ko-nikl-44098-s001"]["ch"])
        self.assertEqual(evidence["ko-nikl-43803-s002"]["lexical_category"], "free-lemma")
        self.assertIn("starch powder", words["ko-nikl-35581-s001"]["ds"])
        self.assertIn("Flour", evidence["ko-nikl-35581-s001"]["source_english"])
        self.assertIn("photosynthesis", words["ko-nikl-35581-s002"]["ds"])

    def test_personal_items_preserve_source_roles_and_mask_sense_identity(self):
        words, evidence, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        for parent, spelling in (
            ("04814", "앞치마"), ("09530", "생리대"), ("20233", "로션"),
            ("22542", "팔찌"), ("35854", "마스크"), ("36915", "머리핀"),
            ("37141", "면봉"), ("44954", "체온계"),
        ):
            identifier = f"ko-nikl-{parent}-s001"
            with self.subTest(sense=identifier):
                self.assertEqual(words[identifier]["ch"], spelling)
                self.assertEqual(evidence[identifier]["source_band"], "unbanded")
                self.assertIsNone(evidence[identifier]["reference_level"])
        for parent in ("13228", "05331", "16501", "48506", "20160"):
            self.assertEqual(identities[f"ko-nikl-{parent}-s001"],
                             identities[f"ko-nikl-{parent}-s002"])
        mask_ids = [f"ko-nikl-35854-s{position:03d}" for position in (1, 2, 3, 4, 6)]
        self.assertEqual(len({identities[identifier] for identifier in mask_ids}), 1)
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual([row["source_position"] for row in parents["ko-nikl-35854"]["senses"]],
                         list(range(1, 7)))
        rows = load_yaml(self.root / "authoring" / "teaching" / "personal-vocabulary.yaml")
        self.assertEqual([row["level"] for row in rows if row["id"] == mask_ids[3]], ["technical"])
        self.assertIn("stockings", words["ko-nikl-02486-s001"]["ds"])
        self.assertIn("leggings", evidence["ko-nikl-02486-s001"]["source_english"])
        self.assertIn("profit", words["ko-nikl-41685-s004"]["ds"])
        self.assertIn("belongings", evidence["ko-nikl-41685-s004"]["source_english"])
        self.assertEqual(identities["ko-nikl-41685-s004"], identities["ko-nikl-41685-s002"])
        self.assertIn("sleeve", words["ko-nikl-00709-s001"]["ds"])
        self.assertIn("coat", words["ko-nikl-20766-s001"]["ds"])
        self.assertIn("perfume", words["ko-nikl-24885-s001"]["ds"])
        self.assertEqual(words["ko-nikl-13228-s001"]["pr"], "재킫")
        self.assertEqual(evidence["ko-nikl-13228-s001"]["reading"]["method"], "authored-broad-hangul")
        self.assertEqual(evidence["ko-nikl-13228-s001"]["reading"]["review_status"], "unreviewed")

    def test_content_counters_and_residual_reference_have_explicit_categories(self):
        evidence, identities = self.references.provenance, self.references.lexical_identity
        for independent, bound in (
            ("ko-nikl-04573-s002", "ko-nikl-04575-s001"),
            ("ko-nikl-22178-s001", "ko-nikl-22179-s001"),
            ("ko-nikl-39480-s001", "ko-nikl-39482-s001"),
        ):
            self.assertEqual(identities[independent], identities[bound])
            self.assertEqual(evidence[bound]["lexical_category"], "free-lemma")
        for identifier in ("ko-nikl-22407-s004", "ko-nikl-35972-s001"):
            self.assertEqual(evidence[identifier]["lexical_category"], "bound-form")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-22407"]["part_of_speech"], "noun")
        other, guitar = "ko-nikl-33117-s001", "ko-nikl-33118-s001"
        self.assertEqual(self.references.vocabulary[other]["ch"], self.references.vocabulary[guitar]["ch"])
        self.assertNotEqual(identities[other], identities[guitar])
        self.assertEqual(evidence[other]["lexical_category"], "function-item")
        self.assertEqual(evidence[guitar]["lexical_category"], "free-lemma")

    def test_content_interpretations_and_core_myth_do_not_replace_source_senses(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertIn("fiber", words["ko-nikl-01312-s001"]["ds"])
        self.assertIn("Fabric", evidence["ko-nikl-01312-s001"]["source_english"])
        self.assertEqual(words["ko-nikl-01414-s002"]["ds"], "metal in general")
        self.assertIn("iron", evidence["ko-nikl-01414-s002"]["source_english"])
        self.assertNotIn("non-flammable", words["ko-nikl-07477-s001"]["ds"])
        self.assertIn("non-flammable", evidence["ko-nikl-07477-s001"]["source_english"])
        self.assertIn("spider", words["ko-nikl-27432-s001"]["ds"])
        self.assertIn("insect", evidence["ko-nikl-27432-s001"]["source_english"])
        self.assertIn("act", words["ko-nikl-35972-s001"]["ds"])
        self.assertIn("scenes", evidence["ko-nikl-35972-s001"]["source_english"])
        self.assertEqual(words["ko-nikl-29514-s001"]["pr"], "골때")
        goal_reading = evidence["ko-nikl-29514-s001"]["reading"]
        self.assertEqual(goal_reading["method"], "authored-broad-hangul")
        self.assertEqual(goal_reading["review_status"], "unreviewed")
        self.assertIn("com=1", goal_reading["reason"])
        rows, _ = load_selections(
            self.root / "authoring" / "teaching",
            load_yaml(self.root / "authoring" / "teaching" / "vocabulary.yaml"),
        )
        placements = {row["id"]: row["level"] for row in rows}
        self.assertEqual(placements["ko-nikl-03362-s001"], "literary")
        self.assertEqual(placements["ko-nikl-03362-s002"], "literary")
        self.assertEqual(placements["ko-nikl-03362-s003"], 27)
        self.assertEqual(len({self.references.lexical_identity[f"ko-nikl-03362-s{i:03d}"]
                              for i in range(1, 4)}), 1)

    def test_expression_homographs_keep_different_actions_and_argument_roles(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (
            ("ko-nikl-36566-s001", "ko-nikl-36567-s004"),
            ("ko-nikl-36570-s001", "ko-nikl-36572-s001"),
            ("ko-nikl-44318-s001", "ko-nikl-44319-s001"),
        ):
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        cold_and_actions = [f"ko-nikl-{parent}-s001" for parent in ("43854", "43856", "43857", "43858")]
        self.assertEqual({words[key]["ch"] for key in cold_and_actions}, {"차다"})
        self.assertEqual(len({identities[key] for key in cold_and_actions}), 4)
        self.assertIn("correct answer", words["ko-nikl-36566-s001"]["ds"])
        self.assertIn("target", words["ko-nikl-36567-s004"]["ds"])
        self.assertIn("slang", words["ko-nikl-43856-s005"]["ds"])
        self.assertIn("figurative", words["ko-nikl-43856-s006"]["ds"])

    def test_expression_short_forms_and_operators_do_not_manufacture_free_breadth(self):
        words, evidence, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        self.assertEqual(identities["ko-nikl-32008-s001"], identities["ko-nikl-32032-s001"])
        self.assertEqual(words["ko-nikl-32032-s001"]["ch"], words["ko-nikl-32033-s001"]["ch"])
        self.assertNotEqual(identities["ko-nikl-32032-s001"], identities["ko-nikl-32033-s001"])
        self.assertEqual(identities["ko-nikl-10548-s001"], identities["ko-nikl-10549-s001"])
        self.assertEqual({words[f"ko-nikl-{parent}-s001"]["ch"] for parent in ("10548", "10549")},
                         {"이따", "이따가"})
        self.assertEqual(identities["ko-nikl-25715-s001"], identities["ko-nikl-25721-s001"])
        self.assertEqual(identities["ko-nikl-51410-s001"], identities["ko-nikl-51408-s003"])
        self.assertIn("emphasis", words["ko-nikl-51410-s001"]["ds"])
        for key in ("ko-nikl-14075-s001", "ko-nikl-33831-s001", "ko-nikl-26900-s001",
                    "ko-nikl-04165-s001", "ko-nikl-04170-s001"):
            self.assertEqual(evidence[key]["lexical_category"], "function-item")

    def test_expression_corrections_preserve_perspective_and_usage_boundaries(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertIn("feel drawn", words["ko-nikl-16773-s001"]["ds"])
        self.assertIn("attract", evidence["ko-nikl-16773-s001"]["source_english"])
        self.assertIn("feel an appetite", words["ko-nikl-16773-s002"]["ds"])
        self.assertIn("stimulate", evidence["ko-nikl-16773-s002"]["source_english"])
        self.assertIn("cramped", words["ko-nikl-16728-s004"]["ds"])
        self.assertIn("lack of air", evidence["ko-nikl-16728-s004"]["source_english"])
        self.assertIn("still to go", words["ko-nikl-34604-s008"]["ds"])
        self.assertIn("fail", evidence["ko-nikl-34604-s008"]["source_english"])
        self.assertIn("resonant", words["ko-nikl-31564-s006"]["ds"])
        self.assertIn("low decibels", evidence["ko-nikl-31564-s006"]["source_english"])
        self.assertIn("no matter", words["ko-nikl-04170-s001"]["ds"])
        self.assertNotIn("ko-nikl-16773-s007", words)

    def test_mobility_support_preserves_real_headwords_and_source_limits(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        tyre = "ko-nikl-21105-s001"
        self.assertEqual(words[tyre]["ch"], "타이어")
        self.assertIn("rubber", evidence[tyre]["source_english"])
        self.assertIn("rubber", words[tyre]["ds"])
        card = "ko-nikl-30790-s001"
        self.assertEqual(words[card]["ch"], "교통 카드")
        self.assertEqual(parents["ko-nikl-30790"]["source_part_of_speech"], "")
        self.assertEqual(parents["ko-nikl-30790"]["source_band"], "unbanded")
        self.assertIn("public transport", words[card]["ds"])
        self.assertEqual(len(parents["ko-nikl-23503"]["senses"]), 1)
        self.assertIn("railway", words["ko-nikl-23503-s001"]["ds"])
        self.assertIn("specified trips", words["ko-nikl-14416-s001"]["ds"])
        self.assertIn("road or rail", words["ko-nikl-51632-s001"]["ds"])
        self.assertIn("authorizing parking", words["ko-nikl-41885-s001"]["ds"])
        for key, reading in (
            ("ko-nikl-23503-s001", "플랟폼"),
            ("ko-nikl-40764-s001", "뱅미러"),
            (card, "교통 카드"),
        ):
            self.assertEqual(words[key]["pr"], reading)
            self.assertEqual(evidence[key]["reading"]["method"], "authored-broad-hangul")
            self.assertEqual(evidence[key]["reading"]["review_status"], "unreviewed")

    def test_mobility_polysemy_adds_senses_without_duplicate_lemmas(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for parent, count in (("43870", 2), ("43877", 2), ("22050", 2), ("24785", 2), ("33248", 3)):
            selected = [f"ko-nikl-{parent}-s{number:03d}" for number in range(1, count + 1)]
            self.assertTrue(all(key in words for key in selected))
            self.assertEqual(len({identities[key] for key in selected}), 1)
        self.assertIn("figurative", words["ko-nikl-33248-s003"]["ds"])
        self.assertIn("reversing", words["ko-nikl-52299-s002"]["ds"])
        self.assertNotEqual(identities["ko-nikl-24785-s002"], identities["ko-nikl-49519-s001"])

    def test_society_homographs_keep_distinct_roles_and_concepts(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (
            ("08617", "08618"), ("30318", "30319"), ("08465", "08466"),
            ("06574", "06575"), ("10793", "10794"), ("08389", "08390"),
        ):
            first, second = f"ko-nikl-{first}-s001", f"ko-nikl-{second}-s001"
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        self.assertIn("father and his son", words["ko-nikl-06574-s001"]["ds"])
        self.assertIn("wealthy", words["ko-nikl-06575-s001"]["ds"])
        self.assertIn("binary source framing", words["ko-nikl-10794-s001"]["ds"])
        self.assertIn("writing", words["ko-nikl-31831-s001"]["ds"])
        self.assertIn("honorific", words["ko-nikl-31831-s001"]["ds"])

    def test_society_naming_and_function_families_preserve_identity_accounting(self):
        identities, evidence = self.references.lexical_identity, self.references.provenance
        self.assertEqual(identities["ko-nikl-08466-s001"], identities["ko-nikl-52049-s001"])
        self.assertEqual(identities["ko-nikl-28496-s002"], identities["ko-nikl-28512-s001"])
        self.assertEqual(identities["ko-nikl-17008-s001"], identities["ko-nikl-17009-s001"])
        self.assertIn("outline", self.references.vocabulary["ko-nikl-17008-s001"]["ds"])
        for key in ("06138", "21111", "31831", "34584", "08389", "17008"):
            self.assertEqual(evidence[f"ko-nikl-{key}-s001"]["lexical_category"], "function-item")
        rows, _ = load_selections(
            self.root / "authoring" / "teaching",
            load_yaml(self.root / "authoring" / "teaching" / "vocabulary.yaml"),
        )
        placements = {row["id"]: row["level"] for row in rows}
        self.assertEqual(placements["ko-nikl-44315-s001"], "professional")
        self.assertEqual(placements["ko-nikl-44315-s002"], 18)
        self.assertEqual(identities["ko-nikl-44315-s001"], identities["ko-nikl-44315-s002"])

    def test_society_corrections_preserve_exact_original_scope_errors(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        for key in ("ko-nikl-06831-s001", "ko-nikl-30297-s001"):
            self.assertIn("two or more", words[key]["ds"])
            self.assertIn("more than two", evidence[key]["source_english"])
        self.assertIn("schooling history", words["ko-nikl-24001-s001"]["ds"])
        self.assertIn("completes", evidence["ko-nikl-24001-s001"]["source_english"])
        self.assertIn("unit or its quarters", words["ko-nikl-06354-s001"]["ds"])
        self.assertIn("army", evidence["ko-nikl-06354-s001"]["source_english"])

    def test_household_fixtures_and_equipment_keep_source_specific_meanings(self):
        words = self.references.vocabulary
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertIn("bowl", words["ko-nikl-00424-s001"]["ds"])
        self.assertIn("water supply", words["ko-nikl-00425-s001"]["ds"])
        self.assertIn("drying", words["ko-nikl-27657-s001"]["ds"])
        self.assertIn("machine", parents["ko-nikl-27657"]["senses"][0]["english"])
        self.assertIn("saw", words["ko-nikl-21655-s001"]["ds"])
        self.assertEqual(len(parents["ko-nikl-19092"]["senses"]), 2)
        self.assertIn("screwdriver", words["ko-nikl-19092-s001"]["ds"])
        self.assertIn("golf", words["ko-nikl-19092-s002"]["ds"])
        self.assertEqual(len(parents["ko-nikl-39040"]["senses"]), 1)
        self.assertIn("fruit and vegetables", words["ko-nikl-39040-s001"]["ds"])
        self.assertEqual(words["ko-nikl-39040-s001"]["pr"], "믹써")
        self.assertEqual(
            self.references.provenance["ko-nikl-39040-s001"]["reading"]["review_status"],
            "unreviewed",
        )

    def test_household_measures_and_cross_cohort_knot_senses_do_not_add_lemmas(self):
        identities = self.references.lexical_identity
        for parent, count in (("39286", 3), ("08996", 2), ("36623", 4),
                              ("21545", 3), ("40114", 2), ("39315", 4)):
            senses = [f"ko-nikl-{parent}-s{number:03d}" for number in range(1, count + 1)]
            self.assertTrue(all(key in self.references.vocabulary for key in senses))
            self.assertEqual(len({identities[key] for key in senses}), 1)
        self.assertIn("fair amount", self.references.vocabulary["ko-nikl-39286-s003"]["ds"])
        self.assertIn("hollow needle", self.references.vocabulary["ko-nikl-39315-s004"]["ds"])

    def test_predicate_homographs_keep_direction_and_argument_perspective(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (
            ("05832", "05833"), ("12642", "12643"),
            ("07861", "07862"), ("47672", "47673"),
        ):
            first, second = f"ko-nikl-{first}-s001", f"ko-nikl-{second}-s001"
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        self.assertIn("visible", words["ko-nikl-05832-s001"]["ds"])
        self.assertIn("show someone", words["ko-nikl-05833-s001"]["ds"])
        self.assertIn("locked", words["ko-nikl-12642-s001"]["ds"])
        self.assertIn("submerged", words["ko-nikl-12643-s001"]["ds"])
        self.assertIn("fruit to form", words["ko-nikl-47672-s001"]["ds"])

    def test_predicate_family_links_do_not_equate_inflections_or_source_ordinals(self):
        identities = self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-09866-s001"], identities["ko-nikl-09867-s001"])
        self.assertEqual(identities["ko-nikl-34101-s001"], identities["ko-nikl-34108-s001"])
        self.assertNotEqual(identities["ko-nikl-34101-s001"], identities["ko-nikl-34100-s001"])
        words = self.references.vocabulary
        self.assertIn("people to stop coming", words["ko-nikl-34016-s008"]["ds"])
        self.assertIn("speech or reading", words["ko-nikl-34018-s008"]["ds"])
        self.assertNotEqual(identities["ko-nikl-34016-s008"], identities["ko-nikl-34018-s008"])
        self.assertEqual(
            self.references.provenance["ko-nikl-10408-s001"]["lexical_category"],
            "function-item",
        )

    def test_predicate_interpretations_preserve_original_direction_and_scope_errors(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertIn("down", words["ko-nikl-34899-s007"]["ds"])
        self.assertIn("pull something up", evidence["ko-nikl-34899-s007"]["source_english"])
        self.assertIn("a region", words["ko-nikl-34882-s002"]["ds"])
        self.assertIn("rural area", evidence["ko-nikl-34882-s002"]["source_english"])
        self.assertIn("credit", words["ko-nikl-18224-s009"]["ds"])
        self.assertIn("deed", evidence["ko-nikl-18224-s009"]["source_english"])
        self.assertIn("text or narrative", words["ko-nikl-47309-s003"]["ds"])
        self.assertIn("plot of a novel", evidence["ko-nikl-47309-s003"]["source_english"])
        self.assertIn("unreasonably", words["ko-nikl-49217-s001"]["ds"])
        self.assertNotIn("ko-nikl-39007-s001", words)

    def test_everyday_predicates_are_retained_source_entries_not_guessed_derivatives(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "everyday-predicates-notes.yaml")
        _, senses = sense_index(load_yaml(self.root / "source-senses.yaml"))
        rows = load_yaml(authoring / "everyday-predicates-vocabulary.yaml")
        self.assertEqual(
            {senses[row["id"]][0]["id"] for row in rows},
            set(notes["source_support_requests"]),
        )
        for row in rows:
            parent, sense = senses[row["id"]]
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertEqual(self.references.vocabulary[row["id"]]["ch"], parent["target"])
            self.assertEqual(self.references.provenance[row["id"]]["source_korean"], sense["korean"])
        advantage = notes["homograph_boundary"]
        self.assertEqual(advantage["selected"], "ko-nikl-50214-s001")
        self.assertEqual(
            self.references.provenance[advantage["selected"]]["source_korean"], "이익이 있다.",
        )
        self.assertNotIn(advantage["rejected_unrelated_parent"], notes["source_support_requests"])
        self.assertEqual(self.references.vocabulary["ko-nikl-07156-s001"]["ds"], "to be disadvantageous")
        self.assertEqual(self.references.vocabulary["ko-nikl-50214-s001"]["ds"], "to be advantageous")

    def test_interpretation_homographs_and_source_nominal_spacing_remain_distinct(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(words["ko-nikl-47262-s001"]["ch"], words["ko-nikl-47263-s001"]["ch"])
        self.assertNotEqual(identities["ko-nikl-47262-s001"], identities["ko-nikl-47263-s001"])
        self.assertEqual(identities["ko-nikl-47263-s001"], identities["ko-nikl-47263-s002"])
        self.assertIn("forceful assertion", words["ko-nikl-47262-s001"]["ds"])
        self.assertIn("opposing", words["ko-nikl-47263-s001"]["ds"])
        self.assertIn("seemingly inconsistent", words["ko-nikl-47263-s002"]["ds"])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(words["ko-nikl-29280-s001"]["ch"], "고정 관념")
        self.assertEqual(parents["ko-nikl-29280"]["source_part_of_speech"], "")
        self.assertEqual(parents["ko-nikl-29280"]["part_of_speech"], "unspecified")
        for identifier in ("ko-nikl-15651-s001", "ko-nikl-29280-s001"):
            reading = self.references.provenance[identifier]["reading"]
            self.assertEqual(reading["method"], "authored-broad-hangul")
            self.assertEqual(reading["review_status"], "unreviewed")
        self.assertEqual(words["ko-nikl-12325-s001"]["pr"], "자율썽")
        self.assertEqual(
            self.references.provenance["ko-nikl-12325-s001"]["reading"]["method"], "official-text",
        )
        self.assertEqual(identities["ko-nikl-16410-s001"], identities["ko-nikl-16410-s002"])
        self.assertEqual(identities["ko-nikl-24405-s001"], identities["ko-nikl-24405-s002"])

    def test_counterevidence_interpretations_retain_source_errors_and_qualification(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        first, second = "ko-nikl-39751-s001", "ko-nikl-39751-s002"
        self.assertEqual(self.references.lexical_identity[first], self.references.lexical_identity[second])
        self.assertIn("disproof", words[first]["ds"])
        self.assertIn("refuting that a fact or argument is wrong", evidence[first]["source_english"])
        self.assertIn("may instead confirm", words[second]["ds"])
        self.assertIn("볼 수 있는", evidence[second]["source_korean"])
        self.assertIn("matter or event", words["ko-nikl-50562-s001"]["ds"])
        self.assertIn("incident or accident", evidence["ko-nikl-50562-s001"]["source_english"])

    def test_procedural_homographs_preserve_distinct_actions_and_participants(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (
            ("01883", "01884"), ("41167", "41168"),
            ("42782", "42783"), ("47378", "47379"),
        ):
            first, second = f"ko-nikl-{first}-s001", f"ko-nikl-{second}-s001"
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        self.assertIn("formal request", words["ko-nikl-03319-s001"]["ds"])
        self.assertIn("receive", words["ko-nikl-14334-s001"]["ds"])
        self.assertIn("issue", words["ko-nikl-39902-s001"]["ds"])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-42021"]["source_part_of_speech"], "동사")
        self.assertIn("comply", words["ko-nikl-42021-s001"]["ds"])

    def test_procedural_polysemy_and_active_passive_family_do_not_inflate_breadth(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-11257-s001"], identities["ko-nikl-11265-s001"])
        self.assertIn("to be regarded", words["ko-nikl-11257-s001"]["ds"])
        self.assertIn("to regard", words["ko-nikl-11265-s001"]["ds"])
        self.assertEqual(
            {identities[f"ko-nikl-14469-s{position:03d}"] for position in range(1, 6)},
            {"ko-lex-14469"},
        )
        self.assertIn("relationship", words["ko-nikl-14469-s004"]["ds"])
        self.assertIn("passbook", words["ko-nikl-14469-s005"]["ds"])
        self.assertEqual(words["ko-nikl-14469-s001"]["pr"], "정ː니하다")
        self.assertEqual(words["ko-nikl-35651-s001"]["pr"], "노늬하다 / 노니하다")
        self.assertEqual(identities["ko-nikl-11018-s001"], identities["ko-nikl-11018-s003"])

    def test_procedural_interpretations_keep_permission_evidence_and_outcome_distinct(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertIn("authorize", words["ko-nikl-02642-s001"]["ds"])
        self.assertEqual(evidence["ko-nikl-02642-s001"]["source_english"], "To agree to do something.")
        self.assertIn("form a pair", words["ko-nikl-17192-s002"]["ds"])
        self.assertIn("equivalent", evidence["ko-nikl-17192-s002"]["source_english"])
        self.assertIn("in writing", words["ko-nikl-37284-s001"]["ds"])
        self.assertIn("whether", words["ko-nikl-42423-s001"]["ds"])
        self.assertIn("truth or falsity", words["ko-nikl-42423-s002"]["ds"])
        self.assertIn("concede", words["ko-nikl-25010-s002"]["ds"])
        self.assertIn("to lose", evidence["ko-nikl-25010-s002"]["source_english"])
        self.assertIn("measures", words["ko-nikl-41209-s001"]["ds"])
        self.assertIn("successfully", words["ko-nikl-24593-s001"]["ds"])

    def test_nature_units_and_scale_reference_are_explicitly_not_free_lemmas(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "nature-notes.yaml")
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        for field, expected in (("bound_only", "bound-form"), ("function_only", "function-item")):
            for identity in notes["identity_decisions"][field]["identity_ids"]:
                with self.subTest(identity=identity):
                    self.assertEqual(groups[identity]["category"], expected)
                    for identifier in groups[identity]["members"]:
                        self.assertEqual(self.references.provenance[identifier]["lexical_category"], expected)
        self.assertNotEqual(
            self.references.lexical_identity["ko-nikl-14232-s001"],
            self.references.lexical_identity["ko-nikl-14233-s001"],
        )
        for parent in ("00550", "20309", "21023", "21024", "21652", "22659", "31993", "39011", "39172"):
            reading = self.references.provenance[f"ko-nikl-{parent}-s001"]["reading"]
            self.assertEqual(reading["method"], "authored-broad-hangul")
            self.assertEqual(reading["review_status"], "unreviewed")

    def test_nature_family_fragments_preserve_calendar_shape_and_physical_senses(self):
        identities = self.references.lexical_identity
        for first, second in (
            ("ko-nikl-03785-s001", "ko-nikl-09374-s001"),
            ("ko-nikl-26083-s002", "ko-nikl-26100-s001"),
            ("ko-nikl-49664-s001", "ko-nikl-49833-s001"),
            ("ko-nikl-16539-s001", "ko-nikl-16542-s001"),
            ("ko-nikl-24576-s001", "ko-nikl-24581-s001"),
            ("ko-nikl-50562-s001", "ko-nikl-50562-s002"),
            ("ko-nikl-39735-s001", "ko-nikl-39735-s003"),
            ("ko-nikl-47153-s001", "ko-nikl-47153-s002"),
        ):
            self.assertEqual(identities[first], identities[second])
        self.assertNotEqual(identities["ko-nikl-49664-s001"], identities["ko-nikl-49668-s001"])
        self.assertEqual(
            self.references.provenance["ko-nikl-24581-s001"]["lexical_category"], "free-lemma",
        )

    def test_nature_labels_do_not_turn_short_source_definitions_into_scientific_claims(self):
        words = self.references.vocabulary
        self.assertIn("quadrilateral", words["ko-nikl-08165-s001"]["ds"])
        self.assertNotIn("square", words["ko-nikl-08165-s001"]["ds"])
        self.assertIn("fields of study", words["ko-nikl-12275-s001"]["ds"])
        self.assertIn("plant", words["ko-nikl-01683-s001"]["ds"])
        self.assertEqual(words["ko-nikl-27655-s001"]["ds"], "absence of moisture or humidity")
        self.assertIn(
            "evaporation", self.references.provenance["ko-nikl-27655-s001"]["source_english"],
        )
        notes = load_yaml(self.root / "authoring" / "teaching" / "nature-notes.yaml")
        for identifier, observation in notes["source_wording_review"]["entries"].items():
            with self.subTest(sense=identifier):
                for language in ("korean", "english"):
                    self.assertEqual(
                        self.references.provenance[identifier][f"source_{language}"],
                        observation[f"source_{language}"],
                    )
                self.assertTrue(observation["limitation"])

    def test_quality_labels_preserve_comparison_outcome_and_discourse_perspective(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertEqual(words["ko-nikl-24117-s001"]["ds"], "much more than before")
        self.assertEqual(evidence["ko-nikl-24117-s001"]["source_english"], "Much better than before. ")
        self.assertEqual(words["ko-nikl-37821-s002"]["ds"], "for things not to work out properly")
        self.assertIn("appearance", evidence["ko-nikl-37821-s002"]["source_english"])
        self.assertEqual(words["ko-nikl-31953-s002"]["ds"], "even that, though it is already inadequate")
        self.assertIn("others", evidence["ko-nikl-31953-s002"]["source_english"])
        self.assertIn("no worse", words["ko-nikl-37832-s001"]["ds"])
        self.assertIn("to seem sincere", words["ko-nikl-14566-s001"]["ds"])
        self.assertIn("to seem to happen", words["ko-nikl-12288-s003"]["ds"])
        self.assertEqual(words["ko-nikl-32620-s001"]["pr"], "그피")
        self.assertEqual(
            self.references.provenance["ko-nikl-32620-s001"]["reading"]["method"], "official-text",
        )

    def test_quality_operators_and_attested_particle_family_keep_explicit_accounting(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "qualities-notes.yaml")
        groups = load_yaml(authoring / "qualities-identities.yaml")
        for identity in notes["identity_policy"]["function_identity_ids"]:
            self.assertEqual(groups[identity]["category"], "function-item")
            for identifier in groups[identity]["members"]:
                self.assertEqual(
                    self.references.provenance[identifier]["lexical_category"], "function-item",
                )
        self.assertEqual(self.references.lexical_identity["ko-nikl-46636-s001"], "ko-lex-46634")
        self.assertEqual(groups["ko-lex-46634"]["lemma"], "억지")
        self.assertEqual(groups["ko-lex-46634"]["members"], ["ko-nikl-46636-s001"])
        self.assertEqual(
            self.references.lexical_identity["ko-nikl-43929-s001"],
            self.references.lexical_identity["ko-nikl-43929-s002"],
        )

    def test_actuality_noun_and_adverb_have_source_compared_conservative_family(self):
        noun, adverb = "ko-nikl-03445-s001", "ko-nikl-03447-s001"
        self.assertEqual(self.references.lexical_identity[noun], "ko-lex-03447")
        self.assertEqual(self.references.lexical_identity[noun], self.references.lexical_identity[adverb])
        for identifier in (noun, adverb):
            self.assertEqual(self.references.provenance[identifier]["lexical_category"], "function-item")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-03445"]["source_part_of_speech"], "명사")
        self.assertEqual(parents["ko-nikl-03447"]["source_part_of_speech"], "부사")
        notes = load_yaml(self.root / "authoring" / "teaching" / "interpretation-notes.yaml")
        decision = notes["actuality_family_adjudication"]
        self.assertEqual(decision["retired_provisional_identity"], "ko-lex-03445")
        evidence = {item["source_parent"]: item for item in decision["official_origin_evidence"]}
        for identifier in (noun, adverb):
            parent = identifier.rsplit("-s", 1)[0]
            self.assertEqual(
                self.references.provenance[identifier]["reading"]["official_entry_id"],
                evidence[parent]["official_entry_id"],
            )
        self.assertEqual(evidence["ko-nikl-03445"]["origin"], evidence["ko-nikl-03447"]["origin"])
        self.assertNotEqual(evidence["ko-nikl-03445"]["origin"], evidence["ko-nikl-03446"]["origin"])
        self.assertNotIn("ko-nikl-03446-s001", self.references.vocabulary)

    def test_recovered_nature_homographs_do_not_substitute_unrelated_meanings(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (("06939", "06940"), ("14570", "14571")):
            first, second = f"ko-nikl-{first}-s001", f"ko-nikl-{second}-s001"
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        self.assertEqual(words["ko-nikl-06939-s001"]["ds"], "a molecule")
        self.assertIn("numerator", words["ko-nikl-06940-s001"]["ds"])
        self.assertIn("purification", words["ko-nikl-14570-s001"]["ds"])
        self.assertIn("frost", words["ko-nikl-09745-s001"]["ds"])
        self.assertEqual(
            self.references.provenance["ko-nikl-39171-s001"]["lexical_category"], "bound-form",
        )
        reading = self.references.provenance["ko-nikl-39171-s001"]["reading"]
        self.assertEqual(reading["method"], "authored-broad-hangul")
        self.assertEqual(reading["review_status"], "unreviewed")

    def test_recovered_source_parents_keep_original_unselected_positions(self):
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        authoring = self.root / "authoring" / "teaching"
        for name in ("natural-support", "quality-support", "analysis", "stance", "rapport", "evaluation"):
            notes = load_yaml(authoring / f"{name}-notes.yaml")
            for parent in notes["source_support_requests"]:
                self.assertEqual(parents[parent]["source_band"], "unbanded")
        self.assertEqual(
            [sense["id"] for sense in parents["ko-nikl-06939"]["senses"]],
            ["ko-nikl-06939-s001", "ko-nikl-06939-s002"],
        )
        self.assertEqual(
            [sense["id"] for sense in parents["ko-nikl-37338"]["senses"]],
            ["ko-nikl-37338-s001", "ko-nikl-37338-s002"],
        )
        note = load_yaml(authoring / "quality-support-notes.yaml")["source_boundary"]
        self.assertEqual(parents["ko-nikl-37338"]["senses"][1]["english"], note["source_english"])
        self.assertNotIn(
            note["excluded_sense"], {row["id"] for row in load_yaml(authoring / "quality-support-vocabulary.yaml")},
        )

    def test_recovered_precision_family_does_not_generate_or_double_count_an_adverb(self):
        adjective, adverb = "ko-nikl-46793-s001", "ko-nikl-46794-s001"
        self.assertEqual(
            self.references.lexical_identity[adjective], self.references.lexical_identity[adverb],
        )
        self.assertEqual(self.references.vocabulary[adjective]["ch"], "엄밀하다")
        self.assertEqual(self.references.vocabulary[adverb]["ch"], "엄밀히")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-46793"]["source_part_of_speech"], "형용사")
        self.assertEqual(parents["ko-nikl-46794"]["source_part_of_speech"], "부사")
        for identifier in (adjective, adverb):
            self.assertEqual(self.references.provenance[identifier]["reading"]["method"], "official-text")
        self.assertIn(
            "Stagnant", self.references.provenance["ko-nikl-42880-s001"]["source_english"],
        )
        self.assertEqual(self.references.vocabulary["ko-nikl-42880-s001"]["ds"], "groundwater")

    def test_analysis_homographs_preserve_discussion_speech_and_listening_meanings(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        public, empty = "ko-nikl-29734-s001", "ko-nikl-29735-s001"
        self.assertEqual(words[public]["ch"], words[empty]["ch"])
        self.assertNotEqual(identities[public], identities[empty])
        self.assertEqual(identities[public], identities["ko-nikl-29734-s002"])
        self.assertEqual(words["ko-nikl-40147-s001"]["ds"], "uttering speech, or the words uttered")
        self.assertEqual(words["ko-nikl-44877-s001"]["ds"], "a listener")
        self.assertEqual(words["ko-nikl-38375-s001"]["ds"], "the literary world or community")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertIn("소리", parents["ko-nikl-40147"]["senses"][0]["korean"])
        self.assertIn("듣는", parents["ko-nikl-44877"]["senses"][0]["korean"])

    def test_analysis_polysemy_keeps_existing_error_and_retained_tuning_positions(self):
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        errors = groups["ko-lex-48188"]["members"]
        self.assertIn("ko-nikl-48188-s001", errors)
        self.assertIn("ko-nikl-48188-s002", errors)
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(
            [sense["id"] for sense in parents["ko-nikl-41132"]["senses"]],
            ["ko-nikl-41132-s001", "ko-nikl-41132-s002"],
        )
        analysis = {row["id"] for row in load_yaml(authoring / "analysis-vocabulary.yaml")}
        self.assertNotIn("ko-nikl-41132-s001", analysis)
        self.assertIn("ko-nikl-41132-s002", analysis)
        self.assertEqual(len(groups["ko-lex-05988"]["members"]), 2)
        self.assertEqual(len(groups["ko-lex-16717"]["members"]), 3)
        notes = load_yaml(authoring / "analysis-notes.yaml")
        self.assertIn("causal direction", " ".join(notes["usage_limits"]))

    def test_analysis_compound_spacing_and_reading_evidence_are_not_conflated(self):
        identifier = "ko-nikl-09305-s001"
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-09305"]["source_part_of_speech"], "")
        self.assertEqual(parents["ko-nikl-09305"]["part_of_speech"], "unspecified")
        self.assertEqual(self.references.vocabulary[identifier]["ch"], "상호 작용")
        self.assertEqual(self.references.vocabulary[identifier]["pr"], "상호 자굥")
        evidence = self.references.provenance[identifier]["reading"]
        self.assertEqual(evidence["method"], "authored-broad-hangul")
        self.assertEqual(evidence["review_status"], "unreviewed")
        official = self.references.provenance["ko-nikl-08177-s001"]["reading"]
        self.assertEqual(official["method"], "official-text")
        self.assertEqual(official["official_entry_id"], "62014")
        self.assertEqual(self.references.vocabulary["ko-nikl-08177-s001"]["pr"], "사고력")

    def test_stance_homographs_keep_calling_gist_and_concrete_representation_distinct(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for left, right in (("00726", "00727"), ("17193", "17194"), ("31006", "31007")):
            left, right = f"ko-nikl-{left}-s001", f"ko-nikl-{right}-s001"
            self.assertEqual(words[left]["ch"], words[right]["ch"])
            self.assertNotEqual(identities[left], identities[right])
        self.assertIn("mental image", words["ko-nikl-03634-s001"]["ds"])
        self.assertIn("Christianity", words["ko-nikl-00726-s002"]["ds"])
        for position in ("001", "002"):
            self.assertEqual(
                self.references.provenance[f"ko-nikl-31006-s{position}"]["reading"]["official_entry_id"],
                "36556",
            )
        stance = {
            row["id"] for row in load_yaml(
                self.root / "authoring" / "teaching" / "stance-vocabulary.yaml",
            )
        }
        self.assertNotIn("ko-nikl-00727-s002", stance)
        self.assertNotIn("ko-nikl-03633-s001", stance)
        self.assertNotIn("ko-nikl-23359-s001", stance)

    def test_stance_nominal_modifiers_and_opposing_response_have_conservative_families(self):
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        for nominal, modifier in (("07594", "07595"), ("09245", "09246")):
            first, second = f"ko-nikl-{nominal}-s001", f"ko-nikl-{modifier}-s001"
            self.assertEqual(self.references.lexical_identity[first], self.references.lexical_identity[second])
            self.assertEqual(parents[f"ko-nikl-{nominal}"]["source_part_of_speech"], "명사")
            self.assertEqual(parents[f"ko-nikl-{modifier}"]["source_part_of_speech"], "관형사")
        for parent, official in (("07594", "60998"), ("07595", "60997"), ("17771", "47796")):
            self.assertEqual(
                self.references.provenance[f"ko-nikl-{parent}-s001"]["reading"]["official_entry_id"],
                official,
            )
        notes = load_yaml(self.root / "authoring" / "teaching" / "stance-notes.yaml")
        decision = notes["family_adjudications"]["opposing_response"]
        evidence = decision["official_evidence"]
        self.assertEqual(evidence["ko-nikl-24543"]["origin"], "抗卞")
        self.assertEqual(evidence["ko-nikl-24544"]["origin"], "抗辯")
        for parent in ("ko-nikl-24543", "ko-nikl-24544"):
            identifier = f"{parent}-s001"
            self.assertEqual(self.references.lexical_identity[identifier], decision["lexical_id"])
            self.assertEqual(
                self.references.provenance[identifier]["reading"]["official_entry_id"],
                evidence[parent]["official_entry_id"],
            )
        self.assertNotEqual(
            self.references.vocabulary["ko-nikl-24543-s001"]["ds"],
            self.references.vocabulary["ko-nikl-24544-s001"]["ds"],
        )

    def test_stance_core_satire_does_not_move_the_optional_literary_meaning(self):
        authoring = self.root / "authoring" / "teaching"
        placements, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        self.assertEqual(
            [row["level"] for row in placements if row["id"] == "ko-nikl-23441-s001"], [25],
        )
        self.assertEqual(
            [row["level"] for row in placements if row["id"] == "ko-nikl-23441-s002"], ["literary"],
        )
        self.assertEqual(
            self.references.lexical_identity["ko-nikl-23441-s001"],
            self.references.lexical_identity["ko-nikl-23441-s002"],
        )
        self.assertEqual(len(groups["ko-lex-37081"]["members"]), 3)
        self.assertEqual(len(groups["ko-lex-14102"]["members"]), 3)

    def test_stance_register_interpretations_keep_source_and_teaching_qualification_separate(self):
        source = self.references.provenance
        words = self.references.vocabulary
        self.assertEqual(words["ko-nikl-28018-s001"]["ds"], "a formal addressee speech style in Korean")
        self.assertIn("raises the addressee", source["ko-nikl-28018-s001"]["source_english"])
        self.assertEqual(words["ko-nikl-31087-s001"]["ds"], "a conversational style of writing")
        self.assertIn("conversations are written down", source["ko-nikl-31087-s001"]["source_english"])
        notes = (self.root / "teaching" / "grammar-notes.md").read_text(encoding="utf-8")
        self.assertIn("Formality is not a higher/lower politeness score", notes)
        self.assertIn("not necessarily a transcript", notes)

    def test_rapport_gratitude_noun_preserves_the_predicate_family_and_excludes_audit(self):
        noun, predicate, audit = "ko-nikl-26491-s001", "ko-nikl-26499-s001", "ko-nikl-26493-s001"
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities[noun], identities[predicate])
        self.assertNotEqual(identities[noun], identities[audit])
        self.assertEqual(words[noun]["ch"], words[audit]["ch"])
        self.assertEqual(words[noun]["pr"], "감ː사")
        self.assertEqual(words[audit]["pr"], "감사")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-26491"]["source_part_of_speech"], "명사")
        self.assertEqual(parents["ko-nikl-26499"]["source_part_of_speech"], "형용사")
        labels = load_yaml(self.root / "authoring" / "teaching" / "support.yaml")
        self.assertEqual(words[predicate]["ds"], labels[predicate])
        self.assertNotIn(audit, labels)

    def test_rapport_polysemy_preserves_cues_attitudes_and_critical_uses(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for parent, first, second in (
            ("15622", "001", "002"), ("27118", "001", "002"), ("30154", "001", "002"),
            ("18910", "002", "003"), ("27403", "001", "002"),
        ):
            left, right = f"ko-nikl-{parent}-s{first}", f"ko-nikl-{parent}-s{second}"
            self.assertEqual(identities[left], identities[right])
            self.assertNotEqual(words[left]["ds"], words[right]["ds"])
        self.assertIn("critical use", words["ko-nikl-27118-s002"]["ds"])
        self.assertIn("ability", words["ko-nikl-15622-s001"]["ds"])
        self.assertIn("expression", words["ko-nikl-15622-s002"]["ds"])
        self.assertNotIn("exaggerated", words["ko-nikl-30154-s001"]["ds"])
        self.assertIn("exaggerated", words["ko-nikl-30154-s002"]["ds"])
        notes = load_yaml(self.root / "authoring" / "teaching" / "rapport-notes.yaml")
        self.assertIn("need not admit fault or constitute an apology", " ".join(notes["pragmatic_limits"]))

    def test_rapport_compound_and_hostile_regard_keep_independent_source_evidence(self):
        item = "ko-nikl-17199-s001"
        self.assertEqual(self.references.vocabulary[item]["ch"], "대인 관계")
        self.assertEqual(self.references.vocabulary[item]["pr"], "대ː인 관계 / 대ː인 관게")
        reading = self.references.provenance[item]["reading"]
        self.assertEqual(reading["method"], "authored-broad-hangul")
        self.assertEqual(reading["review_status"], "unreviewed")
        for parent, reading in (("29631", "공ː감대"), ("34799", "낟까림")):
            self.assertEqual(self.references.vocabulary[f"ko-nikl-{parent}-s001"]["pr"], reading)
        notes = load_yaml(self.root / "authoring" / "teaching" / "rapport-notes.yaml")
        evidence = notes["family_adjudications"]["hostile_regard"]["official_evidence"]
        self.assertEqual(evidence["ko-nikl-43289"]["origin"], "疾視")
        self.assertEqual(evidence["ko-nikl-43290"]["origin"], "嫉視")
        self.assertEqual(
            self.references.lexical_identity["ko-nikl-43289-s001"],
            self.references.lexical_identity["ko-nikl-43290-s001"],
        )
        for parent, value in evidence.items():
            self.assertEqual(
                self.references.provenance[f"{parent}-s001"]["reading"]["official_entry_id"],
                value["official_entry_id"],
            )

    def test_rapport_meanings_do_not_substitute_distractors_or_forecast_future_behavior(self):
        words = self.references.vocabulary
        self.assertIn("yearning", words["ko-nikl-18320-s001"]["ds"])
        self.assertIn("attachment", words["ko-nikl-38859-s001"]["ds"])
        self.assertIn("earnestness", words["ko-nikl-47686-s001"]["ds"])
        self.assertEqual(words["ko-nikl-07734-s001"]["ds"], "insincere remarks not reflecting inward feelings")
        self.assertIn(
            "will not be put into action",
            self.references.provenance["ko-nikl-07734-s001"]["source_english"],
        )
        authoring = self.root / "authoring" / "teaching"
        selected = {row["id"] for row in load_yaml(authoring / "rapport-vocabulary.yaml")}
        for parent in ("01876", "06234", "18319", "26492", "30195", "30365", "30366", "38858", "47388", "47685"):
            self.assertNotIn(f"ko-nikl-{parent}-s001", selected)
        self.assertNotIn("ko-nikl-10199-s003", selected)
        self.assertNotIn("ko-nikl-10199-s004", selected)
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        self.assertEqual(len(groups["ko-lex-04883"]["members"]), 2)
        self.assertEqual(len(groups["ko-lex-11255"]["members"]), 3)
        self.assertEqual(len(groups["ko-lex-39691"]["members"]), 2)

    def test_evaluation_mental_state_and_examination_remain_distinct_homographs(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        mental, examination = "ko-nikl-03625-s001", "ko-nikl-03628-s001"
        self.assertEqual(words[mental]["ch"], words[examination]["ch"])
        self.assertNotEqual(identities[mental], identities[examination])
        self.assertEqual(
            self.references.provenance[mental]["reading"]["official_entry_id"], "66024",
        )
        self.assertEqual(
            self.references.provenance[examination]["reading"]["official_entry_id"], "16442",
        )
        for position in ("002", "003"):
            self.assertEqual(identities[mental], identities[f"ko-nikl-03625-s{position}"])
        self.assertIn("serenity", words["ko-nikl-22892-s001"]["ds"])
        self.assertIn("declaration", words["ko-nikl-44509-s001"]["ds"])

    def test_evaluation_feeling_subtype_does_not_absorb_expert_appraisal(self):
        identities = self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-26576-s001"], identities["ko-nikl-26579-s001"])
        self.assertNotEqual(identities["ko-nikl-26579-s001"], identities["ko-nikl-26581-s001"])
        notes = load_yaml(self.root / "authoring" / "teaching" / "evaluation-notes.yaml")
        evidence = notes["family_adjudications"]["feelings_and_appraisal"]["official_evidence"]
        self.assertEqual(
            [evidence[parent]["origin"] for parent in ("ko-nikl-26576", "ko-nikl-26579", "ko-nikl-26581")],
            ["感情", "憾情", "鑑定"],
        )
        for parent, value in evidence.items():
            self.assertEqual(
                self.references.provenance[f"{parent}-s001"]["reading"]["official_entry_id"],
                value["official_entry_id"],
            )
        self.assertIn("do not award any of the four mastery stages", " ".join(notes["usage_limits"]))

    def test_evaluation_modifiers_preserve_pos_and_the_original_domain(self):
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        for noun, modifier in (("26424", "26425"), ("30276", "30277")):
            self.assertEqual(
                self.references.lexical_identity[f"ko-nikl-{noun}-s001"],
                self.references.lexical_identity[f"ko-nikl-{modifier}-s001"],
            )
            self.assertEqual(parents[f"ko-nikl-{noun}"]["source_part_of_speech"], "명사")
            self.assertEqual(parents[f"ko-nikl-{modifier}"]["source_part_of_speech"], "관형사")
        noun = self.references.provenance["ko-nikl-30276-s001"]
        self.assertIn("conceptual poem", noun["source_english"])
        self.assertFalse(noun["source_korean"].startswith("철학에서"))
        self.assertEqual(
            self.references.vocabulary["ko-nikl-30276-s001"]["ds"],
            "something abstract rather than grounded in reality",
        )
        for parent, official in (("30276", "22435"), ("30277", "22454")):
            self.assertEqual(
                self.references.provenance[f"ko-nikl-{parent}-s001"]["reading"]["official_entry_id"],
                official,
            )

    def test_evaluation_core_and_technical_meanings_keep_their_original_route_scope(self):
        authoring = self.root / "authoring" / "teaching"
        placements, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        for item, level in (
            ("ko-nikl-00006-s001", 30), ("ko-nikl-00006-s002", "technical"),
            ("ko-nikl-35564-s001", "technical"), ("ko-nikl-35564-s002", 15),
        ):
            self.assertEqual([row["level"] for row in placements if row["id"] == item], [level])
        for item in ("ko-nikl-35564-s001", "ko-nikl-35564-s002"):
            self.assertEqual(self.references.provenance[item]["reading"]["method"], "authored-broad-hangul")
            self.assertEqual(self.references.provenance[item]["reading"]["review_status"], "unreviewed")
        self.assertEqual(len(groups["ko-lex-37406"]["members"]), 5)
        self.assertEqual(len(groups["ko-lex-21675"]["members"]), 2)
        self.assertIn("rough", self.references.vocabulary["ko-nikl-21675-s001"]["ds"])
        self.assertIn("statistics", self.references.vocabulary["ko-nikl-21675-s002"]["ds"])

    def test_infrastructure_district_and_building_counter_keep_distinct_categories(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        district, office, counter = (
            "ko-nikl-18300-s001", "ko-nikl-18300-s002", "ko-nikl-18302-s001",
        )
        self.assertEqual({words[item]["ch"] for item in (district, office, counter)}, {"동"})
        self.assertEqual(identities[district], identities[office])
        self.assertNotEqual(identities[district], identities[counter])
        self.assertEqual(self.references.provenance[district]["lexical_category"], "free-lemma")
        self.assertEqual(self.references.provenance[counter]["lexical_category"], "bound-form")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-18300"]["source_part_of_speech"], "명사")
        self.assertEqual(parents["ko-nikl-18302"]["source_part_of_speech"], "의존 명사")

    def test_infrastructure_short_names_and_narrow_door_use_preserve_family_depth(self):
        identities = self.references.lexical_identity
        for members in (
            ("ko-nikl-21437-s001", "ko-nikl-21437-s002", "ko-nikl-30015-s001"),
            ("ko-nikl-10691-s001", "ko-nikl-37089-s001"),
            ("ko-nikl-14080-s001", "ko-nikl-14080-s002", "ko-nikl-14081-s001"),
            ("ko-nikl-44202-s001", "ko-nikl-44169-s001", "ko-nikl-44169-s002", "ko-nikl-50211-s001"),
            ("ko-nikl-38354-s001", "ko-nikl-45770-s001"),
        ):
            with self.subTest(members=members):
                self.assertEqual(len({identities[item] for item in members}), 1)
        words = self.references.vocabulary
        self.assertIn("computer window", words["ko-nikl-44169-s002"]["ds"])
        self.assertIn("glass", words["ko-nikl-50211-s001"]["ds"])
        self.assertNotEqual(identities["ko-nikl-44258-s001"], identities["ko-nikl-44202-s001"])
        self.assertEqual(identities["ko-nikl-29364-s001"], identities["ko-nikl-29364-s002"])
        self.assertIn("upper floors", words["ko-nikl-29364-s001"]["ds"])
        self.assertIn("many storeys", words["ko-nikl-29364-s002"]["ds"])

    def test_infrastructure_water_and_interface_positions_keep_source_specific_meanings(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-01586-s001"], identities["ko-nikl-01586-s002"])
        self.assertEqual(identities["ko-nikl-01586-s002"], identities["ko-nikl-01586-s003"])
        for item, fragment in (
            ("ko-nikl-01586-s002", "drainage"), ("ko-nikl-01586-s003", "tap water"),
            ("ko-nikl-52494-s001", "physical wastebasket"), ("ko-nikl-49428-s001", "receiving mail"),
            ("ko-nikl-00074-s001", "establishing"), ("ko-nikl-17712-s002", "computerised"),
            ("ko-nikl-21011-s004", "computer keyboard"), ("ko-nikl-20324-s001", "web link"),
            ("ko-nikl-37067-s001", "maximum information capacity"),
            ("ko-nikl-37067-s002", "memory component"),
        ):
            with self.subTest(sense=item):
                self.assertIn(fragment, words[item]["ds"])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual([sense["source_position"] for sense in parents["ko-nikl-21011"]["senses"]], [1, 2, 3, 4])
        self.assertIn("컴퓨터에서", self.references.provenance["ko-nikl-21011-s004"]["source_korean"])
        self.assertIn("전력을 전력이", self.references.provenance["ko-nikl-40620-s002"]["source_korean"])
        self.assertEqual(identities["ko-nikl-37067-s001"], identities["ko-nikl-37067-s002"])
        self.assertNotIn("permanent", words["ko-nikl-37067-s002"]["ds"])

    def test_infrastructure_support_preserves_held_source_meanings_without_guessing_readings(self):
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        item = "ko-nikl-29719-s001"
        self.assertEqual(parents["ko-nikl-29719"]["source_part_of_speech"], "")
        self.assertEqual(parents["ko-nikl-29719"]["target"], "공동 주택")
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "infrastructure-support-notes.yaml")
        rows = load_yaml(authoring / "infrastructure-support-vocabulary.yaml")
        held = notes["held_reading_items"]
        self.assertIn("at least two", held[item]["proposed_placement"]["ds"])
        self.assertIn("두 세대 이상", held[item]["source_korean"])
        self.assertIn("more than two", held[item]["source_english"])
        self.assertEqual(set(notes["source_support_requests"]),
                         {row["id"].rsplit("-s", 1)[0] for row in rows}
                         | {row["source_parent"] for row in held.values()})
        self.assertEqual(notes["composition_snapshot"]["selected_senses"], len(rows))
        self.assertTrue(set(notes["source_support_requests"]) <= set(load_yaml(authoring / "support-parents.yaml")))
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["source_band"], "unbanded")
        overlay = load_yaml(self.root / "reading-overlay.yaml")
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        for identifier, record in held.items():
            self.assertNotIn(identifier, self.references.vocabulary)
            source = parents[record["source_parent"]]["senses"][0]
            self.assertEqual(source["korean"], record["source_korean"])
            self.assertEqual(source["english"], record["source_english"])
            with self.assertRaisesRegex(ValueError, "no supported citation reading"):
                citation_reading(record["source_parent"], overlay, decisions)
        correction = load_yaml(authoring / "source-corrections.yaml")["corrections"][item]
        self.assertEqual(correction["authored_interpretation"], held[item]["proposed_placement"]["ds"])

    def test_infrastructure_domain_clarifications_do_not_claim_verified_science(self):
        source = self.references.provenance["ko-nikl-13920-s001"]
        self.assertEqual(self.references.vocabulary["ko-nikl-13920-s001"]["ds"],
                         "voltage; electrical potential difference")
        self.assertIn("electric energy", source["source_english"])
        self.assertEqual(source["source_correction"]["review_status"], "unreviewed")
        self.assertIn("per-unit-charge", source["source_correction"]["rationale"])
        self.assertIn("into the ears", self.references.vocabulary["ko-nikl-10855-s001"]["ds"])
        self.assertIn("patients", self.references.vocabulary["ko-nikl-28411-s001"]["ds"])
        notes = load_yaml(self.root / "authoring" / "teaching" / "infrastructure-support-notes.yaml")
        self.assertIn("compatibility", notes["usage_and_assessment_limits"])
        self.assertEqual(notes["bounded_discovery_result"]["already_selected"], "ko-nikl-20288-s001")

    def test_orientation_forms_share_four_bases_without_absorbing_homographs(self):
        authoring = self.root / "authoring" / "teaching"
        rows = load_yaml(authoring / "orientation-vocabulary.yaml")
        identities = self.references.lexical_identity
        self.assertEqual(len(rows), 12)
        self.assertEqual(len({identities[row["id"]] for row in rows}), 4)
        for parents in (("18568", "18298", "18601"), ("09858", "09686", "09876"),
                        ("34683", "34596", "34709"), ("06791", "06746", "06801")):
            self.assertEqual(len({identities[f"ko-nikl-{parent}-s001"] for parent in parents}), 1)
        for first, other in (("18298", "18300"), ("18298", "18302"),
                             ("34596", "34584"), ("06746", "06745")):
            self.assertNotEqual(identities[f"ko-nikl-{first}-s001"], identities[f"ko-nikl-{other}-s001"])
        for row in rows:
            self.assertEqual(row["level"], 7)
            self.assertEqual(self.references.provenance[row["id"]]["lexical_category"], "free-lemma")
        for item in ("ko-nikl-06791-s002", "ko-nikl-34683-s002", "ko-nikl-18298-s003"):
            self.assertNotIn(item, self.references.vocabulary)

    def test_orientation_readings_preserve_citation_and_ordered_source_distinctions(self):
        notes = load_yaml(self.root / "authoring" / "teaching" / "orientation-notes.yaml")
        for parent, match in notes["reading_assessment"]["crosswalk_proposals"].items():
            item = f"{parent}-s001"
            reading = self.references.provenance[item]["reading"]
            self.assertEqual(reading["official_entry_id"], match["official_entry_id"])
            self.assertEqual(reading["method"], "official-text")
            self.assertEqual(reading["match_method"], "explicit-crosswalk")
            self.assertEqual(self.references.vocabulary[item]["pr"], match["pronunciation"])
        self.assertEqual(self.references.vocabulary["ko-nikl-06801-s001"]["pr"], "부컁")
        self.assertEqual(self.references.vocabulary["ko-nikl-18298-s001"]["pr"], "동")
        self.assertEqual(self.references.vocabulary["ko-nikl-18300-s001"]["pr"], "동ː")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(len(parents["ko-nikl-18298"]["senses"]), 3)
        self.assertNotIn("(N)", parents["ko-nikl-06746"]["senses"][0]["korean"])
        self.assertEqual(parents["ko-nikl-34683"]["senses"][1]["korean"], "북한 지역에 상대하여, 남한 지역.")

    def test_cognition_voice_and_variants_deepen_existing_event_families(self):
        identities = self.references.lexical_identity
        for members in (
            ("ko-nikl-32959-s001", "ko-nikl-32967-s001", "ko-nikl-32961-s001"),
            ("ko-nikl-28218-s001", "ko-nikl-28227-s001", "ko-nikl-28221-s001"),
            ("ko-nikl-25192-s001", "ko-nikl-25192-s002", "ko-nikl-25116-s001"),
            ("ko-nikl-33458-s003", "ko-nikl-33468-s003"),
            ("ko-nikl-35907-s001", "ko-nikl-36423-s001"),
            ("ko-nikl-10843-s001", "ko-nikl-10843-s002", "ko-nikl-46272-s002"),
        ):
            with self.subTest(members=members):
                self.assertEqual(len({identities[item] for item in members}), 1)
        words = self.references.vocabulary
        self.assertIn("be remembered", words["ko-nikl-32961-s001"]["ds"])
        self.assertIn("be settled", words["ko-nikl-28221-s001"]["ds"])
        self.assertIn("slang", words["ko-nikl-33364-s003"]["ds"])
        self.assertEqual(identities["ko-nikl-46162-s003"], identities["ko-nikl-46161-s002"])

    def test_cognition_humble_speech_and_comprehension_are_not_impoliteness_or_agreement(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        honorific, humble, verb = "ko-nikl-36383-s001", "ko-nikl-36383-s002", "ko-nikl-36384-s001"
        self.assertEqual(words[honorific]["ch"], words[humble]["ch"])
        self.assertEqual(identities[honorific], "ko-lex-36211")
        self.assertEqual(identities[honorific], identities[humble])
        self.assertEqual(identities[verb], "ko-lex-36412")
        self.assertIn("honorific", words[honorific]["ds"])
        self.assertIn("humble", words[humble]["ds"])
        self.assertIn("impolite form", self.references.provenance[humble]["source_english"])
        self.assertEqual(words[humble]["pr"], "말ː씀")
        self.assertIn("understanding", words["ko-nikl-09327-s002"]["ds"])
        self.assertNotIn("agree", words["ko-nikl-21102-s001"]["ds"])
        self.assertIn("agree", self.references.provenance["ko-nikl-21102-s001"]["source_english"])

    def test_cognition_inference_and_planning_preserve_nonliteral_source_positions(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for item, fragment in (
            ("ko-nikl-18681-s002", "revisit"), ("ko-nikl-29603-s002", "mull over"),
            ("ko-nikl-25599-s001", "standard"), ("ko-nikl-25599-s002", "roughly"),
            ("ko-nikl-31011-s002", "artwork"), ("ko-nikl-47463-s001", "bring related"),
        ):
            self.assertIn(fragment, words[item]["ds"])
        self.assertEqual(identities["ko-nikl-31011-s001"], "ko-lex-31007")
        self.assertNotEqual(identities["ko-nikl-31011-s001"], identities["ko-nikl-31006-s001"])
        self.assertEqual(identities["ko-nikl-47463-s001"], "ko-lex-47460")
        self.assertEqual(identities["ko-nikl-25599-s001"], identities["ko-nikl-25599-s002"])
        for parent, official in (("07472", "60910"), ("40597", "58817"), ("49154", "26638")):
            self.assertEqual(self.references.provenance[f"ko-nikl-{parent}-s001"]["reading"]["official_entry_id"],
                             official)

    def test_representation_cut_surfaces_and_texture_keep_their_actual_scope(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-16384-s001"], identities["ko-nikl-52150-s001"])
        self.assertNotIn("lengthwise", words["ko-nikl-16384-s001"]["ds"])
        self.assertIn("lengthwise", self.references.provenance["ko-nikl-16384-s001"]["source_english"])
        self.assertIn("right angles", words["ko-nikl-52150-s001"]["ds"])
        self.assertNotEqual(identities["ko-nikl-43251-s001"], identities["ko-nikl-45191-s001"])
        self.assertIn("skin", words["ko-nikl-45191-s001"]["ds"])
        self.assertNotIn("touch", words["ko-nikl-43251-s001"]["ds"])
        self.assertIn("painting", words["ko-nikl-43251-s002"]["ds"])
        self.assertIn("emotional shock", words["ko-nikl-45834-s002"]["ds"])
        self.assertIn("force", words["ko-nikl-45834-s001"]["ds"])
        self.assertNotEqual(identities["ko-nikl-21181-s001"], identities["ko-nikl-21164-s001"])

    def test_representation_named_subtypes_and_methods_do_not_pad_free_breadth(self):
        identities = self.references.lexical_identity
        for members in (
            ("ko-nikl-00006-s002", "ko-nikl-00007-s001"),
            ("ko-nikl-17921-s001", "ko-nikl-17924-s001"),
            ("ko-nikl-37903-s001", "ko-nikl-42155-s001"),
            ("ko-nikl-49682-s001", "ko-nikl-49684-s001"),
            ("ko-nikl-31136-s002", "ko-nikl-31140-s001"),
            ("ko-nikl-45987-s002", "ko-nikl-16508-s001"),
        ):
            self.assertEqual(len({identities[item] for item in members}), 1)
        self.assertNotEqual(identities["ko-nikl-09862-s003"], identities["ko-nikl-32345-s001"])
        self.assertNotEqual(identities["ko-nikl-37556-s003"], identities["ko-nikl-37406-s001"])
        self.assertEqual(self.references.provenance["ko-nikl-17921-s001"]["reading"]["official_entry_id"], "47614")

    def test_completed_support_cohorts_retain_every_requested_source_position(self):
        authoring = self.root / "authoring" / "teaching"
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        for name in ("cognition", "representation", "circumstance", "culture"):
            notes = load_yaml(authoring / f"{name}-notes.yaml")
            rows = load_yaml(authoring / f"{name}-vocabulary.yaml")
            for parent, request in notes["support_parent_requests"].items():
                with self.subTest(cohort=name, parent=parent):
                    record = parents[parent]
                    self.assertEqual(record["source_band"], "unbanded")
                    self.assertEqual(record["target"], request["lemma"])
                    self.assertEqual(record["source_part_of_speech"], request["source_part_of_speech"])
                    self.assertEqual(len(record["senses"]), request["complete_source_senses"])
                    actual = {int(row["id"].rsplit("-s", 1)[1]) for row in rows if row["id"].startswith(parent)}
                    self.assertEqual(actual, set(request["selected_positions"]))
                    if "senses" in request:
                        self.assertEqual(record["senses"], request["senses"])
            for row in rows:
                self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_circumstance_small_amount_forms_preserve_the_stable_function_family(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        group = groups["ko-lex-41331"]
        self.assertEqual((group["lemma"], group["category"]), ("좀", "function-item"))
        self.assertEqual(words["ko-nikl-15085-s001"]["ch"], "조금")
        for item in (
            "ko-nikl-15085-s001", "ko-nikl-15085-s002",
            "ko-nikl-15086-s001", "ko-nikl-15086-s002",
            "ko-nikl-41331-s001", "ko-nikl-41331-s002", "ko-nikl-41331-s003",
            "ko-nikl-41331-s004", "ko-nikl-41331-s005",
        ):
            self.assertEqual(identities[item], "ko-lex-41331")
        self.assertIn("strong intensity", words["ko-nikl-41331-s005"]["ds"])
        self.assertIn("softening", words["ko-nikl-41331-s003"]["ds"])
        for parent in ("07067", "11411", "23879", "24294", "29259", "32715", "32993", "36007", "52386"):
            self.assertEqual(groups[f"ko-lex-{parent}"]["category"], "function-item")

    def test_circumstance_well_senses_are_not_all_skillful_performance(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for position, meaning in (
            (3, "skillfully"), (4, "accurately"), (6, "without trouble"),
            (7, "habit"), (9, "attentively"), (11, "natural tendency"),
            (12, "function or effect"), (13, "sincere care"), (15, "prosperously"),
        ):
            item = f"ko-nikl-12606-s{position:03}"
            self.assertEqual(identities[item], "ko-lex-12606")
            self.assertIn(meaning, words[item]["ds"])
            self.assertEqual(self.references.provenance[item]["source_position"], position)

    def test_circumstance_degree_and_appearance_preserve_qualified_source_meanings(self):
        words = self.references.vocabulary
        limited = "ko-nikl-27958-s002"
        self.assertEqual(self.references.provenance[limited]["source_english"], "At a minimum.")
        self.assertIn("no more than", words[limited]["ds"])
        self.assertIn("seem plausible", words["ko-nikl-32030-s001"]["ds"])
        self.assertNotIn("bored", words["ko-nikl-16728-s003"]["ds"])
        self.assertIn("unrecalled", words["ko-nikl-04148-s002"]["ds"])
        self.assertIn("temporary", words["ko-nikl-11411-s002"]["ds"])
        self.assertIn("once", words["ko-nikl-11411-s003"]["ds"])
        self.assertIn("appear unperturbed", words["ko-nikl-21401-s001"]["ds"])
        self.assertIn("without showing", words["ko-nikl-17621-s001"]["ds"])

    def test_circumstance_derivatives_do_not_zip_senses_or_collapse_homographs(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-46538-s004"], identities["ko-nikl-46539-s003"])
        self.assertIn("amenable", words["ko-nikl-46538-s003"]["ds"])
        self.assertIn("difficult", words["ko-nikl-46539-s003"]["ds"])
        self.assertIn("average", words["ko-nikl-46539-s001"]["ds"])
        self.assertIn("far beyond", words["ko-nikl-46539-s004"]["ds"])
        self.assertEqual(identities["ko-nikl-49900-s002"], identities["ko-nikl-49901-s002"])
        self.assertEqual(identities["ko-nikl-38130-s001"], identities["ko-nikl-38126-s001"])
        self.assertNotEqual(identities["ko-nikl-35999-s002"], identities["ko-nikl-36000-s002"])
        self.assertEqual(identities["ko-nikl-46567-s001"], identities["ko-nikl-46566-s002"])
        self.assertEqual(identities["ko-nikl-32716-s002"], identities["ko-nikl-32715-s001"])

    def test_governance_homographs_currency_and_document_counter_keep_separate_roles(self):
        identities = self.references.lexical_identity
        self.assertEqual(len({identities[item] for item in (
            "ko-nikl-06282-s001", "ko-nikl-06284-s001", "ko-nikl-06286-s002",
        )}), 3)
        for left, right in (
            ("ko-nikl-14622-s001", "ko-nikl-14623-s001"),
            ("ko-nikl-00511-s001", "ko-nikl-00510-s001"),
            ("ko-nikl-17727-s001", "ko-nikl-17730-s001"),
            ("ko-nikl-30825-s001", "ko-nikl-30831-s001"),
            ("ko-nikl-28203-s001", "ko-nikl-28208-s001"),
        ):
            self.assertNotEqual(identities[left], identities[right])
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        self.assertEqual(groups["ko-lex-06286"]["category"], "bound-form")
        self.assertEqual(identities["ko-nikl-16593-s001"], identities["ko-nikl-16594-s001"])
        self.assertEqual(groups["ko-lex-16593"]["category"], "free-lemma")
        for item in ("ko-nikl-16593-s001", "ko-nikl-16594-s001"):
            reading = self.references.provenance[item]["reading"]
            self.assertEqual(reading["method"], "authored-broad-hangul")
            self.assertEqual(reading["review_status"], "unreviewed")
            self.assertNotIn("official_entry_id", reading)

    def test_governance_new_core_senses_do_not_move_or_duplicate_professional_meanings(self):
        authoring = self.root / "authoring" / "teaching"
        rows, _ = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        placements = {row["id"]: row["level"] for row in rows}
        for item, level in (
            ("ko-nikl-28170-s001", "professional"), ("ko-nikl-28170-s002", 12),
            ("ko-nikl-52014-s003", "professional"), ("ko-nikl-52014-s001", 11),
            ("ko-nikl-52014-s004", 8),
        ):
            self.assertEqual(placements[item], level)
        identities = self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-28170-s001"], identities["ko-nikl-28170-s002"])
        self.assertEqual(identities["ko-nikl-52014-s003"], identities["ko-nikl-52014-s004"])
        self.assertEqual(identities["ko-nikl-42260-s001"], identities["ko-nikl-42264-s001"])
        self.assertEqual(identities["ko-nikl-35418-s001"], identities["ko-nikl-35540-s001"])
        self.assertIn("person employed", self.references.vocabulary["ko-nikl-52014-s004"]["ds"])

    def test_governance_source_qualifications_are_not_legal_or_financial_guarantees(self):
        words = self.references.vocabulary
        self.assertIn("victim", words["ko-nikl-29129-s001"]["ds"])
        self.assertIn("due date", words["ko-nikl-06362-s001"]["ds"])
        self.assertIn("formation", words["ko-nikl-28691-s001"]["ds"])
        self.assertIn("collection", words["ko-nikl-43503-s002"]["ds"])
        self.assertIn("borrow", words["ko-nikl-44285-s001"]["ds"])
        self.assertIn("not yet", words["ko-nikl-38828-s001"]["ds"])
        self.assertIn("deadline", words["ko-nikl-44926-s001"]["ds"])
        self.assertEqual(self.references.provenance["ko-nikl-31235-s001"]["source_korean"], "국가의 돈.")
        self.assertEqual(self.references.provenance["ko-nikl-31235-s001"]["reading"]["official_entry_id"], "36790")
        first, second = (self.references.provenance[f"ko-nikl-16694-s{number:03}"] for number in (1, 2))
        self.assertEqual((first["source_position"], second["source_position"]), (1, 2))
        self.assertIn("빚을 진 사람", first["source_korean"])
        self.assertIn("어떠한 일이", second["source_korean"])
        self.assertEqual(first["reading"]["official_entry_id"], "44193")

    def test_governance_support_preserves_complete_sources_and_unread_id_compounds(self):
        authoring = self.root / "authoring" / "teaching"
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        notes = load_yaml(authoring / "governance-notes.yaml")
        held = {"ko-nikl-41731-s001", "ko-nikl-48777-s001"}
        for request in notes["pending_support"]["requests"]:
            parent = parents[request["source_parent"]]
            self.assertEqual(parent["target"], request["target"])
            self.assertEqual(parent["source_part_of_speech"], request["source_part_of_speech"])
            self.assertEqual(parent["source_band"], "unbanded")
            expected = [{
                "id": f"{parent['id']}-s{source['position']:03}",
                "source_position": source["position"],
                "korean": source["source_korean"], "english": source["source_english"],
            } for source in request["evidence"]]
            self.assertEqual(parent["senses"], expected)
            for placement in request["placements"]:
                if placement["id"] not in held:
                    self.assertEqual(self.references.vocabulary[placement["id"]]["ds"], placement["ds"])
        overlay = load_yaml(self.root / "reading-overlay.yaml")
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        for item in held:
            parent = item.rsplit("-s", 1)[0]
            self.assertEqual(parents[parent]["source_part_of_speech"], "")
            self.assertIn(" ", parents[parent]["target"])
            self.assertNotIn(item, self.references.vocabulary)
            with self.assertRaisesRegex(ValueError, "no supported citation reading"):
                citation_reading(parent, overlay, decisions)
        correction = load_yaml(authoring / "source-corrections.yaml")["corrections"]["ko-nikl-48777-s001"]
        self.assertIn("at least", correction["authored_interpretation"])
        self.assertIn("exceeding", correction["source_english"])
        short = parents["ko-nikl-35540"]
        self.assertEqual(short["target"], "노조")
        self.assertEqual(len(short["senses"]), 1)
        self.assertEqual(self.references.provenance["ko-nikl-35540-s001"]["reading"]["official_entry_id"], "42900")

    def test_interaction_positions_preserve_intent_response_and_relationship_boundaries(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for item, meaning in (
            ("ko-nikl-18827-s002", "deceive"), ("ko-nikl-46745-s001", "vague"),
            ("ko-nikl-18660-s002", "repeat back"), ("ko-nikl-18660-s003", "defiantly"),
            ("ko-nikl-39824-s001", "counter"), ("ko-nikl-39819-s003", "handle"),
            ("ko-nikl-35307-s001", "without accurate knowledge"),
            ("ko-nikl-22177-s005", "grow apart"), ("ko-nikl-26370-s002", "break off"),
        ):
            self.assertIn(meaning, words[item]["ds"])
        self.assertNotEqual(identities["ko-nikl-18827-s002"], identities["ko-nikl-46745-s001"])
        self.assertEqual(identities["ko-nikl-18660-s002"], identities["ko-nikl-18660-s003"])
        self.assertEqual(identities["ko-nikl-19303-s003"], identities["ko-nikl-19305-s002"])
        self.assertEqual(identities["ko-nikl-36624-s002"], "ko-lex-36623")
        self.assertEqual(identities["ko-nikl-25680-s002"], "ko-lex-35988")
        self.assertEqual(identities["ko-nikl-18219-s002"], "ko-lex-18224")
        self.assertEqual(identities["ko-nikl-40173-s001"], "ko-lex-40176")
        self.assertEqual(self.references.provenance["ko-nikl-19305-s002"]["reading"]["official_entry_id"], "90914")

    def test_interaction_support_keeps_unselected_source_positions_and_actual_official_readings(self):
        authoring = self.root / "authoring" / "teaching"
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        notes = load_yaml(authoring / "interaction-notes.yaml")
        for parent, request in notes["support_parent_requests"].items():
            self.assertEqual(parents[parent]["target"], request["lemma"])
            self.assertEqual(parents[parent]["source_part_of_speech"], "동사")
            self.assertEqual(parents[parent]["source_band"], "unbanded")
            self.assertEqual(parents[parent]["senses"], request["source_senses"])
            self.assertEqual(len(parents[parent]["senses"]), request["complete_source_sense_count"])
        for filename in ("interaction-vocabulary.yaml", "governance-support-vocabulary.yaml"):
            for row in load_yaml(authoring / filename):
                self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_culture_music_conditions_do_not_invent_nationality_or_performer_counts(self):
        words = self.references.vocabulary
        popular = "ko-nikl-25926-s001"
        ensemble = "ko-nikl-24490-s001"
        self.assertIn("Koreans", self.references.provenance[popular]["source_english"])
        self.assertNotIn("Korean", words[popular]["ds"])
        self.assertIn("kinds", words[ensemble]["ds"])
        self.assertIn("simultaneously", words[ensemble]["ds"])
        self.assertIn("두 가지 이상", self.references.provenance[ensemble]["source_korean"])
        self.assertIn("professionally", words["ko-nikl-04339-s001"]["ds"])
        self.assertIn("traditional Korean", words["ko-nikl-31322-s001"]["ds"])
        self.assertIn("work", words["ko-nikl-12978-s001"]["ds"])
        self.assertNotIn("story", words["ko-nikl-12978-s001"]["ds"])

    def test_culture_audience_and_activity_names_deepen_conservative_families(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for members in (
            ("ko-nikl-02961-s001", "ko-nikl-02958-s001"),
            ("ko-nikl-09197-s001", "ko-nikl-29894-s001"),
            ("ko-nikl-10089-s001", "ko-nikl-37097-s001"),
            ("ko-nikl-13089-s001", "ko-nikl-40365-s001"),
            ("ko-nikl-24499-s001", "ko-nikl-24497-s002"),
            ("ko-nikl-39081-s001", "ko-nikl-35689-s002"),
            ("ko-nikl-18476-s001", "ko-nikl-18606-s001"),
            ("ko-nikl-44893-s001", "ko-nikl-44895-s001"),
            ("ko-nikl-47522-s001", "ko-nikl-47524-s001"),
        ):
            self.assertEqual(len({identities[item] for item in members}), 1)
        self.assertIn("television", words["ko-nikl-02961-s001"]["ds"])
        self.assertIn("radio", words["ko-nikl-44895-s001"]["ds"])
        self.assertIn("opinion", words["ko-nikl-44893-s001"]["ds"])
        self.assertIn("professional", words["ko-nikl-47524-s001"]["ds"])
        self.assertIn("buying", words["ko-nikl-47967-s001"]["ds"])

    def test_culture_impressions_and_dramatic_work_retain_source_boundaries(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        impressions = "ko-nikl-26504-s001"
        self.assertEqual(identities[impressions], identities["ko-nikl-26506-s001"])
        self.assertNotEqual(identities[impressions], identities["ko-nikl-26503-s001"])
        self.assertNotEqual(identities[impressions], identities["ko-nikl-26505-s001"])
        self.assertIn("supporting role", words["ko-nikl-41120-s001"]["ds"])
        self.assertIn("leading role", words["ko-nikl-41796-s001"]["ds"])
        self.assertEqual(self.references.provenance["ko-nikl-27049-s002"]["source_position"], 2)
        self.assertEqual(self.references.provenance["ko-nikl-16515-s002"]["source_position"], 2)
        self.assertEqual(self.references.provenance["ko-nikl-52758-s002"]["source_position"], 2)
        self.assertNotEqual(identities["ko-nikl-17081-s001"], identities["ko-nikl-52758-s002"])
        rows = load_yaml(self.root / "authoring" / "teaching" / "culture-vocabulary.yaml")
        selected = {row["id"] for row in rows}
        self.assertNotIn("ko-nikl-04905-s001", selected)
        self.assertNotIn("ko-nikl-47947-s001", selected)

    def test_pantry_admission_preserves_complete_arrays_and_original_positions(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "pantry-notes.yaml")
        rows = load_yaml(authoring / "pantry-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        for identifier, request in notes["support_parent_requests"].items():
            with self.subTest(parent=identifier):
                record = parents[identifier]
                self.assertEqual(record["source_band"], "unbanded")
                self.assertEqual(record["target"], request["lemma"])
                self.assertEqual(record["source_part_of_speech"], request["source_part_of_speech"])
                self.assertEqual(len(record["senses"]), request["source_sense_count"])
                self.assertEqual([item["korean"] for item in record["senses"]], request["korean_definitions"])
                self.assertEqual([item["english"] for item in record["senses"]], request["english_definitions"])
                actual = {int(row["id"].rsplit("-s", 1)[1]) for row in rows if row["id"].startswith(identifier)}
                self.assertEqual(actual, set(request["selected_positions"]))
        self.assertEqual(
            self.references.provenance["ko-nikl-20932-s002"]["source_position"], 2
        )
        self.assertIn("눈알", parents["ko-nikl-52832"]["senses"][1]["korean"])
        self.assertIn("비유적으로", parents["ko-nikl-35455"]["senses"][1]["korean"])

    def test_pantry_variants_and_prepared_senses_do_not_inflate_free_breadth(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for members in (
            ("ko-nikl-13841-s001", "ko-nikl-35581-s001"),
            ("ko-nikl-35455-s001", "ko-nikl-35454-s001"),
            ("ko-nikl-52832-s001", "ko-nikl-52831-s001"),
            ("ko-nikl-16997-s001", "ko-nikl-20825-s001"),
            ("ko-nikl-52310-s001", "ko-nikl-52309-s001"),
            ("ko-nikl-09629-s001", "ko-nikl-20932-s001", "ko-nikl-20932-s002"),
            ("ko-nikl-02149-s001", "ko-nikl-02149-s002"),
        ):
            self.assertEqual(len({identities[item] for item in members}), 1)
        self.assertIn("ingredient", words["ko-nikl-02149-s001"]["ds"])
        self.assertIn("side dish", words["ko-nikl-02149-s002"]["ds"])
        self.assertIn("egg, milk, sugar", words["ko-nikl-20932-s002"]["ds"])
        self.assertNotIn("sweet", words["ko-nikl-09629-s001"]["ds"])
        self.assertNotIn("sugar", words["ko-nikl-47527-s001"]["ds"])
        self.assertNotEqual(identities["ko-nikl-37341-s001"], identities["ko-nikl-06778-s001"])

    def test_pantry_food_scope_preserves_homographs_and_source_corrections(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertNotEqual(identities["ko-nikl-26022-s001"], identities["ko-nikl-26019-s001"])
        self.assertNotEqual(identities["ko-nikl-26022-s001"], identities["ko-nikl-26023-s001"])
        self.assertIn("fish", words["ko-nikl-16925-s001"]["ds"])
        self.assertEqual(words["ko-nikl-38438-s001"]["ds"], "octopus")
        self.assertEqual(words["ko-nikl-47515-s001"]["ds"], "salmon")
        self.assertEqual(words["ko-nikl-33546-s001"]["ds"], "leaves of perilla or sesame")
        self.assertIn("or root", words["ko-nikl-49357-s001"]["ds"])
        self.assertIn("not the dried product", words["ko-nikl-37341-s001"]["ds"])
        self.assertIn("말리면 북어가", self.references.provenance["ko-nikl-37341-s001"]["source_korean"])
        self.assertIn("known in Korea as bugeo", self.references.provenance["ko-nikl-37341-s001"]["source_english"])
        self.assertIn("with or without salt", words["ko-nikl-33530-s001"]["ds"])
        self.assertIn("tree fruits", words["ko-nikl-28079-s001"]["ds"])
        self.assertIn("other than rice", words["ko-nikl-12697-s001"]["ds"])

    def test_pantry_missing_citation_text_never_becomes_verified_pronunciation(self):
        authoring = self.root / "authoring" / "teaching"
        overlay = load_yaml(self.root / "reading-overlay.yaml")
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        rows = load_yaml(authoring / "pantry-vocabulary.yaml")
        authored = {
            "ko-nikl-00551", "ko-nikl-04156", "ko-nikl-09629",
            "ko-nikl-20695", "ko-nikl-20932", "ko-nikl-23581", "ko-nikl-48459",
        }
        for row in rows:
            parent = row["id"].rsplit("-s", 1)[0]
            reading = self.references.provenance[row["id"]]["reading"]
            with self.subTest(item=row["id"]):
                if parent in authored:
                    self.assertEqual(overlay["entries"][parent]["pronunciations"], [])
                    self.assertEqual(reading["method"], "authored-broad-hangul")
                    self.assertEqual(decisions[parent]["review_status"], "unreviewed")
                else:
                    self.assertEqual(reading["method"], "official-text")
        self.assertEqual(
            self.references.provenance["ko-nikl-46176-s001"]["reading"]["official_entry_id"],
            "14323",
        )

    def test_stance_common_replies_and_scope_are_not_counted_as_free_content(self):
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        notes = load_yaml(authoring / "stance-qualifiers-notes.yaml")
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for group in notes["identity_adjudication"]["corrected_existing_function_categories"]:
            self.assertEqual(groups[group]["category"], "function-item")
        for item in (
            "ko-nikl-38634-s001", "ko-nikl-38633-s001", "ko-nikl-14874-s001",
            "ko-nikl-06392-s001", "ko-nikl-04169-s001", "ko-nikl-11623-s001",
            "ko-nikl-11624-s001", "ko-nikl-04229-s001",
        ):
            self.assertEqual(groups[identities[item]]["category"], "function-item")
        self.assertEqual(identities["ko-nikl-38634-s001"], identities["ko-nikl-38633-s001"])
        self.assertEqual(identities["ko-nikl-11623-s001"], identities["ko-nikl-11624-s001"])
        self.assertNotEqual(identities["ko-nikl-11585-s001"], identities["ko-nikl-11624-s001"])
        self.assertIn("earnest", words["ko-nikl-14874-s001"]["ds"])
        self.assertIn("if at all possible", words["ko-nikl-06392-s001"]["ds"])
        self.assertIn("outset", words["ko-nikl-04229-s001"]["ds"])
        self.assertIn("never", words["ko-nikl-04229-s002"]["ds"])
        self.assertIn("entirely", words["ko-nikl-04229-s003"]["ds"])
        self.assertIn("preferably", words["ko-nikl-48353-s002"]["ds"])

    def test_stance_source_corrections_keep_concession_pretence_and_atmosphere(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        self.assertIn("even just", words["ko-nikl-16148-s002"]["ds"])
        self.assertIn("라도", evidence["ko-nikl-16148-s002"]["source_korean"])
        self.assertIn("real thoughts or feelings", words["ko-nikl-43346-s001"]["ds"])
        self.assertNotIn("thought", evidence["ko-nikl-43346-s001"]["source_english"])
        self.assertIn("마음이나 생각과 다르게", evidence["ko-nikl-43346-s001"]["source_korean"])
        self.assertIn("inwardly", words["ko-nikl-02549-s003"]["ds"])
        self.assertIn("atmosphere", words["ko-nikl-50891-s002"]["ds"])
        self.assertEqual(evidence["ko-nikl-50891-s002"]["source_english"], "Exquisitely.")
        self.assertIn("worse", evidence["ko-nikl-25638-s001"]["source_english"])
        self.assertNotIn("worse", words["ko-nikl-25638-s001"]["ds"])
        self.assertIn("generally", words["ko-nikl-38018-s001"]["ds"])

    def test_stance_actual_category_pairs_and_variants_share_inspected_families(self):
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        identities = self.references.lexical_identity
        self.assertNotIn("ko-lex-07767", groups)
        self.assertNotIn("ko-lex-19845", groups)
        for members in (
            ("ko-nikl-07766-s001", "ko-nikl-07766-s002", "ko-nikl-07767-s001", "ko-nikl-07767-s002"),
            ("ko-nikl-19783-s001", "ko-nikl-19845-s001", "ko-nikl-19846-s001"),
            ("ko-nikl-10343-s001", "ko-nikl-10346-s001", "ko-nikl-10347-s001"),
            ("ko-nikl-11614-s001", "ko-nikl-11614-s002", "ko-nikl-11613-s002", "ko-nikl-11615-s002"),
            ("ko-nikl-51408-s001", "ko-nikl-51408-s003", "ko-nikl-51412-s001", "ko-nikl-51412-s003"),
            ("ko-nikl-17434-s001", "ko-nikl-17440-s001"),
            ("ko-nikl-17835-s001", "ko-nikl-18657-s001"),
        ):
            self.assertEqual(len({identities[item] for item in members}), 1)
        self.assertNotEqual(identities["ko-nikl-02549-s001"], identities["ko-nikl-02551-s001"])

    def test_stance_epistemic_and_perceptual_senses_remain_separate_targets(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertIn("almost", words["ko-nikl-23708-s001"]["ds"])
        self.assertIn("거의", self.references.provenance["ko-nikl-23708-s001"]["source_korean"])
        self.assertIn("unlikely", words["ko-nikl-51408-s001"]["ds"])
        self.assertIn("chance", words["ko-nikl-51408-s002"]["ds"])
        self.assertIn("suspected", words["ko-nikl-51412-s003"]["ds"])
        for suffix, marker in ((1, "memory"), (2, "eye"), (3, "audible"), (4, "asleep"), (5, "lit")):
            item = f"ko-nikl-46369-s{suffix:03d}"
            self.assertIn(marker, words[item]["ds"])
            self.assertEqual(identities[item], "ko-lex-46369")
            self.assertEqual(self.references.provenance[item]["source_position"], suffix)
        self.assertIn("sleep", words["ko-nikl-46462-s004"]["ds"])
        self.assertIn("smoke or smell", words["ko-nikl-46462-s005"]["ds"])
        self.assertIn("closely packed", words["ko-nikl-46065-s002"]["ds"])
        self.assertIn("worn", words["ko-nikl-24992-s001"]["ds"])

    def test_stance_new_parents_retain_full_source_and_actual_official_readings(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "stance-qualifiers-notes.yaml")
        rows = load_yaml(authoring / "stance-qualifiers-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["source"]["support_parent_ids"]
        self.assertEqual(len(requests), 27)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requests), 37)
        for parent in requests:
            record = parents[parent]
            self.assertEqual(record["source_band"], "unbanded")
            self.assertEqual(
                [item["source_position"] for item in record["senses"]],
                list(range(1, len(record["senses"]) + 1)),
            )
            self.assertTrue(all(item["korean"] and item["english"] for item in record["senses"]))
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_demeanor_substantiality_and_loyalty_are_separate_source_homographs(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-45865-s001"], "ko-lex-45863")
        self.assertEqual(identities["ko-nikl-45865-s002"], "ko-lex-45863")
        self.assertEqual(identities["ko-nikl-45866-s001"], "ko-lex-45864")
        self.assertIn("content", words["ko-nikl-45865-s001"]["ds"])
        self.assertIn("healthy", words["ko-nikl-45865-s002"]["ds"])
        self.assertIn("loyal", words["ko-nikl-45866-s001"]["ds"])
        self.assertEqual(words["ko-nikl-45865-s001"]["ch"], words["ko-nikl-45866-s001"]["ch"])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(len(parents["ko-nikl-45863"]["senses"]), 2)
        self.assertEqual(len(parents["ko-nikl-45864"]["senses"]), 1)
        self.assertIn("충성스럽고", parents["ko-nikl-45864"]["senses"][0]["korean"])

    def test_demeanor_quietness_and_familiarity_do_not_imply_character_judgments(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for members in (
            ("ko-nikl-03806-s001", "ko-nikl-03806-s002", "ko-nikl-03805-s001"),
            ("ko-nikl-38325-s001", "ko-nikl-38326-s001"),
            ("ko-nikl-20501-s001", "ko-nikl-20499-s001"),
            ("ko-nikl-14392-s001", "ko-nikl-14371-s002"),
            ("ko-nikl-29214-s001", "ko-nikl-29214-s003", "ko-nikl-29212-s001"),
            ("ko-nikl-33325-s001", "ko-nikl-33404-s001", "ko-nikl-33404-s002"),
            ("ko-nikl-39147-s001", "ko-nikl-39149-s001", "ko-nikl-39148-s001"),
        ):
            self.assertEqual(len({identities[item] for item in members}), 1)
        self.assertNotEqual(identities["ko-nikl-19885-s001"], identities["ko-nikl-38325-s001"])
        self.assertIn("not gentle or friendly", words["ko-nikl-19885-s001"]["ds"])
        self.assertNotIn("friendly", words["ko-nikl-38325-s001"]["ds"])
        self.assertIn("weather", words["ko-nikl-03806-s001"]["ds"])
        self.assertIn("waves", words["ko-nikl-29214-s002"]["ds"])
        self.assertIn("eye", words["ko-nikl-34805-s002"]["ds"])
        self.assertIn("wronged", words["ko-nikl-09733-s001"]["ds"])
        self.assertNotIn("depressed", words["ko-nikl-09733-s001"]["ds"])
        self.assertNotIn("not normal", words["ko-nikl-33404-s002"]["ds"])

    def test_demeanor_resource_texture_urgency_and_relief_keep_original_scope(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        for suffix, marker in ((1, "moisture"), (2, "spare"), (3, "inflexible"), (4, "move"), (5, "packed")):
            item = f"ko-nikl-07868-s{suffix:03d}"
            self.assertIn(marker, words[item]["ds"])
            self.assertEqual(evidence[item]["source_position"], suffix)
        self.assertIn("barely enough", words["ko-nikl-07854-s001"]["ds"])
        self.assertIn("barely reaching", words["ko-nikl-07854-s002"]["ds"])
        self.assertIn("household means", words["ko-nikl-35258-s002"]["ds"])
        self.assertIn("income", evidence["ko-nikl-35258-s002"]["source_english"])
        self.assertIn("or", words["ko-nikl-31640-s001"]["ds"])
        self.assertIn("upon", words["ko-nikl-16046-s001"]["ds"])
        self.assertIn("just before", evidence["ko-nikl-16046-s001"]["source_english"])
        self.assertIn("as if", words["ko-nikl-32539-s001"]["ds"])
        self.assertIn("legs", words["ko-nikl-22400-s004"]["ds"])
        self.assertIn("windless", words["ko-nikl-23001-s003"]["ds"])
        self.assertIn("physical", words["ko-nikl-52238-s001"]["ds"])
        self.assertIn("heavier than it looks", words["ko-nikl-38345-s001"]["ds"])

    def test_demeanor_admission_preserves_unselected_positions_and_official_readings(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "demeanor-notes.yaml")
        rows = load_yaml(authoring / "demeanor-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["source"]["support_parent_ids"]
        self.assertEqual(len(requests), 29)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requests), 45)
        for identifier in requests:
            record = parents[identifier]
            self.assertEqual(record["source_band"], "unbanded")
            self.assertEqual(record["source_part_of_speech"], "형용사")
            self.assertEqual(
                [item["source_position"] for item in record["senses"]],
                list(range(1, len(record["senses"]) + 1)),
            )
        selected = {row["id"] for row in rows}
        self.assertNotIn("ko-nikl-07750-s002", selected)
        self.assertNotIn("ko-nikl-33402-s001", selected)
        self.assertIn("신체 부분", parents["ko-nikl-07750"]["senses"][1]["korean"])
        self.assertIn("몸이 마르고", parents["ko-nikl-33402"]["senses"][0]["korean"])
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_argumentation_support_preserves_all_requested_source_positions(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "argumentation-notes.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["pending_support"]["requests"]
        selected = {row["id"] for row in load_yaml(authoring / "argumentation-support-vocabulary.yaml")}
        self.assertEqual(len(requests), 10)
        self.assertEqual(sum(len(parents[row["source_parent"]]["senses"]) for row in requests), 13)
        for request in requests:
            parent = parents[request["source_parent"]]
            with self.subTest(parent=parent["id"]):
                self.assertEqual(parent["target"], request["target"])
                self.assertEqual(parent["source_band"], "unbanded")
                self.assertEqual(parent["source_part_of_speech"], request["source_part_of_speech"])
                self.assertEqual(
                    [(row["source_position"], row["korean"], row["english"]) for row in parent["senses"]],
                    [(row["position"], row["source_korean"], row["source_english"]) for row in request["evidence"]],
                )
                self.assertTrue({row["id"] for row in request["placements"]} <= selected)
        for identifier in ("ko-nikl-21099-s001", "ko-nikl-24986-s002", "ko-nikl-39807-s002"):
            self.assertNotIn(identifier, selected)
            self.assertNotIn(identifier, self.references.vocabulary)

    def test_argumentation_homographs_and_evidence_are_not_interchangeable(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        own, arbitrary = "ko-nikl-12330-s001", "ko-nikl-12331-s001"
        self.assertEqual(words[own]["ch"], words[arbitrary]["ch"])
        self.assertNotEqual(identities[own], identities[arbitrary])
        self.assertIn("own thoughts", words[own]["ds"])
        self.assertIn("arbitrary", words[arbitrary]["ds"])
        self.assertIn("another person", words["ko-nikl-21099-s002"]["ds"])
        self.assertNotEqual(identities["ko-nikl-27398-s003"], identities["ko-nikl-27395-s001"])
        self.assertIn("indirect", words["ko-nikl-40446-s001"]["ds"])
        self.assertIn("disproof", words["ko-nikl-39751-s001"]["ds"])
        self.assertIn("may instead confirm", words["ko-nikl-39751-s002"]["ds"])
        self.assertEqual(identities["ko-nikl-39751-s001"], identities["ko-nikl-39751-s002"])
        self.assertNotEqual(identities["ko-nikl-40446-s001"], identities["ko-nikl-39751-s001"])

    def test_argumentation_core_model_and_direction_do_not_move_branch_senses(self):
        rows = {row["id"]: row for row in self.data.inputs["vocabulary"]}
        identities = self.references.lexical_identity
        self.assertEqual(rows["ko-nikl-23221-s001"]["level"], 13)
        for suffix in ("002", "003"):
            identifier = f"ko-nikl-23221-s{suffix}"
            self.assertEqual(rows[identifier]["level"], "scientific")
            self.assertEqual(identities[identifier], identities["ko-nikl-23221-s001"])
        self.assertEqual(rows["ko-nikl-40494-s001"]["level"], 7)
        self.assertLess(rows["ko-nikl-40494-s001"]["level"], rows["ko-nikl-40494-s002"]["level"])
        self.assertEqual(identities["ko-nikl-40494-s001"], identities["ko-nikl-40494-s002"])
        self.assertEqual(identities["ko-nikl-27398-s003"], identities["ko-nikl-27398-s004"])
        self.assertEqual(identities["ko-nikl-33215-s004"], identities["ko-nikl-33215-s006"])

    def test_argumentation_readings_keep_actual_text_and_explicit_unreviewed_exceptions(self):
        authoring = self.root / "authoring" / "teaching"
        overlay = load_yaml(self.root / "reading-overlay.yaml")
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        rows = load_yaml(authoring / "argumentation-vocabulary.yaml")
        rows += load_yaml(authoring / "argumentation-support-vocabulary.yaml")
        self.assertEqual(len(rows), 73)
        authored = {"ko-nikl-02744", "ko-nikl-22613"}
        methods = Counter()
        for row in rows:
            parent = row["id"].rsplit("-s", 1)[0]
            reading = self.references.provenance[row["id"]]["reading"]
            methods[reading["method"]] += 1
            if parent in authored:
                self.assertEqual(overlay["entries"][parent]["pronunciations"], [])
                self.assertEqual(reading["method"], "authored-broad-hangul")
                self.assertEqual(decisions[parent]["review_status"], "unreviewed")
            else:
                self.assertEqual(reading["method"], "official-text")
        self.assertEqual(methods, {"official-text": 71, "authored-broad-hangul": 2})
        for item, text, official in (
            ("ko-nikl-05695-s001", "보기", "58787"),
            ("ko-nikl-10617-s002", "이ː력", "71710"),
            ("ko-nikl-25729-s002", "가ː면", "14887"),
            ("ko-nikl-40494-s001", "방향", "65533"),
        ):
            self.assertEqual(self.references.vocabulary[item]["pr"], text)
            self.assertEqual(self.references.provenance[item]["reading"]["official_entry_id"], official)

    def test_argumentation_interpretations_do_not_add_secrecy_imminence_or_deception(self):
        words, evidence = self.references.vocabulary, self.references.provenance
        for item, raw_marker, authored_label in (
            ("ko-nikl-01091-s001", "Secretly", "a plan formed in one's mind"),
            ("ko-nikl-48983-s001", "plot", "the central gist or main point"),
            ("ko-nikl-47942-s001", "about to", "a feeling that something may happen"),
            ("ko-nikl-12331-s001", "subjective", "a self-willed or arbitrary thought"),
            ("ko-nikl-25017-s001", "deceptive", "outward appearance without real substance"),
        ):
            self.assertIn(raw_marker, evidence[item]["source_english"])
            self.assertEqual(words[item]["ds"], authored_label)
            self.assertEqual(evidence[item]["source_correction"]["review_status"], "unreviewed")

    def test_measurement_comparators_preserve_inclusive_and_exclusive_source_boundaries(self):
        authoring = self.root / "authoring" / "teaching"
        _, groups = load_selections(authoring, load_yaml(authoring / "vocabulary.yaml"))
        notes = load_yaml(authoring / "measurement-notes.yaml")
        words, sources = self.references.vocabulary, self.references.provenance
        for identifier in notes["identity_adjudication"]["new_function_ids"]:
            self.assertEqual(groups[identifier]["category"], "function-item")
        for item, marker in (("ko-nikl-10769-s001", "at least"), ("ko-nikl-11007-s001", "at most")):
            self.assertIn(marker, words[item]["ds"])
            self.assertIn("포함하여", sources[item]["source_korean"])
        self.assertIn("less than", words["ko-nikl-38869-s001"]["ds"])
        self.assertIn("이르지 못함", sources["ko-nikl-38869-s001"]["source_korean"])
        self.assertIn("ahead of", words["ko-nikl-10769-s002"]["ds"])
        self.assertIn("after or below", words["ko-nikl-11007-s002"]["ds"])
        self.assertIn("within", words["ko-nikl-10501-s001"]["ds"])
        self.assertEqual(groups["ko-lex-45026"]["category"], "free-lemma")
        self.assertEqual(
            self.references.lexical_identity["ko-nikl-45026-s001"],
            self.references.lexical_identity["ko-nikl-45030-s001"],
        )
        self.assertEqual(
            self.references.lexical_identity["ko-nikl-45397-s001"],
            self.references.lexical_identity["ko-nikl-45398-s001"],
        )

    def test_measurement_same_spellings_do_not_replace_unrelated_source_parents(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for first, second in (
            ("ko-nikl-13782-s001", "ko-nikl-13783-s001"),
            ("ko-nikl-33238-s001", "ko-nikl-33239-s001"),
            ("ko-nikl-10501-s001", "ko-nikl-10503-s001"),
        ):
            self.assertEqual(words[first]["ch"], words[second]["ch"])
            self.assertNotEqual(identities[first], identities[second])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-33238"]["source_part_of_speech"], "동사")
        self.assertEqual(parents["ko-nikl-33239"]["source_part_of_speech"], "형용사")
        self.assertIn("hair", words["ko-nikl-33238-s001"]["ds"])
        cohort = load_yaml(self.root / "authoring" / "teaching" / "measurement-vocabulary.yaml")
        selected_parents = {row["id"].rsplit("-s", 1)[0] for row in cohort}
        self.assertFalse(selected_parents & {
            "ko-nikl-08778", "ko-nikl-10502", "ko-nikl-10770", "ko-nikl-10771",
            "ko-nikl-10772", "ko-nikl-14414", "ko-nikl-32848", "ko-nikl-34999",
            "ko-nikl-40633", "ko-nikl-40634", "ko-nikl-40636", "ko-nikl-46088",
        })

    def test_measurement_actual_adverbs_deepen_predicates_without_absorbing_measure_nouns(self):
        identities = self.references.lexical_identity
        for base, adverb in (
            ("ko-nikl-15283-s001", "ko-nikl-15288-s006"),
            ("ko-nikl-33239-s002", "ko-nikl-33259-s001"),
            ("ko-nikl-33312-s002", "ko-nikl-33317-s002"),
            ("ko-nikl-41623-s001", "ko-nikl-41628-s001"),
        ):
            self.assertEqual(identities[base], identities[adverb])
        for noun, adverb in (
            ("ko-nikl-15287-s001", "ko-nikl-15288-s001"),
            ("ko-nikl-33258-s001", "ko-nikl-33259-s001"),
            ("ko-nikl-33316-s001", "ko-nikl-33317-s001"),
        ):
            self.assertNotEqual(identities[noun], identities[adverb])
        self.assertIn("high-pitched", self.references.vocabulary["ko-nikl-15283-s007"]["ds"])
        self.assertIn("sound intensity", self.references.vocabulary["ko-nikl-15283-s012"]["ds"])
        self.assertIn("loudly or", self.references.vocabulary["ko-nikl-15288-s006"]["ds"])
        self.assertEqual(self.references.provenance["ko-nikl-15288-s006"]["source_position"], 6)
        self.assertEqual(self.references.vocabulary["ko-nikl-15288-s006"]["pr"], "노피")

    def test_measurement_source_admission_and_readings_preserve_complete_real_evidence(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "measurement-notes.yaml")
        rows = load_yaml(authoring / "measurement-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requested = notes["source"]["support_parent_ids"]
        self.assertEqual(len(rows), 93)
        self.assertEqual(len(requested), 31)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requested), 35)
        for item in requested:
            parent = parents[item]
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertEqual(
                [sense["source_position"] for sense in parent["senses"]],
                list(range(1, len(parent["senses"]) + 1)),
            )
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")
        for item, official in notes["reading_review"]["explicit_crosswalks"].items():
            first_selected = next(row["id"] for row in rows if row["id"].startswith(item + "-s"))
            self.assertEqual(self.references.provenance[first_selected]["reading"]["official_entry_id"], official)

    def test_measurement_leftovers_multiples_and_optical_ratio_keep_actual_meanings(self):
        words, sources, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        for suffix, marker in ((1, "remaining"), (2, "unfinished"), (3, "result"), (4, "division")):
            item = f"ko-nikl-34196-s{suffix:03d}"
            self.assertIn(marker, words[item]["ds"])
            self.assertEqual(identities[item], identities["ko-nikl-34196-s001"])
        self.assertIn("double", words["ko-nikl-40635-s001"]["ds"])
        self.assertIn("multiple", words["ko-nikl-40635-s002"]["ds"])
        self.assertEqual(identities["ko-nikl-40635-s001"], identities["ko-nikl-40635-s002"])
        self.assertIn("apparent-to-actual", words["ko-nikl-40670-s001"]["ds"])
        self.assertIn("ratio of the actual size", sources["ko-nikl-40670-s001"]["source_english"])
        self.assertIn("after filling", words["ko-nikl-47094-s001"]["ds"])
        self.assertIn("unused", sources["ko-nikl-47094-s001"]["source_english"])

    def test_measurement_public_description_does_not_claim_more_than_its_source(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("dispersed", words["ko-nikl-06885-s001"]["ds"])
        self.assertNotIn("variance", words["ko-nikl-06885-s001"]["ds"])
        self.assertIn("pair matching", words["ko-nikl-17316-s001"]["ds"])
        self.assertIn("spending", words["ko-nikl-31881-s002"]["ds"])
        self.assertIn("irregular", words["ko-nikl-32849-s002"]["ds"])
        self.assertIn("ratio or rate", words["ko-nikl-18385-s001"]["ds"])
        self.assertIn("contest", sources["ko-nikl-18385-s001"]["source_english"])
        self.assertIn("specified time", words["ko-nikl-14377-s001"]["ds"])
        self.assertIn("hour", sources["ko-nikl-14377-s001"]["source_english"])
        self.assertIn("set", words["ko-nikl-15283-s003"]["ds"])
        self.assertIn("normal", sources["ko-nikl-15283-s003"]["source_english"])

    def test_interpretive_actions_keep_complete_source_requests_and_actual_readings(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "interpretive-actions-notes.yaml")
        rows = load_yaml(authoring / "interpretive-actions-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["support_parent_requests"]
        self.assertEqual(len(rows), 25)
        self.assertEqual(len(requests), 12)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requests), 30)
        for identifier, request in requests.items():
            parent = parents[identifier]
            self.assertEqual(parent["target"], request["lemma"])
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertEqual(parent["source_part_of_speech"], "동사")
            self.assertEqual([row["korean"] for row in parent["senses"]], request["korean_definitions"])
            self.assertEqual([row["english"] for row in parent["senses"]], request["english_definitions"])
            self.assertEqual(
                {self.references.provenance[row["id"]]["source_position"]
                 for row in rows if row["id"].startswith(identifier + "-s")},
                set(request["selected_positions"]),
            )
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_interpretive_voice_and_compound_pairs_preserve_original_nonmatching_ordinals(self):
        identities, sources = self.references.lexical_identity, self.references.provenance
        for first, second in (
            ("ko-nikl-07830-s004", "ko-nikl-07832-s003"),
            ("ko-nikl-06711-s005", "ko-nikl-06712-s003"),
            ("ko-nikl-33757-s002", "ko-nikl-33759-s002"),
            ("ko-nikl-06295-s001", "ko-nikl-06294-s002"),
        ):
            self.assertEqual(identities[first], identities[second])
            self.assertEqual(sources[first]["source_position"], int(first.rsplit("-s", 1)[1]))
            self.assertEqual(sources[second]["source_position"], int(second.rsplit("-s", 1)[1]))
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertIn("손가락", parents["ko-nikl-33757"]["senses"][0]["korean"])
        self.assertIn("범위나 순위", parents["ko-nikl-33759"]["senses"][0]["korean"])
        self.assertTrue(parents["ko-nikl-06295"]["senses"][1]["korean"].endswith("나타나다."))
        self.assertIn("make", self.references.vocabulary["ko-nikl-06295-s001"]["ds"])
        self.assertIn("emerge", self.references.vocabulary["ko-nikl-06294-s002"]["ds"])

    def test_interpretive_certainty_and_appearance_are_not_source_or_truth_substitutions(self):
        words, identities, sources = (
            self.references.vocabulary, self.references.lexical_identity, self.references.provenance,
        )
        self.assertEqual(identities["ko-nikl-16482-s001"], identities["ko-nikl-16479-s001"])
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-16482"]["source_part_of_speech"], "동사")
        self.assertEqual(parents["ko-nikl-16483"]["source_part_of_speech"], "형용사")
        self.assertIn("judge", words["ko-nikl-16482-s001"]["ds"])
        self.assertIn("better than in reality", words["ko-nikl-18193-s001"]["ds"])
        self.assertIn("훌륭하거나 뛰어나", sources["ko-nikl-18193-s002"]["source_korean"])
        self.assertEqual(identities["ko-nikl-18193-s001"], identities["ko-nikl-18193-s002"])
        self.assertIn("try hard", words["ko-nikl-22228-s005"]["ds"])
        self.assertIn("achieve a goal", words["ko-nikl-30404-s001"]["ds"])
        self.assertIn("flatly reject", words["ko-nikl-11629-s001"]["ds"])

    def test_interpretive_summarizing_elicitation_and_textual_reuse_keep_distinct_scopes(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("roughly", words["ko-nikl-38760-s002"]["ds"])
        self.assertEqual(sources["ko-nikl-38760-s002"]["source_korean"].count("대강"), 2)
        self.assertIn("key points", words["ko-nikl-26316-s002"]["ds"])
        self.assertIn("shorten", words["ko-nikl-04740-s002"]["ds"])
        self.assertIn("elicit", words["ko-nikl-34031-s003"]["ds"])
        self.assertNotIn("강제로", sources["ko-nikl-34031-s003"]["source_korean"])
        self.assertEqual(sources["ko-nikl-34039-s008"]["source_position"], 8)
        self.assertIn("다른 사람의 말이나 글", sources["ko-nikl-34039-s008"]["source_korean"])
        self.assertIn("exaggerated", words["ko-nikl-06711-s005"]["ds"])
        self.assertIn("exaggerated", words["ko-nikl-06712-s003"]["ds"])

    def test_practical_descriptors_do_not_substitute_same_spelling_homographs(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        self.assertEqual(words["ko-nikl-04857-s001"]["ch"], words["ko-nikl-04858-s001"]["ch"])
        self.assertNotEqual(identities["ko-nikl-04857-s001"], identities["ko-nikl-04858-s001"])
        self.assertIn("undeserved", words["ko-nikl-04857-s001"]["ds"])
        self.assertEqual(words["ko-nikl-04857-s001"]["pr"], "애ː매하다")
        self.assertEqual(identities["ko-nikl-22112-s001"], identities["ko-nikl-22106-s001"])
        self.assertIn("different", words["ko-nikl-22112-s001"]["ds"])
        self.assertNotIn("ko-nikl-22111-s001", {
            row["id"] for row in load_yaml(
                self.root / "authoring" / "teaching" / "practical-descriptors-vocabulary.yaml"
            )
        })
        self.assertNotEqual(identities["ko-nikl-10780-s001"], identities["ko-nikl-10769-s001"])
        self.assertIn("normal state", words["ko-nikl-10780-s001"]["ds"])
        self.assertIn("what one knew", words["ko-nikl-10780-s002"]["ds"])
        self.assertIn("seem dubious", words["ko-nikl-10780-s003"]["ds"])

    def test_practical_descriptors_preserve_specific_action_and_state_pos(self):
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        self.assertEqual(parents["ko-nikl-22127"]["source_part_of_speech"], "동사")
        self.assertEqual(parents["ko-nikl-22128"]["source_part_of_speech"], "형용사")
        identities, words = self.references.lexical_identity, self.references.vocabulary
        self.assertEqual(identities["ko-nikl-22127-s001"], identities["ko-nikl-22128-s001"])
        self.assertIn("designate", words["ko-nikl-22127-s001"]["ds"])
        self.assertIn("identified and fixed", words["ko-nikl-22128-s001"]["ds"])
        for item, official in (("ko-nikl-22127-s001", "93769"), ("ko-nikl-22128-s001", "83028")):
            self.assertEqual(self.references.provenance[item]["reading"]["official_entry_id"], official)
            self.assertEqual(words[item]["pr"], "특쩡하다")

    def test_practical_descriptors_add_real_counterparts_without_extra_family_breadth(self):
        identities = self.references.lexical_identity
        for base, addition in (
            ("ko-nikl-07380-s001", "ko-nikl-07381-s001"),
            ("ko-nikl-25192-s002", "ko-nikl-25116-s002"),
            ("ko-nikl-37029-s001", "ko-nikl-37027-s001"),
            ("ko-nikl-51771-s001", "ko-nikl-51770-s001"),
        ):
            self.assertEqual(identities[base], identities[addition])
        for suffix in ("001", "002", "003"):
            self.assertEqual(identities["ko-nikl-09580-s004"], identities[f"ko-nikl-09580-s{suffix}"])
        self.assertEqual(self.references.vocabulary["ko-nikl-51770-s001"]["pr"], "화견하다")
        self.assertIn("wide gaps", self.references.vocabulary["ko-nikl-19119-s002"]["ds"])
        self.assertEqual(identities["ko-nikl-19119-s002"], identities["ko-nikl-19119-s001"])

    def test_practical_descriptor_admission_and_readings_use_complete_actual_sources(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "practical-descriptors-notes.yaml")
        rows = load_yaml(authoring / "practical-descriptors-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["source"]["support_parent_ids"]
        self.assertEqual(len(rows), 36)
        self.assertEqual(len(requests), 18)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requests), 23)
        for identifier in requests:
            parent = parents[identifier]
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertEqual(
                [row["source_position"] for row in parent["senses"]],
                list(range(1, len(parent["senses"]) + 1)),
            )
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")

    def test_practical_descriptors_preserve_ease_clarity_and_limited_suitability(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("few difficulties", words["ko-nikl-37946-s001"]["ds"])
        self.assertIn("no conspicuous", words["ko-nikl-37946-s002"]["ds"])
        self.assertIn("temperament", words["ko-nikl-37946-s003"]["ds"])
        self.assertIn("very easy", words["ko-nikl-49171-s001"]["ds"])
        self.assertEqual(sources["ko-nikl-49171-s001"]["source_english"], "Not difficult.")
        self.assertNotIn("easy", words["ko-nikl-26183-s001"]["ds"])
        self.assertIn("easy", sources["ko-nikl-26183-s001"]["source_english"])
        self.assertEqual(words["ko-nikl-26217-s001"]["ds"], "to be simple and clear")
        self.assertIn("Spoken or written", sources["ko-nikl-26217-s001"]["source_english"])
        self.assertIn("words or actions", words["ko-nikl-46520-s001"]["ds"])
        self.assertIn("between alternatives", words["ko-nikl-46520-s002"]["ds"])
        self.assertIn("seems dubious", words["ko-nikl-46520-s003"]["ds"])

    def test_financial_accounts_books_and_operations_keep_their_actual_scope(self):
        words, sources, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        self.assertIn("savings and loans", words["ko-nikl-28712-s001"]["ds"])
        self.assertIn("passbook", words["ko-nikl-21768-s001"]["ds"])
        self.assertNotEqual(identities["ko-nikl-28712-s001"], identities["ko-nikl-21768-s001"])
        self.assertIn("into", words["ko-nikl-11788-s001"]["ds"])
        self.assertIn("out of", words["ko-nikl-45689-s001"]["ds"])
        self.assertIn("one financial account to another", words["ko-nikl-10979-s001"]["ds"])
        self.assertEqual(sources["ko-nikl-11297-s002"]["source_position"], 2)
        self.assertIn("deposited", words["ko-nikl-11297-s002"]["ds"])
        self.assertIn("맡겨 둔 돈", sources["ko-nikl-11297-s002"]["source_korean"])

    def test_financial_remaining_money_and_existing_polysemy_do_not_add_multiple_roots(self):
        words, identities = self.references.vocabulary, self.references.lexical_identity
        for suffix, marker in ((1, "after spending"), (2, "unpaid"), (3, "last installment")):
            item = f"ko-nikl-12550-s{suffix:03d}"
            self.assertIn(marker, words[item]["ds"])
            self.assertEqual(identities[item], identities["ko-nikl-12550-s001"])
        for parent in ("13513", "48902"):
            self.assertEqual(identities[f"ko-nikl-{parent}-s001"], identities[f"ko-nikl-{parent}-s002"])
        self.assertIn("goods", words["ko-nikl-48902-s002"]["ds"])
        self.assertIn("accumulating", words["ko-nikl-13513-s001"]["ds"])
        self.assertIn("borrowed things", words["ko-nikl-09307-s001"]["ds"])
        self.assertIn("borrowed money", words["ko-nikl-10893-s001"]["ds"])
        self.assertIn("deposited", self.references.provenance["ko-nikl-32424-s001"]["source_english"])

    def test_financial_statements_requirements_and_fees_do_not_claim_completed_collection(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("requiring", words["ko-nikl-30139-s001"]["ds"])
        self.assertIn("collecting", sources["ko-nikl-30139-s001"]["source_english"])
        self.assertIn("money amounts", words["ko-nikl-37272-s001"]["ds"])
        self.assertIn("goods", sources["ko-nikl-37272-s001"]["source_english"])
        self.assertIn("requesting money, goods", words["ko-nikl-44802-s001"]["ds"])
        self.assertIn("promised", words["ko-nikl-49986-s001"]["ds"])
        self.assertIn("days overdue", words["ko-nikl-47572-s001"]["ds"])
        self.assertIn("annual earnings", words["ko-nikl-00678-s001"]["ds"])
        self.assertNotEqual(
            self.references.lexical_identity["ko-nikl-44800-s001"],
            self.references.lexical_identity["ko-nikl-44802-s001"],
        )

    def test_financial_source_admission_preserves_every_position_and_actual_reading(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "financial-exchanges-notes.yaml")
        rows = load_yaml(authoring / "financial-exchanges-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requested = notes["source"]["support_parent_ids"]
        self.assertEqual(len(rows), 30)
        self.assertEqual(len(requested), 17)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requested), 19)
        for item in requested:
            parent = parents[item]
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertEqual(parent["source_part_of_speech"], "명사")
            self.assertEqual(
                [row["source_position"] for row in parent["senses"]],
                list(range(1, len(parent["senses"]) + 1)),
            )
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")
        self.assertFalse({row["id"].rsplit("-s", 1)[0] for row in rows} & {
            "ko-nikl-06665", "ko-nikl-10913", "ko-nikl-12549", "ko-nikl-12893",
            "ko-nikl-13589", "ko-nikl-29966", "ko-nikl-31148", "ko-nikl-48903", "ko-nikl-48904",
        })

    def test_cultural_loanword_synonyms_do_not_silently_become_spelling_variants(self):
        identities = self.references.lexical_identity
        for new, related, expected in (
            ("20153", "46993", "ko-lex-20153"),
            ("20313", "47492", "ko-lex-20313"),
            ("22619", "04906", "ko-lex-22619"),
        ):
            self.assertEqual(identities[f"ko-nikl-{new}-s001"], expected)
            self.assertNotEqual(identities[f"ko-nikl-{new}-s001"], identities[f"ko-nikl-{related}-s001"])
        rows = load_yaml(self.root / "authoring" / "teaching" / "culture-loanwords-vocabulary.yaml")
        self.assertEqual(len(rows), 9)
        self.assertEqual(len({identities[row["id"]] for row in rows}), 9)
        self.assertEqual(Counter(row["level"] for row in rows), {8: 4, 10: 4, 12: 1})

    def test_cultural_source_frames_and_foreign_film_dubbing_remain_explicit(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("work or study", words["ko-nikl-20153-s001"]["ds"])
        self.assertIn("held beforehand", words["ko-nikl-20313-s001"]["ds"])
        self.assertIn("sports, arts", words["ko-nikl-22619-s001"]["ds"])
        for parent in ("40844", "39951", "48342"):
            self.assertIn("source", words[f"ko-nikl-{parent}-s001"]["ds"])
        self.assertIn("instrumental", words["ko-nikl-40844-s001"]["ds"])
        self.assertIn("African American", words["ko-nikl-13208-s001"]["ds"])
        self.assertEqual(words["ko-nikl-20975-s001"]["ds"], "Western classical music")
        self.assertIn("mainly", words["ko-nikl-39951-s001"]["ds"])
        self.assertIn("주로", sources["ko-nikl-39951-s001"]["source_korean"])
        self.assertNotIn("mainly", sources["ko-nikl-39951-s001"]["source_english"])
        self.assertIn("all-sung", words["ko-nikl-48342-s001"]["ds"])
        self.assertIn("전부", sources["ko-nikl-48342-s001"]["source_korean"])
        self.assertIn("voice actors recording translated dialogue", words["ko-nikl-17510-s001"]["ds"])
        self.assertIn("foreign film", words["ko-nikl-17510-s001"]["ds"])

    def test_cultural_source_admission_preserves_complete_positions_and_exclusions(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "culture-loanwords-notes.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["support_parent_requests"]
        self.assertEqual(set(requests), {f"ko-nikl-{item}" for item in (
            "13208", "17510", "20313", "39951", "40844",
        )})
        for identifier, request in {
            **notes["retained_selected_source_records"], **requests,
        }.items():
            parent = parents[identifier]
            self.assertEqual(parent["target"], request["lemma"])
            self.assertEqual(parent["source_part_of_speech"], "명사")
            self.assertEqual(parent["source_band"], request["source_band"])
            self.assertEqual(parent["senses"], request["senses"])
            if identifier in requests:
                self.assertEqual(parent["source_band"], "unbanded")
                self.assertIsNone(parent["reference_level"])
        for parent in ("22620", "22621", "40845", "20638"):
            self.assertNotIn(f"ko-nikl-{parent}-s001", self.references.vocabulary)
        self.assertNotIn("ko-nikl-02744-s001", self.references.vocabulary)
        self.assertIn("ko-nikl-02744-s002", self.references.vocabulary)

    def test_cultural_readings_are_explicit_unreviewed_proposals_not_official_text(self):
        authoring = self.root / "authoring" / "teaching"
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        overlay = load_yaml(self.root / "reading-overlay.yaml")["entries"]
        expected = {
            "13208": ("재즈", "24962"), "17510": ("더빙", "47393"),
            "20153": ("레저", "15537"), "20313": ("리허설", "50155"),
            "20975": ("클래식", "49262"), "22619": ("팬", "71314"),
            "39951": ("발레", "15454"), "40844": ("밴드", "58620"),
            "48342": ("오페라", "22019"),
        }
        for parent, (pronunciation, official) in expected.items():
            identifier = f"ko-nikl-{parent}"
            self.assertEqual(overlay[identifier]["official_entry_id"], official)
            self.assertEqual(overlay[identifier]["pronunciations"], [])
            decision = decisions[identifier]
            self.assertEqual(decision["pronunciations"], [pronunciation])
            self.assertEqual(decision["method"], "authored-broad-hangul")
            self.assertEqual(decision["review_status"], "unreviewed")
            source = self.references.provenance[f"{identifier}-s001"]["reading"]
            self.assertEqual(source["method"], "authored-broad-hangul")
            self.assertEqual(source["review_status"], "unreviewed")
            self.assertEqual(self.references.vocabulary[f"{identifier}-s001"]["pr"], pronunciation)
        self.assertEqual(overlay["ko-nikl-20153"]["match_method"], "explicit-crosswalk")
        self.assertIn("unassessed", decisions["ko-nikl-48342"]["reason"])
        self.assertIn("ㄹ+ㄹ", decisions["ko-nikl-39951"]["reason"])
        self.assertIn("unreleased", decisions["ko-nikl-20975"]["reason"])

    def test_environmental_homographs_do_not_merge_on_spelling_or_reading(self):
        identities, words = self.references.lexical_identity, self.references.vocabulary
        for first, second in (
            ("09814", "09815"), ("15173", "15174"), ("15250", "15251"),
            ("20477", "20478"), ("23905", "23906"), ("40502", "40503"),
        ):
            self.assertNotEqual(identities[f"ko-nikl-{first}-s001"], identities[f"ko-nikl-{second}-s001"])
        for parent in ("46193", "46195", "46196", "46198"):
            self.assertNotEqual(identities["ko-nikl-46197-s001"], identities[f"ko-nikl-{parent}-s001"])
        self.assertEqual(words["ko-nikl-20477-s001"]["pr"], words["ko-nikl-20478-s001"]["pr"])
        notes = load_yaml(self.root / "authoring" / "teaching" / "environmental-resources-notes.yaml")
        origins = notes["identity_adjudications"]["actual_erosion_origin_evidence"]
        self.assertEqual(origins["ko-nikl-20477"]["origin"], "侵蝕")
        self.assertEqual(origins["ko-nikl-20478"]["origin"], "浸蝕")
        self.assertIn("outside influence", words["ko-nikl-20477-s001"]["ds"])
        self.assertIn("land or rock", words["ko-nikl-20478-s001"]["ds"])

    def test_environmental_polysemy_and_actual_derivations_preserve_family_breadth(self):
        identities = self.references.lexical_identity
        for parent in ("05155", "06961", "13118", "14745", "15152", "21871", "23906",
                       "42765", "46514", "47506", "51619"):
            self.assertEqual(identities[f"ko-nikl-{parent}-s001"], identities[f"ko-nikl-{parent}-s002"])
        for position in (3, 4):
            self.assertEqual(identities["ko-nikl-13118-s001"],
                             identities[f"ko-nikl-13118-s{position:03d}"])
        self.assertEqual(identities["ko-nikl-09815-s001"], identities["ko-nikl-09816-s001"])
        self.assertEqual(identities["ko-nikl-24690-s001"], identities["ko-nikl-01680-s001"])
        self.assertNotEqual(identities["ko-nikl-24690-s001"], identities["ko-nikl-01681-s001"])
        self.assertNotEqual(identities["ko-nikl-06009-s001"], identities["ko-nikl-05944-s001"])
        self.assertNotEqual(identities["ko-nikl-48258-s001"], identities["ko-nikl-23906-s001"])

    def test_environmental_resource_scope_does_not_add_technical_or_health_claims(self):
        words, sources = self.references.vocabulary, self.references.provenance
        self.assertIn("mushrooms", words["ko-nikl-46197-s001"]["ds"])
        self.assertIn("economic use", words["ko-nikl-11706-s001"]["ds"])
        self.assertIn("abundant", words["ko-nikl-46514-s002"]["ds"])
        self.assertNotIn("abundant", words["ko-nikl-46514-s001"]["ds"])
        self.assertIn("or the catch", words["ko-nikl-46598-s001"]["ds"])
        self.assertIn("캐냄", sources["ko-nikl-46598-s001"]["source_korean"])
        self.assertIn("rainwater", words["ko-nikl-23906-s001"]["ds"])
        self.assertIn("facility", words["ko-nikl-23906-s002"]["ds"])
        self.assertEqual(words["ko-nikl-24690-s001"]["ds"], "the surface of the sea")
        self.assertIn("river or a lake", words["ko-nikl-47506-s001"]["ds"])
        self.assertIn("river or lake", words["ko-nikl-47506-s002"]["ds"])
        self.assertIn("지도를 받으면서", sources["ko-nikl-15250-s001"]["source_korean"])
        self.assertIn("guidance", words["ko-nikl-15250-s001"]["ds"])
        self.assertIn("lower skill than another", words["ko-nikl-23905-s001"]["ds"])
        self.assertIn("clearing the mind", words["ko-nikl-14745-s002"]["ds"])
        for parent in ("40359", "37938", "50134", "15153", "20479", "46194", "48257"):
            self.assertNotIn(f"ko-nikl-{parent}-s001", words)

    def test_environmental_source_admissions_and_citations_remain_exact(self):
        authoring = self.root / "authoring" / "teaching"
        rows = load_yaml(authoring / "environmental-resources-vocabulary.yaml")
        notes = load_yaml(authoring / "environmental-resources-notes.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["source"]["support_parent_ids"]
        self.assertEqual(len(rows), 51)
        self.assertEqual(len({row["id"].rsplit("-s", 1)[0] for row in rows}), 42)
        self.assertEqual(len(requests), 33)
        self.assertEqual(sum(len(parents[item]["senses"]) for item in requests), 41)
        for item in requests:
            self.assertEqual(parents[item]["source_band"], "unbanded")
            self.assertIsNone(parents[item]["reference_level"])
            self.assertEqual(
                [sense["source_position"] for sense in parents[item]["senses"]],
                list(range(1, len(parents[item]["senses"]) + 1)),
            )
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")
        words = self.references.vocabulary
        for parent, expected in (
            ("05155", "범ː남"), ("06009", "보권"), ("11706", "이멉"),
            ("43288", "질쏘"), ("45621", "축쩍"), ("47506", "여난"),
            ("21871", "퇴적 / 퉤적"), ("46598", "어획 / 어훽"),
            ("24779", "핵폐기물 / 핵페기물"),
        ):
            self.assertEqual(words[f"ko-nikl-{parent}-s001"]["pr"], expected)
        for short, long in (("09814", "09815"), ("15173", "15174"), ("15251", "15250"), ("40502", "40503")):
            self.assertNotIn("ː", words[f"ko-nikl-{short}-s001"]["pr"])
            self.assertIn("ː", words[f"ko-nikl-{long}-s001"]["pr"])

    def test_environmental_corrections_keep_low_tide_glaciers_and_heat_distinct(self):
        words, sources = self.references.vocabulary, self.references.provenance
        for parent, position, original, corrected in (
            ("01979", 1, "proportion", "density"),
            ("06961", 2, "deep-rooted", "accumulated"),
            ("13118", 1, "dying", "point of death"),
            ("21871", 2, "iceberg", "glaciers"),
            ("26287", 1, "flood tide", "water recedes"),
            ("42765", 2, "Hot air", "heat at the ground surface"),
        ):
            item = f"ko-nikl-{parent}-s{position:03d}"
            self.assertIn(original, sources[item]["source_english"])
            self.assertIn(corrected, words[item]["ds"])
            self.assertEqual(sources[item]["source_correction"]["review_status"], "unreviewed")
        self.assertIn("or that time", words["ko-nikl-36154-s001"]["ds"])
        self.assertNotIn("time", words["ko-nikl-26287-s001"]["ds"])
        self.assertIn("inside the earth", words["ko-nikl-42765-s001"]["ds"])

    def test_movement_retrieval_keeps_source_condition_and_come_go_contrast(self):
        words, sources, identities = (
            self.references.vocabulary, self.references.provenance, self.references.lexical_identity,
        )
        self.assertIn("to go", words["ko-nikl-44266-s001"]["ds"])
        self.assertIn("to come", words["ko-nikl-44274-s001"]["ds"])
        for parent, direction in (("44266", "take it away"), ("44274", "bring it back")):
            item = f"ko-nikl-{parent}-s002"
            self.assertIn("lost, lent or entrusted", words[item]["ds"])
            self.assertIn(direction, words[item]["ds"])
            self.assertEqual(identities[item], "ko-lex-44265")
        self.assertEqual(sources["ko-nikl-44266-s002"]["source_english"],
                         sources["ko-nikl-44274-s002"]["source_english"])
        self.assertNotEqual(words["ko-nikl-44266-s002"]["ds"], words["ko-nikl-44274-s002"]["ds"])

    def test_movement_valency_posture_and_state_changes_keep_actual_frames(self):
        words = self.references.vocabulary
        self.assertIn("deep place", words["ko-nikl-07855-s001"]["ds"])
        self.assertIn("drop and lose", words["ko-nikl-07855-s003"]["ds"])
        self.assertIn("leave out", words["ko-nikl-07855-s004"]["ds"])
        self.assertIn("let a confined", words["ko-nikl-34854-s004"]["ds"])
        self.assertIn("force a person or animal", words["ko-nikl-34031-s002"]["ds"])
        self.assertIn("pull an object", words["ko-nikl-34031-s001"]["ds"])
        self.assertIn("stand", words["ko-nikl-48449-s001"]["ds"])
        self.assertIn("stand lower", words["ko-nikl-34879-s001"]["ds"])
        self.assertIn("a lower grade or position", words["ko-nikl-34879-s002"]["ds"])
        self.assertIn("restore", words["ko-nikl-18652-s002"]["ds"])
        self.assertIn("another state", words["ko-nikl-18257-s003"]["ds"])
        self.assertIn("illness to improve gradually", words["ko-nikl-18257-s004"]["ds"])
        self.assertIn("caught or blocked", words["ko-nikl-27528-s001"]["ds"])
        self.assertIn("no longer do", words["ko-nikl-05256-s005"]["ds"])
        self.assertIn("familiar and friendly impression", words["ko-nikl-16017-s003"]["ds"])

    def test_movement_support_preserves_actual_arrays_pos_and_protected_families(self):
        authoring = self.root / "authoring" / "teaching"
        notes = load_yaml(authoring / "movement-actions-notes.yaml")
        rows = load_yaml(authoring / "movement-actions-vocabulary.yaml")
        parents, _ = sense_index(load_yaml(self.root / "source-senses.yaml"))
        requests = notes["historical_support_requests"]["requests"]
        self.assertEqual(len(rows), 48)
        self.assertEqual(len({row["id"].rsplit("-s", 1)[0] for row in rows}), 24)
        self.assertEqual(len(requests), 4)
        for request in requests:
            parent = parents[request["source_parent"]]
            self.assertEqual(parent["source_part_of_speech"], "동사")
            self.assertEqual(parent["source_band"], "unbanded")
            self.assertIsNone(parent["reference_level"])
            self.assertEqual(
                [(x["source_position"], x["korean"], x["english"]) for x in parent["senses"]],
                [(x["position"], x["source_korean"], x["source_english"]) for x in request["evidence"]],
            )
        identities = self.references.lexical_identity
        self.assertEqual(identities["ko-nikl-36556-s001"], identities["ko-nikl-36519-s003"])
        self.assertEqual(identities["ko-nikl-34031-s001"], identities["ko-nikl-34031-s003"])
        self.assertEqual(identities["ko-nikl-42561-s001"], identities["ko-nikl-42562-s001"])
        self.assertEqual(identities["ko-nikl-42561-s002"], identities["ko-nikl-42562-s001"])
        self.assertEqual(parents["ko-nikl-42562"]["source_part_of_speech"], "형용사")
        self.assertEqual(identities["ko-nikl-40340-s001"], "ko-lex-40335")
        self.assertEqual(identities["ko-nikl-18599-s001"], "ko-lex-18598")
        self.assertNotIn("ko-nikl-40335-s001", self.references.vocabulary)
        self.assertNotIn("ko-nikl-18598-s001", self.references.vocabulary)

    def test_movement_citations_are_actual_text_and_variants_do_not_pad_counts(self):
        authoring = self.root / "authoring" / "teaching"
        rows = load_yaml(authoring / "movement-actions-vocabulary.yaml")
        words = self.references.vocabulary
        for row in rows:
            self.assertEqual(self.references.provenance[row["id"]]["reading"]["method"], "official-text")
        for parent, expected in (
            ("36556", "마지하다"), ("44266", "차자가다"), ("44274", "차자오다"),
            ("07859", "빠ː저나오다"), ("34854", "내ː노타"), ("34874", "내려노타"),
            ("34031", "끄ː러내다"), ("18652", "되돌리다 / 뒈돌리다"),
        ):
            self.assertEqual(words[f"ko-nikl-{parent}-s001"]["pr"], expected)
        for parent in ("07865", "18656", "07858", "27597"):
            self.assertFalse(any(row["id"].startswith(f"ko-nikl-{parent}-") for row in rows))
        self.assertIn("someone's turn", words["ko-nikl-18259-s002"]["ds"])
        self.assertIn("longer roundabout route", words["ko-nikl-18259-s004"]["ds"])
        self.assertIn("face each other", words["ko-nikl-35924-s001"]["ds"])
        self.assertIn("without stopping", words["ko-nikl-42561-s001"]["ds"])
        self.assertIn("treat it lightly", words["ko-nikl-42561-s002"]["ds"])

    def test_coverage_does_not_confuse_parent_sense_spelling_or_free_lemma_counts(self):
        import yaml
        report = yaml.safe_load(self.data.source_outputs[self.root / "teaching" / "coverage.yaml"])
        pool = report["selected_reference_pool"]
        self.assertEqual(pool["selected_senses"], len(self.references.vocabulary))
        self.assertEqual(pool["dictionary_entries"], len({
            self.references.provenance[item]["source_parent"] for item in self.references.vocabulary
        }))
        self.assertEqual(pool["distinct_spellings"], len({
            row["ch"] for row in self.references.vocabulary.values()
        }))
        self.assertEqual(pool["lexical_identities"],
                         pool["free_lemmas"] + pool["bound_forms"] + pool["function_items"])
        self.assertEqual(sum(row["new_free_lemmas"] for row in report["phases"]),
                         report["core"]["free_lemmas"])
        self.assertEqual(report["core_free_lemma_gap_to_lower_guide"],
                         max(0, 5800 - report["core"]["free_lemmas"]))
        self.assertEqual(report["lexical_identity_review_status"], "unreviewed")

    def test_generated_source_evidence_preserves_corrections_and_reading_methods(self):
        import yaml
        report = yaml.safe_load(self.data.source_outputs[self.root / "teaching" / "source-provenance.yaml"])
        self.assertEqual(report["items"], self.references.provenance)
        self.assertEqual(len(report["phrases"]), 47)
        for source in report["phrases"].values():
            self.assertEqual(source["source_id"], "original-ko")
            self.assertEqual(source["reading_method"], "authored-broad-hangul")
            self.assertEqual(source["review_status"], "unreviewed")

    def test_checked_in_source_reports_match_actual_selections(self):
        for path, expected in self.data.source_outputs.items():
            with self.subTest(path=path):
                self.assertEqual(path.read_text(encoding="utf-8"), expected)

    def test_bound_and_function_categories_match_the_explicit_selection_audit(self):
        notes = load_yaml(self.root / "authoring" / "teaching" / "selection-notes.yaml")
        audit = notes["category_adjudication"]
        functions = [identity for group in audit["function_identities_by_role"].values() for identity in group]
        self.assertEqual(len(functions), len(set(functions)))
        categories = {
            self.references.lexical_identity[identifier]: self.references.provenance[identifier]["lexical_category"]
            for identifier in self.references.vocabulary
        }
        self.assertEqual(set(functions), {identity for identity, category in categories.items()
                                          if category == "function-item"})
        self.assertEqual(set(audit["bound_form_identities"]),
                         {identity for identity, category in categories.items() if category == "bound-form"})

    def test_checked_in_tourist_views_match_actual_canonical_course_records(self):
        anchors = {row["id"]: row["anchors"] for row in self.data.inputs["grammar"]}
        outputs, _ = tourist_outputs(
            self.root, self.data.inputs["tourist"], self.references, self.data.inputs["mastery"],
            self.adapter, self.data.construction_dependencies, anchors,
        )
        for path, expected in outputs.items():
            with self.subTest(path=path):
                self.assertEqual(path.read_text(encoding="utf-8"), expected)


class KoreanTouristArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
        authoring = cls.root / "authoring" / "teaching"
        _, senses = sense_index(load_yaml(cls.root / "source-senses.yaml"))
        readings = load_yaml(cls.root / "reading-overlay.yaml")
        decisions = load_yaml(authoring / "reading-decisions.yaml")
        labels = load_yaml(authoring / "support.yaml")
        cls.plan = load_yaml(cls.root / "teaching" / "tourist" / "plan.yaml")
        words = {}
        for identifier, disambiguator in labels.items():
            parent, _ = senses[identifier]
            words[identifier] = {
                "id": identifier, "ch": parent["target"],
                "pr": citation_reading(parent["id"], readings, decisions)[0], "ds": disambiguator,
            }
        originals = {
            entry["id"]: entry
            for number in range(1, 7)
            for entry in load_yaml(cls.root / f"topik-{number}" / "grammar.yaml")
        }
        selected_grammar = {identifier for unit in cls.plan["units"] for identifier in unit["grammar"]}
        patterns = {
            identifier: {"id": identifier, "ch": originals[identifier]["pattern"],
                         "ds": originals[identifier]["english"]}
            for identifier in selected_grammar
        }
        cls.references = ReferenceBundle(
            words, patterns, {identifier: senses[identifier][0]["id"] for identifier in words},
            source_sense_identity={identifier: identifier for identifier in words},
            reading_identity={identifier: word["pr"] for identifier, word in words.items()},
            spelling_identity={identifier: word["ch"] for identifier, word in words.items()},
        )
        cls.adapter = KoreanAdapter()
        cls.adapter.forms = load_yaml(authoring / "phrase-forms.yaml")

    def test_every_real_tourist_phrase_has_known_precise_components(self):
        words, grammar = set(), set()
        phrases = 0
        for unit in self.plan["units"]:
            self.assertLessEqual(len(unit["vocabulary"]), 25)
            self.assertLessEqual(len(unit["grammar"]), 3)
            self.assertTrue(set(unit["review_vocabulary"]) <= words)
            self.assertTrue(set(unit["review_grammar"]) <= grammar)
            self.assertFalse(set(unit["vocabulary"]) & words)
            self.assertFalse(set(unit["grammar"]) & grammar)
            words.update(unit["vocabulary"])
            grammar.update(unit["grammar"])
            context = PhraseContext(
                self.adapter.profile, self.references, frozenset(words), frozenset(grammar),
            )
            for phrase in unit["phrases"]:
                with self.subTest(phrase=phrase["id"]):
                    self.assertLessEqual(len(phrase["ds"]), 64)
                    analysis = analyze_phrase(phrase, context, self.adapter)
                    self.assertEqual(analysis.items, tuple(phrase["items"]))
                    self.assertEqual(analysis.grammar, tuple(phrase["grammar"]))
                    self.assertTrue(all(part.items or part.grammar for part in analysis.realizations))
                    phrases += 1
        self.assertEqual(phrases, 47)
        self.assertEqual(len(words), 66)
        self.assertEqual(len(grammar), 20)
        self.assertIn("ko-nikl-20539-s006", words)  # Payment card, not an arbitrary rectangular card.
        self.assertIn("ko-nikl-35345-s002", words)  # Affirmative response, not the four-counter form.
        self.assertIn("ko-nikl-43778-s008", words)  # Photograph, not stabbing or stamping.
        self.assertIn("ko-nikl-28668-s003", words)  # Paying, not doing arithmetic.

    def test_quick_start_is_independent_and_compact_entries_are_full_records(self):
        outputs, report = tourist_outputs(
            self.root, self.plan, self.references, {"id": "ko-item-mastery"}, self.adapter,
        )
        self.assertEqual(len(outputs), 8)
        self.assertEqual(report["quick_start"]["phrases"], 24)
        import yaml
        directory = self.root / "teaching" / "tourist"
        full = yaml.safe_load(outputs[directory / "sequence.yaml"])
        quick = yaml.safe_load(outputs[directory / "quick-start" / "sequence.yaml"])
        self.assertEqual(quick["units"], full["units"][:5])
        for route, location in ((full, directory), (quick, directory / "quick-start")):
            for kind, fields in (
                ("vocabulary", {"id", "ch", "pr", "ds"}),
                ("grammar", {"id", "ch", "ds"}),
                ("phrases", {"id", "ch", "pr", "ds"}),
            ):
                compact = yaml.safe_load(outputs[location / f"{kind}.min.yaml"])
                self.assertEqual(compact, [entry for unit in route["units"] for entry in unit[kind]])
                self.assertTrue(all(set(entry) == fields for entry in compact))

    def test_real_route_rejects_forward_review_and_uncovered_phrase_material(self):
        plan = deepcopy(self.plan)
        plan["units"][0]["review_vocabulary"].append("ko-nikl-38551-s001")
        with self.assertRaisesRegex(ValueError, "earlier introductions"):
            tourist_outputs(self.root, plan, self.references, {"id": "ko-item-mastery"}, self.adapter)
        plan = deepcopy(self.plan)
        plan["units"][0]["phrases"][0]["ch"] += " 추가"
        with self.assertRaisesRegex(ValueError, "spacing"):
            tourist_outputs(self.root, plan, self.references, {"id": "ko-item-mastery"}, self.adapter)

    def test_route_satisfies_real_construction_dependencies_and_lexical_anchors(self):
        authoring = self.root / "authoring" / "teaching"
        dependencies = load_yaml(authoring / "construction-dependencies.yaml")
        anchors = {row["id"]: row["anchors"] for row in load_yaml(authoring / "grammar.yaml")}
        outputs, report = tourist_outputs(
            self.root, self.plan, self.references, {"id": "ko-item-mastery"}, self.adapter,
            dependencies, anchors,
        )
        self.assertEqual(len(outputs), 8)
        self.assertEqual(report["quick_start"]["phrases"], 24)


if __name__ == "__main__":
    unittest.main()
