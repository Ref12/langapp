"""Audit Chinese curriculum coverage against current and legacy HSK evidence."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.request import Request, urlopen

import pymupdf

from curriculum_yaml import dump_yaml, load_yaml


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CHINESE_ROOT = REPOSITORY_ROOT / "curriculum" / "chinese"
AUDIT_PATH = CHINESE_ROOT / "teaching" / "hsk-audit.yaml"
PROGRAM_PATH = CHINESE_ROOT / "teaching" / "core" / "sequence.yaml"
READINESS_PATH = CHINESE_ROOT / "teaching" / "hsk-readiness.yaml"
GRAMMAR_CROSSWALK_PATH = CHINESE_ROOT / "teaching" / "hsk-grammar-crosswalk.yaml"

COMPLETE_HSK_SOURCE = {
    "id": "complete-hsk-vocabulary",
    "url": (
        "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/"
        "7ac65bf1a6387d35f1ade478906172a19311c7f9/complete.json"
    ),
    "filename": "complete.json",
    "sha256": "c869a0ce353279c9333d9b42c31fc3549785e8b40673dab57ee42bc99cd14131",
}
OFFICIAL_SYLLABUS_SOURCE = {
    "id": "ct-exam-syllabus",
    "url": (
        "https://hsk.cn-bj.ufileos.com/3.0/"
        "%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf"
    ),
    "filename": "new-hsk-syllabus-1219.pdf",
    "sha256": "ec74ce0439e837bbb15154be13e747ae798903b2fd3a331629df6c3b45504941",
    "published": "2025-11",
    "effective": "2026-07",
}
EXPECTED_OFFICIAL_INCREMENTAL_ROWS = (300, 200, 500, 1000, 1600, 1800)
EXPECTED_OFFICIAL_INCREMENTAL_GRAMMAR = (70, 78, 96, 95, 70, 50)
DIGMANDARIN_PAPER_HASHES = {
    "H10901": "68e4e3323c36cf7abbb33b2de23ff5e77e7823975a87bcd7d1a481d65f79f572",
    "H10902": "a6b5768704dd9a6fb00089d9b9ec51272638b9676e14c217d3907b7dded14e50",
    "H11003": "545db964df7983d9033e2adf7d87db8b876269f2a14676bb1fc898bccd985563",
    "H11004": "5b51bde9c9df652d7aa681313aee49dcda92aaa8e1b2f64682246c2a70bc6a07",
    "H11005": "25caf242ea1454e06a088a35b98f63bf1a3427418212c952a487df97cb5a97d7",
    "H20901": "4be2c8d34ba2f871027ed8fff14b8b56223eb4ce91e2f2f7b8627e89163a8730",
    "H20902": "d521dcc882d9d9bfbd75d3668f9393f6be029ed849d775ba23f1ee86530fddbe",
    "H21003": "1ca3c171a64d41ab14f590141cb332499140b7a70d0f179ebc640c0076f3a0e5",
    "H21004": "b59f585ca747051ea9bab1a17e117066d6472e8719162cc3ca362b2d556f86d0",
    "H21005": "cc14d36e39f94f4461ea50b0727b61db29df6fa836a9c77e6f5ee5fa9c004af5",
    "H31001": "f6583e8218bcf85be5ffd6031736742f89d2f30647255552921fa27dff730e91",
    "H31002": "dabdffaa230696ede19ec7fe2e529b2cc972b818918a7b8cf39787a99741820c",
    "H31003": "6cec3066b6f350417a71f047644f46519a6edee0f44eb9aa719d0a7a4ffb6a2f",
    "H31004": "3a718f54277c99d516060a451b3ba9c74161b2dc6ddf528480eb205d19c883fd",
    "H31005": "0dc8e5a2524319a6bb8367d018544fb5c097761b91cce7de8c9d58c1c9f57591",
    "H41001": "042755fa1b306652cb3cd598f8ab07ecabc0927a5947d8529920491e7fbb5610",
    "H41002": "e165085a6e2deb861f37a426eee259f5f6ad27682b388a7f7ee8ab2a92ba7a99",
    "H41003": "c3b5dd23c0c34f3524b059a13be9c5197ea937b8675c27d3af96c8e238cf9204",
    "H41004": "9e8b719a53f77f3941f8ba1b46fec4216a8c939ac62662efca65257f41c3644c",
    "H41005": "7679ee28ddfc5134d13bf9b5ce6388b60c551dda645798bf9356aae3774fea49",
    "H51001": "fdd839fdbc7b9e15d5d9147790780ede869cd3eb0467ab9b9e2e62ea8c15e803",
    "H51002": "a2714c3fa5b84cb976b714c98e7f885b04835c47815650869abc45d10d566e35",
    "H51003": "d90264d9980655784a1213f916599eb6d8345e6f696777c2430485f0f7d37894",
    "H51004": "99b608258adf67a56953b1f999c6c11f9ab5f16f106c91678a7515c8be833067",
    "H51005": "7dce96ac0f6488c84dd8842ae0bf1dc36b45559faa06abaa77eed6a446d978d5",
    "H61001": "f9b01d031867bcd1bc3ad568f17ba8e66368b4e50f60e80ec62c63debc9a0c36",
    "H61002": "da9bccc61d5674ada7a476a8b2b9606f4474fc28a8e6eb7289a3580af058f032",
    "H61003": "409064b01fe9a81cc05f1f7e95b45f0fa47f07a001b276f31c2d1e203829d904",
    "H61004": "1d5e53cdbfe9da04068f1c424cb72202c15cbf2ec08a71f5f0b6a5641aa263e1",
    "H61005": "e74efaf782a52f28a643a1402ead2f712a739261a6009619df310df2a2c2adaa",
}
MANDARIN_MANIA_PAPER_HASHES = {
    "H11329": "f7ad5a5fe70c5366f2bc67015f9929fd70b1b1e24d890d6ff29687356357204e",
    "H11330": "db356ea22313e6abe3ff4e8ad9dc76195dd2ddb5d218819bedf34c7fe96e8c00",
    "H11331": "5733b0487cf91a6d417b926d2ffc5c37afba687dabf876d0052206d37e073351",
    "H11332": "4d8225117110a934bfffb23912bd6af5ddb25e423d6894ac2732d5c9718245e2",
    "H11334": "6159b5d7355592a427a6a6233d75a9b58ea4b20f374075e4fa7b2e36eddbdb16",
    "H21329": "9a977c19b88449602b6ac787143c23abc16e58a0b9d88e40312f7ea62bf9dd92",
    "H21330": "20fd89fc35dadc26f0b664b2438b78e870f2fb1479f95b41d9f62badff3d400e",
    "H21331": "2d88ceb145645e62b999bb18c6f715dda063bf294fb030c51c32dc526bdaae9b",
    "H21332": "3a16d3537b7ac15e03247c06648a2c1dacdb795e551f690ca443e8cadd367fed",
    "H21334": "b51c3cb3ea05d623119d6685e9e6cf69037d39728335c3c11ec90a27f3630f9a",
    "H31327": "0cfe003a43c0a823c07c9ca9719d4daf77c4a2731606d8c14eb3c30f1e2ba209",
    "H31328": "bb2539bbeb2733479c8e36458d0ab781262d8dff2f35d4588122cc00528bc07a",
    "H31329": "c086b922c2b25f06e3d8bcbea744a7557fcbfbce91e98913ff07eeb40f311a62",
    "H31330": "e7581a6566d5094126c0f975991a1edb04f32d78d3ed1a23f50e65d536a7c9ae",
    "H31332": "76d51bdf3d0737fb2bfb874fe98b8c2cf0800d5ad915f0d14474da09d989dec8",
    "H41327": "20c0832ddacf505fa4ea8d5db6e601ba9717e274b4cf93ad1b126f8e54543e85",
    "H41328": "43838b9f9e2542ad4d738da6b4afd9d1c39e0b6d579cb1ce9d33b396ea822d03",
    "H41329": "c394a70c5176720361ce905f65930ffaed232c0612819bfb4eee85868227bb01",
    "H41330": "3a64fc90a0a24d15351a1d71a69e972d98b9b642048c3e05e008746490c85398",
    "H41332": "954d3f20cb83e38c334012d6eea21ddd5b087a87d6325e1454037232ea2d1eaa",
    "H51327": "d50ca3c9fa6028a2b86767c6409c74e1579c02d399531a20bd982b1e460d6942",
    "H51328": "c83e6156801abdc21d9d7f49638d1efcd2398d4b5527e6da8079217b3ba67fd7",
    "H51329": "4beb8f43ac86c512e56eb9ce54128cc2a8313d17c09becea40e5a14ad66da39a",
    "H51330": "33f026c11b4f668750cc32ebcff6a803084e46e4edaf254687135a15c898cef3",
    "H51332": "673a3c1b3c0bb35035680c9075b776f7c522c6309119d7e28bb92cdadff78365",
    "H61327": "26770b22808b2c5963113444d53a943bc222b7888bc7c4e22c073e5d19b3b2c5",
    "H61328": "be744ff7be1e842a80aa5199e8610e06176fd5b255f896fa0994cb39b26017b4",
    "H61329": "89acbe012312933f40845fe1e1915ecf56d1fa24ec4038187065b744c0df8984",
    "H61330": "5f8cac4df1614bf97df342d4ab4192bc36e4c32ac8b3bcdf7bfc2a3778ce1666",
    "H61332": "355b20837ba96ff07d471ec3eec9f6a7b3a2aed8548cf8388e2fce1ca1540b74",
}
PAPER_HASHES = {**DIGMANDARIN_PAPER_HASHES, **MANDARIN_MANIA_PAPER_HASHES}
HAN_RUN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
OFFICIAL_ROW = re.compile(
    r"(?:^|\s)([1-6])(?:（\d+）)?\s+"
    r"([\u3400-\u4dbf\u4e00-\u9fff]+)(?:\d)?\s+(\S+)"
)


def paper_url(identifier):
    if identifier in MANDARIN_MANIA_PAPER_HASHES:
        return (
            f"https://downloads.mandarinmania.com/hsk-{paper_level(identifier)}/"
            f"{identifier}.pdf"
        )
    month = "04" if identifier.endswith(("01", "02", "03")) else "05"
    return f"https://www.digmandarin.com/wp-content/uploads/2022/{month}/{identifier}.pdf"


def paper_level(identifier):
    return int(identifier[1])


def paper_collection(identifier):
    return (
        "mandarinmania-additional"
        if identifier in MANDARIN_MANIA_PAPER_HASHES
        else "digmandarin"
    )


def paper_sections(level):
    return ["listening", "reading"] + (["writing"] if level >= 3 else [])


def digest(values):
    return sha256(
        json.dumps(sorted(values), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def percent(numerator, denominator):
    return round(100 * numerator / denominator, 2) if denominator else 0.0


def curriculum_snapshot(program):
    cumulative_words = set()
    cumulative_grammar = set()
    levels = []
    for phase in program["phases"]:
        phase_levels = phase["levels"]
        for level in phase_levels:
            for unit in level["units"]:
                cumulative_words.update(entry["ch"] for entry in unit["vocabulary"])
                cumulative_grammar.update(entry["id"] for entry in unit["grammar"])
        levels.append({
            "course_levels": [level["number"] for level in phase_levels],
            "headwords": set(cumulative_words),
            "grammar_ids": set(cumulative_grammar),
        })
    if len(levels) != 6:
        raise ValueError("Chinese program must contain six phases for the HSK audit")
    return levels


def parse_official_vocabulary(text):
    end = text.rfind("HSK（一级）认读字")
    if end < 0:
        raise ValueError("Official syllabus text has no HSK character-outline marker")
    start = text.rfind("词汇大纲", 0, end)
    if start < 0:
        raise ValueError("Official syllabus text has no vocabulary-outline marker")
    rows = {level: [] for level in range(1, 7)}
    for line in text[start:end].splitlines():
        for match in OFFICIAL_ROW.finditer(line):
            rows[int(match.group(1))].append(match.group(2))
    return rows


def extract_official_vocabulary(pdf_path):
    document = pymupdf.open(pdf_path)
    rows = {}
    for page_index in range(79, min(214, document.page_count)):
        words = document[page_index].get_text("words")
        serial_words = [
            word for word in words
            if 60 <= word[0] < 125
            and re.fullmatch(r"\d+", word[4])
            and 1 <= int(word[4]) <= 5400
            and 80 < word[1] < 790
        ]
        for serial_word in serial_words:
            same_line = [
                word for word in words if abs(word[1] - serial_word[1]) < 2
            ]
            level_text = "".join(
                word[4] for word in sorted(same_line, key=lambda item: item[0])
                if 125 <= word[0] < 205
            )
            headword = "".join(
                word[4] for word in sorted(same_line, key=lambda item: item[0])
                if 205 <= word[0] < 315
            )
            level_match = re.match(r"([1-6])", level_text)
            if level_match and headword:
                rows[int(serial_word[4])] = (
                    int(level_match.group(1)), re.sub(r"\d+$", "", headword)
                )
    missing = sorted(set(range(1, 5401)) - set(rows))
    if missing:
        raise ValueError(f"Official vocabulary coordinate extraction missed rows: {missing}")
    result = {level: [] for level in range(1, 7)}
    for serial in range(1, 5401):
        level, headword = rows[serial]
        result[level].append(headword)
    expected = list(EXPECTED_OFFICIAL_INCREMENTAL_ROWS)
    actual = [len(result[level]) for level in range(1, 7)]
    if actual != expected:
        raise ValueError(
            f"Official vocabulary level counts {actual} do not match {expected}"
        )
    return result


def practice_content(text, identifier):
    lines = []
    for page in text.split("\f")[1:]:
        if "卷答案" in page:
            break
        for line in page.splitlines():
            compact = re.sub(r"\s+", "", line)
            if re.fullmatch(rf"{identifier}-\d+", compact):
                continue
            if compact in {
                "第一部分", "第二部分", "第三部分", "第四部分",
                "一、听力", "二、阅读", "三、书写",
            }:
                continue
            if any(marker in compact for marker in (
                "卷听力材料", "音乐，", "渐弱", "听力考试现在结束",
                "请选出正确答案", "请选出与所听内容一致的一项",
                "现在开始第", "题是根据下面", "例如：",
            )):
                continue
            lines.append(line)
    return "\n".join(lines)


def tokenize_known_headwords(text, headwords):
    maximum = max(map(len, headwords))
    tokens = []
    unknown = []
    for run in HAN_RUN.findall(text):
        offset = 0
        while offset < len(run):
            for length in range(min(maximum, len(run) - offset), 0, -1):
                token = run[offset:offset + length]
                if token in headwords:
                    tokens.append(token)
                    offset += length
                    break
            else:
                unknown.append(run[offset])
                offset += 1
    return tokens, unknown


def load_grammar_crosswalk(path=GRAMMAR_CROSSWALK_PATH):
    crosswalk = load_yaml(path)
    if not isinstance(crosswalk, dict) or crosswalk.get("schema_version") != 1:
        raise ValueError("HSK grammar crosswalk must use schema_version 1")
    levels = crosswalk.get("levels")
    if not isinstance(levels, list) or len(levels) != 6:
        raise ValueError("HSK grammar crosswalk must contain six levels")
    reviewed_items = set()
    for index, row in enumerate(levels):
        level = index + 1
        expected = EXPECTED_OFFICIAL_INCREMENTAL_GRAMMAR[index]
        if (
            row.get("hsk_level") != level
            or row.get("official_incremental_items") != expected
            or row.get("status") not in {"not-reviewed", "partial", "complete"}
            or not isinstance(row.get("mappings"), list)
        ):
            raise ValueError(f"Invalid HSK grammar crosswalk level {level}")
        for mapping in row["mappings"]:
            if (
                not isinstance(mapping, dict)
                or set(mapping) != {"official_item", "local_ids", "status", "note"}
                or not isinstance(mapping["official_item"], str)
                or not isinstance(mapping["local_ids"], list)
                or not all(isinstance(item, str) for item in mapping["local_ids"])
                or mapping["status"] != "reviewed"
                or not isinstance(mapping["note"], str)
            ):
                raise ValueError(f"Invalid HSK grammar mapping at level {level}")
            if mapping["official_item"] in reviewed_items:
                raise ValueError(
                    f"Duplicate official grammar item {mapping['official_item']}"
                )
            reviewed_items.add(mapping["official_item"])
    expected_status = (
        "complete" if all(row["status"] == "complete" for row in levels)
        else "partial" if reviewed_items else "not-reviewed"
    )
    if crosswalk.get("status") != expected_status:
        raise ValueError("HSK grammar crosswalk summary status is inconsistent")
    return crosswalk


def local_grammar_result(level, grammar_ids, crosswalk):
    expected = {
        f"zh-hsk{band}-g{number:03d}"
        for band in range(1, level + 1)
        for number in range(1, 26)
    }
    rows = crosswalk["levels"][:level]
    mappings = [mapping for row in rows for mapping in row["mappings"]]
    mapped_official = {
        mapping["official_item"] for mapping in mappings
        if mapping.get("status") == "reviewed"
        and set(mapping["local_ids"]) <= grammar_ids
    }
    official_total = sum(EXPECTED_OFFICIAL_INCREMENTAL_GRAMMAR[:level])
    status = (
        "complete" if len(mapped_official) == official_total
        else "partial" if mapped_official else "not-reviewed"
    )
    return {
        "authored_reference_constructs": len(expected),
        "available_by_mapped_cutoff": len(expected & grammar_ids),
        "missing_by_mapped_cutoff": len(expected - grammar_ids),
        "official_cumulative_items": official_total,
        "reviewed_crosswalk_items": len(mapped_official),
        "remaining_unmapped_official_items": official_total - len(mapped_official),
        "official_crosswalk_status": status,
    }


def readiness_result(level, readiness):
    sections = readiness.get("sections", [])
    section = next(
        (row for row in sections if row.get("hsk_level") == level), None
    )
    if section is None:
        raise ValueError(f"HSK readiness section {level} is missing")
    module_ids = [module["id"] for module in section.get("modules", [])]
    skills = section.get("exam", {}).get("skills", [])
    crosswalk = section.get("skill_crosswalk", {})
    gates = section.get("performance_gates", [])
    if set(crosswalk) != set(skills):
        raise ValueError(f"HSK readiness section {level} has a stale skill crosswalk")
    if any(
        row.get("module_id") not in module_ids
        or row.get("status") != "curriculum-support-declared"
        or row.get("performance") != "external-evidence-required"
        for row in crosswalk.values()
    ):
        raise ValueError(f"HSK readiness section {level} has an invalid skill mapping")
    expected_gates = {"current-format", "unseen-mocks", "score-stability", "listening-conditions"}
    if level >= 3:
        expected_gates.add("writing-review")
    if {gate.get("id") for gate in gates} != expected_gates:
        raise ValueError(f"HSK readiness section {level} has incomplete performance gates")
    return {
        "declared_exam_skills": skills,
        "skill_crosswalk": crosswalk,
        "skill_crosswalk_status": "complete-for-curriculum-support",
        "performance_gates_declared": len(gates),
        "performance_status": "not-assessed",
    }


def coverage_result(words, mapped_words, full_words, expected_rows=None):
    mapped = sum(word in mapped_words for word in words)
    full = sum(word in full_words for word in words)
    result = {
        "audited_rows": len(words),
        "mapped_covered_rows": mapped,
        "full_curriculum_covered_rows": full,
    }
    if expected_rows is None:
        result.update({
            "mapped_coverage_percent": percent(mapped, len(words)),
            "full_curriculum_coverage_percent": percent(full, len(words)),
        })
    else:
        unresolved = expected_rows - len(words)
        if unresolved < 0:
            raise ValueError("Extracted more official vocabulary rows than expected")
        result.update({
            "expected_rows": expected_rows,
            "unresolved_extraction_rows": unresolved,
            "mapped_coverage_lower_percent": percent(mapped, expected_rows),
            "mapped_coverage_upper_percent": percent(mapped + unresolved, expected_rows),
            "full_curriculum_coverage_lower_percent": percent(full, expected_rows),
            "full_curriculum_coverage_upper_percent": percent(full + unresolved, expected_rows),
        })
    return result


def ensure_file(directory, source, download):
    path = directory / source["filename"]
    if not path.exists():
        if not download:
            raise ValueError(f"Missing {path}; rerun with --download")
        request = Request(source["url"], headers={"User-Agent": "langapp-hsk-audit/1"})
        with urlopen(request) as response:
            path.write_bytes(response.read())
    actual = sha256(path.read_bytes()).hexdigest()
    if actual != source["sha256"]:
        raise ValueError(
            f"{path.name}: SHA-256 {actual} does not match pinned {source['sha256']}"
        )
    return path


def extract_pdf(pdf_path):
    executable = shutil.which("pdftotext")
    if executable is None:
        raise ValueError("pdftotext is required to refresh the HSK audit")
    text_path = pdf_path.with_suffix(".txt")
    completed = subprocess.run(
        [executable, "-q", "-layout", "-enc", "UTF-8", str(pdf_path), str(text_path)],
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        raise ValueError(
            f"pdftotext failed for {pdf_path.name}: "
            f"{completed.stderr.decode(errors='replace').strip()}"
        )
    return text_path.read_text(encoding="utf-8")


def refresh_report(materials_dir, download=False):
    materials_dir.mkdir(parents=True, exist_ok=True)
    program = load_yaml(PROGRAM_PATH)
    readiness = load_yaml(READINESS_PATH)
    grammar_crosswalk = load_grammar_crosswalk()
    snapshots = curriculum_snapshot(program)
    full_words = snapshots[-1]["headwords"]

    complete_path = ensure_file(materials_dir, COMPLETE_HSK_SOURCE, download)
    complete = json.loads(complete_path.read_text(encoding="utf-8"))
    legacy_incremental = {
        level: {
            row["simplified"]
            for row in complete
            if f"old-{level}" in row.get("level", [])
        }
        for level in range(1, 7)
    }

    official_path = ensure_file(materials_dir, OFFICIAL_SYLLABUS_SOURCE, download)
    official_rows = extract_official_vocabulary(official_path)

    paper_sources = []
    paper_text = {}
    for identifier, expected_hash in PAPER_HASHES.items():
        source = {
            "id": identifier,
            "url": paper_url(identifier),
            "filename": f"{identifier}.pdf",
            "sha256": expected_hash,
        }
        pdf_path = ensure_file(materials_dir, source, download)
        paper_text[identifier] = extract_pdf(pdf_path)
        level = paper_level(identifier)
        paper_sources.append({
            "id": identifier,
            "hsk_level": level,
            "collection_id": paper_collection(identifier),
            "url": source["url"],
            "sha256": expected_hash,
            "format": "pdf",
            "format_generation": "legacy-six-level",
            "pages": pymupdf.open(pdf_path).page_count,
            "sections": paper_sections(level),
            "license_status": "no-open-redistribution-license-identified",
            "retained": "metadata-and-non-substitutive-coverage-summary-only",
        })

    results = []
    cumulative_official = []
    cumulative_legacy = set()
    expected_cumulative = 0
    for level in range(1, 7):
        snapshot = snapshots[level - 1]
        cumulative_official.extend(official_rows[level])
        cumulative_legacy.update(legacy_incremental[level])
        expected_cumulative += EXPECTED_OFFICIAL_INCREMENTAL_ROWS[level - 1]

        observed_tokens = []
        unknown = []
        identifiers = [
            identifier for identifier in PAPER_HASHES
            if paper_level(identifier) == level
        ]
        for identifier in identifiers:
            tokens, unmatched = tokenize_known_headwords(
                practice_content(paper_text[identifier], identifier),
                cumulative_legacy,
            )
            observed_tokens.extend(tokens)
            unknown.extend(unmatched)
        observed = sorted(set(observed_tokens))

        official = coverage_result(
            cumulative_official,
            snapshot["headwords"],
            full_words,
            expected_rows=expected_cumulative,
        )
        official["missing_by_mapped_cutoff_examples"] = sorted(
            set(cumulative_official) - snapshot["headwords"]
        )[:20]
        official["missing_from_full_curriculum_examples"] = sorted(
            set(cumulative_official) - full_words
        )[:20]

        legacy = coverage_result(
            sorted(cumulative_legacy), snapshot["headwords"], full_words
        )
        legacy["normalized_reference_headwords"] = legacy.pop("audited_rows")

        practice = coverage_result(observed, snapshot["headwords"], full_words)
        practice["paper_ids"] = identifiers
        practice["paper_count"] = len(identifiers)
        practice["collection_ids"] = sorted({
            paper_collection(identifier) for identifier in identifiers
        })
        practice["observed_unique_legacy_headwords"] = practice.pop("audited_rows")
        practice["recognized_headword_occurrences"] = len(observed_tokens)
        practice["unmatched_han_character_occurrences"] = len(unknown)
        practice["unmatched_unique_han_characters"] = len(set(unknown))
        practice["missing_by_mapped_cutoff_examples"] = sorted(
            set(observed) - snapshot["headwords"]
        )[:20]
        practice["missing_from_full_curriculum_examples"] = sorted(
            set(observed) - full_words
        )[:20]

        results.append({
            "hsk_level": level,
            "course_levels": snapshot["course_levels"],
            "curriculum": {
                "cumulative_headwords": len(snapshot["headwords"]),
                "headword_sha256": digest(snapshot["headwords"]),
                "cumulative_grammar_constructs": len(snapshot["grammar_ids"]),
                "grammar_sha256": digest(snapshot["grammar_ids"]),
            },
            "official_2026_vocabulary": official,
            "legacy_six_level_vocabulary": legacy,
            "practice_exam_vocabulary": practice,
            "grammar": local_grammar_result(
                level, snapshot["grammar_ids"], grammar_crosswalk,
            ),
            "skills_and_performance": readiness_result(level, readiness),
            "gates": {
                "official_vocabulary": (
                    "passed" if official["mapped_covered_rows"] == expected_cumulative
                    else "blocked"
                ),
                "practice_vocabulary": (
                    "passed"
                    if practice["mapped_covered_rows"]
                    == practice["observed_unique_legacy_headwords"]
                    else "blocked"
                ),
                "grammar_crosswalk": (
                    "passed"
                    if local_grammar_result(
                        level, snapshot["grammar_ids"], grammar_crosswalk,
                    )["official_crosswalk_status"] == "complete"
                    else "blocked"
                ),
                "timed_unseen_mock_performance": "not-assessed",
                "listening_audio_performance": "not-assessed",
                "writing_performance": "not-applicable" if level < 3 else "not-assessed",
            },
            "verdict": "not-demonstrated",
        })

    return {
        "schema_version": 2,
        "id": "zh-hsk-curriculum-audit",
        "audited_on": "2026-09-16",
        "claim": "HSK exams can be passed using only knowledge available in the Chinese curriculum.",
        "conclusion": "unsupported",
        "reason": (
            "The cumulative curriculum now contains every official HSK 1-6 vocabulary row "
            "and every recognized legacy-list headword in the audited papers by its cutoff, "
            "but the official grammar crosswalk and learner performance gates are not complete."
        ),
        "cutoff_semantics": (
            "For HSK level N, knowledge available by the cutoff is the union of all vocabulary "
            "and grammar introduced in the mapped course levels through that section. Official "
            "vocabulary rows and recognized practice-paper headwords must be present by that "
            "cutoff; later levels and optional branches do not count."
        ),
        "method": {
            "official_vocabulary": (
                "Read all 5,400 numbered vocabulary rows from the official November 2025 "
                "syllabus PDF, effective July 2026, using page coordinates and verify the "
                "published 300/200/500/1000/1600/1800 incremental counts."
            ),
            "legacy_vocabulary": (
                "Use old-1 through old-6 labels from the pinned Complete HSK Vocabulary "
                "dataset as a normalized legacy six-level reference."
            ),
            "practice_papers": (
                "Extract question, option, listening-transcript, and writing-source text "
                "from five DigMandarin PDFs and five additional Mandarin Mania PDFs per "
                "level. Longest-match segmentation uses only the cumulative legacy "
                "reference lexicon. No paper or transcript is checked in."
            ),
            "grammar": (
                "Count locally authored HSK-labelled constructs and compare the explicit "
                "crosswalk status with the 459 official HSK 1-6 grammar items. Candidate "
                "similarity is not counted as coverage without reviewed item mappings."
            ),
            "skills_and_performance": (
                "Verify that readiness sections name the tested skills and explicit external "
                "performance gates. Curriculum inventory coverage never substitutes for "
                "timed listening, reading, writing, scoring, or learner evidence."
            ),
        },
        "sources": {
            "official_syllabus": {
                key: OFFICIAL_SYLLABUS_SOURCE[key]
                for key in ("id", "url", "sha256", "published", "effective")
            },
            "legacy_vocabulary": {
                key: COMPLETE_HSK_SOURCE[key]
                for key in ("id", "url", "sha256")
            },
            "grammar_crosswalk": {
                "path": "teaching/hsk-grammar-crosswalk.yaml",
                "official_incremental_items": list(
                    EXPECTED_OFFICIAL_INCREMENTAL_GRAMMAR
                ),
                "status": grammar_crosswalk["status"],
            },
            "practice_collections": [
                {
                    "id": "digmandarin",
                    "url": "https://www.digmandarin.com/hsk-practice-test",
                    "retrieved_on": "2026-09-16",
                    "license_status": "no-open-redistribution-license-identified",
                    "paper_ids": list(DIGMANDARIN_PAPER_HASHES),
                },
                {
                    "id": "mandarinmania-additional",
                    "url": "https://mandarinmania.com/hsk-sample-tests/",
                    "institutional_mirror": (
                        "https://www.confuciusinstitute.manchester.ac.uk/"
                        "study/testing/hsk/hsk-learning-resources/"
                    ),
                    "retrieved_on": "2026-09-16",
                    "license_status": "no-open-redistribution-license-identified",
                    "paper_ids": list(MANDARIN_MANIA_PAPER_HASHES),
                },
            ],
            "practice_papers": {
                "papers": paper_sources,
            },
            "official_mock_platform": {
                "id": "hsk-mock",
                "url": "https://hskmock.com/",
                "retrieved_on": "2026-09-16",
                "use": "External timed performance evidence only; no test content retained.",
            },
        },
        "results": results,
        "overall_gates": {
            "source_integrity": "passed",
            "official_vocabulary_at_every_cutoff": "passed",
            "practice_vocabulary_at_every_cutoff": "passed",
            "official_grammar_crosswalk": "blocked",
            "timed_unseen_mock_performance": "not-assessed",
            "listening_audio_performance": "not-assessed",
            "writing_performance": "not-assessed",
            "current_format_confirmation_before_exam": "required",
        },
        "limitations": [
            "Coverage is inventory containment, not evidence that a learner has mastered the material.",
            "The official vocabulary extraction verifies all 5,400 numbered rows, but matching a headword cannot prove control of every listed part of speech or sense.",
            "All 60 practice papers use the legacy six-level format, not the July 2026 syllabus.",
            "Longest-match segmentation can miss unknown compounds or proper names and cannot determine the intended sense.",
            "PDF transcripts cover linguistic content but not audio speed, accent, noise, or listening performance.",
            "No automatic surface-text method can prove grammar coverage; reviewed item-level official grammar mappings remain incomplete.",
            "Passing also depends on task strategy, timing, comprehension, writing, and the learner's demonstrated performance.",
            "The external papers have no identified open redistribution license, so only URLs, retrieval dates, hashes, metadata, and aggregate non-substitutive coverage summaries are retained.",
        ],
    }


def validate_checked_in_audit(chinese_root=CHINESE_ROOT):
    errors = []
    path = chinese_root / "teaching" / "hsk-audit.yaml"
    try:
        audit = load_yaml(path)
        program = load_yaml(chinese_root / "teaching" / "core" / "sequence.yaml")
        readiness = load_yaml(chinese_root / "teaching" / "hsk-readiness.yaml")
        crosswalk = load_grammar_crosswalk(
            chinese_root / "teaching" / "hsk-grammar-crosswalk.yaml"
        )
    except (OSError, ValueError) as exc:
        return [str(exc)]
    if not isinstance(audit, dict):
        return [f"{path}: expected a YAML object"]
    if audit.get("schema_version") != 2:
        errors.append("schema_version must be 2")
    if audit.get("conclusion") != "unsupported":
        errors.append("conclusion must remain unsupported until every evidence gate passes")
    results = audit.get("results")
    if not isinstance(results, list) or len(results) != 6:
        return errors + ["results must contain HSK 1 through HSK 6"]
    try:
        snapshots = curriculum_snapshot(program)
    except (KeyError, TypeError, ValueError) as exc:
        return errors + [str(exc)]
    expected_source = audit.get("sources", {}).get("official_syllabus", {})
    for key in ("url", "sha256", "published", "effective"):
        if expected_source.get(key) != OFFICIAL_SYLLABUS_SOURCE[key]:
            errors.append(f"official_syllabus.{key} does not match the pinned audit source")
    legacy_source = audit.get("sources", {}).get("legacy_vocabulary", {})
    for key in ("url", "sha256"):
        if legacy_source.get(key) != COMPLETE_HSK_SOURCE[key]:
            errors.append(f"legacy_vocabulary.{key} does not match the pinned audit source")
    practice_sources = audit.get("sources", {})
    collections = practice_sources.get("practice_collections", [])
    if (
        not isinstance(collections, list)
        or {row.get("id") for row in collections}
        != {"digmandarin", "mandarinmania-additional"}
        or any(
            row.get("license_status")
            != "no-open-redistribution-license-identified"
            for row in collections
        )
    ):
        errors.append("practice_collections must record both non-redistributable sources")
    papers = practice_sources.get("practice_papers", {}).get("papers", [])
    if not isinstance(papers, list) or len(papers) != len(PAPER_HASHES):
        errors.append("practice_papers must contain all 60 pinned papers")
    else:
        for paper, (identifier, expected_hash) in zip(papers, PAPER_HASHES.items()):
            level = paper_level(identifier)
            expected = {
                "id": identifier,
                "hsk_level": level,
                "collection_id": paper_collection(identifier),
                "url": paper_url(identifier),
                "sha256": expected_hash,
                "format": "pdf",
                "format_generation": "legacy-six-level",
                "sections": paper_sections(level),
                "license_status": "no-open-redistribution-license-identified",
                "retained": "metadata-and-non-substitutive-coverage-summary-only",
            }
            for key, value in expected.items():
                if paper.get(key) != value:
                    errors.append(f"practice paper {identifier}.{key} is stale")
            if type(paper.get("pages")) is not int or paper["pages"] <= 0:
                errors.append(f"practice paper {identifier}.pages is invalid")
    gates = audit.get("overall_gates", {})
    if (
        gates.get("official_vocabulary_at_every_cutoff") != "passed"
        or gates.get("practice_vocabulary_at_every_cutoff") != "passed"
        or gates.get("official_grammar_crosswalk") != "blocked"
        or gates.get("timed_unseen_mock_performance") != "not-assessed"
    ):
        errors.append("overall_gates must conservatively separate inventory and performance")
    for index, result in enumerate(results):
        level = index + 1
        snapshot = snapshots[index]
        location = f"results[{index}]"
        if result.get("hsk_level") != level:
            errors.append(f"{location}.hsk_level must be {level}")
        if result.get("course_levels") != snapshot["course_levels"]:
            errors.append(f"{location}.course_levels is stale")
        curriculum = result.get("curriculum", {})
        expected_curriculum = {
            "cumulative_headwords": len(snapshot["headwords"]),
            "headword_sha256": digest(snapshot["headwords"]),
            "cumulative_grammar_constructs": len(snapshot["grammar_ids"]),
            "grammar_sha256": digest(snapshot["grammar_ids"]),
        }
        if curriculum != expected_curriculum:
            errors.append(f"{location}.curriculum is stale")
        official = result.get("official_2026_vocabulary", {})
        expected_rows = sum(EXPECTED_OFFICIAL_INCREMENTAL_ROWS[:level])
        audited_rows = official.get("audited_rows")
        unresolved = official.get("unresolved_extraction_rows")
        if (official.get("expected_rows") != expected_rows
                or not isinstance(audited_rows, int)
                or unresolved != expected_rows - audited_rows):
            errors.append(f"{location}.official_2026_vocabulary row counts are inconsistent")
        else:
            for prefix in ("mapped", "full_curriculum"):
                covered = official.get(f"{prefix}_covered_rows")
                lower = official.get(f"{prefix}_coverage_lower_percent")
                upper = official.get(f"{prefix}_coverage_upper_percent")
                if (not isinstance(covered, int)
                        or lower != percent(covered, expected_rows)
                        or upper != percent(covered + unresolved, expected_rows)):
                    errors.append(
                        f"{location}.official_2026_vocabulary {prefix} coverage is inconsistent"
                    )
        if (
            official.get("audited_rows") != expected_rows
            or official.get("unresolved_extraction_rows") != 0
            or official.get("mapped_covered_rows") != expected_rows
            or official.get("mapped_coverage_lower_percent") != 100.0
            or official.get("mapped_coverage_upper_percent") != 100.0
        ):
            errors.append(f"{location} must cover every official vocabulary row")
        legacy = result.get("legacy_six_level_vocabulary", {})
        legacy_total = legacy.get("normalized_reference_headwords")
        if isinstance(legacy_total, int):
            for prefix in ("mapped", "full_curriculum"):
                covered = legacy.get(f"{prefix}_covered_rows")
                coverage = legacy.get(f"{prefix}_coverage_percent")
                if not isinstance(covered, int) or coverage != percent(covered, legacy_total):
                    errors.append(
                        f"{location}.legacy_six_level_vocabulary "
                        f"{prefix} coverage is inconsistent"
                    )
        else:
            errors.append(f"{location}.legacy_six_level_vocabulary total is invalid")
        practice_result = result.get("practice_exam_vocabulary", {})
        paper_ids = practice_result.get("paper_ids")
        if paper_ids != [
            identifier for identifier in PAPER_HASHES
            if paper_level(identifier) == level
        ]:
            errors.append(f"{location}.practice_exam_vocabulary.paper_ids is stale")
        if practice_result.get("paper_count") != 10:
            errors.append(f"{location}.practice_exam_vocabulary must use ten papers")
        if practice_result.get("collection_ids") != [
            "digmandarin", "mandarinmania-additional"
        ]:
            errors.append(f"{location}.practice_exam_vocabulary collections are stale")
        practice_total = practice_result.get("observed_unique_legacy_headwords")
        if isinstance(practice_total, int):
            for prefix in ("mapped", "full_curriculum"):
                covered = practice_result.get(f"{prefix}_covered_rows")
                coverage = practice_result.get(f"{prefix}_coverage_percent")
                if not isinstance(covered, int) or coverage != percent(covered, practice_total):
                    errors.append(
                        f"{location}.practice_exam_vocabulary "
                        f"{prefix} coverage is inconsistent"
                    )
            if practice_result.get("mapped_covered_rows") != practice_total:
                errors.append(
                    f"{location}.practice_exam_vocabulary has a cutoff vocabulary gap"
                )
        else:
            errors.append(f"{location}.practice_exam_vocabulary total is invalid")
        grammar = result.get("grammar", {})
        if grammar != local_grammar_result(level, snapshot["grammar_ids"], crosswalk):
            errors.append(f"{location}.grammar is stale")
        skills = result.get("skills_and_performance", {})
        try:
            expected_skills = readiness_result(level, readiness)
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(str(exc))
            expected_skills = None
        if skills != expected_skills:
            errors.append(f"{location}.skills_and_performance is stale")
        result_gates = result.get("gates", {})
        if (
            result_gates.get("official_vocabulary") != "passed"
            or result_gates.get("practice_vocabulary") != "passed"
            or result_gates.get("grammar_crosswalk") != "blocked"
            or result_gates.get("timed_unseen_mock_performance") != "not-assessed"
        ):
            errors.append(f"{location}.gates are not conservative")
        if result.get("verdict") != "not-demonstrated":
            errors.append(f"{location}.verdict must be not-demonstrated")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--check", action="store_true", help="Validate the checked-in audit.")
    action.add_argument("--refresh", action="store_true", help="Recompute the audit from source files.")
    parser.add_argument("--materials-dir", type=Path,
                        help="Directory containing or receiving downloaded audit sources.")
    parser.add_argument("--download", action="store_true",
                        help="Download missing source files when refreshing.")
    parser.add_argument("--write", action="store_true",
                        help="Write the refreshed report to curriculum/chinese/teaching.")
    args = parser.parse_args()

    if args.refresh:
        if args.materials_dir is None:
            parser.error("--refresh requires --materials-dir")
        try:
            report = refresh_report(args.materials_dir.resolve(), args.download)
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        output = dump_yaml(report)
        if args.write:
            AUDIT_PATH.write_text(output, encoding="utf-8")
            print(f"Wrote {AUDIT_PATH}")
        else:
            sys.stdout.write(output)
        return 0

    errors = validate_checked_in_audit()
    if errors:
        for error in errors:
            print(f"ERROR: {AUDIT_PATH}: {error}", file=sys.stderr)
        return 1
    print("HSK readiness audit is current; pass claim remains unsupported.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
