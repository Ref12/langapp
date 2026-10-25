# Writing exercises and stroke fitting handoff

Updated: 2026-10-11. This is the continuation record for writing exercises,
consolidated from the study-flow handoff. That file retains a frozen historical
chronology; update this file for future writing work. Read it together with the
current source and Git status; it is not permission to publish or expand the work.

## 2026-10-11 decision: scale run integrated as-is (review loop paused)

**The user paused the supervised nine-character review loop** and asked for the
current fitter (`median-simple-models:13`, including short-entry-flick:1,
isolated-dot-clearance:1, hook-and-bend-softening:1, sustained-fold-retention:1
and sustained-bend-fillet:1) to be applied to the whole prepared set and shipped
"as is" so writing exercises can be used. Imperfect strokes are accepted. The
older "Start here" text above describes the paused loop; the 热 v6 status there
no longer gates anything. No per-character tweaks were made.

What was built:

- `scripts\fit_chinese_recipes.py` fits every non-prototype character (no
  adjustment options; 万's manual authored default is skipped) and writes
  `curriculum\chinese\characters\recipes\fitted-monoline.yaml` (+ `.summary.json`).
  A stroke the fitter cannot resolve or whose path fails `validate_path` keeps its
  pinned source-median path; `fitted_strokes` lists the stroke numbers that were fitted.
- `import_chinese_writing.py` reads that recipe (`read_fitted_recipes`), adds a
  `fitted-monoline` variant (status reviewed: false, no review block, recipe
  provenance `zh-fitted-uXXXX`) and makes it the default for those 2,995 characters.
  The five reviewed prototypes keep `reviewed-monoline`; 万 keeps `authored-monoline`.
  Provenance label: recipe `review: fitted-unreviewed`; the app index carries `fittedRecipe`.
- `generate-app-characters.mjs` and `src\core\characters\assets.ts` validate the
  fitted recipe pin and variant (unreviewed, exact paths, no inherited review).

Scale-run result (fit time 71.6 s with 6 processes; importer ~70 s; generate ~1 min):

| Measure | Count |
| --- | --- |
| Characters fitted (non-prototype, non-authored) | 2,995 |
| Characters with every stroke fitted | 2,231 |
| Characters partly fitted, remaining strokes left as source | 762 |
| Characters left entirely as source | 2 |
| Strokes total / fitted / left as source (unresolved) | 28,387 / 27,513 / 874 |
| Exceptions or aborted characters | 0 |

Models: line 13,904; sustained-curve 4,023; connected-lines 3,403; quadratic 2,867;
softened-lines 758; line-curve 753; entry-smoothed-line 722; spaced-dot 582;
rounded-hook 349; entry-smoothed-curve 83; curved-hook 59; joined-curves 10;
unresolved 874. Stroke counts were not changed. Strokes "changed" = fitted strokes
(27,513 replace the source-median path; many are near-identical straight lines).

Rerun: `py -3.12 -B scripts\fit_chinese_recipes.py` then
`py -3.12 -B scripts\import_chinese_writing.py` then `npm run characters:generate`
and `npm run characters:check`. Set `PYTHONIOENCODING=utf-8` if printing Chinese.

Remaining imperfect: nothing is visually reviewed beyond the earlier supervised
batches; the 874 source strokes are visibly rougher than fitted neighbours; no radical
layout, crossbar-height or spacing review was done; the 万 authored default still
differs from the accepted programmatic 万. Future per-character review can add a
reviewed variant; do not relabel fitted defaults as reviewed in bulk.

Checks run after integration: test_chinese_writing (27 OK), importer `--check`,
`characters:check`, lint, `test:pages` (3,507 passed), build, fitter suite default
(85 OK, 3 skipped) and with LANGAPP_SLOW_TESTS=1 (85 OK). The retained-咖 test now derives
its expected path instead of pinning a hash of the then-current default. Branch
`writing-exercises-fitted` (not pushed): 1aca615e code/tests/handoff, 4dc200b7 regenerated
data, 639ea2f2 merge of origin/main c039b839 (only conflicts: generated ATTRIBUTION.html and
derived ZIP, regenerated). After the merge: characters:check, lint, test:pages (3,646 passed)
and build pass; `npm ci` was needed for main's new qrcode/jsqr dependencies.

## Start here

We are improving Chinese tracing guides through a **programmatic, source-driven
fitter with human review, one character at a time**. The current character is
**热 (re, hot)**. Its preferred candidate is **`re-v6.html`**, produced by
`median-simple-models:8` with report schema 5. Those three version numbers
describe different things.

**The user chose 热 v6 after viewing v7: “Actually v6 is fine.” No programmatic
fitting candidate has been applied to the application.** V7 remains an
unselected experiment; preserve both previews. The next step is supervised
nine-character batches with the current rules and no per-character adjustments.

Three layers must not be confused:

| Layer | State |
| --- | --- |
| Dictionary characters and writing-practice UI | Integrated in commit `42a97709`, previously pushed during this session. |
| Manual `authored-monoline` default for 万 | Uncommitted importer/runtime integration and generated assets; unreviewed. It is not the accepted programmatic 万 candidate. |
| Supervised programmatic fitter and previews | Uncommitted, preview-only. Historical 万, 水 and 咖 candidates were accepted individually; 热 remains under review. |

On 2026-10-11, the worktree still has branch
`lancec-writing-exercise-mockups`, HEAD `ccd07286` (the latest-main update used
for this work). No newer fetch, merge, commit or push was performed for this
handoff. The current fitter and its two geometry dependencies match the hashes
embedded in the latest preview. Historical report hashes below were rechecked.
Functional tests were not rerun for this documentation-only update.

## Design intent and review rules

- Produce clean, even-width Chinese handwriting guides, not a traced print font.
  Keep genuine folds and hooks, but remove incidental terminal crooks and kinks.
- Smooth does not mean straight. Preserve broad, intentional curvature,
  including gently curved dots and falling strokes, instead of replacing every
  numerically acceptable shape with straight facets.
- The supplied Duolingo 热 screenshot is a **style reference**, not source
  artwork to trace or copy. The useful characteristics are compact hooks,
  gently curved bottom dots, a rounded right-hand bend, and balanced component
  placement with enough space between the upper components.
- Judge the whole character as well as isolated strokes. Smooth individual
  paths can still have poor lengths, crossbar height or component spacing.
- One logical stroke is one pen-down, even when its path has several segments.
  Do not erase hooks or split a folded stroke to simplify fitting.
- The user initially questioned 咖's short boxes against the printed app glyph,
  then withdrew font matching after seeing the original handwriting-style
  source. Do not revive that work or resize those boxes without a new request.
- Small intentional box-closing overhangs were accepted for 咖. Do not classify
  them as terminal noise. The discussion established a style choice, not an
  official universal handwriting rule.
- Earlier visual approvals are **historical checkpoints, not permanent
  constraints**. The user is open to revisiting 万, 水 and 咖 because some parts
  may still be too angular. Preserve old previews and review each revision.
- Do not bulk-fit, apply artwork, change review status, commit or push merely
  because a candidate passes geometric checks or this handoff exists.

## What is already in the app

Dictionary -> Characters has full and knowledge views. The full collection
combines prepared artwork, exact Han characters from catalog vocabulary and
manual additions. Knowledge membership combines characters in known v2 words
with independent manual additions. No normalization, character substitution,
inferred morpheme meaning or invented artwork is used to fill gaps.

Practice routes are `#writing/<hex-codepoint>/<all|knowledge>`, such as
`#writing/70ed/all`. They load the **prepared default**, not the local candidate
in the comparison canvas. Source-derived defaults are explicitly unreviewed
unless inherited review evidence applies.

There are three phases, with three complete repetitions in each: full guide,
one stroke at a time, and memory. In memory, two committed misses on the same
stroke reveal only that stroke's guide; later strokes remain hidden. Undo
retains assistance history, while Clear resets the repetition and its misses.
Replay is optional and does not count as tracing. Pointer cancellation,
blur/resize/visibility interruptions and Escape do not commit a partial stroke.
Leaving the page restarts unfinished practice.

`practiceCompletions` increments **once after all nine repetitions**, not after
each stroke or repetition. `lastPracticedAt` is recorded with it. Manual
membership and practice history are independent: writing a character does not
automatically add it to knowledge, and removing a manual addition preserves
existing practice history. State is per-profile and travels through backups
and profile YAML; older snapshots default to empty character state.
`characterStates` was introduced at Dexie migration 7; that is not a statement
that 7 is the latest database version.

This is a tracing aid, not general handwriting recognition or a mastery/pass
prediction. It does not create a writing FSRS card or grant vocabulary knowledge.
Japanese/Korean app activation is outside the current work.

## Where the implementation lives

| Files | Responsibility |
| --- | --- |
| `src\pages\Writing.tsx`, `writing.css`, `Writing.test.tsx` | Practice UI, pointer handling, hints, replay and completion saving. |
| `src\core\characters\practice.ts`, `geometry.ts`, `geometry.test.ts` | Three-phase state, path sampling and directional tracing match. |
| `src\core\characters\dictionary.ts`, `store.ts`, `contracts.ts` and their tests | Exact character identity, knowledge membership and persisted completions. |
| `src\pages\Dictionary.tsx`, `src\components\characters\CharacterCard.tsx`, `src\App.tsx` | Character collections and practice entry/routes. |
| `src\core\characters\assets.ts`, `assets.test.ts` | Lazy asset loading and provenance/path validation. |
| `scripts\generate-app-characters.mjs`, `generate-app-characters.test.ts` | Canonical-to-app projection and reproducible source distribution. |
| `scripts\import_chinese_writing.py`, `test_chinese_writing.py` | Pinned source import, variants, authored recipes and canonical generation. |
| `scripts\fit_chinese_strokes.py`, `test_chinese_stroke_fitting.py` | One-character preview fitter and supervised adjustment workflow. |
| `scripts\chinese_monoline.py`, `character_geometry.py` | Shared geometry helpers. Changing them can affect inherited artwork; prefer keeping pilot logic in the fitter. |
| `curriculum\chinese\characters\recipes\authored-monoline.yaml` | Separate manual 万 default, not a programmatic approval record. |

Related persistence code is in `src\core\database.ts`, `backup*.ts` and
`profiles\`. The [asset README](../curriculum/chinese/characters/README.md)
documents the pipeline and fitting rules; the shared artwork contract is
[curriculum/CHARACTERS.md](../curriculum/CHARACTERS.md).

The dirty worktree contains the authored recipe integration, canonical YAML
pages/manifests/coverage, public generated pages, attribution/source ZIP and app
index, plus the fitter/tests and documentation. Many pages changed because
shared provenance changed; do not assume that every dirty page has new geometry.
Prior manual-default checks established that the other 3,000 defaults retained
their paths. The fitter and its test file are still untracked as of this handoff.
Preserve unrelated edits and work only in this worktree, not the main checkout.

## Source, licensing and geometry contract

The current prepared Chinese inventory has 3,001 characters in 80 lazy pages,
with 28,418 logical strokes. Five inherited reviewed defaults are 茶、雨、杯、人、一.
Inventory coverage is not visual approval; do not transfer those approvals to
new recipes or claim the whole collection is professionally reviewed.

Pinned Hanzi Writer Data revision:
`68d10a4b21150cae5e1ebbd223eed289cf32d90c`.

Archive: `curriculum\chinese\upstream\writing\hanzi-writer-selected.zip`.
SHA-256:
`bd98c77053c374fee3b024c444b0e804186721e2fb4b83a68ce4ff211eeeaa68`.

热 source member: `data/热.json`, SHA-256:
`25f30e825e12e831de16c70bb0056ee22e3947b68ef46ea5f0eae3b6114ad20f`.

Source medians and outlines share a y-up em-box. Normalize once:

```text
x = 5 + sourceX * 90 / 1024
y = 5 + (900 - sourceY) * 90 / 1024
```

Do not tight-fit or independently rescale components. Deliberate positioning
in later 热 previews is a separately declared review choice, not a replacement
for source normalization.

Paths contain exactly one initial `M`, followed by explicit absolute `L`, `Q`
or `C` commands, remain nonzero, and keep every endpoint/control in 0..100.
Width is 5.5, with round caps and joins. The shared sampler uses 32 subdivisions
per Bezier. Error measurements are sampled, not analytic guarantees.

Artwork remains under the ARPHIC PUBLIC LICENSE, with original source bytes,
copyright and modification notices retained. The implementation and curriculum
have separate licensing concerns. Do not copy the Duolingo screenshot into the
public artwork distribution.

The manual 万 default is pinned to member hash
`8b7dd1ad6c952991cbab52e7a95552e991f9fef4bbb9b473b225ebbeae04af5d`.
Its recipe currently contains these paths, which differ from the accepted
programmatic 万 preview:

```text
M19.356 27.664 L81.805 20.587
M47.715 41.299 L68.281 41.035 L52.373 78.037 L41.826 71.27
M50.242 24.164 Q41.155 58.018 15.283 74.609
```

## Fitter behavior and remaining automation gap

The preview command validates pinned source bytes and the current page hash.
It produces source/current/candidate columns, isolated-stroke selection,
numbered source points, synchronized replay and a diagnostic JSON report.
Unresolved strokes are absent from the candidate, never silently replaced by
source interpolation. Every report remains `reviewed: false`, `applied: false`.
Output under `curriculum`, `public` and `src` is rejected.

The automatic path tries a central least-squares line, supported sustained
curvature, a quadratic, and distinct connected turns. Later fallbacks fit
joined line/curve primitives, round recognized short returning hooks, and fit
one or two tangent-connected cubic bends after a genuine fold.

The 热 fifth-stroke solution is a line plus two constrained cubics. A single
sweeping cubic was tried and rejected because it pulled the hook inward.
The two-curve version retains the broad bottom bend and upright tip. Tangent
handles are constrained, ordered residuals are checked after serialization,
and sampled self-crossings are rejected.

The gentle-curvature rule counters the original bias toward straight lines.
Source turns must agree in sign and each be below the corner threshold; the
retained core must support at least 8 degrees of matching tangent turn.
A full quadratic with original endpoints must reduce sampled error to at most
half the competing line's error and pass ordinary bounds. This changes 热
strokes 6-10, but does not prove linguistic intent from sparse medians.

Current numeric gates:

| Gate | Value in the 100-unit frame |
| --- | --- |
| Core terminal inset | At most 5.5 units or 20% of stroke length at each end |
| Straight-core error | 1.1 |
| Corner simplification tolerance / minimum turn | 3.3 / 35 degrees |
| Ordinary symmetric source deviation | 4.125 |
| Maximum source endpoint displacement | 5.5 |
| Maximum connected segments | 5 |
| Explicit terminal-only line fallback deviation | 5.5, still requiring core error <= 1.1 |
| Returning-hook length | At least 5.5 and at most 35% of shaft; shaft at least 16.5 |
| Hook fillet trim | At most 3 units or 45% of either limb |
| Cubic ordered error / maximum cubic segments | 1.65 / 2 |
| Sustained core turn / curve-to-line error ratio | At least 8 degrees / at most 0.5 |

Some geometry is still selected manually through reproducible options:

| Option | Meaning |
| --- | --- |
| `--retain-current-stroke N` | Copy an explicitly preferred current path exactly, labeled `retained-current`. Used for 咖 stroke 4. |
| `--compact-stroke N` | A line loses 10% at each end, capped at half a pen width; a recognized return hook keeps two thirds of its returning limb, with its fillet rebuilt. |
| `--translate-stroke N DX DY` | Translate all endpoints/controls together after compaction. Negative x is left; negative y is up. |
| `--trim-line-start N AMOUNT` | After positioning, remove distance only from an `M L` path's pen-down start; retain its end and angle. Start means stroke order, not necessarily screen-left. |

Indices are one-based, repeatable and unique within each option. Exact retained
strokes cannot also be adjusted. Trims are positive and at most 2.75; at least
one pen width of line remains. Translations are finite, nonzero and at most
the endpoint-shift limit in magnitude. Adjustment stages recheck ordinary
source/frame/endpoint limits, without terminal-only relaxation or clamping.
Unsupported choices abort before output. Reports preserve each preceding result,
selected parameters and recomputed measurements.

These are generic geometric operations, but **the selection of strokes and
layout offsets is still supervised**. We have not built an automatic radical
layout engine or a reliable automatic replacement for 咖's retained curve.
Do not describe this pilot as an all-character automatic fix.

## Review history

| Character / preview | Decision or meaningful change |
| --- | --- |
| 万 `wan` | Accepted exact programmatic line / three-segment fold / falling curve. Separate from the manual default. |
| 水 `shui` -> `shui-v2` | Initial strokes 1-3 unresolved; joined primitives and a flagged terminal-only fallback produced four candidates. Stroke 3's 4.932-unit start movement was treated as minor. |
| 水 `shui-v3` | Softened the bottom return hook; other strokes stayed exact. Accepted. |
| 咖 `ka` -> `ka-v2` | Rejected angular fourth stroke; explicitly retained current stroke 4. Box resizing was dropped; closing overhangs were accepted. Exact mixed v2 accepted. |
| 热 `re` | Nine candidates; fifth stroke explicitly unresolved. |
| 热 `re-v2` | Resolved stroke 5 with a line and two smooth cubics; other nine paths unchanged. |
| 热 `re-v3` | Retained gentle curvature in the short crossing stroke and four dots, using the Duolingo style reference. |
| 热 `re-v4` | Compacted strokes 2 and 3: hook limb one third shorter, line 20% shorter. |
| 热 `re-v5` | Moved strokes 1-3 left 1.25; also raised stroke 1 by 3. |
| 热 `re-v6` | Kept v5 except stroke 2 another 1.25 left; stroke 3 up 1 and trimmed 1.5 only at its left/start. Current, not approved. |

Earlier previews were not superseded by rewriting their files. No 热 revision
has received final visual acceptance. Previous 万/水/咖 acceptance does not
approve later fitter versions or authorize app application.

## Reproduce the exact current selection

Run from the repository root. Use `py -3.12 -B`, not the Windows Store `python`
alias. Choose a new output filename so historical reports stay immutable:

```powershell
py -3.12 -B scripts\fit_chinese_strokes.py --character 热 `
  --compact-stroke 2 --compact-stroke 3 `
  --translate-stroke 1 -1.25 -3 `
  --translate-stroke 2 -2.5 0 `
  --translate-stroke 3 -1.25 -1 `
  --trim-line-start 3 1.5 `
  --output C:\Temp\re-v6-reproduced.html
```

This generates HTML plus sibling JSON; it does not modify app assets. The
current recipe uses no retained-current override. The exact ten final paths,
in stroke order, are:

```text
M21.231346 32.896855 L42.692403 26.222989
M35.289587 14.298962 L34.32 56.734 Q34.251 59.734 31.406 58.783 L27.159873 57.36346
M20.683781 50.234548 L38.455574 40.079236
M58.232 13.572 Q59.202 39.192 45.317 60.377
M45.981461 35.326274 L68.370304 28.020617 C63.994705 40.097277 64.734882 57.910156 81.113281 57.910156 C83.126186 57.910156 82.836513 46.033393 82.783203 43.847656
M47.011719 41.914063 Q55.37 45.604 60.722656 52.373047
M27.236328 67.402344 Q24.632 75.023 20.205078 81.816406
M39.101563 68.896484 Q41.974 72.864 43.408203 77.509766
M53.955078 67.490234 Q57.983 71.471 60.195313 76.542969
M68.193359 65.644531 Q77.058 71.267 79.970703 80.761719
```

Strokes 1/2/3 have sampled deviations 4.112/2.875/3.776 and endpoint shifts
2.104/4.112, 0.587/1.697 and 3.776/3.652 respectively. Stroke 1 is close to the
ordinary 4.125 limit; further changes may hit that bound. Do not quietly relax
the bound or report a failed adjustment as success.

## Local artifacts and canvas

Historical artifacts are **session-local, not tracked repository files**:

```text
C:\Users\lancec\.copilot\session-state\b0f76303-523e-42cd-9d05-3c2886eac972\files\stroke-fitting
```

The latest canvas is `browser` instance `hot-re-shaft-and-rising-stroke`,
showing `re-v6.html`. Older 热 canvases can still be open. Reopening an existing
handle with a changed URL once left the visible browser on the old preview:
use a **fresh filename and panel handle for each revision**. Refocusing the
same unchanged URL is fine. Local HTML needs no dev server.

Useful latest images: `re-v6-comparison.png`, `re-v6-stroke-2.png`,
`re-v6-stroke-3.png`, `re-v6-panel.png`, and `re-v6-versus-v5.png`.
The earlier 咖 source comparison is `ka-original.svg` / `ka-original.png`.

The original Duolingo reference remains a local attachment:

```text
C:\Users\lancec\.copilot\workspaces\b0f76303-523e-42cd-9d05-3c2886eac972\attachments\81f7c93d-a6e3-4172-8c9c-6dc082f934f3-Screenshot (Oct 1, 2026 10_52_12 AM).png
```

Historical JSON SHA-256 values, rechecked on 2026-10-11:

```text
wan.json      98f186abbbf1a02a81f25c878ed1fb43623a8f8dbf4f44b68b2eaeb49912e9d6
shui-v3.json  24f2c3b50b1b93064905ff219300f4286308fd264ed6e0a18447ba0b2465cd81
ka-v2.json    26b9bbb306a05ca68e53a27b302e8890e6597adc4c5fc63ab4930b67263b3046
re.json       13b633056e53580e4f1849985e434d0c4e9bc4d6393b4f4be47d2bb66d4848be
re-v2.json    5fd81e8bed76e7d44dd92407f62cb9559d2f07f95e784ff32647ea4b45c80b25
re-v3.json    a3a5e833e9f4c56f3a46c151cafd8f16d94390235f0f82808be2ff1cffdf00b7
re-v4.json    1fbd4a81ffd81171279d3ce8c3e0e9cb9359a962e90fa74fdc50856566d94cbd
re-v5.json    c59ad798d15466169e62e2d1720ea24077ef22f302a322ae33a1dbf0d4b06cb7
re-v6.json    b9998a4a4892a8774c6c4091f617f36d4d5d6435ec85d757c88e77a795352260
```

A newly generated report includes current tool/page hashes. If inputs change,
do not expect its report hash to match an old checkpoint or overwrite the old
report to make it appear current. If session artifacts are unavailable, the
command and exact path list above preserve the latest selection, but historical
screenshots and exact old tool versions are not reconstructed by this file.

## Validation and practical workflow

Last functional validation, 2026-10-01: **61 focused Python tests passed**.
They cover existing accepted regressions, smooth joins, curvature selection,
transforms, strict bounds, explicit retention/adjustment choices, no-output
failures, one-sided trimming, and the crossbar/rising-stroke intersections with
the repositioned shaft.

Edge checks verified ten exact preview paths, the eight unchanged v5 results,
selection labels, per-stroke controls, overlays, replay/Escape and mobile
overflow. All ten forward sampled paths passed the actual app matcher; their
reversals failed. The before/after and isolated-stroke screenshots were
inspected. These checks establish compatibility, not human handwriting quality.
Temporary port-5174 servers were stopped; no server is required for the canvas.

After fitter changes:

```powershell
py -3.12 -B -m unittest discover -s scripts -p test_chinese_stroke_fitting.py
```

Then generate a fresh preview, compare the exact intended paths and unchanged
strokes, inspect the full glyph and isolated affected strokes, and check it in
the actual app sampler/matcher. Do not weaken the matcher to accommodate artwork.
For temporary browser validation, use an available port without disturbing an
existing server; previous checks used:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Verify readiness and stop a server created only for checks afterward. The old Copilot Playwright capture workflow does not apply in hexad. Use
hexad's shared `browser_open` with a `file://` preview URL and
`browser_screenshot`; do not hunt cached Playwright or Node versions.
The currently exposed screenshot signature supports full-page or viewport
captures, but has no element/region, output-path, or attachment-export option.
Captures are delivered directly as chat image attachments. If saving those
exact screenshots to scratch is required, report the missing capability rather
than introducing a workaround.
Selecting a single stroke leaves one `.stroke` element, not ten hidden ones.
The app matcher can be imported from `/src/core/characters/geometry.ts`.

If app or canonical changes are separately authorized, run the relevant
importer/projection/runtime checks, not just the preview suite:

```powershell
py -3.12 -B -m unittest discover -s scripts -p test_chinese_writing.py
py -3.12 -B scripts\import_chinese_writing.py --check
npm run characters:check
npm test -- scripts\generate-app-characters.test.ts src\core\characters\assets.test.ts src\core\characters\geometry.test.ts src\core\characters\dictionary.test.ts src\core\characters\store.test.ts src\pages\Writing.test.tsx
```

If an authored recipe changes, regenerate canonical assets with the importer,
then app assets with `npm run characters:generate`. Changes to `package.json`,
`package-lock.json` or `scripts\generate-app-characters.mjs` also require app
character regeneration because those exact inputs are bundled in the
reproducibility ZIP. `characters:check` must pass before publication; a direct
Vite build does not replace it. Do not regenerate anything for a preview-only
or documentation-only change.

## Resume from here

1. Confirm source/Git state against this handoff and reopen the exact 热 v6
   candidate, not an older 热 canvas. Obtain the next visual judgment.
2. If refining it, preserve v6 and change only the requested strokes. Prefer
   reusable rules or explicit reproducible adjustments, and state what remains
   a human-selected style choice. Keep the rest of the glyph unchanged unless
   a broader change is requested.
3. Revisit earlier accepted characters individually if requested, retaining
   their historical approvals and previews rather than treating them as a
   permanent stylistic constraint.
4. Applying a candidate to canonical/app defaults, changing review evidence,
   expanding automation across characters, or publishing is separate work.
   None of those steps is currently authorized by the preview review or this
   documentation request.

## 2026-10-11 hexad continuation: 热 v7 and supervised batches

The user likes v6 overall and requested only another leftward movement of
stroke 2. Generated v7 with the existing fitter unchanged:

```powershell
py -3.12 -B scripts\fit_chinese_strokes.py --character 热 `
  --compact-stroke 2 --compact-stroke 3 `
  --translate-stroke 1 -1.25 -3 --translate-stroke 2 -3.75 0 `
  --translate-stroke 3 -1.25 -1 --trim-line-start 3 1.5 `
  --output Q:\src\workspace\hexad-data\project\scratch\s-20261011-224906-0b80\re-v7.html
```

Sibling `re-v7.json` and `re-v7-versus-v6.html` are in that scratch folder.
Historical artifacts were read/copied to scratch, never modified.
Stroke 2 moved another 1.25 left relative to v6; all other nine stroke records
and paths match v6 exactly. Tool/source/current hashes also match.
The new path is:

```text
M34.039587 14.298962 L33.07 56.734 Q33.001 59.734 30.156 58.783 L25.909873 57.36346
```

Sampled deviation is 4.124 against 4.125; endpoint shifts are 0.671/1.413.
No gates were relaxed. Strokes 1 and 3 intersect the shaft at approximately
(33.703267,29.018391) and (33.384328,42.977091), within both finite segments.
This remains a human-selected layout/style offset, not a general fitting rule.
V7 is open in the shared browser and awaiting the user's visual verdict.
Hexad screenshots were sent for v6/v7, the full comparison, and isolated
strokes 2 and 3. The tool cannot currently save these exact attachments to
scratch (no output-path/export option). A prior canvas-generated
`re-v7-versus-v6.png` exists but is not a hexad browser screenshot; do not
mislabel it as one. The attempted Playwright capture exited on the Node
version requirement and was abandoned at the user's instruction.

Next, only after the v7 verdict, prepare a varied batch of nine common app
inventory characters. Run current fitter rules first with NO per-character
adjustments. Show a 3×3 sheet and individual previews. Convert requested
corrections into reusable rules with tests wherever possible; explicitly
record remaining human style choices. Aim for a batch needing no corrections.
Do not fit all 3,001 characters until explicitly authorized by the user.
No helper sessions; preserve the dirty worktree, branch and historical files.
No candidate application, review-status changes, commits or pushes authorized.

### Verdict and first batch

The user’s latest verdict is “Actually v6 is fine.” Keep v6 as the preferred
热 preview; v7 is an unselected experiment. This visual choice does not
authorize canonical application or review-status changes.
The focused regression run completed: 61 tests passed in 229.028 seconds.
No fitter code changed.

First batch: 你、好、学、家、国、中、我、小、大. These cover left-right,
top-bottom, enclosure, intersecting strokes, hooks, dots and broad sweeps.
Generate with only `--character` and `--output`, no per-character adjustments.
Batch files are under the session scratch folder's `batch-01` directory.
Await the user's corrections after showing the 3×3 sheet and individual links.

Batch 01 generated successfully: nine individual HTML/JSON pairs, `index.html`
3×3 sheet, and `batch-summary.json` in scratch `batch-01`. All nine have
complete fitted paths; no unresolved strokes or selection adjustments.
Maximum sampled deviations: 你 4.050, 好 3.736, 学 3.424, 家 3.526,
国 2.724, 中 2.583, 我 3.721, 小 3.844, 大 2.945 (limit 4.125).
Generation's final console summary hit a Windows cp1252 UnicodeEncodeError
AFTER all files were written; all nine fitter subprocesses exited successfully
and the files/selection flags were independently verified. This is a scratch
reporting issue, not a fitter failure. The sheet is open in the shared browser.
Click any character to see its individual three-panel preview and stroke control.
Awaiting user corrections; no fitter or app assets changed.

### Batch 01 feedback (pending rule work)

User: “Ni has crooks on the top character radicals. Same is true for da.
The dot stoke touches the others a little too much.”
Interpretation: unwanted top crooks in 你 and 大; dot separation needs correction.
Asked which character's dot is intended; do not assume the sense/stroke.
Finish the requested performance work and verification before geometry changes.
Batch 01 is not correction-free; scale fitting remains unauthorized.

## Fitter performance workflow — 2026-10-11

Implemented at user request, without changing geometry:
- Repeat `--character` or use `--characters 你好学家国中我小大`.
  Maximum nine distinct characters per supervised process; scale mode is not enabled.
  Batch adjustments are rejected. Full validation completes before writing outputs.
- `--output SCRATCH\sheet.html` writes the 3-column sheet plus
  `sheet-01-u4f60.html/.json`, etc., and a sheet JSON index.
- A shared validated context extracts inventory, validates pinned source archive
  and loads the manifest once per batch. Current page checks stay live per report.
- `scripts/chinese_fitting_inventory.py` stores successful validated inventories
  in `$env:HEXAD_SCRATCH\chinese-fitting-inventory`, falling back to workspace
  `.cache\chinese-fitting-inventory`. Never application/curriculum directories.
  Keys hash EVERY curriculum file and Python workflow source (3,556 snapshot
  inputs here), plus parser/runtime/policy versions. Conservative over-invalidation
  covers indirect/generated dependencies, optional/new files, deletes and citation
  inputs. Each lookup hashes bytes, not mtimes. Cache payload digest is checked;
  corrupt entries are rebuilt. Inputs changing during extraction fail without
  publishing the cache. Reports preserve inventory, source and snapshot hashes.
- `curriculum_yaml.py` already selected CSafeLoader in this dirty worktree.
  Refactored to explicit libyaml/pure safe-loader classes sharing the exact mapping
  constructor, preserving duplicate/unhashable-key validation and pure fallback.
  `load_yaml(..., loader=...)` allows explicit parity tests; default stays libyaml.
- Fitter tests share ONE real validated context. Dedicated inventory test verifies
  all 3,001 characters and input hashes. Parser test compares BOTH loaders across
  all real Chinese inventory YAML inputs. Synthetic cache tests cover hits, edits
  with unchanged mtime, added/deleted inputs, corrupt payloads, failed validation
  and edits during extraction. CLI tests cover repeat/joined modes, shared context,
  individual output/report provenance, batch adjustment/scale rejection.

Measurements with `py -3.12 -B` on this machine:
- Before: one 中 invocation 19.55 s (user's earlier profile was 40 s, 38.3 inventory).
  Prior nine-process batch estimate from this local measurement: ~176 s;
  this is an estimate, not a measured nine-character baseline.
- After: cold nine-character batch 28.32 s.
- After: warm nine-character batches 5.76 s and 5.75 s (fresh processes).
- Prior focused suite: 61 tests / 229.028 s.
- Final expanded focused suite: 68 tests / 59.571 s, all passed.
  Earlier concurrent cold run: 68 / 85.903 s. Pure-parser parity intentionally
  remains in the suite and contributes runtime.
- All nine batch-01 stroke records match optimized reports exactly.
  No algorithm gates relaxed or review-status changes; no app application.

Timings/previews: session scratch `perf-before.html`, `perf-after-final\sheet.html`,
`perf-warm-1\sheet.html`, `perf-warm-2\sheet.html`.
Use native hexad browser tools only for supervised preview display/capture.
Pending: reusable-rule corrections for the user's batch-01 feedback above;
dot character needs clarification. No scale, commit or push authorization.

Additional checks: `test_character_assets.py` passed 32 tests in 33.547 s.
Real-input parser timing (152 YAML files): pure 39.85 s, libyaml 6.07 s;
this isolated run overlapped other validation, so treat as illustrative.
Scoped diff whitespace check passed.


## Preview speed-up v2 and batch-01 corrections (2026-10-11)

User direction replaced the inventory cache: previews never call
`extract_inventory` or load curriculum YAML. `prepare_context` now reads only
the source lock, archive (hash-checked), license hash, and the character manifest.
Per character it checks the lock's member hash, then loads the single indexed
page after checking its manifest SHA-256 (no generated asset change needed;
the manifest already records page hashes). Missing index entry, wrong page hash,
wrong member/archive hash and unknown characters fail with clear errors (tests).
Removed `scripts/chinese_fitting_inventory.py`, its tests and cache output.
Kept the libyaml loader. Reports no longer embed inventory hashes; they record
source/lock/manifest input hashes and the page hash. Full inventory validation
stays in characters:check, the importer, and one dedicated full-inventory test.
Cold 9-character batch: 2.33 s (was 28.3 s cold with inventory, 19.55 s single).
With the new correction rules disabled, all nine reports' strokes/source/current
match batch-01 exactly. Tests: 75 passed, 82.5 s (dominated by the dedicated
full-inventory test and pure-parser comparison).

Corrections (VERSION median-simple-models:9), general rules, no per-character offsets:
- short-entry-flick:1: a short down-right entry before a long descending body is
  removed by moving the body start halfway between the original start and the body's
  back-projection; ordinary deviation/endpoint gates apply. Affects 你(1,3), 好(1),
  中(4), 大(2).
- isolated-dot-clearance:1: a short disjoint down-right curve is compacted about
  its centre (10-50%) when its gap to other strokes is under 1.1 widths and the
  source medians do not touch. Affects 国 stroke 7 only.
Human style choices still open: how much entry flick to keep, desired dot clearance.
Revised batch: scratch batch-01-v2\sheet.html. Awaiting the user's verdict.


### Batch sheet shows the original source image (2026-10-11)
User asked for the actual original image, not medians. Each batch tile now shows,
left, the pinned Hanzi Writer Data **filled stroke outlines** (the archive's
`strokes` paths, unmodified), transformed into the same 100-unit frame with the same
matrix as the medians (`SOURCE_FRAME_MATRIX`), beside the candidate. Reports record
`source_outlines` and `source_outline_matrix`. Only one upstream source exists locally
(Hanzi Writer Data, derived from Make Me a Hanzi / Arphic); no reference font is
bundled, so none was used. Sheet: scratch batch-01-v4\sheet.html.


### Batch 01 accepted (2026-10-11)
User verdict on the revised batch-01 sheet (source outlines beside candidates): "No corrections."
Rules in force: median-simple-models:9 (short-entry-flick:1, isolated-dot-clearance:1).
Style choices still human: entry-flick amount, dot clearance. No scale run authorized.
Batch 02 (current rules, no adjustments): 的是这们说门心水到 — 的 dot/hook, 是 top-bottom, 这 walking
radical, 们 left-right with vertical, 说 speech radical, 门 enclosure with hooks, 心 dots, 水 hooks and
sweeps, 到 left-right with vertical hook. Sheet: scratch batch-02\sheet.html.


### Batch 02 result with current rules (no adjustments)
Characters 的是这们说门心水到, rules median-simple-models:9. Sheet: scratch batch-02\sheet.html.
Unresolved (no fit inside the gates, shown as missing, never substituted):
- 们 stroke 1 (left-falling stroke with a short down-right entry, 7 median points)
- 门 stroke 3 (short entry, long vertical, return hook)
- 到 stroke 8 (same vertical-hook shape as 门 stroke 3)
Fitted through the existing terminal-adjusted line rule (up to 5.5 units, not an ordinary-limit breach):
的 stroke 1 (4.33) and 水 stroke 3 (4.93); both are flagged for review.
smooth_entry_flick only runs on strokes that already fit, so it does not reach these three.
Awaiting the user's marks. No rule has been changed for batch 02 yet.


### Batch 02 unresolved strokes fixed (median-simple-models:10)
User approved fixing 们 stroke 1, 门 stroke 3 and 到 stroke 8 with general rules; gates unchanged.
- New last-resort model `merged_corner_fit` (rule merged-corner-lines:1), run only after every other
  model fails, so no previously fitted stroke can change. A sub-width segment between longer limbs is a
  rounded corner and is dropped; a bend under 35 degrees is merged into one limb. Joins may lie on the
  dropped median section within the ordinary endpoint-shift bound. Guards: at most 3 straight limbs
  (a hook or falling stroke, not a curve), dropped sections under one stroke width, no self-crossing, inside
  the frame, same direction/angle/deviation/endpoint gates. A short leading entry then goes through
  short-entry-flick:1.
- Results: 们 1 and 到 8 fit via the entry-flick rule (deviation 3.37 and 2.46); 门 3 via merged-corner-lines
  (2.73). Across batch 01 and 02, no previously fitted stroke changed (checked stroke by stroke).
- First attempts also fitted 热 stroke 5 and a curved-hook limits test case; the 3-limb, straight-limb,
  short-section and self-crossing guards remove those. Tests: 80 passed, 86 s.
- Still flagged for review, not changed: 的 stroke 1 (4.33) and 水 stroke 3 (4.93), terminal-adjusted fits.
Sheet: scratch batch-02-v3\sheet.html. Awaiting the user's verdict.

### Batch 02 feedback: hook and bend softening (2026-10-11)

User: 心 stroke 2, 们 stroke 5 and 的 stroke 7 were too angular; 的's hook should
descend straight, then turn upward. Added a general rule, not per-character:
`soften_hook_and_bends`, version `median-simple-models:11`, rule
`hook-and-bend-softening:1`. It applies only to fitted all-line polylines and
keeps every numeric gate (a rejected softening leaves the fit unchanged). It
turns a short chamfer before a final hook into one quadratic, rounds a final hook
with the bounded fillet, and smooths runs of shallow same-direction bends.
Across both batches it changed exactly 7 strokes: 家 3, 中 2, 的 7, 们 5, 门 3,
心 2, 到 8 (max deviation 3.821). Nothing else changed. Fitter tests: 83 passed.
Previews: scratch `batch-02-v4` and `batch-01-v5`. Awaiting the user's visual
verdict, especially 的 7, which still looks close to the source. No scale run,
application or commit is authorized.

### Batch 01 corrections declared and verified (2026-10-25)

Batch 01 stands accepted by the user. The earlier crook and dot complaints were
already general rules, `short-entry-flick:1` (你 1 and 3, 好 1, 中 4, 大 2) and
`isolated-dot-clearance:1` (国 7). Their paths are identical in every saved
report from batch-01-v2 to batch-01-v6; the original batch-01 had the crooks and
the touching dot. Close-ups of 你, 大 and 国 in v5 showed no crook and a clear dot.
No batch-01 rule was changed. The later rules changed only 学 7 (the softening
rule's chamfer case, fitter version 12); no other batch-01 stroke moved.

### Batch 02 corrections, fitter `median-simple-models:13` (2026-10-25)

User: 是, 这 and 们 are fine; 的 7 stands. Corrections: 说 9 should be a smooth
curve, and 这 6 collapsed a real fold.
- `sustained-bend-fillet:1`: a straight-segment stroke that turns the same way at
  every vertex for at least 150 degrees, with no source turn above 45 degrees,
  gets large-radius quadratic fillets (maximum 8, shared between limbs). Gates are
  unchanged. 万 stroke 2 has one 60-degree source turn, so it is deliberately kept.
- `sustained-fold-retention:1`: a finer corner pass (tolerance 2.75 then 2.2) may add
  a vertex only when every limb is at least 2 pen widths and every turn at least
  25 degrees. 这 6 is the only stroke it changes in both batches.
- Also added `short-entry-flick`-style chamfer handling for 学 7 (version 12).
Strokes changed by v13 against v4/v5 across both batches: 学 7, 这 6, 说 9.
Tests: 85 total, 3 slow ones skipped by default. Previews: scratch batch-01-v6 and
batch-02-v5. The user's review of 这 6 and 说 9 is pending. No application,
commit or scale run.

### Test speed (2026-10-25)

`FullInventoryTests` (full 3,001-character inventory, parser parity, loader
rejection) are skipped unless `LANGAPP_SLOW_TESTS=1`; they take about 68 s. Real
default per-character reports are now cached per run. The default fitter suite
runs in about 18 s, down from about 94 s. `characters:check` does not run these
Python tests, and no CI file does, so the slow set needs a separate command:
`$env:LANGAPP_SLOW_TESTS="1"; py -3.12 -B -m unittest discover -s scripts -p test_chinese_stroke_fitting.py`.
