"""Fit every prepared Chinese character with the current fitter into a recipe file.

Strokes the fitter cannot resolve keep their pinned source-median path. Output
is unreviewed. Rerun: py -3.12 -B scripts/fit_chinese_recipes.py
then: py -3.12 -B scripts/import_chinese_writing.py ; npm run characters:generate
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
import time

from character_geometry import validate_path
from character_inventory import extract_inventory
from chinese_monoline import normalize_median, source_median_path
from curriculum_yaml import dump_yaml
import fit_chinese_strokes as fitter
import import_chinese_writing as importer

OUTPUT = importer.FITTED_RECIPES
NOTICE = (
    "MODIFIED 2026-10-11: Programmatically fitted simplified tracing paths from pinned Hanzi "
    "Writer Data medians using " + fitter.VERSION + ". Strokes failing the fitter gates retain "
    "their source-median path. Original stroke order, em-box placement and width 5.5 are retained. "
    "Fitted defaults are fitted-unreviewed: no human visual review. Derived artwork is freely "
    "available under the ARPHIC PUBLIC LICENSE, AS IS, without warranty; retain the original "
    "license and notices."
)


def fit_character(character: str, medians: list[list[list[float]]]) -> dict:
    strokes = fitter.space_isolated_dots(medians, [fitter.fit_stroke(points) for points in medians])
    paths, fitted, reasons = [], [], []
    for index, (points, stroke) in enumerate(zip(medians, strokes), 1):
        path = stroke.get("path")
        if path:
            try:
                validate_path(path)
            except ValueError:
                path = None
        if path:
            paths.append(path)
            fitted.append(index)
        else:
            paths.append(source_median_path(points))
            reasons.append(index)
    return {"character": character, "paths": paths, "fitted_strokes": fitted, "source_strokes": reasons,
            "models": [s.get("model", "unresolved") for s in strokes]}


def work(item):
    character, medians = item
    return fit_character(character, medians)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, help="Fit only the first N eligible characters, without writing")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    started = time.time()
    root = importer.ROOT
    inventory = extract_inventory(root.parent, "chinese")
    source, lock, _ = importer.read_source(root, inventory["required"])
    skip = set(importer.APPROVED) | set(importer.read_authored_recipes(root, source, lock)[0]["characters"])
    items = [(c, [normalize_median(m) for m in rec["medians"]]) for c, rec in sorted(source.items()) if c not in skip]
    if args.limit:
        items = items[:args.limit]
    with ProcessPoolExecutor(args.workers) as pool:
        results = list(pool.map(work, items, chunksize=20))
    seconds = round(time.time() - started, 1)
    models = Counter(m for r in results for m in r["models"])
    summary = {
        "fitter": fitter.VERSION, "characters": len(results),
        "strokes": sum(len(r["paths"]) for r in results),
        "strokes_fitted": sum(len(r["fitted_strokes"]) for r in results),
        "strokes_left_as_source": sum(len(r["source_strokes"]) for r in results),
        "characters_fully_fitted": sum(not r["source_strokes"] for r in results),
        "characters_partly_source": sum(bool(r["source_strokes"]) and bool(r["fitted_strokes"]) for r in results),
        "characters_all_source": sum(not r["fitted_strokes"] for r in results),
        "models": dict(models), "seconds": seconds,
    }
    if not args.limit:
        recipes = {
            "id": "zh-fitted-monoline", "version": "1", "source_revision": importer.REVISION,
            "fitter": fitter.VERSION, "review": "fitted-unreviewed", "notice": NOTICE,
            "characters": {r["character"]: {
                "source_member_sha256": lock["members"][f"data/{r['character']}.json"]["sha256"],
                "fitted_strokes": r["fitted_strokes"], "paths": r["paths"]} for r in results},
        }
        (root / OUTPUT).write_text(dump_yaml(recipes), encoding="utf-8", newline="\n")
        (root / "characters" / "recipes" / "fitted-monoline.summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(summary, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
