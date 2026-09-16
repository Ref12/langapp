"""Generate Spanish teaching views through the shared practical-program engine."""

import argparse
from pathlib import Path
import sys

import yaml

from generate_practical_program import generate
from spanish_program_adapter import ADAPTER
from spanish_sources import ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="Detect missing/stale views without writing")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, ADAPTER, check=args.check)
    except (OSError, UnicodeError, ValueError, KeyError, yaml.YAMLError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} Spanish curriculum views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
