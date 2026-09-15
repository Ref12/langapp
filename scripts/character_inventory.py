"""Extract exact writing requirements from expanded curriculum fields, never English glosses."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from pathlib import Path
import re
import sys
import unicodedata

import yaml

from curriculum_yaml import dump_yaml, load_yaml
from generate_practical_program import program_outputs, validate_references
from generate_teaching_track import load_reference_index, resolve_sequence, teaching_outputs
from practical_program_registry import REGISTRATIONS, get_adapter
from practical_program_types import ProgramData


POLICY_VERSION = "curriculum-writing-inventory-v2"
LANGUAGES = ("chinese", "japanese", "korean")
KINDS = ("required", "component", "notation", "literal_sign", "literal_cross_script", "whitespace")
TEACHING_INPUT_FILES = (
    "teaching/program.yaml", "teaching/mastery.yaml",
    "authoring/teaching/vocabulary.yaml", "authoring/teaching/grammar.yaml",
    "authoring/teaching/support.yaml", "teaching/tourist/plan.yaml",
)
SHARED_TOOL_FILES = (
    "curriculum_yaml.py", "generate_curriculum_tokens.py", "generate_teaching_track.py",
    "generate_practical_program.py", "practical_program_registry.py", "practical_program_types.py",
)
ADAPTER_EXTRA_TOOL_FILES = {"japanese": ("import_japanese_curriculum.py",)}
KANA_READING = re.compile(r"[\u3041-\u3096\u3099\u309a\u30a1-\u30fa\u30fc\u30fb\uff65\u301c\uff5e\s]+")
HAN_RANGES = (
    (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF),
    (0x20000, 0x2A6DF), (0x2A700, 0x2B73F), (0x2B740, 0x2B81F),
    (0x2B820, 0x2CEAF), (0x2CEB0, 0x2EBEF), (0x2EBF0, 0x2EE5F),
    (0x2F800, 0x2FA1F), (0x30000, 0x3134F), (0x31350, 0x323AF),
)


def script_of(character: str) -> str:
    """Explicit Unicode script families needed by this inventory, without folding."""
    cp = ord(character)
    if cp in (0x3005, 0x3007) or any(low <= cp <= high for low, high in HAN_RANGES):
        return "Han"
    if 0x3041 <= cp <= 0x3096 or cp in (0x309D, 0x309E, 0x309F):
        return "Hiragana"
    if 0x30A1 <= cp <= 0x30FA or 0x31F0 <= cp <= 0x31FF or cp in (0x30FD, 0x30FE, 0x30FF):
        return "Katakana"
    if (0x1100 <= cp <= 0x11FF or 0x3131 <= cp <= 0x318E or 0xA960 <= cp <= 0xA97F
            or 0xAC00 <= cp <= 0xD7A3 or 0xD7B0 <= cp <= 0xD7FF):
        return "Hangul"
    if cp in (0x3099, 0x309A) or unicodedata.category(character).startswith("M"):
        return "Inherited"
    return "Common"


def foundation_characters(language: str) -> dict[str, str]:
    """Exact approved modern foundations: character/component/sign roles, not font expansion."""
    if language not in LANGUAGES:
        raise ValueError(f"unknown language {language}")
    result = {}
    if language == "japanese":
        excluded = {0x3090, 0x3091, 0x30F0, 0x30F1, 0x30F7, 0x30F8, 0x30F9, 0x30FA}
        for cp in (*range(0x3041, 0x3097), *range(0x30A1, 0x30FB)):
            if cp not in excluded:
                result[chr(cp)] = "character"
        for cp in (0x3001, 0x3002, 0x3007, 0x309B, 0x309C, 0x30FB, 0x30FC):
            result[chr(cp)] = "sign"
        for cp in (0x3099, 0x309A):
            result[chr(cp)] = "component"
    elif language == "korean":
        result.update({chr(cp): "character" for cp in range(0x3131, 0x3164)})
        for low, high in ((0x1100, 0x1113), (0x1161, 0x1176), (0x11A8, 0x11C3)):
            result.update({chr(cp): "component" for cp in range(low, high)})
    return dict(sorted(result.items()))


def _text(value, location: str, *, empty: bool = False) -> str:
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise ValueError(f"{location}: expected {'possibly empty ' if empty else ''}text")
    if "\ufffd" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValueError(f"{location}: invalid Unicode")
    return value


def _records(value, location: str) -> list[dict]:
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise ValueError(f"{location}: expected list of mappings")
    return value


def _classify(character: str, language: str, notation: bool) -> str:
    if character.isspace():
        return "whitespace"
    script = script_of(character)
    if script in {"chinese": {"Han"}, "japanese": {"Han", "Hiragana", "Katakana"},
                  "korean": {"Hangul"}}[language]:
        return "required"
    if language == "japanese" and character in foundation_characters(language):
        return "component" if ord(character) in (0x3099, 0x309A) else "required"
    if notation:
        return "notation"
    if unicodedata.category(character)[0] in ("P", "S", "N"):
        return "literal_sign"
    return "literal_cross_script"


def extract_inventory(curriculum_root: Path, language: str) -> dict:
    """Return a checksummed inventory with independent reference/teaching/foundation scopes."""
    if language not in LANGUAGES:
        raise ValueError(f"unknown language {language}")
    root = curriculum_root.resolve()
    language_root = root / language
    inputs, evidence, scopes = {}, {}, {}

    def read(path: Path, *, document: bool = False, expected: str | None = None):
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise ValueError(f"inventory input escapes curriculum root: {path}")
        raw = path.read_bytes()
        if expected is not None and raw.decode("utf-8").replace("\r\n", "\n") != expected:
            raise ValueError(f"Missing or stale teaching view: {path}")
        inputs[path.relative_to(root).as_posix()] = hashlib.sha256(raw).hexdigest()
        return raw.decode("utf-8-sig") if document else load_yaml(path)

    def add(text: str, scope: str, file: str, field: str, entry: str, *,
            notation: bool = False, forced: str | None = None, reason: str | None = None,
            notation_chars: str = ""):
        _text(text, f"{file}:{entry}.{field}", empty=True)
        scope_sets = scopes.setdefault(scope, {kind: set() for kind in KINDS})
        for character, count in Counter(text).items():
            kind = forced or _classify(character, language, notation or character in notation_chars)
            scope_sets[kind].add(character)
            rows = evidence.setdefault(character, {})
            key = (scope, file, field, kind)
            if key not in rows:
                rows[key] = {"scope": scope, "file": file, "field": field,
                             "classification": kind, "first_entry": entry, "occurrences": 0}
                if reason:
                    rows[key]["reason"] = reason
            rows[key]["occurrences"] += count

    def word(row, scope, file):
        identifier = _text(row.get("id"), f"{file}.id")
        target = _text(row.get("target"), f"{identifier}.target")
        affix = language == "korean" and (target.startswith("-") or target.endswith("-"))
        add(target, scope, file, "target", identifier, notation_chars="-" if affix else "")
        if language == "japanese":
            add(_text(row.get("reading"), f"{identifier}.reading", empty=True),
                scope, file, "reading", identifier)

    def grammar(row, scope, file):
        identifier = _text(row.get("id"), f"{file}.id")
        add(_text(row.get("pattern"), f"{identifier}.pattern"), scope, file,
            "pattern", identifier, notation=True)
        if "token_form" in row:
            add(_text(row["token_form"], f"{identifier}.token_form"), scope, file,
                "token_form", identifier, notation=True)
        for index, example in enumerate(_records(row.get("examples"), f"{identifier}.examples")):
            add(_text(example.get("target"), f"{identifier}.examples.target"),
                scope, file, "examples.target", f"{identifier}[{index}]")
            if language == "japanese" and "reading" in example:
                add(_text(example["reading"], f"{identifier}.examples.reading", empty=True),
                    scope, file, "examples.reading", f"{identifier}[{index}]")

    def canonical_reading(value, scope, file, field, identifier):
        if language == "japanese":
            reading = _text(value, f"{identifier}.{field}")
            if not KANA_READING.fullmatch(reading):
                raise ValueError(f"{identifier}: Japanese canonical reading must be kana")
            add(reading, scope, file, field, identifier)

    def canonical_units(units, scope, file):
        for unit in _records(units, f"{file}.units"):
            for field in ("vocabulary", "review_vocabulary", "grammar", "review_grammar", "phrases"):
                for entry in _records(unit.get(field, []), f"{file}.{field}"):
                    identifier = _text(entry.get("id"), f"{file}.{field}.id")
                    target = _text(entry.get("ch"), f"{identifier}.ch")
                    is_grammar = field in ("grammar", "review_grammar")
                    affix = language == "korean" and (target.startswith("-") or target.endswith("-"))
                    add(target, scope, file, f"{field}.ch", identifier, notation=is_grammar,
                        notation_chars="-" if affix and field != "phrases" else "")
                    if language == "japanese" and not is_grammar:
                        # Canonical Japanese pr is documented kana, not generic pronunciation metadata.
                        canonical_reading(entry.get("pr"), scope, file, f"{field}.pr", identifier)
                    if field == "phrases":
                        components = unit["phrase_components"][identifier]
                        if isinstance(components, dict):
                            for index, segment in enumerate(components["realizations"]):
                                # Preserve exact written realizations even when the engine accepts NFC equivalence.
                                locator = f"{identifier}.realizations[{index}]"
                                add(segment["ch"], scope, file, "phrase_components.realizations.ch", locator)
                                canonical_reading(segment["pr"], scope, file, "phrase_components.realizations.pr", locator)

    catalog = read(root / "catalog.yaml")
    if not isinstance(catalog, dict) or catalog.get("schema_version") != 1:
        raise ValueError("invalid catalog schema")
    matches = [entry for entry in _records(catalog.get("languages"), "catalog.languages")
               if entry.get("id") == language]
    if len(matches) != 1:
        raise ValueError(f"catalog must declare {language} exactly once")
    declaration = matches[0]
    levels = declaration.get("levels")
    if not isinstance(levels, list) or not levels or len(levels) != len(set(levels)):
        raise ValueError("catalog levels must be a nonempty unique list")
    words, patterns, locations = {}, {}, {}
    for level in levels:
        if not isinstance(level, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", level):
            raise ValueError("invalid level directory")
        for filename, consumer, index in (("vocabulary.yaml", word, words),
                                           ("grammar.yaml", grammar, patterns)):
            path = language_root / level / filename
            file = path.relative_to(root).as_posix()
            for row in _records(read(path), file):
                identifier = _text(row.get("id"), f"{file}.id")
                if identifier in index:
                    raise ValueError(f"duplicate inventory entry ID: {identifier}")
                index[identifier] = row
                locations[identifier] = file
                consumer(row, f"reference:{level}", file)
                for sense in _records(row.get("senses", []), f"{identifier}.senses"):
                    sense_id = _text(sense.get("id"), f"{identifier}.sense.id")
                    if sense_id in index:
                        raise ValueError(f"duplicate sense ID: {sense_id}")
                    index[sense_id] = row
                    locations[sense_id] = file
    tracks = declaration.get("teaching_tracks", [])
    if not isinstance(tracks, list) or not all(isinstance(track, str) and re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*", track) for track in tracks) or len(tracks) != len(set(tracks)):
        raise ValueError("invalid teaching track list")
    registration = REGISTRATIONS[language]
    if "teaching_program" in declaration and declaration["teaching_program"] != registration.program_id:
        raise ValueError(f"unsupported teaching_program; expected {registration.program_id}")
    program_enabled = "teaching_program" in declaration
    adapter = data = None
    if program_enabled or (tracks and language != "chinese"):
        adapter = get_adapter(language)
        data = adapter.load(language_root)
        if not isinstance(data, ProgramData):
            raise ValueError("Active teaching adapter must return ProgramData")
        validate_references(data.references, adapter.profile)
        read(language_root / "sources.yaml", document=True)
        for name in TEACHING_INPUT_FILES:
            read(language_root / name, document=True)
    if program_enabled:
        outputs = program_outputs(language_root, data, adapter)
        for path, expected in outputs.items():
            read(path, document=True, expected=expected)
        core_path = language_root / "teaching" / "core" / "sequence.yaml"
        core = read(core_path)
        for phase in core["phases"]:
            for level in phase["levels"]:
                canonical_units(
                    level["units"], f"teaching:program:{registration.program_id}:level-{level['number']:02d}",
                    core_path.relative_to(root).as_posix(),
                )
        for extension in data.inputs["program"]["extensions"]:
            path = language_root / "teaching" / "extensions" / extension["id"] / "sequence.yaml"
            canonical_units(read(path)["units"], f"teaching:program:{registration.program_id}:extension:{extension['id']}",
                            path.relative_to(root).as_posix())
        path = language_root / "teaching" / "tourist" / "sequence.yaml"
        canonical_units(read(path)["units"], f"teaching:program:{registration.program_id}:tourist",
                        path.relative_to(root).as_posix())
    if tracks:
        if language == "chinese":
            additional_path = language_root / "reference-senses.yaml"
            for row in _records(read(additional_path), "reference-senses"):
                for sense in _records(row.get("senses"), "additional.senses"):
                    identifier = _text(sense.get("id"), "additional.sense.id")
                    if identifier in words:
                        raise ValueError(f"duplicate additional sense: {identifier}")
                    words[identifier] = row
                    locations[identifier] = additional_path.relative_to(root).as_posix()
            word_index, pattern_index = load_reference_index(language_root)
        else:
            word_index, pattern_index = data.references.vocabulary, data.references.grammar
        for track in tracks:
            sequence_path = language_root / "teaching" / track / "sequence.yaml"
            raw_sequence = read(sequence_path)
            sequence = resolve_sequence(raw_sequence, word_index, pattern_index,
                                        language=language, prefix=registration.prefix)
            for path, expected in teaching_outputs(
                    sequence_path.parent, raw_sequence, word_index, pattern_index,
                    language=language, prefix=registration.prefix).items():
                read(path, document=True, expected=expected)
            canonical_units(sequence["units"], f"teaching:{track}", sequence_path.relative_to(root).as_posix())
            # Legacy Chinese tracks also retain their selected expanded examples and reference scope evidence.
            if language == "chinese":
                for unit in sequence["units"]:
                    for field, lookup, consumer in (
                        ("vocabulary", words, word), ("review_vocabulary", words, word),
                        ("grammar", patterns, grammar), ("review_grammar", patterns, grammar),
                    ):
                        for entry in unit[field]:
                            consumer(lookup[entry["id"]], f"teaching:{track}", locations[entry["id"]])
    for character, role in foundation_characters(language).items():
        add(character, "foundation:modern-script", "shared-policy", "foundation", POLICY_VERSION,
            forced="component" if role == "component" else "required",
            reason="Approved modern script prerequisite; not a reference-level assignment")
    if language == "korean":
        path = language_root / "README.md"
        content = read(path, document=True)
        for character, phrase in (("\uaf9c", "\ud559\uad50 [\ud559\uaf9c]"),
                                  ("\uc62b", "\uc637 [\uc62b]")):
            if phrase not in content:
                raise ValueError(f"Korean supplemental requirement citation is stale: {phrase}")
            add(character, "supplemental:phonetic-display-support", "korean/README.md",
                "Hangul, pronunciation and pragmatic prerequisites", phrase, forced="required",
                reason="Explicit broad pronunciation display, not standard vocabulary spelling")
    requirements = language_root / "characters" / "requirements.yaml"
    if requirements.exists():
        additions = read(requirements)
        if (not isinstance(additions, dict) or set(additions) != {"schema_version", "characters"}
                or additions["schema_version"] != 1 or not isinstance(additions["characters"], dict)):
            raise ValueError("requirements.yaml expects schema_version:1 and characters mapping")
        for character, item in additions["characters"].items():
            if not isinstance(character, str) or len(character) != 1:
                raise ValueError("supplemental keys must be exact scalars")
            if not isinstance(item, dict) or set(item) != {"kind", "reason", "source"}:
                raise ValueError("supplemental entry needs kind, reason, source")
            if item["kind"] not in ("character", "component", "sign"):
                raise ValueError("invalid supplemental kind")
            reason = _text(item["reason"], "supplemental.reason")
            source = _text(item["source"], "supplemental.source")
            file, marker, locator = source.partition("#")
            if not marker or not locator or "\\" in file or ":" in file or ".." in file.split("/"):
                raise ValueError("supplemental source must be language-relative file#exact quoted text")
            citation = read(language_root / file, document=True)
            if locator not in citation:
                raise ValueError(f"supplemental citation text not found: {source}")
            add(character, "supplemental:authored", f"{language}/{file}", "explicit-requirement",
                locator, forced="component" if item["kind"] == "component" else "required", reason=reason)
    sets = {kind: set().union(*(scope[kind] for scope in scopes.values())) for kind in KINDS}
    sets["component"] -= sets["required"]
    characters = {}
    for character in sorted(evidence):
        classifications = sorted({row["classification"] for row in evidence[character].values()})
        characters[character] = {
            "codepoint": f"U+{ord(character):04X}", "script": script_of(character),
            "classifications": classifications,
            "evidence": [evidence[character][key] for key in sorted(evidence[character])],
        }
    references = set().union(*(scope["required"] | scope["component"]
                               for name, scope in scopes.items() if name.startswith("reference:")))
    teaching = set().union(*(scope["required"] | scope["component"]
                            for name, scope in scopes.items() if name.startswith("teaching:")))
    writing = sets["required"] | sets["component"]
    tool_files = set(SHARED_TOOL_FILES)
    if adapter is not None:
        tool_files.add(registration.module + ".py")
        tool_files.update(ADAPTER_EXTRA_TOOL_FILES.get(language, ()))
    return {
        "schema_version": 1, "language": language, "policy_version": POLICY_VERSION,
        "unicode_version": unicodedata.unidata_version,
        "inputs": [{"path": path, "sha256": inputs[path]} for path in sorted(inputs)],
        "tool_inputs": [
            {"file": name, "sha256": hashlib.sha256(
                Path(__file__).with_name(name).read_bytes().replace(b"\r\n", b"\n"),
            ).hexdigest()} for name in sorted(tool_files)
        ],
        "required": sorted(sets["required"]), "components": sorted(sets["component"]),
        "literal_cross_script": sorted(sets["literal_cross_script"] - writing),
        "literal_signs": sorted(sets["literal_sign"] - writing),
        "notation": sorted(sets["notation"] - writing),
        "characters": characters,
        "scopes": {name: {kind: sorted(chars) for kind, chars in scopes[name].items()}
                   for name in sorted(scopes)},
        "counts": {
            "reference": len(references), "teaching": len(teaching),
            "teaching_only": len(teaching - references),
            "foundation": len(foundation_characters(language)),
            "required": len(sets["required"]), "component_only": len(sets["component"]),
            "writing": len(writing),
            "by_script": dict(sorted(Counter(script_of(char) for char in writing).items())),
            "literal_cross_script": len(sets["literal_cross_script"] - writing),
            "literal_signs": len(sets["literal_sign"] - writing),
        },
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=LANGUAGES, required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "curriculum")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--output", type=Path, help="Write the full inventory as UTF-8 YAML")
    output.add_argument("--check", type=Path, help="Compare a saved inventory without writing")
    args = parser.parse_args()
    try:
        inventory = extract_inventory(args.root, args.language)
        content = dump_yaml(inventory)
        if args.check:
            if not args.check.is_file() or args.check.read_bytes() != content.encode("utf-8"):
                raise ValueError(f"stale inventory: {args.check}")
        elif args.output:
            args.output.write_text(content, encoding="utf-8", newline="\n")
        print(dump_yaml({"language": args.language, "counts": inventory["counts"],
                         "literal_cross_script": inventory["literal_cross_script"],
                         "literal_signs": inventory["literal_signs"]}), end="")
        return 0
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
