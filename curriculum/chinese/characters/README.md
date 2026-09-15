# Chinese writing assets

These are offline curriculum-backed artwork and review-support data, not a
production writing activity, handwriting recognizer, font, or claim of
professional language review. They implement the shared
[character contract](../../CHARACTERS.md).

## Scope and identity

The current required union is **2,971 Han characters in 80 Unicode pages**:
2,970 from all 10,969 expanded HSK vocabulary targets, plus U+6BCB from
`zh-hsk7-9-g026` and its examples. Grammar patterns, literal example targets and
authored token forms are included. The beginner track uses 223 vocabulary Han,
227 with resolved grammar/examples, and adds none outside the reference union.
Its sense IDs, teaching order and reference assignments remain unchanged.

Keys are exact single Unicode scalars, with no NFC/NFKC folding or automatic
simplified/traditional conversion. The current union contains no compatibility
or supplementary-plane keys. `u004e.yaml` covers U+4E00..U+4EFF; pages use the
lowercase hexadecimal codepoint shifted right eight bits, padded to four digits.
Artwork is not copied into levels or lessons.

The syllabi do not specify a separate radical or stroke-symbol glyph inventory.
Pinyin, tones and input preparation are not manufactured Latin writing assets.
Actual punctuation U+3002, U+FF0C, U+FF1B and U+FF1F is explicitly recorded as
four unsupported literal sign targets. Thus Han coverage is complete but
`text_coverage_complete` remains false. Grammar-slot letters/notation, pinyin
readings and English glosses are not target-character evidence.

`coverage.yaml` contains the full shared inventory, source-file hashes, scopes,
field-level evidence and explicit missing/sign/review states. Its compact
evidence records first matching entry IDs and occurrence counts, not a duplicate
copy of every lesson or word meaning.

## Baselines, candidates and actual review

All variants have explicit `locale: zh-Hans-CN`. Locale identifies the intended
Chinese variant; it is neither an artwork-style name nor a teacher certification.

| Variant ID | Purpose | Default selection |
| --- | --- | --- |
| `source-median` | Supported, mechanically checked cubic paths from source medians; visually unreviewed | All but the five reviewed characters |
| `refined-candidate` | Generic conservative terminal corrections for review; visually unreviewed | Never |
| `reviewed-monoline` | Exact inherited approved prototype paths | U+8336, U+96E8, U+676F, U+4EBA, U+4E00 only |

The source audit contains 28,084 ordered logical strokes and 164,454 median
points. Generic detectors flag 405 compact-hook and 3,270 short-fall strokes in
2,000 characters. Three of those characters already have reviewed recipes;
the other 1,997 receive a separately identified candidate variant. Unmatched,
compound, ambiguous and long-fall geometry retains the source-median renderer.
Detector hits are not semantic labels for dots or evidence of visual approval.

Every generated variant passes mechanical path checks, but this does not grant
artwork approval. `default_reviewed` contains five keys; `reviewed` conservatively
requires every variant of a character to be reviewed and remains empty because
the baseline alternatives are unreviewed. `release_ready` remains false.

The five reviewed recipes retain 28 byte-exact ordered path strings and their
original path hashes. Their review date **2026-09-15 is a coordinator
carry-forward attestation**, not the unknown date of the original user review
in the writing-study conversation. No original date is inferred and no new
professional-language review is claimed. Recipe/golden/source mismatches are
errors; they do not authorize substituting another shape or reusing approval.

## Coordinate and matching geometry

Original source frame: `[0, -124, 1024, 1024]` as x/y/width/height, with y increasing
upward. Normalize exactly once:

```text
x = 5 + sourceX * 90 / 1024
y = 5 + (900 - sourceY) * 90 / 1024
```

The original em-box maps to the inset 5..95 area of the 100-unit y-down frame.
No glyph is independently tight-fitted, rotated, straightened to an axis or
resized relative to other glyphs. Raw median coordinates are not rounded;
generated source-median paths use six-decimal serialization, and the reviewed
prototype paths retain their exact three-decimal strings.

Reference width is fixed at 5.5, with round caps/joins. Width affects cap
compensation, so changing it requires a new style/geometry review, not a visual
CSS override. Source frame/matrix metadata describes the already-applied
transform; do not apply it again to generated paths.

One `strokes` entry is one continuous logical pen-down. A path may contain
multiple explicit L/Q/C segments after its initial M. Do not count segments as
extra strokes. Filled outlines and ordered source medians remain distinguishable
from final display geometry in the pinned input archive.

Use shared `character_geometry.sample_path` and the manifest's sampling version
for matching. It samples the final display path, never the original median.
The deterministic 32-subdivision Bezier/arc-length approximation is not claimed
bit-identical to browser SVG length sampling. This milestone changes no app
renderer, assessment or learner-progress behavior.

## Source pin, provenance and licensing

Primary pin: Hanzi Writer Data commit
`68d10a4b21150cae5e1ebbd223eed289cf32d90c`. The upstream `v2.0.1` tag instead
points to `ad1a9905cada18d07630acc27d438b070d753ec0`; the retained commit follows
that tag and remains upstream master at audit time. All required JSON bytes
are identical between the two revisions. No update or gap-fill import is needed.

The selected ZIP in `../upstream/writing` preserves all 2,971 original
`data/{character}.json` members: **8,279,016 uncompressed data bytes**, plus
original README/license and a separate selection notice. Member order,
timestamps and file metadata are deterministic. Normal rebuilds consume this
archive directly without extraction or network access.

`source-lock.yaml` pins archive/member hashes, original upstream URL/commit and
source-container hash. Each generated variant cites the immutable source URL,
selected archive hash, exact member path and original member hash. Reviewed
recipe/golden inputs are pinned separately under `recipes/`. The manifest
also pins licenses, the source catalog, inventory, outputs and shared tools.

Artwork derives from Make Me a Hanzi and Arphic fonts through Hanzi Writer Data.
**Source and derived artwork retain the ARPHIC PUBLIC LICENSE**, not the
engine's code license or the dictionary curriculum's CC-BY-SA license.
Preserve the unaltered
[original ARPHIC notice](../licenses/hanzi-writer-ARPHICPL.TXT),
Chinese `sources.yaml`, and prominent dated modification notices in every
modified artwork file. Make the derived modifications freely available under
that license; copyright and no-warranty terms remain in force. Independent
implementation code is separate.

AnimCJK commit `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6` was audited only as a
possible reference/gap-fill source. All required codepoints have ZhHans SVG paths;
617 have matching codepoint paths in ZhHant, which is not a conversion measure.
Its hanzi artwork is ARPHIC-derived, whereas other files and non-Arphic
kana/stroke assets have separate LGPL terms. No AnimCJK files, dictionaries,
Japanese geometry or traditional expansions are imported. Future source gaps
require explicit locale/provenance/license decisions, not silent substitution.

## Rebuild, check and review

From the repository root with Python 3.10+ and the existing pinned PyYAML
dependency (the Windows launcher `py -3.12` is available):

```powershell
py -3.12 -B scripts\import_chinese_writing.py
py -3.12 -B scripts\import_chinese_writing.py --check
py -3.12 -B scripts\validate_characters.py --language chinese --check
py -3.12 -B -m unittest discover -s scripts -p test_chinese_writing.py
```

Normal generation and `--check` are offline. The stale check recomputes expected
bytes, checks pinned source/recipe/license data, and fails for missing, changed
or extra owned pages without creating directories, writing, deleting or
updating inputs. `-B` also prevents Python bytecode-cache writes. Ordinary
generation validates before writing and removes only obsolete owned page names.
`--require-release` intentionally fails while review gaps remain.

The original source selection can be reproduced explicitly:

```powershell
py -3.12 -B scripts\import_chinese_writing.py --prepare-source C:\path\to\pinned-upstream.tar.gz
py -3.12 -B scripts\import_chinese_writing.py --download-source
```

These alternatives verify the fixed upstream container hash before selecting
original bytes; they prepare sources only, not artwork. Neither silently
advances a revision. Review any source/recipe/style change and regenerate all
dependent artifacts together.

The [30-character review sheet](review/batch-001.html) compares original filled
outlines, baselines and candidate/reviewed paths at common and small sizes.
Expandable ordered strokes mark green starts and red ends. Its
[companion YAML](review/batch-001.yaml) includes exact paths, matching samples,
status, source hashes and transform metadata. The complete
[candidate queue](review/candidates.yaml) names affected characters, stroke
indices and generic rules, with an explicit `scope_characters` list. Its
`detector_flagged_glyphs` count is distinct from `variant_counts`: the 30-character
batch has 18 flagged glyphs but only **15 new candidate variants**, alongside
30 baselines and five inherited reviewed variants.

```powershell
py -3.12 -B scripts\import_chinese_writing.py --review-batch
```

This review-only operation generates the 30-character review artifacts and
`review/batch-candidates.yaml`, **never** shards, manifest/coverage files or the
full candidate queue. It does not overwrite the full queue with batch-only
coverage. Full generation updates both review scopes together.
Batch/process acceptance does not grant individual glyph approval. New
per-character recipes or review status require attributable approval of their
exact output; do not turn generic detector hits into authored recipes.

Coordinator batch inspection noted heavy strokes/tight counters at width 5.5
for U+56CA, U+8B66, U+8D62 and U+5668. These remain explicit style/legibility
cautions in the review sheets and queue, not silent thinner-pen overrides.
Batch acceptance authorized data preparation only; these characters remain
unreviewed and retain their source-median defaults.
