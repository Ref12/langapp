"""Scoped, source-driven fitting and preview-only workflow regressions."""

from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from character_geometry import parse_path, sample_path
from chinese_monoline import normalize_median
import fit_chinese_strokes as fitter
from character_inventory import extract_inventory
from curriculum_yaml import PureCurriculumLoader, LibyamlCurriculumLoader, load_yaml
import yaml

_REAL_REPORTS = {}
_build_report = fitter.build_report


def _cached_build_report(character, *args, **kwargs):
    """Real default reports are deterministic and read-only; fit each character once per run."""
    if args or kwargs:
        return _build_report(character, *args, **kwargs)
    if character not in _REAL_REPORTS:
        _REAL_REPORTS[character] = _build_report(character)
    return deepcopy(_REAL_REPORTS[character])


fitter.build_report = _cached_build_report


class PreviewContextTests(unittest.TestCase):
    """Previews read the lock, archive, manifest and requested pages only."""

    def test_preview_never_extracts_inventory_or_loads_unrelated_yaml(self):
        loaded = []
        real = fitter.load_yaml

        def spy(path, **kw):
            loaded.append(Path(path).name)
            return real(path, **kw)

        with patch.object(fitter, "load_yaml", side_effect=spy), \
                patch("character_inventory.extract_inventory", side_effect=AssertionError("inventory")):
            context = fitter.prepare_context()
            reports = [fitter.build_report(ch, _context=context) for ch in "你国大"]
        self.assertEqual(sorted(set(loaded)), ["manifest.yaml", "source-lock.yaml", "u004f.yaml", "u0056.yaml", "u0059.yaml"])
        self.assertFalse(any(name.startswith(("lessons", "program", "vocabulary")) for name in loaded))
        for report in reports:
            self.assertEqual(report["current"]["page_sha256"], next(
                c["sha256"] for c in context["manifest"]["chunks"] if c["file"] == report["current"]["page"]))
            self.assertFalse(report["applied"] or report["reviewed"])
            self.assertNotIn("inventory_inputs", report)

    def test_wrong_page_hash_fails_clearly(self):
        context = fitter.prepare_context()
        context["manifest"] = deepcopy(context["manifest"])
        page = f"u{ord('中') >> 8:04x}.yaml"
        next(c for c in context["manifest"]["chunks"] if c["file"] == page)["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "does not match its manifest"):
            fitter.build_report("中", _context=context)

    def test_missing_index_entry_and_unknown_character_fail_clearly(self):
        context = fitter.prepare_context()
        context["manifest"] = deepcopy(context["manifest"])
        context["manifest"]["chunks"] = [c for c in context["manifest"]["chunks"]
                                         if c["file"] != f"u{ord('中') >> 8:04x}.yaml"]
        with self.assertRaisesRegex(ValueError, "no unique index entry"):
            fitter.build_report("中", _context=context)
        with self.assertRaisesRegex(ValueError, "not in the pinned"):
            fitter.build_report("𠀀", _context=fitter.prepare_context())

    def test_wrong_source_member_hash_fails_clearly(self):
        context = fitter.prepare_context()
        context["lock"] = deepcopy(context["lock"])
        context["lock"]["members"]["data/中.json"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            fitter.build_report("中", _context=context)

    def test_source_archive_hash_is_checked(self):
        with patch.object(fitter, "sha256", return_value="0" * 64):
            with self.assertRaisesRegex(ValueError, "archive checksum mismatch"):
                fitter.prepare_context()


@unittest.skipUnless(os.environ.get("LANGAPP_SLOW_TESTS") == "1",
                     "slow full-inventory/parser checks; set LANGAPP_SLOW_TESTS=1 (npm run characters:check:slow)")
class FullInventoryTests(unittest.TestCase):
    """Real full-inventory and parser-parity checks, opt-in because they take about a minute."""

    def test_real_inventory_matches_source_selection_and_page_index(self):
        inventory = extract_inventory(fitter.ROOT.parent, "chinese")
        required = inventory["required"]
        self.assertEqual(len(required), 3001)
        context = fitter.prepare_context()
        self.assertEqual({k[5:-5] for k in context["lock"]["members"] if k.startswith("data/")}, set(required))
        pages = {f"u{ord(c) >> 8:04x}.yaml" for c in required}
        self.assertEqual(pages, {c["file"] for c in context["manifest"]["chunks"]})

    def test_real_curriculum_loaders_are_identical(self):
        paths = sorted(fitter.ROOT.rglob("*.yaml"))[:]
        paths = [p for p in paths if p.parent.name != "characters" or p.name == "manifest.yaml"]
        self.assertGreater(len(paths), 10)
        for path in paths:
            with self.subTest(path=path.name):
                self.assertEqual(load_yaml(path, loader=PureCurriculumLoader),
                                 load_yaml(path, loader=LibyamlCurriculumLoader))

    def test_both_loaders_reject_duplicate_and_unhashable_keys(self):
        for loader in (PureCurriculumLoader, LibyamlCurriculumLoader):
            for text in ("key: 1\nkey: 2\n", "? [a, b]\n: value\n",
                         "base: &base {key: 1}\nmerged: {<<: *base, key: 2}\n"):
                with self.subTest(loader=loader, text=text):
                    with self.assertRaises(yaml.constructor.ConstructorError):
                        yaml.load(text, Loader=loader)


class BatchWorkflowTests(unittest.TestCase):
    def test_repeated_and_joined_character_cli_share_one_context(self):
        for flags in (["--characters", "中小大"], ["--character", "中", "--character", "小", "--character", "大"]):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "sheet.html"
                with patch.object(fitter.sys, "argv", ["fit", *flags, "--output", str(output)]), \
                        patch.object(fitter, "prepare_context", wraps=fitter.prepare_context) as context, \
                        patch("sys.stdout", new=io.StringIO()):
                    self.assertEqual(fitter.main(), 0)
                context.assert_called_once_with()
                self.assertEqual(len(list(Path(directory).glob("*.html"))), 4)
                self.assertEqual(len(list(Path(directory).glob("*.json"))), 4)
                sheet = output.read_text(encoding="utf-8")
                self.assertIn("grid-template-columns:repeat(3", sheet)
                self.assertEqual(sheet.count("Original source image (Hanzi Writer filled outlines)</figcaption>"), 3)
                self.assertEqual(sheet.count('class="outline"'), 3)
                self.assertEqual(sheet.count("Candidate</figcaption>"), 3)
                for item in json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))["previews"]:
                    report = json.loads(output.with_name(item).with_suffix(".json").read_text(encoding="utf-8"))
                    self.assertFalse(report["applied"] or report["reviewed"])

    def test_invalid_batch_or_adjustments_write_nothing(self):
        for flags in (["--characters", "中中"], ["--characters", "你好学家国中我小大热"],
                      ["--characters", "中大", "--compact-stroke", "1"],
                      ["--character", "中大"]):
            with tempfile.TemporaryDirectory() as directory:
                with patch.object(fitter.sys, "argv", ["fit", *flags, "--output", str(Path(directory) / "sheet.html")]), \
                        patch.object(fitter, "prepare_context") as context, \
                        patch("sys.stderr", new=io.StringIO()):
                    self.assertEqual(fitter.main(), 1)
                context.assert_not_called()
                self.assertEqual(list(Path(directory).iterdir()), [])


class BatchCorrectionTests(unittest.TestCase):
    def test_real_entry_flicks_removed_with_ordinary_gates(self):
        for character, indices in (("你", (0, 2)), ("大", (1,))):
            report = fitter.build_report(character)
            for index in indices:
                fitted = report["strokes"][index]
                self.assertEqual(fitted["rule"], "short-entry-flick:1")
                self.assertLessEqual(fitted["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
                self.assertLessEqual(max(fitted["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
                self.assertFalse(fitted.get("terminal_adjustment"))
                self.assertNotEqual(fitted["path"], fitted["unsmoothed_path"])

    def test_intentional_corner_return_hook_and_long_fold_retained(self):
        for points in ([[10, 10], [40, 10], [40, 60]],
                       [[30, 10], [30, 60], [20, 55]],
                       [[10, 10], [40, 40], [20, 80]]):
            raw = fitter.fit_stroke_raw(points)
            self.assertEqual(fitter.smooth_entry_flick(points, raw), raw)

    def test_country_dot_gets_more_clearance_without_translation(self):
        report = fitter.build_report("国")
        fitted = report["strokes"][6]
        self.assertEqual(fitted["model"], "spaced-dot")
        self.assertGreater(fitted["centerline_gap"], fitted["original_centerline_gap"])
        self.assertLessEqual(fitted["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
        self.assertFalse(report["selection"]["translate_strokes"])

    def test_attached_dot_and_other_samples_are_not_compacted(self):
        medians = [[[50, 50], [54, 52], [57, 57]], [[50, 50], [80, 50]]]
        fitted = [fitter.fit_stroke(p) for p in medians]
        self.assertEqual(fitter.space_isolated_dots(medians, fitted), fitted)
        hot = fitter.build_report("热")
        self.assertFalse(any(s.get("model") == "spaced-dot" for s in hot["strokes"][5:]))


class HookSofteningTests(unittest.TestCase):
    """General softening of angular hooks and bowls; gates stay unchanged."""

    EXPECTED = {("心", 1): "smooth-bowl", ("们", 4): "rounded-hook", ("的", 6): "chamfer-to-quadratic", ("学", 6): "chamfer-to-quadratic",
                ("说", 8): "sustained-bend-fillet"}

    def test_requested_strokes_are_softened_within_gates(self):
        for (character, index), kind in self.EXPECTED.items():
            fitted = fitter.build_report(character)["strokes"][index]
            self.assertEqual(fitted["softening"], kind, character)
            self.assertIn("Q", fitted["path"])
            self.assertLessEqual(fitted["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
            self.assertLessEqual(max(fitted["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])

    def test_only_all_line_polylines_change(self):
        changed = {(c, i) for c in "你好学家国中我小大的是这们说门心水到"
                   for i, s in enumerate(fitter.build_report(c)["strokes"]) if s.get("softening")}
        self.assertEqual(changed, {("家", 2), ("中", 1), ("的", 6), ("们", 4), ("门", 2), ("心", 1), ("到", 7), ("学", 6), ("说", 8)})

    def test_sustained_fold_is_kept_as_a_corner(self):
        fitted = fitter.build_report("这")["strokes"][5]
        self.assertEqual(fitted["rule"], "sustained-fold-retention:1")
        self.assertEqual(len(fitter.parse_path(fitted["path"])), 4)
        self.assertLessEqual(fitted["maximum_deviation"], fitter.LIMITS["maximum_deviation"])

    def test_fold_rule_changes_no_other_stroke(self):
        folded = {(c, i) for c in "你好学家国中我小大的是这们说门心水到"
                  for i, s in enumerate(fitter.build_report(c)["strokes"])
                  if "sustained-fold-retention" in (s.get("rule") or "")}
        self.assertEqual(folded, {("这", 5)})

    def test_straight_and_curved_fits_are_untouched(self):
        line = {"status": "candidate", "path": "M10 10 L50 50"}
        self.assertIs(fitter.soften_hook_and_bends([[10, 10], [50, 50]], line), line)
        curve = {"status": "candidate", "path": "M10 10 Q30 10 50 50"}
        self.assertIs(fitter.soften_hook_and_bends([[10, 10], [50, 50]], curve), curve)


class MergedCornerTests(unittest.TestCase):
    """Rounded-corner hooks and falling strokes that earlier models cannot fit."""

    def test_real_unresolved_strokes_now_fit_inside_unchanged_gates(self):
        for character, index in (("们", 0), ("门", 2), ("到", 7)):
            fitted = fitter.build_report(character)["strokes"][index]
            self.assertIsNotNone(fitted.get("path"), character)
            self.assertLessEqual(fitted["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
            self.assertLessEqual(max(fitted["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
            self.assertFalse(fitted.get("terminal_adjustment"))

    def test_hook_strokes_merge_rounded_corners_into_clean_limbs(self):
        for character, index in (("门", 2),):
            fitted = fitter.build_report(character)["strokes"][index]
            self.assertEqual(fitted["rule"], "merged-corner-lines:1+hook-and-bend-softening:1")
            self.assertEqual(fitted["softening"], "rounded-hook")
            self.assertEqual(len(parse_path(fitted["unsoftened_path"])), 4)

    def test_only_previously_unresolved_strokes_change(self):
        # The fallback runs after every other model, so accepted fits cannot move.
        for character in "你好学家国中我小大的是这说心水":
            for stroke in fitter.build_report(character)["strokes"]:
                self.assertNotEqual(stroke.get("rule"), "merged-corner-lines:1", character)

    def test_loops_and_straight_strokes_are_not_rescued(self):
        loop = [[50, 50], [60, 50], [60, 60], [50, 60], [50.5, 50.5]]
        self.assertIsNone(fitter.merged_corner_fit([[10, 10], [30, 10], [60, 10]]))
        self.assertEqual(fitter.fit_stroke_raw(loop)["status"], "unresolved")

    def test_no_clean_hook_leaves_stroke_unresolved(self):
        zigzag = [[10, 10], [30, 40], [10, 70], [30, 90], [10, 99]]
        self.assertIsNone(fitter.fit_stroke_raw(zigzag).get("rule"))


class StrokeFittingTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(fitter.local(fitter.ROOT, fitter.ARCHIVE)) as archive:
            source = json.loads(archive.read("data/\u4e07.json"))
            water = json.loads(archive.read("data/\u6c34.json"))
            coffee = json.loads(archive.read("data/\u5496.json"))
            hot = json.loads(archive.read("data/\u70ed.json"))
        cls.medians = [normalize_median(points) for points in source["medians"]]
        cls.water = [normalize_median(points) for points in water["medians"]]
        cls.coffee = [normalize_median(points) for points in coffee["medians"]]
        cls.hot = [normalize_median(points) for points in hot["medians"]]

    def test_wan_models_are_inferred_without_authored_coordinates(self):
        before = deepcopy(self.medians)
        strokes = [fitter.fit_stroke(points) for points in self.medians]
        self.assertEqual([stroke["model"] for stroke in strokes], ["line", "connected-lines", "quadratic"])
        self.assertEqual([[command for command, _ in parse_path(stroke["path"])] for stroke in strokes],
                         [["M", "L"], ["M", "L", "L", "L"], ["M", "Q"]])
        self.assertEqual(self.medians, before)
        for stroke in strokes:
            self.assertEqual(stroke["status"], "candidate")
            self.assertLessEqual(stroke["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
            self.assertLessEqual(max(stroke["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
        self.assertEqual(len(strokes[1]["source_corner_indices"]), 2)
        self.assertLessEqual(max(strokes[1]["corner_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
        points = sample_path(strokes[2]["path"])
        self.assertTrue(all(b[0] < a[0] and b[1] > a[1] for a, b in zip(points, points[1:])))

    def test_user_accepted_wan_v1_geometry_is_byte_exact_after_new_fallbacks(self):
        self.assertEqual([fitter.fit_stroke(points)["path"] for points in self.medians], [
            "M19.36201 27.656288 L81.743358 20.200353",
            "M47.719339 40.993273 L69.740446 41.317265 L56.219398 80.448709 L41.812398 71.291202",
            "M50.242 27.828 Q40.763 57.605 15.283 74.609",
        ])

    def test_water_retains_hook_and_fits_a_smooth_curve_after_its_fold(self):
        before = deepcopy(self.water)
        strokes = [fitter.fit_stroke(points) for points in self.water]
        self.assertEqual(self.water, before)
        self.assertEqual([stroke["model"] for stroke in strokes],
                         ["rounded-hook", "line-curve", "line", "quadratic"])
        self.assertEqual([[op for op, _ in parse_path(stroke["path"])] for stroke in strokes],
                         [["M", "L", "Q", "L"], ["M", "L", "Q"], ["M", "L"], ["M", "Q"]])
        self.assertEqual(strokes[3]["path"], "M51.399 41.006 Q65.849 65.068 92.012 67.842")
        hook = parse_path(strokes[0]["path"])
        self.assertLess(hook[-1][1][0], hook[-2][1][0])
        self.assertLess(hook[-1][1][1], hook[-2][1][1])
        self.assertEqual(len(strokes[1]["source_corner_indices"]), 1)
        for index, stroke in enumerate(strokes):
            limit = fitter.LIMITS["maximum_terminal_deviation"] if index == 2 else fitter.LIMITS["maximum_deviation"]
            self.assertLessEqual(stroke["maximum_deviation"], limit)
            self.assertLessEqual(max(stroke["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])

    def test_return_hook_rounding_keeps_endpoints_and_tangent_continuity(self):
        result = fitter.fit_stroke(self.water[0])
        sharp = parse_path(result["unrounded_path"])
        rounded = parse_path(result["path"])
        self.assertEqual(rounded[0], sharp[0])
        self.assertEqual(rounded[-1], sharp[-1])
        start, entry = rounded[0][1], rounded[1][1]
        control, exit_point = rounded[2][1][:2], rounded[2][1][2:]
        end = rounded[-1][1]
        for a, b in ((fitter.direction(start, entry), fitter.direction(entry, control)),
                     (fitter.direction(control, exit_point), fitter.direction(exit_point, end))):
            self.assertAlmostEqual(sum(x * y for x, y in zip(a, b)), 1, places=6)
        for point in (entry, exit_point):
            self.assertLessEqual(fitter.distance(control, point), 3.001)
        self.assertLess(len(sample_path(result["path"], spacing=0.1)),
                        len(sample_path(result["unrounded_path"], spacing=0.1)))
        self.assertEqual(result["corner_treatment"], "bounded-quadratic-fillet")

    def test_user_accepted_water_v3_geometry_is_byte_exact(self):
        self.assertEqual([fitter.fit_stroke(points)["path"] for points in self.water], [
            "M50.567153 12.639101 L49.238 78.601 Q49.177 81.601 46.462 80.325 L36.410738 75.603461",
            "M18.184367 42.457525 L39.937297 38.648609 Q33.795 61.881 14.932 74.434",
            "M73.267825 27.642537 L56.719108 44.239032",
            "M51.399 41.006 Q65.849 65.068 92.012 67.842",
        ])
        self.assertEqual(fitter.fit_stroke(self.water[0])["unrounded_path"],
                         "M50.567153 12.639101 L49.177409 81.600596 L36.410738 75.603461")

    def test_coffee_first_character_has_eight_bounded_unapproved_candidates(self):
        before = deepcopy(self.coffee)
        strokes = [fitter.fit_stroke(points) for points in self.coffee]
        self.assertEqual(len(strokes), 8)
        self.assertEqual(self.coffee, before)
        for stroke in strokes:
            self.assertEqual(stroke["status"], "candidate")
            self.assertFalse(stroke.get("terminal_adjustment"))
            self.assertLessEqual(stroke["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
            self.assertLessEqual(max(stroke["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
            self.assertEqual([op for op, _ in parse_path(stroke["path"])].count("M"), 1)

    def test_explicit_retention_preserves_exact_current_path_without_refitting(self):
        with patch.object(fitter, "fit_stroke", wraps=fitter.fit_stroke) as fit:
            report = fitter.build_report("\u5496", retain_current_strokes=[4])
        self.assertEqual(fit.call_count, 7)
        self.assertEqual(report["selection"]["retain_current_strokes"], [4])
        retained = report["strokes"][3]
        self.assertEqual(retained["status"], "retained-current")
        self.assertEqual(retained["path"], report["current_paths"][3])
        self.assertIn("not a newly fitted replacement", retained["review_notes"][0])
        self.assertFalse(report["reviewed"])
        self.assertFalse(report["applied"])
        # The retained path is whatever the prepared default currently is, so derive the
        # expectation instead of pinning a hash that changes when defaults are regenerated.
        self.assertEqual([stroke["path"] for stroke in report["strokes"]],
                         [report["current_paths"][3] if index == 3 else fitter.fit_stroke(median)["path"]
                          for index, median in enumerate(self.coffee)])
        for index, median in enumerate(self.coffee):
            if index != 3:
                self.assertEqual(report["strokes"][index], fitter.fit_stroke(median))

    def test_hot_bent_hook_is_source_driven_and_one_smooth_pen_down(self):
        before = deepcopy(self.hot[4])
        stroke = fitter.fit_stroke(self.hot[4])
        self.assertEqual(self.hot[4], before)
        self.assertEqual(stroke["model"], "curved-hook")
        commands = parse_path(stroke["path"])
        self.assertEqual([op for op, _ in commands], ["M", "L", "C", "C"])
        self.assertEqual(stroke["source_corner_indices"], [5])
        self.assertEqual(stroke["smooth_join_indices"], [14])
        self.assertLessEqual(stroke["ordered_curve_error"], fitter.LIMITS["maximum_cubic_error"])
        self.assertLessEqual(stroke["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
        self.assertLessEqual(max(stroke["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
        self.assertFalse(stroke.get("terminal_adjustment"))
        self.assertLess(fitter.distance(commands[-1][1][-2:], self.hot[4][-1]), 1e-6)
        samples = sample_path(stroke["path"], spacing=0.25)
        self.assertAlmostEqual(max(p[1] for p in samples), self.hot[4][14][1], delta=0.1)
        end_tangent = fitter.direction(commands[-1][1][2:4], commands[-1][1][4:])
        interior = fitter.core(self.hot[4][5:])
        source_tangent = fitter.direction(interior[-2], interior[-1])
        self.assertAlmostEqual(sum(a * b for a, b in zip(end_tangent, source_tangent)), 1, places=6)

    def test_hot_cubic_join_is_tangent_continuous_without_reverse_curvature(self):
        commands = parse_path(fitter.fit_stroke(self.hot[4])["path"])
        join = commands[2][1][-2:]
        incoming = fitter.direction(commands[2][1][2:4], join)
        outgoing = fitter.direction(join, commands[3][1][:2])
        self.assertAlmostEqual(sum(a * b for a, b in zip(incoming, outgoing)), 1, places=6)
        start = commands[1][1]
        for _, values in commands[2:]:
            controls = [start] + [values[i:i + 2] for i in range(0, 6, 2)]
            for step in range(201):
                t = step / 200
                velocity = [3 * sum(w * (b[i] - a[i]) for w, a, b in
                                   zip(((1 - t) ** 2, 2 * t * (1 - t), t * t), controls, controls[1:]))
                            for i in (0, 1)]
                acceleration = [6 * ((1 - t) * (controls[2][i] - 2 * controls[1][i] + controls[0][i])
                                     + t * (controls[3][i] - 2 * controls[2][i] + controls[1][i]))
                                for i in (0, 1)]
                self.assertGreater(sum(value * value for value in velocity), 1e-6)
                self.assertLessEqual(velocity[0] * acceleration[1] - velocity[1] * acceleration[0], 0.001)
            start = values[-2:]

    def test_curved_hook_rejects_sampled_self_intersections(self):
        self.assertTrue(fitter.sampled_self_crossing("M10 10 L80 80 L80 10 L10 80"))
        self.assertFalse(fitter.sampled_self_crossing(fitter.fit_stroke(self.hot[4])["path"]))
        with patch.object(fitter, "sampled_self_crossing", return_value=True):
            self.assertEqual(fitter.fit_stroke(self.hot[4])["status"], "unresolved")

    def test_hot_first_five_strokes_remain_byte_exact_in_curvature_revision(self):
        expected = [
            "M22.481346 35.896855 L43.942403 29.222989",
            "M37.789587 14.298962 L36.82 56.734 Q36.751 59.734 33.906 58.783 L26.114177 56.178415",
            "M18.247146 53.341196 L42.089844 39.716796",
            "M58.232 13.572 Q59.202 39.192 45.317 60.377",
            "M45.981461 35.326274 L68.370304 28.020617 C63.994705 40.097277 64.734882 57.910156 81.113281 57.910156 C83.126186 57.910156 82.836513 46.033393 82.783203 43.847656",
        ]
        self.assertEqual([fitter.fit_stroke(points)["path"] for points in self.hot[:5]],
                         expected)

    def test_hot_dots_and_short_crossing_stroke_preserve_supported_curvature(self):
        before = deepcopy(self.hot)
        for points in self.hot[5:]:
            result = fitter.fit_stroke(points)
            self.assertEqual(result["model"], "sustained-curve")
            commands = parse_path(result["path"])
            self.assertEqual([op for op, _ in commands], ["M", "Q"])
            self.assertTrue(fitter.forward_primitive(commands))
            self.assertLess(fitter.distance(commands[0][1], points[0]), 1e-6)
            self.assertLess(fitter.distance(commands[-1][1][-2:], points[-1]), 1e-6)
            original = sample_path(fitter.polyline(points), spacing=1)
            curve_error = fitter.deviation(original, sample_path(result["path"], spacing=1))
            line_error = fitter.deviation(original, sample_path(result["line_candidate_path"], spacing=1))
            self.assertLessEqual(curve_error / line_error, fitter.LIMITS["maximum_curve_line_error_ratio"])
            self.assertLessEqual(curve_error, fitter.LIMITS["maximum_deviation"])
            self.assertGreaterEqual(abs(result["core_turn_degrees"]), fitter.LIMITS["minimum_sustained_turn_degrees"])
            self.assertEqual(result["endpoint_shifts"], [0, 0])
        self.assertEqual(self.hot, before)

    def test_explicit_compaction_changes_only_selected_hot_strokes(self):
        report = fitter.build_report("\u70ed", compact_strokes=[3, 2])
        self.assertEqual(report["schema_version"], 5)
        self.assertEqual(report["selection"]["compact_strokes"], [2, 3])
        self.assertEqual(report["compaction_policy"], fitter.COMPACTION)
        self.assertFalse(report["reviewed"])
        self.assertFalse(report["applied"])
        for index, points in enumerate(self.hot):
            ordinary = fitter.fit_stroke(points)
            result = report["strokes"][index]
            if index in (1, 2):
                self.assertEqual(result["compaction"]["uncompacted_fit"], ordinary)
                self.assertIn("Explicit compaction", result["review_notes"][0])
                self.assertLessEqual(result["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
                self.assertLessEqual(max(result["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
                self.assertNotIn("terminal_adjustment", result)
            else:
                self.assertEqual(result, ordinary)
        self.assertEqual(report["strokes"][1]["model"], "compact-hook")
        self.assertEqual(report["strokes"][2]["model"], "compact-line")

    def test_compact_line_preserves_center_direction_and_shortens_twenty_percent(self):
        points = self.hot[2]
        fitted = fitter.fit_stroke(points)
        before = deepcopy(fitted)
        result = fitter.compact_stroke(points, fitted)
        self.assertEqual(fitted, before)
        a, b = [values for _, values in parse_path(fitted["path"])]
        c, d = [values for _, values in parse_path(result["path"])]
        self.assertAlmostEqual(fitter.distance(c, d) / fitter.distance(a, b), 0.8, places=6)
        for axis in (0, 1):
            self.assertAlmostEqual(a[axis] + b[axis], c[axis] + d[axis], places=6)
        self.assertAlmostEqual(sum(x * y for x, y in zip(fitter.direction(a, b), fitter.direction(c, d))), 1)
        self.assertEqual(result["maximum_deviation"], 3.668)
        for old, new in ((a, c), (b, d)):
            self.assertLessEqual(fitter.distance(old, new), fitter.STYLE["width"] / 2)

    def test_compact_hook_preserves_shaft_fold_direction_and_smooth_joins(self):
        points = self.hot[1]
        fitted = fitter.fit_stroke(points)
        before = deepcopy(fitted)
        result = fitter.compact_stroke(points, fitted)
        self.assertEqual(fitted, before)
        original = parse_path(fitted["unrounded_path"])
        sharp = parse_path(result["compaction"]["unrounded_path"])
        self.assertEqual(sharp[:2], original[:2])
        corner, tip = sharp[1][1], sharp[-1][1]
        self.assertAlmostEqual(fitter.distance(corner, tip) / fitter.distance(corner, original[-1][1]), 2 / 3, places=6)
        self.assertAlmostEqual(sum(x * y for x, y in zip(fitter.direction(corner, tip),
                                                       fitter.direction(corner, original[-1][1]))), 1)
        rounded = parse_path(result["path"])
        self.assertEqual([op for op, _ in rounded], ["M", "L", "Q", "L"])
        start, entry = rounded[0][1], rounded[1][1]
        control, exit_point = rounded[2][1][:2], rounded[2][1][2:]
        for a, b in ((fitter.direction(start, entry), fitter.direction(entry, control)),
                     (fitter.direction(control, exit_point), fitter.direction(exit_point, tip))):
            self.assertAlmostEqual(sum(x * y for x, y in zip(a, b)), 1, places=6)
        self.assertEqual(result["maximum_deviation"], 3.745)
        self.assertFalse(fitter.sampled_self_crossing(result["path"]))

    def test_compaction_follows_source_transforms_not_character_coordinates(self):
        for points in (self.hot[1], self.hot[2], [[50, 10], [50, 35], [50, 60], [40, 56]]):
            original = fitter.compact_stroke(points, fitter.fit_stroke(points))
            for transform in (lambda x, y: [x - 5, y - 5], lambda x, y: [100 - x, y],
                              lambda x, y: [100 - y, x]):
                moved = [transform(x, y) for x, y in points]
                result = fitter.compact_stroke(moved, fitter.fit_stroke(moved))
                self.assertEqual(result["model"], original["model"])
                for (_, a), (_, b) in zip(parse_path(original["path"]), parse_path(result["path"])):
                    for index in range(0, len(a), 2):
                        for expected, actual in zip(transform(*a[index:index + 2]), b[index:index + 2]):
                            self.assertAlmostEqual(expected, actual, places=3)

    def test_compaction_does_not_relax_limits_or_shorten_unsupported_shapes(self):
        fitted = fitter.fit_stroke(self.hot[2])
        for limits in ({"maximum_deviation": 0.1}, {"maximum_endpoint_shift": 0.1}):
            with patch.dict(fitter.LIMITS, limits), self.assertRaisesRegex(ValueError, "pilot limit"):
                fitter.compact_stroke(self.hot[2], fitted)
        for points in (self.hot[4], self.hot[6], self.medians[1]):
            with self.subTest(points=points), self.assertRaisesRegex(ValueError, "supports only"):
                fitter.compact_stroke(points, fitter.fit_stroke(points))
        with self.assertRaisesRegex(ValueError, "fitted candidate"):
            fitter.compact_stroke(self.hot[2], {"status": "unresolved", "path": None})
        with self.assertRaisesRegex(ValueError, "fitted candidate"):
            fitter.compact_stroke(self.hot[2], fitter.retained_current_stroke(self.hot[2], fitted["path"]))
        for points, message in (([[20, 20], [22, 23]], "one pen width"),
                                ([[50, 10], [50, 35], [50, 60], [44, 58]], "returning-hook limits")):
            with self.subTest(points=points), self.assertRaisesRegex(ValueError, message):
                fitter.compact_stroke(points, fitter.fit_stroke(points))

    def test_hot_positioning_raises_first_stroke_and_spaces_left_component(self):
        offsets = [(1, -1.25, -3), (2, -1.25, 0), (3, -1.25, 0)]
        report = fitter.build_report("\u70ed", compact_strokes=[2, 3], translate_strokes=offsets)
        self.assertEqual(report["selection"]["translate_strokes"],
                         [{"stroke": index, "dx": dx, "dy": dy} for index, dx, dy in offsets])
        self.assertFalse(report["reviewed"])
        self.assertFalse(report["applied"])
        before = []
        for index, points in enumerate(self.hot):
            fitted = fitter.fit_stroke(points)
            if index in (1, 2):
                fitted = fitter.compact_stroke(points, fitted)
            before.append(fitted)
            result = report["strokes"][index]
            if index < 3:
                self.assertEqual(result["placement"]["unpositioned_fit"], fitted)
                self.assertLessEqual(result["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
                self.assertLessEqual(max(result["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
                self.assertNotIn("terminal_adjustment", result)
                dx, dy = offsets[index][1:]
                for (op, a), (moved_op, b) in zip(parse_path(fitted["path"]), parse_path(result["path"])):
                    self.assertEqual(op, moved_op)
                    for j in range(0, len(a), 2):
                        self.assertAlmostEqual(b[j] - a[j], dx, places=6)
                        self.assertAlmostEqual(b[j + 1] - a[j + 1], dy, places=6)
            else:
                self.assertEqual(result, fitted)
        # The raised crossbar and shortened rising stroke still cross the shaft.
        shaft = [parse_path(report["strokes"][1]["path"])[i][1] for i in (0, 1)]
        for index in (0, 2):
            bar = [values for _, values in parse_path(report["strokes"][index]["path"])]
            join = fitter.intersection(shaft, bar)
            self.assertIsNotNone(join)
            self.assertLess(fitter.segment_distance(join, *shaft), 1e-6)
            self.assertLess(fitter.segment_distance(join, *bar), 1e-6)
        right = [sample_path(stroke["path"], spacing=0.25) for stroke in before[3:6]]
        def gap(strokes):
            left = [point for stroke in strokes[:3] for point in sample_path(stroke["path"], spacing=0.25)]
            return min(fitter.segment_distance(point, a, b) for point in left
                       for samples in right for a, b in zip(samples, samples[1:])) - fitter.STYLE["width"]
        self.assertGreater(gap(report["strokes"]), gap(before) + 1)
        self.assertGreater(gap(report["strokes"]), 0)

    def test_translation_keeps_curves_and_control_handles_without_mutation(self):
        for points in (self.hot[3], self.hot[4], self.hot[9]):
            fitted = fitter.fit_stroke(points)
            before = deepcopy(fitted)
            result = fitter.translate_stroke(points, fitted, -0.25, 0.25)
            self.assertEqual(fitted, before)
            for (op, a), (moved_op, b) in zip(parse_path(fitted["path"]), parse_path(result["path"])):
                self.assertEqual(op, moved_op)
                for j in range(0, len(a), 2):
                    self.assertAlmostEqual(b[j], a[j] - 0.25, places=6)
                    self.assertAlmostEqual(b[j + 1], a[j + 1] + 0.25, places=6)

    def test_hot_start_trim_follows_positioning_and_preserves_shaft_connections(self):
        report = fitter.build_report("\u70ed", compact_strokes=[2, 3],
                                     translate_strokes=[(1, -1.25, -3), (2, -2.5, 0), (3, -1.25, -1)],
                                     trim_line_starts=[(3, 1.5)])
        self.assertEqual(report["selection"]["trim_line_starts"], [{"stroke": 3, "amount": 1.5}])
        self.assertFalse(report["applied"])
        self.assertFalse(report["reviewed"])
        self.assertEqual(report["strokes"][0]["path"], "M21.231346 32.896855 L42.692403 26.222989")
        self.assertEqual(report["strokes"][1]["placement"]["dx"], -2.5)
        result = report["strokes"][2]
        positioned = result["start_trim"]["untrimmed_fit"]
        self.assertEqual(positioned["placement"]["dy"], -1)
        a, b = [values for _, values in parse_path(positioned["path"])]
        c, d = [values for _, values in parse_path(result["path"])]
        self.assertEqual(b, d)
        self.assertAlmostEqual(fitter.distance(a, b) - fitter.distance(c, d), 1.5, places=6)
        self.assertEqual(result["path"], "M20.683781 50.234548 L38.455574 40.079236")
        self.assertLessEqual(result["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
        self.assertLessEqual(max(result["endpoint_shifts"]), fitter.LIMITS["maximum_endpoint_shift"])
        shaft = [parse_path(report["strokes"][1]["path"])[i][1] for i in (0, 1)]
        for index in (0, 2):
            bar = [values for _, values in parse_path(report["strokes"][index]["path"])]
            join = fitter.intersection(shaft, bar)
            self.assertIsNotNone(join)
            self.assertLess(fitter.segment_distance(join, *shaft), 1e-6)
            self.assertLess(fitter.segment_distance(join, *bar), 1e-6)
        for index in range(3, 10):
            self.assertEqual(report["strokes"][index], fitter.fit_stroke(self.hot[index]))

    def test_start_trim_preserves_end_angle_and_input_in_either_direction(self):
        for points in ([[20, 20], [40, 30]], [[40, 30], [20, 20]], [[40, 20], [40, 50]]):
            fitted = fitter.fit_stroke(points)
            before = deepcopy(fitted)
            result = fitter.trim_line_start(points, fitted, 1.5)
            self.assertEqual(fitted, before)
            a, b = [values for _, values in parse_path(fitted["path"])]
            c, d = [values for _, values in parse_path(result["path"])]
            self.assertEqual(b, d)
            self.assertAlmostEqual(fitter.distance(a, c), 1.5, places=6)
            self.assertAlmostEqual(fitter.distance(a, b) - fitter.distance(c, d), 1.5, places=6)
            self.assertAlmostEqual(sum(x * y for x, y in zip(fitter.direction(a, b), fitter.direction(c, d))), 1)
            self.assertEqual(result["start_trim"]["untrimmed_fit"], fitted)
            self.assertIn("end and angle retained", result["review_notes"][-1])

    def test_start_trim_rejects_invalid_amounts_unsupported_paths_and_limits(self):
        points = [[20, 20], [40, 30]]
        fitted = fitter.fit_stroke(points)
        for amount in (0, -1, True, "1", float("nan"), float("inf"), 3):
            with self.subTest(amount=amount), self.assertRaisesRegex(ValueError, "Start trim must"):
                fitter.trim_line_start(points, fitted, amount)
        for limits in ({"maximum_deviation": 0.1}, {"maximum_endpoint_shift": 0.1}):
            with patch.dict(fitter.LIMITS, limits), self.assertRaisesRegex(ValueError, "pilot limit"):
                fitter.trim_line_start(points, fitted, 0.5)
        for result in ({"status": "unresolved", "path": None},
                       fitter.retained_current_stroke(points, fitted["path"]),
                       fitter.trim_line_start(points, fitted, 1)):
            with self.assertRaisesRegex(ValueError, "untrimmed fitted candidate"):
                fitter.trim_line_start(points, result, 1)
        with self.assertRaisesRegex(ValueError, "single fitted line"):
            fitter.trim_line_start(self.hot[1], fitter.fit_stroke(self.hot[1]), 1)
        with self.assertRaisesRegex(ValueError, "one pen width"):
            fitter.trim_line_start([[20, 20], [26, 20]], fitter.fit_stroke([[20, 20], [26, 20]]), 1)

    def test_translation_rejects_invalid_offsets_bounds_and_fit_failures(self):
        points = [[20, 20], [40, 20]]
        fitted = fitter.fit_stroke(points)
        for dx, dy in ((0, 0), (True, 0), ("1", 0), (float("nan"), 0), (0, float("inf")), (6, 0)):
            with self.subTest(dx=dx, dy=dy), self.assertRaisesRegex(ValueError, "Translation must"):
                fitter.translate_stroke(points, fitted, dx, dy)
        with self.assertRaisesRegex(ValueError, "pilot limit"):
            fitter.translate_stroke(points, fitted, 5, 0)
        with patch.dict(fitter.LIMITS, {"maximum_deviation": 0.1}), self.assertRaisesRegex(ValueError, "pilot limit"):
            fitter.translate_stroke(points, fitted, 0.5, 0)
        for result in ({"status": "unresolved", "path": None},
                       fitter.retained_current_stroke(points, fitted["path"]),
                       fitter.translate_stroke(points, fitted, 0.5, 0)):
            with self.assertRaisesRegex(ValueError, "unpositioned fitted candidate"):
                fitter.translate_stroke(points, result, 0.5, 0)
        points = [[0, 20], [10, 20]]
        with self.assertRaisesRegex(ValueError, "100-unit frame"):
            fitter.translate_stroke(points, fitter.fit_stroke(points), -1, 0)

    def test_sustained_curve_requires_core_evidence_and_meaningful_improvement(self):
        for limits in ({"minimum_sustained_turn_degrees": 180}, {"maximum_curve_line_error_ratio": 0.01}):
            with self.subTest(limits=limits), patch.dict(fitter.LIMITS, limits):
                for points in self.hot[5:]:
                    self.assertEqual(fitter.fit_stroke(points)["model"], "line")
        for points in (self.hot[0], self.hot[2], self.coffee[0], self.coffee[5],
                       [[10, 20], [30, 20], [60, 20]],
                       [[10, 20], [20, 19.9], [30, 20], [50, 20]]):
            with self.subTest(points=points):
                self.assertEqual(fitter.fit_stroke(points)["model"], "line")

    def test_sustained_curve_follows_source_under_transforms(self):
        for points in self.hot[5:]:
            original = fitter.fit_stroke(points)
            for transform in (lambda x, y: [x - 5, y - 5], lambda x, y: [100 - x, y],
                              lambda x, y: [100 - y, x]):
                moved = fitter.fit_stroke([transform(x, y) for x, y in points])
                self.assertEqual(moved["model"], original["model"])
                for (_, a), (_, b) in zip(parse_path(original["path"]), parse_path(moved["path"])):
                    for index in range(0, len(a), 2):
                        for expected, actual in zip(transform(*a[index:index + 2]), b[index:index + 2]):
                            self.assertAlmostEqual(expected, actual, places=3)

    def test_sustained_curve_is_not_a_character_specific_dot_rule(self):
        points = sample_path("M20 20 Q42 38 60 60", spacing=2)
        line = fitter.straight_fit(points, fitter.core(points))
        self.assertIsNotNone(line)
        result = fitter.fit_stroke(points)
        self.assertEqual(result["model"], "sustained-curve")
        self.assertLess(result["maximum_deviation"], 0.1)
        self.assertIn("Sustained source curvature", result["review_notes"][0])

    def test_curved_hook_follows_translation_reflection_and_rotation(self):
        original = fitter.fit_stroke(self.hot[4])
        for transform in (lambda x, y: [x - 4, y + 5], lambda x, y: [100 - x, y],
                          lambda x, y: [100 - y, x]):
            moved = fitter.fit_stroke([transform(x, y) for x, y in self.hot[4]])
            self.assertEqual(moved["model"], original["model"])
            self.assertEqual(moved["smooth_join_indices"], original["smooth_join_indices"])
            for (_, a), (_, b) in zip(parse_path(original["path"]), parse_path(moved["path"])):
                for index in range(0, len(a), 2):
                    for expected, actual in zip(transform(*a[index:index + 2]), b[index:index + 2]):
                        self.assertAlmostEqual(expected, actual, places=3)

    def test_curved_hook_limits_do_not_silently_fall_back_to_source(self):
        for limits in ({"maximum_cubic_segments": 1}, {"maximum_cubic_error": 0.1},
                       {"maximum_deviation": 0.1}, {"maximum_endpoint_shift": 0.1}):
            with self.subTest(limits=limits), patch.dict(fitter.LIMITS, limits):
                result = fitter.fit_stroke(self.hot[4])
                self.assertEqual(result["status"], "unresolved")
                self.assertIsNone(result["path"])
                self.assertTrue(any("curved-hook" in reason for reason in result["reasons"]))

    def test_tangent_fit_rejects_reversed_parallel_and_out_of_frame_controls(self):
        points = sample_path("M20 20 C20 35 30 40 40 40", spacing=1)
        self.assertIsNotNone(fitter.tangent_cubic(points, points[0], points[-1], [0, 1], [1, 0]))
        for start, end, incoming, outgoing in (
            (points[0], points[-1], [0, -1], [1, 0]),
            (points[0], points[-1], [0, 1], [-1, 0]),
            (points[0], points[-1], [1, 0], [1, 0]),
            ([-1, 20], points[-1], [0, 1], [1, 0]),
        ):
            self.assertIsNone(fitter.tangent_cubic(points, start, end, incoming, outgoing))

    def test_retained_current_path_still_requires_valid_geometry(self):
        with self.assertRaises(ValueError):
            fitter.retained_current_stroke(self.coffee[3], "M20 20 L200 20")

    def test_hook_rule_is_not_blanket_corner_rounding(self):
        self.assertIsNotNone(fitter.rounded_return_hook("M50 10 L50 80 L40 75"))
        for path in ("M15 20 L70 20 L70 80", "M40 10 L40 80 L10 30",
                     "M10 10 L10 20 L7 19", "M20 20 L70 20 L60 70 L50 65",
                     "M20 20 Q50 50 60 70"):
            with self.subTest(path=path):
                self.assertIsNone(fitter.rounded_return_hook(path))
        result = fitter.fit_stroke([[50, 10], [50, 40], [50, 80], [40, 75]])
        self.assertEqual(result["model"], "rounded-hook")

    def test_terminal_adjustment_is_explicit_and_does_not_relax_the_stroke_core(self):
        stroke = fitter.fit_stroke(self.water[2])
        self.assertTrue(stroke["terminal_adjustment"])
        self.assertGreater(stroke["maximum_deviation"], fitter.LIMITS["maximum_deviation"])
        self.assertLessEqual(stroke["central_deviation"], fitter.LIMITS["line_core_error"])
        self.assertIn("Terminal-only", stroke["review_notes"][0])
        with patch.dict(fitter.LIMITS, {"maximum_terminal_deviation": 4.125}):
            self.assertEqual(fitter.fit_stroke(self.water[2])["status"], "unresolved")

    def test_new_join_models_require_bounds_direction_and_real_corners(self):
        for median in self.water[:2]:
            for model in fitter.joined_models(median):
                commands = parse_path(model["path"])
                self.assertTrue(fitter.forward_primitive(commands[:2]))
                self.assertTrue(fitter.forward_primitive([("M", commands[1][1][-2:]), commands[2]]))
                self.assertGreaterEqual(model["corner_angles"][0], fitter.LIMITS["minimum_corner_degrees"])
                self.assertLessEqual(model["corner_shifts"][0], fitter.LIMITS["maximum_endpoint_shift"])
        self.assertEqual(list(fitter.joined_models([[10, 20], [30, 20], [80, 20]])), [])

    def test_fits_follow_translated_source_not_character_specific_constants(self):
        for median in [*self.medians, *self.water]:
            original = fitter.fit_stroke(median)
            moved = fitter.fit_stroke([[x + 4, y + 2] for x, y in median])
            self.assertEqual(original["model"], moved["model"])
            for (_, values), (_, shifted) in zip(parse_path(original["path"]), parse_path(moved["path"])):
                for index, (a, b) in enumerate(zip(values, shifted)):
                    self.assertAlmostEqual(b - a, 4 if index % 2 == 0 else 2, places=3)

    def test_joined_and_terminal_models_follow_mirrored_source(self):
        for median in self.water[:3]:
            original = fitter.fit_stroke(median)
            mirrored = fitter.fit_stroke([[100 - x, y] for x, y in median])
            self.assertEqual(original["model"], mirrored["model"])
            for (_, values), (_, reflected) in zip(parse_path(original["path"]), parse_path(mirrored["path"])):
                for index, (a, b) in enumerate(zip(values, reflected)):
                    self.assertAlmostEqual(100 - a if index % 2 == 0 else a, b, places=3)

    def test_straight_and_short_strokes_keep_direction_and_endpoints(self):
        for points in ([[10, 30], [40, 25], [70, 20]], [[30, 10], [30, 80]],
                       [[70, 20], [10, 30]], [[20, 20], [22, 23]]):
            result = fitter.fit_stroke(points)
            self.assertEqual(result["model"], "line")
            sampled = sample_path(result["path"])
            self.assertAlmostEqual(fitter.distance(sampled[0], points[0]), 0, places=5)
            self.assertAlmostEqual(fitter.distance(sampled[-1], points[-1]), 0, places=5)

    def test_genuine_right_angle_is_one_pen_down_not_a_swooping_curve(self):
        result = fitter.fit_stroke([[15, 20], [40, 20], [70, 20], [70, 40], [70, 80]])
        self.assertEqual(result["model"], "connected-lines")
        self.assertEqual([op for op, _ in parse_path(result["path"])], ["M", "L", "L"])
        self.assertAlmostEqual(result["corner_angles"][0], 90, places=1)

    def test_loop_is_reported_as_unresolved_not_replaced_by_a_line(self):
        result = fitter.fit_stroke([[20, 20], [60, 20], [60, 60], [20, 60], [20, 20]])
        self.assertEqual(result["status"], "unresolved")
        self.assertIsNone(result["path"])
        self.assertIn("Loop-like", result["reasons"][0])

    def test_input_errors_are_explicit(self):
        for points in ([], [[1, 2]], [[1, 2], [1, 2]], [[1, 2], [101, 2]],
                       [[True, 2], [3, 4]], [[1, 2], [float("nan"), 4]], [[1, 2], [3]]):
            with self.subTest(points=points), self.assertRaises(ValueError):
                fitter.fit_stroke(points)

    def test_out_of_frame_curve_is_not_returned_or_allowed_to_abort_other_models(self):
        with patch.object(fitter, "curve_path", return_value="M20 20 Q-10 30 60 60"):
            result = fitter.fit_stroke([[20, 20], [50, 20], [50, 60]])
        if result["path"] is not None:
            self.assertNotEqual(result["model"], "quadratic")
            parse_path(result["path"])
        else:
            self.assertEqual(result["status"], "unresolved")


class PreviewWorkflowTests(unittest.TestCase):
    def test_invalid_start_trim_selections_fail_before_source_reads(self):
        for trims in ([(0, 1)], [(True, 1)], [(1, 1), (1, 2)], [(1, 0)], [(1, float("nan"))],
                      [(1, 1, 1)], [None], ((1, 1),)):
            with self.subTest(trims=trims), patch.object(fitter, "prepare_context") as inventory:
                with self.assertRaises(ValueError):
                    fitter.build_report("\u70ed", trim_line_starts=trims)
                inventory.assert_not_called()
        with patch.object(fitter, "prepare_context") as inventory:
            with self.assertRaisesRegex(ValueError, "both retained"):
                fitter.build_report("\u70ed", retain_current_strokes=[3], trim_line_starts=[(3, 1)])
            inventory.assert_not_called()

    def test_start_trim_indices_are_checked_before_fitting(self):
        with patch.object(fitter, "fit_stroke") as fit:
            with self.assertRaisesRegex(ValueError, "stroke number"):
                fitter.build_report("\u70ed", trim_line_starts=[(11, 1)])
            fit.assert_not_called()

    def test_cli_passes_start_trim_with_compaction_and_positioning(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--compact-stroke", "3",
                                                 "--translate-stroke", "3", "-1.25", "-1",
                                                 "--trim-line-start", "3", "1.5"]), \
                    patch.object(fitter, "build_report", return_value={"strokes": []}) as build, \
                    patch.object(fitter, "render_preview", return_value="<html>preview</html>"), \
                    patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fitter.main(), 0)
            build.assert_called_once_with("\u70ed", compact_strokes=[3],
                                          translate_strokes=[(3, -1.25, -1)], trim_line_starts=[(3, 1.5)])

    def test_failed_start_trim_writes_nothing_or_falls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--trim-line-start", "2", "1"]), \
                    patch("sys.stderr", new=io.StringIO()) as errors:
                self.assertEqual(fitter.main(), 1)
            self.assertIn("Stroke 2 start trim failed", errors.getvalue())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_invalid_translations_fail_before_source_reads(self):
        cases = ([(0, 1, 0)], [(True, 1, 0)], [(1, 1, 0), (1, 0, 1)], [(1, 0, 0)],
                 [(1, float("nan"), 0)], [(1, 1)], [(1, 1, 0, 0)], [None], ((1, 1, 0),))
        for translations in cases:
            with self.subTest(translations=translations), patch.object(fitter, "prepare_context") as inventory:
                with self.assertRaises(ValueError):
                    fitter.build_report("\u70ed", translate_strokes=translations)
                inventory.assert_not_called()
        with patch.object(fitter, "prepare_context") as inventory:
            with self.assertRaisesRegex(ValueError, "both retained"):
                fitter.build_report("\u70ed", retain_current_strokes=[2], translate_strokes=[(2, -1, 0)])
            inventory.assert_not_called()

    def test_translation_indices_are_checked_before_fitting(self):
        with patch.object(fitter, "fit_stroke") as fit:
            with self.assertRaisesRegex(ValueError, "stroke number"):
                fitter.build_report("\u70ed", translate_strokes=[(11, -1, 0)])
            fit.assert_not_called()

    def test_cli_passes_explicit_translation_after_compaction(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--compact-stroke", "2",
                                                 "--translate-stroke", "1", "-1.25", "-3",
                                                 "--translate-stroke", "2", "-1.25", "0"]), \
                    patch.object(fitter, "build_report", return_value={"strokes": []}) as build, \
                    patch.object(fitter, "render_preview", return_value="<html>preview</html>"), \
                    patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fitter.main(), 0)
            build.assert_called_once_with("\u70ed", compact_strokes=[2],
                                          translate_strokes=[(1, -1.25, -3.0), (2, -1.25, 0.0)])

    def test_failed_translation_writes_nothing_and_reports_stroke(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--translate-stroke", "1", "-5.5", "0"]), \
                    patch("sys.stderr", new=io.StringIO()) as errors:
                self.assertEqual(fitter.main(), 1)
            self.assertIn("Stroke 1 translation failed", errors.getvalue())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_invalid_compaction_and_conflicting_retention_fail_before_sources(self):
        for compacted in ([0], [-1], [True], [1, 1], ["2"], (2,)):
            with self.subTest(compacted=compacted), patch.object(fitter, "prepare_context") as inventory:
                with self.assertRaisesRegex(ValueError, "unique positive integers"):
                    fitter.build_report("\u70ed", compact_strokes=compacted)
                inventory.assert_not_called()
        with patch.object(fitter, "prepare_context") as inventory:
            with self.assertRaisesRegex(ValueError, "both retained"):
                fitter.build_report("\u70ed", retain_current_strokes=[2], compact_strokes=[2])
            inventory.assert_not_called()

    def test_out_of_range_compaction_fails_before_fitting(self):
        with patch.object(fitter, "fit_stroke") as fit:
            with self.assertRaisesRegex(ValueError, "stroke number"):
                fitter.build_report("\u70ed", compact_strokes=[11])
            fit.assert_not_called()

    def test_cli_passes_compaction_and_disjoint_retention_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--compact-stroke", "2",
                                                 "--compact-stroke", "3", "--retain-current-stroke", "4"]), \
                    patch.object(fitter, "build_report", return_value={"strokes": []}) as build, \
                    patch.object(fitter, "render_preview", return_value="<html>preview</html>"), \
                    patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fitter.main(), 0)
            build.assert_called_once_with("\u70ed", retain_current_strokes=[4], compact_strokes=[2, 3])

    def test_failed_explicit_compaction_does_not_write_or_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u70ed",
                                                 "--output", str(output), "--compact-stroke", "4"]), \
                    patch("sys.stderr", new=io.StringIO()) as errors:
                self.assertEqual(fitter.main(), 1)
            self.assertIn("Stroke 4 compaction failed", errors.getvalue())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_invalid_retention_is_rejected_before_reading_sources(self):
        for retained in ([0], [-1], [True], [1, 1], ["4"], (4,)):
            with self.subTest(retained=retained), patch.object(fitter, "prepare_context") as inventory:
                with self.assertRaisesRegex(ValueError, "unique positive integers"):
                    fitter.build_report("\u5496", retain_current_strokes=retained)
                inventory.assert_not_called()

    def test_out_of_range_retention_is_rejected_before_fitting(self):
        with patch.object(fitter, "fit_stroke") as fit:
            with self.assertRaisesRegex(ValueError, "stroke number"):
                fitter.build_report("\u5496", retain_current_strokes=[9])
        fit.assert_not_called()

    def test_cli_passes_explicit_retention_without_implicit_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u5496",
                                                 "--output", str(output), "--retain-current-stroke", "4",
                                                 "--retain-current-stroke", "7"]), \
                    patch.object(fitter, "build_report", return_value={"strokes": []}) as build, \
                    patch.object(fitter, "render_preview", return_value="<html>preview</html>"), \
                    patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fitter.main(), 0)
            build.assert_called_once_with("\u5496", retain_current_strokes=[4, 7])

    def test_multiple_characters_are_rejected_before_reading_or_generating(self):
        with patch.object(fitter, "prepare_context") as inventory:
            with self.assertRaisesRegex(ValueError, "exactly one"):
                fitter.build_report("\u4e07\u4e00")
        inventory.assert_not_called()

    def test_canonical_output_locations_are_rejected_before_fitting(self):
        for path in ("curriculum/review.html", "public/preview.html", "src/preview.html", "preview.yaml"):
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u4e07", "--output", path]), \
                    patch.object(fitter, "build_report") as build, patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(fitter.main(), 1)
                build.assert_not_called()

    def test_cli_writes_only_requested_html_and_sibling_json(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.html"
            report = {"character": "\u4e07", "strokes": [{"model": "line"}], "applied": False}
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u4e07", "--output", str(output)]), \
                    patch.object(fitter, "build_report", return_value=report) as build, \
                    patch.object(fitter, "render_preview", return_value="<html>preview</html>"), \
                    patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fitter.main(), 0)
            build.assert_called_once_with("\u4e07")
            self.assertEqual({path.name for path in Path(directory).iterdir()}, {"preview.html", "preview.json"})
            self.assertEqual(json.loads(output.with_suffix(".json").read_text(encoding="utf-8")), report)
            self.assertFalse(report["applied"])

    def test_source_failure_creates_no_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "missing" / "preview.html"
            with patch.object(fitter.sys, "argv", ["fit_chinese_strokes.py", "--character", "\u4e07", "--output", str(output)]), \
                    patch.object(fitter, "build_report", side_effect=ValueError("Source checksum mismatch")), \
                    patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(fitter.main(), 1)
            self.assertFalse(output.parent.exists())

    def test_embedded_report_and_license_are_escaped(self):
        page = fitter.render_preview({"notice": "</pre><script>bad</script>", "strokes": []}, "</pre>license")
        self.assertNotIn("</pre><script>bad", page)
        self.assertIn("\\u003c/script>", page)
        self.assertIn("&lt;/pre&gt;license", page)

    def test_preview_surfaces_terminal_review_notes(self):
        page = fitter.render_preview({"notice": "test", "strokes": []}, "license")
        self.assertIn("stroke.review_notes", page)
        self.assertIn("if(stroke.terminal_adjustment)row.className='warning'", page)
        self.assertIn("Kept from current guide: stroke ", page)
        self.assertIn("explicitly marked as a retained current guide", page)
        self.assertIn("Explicitly compacted: stroke ", page)
        self.assertIn("Explicit compaction is a separate style choice", page)
        self.assertIn("Explicitly positioned: ", page)
        self.assertIn("Start trimmed: ", page)


if __name__ == "__main__":
    unittest.main()
