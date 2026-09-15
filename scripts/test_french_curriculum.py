"""French source fidelity, identity, pronunciation, route and regeneration tests."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import shutil
import tempfile
import unittest

import yaml

from curriculum_yaml import dump_yaml, load_yaml
from import_french_curriculum import (
    KAIKKI_HASH, LEXIQUE_HASH, ROOT, eligible_senses, phonetic_ipa,
    authored_groups, discover_choices, read_projection, reading_candidates, reference_data, reference_outputs, stable_id,
)


def parsed(text: str):
    return yaml.load(text, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))


class FrenchSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.projection = read_projection(ROOT)
        cls.choices = load_yaml(ROOT / "authoring" / "teaching" / "sense-selections.yaml")
        cls.expanded, cls.placements, cls.reference = reference_data(ROOT, cls.projection, cls.choices)
        cls.by_id = {row["id"]: row for row in cls.expanded}
        cls.by_word = {row["lemma"]: row for row in cls.expanded}

    def test_pinned_projection_and_all_source_senses(self):
        self.assertEqual(self.projection["kaikki_source_sha256"], KAIKKI_HASH)
        self.assertEqual(self.projection["lexique_source_sha256"], LEXIQUE_HASH)
        records = {row["record"]: row for row in self.projection["kaikki"]}
        for choice in self.choices:
            record = records[choice["record"]]
            sense = record["senses"][choice["sense_index"]]
            self.assertEqual(choice["source_sense_id"], sense["id"])
            self.assertEqual(choice["id"], stable_id("v", sense["id"]))
            self.assertEqual(self.by_id[choice["id"]]["source_glosses"], sense["glosses"])
            self.assertIn(sense, eligible_senses(
                record, allow_marked=choice.get("allow_marked", False),
                allowed_tags=tuple(choice.get("allowed_tags", [])),
            ))
            self.assertFalse(sense.get("form_of") or sense.get("alt_of"))

    def test_independent_reference_shape_and_labels(self):
        expected = {
            "id", "target", "reading", "english", "part_of_speech",
            "topic", "source_id", "source_entry", "level_basis",
        }
        for row in self.reference:
            self.assertEqual(set(row), expected)
            expanded = self.by_id[row["id"]]
            self.assertEqual(row["target"], expanded["target"])
            self.assertEqual(row["reading"], expanded["reading"])
            self.assertTrue(1 <= len(expanded["disambiguator"]) <= 64)
            self.assertIn("wiktionary.org", expanded["source_history"])

    def test_actual_core_breadth_and_phase_growth(self):
        core = [row for row in self.placements if type(row["level"]) is int]
        self.assertEqual({row["level"] for row in core}, set(range(1, 31)))
        heads = {self.by_id[row["id"]]["headword_id"] for row in core}
        self.assertGreaterEqual(len(heads), 5800)
        self.assertLessEqual(len(heads), 6000)
        seen, counts = set(), []
        for first, last in ((1, 4), (5, 8), (9, 13), (14, 18), (19, 24), (25, 30)):
            current = {self.by_id[row["id"]]["headword_id"] for row in core if first <= row["level"] <= last}
            counts.append(len(current - seen))
            seen.update(current)
        self.assertEqual(counts, sorted(counts))
        for branch in ("professional", "technical", "scientific", "literary"):
            self.assertGreaterEqual(len({row["id"] for row in self.placements if row["level"] == branch}), 30)

    def test_later_meanings_are_not_early_mastery(self):
        selections = {row["source_sense_id"]: row["id"] for row in self.expanded}
        levels = {row["id"]: row["level"] for row in self.placements if type(row["level"]) is int}
        self.assertEqual(levels[selections["en-personne-fr-pron-xCK8GK8O"]], 14)
        self.assertEqual(levels[selections["en-droit-fr-noun-c3YxQKwq"]], 22)
        self.assertGreater(levels[selections["en-appeler-fr-verb-ESt41nz5"]],
                           levels[selections["en-appeler-fr-verb-UG~Hts2y"]])

    def test_conservative_forms_keep_distinct_senses(self):
        for related, base in (("veuve", "veuf"), ("aïeule", "aïeul"), ("travaux", "travail")):
            self.assertEqual(self.by_word[related]["headword_id"], self.by_word[base]["headword_id"])
            self.assertNotEqual(self.by_word[related]["id"], self.by_word[base]["id"])
            self.assertNotEqual(self.by_word[related]["target"], self.by_word[base]["target"])
        holiday = self.by_word["vacance"]
        self.assertEqual(holiday["target"], "vacances")
        self.assertIn("plural-only", holiday["tags"])
        self.assertNotIn("une", self.by_word)
        self.assertNotIn("débutante", self.by_word)

    def test_high_impact_common_sense_choices(self):
        for word, source_id in {
            "hôtel": "en-hôtel-fr-noun-0k58YxE-",
            "billet": "en-billet-fr-noun-FAaUKRUK",
            "droite": "en-droite-fr-noun-elOKo-sg",
            "addition": "en-addition-fr-noun-2K5ayR8V",
            "découvert": "en-découvert-fr-noun-sRqDObWO",
        }.items():
            self.assertEqual(self.by_word[word]["source_sense_id"], source_id)

    def test_lexique_conversion_is_strict_and_disclosed(self):
        self.assertEqual(phonetic_ipa("S9vR"), "/ʃœvʁ/")
        self.assertEqual(phonetic_ipa("@f5"), "/ɑ̃fɛ̃/")
        with self.assertRaises(ValueError):
            phonetic_ipa("unknown?")
        converted = [row for row in self.expanded if row["reading_source"]["source_id"] == "lexique-3.83"]
        self.assertTrue(converted)
        for row in converted:
            self.assertEqual(row["reading"], phonetic_ipa(row["reading_source"]["source_reading"]))
            self.assertIn("not observed audio", row["reading_source"]["status"])

    def test_france_label_does_not_override_historical_exclusion(self):
        row = {"sounds": [
            {"ipa": "/a/", "tags": ["France", "archaic"]},
            {"ipa": "/b/", "tags": ["Quebec"]},
            {"ipa": "/k/", "tags": ["France", "Canada"]},
            {"ipa": "/d/"},
        ]}
        self.assertEqual(reading_candidates(row), [(2, "/k/"), (3, "/d/")])

    def test_source_mutations_and_duplicate_ids_fail(self):
        altered = dict(self.choices[0], pr="/invented/")
        with self.assertRaisesRegex(ValueError, "pronunciation differs from source"):
            reference_data(ROOT, self.projection, [altered, *self.choices[1:]])
        altered = dict(self.choices[0], source_sense_id="not-a-source-identifier")
        with self.assertRaisesRegex(ValueError, "differs from the pinned source"):
            reference_data(ROOT, self.projection, [altered, *self.choices[1:]])
        with self.assertRaisesRegex(ValueError, "Duplicate French sense"):
            reference_data(ROOT, self.projection, [self.choices[0], *self.choices])

    def test_source_lock_and_projection_tampering_fail(self):
        with tempfile.TemporaryDirectory(prefix="french-source-lock-") as temporary:
            root = Path(temporary)
            (root / "source-data").mkdir()
            path = root / "source-data" / "selected-records.json"
            shutil.copy2(ROOT / "source-data" / "selected-records.json", path)
            lock = load_yaml(ROOT / "source-lock.yaml")
            altered = deepcopy(lock)
            altered["kaikki"]["sha256"] = "0" * 64
            (root / "source-lock.yaml").write_text(dump_yaml(altered), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected source snapshots"):
                read_projection(root)
            (root / "source-lock.yaml").write_text(dump_yaml(lock), encoding="utf-8")
            with path.open("ab") as stream:
                stream.write(b"\n")
            with self.assertRaisesRegex(ValueError, "projection hash mismatch"):
                read_projection(root)

    def test_excluded_candidates_are_explicit(self):
        gaps = load_yaml(ROOT / "authoring" / "teaching" / "source-gaps.yaml")
        excluded = {word.strip() for row in gaps for word in row["words"].split("|")}
        self.assertGreater(len(excluded), 200)
        self.assertFalse(excluded & self.by_word.keys())
        self.assertTrue(all(row["reason"].strip() for row in gaps))

    def test_explicit_sense_keeps_core_and_branch_destinations(self):
        with tempfile.TemporaryDirectory(prefix="french-sense-routes-") as temporary:
            root = Path(temporary)
            shutil.copytree(ROOT / "authoring", root / "authoring")
            authoring = root / "authoring" / "teaching"
            additional = load_yaml(authoring / "additional-senses.yaml")
            original = next(row for row in additional
                            if row["selection"]["source_sense_id"] == "en-carte-fr-noun-RoMy~GGt")
            branch = dict(original, level="professional", topic="work")
            additional.append(branch)
            (authoring / "additional-senses.yaml").write_text(dump_yaml(additional), encoding="utf-8")
            groups = [*authored_groups(root), *additional]
            overrides = load_yaml(authoring / "sense-overrides.yaml")
            choices, gaps = discover_choices(groups, self.projection, overrides)
            self.assertFalse(gaps)
            source_id = original["selection"]["source_sense_id"]
            selected = [row for row in choices if row["source_sense_id"] == source_id]
            self.assertEqual(len(selected), 1)
            _, placements, _ = reference_data(root, self.projection, choices)
            self.assertEqual({row["level"] for row in placements if row["id"] == selected[0]["id"]},
                             {4, "professional"})
            branch["selection"] = dict(branch["selection"], ds="A different branch label")
            with self.assertRaisesRegex(ValueError, "inconsistent canonical content"):
                discover_choices(groups, self.projection, overrides)

    def test_source_views_are_deterministic_and_current(self):
        outputs = reference_outputs(ROOT, self.projection, self.choices)
        for path, content in outputs.items():
            self.assertEqual(path.read_text(encoding="utf-8"), content, str(path))

    def test_authored_grammar_schema_and_frontiers_without_engine(self):
        authoring = ROOT / "authoring" / "teaching"
        program = load_yaml(ROOT / "teaching" / "program.yaml")
        definitions = [
            *load_yaml(authoring / "grammar-definitions.yaml"),
            *load_yaml(authoring / "tourist-grammar.yaml"),
        ]
        by_id = {row["id"]: row for row in definitions}
        self.assertEqual(len(by_id), len(definitions))
        words = {row["word"]: row["id"] for row in self.choices if row["primary"]}
        frontiers = {row["id"]: row["after_level"] for row in program["extensions"]}
        expected = {"id", "level", "topic", "ch", "ds", "note", "examples", "anchor_words", "requires"}
        for row in definitions:
            self.assertEqual(set(row), expected)
            self.assertIn(row["topic"], program["topics"])
            self.assertLessEqual(len(row["ds"]), 64)
            self.assertGreaterEqual(len(row["examples"]), 2)
            for example in row["examples"]:
                self.assertEqual(set(example), {"target", "english"})
            for word in row["anchor_words"]:
                self.assertIn(word, words)
                if row["level"] != "tourist":
                    cutoff = row["level"] if type(row["level"]) is int else frontiers[row["level"]]
                    self.assertTrue(any(
                        placement["id"] == words[word] and (
                            placement["level"] == row["level"]
                            or type(placement["level"]) is int and placement["level"] <= cutoff
                        ) for placement in self.placements
                    ), (row["id"], word))
            for required in row["requires"]:
                self.assertIn(required, by_id)
                prior = by_id[required]["level"]
                if type(row["level"]) is int:
                    self.assertTrue(type(prior) is int and prior <= row["level"])
                elif row["level"] == "tourist":
                    self.assertEqual(prior, "tourist")
                else:
                    self.assertTrue(prior == row["level"] or type(prior) is int and prior <= frontiers[row["level"]])
        visiting, complete = set(), set()

        def visit(identifier):
            self.assertNotIn(identifier, visiting, identifier)
            if identifier in complete:
                return
            visiting.add(identifier)
            for required in by_id[identifier]["requires"]:
                visit(required)
            visiting.remove(identifier)
            complete.add(identifier)

        for identifier in by_id:
            visit(identifier)


class FrenchProgramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from french_program_adapter import FrenchAdapter
        from generate_practical_program import program_outputs
        cls.adapter = FrenchAdapter()
        cls.data = cls.adapter.load(ROOT)
        cls.outputs = program_outputs(ROOT, cls.data, cls.adapter)
        cls.core = parsed(cls.outputs[ROOT / "teaching" / "core" / "sequence.yaml"])
        cls.tourist = parsed(cls.outputs[ROOT / "teaching" / "tourist" / "sequence.yaml"])

    def test_exact_compact_equality_and_earlier_reviews(self):
        known = {"vocabulary": set(), "grammar": set()}
        indexes = {"vocabulary": self.data.references.vocabulary, "grammar": self.data.references.grammar}
        for phase in self.core["phases"]:
            for level in phase["levels"]:
                for unit in level["units"]:
                    for kind in known:
                        for entry in unit["review_" + kind]:
                            self.assertIn(entry["id"], known[kind])
                            self.assertEqual(entry, indexes[kind][entry["id"]])
                        for entry in unit[kind]:
                            self.assertNotIn(entry["id"], known[kind])
                            self.assertEqual(entry, indexes[kind][entry["id"]])
                            known[kind].add(entry["id"])

    def test_all_levels_have_numbered_phase_paths(self):
        for index, phase in enumerate(self.data.inputs["program"]["phases"], 1):
            for level in phase["levels"]:
                path = ROOT / "teaching" / "phases" / f"{index}-{phase['id']}" / "levels" / f"{level:02d}" / "sequence.yaml"
                self.assertIn(path, self.outputs)

    def test_substantial_original_grammar_and_branches(self):
        definitions = load_yaml(ROOT / "authoring" / "teaching" / "grammar-definitions.yaml")
        for level in [*range(1, 31), "professional", "technical", "scientific", "literary"]:
            self.assertGreaterEqual(sum(row["level"] == level for row in definitions), 3)
        for row in definitions:
            self.assertGreaterEqual(len(row["examples"]), 2)
            self.assertLessEqual(len(row["ds"]), 64)

    def test_branch_introduces_later_core_sense_without_moving_core(self):
        identifier = stable_id("v", "en-pouvoir-fr-noun-j3b9UBu2")
        professional = parsed(self.outputs[ROOT / "teaching" / "extensions" / "professional" / "sequence.yaml"])
        introductions = {entry["id"]: entry for unit in professional["units"] for entry in unit["vocabulary"]}
        self.assertEqual(introductions[identifier], self.data.references.vocabulary[identifier])
        core_levels = [
            level["number"] for phase in self.core["phases"] for level in phase["levels"]
            if any(entry["id"] == identifier for unit in level["units"] for entry in unit["vocabulary"])
        ]
        self.assertEqual(core_levels, [20])

    def test_tourist_quick_start_closes_from_empty_context(self):
        from generate_practical_program import dependency_closure
        quick = parsed(self.outputs[ROOT / "teaching" / "tourist" / "quick-start" / "sequence.yaml"])
        self.assertEqual(len(quick["units"]), 3)
        self.assertEqual(quick["units"], self.tourist["units"][:3])
        anchors = {identifier: row.get("anchors", []) for identifier, row in self.data.references.provenance.items()
                   if identifier in self.data.references.grammar}
        dependency_closure(quick["units"], self.data.construction_dependencies, anchors)
        known_words, known_grammar = set(), set()
        for unit in quick["units"]:
            for entry in unit["review_vocabulary"]:
                self.assertIn(entry["id"], known_words)
            for entry in unit["review_grammar"]:
                self.assertIn(entry["id"], known_grammar)
            known_words.update(entry["id"] for entry in unit["vocabulary"])
            known_grammar.update(entry["id"] for entry in unit["grammar"])
            for components in unit["phrase_components"].values():
                self.assertLessEqual(set(components["items"]), known_words)
                self.assertLessEqual(set(components["grammar"]), known_grammar)

    def test_tourist_phrase_records_and_fixed_construction_evidence(self):
        phrases = [phrase for unit in self.tourist["units"] for phrase in unit["phrases"]]
        self.assertGreaterEqual(len(phrases), 35)
        self.assertEqual(len({phrase["id"] for phrase in phrases}), len(phrases))
        for phrase in phrases:
            self.assertEqual(set(phrase), {"id", "ch", "pr", "ds"})
            self.assertLessEqual(len(phrase["ds"]), 64)
        components = [value for unit in self.tourist["units"] for value in unit["phrase_components"].values()]
        self.assertTrue(any(not value["items"] and value["grammar"] for value in components))
        self.assertTrue(any(segment.get("form_id") for value in components for segment in value["realizations"]))

    def test_unlicensed_surface_reading_and_prerequisites_fail(self):
        from practical_program_types import PhraseContext
        phrase = next(phrase for unit in self.data.inputs["tourist"]["units"] for phrase in unit["phrases"]
                      if any(segment.get("form_id") for segment in phrase["realizations"]))
        full = PhraseContext(
            self.adapter.profile, self.data.references,
            frozenset(self.data.references.vocabulary), frozenset(self.data.references.grammar),
        )
        for field in ("ch", "pr"):
            altered = deepcopy(phrase)
            segment = next(segment for segment in altered["realizations"] if segment.get("form_id"))
            segment[field] += "unlicensed"
            with self.assertRaisesRegex(ValueError, "unlicensed or mismatched"):
                self.adapter.validate_phrase(altered, full)
        constrained = next(phrase for unit in self.data.inputs["tourist"]["units"] for phrase in unit["phrases"]
                           if phrase["grammar"])
        with self.assertRaisesRegex(ValueError, "construction evidence"):
            self.adapter.validate_phrase(constrained, PhraseContext(
                self.adapter.profile, self.data.references, full.introduced_vocabulary, frozenset(),
            ))

    def test_construction_slot_cannot_license_an_unrelated_word(self):
        from practical_program_types import PhraseContext
        for unit in self.data.inputs["tourist"]["units"]:
            for phrase in unit["phrases"]:
                for index, raw in enumerate(phrase["realizations"]):
                    realization = self.adapter._realizations.get(raw.get("form_id"))
                    if realization and realization["next_words"]:
                        wrong = next(row for identifier, row in self.data.references.vocabulary.items()
                                     if identifier not in realization["next_words"])
                        altered = deepcopy(phrase)
                        altered["realizations"][index + 1] = {
                            "ch": wrong["ch"], "pr": wrong["pr"], "items": [wrong["id"]], "grammar": [],
                        }
                        with self.assertRaisesRegex(ValueError, "slot"):
                            self.adapter.validate_phrase(altered, PhraseContext(
                                self.adapter.profile, self.data.references,
                                frozenset(self.data.references.vocabulary), frozenset(self.data.references.grammar),
                            ))
                        return
        self.fail("Tourist route has no guarded productive frame")

    def test_slots_reject_wrong_number_or_gender_with_same_lexical_id(self):
        from practical_program_types import PhraseContext
        context = PhraseContext(
            self.adapter.profile, self.data.references,
            frozenset(self.data.references.vocabulary), frozenset(self.data.references.grammar),
        )
        phrases = {phrase["id"]: phrase for unit in self.data.inputs["tourist"]["units"] for phrase in unit["phrases"]}
        singular = deepcopy(phrases["fr-tourist-p011"])
        identifier = singular["realizations"][1]["items"][0]
        word = self.data.references.vocabulary[identifier]
        singular["realizations"][1] = {"ch": word["ch"], "pr": word["pr"], "items": [identifier], "grammar": []}
        with self.assertRaisesRegex(ValueError, "grammatical realization"):
            self.adapter.validate_phrase(singular, context)
        wrong_gender = deepcopy(phrases["fr-tourist-p031"])
        form = self.adapter._realizations["fr-f-travel-perdue-feminine"]["segment"]
        wrong_gender["realizations"][3] = {
            "ch": form.ch, "pr": form.pr, "items": list(form.items),
            "grammar": list(form.grammar), "form_id": form.form_id,
        }
        with self.assertRaisesRegex(ValueError, "grammatical realization"):
            self.adapter.validate_phrase(wrong_gender, context)

    def test_normalized_and_program_regeneration_agree(self):
        expected = reference_outputs(
            ROOT, read_projection(ROOT),
            load_yaml(ROOT / "authoring" / "teaching" / "sense-selections.yaml"),
        )
        for path, content in expected.items():
            self.assertEqual(content, self.outputs[path], str(path))

    def test_registered_inflections_require_real_source_form_and_reading(self):
        from french_program_adapter import compile_realizations
        choices = load_yaml(ROOT / "authoring" / "teaching" / "sense-selections.yaml")
        words = {choice["word"]: self.data.references.vocabulary[choice["id"]]
                 for choice in choices if choice["primary"]}
        specs = load_yaml(ROOT / "authoring" / "teaching" / "realizations.yaml")
        inflection = next(spec for spec in specs if spec["kind"] == "source-inflection")
        for field, message in (("ch", "not attested"), ("pr", "lacks aligned source support")):
            altered = dict(inflection)
            altered[field] += "invented"
            with self.assertRaisesRegex(ValueError, message):
                compile_realizations(
                    [altered], words, self.data.references.grammar,
                    self.data.references.provenance, read_projection(ROOT),
                )

    def test_sentence_case_does_not_allow_arbitrary_rewriting(self):
        from french_program_adapter import compile_realizations
        choices = load_yaml(ROOT / "authoring" / "teaching" / "sense-selections.yaml")
        words = {choice["word"]: self.data.references.vocabulary[choice["id"]]
                 for choice in choices if choice["primary"]}
        spec = next(spec for spec in load_yaml(ROOT / "authoring" / "teaching" / "realizations.yaml")
                    if spec["kind"] == "sentence-case")
        with self.assertRaisesRegex(ValueError, "capitalization"):
            compile_realizations(
                [dict(spec, ch="An unrelated sentence")], words, self.data.references.grammar,
                self.data.references.provenance, read_projection(ROOT),
            )

    def test_read_only_check_and_deterministic_regeneration(self):
        from french_program_adapter import FrenchAdapter
        from generate_practical_program import generate
        before = {path: path.stat().st_mtime_ns for path in self.outputs}
        actual = generate(ROOT, FrenchAdapter(), check=True)
        self.assertEqual(actual, self.outputs)
        self.assertEqual(before, {path: path.stat().st_mtime_ns for path in self.outputs})

    def test_bad_authored_phrase_fails_before_any_output_write(self):
        from french_program_adapter import FrenchAdapter
        from generate_practical_program import generate
        with tempfile.TemporaryDirectory(prefix="french-curriculum-") as temporary:
            root = Path(temporary)
            shutil.copytree(ROOT / "authoring", root / "authoring")
            shutil.copytree(ROOT / "source-data", root / "source-data")
            shutil.copy2(ROOT / "source-lock.yaml", root / "source-lock.yaml")
            (root / "teaching").mkdir()
            for name in ("program.yaml", "mastery.yaml"):
                shutil.copy2(ROOT / "teaching" / name, root / "teaching" / name)
            path = root / "authoring" / "teaching" / "tourist.yaml"
            tourist = load_yaml(path)
            tourist["units"][0]["phrases"][0]["segments"] = [{"form": "fr-f-invented"}]
            path.write_text(dump_yaml(tourist), encoding="utf-8")
            sentinel = root / "teaching" / "core" / "sequence.yaml"
            sentinel.parent.mkdir()
            sentinel.write_text("unchanged", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unknown tourist segment"):
                generate(root, FrenchAdapter())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")
            self.assertFalse((root / "reference" / "vocabulary.yaml").exists())


if __name__ == "__main__":
    unittest.main()
