"""Regression checks for the bounded, explicitly unreviewed Korean writing pilot."""

from copy import deepcopy
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import unicodedata

from character_assets import build_outputs, sha256
from character_geometry import parse_path, sample_path, validate_path
from character_inventory import extract_inventory, foundation_characters
from curriculum_yaml import load_yaml, write_yaml
from import_korean_characters import GAP_REASON, generate, input_pins
from korean_character_composition import (
    JAMO_RECIPE, LAYOUT_RECIPE, LEADING, MEDIAL, SOURCE_ID, TRAILING, compatibility,
    compose, decompose, geometry_flags, letter_paths, load_recipes, pilot_records,
    placement, vowel_family,
)
from korean_character_preview import render_preview


ROOT = Path(__file__).resolve().parents[1] / "curriculum"


class KoreanPilotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.language_root = ROOT / "korean"
        cls.inventory = extract_inventory(ROOT, "korean")
        cls.jamo, cls.layouts = load_recipes(cls.language_root)
        cls.records, cls.report = pilot_records(cls.language_root, cls.inventory)

    def test_exact_inventory_and_bounded_pilot(self):
        self.assertEqual(len(self.inventory["required"]), 1209)
        self.assertEqual(len(self.inventory["components"]), 67)
        self.assertEqual(len(foundation_characters("korean")), 118)
        self.assertEqual(len(self.records), 174)
        syllables = {c for c in self.records if 0xAC00 <= ord(c) <= 0xD7A3}
        self.assertEqual(syllables, set(self.layouts["pilot_syllables"]))
        self.assertEqual(len(syllables), 54)
        self.assertEqual(len(self.jamo["consonants"]) + len(self.jamo["vowels"]), 24)
        self.assertEqual(len(self.jamo["double_consonants"]) + len(self.jamo["compound_vowels"]), 16)
        self.assertEqual(len(self.jamo["final_clusters"]), 11)

    def test_unicode_round_trip_without_dumping_syllables(self):
        for codepoint in range(0xAC00, 0xD7A4):
            character = chr(codepoint)
            leading, medial, trailing = decompose(character)
            self.assertEqual(0xAC00 + leading * 588 + medial * 28 + trailing, codepoint)
            sequence = chr(0x1100 + leading) + chr(0x1161 + medial)
            if trailing:
                sequence += chr(0x11A7 + trailing)
            self.assertEqual(unicodedata.normalize("NFC", sequence), character)
        for invalid in ("", "ab", "\ud800", "ㄱ", "\ua960", "\ud7a4"):
            with self.assertRaises(ValueError):
                decompose(invalid)

    def test_modern_foundations_preserve_positional_identity(self):
        for character in foundation_characters("korean"):
            self.assertIn(character, self.records)
            self.assertTrue(0x3131 <= ord(compatibility(character)) <= 0x3163)
        for character in ("ᄀ", "ᆨ", "ㄱ"):
            self.assertIn(character, self.records)
        self.assertEqual(self.records["ᄀ"]["kind"], "component")
        self.assertEqual(self.records["ᆨ"]["kind"], "component")
        self.assertEqual(self.records["ㄱ"]["kind"], "character")
        self.assertNotIn("ㄱ", [a["text"] for a in self.records["ㄱ"].get("aliases", [])])
        for excluded in ("\u115f", "\u1160", "\u3164", "\ua960", "\uffa1"):
            self.assertNotIn(excluded, self.records)
            with self.assertRaises(ValueError):
                compatibility(excluded)

    def test_all_candidate_geometry_is_original_and_unreviewed(self):
        for character, record in self.records.items():
            variant = record["variants"][0]
            self.assertEqual(record["default_variant"], variant["id"])
            self.assertEqual(variant["status"], {"generated": True, "validated": True, "reviewed": False})
            self.assertNotIn("review", variant)
            self.assertNotIn("readings", variant)
            self.assertEqual({p["source_id"] for p in variant["provenance"]}, {SOURCE_ID})
            self.assertEqual(variant["transform"]["matrix"], [1, 0, 0, 1, 0, 0])
            for stroke in variant["strokes"]:
                validate_path(stroke["path"])
                self.assertEqual(sum(op == "M" for op, _ in parse_path(stroke["path"])), 1)
                samples = sample_path(stroke["path"])
                self.assertGreater(len(samples), 1)

    def test_closed_ieung_is_one_pen_down(self):
        strokes = self.records["ㅇ"]["variants"][0]["strokes"]
        self.assertEqual(len(strokes), 1)
        samples = sample_path(strokes[0]["path"])
        self.assertEqual(samples[0], samples[-1])
        self.assertGreater(len({tuple(point) for point in samples}), 20)

    def test_requested_vertical_ticks_in_every_hieuh_and_chieuch_form(self):
        for character in ("ㅎ", "ㅊ"):
            for form, paths in self.jamo["consonants"][character].items():
                with self.subTest(character=character, form=form):
                    tick, bar = parse_path(paths[0], bounded=False), parse_path(paths[1], bounded=False)
                    self.assertEqual([op for op, _ in tick], ["M", "L"])
                    start, end = tick[0][1], tick[1][1]
                    self.assertEqual(start[0], end[0])
                    self.assertLess(start[1], end[1])
                    self.assertEqual(end[1], bar[0][1][1])
                    self.assertLess(bar[0][1][0], end[0])
                    self.assertGreater(bar[1][1][0], end[0])
                    self.assertEqual(len(paths), 3)

    def test_branches_join_on_curve_not_at_arbitrary_nearby_points(self):
        for character in ("ㅅ", "ㅈ", "ㅊ"):
            for form, paths in self.jamo["consonants"][character].items():
                with self.subTest(character=character, form=form):
                    left, right = [parse_path(path, bounded=False) for path in paths[-2:]]
                    junction = right[0][1]
                    vertices = [coordinates[-2:] for _, coordinates in left]
                    self.assertIn(junction, vertices[1:-1])
                    self.assertLess(vertices[-1][0], junction[0])
                    self.assertGreater(right[-1][1][-2], junction[0])
                    self.assertGreater(vertices[-1][1], junction[1])
                    self.assertGreater(right[-1][1][-1], junction[1])

    def test_joined_vowel_crossbars_reach_the_right_stem(self):
        for character, bars in (("ㅐ", (1,)), ("ㅒ", (1, 2)), ("ㅙ", (3,))):
            paths = [parse_path(path) for path in letter_paths(self.jamo, character)]
            stem_start, stem_end = paths[-1][0][1], paths[-1][-1][1]
            for index in bars:
                with self.subTest(character=character, stroke=index):
                    endpoint = paths[index][-1][1]
                    self.assertAlmostEqual(endpoint[0], stem_start[0])
                    self.assertGreater(endpoint[1], stem_start[1])
                    self.assertLess(endpoint[1], stem_end[1])

    def test_thieuth_draws_middle_bar_before_left_and_bottom(self):
        for form, paths in self.jamo["consonants"]["ㅌ"].items():
            with self.subTest(form=form):
                top, middle, corner = [parse_path(path, bounded=False) for path in paths]
                self.assertEqual([op for op, _ in top], ["M", "L"])
                self.assertEqual([op for op, _ in middle], ["M", "L"])
                self.assertEqual([op for op, _ in corner], ["M", "L", "L"])
                self.assertLess(top[0][1][1], middle[0][1][1])
                self.assertLess(middle[0][1][1], corner[-1][1][1])
                self.assertEqual(corner[0][1][0], corner[1][1][0])

    def test_paired_forms_do_not_halve_component_height(self):
        def height(paths):
            coordinates = [values[index + 1] for path in paths
                           for _, values in parse_path(path, bounded=False)
                           for index in range(0, len(values), 2)]
            return max(coordinates) - min(coordinates)
        for doubled, base in self.jamo["double_consonants"].items():
            for form in ("isolated", "side", "wide"):
                with self.subTest(character=doubled, form=form):
                    original = letter_paths(self.jamo, base, form)
                    first = letter_paths(self.jamo, doubled, form)[:len(original)]
                    self.assertGreaterEqual(height(first), 0.8 * height(original))

    def test_mixed_vowel_bars_keep_their_relative_heights(self):
        for character in ("ㅝ", "ㅞ"):
            paths = [parse_path(path) for path in letter_paths(self.jamo, character)]
            u_bar_y, eo_arm_y = paths[0][0][1][1], paths[2][0][1][1]
            self.assertEqual(u_bar_y, paths[0][-1][1][1])
            self.assertEqual(paths[1][0][1][0], paths[1][-1][1][0])
            self.assertGreater(eo_arm_y - u_bar_y, 8)
            self.assertGreater(paths[3][0][1][0] - paths[0][-1][1][0], 8)
        for character in ("ㅘ", "ㅙ"):
            paths = [parse_path(path) for path in letter_paths(self.jamo, character)]
            self.assertGreater(paths[2][0][1][0] - paths[1][-1][1][0], 8)

    def test_composition_preserves_component_order_and_strokes(self):
        for character in self.layouts["pilot_syllables"]:
            parts = compose(self.jamo, self.layouts, character)
            variant = self.records[character]["variants"][0]
            self.assertEqual([part["role"] for part in parts][:2], ["initial", "medial"])
            self.assertEqual([stroke["path"] for stroke in variant["strokes"]],
                             [path for part in parts for path in part["paths"]])
            sequence = "".join(part["character"] for part in parts)
            self.assertEqual(sequence, unicodedata.normalize("NFD", character))
        self.assertEqual(len(letter_paths(self.jamo, "ㄲ")), 2)
        self.assertEqual(len(letter_paths(self.jamo, "ㄽ")), 5)

    def test_pilot_covers_component_and_broad_layout_families(self):
        decomposed = [decompose(c) for c in self.layouts["pilot_syllables"]]
        self.assertEqual({p[0] for p in decomposed}, set(range(len(LEADING))))
        self.assertEqual({p[1] for p in decomposed}, set(range(len(MEDIAL))))
        self.assertEqual({p[2] for p in decomposed}, set(range(len(TRAILING))) - {12})
        all_required = [decompose(c) for c in self.inventory["required"] if 0xAC00 <= ord(c) <= 0xD7A3]
        def family(parts):
            _, medial, final = parts
            kind = ("none" if not final else "double" if final in (2, 20)
                    else "cluster" if TRAILING[final] in self.jamo["final_clusters"] else "single")
            return vowel_family(medial), kind
        self.assertEqual({family(p) for p in decomposed}, {family(p) for p in all_required})
        context = self.report["contextual_assignments"]
        self.assertEqual(context["total"], 196)
        self.assertEqual(context["exercised"], 102)
        self.assertEqual(len(context["unexercised"]), 94)
        self.assertEqual(context["qualified_reviewed"], 0)

    def test_density_hints_are_not_silent_fixes(self):
        parts = [{"character": "x", "role": "test",
                  "paths": ["M20 20 L80 20", "M20 24 L80 24"]}]
        before = deepcopy(parts)
        self.assertTrue(any(f["kind"] == "near-parallel-strokes" for f in geometry_flags(parts)))
        self.assertEqual(parts, before)
        self.assertFalse(any(flag.get("clearance", 0) < 0 for detail in self.report["characters"].values()
                             for flag in detail["flags"]))

    def test_unavailable_contexts_and_invalid_placements_fail(self):
        mixed_cluster = chr(0xAC00 + 9 * 28 + 3)
        with self.assertRaisesRegex(ValueError, "outside the pilot"):
            compose(self.jamo, self.layouts, mixed_cluster)
        with self.assertRaisesRegex(ValueError, "No original"):
            letter_paths(self.jamo, "\u3164")
        for values in ([0, 0, 0], [1, 0], [float("nan"), 0, 0], [True, 0, 0]):
            with self.assertRaises(ValueError):
                placement(["M0 0 L1 1"], values)

    def test_two_literal_signs_are_not_hangul(self):
        self.assertEqual(set(self.inventory["literal_signs"]), {".", "?"})
        for character in (".", "?"):
            self.assertEqual(self.records[character]["script"], "Common")
            self.assertEqual(self.records[character]["kind"], "sign")
        self.assertEqual(len(self.records["?"]["variants"][0]["strokes"]), 2)
        self.assertNotIn("-", self.records)

    def test_coverage_keeps_missing_and_review_gates(self):
        expected = set(self.inventory["required"]) | set(self.inventory["components"])
        outputs = build_outputs(
            self.language_root, self.records, self.inventory, input_pins(self.language_root),
            adapter="test", adapter_version="1",
            blocked={c: GAP_REASON for c in sorted(expected - self.records.keys())},
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "coverage.yaml"
            path.write_text(outputs["coverage.yaml"], encoding="utf-8")
            coverage = load_yaml(path)
        self.assertFalse(coverage["release_ready"])
        self.assertFalse(coverage["text_coverage_complete"])
        self.assertEqual(len(coverage["missing"]), 1104)
        self.assertEqual(len(coverage["source_blocked"]), 1104)
        self.assertEqual(coverage["reviewed"], [])
        self.assertEqual(coverage["literal_signs_missing"], [])
        self.assertEqual(coverage["missing_license_inputs"], [])
        self.assertEqual(coverage["missing_components"], [])

    def test_preview_uses_exact_paths_and_declares_review_limits(self):
        html = render_preview(self.inventory, self.records, self.report, "0" * 64)
        self.assertEqual(html.count("<article "), 174)
        self.assertIn("102 of 196", html)
        self.assertIn("qualified reviewed: 0", html)
        self.assertIn("UNREVIEWED", html)
        self.assertIn("Next stroke", html)
        self.assertIn('class="hide-directions"', html)
        self.assertIn('id="overview"', html)
        self.assertNotIn("https://fonts.", html)
        for record in self.records.values():
            for stroke in record["variants"][0]["strokes"]:
                self.assertIn(stroke["path"], html)

    def test_rebuild_is_deterministic_and_check_does_not_mutate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "curriculum"
            root.mkdir()
            shutil.copy2(ROOT / "catalog.yaml", root / "catalog.yaml")
            shutil.copytree(self.language_root, root / "korean")
            with patch("korean_character_composition.geometry_flags", return_value=[]):
                generate(root)
                before = {str(p.relative_to(root)): sha256(p.read_bytes())
                          for p in root.rglob("*") if p.is_file()}
                self.assertEqual(generate(root, check=True), [])
                self.assertEqual(generate(root), [])
                self.assertEqual(before, {str(p.relative_to(root)): sha256(p.read_bytes())
                                          for p in root.rglob("*") if p.is_file()})
                preview = root / "korean" / "characters" / "pilot-preview.html"
                preview.write_text("stale", encoding="utf-8")
                self.assertIn("pilot-preview.html", generate(root, check=True))
                self.assertEqual(preview.read_text(encoding="utf-8"), "stale")
                source = root / "korean" / "upstream" / "writing" / "hangeul-stroke-order-README.md"
                source.write_text("changed source", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    generate(root, check=True)

    def test_no_bulk_pilot_list_change_without_explicit_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "characters" / "recipes").mkdir(parents=True)
            write_yaml(root / JAMO_RECIPE, self.jamo)
            changed = deepcopy(self.layouts)
            changed["pilot_syllables"].append("각")
            write_yaml(root / LAYOUT_RECIPE, changed)
            with self.assertRaisesRegex(ValueError, "54 distinct"):
                load_recipes(root)


if __name__ == "__main__":
    unittest.main()
