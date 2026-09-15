"""Focused regression tests for the shared offline character asset contract."""

from copy import deepcopy
import math
from pathlib import Path
import tempfile
import unittest

import yaml

from character_assets import build_outputs, chunk_name, sha256, validate_record, write_outputs
from character_geometry import normalize_svg_path, sample_path, transform_path, validate_path
from curriculum_yaml import load_yaml, write_yaml


class GeometryTests(unittest.TestCase):
    def test_sampling_uses_display_curve_not_control_polygon(self):
        samples = sample_path("M10 10 Q50 90 90 10")
        self.assertEqual(samples[0], [10, 10])
        self.assertEqual(samples[-1], [90, 10])
        self.assertAlmostEqual(max(y for _, y in samples), 50, delta=0.05)
        self.assertEqual(samples, sample_path("M10 10 Q50 90 90 10"))
        self.assertTrue(all(math.dist(a, b) <= 2.000002 for a, b in zip(samples, samples[1:])))

    def test_logical_stroke_can_contain_several_segments_and_close(self):
        path = normalize_svg_path("m10 10 h30 v30 h-30z")[0]
        self.assertEqual(path, "M10 10 L40 10 L40 40 L10 40 L10 10")
        self.assertEqual(sample_path(path)[0], sample_path(path)[-1])
        self.assertEqual(len(normalize_svg_path("M10 10L20 20M30 30L40 40")), 2)

    def test_normalizes_relative_repeated_and_reflected_curves(self):
        self.assertEqual(normalize_svg_path("m10 10 10 0 0 10"), ["M10 10 L20 10 L20 20"])
        self.assertEqual(
            normalize_svg_path("M10 10q10 10 20 0t20 0"),
            ["M10 10 Q20 20 30 10 Q40 0 50 10"],
        )
        self.assertEqual(
            normalize_svg_path("M10 10c5 0 5 10 10 10s5 10 10 10"),
            ["M10 10 C15 10 15 20 20 20 C25 20 25 30 30 30"],
        )

    def test_arc_conversion_preserves_endpoints_and_circle(self):
        path = normalize_svg_path("M70 50 A20 20 0 1 1 30 50 A20 20 0 1 1 70 50")[0]
        self.assertNotIn("A", path)
        points = sample_path(path, spacing=0.5)
        self.assertEqual(points[0], points[-1])
        self.assertTrue(all(abs(math.dist(point, [50, 50]) - 20) < 0.002 for point in points))

    def test_fixed_frame_transform_preserves_small_glyph_offset(self):
        self.assertEqual(transform_path("M20 40 L40 60", [0.5, 0, 0, 0.5, 5, 5]),
                         "M15 25 L25 35")
        self.assertEqual(normalize_svg_path("M0 900l1024 -1024", [90/1024, 0, 0, -90/1024, 5, 5+900*90/1024]),
                         ["M5 5 L95 95"])

    def test_rejects_malformed_or_unsafe_geometry(self):
        for path in ("", "<script/>", "M10 10 LNaN 20", "M0 0 L1e999 2",
                     "M0 0L101 20", "M1 1", "M1 1L1 1", "M1 1M2 2L3 3",
                     "M1 1 l2 2", "M1 1L2", "M1 1L2 2Z", "M1 1 L2 2 junk"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_path(path)
        for spacing in (0, -1, float("nan"), True, 1e-20):
            with self.subTest(spacing=spacing), self.assertRaises(ValueError):
                sample_path("M0 0 L10 10", spacing)


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "upstream").mkdir()
        (self.root / "upstream" / "strokes.txt").write_bytes(b"source")
        self.sources = {"test-source": {
            "id": "test-source", "license": "test-only fixture", "attribution": "test fixture",
            "url": "https://example.invalid/fixture",
        }}
        write_yaml(self.root / "sources.yaml", list(self.sources.values()))
        self.inputs = [{
            "path": "upstream/strokes.txt", "sha256": sha256(b"source"),
            "source_id": "test-source", "source_version": "fixture-v1",
        }]
        self.record = {
            "script": "Han", "kind": "character", "default_variant": "mainland",
            "variants": [{
                "id": "mainland", "locale": "zh-Hans-CN",
                "strokes": [{"path": "M10 50 L90 50"}],
                "provenance": [{"source_id": "test-source", "source_entry": "fixture:one",
                                "input": "upstream/strokes.txt", "sha256": sha256(b"source")}],
                "transform": {"id": "fixture", "version": "1", "source_frame": [0, 0, 100, 100],
                              "matrix": [1, 0, 0, 1, 0, 0]},
                "status": {"generated": True, "validated": True, "reviewed": False},
            }],
        }
        self.inventory = {"language": "chinese", "required": ["\u4e00", "\u4e8c"], "components": []}

    def outputs(self, **kwargs):
        return build_outputs(self.root, {"\u4e00": self.record}, self.inventory, self.inputs,
                             adapter="test", adapter_version="1", **kwargs)

    def validate(self, record=None):
        validate_record("\u4e00", self.record if record is None else record,
                        sources=self.sources, inputs=self.inputs)

    def test_chunk_boundaries_and_exact_compatibility_identity(self):
        self.assertEqual(chunk_name("\u4e00"), "u004e.yaml")
        self.assertEqual(chunk_name("\u4eff"), "u004e.yaml")
        self.assertEqual(chunk_name("\u4f00"), "u004f.yaml")
        self.assertEqual(chunk_name("\U00020000"), "u0200.yaml")
        self.assertNotEqual(chunk_name("\uf900"), chunk_name("\u8c48"))
        for key in ("", "ab", "\ud800", " "):
            with self.assertRaises(ValueError):
                chunk_name(key)

    def test_default_variant_is_explicit_not_first(self):
        second = deepcopy(self.record["variants"][0])
        second.update(id="taiwan", locale="zh-Hant-TW")
        self.record["variants"].insert(0, second)
        self.validate()
        self.record["default_variant"] = "missing"
        with self.assertRaisesRegex(ValueError, "default_variant"):
            self.validate()

    def test_aliases_preserve_sequences_and_context(self):
        record = deepcopy(self.record)
        record["aliases"] = [{"text": "\u304b\u3099", "kind": "composition",
                              "policy": "explicit source relationship, never implicit folding",
                              "source_id": "test-source"}]
        self.validate(record)
        record["aliases"].append(deepcopy(record["aliases"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.validate(record)

    def test_provenance_requires_exact_source_and_pin(self):
        for field, value in (("sha256", "0" * 64), ("input", "upstream/missing"),
                             ("source_id", "invented")):
            record = deepcopy(self.record)
            record["variants"][0]["provenance"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(record)
        (self.root / "upstream" / "strokes.txt").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.outputs()

    def test_generated_does_not_claim_review_or_complete_coverage(self):
        outputs = self.outputs(blocked={"\u4e8c": "No authorized source stroke data"})
        coverage = yaml.safe_load(outputs["coverage.yaml"])
        self.assertEqual(coverage["missing"], ["\u4e8c"])
        self.assertEqual(coverage["reviewed"], [])
        self.assertFalse(coverage["release_ready"])
        self.assertEqual(coverage["drawable"], ["\u4e00"])
        self.record["variants"][0]["status"]["reviewed"] = True
        with self.assertRaisesRegex(ValueError, "review evidence"):
            self.outputs()

    def test_deterministic_outputs_and_no_write_stale_detection(self):
        outputs = self.outputs()
        self.assertEqual(outputs, self.outputs())
        self.assertEqual(write_outputs(self.root, outputs, check=True),
                         ["coverage.yaml", "manifest.yaml", "u004e.yaml"])
        self.assertFalse((self.root / "characters").exists())
        write_outputs(self.root, outputs)
        self.assertEqual(write_outputs(self.root, outputs, check=True), [])
        extra = self.root / "characters" / "u004f.yaml"
        extra.write_text("{}\n", encoding="utf-8")
        self.assertEqual(write_outputs(self.root, outputs, check=True), ["u004f.yaml"])
        self.assertTrue(extra.exists())
        write_outputs(self.root, outputs)
        self.assertFalse(extra.exists())

    def test_notice_is_part_of_hashed_output(self):
        outputs = self.outputs(notice="MODIFIED 2026-09-15: fixture only\nRetain original notice.")
        self.assertTrue(outputs["u004e.yaml"].startswith("# MODIFIED"))
        manifest = yaml.safe_load(outputs["manifest.yaml"])
        self.assertEqual(manifest["chunks"][0]["sha256"], sha256(outputs["u004e.yaml"].encode("utf-8")))

    def test_duplicate_yaml_keys_rejected(self):
        path = self.root / "duplicate.yaml"
        path.write_text("'\\u4e00': {}\n'\\u4e00': {}\n", encoding="utf-8")
        with self.assertRaisesRegex(yaml.YAMLError, "duplicate"):
            load_yaml(path)

    def test_metadata_and_strokes_are_strict(self):
        for modify in (
            lambda v: v["strokes"].append({"path": "M1 1L2 2", "onclick": "bad"}),
            lambda v: v.update(readings=[{"value": "word-reading", "system": "test"}]),
            lambda v: v["status"].update(validated="true"),
            lambda v: v["transform"].update(matrix=[1, 0, 0, 0, 0, 0]),
        ):
            record = deepcopy(self.record)
            modify(record["variants"][0])
            with self.assertRaises(ValueError):
                self.validate(record)


if __name__ == "__main__":
    unittest.main()
