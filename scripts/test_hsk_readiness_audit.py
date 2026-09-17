"""Tests for the reproducible HSK curriculum coverage audit."""

from pathlib import Path
import tempfile
import unittest

from curriculum_yaml import dump_yaml, load_yaml
from audit_hsk_readiness import (
    AUDIT_PATH,
    CHINESE_ROOT,
    curriculum_snapshot,
    parse_official_vocabulary,
    tokenize_known_headwords,
    validate_checked_in_audit,
)


class HskReadinessAuditTests(unittest.TestCase):
    def test_official_vocabulary_parser_uses_the_actual_outline_not_the_toc(self):
        text = (
            "词汇大纲\nHSK（一级）认读字\n"
            "词汇大纲\n"
            "1 1 爱 ài 动\n"
            "2 1 爸爸 bàba 名\n"
            "3 2 帮忙 bāngmáng 动\n"
            "HSK（一级）认读字\n"
        )
        self.assertEqual(parse_official_vocabulary(text), {
            1: ["爱", "爸爸"],
            2: ["帮忙"],
            3: [],
            4: [],
            5: [],
            6: [],
        })

    def test_practice_tokenizer_prefers_the_longest_known_headword(self):
        tokens, unknown = tokenize_known_headwords(
            "我坐出租车去北京。", {"我", "坐", "出", "出租车", "去"}
        )
        self.assertEqual(tokens, ["我", "坐", "出租车", "去"])
        self.assertEqual(unknown, ["北", "京"])

    def test_checked_in_report_matches_the_current_curriculum(self):
        self.assertEqual(validate_checked_in_audit(), [])
        audit = load_yaml(AUDIT_PATH)
        self.assertEqual(audit["conclusion"], "unsupported")
        self.assertEqual([
            result["official_2026_vocabulary"]["mapped_coverage_lower_percent"]
            for result in audit["results"]
        ], [100.0] * 6)
        self.assertEqual([
            result["practice_exam_vocabulary"]["mapped_coverage_percent"]
            for result in audit["results"]
        ], [100.0] * 6)
        self.assertTrue(all(
            result["practice_exam_vocabulary"]["paper_count"] == 10
            for result in audit["results"]
        ))
        self.assertTrue(all(
            result["grammar"]["official_crosswalk_status"] == "not-reviewed"
            for result in audit["results"]
        ))
        self.assertEqual(
            audit["overall_gates"]["official_grammar_crosswalk"], "blocked"
        )
        self.assertEqual(
            audit["overall_gates"]["timed_unseen_mock_performance"], "not-assessed"
        )

    def test_stale_curriculum_fingerprint_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "teaching" / "core").mkdir(parents=True)
            audit = load_yaml(AUDIT_PATH)
            program = load_yaml(CHINESE_ROOT / "teaching" / "core" / "sequence.yaml")
            program["phases"][0]["levels"][0]["units"][0]["vocabulary"][0]["ch"] = "失配"
            (root / "teaching" / "hsk-audit.yaml").write_text(
                dump_yaml(audit), encoding="utf-8"
            )
            for name in ("hsk-readiness.yaml", "hsk-grammar-crosswalk.yaml"):
                (root / "teaching" / name).write_text(
                    (CHINESE_ROOT / "teaching" / name).read_text(encoding="utf-8"),
                    encoding="utf-8",
                )
            (root / "teaching" / "core" / "sequence.yaml").write_text(
                dump_yaml(program), encoding="utf-8"
            )
            errors = validate_checked_in_audit(root)
            self.assertIn("results[0].curriculum is stale", errors)

    def test_curriculum_snapshot_is_cumulative(self):
        program = load_yaml(CHINESE_ROOT / "teaching" / "core" / "sequence.yaml")
        snapshots = curriculum_snapshot(program)
        self.assertEqual([len(row["headwords"]) for row in snapshots],
                         [352, 941, 1854, 3299, 5423, 8104])
        self.assertTrue(snapshots[0]["headwords"] < snapshots[-1]["headwords"])


if __name__ == "__main__":
    unittest.main()
