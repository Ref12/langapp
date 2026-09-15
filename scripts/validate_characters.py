"""Validate language-local character bundles offline without rewriting any files."""

import argparse
from pathlib import Path
import sys
import tarfile
import zipfile

import yaml

from character_assets import LANGUAGES, validate_bundle


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=LANGUAGES)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "curriculum")
    parser.add_argument("--check", action="store_true", help="Explicit no-write mode (always enabled)")
    parser.add_argument("--require-release", action="store_true",
                        help="Fail on missing, unreviewed, cross-script, or license coverage")
    args = parser.parse_args()
    errors = []
    for language in (args.language,) if args.language else LANGUAGES:
        try:
            coverage = validate_bundle(args.root / language, require_release=args.require_release)
            print(f"{language}: drawable={len(coverage['drawable'])}, "
                  f"required={len(coverage['required'])}, components={len(coverage['components'])}, "
                  f"missing={len(coverage['missing'])}, default-reviewed={len(coverage['default_reviewed'])}, "
                  f"release_ready={coverage['release_ready']}; mechanical checks only")
        except (OSError, UnicodeError, ValueError, yaml.YAMLError, tarfile.TarError, zipfile.BadZipFile) as exc:
            errors.append(f"{language}: {exc}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
