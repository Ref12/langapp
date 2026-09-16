"""Strict Korean adapter and checked-in curriculum regressions."""

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
        ):
            notes = load_yaml(self.root / "authoring" / "teaching" / filename)
            for identifier, request in notes["source_correction_requests"].items():
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
