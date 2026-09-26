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
  claim. Character membership is derived from exact known v2 vocabulary
  spellings plus manual additions. Dexie 7 `characterStates` stores manual
  membership and completed rounds; backup 4 and profile YAML 3 preserve them
  while accepting older snapshots with an empty character-state list.
  The prepared Chinese default paths are projected by
  `scripts/generate-app-characters.mjs`, checked during `build:next`, and loaded
  by Unicode page only when practice is opened. New geometry/review approval
  and Japanese/Korean app activation remain outside this integration.
- The old `#practice` recognition flow and starter words still use the
  original `words` tables and do not feed the knowledge set.
- Exercise coverage of every target is requested in the prompt but not enforced
  after validation; uncovered targets are simply not rescheduled that session.
