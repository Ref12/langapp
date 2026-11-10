# Japanese Practice, stage E: the Practice page

Base `3bd8727`, branch `langapp/pack-3-5e-practice-page`. Screenshots (430 px, Noto CJK): `docs/audits/images/2026-11-10-ja-practice-stage-e/` (zh/ja New items and Reviews with due count, ja Practice-by-skill block, first question for Reading, Listening, Speaking, Writing; real kana/kanji visible).

## Per page item (Japanese)
- Practice New items / Reviews: work, language-scoped; wording from the pack.
- Practice by skill: works. Lessons 1-12 seeded: Reading 22, Listening 25, Speaking 25, Writing 25 exercises, none dataset forms.
- Hands-free / Least practised program: hidden (pack handsFree feature off; its script speaks Chinese).
- Unwritten characters, stroke-only drill types, Learn to write: hidden: the writing area is still switched off for Japanese. Main now has the Japanese stroke data and write views, so switching it on is the next step.
- Classic word-list review and Mahjong: hidden (wordLists/games features off).
- Recent sessions: shown, language-scoped.
- AI-model notice: hidden (modelExercises false).

## Dataset and model, before and after
- Before: loadPracticeData always asked for Chinese band files; presets listed dataset forms (exchange-pick/reply, which-correct, conversation); content generation could send Chinese-written prompts to a connected model.
- After: no dataset request for a pack without one; dataset forms are filtered from presets (rounds kept) via offered.ts/set-plan.ts; model prompts never sent when modelExercises is false, even with a connection.
- Function words, model switch and page description now come from the pack (practice-page.ts); scripts/pwa.ts injects the description.

## Chinese proof
Chinese function-word list byte/order identical; Chinese screen pins, prompt pins and screenshots unchanged; Chinese tests all pass.

## Tests
Targeted set: 48 files, 455 passed, 1 skipped. Full npm run test:pages: 311 files, 5060 passed, 19 skipped, 1 failed (Assistant.test.tsx "waits for the JSON default", a load-timing flake; passes alone 45/45, untouched by this work). Lint 0 errors; Chinese and ja builds pass. New pins: ja-practice-start (changed), ja-practice-by-skill, ja ready page.

## Notes
- Step 3.6: conjugate/form-pick forms can join the pack form list; offered.ts already filters by pack.
- Step 4: delete parallel code; the Japanese Hands-free speech locale remains unwired.
