"""Russian source fidelity and language-specific reading regression checks."""

from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest
from curriculum_yaml import load_yaml, write_yaml
from russian_curriculum_adapter import RussianReferences
from russian_tourist import matching_selections
from russian_source import (
    REVISION, SOURCE_ID, TABLES, english_source_span, expanded_selection, fingerprint, form_records, normalized_reference, parse_table, source_bytes,
    source_reading, unstress, validate_selection,
)


class RussianSourceTests(unittest.TestCase):
    def test_matching_english_hint_cannot_substitute_an_unrelated_source_sense(self):
        selection = {"source_table": "nouns", "source_record": 320, "source_gloss": "map", "ds": "card"}
        binding = {"source_table": "nouns", "source_record": 320, "source_gloss": "card", "ds": "card"}
        self.assertEqual(matching_selections([selection], binding), [])

    def test_source_meanings_are_not_fragments_inside_longer_words(self):
        with self.assertRaisesRegex(ValueError, "word boundaries"):
            english_source_span("teacher; instructor", "tea")
        with self.assertRaisesRegex(ValueError, "word boundaries"):
            english_source_span("almonds, almond-tree", "almond")
        self.assertEqual(english_source_span("teacher; tea", "tea"), (9, 12))
        self.assertEqual(english_source_span("take; have a look", "have a look"), (6, 17))

    def test_source_stress_is_not_inferred_from_orthography(self):
        self.assertEqual(source_reading("вода'"), ("вода́", "source-marked-stress"))
        self.assertEqual(source_reading("ёлка"), ("ёлка", "source-yo-reading"))
        self.assertEqual(source_reading("в"), ("в", "source-monosyllabic-or-nonsyllabic"))
        self.assertEqual(source_reading("дом"), ("дом", "source-monosyllabic-or-nonsyllabic"))
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            source_reading("зачем")

    def test_homographs_have_different_source_readings(self):
        self.assertEqual(unstress(source_reading("за'мок")[0]), "замок")
        self.assertEqual(unstress(source_reading("замо'к")[0]), "замок")
        self.assertNotEqual(source_reading("за'мок")[0], source_reading("замо'к")[0])
        self.assertNotEqual(source_reading("му'ка")[0], source_reading("мука'")[0])

    def test_yo_is_never_silently_folded_to_e(self):
        self.assertNotEqual(unstress("все"), unstress("всё"))
        with self.assertRaisesRegex(ValueError, "spelling/reading conflict"):
            source_reading("же'лчный", target="жёлчный")

    def test_invalid_and_ambiguous_readings_fail(self):
        for value in ("'вода", "вод'а", "во'да'", "вода/воды", "  дом", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                source_reading(value)

    def test_canonical_acute_and_source_apostrophe_agree(self):
        self.assertEqual(source_reading("вода́")[0], source_reading("вода'")[0])
        self.assertEqual(source_reading("до свида'ния")[0], "до свида́ния")
        self.assertEqual(source_reading("по-англи'йски")[0], "по-англи́йски")

    def test_source_checksum_is_mandatory_even_for_local_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nouns.csv").write_bytes(b"changed upstream data")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                source_bytes("nouns", root)
            with self.assertRaisesRegex(ValueError, "exactly one source file"):
                source_bytes("verbs", root)

    def test_source_locator_and_raw_values_survive_expansion(self):
        raw = {
            "bare": "вода", "accented": "вода'", "translations_en": "water; liquid",
            "translations_de": "Wasser", "gender": "f", "animate": "0", "sg_acc": "во'ду",
        }
        selection = {
            "id": "ru-or-n00001-s001", "source_table": "nouns", "source_record": 1,
            "source_gloss": "water", "ds": "water", "level": 1, "topic": "food",
            "lexical_identity": "ru-or-n00001", "part_of_speech": "noun",
        }
        self.assertEqual(validate_selection(selection, {"nouns": [raw]}, {"food"}), raw)
        original = deepcopy(raw)
        result = expanded_selection(selection, raw)
        self.assertEqual(raw, original)
        self.assertEqual(result["source_data"], raw)
        self.assertEqual(result["source_record"]["sha256"], fingerprint(raw))
        self.assertEqual(result["selected_source_span"], {"field": "translations_en", "start": 0, "end": 5})
        self.assertTrue(result["source_entry"].endswith("nouns.csv#data-record=1"))
        self.assertEqual(result["reading"], "вода́")
        selection["source_gloss"] = "wine"
        with self.assertRaisesRegex(ValueError, "exact English source span"):
            validate_selection(selection, {"nouns": [raw]}, {"food"})

    def test_inflected_forms_do_not_create_new_lexical_identities(self):
        raw = {"bare": "вода", "accented": "вода'", "translations_en": "water",
               "translations_de": "Wasser", "sg_acc": "во'ду", "sg_gen": "воды'"}
        sense = {"id": "ru-or-n00029-s001", "lexical_identity": "ru-or-n00029"}
        forms, gaps = form_records("nouns", 29, raw, [sense])
        self.assertFalse(gaps)
        self.assertEqual({row["target"] for row in forms}, {"воду", "воды"})
        self.assertEqual({row["lexical_identity"] for row in forms}, {"ru-or-n00029"})
        self.assertTrue(all(row["sense_ids"] == [sense["id"]] for row in forms))
        self.assertEqual(forms[0]["source_field"], "sg_acc")
        self.assertEqual(forms[0]["reading"], "во́ду")

    def test_invalid_source_form_is_reported_not_given_a_reading(self):
        raw = {"bare": "вода", "accented": "вода'", "sg_acc": "воду"}
        forms, gaps = form_records(
            "nouns", 29, raw, [{"id": "ru-or-n00029-s001", "lexical_identity": "ru-or-n00029"}],
        )
        self.assertEqual(forms, [])
        self.assertEqual(gaps[0]["value"], "воду")
        self.assertIn("Unresolved", gaps[0]["reason"])

    def test_shared_homograph_row_does_not_share_ambiguous_inflections(self):
        raw = {"bare": "среда", "accented": "среда'", "sg_gen": "среды'"}
        forms, gaps = form_records("nouns", 1, raw, [
            {"id": "ru-or-n00001-s001", "lexical_identity": "ru-wednesday"},
            {"id": "ru-or-n00001-s002", "lexical_identity": "ru-environment"},
        ])
        self.assertEqual(forms, [])
        self.assertIn("homographs", gaps[0]["reason"])

    def test_tsv_headers_and_rows_are_strict(self):
        good = "bare\taccented\ttranslations_en\ttranslations_de\nдом\tдом\thouse\tHaus\n"
        self.assertEqual(parse_table(good.encode(), "nouns")[0]["translations_en"], "house")
        for value in (
            "bare\tbare\ttranslations_en\ttranslations_de\n",
            "bare\taccented\ttranslations_en\ttranslations_de\nдом\tдом\n",
            "bare\taccented\ttranslations_en\ttranslations_de\n",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_table(value.encode(), "nouns")

    def test_tsv_quotes_are_literal_not_lossy_csv_quoting(self):
        value = 'bare\taccented\ttranslations_en\ttranslations_de\nдом\tдом\t"house" building\t"ein" Haus\n'
        row = parse_table(value.encode(), "nouns")[0]
        self.assertEqual(row["translations_en"], '"house" building')
        self.assertEqual(row["translations_de"], '"ein" Haus')


class RussianReferenceAdapterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "reference").mkdir()
        (self.root / "build").mkdir()
        (self.root / "authoring").mkdir()
        write_yaml(self.root / "authoring" / "anchor-bindings.yaml", {})
        self.source = {
            "bare": "вода", "accented": "вода'", "translations_en": "water",
            "translations_de": "Wasser", "sg_acc": "во'ду",
        }
        self.selection = {
            "id": "ru-or-n00029-s001", "source_table": "nouns", "source_record": 29,
            "source_gloss": "water", "ds": "water", "level": 1, "topic": "food",
            "lexical_identity": "ru-or-n00029", "part_of_speech": "noun",
        }
        self.entry = expanded_selection(self.selection, self.source)
        write_yaml(self.root / "build" / "lexical-records.yaml", [self.entry])
        write_yaml(self.root / "reference" / "vocabulary.yaml", [normalized_reference(self.entry)])
        write_yaml(self.root / "build" / "linked-forms.yaml", [])

    def test_canonical_entries_keep_exact_requested_shape(self):
        references = RussianReferences(self.root)
        self.assertEqual(references.vocabulary["ru-or-n00029-s001"],
                         {"id": "ru-or-n00029-s001", "ch": "вода", "pr": "вода́", "ds": "water"})
        self.assertEqual(references.resolve_anchor("вода", "water"), "ru-or-n00029-s001")
        self.assertEqual(references.lexical_identity["ru-or-n00029-s001"], "ru-or-n00029")

    def test_phrases_require_the_actual_source_form_and_intended_sense(self):
        references = RussianReferences(self.root)
        references.validate_form("ru-or-n00029-s001", "ru-or-n00029-f-sg-acc-01", "Воду", "Во́ду")
        with self.assertRaisesRegex(ValueError, "differs"):
            references.validate_form("ru-or-n00029-s001", "ru-or-n00029-f-sg-acc-01", "воду", "воду́")
        with self.assertRaisesRegex(ValueError, "Unknown"):
            references.validate_form("unrelated-sense", "ru-or-n00029-f-sg-acc-01", "воду", "во́ду")
        with self.assertRaisesRegex(ValueError, "exact intended sense"):
            references.resolve_anchor("вода", "wine")

    def test_source_reading_and_spelling_cannot_be_edited_only_in_a_view(self):
        for field, replacement in (("reading", "во́да"), ("target", "воды")):
            entry = deepcopy(self.entry)
            entry[field] = replacement
            write_yaml(self.root / "build" / "lexical-records.yaml", [entry])
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "differs"):
                RussianReferences(self.root)

    def test_raw_source_corruption_is_visible(self):
        self.entry["source_data"]["translations_en"] = "wine"
        write_yaml(self.root / "build" / "lexical-records.yaml", [self.entry])
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            RussianReferences(self.root)

    def test_matching_normalized_view_cannot_disguise_wrong_source_locator(self):
        self.entry["source_entry"] = self.entry["source_entry"].replace("record=29", "record=30")
        write_yaml(self.root / "build" / "lexical-records.yaml", [self.entry])
        write_yaml(self.root / "reference" / "vocabulary.yaml", [normalized_reference(self.entry)])
        with self.assertRaisesRegex(ValueError, "source locator"):
            RussianReferences(self.root)

    def test_source_span_must_be_positive_exact_bounds(self):
        self.entry["selected_source_span"].update(start=-5, end=5)
        write_yaml(self.root / "build" / "lexical-records.yaml", [self.entry])
        with self.assertRaisesRegex(ValueError, "English source span"):
            RussianReferences(self.root)

    def test_offline_generation_requires_current_curated_source_meanings(self):
        references = RussianReferences(self.root)
        references.validate_curation([self.selection])
        changed = {**self.selection, "ds": "wine"}
        with self.assertRaisesRegex(ValueError, "curated source sense differs"):
            references.validate_curation([changed])
        with self.assertRaisesRegex(ValueError, "selections differ"):
            references.validate_curation([])


class RussianRealSourceFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1] / "curriculum" / "russian"
        cls.root = root
        cls.fixture = load_yaml(root / "source-snapshots" / "openrussian-fixture.yaml")
        cls.records = {(row["table"], row["record"]): row["source_data"]
                       for row in cls.fixture["records"]}

    def test_fixture_preserves_pinned_revision_and_source_rows(self):
        self.assertEqual(self.fixture["revision"], REVISION)
        for entry in self.fixture["records"]:
            self.assertEqual(entry["row_sha256"], fingerprint(entry["source_data"]))
            self.assertIn(REVISION, entry["source_entry"])

    def test_source_notices_match_the_download_pins_and_retained_data_license(self):
        sources = load_yaml(self.root / "sources.yaml")
        source = next(row for row in sources if row["id"] == SOURCE_ID)
        self.assertEqual(source["revision"], REVISION)
        self.assertEqual(source["license"], "CC-BY-SA-4.0")
        self.assertEqual(set(source["downloads"]), set(TABLES))
        for table, (_, checksum) in TABLES.items():
            self.assertEqual(source["downloads"][table]["sha256"], checksum)
            self.assertIn(REVISION, source["downloads"][table]["url"])
        license_path = self.root / "licenses" / "CC-BY-SA-4.0.txt"
        self.assertEqual(hashlib.sha256(license_path.read_bytes()).hexdigest(), source["license_sha256"])
        self.assertTrue(any(row["id"] == "original-ru" for row in sources))

    def test_real_castle_lock_and_flour_torment_are_distinguished(self):
        castle = self.records["nouns", 26428]
        lock = self.records["nouns", 26429]
        self.assertEqual(castle["translations_en"], "castle")
        self.assertTrue(lock["translations_en"].startswith("lock"))
        self.assertEqual(source_reading(castle["accented"])[0], "за́мок")
        self.assertEqual(source_reading(lock["accented"])[0], "замо́к")
        self.assertNotEqual(source_reading(self.records["nouns", 1154]["accented"])[0],
                            source_reading(self.records["nouns", 26432]["accented"])[0])

    def test_real_case_realization_retains_water_lemma_identity(self):
        raw = self.records["nouns", 29]
        self.assertEqual(raw["bare"], "вода")
        forms, _ = form_records(
            "nouns", 29, raw, [{"id": "ru-or-n00029-s001", "lexical_identity": "ru-or-n00029"}],
        )
        accusative = next(row for row in forms if row["source_field"] == "sg_acc")
        self.assertEqual((accusative["target"], accusative["reading"]), ("воду", "во́ду"))
        self.assertEqual(accusative["lexical_identity"], "ru-or-n00029")

    def test_source_mixed_senses_and_missing_metadata_are_visible(self):
        self.assertIn("nobility", self.records["verbs", 4]["translations_en"])
        self.assertEqual(self.records["nouns", 26428]["gender"], "")
        self.assertEqual(self.records["verbs", 6]["translations_en"], "eat")
        self.assertEqual(self.records["others", 4991]["translations_en"], "there is, there are")
        self.assertNotEqual(self.records["others", 1967]["bare"], self.records["others", 4978]["bare"])


if __name__ == "__main__":
    unittest.main()
