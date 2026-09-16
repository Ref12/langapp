"""Japanese source restrictions, local sense identities, and phrase realizations."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from curriculum_yaml import load_yaml, write_yaml
from generate_practical_program import analyze_phrase
from japanese_program_adapter import (
    JapaneseAdapter, LEVELS, PROFILE, ROOT, entry_number, original_paths, selected_sense,
    source_counter_surfaces, source_manifest, validate_form_annotations, verify_sources, word_inflections,
)
from practical_program_types import PhraseContext, ReferenceBundle


class JapaneseSenseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dictionary = json.loads((ROOT / "upstream" / "jmdict-selected.json").read_text(encoding="utf-8"))
        cls.dictionary = {str(word["id"]): word for word in dictionary["words"]}
        cls.parents = {row["id"]: row for level in LEVELS
                       for row in load_yaml(ROOT / f"jlpt-{level}" / "vocabulary.yaml")}

    def sense(self, identifier, ordinal, hint, spelling=None):
        parent = self.parents[identifier]
        return selected_sense(parent, self.dictionary[entry_number(parent)], ordinal, hint, "pinned-test-snapshot", spelling)

    def test_frozen_reference_and_source_inputs_are_complete_and_unchanged(self):
        manifest = load_yaml(ROOT / "authoring" / "teaching" / "source-lock.yaml")
        self.assertEqual(source_manifest(ROOT), manifest)
        self.assertEqual(len(self.parents), 7828)
        self.assertEqual(len({entry_number(row) for row in self.parents.values()}), 7743)
        self.assertEqual(len(verify_sources(ROOT)["words"]), 7747)

    def source_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for original in [*original_paths(ROOT), ROOT / "authoring" / "teaching" / "source-lock.yaml"]:
            target = root / original.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
        return root

    def test_additive_writing_assets_do_not_change_the_frozen_curriculum_scope(self):
        root = self.source_fixture()
        (root / "licenses" / "writing-kanjivg-COPYING.txt").write_text(
            "Additional writing-asset notice.", encoding="utf-8",
        )
        (root / "upstream" / "writing-metadata.json").write_text("{}", encoding="utf-8")
        self.assertEqual(source_manifest(root), source_manifest(ROOT))
        self.assertEqual(len(verify_sources(root)["words"]), 7747)
        original = root / "licenses" / "Waller-sharing.html"
        original.write_bytes(original.read_bytes() + b"\nchanged")
        with self.assertRaisesRegex(ValueError, "frozen source manifest"):
            verify_sources(root)
        original.unlink()
        with self.assertRaises(FileNotFoundError):
            verify_sources(root)

    def test_frozen_manifest_cannot_silently_drop_an_original_input(self):
        root = self.source_fixture()
        path = root / "authoring" / "teaching" / "source-lock.yaml"
        manifest = load_yaml(path)
        manifest.pop("licenses/Waller-sharing.html")
        write_yaml(path, manifest)
        with self.assertRaisesRegex(ValueError, "frozen source manifest"):
            verify_sources(root)

    def test_raw_ordinals_preserve_gaps_after_reading_restrictions(self):
        sense = self.sense("ja-n1-00174", 3, "first day of a month")
        self.assertEqual(sense["id"], "ja-n1-00174-s003")
        self.assertEqual(sense["raw_sense_ordinal"], 3)
        with self.assertRaisesRegex(ValueError, "incompatible"):
            self.sense("ja-n1-00174", 2, "all day")

    def test_konnichi_sense_does_not_become_kyou_sense(self):
        valid = self.sense("ja-n3-00602", 2, "these days")
        self.assertEqual(valid["reading"], "\u3053\u3093\u306b\u3061")
        self.assertEqual(valid["source_sense"]["appliesToKana"], ["\u3053\u3093\u306b\u3061"])
        with self.assertRaisesRegex(ValueError, "incompatible"):
            self.sense("ja-n5-00192", 2, "these days")

    def test_asu_future_sense_does_not_become_ashita_sense(self):
        self.assertEqual(self.sense("ja-n4-00015", 2, "near future")["reading"], "\u3042\u3059")
        with self.assertRaisesRegex(ValueError, "incompatible"):
            self.sense("ja-n5-00015", 2, "near future")

    def test_verified_modern_spelling_does_not_rewrite_the_parent(self):
        parent = deepcopy(self.parents["ja-n5-00006"])
        source = deepcopy(self.dictionary[entry_number(parent)])
        before = deepcopy((parent, source))
        expanded = selected_sense(parent, source, 1, "bright; well-lit", "snapshot", "\u660e\u308b\u3044")
        self.assertEqual(expanded["target"], "\u660e\u308b\u3044")
        self.assertEqual(parent["target"], "\u660e\u3044")
        self.assertEqual((parent, source), before)
        with self.assertRaisesRegex(ValueError, "verified source form"):
            selected_sense(parent, source, 1, "bright", "snapshot", "invented")

    def test_meanings_come_from_raw_senses_not_formatted_reference_english(self):
        parent = deepcopy(self.parents["ja-n5-00180"])
        parent["english"] = "An unrelated formatted display string | 99. Not a source sense."
        expanded = selected_sense(parent, self.dictionary[entry_number(parent)], 3, "to ask", "snapshot")
        self.assertIn("to ask", expanded["english"])
        self.assertNotIn("display string", expanded["english"])
        self.assertEqual(expanded["source_sense"]["partOfSpeech"], ["v5k", "vt"])

    def test_common_secondary_meanings_are_independently_addressable(self):
        for identifier, ordinal, hint, expected in (
            ("ja-n5-00180", 2, "to listen", "listen"),
            ("ja-n5-00180", 3, "to ask", "ask"),
            ("ja-n5-00150", 3, "to wear glasses", "glasses"),
            ("ja-n5-00150", 4, "to make a phone call", "call"),
            ("ja-n5-00150", 5, "to spend time or money", "spend"),
            ("ja-n5-00572", 5, "counter for long thin objects", "counter"),
            ("ja-n3-00170", 1, "yen", "yen"),
            ("ja-n3-00170", 2, "circle", "circle"),
            ("ja-n3-00876", 2, "thank you for the trouble", "thank"),
        ):
            with self.subTest(identifier=identifier, ordinal=ordinal):
                self.assertIn(expected, self.sense(identifier, ordinal, hint)["english"])

    def test_no_invalid_or_fabricated_raw_sense_identifiers(self):
        for ordinal in (0, -1, 999, True, "1"):
            with self.subTest(ordinal=ordinal):
                with self.assertRaisesRegex(ValueError, "ordinal"):
                    self.sense("ja-n5-00180", ordinal, "a sense")
        parent = self.parents["ja-n5-00180"]
        word = deepcopy(self.dictionary[entry_number(parent)])
        word["id"] = "wrong-entry"
        with self.assertRaisesRegex(ValueError, "does not match"):
            selected_sense(parent, word, 1, "to hear", "snapshot")

    def test_kana_only_reading_cannot_license_a_kanji_spelling(self):
        parent = deepcopy(self.parents["ja-n5-00180"])
        word = deepcopy(self.dictionary[entry_number(parent)])
        word["kana"][0]["appliesToKanji"] = []
        with self.assertRaisesRegex(ValueError, "kana reading restriction"):
            selected_sense(parent, word, 1, "to hear", "snapshot")
        kana = selected_sense(parent, word, 1, "to hear", "snapshot", parent["reading"])
        self.assertEqual(kana["target"], parent["reading"])

    def test_expanded_raw_provenance_keeps_spelling_and_reading_restrictions(self):
        sense = self.sense("ja-n3-00602", 2, "these days")
        raw = self.dictionary[entry_number(self.parents["ja-n3-00602"])]["sense"][1]
        self.assertEqual(sense["source_sense"], raw)
        self.assertTrue(sense["reading_restrictions"])
        self.assertEqual(sense["source_snapshot"], "pinned-test-snapshot")

    def test_counter_surface_discovery_respects_raw_spelling_and_reading_restrictions(self):
        word = deepcopy(self.dictionary[entry_number(self.parents["ja-n5-00572"])])
        word["kanji"] = [{"text": "\u672c"}, {"text": "\u4eee"}]
        word["kana"] = [
            {"text": "\u307b\u3093", "appliesToKanji": ["\u672c"]},
            {"text": "\u3082\u3068", "appliesToKanji": ["*"]},
        ]
        word["sense"] = [{
            **word["sense"][4], "appliesToKanji": ["\u672c"], "appliesToKana": ["\u307b\u3093"],
        }]
        surfaces = source_counter_surfaces({"words": [word]})
        self.assertIn("\u672c", surfaces)
        self.assertFalse(surfaces & {"\u4eee", "\u3082\u3068", "\u307b\u3093"})
        word["kana"][0]["appliesToKanji"] = ["\u4eee"]
        self.assertNotIn("\u672c", source_counter_surfaces({"words": [word]}))

    def test_attested_verb_groups_control_full_word_readings(self):
        for identifier, written, reading in (
            ("ja-n5-00148", "\u66f8\u3044\u3066", "\u304b\u3044\u3066"),
            ("ja-n5-00652", "\u547c\u3093\u3067", "\u3088\u3093\u3067"),
            ("ja-n5-00589", "\u5f85\u3063\u3066", "\u307e\u3063\u3066"),
            ("ja-n5-00369", "\u98df\u3079\u3066", "\u305f\u3079\u3066"),
            ("ja-n5-00048", "\u884c\u3063\u3066", "\u3044\u3063\u3066"),
            ("ja-n5-00217", "\u6765\u307e\u3059", "\u304d\u307e\u3059"),
        ):
            with self.subTest(identifier=identifier):
                sense = self.sense(identifier, 1, "verb form")
                forms = word_inflections(
                    {"ch": sense["target"], "pr": sense["reading"]},
                    set(sense["source_sense"]["partOfSpeech"]),
                )
                self.assertIn((written, reading), [(ch, pr) for ch, pr, _, _ in forms])


class JapaneseRealizationTests(unittest.TestCase):
    def setUp(self):
        self.words = {
            "write-sense": {"id": "write-sense", "ch": "\u66f8\u304f", "pr": "\u304b\u304f", "ds": "to write"},
        }
        self.grammar = {
            "ja-n5-g041": {"id": "ja-n5-g041", "ch": "V-te", "ds": "sequence actions"},
            "ja-n5-g004": {"id": "ja-n5-g004", "ch": "N+\u306f", "ds": "topic particle"},
        }
        self.references = ReferenceBundle(
            self.words, self.grammar, {"write-sense": "write-lemma"},
            provenance={"write-sense": {"source_sense": {"partOfSpeech": ["v5k", "vt"]}}},
        )
        self.adapter = JapaneseAdapter()
        self.adapter.forms = {
            "write-te": {
                "ch": "\u66f8\u3044\u3066", "pr": "\u304b\u3044\u3066",
                "items": ["write-sense"], "grammar": ["ja-n5-g041"],
                "source_id": "original-ja-practical", "note": "Authored te-form of the source verb.",
            },
            "topic-wa": {
                "ch": "\u306f", "pr": "\u308f", "items": [], "grammar": ["ja-n5-g004"],
                "source_id": "original-ja-practical", "note": "The topic particle is pronounced wa.",
            },
        }
        self.phrase = {
            "id": "ja-tourist-p001", "ch": "\u66f8\u3044\u3066", "pr": "\u304b\u3044\u3066", "ds": "Write.",
            "items": ["write-sense"], "grammar": ["ja-n5-g041"],
            "realizations": [{
                "ch": "\u66f8\u3044\u3066", "pr": "\u304b\u3044\u3066",
                "items": ["write-sense"], "grammar": ["ja-n5-g041"], "form_id": "write-te",
            }],
        }
        self.context = PhraseContext(PROFILE, self.references, frozenset(self.words), frozenset(self.grammar))

    def test_form_annotations_have_explicit_lexical_grammar_and_source_links(self):
        validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})
        analysis = self.adapter.validate_phrase(self.phrase, self.context)
        self.assertEqual(analysis.items, ("write-sense",))
        self.assertEqual(analysis.grammar, ("ja-n5-g041",))
        self.assertEqual(analysis.realizations[0].form_id, "write-te")

    def test_changed_surface_reading_links_and_unknown_form_fail(self):
        original = deepcopy(self.phrase["realizations"][0])
        for key, value in (
            ("ch", "\u66f8\u3063\u3066"), ("pr", "\u304b\u304d\u3066"),
            ("grammar", ["ja-n5-g004"]), ("items", []), ("form_id", "invented"),
        ):
            with self.subTest(key=key):
                self.phrase["realizations"][0] = {**original, key: value}
                with self.assertRaisesRegex(ValueError, "unlicensed|differs"):
                    self.adapter.validate_phrase(self.phrase, self.context)

    def test_inflection_cannot_be_presented_as_an_unchecked_canonical_word(self):
        self.phrase["realizations"][0].pop("form_id")
        with self.assertRaisesRegex(ValueError, "needs a licensed form"):
            self.adapter.validate_phrase(self.phrase, self.context)

    def test_particle_fixed_form_does_not_require_fake_lexical_credit(self):
        validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})
        self.adapter.forms["topic-wa"]["pr"] = "\u306f"
        with self.assertRaisesRegex(ValueError, "particle reading"):
            validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})

    def test_missing_source_and_licensing_construction_are_errors(self):
        with self.assertRaisesRegex(ValueError, "unknown form annotation source"):
            validate_form_annotations(self.adapter.forms, self.references, set())
        self.adapter.forms["write-te"]["grammar"] = []
        with self.assertRaisesRegex(ValueError, "licensing construction"):
            validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})

    def test_annotation_and_phrase_cannot_jointly_license_an_invented_inflection(self):
        for key, value in (("ch", "\u66f8\u3063\u3066"), ("pr", "\u304b\u3063\u3066")):
            with self.subTest(key=key):
                original = self.adapter.forms["write-te"][key]
                self.adapter.forms["write-te"][key] = value
                self.phrase["realizations"][0][key] = value
                with self.assertRaisesRegex(ValueError, "source-backed inflection"):
                    self.adapter.validate_phrase(self.phrase, self.context)
                self.adapter.forms["write-te"][key] = original
                self.phrase["realizations"][0][key] = original

    def test_word_form_needs_raw_pos_and_not_just_a_verb_looking_spelling(self):
        for pos in ([], ["n"], ["v1"]):
            with self.subTest(pos=pos):
                self.references.provenance["write-sense"]["source_sense"]["partOfSpeech"] = pos
                with self.assertRaisesRegex(ValueError, "part-of-speech|source-backed inflection"):
                    validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})

    def test_whole_phrase_annotation_is_not_atomic_coverage(self):
        self.words["second-sense"] = {"id": "second-sense", "ch": "x", "pr": "x", "ds": "another item"}
        self.adapter.forms["write-te"]["items"].append("second-sense")
        with self.assertRaisesRegex(ValueError, "exactly one lexical sense"):
            validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})

    def test_fixed_grammar_cannot_hide_unlisted_lexical_material(self):
        self.adapter.forms["topic-wa"].update(ch="\u304a\u8336\u306f", pr="\u304a\u3061\u3083\u308f")
        with self.assertRaisesRegex(ValueError, "unsupported fixed"):
            validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})

    def test_canonical_lexeme_cannot_award_an_unrelated_construction(self):
        self.phrase["realizations"] = [{
            "ch": self.words["write-sense"]["ch"], "pr": self.words["write-sense"]["pr"],
            "items": ["write-sense"], "grammar": ["ja-n5-g004"],
        }]
        with self.assertRaisesRegex(ValueError, "canonical construction link"):
            self.adapter.validate_phrase(self.phrase, self.context)

    def test_phrase_readings_cannot_invent_pitch_accent_or_use_latin_word_readings(self):
        for reading in ("kaite", "\u304b\u3044\u3066\u2191"):
            self.phrase["pr"] = reading
            with self.assertRaisesRegex(ValueError, "documented kana"):
                self.adapter.validate_phrase(self.phrase, self.context)


class JapaneseQuantityReadingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        adapter = JapaneseAdapter()
        cls.references = adapter.load(ROOT).references
        cls.counter_surfaces = adapter.counter_surfaces

    def setUp(self):
        self.adapter = JapaneseAdapter()
        self.adapter.counter_surfaces = self.counter_surfaces
        self.context = PhraseContext(
            PROFILE, self.references, frozenset(self.references.vocabulary),
            frozenset(self.references.grammar),
        )

    def canonical_phrase(self, *items, grammar=True):
        words = self.references.vocabulary
        return {
            "id": "ja-quantity-regression", "ch": "".join(words[item]["ch"] for item in items),
            "pr": "".join(words[item]["pr"] for item in items), "ds": "Quantity reading.",
            "items": list(items), "grammar": ["ja-n5-g042"] if grammar else [],
            "realizations": [{
                "ch": words[item]["ch"], "pr": words[item]["pr"], "items": [item],
                "grammar": ["ja-n5-g042"] if grammar and set(
                    self.references.provenance[item]["source_sense"]["partOfSpeech"],
                ) & {"num", "ctr"} else [],
            } for item in items],
        }

    def test_real_counter_and_number_readings_cannot_be_naively_concatenated(self):
        for items in (
            ("ja-n5-00056-s001", "ja-n5-00572-s005"),
            ("ja-n5-00269-s001", "ja-n5-00572-s005"),
            ("ja-n5-00673-s001", "ja-n5-00572-s005"),
            ("ja-n5-00056-s001", "ja-n5-00572-s007"),
            ("ja-n5-00056-s001", "ja-n3-00236-s001"),
            ("ja-n5-00056-s001", "ja-n3-00510-s001"),
            ("ja-n5-00269-s001", "ja-n5-00532-s001"),
            ("ja-n5-00673-s001", "ja-n5-00532-s001"),
            ("ja-n5-00269-s001", "ja-n5-00331-s001"),
        ):
            with self.subTest(items=items):
                phrase = self.canonical_phrase(*items)
                with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
                    analyze_phrase(phrase, self.context, self.adapter)

    def test_omitting_counter_links_or_spacing_the_surface_does_not_bypass_reading_evidence(self):
        for grammar, spaced in ((False, False), (True, True)):
            phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00572-s005", grammar=grammar)
            if spaced:
                phrase["ch"] = "\u4e00 \u672c"
            with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
                analyze_phrase(phrase, self.context, self.adapter)

    def test_book_sense_cannot_hide_a_known_counter_surface(self):
        for grammar in (True, False):
            for spaced in (True, False):
                with self.subTest(grammar=grammar, spaced=spaced):
                    phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00572-s001", grammar=grammar)
                    if spaced:
                        phrase["ch"] = "\u4e00 \u672c"
                    with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
                        analyze_phrase(phrase, self.context, self.adapter)
        phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00572-s001")
        phrase["realizations"][0]["grammar"] = []
        phrase["realizations"][1]["grammar"] = ["ja-n5-g042"]
        with self.assertRaisesRegex(ValueError, "canonical construction link"):
            analyze_phrase(phrase, self.context, self.adapter)

    def test_source_counter_detection_does_not_require_selecting_its_counter_sense(self):
        items = ("ja-n5-00056-s001", "ja-n5-00572-s001")
        original = self.references
        vocabulary = {item: original.vocabulary[item] for item in items}
        selected = ReferenceBundle(
            vocabulary, original.grammar,
            {item: original.lexical_identity[item] for item in items},
            {item: original.provenance[item] for item in (*items, *original.grammar)},
            {item: original.source_sense_identity[item] for item in items},
            {item: original.reading_identity[item] for item in items},
            {item: original.spelling_identity[item] for item in items},
        )
        context = PhraseContext(PROFILE, selected, frozenset(items), frozenset(original.grammar))
        self.assertIn("\u672c", self.adapter.counter_surfaces)
        with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
            analyze_phrase(self.canonical_phrase(*items), context, self.adapter)

    def test_other_noun_counter_homographs_require_quantity_evidence(self):
        for item in ("ja-n5-00490-s001", "ja-n5-00543-s001", "ja-n3-01294-s001"):
            with self.subTest(item=item):
                phrase = self.canonical_phrase("ja-n5-00056-s001", item)
                with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
                    analyze_phrase(phrase, self.context, self.adapter)
                items = ("ja-n5-00249-s001", item)
                noun_phrase = self.canonical_phrase(*items, grammar=False)
                self.assertEqual(analyze_phrase(noun_phrase, self.context, self.adapter).items, items)

    def test_correct_pronunciation_does_not_license_the_wrong_book_sense_tuple(self):
        phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00572-s001")
        form = {
            "ch": phrase["ch"], "pr": "\u3044\u3063\u307d\u3093",
            "items": phrase["items"], "grammar": ["ja-n5-g042"],
            "source_id": "original-ja-practical", "note": "Incorrect book-sense substitution.",
        }
        self.adapter.forms = {"ja-form-wrong-book-sense": form}
        phrase["pr"] = form["pr"]
        phrase["realizations"] = [{
            **{key: form[key] for key in ("ch", "pr", "items", "grammar")},
            "form_id": "ja-form-wrong-book-sense",
        }]
        with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
            analyze_phrase(phrase, self.context, self.adapter)

    def test_book_noun_phrases_and_punctuated_word_lists_remain_valid(self):
        items = ("ja-n5-00249-s001", "ja-n5-00572-s001")
        phrase = self.canonical_phrase(*items, grammar=False)
        self.assertEqual(analyze_phrase(phrase, self.context, self.adapter).items, items)
        items = ("ja-n5-00056-s001", "ja-n5-00572-s001")
        phrase = self.canonical_phrase(*items, grammar=False)
        phrase["ch"] = "\u4e00\u3001\u672c"
        self.assertEqual(analyze_phrase(phrase, self.context, self.adapter).items, items)

    def test_documented_whole_word_counter_form_licenses_ippon_not_ichihon(self):
        phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00572-s005")
        form = {
            "ch": "\u4e00\u672c", "pr": "\u3044\u3063\u307d\u3093",
            "items": phrase["items"], "grammar": ["ja-n5-g042"],
            "source_id": "original-ja-practical",
            "note": "Whole counted-word reading documented in grammar-notes.md.",
        }
        self.adapter.forms = {"ja-form-counter-ippon": form}
        phrase["pr"] = form["pr"]
        phrase["realizations"] = [{
            **{key: form[key] for key in ("ch", "pr", "items", "grammar")},
            "form_id": "ja-form-counter-ippon",
        }]
        validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})
        result = analyze_phrase(phrase, self.context, self.adapter)
        self.assertEqual(result.realizations[0].pr, "\u3044\u3063\u307d\u3093")
        form["pr"] = phrase["pr"] = phrase["realizations"][0]["pr"] = "\u3044\u3061\u307b\u3093"
        with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
            validate_form_annotations(self.adapter.forms, self.references, {"original-ja-practical"})
        with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
            analyze_phrase(phrase, self.context, self.adapter)

    def test_supported_currency_and_dictionary_whole_words_remain_canonical(self):
        for items in (
            ("ja-n5-00331-s001", "ja-n3-00170-s001"),
            ("ja-n5-00544-s001", "ja-n2-00202-s001"),
        ):
            phrase = self.canonical_phrase(*items)
            self.assertEqual(analyze_phrase(phrase, self.context, self.adapter).items, items)

    def test_punctuated_number_lists_are_not_treated_as_one_compound(self):
        items = ("ja-n5-00056-s001", "ja-n5-00269-s001")
        phrase = self.canonical_phrase(*items, grammar=False)
        phrase["ch"] = "\u4e00\u3001\u4e09"
        self.assertEqual(analyze_phrase(phrase, self.context, self.adapter).items, items)

    def test_unsupported_longer_numeric_runs_are_not_checked_only_pairwise(self):
        phrase = self.canonical_phrase("ja-n5-00056-s001", "ja-n5-00331-s001", "ja-n3-00170-s001")
        with self.assertRaisesRegex(ValueError, "whole-word counter/number reading"):
            analyze_phrase(phrase, self.context, self.adapter)


if __name__ == "__main__":
    unittest.main()
