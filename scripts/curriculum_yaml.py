"""Shared safe, deterministic YAML serialization for maintained curriculum data."""

from pathlib import Path

import yaml


class CurriculumLoader(getattr(yaml, "CSafeLoader", yaml.SafeLoader)):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        keys = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                duplicate = key in keys
                keys.add(key)
            except TypeError as exc:
                raise yaml.constructor.ConstructorError(
                    "while constructing a mapping", node.start_mark,
                    "found an unhashable key", key_node.start_mark,
                ) from exc
            if duplicate:
                raise yaml.constructor.ConstructorError(
                    "while constructing a mapping", node.start_mark,
                    f"found duplicate key {key!r}", key_node.start_mark,
                )
        return super().construct_mapping(node, deep=deep)


def load_yaml(path: Path):
    with path.open(encoding="utf-8-sig") as stream:
        return yaml.load(stream, Loader=CurriculumLoader)


def dump_yaml(value) -> str:
    return yaml.dump(
        value,
        Dumper=getattr(yaml, "CSafeDumper", yaml.SafeDumper),
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=100,
    )


def write_yaml(path: Path, value) -> None:
    path.write_text(dump_yaml(value), encoding="utf-8", newline="\n")


def dump_pairs(pairs: list[list[str]]) -> str:
    """Write a YAML sequence with one compact [id, token] pair per line."""
    return "".join(
        "- " + yaml.dump(
            pair,
            Dumper=getattr(yaml, "CSafeDumper", yaml.SafeDumper),
            allow_unicode=True,
            default_flow_style=True,
            width=100_000,
        )
        for pair in pairs
    )
