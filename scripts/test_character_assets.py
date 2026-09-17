"""Focused regression tests for the shared offline character asset contract."""

from copy import deepcopy
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import yaml

from character_assets import (
    build_outputs, chunk_name, sha256, validate_bundle, validate_record, write_outputs,
)
from character_geometry import normalize_svg_path, sample_path, transform_path, validate_path
from character_inventory import extract_inventory, foundation_characters
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

    def test_drawing_after_closepath_opens_a_new_subpath(self):
        triangle = "M10 10 L30 10 L30 30 L10 10"
        for suffix, expected in (
            ("L50 10", "M10 10 L50 10"),
            ("l40 0 0 20", "M10 10 L50 10 L50 30"),
            ("H50v20z", "M10 10 L50 10 L50 30 L10 10"),
            ("M40 40 L50 50", "M40 40 L50 50"),
            ("m20 20 10 10", "M30 30 L40 40"),
            ("Z L50 10", "M10 10 L50 10"),
        ):
            with self.subTest(suffix=suffix):
                paths = normalize_svg_path("M10 10 L30 10 L30 30 Z " + suffix)
                self.assertEqual(paths, [triangle, expected])
                self.assertEqual(sample_path(paths[0])[0], sample_path(paths[0])[-1])

    def test_closepath_resets_reflected_controls_and_keeps_relative_origin(self):
        for curve, suffix, expected in (
            ("C15 10 25 30 30 30", "S30 20 40 40", "M10 10 C10 10 30 20 40 40"),
            ("C15 10 25 30 30 30", "s20 10 30 30", "M10 10 C10 10 30 20 40 40"),
            ("Q20 30 30 30", "T40 40", "M10 10 Q10 10 40 40"),
            ("Q20 30 30 30", "t30 30", "M10 10 Q10 10 40 40"),
        ):
            with self.subTest(suffix=suffix):
                paths = normalize_svg_path(f"M10 10 {curve} Z {suffix}")
                self.assertEqual(paths, [f"M10 10 {curve} L10 10", expected])

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
        self.assertEqual(normalize_svg_path("M70 50A20 20 0 0130 50"),
                         normalize_svg_path("M70 50A20 20 0 0 1 30 50"))

    def test_source_parser_rejects_nonfinite_degenerate_and_bad_flags(self):
        for path in ("M10 10A20 20 0 2 1 30 50", "M10 10A1e-300 20 0 0 1 30 50",
                     "M10 10 L1e999 20", "M10 10Z", "M10 10L20 20 <script>"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                normalize_svg_path(path)

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

    def test_bundle_round_trip_and_stale_detection(self):
        outputs = self.outputs()
        write_outputs(self.root, outputs)
        self.assertFalse(validate_bundle(self.root, inventory=self.inventory)["release_ready"])
        with self.assertRaisesRegex(ValueError, "not release-ready"):
            validate_bundle(self.root, inventory=self.inventory, require_release=True)
        path = self.root / "characters" / "u004e.yaml"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "checksum"):
            validate_bundle(self.root, inventory=self.inventory)

    def test_bundle_rejects_incorrect_shard_membership(self):
        outputs = self.outputs()
        write_outputs(self.root, outputs)
        root = self.root / "characters"
        (root / "u004e.yaml").rename(root / "u004f.yaml")
        manifest = load_yaml(root / "manifest.yaml")
        manifest["chunks"][0]["file"] = "u004f.yaml"
        write_yaml(root / "manifest.yaml", manifest)
        with self.assertRaisesRegex(ValueError, "incorrect shard membership"):
            validate_bundle(self.root, inventory=self.inventory)

    def test_review_does_not_hide_missing_components_or_cross_script(self):
        self.inventory["required"] = ["\u4e00"]
        self.inventory["literal_cross_script"] = ["\uff27"]
        variant = self.record["variants"][0]
        variant["status"]["reviewed"] = True
        variant["review"] = {"reviewer": "fixture only", "date": "2026-09-15", "note": "not real artwork"}
        variant["components"] = [{"character": "\u4e8c", "role": "fixture", "source_id": "test-source"}]
        coverage = yaml.safe_load(self.outputs()["coverage.yaml"])
        self.assertEqual(coverage["default_reviewed"], ["\u4e00"])
        self.assertEqual(coverage["missing_components"], ["\u4e8c"])
        self.assertEqual(coverage["cross_script_missing"], ["\uff27"])
        self.assertEqual(coverage["missing_license_inputs"], ["test-source"])
        self.assertFalse(coverage["release_ready"])

    def test_archive_member_checksums_are_verified_offline(self):
        path = self.root / "upstream" / "selected.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("data/one.txt", b"original bytes")
        pin = {"path": "upstream/selected.zip", "sha256": sha256(path.read_bytes()),
               "source_id": "test-source", "source_version": "fixture-archive"}
        self.inputs.append(pin)
        provenance = self.record["variants"][0]["provenance"][0]
        provenance.update(input=pin["path"], sha256=pin["sha256"],
                          member="data/one.txt", member_sha256=sha256(b"original bytes"))
        self.outputs()
        provenance["member_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "member checksum"):
            self.outputs()
        provenance["member"] = "../one.txt"
        with self.assertRaisesRegex(ValueError, "relative"):
            self.outputs()

    def test_recipe_is_pinned_without_treating_it_as_upstream(self):
        path = self.root / "characters" / "recipes.yaml"
        path.parent.mkdir()
        path.write_bytes(b"fixture: recipe\n")
        digest = sha256(path.read_bytes())
        self.inputs.append({"path": "characters/recipes.yaml", "sha256": digest,
                            "source_id": "test-source", "source_version": "recipe1"})
        self.record["variants"][0]["recipe"] = {
            "id": "one", "version": "1", "input": "characters/recipes.yaml", "sha256": digest,
        }
        write_outputs(self.root, self.outputs())
        self.assertEqual(path.read_bytes(), b"fixture: recipe\n")
        path.write_bytes(b"fixture: changed\n")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.outputs()

    def test_component_links_must_have_source_evidence(self):
        self.record["variants"][0]["components"] = [
            {"character": "\u4e8c", "role": "fixture", "source_id": "unsupported"},
        ]
        with self.assertRaisesRegex(ValueError, "unknown source"):
            self.outputs()

    def test_release_gate_requires_review_and_pinned_license_for_every_variant(self):
        self.inventory["required"] = ["\u4e00"]
        (self.root / "licenses").mkdir()
        (self.root / "licenses" / "fixture.txt").write_bytes(b"test fixture license")
        self.inputs.append({"path": "licenses/fixture.txt", "sha256": sha256(b"test fixture license"),
                            "source_id": "test-source", "source_version": "fixture-license-1"})
        variant = self.record["variants"][0]
        variant["status"]["reviewed"] = True
        variant["review"] = {"reviewer": "fixture", "date": "2026-09-15", "note": "test only"}
        outputs = self.outputs()
        write_outputs(self.root, outputs)
        self.assertTrue(validate_bundle(self.root, inventory=self.inventory,
                                        require_release=True)["release_ready"])
        alternative = deepcopy(variant)
        alternative["id"] = "unreviewed-alternative"
        alternative["status"]["reviewed"] = False
        del alternative["review"]
        self.record["variants"].append(alternative)
        coverage = yaml.safe_load(self.outputs()["coverage.yaml"])
        self.assertEqual(coverage["reviewed"], [])
        self.assertEqual(coverage["default_reviewed"], ["\u4e00"])
        self.assertFalse(coverage["release_ready"])

    def test_license_gate_covers_referenced_recipes_and_all_cited_metadata_sources(self):
        variant = self.record["variants"][0]
        variant["status"]["reviewed"] = True
        variant["review"] = {"reviewer": "fixture", "date": "2026-09-15", "note": "test only"}
        self.sources["metadata-source"] = {
            **self.sources["test-source"], "id": "metadata-source",
        }
        write_yaml(self.root / "sources.yaml", list(self.sources.values()))
        for name, source_id, raw in (
            ("licenses/source.txt", "test-source", b"fixture license"),
            ("upstream/metadata.txt", "metadata-source", b"fixture metadata"),
            ("characters/recipes.yaml", "metadata-source", b"fixture recipe"),
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            self.inputs.append({"path": name, "sha256": sha256(raw),
                                "source_id": source_id, "source_version": "fixture-v1"})
        second = deepcopy(self.record)

        def coverage(record):
            outputs = build_outputs(
                self.root, {"\u4e00": record, "\u4e8c": second}, self.inventory, self.inputs,
                adapter="test", adapter_version="1",
            )
            return yaml.safe_load(outputs["coverage.yaml"])

        # Unreferenced metadata/recipe pins do not introduce release license requirements.
        self.assertTrue(coverage(self.record)["release_ready"])
        license_path = self.root / "licenses" / "metadata.txt"
        license_path.write_bytes(b"fixture metadata license")
        license_pin = {"path": "licenses/metadata.txt", "source_id": "metadata-source",
                       "source_version": "fixture-v1", "sha256": sha256(license_path.read_bytes())}
        for field, value in (
            ("recipe", {"id": "one", "version": "1", "input": "characters/recipes.yaml",
                        "sha256": sha256(b"fixture recipe")}),
            ("aliases", [{"text": "\u58f9", "kind": "regional",
                          "policy": "test-only relation", "source_id": "metadata-source"}]),
            ("readings", [{"value": "fixture", "system": "fixture",
                           "source_id": "metadata-source", "source_entry": "one"}]),
            ("names", [{"value": "fixture", "language": "en",
                        "source_id": "metadata-source", "source_entry": "one"}]),
            ("components", [{"character": "\u4e8c", "role": "fixture",
                             "source_id": "metadata-source"}]),
        ):
            with self.subTest(field=field):
                record = deepcopy(self.record)
                target = record if field == "aliases" else record["variants"][0]
                target[field] = value
                if field in ("readings", "names", "components"):
                    target["provenance"].append({
                        "source_id": "metadata-source", "source_entry": "one",
                        "input": "upstream/metadata.txt", "sha256": sha256(b"fixture metadata"),
                    })
                result = coverage(record)
                self.assertEqual(result["missing_license_inputs"], ["metadata-source"])
                self.assertFalse(result["release_ready"])
                self.inputs.append(license_pin)
                result = coverage(record)
                self.assertEqual(result["missing_license_inputs"], [])
                self.assertTrue(result["release_ready"])
                self.inputs.pop()


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        level = self.root / "japanese" / "jlpt-n5"
        level.mkdir(parents=True)
        write_yaml(self.root / "catalog.yaml", {
            "schema_version": 1, "languages": [{"id": "japanese", "levels": ["jlpt-n5"]}],
        })
        write_yaml(level / "vocabulary.yaml", [{
            "id": "word1", "target": "\u4e00\uff27", "reading": "\u3044\u3061",
            "english": "gloss-only \u3013 \u9f8d must never be mined",
        }])
        write_yaml(level / "grammar.yaml", [{
            "id": "grammar1", "pattern": "N+\u3067\u3059",
            "examples": [{"target": "\u4e8c\u3002", "english": "ignored \u4e09"}],
        }])

    def test_modern_foundations_exclude_archaic_and_preserve_components(self):
        japanese = foundation_characters("japanese")
        self.assertEqual(len(japanese), 177)
        self.assertNotIn("\u3090", japanese)
        self.assertNotIn("\u30f7", japanese)
        self.assertIn("\u3094", japanese)
        self.assertIn("\u3095", japanese)
        self.assertEqual(japanese["\u3099"], "component")
        korean = foundation_characters("korean")
        self.assertEqual(len(korean), 118)
        self.assertEqual(korean["\u1100"], "component")
        self.assertEqual(korean["\u3131"], "character")
        self.assertNotIn("\u115f", korean)
        self.assertNotIn("\uac00", korean)
        self.assertEqual(foundation_characters("chinese"), {})

    def test_inventory_uses_only_authoritative_expanded_fields(self):
        inventory = extract_inventory(self.root, "japanese")
        self.assertIn("\u4e00", inventory["required"])
        self.assertIn("\u4e8c", inventory["required"])
        self.assertNotIn("\u4e09", inventory["characters"])
        self.assertNotIn("\u3013", inventory["characters"])
        self.assertNotIn("\u9f8d", inventory["characters"])
        self.assertEqual(inventory["literal_cross_script"], ["\uff27"])
        self.assertIn("N", inventory["notation"])
        self.assertIn("\u3099", inventory["components"])
        self.assertNotIn("\u3099", inventory["required"])
        self.assertEqual(inventory, extract_inventory(self.root, "japanese"))
        self.assertEqual(len(inventory["inputs"]), 3)

    def test_exact_compatibility_ideographs_are_not_canonicalized(self):
        path = self.root / "japanese" / "jlpt-n5" / "vocabulary.yaml"
        write_yaml(path, [{"id": "compat", "target": "\uf900\u8c48", "reading": ""}])
        inventory = extract_inventory(self.root, "japanese")
        self.assertIn("\uf900", inventory["required"])
        self.assertIn("\u8c48", inventory["required"])

    def test_explicit_additions_are_cited_and_stale_sources_fail(self):
        root = self.root / "japanese"
        (root / "characters").mkdir()
        (root / "README.md").write_text("Explicit teaching fixture", encoding="utf-8")
        write_yaml(root / "characters" / "requirements.yaml", {
            "schema_version": 1,
            "characters": {"\u4e09": {"kind": "character", "reason": "Fixture addition",
                                     "source": "README.md#Explicit teaching fixture"}},
        })
        inventory = extract_inventory(self.root, "japanese")
        self.assertIn("\u4e09", inventory["required"])
        self.assertIn("supplemental:authored", inventory["scopes"])
        (root / "README.md").write_text("Changed citation", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "citation"):
            extract_inventory(self.root, "japanese")

    def test_real_curriculum_snapshot_counts(self):
        root = Path(__file__).resolve().parents[1] / "curriculum"
        expected = {"chinese": (3001, 0, 0, 30), "japanese": (2235, 2, 4, 22), "korean": (1276, 67, 0, 0)}
        for language, (writing, components, cross_script, teaching_only) in expected.items():
            with self.subTest(language=language):
                inventory = extract_inventory(root, language)
                self.assertEqual(inventory["counts"]["writing"], writing)
                self.assertEqual(len(inventory["components"]), components)
                self.assertEqual(len(inventory["literal_cross_script"]), cross_script)
                self.assertEqual(inventory["counts"]["teaching_only"], teaching_only)

    def test_no_write_cli_accepts_honest_missing_bundle_but_not_release(self):
        root = self.root / "japanese"
        write_yaml(root / "sources.yaml", [])
        inventory = extract_inventory(self.root, "japanese")
        outputs = build_outputs(
            root, {}, inventory, [], adapter="fixture", adapter_version="1",
            blocked={character: "No fixture artwork" for character in
                     inventory["required"] + inventory["components"]},
        )
        write_outputs(root, outputs)
        times = {path: path.stat().st_mtime_ns for path in (root / "characters").iterdir()}
        command = [sys.executable, str(Path(__file__).with_name("validate_characters.py")),
                   "--root", str(self.root), "--language", "japanese", "--check"]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("release_ready=False", result.stdout)
        self.assertEqual(times, {path: path.stat().st_mtime_ns for path in times})
        result = subprocess.run(command + ["--require-release"], capture_output=True, text=True,
                                encoding="utf-8", check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("not release-ready", result.stderr)


if __name__ == "__main__":
    unittest.main()
