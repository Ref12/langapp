"""Validated v1 character asset records and deterministic offline bundle utilities."""

from __future__ import annotations

from datetime import date
import hashlib
from pathlib import Path, PurePosixPath
import re
from typing import Literal, NotRequired, TypedDict

from character_geometry import SAMPLING, STYLE, finite_number, validate_path
from curriculum_yaml import dump_yaml, load_yaml


LANGUAGES = ("chinese", "japanese", "korean")
SCRIPTS = ("Han", "Hiragana", "Katakana", "Hangul", "Common", "Inherited")
SCHEMA_VERSION = 1


class InputPin(TypedDict):
    path: str
    sha256: str
    source_id: str
    source_version: str


class Provenance(TypedDict):
    source_id: str
    source_entry: str
    input: str
    sha256: str


class Stroke(TypedDict):
    path: str


class Version(TypedDict):
    id: str
    version: str


class Transform(Version):
    source_frame: list[float]
    matrix: list[float]


class Recipe(Version):
    input: str
    sha256: str


class Status(TypedDict):
    generated: bool
    validated: bool
    reviewed: bool


class Review(TypedDict):
    reviewer: str
    date: str
    note: str


class Alias(TypedDict):
    text: str
    kind: Literal["canonical-decomposition", "compatibility", "regional", "composition"]
    policy: str
    source_id: str


class Component(TypedDict):
    character: str
    role: str
    source_id: str


class Reading(TypedDict):
    value: str
    system: str
    source_id: str
    source_entry: str


class Name(TypedDict):
    value: str
    language: str
    source_id: str
    source_entry: str


class Variant(TypedDict):
    id: str
    locale: str
    strokes: list[Stroke]
    provenance: list[Provenance]
    transform: Transform
    recipe: NotRequired[Recipe]
    status: Status
    review: NotRequired[Review]
    components: NotRequired[list[Component]]
    readings: NotRequired[list[Reading]]
    names: NotRequired[list[Name]]


class CharacterRecord(TypedDict):
    script: Literal["Han", "Hiragana", "Katakana", "Hangul", "Common", "Inherited"]
    kind: Literal["character", "component", "sign"]
    default_variant: str
    variants: list[Variant]
    aliases: NotRequired[list[Alias]]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _text(value, location: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\ufffd" in value:
        raise ValueError(f"{location}: expected nonempty text without replacement characters")
    if any(0xD800 <= ord(char) <= 0xDFFF or ord(char) < 32 for char in value):
        raise ValueError(f"{location}: invalid Unicode/control character")
    return value


def _fields(value, required: set[str], optional: set[str], location: str) -> None:
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - optional:
        raise ValueError(f"{location}: expected fields {sorted(required)}; optional {sorted(optional)}")


def _list(value, location: str, *, nonempty: bool = False) -> list:
    if not isinstance(value, list) or (nonempty and not value):
        raise ValueError(f"{location}: expected {'nonempty ' if nonempty else ''}list")
    return value


def _hash(value, location: str) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError(f"{location}: expected lowercase SHA-256")


def _scalar(character: str) -> None:
    _text(character, "character")
    if len(character) != 1 or character.isspace():
        raise ValueError("character key must be exactly one Unicode scalar, not a sequence")


def chunk_name(character: str) -> str:
    _scalar(character)
    return f"u{ord(character) >> 8:04x}.yaml"


def _source(source_id, sources: dict) -> None:
    _text(source_id, "source_id")
    if source_id not in sources:
        raise ValueError(f"unknown source_id {source_id!r}")
    source = sources[source_id]
    for field in ("license", "attribution", "url"):
        _text(source.get(field), f"{source_id}.{field}")


def _relative(path: str) -> PurePosixPath:
    _text(path, "input.path")
    parsed = PurePosixPath(path)
    if ("\\" in path or ":" in path or parsed.is_absolute()
            or ".." in parsed.parts or str(parsed) != path):
        raise ValueError(f"expected portable language-relative path: {path!r}")
    return parsed


def _local_file(root: Path, name: str) -> Path:
    relative = _relative(name)
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"input escapes language root: {name}")
    return path


def _input_index(inputs: list[InputPin], sources: dict) -> dict[str, InputPin]:
    index = {}
    for pin in _list(inputs, "inputs"):
        _fields(pin, {"path", "sha256", "source_id", "source_version"}, set(), "input")
        path = _relative(pin["path"])
        if path.parts[0] not in ("upstream", "licenses", "characters"):
            raise ValueError("inputs must live under existing upstream/, licenses/, or characters/ recipes")
        if path.parts[0] == "characters" and not (
                path.parts[1:2] == ("recipes",) or path.name == "recipes.yaml"):
            raise ValueError("only recipes may be pinned from characters/ (not generated output)")
        if pin["path"] in index:
            raise ValueError(f"duplicate pinned input {pin['path']}")
        _hash(pin["sha256"], "input.sha256")
        _source(pin["source_id"], sources)
        _text(pin["source_version"], "input.source_version")
        index[pin["path"]] = pin
    return index


def validate_record(character: str, record: CharacterRecord, *, sources: dict,
                    inputs: list[InputPin]) -> None:
    """Raise ValueError on an invalid record; never normalize character identities."""
    _scalar(character)
    pins = _input_index(inputs, sources)
    _fields(record, {"script", "kind", "default_variant", "variants"}, {"aliases"}, character)
    if record["script"] not in SCRIPTS or record["kind"] not in ("character", "component", "sign"):
        raise ValueError(f"{character}: invalid script or kind")
    aliases = set()
    for alias in _list(record.get("aliases", []), f"{character}.aliases"):
        _fields(alias, {"text", "kind", "policy", "source_id"}, set(), "alias")
        text = _text(alias["text"], "alias.text")
        if text == character or text in aliases:
            raise ValueError(f"{character}: duplicate or self alias")
        aliases.add(text)
        if alias["kind"] not in ("canonical-decomposition", "compatibility", "regional", "composition"):
            raise ValueError("unknown alias kind")
        _text(alias["policy"], "alias.policy")
        _source(alias["source_id"], sources)
    variants = set()
    for variant in _list(record["variants"], f"{character}.variants", nonempty=True):
        _fields(variant, {"id", "locale", "strokes", "provenance", "transform", "status"},
                {"review", "components", "readings", "names", "recipe"}, "variant")
        identifier = _text(variant["id"], "variant.id")
        if identifier in variants:
            raise ValueError(f"{character}: duplicate variant ID")
        variants.add(identifier)
        locale = _text(variant["locale"], "variant.locale")
        if re.fullmatch(r"(?:zh|ja|ko)(?:-[A-Za-z0-9]{2,8})*", locale) is None:
            raise ValueError("locale must be an explicit zh, ja, or ko language tag")
        for stroke in _list(variant["strokes"], "variant.strokes", nonempty=True):
            _fields(stroke, {"path"}, set(), "stroke")
            validate_path(stroke["path"])
        _fields(variant["transform"], {"id", "version", "source_frame", "matrix"}, set(), "transform")
        for key in ("id", "version"):
            _text(variant["transform"][key], f"transform.{key}")
        for key, size in (("source_frame", 4), ("matrix", 6)):
            if key in variant["transform"]:
                values = variant["transform"][key]
                if (not isinstance(values, list) or len(values) != size
                        or not all(finite_number(value) for value in values)):
                    raise ValueError(f"transform.{key}: expected {size} finite numbers")
        if "source_frame" in variant["transform"] and any(
                value <= 0 for value in variant["transform"]["source_frame"][2:]):
            raise ValueError("source frame dimensions must be positive")
        if "matrix" in variant["transform"]:
            a, b, c, d, _, _ = variant["transform"]["matrix"]
            if abs(a * d - b * c) < 1e-12:
                raise ValueError("transform matrix must not collapse the source frame")
        if "recipe" in variant:
            recipe = variant["recipe"]
            _fields(recipe, {"id", "version", "input", "sha256"}, set(), "recipe")
            for key in ("id", "version"):
                _text(recipe[key], f"recipe.{key}")
            _hash(recipe["sha256"], "recipe.sha256")
            if recipe["input"] not in pins or recipe["sha256"] != pins[recipe["input"]]["sha256"]:
                raise ValueError("recipe must reference a pinned input checksum")
        _fields(variant["status"], {"generated", "validated", "reviewed"}, set(), "status")
        status = variant["status"]
        if not all(type(value) is bool for value in status.values()) or not status["generated"]:
            raise ValueError("status flags must be booleans; an emitted variant must be generated")
        if status["reviewed"] and not status["validated"]:
            raise ValueError("reviewed variants must also be validated")
        if status["reviewed"] != ("review" in variant):
            raise ValueError("review evidence is required exactly when reviewed is true")
        if "review" in variant:
            _fields(variant["review"], {"reviewer", "date", "note"}, set(), "review")
            for key, value in variant["review"].items():
                _text(value, f"review.{key}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", variant["review"]["date"]):
                raise ValueError("review.date must be YYYY-MM-DD")
            date.fromisoformat(variant["review"]["date"])
        provenance_sources = set()
        for provenance in _list(variant["provenance"], "provenance", nonempty=True):
            _fields(provenance, {"source_id", "source_entry", "input", "sha256"}, set(), "provenance")
            _source(provenance["source_id"], sources)
            _text(provenance["source_entry"], "source_entry")
            _hash(provenance["sha256"], "provenance.sha256")
            pin = pins.get(provenance["input"])
            if pin is None or any(pin[key] != provenance[key] for key in ("source_id", "sha256")):
                raise ValueError("provenance must exactly reference a pinned input and source checksum")
            provenance_sources.add(provenance["source_id"])
        for field, required in (
            ("components", {"character", "role", "source_id"}),
            ("readings", {"value", "system", "source_id", "source_entry"}),
            ("names", {"value", "language", "source_id", "source_entry"}),
        ):
            for item in _list(variant.get(field, []), field):
                _fields(item, required, set(), field)
                for key, value in item.items():
                    _text(value, f"{field}.{key}")
                _source(item["source_id"], sources)
                if item["source_id"] not in provenance_sources:
                    raise ValueError(f"{field}: source must be included in variant provenance")
                if field == "components":
                    _scalar(item["character"])
    if record["default_variant"] not in variants:
        raise ValueError(f"{character}: default_variant must resolve an explicit variant ID")


def _stable(value):
    if isinstance(value, dict):
        return {key: _stable(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def _sources(language_root: Path) -> dict:
    sources = {}
    for source in _list(load_yaml(language_root / "sources.yaml"), "sources"):
        if not isinstance(source, dict):
            raise ValueError("source record must be a mapping")
        identifier = _text(source.get("id"), "source.id")
        if identifier in sources:
            raise ValueError(f"duplicate source ID: {identifier}")
        sources[identifier] = source
    return sources


def build_outputs(language_root: Path, records: dict[str, CharacterRecord], inventory: dict,
                  inputs: list[InputPin], *, adapter: str, adapter_version: str,
                  blocked: dict[str, str] | None = None,
                  notice: str | None = None) -> dict[str, str]:
    """Build characters-relative filename -> YAML text, checking every local source pin."""
    language = inventory.get("language")
    if language not in LANGUAGES:
        raise ValueError("inventory.language must be chinese, japanese, or korean")
    _text(adapter, "adapter")
    _text(adapter_version, "adapter_version")
    sources = _sources(language_root)
    pins = _input_index(inputs, sources)
    for name, pin in pins.items():
        if sha256(_local_file(language_root, name).read_bytes()) != pin["sha256"]:
            raise ValueError(f"source checksum mismatch: {name}")
    required = _list(inventory.get("required"), "inventory.required")
    components = _list(inventory.get("components"), "inventory.components")
    for chars in (required, components):
        for character in chars:
            _scalar(character)
        if chars != sorted(set(chars)):
            raise ValueError("inventory character lists must be unique and codepoint-sorted")
    if set(required) & set(components):
        raise ValueError("required and component-only inventory must not overlap")
    if not isinstance(records, dict):
        raise ValueError("records must be a character-keyed mapping")
    blocked = {} if blocked is None else blocked
    if not isinstance(blocked, dict):
        raise ValueError("blocked must map character to explicit source-gap reason")
    for character, reason in blocked.items():
        _scalar(character)
        _text(reason, f"blocked {character}")
        if character not in required and character not in components:
            raise ValueError(f"blocked character {character} is not in the inventory")
    chunks, validated, reviewed = {}, [], []
    for character in sorted(records):
        record = records[character]
        validate_record(character, record, sources=sources, inputs=inputs)
        chunks.setdefault(chunk_name(character), {})[character] = _stable(record)
        if all(variant["status"]["validated"] for variant in record["variants"]):
            validated.append(character)
        if all(variant["status"]["reviewed"] for variant in record["variants"]):
            reviewed.append(character)
    expected = set(required) | set(components)
    dependency_components = {
        item["character"] for record in records.values() for variant in record["variants"]
        for item in variant.get("components", [])
    }
    missing_dependencies = sorted(dependency_components - records.keys())
    missing = sorted(expected - records.keys())
    coverage = {
        "schema_version": SCHEMA_VERSION,
        "language": language,
        "inventory": inventory,
        "required": required,
        "components": components,
        "drawable": sorted(records),
        "validated": validated,
        "reviewed": reviewed,
        "missing": missing,
        "source_blocked": {key: blocked[key] for key in sorted(blocked)},
        "missing_components": missing_dependencies,
        "extra": sorted(records.keys() - expected),
        "release_ready": bool(expected) and not missing and not blocked and not missing_dependencies
                         and expected <= set(reviewed),
    }
    header = ""
    if notice is not None:
        if not isinstance(notice, str) or not notice.strip():
            raise ValueError("notice must be a nonempty modification/attribution notice")
        for line in notice.splitlines():
            if line:
                _text(line, "notice")
        header = "".join("# " + line + "\n" for line in notice.splitlines())
    outputs = {name: header + dump_yaml(value) for name, value in sorted(chunks.items())}
    outputs["coverage.yaml"] = dump_yaml(coverage)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "language": language,
        "adapter": {"id": adapter, "version": adapter_version},
        "style": STYLE,
        "sampling": SAMPLING,
        "identity": "exact-unicode-scalar-no-normalization",
        "inputs": sorted(inputs, key=lambda pin: pin["path"]),
        "sources_sha256": sha256((language_root / "sources.yaml").read_bytes()),
        "inventory_sha256": sha256(dump_yaml(inventory).encode("utf-8")),
        "chunks": [
            {"file": name, "sha256": sha256(text.encode("utf-8")), "characters": len(chunks[name])}
            for name, text in outputs.items() if name in chunks
        ],
        "coverage_sha256": sha256(outputs["coverage.yaml"].encode("utf-8")),
        "release_ready": coverage["release_ready"],
    }
    if notice is not None:
        manifest["notice"] = notice
    outputs["manifest.yaml"] = dump_yaml(manifest)
    return outputs


def write_outputs(language_root: Path, outputs: dict[str, str], *, check: bool = False) -> list[str]:
    """Return stale paths; check=True never creates, removes, or modifies anything."""
    root = language_root / "characters"
    for name, text in outputs.items():
        if not re.fullmatch(r"(?:u[0-9a-f]{4}|manifest|coverage)\.yaml", name):
            raise ValueError(f"unexpected generated filename: {name}")
        if not isinstance(text, str):
            raise ValueError("outputs must contain serialized YAML strings")
    expected = set(outputs)
    existing = {path.name for path in root.glob("u*.yaml")
                if re.fullmatch(r"u[0-9a-f]{4}\.yaml", path.name)}
    stale = sorted(
        [name for name, text in outputs.items()
         if not (root / name).is_file() or (root / name).read_bytes() != text.encode("utf-8")]
        + list(existing - expected)
    )
    if not check:
        root.mkdir(parents=True, exist_ok=True)
        for name in stale:
            path = root / name
            if name in outputs:
                path.write_text(outputs[name], encoding="utf-8", newline="\n")
            else:
                path.unlink()
    return stale
