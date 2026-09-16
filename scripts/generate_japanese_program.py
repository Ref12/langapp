"""Generate normalized Japanese practical curriculum views from authored selections."""

import argparse
from pathlib import Path
import sys

import yaml

from generate_practical_program import generate
from japanese_program_adapter import ADAPTER, ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="Reject stale views without writing")
    args = parser.parse_args()
    try:
        outputs = generate(args.root, ADAPTER, check=args.check)
    except (OSError, UnicodeError, ValueError, KeyError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} Japanese curriculum views")
    return 0


if __name__ == "__main__":
    sys.exit(main())
