"""Build/check Chinese writing assets offline; source preparation is explicit."""

from __future__ import annotations

import argparse
from collections import Counter
import html
import io
import json
from pathlib import Path
import sys
import tarfile
import urllib.request
import zipfile

import yaml

from character_assets import build_outputs, sha256, write_outputs
from character_geometry import sample_path
from character_inventory import extract_inventory
from chinese_monoline import (
    TRANSFORM, candidate_stroke, normalize_median, reviewed_stroke, source_median_path,
)
from curriculum_yaml import CurriculumLoader, dump_yaml, load_yaml


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "chinese"
REVISION = "68d10a4b21150cae5e1ebbd223eed289cf32d90c"
SOURCE_ID = "zh-writing-hanzi-writer"
SOURCE_URL = f"https://codeload.github.com/chanind/hanzi-writer-data/tar.gz/{REVISION}"
SOURCE_SHA256 = "6596f675e58dafb5b6bd58d003e0f407d88e4bbccf8477c1ee2039a6faefab55"
LICENSE_SHA256 = "5590533436c70f10f2f524ee61456238c290175c6662fbe1c700b5f038a6d328"
ARCHIVE = "upstream/writing/hanzi-writer-selected.zip"
LOCK = "upstream/writing/source-lock.yaml"
LICENSE = "licenses/hanzi-writer-ARPHICPL.TXT"
RECIPES = "characters/recipes/reviewed-prototype.yaml"
APPROVED = ("\u8336", "\u96e8", "\u676f", "\u4eba", "\u4e00")
BATCH = tuple("\u8336\u96e8\u676f\u4eba\u4e00\u4e09\u5341\u5c0f\u4e86\u4e01"
              "\u6c34\u5fc3\u6587\u6728\u6c38\u6211\u53ef\u53e3\u65e5\u56fd"
              "\u56de\u5668\u8b66\u85cf\u8d62\u4e4b\u6bcb\u98ce\u4e5d\u56ca")
STYLE_CAUTIONS = {
    character: "Coordinator batch review noted heavy strokes/tight counters at width 5.5. "
               "Retain as a style/legibility review caution; no thinner pen or new visual approval."
    for character in "\u56ca\u8b66\u8d62\u5668"
}
NOTICE = """MODIFIED 2026-09-15: Selected current Chinese curriculum characters from pinned
Hanzi Writer Data; retained original source bytes in the selected archive.
Derived 100-unit padded source-median paths, conservative terminal candidates,
and exact paths for five previously reviewed prototype recipes. No new visual
approval is implied. Stroke order and original em-box proportions are retained.
Copyright (C) 1999 Arphic Technology Co., Ltd.; via Make Me a Hanzi by Shaunak
Kishore and contributors and Hanzi Writer Data by David Chanin.
Derived artwork is freely available under the ARPHIC PUBLIC LICENSE, AS IS,
without warranty. Retain licenses/hanzi-writer-ARPHICPL.TXT and modification
notices with redistributed source and derived artwork. Independent code is separate."""


def local(root: Path, name: str) -> Path:
    return root.joinpath(*name.split("/"))


def path_hash(paths: list[str]) -> str:
    return sha256(json.dumps(paths, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def prepare_source(root: Path, source: bytes) -> None:
    if sha256(source) != SOURCE_SHA256:
        raise ValueError("Upstream archive SHA-256 mismatch; refusing source preparation")
    inventory = extract_inventory(root.parent, "chinese")
    required = inventory["required"]
    members = {}
    prefix = f"hanzi-writer-data-{REVISION}/"
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        names = archive.getnames()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate upstream archive members")
        for name in ["ARPHICPL.TXT", "README.md"] + [f"data/{c}.json" for c in required]:
            member = archive.getmember(prefix + name)
            if not member.isfile():
                raise ValueError(f"Upstream member is not a regular file: {name}")
            with archive.extractfile(member) as stream:
                members[name] = stream.read()
    if sha256(members["ARPHICPL.TXT"]) != LICENSE_SHA256:
        raise ValueError("Original ARPHIC license checksum changed")
    members["SELECTION-NOTICE.txt"] = (NOTICE + "\n").encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw, compresslevel=9)
    selected = buffer.getvalue()
    lock = {
        "schema_version": 1,
        "revision": REVISION,
        "upstream_url": SOURCE_URL,
        "upstream_sha256": SOURCE_SHA256,
        "archive": ARCHIVE,
        "archive_sha256": sha256(selected),
        "license": LICENSE,
        "license_sha256": LICENSE_SHA256,
        "members": {
            name: {"sha256": sha256(raw), "bytes": len(raw)}
            for name, raw in sorted(members.items())
        },
    }
    for name, raw in (
        (ARCHIVE, selected), (LICENSE, members["ARPHICPL.TXT"]),
        (LOCK, dump_yaml(lock).encode("utf-8")),
    ):
        path = local(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)


def read_source(root: Path, required: list[str]) -> tuple[dict, dict, list[dict]]:
    lock = load_yaml(local(root, LOCK))
    if (not isinstance(lock, dict) or lock.get("schema_version") != 1
            or lock.get("revision") != REVISION or lock.get("upstream_sha256") != SOURCE_SHA256
            or lock.get("upstream_url") != SOURCE_URL
            or lock.get("archive") != ARCHIVE or lock.get("license") != LICENSE
            or lock.get("license_sha256") != LICENSE_SHA256):
        raise ValueError("Invalid Chinese writing source lock or changed upstream pin")
    archive_bytes = local(root, ARCHIVE).read_bytes()
    if sha256(archive_bytes) != lock["archive_sha256"]:
        raise ValueError("Selected source archive checksum mismatch")
    if sha256(local(root, LICENSE).read_bytes()) != LICENSE_SHA256:
        raise ValueError("Original ARPHIC license checksum mismatch")
    members = lock["members"]
    expected = {f"data/{c}.json" for c in required} | {"ARPHICPL.TXT", "README.md", "SELECTION-NOTICE.txt"}
    if not isinstance(members, dict) or set(members) != expected:
        raise ValueError("Source selection does not exactly match required characters and notices")
    source = {}
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != expected:
            raise ValueError("Selected archive has missing, extra or duplicate members")
        for name in sorted(expected):
            info = archive.getinfo(name)
            if (info.is_dir() or info.file_size > 1_000_000
                    or (info.external_attr >> 16) & 0o170000 not in (0, 0o100000)):
                raise ValueError(f"Selected member is not a bounded regular file: {name}")
            raw = archive.read(name)
            if members[name] != {"sha256": sha256(raw), "bytes": len(raw)}:
                raise ValueError(f"Selected member checksum mismatch: {name}")
            if name.startswith("data/"):
                source[Path(name).stem] = json.loads(raw)
    inputs = [
        {"path": name, "sha256": digest, "source_id": SOURCE_ID, "source_version": REVISION}
        for name, digest in (
            (ARCHIVE, lock["archive_sha256"]), (LICENSE, LICENSE_SHA256),
            (LOCK, sha256(local(root, LOCK).read_bytes())),
        )
    ]
    return source, lock, inputs


def read_recipes(root: Path) -> tuple[dict, dict]:
    raw = local(root, RECIPES).read_bytes()
    recipes = load_yaml(local(root, RECIPES))
    if (not isinstance(recipes, dict) or recipes.get("id") != "zh-reviewed-prototype"
            or recipes.get("version") != "1" or recipes.get("source_revision") != REVISION
            or set(recipes.get("characters", {})) != set(APPROVED)):
        raise ValueError("Reviewed recipes must retain the exact five pinned prototype characters")
    pin = {
        "path": RECIPES, "sha256": sha256(raw), "source_id": SOURCE_ID,
        "source_version": "reviewed-prototype:1",
    }
    return recipes, pin


def make_records(source: dict, lock: dict, recipes: dict, recipe_pin: dict) -> tuple[dict, dict]:
    records, queue = {}, {}
    for character, original in sorted(source.items()):
        if (not isinstance(original, dict) or not isinstance(original.get("strokes"), list)
                or not isinstance(original.get("medians"), list) or not original["strokes"]
                or len(original["strokes"]) != len(original["medians"])
                or any(not isinstance(path, str) or not path.startswith("M") or not path.endswith("Z")
                       for path in original["strokes"])):
            raise ValueError(f"{character}: incomplete source outlines/medians")
        medians = [normalize_median(points) for points in original["medians"]]
        baseline = [source_median_path(points) for points in medians]
        member = f"data/{character}.json"
        provenance = [{
            "source_id": SOURCE_ID,
            "source_entry": f"https://raw.githubusercontent.com/chanind/hanzi-writer-data/{REVISION}/{member}",
            "input": ARCHIVE, "sha256": lock["archive_sha256"],
            "member": member, "member_sha256": lock["members"][member]["sha256"],
        }]

        def variant(identifier, paths, *, reviewed=False):
            return {
                "id": identifier, "locale": "zh-Hans-CN",
                "strokes": [{"path": path} for path in paths],
                "provenance": provenance,
                "transform": dict(TRANSFORM),
                "status": {"generated": True, "validated": True, "reviewed": reviewed},
            }

        variants = [variant("source-median", baseline)]
        default = "source-median"
        candidates = [candidate_stroke(points) for points in medians]
        flags = [{"stroke": index + 1, "rule": rule}
                 for index, (_, rule) in enumerate(candidates) if rule]
        if flags:
            queue[character] = {
                "source_member_sha256": lock["members"][member]["sha256"],
                "rules": flags, "reviewed_prototype": character in APPROVED,
            }
        if character in APPROVED:
            recipe = recipes["characters"][character]
            if recipe["source_member_sha256"] != lock["members"][member]["sha256"]:
                raise ValueError(f"{character}: reviewed source bytes changed")
            if len(recipe["strokes"]) != len(medians):
                raise ValueError(f"{character}: incomplete reviewed stroke recipes")
            paths = [reviewed_stroke(points, stroke)[0]
                     for points, stroke in zip(medians, recipe["strokes"], strict=True)]
            if paths != recipe["paths"] or path_hash(paths) != recipe["paths_sha256"]:
                raise ValueError(f"{character}: approved paths changed; refusing inherited review")
            approved = variant("reviewed-monoline", paths, reviewed=True)
            approved["recipe"] = {
                "id": f"zh-prototype-u{ord(character):04x}", "version": recipes["version"],
                "input": RECIPES, "sha256": recipe_pin["sha256"],
            }
            approved["review"] = dict(recipes["review"])
            variants.append(approved)
            default = "reviewed-monoline"
        elif flags:
            variants.append(variant("refined-candidate", [path for path, _ in candidates]))
        records[character] = {
            "script": "Han", "kind": "character", "default_variant": default, "variants": variants,
        }
    return records, queue


def svg(paths: list[str], *, outline=False, direction_marks=False) -> str:
    transform = ' transform="matrix(0.087890625 0 0 -0.087890625 5 84.1015625)"' if outline else ""
    style = 'fill="#222"' if outline else 'fill="none" stroke="#222" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"'
    elements = "".join(f'<path d="{html.escape(path, quote=True)}"/>' for path in paths)
    markers = ""
    if direction_marks:
        points = sample_path(paths[0])
        for point, color in ((points[0], "#07804b"), (points[-1], "#c22")):
            markers += f'<circle cx="{point[0]}" cy="{point[1]}" r="1.4" fill="{color}"/>'
    return f'<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g{transform} {style}>{elements}</g>{markers}</svg>'


def variant_counts(records: dict) -> dict[str, int]:
    return dict(sorted(Counter(
        variant["id"] for record in records.values() for variant in record["variants"]
    ).items()))


def review_outputs(records: dict, source: dict, queue: dict) -> dict[str, bytes]:
    counts = Counter(flag["rule"] for entry in queue.values() for flag in entry["rules"])
    report = {
        "schema_version": 1, "notice": NOTICE, "source_revision": REVISION,
        "scope": "Detector candidates, not visual approvals or automatic release permission",
        "scope_characters": sorted(records),
        "detector_flagged_glyphs": len(queue), "stroke_rule_counts": dict(sorted(counts.items())),
        "variant_counts": variant_counts(records),
        "style_cautions": {character: note for character, note in sorted(STYLE_CAUTIONS.items())
                           if character in records},
        "characters": queue,
    }
    items, cards = [], []
    for character in BATCH:
        record = records[character]
        row = {
            "character": character, "default_variant": record["default_variant"],
            "rules": queue.get(character, {}).get("rules", []), "variants": [],
            "style_cautions": [STYLE_CAUTIONS[character]] if character in STYLE_CAUTIONS else [],
        }
        comparisons = [f'<figure>{svg(source[character]["strokes"], outline=True)}<figcaption>Original filled source</figcaption></figure>']
        for variant in record["variants"]:
            paths = [stroke["path"] for stroke in variant["strokes"]]
            row["variants"].append({
                "id": variant["id"], "status": variant["status"],
                "provenance": variant["provenance"], "transform": variant["transform"],
                "strokes": [{"order": index + 1, "path": path, "samples": sample_path(path)}
                            for index, path in enumerate(paths)],
            })
            label = variant["id"] + (" (reviewed)" if variant["status"]["reviewed"] else " (unreviewed)")
            steps = "".join(
                f'<figure>{svg([path], direction_marks=True)}<figcaption>Stroke {index + 1}</figcaption></figure>'
                for index, path in enumerate(paths)
            )
            comparisons.append(
                f'<figure>{svg(paths)}<div class="small">{svg(paths)}</div>'
                f'<figcaption>{html.escape(label)}</figcaption>'
                '<details><summary>Ordered strokes (green start, red end)</summary>'
                f'<div class="stroke-strip">{steps}</div></details></figure>'
            )
        items.append(row)
        rules = ", ".join(f'{flag["stroke"]}: {flag["rule"]}' for flag in row["rules"]) or "No terminal rule"
        cards.append(f'<article><h2>{character} U+{ord(character):04X} ({len(source[character]["strokes"])} strokes)</h2>'
                     + '<div class="variants">' + "".join(comparisons)
                     + f'</div><p>{html.escape(rules)}</p>'
                     + "".join(f'<p class="caution">{html.escape(note)}</p>' for note in row["style_cautions"])
                     + "</article>")
    page = """<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Chinese writing review batch</title>
<style>
body{font:16px system-ui;margin:2rem;background:#fafafa;color:#222}
.variants{display:flex;flex-wrap:wrap;gap:1rem}figure{margin:0;width:180px}
svg{width:180px;height:180px;border:1px solid #bbb;background:linear-gradient(transparent 49.7%,#ddd 50%,transparent 50.3%),linear-gradient(90deg,transparent 49.7%,#ddd 50%,transparent 50.3%)}
figcaption{font-size:13px}article{break-inside:avoid;border-top:1px solid #ccc;padding:1rem 0}
.small svg{width:48px;height:48px}.stroke-strip svg{width:96px;height:96px}
.stroke-strip{display:flex;flex-wrap:wrap}.stroke-strip figure{width:100px}
.caution{border-left:4px solid #b87d00;padding-left:1rem}
pre{white-space:pre-wrap;font-size:12px}a{color:#0645ad}
</style><h1>Chinese writing: representative review batch</h1>
<p>Source-median defaults are supported but unreviewed. Refinements are candidates;
only five exact inherited prototype paths retain review evidence. No new approval is implied.</p>
<p><a href="batch-001.yaml">Ordered paths, matching samples, provenance and rule details</a></p>
"""
    page += "<pre>" + html.escape(NOTICE) + "</pre>" + "".join(cards) + "</html>\n"
    header = "".join("# " + line + "\n" for line in NOTICE.splitlines())
    batch_queue = {character: queue[character] for character in sorted(BATCH) if character in queue}
    batch_counts = Counter(flag["rule"] for entry in batch_queue.values() for flag in entry["rules"])
    batch_report = {
        **report, "scope_characters": sorted(BATCH), "detector_flagged_glyphs": len(batch_queue),
        "variant_counts": variant_counts({character: records[character] for character in BATCH}),
        "stroke_rule_counts": dict(sorted(batch_counts.items())), "characters": batch_queue,
    }
    return {
        "review/candidates.yaml": (header + dump_yaml(report)).encode("utf-8"),
        "review/batch-candidates.yaml": (header + dump_yaml(batch_report)).encode("utf-8"),
        "review/batch-001.yaml": (header + dump_yaml({
            "schema_version": 1, "notice": NOTICE, "characters": items,
        })).encode("utf-8"),
        "review/batch-001.html": page.encode("utf-8"),
    }


def write_review(root: Path, outputs: dict[str, bytes], *, check: bool) -> list[str]:
    stale = [
        name for name, raw in outputs.items()
        if not local(root / "characters", name).is_file()
        or local(root / "characters", name).read_bytes() != raw
    ]
    if not check:
        for name in stale:
            path = local(root / "characters", name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(outputs[name])
    return stale


def generate_batch(root: Path) -> dict:
    inventory = extract_inventory(root.parent, "chinese")
    source, lock, inputs = read_source(root, inventory["required"])
    recipes, recipe_pin = read_recipes(root)
    if not set(BATCH) <= source.keys():
        raise ValueError("Review batch must be a subset of the required source inventory")
    selected = {character: source[character] for character in BATCH}
    records, queue = make_records(selected, lock, recipes, recipe_pin)
    build_outputs(root, records, {"language": "chinese", "required": sorted(BATCH), "components": []},
                  inputs + [recipe_pin], adapter="chinese-writing", adapter_version="1", notice=NOTICE)
    outputs = review_outputs(records, selected, queue)
    del outputs["review/candidates.yaml"]
    write_review(root, outputs, check=False)
    return {"review_batch": len(records), "bulk_output": False,
            "detector_flagged_glyphs": len(queue), "variant_counts": variant_counts(records)}


def generate(root: Path, *, check: bool = False) -> dict:
    inventory = extract_inventory(root.parent, "chinese")
    source, lock, inputs = read_source(root, inventory["required"])
    recipes, recipe_pin = read_recipes(root)
    records, queue = make_records(source, lock, recipes, recipe_pin)
    outputs = build_outputs(root, records, inventory, inputs + [recipe_pin],
                            adapter="chinese-writing", adapter_version="1", notice=NOTICE)
    review = review_outputs(records, source, queue)
    stale = write_outputs(root, outputs, check=True)
    stale += write_review(root, review, check=True)
    if check and stale:
        raise ValueError("Missing or stale Chinese writing files: " + ", ".join(stale))
    if not check:
        write_outputs(root, outputs)
        write_review(root, review, check=False)
    coverage = yaml.load(outputs["coverage.yaml"], Loader=CurriculumLoader)
    return {
        "required": len(inventory["required"]), "drawable": len(records),
        "variants": sum(variant_counts(records).values()), "variant_counts": variant_counts(records),
        "reviewed_defaults": len(coverage["default_reviewed"]),
        "detector_flagged_glyphs": len(queue), "release_ready": coverage["release_ready"],
        "text_coverage_complete": coverage["text_coverage_complete"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    operations = parser.add_mutually_exclusive_group()
    operations.add_argument("--check", action="store_true", help="Offline no-write stale check")
    operations.add_argument("--review-batch", action="store_true", help="Generate only the 30-character review batch")
    operations.add_argument("--prepare-source", type=Path, help="Select original bytes from the pinned upstream tar.gz")
    operations.add_argument("--download-source", action="store_true", help="Explicitly download/select the fixed upstream pin")
    args = parser.parse_args()
    try:
        if args.prepare_source or args.download_source:
            if args.prepare_source:
                raw = args.prepare_source.read_bytes()
            else:
                request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "langapp-chinese-writing-importer"})
                with urllib.request.urlopen(request, timeout=120) as response:
                    raw = response.read()
            prepare_source(args.root, raw)
            print("Prepared pinned Chinese writing source archive; no artwork generated")
        elif args.review_batch:
            print(json.dumps(generate_batch(args.root)))
        else:
            print(json.dumps(generate(args.root, check=args.check)))
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError, zipfile.BadZipFile, tarfile.TarError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
