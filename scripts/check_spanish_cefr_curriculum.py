"""Consistency check for the CEFR Spanish curriculum inventory (curriculum/spanish/cefr).

Run from anywhere: python scripts/check_spanish_cefr_curriculum.py [root]
Exits 1 and prints one line per problem.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys

from curriculum_yaml import load_yaml

REPO = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = REPO / "curriculum" / "spanish" / "cefr"
LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"]
MAX_GLOSS = 40
MODULE_UNITS = (8, 12)
LAST_MODULE_MIN = 5
VERB_CLASSES = {
    "regular-ar", "regular-er", "regular-ir",
    "stem-e-ie", "stem-o-ue", "stem-e-i", "stem-u-ue",
    "spell-c-qu", "spell-g-gu", "spell-z-c", "spell-g-j", "spell-i-y",
    "irregular-yo", "irregular-preterite", "irregular-participle", "fully-irregular",
}
VOSOTROS = re.compile(r"\b(vosotros|vosotras|vuestr[oa]s?|habl[aá]is|com[eé]is|viv[ií]s)\b", re.IGNORECASE)


def words(text: str) -> list[str]:
    return [part for part in re.split(r"\s+", text.strip()) if part]


def load_all(root: Path) -> dict:
    data = {"vocab": {}, "grammar": {}, "functions": {}}
    for level in LEVELS:
        base = root / "levels" / level
        data["vocab"][level] = load_yaml(base / "vocabulary.yaml") or []
        data["grammar"][level] = load_yaml(base / "grammar.yaml") or []
        data["functions"][level] = load_yaml(base / "functions.yaml") or []
    data["verbs"] = load_yaml(root / "verbs.yaml") or []
    data["tenses"] = load_yaml(root / "tenses.yaml") or {}
    data["sequence"] = load_yaml(root / "teaching" / "a1" / "sequence.yaml") or {}
    return data


def check_data(data: dict) -> list[str]:
    errors: list[str] = []
    seen: dict[str, str] = {}
    senses: dict[tuple, str] = {}
    for level in LEVELS:
        for row in data["vocab"][level]:
            rid = row.get("id")
            if not rid:
                errors.append(f"{level}: vocabulary record without id: {row.get('lemma')}")
                continue
            if rid in seen:
                errors.append(f"duplicate item {rid} in {seen[rid]} and {level}")
            seen[rid] = level
            key = (row.get("lemma"), row.get("pos"), row.get("sense", 1))
            if key in senses:
                errors.append(f"duplicate sense {key} in {senses[key]} and {level}")
            senses[key] = level
            gloss = row.get("gloss")
            if not isinstance(gloss, str) or not gloss.strip():
                errors.append(f"{rid}: missing gloss")
            elif len(gloss) > MAX_GLOSS:
                errors.append(f"{rid}: gloss longer than {MAX_GLOSS} characters ({len(gloss)})")
            if row.get("basis") not in {"pcic", "frequency", "judgement"}:
                errors.append(f"{rid}: bad basis {row.get('basis')!r}")
            if row.get("pos") == "noun" and not row.get("gender"):
                errors.append(f"{rid}: noun without gender")
            if VOSOTROS.search(str(row.get("lemma", ""))) and row.get("taught") is not False:
                errors.append(f"{rid}: vosotros item marked as taught")
        for row in data["grammar"][level]:
            rid = row.get("id")
            if rid in seen:
                errors.append(f"duplicate item {rid} in {seen[rid]} and {level}")
            seen[rid] = level
            for field in ("name", "explain", "forms"):
                if not row.get(field):
                    errors.append(f"{rid}: missing {field}")
            if row.get("concept") is True and not row.get("concept_reason"):
                errors.append(f"{rid}: concept item without concept_reason")
            text = " ".join([str(row.get("id")), str(row.get("name"))] + [str(f) for f in row.get("forms") or []])
            if VOSOTROS.search(text) and row.get("taught") is not False:
                errors.append(f"{rid}: vosotros item marked as taught")
        if not data["functions"][level]:
            errors.append(f"{level}: no functions")
    # verbs
    verb_by_id = {}
    for row in data["verbs"]:
        verb_by_id[row.get("id")] = row
        classes = row.get("class") or []
        if not classes:
            errors.append(f"verb {row.get('lemma')}: no class")
        for cls in classes:
            if cls not in VERB_CLASSES:
                errors.append(f"verb {row.get('lemma')}: unknown class {cls}")
        lemma = str(row.get("lemma"))
        stem = lemma[:-2] if lemma.endswith("se") else lemma
        ending = {"ír": "ir"}.get(stem[-2:], stem[-2:])
        if ending in ("ar", "er", "ir") and row.get("group") != ending:
            errors.append(f"verb {lemma}: group {row.get('group')} does not match ending")
        reg = [c for c in classes if c.startswith("regular-")]
        if reg and (len(classes) != 1 or reg[0] != f"regular-{row.get('group')}"):
            errors.append(f"verb {lemma}: regular class mixed or mismatched: {classes}")
    for level in LEVELS:
        for row in data["vocab"][level]:
            if row.get("pos") == "verb" and row.get("sense", 1) == 1 and row.get("id") not in verb_by_id:
                errors.append(f"verb {row.get('lemma')}: not in verbs.yaml")
            if row.get("pos") == "verb" and not row.get("verb_class"):
                errors.append(f"verb {row.get('lemma')}: vocabulary record without verb_class")
    for row in data["verbs"]:
        if seen.get(row.get("id")) != row.get("level"):
            errors.append(f"verb {row.get('lemma')}: level mismatch with vocabulary")
    # tenses
    tenses = data["tenses"]
    for person in tenses.get("persons", []):
        if VOSOTROS.search(str(person.get("id"))) and person.get("taught") is not False:
            errors.append("tenses.yaml: vosotros person marked as taught")
    for tense in tenses.get("tenses", []):
        if tense.get("level") not in LEVELS:
            errors.append(f"tense {tense.get('id')}: bad level")
    # A1 sequence
    a1_items = [row["id"] for row in data["vocab"]["a1"] if row.get("taught") is not False and row.get("id")]
    a1_items += [row["id"] for row in data["grammar"]["a1"] if row.get("taught") is not False and row.get("id")]
    modules = (data["sequence"] or {}).get("modules") or []
    placed: dict[str, tuple] = {}
    unit_ids: list[str] = []
    titles: dict[str, str] = {}
    for mi, module in enumerate(modules):
        units = module.get("units") or []
        count = len(units)
        low, high = MODULE_UNITS
        last = mi == len(modules) - 1
        if count > high or (count < low and not (last and count >= LAST_MODULE_MIN)):
            errors.append(f"module {module.get('id')}: {count} units, expected {low}-{high} (last at least {LAST_MODULE_MIN})")
        title = str(module.get("title", ""))
        n = len(words(title))
        if not 2 <= n <= 5:
            errors.append(f"module {module.get('id')}: title {title!r} has {n} words, expected 2-5")
        if re.search(r"\d|\bmixed\b|\bmodule\b|\bunit\b", title, re.IGNORECASE):
            errors.append(f"module {module.get('id')}: title {title!r} is numbered or generic")
        key = title.strip().lower()
        if key in titles:
            errors.append(f"module {module.get('id')}: title {title!r} repeats {titles[key]}")
        titles[key] = str(module.get("id"))
        for ui, unit in enumerate(units):
            unit_ids.append(unit.get("id"))
            for pi, item in enumerate(unit.get("items") or []):
                if item in placed:
                    errors.append(f"item {item} is in more than one unit ({placed[item][2]} and {unit.get('id')})")
                placed[item] = (len(unit_ids), pi, unit.get("id"))
            if not unit.get("items"):
                errors.append(f"unit {unit.get('id')}: empty")
    if len(set(unit_ids)) != len(unit_ids):
        errors.append("unit ids are not unique")
    expected = [f"{m.get('id')}.u{i + 1:02d}" for m in modules for i in range(len(m.get('units') or []))]
    if unit_ids != expected:
        errors.append("unit ids do not run in order inside modules")
    for item in a1_items:
        if item not in placed:
            errors.append(f"A1 item {item} is in no unit")
    for item in placed:
        if item not in set(a1_items):
            errors.append(f"unit item {item} is not an A1 item")
    # a verb's forms come after the grammar that teaches its tense and class
    for row in data["verbs"]:
        if row.get("level") != "a1":
            continue
        where = placed.get(row["id"])
        for gate in row.get("taught_after") or []:
            gid = f"es.a1.{gate}"
            at = placed.get(gid)
            if where is None or at is None:
                errors.append(f"verb {row['lemma']}: gate {gate} or verb not in the sequence")
            elif at[:2] >= where[:2]:
                errors.append(f"verb {row['lemma']} comes before its grammar {gate}")
    return errors


def check(root: Path = DEFAULT_ROOT) -> list[str]:
    return check_data(load_all(Path(root)))


def counts(root: Path = DEFAULT_ROOT) -> dict:
    data = load_all(Path(root))
    out = {}
    for level in LEVELS:
        verbs = [r for r in data["vocab"][level] if r.get("pos") == "verb" and r.get("sense", 1) == 1]
        out[level] = {
            "vocabulary": len(data["vocab"][level]),
            "grammar": len(data["grammar"][level]),
            "functions": len(data["functions"][level]),
            "verbs": len(verbs),
        }
    return out


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else DEFAULT_ROOT
    errors = check(root)
    for line in errors[:200]:
        print(line)
    if errors:
        print(f"{len(errors)} problem(s)")
        return 1
    totals = counts(root)
    print("ok", {level: values["vocabulary"] for level, values in totals.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
