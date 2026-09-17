"""Chinese writing provenance, prototype regression and no-write checks."""

from copy import deepcopy
import io
import math
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import yaml

from character_assets import build_outputs, sha256
from character_geometry import parse_path, sample_path
from character_inventory import extract_inventory
from chinese_monoline import (
    candidate_stroke, coordinates, correct_terminals, length, normalize_median,
    reviewed_stroke, source_median_path,
)
from curriculum_yaml import CurriculumLoader, load_yaml
import import_chinese_writing as importer


class ChineseGeometryTests(unittest.TestCase):
    def test_original_em_box_maps_once_with_padding(self):
        self.assertEqual(normalize_median([[0, 900], [1024, -124]]), [[5, 5], [95, 95]])
        points = [[320, 600], [600, 650]]
        before = deepcopy(points)
        result = normalize_median(points)
        self.assertEqual(points, before)
        self.assertGreater(result[1][0], result[0][0])
        self.assertLess(result[1][1], result[0][1])

    def test_source_validation_rejects_invalid_or_duplicate_points(self):
        for points in ([], [[1, 2]], [[1, 2], [1, 2]], [[0, 901], [1, 2]],
                       [[0, -125], [1, 2]], [[True, 0], [1, 2]], [[0, 0], [math.inf, 1]]):
            with self.subTest(points=points), self.assertRaises(ValueError):
                normalize_median(points)

    def test_js_halfway_serialization_preserves_reviewed_paths(self):
        self.assertEqual(coordinates([0.0625, -0.00001]), "0.063 0")
        self.assertEqual(coordinates([10.0, 100.0]), "10 100")

    def test_line_fit_keeps_slant_and_position(self):
        path, rule = reviewed_stroke([[20, 30], [40, 25], [80, 15]], {"shape": "line"})
        self.assertEqual(path, "M20 30 L80 15")
        self.assertIsNone(rule)
        self.assertEqual(reviewed_stroke([[42, 12], [44, 50], [46, 88]],
                                        {"shape": "line"})[0], "M42 12 L46 88")

    def test_ambiguous_and_compound_strokes_remain_source_median(self):
        examples = [
            [[10, 20], [70, 20], [70, 80], [55, 70]],
            [[20, 20], [21, 40]], [[20, 40], [40, 35]],
            [[50, 20], [35, 45], [10, 70]],
            [[10, 10], [50, 50], [90, 70]],
            [[20, 20], [28, 20], [28, 28]],
            [[20, 20], [30, 32], [26, 28]], [[20, 20], [22, 22]],
        ]
        for points in examples:
            with self.subTest(points=points):
                path, rule = candidate_stroke(points)
                self.assertIsNone(rule)
                self.assertEqual(path, source_median_path(points))

    def test_short_strokes_retain_length_and_width_is_bounded(self):
        points = [[20, 20], [25, 24]]
        for width in (3, 5.5, 7):
            corrected, rule = correct_terminals(points, width)
            self.assertEqual(rule, "short-fall")
            self.assertGreaterEqual(length(corrected), length(points) * 0.35 - 1e-8)
        for width in (True, 0, math.nan, 8):
            with self.assertRaises(ValueError):
                correct_terminals(points, width)

    def test_invalid_reviewed_recipes_are_errors_not_fallbacks(self):
        for recipe in ({"shape": "line", "from": 1}, {"shape": "unknown"},
                       {"shape": "line", "from": True}, {"shape": "line", "extra": 1}):
            with self.subTest(recipe=recipe), self.assertRaises(ValueError):
                reviewed_stroke([[1, 2], [3, 4]], recipe)

    def test_baseline_does_not_silently_clamp_controls(self):
        with self.assertRaisesRegex(ValueError, "100-unit frame"):
            source_median_path([[95, 5], [5, 5], [5, 95]])


class ChineseAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = extract_inventory(importer.ROOT.parent, "chinese")
        cls.source, cls.lock, cls.inputs = importer.read_source(importer.ROOT, cls.inventory["required"])
        cls.recipes, cls.recipe_pin = importer.read_recipes(importer.ROOT)
        cls.batch_source = {character: cls.source[character] for character in importer.BATCH}
        cls.records, cls.queue = importer.make_records(
            cls.batch_source, cls.lock, cls.recipes, cls.recipe_pin,
        )

    def fixture_root(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name) / "chinese"
        for name in (importer.ARCHIVE, importer.LOCK, importer.LICENSE, importer.RECIPES, "sources.yaml"):
            destination = importer.local(root, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(importer.local(importer.ROOT, name), destination)
        return root

    def snapshot(self, root):
        return {path.relative_to(root).as_posix(): path.read_bytes()
                for path in root.rglob("*") if path.is_file()}

    def test_exact_inventory_and_explicit_non_han_sign_gaps(self):
        self.assertEqual(len(self.inventory["required"]), 3001)
        self.assertEqual(sha256("".join(self.inventory["required"]).encode("utf-8")),
                         "51f1a0decf3b4c1fe1d717894bb2892136bcda64320ca7670a3a104fc7772809")
        self.assertEqual(set(self.inventory["literal_signs"]), set("\u3002\uff0c\uff1b\uff1f"))
        self.assertEqual(self.inventory["literal_cross_script"], [])
        self.assertEqual(self.inventory["components"], [])
        self.assertIn("\u6bcb", self.inventory["required"])
        self.assertEqual(len({ord(c) >> 8 for c in self.inventory["required"]}), 80)

    def test_selected_original_counts_and_immutable_license(self):
        self.assertEqual(len(self.source), 3001)
        self.assertEqual(sum(len(row["strokes"]) for row in self.source.values()), 28418)
        self.assertEqual(sum(value["bytes"] for name, value in self.lock["members"].items()
                             if name.startswith("data/")), 8372864)
        self.assertEqual(sha256(importer.local(importer.ROOT, importer.LICENSE).read_bytes()),
                         importer.LICENSE_SHA256)

    def test_exact_five_path_goldens_and_inherited_attestation(self):
        for character in importer.APPROVED:
            with self.subTest(character=character):
                record = self.records[character]
                variant = record["variants"][-1]
                paths = [stroke["path"] for stroke in variant["strokes"]]
                self.assertEqual(paths, self.recipes["characters"][character]["paths"])
                self.assertEqual(importer.path_hash(paths), self.recipes["characters"][character]["paths_sha256"])
                self.assertEqual(record["default_variant"], "reviewed-monoline")
                self.assertTrue(variant["status"]["reviewed"])
                self.assertEqual(variant["review"]["date"], "2026-09-15")
                self.assertIn("carried forward by coordinating agent", variant["review"]["reviewer"])
                self.assertFalse(record["variants"][0]["status"]["reviewed"])

    def test_changed_goldens_or_incomplete_recipes_cannot_reuse_approval(self):
        for field, replacement in (("paths", ["M1 1 L2 2"]), ("strokes", []),
                                   ("source_member_sha256", "0" * 64)):
            recipes = deepcopy(self.recipes)
            recipes["characters"]["\u4e00"][field] = replacement
            with self.subTest(field=field), self.assertRaises(ValueError):
                importer.make_records(self.batch_source, self.lock, recipes, self.recipe_pin)

    def test_candidate_status_and_defaults_never_promote_review(self):
        self.assertEqual(len(self.queue), 18)
        self.assertEqual(sum(v["id"] == "refined-candidate" for r in self.records.values()
                             for v in r["variants"]), 15)
        for character, record in self.records.items():
            if character not in importer.APPROVED:
                self.assertEqual(record["default_variant"], "source-median")
                self.assertTrue(all(not v["status"]["reviewed"] for v in record["variants"]))

    def test_batch_report_distinguishes_detector_flags_from_new_variants(self):
        outputs = importer.review_outputs(self.records, self.batch_source, self.queue)
        report = yaml.load(outputs["review/batch-candidates.yaml"], Loader=CurriculumLoader)
        self.assertEqual(report["detector_flagged_glyphs"], 18)
        self.assertEqual(report["variant_counts"],
                         {"refined-candidate": 15, "reviewed-monoline": 5, "source-median": 30})
        self.assertEqual(set(report["style_cautions"]), set(importer.STYLE_CAUTIONS))

    def test_matching_samples_follow_final_display_paths(self):
        outputs = importer.review_outputs(self.records, self.batch_source, self.queue)
        report = yaml.load(outputs["review/batch-001.yaml"], Loader=CurriculumLoader)
        for record in report["characters"]:
            for variant in record["variants"]:
                self.assertEqual([stroke["order"] for stroke in variant["strokes"]],
                                 list(range(1, len(variant["strokes"]) + 1)))
                for stroke in variant["strokes"]:
                    samples = stroke["samples"]
                    self.assertEqual(samples, sample_path(stroke["path"]))
                    self.assertEqual(samples[0], [round(v, 6) for v in parse_path(stroke["path"])[0][1]])
                    self.assertGreater(len(samples), 1)
        tea = next(record for record in report["characters"] if record["character"] == "\u8336")
        self.assertNotEqual([stroke["samples"] for stroke in tea["variants"][0]["strokes"]],
                            [stroke["samples"] for stroke in tea["variants"][-1]["strokes"]])

    def test_archive_corruption_is_an_error(self):
        root = self.fixture_root()
        path = importer.local(root, importer.ARCHIVE)
        path.write_bytes(path.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "archive checksum mismatch"):
            importer.read_source(root, self.inventory["required"])

    def test_source_preparation_requires_the_exact_upstream_pin(self):
        with self.assertRaisesRegex(ValueError, "archive SHA-256 mismatch"):
            importer.prepare_source(importer.ROOT, b"not the approved source archive")

    def test_review_only_command_never_calls_bulk_generator(self):
        with patch.object(importer.sys, "argv", ["import_chinese_writing.py", "--review-batch"]), \
                patch.object(importer, "generate_batch", return_value={"review_batch": 30}) as batch, \
                patch.object(importer, "generate") as bulk, patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(importer.main(), 0)
            batch.assert_called_once_with(importer.ROOT)
            bulk.assert_not_called()

    def test_batch_writes_review_artifacts_but_no_shards_or_manifest(self):
        root = self.fixture_root()
        before = set(self.snapshot(root))
        with patch.object(importer, "extract_inventory", return_value=self.inventory):
            result = importer.generate_batch(root)
        self.assertEqual(result["review_batch"], 30)
        self.assertFalse(result["bulk_output"])
        self.assertEqual(set(self.snapshot(root)) - before, {
            "characters/review/batch-001.html", "characters/review/batch-001.yaml",
            "characters/review/batch-candidates.yaml",
        })

    def test_check_dispatch_is_explicitly_offline_and_no_write(self):
        with patch.object(importer.sys, "argv", ["import_chinese_writing.py", "--check"]), \
                patch.object(importer, "generate", return_value={}) as generate, \
                patch.object(importer, "prepare_source") as prepare, \
                patch.object(importer.urllib.request, "urlopen") as download, \
                patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(importer.main(), 0)
            generate.assert_called_once_with(importer.ROOT, check=True)
            prepare.assert_not_called()
            download.assert_not_called()

    def test_importer_check_does_not_create_missing_output_directories(self):
        root = self.fixture_root()
        before = self.snapshot(root)
        with patch.object(importer, "extract_inventory", return_value=self.inventory), \
                patch.object(importer, "make_records", return_value=(self.records, self.queue)), \
                patch.object(importer.urllib.request, "urlopen", side_effect=AssertionError("network")):
            with self.assertRaisesRegex(ValueError, "Missing or stale"):
                importer.generate(root, check=True)
        self.assertEqual(self.snapshot(root), before)
        self.assertFalse((root / "characters" / "review").exists())
        self.assertFalse((root / "characters" / "manifest.yaml").exists())

    def test_no_write_missing_and_stale_review_detection(self):
        root = self.fixture_root()
        outputs = importer.review_outputs(self.records, self.batch_source, self.queue)
        before = self.snapshot(root)
        self.assertEqual(set(importer.write_review(root, outputs, check=True)), set(outputs))
        self.assertEqual(self.snapshot(root), before)
        importer.write_review(root, outputs, check=False)
        self.assertEqual(importer.write_review(root, outputs, check=True), [])
        path = root / "characters" / "review" / "batch-001.html"
        path.write_bytes(b"stale")
        before = self.snapshot(root)
        self.assertEqual(importer.write_review(root, outputs, check=True), ["review/batch-001.html"])
        self.assertEqual(self.snapshot(root), before)

    def test_bundle_reports_reviewed_defaults_not_all_variant_approval(self):
        minimal = {"language": "chinese", "required": sorted(importer.BATCH), "components": []}
        outputs = build_outputs(importer.ROOT, self.records, minimal, self.inputs + [self.recipe_pin],
                                adapter="chinese-writing", adapter_version="1", notice=importer.NOTICE)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "coverage.yaml"
            path.write_text(outputs["coverage.yaml"], encoding="utf-8")
            coverage = load_yaml(path)
        self.assertEqual(coverage["default_reviewed"], sorted(importer.APPROVED))
        self.assertEqual(coverage["reviewed"], [])
        self.assertFalse(coverage["release_ready"])
        self.assertEqual(coverage["missing_license_inputs"], [])

    def test_complete_corpus_preserves_stroke_counts_and_review_boundaries(self):
        records, queue = importer.make_records(self.source, self.lock, self.recipes, self.recipe_pin)
        self.assertEqual(set(records), set(self.inventory["required"]))
        self.assertEqual(len(queue), 2019)
        self.assertEqual(sum(len(record["variants"]) for record in records.values()), 5022)
        rules = [flag["rule"] for entry in queue.values() for flag in entry["rules"]]
        self.assertEqual(rules.count("compact-hook"), 408)
        self.assertEqual(rules.count("short-fall"), 3306)
        for character, record in records.items():
            self.assertEqual(record["default_variant"],
                             "reviewed-monoline" if character in importer.APPROVED else "source-median")
            for variant in record["variants"]:
                self.assertEqual(len(variant["strokes"]), len(self.source[character]["strokes"]))
                self.assertEqual(variant["status"]["reviewed"], variant["id"] == "reviewed-monoline")
        self.assertEqual(sum(len(points) for row in self.source.values() for points in row["medians"]), 166294)

    def test_dense_style_cautions_do_not_change_geometry_or_approval(self):
        self.assertEqual(set(importer.STYLE_CAUTIONS), set("\u56ca\u8b66\u8d62\u5668"))
        for character in importer.STYLE_CAUTIONS:
            self.assertEqual(self.records[character]["default_variant"], "source-median")
            self.assertTrue(all(not variant["status"]["reviewed"]
                                for variant in self.records[character]["variants"]))


if __name__ == "__main__":
    unittest.main()
