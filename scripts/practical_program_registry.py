"""Explicit adapter registrations; catalog data cannot choose executable modules."""

from dataclasses import dataclass
from importlib import import_module

from practical_program_types import ProgramAdapter, ProgramProfile


@dataclass(frozen=True)
class ProgramRegistration:
    prefix: str
    module: str
    reference_inventory: str | None = None

    @property
    def program_id(self) -> str:
        return f"{self.prefix}-practical"


REGISTRATIONS = {
    "chinese": ProgramRegistration("zh", "generate_chinese_program"),
    "korean": ProgramRegistration("ko", "korean_program_adapter"),
    "japanese": ProgramRegistration("ja", "japanese_program_adapter"),
    "french": ProgramRegistration("fr", "french_program_adapter", "reference"),
    "russian": ProgramRegistration("ru", "russian_program_adapter", "reference"),
    "spanish": ProgramRegistration("es", "spanish_program_adapter", "reference"),
}


def get_adapter(language: str) -> ProgramAdapter:
    registration = REGISTRATIONS.get(language)
    if registration is None:
        raise ValueError(f"Unregistered practical curriculum language: {language}")
    try:
        module = import_module(registration.module)
    except ModuleNotFoundError as exc:
        if exc.name != registration.module:
            raise
        raise ValueError(
            f"Enabled {language} program requires the missing adapter {registration.module}"
        ) from exc
    adapter = getattr(module, "ADAPTER", None)
    profile = getattr(adapter, "profile", None)
    if (not isinstance(profile, ProgramProfile) or profile.language != language or profile.prefix != registration.prefix
            or not callable(getattr(adapter, "load", None))
            or not callable(getattr(adapter, "validate_phrase", None))):
        raise ValueError(f"{registration.module}: expected a compatible ADAPTER")
    if language != "chinese" and (
        profile.level_layout != "phase-nested" or profile.phrase_mode != "realizations"
        or profile.inventory_schema != "identity-aware"
    ):
        raise ValueError(f"{language}: new adapters must use nested, realization-validated, identity-aware profiles")
    return adapter
