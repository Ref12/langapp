"""Source fidelity and identity regressions for checked-in Spanish selections."""

from pathlib import Path
import shutil
import tempfile
import unittest
from curriculum_yaml import load_yaml
from import_spanish_curriculum import generate, reference_outputs
from spanish_sources import (
    ROOT, SOURCE_SHA256, canonical_vocabulary, effective_selections, lexical_id, load_projection,
    local_id, reading_text, record_index, short_label, source_readings,
    selected_inflections, surface_forms, usable_senses, verify,
)
from spanish_tourist import compile_route, resolve_items, written


class SpanishSourceUnitTests(unittest.TestCase):
    def test_disambiguator_keeps_a_complete_gloss_clause(self):
        self.assertEqual(short_label({"glosses": ["bank (financial institution)"]}), "bank")
        self.assertEqual(short_label({"glosses": ["man, (adult male person)"]}), "man")
        self.assertIsNone(short_label({"glosses": ["x" * 65]}))
        self.assertEqual(short_label({"glosses": ["x" * 65 + "; useful sense"]}), "useful sense")

    def test_inflections_names_and_rare_meanings_are_not_lemma_candidates(self):
        senses = [
            {"id": "house", "glosses": ["house"]},
            {"id": "houses", "glosses": ["house"], "form_of": [{"word": "house"}]},
            {"id": "rare", "glosses": ["house"], "tags": ["rare"]},
            {"id": "proper", "glosses": ["a given name"]},
            {"id": "plural", "glosses": ["plural of house"]},
            {"id": "mail", "glosses": ["letter (document)"]},
            {"id": "alphabet", "glosses": ["a letter of the Spanish alphabet"]},
        ]
        self.assertEqual([row["id"] for row in usable_senses({"senses": senses})], ["house", "mail"])

    def test_preserves_source_reading_variants_without_inferred_geography(self):
        row = {"sounds": [
            {"ipa": "/a/"}, {"ipa": "[a]"}, {"ipa": "/b/", "tags": ["dialectal"]},
            {"audio": "not-imported.ogg"}, {"ipa": "/a/"},
        ]}
        readings = source_readings(row)
        self.assertEqual(readings, [{"ipa": "/a/"}, {"ipa": "/b/", "tags": ["dialectal"]}])
        self.assertEqual(reading_text(readings), "/a/ | /b/ (dialectal)")
        self.assertNotIn("Spain", reading_text(readings))
        with self.assertRaisesRegex(ValueError, "no broad"):
            reading_text([])

    def test_checksum_mismatch_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input"
            path.write_bytes(b"changed source")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify(path, SOURCE_SHA256)

    def test_local_identity_is_not_a_level_or_fake_official_band(self):
        source = "en-querer-es-verb-pL-MnkyR"
        self.assertEqual(local_id(source), local_id(source))
        self.assertNotEqual(local_id(source), local_id(source + "another"))
        self.assertTrue(local_id(source).startswith("es-v-"))
        self.assertEqual(lexical_id("cafe\u0301"), lexical_id("caf\u00e9"))

    def test_written_form_checks_preserve_hyphens_apostrophes_and_accents(self):
        self.assertEqual(written("\u00bfPuedo pagar?"), written("puedo pagar"))
        self.assertNotEqual(written("p-a-g-a-r"), written("pagar"))
        self.assertNotEqual(written("pag'ar"), written("pagar"))
        self.assertNotEqual(written("esta"), written("est\u00e1"))

    def test_source_identity_conflict_is_rejected(self):
        first = {"word": "test", "pos": "noun", "senses": [{"id": "id", "glosses": ["one"]}]}
        second = {**first, "senses": [{"id": "id", "glosses": ["two"]}]}
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            record_index([first, second])

    def test_conjugation_metadata_is_not_a_licensed_written_form(self):
        row = {"pos": "verb", "forms": [
            {"form": "es-conj", "tags": ["inflection-template"]},
            {"form": "e-ie alternation", "tags": ["class"]},
            {"form": "quiero", "tags": ["first-person", "present", "singular"]},
        ]}
        self.assertEqual(surface_forms(row), [row["forms"][2]])
        self.assertEqual(selected_inflections(row), [row["forms"][2]])


class SpanishRealReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = record_index(load_projection())
        cls.expanded, cls.aliases = canonical_vocabulary()
        cls.senses = {sense["id"]: sense for group in cls.expanded for sense in group["senses"]}
        cls.selections = effective_selections(ROOT)

    def test_source_projection_is_bounded_and_excludes_quoted_content(self):
        projection = load_projection()
        self.assertLess((ROOT / "upstream" / "selected-records.jsonl.gz").stat().st_size, 10_000_000)
        for row in projection:
            self.assertNotIn("examples", row)
            self.assertNotIn("etymology_text", row)
            self.assertNotIn("categories", row)
            self.assertEqual(set(row), {
                "word", "pos", "etymology_number", "source_record_sha256", "readings", "senses", "forms",
            })
            for sense in row["senses"]:
                self.assertNotIn("examples", sense)
                self.assertNotIn("wikidata", sense)
                self.assertNotIn("categories", sense)

    def test_all_selected_glosses_and_readings_match_the_pinned_projection(self):
        for selection in self.selections:
            sense = self.senses[selection["id"]]
            original, meaning = self.source[selection["source_sense_id"]]
            self.assertEqual(sense["source_glosses"], meaning["glosses"])
            self.assertEqual(sense["target"], original["word"])
            self.assertEqual(sense["part_of_speech"], original["pos"])
            self.assertEqual(sense["reading"], reading_text(original["readings"]))
            self.assertEqual(sense["source_record_sha256"], original["source_record_sha256"])
            self.assertEqual(sense["inflections"], selected_inflections(original))
            self.assertTrue(sense["source_entry"].startswith("https://en.wiktionary.org/wiki/"))
            self.assertTrue(0 < len(sense["disambiguator"]) <= 64)

    def test_useful_polysemy_has_separate_source_senses_not_conjugation_ids(self):
        for first, second in [
            ("querer-want", "querer-love"),
            ("haber-existential", "haber-auxiliary"),
            ("banco-financial", "banco-bench"),
            ("mujer-woman", "mujer-wife"),
            ("saber-know", "saber-how"),
            ("estar-location", "estar-state"),
            ("orden-command", "orden-arrangement"),
        ]:
            self.assertNotEqual(self.aliases[first], self.aliases[second])
            self.assertEqual(self.senses[self.aliases[first]]["target"],
                             self.senses[self.aliases[second]]["target"])
        self.assertEqual(self.senses[self.aliases["cafe-drink"]]["part_of_speech"], "noun")
        self.assertIn("coffee", self.senses[self.aliases["cafe-drink"]]["english"])
        self.assertIn("cash", self.senses[self.aliases["efectivo-cash"]]["english"])
        self.assertIn("bathroom", self.senses[self.aliases["bano-room"]]["english"])

    def test_travel_bindings_do_not_change_meaning_with_level_order(self):
        resolve = resolve_items(ROOT, self.senses, self.aliases)
        with self.assertRaisesRegex(ValueError, "Ambiguous lemma"):
            resolve("lemma:ser")
        self.assertEqual(resolve("ser-occurrence"), self.aliases["ser-occurrence"])
        self.assertEqual(resolve(self.aliases["ser-occurrence"]), self.aliases["ser-occurrence"])
        for form in load_yaml(ROOT / "authoring" / "tourist-forms.yaml")["forms"]:
            if "item" in form:
                self.assertIn(resolve(form["item"]), self.senses)
        for alias, meaning in {
            "probar-try": "try out",
            "devolver-return": "give back",
            "salida-departure": "departure",
            "talla-clothing": "clothing size",
        }.items():
            self.assertIn(meaning, self.senses[resolve(alias)]["disambiguator"])
        self.assertEqual(self.senses[resolve("demasiado-degree")]["part_of_speech"], "adv")

    def test_reference_records_keep_the_shared_nine_fields(self):
        expected = {"id", "target", "reading", "english", "part_of_speech", "topic",
                    "source_id", "source_entry", "level_basis"}
        for group in self.expanded:
            self.assertTrue(expected <= set(group))
            self.assertTrue(all(isinstance(group[key], str) and group[key] for key in expected))
        for group in load_yaml(ROOT / "reference" / "vocabulary.yaml"):
            self.assertEqual(set(group), expected)

    def test_review_preserves_sense_identity_and_does_not_relabel_homographs(self):
        raw = {row["id"]: row for row in load_yaml(ROOT / "authoring" / "vocabulary.yaml")}
        review = load_yaml(ROOT / "authoring" / "lexical-review.yaml")
        self.assertFalse(set(review["exclude"]) & set(self.senses))
        for row in self.selections:
            for key in ("id", "lemma", "part_of_speech", "source_sense_id"):
                self.assertEqual(row[key], raw[row["id"]][key])
        for alias, expected in {
            "tienda-shop": "shop",
            "perro-dog": "dog",
            "carta-letter": "written message",
            "dificil-difficult": "difficult",
        }.items():
            self.assertIn(expected, self.senses[self.aliases[alias]]["disambiguator"])
        siblings = [row for row in self.selections if row["lemma"] in {"hermano", "hermana"}]
        self.assertEqual({lexical_id(row.get("breadth_lemma", row["lemma"])) for row in siblings},
                         {lexical_id("hermano")})
        placements = {row["id"]: row for row in self.selections}
        self.assertEqual(placements[self.aliases["cafe-drink"]]["topic"], "food")
        self.assertEqual(placements[self.aliases["efectivo-cash"]]["topic"], "money")

    def test_feminine_example_forms_have_the_correct_source_family(self):
        for form, alias in {
            "profesora": "profesor-teacher", "maestra": "maestro-teacher",
            "tía": "tio-uncle", "chica": "chico-boy", "novia": "novio-boyfriend",
        }.items():
            sense = self.senses[self.aliases[alias]]
            self.assertIn(form, [row["form"] for row in sense["inflections"]
                                 if "feminine" in row.get("tags", [])])

    def test_authored_grammar_and_small_travel_start_close_without_core(self):
        grammar = load_yaml(ROOT / "authoring" / "grammar.yaml")
        by_id = {}
        branch_limits = {row["id"]: row["after_level"]
                         for row in load_yaml(ROOT / "teaching" / "program.yaml")["extensions"]}
        for row in grammar:
            self.assertNotIn(row["id"], by_id)
            self.assertEqual(set(row), {"id", "level", "topic", "ch", "ds", "note",
                                        "examples", "fixed_forms", "anchors", "prerequisites"})
            self.assertTrue(all(isinstance(value, str) for value in row["fixed_forms"]))
            self.assertGreaterEqual(len(row["examples"]), 2)
            for dependency in row["prerequisites"]:
                self.assertIn(dependency, by_id)
                prior = by_id[dependency]["level"]
                if type(row["level"]) is int:
                    self.assertIs(type(prior), int)
                    self.assertLessEqual(prior, row["level"])
                elif type(prior) is int:
                    self.assertLessEqual(prior, branch_limits[row["level"]])
                else:
                    self.assertEqual(prior, row["level"])
            by_id[row["id"]] = row
        route, _ = compile_route(ROOT, self.senses, by_id, grammar)
        self.assertEqual(len(route["units"]), 12)
        self.assertEqual(sum(len(unit["phrases"]) for unit in route["units"]), 60)
        self.assertLessEqual(len(route["units"][0]["grammar"]), 6)
        self.assertLessEqual(sum(len(unit["grammar"]) for unit in route["units"][:5]), 20)
        words, patterns = set(), set()
        resolve = resolve_items(ROOT, self.senses, self.aliases)
        for unit in route["units"]:
            self.assertTrue(set(unit["review_vocabulary"]) <= words)
            self.assertTrue(set(unit["review_grammar"]) <= patterns)
            words.update(unit["vocabulary"])
            for identifier in unit["grammar"]:
                self.assertTrue(set(by_id[identifier]["prerequisites"]) <= patterns)
                self.assertTrue({resolve(alias) for alias in by_id[identifier]["anchors"]} <= words)
                patterns.add(identifier)
            for phrase in unit["phrases"]:
                self.assertTrue(set(phrase["items"]) <= words)
                self.assertTrue(set(phrase["grammar"]) <= patterns)
                self.assertEqual(written(phrase["ch"]),
                                 written(" ".join(form["ch"] for form in phrase["realizations"])))
        self.assertNotIn("es-g0082", patterns)
        self.assertNotIn(self.aliases["tener-possession"], route["units"][9]["phrases"][0]["items"])
        self.assertNotIn(self.aliases["ser-identity"], route["units"][7]["phrases"][2]["items"])

    def test_all_thirty_levels_and_four_branches_have_real_source_selections(self):
        destinations = {row["level"] for row in self.selections}
        self.assertEqual(destinations, set(range(1, 31)) | {"professional", "technical", "scientific", "literary"})
        self.assertGreater(len(self.senses), len(self.expanded))
        self.assertFalse(any(row["lemma"] in {"soy", "quiero", "estoy", "hemos"} for row in self.selections))

    def test_reference_generation_is_deterministic_and_check_is_read_only(self):
        self.assertEqual(reference_outputs(ROOT), reference_outputs(ROOT))
        generate(ROOT, check=True)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "spanish"
            for name in ("authoring", "upstream"):
                shutil.copytree(ROOT / name, root / name)
            generate(root)
            path = root / "reference" / "vocabulary.yaml"
            path.write_text("stale\n", encoding="utf-8")
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "stale"):
                generate(root, check=True)
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
