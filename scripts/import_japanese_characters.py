"""Import pinned Japanese writing candidates; offline by default, never a recognizer."""

from __future__ import annotations

import argparse
import html
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import xml.etree.ElementTree as ET

from character_assets import build_outputs, sha256, validate_bundle, write_outputs
from character_geometry import normalize_svg_path, sample_path
from character_inventory import extract_inventory, foundation_characters, script_of
from curriculum_yaml import load_yaml, write_yaml
from import_japanese_curriculum import fetch


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "japanese"
KVG = "kanjivg-writing"
APL = "animcjk-writing-arphic"
LGPL = "animcjk-writing-lgpl"
RECIPES = "japanese-writing-recipes"
FOUNDATION_ROLES = foundation_characters("japanese")
ADAPTER_VERSION = "1"
SVG = "{http://www.w3.org/2000/svg}"
FIRST_BATCH = (
    "\u3042\u3041\u304d\u304e\u3055\u3056\u306c\u306d\u306e\u3071\u3077\u3064\u3063"
    "\u30b7\u30c4\u30bd\u30f3\u30f4\u3094\u30f5\u30f6\u30fc\u309b\u309c\u3001\u3002"
    "\u3007\u79ed\u4e00\u52c9\u8fbb\u9b31\u3099\u309a"
)
ALTERNATIVES = {"\u79ed": (APL, "svgsJa/31213.svg", 9),
                "\u3007": (LGPL, "svgsJa/12295.svg", 1)}
BLOCKED = {"\u9c5d": "Exact Japanese U+9C5D is absent from both pinned sources; "
           "the 23-stroke KanjiVG donor recipe is review-only, not accepted artwork."}
ARCHIVES = {
    "kanjivg": {
        "repository": "KanjiVG/kanjivg",
        "commit": "422b5538595676da918c288a4230cb5e22a1ee7e",
        "sha256": "121aa4eeeaaceddf8678845b370b4ee2b8da1e2fc7e7dccb6415f30c150c72b3",
    },
    "animcjk": {
        "repository": "parsimonhi/animCJK",
        "commit": "ec5e17cca76c87587790bcbce5ea0b4d4fb753d6",
        "sha256": "a14501be93d89a27d7b8d62af4a0b3a98e2367a68597762eb8337bcb0170fea1",
    },
}
GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.txt"
GPL_SHA = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986"
NOTICE = """MODIFIED 2026-09-15: Japanese source-em-box monoline candidates; no visual approval.
KanjiVG: Copyright 2009/2010/2011 Ulrich Apel, https://kanjivg.tagaini.net/; CC BY-SA 3.0.
AnimCJK: Copyright 2016-2026 FM-SH, https://github.com/parsimonhi/animCJK.
U+79ED: Make Me a Hanzi / Arphic fonts, Copyright 1999 Arphic Technology Co., Ltd.; ARPHIC PUBLIC LICENSE.
U+3007: LGPL-3.0-or-later, as stated in the individual SVG; not ARPHIC.
Changes: select ordered centerlines, preserve original em-box proportions, normalize paths;
contextual combining marks use explicit source path-selection recipes.
This page is a collection of separately licensed artwork, not a blanket relicensing.
Retain original notices, licenses/writing-* and upstream/writing source bytes; no warranty."""


def local_path(root: Path, portable: str) -> Path:
    parts = PurePosixPath(portable)
    if ("\\" in portable or ":" in portable or parts.is_absolute()
            or ".." in parts.parts or str(parts) != portable):
        raise ValueError(f"Invalid language-relative input path: {portable}")
    result = root.joinpath(*parts.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Input escapes language directory: {portable}")
    return result


def source_path(provider: str, member: str) -> str:
    return f"upstream/writing/{provider}/{member}"


def source_request(character: str) -> tuple[str, str, str]:
    if character in ALTERNATIVES:
        source, member, _ = ALTERNATIVES[character]
        return "animcjk", member, source
    return "kanjivg", f"kanji/{ord(character):05x}.svg", KVG


def chosen_characters(inventory: dict, batch: str) -> list[str]:
    expected = set(inventory["required"]) | set(inventory["components"])
    if batch == "first":
        if not set(FIRST_BATCH) <= expected:
            raise ValueError("First batch disagrees with the shared Japanese inventory")
        return sorted(FIRST_BATCH)
    return sorted(expected)


def requested_members(characters: list[str], recipes: dict) -> dict:
    requested = {"kanjivg": {}, "animcjk": {}}
    for character in characters:
        if character in BLOCKED:
            continue
        if character in recipes["combining_marks"]:
            member = recipes["combining_marks"][character]["source_file"]
            requested["kanjivg"][member] = (source_path("kanjivg", member), KVG)
        else:
            provider, member, source = source_request(character)
            requested[provider][member] = (source_path(provider, member), source)
    for recipe in recipes["review_only"].values():
        for donor in recipe["donors"]:
            member = donor["source_file"]
            requested["kanjivg"][member] = (source_path("kanjivg", member), KVG)
    requested["kanjivg"].update({
        "README.md": ("licenses/writing-kanjivg-README.md", KVG),
        "COPYING": ("licenses/writing-kanjivg-COPYING.txt", KVG),
    })
    requested["animcjk"].update({
        "README.md": ("licenses/writing-animcjk-README.md", APL),
        "licenses/COPYING.txt": ("licenses/writing-animcjk-COPYING.txt", APL),
        "licenses/APL/english/ARPHICPL.TXT": ("licenses/writing-ARPHICPL.txt", APL),
        "licenses/LGPL.txt": ("licenses/writing-LGPL-3.0.txt", LGPL),
    })
    return requested


def download(root: Path, inventory: dict, batch: str, archive_directory: Path | None) -> None:
    recipes = load_yaml(root / "characters" / "recipes.yaml")
    requested = requested_members(chosen_characters(inventory, batch), recipes)
    pending, downloads = {}, []
    for provider, configuration in ARCHIVES.items():
        commit = configuration["commit"]
        url = f"https://codeload.github.com/{configuration['repository']}/tar.gz/{commit}"
        raw = ((archive_directory / f"{provider}-pinned.tar.gz").read_bytes()
               if archive_directory is not None else fetch(url, configuration["sha256"]))
        if sha256(raw) != configuration["sha256"]:
            raise ValueError(f"Pinned archive checksum mismatch: {provider}")
        found = set()
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            for member in archive:
                relative = member.name.partition("/")[2]
                if relative not in requested[provider]:
                    continue
                if not member.isfile() or relative in found:
                    raise ValueError(f"Invalid or duplicate archive member: {member.name}")
                found.add(relative)
                with archive.extractfile(member) as stream:
                    content = stream.read()
                destination, source = requested[provider][relative]
                pending[destination] = (content, source, commit)
        if found != set(requested[provider]):
            raise ValueError(f"Missing pinned {provider} members: {sorted(set(requested[provider]) - found)}")
        downloads.append({"provider": provider, "url": url, "sha256": sha256(raw), "bytes": len(raw)})
    gpl = fetch(GPL_URL, GPL_SHA)
    pending["licenses/writing-GPL-3.0.txt"] = (gpl, LGPL, "GPL-3.0")
    downloads.append({"provider": "gnu-gpl", "url": GPL_URL, "sha256": GPL_SHA, "bytes": len(gpl)})
    pins = []
    for name, (raw, source, version) in sorted(pending.items()):
        path = local_path(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        pins.append({"path": name, "sha256": sha256(raw), "source_id": source, "source_version": version})
    write_yaml(root / "upstream" / "writing" / "download-lock.yaml", {
        "version": 1, "source_revision_date": "2026-09-15", "batch": batch,
        "downloads": downloads, "inputs": pins,
    })


def load_inputs(root: Path) -> tuple[dict, list[dict], dict]:
    lock = load_yaml(root / "upstream" / "writing" / "download-lock.yaml")
    if not isinstance(lock, dict) or lock.get("version") != 1 or lock.get("batch") not in ("first", "full"):
        raise ValueError("Unsupported Japanese writing source lock")
    pins = lock.get("inputs")
    if not isinstance(pins, list):
        raise ValueError("Writing lock inputs must be a list")
    index = {}
    for pin in pins:
        if not isinstance(pin, dict) or set(pin) != {"path", "sha256", "source_id", "source_version"}:
            raise ValueError("Malformed Japanese writing input pin")
        name = pin["path"]
        if name in index:
            raise ValueError(f"Duplicate Japanese writing input: {name}")
        raw = local_path(root, name).read_bytes()
        if sha256(raw) != pin["sha256"]:
            raise ValueError(f"Source checksum mismatch: {name}")
        index[name] = (pin, raw)
    recipe_name = "characters/recipes.yaml"
    recipe_raw = local_path(root, recipe_name).read_bytes()
    recipes = load_yaml(local_path(root, recipe_name))
    if recipes.get("version") != "1" or recipes.get("source_id") != RECIPES:
        raise ValueError("Unsupported Japanese writing recipes")
    recipe_pin = {"path": recipe_name, "sha256": sha256(recipe_raw),
                  "source_id": RECIPES, "source_version": recipes["version"]}
    index[recipe_name] = (recipe_pin, recipe_raw)
    notice_name = "licenses/writing-recipes-NOTICE.txt"
    notice_raw = local_path(root, notice_name).read_bytes()
    notice_pin = {"path": notice_name, "sha256": sha256(notice_raw),
                  "source_id": RECIPES, "source_version": recipes["version"]}
    index[notice_name] = (notice_pin, notice_raw)
    return index, pins + [recipe_pin, notice_pin], recipes


def svg_root(raw: bytes, size: int) -> ET.Element:
    if b"<!ENTITY" in raw.upper():
        raise ValueError("SVG entity declarations are not permitted")
    root = ET.fromstring(raw)
    if root.tag != SVG + "svg" or root.get("viewBox") != f"0 0 {size} {size}":
        raise ValueError(f"Unexpected SVG root or original {size}-unit em frame")
    for element in root.iter():
        if element.tag in {SVG + "script", SVG + "foreignObject", SVG + "image"}:
            raise ValueError("External or executable SVG content is not permitted")
        if any(key.lower().startswith("on") for key in element.attrib):
            raise ValueError("Executable SVG attributes are not permitted")
        if any((key == "href" or key.endswith("}href")) and not value.startswith("#")
               for key, value in element.attrib.items()):
            raise ValueError("External SVG references are not permitted")
    return root


def metadata(element: ET.Element, name: str) -> str | None:
    values = [value for key, value in element.attrib.items()
              if key in (f"{{https://kanjivg.tagaini.net/}}{name}",
                         f"{{http://kanjivg.tagaini.net}}{name}")]
    if len(set(values)) > 1:
        raise ValueError(f"Conflicting KanjiVG {name} metadata")
    return values[0] if values else None


def kanjivg_paths(raw: bytes, character: str) -> tuple[ET.Element, list[ET.Element]]:
    root = svg_root(raw, 109)
    code = f"{ord(character):05x}"
    groups = [g for g in root.iter(SVG + "g") if g.get("id") == f"kvg:StrokePaths_{code}"]
    if len(groups) != 1:
        raise ValueError("Missing or duplicate KanjiVG stroke group")
    group = groups[0]
    glyphs = [g for g in group.iter(SVG + "g") if g.get("id") == f"kvg:{code}"]
    if len(glyphs) != 1 or metadata(glyphs[0], "element") != character:
        raise ValueError("KanjiVG character identity disagrees with requested scalar")
    if any("transform" in element.attrib for element in group.iter()):
        raise ValueError("Unexpected KanjiVG group transform; explicit adaptation required")
    paths = list(group.iter(SVG + "path"))
    expected = [f"kvg:{code}-s{index}" for index in range(1, len(paths) + 1)]
    if not paths or [p.get("id") for p in paths] != expected:
        raise ValueError("KanjiVG stroke IDs must be contiguous, unique and in pen order")
    return root, paths


def animcjk_paths(raw: bytes, character: str, expected_count: int) -> tuple[ET.Element, list[ET.Element]]:
    root = svg_root(raw, 1024)
    if root.get("id") != f"z{ord(character)}" or any("transform" in e.attrib for e in root.iter()):
        raise ValueError("Unexpected animCJK glyph identity or transform")
    prefix = f"z{ord(character)}"
    all_paths = list(root.iter(SVG + "path"))
    outline_nodes = [p for p in all_paths if p.get("id")]
    clip_nodes = list(root.iter(SVG + "clipPath"))
    outlines = {p.get("id"): p for p in outline_nodes}
    clips = {p.get("id"): p for p in clip_nodes}
    medians = [p for p in root.iter(SVG + "path") if p.get("clip-path")]
    expected_ids = {f"{prefix}d{i}" for i in range(1, expected_count + 1)}
    if (len(medians) != expected_count or set(outlines) != expected_ids
            or len(outline_nodes) != expected_count or len(clips) != expected_count
            or len(clip_nodes) != expected_count or len(all_paths) != expected_count * 2):
        raise ValueError("Ambiguous/split animCJK strokes require an explicit reviewed mapping")
    for index, median in enumerate(medians, 1):
        clip_id = f"{prefix}c{index}"
        clip = clips.get(clip_id)
        uses = [] if clip is None else list(clip)
        if (median.get("clip-path") != f"url(#{clip_id})" or len(uses) != 1
                or uses[0].tag != SVG + "use" or uses[0].get("href") != f"#{prefix}d{index}"
                or median.get("style") != f"--d:{index}s;"):
            raise ValueError("animCJK median order/clip mapping disagrees with logical strokes")
    return root, medians


def normalized_strokes(paths: list[ET.Element], size: int) -> list[dict]:
    result = []
    matrix = [100 / size, 0, 0, 100 / size, 0, 0]
    for element in paths:
        paths = normalize_svg_path(element.get("d", ""), matrix)
        if len(paths) != 1:
            raise ValueError("One logical stroke cannot contain disconnected SVG subpaths")
        result.append({"path": paths[0]})
    return result


def provenance(pin: dict, entry: str) -> dict:
    return {"source_id": pin["source_id"], "source_entry": entry,
            "input": pin["path"], "sha256": pin["sha256"]}


def classify(character: str) -> tuple[str, str]:
    return script_of(character), FOUNDATION_ROLES.get(
        character, "sign" if character == "\u3005" else "character"
    )


def make_record(character: str, paths: list[ET.Element], pin: dict, entry: str, size: int) -> dict:
    script, kind = classify(character)
    return {
        "script": script, "kind": kind, "default_variant": "japanese-source",
        "variants": [{
            "id": "japanese-source", "locale": "ja-JP",
            "strokes": normalized_strokes(paths, size),
            "provenance": [provenance(pin, entry)],
            "transform": {"id": "original-source-em-box", "version": "1",
                          "source_frame": [0, 0, size, size],
                          "matrix": [100 / size, 0, 0, 100 / size, 0, 0]},
            "status": {"generated": True, "validated": True, "reviewed": False},
        }],
    }


def select_paths(paths: list[ET.Element], identifiers: list[str]) -> list[ET.Element]:
    selected = [p for p in paths if p.get("id") in identifiers]
    if not selected or [p.get("id") for p in selected] != identifiers:
        raise ValueError("Recipe paths disagree with source stroke identities/order")
    return selected


def build_records(root: Path, inventory: dict, batch: str) -> tuple[dict, list[dict], dict]:
    inputs, pins, recipes = load_inputs(root)
    records = {}
    recipe_pin = inputs["characters/recipes.yaml"][0]
    for character in chosen_characters(inventory, batch):
        if character in BLOCKED:
            continue
        if character in recipes["combining_marks"]:
            recipe = recipes["combining_marks"][character]
            name = source_path("kanjivg", recipe["source_file"])
            if name not in inputs:
                raise ValueError(f"Missing selected source input {name}; download the requested batch explicitly")
            pin, raw = inputs[name]
            _, paths = kanjivg_paths(raw, recipe["source_character"])
            paths = select_paths(paths, recipe["path_ids"])
            record = make_record(character, paths, pin, recipe["source_file"] + ":" + ",".join(recipe["path_ids"]), 109)
            variant = record["variants"][0]
            variant["recipe"] = {"id": f"contextual-mark-{ord(character):04x}", "version": recipes["version"],
                                 "input": recipe_pin["path"], "sha256": recipe_pin["sha256"]}
            variant["provenance"].append(provenance(recipe_pin, f"combining_marks.U+{ord(character):04X}"))
            variant["components"] = [{"character": recipe["source_character"], "role": recipe["role"],
                                      "source_id": KVG}]
        else:
            provider, member, source = source_request(character)
            name = source_path(provider, member)
            if name not in inputs:
                raise ValueError(f"Missing selected source input {name}; download the requested batch explicitly")
            pin, raw = inputs[name]
            if pin["source_id"] != source:
                raise ValueError(f"Source identity mismatch for U+{ord(character):04X}")
            if provider == "kanjivg":
                _, paths = kanjivg_paths(raw, character)
                size = 109
            else:
                _, paths = animcjk_paths(raw, character, ALTERNATIVES[character][2])
                size = 1024
            record = make_record(character, paths, pin, member, size)
        records[character] = record
    return records, pins, recipes


def review_only_fish(root: Path) -> dict:
    inputs, _, recipes = load_inputs(root)
    selected, evidence = [], []
    for donor in recipes["review_only"]["\u9c5d"]["donors"]:
        name = source_path("kanjivg", donor["source_file"])
        pin, raw = inputs[name]
        svg, paths = kanjivg_paths(raw, donor["source_character"])
        groups = [g for g in svg.iter(SVG + "g") if g.get("id") == donor["group_id"]]
        if (len(groups) != 1 or metadata(groups[0], "element") != donor["component"]
                or metadata(groups[0], "position") != donor["position"]):
            raise ValueError("Fish review recipe donor component metadata disagrees")
        selected.extend(select_paths(list(groups[0].iter(SVG + "path")), donor["path_ids"]))
        evidence.append(provenance(pin, donor["source_file"] + "#" + donor["group_id"]))
    if len(selected) != 23:
        raise ValueError("Fish review-only composition must contain exactly 23 source pen-downs")
    recipe_pin = inputs["characters/recipes.yaml"][0]
    evidence.append(provenance(recipe_pin, "review_only.U+9C5D"))
    return {"character": "\u9c5d", "blocked": BLOCKED["\u9c5d"], "strokes": normalized_strokes(selected, 109),
            "provenance": evidence, "reviewed": False,
            "recipe": {"id": "fish-left-ben-right-review-only", "version": recipes["version"],
                       "input": recipe_pin["path"], "sha256": recipe_pin["sha256"]},
            "transform": {"id": "original-source-em-box", "version": "1",
                          "source_frame": [0, 0, 109, 109], "matrix": [100/109, 0, 0, 100/109, 0, 0]}}


def source_preview(root: Path, character: str, origins: list[dict]) -> str:
    parts = []
    for origin in origins:
        if not origin["input"].endswith(".svg"):
            continue
        provider = "kanjivg" if origin["source_id"] == KVG else "animcjk"
        size = 109 if provider == "kanjivg" else 1024
        svg = svg_root(local_path(root, origin["input"]).read_bytes(), size)
        if provider == "kanjivg":
            paths = [p for p in svg.iter(SVG + "path") if p.get("id", "").startswith("kvg:")]
            style = "fill='none' stroke='#17354c' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'"
        else:
            paths = [p for p in svg.iter(SVG + "path") if p.get("id")]
            style = "fill='#17354c' stroke='none'"
        parts.append(f"<svg viewBox='0 0 {size} {size}' aria-label='Original source reference for U+{ord(character):04X}'>")
        parts.extend(f"<path d='{html.escape(p.get('d', ''), quote=True)}' {style}/>" for p in paths)
        parts.append("</svg>")
    return "".join(parts)


def write_review(root: Path, directory: Path, records: dict, pins: list[dict], fish: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for pin in pins:
        destination = local_path(directory, pin["path"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path(root, pin["path"]), destination)
    evidence = {"notice": NOTICE, "candidates": records, "review_only": fish}
    (directory / "candidates.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
                                              encoding="utf-8")
    parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><title>Japanese writing first batch</title>",
             "<style>body{font:16px system-ui;margin:20px;background:#eef1f4;color:#14283a}"
             "main{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}"
             "article{background:white;padding:12px;border-radius:8px}svg{width:100%;max-width:240px}"
             ".source{display:flex}.source svg{max-width:100px}.source-title{font-size:12px}"
             "h2{margin:0;font-size:24px}small{overflow-wrap:anywhere}.guide path{fill:none;stroke:#17354c;"
             "stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}"
             ".guide .grid{stroke:#ddd;stroke-width:.4}text{font-size:4px;fill:#b14c24}"
             "body.play .ink{stroke-dasharray:1;stroke-dashoffset:1;"
             "animation:draw .7s linear forwards;animation-delay:var(--delay)}"
             "@keyframes draw{to{stroke-dashoffset:0}}pre{white-space:pre-wrap;font-size:11px}</style>",
             "<h1>Japanese source-backed candidates - all unreviewed</h1>"
             "<p>Same final paths for static guide, ordered animation and matching samples. "
             "No terminal corrections, per-glyph fitting or professional approval. "
             "The separate fish composition remains blocked. Small original-source thumbnails show "
             "unmodified centerlines/outlines; mark records show their full source kana. "
             "Source bytes and complete licenses accompany this page.</p>"
             "<button id='replay'>Replay ordered strokes</button><main>"]
    items = [(c, r["variants"][0]["strokes"], r["variants"][0]["provenance"], False)
             for c, r in sorted(records.items())]
    items.append((fish["character"], fish["strokes"], fish["provenance"], True))
    for character, strokes, origins, blocked in items:
        label = "BLOCKED REVIEW FIXTURE" if blocked else "unreviewed candidate"
        parts.append(f"<article><h2>{character} <small>U+{ord(character):04X}</small></h2>"
                     f"<p>{len(strokes)} pen-downs; {label}</p><div class='source-title'>Original source</div>"
                     f"<div class='source'>{source_preview(root, character, origins)}</div>"
                     "<div class='source-title'>100-unit candidate</div><svg class='guide' viewBox='0 0 100 100'>"
                     "<path class='grid' d='M0 50 L100 50 M50 0 L50 100'/>")
        for index, stroke in enumerate(strokes):
            samples = sample_path(stroke["path"])
            x, y = samples[0]
            parts.append(f"<path class='ink' pathLength='1' style='--delay:{index*.8:.1f}s' "
                         f"d='{html.escape(stroke['path'], quote=True)}'/>"
                         f"<text x='{max(1,x-4):.2f}' y='{max(4,y-3):.2f}'>{index+1}</text>")
        parts.append("</svg><small>" + "<br>".join(html.escape(p["source_entry"]) for p in origins)
                     + "</small></article>")
    parts.append("</main><h2>Modification and license notice</h2><pre>" + html.escape(NOTICE) + "</pre>"
                 "<script>document.getElementById('replay').onclick=()=>{document.body.classList.remove('play');"
                 "void document.body.offsetWidth;document.body.classList.add('play')};</script></html>")
    (directory / "index.html").write_text("\n".join(parts), encoding="utf-8")


def locked_batch(root: Path) -> str:
    lock = load_yaml(root / "upstream" / "writing" / "download-lock.yaml")
    if not isinstance(lock, dict) or lock.get("batch") not in ("first", "full"):
        raise ValueError("Writing source lock must declare first/full batch")
    return lock["batch"]


def generate(root: Path = ROOT, *, batch: str | None = None, check: bool = False,
             review_directory: Path | None = None) -> tuple[list[str], dict]:
    if check and review_directory is not None:
        raise ValueError("--check cannot write review artifacts")
    batch = batch or locked_batch(root)
    inventory = extract_inventory(root.parent, "japanese")
    records, inputs, _ = build_records(root, inventory, batch)
    blocked = {c: reason for c, reason in BLOCKED.items() if c in inventory["required"]}
    outputs = build_outputs(root, records, inventory, inputs, adapter="japanese-source-centerlines",
                            adapter_version=ADAPTER_VERSION, blocked=blocked, notice=NOTICE)
    stale = write_outputs(root, outputs, check=check)
    if review_directory is not None:
        write_review(root, review_directory, records, inputs, review_only_fish(root))
    return stale, {"candidates": len(records), "reviewed": 0, "blocked": blocked, "batch": batch}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Fetch fixed archives and retain selected original SVGs/notices")
    parser.add_argument("--archive-directory", type=Path, help="Use checksum-verified cached archives with --download")
    parser.add_argument("--batch", choices=("first", "full"), help="Defaults to the pinned source lock's batch")
    checking = parser.add_mutually_exclusive_group()
    checking.add_argument("--check", action="store_true", help="Compare generated output without any writes/network")
    checking.add_argument("--validate-only", action="store_true", help="Run the shared committed-bundle checker without writes")
    parser.add_argument("--review-directory", type=Path, help="Write a separate unreviewed geometry/animation fixture")
    args = parser.parse_args()
    if (args.check or args.validate_only) and (args.download or args.archive_directory or args.review_directory):
        parser.error("Check/validation mode cannot download or write review artifacts")
    if args.validate_only:
        coverage = validate_bundle(ROOT)
        print(json.dumps({"drawable": len(coverage["drawable"]), "reviewed": len(coverage["reviewed"]),
                          "missing": len(coverage["missing"]), "release_ready": coverage["release_ready"]}))
        return
    if args.archive_directory and not args.download:
        parser.error("--archive-directory requires --download")
    if args.download:
        download(ROOT, extract_inventory(ROOT.parent, "japanese"), args.batch or locked_batch(ROOT),
                 args.archive_directory)
    stale, summary = generate(batch=args.batch, check=args.check, review_directory=args.review_directory)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    if args.check and stale:
        raise SystemExit("Stale Japanese writing outputs: " + ", ".join(stale))


if __name__ == "__main__":
    main()
