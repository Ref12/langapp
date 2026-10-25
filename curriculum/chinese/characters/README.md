# Chinese writing assets

These are offline curriculum-backed artwork and review-support data, not a
production writing activity, handwriting recognizer, font, or claim of
professional language review. They implement the shared
[character contract](../../CHARACTERS.md).

## App projection

The Mandarin app consumes a separate, deterministic projection of these prepared
files; it does not run the source importer or introduce new review approvals:

```powershell
npm run characters:generate
npm run characters:check
npm test -- scripts\generate-app-characters.test.ts src\core\characters\assets.test.ts
```

`scripts/generate-app-characters.mjs` verifies the manifest's prepared page,
coverage, source-catalog, recipe, license and selected-source hashes. It checks
exact keys, declared defaults, provenance, ordered source stroke counts,
inherited review evidence, and canonical nonzero single-subpath M/L/Q/C paths
whose coordinates/control points remain within 0..100. It copies default path
strings in their existing order without fitting, rounding, transforming,
normalizing character keys or selecting candidates. All 3,001 available keys
are projected, not just those currently used by the app's HSK 1-6 vocabulary.
Missing guides must remain unavailable; vocabulary must not fabricate them.

The small `src/data/characters/index.generated.json` contains character,
stroke-count, default-variant and review-status metadata, plus exact generated
source revision/archive pins, but no stroke paths. Runtime provenance checks use
those pins, so an intentional prepared-source refresh cannot leave stale
revision or archive-hash constants in the loader.
`src/core/characters/assets.ts` exports `characterAssetIndex`,
`loadCharacterAsset(exactCharacter)` and `characterAttributionUrl`. Its public
`CharacterAssetSummary` has `{character, strokeCount, reviewed, variant}`;
`CharacterAsset` adds ordered `paths` and source provenance. The loader validates
membership and the entire incoming page before returning a character, shares
in-flight/successful page loads, and allows retries after any failed request.
Runtime path validation uses `src/core/characters/geometry.ts`'s
`makeStrokeGuide`, the same 32-subdivision, spacing-2 sampler used for tracing.
The offline generator has its own matching path-contract validation and does
not execute the browser loader or sampler.

Runtime geometry URLs are
`BASE_URL + "characters/chinese/u004e.generated.json"` (for example, 一).
The page is the scalar shifted right eight bits, encoded as lowercase
hexadecimal padded to four digits. Each JSON page has
`{schemaVersion: 1, language: "chinese", page, notice, characters: CharacterAsset[]}`.
There are 80 lazy pages, about 10.7 MB total before HTTP compression; the largest
page is about 307 KB. No geometry page is eagerly imported into the application.
The loader respects Vite's `import.meta.env.BASE_URL`, including GitHub Pages
subpaths and relative production bases. Render paths as SVG path attributes,
never as raw SVG markup. Use the existing width 5.5 and round caps/joins.

`characterAttributionUrl` points to the viewable local
`characters/chinese/ATTRIBUTION.html`. The public distribution includes the
unaltered ARPHIC license, dated notices, retained source catalog and lock, the
exact original selected ZIP, and a deterministic derived-source ZIP with the
prepared YAML, review evidence, projection script and locked package metadata.
The page explains reproduction and how to restore the separately distributed
original ZIP. It also distinguishes the artwork's ARPHIC terms from independent
implementation-code and vocabulary licensing. It makes no professional-review
claim. Source downloads are not loaded with the practice page.

`characters:check` is part of `build:next`. It compares every expected byte and
reports missing, modified or extra owned page outputs without writing, creating
directories or deleting anything. Generation validates all inputs before writing
and removes only obsolete owned generated page filenames; unrelated files are
preserved. Vite copies the public assets and legally necessary source/notices
into the built distribution.

## Scope and identity

The current required union is **3,001 Han characters in 80 Unicode pages**:
2,971 from the expanded reference and grammar inventory plus 30 teaching-only
characters introduced by the HSK evidence overlay. Grammar patterns, literal
example targets and authored token forms are included. The available four-level
path now includes the cumulative HSK 1 vocabulary additions while retaining the
original beginner module order and canonical IDs.

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
| `source-median` | Supported, mechanically checked cubic paths from source medians; visually unreviewed | Characters without an explicit reviewed or authored recipe |
| `refined-candidate` | Generic conservative terminal corrections for review; visually unreviewed | Never |
| `reviewed-monoline` | Exact inherited approved prototype paths | U+8336, U+96E8, U+676F, U+4EBA, U+4E00 only |
| `authored-monoline` | Explicit source-pinned tracing corrections; visually unreviewed | U+4E07 (万) |

`recipes/authored-monoline.yaml` selects 万's corrected default as of 2026-09-30:
a naturally slanted straight top stroke, three connected straight segments for
the folded hook, and one smooth quadratic left-falling stroke. The folded hook
is still **one pen-down**, not three strokes. This removes the source median's
terminal crooks without changing the source archive, stroke order, em-box
placement, width, or any other character's geometry. The original baseline
remains available as a separate variant. Selection does not imply visual approval.

Authored inputs pin the original member hash and exact ordered paths, carry
dated modification/license notices, and cannot replace one of the five reviewed
recipes or add review evidence. Both the importer and app projection validate
the source, stroke count and path contract. The generated app index pins the
authored recipe metadata; the loader checks it and returns it in
`provenance.recipe`. The reproducibility ZIP includes the authored recipe.
Guides, animation and matching all consume the same final paths; no runtime
smoothing or display-only override is applied.

### Supervised programmatic fitting

See the [writing handoff](../../../pending/writing-handoff.md) for the current
review checkpoint, exact reproduction command, design decisions and validation
history. This section describes the tool and asset contract.

The initial fitting experiment is preview-only and limited to **one requested
character at a time**. It does not edit recipes, defaults, review status or app
assets:

```powershell
py -3.12 -B scripts\fit_chinese_strokes.py --character 万 --output C:\Temp\wan-fitting.html
py -3.12 -B -m unittest discover -s scripts -p test_chinese_stroke_fitting.py
```

The tool checks pinned source bytes and the current page hash, then fits each
median without character-specific coordinates or hand-assigned stroke classes.
It tries a least-squares line using the central stroke, a single quadratic with
projected endpoints, then intersecting fitted lines at sufficiently distinct
turns. Terminal insets, fit error, endpoint/corner displacement and corner-angle
limits are experimental and appear in the report. Nonzero length, one pen-down,
stroke direction and the 100-unit control envelope are retained. A failed model
is not permission to clip coordinates, erase a hook or reuse source interpolation
as a successful fit: unresolved strokes have no candidate path.

Fitter version `median-simple-models:2` adds fallback models for 水 while keeping
the user-accepted 万 paths byte-exact. It searches source-point splits for a true
turn joining two independently fitted primitives, allowing a line followed by a
curve instead of forcing curved limbs into straight facets. Joins come from
tangent intersections, stay within the existing corner displacement limit, and
must preserve forward direction and a distinct turn. Valid fits prefer fewer
curves, then lower sampled deviation; the original models run first.

A separate, explicitly flagged straight-stroke fallback allows at most 5.5 units
of terminal-only deviation rather than the ordinary 4.125, while requiring the
entire retained central stroke to stay within 1.1 units of the resulting line.
It uses the existing 5.5-unit terminal inset, capped at 20% of stroke length,
and does not relax limits for the middle of the stroke, curves or joins.
The third 水 stroke triggers this warning: its starting point moves 4.932 units.
This is a reviewable candidate, not evidence that every short hook is accidental.

Version `median-simple-models:3` softens short returning hooks after selecting
the fitted limbs. A two-line join qualifies only when its shaft spans at least
three pen widths, its hook spans at least one pen width but at most 35% of the
shaft, and its outgoing direction projects negatively onto the shaft by more
than 0.15. The existing bounded quadratic fillet trims at most 3 units or 45%
of either limb, retaining the fitted endpoints and smooth tangent joins within
serialization precision. The rounded path must pass the ordinary geometry
limits again. Reports retain its unrounded path and flag the corner treatment.
This is not blanket rounding: ordinary elbows, long outgoing limbs and
multi-corner folds remain unchanged. For 水, only stroke 1 changes from version 2;
the other strokes and accepted 万 paths remain byte-exact. The user accepted
the exact 水 version-3 candidate for this experiment; it has not been applied.

Version `median-simple-models:4` adds a last-resort curved-hook model for 热's
fifth stroke. It searches for a genuine fold after a fitted line, followed by
one or two cubic bends. Endpoint tangents come from the source; two bends share
the same tangent at a source-derived join. A constrained least-squares fit keeps
positive control handles inside each endpoint-tangent triangle, avoiding
cusps and curvature reversals within each cubic. Both bends must turn the same
way, and sampled self-intersections are rejected. This is not a guarantee about
every possible unsampled intersection or linguistic stroke classification.
Each cubic must also match its source span in traversal order within 1.65 units,
checked after serialization. The complete stroke still passes the ordinary
4.125-unit deviation, endpoint-shift and frame limits. The report records the
fold, smooth joins, segment types and ordered curve error. In that revision,
earlier models ran first, preserving the nine other 热 paths and accepted 万/水/咖 geometry.
The new 热 candidate remains subject to visual review; it does not retain a
current guide automatically or claim that a dense source interpolation was fitted.

Version `median-simple-models:5` stops preferring a line solely because its
deviation is small. Before accepting an ordinary line, it checks for supported
gentle curvature: original source turns must agree in direction and each stay
below the 35-degree corner threshold; the retained core must support a forward
quadratic with at least 8 degrees of tangent turn in that same direction.
A quadratic fitted to uniformly resampled full-stroke points must preserve the
original endpoints, remain forward and bounded, and reduce sampled deviation
to at most half that of the line. It must also pass all ordinary candidate
limits. Reports label this choice `sustained-curve` and retain the competing
line, measured turns and error ratio. This conservative geometric rule is not
proof of intended curvature, especially for sparse medians.

The third 热 preview changes only strokes 6-10: the short crossing stroke and
four bottom dots now keep smooth curvature. The first five strokes, including
both hooks, are unchanged; this revision does not shorten hooks. The Duolingo
reference informed the style goal, not the coordinates, which remain derived
from the pinned source. Earlier accepted 万/水/咖 previews remain preserved and
unchanged by this revision. Those approvals are historical checkpoints, not a
requirement to keep angular geometry forever: reconsideration remains
one character at a time, with new previews and user review.

Version `median-simple-models:6` adds explicitly selected compaction for strokes
whose reach the user wants reduced, without changing automatic model selection:

```powershell
py -3.12 -B scripts\fit_chinese_strokes.py --character 热 --compact-stroke 2 --compact-stroke 3 --output C:\Temp\re-compact.html
```

For a fitted line, each endpoint moves inward by 10% of its length, capped at
half a pen width, preserving its center and direction. The remaining line must
span at least one pen width. For a recognized rounded returning hook, the
unrounded returning limb keeps two thirds of its length, preserving the fitted
shaft, fold and return direction. The existing bounded fillet is then rebuilt
and must still meet the returning-hook rules. Full-stroke source deviation and
endpoint displacement must pass the ordinary limits again; compaction never
uses the more permissive terminal-only allowance.

This is a supervised style choice, not an automatic claim that the source is
too long. It does not compact general curves, compound folds or retained-current
paths. An unsupported selection or failed bound aborts before writing outputs,
without substituting the uncompacted fit. Indices are one-based, repeatable,
unique and disjoint from retained-current selections. The schema-v3 report
records the policy, selected indices, original fitted result, new path and
recomputed metrics; the HTML identifies compacted strokes explicitly.
The fourth 热 preview changes only strokes 2 and 3: the returning hook is one
third shorter and stroke 3 is 20% shorter. Its other eight paths, including the
gentle curves from v3, remain byte-exact. No app assets are changed.

Version `median-simple-models:7` adds explicit positioning after fitting and
optional compaction. Repeat `--translate-stroke STROKE DX DY` for each selected
stroke; negative x moves left and negative y moves up in the 100-unit frame.
For example, the fifth 热 preview uses the two compactions above plus
`--translate-stroke 1 -1.25 -3 --translate-stroke 2 -1.25 0 --translate-stroke 3 -1.25 0`.
This raises the crossbar and moves the left component slightly away from the
right component, retaining all stroke shapes, sizes and the other seven paths.

The shared affine helper translates every endpoint and control point together.
Offsets must be finite, nonzero and no longer than the endpoint-shift limit.
The final paths must still pass the ordinary source-deviation, endpoint and
frame bounds, without the terminal-only allowance or automatic clamping.
Duplicate indices, retained-current conflicts and unresolved candidates fail
before writing output. Translations are explicit review choices, not inferred
component identities or permission to move every instance of a radical.
Schema-v4 reports pin each offset and the complete unpositioned result (including
any compaction); the HTML labels positioning separately from automatic fitting.

Version `median-simple-models:8` adds `--trim-line-start STROKE AMOUNT` for
one-sided shortening after compaction and positioning. It removes only the
specified distance from the pen-down start of an `M L` path, along its existing
direction, keeping the other endpoint fixed. "Start" follows stroke order, not
screen-left. The amount must be finite, positive and at most half a pen width;
at least one pen width of line must remain. Ordinary source-deviation and
endpoint limits are rechecked without clamping or fallback. Curves, hooks,
exact retained-current paths and duplicate selections are rejected.
Schema-v5 reports preserve the complete pre-trim result and selected amount,
and the preview identifies start trimming explicitly.

The sixth 热 preview keeps v5 except for strokes 2 and 3. Stroke 2 moves another
1.25 units left (total x offset -2.5). Stroke 3 moves up 1 unit and loses 1.5
units only from its left/pen-down start, preserving its right-end x coordinate
and angle. The first and third strokes still intersect the shaft as intended;
the first stroke and other seven strokes are unchanged.

An existing guide stroke that the user prefers can be retained explicitly:

```powershell
py -3.12 -B scripts\fit_chinese_strokes.py --character 咖 --retain-current-stroke 4 --output C:\Temp\ka-review.html
```

Stroke numbers are one-based; repeat the option for multiple strokes. The
report pins this selection and copies each selected current path
byte-exactly, with `status: retained-current`, not a successful fit. Other strokes
still use the unchanged fitting rules. This is an explicit review decision, not
an automatic fallback or a general solution to curved-stroke model selection.
Invalid indices, duplicate selections and invalid retained geometry fail without
output. Neither retention nor the preview resizes components or changes app assets.

The self-contained HTML compares original median paths, the current guide and
the unapplied candidate. It supports per-stroke selection, synchronized replay
and numbered source-point overlays. A sibling JSON report pins source/member,
current-page and fitting-tool hashes alongside exact candidate paths and metrics.
The original artwork license is included in the preview. Error distances are
geometric diagnostics, not handwriting-quality scores or automatic approval.
Review each character with the user and refine reusable rules before considering
bulk application. Approval and publication are separate steps; this command has
no bulk mode and refuses output paths under `curriculum`, `public` or `src`.

The source audit contains 28,418 ordered logical strokes and 166,294 median
points. Generic detectors flag 408 compact-hook and 3,306 short-fall strokes
in 2,019 characters. Three
of those characters already have reviewed recipes; the other 2,016 receive a
separately identified candidate variant. Unmatched,
compound, ambiguous and long-fall geometry retains the source-median renderer
unless an explicit authored recipe selects a correction.
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

The selected ZIP in `../upstream/writing` preserves all 3,001 original
`data/{character}.json` members: **8,372,864 uncompressed data bytes**, plus
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
