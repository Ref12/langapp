"""Reproduce the Chinese vocabulary and authored grammar as YAML.

Run from the repository root: python scripts\\import_chinese_curriculum.py
Install dependencies from scripts/requirements.txt first.
The pinned upstream download is verified before any outputs are replaced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.request

from curriculum_yaml import dump_yaml, load_yaml
from generate_curriculum_tokens import compact_outputs


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
REVISION = "7ac65bf1a6387d35f1ade478906172a19311c7f9"
URL = f"https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/{REVISION}/complete.json"
SHA256 = "c869a0ce353279c9333d9b42c31fc3549785e8b40673dab57ee42bc99cd14131"
EXPECTED = {"1": 506, "2": 750, "3": 953, "4": 972, "5": 1059, "6": 1123, "7-9": 5606}
CJK = re.compile(r"[\u3400-\u9fff]+")
REFERENCE = re.compile(r"^(?:(?:[\w-]+\s+)*variant of|see\b|abbr\.?\s+for)", re.I)
REFERENCE_LEAD = re.compile(
    r"^(?:variant of|see\b|abbr(?:eviation)?\.?\s+(?:of|for|to)|"
    r"short (?:form|name) (?:of|for)|short for|same as|also written|"
    r"alternate writing of|equivalent (?:of|to)|used (?:in|for)|"
    r"bound form having the same meaning|colloquial reading|Taiwan pr\.)",
    re.I,
)

# Original corrections repair reference-only and misleading headword records.
# A few upstream references are truncated and would resolve to the wrong word.
GLOSS_CORRECTIONS = {
    "纯朴": "simple and honest; unpretentious",
    "得意扬扬": "looking very pleased with oneself; triumphant",
    "干吗": "why; what for; what are you doing",
    "火暴": "fiery; hot-tempered; extremely lively",
    "纪录": "a record, especially a best achievement",
    "老头儿": "old man; elderly man (informal)",
    "水灵灵": "fresh and juicy; bright and full of vitality",
    "体检": "medical examination; physical checkup",
    "无可厚非": "not deserving of serious criticism; understandable",
    "下功夫": "to put in effort; to work hard at something",
    "效仿": "to imitate; to follow the example of",
    "抑扬顿挫": "rhythmic variations in pitch and cadence",
    "做证": "to testify; to bear witness",
    "呀": "sentence particle expressing surprise, emphasis or a softened tone",
    "一块儿": "together; in the same place; at the same time",
    "快点儿": "hurry up; a little faster",
    "大厦": "large building; mansion; high-rise building",
}
SENSE_CORRECTIONS = {
    "same as": "equal; identical",
    "the same as": "the same; identical",
    "equivalent to 就: then": "then; in that case",
    "dry measure for grain equal to ten 升 or one-tenth of a 石": "traditional dry measure for grain",
    "measure for dry grain equal to one-tenth of sheng 升 or liter, or one-hundredth dou 斗": "traditional grain measure, approximately one-tenth of a liter",
    "measure for dry grain equal to one-tenth dou 斗": "traditional grain measure, approximately one liter",
    "unit of volume equal to 12 斗 and 8 升, approx 128 liters": "traditional unit of volume, approximately 128 liters",
    "old unit of distance equal to 10 丈, one-thirtieth of a km or 33.33 meters": "old unit of distance, approximately 33.33 meters",
    "particle similar to 把 in 管...叫 constructions": "object-marking particle used in constructions meaning to call someone or something by a name",
    "sentence-final particle, contraction of 了啊, indicating exclamation": "sentence-final particle indicating exclamation",
    "used with numeral 一: classifier for scenario, scene, feeling, atmosphere, sound etc": "classifier for a scene, feeling, atmosphere or sound",
    "replaces 啊 when following the vowel \"u\" or \"ao\"": "sentence-final particle expressing exclamation or emphasis after certain vowel sounds",
    "(literary) particle having functions similar to 啊": "(literary) sentence-final particle expressing exclamation or emphasis",
    "classical final particle, similar to modern 了": "classical sentence-final particle marking completion or a change of state",
    "the head of an institution whose name ends in 院": "head of an institution such as a college, institute or hospital",
    "(suffix) -ation, -tion etc, as in 用, inhibition": "suffix forming nouns of processes or effects, roughly corresponding to -ation or -tion",
    "与其 A 如 B (rather than A, better to B)": "rather than doing A, it is better to do B",
}
TOPICS = {
    "people-and-relationships": r"\b(family|mother|father|child|friend|marry|husband|wife|sister|brother)\b",
    "food-and-shopping": r"\b(food|eat|drink|rice|tea|restaurant|shop|buy|sell|price|fruit|vegetable)\b",
    "time-and-quantity": r"\b(time|day|month|year|hour|minute|number|hundred|thousand|week)\b",
    "travel-and-places": r"\b(travel|road|train|bus|city|country|airport|hotel|river|mountain|direction)\b",
    "study-and-work": r"\b(study|school|student|teach|learn|work|job|office|company|examination|book)\b",
    "health-and-body": r"\b(health|body|doctor|hospital|illness|disease|medicine|pain|eye|hand|head)\b",
    "society-and-public-life": r"\b(law|government|politic|society|public|economic|economy|culture|history)\b",
    "nature-and-technology": r"\b(nature|weather|rain|wind|animal|plant|computer|science|technology|electric)\b",
    "thought-and-communication": r"\b(think|idea|opinion|say|speak|language|meaning|feel|emotion|explain)\b",
}


def remove_reference_parentheses(gloss: str) -> str:
    """Remove whole balanced annotations, including nested parentheses."""
    spans, start, depth = [], None, 0
    for index, character in enumerate(gloss):
        if character == "(":
            if depth == 0:
                start = index
            depth += 1
        elif character == ")" and depth:
            depth -= 1
            if depth == 0 and CJK.search(gloss[start:index + 1]):
                spans.append((start, index + 1))
    for start, end in reversed(spans):
        gloss = gloss[:start] + gloss[end:]
    return gloss


def clean_gloss(gloss: str) -> str:
    if gloss in SENSE_CORRECTIONS:
        return SENSE_CORRECTIONS[gloss]
    had_reference = bool(CJK.search(gloss))
    gloss = remove_reference_parentheses(gloss)
    lead = re.sub(r"^(?:\([^()]*\)\s*)+", "", gloss).strip()
    if not gloss.strip():
        return ""
    if CJK.search(gloss) and (REFERENCE_LEAD.match(lead) or REFERENCE.match(lead)):
        # A trailing English definition can stand without its Chinese reference.
        english_tail = re.search(r"[\u3400-\u9fff][^A-Za-z]*[,;:]\s*([A-Za-z][^\u3400-\u9fff]+)$", gloss)
        if not english_tail:
            return ""
        cleaned = clean_gloss(english_tail.group(1))
        tags = re.match(r"^(?:\([^()]*\)\s*)+", gloss)
        return ((tags.group(0) if tags else "") + cleaned).strip() if cleaned else ""
    if REFERENCE.match(lead):
        return ""
    if re.fullmatch(r"\(?(?:used in (?:place )?names|phonetic)\)?", lead or gloss, re.I):
        return ""
    if re.match(r"^(?:Example:|opposite:|Kangxi radical \d+$)", lead, re.I):
        return ""
    # Remove examples/aliases and reference-dependent trailing clauses as units.
    gloss = re.sub(r",?\s*(?:e\.g\.(?:\s+see)?|occurring in|ranked below|aka)\s+[^;]*[\u3400-\u9fff][^;]*", "", gloss, flags=re.I)
    gloss = re.sub(r"\[[^\]]*\]", "", gloss)
    gloss = CJK.sub("", gloss)
    gloss = re.sub(r"\s+([,;:])", r"\1", gloss)
    gloss = re.sub(r"\s+", " ", gloss).strip(" ,;:/")
    if re.fullmatch(r"(?:used in(?: and)*|short for|abbr\.? (?:of|for|to)|equivalent of|alternate writing of)", gloss, re.I):
        return ""
    if had_reference and gloss.lower() in {"also", "same as", "equivalent to"}:
        return ""
    return gloss if re.search(r"[A-Za-z]{2}", gloss) else ""


def check_normalizer() -> None:
    cases = {
        "used in 吗啡": "",
        "used in 防 and 溜": "",
        "(Tw) used in 夹生": "",
        "short for 体格检查": "",
        "abbr. of 沧海桑田": "",
        "equivalent of 在于": "",
        "alternate writing of 跩": "",
        "same as 出头": "",
        "(used in place names)": "",
        "supermarket (abbr. for 超级市场)": "supermarket",
        "no matter how ... (usually followed by (a verb and) 也)": "no matter how ...",
        "(Tw) variant of 挡, gear": "(Tw) gear",
        "to see": "to see",
        "to see a doctor": "to see a doctor",
        "never (if used in negative sentence)": "never (if used in negative sentence)",
        "also": "also",
        "equivalent to": "equivalent to",
        "(indicating a fraction)": "(indicating a fraction)",
    }
    for source, expected in cases.items():
        if clean_gloss(source) != expected:
            raise ValueError(f"Gloss normalization regression for {source!r}")


def normalization_report(data: list[dict]) -> dict:
    examined = omitted = rewritten = forms_omitted = reading_options_omitted = repairs = 0
    for entry in data:
        if not any(level.startswith("new-") for level in entry["level"]):
            continue
        original_readings, kept_readings = set(), set()
        for form in entry["forms"]:
            reading = form["transcriptions"]["pinyin"].strip()
            original_readings.add(reading)
            normalized = []
            for original in form["meanings"]:
                examined += 1
                cleaned = clean_gloss(original)
                if not cleaned:
                    omitted += 1
                elif cleaned != original:
                    rewritten += 1
                if original in SENSE_CORRECTIONS:
                    repairs += 1
                normalized.append(cleaned)
            if entry["simplified"] in GLOSS_CORRECTIONS or any(normalized):
                kept_readings.add(reading)
            else:
                forms_omitted += 1
        reading_options_omitted += len(original_readings - kept_readings)
    return {
        "source_id": "zh-vocab-adapted",
        "source_revision": REVISION,
        "examined_source_senses": examined,
        "excluded_source_senses_before_headword_overrides": omitted,
        "normalized_nonempty_source_senses": rewritten,
        "excluded_source_forms_without_standalone_gloss": forms_omitted,
        "excluded_distinct_headword_reading_options": reading_options_omitted,
        "headword_gloss_overrides": len(GLOSS_CORRECTIONS),
        "sense_rewrite_rules": len(SENSE_CORRECTIONS),
        "sense_rewrite_rule_applications": repairs,
        "method": "All imported senses processed; balanced reference annotations removed; reference-only senses and empty reading groups omitted; standalone English tails preserved; explicit semantic repairs recorded in importer.",
        "limitation": "A normalization audit, not independent certification of every dictionary sense or pronunciation.",
    }


def pronunciation_note(english: str) -> bool:
    return bool(re.fullmatch(
        r"(?:(?:also|Taiwan) pr\.[^;()]*|\(Taiwan pr\.[^()]*\))",
        english,
    ))


def vocabulary_senses(entry: dict, headword_id: str) -> list[dict]:
    """Keep upstream meaning boundaries, not the semicolons joining synonyms."""
    senses = []
    seen = set()
    for form in entry["forms"]:
        reading = form["transcriptions"]["pinyin"].strip()
        meanings = (
            [GLOSS_CORRECTIONS[entry["simplified"]]]
            if entry["simplified"] in GLOSS_CORRECTIONS
            else form["meanings"]
        )
        for meaning in meanings:
            english = clean_gloss(meaning)
            key = (reading, english)
            if not reading or not english or key in seen:
                continue
            seen.add(key)
            senses.append({
                "id": f"{headword_id}-s{len(senses) + 1:03d}",
                "reading": reading,
                "english": english,
            })
    # Keep source-derived ID slots; pronunciation annotations are not meanings.
    return [sense for sense in senses if not pronunciation_note(sense["english"])]


def vocabulary(data: list[dict]) -> dict[str, list[dict]]:
    rows = {level: [] for level in EXPECTED}
    seen = set()
    for entry_index, entry in enumerate(data):
        levels = [level for level in entry["level"] if level.startswith("new-")]
        if not levels:
            continue
        if len(levels) != 1 or entry["simplified"] in seen:
            raise ValueError("Unexpected cumulative or duplicate upstream entry")
        target = entry["simplified"]
        seen.add(target)
        level = levels[0].removeprefix("new-")
        level = "7-9" if level == "7" else level
        readings, senses = [], []
        for form in entry["forms"]:
            reading = form["transcriptions"]["pinyin"].strip()
            meanings = list(dict.fromkeys(filter(None, map(clean_gloss, form["meanings"]))))
            if target in GLOSS_CORRECTIONS:
                meanings = [GLOSS_CORRECTIONS[target]]
            if reading and meanings:
                gloss = "; ".join(meanings)
                if (reading, gloss) not in senses:
                    senses.append((reading, gloss))
                    if reading not in readings:
                        readings.append(reading)
        if not senses:
            raise ValueError(f"No translated sense for upstream entry {entry_index}")
        english = " / ".join(f"[{reading}] {gloss}" for reading, gloss in senses)
        topics = [topic for topic, expression in TOPICS.items() if re.search(expression, english, re.I)]
        number = len(rows[level]) + 1
        rows[level].append({
            "id": f"zh-hsk{level}-{number:05d}",
            "target": target,
            "reading": " / ".join(readings),
            "english": english,
            "part_of_speech": "",
            "topic": ";".join(topics) or "general-and-abstract",
            "source_id": "zh-vocab-adapted",
            "source_entry": f"{URL}#/{entry_index}",
            "level_basis": f"2021-standard-derived upstream {levels[0]}; not 2025 exam",
        })
        if level == "1":
            row = rows[level][-1]
            row["senses"] = vocabulary_senses(entry, row["id"])
    if {level: len(entries) for level, entries in rows.items()} != EXPECTED:
        raise ValueError("Pinned vocabulary counts changed")
    return rows


def grammar() -> dict[str, list[dict]]:
    result = {level: [] for level in EXPECTED}
    text = (ROOT / "authoring" / "grammar.psv").read_text(encoding="utf-8")
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 8:
            raise ValueError(f"Expected eight grammar fields at line {line_number}")
        level, pattern, english, note, zh1, en1, zh2, en2 = fields
        if not all(fields):
            raise ValueError(f"Empty grammar field at line {line_number}")
        result[level].append({
            "id": f"zh-hsk{level}-g{len(result[level]) + 1:03d}",
            "pattern": pattern,
            "english": english,
            "note": note,
            "examples": [{"target": zh1, "english": en1}, {"target": zh2, "english": en2}],
            "source_id": "original-zh",
            "level_basis": f"Original teaching selection for 2021-framework band {level}; not official grammar mapping",
        })
    for level, entries in result.items():
        if len(entries) < (35 if level == "7-9" else 25):
            raise ValueError(f"Insufficient grammar coverage for {level}")
    return result


def group_vocabulary_senses(words: list[dict], aliases: dict) -> None:
    if not isinstance(aliases, dict) or not all(
        isinstance(alias, str) and isinstance(canonical, str)
        for alias, canonical in aliases.items()
    ):
        raise ValueError("HSK-1 sense groups must map source IDs to canonical IDs")
    source = {
        sense["id"]: (row["id"], sense)
        for row in words for sense in row["senses"]
    }
    positions = {identifier: index for index, identifier in enumerate(source)}
    for alias, canonical in aliases.items():
        if alias not in source or canonical not in source:
            raise ValueError(f"Unknown source sense in group: {alias} -> {canonical}")
        if canonical in aliases or positions[canonical] >= positions[alias]:
            raise ValueError(f"{alias}: canonical sense must be earlier and not an alias")
        parent, sense = source[alias]
        canonical_parent, canonical_sense = source[canonical]
        if parent != canonical_parent or sense["reading"] != canonical_sense["reading"]:
            raise ValueError(f"{alias}: groups must share a headword and reading")
    for row in words:
        groups = {}
        for sense in row["senses"]:
            identifier = sense["id"]
            canonical = aliases.get(identifier, identifier)
            if canonical == identifier:
                groups[canonical] = {**sense, "source_sense_ids": [identifier]}
            else:
                groups[canonical]["english"] += "; " + sense["english"]
                groups[canonical]["source_sense_ids"].append(identifier)
        row["senses"] = list(groups.values())


def add_hsk1_token_metadata(words: list[dict], patterns: list[dict],
                            authoring: Path) -> None:
    group_vocabulary_senses(words, load_yaml(authoring / "vocabulary-groups.yaml"))
    labels = load_yaml(authoring / "vocabulary.yaml")
    senses = [sense for row in words for sense in row["senses"]]
    expected_ids = {sense["id"] for sense in senses}
    if not isinstance(labels, dict) or set(labels) != expected_ids:
        raise ValueError("HSK-1 vocabulary labels must cover every canonical sense ID exactly")
    for sense in senses:
        sense["disambiguator"] = labels[sense["id"]]

    grammar_labels = load_yaml(authoring / "grammar.yaml")
    if not isinstance(grammar_labels, dict) or set(grammar_labels) != {
        row["id"] for row in patterns
    }:
        raise ValueError("HSK-1 grammar labels must cover every grammar ID exactly")
    for row in patterns:
        fields = grammar_labels[row["id"]]
        if not isinstance(fields, dict) or set(fields) != {"token_form", "disambiguator"}:
            raise ValueError(f"{row['id']}: expected token_form and disambiguator")
        row.update(fields)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Use an existing pinned complete.json for offline reproduction")
    parser.add_argument("--check", action="store_true", help="Verify generated files without modifying them")
    args = parser.parse_args()
    if args.source:
        raw = args.source.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=90) as response:
            raw = response.read()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError("Source SHA-256 mismatch; refusing to import")
    check_normalizer()
    data = json.loads(raw)
    words = vocabulary(data)
    patterns = grammar()
    add_hsk1_token_metadata(words["1"], patterns["1"], ROOT / "authoring" / "hsk-1")
    report = normalization_report(data)
    outputs = {ROOT / "normalization-report.yaml": dump_yaml(report)}
    for level in EXPECTED:
        outputs[ROOT / f"hsk-{level}" / "vocabulary.yaml"] = dump_yaml(words[level])
        outputs[ROOT / f"hsk-{level}" / "grammar.yaml"] = dump_yaml(patterns[level])
    outputs.update(compact_outputs(ROOT / "hsk-1", words["1"], patterns["1"]))
    for path, content in outputs.items():
        if args.check:
            if path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Generated file differs: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print(json.dumps({level: {"vocabulary": len(words[level]), "grammar": len(patterns[level])} for level in EXPECTED}))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
