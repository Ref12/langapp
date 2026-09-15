"""Korean source-position and official-reading regression tests."""

from copy import deepcopy
import hashlib
import unittest
from unittest.mock import patch

from korean_sources import (
    definitions, extract_senses, features, match_readings, official_record, verify_bytes,
)


class KoreanSourceTests(unittest.TestCase):
    def test_checksum_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            verify_bytes(b"changed source", "not-its-hash", "source")

    def test_definitions_keep_duplicate_positions_and_whitespace(self):
        values = ["The act of supervision. ", "The act of supervision. "]
        self.assertEqual(definitions(repr(values), "fixture"), values)
        for value in ("[]", "'not a list'", "['valid', None]", "['']"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                definitions(value, "fixture")

    def test_source_position_alignment_and_raw_bilingual_text(self):
        import csv
        import io
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=[
            "Form", "Part of Speech", "Korean Definition", "English Definition",
            "Usages", "Vocabulary Level", "Semantic Category",
        ])
        writer.writeheader()
        writer.writerow({
            "Form": "감독", "Part of Speech": "명사",
            "Korean Definition": repr(["감독하는 일.", "감독하는 사람."]),
            "English Definition": repr(["Supervision. ", "Supervision. "]),
            "Vocabulary Level": "", "Usages": "[]", "Semantic Category": "",
        })
        raw = stream.getvalue().encode("utf-8")
        with patch("korean_sources.SHA256", hashlib.sha256(raw).hexdigest()):
            output = extract_senses(raw, {}, ["ko-nikl-00001"])
        senses = output["entries"][0]["senses"]
        self.assertEqual([s["id"] for s in senses], ["ko-nikl-00001-s001", "ko-nikl-00001-s002"])
        self.assertEqual(senses[0]["english"], senses[1]["english"])
        self.assertNotEqual(senses[0]["korean"], senses[1]["korean"])
        self.assertEqual(senses[0]["english"], "Supervision. ")
        self.assertEqual(output["entries"][0]["source_band"], "unbanded")

    def test_official_singletons_variants_and_missing_readings(self):
        entry = {
            "val": "1",
            "Lemma": [{"feat": {"att": "writtenForm", "val": "읽다"}},
                      {"feat": {"att": "variant", "val": "읽어요"}}],
            "feat": {"att": "partOfSpeech", "val": "동사"},
            "Sense": {"val": "7", "feat": {"att": "definition", "val": "글을 읽다."}},
            "WordForm": [
                {"feat": [{"att": "type", "val": "발음"},
                          {"att": "pronunciation", "val": "익따"},
                          {"att": "sound", "val": "excluded.wav"}]},
                {"feat": [{"att": "type", "val": "활용"},
                          {"att": "pronunciation", "val": "일거요"}]},
                {"feat": [{"att": "type", "val": "발음"}, {"att": "pronunciation"}]},
            ],
        }
        result = official_record(entry)
        self.assertEqual(result["target"], "읽다")
        self.assertEqual(result["pronunciations"], ["익따"])
        self.assertNotIn("sound", str(result))
        self.assertEqual(result["senses"][0]["id"], "7")
        entry["Sense"]["feat"] = [
            entry["Sense"]["feat"],
            {"att": "syntacticPattern", "val": "N을 읽다"},
            {"att": "syntacticPattern", "val": "N으로 읽다"},
        ]
        entry["WordForm"][0]["feat"].append({"att": "pronunciation", "val": "익ː따"})
        self.assertEqual(official_record(entry)["pronunciations"], ["익따", "익ː따"])
        del entry["WordForm"]
        self.assertEqual(official_record(entry)["pronunciations"], [])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            features([{"att": "type", "val": "a"}, {"att": "type", "val": "b"}])


class KoreanReadingTests(unittest.TestCase):
    def setUp(self):
        self.parent = {
            "id": "ko-nikl-00001", "target": "눈", "source_part_of_speech": "명사",
            "senses": [{"id": "ko-nikl-00001-s001", "korean": "하늘에서 내리는 눈."}],
        }
        self.snow = {
            "official_entry_id": "20", "target": "눈", "source_part_of_speech": "명사",
            "pronunciations": ["눈ː"], "senses": [{"id": "8", "korean": "하늘에서 내리는 눈."}],
        }
        self.eye = {
            **self.snow, "official_entry_id": "10", "pronunciations": ["눈"],
            "senses": [{"id": "1", "korean": "보는 신체 기관."}],
        }

    def output(self, candidates=None, decisions=None):
        return match_readings(
            {"entries": [self.parent]},
            {("눈", "명사"): candidates if candidates is not None else [self.eye, self.snow]},
            decisions if decisions is not None else {},
        )

    def test_homograph_matches_definition_not_first_candidate(self):
        output = self.output()
        entry = output["entries"][self.parent["id"]]
        self.assertEqual(entry["official_entry_id"], "20")
        self.assertEqual(entry["pronunciations"], ["눈ː"])
        self.assertEqual(output["unresolved"], [])
        self.assertEqual(self.parent["senses"][0]["id"], "ko-nikl-00001-s001")

    def test_ambiguous_or_missing_matches_do_not_copy_spelling(self):
        duplicate = {**self.snow, "official_entry_id": "30"}
        for candidates, reason in (
            ([self.eye], "no-exact-match"),
            ([self.snow, duplicate], "ambiguous-exact-match"),
        ):
            with self.subTest(reason=reason):
                output = self.output(candidates)
                self.assertEqual(output["entries"], {})
                self.assertEqual(output["unresolved"][0]["status"], reason)
        no_reading = {**self.snow, "pronunciations": []}
        output = self.output([no_reading])
        self.assertEqual(output["entries"][self.parent["id"]]["pronunciations"], [])
        self.assertEqual(output["unresolved"][0]["status"], "official-text-missing")

    def test_explicit_crosswalk_requires_candidate_and_reason(self):
        changed = deepcopy(self.snow)
        changed["senses"][0]["korean"] += " 정의 개정."
        decision = {self.parent["id"]: {"official_entry_id": "20", "reason": "Definition wording updated."}}
        output = self.output([changed], decision)
        self.assertEqual(output["entries"][self.parent["id"]]["match_method"], "explicit-crosswalk")
        for identifier, reason in (("missing", "Explained."), ("20", "")):
            with self.subTest(identifier=identifier, reason=reason), self.assertRaises(ValueError):
                self.output([changed], {self.parent["id"]: {"official_entry_id": identifier, "reason": reason}})

    def test_manual_crosswalk_cannot_override_exact_homograph_identity(self):
        with self.assertRaisesRegex(ValueError, "conflicts"):
            self.output(decisions={
                self.parent["id"]: {"official_entry_id": "10", "reason": "Wrong meaning."},
            })


if __name__ == "__main__":
    unittest.main()
