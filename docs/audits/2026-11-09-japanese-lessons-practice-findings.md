# Japanese through the Lessons and Practice screens: findings (step 3.1)

Built with `LANGAPP_LANGUAGE=ja`, served with `vite preview`, walked in headless Chromium at 430 px wide. Nothing here was fixed (only the loaders, `renderExample` and the pack were changed in this step). Screenshots are in `docs/audits/images/2026-11-09-ja/`. Line numbers are at branch tip.

## What works (data behind the existing loaders)

- The catalog loads: 87 groups, 291 words, 108 grammar patterns; no console error and no page error on any screen walked.
- Overview, Lessons ("New", "All lessons" with 87 rows), lesson 1 and lesson 27 show Japanese text with kana readings and English glosses; examples render through `renderExample` (kana joined with no space).
- Practice: a set on lesson 1 starts, intro cards render, and the forms listen-pick, choice, type-pinyin, type-meaning and translate-zh-en appear and can be answered. A wrong answer repeats the form ("another try").
- Sentence and conversation exercises need a connected model and were not reachable (no model in the sandbox).

## Findings by where the fix belongs

### Lessons path (3.2)
1. **Chinese labels everywhere.** Header "Practical Mandarin", pill "English / Mandarin", Overview cards "YOUR MANDARIN PATH", "Explore HSK 1-6 readiness…", "357 real curriculum senses" (src/pages/Curriculum.tsx:10-11, src/pages/Overview.tsx, src/App.tsx:258, :334 "Opening your Mandarin workspace"). Lesson headers read "HSK 1 / LESSON 27", "HSK 1 / group 1 of 87", "VOCABULARY / HSK 1". Screenshots: overview.png, lessons.png, lesson-27.png.
2. **Course track selector** on the all-lessons page shows "Course track: Chinese / More tracks…" and "HSK 1 / 0 of 87 done" (src/components/LessonList.tsx, src/components/ParallelLessonList.tsx).
3. **`lang="zh-Hans"` on Japanese text** (wrong font and speech hints): src/components/LessonList.tsx:18, src/components/study/UnitCard.tsx:21 and :51, src/components/shared.tsx:37/:45, src/components/MandarinWord.tsx:8, src/components/study/AnnotatedChinese.tsx:8-9, src/components/phrases/PhraseTable.tsx:20 (also column "Chinese").
4. **Readings annotated with Han-run logic.** src/core/study/annotate.ts:13 (`\p{Script=Han}` runs) assumes one Han character per pinyin syllable, so Japanese text with kana and multi-kana readings is mis-annotated or not annotated; hide/show "pinyin" toggle label (src/pages/Study.tsx:309).
5. **Hear/speech locale**: UnitCard.tsx:48 and shared.tsx:48 pass `locale: 'zh-Hans'` to the snippet/speech actions, so Japanese is spoken with a Chinese voice; Settings offers "Chinese voice" only (src/components/handsfree/HandsfreeSettingsForm.tsx:58, src/components/learning/GuidedAudio.tsx:29 "Mandarin voices").
6. **Grammar units with no pedagogy for kana patterns**: titles such as 動詞語幹に行く are shown as both title and pinyin line (pt == pr for several patterns because the pattern has no separate reading). Data, not code: add readings in a later step.
7. Nine grammar records have no authored phrase, so lessons do not teach them (see "Decisions" in the report).

### Practice path (3.3)
8. **Typed-pinyin form is shown for Japanese**: "Type the pinyin", help text "Pinyin with tones: type numbers (xue2 xi2) or marks (xué xí). Use v for ü (lv4)" (src/core/session/types.ts:25; src/core/session/grade.ts:227 grades typed pinyin with tones; :13 and :247 run answers through `formatPinyin`). The correct answer is kana, so no typed answer can match; the form falls back to self-marking "I was right: count it". Screenshot practice-type-pinyin.png.
9. **Han tests in grading and exercise building**: src/core/session/grade.ts:47 and :279 (an answer containing Han is rejected as "should be in English" — kanji answers are rejected); src/core/study/exercises.ts:22, :100, :111, :135 (cloze/gap and sentence building split text by Han runs); src/core/study/contracts.ts:48; src/components/study/KnowledgeCounts.tsx:8 (counts "characters" with Han only; Overview/Practice header "4 new characters" counts kanji as Chinese characters).
10. **Prompt wording**: forms titled "Chinese ↔ English", "Which Mandarin word matches?" (src/pages/Study.tsx:307, src/pages/Practice.tsx:68), "Write it: a pinyin sentence…", "Say the pinyin" (src/core/session/types.ts:25); "Choose a Mandarin translation before practicing" (src/components/assistant/PracticeRecording.tsx:237). Sentence exercises sent to the model use Chinese-wording prompts (src/core/chinese-prompts.ts, pinned by tests).
11. **Learn to write / strokes** use Chinese character data (src/components/assistant/WritePractice.tsx:7, :31-32 `isHan` + `hasGuide`): kana have no guides; kanji use Chinese stroke data (different forms).
12. **Practice page** shows "LEARNING FROM: Chinese curriculum" and "0 words · 0 grammar · 0 characters" until items are added; source picker reads Chinese data only (src/core/session/sources.ts).
13. **Listen-pick** works but options are English translations only; the prompt shows no text (intended listening form) and the speech voice is Chinese (see 5), so the form cannot be completed by listening.
14. Practice by skill (Reading/Listening/Speaking/Writing) is disabled until items exist and has no Japanese-specific material (the practice dataset is absent for ja by design in this step).

### Word forms (3.4)
15. Conjugation: 勉強し + ます is rendered correctly in examples, but no practice form tests inflection; `form`/`span` tags are kept on phrase tokens for this. Intro cards for 動詞ます (polite nonpast verb) have nothing to practise it with.

### Publishing (3.5)
16. Output still contains the Chinese dictionary-adjacent assets: characters/chinese/* (zips, components, recognition, meanings), common ja/ko dictionary modules, the speech SDK and Chinese-only games chunks (sizes in the report). Manifest/title names come from the pack (ok). The parallel ja/ko data still carries Chinese ids (zh-hsk1-…) in assets/ja-*.js and ko-*.js until step 4.

### Later
17. Dictionary/Games/Media/Library areas are switched off for ja by the pack's features; their Chinese data still ships.
18. `html lang`, profile default `language: 'zh-Hans'` (src/core/profiles/codec.ts createEmptyProfile) and `pinyin: true` preference defaults are Chinese.
19. Profile export: legacy word labels come only from the Chinese pack now (src/core/language/word-labels.ts); a Japanese profile exports study refs, which is correct, but legacy "words" rows cannot be labelled (none exist in a Japanese build).

## Screenshots
overview.png, lessons.png, lessons-list.png, lesson-1.png, lesson-27.png, practice.png, practice-intro.png, practice-listen-pick.png, practice-choice.png, practice-type-pinyin.png, practice-type-meaning.png, practice-translate.png
