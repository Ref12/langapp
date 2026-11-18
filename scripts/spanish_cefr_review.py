"""Model review of the CEFR Spanish vocabulary (curriculum/spanish/cefr/levels/*/vocabulary.yaml).

A reviewer model reads records in batches and returns only the records it would change, with the
fix and a reason. Records it does not list are accepted. Each batch's answer is cached under --out,
so a rerun skips finished batches.

  python scripts/spanish_cefr_review.py --levels a1 a2 --model deepseek --out review/deepseek
  python scripts/spanish_cefr_review.py --levels a1 --ids ids.txt --model luna --out review/luna

Models go through the hexad model gateway (HEXAD_GATEWAY_URL, default http://localhost:5210;
HEXAD_GATEWAY_KEY if the gateway needs one).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from curriculum_yaml import load_yaml  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / "curriculum" / "spanish" / "cefr"

MODELS = {
    "deepseek": ("chat", "wupeter/DeepSeek-V4.1-Flash"),
    "haiku": ("chat", "claude-haiku-4.5"),
    "luna": ("responses", "gpt-6-luna"),
    "sonnet": ("chat", "claude-sonnet-5.5"),
}

FIELDS = ["lemma", "pos", "sense", "taught", "gender", "plural", "gloss", "region_note", "register", "conj", "verb_class"]
VERB_CLASSES = (
    "regular-ar regular-er regular-ir stem-e-ie stem-o-ue stem-e-i stem-u-ue spell-c-qu spell-g-gu "
    "spell-z-c spell-g-j spell-i-y irregular-yo irregular-preterite irregular-participle fully-irregular"
)

SYSTEM = f"""You review vocabulary records for a Spanish course for adult English speakers.
The variety taught is Latin American Spanish with Mexico as the reference (US classroom model).
"You all" is ustedes; vosotros is Spain-only and never taught.

Each record has: id, level (CEFR), lemma, pos, and optionally gender (m, f, mf = same form both
genders, m/f = two forms), plural (only when irregular), gloss (short English, at most 40
characters), region_note, register, conj (ar/er/ir), verb_class (list from: {VERB_CLASSES}).

Check every field against these rules:
- lemma: correct dictionary form, correct accents and spelling (a missing accent is an error).
- gloss: the meaning a learner in Mexico needs, at most 40 characters, verbs as "to ...". If the
  word means something different in Mexico than in Spain, the gloss gives the Mexican meaning.
- gender and plural: correct for nouns; plural only when it is not the regular +s/+es.
- region_note: only when Spain's everyday word for the same meaning is different, written
  exactly "Spain: <word>". Remove a note that repeats the lemma, names the wrong country, or
  describes a different meaning. Add one where Spain clearly uses a different everyday word.
- Words mainly used outside Mexico (Southern Cone, Caribbean, Spain) are not taught as the main
  word: set "drop" with the Mexican word in "why".
- Words vulgar or offensive in Mexico are not taught at A1-A2: set "drop".
- conj and verb_class: correct for verbs; regular verbs have only their regular class; stem and
  spelling changes and irregular yo, preterite stem or participle are listed when they apply.
- A lemma can have several records, one per sense ("sense": 2 ...); judge each record's own
  sense. A record with "taught": false is kept for recognition only (vosotros forms): never drop
  it for being Spain-only.
- Do not reword a gloss that is already correct and clear. Only report real errors.

Return ONLY a JSON array. List only records that need a change; return [] if none do.
Each item: {{"id": "<id>", "fix": {{"<field>": <new value or null to remove>}}, "drop": false,
"why": "<at most 15 words>"}}. Use "drop": true (fix may be empty) to remove the record."""


def gateway() -> tuple[str, dict[str, str]]:
    base = os.environ.get("HEXAD_GATEWAY_URL", "http://localhost:5210").rstrip("/")
    if not base.endswith("/v1"):
        base += "/v1"
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("HEXAD_GATEWAY_KEY")
    if key:
        headers["Authorization"] = "Bearer " + key
    return base, headers


def call(model: str, system: str, user: str) -> tuple[str, dict]:
    api, name = MODELS[model]
    base, headers = gateway()
    if api == "chat":
        body = {"model": name, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        url = base + "/chat/completions"
    else:
        body = {"model": name, "instructions": system, "input": user}
        url = base + "/responses"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=600) as r:
        data = json.load(r)
    if api == "chat":
        return data["choices"][0]["message"]["content"], data.get("usage", {})
    text = data.get("output_text")
    if not text:
        parts = []
        for item in data.get("output", []):
            for c in item.get("content", []) or []:
                if c.get("type") in ("output_text", "text"):
                    parts.append(c.get("text", ""))
        text = "".join(parts)
    return text, data.get("usage", {})


def parse_array(text: str) -> list:
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        raise ValueError("no JSON array in answer: " + text[:200])
    return json.loads(m.group(0))


def records(levels: list[str], ids: set[str] | None) -> list[dict]:
    out = []
    for level in levels:
        for rec in load_yaml(ROOT / "levels" / level / "vocabulary.yaml") or []:
            if ids is not None and rec["id"] not in ids:
                continue
            item = {"id": rec["id"], "level": level.upper()}
            item.update({k: rec[k] for k in FIELDS if k in rec})
            out.append(item)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", nargs="+", default=["a1", "a2"])
    ap.add_argument("--ids", type=Path, help="file with one record id per line (default: all)")
    ap.add_argument("--model", choices=sorted(MODELS), default="deepseek")
    ap.add_argument("--batch", type=int, default=60)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)

    ids = None
    if a.ids:
        ids = {line.strip() for line in a.ids.read_text(encoding="utf-8").splitlines() if line.strip()}
    recs = records(a.levels, ids)
    a.out.mkdir(parents=True, exist_ok=True)
    batches = [recs[i:i + a.batch] for i in range(0, len(recs), a.batch)]
    print(f"{len(recs)} records, {len(batches)} batches, model {a.model}", flush=True)

    def run(i: int) -> str:
        path = a.out / f"{i:04d}.json"
        if path.exists():
            return f"{i}: cached"
        chunk = batches[i]
        user = json.dumps(chunk, ensure_ascii=False)
        last = None
        for _ in range(3):
            try:
                text, usage = call(a.model, SYSTEM, user)
                items = parse_array(text)
                known = {r["id"] for r in chunk}
                items = [x for x in items if isinstance(x, dict) and x.get("id") in known]
                path.write_text(json.dumps({"ids": sorted(known), "items": items, "usage": usage},
                                           ensure_ascii=False, indent=1), encoding="utf-8")
                return f"{i}: {len(items)} changes"
            except Exception as e:  # retried; the last error is reported
                last = e
        return f"{i}: FAILED {last}"

    with cf.ThreadPoolExecutor(a.workers) as ex:
        for line in ex.map(run, range(len(batches))):
            print(line, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
