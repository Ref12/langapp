# New / Review study flow handoff

State: implemented and committed; `tsc -b` and `eslint .` passed before the fixes
below. The full `npm test` suite has not been run; the user chose to commit
without it. Run `npm test` and fix anything the new tests report.

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
`knowledge.test.ts`), consistent with the last two bugs; not re-run since.

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
  separate cards and exercise types.
- The old `#practice` recognition flow and starter words still use the
  original `words` tables and do not feed the knowledge set.
- Exercise coverage of every target is requested in the prompt but not enforced
  after validation; uncovered targets are simply not rescheduled that session.
