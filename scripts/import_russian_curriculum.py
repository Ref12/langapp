"""Import selected Russian references from checksum-pinned OpenRussian source tables."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import yaml

from russian_source import load_tables, write_outputs
from russian_tourist import prepare_outputs


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "russian"


def generate(root: Path = ROOT, *, source_directory: Path | None = None,
             check: bool = False) -> dict[Path, str]:
    outputs = prepare_outputs(root, load_tables(source_directory))
    write_outputs(outputs, check=check)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--source-directory", type=Path,
                        help="Use the four pinned local TSV tables instead of downloading them")
    parser.add_argument("--check", action="store_true", help="Compare references without writing")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, source_directory=args.source_directory, check=args.check)
    except (OSError, UnicodeError, ValueError, KeyError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Imported'} {len(outputs)} Russian reference views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
