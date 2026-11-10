# Practice in a Japanese build: inventory and plan for step 3.5

Base `c421affe`. Read, look, write: no source file changed. Build: `LANGAPP_LANGUAGE=ja`, served with `vite preview`, headless Chromium 430 px wide, Noto CJK installed (the font check shows real Japanese glyphs: `font-check-lessons.png`). Screenshots are in `docs/audits/images/2026-11-10-ja-practice/` (named below). Lessons 13 and 40 were reached by writing the knowledge of lessons 1 to 12 and 1 to 39 into IndexedDB, as a learner who had finished them would have. Everything was done without a connected model. Limits: my answering script chose options blindly, so "answered once right" is shown for choice, listen-pick, recall and match only in the sense the app marked them; the Word order form could not be completed at all (F1), so Writing/Listening presets never reached `dictation` or `translate-en-zh`, and those two rows below are read from code and a grader probe, not seen on screen. In F3 the claim about the dictionary-form target is from reading `buildGap`; the screenshots show a gap whose options are the wrong kind of word.

## 1. What a learner sees today

**`#practice` before anything is learned** (`practice-empty.png`): "0 words · 0 grammar", the source picker says "Learning from: Chinese curriculum" and has no other option for the curriculum, the summary says "7 items · 3 words, 4 grammar · 1 lesson · 4 new characters" (kanji counted as "characters"), "Sentence and conversation exercises are written by your own AI model". The page already picks the Japanese lesson 1 items, so the data side is right.

**A set on lesson 1** (`set-ready-lesson-1.png`): the intro cards are correct (kana readings, meanings, example sentences), but the toggle says "Hide pinyin". The session is 15 exercises: Recognise 6, Recall 3, Produce 3, Use 3 (the preview said "1 item has no exercise in the bank yet").

**Lesson 13 and lesson 40**: same engine, 28 exercises. Lesson 40 adds Match pairs and a Fill the gap. The forms that appear: choice, listen-pick, match, recall, pinyin, tiles, gap, translate-zh-en, repeat (Speaking preset). I did not see `translate-en-zh`, `dictation` (the Writing and Listening presets never got far enough: Word order blocks, see below), nor any dataset form.

### Faults seen (each with a screenshot)

| # | Fault | Where | Screenshot |
|---|---|---|---|
| F1 | **Word order cannot be solved.** Tiles are only the kanji runs of the sentence, cut mid-word (飯, 少 of ご飯, 少し; 知 of 知っている), kana, particles and endings are missing; the learner places kanji only and the answer (the full sentence) never matches. The Check button only enables once the tiles are placed; a wrong answer gives a diff against a sentence that cannot be built. | `segmentWords`, `src/core/session/grade.ts:44-47` (Han runs only) via `buildTiles` `bank-forms.ts:68` | `L13-tiles-first.png`, `L13-tiles-question.png`, `L40w-tiles-wrong.png` |
| F2 | **"Type the pinyin" is shown for kana readings.** Title, help text "Pinyin with tones: type numbers (xue2 xi2)…", tone preview. A correct typed reading is not recognised: `gradePinyin('わたし',['わたし'])` returns `self`, so does `watashi`. Every answer ends in "Compare with the answer and mark it yourself. I was right: count it". | `buildPinyinItem` `bank-forms.ts:126`; `gradePinyin` `grade.ts:228`; `PinyinView` `QuestionViews.tsx:~150`; engine text form `EngineQuestion.tsx:95-142` | `L1-pinyin-first.png`, `L1w-pinyin-wrong.png`, `L13-pinyin-first.png` |
| F3 | **Fill the gap does not find conjugated words.** The target is the dictionary form (`勉強する`), the sentence has 勉強します, so `phrase.zh.includes(target)` fails and the gap is not built; when it is built, the blanked sentence and options are kanji-only words, so the option list shows the wrong kind of word (a noun for a verb slot, a hospital for "person"). Wrong options are drawn from known words by band and length only. | `buildGap` `bank-forms.ts:81` | `L1-gap-first.png`, `L40w-gap-wrong.png` |
| F4 | **Typed meanings are fine in English, but a kanji answer is "wrong"**: any Han in the answer is rejected as "The answer should be in English". | `gradeMeaning` `grade.ts:279` | `L1-recall-first.png`, `L1w-recall-wrong.png` |
| F5 | **"Hear" uses the Chinese voice.** Every `HearButton` in the engine passes `locale="zh-Hans"`; the first Hear in the browser showed "System speech could not be played" (no voice here, but the locale is the point). The pack has `speechLocale: 'ja-JP'` and Overview/Lessons already use it. | `EngineQuestion.tsx:126` (and the `lang="zh-Hans"` on prompts: lines 46, 75, 128, 142, 162) | `L13-tiles-first.png` (toast), `L1-listen-pick-first.png` |
| F6 | **Wording is Chinese**: "Type the pinyin", "Hide pinyin" (every question), "Type the Chinese, or its pinyin", form labels (`FORM_LABEL`, `types.ts:24-28`: "Translate to Chinese", "Type the pinyin"), "Chinese ↔ English: choose or type", "Chinese curriculum", `lang="zh-Hans"` on Japanese text (the browser picks Chinese glyph variants for shared kanji). | `types.ts:24`, `Drills.tsx`, `EngineQuestion.tsx`, `QuestionViews.tsx` | most screenshots |
| F7 | **Match pairs, choice, listen-pick work** and mark right and wrong correctly (readings under words follow the Overview setting via the existing token code). Listen-pick options are English translations of other bank phrases, fine; the listen-pick prompt shows no text by design. | `local-exercises.ts` (`buildMatch`, `buildChoice`), `buildListenPick` `bank-forms.ts:97` | `L13-match-first.png`, `L40w-match-wrong.png`, `L13-choice-first.png`, `L1w-choice-wrong.png`, `L13-listen-pick-first.png`, `L1w-listen-pick-wrong.png` |
| F8 | **Phrase identity is its Han characters** (`phraseKey` = the sentence with everything but Han removed). Two Japanese sentences with no kanji (ありがとう, すみません) both have the key `""`: they count as the same sentence ("no sentence twice", dedupe, the bank map). 私は学生です and 私は先生です differ only because of 学生/先生. | `src/core/phrases/key.ts:4`, `phrases/bank.ts:10`, `grammar-match.ts:8`, `user.ts:10` | (probe in the dev server, no screenshot) |
| F9 | **Shown form is not applied in Practice.** "Show verbs as: polite" (default) is honoured in Lessons; Practice cards show 勉強する (dictionary) in Choose the meaning, Match, Recall and Tiles distractors, 勉強します only in sentences and intro. | `buildChoiceItem`, `buildRecall`, `buildPinyinItem`, `buildMatch` use `record.ch` directly | `L1-choice-first.png`, `L13-match-first.png` |
| F10 | **Knowledge counts**: "4 new characters" counts kanji. Writing ("Write", "Practice" buttons on the card) draws kanji from Chinese stroke data; kana have no guide. | `KnowledgeCounts.tsx:9`, `WritePractice.tsx:7,31-32`, `characters/writing-route` | `practice-empty.png` |

## 2. Trace: every form in `FORMS` (`types.ts:22`)

"Reach" is what I saw in a Japanese build. "Chinese assumption" is what has to change.

| Form | Reach (ja) | Built by, from | Graded by | Chinese assumptions |
|---|---|---|---|---|
| `intro` | yes, correct | `plan.ts` introduce stage; cards in `IntroCards.tsx`, `Teach.tsx` | none | "Hide pinyin" toggle label; Write/Practice buttons use Chinese strokes |
| `choice` | yes, works | `buildChoiceItem` `bank-forms.ts:131` -> `study/local-exercises.ts` `buildChoice` (vocabulary records) | exact index | shows `record.ch` (F9); `lang="zh-Hans"` (F6); Han check in `isVocabulary`/distractor filter (none seen) |
| `match` | yes, works | `plan.ts` `matchGroups`+`buildMatch` (local-exercises.ts) | misses list | modes `zh-en`/`zh-py`/`py-en`: the pinyin modes are labelled by pinyin; I saw `zh-en` only; the `zh-py` mode would pair kanji with kana (fine) but is named and labelled pinyin |
| `pinyin` | reachable, **wrong (F2)** | `buildPinyinItem` `bank-forms.ts:126` from `record.pr` | `gradePinyin` `grade.ts:228` (`parseReadings`, tones) | whole path: tones, `formatPinyin`, preview, help text, hint "Letters only" strips marks |
| `recall` | works, minor (F4) | `buildRecall` `bank-forms.ts:121` from `record.ds` senses | `gradeMeaning` `grade.ts:278` | Han rejected (F4); explanation text "X (reading) means …" is fine; `hearText` Chinese voice (F5) |
| `translate-zh-en` | reachable (lesson 1 Use stage), works | `buildTranslate` from a bank phrase (lesson examples) | `gradeMeaning` against `acceptedEnglish` | prompt text is the sentence (fine); form name; `hearText` voice; the accepted English list has only the authored translation (no alternates, no dataset) so a correct different wording ends in self-marking |
| `translate-en-zh` | **not reached** (new items are turned into tiles by the planner, `plan.ts` "A new item never types Chinese"); known items would reach it | `buildTranslate` | `gradeChinese` `grade.ts:156`: compares Han characters, ignores kana: a kana answer ("がくせいです") is `diff` against 学生です。 (probe) | needs kana-aware comparison, IME typing, readings accepted; answer lang `zh` drives speech and handwriting |
| `tiles` | reachable, **broken (F1)** | `buildTiles` `bank-forms.ts:68`, `segmentWords` | `gradeChinese` | Han segmentation; distractors are kanji words |
| `gap` | reachable, **mostly wrong (F3)** | `buildGap` `bank-forms.ts:81` | exact index | `includes(target)` on the dictionary form; distractor pool |
| `listen-pick` | works (F7), voice F5 | `buildListenPick` `bank-forms.ts:97` | exact index | voice `zh-Hans`; the phrase key (F8) |
| `dictation` | **not reached** (Writing/Listening presets stopped at tiles/choice); code path: `buildDictation` -> `gradeChinese` | typed answer must equal the sentence, kana vs kanji (勉強します / べんきょうします) would be `diff`: no variant accepted | `gradeChinese` | needs "kana or kanji counts" and the reading accepted; voice |
| `repeat` | yes, works | `buildRepeat` | none (not graded) | `zh`/`py` fields hold Japanese and its reading (names only); voice F5 |
| `exchange-pick`, `exchange-reply`, `which-correct`, `conversation` | **unreachable** | `DatasetSource` (`dataset-source.ts`) from `loadPracticeData()` (`EngineSet.tsx:45`); the dataset is `src/data/practice/*` built by `scripts/build-practice-dataset.mjs` for Chinese bands only | `gradeChinese`, index | needs the dataset (see 5); model-backed "AI" exercises are separate (`chinese-prompts.ts`, pinned `src/core/__prompts__/P05-exercise-writer.txt`) |
| `conjugate`, `form-pick` | **unreachable in the engine** (only `src/core/parallel/session.ts` `planParallel` builds them) | `core/parallel/conjugate.ts` `buildConjugate`/`buildFormPick` | `gradeConjugate` | step 3.6 |

Engine-level Chinese assumptions that are not tied to one form: `loadSessionBank` (`sources.ts`) takes phrases from the Chinese bank bands (`shippedPhrases`); for Japanese the bank is the pack's lesson sentences (that is why choice/listen work); `FUNCTION_CHARACTERS_LIST` (`function-characters.ts`, the Chinese function words that are always "known"), `phraseForms`/`planSession`'s `formOf` use `record.ch`; Practice page source picker (`Drills.tsx`), `KnowledgeCounts`.

## 3. What the old parallel practice does for Japanese

Entry points: `#lessons/ja/<n>/practise`, `#lessons/ja/review` -> `ParallelPractice.tsx` (not `Practice.tsx`); `Drills.tsx:391` shows `ParallelPracticeSource` for languages whose track has `parallel: true` (not the Japanese app). Exercises are the engine's own types with `language: 'ja'` (`types.ts:63`).

| Piece | File | Does | Verdict |
|---|---|---|---|
| Planner `planParallel` | `parallel/session.ts:144` | Introduce, Recognise (choice, match, form-pick, listen-pick), Use (tiles, conjugate), from `ParallelData` (own loaders) | **Do not reuse**: parallel data shapes (`ParallelData`, refs `zh-hsk1-…`), a second planner. Its ideas (readiness by lesson, taught-form filter) are already in the engine's catalog + knowledge set. |
| Tiles `tilesFor`, `gradeTiles`, `normaliseTile`, `isParticle`, particle list | `parallel/session.ts:254`, `:95`, `:78`, `:82-91` | tokens are real words (kana included), particle tiles carry a description, swapped-particle distractor, grading with position/particle feedback | **Correct and reusable.** Move the segmentation (token list) and grading behind the pack; `TilesItem` already has the `ParallelTilesExtra` fields (`types.ts:70`). |
| `buildConjugate`, `gradeConjugate` | `parallel/conjugate.ts:40,45` | built from the forms engine (`pack-forms`), taught-form filter, rule line, regular-rule alternatives for irregular verbs, kana reading accepted | **Correct, reusable as is**, but belongs to 3.6. |
| `buildFormPick`, `inflectedTokens` | `parallel/conjugate.ts:63-66` | form-to-meaning question, inflected tokens from phrases confirmed by the analyser | Reusable in 3.6; the pack already marks `form`/`span` on tokens (findings 15). |
| `wordFormsTable`, `ruleLine` | `parallel/conjugate.ts` | tables of forms by taught status | 3.6 / Study screens |
| `romanizeJapanese`, `toHiragana`, `toKatakana`, `isKana`, `readingFor` | `parallel/romanize.ts:26-65` | Hepburn romaji from kana; reading setting | **Correct and reusable**: the base of "kana or romaji" grading (below). Needs the reverse direction (romaji -> kana) and the alternative spellings. |
| `shortMeaning` | `parallel/session.ts:115-119` | shortened gloss | duplicates the engine's `shortMeaning`; delete in step 4 |
| `progress.ts`, `refs.ts`, `data.ts`, `practice.ts` | `parallel/*` | progress records, parallel refs, loaders | Chinese-id coupled; delete in step 4 |
| Screens | `ParallelPractice.tsx`, `ParallelLessonView`, `components/ParallelPracticeSource.tsx` | a second set of screens | delete in step 4 |

## 4. Plan for step 3.5: stages

One seam rule: pages and the engine ask `getPack()`. Where a stage says "pack gains", it is an entry in `meta.ts`/`pack-data.ts` (or a small module the pack points to), not a test of the language in a screen. Chinese stays the default values.

**Stage A: look and wording, no decision needed (do first).**
- Pack gains: `practice` wording block (typed-reading title/help/placeholder/hide-label, source label, form labels per form id, instruction strings) and `speechLocale` use in the engine; `htmlLang` per language for `lang=` attributes on target text; counts noun ("characters" off for ja, via the existing `countsCharacters`).
- Changes: `FORM_LABEL`/instruction strings and the "Hide pinyin"/"Type the pinyin" strings in `EngineQuestion.tsx`, `QuestionViews.tsx`, `Drills.tsx`, `KnowledgeCounts.tsx` read the pack; `HearButton locale` from the pack; `lang="zh-Hans"` on target text becomes the pack's tag; "Chinese curriculum" label from the pack.
- Reuse: the Overview/Lessons pack wording code (same accessor).
- Chinese unchanged: `src/pages/__screens__/practice-start.txt`, `overview.txt`, `lessons-list.txt`, `settings.txt`, the engine pins (`src/core/session/*.test.ts`), the prompt pins `src/core/__prompts__/*` (no prompt text changes in this stage).
- New Japanese pin: `src/pages/__screens__/ja-practice-start.txt` (like `ja-overview.txt`) plus one engine-form screen text for a choice and a listen-pick.
- Learner sees: Practice in Japanese words, the Japanese voice on Hear, kanji drawn with Japanese glyphs.

**Stage B: typed reading, shown form, readings (F2, F9).**
- Pack gains: `readingInput` (kind `kana`), `normaliseReading(text)` -> kana, `showForm(word)` (reuses "Show verbs as" and the forms table), reading display from the "Readings" setting (kana or romaji).
- Changes: `buildPinyinItem` (rename internally to a reading item; the Chinese form stays `pinyin`) uses the pack's accepted readings; `gradePinyin` is called for Chinese only, the pack supplies the kana grader: typed kana, katakana->hiragana, romaji -> kana with Hepburn, si/shi, ti/chi, tu/tsu, hu/fu, zi/ji, sya/sha, ou/oo, long vowels (ō, ou, oo), `n'`/`nn`; wrong letters stay `self` only where nothing matches. Choice/Match/Recall/Tiles use the pack's shown form for a vocabulary word.
- Reuse (moved): `romanizeJapanese`, `toHiragana`, `readingFor` from `parallel/romanize.ts` move to the pack module; the reverse romaji->kana is new (small, table driven).
- Chinese unchanged: `grade.test.ts` pinyin cases, `practice-start.txt`, `golden-exports.test.ts` (no export change).
- New Japanese pin: grade tests for kana/romaji spellings, plus `ja-practice-type-reading.txt`.
- Learner sees: Type the reading works in kana or romaji, verbs shown as chosen, no "mark it yourself" for a right answer.

**Stage C: phrase identity and segmentation (F8, F1 half).**
- Pack gains: `phraseKey(text)` and `segment(text, words)`: tokens from the pack's tokens (the sentence already has `words` and `form`/`span`) with kana and particles; particle list with descriptions.
- Changes: `phrases/key.ts`, `bank.ts`, `grammar-match.ts`, `user.ts` call the pack's key (Chinese: the current Han-only function, byte-identical output); `segmentWords` (grade.ts:44) takes the pack's segmentation.
- Reuse (moved): `isParticle`, the particle table and descriptions, and token logic from `parallel/session.ts:78-91,254`.
- Chinese unchanged: `phraseKey` test that matches `scripts/build-phrase-bank.mjs`, plan/grade tests, `practice-start.txt`.
- New Japanese pin: a test that all 822 sentences have distinct keys and that no sentence's tiles are empty.
- Learner sees: no more "same sentence" collapse; the sentence builder gets the right tiles (finished in D).

**Stage D: sentence builder and the Japanese-writing forms (F1, F3, F4).**
- Pack gains: `gradeSentence(answer, accepted, options)` (kana/kanji variants, optional particles ignored only where the data says so), `distractors(phrase)` (swapped particle, as in `tilesFor`), `blank(sentence, wordRef)` (the gap uses the token carrying the word, so 勉強します is found).
- Changes: `buildTiles`, `buildGap`, `buildDictation`, `buildTranslate(en->target)`, `gradeChinese` calls go through the pack; Han rejection in `gradeMeaning` becomes a pack setting (a kanji answer to an English prompt is still wrong, but only if it contains no Latin: keep as is for ja; the change is only the note text).
- Reuse (moved): `gradeTiles` and the particle feedback from `parallel/session.ts:95`.
- Chinese unchanged: the whole `grade.test.ts`, `plan.test.ts` for tiles, `src/pages/__screens__/practice-start.txt`.
- New Japanese pin: tiles tests on lesson 1 and lesson 40 sentences; a screen pin for a Japanese tiles question.
- Learner sees: Word order, Fill the gap, dictation and English->Japanese usable.

**Stage E: Practice page, sources, counts and the dataset door.**
- Pack gains: the source list (the Japanese curriculum as a source), the "unit counts" rule, and `practiceData: undefined` for ja so `loadPracticeData` returns nothing and the dataset forms are simply not planned.
- Changes: `Drills.tsx` source picker, `sources.ts`, `FUNCTION_CHARACTERS_LIST` becomes pack data (the Japanese list is the particles and です/ます endings that are "free" in sentences), "Practice by skill" copy.
- Chinese unchanged: `practice-start.txt`, `dataset-source.test.ts`, runner tests.
- New Japanese pin: `ja-practice-by-skill.txt`.
- Learner sees: the whole Practice page, including skills, with nothing Chinese left; no dead-end exercises.

**Seam for 3.6 (word forms in practice):** after C and D the planner asks the pack for `extraForms(stage, items)`; 3.6 adds `conjugate` and `form-pick` to the pack's form list and moves `buildConjugate`/`buildFormPick`/`gradeConjugate`/`buildFormPick`'s tokens from `parallel/conjugate.ts` behind it. The `Form` union and the types already carry them (`types.ts:22`). Nothing in A to E has to be undone.

**What is left to delete in step 4:** `src/core/parallel/*` (session, progress, refs, data, practice, conjugate, romanize after the moves), `pages/ParallelPractice.tsx`, `ParallelLessonView`, `components/ParallelPracticeSource.tsx`, the `language?: 'ja' | 'ko'` field on `BaseExercise`, and the `parallelTrack` branch in `Drills.tsx:387-391`. Korean is out of scope here; Korean code in those files stays until step 4 decides.

## 5. The practice dataset for Japanese: what needs it and what producing it takes

Forms that only the dataset supplies: `exchange-pick`, `exchange-reply`, `which-correct`, `conversation` (`DATASET_FORMS`, `types.ts:40`), plus the "accepted other wordings" (`zhAlt`, `enAlt`, optional words, synonyms) that let Translate and Word order be marked without a model. Without them: Translate to English falls back to self-marking for any wording but the authored one; Word order and dictation accept only the exact sentence; no exchanges or conversations.

Producing it for Japanese (not done here): `scripts/build-practice-dataset.mjs` runs four kinds per band: accepted (batches of 25 phrases), exchanges (6 per lesson), grammar near-misses (4 points per call), conversations (up to 2 per lesson), a writer model, code validation (every word must be ready by the item's lesson), a checker model, dedupe. The script is Chinese-specific (HSK bands, `phraseKey` by Han, `phrasePinyin`, Chinese prompts, readiness from `src/data/v2`). It would need: Japanese catalog input (87 lessons, 822 sentences, 292 words, 115 patterns), a Japanese key and readiness, Japanese writer and checker prompts, a kana/kanji acceptance check in the validator, a per-language output path, and `loadPracticeData` taking the language. Model calls for 822 phrases in batches of 25 is about 33 accepted units; 87 lessons x exchanges and conversations is about 87 + 87 to 174 more units, plus 115 patterns / 4 = 29 grammar units: of the order of 250 writer calls plus as many checker calls. Review by a native reader is the real cost.

## 6. Questions for the owner

1. **Handwriting and strokes for Japanese.** The `writing` area is off; the Write button on a Japanese card draws kanji from Chinese stroke data (different forms for some kanji) and kana have no guide. Options: (a) hide Write/Practice on cards for Japanese until there is Japanese stroke data (cost: nothing now, no writing practice); (b) kana-only stroke data (needs a source with a licence we can ship; hiragana and katakana about 150 shapes) and keep kanji hidden; (c) kana and the 87-lesson kanji with a Japanese stroke source (largest; a licence and a data-size check, plus the Chinese-form differences). Recommendation: (a) in 3.5, decide b/c later.
2. **Model-backed sentence and conversation exercises.** Today these send Chinese-wording prompts (`chinese-prompts.ts`, pinned by `__prompts__/P05…`). Options: (a) keep them off for Japanese (the Practice page says they need a model; Japanese gets only built-in exercises); (b) a Japanese prompt set (a second pinned set: a writer prompt that stays in the learner's known words and patterns, in kana-and-kanji at the level, polite form by default) plus our own tests; (c) later. Cost of b: new prompts, new pins, and a manual check of model output quality in Japanese. Recommendation: (a) now.
3. **Practice by skill and dataset-only forms.** Options: (a) leave Reading/Listening/Speaking/Writing practice using only the built-in forms (the skill counts are lower for Japanese, "Practice by skill" works with fewer forms); (b) produce the dataset for lessons 1 to 20 first (about 90 units, read by a native speaker) so exchanges, near-misses and accepted wordings exist for the beginning; (c) produce everything. Cost: model time and, for b/c, a native review and a script port. Recommendation: (a) for 3.5, decide b after the learner sees A to E.
4. **Kanji vs kana in what the learner types.** Should "type the sentence" accept kana for a kanji word (べんきょうします for 勉強します)? Option (a): yes, always (kind to beginners, but the learner never has to produce kanji); (b) yes until the learner has met the kanji, then kanji required; (c) always kanji. Recommendation: (a) with a note under the answer; this is a learner choice, so it is asked here.

## Not done here, on purpose

No source changed, no dataset produced, no full suite run, no change to `stable`, `.github/workflows/`, or `package.json`.
