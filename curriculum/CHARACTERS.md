# Shared character-writing asset contract (v1)

This is an offline asset/tooling contract, not a handwriting recognizer, activity,
font, or claim of professional language review. Maintained assets are UTF-8 YAML.
Language adapters own their `curriculum/<language>/characters` outputs, recipes,
source records, original snapshots, and notices. Shared Python utilities own the
contract and mechanical checks. Vocabulary retains word meanings/readings: do
not split a word pronunciation into invented character metadata.

## Identity and files

`characters/uXXXX.yaml` is a plain mapping from **exact single Unicode scalars**
to records. `XXXX` is lowercase hexadecimal `ord(character) >> 8`, padded to four
digits: `u004e.yaml` covers U+4E00 through U+4EFF. Sort keys by codepoint. Neither
curriculum level nor chunk location is an identity. Never normalize keys with
NFC or NFKC: even NFC can fold CJK compatibility ideographs.

`manifest.yaml` indexes chunk byte hashes, versions, fixed style, sampling,
source pins, source-catalog hash, inventory hash, coverage hash, and the hashes of
the shared Python generation/validation modules (LF-normalized, matching Git's
text-file representation across platforms; data/source pins remain byte-exact).
`coverage.yaml` includes the inventory, drawable/validated/reviewed lists,
required/component-only/missing/source-blocked/extra keys, component gaps, and
derived `release_ready`. Missing assets remain explicit; imports need not
pretend to be complete. Aliases are **documented relationships, not redirects**.
The consumer must honor their explicit language/context policy; compatibility
jamo never indiscriminately redirect to either an initial or final component.
`validated` and `reviewed` conservatively require **all** emitted variants for a
character to have that status. `default_validated`/`default_reviewed` report the
explicit selected variant separately, and `variant_status` retains every
variant's flags. Unreviewed alternatives cannot be hidden behind a reviewed
default to make the entire bundle release-ready.

Each character record has these exact fields:

```yaml
script: Han # Han | Hiragana | Katakana | Hangul | Common | Inherited
kind: character # character | component | sign
default_variant: mainland
variants:
- id: mainland
  locale: zh-Hans-CN
  strokes:
  - path: M10 50 L90 50
  provenance:
  - source_id: example-source
    source_entry: exact-source-record-id
    input: upstream/example.json
    sha256: '<64 lowercase hexadecimal digits>'
  transform:
    id: source-em-box
    version: '1'
    source_frame: [0, 0, 100, 100] # [x, y, width, height]
    matrix: [1, 0, 0, 1, 0, 0] # SVG affine [a,b,c,d,e,f]
  status:
    generated: true
    validated: true
    reviewed: false
```

Archive-backed provenance can additionally supply **both**
`member: data/<character>.json` and `member_sha256: <original member byte hash>`.
The ordinary `input`/`sha256` still identify the pinned archive, not its member.
ZIP and TAR variants are checked locally without extraction. Duplicate names,
traversal, symbolic links, missing members, mismatched hashes, and individual
members larger than 64 MiB are rejected. Preserve original member bytes and
original per-file license headers in selected source archives.

All variants are explicit; `default_variant` must resolve an ID and never means
"the first one". `locale` is a zh/ja/ko language tag with optional region/script
subtags. Style variants or regional stroke order stay distinguishable.

Optional record field:

* `aliases: [{text, kind, policy, source_id}]`, with kind
  `canonical-decomposition`, `compatibility`, `regional`, or `composition`.
  Text may contain several scalars, including combining signs; never drop marks.

Optional variant fields:

* `recipe: {id, version, input, sha256}` references a pinned declarative recipe.
* `components: [{character, role, source_id}]` describes source-backed structure,
  including positional Hangul or kana base/mark roles; it is not pronunciation.
* `readings: [{value, system, source_id, source_entry}]` and
  `names: [{value, language, source_id, source_entry}]` require per-character
  evidence from a source also present in the variant's provenance.
* `review: {reviewer, date, note}` is required exactly when `reviewed: true`.
  Date is a quoted ISO date. This means attributable **visual** approval of this
  exact geometry, not a professional language certification. Agent inspection
  does not authorize a claim that a person approved an entire imported font.

Generated is true for emitted variants; validated is a boolean assertion of
mechanical checks. Every output is still mechanically checked by the builder.
Reviewed implies validated and review evidence. Bulk imports remain unreviewed.
The five user-reviewed Chinese prototype shapes may retain review evidence only
when their exact approved output is preserved. Changing a recipe or geometry
requires renewed approval; a source font's existence is not that approval.

## Logical paths, source transforms, and sampling

Each `strokes` element is one ordered, continuous pen-down, potentially containing
many SVG segments. `path` is a single `M` followed by explicit absolute `L`, `Q`,
or `C` commands. A return to the starting point closes a loop without lifting.
A second `M` is a different subpath, not another segment of the same pen-down.
No SVG elements, attributes, scripts, URLs, arbitrary commands, or embedded
markup are accepted. Every coordinate/control point is finite and in [0,100];
each stroke has nonzero length. This conservative control-envelope rule can
flag otherwise drawable sources; adapters must report, not silently clamp them.

The fixed style is a 100-unit y-down frame, width 5.5, round caps and round joins.
Preserve original em-box proportions, small kana/diacritic offsets and natural
slant. Do not independently tight-fit glyph bounds. Source frame metadata uses
`[x,y,width,height]`, **not** `[left,top,right,bottom]`. The reviewed Chinese
prototype uses `x = 5 + 90*sourceX/1024` and
`y = 5 + 90*(900-sourceY)/1024` without rounding source medians.
Chinese terminal corrections are not default rules for kana or Hangul.

`scripts/character_geometry.py` provides:

```text
validate_path(path: str) -> None
sample_path(path: str, spacing: float = 2.0) -> list[list[float]]
transform_path(path: str, matrix: Sequence[float]) -> str
normalize_svg_path(path: str, matrix=(1,0,0,1,0,0)) -> list[str]
```

The normalizer accepts relative/absolute M/L/H/V/C/S/Q/T/A/Z, implicit repeated
coordinates, reflected controls, closed loops, and explicit pen lifts. It returns
one canonical path per source subpath, including the implicit new subpath when
drawing follows `Z` without a new moveto. Lines and Beziers transform
exactly before rounding to six decimals (maximum coordinate rounding error
0.0000005 frame units). Elliptical arcs use tangent-matched cubic segments of at
most 22.5 degrees; adapters must reject unsupported source semantics and compare
converted paths when extremely eccentric or oversized ellipses are present.
The helper cannot infer which duplicate animation masks describe the *same*
logical stroke: adapters must resolve source-specific semantics first.

Sampling version `explicit-bezier-polyline-arclength:1` evaluates every Q/C
segment at 32 equal parameter subdivisions, concatenates the resulting polyline
without pen lifts, then samples `ceil(polyline_length / spacing)` equal
arc-length intervals including both endpoints. Coordinates are rounded to six
decimals. This is a reproducible approximation, not analytic SVG arc length.
Curves/control points are bounded by the frame; the approximation's maximum
Bezier-to-chord deviation is less than 0.21 frame units per subdivision for this
envelope. Matching uses these **same final display paths**, not raw medians or
outlines. Use the fixed manifest sampling parameters for shared fixtures.

## Offline adapter API

Use Python 3.10+ and the existing pinned PyYAML dependency (`scripts/requirements.txt`).
Windows installations with the Store alias can use `py -3.12` instead of `python`.
The utility module exposes:

```text
chunk_name(character: str) -> str
validate_record(character, record, *, sources, inputs) -> None
build_outputs(language_root, records, inventory, inputs, *,
              adapter, adapter_version, blocked=None, notice=None) -> dict[str,str]
write_outputs(language_root, outputs, *, check=False) -> list[str]
validate_bundle(language_root, *, inventory=None, require_release=False) -> dict
```

`language_root` is `curriculum/<language>`, not the characters directory.
`records` is the exact-character mapping above. `sources` is an ID-to-source
mapping from the language's existing `sources.yaml`. Every source must identify
its actual component license, attribution, and URL; no code-license inference.
Input pins are `{path, sha256, source_id, source_version}`. Portable relative
paths use `/` in YAML and resolve **inside** the language directory. Keep
original inputs under `upstream/`, original notices under `licenses/`, and
authored recipes under `characters/recipes.yaml` or `characters/recipes/`.
Generated output is never an upstream pin. Include all raw, recipe, and license
inputs used by the adapter; ordinary builds read local pinned bytes only.
Provenance hashes and source IDs must match the referenced input pin.

The inventory minimum is `{language, required: [sorted scalars],
components: [sorted scalars]}`; required and component-only keys are disjoint.
This minimum is useful for adapter/unit fixtures. Whole-bundle validation
recomputes and requires the **full** shared inventory, including source-file
checksums, classifications and scopes. Positional conjoining jamo and combining
kana marks have `kind: component` unless independently required by literal
curriculum text. No word-level meaning is implied by that role.
`blocked` maps an expected character to a nonempty source-gap reason.
`notice`, when supplied, becomes a deterministic comment header on every shard
and manifest text for previews. Adapters supply any license-required dated
modification notice; the bytes, including the notice, are hashed.

The builder neither writes nor downloads. `write_outputs(..., check=True)`
returns stale filenames without creating directories, deleting or writing.
Normal writes replace generated files and remove only obsolete matching shard
filenames; they do not touch recipes. A structurally valid candidate bundle can
be regenerated successfully while `release_ready` remains false. Drawable
coverage and approval coverage are intentionally different.

`cross_script_missing` and `literal_signs_missing` remain visible. Cross-script
target gaps block release; separately reported punctuation does not silently
become required stroke artwork, but prevents `text_coverage_complete`. That
field means drawable text coverage only, not review or learner mastery.
`missing_license_inputs` lists cited provenance, alias, component, reading, name,
and referenced recipe-pin sources with no pinned local license/notice input.
Unrelated unused pins do not require additional licenses for release. These gaps
also prevent release. Structural checks cannot certify legal
permission or expert correctness of a source's own claims.

## Authoritative inventory and explicit foundations

`scripts/character_inventory.py` exposes:

```text
foundation_characters(language: str) -> dict[str,str]  # character/component/sign
extract_inventory(curriculum_root: Path, language: str) -> dict
script_of(character: str) -> str
```

Only catalog-declared **expanded** level files are read: vocabulary `target`,
Japanese vocabulary `reading`, grammar `pattern`/`token_form`, example `target`,
and Japanese example `reading` when supplied. English, translation notes,
upstream dictionaries and compact token strings are never mined for characters.
Chinese teaching sequences are checked with the existing resolver, then selected
IDs resolve back to expanded words/patterns/examples. Reference levels and
pedagogical order remain independent scopes, not competing character identities.
Grammar-slot Latin and syntax punctuation are notation; literal fullwidth Latin
in actual Japanese target forms is a distinct cross-script gap. Korean
vocabulary boundary hyphens are affix notation, not literal sentence punctuation.

Every observed scalar retains classifications and evidence grouped by
file/field/scope, with occurrence count and the first matching entry ID. This is
compact reproducible evidence, not an exhaustive list of every lexeme ID.
Inventories include exact input byte hashes, policy version, Unicode database
version, sorted scalar sets, scope membership, and derived counts. Foundation
membership never mutates reference-level assignments.

Approved snapshot on this branch:

| Language | Reference writing scalars | Foundation keys | Required | Component-only | Total writing keys | Other literal targets |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Chinese | 2,971 | 0 | 2,971 | 0 | **2,971** | 4 punctuation signs |
| Japanese | 2,189 | 177 | 2,211 | 2 | **2,213** | 4 fullwidth Latin characters |
| Korean | 1,160 | 118 | 1,209 | 67 | **1,276** | 2 punctuation signs |

Foundations overlap reference scalars; do not add those columns. Chinese
teaching scope uses 227 characters and adds none outside its reference union.
The reference union is 2,970 vocabulary Han plus grammar-only U+6BCB. Japanese's
initial Han count 2,036 includes U+3005 (iteration mark); adding the explicitly
approved U+3007 number/date prerequisite yields 2,037 Han-script keys, not 2,037
unified ideographs. Target punctuation brings its reference writing count above
the preliminary 2,036 + 151 kana/signs scan.

Modern Japanese kana are U+3041..3096 excluding U+3090/3091, and U+30A1..30FA
excluding U+30F0/30F1/30F7..30FA: 84 hiragana and 84 katakana including small and
voiced/semi-voiced forms. Seven prerequisite signs are U+3001/3002/3007,
U+309B/309C, and U+30FB/30FC. U+3099/309A are two component-only combining marks.
No blanket historical kana, Ainu extension, halfwidth forms, or gloss-only
U+3013 expansion. The four literal cross-script exceptions are
U+FF27/U+FF2B/U+FF2F/U+FF58, retained exactly and never normalized to ASCII.

Modern Korean foundations are the 51 compatibility forms U+3131..3163 and 67
positional conjoining forms (19 initials U+1100..1112, 21 vowels U+1161..1175,
27 finals U+11A8..11C2). The corpus already has four compatibility jamo, so its
1,156 syllables plus foundations total 1,274. Two separately approved,
source-cited README pronunciation-display requirements (U+AF9C and U+C62B)
bring the writing union to 1,276. These are phonetic teaching representations,
**not** replacement vocabulary spellings or inferred word readings. Their exact
README phrases are checked by shared policy; no general prose harvesting occurs.
No archaic/filler/halfwidth/Hanja expansion and no blanket 11,172-syllable import.

Optional future explicit additions belong to language-owned
`characters/requirements.yaml`:

```yaml
schema_version: 1
characters:
  '<one scalar>':
    kind: character # character | component | sign
    reason: Explicitly approved teaching prerequisite
    source: 'README.md#Exact quoted source text'
```

The source is a language-relative file plus an exact text locator, **not a
Markdown slug**. Both the additions file and cited source bytes enter inventory
pins; missing/changed quoted text fails rather than silently retaining a stale
requirement. Use this only for explicit scope decisions, not to turn every
readme example or English gloss into an asset requirement.

## Commands and limits

```powershell
py -3.12 scripts\character_inventory.py --language japanese
py -3.12 scripts\character_inventory.py --language korean --output inventory.yaml
py -3.12 scripts\character_inventory.py --language korean --check inventory.yaml
py -3.12 scripts\validate_characters.py --language chinese --check
py -3.12 scripts\validate_characters.py --language chinese --require-release
py -3.12 -m unittest discover -s scripts -p "test_*.py"
py -3.12 scripts\validate_curriculum.py
```

`--output` writes the requested scratch/report path; it does not populate a
language pack. Each language's importer calls the shared builder/writer for
generation and its own no-write rebuild comparison. `validate_characters.py`
always performs a no-write check, requires a manifest for each selected language,
and returns nonzero for structural/stale failures. `--require-release` also
rejects candidate/incomplete bundles. The existing curriculum validator checks
character bundles whenever a language's `characters` directory exists; an
incomplete directory is not silently ignored. It does not require languages
that have not introduced assets to create a bundle.

Shared bundle validation checks shard membership, byte hashes, duplicate keys,
schema, geometry, local source/archive/recipe pins, current inventory, current
shared-tool versions and exact regenerated manifests/coverage. It cannot
independently reinterpret every upstream format or prove that a claimed source
record has the correct stroke order. Source-to-output reconstruction and
approved-geometry goldens remain adapter responsibilities; use the language
importer's no-write check as well. Numerical geometry/visual inspection do not
replace professional linguistic review, and none of these assets imply learner
mastery or production handwriting recognition.
