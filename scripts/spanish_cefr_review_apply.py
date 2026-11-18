"""Merge two reviewers' answers from spanish_cefr_review.py and apply decided changes.

  merge:  python scripts/spanish_cefr_review_apply.py merge review/deepseek review/luna --out review/merged
          writes agreed.json (both reviewers proposed the same change) and disputed.json (only one
          did, or they differ), each with the current record alongside.
  apply:  python scripts/spanish_cefr_review_apply.py apply decisions.json [more.json ...]
          each file is a list of {"id", "fix": {field: value or null}, "drop": bool}. Records are
          edited in place on their own line; a drop also removes the id from the A1 sequence and,
          for verbs, from verbs.yaml. verb_class and conj changes are mirrored into verbs.yaml.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spanish_cefr_review import ROOT, records  # noqa: E402

LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"]


def load_reviews(folder: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for path in sorted(folder.glob("*.json")):
        for item in json.loads(path.read_text(encoding="utf-8"))["items"]:
            out[item["id"]] = {"fix": item.get("fix") or {}, "drop": bool(item.get("drop")), "why": item.get("why", "")}
    return out


def same(a: dict | None, b: dict | None) -> bool:
    if a is None or b is None:
        return False
    if a["drop"] or b["drop"]:
        return a["drop"] and b["drop"]
    return a["fix"] == b["fix"]


def merge(a_dir: Path, b_dir: Path, out: Path, levels: list[str]) -> None:
    a, b = load_reviews(a_dir), load_reviews(b_dir)
    current = {r["id"]: r for r in records(levels, None)}
    agreed, disputed = [], []
    for rid in sorted(set(a) | set(b), key=lambda x: list(current).index(x) if x in current else 0):
        row = {"id": rid, "current": current.get(rid), a_dir.name: a.get(rid), b_dir.name: b.get(rid)}
        if same(a.get(rid), b.get(rid)):
            agreed.append({"id": rid, "fix": a[rid]["fix"], "drop": a[rid]["drop"], "current": current.get(rid),
                           "why": a[rid]["why"] + " / " + b[rid]["why"]})
        else:
            disputed.append(row)
    out.mkdir(parents=True, exist_ok=True)
    (out / "agreed.json").write_text(json.dumps(agreed, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "disputed.json").write_text(json.dumps(disputed, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(current)} records: {len(agreed)} agreed changes, {len(disputed)} disputed")


JUDGE = """You make the final call on vocabulary records for a Spanish course for adult English
speakers: Latin American Spanish, Mexico as the reference (US classroom model). "You all" is
ustedes; vosotros records ("taught": false) are kept for recognition only, with their note.

You get groups. Each group is every A1-A2 record of one lemma (all its senses), and for some records
two reviewers' proposals (each a fix of fields, or drop, with a reason). Reviewers are often wrong:
judge each proposal on its merits, and you may make a different change or none.

Rules for the final records:
- Each record is one sense. No two records of a lemma may mean the same thing: drop the duplicate.
  A sense whose meaning belongs to another part of speech gets the right pos or is dropped.
  An inflected form listed as its own lemma (veces beside vez) is dropped.
- plural is listed only when it is not the plain +s/+es rule: invariable plurals (lunes, cumpleaños)
  and irregular ones keep it; regular ones, including the usual accent change, drop it.
- gloss: the meaning a learner in Mexico needs, at most 40 characters, verbs as "to ...".
- region_note: only "Spain: <word>" when Spain's everyday word for that meaning differs.
- Words mainly used outside Mexico, or vulgar in Mexico, are dropped at A1-A2.
- verb_class from: regular-ar/er/ir, stem-e-ie, stem-o-ue, stem-e-i, stem-u-ue, spell-c-qu,
  spell-g-gu, spell-z-c, spell-g-j, spell-i-y, irregular-yo, irregular-preterite,
  irregular-participle, fully-irregular; conj is ar/er/ir.
- Lemma spelling and accents must be right.

Return ONLY a JSON array with one item for every record that has proposals:
{"id": ..., "fix": {field: new value or null to remove}, "drop": bool, "why": "<at most 12 words>"}.
"fix": {} with "drop": false means no change. You may also include other records of a group
that need a change (for example to drop a duplicate)."""


def judge(merged: Path, out: Path, levels: list[str], batch: int) -> None:
    from spanish_cefr_review import call, parse_array
    rows = json.loads((merged / "agreed.json").read_text(encoding="utf-8"))
    rows = [{"id": r["id"], "current": r["current"], "proposals": [{"fix": r["fix"], "drop": r["drop"], "why": r["why"]}]}
            for r in rows]
    for r in json.loads((merged / "disputed.json").read_text(encoding="utf-8")):
        props = [v for k, v in r.items() if k not in ("id", "current") and v]
        rows.append({"id": r["id"], "current": r["current"], "proposals": props})
    current = records(levels, None)
    by_lemma: dict[str, list[dict]] = {}
    for rec in current:
        by_lemma.setdefault(rec["lemma"], []).append(rec)
    props = {r["id"]: r["proposals"] for r in rows}
    lemmas = []
    for rec in current:
        if rec["id"] in props and rec["lemma"] not in lemmas:
            lemmas.append(rec["lemma"])
    groups = [[dict(rec, proposals=props.get(rec["id"])) if rec["id"] in props else rec
               for rec in by_lemma[lemma]] for lemma in lemmas]
    out.mkdir(parents=True, exist_ok=True)
    chunks = [groups[i:i + batch] for i in range(0, len(groups), batch)]
    print(f"{len(rows)} proposed records in {len(groups)} lemma groups, {len(chunks)} batches", flush=True)
    import concurrent.futures as cf

    def run(i: int) -> str:
        path = out / f"{i:04d}.json"
        if path.exists():
            return f"{i}: cached"
        last = None
        for _ in range(3):
            try:
                text, usage = call("sonnet", JUDGE, json.dumps(chunks[i], ensure_ascii=False))
                items = parse_array(text)
                path.write_text(json.dumps({"items": items, "usage": usage}, ensure_ascii=False, indent=1), encoding="utf-8")
                return f"{i}: {len(items)} decisions"
            except Exception as e:
                last = e
        return f"{i}: FAILED {last}"

    with cf.ThreadPoolExecutor(4) as ex:
        for line in ex.map(run, range(len(chunks))):
            print(line, flush=True)
    decided = []
    for path in sorted(out.glob("0*.json")):
        decided += json.loads(path.read_text(encoding="utf-8"))["items"]
    (out / "decisions.json").write_text(json.dumps(decided, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(decided)} decisions in {out / 'decisions.json'}")


def line_of(rec: dict) -> str:
    return "- " + yaml.dump(rec, default_flow_style=True, allow_unicode=True, sort_keys=False, width=100_000).rstrip("\n")


def rewrite(path: Path, edit) -> None:
    lines = path.read_text(encoding="utf-8").split("\n")
    out = []
    for line in lines:
        if line.startswith("- {"):
            rec = yaml.safe_load(line)[0]
            new = edit(rec)
            if new is None:
                continue
            if new is not rec or new != yaml.safe_load(line)[0]:
                line = line_of(new)
        out.append(line)
    path.write_text("\n".join(out), encoding="utf-8", newline="\n")


def apply(files: list[Path]) -> None:
    decisions: dict[str, dict] = {}
    for f in files:
        for d in json.loads(f.read_text(encoding="utf-8")):
            decisions[d["id"]] = d
    dropped: set[str] = set()
    verb_updates: dict[str, dict] = {}
    seen: set[str] = set()

    def edit_vocab(rec: dict):
        d = decisions.get(rec.get("id"))
        if not d:
            return rec
        seen.add(rec["id"])
        if d.get("drop"):
            dropped.add(rec["id"])
            return None
        rec = dict(rec)
        order = list(rec)
        for field, value in (d.get("fix") or {}).items():
            if value is None or value == "":
                rec.pop(field, None)
            else:
                rec[field] = value
                if field not in order:
                    order.insert(order.index("basis") if "basis" in order else len(order), field)
        rec = {k: rec[k] for k in order if k in rec}
        if rec.get("pos") == "verb":
            verb_updates[rec["id"]] = rec
        return rec

    for level in LEVELS:
        rewrite(ROOT / "levels" / level / "vocabulary.yaml", edit_vocab)

    def edit_verb(row: dict):
        if row.get("id") in dropped:
            return None
        v = verb_updates.get(row.get("id"))
        if v:
            row = dict(row)
            row["lemma"] = v["lemma"]
            if "verb_class" in v:
                row["class"] = v["verb_class"]
            if "conj" in v:
                row["group"] = v["conj"]
        return row

    rewrite(ROOT / "verbs.yaml", edit_verb)

    seq = ROOT / "teaching" / "a1" / "sequence.yaml"
    text = seq.read_text(encoding="utf-8")
    for rid in dropped:
        text = re.sub(r"(items: \[)([^\]]*)\]", lambda m: m.group(1) + ", ".join(
            x for x in (s.strip() for s in m.group(2).split(",")) if x and x != rid) + "]", text)
    seq.write_text(text, encoding="utf-8", newline="\n")
    missing = sorted(set(decisions) - seen)
    print(f"applied {len(seen)} decisions ({len(dropped)} drops); not found: {missing}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("merge")
    m.add_argument("a", type=Path)
    m.add_argument("b", type=Path)
    m.add_argument("--out", type=Path, required=True)
    m.add_argument("--levels", nargs="+", default=["a1", "a2"])
    j = sub.add_parser("judge")
    j.add_argument("merged", type=Path)
    j.add_argument("--out", type=Path, required=True)
    j.add_argument("--levels", nargs="+", default=["a1", "a2"])
    j.add_argument("--batch", type=int, default=40)
    p = sub.add_parser("apply")
    p.add_argument("files", nargs="+", type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "merge":
        merge(a.a, a.b, a.out, a.levels)
    elif a.cmd == "judge":
        judge(a.merged, a.out, a.levels, a.batch)
    else:
        apply(a.files)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
