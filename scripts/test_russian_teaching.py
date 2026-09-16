"""Offline checks of real Russian authoring and source-derived tourist inputs.

Generated program views are checked separately by test_russian_program.py.
"""

from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
import re
import unittest

import yaml

from curriculum_yaml import CurriculumLoader, load_yaml as load_document
from russian_curriculum_adapter import RussianReferences, grammar_inputs
from russian_source import (
    english_source_span, fingerprint, load_selections, source_locator, source_reading, unstress,
)


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "russian"
WORD = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")
NORMALIZED_FIELDS = {
    "id", "target", "reading", "english", "part_of_speech", "topic",
    "source_id", "source_entry", "level_basis",
}
VOCABULARY_FIELDS = {"id", "ch", "pr", "ds"}
GRAMMAR_FIELDS = {"id", "ch", "ds"}
PHASES = (
    ("first-exchanges", range(1, 5)),
    ("everyday-life", range(5, 9)),
    ("stories-conversations", range(9, 14)),
    ("explanation-problems", range(14, 19)),
    ("analysis-argument", range(19, 25)),
    ("nuance-interpretation", range(25, 31)),
)
BRANCHES = {"professional": 18, "technical": 18, "scientific": 24, "literary": 24}
TOPICS = {
    "communication", "people", "home", "clothing", "food", "health", "travel",
    "services", "leisure", "learning", "work", "money", "time", "actions",
    "description", "feelings", "reasoning", "grammar", "society", "institutions",
    "media", "technology", "nature", "science", "history", "culture", "arts",
    "argument", "register", "literature",
}


class RussianTeachingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.program = load_document(ROOT / "teaching" / "program.yaml")
        cls.mastery = load_document(ROOT / "teaching" / "mastery.yaml")
        cls.primary = load_document(ROOT / "authoring" / "vocabulary.yaml")
        cls.selections = load_selections(ROOT)
        cls.references = RussianReferences(ROOT)
        cls.normalized = load_document(ROOT / "reference" / "vocabulary.yaml")
        cls.report = load_document(ROOT / "normalization-report.yaml")
        cls.grammar_rows = load_document(ROOT / "authoring" / "grammar.yaml")
        cls.authored_grammar = {row["id"]: row for row in cls.grammar_rows}
        cls.patterns, cls.placements, cls.dependencies, cls.grammar_outputs = grammar_inputs(
            ROOT, cls.references,
        )
        cls.anchors = {row["id"]: row["anchors"] for row in cls.placements}
        cls.linked_forms = load_document(ROOT / "build" / "linked-forms.yaml")
        cls.fixed_rows = load_document(ROOT / "build" / "grammar-forms.yaml")
        cls.fixed_forms = {row["id"]: row for row in cls.fixed_rows}
        cls.plan = load_document(ROOT / "teaching" / "tourist" / "plan.yaml")
        cls.draft = load_document(ROOT / "authoring" / "tourist-draft.yaml")
        cls.bindings = load_document(ROOT / "authoring" / "tourist-bindings.yaml")
        cls.phrases = {
            phrase["id"]: phrase for unit in cls.plan["units"] for phrase in unit["phrases"]
        }
        cls.draft_phrases = {
            phrase["id"]: phrase for unit in cls.draft["units"] for phrase in unit["phrases"]
        }
        cls.source_rows = {
            entry["source_entry"]: entry["source_data"]
            for entry in cls.references.expanded.values()
        }
        cls.source_rows.update({
            form["source_entry"]: form["source_data"]
            for form in cls.linked_forms + cls.fixed_rows
        })

    def test_thirty_levels_have_named_observable_goals_and_fresh_checkpoints(self):
        self.assertEqual(self.program["schema_version"], 1)
        self.assertEqual(self.program["id"], "ru-practical")
        self.assertEqual(self.program["language"], "russian")
        levels = self.program["levels"]
        self.assertEqual([level["number"] for level in levels], list(range(1, 31)))
        self.assertEqual(len({level["title"] for level in levels}), 30)
        self.assertEqual(len({level["checkpoint"] for level in levels}), 30)
        for level in levels:
            with self.subTest(level=level["number"]):
                self.assertEqual(set(level), {"number", "title", "goals", "checkpoint"})
                self.assertIs(type(level["number"]), int)
                self.assertTrue(level["title"].strip())
                self.assertGreater(len(level["checkpoint"].split()), 8)
                self.assertIsInstance(level["goals"], list)
                self.assertIn(len(level["goals"]), range(2, 5))
                self.assertEqual(len(level["goals"]), len(set(level["goals"])))
                for goal in level["goals"]:
                    self.assertIsInstance(goal, str)
                    self.assertGreater(len(goal.split()), 4)
                    self.assertNotRegex(goal.casefold(), r"^(know|learn|memorize|be familiar)\b")

    def test_exact_phase_partitions_topics_and_optional_branch_contracts(self):
        self.assertEqual(
            [(phase["id"], phase["levels"]) for phase in self.program["phases"]],
            [(identifier, list(levels)) for identifier, levels in PHASES],
        )
        self.assertEqual(
            [phase["target_new_headwords"] for phase in self.program["phases"]],
            [200, 500, 800, 1100, 1400, 1800],
        )
        self.assertEqual(set(self.program["topics"]), TOPICS)
        extensions = self.program["extensions"]
        self.assertEqual(len(extensions), len(BRANCHES))
        self.assertEqual({row["id"]: row["after_level"] for row in extensions}, BRANCHES)
        self.assertEqual(
            {row["id"]: row["mastery_target"] for row in extensions},
            {branch: "independent-use" if branch == "professional" else "understand"
             for branch in BRANCHES},
        )

    def test_all_core_levels_and_branches_have_authored_vocabulary_and_grammar(self):
        destinations = set(range(1, 31)) | set(BRANCHES)
        self.assertEqual({row["level"] for row in self.primary}, destinations)
        self.assertEqual({row["level"] for row in self.grammar_rows}, destinations)
        self.assertEqual(len(self.authored_grammar), len(self.grammar_rows))
        for row in self.primary + self.grammar_rows:
            with self.subTest(item=row["id"]):
                self.assertIn(row["topic"], TOPICS)
                if not isinstance(row["level"], str):
                    self.assertIs(type(row["level"]), int)
        for row in self.grammar_rows:
            with self.subTest(grammar=row["id"]):
                self.assertGreaterEqual(len(row["examples"]), 2)
                self.assertTrue(row["english"].strip())
                for example in row["examples"]:
                    self.assertEqual(set(example), {"target", "english"})
                    self.assertRegex(example["target"], r"[А-Яа-яЁё]")
                    self.assertRegex(example["english"], r"[A-Za-z]")

    def assert_grammar_graph(self, dependencies):
        self.assertEqual(set(dependencies), set(self.authored_grammar))
        visiting, visited = set(), set()

        def visit(identifier):
            self.assertNotIn(identifier, visiting, f"Construction cycle at {identifier}")
            if identifier in visited:
                return
            visiting.add(identifier)
            destination = self.authored_grammar[identifier]["level"]
            for prerequisite in dependencies[identifier]:
                self.assertIn(prerequisite, self.authored_grammar)
                prior = self.authored_grammar[prerequisite]["level"]
                if isinstance(destination, int):
                    self.assertIs(type(prior), int, "Core construction depends on a branch")
                    self.assertLessEqual(prior, destination, "Later-core grammar dependency")
                elif isinstance(prior, int):
                    self.assertLessEqual(prior, BRANCHES[destination], "Undeclared later core")
                else:
                    self.assertEqual(prior, destination, "Cross-branch grammar dependency")
                visit(prerequisite)
            visiting.remove(identifier)
            visited.add(identifier)

        for identifier in dependencies:
            visit(identifier)
        self.assertEqual(visited, set(self.patterns))

    def test_grammar_dependencies_are_acyclic_and_respect_branch_boundaries(self):
        self.assert_grammar_graph(self.dependencies)
        for placement in self.placements:
            for anchor in placement["anchors"]:
                self.assertIn(anchor, self.references.vocabulary)

    def test_grammar_graph_check_rejects_cycles_and_hidden_branch_dependencies(self):
        first = next(row["id"] for row in self.grammar_rows if row["level"] == 1)
        last = next(row["id"] for row in self.grammar_rows if row["level"] == 30)
        professional = next(
            row["id"] for row in self.grammar_rows if row["level"] == "professional"
        )
        technical = next(row["id"] for row in self.grammar_rows if row["level"] == "technical")
        for identifier, prerequisite in (
            (first, first), (first, last), (professional, last), (professional, technical),
        ):
            changed = deepcopy(self.dependencies)
            changed[identifier].append(prerequisite)
            with self.subTest(item=identifier, prerequisite=prerequisite):
                with self.assertRaises(AssertionError):
                    self.assert_grammar_graph(changed)

    def test_normalized_references_have_nine_fields_and_separate_exact_provenance(self):
        self.assertEqual(len(self.normalized), len(self.references.expanded))
        self.assertEqual(len({row["id"] for row in self.normalized}), len(self.normalized))
        for row in self.normalized:
            with self.subTest(item=row["id"]):
                self.assertEqual(set(row), NORMALIZED_FIELDS)
                entry = self.references.expanded[row["id"]]
                self.assertIn("source_data", entry)
                self.assertIn("selected_source_span", entry)
                self.assertIn("reading_provenance", entry)
                self.assertIn("lexical_identity", entry)
                self.assertEqual(row["english"], entry["disambiguator"])
                self.assertEqual(
                    entry["source_record"]["sha256"], fingerprint(entry["source_data"]),
                )
                raw = entry["source_data"]["translations_en"]
                span = entry["selected_source_span"]
                self.assertEqual(span["field"], "translations_en")
                self.assertEqual(raw[span["start"]:span["end"]], entry["english"])

    def test_recorded_source_spans_identify_whole_english_meanings(self):
        invalid = []
        for entry in self.references.expanded.values():
            raw = entry["source_data"]["translations_en"]
            span = entry["selected_source_span"]
            actual = (span["start"], span["end"])
            try:
                expected = english_source_span(raw, entry["english"])
            except ValueError:
                invalid.append(f"{entry['id']}: {entry['english']!r} has no whole-word source span")
                continue
            if actual != expected:
                invalid.append(f"{entry['id']}: {entry['english']!r} at {actual}, expected {expected}")
        self.assertEqual(invalid, [], "Selected spans include fragments or stale source offsets")

    def test_current_primary_and_support_selections_match_all_build_records(self):
        self.references.validate_curation(self.selections)
        self.assertEqual(
            {row["id"] for row in self.selections}, set(self.references.vocabulary),
            "Normalized references must include primary, grammar, and travel support selections",
        )

    def test_recorded_counts_use_explicit_identity_and_keep_forms_separate(self):
        entries = list(self.references.expanded.values())
        identities = {entry["lexical_identity"] for entry in entries}
        canonical = {
            (entry["lexical_identity"], entry["target"], entry["reading"]) for entry in entries
        }
        derived = [
            form for form in self.references.forms.values()
            if "source_form_column" in form["features"]
        ]
        surfaces = {
            (form["lexical_identity"], form["target"], form["reading"])
            for form in derived + self.linked_forms
        }
        expected = {
            "selected_vocabulary_senses": len(entries),
            "selected_source_records": len({
                (entry["source_record"]["table"], entry["source_record"]["record"])
                for entry in entries
            }),
            "selected_source_sense_spans": len({
                (entry["source_entry"], entry["selected_source_span"]["start"],
                 entry["selected_source_span"]["end"]) for entry in entries
            }),
            "selected_lexical_headwords": len(identities),
            "selected_canonical_spellings": len({entry["target"] for entry in entries}),
            "selected_canonical_readings": len({entry["reading"] for entry in entries}),
            "retained_source_form_records": len(derived),
            "linked_pronoun_form_records": len(self.linked_forms),
            "distinct_noncanonical_lexical_forms": len(surfaces - canonical),
            "fixed_construction_form_records": len(self.fixed_rows),
        }
        for key, count in expected.items():
            with self.subTest(count=key):
                self.assertEqual(self.report[key], count)
        self.assertEqual(
            self.report["reading_kinds"],
            dict(Counter(entry["reading_provenance"]["kind"] for entry in entries)),
        )
        self.assertEqual(len(self.fixed_forms), len(self.fixed_rows))
        self.assertEqual(self.report["selected_orthographic_aliases"],
                         sum(len(row.get("aliases", [])) for row in self.selections))
        self.assertLess(len(identities), len(entries), "Selected additional senses add no headwords")
        for form in derived + self.linked_forms:
            self.assertIn(form["lexical_identity"], identities)
            for sense in form["sense_ids"]:
                self.assertEqual(
                    form["lexical_identity"], self.references.lexical_identity[sense],
                )

    def test_later_phases_introduce_broader_identity_sets_without_a_quota_floor(self):
        by_level = defaultdict(set)
        for row in self.selections:
            if isinstance(row["level"], int):
                by_level[row["level"]].add(row["lexical_identity"])
        introduced, new_counts = set(), []
        for identifier, levels in PHASES:
            current = set().union(*(by_level[level] for level in levels))
            new = current - introduced
            self.assertTrue(new, f"Empty phase breadth: {identifier}")
            new_counts.append(len(new))
            introduced.update(current)
        self.assertEqual(sum(new_counts), len(introduced))
        for earlier, later in zip(new_counts, new_counts[1:]):
            self.assertGreater(later, earlier, f"Later phase breadth did not increase: {new_counts}")

    def selected_senses(self, target):
        return {
            entry["english"]: entry for entry in self.references.expanded.values()
            if entry["target"] == target
        }

    def test_common_nonfirst_senses_are_explicit_and_do_not_inflate_identity(self):
        for target, meanings in (("язык", ("language", "tongue")), ("лёгкий", ("easy", "light"))):
            entries = self.selected_senses(target)
            with self.subTest(target=target):
                self.assertTrue(set(meanings) <= set(entries))
                first, second = (entries[meaning] for meaning in meanings)
                self.assertNotEqual(first["id"], second["id"])
                self.assertEqual(first["lexical_identity"], second["lexical_identity"])
                starts = {entry["selected_source_span"]["start"] for entry in (first, second)}
                self.assertEqual(len(starts), 2)
                self.assertGreater(max(starts), 0)
        pronouns = [self.selected_senses(target) for target in ("он", "она")]
        self.assertEqual(pronouns[0]["he"]["lexical_identity"],
                         pronouns[1]["she"]["lexical_identity"])
        self.assertNotEqual(pronouns[0]["he"]["source_entry"], pronouns[1]["she"]["source_entry"])

    def test_selected_castle_and_lock_keep_their_own_readings_and_identities(self):
        entries = self.selected_senses("замок")
        self.assertTrue({"castle", "lock"} <= set(entries))
        castle, lock = entries["castle"], entries["lock"]
        self.assertEqual(castle["target"], lock["target"])
        self.assertNotEqual(castle["lexical_identity"], lock["lexical_identity"])
        self.assertEqual(castle["reading"], "за́мок")
        self.assertEqual(lock["reading"], "замо́к")

    def test_canonical_compact_entries_and_original_grammar_match_their_references(self):
        for row in self.normalized:
            compact = self.references.vocabulary[row["id"]]
            with self.subTest(item=row["id"]):
                self.assertEqual(set(compact), VOCABULARY_FIELDS)
                self.assertEqual(compact, {
                    "id": row["id"], "ch": row["target"],
                    "pr": row["reading"], "ds": row["english"],
                })
                self.assertGreater(len(compact["ds"]), 0)
                self.assertLessEqual(len(compact["ds"]), 64)
        self.assertEqual(set(self.patterns), set(self.authored_grammar))
        for identifier, pattern in self.patterns.items():
            self.assertEqual(set(pattern), GRAMMAR_FIELDS)
            self.assertEqual(
                pattern, {key: self.authored_grammar[identifier][key] for key in GRAMMAR_FIELDS},
            )
            self.assertLessEqual(len(pattern["ds"]), 64)
        self.assertEqual(set(self.grammar_outputs), {ROOT / "reference" / "grammar.yaml"})
        expected = yaml.load(
            self.grammar_outputs[ROOT / "reference" / "grammar.yaml"], Loader=CurriculumLoader,
        )
        self.assertEqual(load_document(ROOT / "reference" / "grammar.yaml"), expected)
        self.assertTrue(all(row["source_id"] == "original-ru" for row in expected))

    def assert_route_closed(self, units):
        words, constructions, phrase_ids = set(), set(), set()
        for unit in units:
            new_words, new_grammar = unit["vocabulary"], unit["grammar"]
            self.assertEqual(len(new_words), len(set(new_words)))
            self.assertEqual(len(new_grammar), len(set(new_grammar)))
            self.assertFalse(words & set(new_words), "Repeated lexical introduction")
            self.assertFalse(constructions & set(new_grammar), "Repeated grammar introduction")
            for field, prior in (
                ("review_vocabulary", words), ("review_grammar", constructions),
            ):
                self.assertEqual(len(unit[field]), len(set(unit[field])))
                self.assertTrue(set(unit[field]) <= prior, f"Review borrows a later item: {field}")
            for identifier in new_words + unit["review_vocabulary"]:
                self.assertIn(identifier, self.references.vocabulary)
                self.assertEqual(set(self.references.vocabulary[identifier]), VOCABULARY_FIELDS)
            for identifier in new_grammar + unit["review_grammar"]:
                self.assertIn(identifier, self.patterns)
                self.assertEqual(set(self.patterns[identifier]), GRAMMAR_FIELDS)
            words.update(new_words)
            for identifier in new_grammar:
                self.assertTrue(set(self.dependencies[identifier]) <= constructions,
                                f"Construction precedes a prerequisite: {identifier}")
                self.assertTrue(set(self.anchors[identifier]) <= words,
                                f"Construction anchor not introduced: {identifier}")
                constructions.add(identifier)
            self.assertTrue(unit["phrases"])
            for phrase in unit["phrases"]:
                self.assertNotIn(phrase["id"], phrase_ids)
                phrase_ids.add(phrase["id"])
                self.assertTrue(set(phrase["items"]) <= words,
                                f"Phrase has unintroduced words: {phrase['id']}")
                self.assertTrue(set(phrase["grammar"]) <= constructions,
                                f"Phrase has unintroduced grammar: {phrase['id']}")
                self.assertTrue(set(self.draft_phrases[phrase["id"]]["grammar_ids"])
                                <= set(phrase["grammar"]))
                self.assertEqual(
                    set(phrase["items"]),
                    {item for segment in phrase["realizations"] for item in segment["items"]},
                )
                self.assertEqual(
                    set(phrase["grammar"]),
                    {item for segment in phrase["realizations"] for item in segment["grammar"]},
                )
        return words, constructions, phrase_ids

    def test_tourist_introductions_reviews_and_phrase_dependencies_close_in_order(self):
        self.assertEqual(self.plan["id"], "ru-tourist")
        self.assertEqual(self.plan["schema_version"], 1)
        self.assertEqual(self.plan["language"], "russian")
        self.assertEqual(
            [unit["id"] for unit in self.plan["units"]],
            [unit["id"] for unit in self.draft["units"]],
        )
        words, constructions, phrases = self.assert_route_closed(self.plan["units"])
        self.assertTrue(words)
        self.assertTrue(constructions)
        self.assertEqual(phrases, set(self.draft_phrases))

    def test_first_five_tourist_units_close_without_core_or_later_units(self):
        expected = ["polite-repair", "food-basics", "finding-your-way", "paying", "asking-for-help"]
        self.assertEqual(self.plan["quick_start"], expected)
        self.assertEqual(self.draft["quick_start"], expected)
        prefix = self.plan["units"][:5]
        self.assertEqual([unit["id"] for unit in prefix], expected)
        _, _, phrases = self.assert_route_closed(prefix)
        self.assertEqual(phrases, {
            phrase["id"] for unit in self.draft["units"][:5] for phrase in unit["phrases"]
        })

    def test_closure_check_rejects_a_missing_introduction_and_a_late_review(self):
        changed = deepcopy(self.plan["units"][:5])
        water = self.phrases["ru-tourist-p006"]["items"][0]
        next(unit for unit in changed if water in unit["vocabulary"])["vocabulary"].remove(water)
        with self.assertRaises(AssertionError):
            self.assert_route_closed(changed)
        changed = deepcopy(self.plan["units"][:5])
        introduced = {item for unit in changed for item in unit["vocabulary"]}
        later = next(
            item for unit in self.plan["units"][5:] for item in unit["vocabulary"]
            if item not in introduced
        )
        changed[0]["review_vocabulary"].append(later)
        with self.assertRaises(AssertionError):
            self.assert_route_closed(changed)

    def assert_phrase_forms(self, phrase):
        identifier = phrase["id"]
        draft = self.draft_phrases[identifier]
        self.assertEqual(set(phrase), VOCABULARY_FIELDS | {"items", "grammar", "realizations"})
        self.assertEqual({key: phrase[key] for key in ("id", "ch", "ds")},
                         {key: draft[key] for key in ("id", "ch", "ds")})
        self.assertLessEqual(len(phrase["ds"]), 64)
        segments, bindings = phrase["realizations"], self.bindings[identifier]
        self.assertEqual([segment["ch"] for segment in segments], WORD.findall(phrase["ch"]))
        self.assertEqual(len(segments), len(bindings))
        self.assertEqual(phrase["pr"], " ".join(segment["pr"] for segment in segments))
        for segment, binding in zip(segments, bindings):
            self.assertEqual(set(segment), {"ch", "pr", "items", "grammar", "form_id"})
            locator = source_locator(binding["source_table"], binding["source_record"])
            raw = self.source_rows[locator]
            field = binding["source_field"]
            expected = source_reading(raw[field])[0]
            self.assertEqual(unstress(expected).casefold(), segment["ch"].casefold())
            self.assertEqual(expected.casefold(), segment["pr"].casefold())
            self.assertEqual(segment["ch"][0].isupper(), segment["pr"][0].isupper())
            if binding["kind"] == "lexical":
                self.assertEqual(len(segment["items"]), 1)
                sense = segment["items"][0]
                self.references.validate_form(sense, segment["form_id"],
                                              segment["ch"], segment["pr"])
                form = self.references.forms[segment["form_id"]]
                self.assertEqual(form["source_entry"], locator)
                self.assertEqual(form.get("source_field", "accented"), field,
                                 "Bound source field changed")
                self.assertEqual(
                    self.references.expanded[sense]["english"], binding["source_gloss"],
                    "Same-spelling form borrowed an unrelated source sense",
                )
                self.assertEqual(raw[field], form.get("source_value", raw["accented"]))
            else:
                self.assertEqual(segment["items"], [], "Fixed form awarded lexical credit")
                form = self.fixed_forms[segment["form_id"]]
                self.assertEqual(form["grammar_id"], binding["grammar_id"])
                self.assertIn(form["grammar_id"], segment["grammar"])
                self.assertEqual(form["source_entry"], locator)
                self.assertEqual(form["source_field"], field)
                self.assertEqual(form["reading"].casefold(), segment["pr"].casefold())
                allowed = {
                    word.casefold()
                    for chunk in self.authored_grammar[form["grammar_id"]]["fixed_forms"]
                    for word in WORD.findall(chunk)
                }
                self.assertIn(segment["ch"].casefold(), allowed)

    def test_all_tourist_realizations_are_attested_by_the_explicit_source_bindings(self):
        self.assertEqual(set(self.bindings), set(self.phrases))
        self.assertEqual(len(self.phrases), sum(len(unit["phrases"]) for unit in self.plan["units"]))
        for phrase in self.phrases.values():
            with self.subTest(phrase=phrase["id"]):
                self.assert_phrase_forms(phrase)

    def test_build_form_fingerprints_and_linked_pronoun_identities_are_preserved(self):
        self.assertTrue(self.linked_forms)
        self.assertTrue(self.fixed_rows)
        for form in self.linked_forms + self.fixed_rows:
            with self.subTest(form=form["id"]):
                self.assertEqual(fingerprint(form["source_data"]), form["source_record_sha256"])
                field = form.get("source_field", "accented")
                reading = source_reading(form["source_data"][field])[0]
                self.assertEqual(form["reading"], reading)
                self.assertEqual(form["target"], unstress(reading))
                if "sense_ids" in form:
                    self.assertTrue(form["sense_ids"])
                    for sense in form["sense_ids"]:
                        self.assertEqual(form["lexical_identity"],
                                         self.references.lexical_identity[sense])
                    self.assertEqual(form["linkage_provenance"]["source_id"], "original-ru")
                else:
                    self.assertNotIn("lexical_identity", form)
                    self.assertEqual(form["linkage_source_id"], "original-ru")

    def realization(self, phrase_id, surface):
        matches = [
            segment for segment in self.phrases[phrase_id]["realizations"]
            if segment["ch"].casefold() == surface.casefold()
        ]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_water_travel_cost_and_sugar_use_the_intended_case_sense_and_stress(self):
        examples = (
            ("ru-tourist-p034", "воды", "вода", "water", "sg_gen", "воды́"),
            ("ru-tourist-p029", "еду", "ехать", "drive", "presfut_sg1", "е́ду"),
            ("ru-tourist-p016", "стоит", "стоить", "cost", "presfut_sg3", "сто́ит"),
            ("ru-tourist-p036", "сахара", "сахар", "sugar", "sg_gen", "са́хара"),
        )
        for phrase_id, surface, lemma, meaning, field, reading in examples:
            with self.subTest(surface=surface):
                segment = self.realization(phrase_id, surface)
                entry = self.references.expanded[segment["items"][0]]
                form = self.references.forms[segment["form_id"]]
                self.assertEqual((entry["target"], entry["english"]), (lemma, meaning))
                self.assertEqual(form["source_field"], field)
                self.assertEqual(segment["pr"], reading)

    def test_map_and_payment_card_keep_distinct_senses_under_one_identity(self):
        map_segment = self.realization("ru-tourist-p014", "карте")
        card_segment = self.realization("ru-tourist-p018", "карты")
        map_entry = self.references.expanded[map_segment["items"][0]]
        card_entry = self.references.expanded[card_segment["items"][0]]
        self.assertEqual(map_entry["english"], "map")
        self.assertEqual(card_entry["english"], "card")
        self.assertNotEqual(map_entry["id"], card_entry["id"])
        self.assertEqual(map_entry["lexical_identity"], card_entry["lexical_identity"])
        room_segment = self.realization("ru-tourist-p031", "номер")
        self.assertEqual(self.references.expanded[room_segment["items"][0]]["english"], "room")
        changed = deepcopy(self.phrases["ru-tourist-p018"])
        next(segment for segment in changed["realizations"] if segment["ch"] == "карты")[
            "items"
        ] = [map_entry["id"]]
        with self.assertRaisesRegex(AssertionError, "unrelated source sense"):
            self.assert_phrase_forms(changed)

    def test_referential_eto_reuses_the_demonstrative_identity_and_attested_case(self):
        locator = source_locator("adjectives", 3)
        entries = [
            entry for entry in self.references.expanded.values()
            if entry["source_entry"] == locator and entry["english"] == "this"
        ]
        self.assertEqual(len(entries), 1)
        demonstrative = entries[0]
        self.assertEqual(demonstrative["target"], "этот")
        for phrase_id, field in (
            ("ru-tourist-p015", "decl_n_nom"),
            ("ru-tourist-p017", "decl_n_nom"),
            ("ru-tourist-p044", "decl_n_acc"),
            ("ru-tourist-p050", "decl_n_acc"),
        ):
            with self.subTest(phrase=phrase_id):
                segment = self.realization(phrase_id, "это")
                self.assertEqual(segment["items"], [demonstrative["id"]])
                form = self.references.forms[segment["form_id"]]
                self.assertEqual(form["source_entry"], locator)
                self.assertEqual(form["source_field"], field)
                self.assertEqual(form["lexical_identity"], demonstrative["lexical_identity"])
                self.assertEqual(segment["pr"].casefold(), "э́то")

        fixed_locator = source_locator("others", 10)
        self.assertFalse(
            any(entry["source_entry"] == fixed_locator
                for entry in self.references.expanded.values()),
            "Fixed or inflected это was introduced as another lexical headword",
        )
        for phrase_id in ("ru-tourist-p010", "ru-tourist-p027"):
            with self.subTest(phrase=phrase_id):
                segment = self.realization(phrase_id, "это")
                self.assertEqual(segment["items"], [])
                form = self.fixed_forms[segment["form_id"]]
                self.assertEqual(form["grammar_id"], "ru-g-present-identity")
                self.assertEqual(form["source_entry"], fixed_locator)
                self.assertEqual(form["source_field"], "accented")

    def test_genitive_water_cannot_be_replaced_by_source_attested_plural_water(self):
        changed = deepcopy(self.phrases["ru-tourist-p034"])
        segment = next(item for item in changed["realizations"] if item["ch"] == "воды")
        sense = segment["items"][0]
        plural = next(
            form for form in self.references.forms.values()
            if sense in form["sense_ids"] and form.get("source_field") == "pl_nom"
        )
        segment.update(form_id=plural["id"], pr=plural["reading"])
        changed["pr"] = " ".join(item["pr"] for item in changed["realizations"])
        with self.assertRaises(AssertionError):
            self.assert_phrase_forms(changed)

    def test_existential_and_goodbye_forms_award_no_eating_or_date_sense_credit(self):
        existentials = [
            segment for phrase in self.phrases.values() for segment in phrase["realizations"]
            if segment["ch"].casefold() == "есть"
        ]
        self.assertTrue(existentials)
        for segment in existentials:
            self.assertEqual(segment["items"], [])
            self.assertIn("ru-g-possession-existence", segment["grammar"])
            self.assertEqual(self.fixed_forms[segment["form_id"]]["grammar_id"],
                             "ru-g-possession-existence")
        goodbye = self.phrases["ru-tourist-p060"]
        self.assertEqual(goodbye["items"], [])
        self.assertEqual([segment["ch"] for segment in goodbye["realizations"]], ["До", "свидания"])
        for segment in goodbye["realizations"]:
            self.assertEqual(segment["items"], [])
            self.assertIn("ru-g-polite-repair", segment["grammar"])
        changed = deepcopy(goodbye)
        changed["realizations"][-1]["items"] = [next(iter(self.references.vocabulary))]
        with self.assertRaisesRegex(AssertionError, "lexical credit"):
            self.assert_phrase_forms(changed)

    def test_mastery_keeps_receptive_and_productive_modalities_separate(self):
        self.assertEqual(self.mastery["schema_version"], 1)
        self.assertEqual(self.mastery["id"], "ru-item-mastery")
        self.assertEqual(set(self.mastery), {
            "schema_version", "id", "applies_to", "scope", "unassessed", "modalities",
            "stages", "evidence_fields", "evidence_outcomes", "policy",
        })
        self.assertEqual(set(self.mastery["applies_to"]),
                         {"vocabulary-sense", "grammar-construct", "phrase"})
        receptive = {"reading", "listening"}
        productive = {"typed-production", "spoken-production", "handwriting"}
        self.assertEqual(set(self.mastery["modalities"]), receptive | productive)
        stages = {stage["id"]: stage for stage in self.mastery["stages"]}
        self.assertEqual(set(stages), {"recognize", "understand", "supported-use", "independent-use"})
        for identifier, stage in stages.items():
            with self.subTest(stage=identifier):
                self.assertEqual(set(stage["modalities"]),
                                 receptive if identifier in {"recognize", "understand"} else productive)
                self.assertGreaterEqual(len(stage["evidence"]), 2)
                self.assertTrue(all(isinstance(item, str) for item in stage["evidence"]))
                self.assertTrue(stage["limitation"].strip())
        self.assertEqual(self.mastery["evidence_fields"], [
            "item_id", "stage", "modality", "task_id", "session_id", "observed_at",
            "context", "response", "outcome", "assistance",
        ])
        self.assertEqual(set(self.mastery["evidence_outcomes"]), {"successful", "partial", "unsuccessful"})
        policy = " ".join(self.mastery["policy"]).casefold()
        self.assertIn("actual audio", policy)
        self.assertIn("handwritten sample", policy)
        self.assertIn("invent no learner observations", policy)

    def test_curriculum_and_rubric_contain_no_fabricated_learner_state(self):
        forbidden = {
            "learner_id", "observations", "observed_at", "session_id", "mastered",
            "mastery_score", "assessments", "learner_progress",
        }

        def inspect(value):
            if isinstance(value, dict):
                self.assertFalse(forbidden & set(value), f"Learner state in curriculum: {set(value)}")
                for child in value.values():
                    inspect(child)
            elif isinstance(value, list):
                for child in value:
                    inspect(child)

        for document in (self.program, self.mastery, self.plan, self.report):
            inspect(document)


if __name__ == "__main__":
    unittest.main()
