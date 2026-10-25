# New / Review study flow handoff

State: implemented and committed. During Pages publication preparation on
2026-09-23, the full suite was run and stale UI/schema assertions were corrected.
All 1945 Pages release tests, lint, and the complete root/v1 build now pass.
The strict all-seven-band authoring audit remains blocked by missing HSK 7-9
usage examples, which are outside the published HSK 1-6 app. See
`assistant-handoff.md` for the deployment gates and publication state.

Verified manually in the dev server (2026-09-22, deepseek-v4.1-flash via Poe,
structured output off): a New session generated 10 exercises, all accepted, and
the first answer was checked and scheduled. That required three fixes:

- The prompt names every field per exercise type, and `structured.ts` appends
  the JSON schema to the system prompt when strict JSON-schema output is off
  (the model had returned `correctIndex`/`sentence`).
- Explanations may quote Chinese; `validateProposal` checks it with the
  segmenter like every other Chinese string.
- Unit label/ref regexes accept the `--` separator used by every v2 label; before
  this, every target ref failed validation.

Before these fixes, 4 study tests failed (2 in `exercises.test.ts`, 2 in
`knowledge.test.ts`), consistent with the last two bugs; all pass in the
2026-09-23 release run.

## What was built

- `scripts/generate-v2-app-data.mjs` (+ test): per-band `src/data/v2/*.generated.json`
  with vocabulary, grammar (with `ex`) and the planner's introduction groups.
  `npm run curriculum:v2:app[:check]`; `build:next` runs the check.
- `src/core/study/`: `contracts.ts` (zod schemas), `fsrs.ts` (FSRS-5 formulas,
  small state machine), `catalog.ts` (lazy band loading, unit lookup, example
  rendering), `exercises.ts` (prompt, JSON schema, segmenter/validator,
  answer checking), `knowledge.ts` (knowledge set, next group, due cards,
  sessions, answers), `labels.ts`.
- `src/core/ai/structured.ts`: one-shot structured JSON request over the
  existing Assistant connection (chat-completions and Responses).
- `settings/system-prompts/exercises.md`: generation prompt.
- UI: `src/pages/Study.tsx` (Lessons tab: New / Review, intro, player,
  completion), `src/pages/Dictionary.tsx` (v2 sections), `src/components/study/*`.
- Dexie schema 4 (`knowledge`, `studyCards`, `exerciseSessions`,
  `exerciseAttempts`); backup schema 3 adds `study`.
- Routes: `#lessons` = Study, `#lessons/session/<id>`, old map at `#curriculum`.

## Tests added / changed

New: `src/core/study/{fsrs,exercises,knowledge}.test.ts`, `src/pages/Study.test.tsx`,
`scripts/generate-v2-app-data.test.ts`. Updated for the new Lessons and Dictionary
pages and backup schema: `src/App.test.tsx`, `src/pages/Curriculum.test.tsx`,
`src/core/backup.test.ts`, `src/core/curriculum.test.ts`,
`src/components/learning/LearningModels.test.tsx`.

## Open follow-ups

- HSK 7-9 has no `examples.yaml`, so it is not in the app data yet.
- Only the `reading` domain has cards; listening/speaking/writing would be
  separate cards and exercise types. Dictionary -> Characters now provides
  separate three-phase tracing practice, without a writing FSRS card or mastery
  claim. **Current writing continuation lives in
  [Writing exercises and stroke fitting](writing-handoff.md).** Update that
  dedicated handoff for further work. The writing chronology below is frozen
  historical context through 2026-10-01, not a second live status record.

  Character membership is derived from exact known v2 vocabulary
  spellings plus manual additions. Dexie 7 `characterStates` stores manual
  membership and completed rounds; backup 4 and profile YAML 3 preserve them
  while accepting older snapshots with an empty character-state list.
  The prepared Chinese default paths are projected by
  `scripts/generate-app-characters.mjs`, checked during `build:next`, and loaded
  by Unicode page only when practice is opened. New geometry/review approval
  and Japanese/Korean app activation remain outside this integration.
  On 2026-09-30, 万 received a separate source-pinned `authored-monoline`
  default: straight slanted top, a single three-segment folded hook, and one
  smooth falling curve. It remains unreviewed; the original baseline and five
  inherited approvals are unchanged. Edit
  `curriculum/chinese/characters/recipes/authored-monoline.yaml`, then run
  `py -3.12 -B scripts/import_chinese_writing.py` and
  `npm run characters:generate` together so geometry, provenance, notices,
  coverage and the app's downloadable source stay consistent.
  The subsequent supervised fitting experiment is preview-only:
  `scripts/fit_chinese_strokes.py --character 万 --output <preview.html>`
  compares source medians, the current authored guide and a source-driven
  candidate, with per-stroke controls and a JSON diagnostic report. It infers
  line / connected-lines / quadratic for 万 without character-specific
  coordinates. On 2026-09-30 the user accepted the displayed 万 candidate
  ("The programmatic candidate looks ok to me") and requested 水 next.
  The accepted session report `files/stroke-fitting/wan.json` has SHA-256
  `98f186abbbf1a02a81f25c878ed1fb43623a8f8dbf4f44b68b2eaeb49912e9d6`.
  This acceptance covers that exact candidate, not the different manual default,
  future fitter revisions or other characters. No programmatic candidate has
  been applied to the app, and no bulk application is authorized.
  The unchanged fitter's 水 preview remains `files/stroke-fitting/shui.html`
  with its sibling JSON report: strokes 1-3 were unresolved; stroke 4 was a
  quadratic candidate. The user authorized resolving these gaps.
  Version `median-simple-models:2` produces all four candidates in
  `files/stroke-fitting/shui-v2.html` without changing app guides: connected
  shaft/hook lines, line plus quadratic, straight falling line, and quadratic.
  New fallbacks join independently fitted primitives at bounded tangent
  intersections; a terminal-only line fallback explicitly allows deviation
  up to 5.5 units while keeping central deviation within 1.1 units. 水 stroke 3
  is flagged for its 4.932-unit start movement. The other stroke deviations
  stay within the original 4.125-unit limit. All accepted 万 path strings remain
  byte-exact; its original accepted report is preserved.
  The user treated stroke 3's adjustment as minor but requested a softer bottom
  hook. Version `median-simple-models:3` rounds only stroke 1's centerline turn,
  using the existing bounded quadratic fillet on inferred short returning hooks,
  not character-specific coordinates. Fitted endpoints are retained; 水 strokes
  2-4 and all accepted 万 paths stay byte-exact. The rounded hook's maximum
  sampled deviation remains 3.996 units, within the ordinary 4.125-unit limit.
  New preview: `files/stroke-fitting/shui-v3.html`; its JSON report SHA-256 is
  `24f2c3b50b1b93064905ff219300f4286308fd264ed6e0a18447ba0b2465cd81`.
  The 21 focused tests pass, including tangent continuity, endpoint preservation,
  non-hook exclusions and previous path regressions. Edge preview/replay and
  forward/reverse app matching were checked; the hook screenshot was inspected.
  Previous reports remain unchanged, and no app/canonical asset was generated.
  Opened a fresh browser panel `water-fitting-soft-hook`: reusing a panel handle
  previously left the user's visible browser on its old URL despite a successful
  open response. On 2026-09-30 the user accepted this exact 水 v3 candidate
  ("Seems ok") and requested 咖 (ka, the first character in coffee) next.
  Its full path list now has an exact regression, like the accepted 万 paths;
  neither acceptance authorizes app application, bulk rollout or future changes.
  The unchanged version-3 fitter produced eight bounded 咖 candidates in
  `files/stroke-fitting/ka.html`, opened in fresh panel `coffee-ka-first-fit`.
  Its JSON SHA-256 is
  `155dfb38049dd42310193f5d965fab1293b10ed865de463cc294595435302e63`.
  Models: line / connected-lines / line / connected-lines / quadratic / line /
  connected-lines / line. All sampled deviations are within the ordinary
  4.125-unit bound (maximum 3.818), with no terminal-only allowance.
  Stroke 4 has a four-line folded hook with an angular lower bend: geometric
  acceptance is not visual approval, and this is a particular review point.
  All 22 focused tests pass. Eight-stroke rendering, each isolated exact path,
  replay, narrow layout and forward/reverse app matching were checked in Edge;
  the full comparison screenshot was inspected. No fitter algorithm, app guide
  or prior accepted report changed.
  The user rejected 咖's fitted stroke 4 and preferred the current guide's
  smooth shape. They initially compared the side boxes with the printed app
  character, then dropped font-matching after seeing the original filled source
  (`files/stroke-fitting/ka-original.svg`). Keep the source handwriting proportions;
  do not resize the side boxes or continue the cancelled font-measurement work.
  Added repeatable `--retain-current-stroke` to the preview-only CLI, with
  one-based validated indices and schema-v2 selection metadata. This is an
  explicit current-guide choice, not a new successful fitted model or silent
  fallback. Generic fitting still produces the rejected angular stroke 4 when
  no retention is requested; automated selection of such good existing curves
  remains future work.
  `--character 咖 --retain-current-stroke 4` produces
  `files/stroke-fitting/ka-v2.html`, opened in `coffee-retained-fourth-stroke`.
  Its JSON SHA-256 is
  `26b9bbb306a05ca68e53a27b302e8890e6597adc4c5fc63ab4930b67263b3046`.
  Stroke 4 copies the pinned current path exactly; all seven other candidate
  paths and the side-box proportions remain unchanged. The preview labels
  the retained stroke prominently; it is not overall approval.
  All 27 focused tests pass, including exact retention, invalid selections,
  no implicit fallback and accepted 万/水 regressions. Edge isolated-stroke,
  replay, mobile overflow and all eight forward/reverse matching checks pass;
  the retained hook screenshot was inspected. Earlier reports remain immutable.
  On 2026-10-01 the user accepted the displayed 咖 v2 ("what we have seems fine")
  after discussing the small rightward overhang of the closing box strokes.
  The exact report hash above was rechecked and its comparison image inspected:
  both side boxes close visibly, bottom strokes extend slightly to the right,
  left verticals extend below them, and retained stroke 4 keeps its smooth hook.
  Preserve these intentional joins/overhangs rather than classifying them as
  terminal wiggles. This is visual acceptance of that exact mixed candidate,
  not approval of the original fully fitted 咖, a formal handwriting standard,
  or authorization for application/bulk rollout. No geometry changed during
  this review, and no app/canonical assets were regenerated or applied.
  Next requested character: 热 (re, hot). The unchanged fitter generated
  `files/stroke-fitting/re.html`, opened in fresh panel `hot-re-first-fit`.
  Its JSON SHA-256 is
  `13b633056e53580e4f1849985e434d0c4e9bc4d6393b4f4be47d2bb66d4848be`.
  Nine of ten strokes have candidates, all within the ordinary fit limits;
  stroke 2 reuses the rounded return-hook rule. Stroke 5, the right-side bent
  hook, remains explicitly unresolved and absent from the candidate panel.
  The source/current panels retain all ten strokes. No current stroke was
  implicitly retained or approved. The comparison image, isolated unresolved
  stroke and replay were checked. 热 awaits supervised review and resolution
  of stroke 5; no fitter rule or accepted character changed.
  On 2026-10-01 the user requested continuation, so version
  `median-simple-models:4` now resolves 热 stroke 5 through a new final fallback:
  a fitted line, a genuine fold and two tangent-connected cubic bends. A single
  sweeping cubic visibly pulled the hook inward, so that experiment was rejected.
  The implemented bounded two-curve fit preserves the broad lower bend and the
  upright tip without source interpolation or a retained-current override.
  Constrained tangent handles avoid curvature reversals; source-order residual
  is limited to 1.65 units, and all existing whole-stroke limits remain enforced.
  The fifth stroke has 1.376-unit symmetric sampled deviation, 1.413-unit ordered
  curve error, endpoint shifts 0.929/0, source fold index 5 and smooth join 14.
  All nine other 热 paths and accepted 万/水/咖 geometry stay byte-exact.
  New preview `files/stroke-fitting/re-v2.html` is open in fresh panel
  `hot-re-smooth-hook`; JSON SHA-256:
  `5fd81e8bed76e7d44dd92407f62cb9559d2f07f95e784ff32647ea4b45c80b25`.
  All 34 focused tests pass, including accepted regressions, tangent continuity,
  signed curvature, translation/reflection/rotation, strict failure limits and
  sampled self-crossing rejection. Edge confirmed all ten paths, per-stroke
  controls, point overlay, replay, mobile width and forward/reverse app matching.
  Full and isolated fifth-stroke screenshots were inspected. The old app server
  had stopped; a temporary server on 5174 was used for matching and stopped
  afterward. The file-based review panel does not need that server.
  热 v2 awaits visual approval. Previous reports remain immutable; no canonical
  bundle, app asset, accepted guide, commit or push was produced by this step.
  The user then requested preserving natural curvature after supplying a
  Duolingo style reference; its artwork was not traced or copied. Version
  `median-simple-models:5` can prefer a supported gentle quadratic over an
  otherwise valid line. Source turns must be one-way and individually below
  35 degrees, with at least 8 degrees of matching core tangent turn. A uniformly
  resampled full-stroke fit preserves source endpoints and must reduce sampled
  deviation to at most half the line's error, while passing all ordinary limits.
  Reports explicitly record `sustained-curve`, core/source turns, the competing
  line and error ratio. This is provisional geometric evidence, not proof of
  linguistic intent; sparse medians still need visual judgment.
  New preview `files/stroke-fitting/re-v3.html` is open in fresh panel
  `hot-re-preserved-curvature`; JSON SHA-256:
  `a3a5e833e9f4c56f3a46c151cafd8f16d94390235f0f82808be2ff1cffdf00b7`.
  Only 热 strokes 6-10 change: the short crossing stroke and four bottom dots
  now have gentle quadratic curvature, with zero reported endpoint displacement.
  Their deviations are 0.488, 0.181, 0.124, 0.233 and 0.486 units respectively.
  The first five strokes, including the two hooks, remain byte-exact from v2;
  no hook shortening or proportion adjustment was attempted.
  All 38 focused tests pass, including measured improvement, endpoint retention,
  straight-core exclusions, transforms, synthetic non-character-specific curves
  and existing hook/retention regressions. Edge confirmed all ten exact paths,
  per-stroke controls, source points, replay/Escape, mobile width and all ten
  forward/reverse app matches. Full and isolated last-dot screenshots were
  inspected; the temporary app server on 5174 was stopped afterward.
  热 v3 is awaiting user visual review, not approved or applied. Earlier preview
  reports remain unchanged, as do the accepted 万/水/咖 paths in this iteration.
  The user also noted that previously accepted characters may be too angular:
  treat their approvals as historical checkpoints, not permanent constraints.
  After this 热 review, revisit any requested earlier character individually,
  preserving its old preview and obtaining review of each new candidate.
  No bulk revision, canonical/app regeneration, commit or push is authorized.
  The next review requested a less pronounced third stroke and second-stroke
  hook. The user confirmed shorter reach, not softer angles: shorten stroke 3
  and reduce how far stroke 2's bottom hook extends left.
  Version `median-simple-models:6` adds repeatable `--compact-stroke` as an
  explicit, geometry-driven style selection; automatic fitting is unchanged.
  Lines lose 10% at each end, capped at half a pen width, retaining center and
  direction. Recognized rounded return hooks keep two thirds of their returning
  limb, retaining shaft, fold and return direction and rebuilding the existing
  fillet. Ordinary source-deviation/endpoint limits are rechecked through the
  same metrics helper as automatic candidates; no terminal-only relaxation.
  Unsupported shapes, bounds failures, invalid indices and conflicts with exact
  current-guide retention fail before output rather than silently falling back.
  Schema-v3 reports retain the original fitted result under each compacted
  stroke, plus explicit selection/policy and recomputed measurements.
  Command: `py -3.12 -B scripts\fit_chinese_strokes.py --character 热
  --compact-stroke 2 --compact-stroke 3 --output <re-v4.html>`.
  New preview `files/stroke-fitting/re-v4.html` is open in fresh panel
  `hot-re-compact-strokes`; JSON SHA-256:
  `1fbd4a81ffd81171279d3ce8c3e0e9cb9359a962e90fa74fdc50856566d94cbd`.
  Stroke 2's returning limb shrinks from 11.215 to 7.477 units; its maximum
  sampled source deviation is 3.745 and endpoint shifts are 3.083/3.745.
  Stroke 3 shrinks from 27.461 to 21.969 units (20%); its maximum source
  deviation is 3.668 and endpoint shifts are 3.668/2.746.
  Both are within ordinary bounds. All other eight stroke results and the
  source/current reference paths remain byte-exact from v3.
  All 47 focused tests pass, including proportions, tangent continuity,
  transforms, strict bounds, unsupported selections and no-output failures.
  Edge confirmed exact paths, visible selection labels, isolated strokes,
  overlays, replay/Escape, mobile width and all ten forward/reverse app matches.
  Full and isolated stroke-2/stroke-3 screenshots were inspected. The temporary
  server on 5174 was stopped; the file-based canvas remains usable.
  热 v4 awaits visual approval. Earlier reports are preserved; no programmatic
  candidate has been applied and no canonical/app assets, commit or push changed
  in this iteration.
  The user next found the first stroke too low and the left component too close
  to the right, reiterating the Duolingo style reference. Version
  `median-simple-models:7` adds repeatable explicit `--translate-stroke N DX DY`
  after fitting/compaction. The shared affine helper moves all controls and
  endpoints together; it does not reshape, scale, rotate or refit the stroke.
  The new 热 preview retains v4 compaction of strokes 2 and 3, moves strokes
  1-3 left by 1.25 units, and additionally moves stroke 1 up by 3 units.
  Command additions:
  `--translate-stroke 1 -1.25 -3 --translate-stroke 2 -1.25 0 --translate-stroke 3 -1.25 0`.
  These are supervised placement choices, not inferred radical-layout rules.
  Final geometry still passes ordinary source-deviation and endpoint limits;
  no thresholds were relaxed. Maximum deviations for strokes 1-3 are
  4.112, 2.625 and 3.881 units. Other seven stroke results and reference paths
  remain byte-exact from v4. Schema-v4 reports retain the complete unpositioned
  result and explicit offsets, with visible placement labels.
  New preview `files/stroke-fitting/re-v5.html` is open in fresh panel
  `hot-re-component-spacing`; JSON SHA-256:
  `c59ad798d15466169e62e2d1720ea24077ef22f302a322ae33a1dbf0d4b06cb7`.
  All 54 focused tests pass, including unchanged control geometry, crossbar and
  rising-stroke intersections with the shaft, and a measured increase of more
  than one unit in minimum sampled gap between the two upper components.
  Invalid offsets, exact-retention conflicts, source/frame bounds and failed
  output behavior are covered. Edge checked all ten paths, explicit labels,
  per-stroke selection, overlay, replay/Escape, mobile width and forward/reverse
  app matching. Inspected the direct v4/v5 comparison screenshot
  `files/stroke-fitting/re-v5-versus-v4.png` and revisited the supplied reference;
  no Duolingo outlines were traced or copied.
  The temporary app server was stopped. 热 v5 awaits visual review; prior
  previews are preserved and no canonical/app assets, commit or push changed.
  The next user request was isolated: move only stroke 2 a little farther left,
  with stroke 3 shortened on its left side and lifted slightly; leave everything
  else as v5. Version `median-simple-models:8` adds explicit
  `--trim-line-start N AMOUNT`, applied after compaction and positioning. It
  supports only a single fitted line, removes distance from its pen-down start,
  preserves its other endpoint and angle, and retains the complete pre-trim
  result in schema-v5 reports. Amounts are positive and at most half a pen width;
  at least one pen width of line remains. Ordinary source/frame/endpoint limits
  still apply; invalid or unsupported selections abort before writing outputs.
  热 v6 uses the previous compaction of strokes 2 and 3, keeps stroke 1 at
  `dx=-1.25, dy=-3`, moves stroke 2 to `dx=-2.5, dy=0`, and moves stroke 3 to
  `dx=-1.25, dy=-1` before `--trim-line-start 3 1.5`.
  Relative to v5, stroke 2 moves another 1.25 units left without reshaping.
  Stroke 3 moves up 1 unit and loses 1.5 units only from its left/start end;
  its final path is `M20.683781 50.234548 L38.455574 40.079236`.
  Stroke 2's maximum source deviation is 2.875, with endpoint shifts
  0.587/1.697. Stroke 3's deviation is 3.776, with shifts 3.776/3.652.
  The other eight full stroke results and source/current reference paths remain
  byte-exact from v5.
  New preview `files/stroke-fitting/re-v6.html` is open in fresh panel
  `hot-re-shaft-and-rising-stroke`; JSON SHA-256:
  `b9998a4a4892a8774c6c4091f617f36d4d5d6435ec85d757c88e77a795352260`.
  All 61 focused tests pass, including one-sided trimming in either direction,
  exact retained endpoint, unchanged angle, both shaft intersections, invalid
  selections/amounts, source limits and no-output failures. Edge confirmed
  eight unchanged results, all ten paths, labels, selection/overlay/replay,
  mobile width and all forward/reverse app matches. Inspected the direct
  `re-v6-versus-v5.png` comparison and isolated third-stroke screenshot.
  Temporary app server stopped. 热 v6 awaits visual approval; previous reports
  are preserved. No canonical/app assets, commit or push changed.
  Fitter limits are provisional; geometric fit does not establish linguistic
  correctness. Its focused suite is `test_chinese_stroke_fitting.py`.
- The old `#practice` recognition flow and starter words still use the
  original `words` tables and do not feed the knowledge set.
- Exercise coverage of every target is requested in the prompt but not enforced
  after validation; uncovered targets are simply not rescheduled that session.
