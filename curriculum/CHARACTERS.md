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
source pins, source-catalog hash, inventory hash, and coverage hash.
`coverage.yaml` includes the inventory, drawable/validated/reviewed lists,
required/component-only/missing/source-blocked/extra keys, component gaps, and
derived `release_ready`. Missing assets remain explicit; imports need not
pretend to be complete. Aliases are **documented relationships, not redirects**.
The consumer must honor their explicit language/context policy; compatibility
jamo never indiscriminately redirect to either an initial or final component.

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
one canonical path per explicit source subpath. Lines and Beziers transform
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

Use the existing pinned PyYAML dependency (`scripts/requirements.txt`).
Windows installations with the Store alias can use `py -3.12` instead of `python`.
The early utility slice exposes:

```text
chunk_name(character: str) -> str
validate_record(character, record, *, sources, inputs) -> None
build_outputs(language_root, records, inventory, inputs, *,
              adapter, adapter_version, blocked=None, notice=None) -> dict[str,str]
write_outputs(language_root, outputs, *, check=False) -> list[str]
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
The shared extractor adds source-file checksums, classifications and scopes.
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

```powershell
py -3.12 scripts\test_character_assets.py
```

Inventory extraction, whole-bundle checking, and curriculum-validator integration
are delivered in the follow-up shared slice; language adapters need not wait to
produce records against this frozen v1 contract.
