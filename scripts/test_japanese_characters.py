"""Targeted tests for the Japanese source adapter and complete prepared candidate set."""

from copy import deepcopy
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from character_assets import validate_bundle
from character_geometry import normalize_svg_path, sample_path
from character_inventory import extract_inventory
from import_japanese_characters import (
    APL, BLOCKED, FIRST_BATCH, LGPL, ROOT, SVG, animcjk_paths, build_records,
    chosen_characters, classify, generate, kanjivg_paths, load_inputs, local_path,
    normalized_strokes, review_only_fish, source_path, svg_root,
)


class JapaneseWritingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = extract_inventory(ROOT.parent, "japanese")
        cls.records, cls.pins, cls.recipes = build_records(ROOT, cls.inventory, "first")

    def raw_kvg(self, character):
        return (ROOT / "upstream" / "writing" / "kanjivg" / "kanji"
                / f"{ord(character):05x}.svg").read_bytes()

    def raw_anim(self, character):
        return (ROOT / "upstream" / "writing" / "animcjk" / "svgsJa"
                / f"{ord(character)}.svg").read_bytes()

    def test_authoritative_scope_and_batch_remain_distinct(self):
        self.assertEqual(len(self.inventory["required"]), 2211)
        self.assertEqual(self.inventory["components"], ["\u3099", "\u309a"])
        self.assertEqual(self.inventory["literal_cross_script"], list("\uff27\uff2b\uff2f\uff58"))
        self.assertEqual(len(self.inventory["required"]) + len(self.inventory["components"]), 2213)
        self.assertEqual(set(chosen_characters(self.inventory, "first")), set(FIRST_BATCH))
        self.assertEqual(set(chosen_characters(self.inventory, "full")),
                         set(self.inventory["required"]) | set(self.inventory["components"]))
        self.assertEqual(len(self.records), 34)
        self.assertNotIn("\u9c5d", self.records)
        self.assertEqual(set(BLOCKED), {"\u9c5d"})

    def test_exact_script_families_and_component_roles(self):
        for character, expected in {
            "\u3005": ("Han", "sign"), "\u3007": ("Han", "sign"),
            "\u3099": ("Inherited", "component"), "\u309a": ("Inherited", "component"),
            "\u309b": ("Common", "sign"), "\u30fc": ("Common", "sign"),
            "\u3042": ("Hiragana", "character"), "\u30a2": ("Katakana", "character"),
        }.items():
            self.assertEqual(classify(character), expected)

    def test_kana_logical_pen_counts_and_direct_curve_preservation(self):
        for character, count in {
            "\u3042": 3, "\u306c": 2, "\u306d": 2, "\u306e": 1, "\u304d": 4,
            "\u3055": 3, "\u3071": 4, "\u3077": 5, "\u30f4": 5, "\u3094": 4,
        }.items():
            with self.subTest(character=character):
                _, source = kanjivg_paths(self.raw_kvg(character), character)
                actual = self.records[character]["variants"][0]["strokes"]
                self.assertEqual(len(actual), count)
                self.assertEqual(actual, normalized_strokes(source, 109))
                self.assertTrue(all(" C" in stroke["path"] for stroke in actual))

    def test_small_kana_keeps_native_size_and_lower_position(self):
        def bounds(character):
            points = [p for stroke in self.records[character]["variants"][0]["strokes"]
                      for p in sample_path(stroke["path"])]
            return [min(p[0] for p in points), max(p[0] for p in points),
                    min(p[1] for p in points), max(p[1] for p in points)]
        full, small = bounds("\u3042"), bounds("\u3041")
        self.assertLess(small[1] - small[0], (full[1] - full[0]) * 0.85)
        self.assertGreater(small[2], full[2] + 10)
        self.assertEqual(self.records["\u3041"]["variants"][0]["transform"]["matrix"],
                         [100/109, 0, 0, 100/109, 0, 0])

    def test_contextual_marks_are_exact_source_strokes_not_spacing_aliases(self):
        for mark, source, tail in (("\u3099", "\u304c", 2), ("\u309a", "\u3071", 1)):
            _, paths = kanjivg_paths(self.raw_kvg(source), source)
            variant = self.records[mark]["variants"][0]
            self.assertEqual(variant["strokes"], normalized_strokes(paths[-tail:], 109))
            self.assertEqual(len(variant["strokes"]), tail)
            self.assertIn("recipe", variant)
            self.assertEqual(self.recipes["combining_marks"][mark]["source_character"], source)
            self.assertNotIn("components", variant)
            points = [p for s in variant["strokes"] for p in sample_path(s["path"])]
            self.assertGreater(min(p[0] for p in points), 70)
            self.assertLess(max(p[1] for p in points), 30)
        self.assertNotEqual(self.records["\u3099"]["variants"][0]["strokes"],
                            self.records["\u309b"]["variants"][0]["strokes"])

    def test_alternative_assets_have_distinct_licenses_and_open_zero_median(self):
        for character, source_id, count in (("\u79ed", APL, 9), ("\u3007", LGPL, 1)):
            _, paths = animcjk_paths(self.raw_anim(character), character, count)
            variant = self.records[character]["variants"][0]
            self.assertEqual(variant["provenance"][0]["source_id"], source_id)
            self.assertEqual(variant["strokes"], normalized_strokes(paths, 1024))
        points = sample_path(self.records["\u3007"]["variants"][0]["strokes"][0]["path"])
        self.assertNotEqual(points[0], points[-1])

    def test_kanjivg_rejects_reordered_duplicate_and_wrong_character_ids(self):
        raw = self.raw_kvg("\u3042")
        root, paths = kanjivg_paths(raw, "\u3042")
        paths[1].set("id", paths[0].get("id"))
        with self.assertRaisesRegex(ValueError, "stroke IDs"):
            kanjivg_paths(ET.tostring(root), "\u3042")
        with self.assertRaisesRegex(ValueError, "stroke group"):
            kanjivg_paths(self.raw_kvg("\u52c9"), "\ufa33")
        root, paths = kanjivg_paths(raw, "\u3042")
        paths[0].set("transform", "translate(1,2)")
        with self.assertRaisesRegex(ValueError, "transform"):
            kanjivg_paths(ET.tostring(root), "\u3042")

    def test_animcjk_rejects_split_or_duplicate_animation_paths(self):
        raw = self.raw_anim("\u3007")
        root, paths = animcjk_paths(raw, "\u3007", 1)
        paths[0].set("clip-path", "url(#z12295c1a)")
        with self.assertRaisesRegex(ValueError, "mapping"):
            animcjk_paths(ET.tostring(root), "\u3007", 1)
        root, _ = animcjk_paths(raw, "\u3007", 1)
        outline = next(p for p in root.iter(SVG + "path") if p.get("id"))
        root.append(deepcopy(outline))
        with self.assertRaisesRegex(ValueError, "Ambiguous/split"):
            animcjk_paths(ET.tostring(root), "\u3007", 1)

    def test_unexpected_svg_content_and_disconnected_paths_fail(self):
        with self.assertRaisesRegex(ValueError, "entity"):
            svg_root(b'<!ENTITY x "y"><svg/>', 109)
        with self.assertRaisesRegex(ValueError, "External"):
            svg_root(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109">'
                     b'<use href="https://example.invalid/external"/></svg>', 109)
        with self.assertRaisesRegex(ValueError, "disconnected"):
            normalized_strokes([ET.Element(SVG + "path", d="M10 10L20 20M30 30L40 40")], 109)
        with self.assertRaises(ValueError):
            normalize_svg_path("M0 0 C0 0 200 200 100 100", [100/109, 0, 0, 100/109, 0, 0])

    def test_review_only_fish_retains_donor_recipe_and_never_becomes_record(self):
        fish = review_only_fish(ROOT)
        self.assertEqual(len(fish["strokes"]), 23)
        self.assertFalse(fish["reviewed"])
        self.assertIn("blocked", fish)
        self.assertEqual(fish["recipe"]["input"], "characters/recipes.yaml")
        self.assertEqual(len(fish["provenance"]), 3)
        self.assertNotIn(fish["character"], self.records)

    def test_bundle_is_structurally_valid_but_not_complete_or_reviewed(self):
        coverage = validate_bundle(ROOT)
        expected = (set(self.inventory["required"]) | set(self.inventory["components"])) - set(BLOCKED)
        self.assertEqual(coverage["drawable"], sorted(expected))
        self.assertEqual(len(coverage["drawable"]), 2212)
        self.assertEqual(coverage["validated"], coverage["drawable"])
        self.assertEqual(coverage["missing"], ["\u9c5d"])
        self.assertEqual(coverage["reviewed"], [])
        self.assertEqual(coverage["default_reviewed"], [])
        self.assertEqual(coverage["cross_script_missing"], list("\uff27\uff2b\uff2f\uff58"))
        self.assertEqual(coverage["missing_license_inputs"], [])
        self.assertEqual(coverage["missing_components"], [])
        self.assertFalse(coverage["text_coverage_complete"])
        self.assertFalse(coverage["release_ready"])
        for record in self.records.values():
            variant = record["variants"][0]
            self.assertEqual(variant["status"], {"generated": True, "validated": True, "reviewed": False})
            self.assertNotIn("readings", variant)

    def test_offline_check_is_deterministic_and_write_free(self):
        with patch("import_japanese_characters.fetch", side_effect=AssertionError("Unexpected network")):
            before = {p: (p.stat().st_mtime_ns, p.read_bytes())
                      for p in (ROOT / "characters").glob("*.yaml")}
            self.assertEqual(generate(check=True)[0], [])
            self.assertEqual(generate(check=True)[0], [])
            after = {p: (p.stat().st_mtime_ns, p.read_bytes())
                     for p in (ROOT / "characters").glob("*.yaml")}
            self.assertEqual(before, after)
        with self.assertRaisesRegex(ValueError, "cannot write"):
            generate(check=True, review_directory=Path("unused-review-directory"))

    def test_missing_or_tampered_input_is_an_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copytree(ROOT / "upstream" / "writing", root / "upstream" / "writing")
            shutil.copytree(ROOT / "licenses", root / "licenses")
            (root / "characters").mkdir()
            shutil.copyfile(ROOT / "characters" / "recipes.yaml", root / "characters" / "recipes.yaml")
            path = local_path(root, source_path("kanjivg", "kanji/03042.svg"))
            path.write_bytes(path.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "checksum"):
                load_inputs(root)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                load_inputs(root)
        for invalid in ("../outside", "C:/outside", "upstream\\bad", "/absolute"):
            with self.assertRaises(ValueError):
                local_path(ROOT, invalid)


if __name__ == "__main__":
    unittest.main()
