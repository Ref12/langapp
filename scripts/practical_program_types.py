"""Source-neutral contracts for practical curriculum adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol


@dataclass(frozen=True)
class ProgramProfile:
    language: str
    prefix: str
    level_layout: Literal["flat", "phase-nested"] = "phase-nested"
    phrase_mode: Literal["literal", "realizations"] = "realizations"
    inventory_schema: Literal["legacy", "identity-aware"] = "identity-aware"


@dataclass(frozen=True)
class ReferenceBundle:
    vocabulary: dict[str, dict[str, str]]
    grammar: dict[str, dict[str, str]]
    lexical_identity: dict[str, str]
    provenance: dict[str, dict] = field(default_factory=dict)
    source_sense_identity: dict[str, str] = field(default_factory=dict)
    reading_identity: dict[str, str] = field(default_factory=dict)
    spelling_identity: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SeedUnit:
    level: int
    topic: str
    unit: dict


@dataclass(frozen=True)
class ProgramData:
    inputs: dict
    references: ReferenceBundle
    seeds: tuple[SeedUnit, ...] = ()
    construction_dependencies: dict[str, tuple[str, ...]] = field(default_factory=dict)
    source_outputs: dict[Path, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SurfaceSegment:
    ch: str
    pr: str
    items: tuple[str, ...] = ()
    grammar: tuple[str, ...] = ()
    form_id: str | None = None


@dataclass(frozen=True)
class PhraseAnalysis:
    items: tuple[str, ...]
    grammar: tuple[str, ...] = ()
    realizations: tuple[SurfaceSegment, ...] = ()


@dataclass(frozen=True)
class PhraseContext:
    profile: ProgramProfile
    references: ReferenceBundle
    introduced_vocabulary: frozenset[str]
    introduced_grammar: frozenset[str]


class ProgramAdapter(Protocol):
    profile: ProgramProfile

    def load(self, root: Path) -> ProgramData: ...

    def validate_phrase(self, phrase: dict, context: PhraseContext) -> PhraseAnalysis: ...
