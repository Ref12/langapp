# What is Chinese-specific in LinguaWeave, and what a language pack would take

Inventory of 2026-11-09. Read-only: nothing in `src/`, `scripts/`, `data/`, `curriculum/` or `public/` was changed; this file is the only commit.

**Base.** `origin/langapp/main-for-rebase` at 73a4815 (the merge into the session branch was a no-op: the branch already contained it). Counts below are from that tree.
**Method.** I read the code and ran `git grep` / `wc` / small `node` one-liners over the data files. I ran no build, no test and no generator (`node_modules` is not installed on this runner), so every "`--check` passes" claim in section 6 is a statement about what the check compares, not an observed result. I used no helper sessions: the areas were small enough to read directly, and a sample-check of helper output would have cost about as much as reading.
**Prior audit.** `docs/audits/2026-11-09-language-as-data-audit.md` at 763eb5e2 (branch `hexad/s-20261109-201149-64a1`, made against 0b0dda3). I read it first. I reused only its Part B figures after re-counting them on 73a4815: the `Parallel*` files (10 files, **616 lines**, re-counted: matches), the ja/ko-only modules (my re-count of the modules it lists plus `tracks.ts`, `LessonsList`: **2,121 non-test lines**), and the list of data that survives either way (re-confirmed in section 4). Its "about 55 files import Chinese data directly" does not reproduce with my wider pattern (v2 catalog, `data/mandarin`, curriculum, phrases, practice, characters index, `core/phrases`, `practice-data`): **81 non-test files**; with a narrow pattern it is probably its 55. Its Part A (what changed for a Chinese-only learner), and the N1–N5 "not asked for" findings, I did not use and did not re-check; they are about the revert question, not this one.
**Line counts** are wc -l of the file. Many lines in this repo are 150–250 characters, so a 400-line file can hold more than 400 lines of a normal style.
**Verdict legend** (as in the brief): **data** = swap the data; **parameter** = general once a value/function comes from the pack; **generalise** = reshape (how is said); **Chinese only** = off for other languages; **stored format** = touches saved profiles/backups. Rows can carry two verdicts; the first is the main cost.

---

## 1. Summary

**How neutral is it already?** Of 371 non-test source files under `src/` + `shared/` (37,638 lines), **201 files (54%) / 27,252 lines mention something Chinese-specific** (pinyin, Han script, `zh`/`zh-Hans`, HSK, Mandarin, the `ch`/`pr`/`zh`/`py` field names); 108 files (18,363 lines) mention it five or more times. (Counts include comments and some English prose, so they overstate logic a little.) Neutral already: all of `core/backup` (0 of 15 files; except the ref parsing), `core/forms`, `core/games` region puzzles and Mahjong geometry, the FSRS scheduler, the session *planner's* skeleton (`STAGES`, presets, skills), the AI transport and the profile/backup plumbing, the pocket-mode loop, Media/Library import and Collections as containers, and 25 of 37 files in `components/`. Chinese-bound: 25 of 28 files in `pages/`, 12 of 16 in `pages/drills/`, 12 of 18 in `core/characters/`, 15 of 28 in `core/assistant/`.

**Where the hard parts are.** The engine is shaped by Chinese in five ways that are not "a language setting":
1. *Chinese is the schema.* The persisted and in-memory records are named for it: `zh` (52 files, 298 hits), `py` (21 files), `ch`/`pr` (44/30 files), `pinyin` (87 files, 253 hits), `<Pinyin>` (53 uses), `preferences.pinyin` (82 uses in 32 files), locale literals `'zh-Hans'` (253 hits, 82 files), a strict zod literal `language: 'zh-Hans'` in the backup, and enums such as `'zh-to-en'`, `'zh-en' | 'zh-py' | 'py-en'`. A neutral rename is mostly mechanical but touches stored formats (rows S in section 2).
2. *"Only known words" is a closed-vocabulary string match.* Greedy longest-match segmentation (`createSegmenter`, 5 files calling it plus a copy in `scripts/build-phrase-bank.mjs`) guards what AI-written sentences, tiles and gap exercises may contain. It cannot follow inflection, so Japanese and Korean needed a separate tagged-token analyser and forms engine; a pack interface has to put an *analyser* behind it (as `docs/languages.md` §4.3 already proposes).
3. *Content, not code, is the cost.* Japanese and Korean have **87 lessons each (291/300 words, 108/97 grammar points, 817/801 phrases)** anchored one-to-one on Chinese HSK 1 groups; Chinese has 1,491 groups, 7,122 vocabulary senses, 673 grammar points, a **15,108-phrase bank** and a practice dataset of **14,180 accepted-answer sets, 8,049 exchanges, 672 near-miss items and 877 conversations**. The ja/ko pack would have 0 of the dataset, ~5% of the phrase bank and ~6% of the lessons, no model-prompt set of its own, and a lesson order that exists only in relation to Chinese. "Same screens" is cheap in code and expensive in material.
4. *Chinese-only subsystems of real size* have no counterpart: pinyin and tone grading (`pinyin.ts`, `grade.ts`, `dictionary-search.ts`, `pinyin-pro` in 7 files), the Han-character writing stack (`core/characters` + `Writing` + pads ≈ 4,000 lines, 17 MB of stroke data, a 1.4 MB component table, a parts font), the **legacy Word/Lesson/Story system** (`data/mandarin.ts`, a 357-word/50-lesson/30-level "Mandarin path" with HSK-readiness page; 14 files; still feeding the games' word lists, the Assistant's lookup tool and the backup validator), and the per-character Assistant practice chain.

**Worse than it looks.**
- **Storage names are shared by origin, not by path.** Two builds under one address share IndexedDB, localStorage, Cache Storage, BroadcastChannel and Web Locks namespaces. I count **3 IndexedDB base names (the learning DB exists once per profile), 15 localStorage keys (+1 sessionStorage prefix), 2 cache names, 2 backup channel/lock names, a manifest name, and the cloud-backup path `profiles/<id>/`**, all fixed strings today (section 3). And the service worker's activate step deletes every cache that starts with `linguaweave-shell-` and is not its own, so **two builds on one origin evict each other's shell cache on every update** (`scripts/pwa.ts:56-60`). That is true for Stable/Lab as well as for languages.
- **The cloud-backup repo path is not per build.** `profiles/<profile-id>/` in the same repo/branch means a Chinese and a Japanese build with the same profile id write the same files.
- **`characterStates` can only hold Han characters** (`characterSchema` requires `\p{Script=Han}`), so Hangul syllables and kana cannot be stored by the shared writing store; the ja/ko writing path today stores nothing.
- **Model output contracts embed the Chinese names** (`zh`, `py`, `pinyin`, `locale: 'zh-Hans'`, `romanization`) in 8 prompt/schema sites, so a prompt change is also a validator change.
- **Language-code vocabularies disagree**: the Assistant uses `'en-US' | 'zh-Hans'`, `shared/speech` uses `'en-US' | 'zh-CN' | 'ja-JP' | 'ko-KR'`, writing uses `'zh' | 'ja' | 'ko'`, media uses `zh-Hans, zh-CN, zh, zh-Hant, zh-TW`, tracks use `zh-Latn-pinyin`. A pack needs one language id with several derived tags.
- **193 of 260 test files** contain Han, pinyin, Mandarin or HSK in their fixtures; a pack's tests need pack-supplied fixtures, not a search-and-replace.

**The four findings that most affect the plan.**
1. **Decide the persisted names first (Open question 1).** Whether the Chinese build keeps writing `zh`/`py`/`pinyin`/`zh-Hans` or starts writing neutral names with read-both decides whether stage 5–6 are "type-level only" (small, zero stored change) or "stored format migration" (much larger, with a rollback cost).
2. **Make storage names build-derived before anything else, and fix the service-worker eviction and the backup path.** The other session is doing the names; the SW deletion rule and the `profiles/<id>/` path are separate and not covered by "derived names".
3. **Content decides the schedule, not code.** A pack with working screens but 87 lessons and no practice dataset is a Japanese HSK-1-sized experience. The ja/ko data can seed the pack but their lesson order is a function of the Chinese groups and has to be re-derived.
4. **Chinese-only features are many and individually small; the dangerous ones are three: the legacy Word system (still wired into games, tools and backup validation), the Han-only character store, and the pinyin slot being a global user preference.** Switch-off by pack is straightforward for the rest.

---

## 2. Inventory

Column "Where" gives files with line counts (non-test unless said). "Depth": data / name-label / logic / interface / prompt / stored. "ja/ko needs" is what a Japanese or Korean pack supplies in its place. The IDs are referenced from sections 5–7.

### 2.1 Catalog, data generation, ids, storage

| ID | What | Where | Depth | ja/ko would need | Verdict |
|---|---|---|---|---|---|
| C1 | **v2 curriculum source and order tooling**: examples-first authored YAML per HSK band (vocabulary `ch/pr/ds/lb`, grammar `pt/pr/ds/lb/ex`), dependency-aware lesson ordering, grammar-to-vocabulary sense bindings by pronunciation, "supported Chinese punctuation" in examples | `curriculum/v2/chinese` (40 files, 5.8 MB); `scripts/v2-*.mjs` 11 files ≈1,300 lines; `generate-v2-app-data.mjs` 108; `generate-app-curriculum.mjs` 654; `generate-learning-content.mjs` 153 | data + logic + name | an authored curriculum in the same shape (neutral field names), an ordering that does not depend on Chinese; punctuation set per language; sense bindings use `numberedPinyin` | **generalise** (rename fields, band list and punctuation and reading comparer from the pack) + **data** (the authoring itself is the cost) |
| C2 | **Generated app catalog** `src/data/v2/hsk-1..6.generated.json` + `index` + `profile-word-labels` | 3.9 MB; `core/study/catalog.ts` 120; **7,122 vocabulary, 673 grammar, 1,491 groups** (per band vocab/grammar/groups: 1: 382/97/87, 2: 288/101/72, 3: 638/143/149, 4: 1,314/143/277, 5: 2,227/113/458, 6: 2,273/76/448) | data + name | the pack's own bands in the same loader | **data**; loader **parameter** (`catalog.ts` has six hard-coded `import()` lines keyed by `'1'..'6'`) |
| C3 | **Bands**: `bandSchema = '1'..'6'`; stored on every knowledge entry; journal `add` writes `band: Number(...)`; labels "HSK n" built in about 14 places (see U-rows) | `study/contracts.ts`; 26 files use `Band`/`.band` | name + stored | JLPT has 5 levels, TOPIK 6, others none: the pack declares an ordered band list and a label function; stored value stays 1..6 (mapping) | **parameter** + **stored format** (band is persisted as a string 1–6; a pack with 5 bands maps into it, one with more than 6 cannot) |
| C4 | **Legacy Word/Lesson/Story system**: 14 starter words (`zh:tea`…), 2 stories, 357 "curriculum sense" words, 50 lessons, 30 levels, 25 grammar points, HSK-readiness map; the old `words/readings/lessons/sessions/attempts` tables key on it | `data/mandarin.ts` 80, `curriculum.ts` 41, `curriculum.generated.json` 629 KB, `learning-content*` 32+153+generated, `core/learning.ts` 169, `questions.ts` 40, `progress.ts` 35, `guided-audio.ts` 128; pages `Curriculum` 121, `Lessons` 100, `Reading` 137; `components/learning` 4 files 205; 14 importers incl. `backup-codec.ts`, `assistant/tools.ts`, 2 games | data + logic + interface + stored | nothing (no counterpart authored) | **Chinese only** for the pages; **stored format** for `backup-codec.ts` (it validates `words`, `lessons`, `readings` against these ids and `retiredLessonIds`) and **generalise** for the 3 non-page consumers: the games' word lists (`game-vocabulary.ts`, `sudoku-characters.ts`) and the Assistant context tool must read the v2/knowledge path only |
| C5 | **Phrase bank**: LLM+check pipeline, segmenter copy, pinyin-pro for readings; bank + Han refine | `scripts/build-phrase-bank.mjs` 1,077, `phrase-bank-files.mjs` 169; `curriculum/chinese/authoring/phrases`; `src/data/phrases` 4.3 MB, **15,108 phrases** (1,240/1,032/2,126/2,269/3,909/4,532 by band); `core/phrases` 10 files ≈800 (+ `PhraseTable`, `AddToPhraseBank`, `PhraseKnowledge`) | data + prompt + logic + name (`BankPhrase.zh/py/en`) | a bank per language: ja/ko have 817/801 phrases inside their parallel lessons, no standalone bank | **generalise** (generator: segmenter, reading, prompts from pack; record `zh`→`text`, `py`→`reading`) + **data** |
| C6 | **Practice dataset**: accepted answers + near-miss + exchanges + conversations; built by 9 prompts; Han refine in the schema | `scripts/build-practice-dataset.mjs` 738; `src/data/practice` 11 MB (24 files); `core/practice-data` 98+88; consumers `session/dataset-source.ts` 132, `pages/drills/DatasetQuestions.tsx` 96 | data + prompt + name | the same four kinds per language; ja/ko have none | **generalise** (schema: script test, `zh`/`py`, near-miss `kind` list is Chinese: `order, particle, missing-particle, adverb, measure, negation, other`) + **data**; all 4 forms in `DATASET_FORMS` are unavailable without it (switched off by the pack, not replaced) |
| C7 | **Item labels**: `lb` = numbered pinyin joined with `--` and an English gloss (`ba4-ba5--dad`); registry validated by `numberedPinyin` (throws on anything but pinyin); 23 `legacy-*` and 8+ `starter-*` labels | `scripts/readable-labels.mjs` 49 (3 importers), `profile-word-labels.mjs` 121, `unitLabelSchema` = `/^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/` (ASCII slug) | name + stored | an ASCII-slug label per entry from the pack (romaji/RR slug + gloss); the schema regex already allows it | **parameter** (`pack.labelOf(entry)`) ; labels of existing Chinese items are **stored format** and must not change (they are the profile/backup identity) |
| C8 | **Refs**: `vocabulary:`/`grammar:`/`phrase:`/`source:` + `<lb>`; `ja:w:`, `ja:g:`, `ja:f:<lemma>:<form>`, `ko:…`; `isLanguageRef = /^[a-z]{2,3}:/` filters them out of the Chinese workspace | `study/contracts.ts` `unitRefSchema`, `core/parallel/refs.ts` 19, `database.ts`, `knowledge.ts` (3), `journal.ts`, `tools.ts` | name + stored | in a one-language build the prefix is unnecessary; form items (irregular conjugations) need a generic ref kind | **stored format** (see Q2): keep `vocabulary:`/`grammar:` shapes for every pack, add `form:` kind; `ja:`/`ko:` prefixes disappear with the parallel code. The in-flight backup fix for `ja:`/`ko:` rows should be treated as throw-away for pack builds |
| C9 | **Database schema**: Dexie `linguaweave-next` / `-profile-<id>`, 26 versions, 37 declared tables. Language-shaped parts: `preferences.language: 'zh-Hans'`, `words.language: 'zh-Hans'`, `phraseHeard`/`userPhrases` keyed `zh`, `characterStates` keyed `character` (Han only), `practiceHistory` keyed `text` | `core/database.ts` 211, `model.ts` 165 | name + stored | per-build DB already (own storage), so no migration; neutral names for new language builds | **stored format** (rename of keys `zh` and the literal) or leave as is (Q1) |
| C10 | **Journal** (append-only events add/remove/review/attempt/character) and replay | `core/backup/journal.ts` 180 | logic | none beyond ref parsing | **parameter**/neutral; splits `ref` on `:`, which is wrong for `ja:f:<lemma>:<form>` (known, in the other session's fix) |
| C11 | **Backup formats** (see also section 3): `linguaweave-next-backup` v1–5 (strict zod, `language: z.literal('zh-Hans')` on preferences and on every `words[]` row), profile `linguaweave-profile` v5 (wire form swaps `wordId`→`lb`, knowledge `{kind, lb}` drops `ref`), repo layout v2 `profiles/<id>/{manifest,journal/,state/,settings,profile,knowledge,conversations/,library/,source-entries/}.yaml` | `backup-codec.ts` 291, `profiles/{contracts,vocabulary,codec,read-snapshot,store}.ts` ≈750, `backup/{layout,files,github,run,service,state,auto}.ts` ≈1,100 | stored | a build per language writes its own; the Chinese build must keep reading old files | **stored format**. Compatible path: keep the Chinese schema (`language` literal accepted as is), add `language` field discriminator for pack builds, and give the backup path a build/language segment (open Q3) |
| C12 | **Profile files / local dev servers** | `scripts/profile-files.ts` 301, `local-profiles.ts` 156, `local-settings.ts` 160 | stored (YAML on disk) | none | neutral; `local-settings.ts` stores `pinyinFormat` and `speechVoices` (see section 3) |
| C13 | **Other-language importers (already exist)**: Python importers/adapters for Japanese, Korean, French, Russian, Spanish; `curriculum/{japanese,korean,french,russian,spanish}` (2,487/372/159/155/27 files) | `scripts/import_*.py`, `*_program_adapter.py`, `generate_practical_program.py` (≈6,500 lines of Python in the importers and adapters alone) | data | these are the raw material of a pack's curriculum | **data** (reusable); note French/Russian/Spanish have no app projection |

### 2.2 Lessons, curriculum order, phrase bank

| ID | What | Where | Depth | ja/ko needs | Verdict |
|---|---|---|---|---|---|
| L1 | **Group/lesson flow**: next group, knowledge set, group status, intro cards | `study/knowledge.ts` 473, `pages/Study.tsx` 412, `Lessons.tsx` 100, `LessonsList.tsx`, `GroupDetail.tsx` 26, `data/tracks.ts` 109 (`zhTrack`/`jaTrack`/`koTrack`; `parallel` flag) | logic neutral; labels "HSK n" | the pack's group list | **parameter** (track descriptor becomes the pack) |
| L2 | **Lesson order as a function of Chinese** (ja/ko): lesson N = Chinese HSK 1 group N, senses map Chinese→ja/ko, phrase has `zh` | `curriculum/{japanese,korean}/parallel/{entries,zh-lessons,report}.yaml`, `scripts/build-parallel-lessons.mjs` 866, `parallel-lessons-files.mjs` 335, `generate-app-parallel.mjs` 41, `src/data/parallel/{ja,ko}.json` 1.1 MB | data + prompt | an own order (e.g. by JLPT band) and source meaning in English only | **data** (re-derive); this is the largest content gap |
| L3 | **"Ready-at"/look-ahead gating** of phrases (all words and grammar introduced by lesson N) | `BankPhrase.readyAt/lookahead`, `session/plan.ts`, `parallel/session.ts` `readyAt`, `usablePhrases` | logic | none | **parameter** (the two implementations merge) |
| L4 | **Function-word set** `的了吗呢吧是不很也都和在有这那我你他她们个` (24 characters) allowed beside learned words | `session/function-characters.ts` 2, `drills/items.ts`, `bank-forms.ts`, `phrases/bank.ts` | data in code | the pack's own (particles, copula, honorific affixes) | **parameter** |

### 2.3 Readings (pinyin)

| ID | What | Where | Depth | ja/ko needs | Verdict |
|---|---|---|---|---|---|
| R1 | **Pinyin model**: syllable inventory, tone marks, `formatPinyin` (marks / marks-and-numbers / numbers), `parseReadings` (splits on `/ ; ,` and "or"), `withTone` | `core/pinyin.ts` 119, `pinyin/phrase.ts` 102, `phrase-readings.ts` 34; 18 importers; `pinyin-pro` in 7 files | logic | Japanese: hiragana (+romaji conversion, exists: `romanize.ts` 78); Korean: Hangul → Revised Romanization (exists) | **parameter**: `pack.reading = { id, formats[], default, format(text, fmt), parse(text) }`; Chinese pack points at `pinyin.ts` unchanged |
| R2 | **Reading display slot**: `<Pinyin>` (53 uses/28 files), `usePinyinFormatter`, global on/off `preferences.pinyin` (82 uses/32 files), `sudokuShowPinyin`, game "show pinyin" setting; ja/ko already reuse the slot ("pinyin slot" in their cards, with `japaneseReading` romaji/kana) | `components/Pinyin.tsx` 5, `pinyin-context.ts` 15, `App.tsx`, `Settings.tsx`, `PageSettings.tsx` | interface + stored key | the same toggle labelled for the language (Reading / Furigana / Romanization) | **parameter** (label from pack) + **stored format** if `pinyin` key is renamed (Q1) |
| R3 | **Typed-reading exercise**: form `pinyin`, drill `pinyin` ("Say the pinyin"), `gradePinyin`/`typedTones`/`previewPinyin` (tone-aware, tolerant of numbers/marks/ü), wavy underline for wrong tone (`.engine-tone-off`); match modes `zh-py`, `py-en`; Defender `character-pinyin`/`pinyin-character`; game faces `pinyin` | `session/grade.ts` (≈100 of 298), `bank-forms.ts:126`, `study/contracts.ts` MATCH_MODE_VALUES, `shared/defender-engine.ts` 202, `game-vocabulary.ts` 59 | logic + interface + stored (match modes persisted in exercise sessions) | Japanese: typed kana is a natural counterpart, graded by exact kana (no tones); Korean: typed romanization is not a natural task | **Chinese only** for tone grading (counterpart: kana typing for Japanese needs a home), **parameter** for the exercise itself (`pack.reading.input`) |
| R4 | **Search by reading**: ranks (exact, prefix, mid-syllable, tone-agnostic), `ownCharacterData` derives a character's reading from containing words | `core/dictionary-search.ts` 107 | logic | Japanese: kana/romaji prefix match; Korean: RR/Hangul | **parameter**: `pack.reading.matcher`; mid-syllable and tone rules stay in the Chinese pack |
| R5 | **Reading in model output**: `romanization` in speech blocks; `py` in drill JSON; `pinyin` in book and media tokens | see P-rows | prompt + stored | per-language wording | **parameter** |
| R6 | **Tone colours** | none: there is no tone colouring in the code. Only a wavy underline on wrong-tone syllables in typed pinyin (`drills.css:316`) and `speech-assessment` word scores | — | — | Chinese only (nothing to port) |

### 2.4 Characters and writing

| ID | What | Where | Depth | ja/ko needs | Verdict |
|---|---|---|---|---|---|
| W1 | **Stroke data and guides**: 3,001 Chinese characters in 93 files (17 MB), source pin `zh-writing-hanzi-writer`, fitted recipes, provenance per glyph, reproducibility ZIP (`AGENTS.md`: any `package.json`/lockfile/generator change regenerates it) | `public/characters/chinese`, `src/data/characters` 260 KB, `core/characters/assets.ts` 135 (imports the Chinese index statically), `geometry.ts` 108, `scripts/generate-app-characters.mjs` 372, `generate-character-{meanings,origins}.mjs`, Python importers/fitters ≈3,600 lines | data + logic + build | ja/ko already have lazy loaders and data (kana, kanji N5/N4, hangul; 1.1 MB), no provenance | **generalise**: one loader parameterised by `pack.writing = { folder, scriptTest, index }` with provenance optional; `characters:check` and the ZIP stay Chinese-pack build steps |
| W2 | **Writing UI**: `Writing` 392, `StrokePad` 79, `StrokeOrder` 43, `CharacterIntro` 70, `HandwritingPad` 155, `WritingPreview` 48 (dev), `writing-route` 45, `writing-sheet` 31, `writing-speech` 14, `writing-heading` 27 | as listed (≈1,000) | interface + logic | per-language guides (done for ja/ko in `ParallelStrokes` 42 and `ParallelHear` 61, 100 lines of branches in `Writing.tsx`) | **generalise** (collapse `ParallelStrokes`/`OtherCharacterCard` into the main path via W1) |
| W3 | **Handwriting recognition**: recogniser, worker, index, engine choice (Chrome / Google / built-in) | `recognize.ts` 267, `recognize.worker.ts` 23, `handwritingEngine.ts` 199 (`localStorage 'handwriting-engine'`), `handwriting.ts` 78, `recognition.generated.json` | data + logic | Japanese/Korean recognition index (not present) | **Chinese only** for the built-in recogniser; engines `chrome`/`google` take a language tag (**parameter**) |
| W4 | **Components / decomposition**: parts, semantic/phonetic roles, variant forms, radical, origins, meanings; parts font `lw-parts.woff2` with PUA glyphs | `components.ts` 169, `origins.ts` 36, `meanings.ts` 31, `Decomposition.tsx` 93, `components.generated.json` 1.4 MB, `scripts/build-components.mjs` 533 + `build-component-font.py` 161 | data + logic + interface | kanji reuse Han components (possible); hangul composition (jamo) is a different structure (exists in `korean_character_composition.py`, not in the app) | **Chinese only** (Japanese kanji counterpart is an open question; hangul jamo breakdown would be a new feature that needs a home) |
| W5 | **Character state**: "can write / cannot", practice count, manual add; keyed by character; `characterSchema` requires exactly one Han code point | `characters/contracts.ts` 36, `store.ts` 108, `practice.ts` 63, journal `character` events, backup `characterStates` (≤100,000 rows) | stored | kana and Hangul syllables | **stored format**: the table and journal events stay; the validator becomes `pack.script.isWritable(char)` (Chinese accepts what it accepts today, so existing rows validate unchanged) |
| W6 | **Character dictionary tab** + character counts: `characterKnowledge`, write filter (`characterWriteFilter`), `KnowledgeCounts` counts Han characters in words | `core/characters/dictionary.ts` 57, `Dictionary.tsx` (19 token lines), `KnowledgeCounts.tsx` 27 | logic + interface | kana/kanji/hangul lists (`other-list.ts` 29 already) | **parameter** |

### 2.5 Text handling

| ID | What | Where | Depth | ja/ko needs | Verdict |
|---|---|---|---|---|---|
| T1 | **Han-script tests** (`/\p{Script=Han}/u`, `[\u3400-\u9fff]`) used to pick runs, reject English-only fields, detect language, count syllables | **43 non-test files, 57 lines**: session/grade, study/{exercises,annotate,contracts}, drills/{content,tasks}, phrases/{bank,key,user,grammar-match}, media/{entries,readings,span,compounds,reconcile,translation}, assistant/{practice-chain,selection,tools}, collections/{extract,naming}, games/sudoku-phrases, handsfree/script, pages/{Media,HandsFree,CharacterIntro,QuestionViews}, components/study/KnowledgeCounts, `shared/speech/alignment.ts` (the only one already aware of ja/ko) | logic | per-language script classes (Han+kana, Hangul) | **parameter**: `pack.script = { isLetter(ch), runs(text), isTarget(text) }`, one function replacing 57 regex uses |
| T2 | **Segmentation**: greedy longest-match over a closed form set (`createSegmenter` `exercises.ts:82`; 5 files call it; copy in `build-phrase-bank.mjs:166/192`); `Intl.Segmenter('zh'/'zh-CN')` in `practice-chain.ts:117` and `useWriteLongPress.ts:24`; AI segmentation of subtitles (`media/entries.ts`); `isNamePattern` `姓…的` | as listed | logic | ja/ko cannot rely on string match (inflection): tagged tokens (`ParallelToken {t,w,g,form}`) and the forms analyser (`core/forms`) exist | **generalise**: an `Analyser` (`covers(text)`, `segment(text)`, `known(text)`), Chinese adapter = today's code, ja/ko adapter = tokens + forms |
| T3 | **Punctuation and spacing**: CJK punctuation handled in answers, tiles (`zh-punct` CSS class, negative margins), v2 examples ("supported Chinese punctuation"), `normaliseTile` NFKC with a CJK set for ja/ko | `parallel/session.ts:86-89`, `App.css:226-229`, `v2-example-schema.mjs` | logic + CSS | per-language set | **parameter** |
| T4 | **Answer matching (Chinese)**: accepted answers by Han key (`phraseKey`), `diffWords` (missing/extra/swapped/instead/order), `OPTIONAL_WORDS` 了 的, `EQUIVALENT_WORDS` (你/您, 他/她/它), 好不好 ↔ 好吗 (`asMa`), yes/no detection | `session/grade.ts` 298 (≈170 lines of it), `phrases/key.ts` 5, `bank-forms.ts` 134 | logic + data in code | ja/ko have `gradeTiles` with particle swaps and `gradeConjugate` (`parallel/session.ts`, `conjugate.ts`) | **generalise**: matching = `pack.matching { key(text), optional[], equivalences[], extraRules }`; 好不好↔吗 is **Chinese only** |
| T5 | **English-side grading** (meaning: normalise, stem, typo distance, senses) | `grade.ts` `gradeMeaning` etc. (≈90 lines) | logic | none (learner language is English) | neutral except the "answer must not contain Han" test (T1) |
| T6 | **`lang` attributes and fonts**: `lang="zh-Hans"` 253 hits/82 files, `lang="zh-Latn"` on pinyin, CSS `[lang="zh-Hans"]` rules (≥10 in `App.css`, `practice-playlist.css`), `.mandarin-word`, `ruby[lang="ja"]`; Noto CJK note in `public/fonts` | components throughout, `MandarinWord.tsx` 11 | interface | per-language tag and font stack | **parameter**: `pack.lang`, `pack.readingLang`; rename classes (`.mandarin-word` → neutral) |

### 2.6 Exercise types and their checking

There are **three** exercise systems in the app plus Hands-free. Counts: **18 engine forms**, **3 AI-session types**, **9 legacy drill types**.

| ID | Form / type | Neutral? | Verdict for a pack |
|---|---|---|---|
| E1 | Engine forms (`session/types.ts` `FORMS`): `intro` | yes | neutral |
| E2 | `choice` (`zh-to-en`/`en-to-zh`), `match` (modes `zh-en`,`zh-py`,`py-en`), `recall` (type the meaning) | assume `ch/pr/ds`; direction and mode ids are Chinese-named and persisted | **parameter** (`target`/`reading` ids; stored enum values: Q1) |
| E3 | `pinyin` (type the reading) | tone-aware grading | **Chinese only** for tones; Japanese counterpart (kana typing) fits `pack.reading.input` |
| E4 | `translate-zh-en`, `translate-en-zh`, `dictation`, `gap`, `listen-pick`, `repeat` (phrase forms) | use `BankPhrase.zh/py/en`, Han segmenting and Han-key matching | **generalise** (via T1, T2, T4) |
| E5 | `tiles` (word order) | Chinese: `segmentWords`; ja/ko: `ParallelTilesExtra` with particle tags | **generalise**: one tiles builder with analyser |
| E6 | `exchange-pick`, `exchange-reply`, `which-correct`, `conversation` (**dataset forms**, `DATASET_FORMS`) | need the practice dataset | **data** (switched off by the pack until a dataset exists) |
| E7 | `conjugate`, `form-pick` | already language-specific (ja/ko word forms) | **Chinese only is the wrong frame**: these are *pack-optional*; Chinese has none. The "Conjugate" counterpart needs a home in the pack's exercise list (`pack.exercises`) |
| E8 | AI-session types `choice`, `tiles`, `match` (`study/contracts.ts`): schema refines on Han (`chineseTile`/`englishText`), enum `'zh-to-en'` | persisted in exercise sessions (backups) | **stored format** + **generalise** (script test from pack) |
| E9 | Legacy drill types (`DRILL_TYPE_IDS` = meanings, match, learn, write, pinyin, translate, repeat, listen, read), drill sets persist `zh`/`py`/`en` items and conversations `{who, zh, py, en}` (`core/drills` 7 files ≈1,000 lines, `pages/drills` 16 files ≈2,000) | no: stored, logic and prompt | **generalise** (same as E2–E5) + **stored format** |
| E10 | Hands-free activity (spoken script with English frames, syllable-timed pauses) | see S5 | **parameter** |
| E11 | Skills (`reading/listening/speaking/writing`) and `FORM_SKILLS` | neutral | neutral |

### 2.7 Dictionary, unit cards, History

| ID | What | Where | Depth | Verdict |
|---|---|---|---|---|
| D1 | **Dictionary page**: sections vocabulary/grammar/characters/phrases, scope (all/knowledge), Band filter, rank-by-reading; 100 lines of language filter and ja/ko result merging (`multi`, `dicts`, `otherKnown`) | `Dictionary.tsx` 357 (19 token lines), `dictionary-search.ts` 107, `OtherEntries.tsx` 115, `core/dictionary/{other,links}.ts` 201 | interface + logic | **generalise**: the merge/filter code goes away; ja/ko dictionaries (`src/data/dictionary` 2.9 MB: **7,890 + 11,069 words, 117 + 107 grammar**; JLPT/TOPIK; `generate-app-dictionary.mjs` 119) become the pack's own dictionary tier alongside the curriculum; Chinese has only the curriculum as its dictionary (no full dictionary yet) |
| D2 | **Unit cards**: eyebrow "word / HSK n", `lang`, reading line, ⋯ menu Ask / Practise / Write, example line with segmentation-based annotation (`annotate.ts` 55) | `components/study/UnitCard.tsx` 84, `SourceEntryCard`, `AnnotatedChinese` 12, `useWriteLongPress.ts` | interface | **parameter** (band label, lang) |
| D3 | **History**: word list with `zh/py`, "N to write" (characters with a stroke guide not yet written), practice entries with `romanization` | `History.tsx` | interface | **parameter** |

### 2.8 Speech

| ID | What | Where | Depth | ja/ko needs | Verdict |
|---|---|---|---|---|---|
| S1 | **Speech output**: locale model `'en-US'` or `'zh-Hans'`, browser voice matching incl. a Cantonese exclusion (HK/MO without explicit Mandarin), warm-up utterance "准备好了。", error messages naming Mandarin | `assistant/speech.ts` 512, `speaker-voices.ts` 29 (Edge voices `zh-CN-XiaoxiaoNeural/YunxiNeural`, name regexes for gender), `edge-speech.ts` 217, `scripts/edge-tts.ts` 337, `edge-tts-voices.ts` 84 (voice-id regex accepts only `en-XX` and `zh-CN`, `zh-SG` or `zh-TW`), `local-tts.ts` 170 | logic + name + stored | `ja-JP`/`ko-KR` voices, per-language gender voices, warm-up text | **parameter**: `pack.speech = { uiLocale, bcp47, voiceFilter, edgeDefaults{female,male}, warmup }` |
| S2 | **Voice settings keyed by locale**: `speechVoices: { 'zh-Hans'?, 'en-US'? }` (strict), Hands-free `zhVoice`/`zhRate`/`frameVoice`/`emphasisRate`, `defaultSpeechRate` | `assistant/contracts.ts:26-33`, `handsfree/contracts.ts`, `VoiceSettings.tsx` 120, `HandsfreeSettingsForm.tsx` 73 | stored | per-language voice | **stored format** (the key `'zh-Hans'` in `speechVoices`; see Q1) |
| S3 | **Recognition and pronunciation assessment**: `recognition.lang = 'zh-CN'`, Azure assessment locale `'zh-CN'`, CJK word alignment (`shared/speech/alignment.ts` already switches on `ja-JP`/`zh-CN`), transcript diff, practice recording | `speech-capture.ts` 301, `speech-assessment.ts` 409, `shared/speech/assessment.ts` 92 (type already `en-US`, `zh-CN`, `ja-JP`, `ko-KR`), `transcript-diff.ts` 78, `PracticeRecording.tsx` 331, `PracticeFeedback.tsx` 39 | logic | tags; Korean alignment (spaces) vs Japanese (no spaces) | **parameter** (tags) — the shared layer is already ahead of the app layer |
| S4 | **Assistant practice chain** (select text → plan of per-character units with readings, polyphonic characters, boundaries, playlist, write practice) | `assistant/practice-chain.ts` 361 + contracts 138 + store 42; `PracticePlaylist.tsx` 483, `PracticePhraseSelection` 120, `PracticeBoundaryEditor` 54, `WritePractice` 45, `PhrasePractice` 107; `selection.ts` 30 (`snippetLocale`: Han ⇒ `zh-Hans`; message "Select Mandarin text") | logic + interface | unit = one code point + one reading is true for Chinese (and Hangul syllables) but not kanji/okurigana | **generalise** (units from the analyser) or **Chinese only** until then (decision, Q9) |
| S5 | **Hands-free script**: English frames ("In Mandarin"), `syllables()` = Han count × 500 ms, rates relative to 0.85, descriptive-item classifier (particle, measure word), phrase picking | `core/handsfree/script.ts` 398, `player.ts` 142, `store.ts` 77 (`localStorage 'handsfree.settings'`), `pages/drills/HandsFree.tsx` 293 | logic + prompt-like text + stored | per-language syllable/mora timing and frame text | **parameter** (`pack.speech.timing`, `pack.frames`) |

### 2.9 Model prompts

**17 prompts in the app that say or assume Chinese** (5 prompt files + 12 in-code), **1 neutral** (`structured.ts:94` capability probe), and **2 offline pipelines with about 12 more** (`build-practice-dataset.mjs` about 8 prompt objects at `:353-431`, `build-phrase-bank.mjs` about 4 `SYSTEM`-based calls at `:442-610`); `build-parallel-lessons.mjs` is already parametrised per language (`languageOf(code).name/style/script`, `REGISTER`, `FORMAT_RULES` for `ja`/`ko`) and is the template for a pack's offline prompts. All prompts are English-language instructions to a model about Mandarin; the learner's language (English) stays.

| ID | Prompt | Where | What it assumes | Output contract that embeds Chinese names | Verdict |
|---|---|---|---|---|---|
| P1 | Conversation mode | `settings/system-prompts/conversation.md` (8 lines) | "understand and use Mandarin", "Mandarin phrase in its own speech block, with romanization" | speech block | **parameter** (file per pack, or template with `{language}`) |
| P2 | Shadow mode | `shadow.md` (10) | "currently English" → Mandarin translation with romanization | speech block | **parameter** |
| P3 | Explain intent | `explain.md` (7) | "short Mandarin examples" | — | **parameter** |
| P4 | Repeat (reserved, not loaded by the app) | `repeat.md` (15) | Mandarin, tones, pronunciation | — | **parameter** (or drop) |
| P5 | Exercise writer | `exercises.md` (51), built in `study/exercises.ts:165` | every rule: Chinese vocabulary only, 都/也/了 and measure-word rendering examples, "no pinyin inside Chinese strings", `zh-to-en`/`en-to-zh`, tiles are "words in the right order", `acceptedAnswers` with no spaces | `{"exercises":[…]}` with `direction: zh-to-en`, `tiles`, validated by `exerciseSchema` (Han refine) | **generalise**: the *rules* are language-specific text, the *structure* is shared; the Chinese file stays as is |
| P6 | Reply format (the tutor's envelope) | `ai/provider.ts:85-104` `REPLY_INSTRUCTIONS` | "LinguaWeave Mandarin tutor"; `locale: zh-Hans` or `en-US`; "tone-marked pinyin … without tone numbers"; "each Mandarin phrase in its own zh-Hans speech block" | YAML `speech` blocks (`locale`, `romanization`) stored in conversations (backup) | **parameter** + **stored format** (stored `locale` value) |
| P7 | Assistant system message | `assistant/tools.ts:316-325`, `voiceInstructions` `:18`; tool descriptions (32 token lines) | learner context, catalog lookup "across the whole v2 catalog", `band: 'HSK n'`, `pinyin` fields in tool results | tool result fields `chinese`, `pinyin` | **generalise** |
| P8 | Material check | `ai/check.ts:25-30` (6 token lines) | "learner of Mandarin", "is the Chinese natural" | `results[{natural, matches, oneRight, wrongClear}]`, item kinds `zh/en` | **parameter** |
| P9 | Study-set names | `collections/naming.ts:26` | "title (often a show's title in Chinese) → English gist" | `{"names":[…]}` | **parameter** (small) |
| P10 | Drill sentences and conversations | `drills/content.ts:56` `SYSTEM` + 3 call sites (`:120, :196, :206`) (26 token lines) | "simple natural everyday Chinese. Pinyin has tone marks and spaces between syllables. English has no Chinese characters" | JSON `zh, py, en`; conversations `{who, zh, py, en}` | **generalise** + **stored format** (drill sets persist these keys) |
| P11 | Sudoku phrase | `games/sudoku-phrases.ts:65` | "one natural Mandarin phrase using only the supplied vocabulary" | `{text, translation}`, Han refine | **parameter** |
| P12 | Book translation | `library/translation.ts:68` | English → Simplified Chinese, tokens with tone-marked pinyin and English gloss | `blocks[tokens{text, pinyin, meaning, trailing}]` stored in library (backup) | **generalise** + **stored format** (`pinyin` key in `library` rows) |
| P13 | Media dictionary entries (+ sense picking) | `media/entries.ts:128, 141` (26 token lines) | "words segmented out of a video's subtitles", register `literary` ("classical, literary or court-drama"), name pattern 姓…的 | `source` entries `{word, pinyin, meanings, pos, register}` stored (backup) | **generalise** + **stored format** |
| P14 | Media subtitle translation (+ salvage, + fragments) | `media/translation.ts:332, 339, 342` (24 token lines) | "subtitle a Mandarin video for an English-speaking learner" | `aligned` sentences, tokens `{text, pinyin, meaning, trailing}` stored per media item | **generalise** + **stored format** |
| P15 | Phrase bank writer / checker (offline) | `scripts/build-phrase-bank.mjs:442-610` | "practice material for an English-speaking learner of Mandarin", segmenter copy, pinyin-pro | `phrases[{zh, py, en, words, grammar}]` | **generalise** (model: `build-parallel-lessons.mjs`) |
| P16 | Practice dataset writer / checker (offline) | `scripts/build-practice-dataset.mjs:353-431` | `FUNCTION_NOTE` lists the 24 particles; near-miss kinds | dataset JSON (C6) | **generalise** |
| P17 | Parallel lessons (offline) | `scripts/build-parallel-lessons.mjs:51-55, 230, 366, 443` | already per language, but anchored on the Chinese lesson and written for "a Mandarin course" | parallel YAML | **data**/**parameter** (anchor must go for a pack) |

### 2.10 Games

Five playable games plus one bank. **Shared:** word lists come from `game-vocabulary.ts` (59), `sudoku-characters.ts` (54) and the knowledge set; the faces are `character | pinyin | meaning`; pair modes name them (`character-pinyin`, `pinyin-meaning`, …) in Mahjong, Memory and Defender, so saved games and settings persist those ids.

| ID | Game | Where | Chinese-specific | Verdict |
|---|---|---|---|---|
| G1 | Character Sudoku | `pages/Sudoku.tsx` 424 (98 token lines), `core/games/sudoku-*` ≈600, `sudoku-characters.ts` 54, `sudoku-phrases.ts` 81 (AI phrase + Han refine) | the grid symbols are Han characters, hints use per-character readings resolved through `createPracticePlan` (pinyin-pro) and `getWord` (legacy words); saved boards are in the backup (`sudokuBoards`) | **generalise** (symbols from pack: kana/kanji/hangul; readings from pack) + **stored format** for saved boards (`symbols[].character`, `contexts[].pinyin`) |
| G2 | Mahjong | `pages/Mahjong.tsx` 192, `core/games/mahjong*.ts` ≈330, layouts `data/mahjong/*.yaml` (3) | tiles are word pairs by face (`character/pinyin/meaning`); layouts are geometry only | **parameter** (face names from the pack); layouts are neutral. Game state is stored in IndexedDB but **not** in the backup |
| G3 | Memory | `pages/Memory.tsx` 195, `core/games/memory.ts` 112 | modes `character-meaning/-pinyin/pinyin-meaning/triplets` | **parameter** |
| G4 | Hanzi Defender | `pages/Defender.tsx` 145, `core/games/defender.ts` 151, `shared/defender-engine.ts` 202 (shared code) | directions `chinese/english/character-pinyin/pinyin-character`; `pinyinAnswerForms` requires tone-marked, space-separated syllables or throws; `allowsPinyinAnnotations`; type-the-pinyin answers | **Chinese only** for the pinyin directions (a kana-typing counterpart for Japanese would go in the same direction slot), **parameter** for the rest |
| G5 | Phrase Potions | `pages/Potions.tsx` 318, `core/games/potions.ts` 316, `potions-phrases.ts` 40 | phrases are word lists joined without spaces (`phraseText`), each carries `pinyin` | **parameter** (joiner) |
| G6 | Region puzzles (Queens-style bank) | `data/region-puzzles/*.json` + `index.ts`, `core/games/regions/` | none: "no UI, vocabulary mapping, persistence or routing" | neutral |

### 2.11 Media, Library, Collections

| ID | What | Where | Depth | Verdict |
|---|---|---|---|---|
| M1 | **Media (subtitled video via the external Medusa helper)**: requested subtitle languages `['zh-Hans','zh-CN','zh','zh-Hant','zh-TW']`, "This video has no Chinese subtitles", AI translation to aligned English with per-word weaving tokens and pinyin, AI dictionary entries and sense picking, readings via pinyin-pro, compounds, span learning, name pattern, Pinyin/English tracks posted back to Medusa with language `zh-Latn-pinyin` / `en` | `media/translation.ts` 613, `entries.ts` 528, `helper.ts` 158, `contracts.ts` 153, `reconcile.ts` 91, `span.ts` 85, `compounds.ts` 82, `tracks.ts` 80, `readings.ts` 41, `learn.ts`, `study.ts`; `pages/Media.tsx` 555 (27 token lines), `LearnFromSpan.tsx` 56; `sourceEntries` table (≤100,000 rows in profiles) | logic + prompt + stored + interface | **generalise** (analyser, reading, languages from pack) + **stored format** (`pinyin`, `register: 'literary'`, track language tag); *Chinese only until a pack supplies an analyser* is a defensible switch-off for compounds/`isNamePattern` |
| M2 | **Library (books and documents)**: import (EPUB/text/markdown/paste) and reader are neutral; AI translation to Chinese tokens is P12; the reader shows the Chinese translation with weaving | `shared/document-import.ts` 365, `library/{contracts,store,translation}.ts` 233, `pages/Reading.tsx` 137, `ImportedReader.tsx` 132, `reading.css` | neutral import; translation direction English → Chinese | **parameter** (translation target language) + **stored format** (translation `pinyin`) |
| M3 | **Collections (study sets from media/books)**: items `phrase:`/`source:` refs, Han-run extraction, English-gist naming (P9) | `collections/{extract,naming,store,…}.ts` ≈550, `pages/Collections.tsx` 147 | logic | **parameter** (T1) |
| M4 | **Pocket mode** (auto-listen loop, wake lock) | `core/pocket` 202, `components/pocket` 3 files | neutral except recognition locale (S3) and `'linguaweave.autoListen'` key | neutral |

### 2.12 Interface text naming the language or its concepts

I did not read every string. Counts are non-test, non-CSS lines in `pages/`, `components/`, `App.tsx` with a Chinese-naming word: **Mandarin 49 lines/23 files; Chinese 55/28; pinyin 344/58 (mostly the `pinyin` prop and `<Pinyin>`, not text); HSK 26/13; hanzi 2/1; "stroke" 123/20; "radical/component" 187/41 (mostly code identifiers)**. The visible-text ones:

| ID | Text | Where | Verdict |
|---|---|---|---|
| U1 | "HSK n" in lesson list, unit card, group page, Overview ("HSK 3, group 2 of 7"), Study ("NEW ITEMS / HSK 1"), assistant tool, character origins ("HSK 2021 standard word lists"), Dictionary band filter and intros | `LessonList:39`, `UnitCard:50`, `GroupDetail:18`, `Overview:25-26,49`, `Study:52,236`, `tools.ts:93`, `origins.ts:20,23`, `Dictionary:285-286,307` | **parameter** (`pack.bandLabel`) |
| U2 | "Mandarin" naming: "A local Mandarin learning space", "YOUR MANDARIN PATH", "Select Mandarin text to use phrase practice", "Mandarin voice not available", voice picker "Mandarin", Hands-free "In Mandarin" | `Settings:25,32`, `Overview:19,49`, `Practice:17,68`, `App.tsx:311`, `selection.ts`, `speech.ts:326,488`, `VoiceSettings:11`, `HandsfreeSettingsForm:58` ("Chinese voice") | **parameter** (`pack.name`) |
| U3 | "Pinyin" as a concept: "Pinyin format", "Type the pinyin", "Say the pinyin", Match "pinyin" columns, "Show pinyin" toggles (Sudoku, Defender, Settings) | `Settings:46-54`, `FORM_LABEL` (`session/types.ts:32-37`: "Type the pinyin", "Translate to Chinese", …), `DRILL_TYPES` blurbs, `Practice:37` | **parameter** (`pack.reading.label`) |
| U4 | "Chinese curriculum", "Chinese" column headers, the 中/日/한 switch and "with Chinese" captions | `tracks.ts`, `PhraseTable:20`, `ParallelNew:32`, `ParallelLessonList:40` | **parameter** / goes away with the tracks |
| U5 | The "Mandarin path" page (HSK readiness, exam links), Settings "About this checkpoint" text on the 30-level course and the HSK disclaimer | `pages/Curriculum.tsx` 121, `Settings:81-84` | **Chinese only** |
| U6 | Document `<html lang="en">`, manifest name/short_name "LinguaWeave" | `index.html`, `scripts/pwa.ts:27-28` | **parameter** (build constant; the name per language is a learner decision, Q8) |

### 2.13 Build, publish, tests, docs

| ID | What | Where | Verdict |
|---|---|---|---|
| B1 | **Checks wired into the build**: `build:next` = `curriculum:check` (4 generators `--check`: curriculum, forms, parallel, dictionary) + `curriculum:v2:app:check` + `characters:check` (3: characters, writing-ja-ko, origins) + `tsc -b` + vite. Every `--check` regenerates in memory and compares text, so each is a "output unchanged" check | `package.json` | **parameter**: the Chinese pack keeps its list, other packs list theirs; `characters:check` also checks the reproducibility ZIP, which changes with `package.json` (`AGENTS.md`) |
| B2 | **Publishing**: one GitHub Pages deploy of `dist` from `main` (`.github/workflows/deploy-pages.yml`: lint, `test:pages`, `build`), Vite `base: './'`, relative PWA scope; `build-site.mjs` only copies design mockups | workflow, `vite.config.ts`, `scripts/pwa.ts` | **generalise**: one build per language into a sub-path of one artifact; the workflow becomes a matrix. Not read: the other session's channel work |
| B3 | **Tests**: 225 files in `src` + 35 in `scripts` + 1 in `shared` (45,968 lines) + 20 Python tests; 193 of the TS/JS test files hold Han, pinyin, Mandarin or HSK in fixtures; `src/test/` helpers (7 files), `profiles/test-fixtures.ts` 87; 12 test files mention ja/ko | as listed | **parameter**: pack-supplied fixtures; Chinese tests stay untouched (they are the "Chinese unchanged" evidence) |
| B4 | **Existing design prior art**: `docs/languages.md` (425 lines, base 4e8907f, design only): `LangConfig` (script, reading system, writing mode, function words, analyser, prompt pack), an `Analyser` interface wrapping `createSegmenter`, lexeme→forms layer, zero-change migration "add `lang` to the catalog index"; it predates the ja/ko tracks and does not consider the storage or build split | `docs/languages.md` §0, §5, §7, §8 | this inventory confirms its §7 and extends it (section 5 below) |

---

## 3. Settings and stored keys

Classes: **G** global (same meaning in every language, can move to a shared settings store), **L** language-specific (the value only means something for one language, or its choices differ), **D** device-local (belongs to this browser/device, never to the learner's profile). "Interim" = what the learner described: each build keeps its own copy, settings copied across at set-up.

### 3.1 Preferences (IndexedDB `preferences` row `workspace`; in backups as `settings.preferences`, strict schema)

| Key | Meaning | Class | Why / note |
|---|---|---|---|
| `id`, `language: 'zh-Hans'` | row id; the language literal | L (identity) | the literal is validated strictly on import (C11); a pack build writes its own tag |
| `name` | workspace name | G | |
| `theme` | dark/light | G (D in practice) | |
| `pinyin` | show readings on or off | **L** | means "show the reading"; for ja/ko it already means romaji/furigana; rename candidate `showReading` (Q1) |
| `pinyinFormat` | marks / marks-and-numbers / numbers | **L** | becomes the pack's reading format; also in dev `local-settings` |
| `japaneseReading` | romaji or kana | L → merges into the reading format of the Japanese pack | goes away as its own key |
| `currentLanguage`, `startedTracks`, `otherLanguageCards` | the 中/日/한 machinery | — | **disappear** in per-language builds (the cross-language "other languages on cards" returns later as integration) |
| `readingMode` (source/weave/target) | legacy Story reader | L (Chinese only) | belongs to the legacy Word system (C4) |
| `sidebarCollapsed` | layout | D | |
| `speechVoices` (`'zh-Hans'`, `'en-US'`) | chosen voice per locale; browser voices are `voiceURI`+name (device-specific), Edge voices an id | **L + D** | the target-language voice is per pack; the English voice is global; a browser `voiceURI` is device-local by nature |
| `defaultSpeechRate` | 0.25–1.25× | G | learner may want it per language; open (Q7) |
| `speechDebugMessages` | developer toasts | D | |
| `sudokuAutoSpeak`, `tileAutoSpeak`, `promptAutoPlay` | auto-play in a game/exercise | G | `promptAutoPlay` "plays the Chinese prompt" in its help text |
| `writingAutoSpeak` (legacy), `writingSpeech`, `writingSpeechResume` | says the character while writing | L (only where a pack has writing) | |
| `writingColourParts` | colour strokes by component | **L (Chinese only)** | needs components (W4) |
| `haptics` | vibration | D | |
| `exercisesPerLesson` | 8–40, default 20 | G | |
| `sudokuShowPinyin` | show reading in Sudoku | L | |
| `answerMode` (type/speak/write), `practiceMode`, `practiseWriting` | how typed answers are given; include writing exercises | G for the mode, L for `practiseWriting`/write | "write" exists only when the pack has writing |
| `historyFilter`, `dictionaryScope` | list filters | D (UI state) | |
| `characterWriteFilter` | Characters tab filter | L | |

### 3.2 Other stored settings and state

| Key / table | Where | Class | Note |
|---|---|---|---|
| `aiConnections` / `aiEndpoints`, `speechConnections` | IndexedDB; exported in `settings`; token inside | **G** (secret) | same endpoint serves every language; must stay out of any shared public artefact; each build copies it (interim) |
| `backupConfig` + `localStorage linguaweave-backup-config:<profile>` | IndexedDB + localStorage | G (repo/token) but **path must be per build** | Q3 |
| `practice.newItems` (legacy `practice.newWords`), `practice.reviewCount`, `practice.unwrittenSize` | localStorage | G (pace) — `unwrittenSize` L (writing) | daily counts; on one origin two builds would **share** them today |
| `linguaweave.engine.customPresets` | localStorage | L | a preset lists forms, some of which exist only for one language |
| `drills.write` | localStorage | L (writing) | |
| `handsfree.settings` (pause, repeats, wording, intros, emphasis, rates; `zhVoice`, `zhRate`, `frameVoice`) | localStorage; also copied into a practice set's Hands-free activity | G for pause/repeats/wording, **L** for target voice/rate | persisted in `drillSets` (backup) |
| `handwriting-engine` | localStorage | D + L | |
| `media-translation-chunk-size`, `media-translation-concurrency` | localStorage | D | |
| `linguaweave-media-pause-after-line`, `linguaweave-media-glosses` | localStorage | G (pause) / L (glosses) | |
| `linguaweave.autoListen` | localStorage (pocket mode) | D | |
| `linguaweave-selected-profile` | localStorage | D | one per build |
| `linguaweave-media-job-url:<id>` | sessionStorage | D | |
| Learning-state tables (`knowledge`, `studyCards`, `exerciseSessions`, `exerciseAttempts`, `characterStates`, `skillPractice`, `drillSets`, `phraseHeard`, `userPhrases`, `collections*`, `sourceEntries`, `libraryBooks`, `mediaItems`, `assistant*`, `practiceHistory`, `sudokuGames` …) | IndexedDB | **L** (state, not settings) | per build by design |
| Dev-only `data/default.yaml` (`aiConnection`, `speechConnection`, `defaultSpeechRate`, `speechVoices`, `pinyinFormat`) | `scripts/local-settings.ts`, `core/local-settings-contracts.ts` | G (+ L for `pinyinFormat`) | would need to be per language or global |

**What the learner's end state would look like:** global = name, theme, speech rate, auto-play toggles, exercises per lesson, answer mode, AI/speech connections, backup repo; language-specific = show-reading toggle and its format, target voice and Hands-free target rate, writing options, custom presets, per-language pace if wanted; device-local = voices (`voiceURI`), haptics, sidebar, filters, handwriting engine, media tuning, selected profile. The classification is mine; Q7 asks for the learner's.

### 3.3 Every storage name that must be build-derived (for the channel/build work; I do not describe that work)

| Kind | Names today |
|---|---|
| IndexedDB | `linguaweave-next` (default profile) and `linguaweave-next-profile-<id>` (`database.ts:profileDatabaseName`); `linguaweave-profile-registry` (`profiles/store.ts:15`); `linguaweave-backup-state` (`backup/state.ts:52`) |
| localStorage (15 in `src`) | `linguaweave-selected-profile`, `linguaweave-backup-config:<id>`, `linguaweave.autoListen`, `linguaweave.engine.customPresets`, `linguaweave-media-pause-after-line`, `linguaweave-media-glosses`, `handwriting-engine`, `handsfree.settings`, `drills.write`, `practice.newItems`, `practice.newWords`, `practice.reviewCount`, `practice.unwrittenSize`, `media-translation-chunk-size`, `media-translation-concurrency` — **only 6 of 15 carry the product prefix**; the rest are bare |
| sessionStorage | `linguaweave-media-job-url:<id>` |
| Cache Storage | `linguaweave-shell-<build time>`, `linguaweave-runtime`; the SW deletes other `linguaweave-shell-*` caches (`scripts/pwa.ts:56-60`) |
| Cross-tab | `BroadcastChannel 'linguaweave-backup'` (`backup/host.ts:14`), Web Lock `linguaweave-backup:<key>` (`backup/run.ts:23,35`) |
| Service worker / manifest | `sw.js` at the build's base, `manifest.webmanifest` `name`/`short_name` "LinguaWeave", `start_url`/`scope` `./` (relative: good) |
| Backup repo | `profiles/<profile-id>/` prefix in `backup/github.ts:109,125,168`; manifest format strings `linguaweave-backup`, `linguaweave-settings`, `linguaweave-profile`, `linguaweave-next-backup` |

(Of these, the other session is changing "storage names" on main. I list them so the plan can check its coverage: the SW eviction rule, the 9 unprefixed localStorage keys, the BroadcastChannel/Lock names and the `profiles/<id>/` repo path are the ones a "derive every name from the build constant" pass easily misses.)

---

## 4. What the parallel Japanese/Korean code already has

Totals: 616 lines in the 10 `Parallel*` files; 2,121 non-test lines in all ja/ko-only modules (list in the base note); ~120 lines of ja/ko branches inside 25 shared files (from the prior audit, pattern count); 143 language-branch tokens in 33 shared files by my pattern (`isLanguageRef | parseParallelRef | ParallelLanguage | currentLanguageOf | startedTracks | otherLanguageCards | japaneseReading`). Data: `src/data/parallel` 1.1 MB, `forms` 24 KB, `dictionary` 2.9 MB, `public/characters/{japanese,korean}` 1.1 MB, `curriculum/{japanese,korean}` 2,859 files.

### 4.1 Reuse as pack **data**

| Item | Size | Becomes |
|---|---|---|
| `src/data/parallel/{ja,ko}.json`: entries (291/300), grammar (108/97), formItems, 87 lessons each, phrases (817/801, tokens carry word/grammar/form ids), `glosses.json` | 1.1 MB | seed of each pack's catalog and phrase bank; **but the lesson order is the Chinese HSK 1 order** (`zh-lessons.yaml`, `senses[].zh`, `phrase.zh`) and must be re-derived (L2) |
| `src/data/forms/{ja,ko}.json` (rules, classes, irregular lemmas, templates) | 24 KB | pack `forms` data; generator `generate-app-forms.mjs` + `forms-data.mjs` (69 lines) + `curriculum/<lang>/forms.yaml` |
| `src/data/dictionary/{ja,ko}.json` (JLPT: 7,890 words/117 grammar; TOPIK: 11,069/107) + generator | 2.9 MB | the pack's reference dictionary tier |
| `public/characters/{japanese,korean}` (kana, N5/N4 kanji, hangul syllables; Korean is AI-reviewed only) + `generate-app-writing-ja-ko.mjs` 158, `import_*_characters.py` | 1.1 MB | the pack's `writing` data (W1) |
| `curriculum/{japanese,korean}` imports and adapters (JMdict, TOPIK sources, licences), `build_japanese_teaching_data.py` 1,076 | 2,859 files | authoring sources |
| `build-parallel-lessons.mjs` pipeline (writer/checker/matcher, per-language `REGISTER`/`FORMAT_RULES`) | 866 + 335 | template for every pack's content pipeline |

### 4.2 Reuse as pack **functions**

| Code | Lines | Becomes |
|---|---|---|
| `core/forms/*` (engine, japanese, korean, hangul, retag, index) | 498 | pack `analyser` + word-forms engine |
| `parallel/romanize.ts` (RR, Hepburn, kana conversion, `readingFor`, `tokenReading`) | 78 | pack `reading.format` |
| `parallel/conjugate.ts` (build, grade, forms table, form-pick, `ruleLine`) | 210 | pack exercise builders `conjugate`, `form-pick` (E7) |
| `parallel/session.ts` parts: `gradeTiles` (particle-aware), `tilesFor`, `PARTICLES`, `normaliseTile`, `usablePhrases`, `readyAt`, items | ≈150 of 282 | pack matching and tiles; the rest is a second planner (`planParallel`, ≈100 lines) |
| `core/dictionary/{other,links}.ts` (ranked search across JLPT/TOPIK, cross-links) | 201 | the pack's dictionary tier (the cross-language links are integration: later) |
| `core/characters/{otherLanguages,other-list,language}.ts` | 145 | the generalised writing loader (W1) |
| `shared/speech/{alignment,assessment}.ts` (`ja-JP`, `ko-KR`) | 159 | pack `speech` |
| `ParallelStrokes`, `ParallelHear`, `Form` (ruby with reading), `OtherCharacterCard` | 42+61+11+28 | folded into the shared components |

### 4.3 Exists only because the tracks were bolted on (goes away)

| Code | Lines | Why |
|---|---|---|
| `pages/Parallel{Practice,Questions,LessonView}.tsx`, `components/Parallel{New,Reviews,PracticeSource,LessonList,Form(partly)}.tsx` | ≈600 of 616 | a second set of screens, a second question renderer (`ParallelQuestions` 169: 7 of 18 forms) beside `EngineQuestion`/`QuestionViews`, a second planner, a second practice source |
| `data/tracks.ts` (109), `TrackHeader`, `LanguageSwitch`, `LessonsList` track picker, `ParallelLessonList` | ≈250 | the 中/日/한 switch, track registry |
| `core/parallel/{data, refs, practice, progress}.ts` | 202 | loader keyed by `ja` or `ko`; `ja:`/`ko:` refs; knowledge/lesson rows under prefixed ids (`ja:lesson:N` in `db.lessons`, `isParallelLessonId` in `backup-codec.ts:145`) |
| `isLanguageRef` / `isParallelRef` filters in `database.loadWorkspace`, `knowledge.dueCards`, `assistant/tools`, Dictionary, journal replay | ≈25 lines in 8 files | keep ja/ko rows out of Chinese code; unnecessary once storage is per build |
| Prefs `currentLanguage`, `startedTracks`, `otherLanguageCards`, `japaneseReading`; `OtherLanguageLines`, `OtherEntries` and the dictionary language filter | ≈330 | cross-language display (integration, later) |

What the parallel track **does not have** (why it feels "incomplete"): 11 of the 18 forms (no `recall`, `translate-*`, `gap`, `dictation`, `repeat`, the four dataset forms, `pinyin`-type); no phrase bank or dataset beyond its lessons; no Hands-free, drills, games, Assistant practice chain, media or library paths; no History or knowledge counts for its own items; and, for Korean, no persisted writing state (`characterStates` is Han-only).

---

## 5. The seam: one language pack

A sketch, derived from the rows above (IDs in brackets). Not code in `src/`. The shape follows the `LangConfig` of `docs/languages.md` §7 and adds what that design did not see: storage, speech tags, prompts and the persisted names. A build selects exactly one pack at build time (`import.meta.env`-style constant, the same one the storage names derive from); there is no runtime language switch.

```ts
interface LanguagePack {
  // identity and tags                                   [U2, U6, T6, S1, S3]
  id: 'zh' | 'ja' | 'ko' | …            // also the build constant; storage names derive from it
  name: string; nativeName: string; glyph: string      // "Chinese", "中文", "中"
  tags: { html: string; reading: string; speech: string; recognition: string; assessment: string }   // zh-Hans, zh-Latn, zh-CN …
  learnerLanguage: 'en'                                  // fixed for now

  // content                                             [C1-C6, L1-L4]
  bands: { ids: string[]; label(id): string }           // HSK 1..6 → "HSK 1"; stored value stays '1'..'6' [C3]
  catalog: { index; loadBand(id): Promise<BandData>; accessors: { text(u); reading(u); gloss(u); pattern(u) } }   // ch/pr/ds/pt
  labelOf(entry): string                                // numbered-pinyin slug [C7]
  phraseBank?(band): Promise<BankPhrase[]>; dataset?: DatasetSource   // absent → forms E6 off
  functionWords: readonly string[]                      // FUNCTION_CHARACTERS [L4]
  legacy?: LegacyWordSystem                             // data/mandarin + Curriculum page; zh only [C4]

  // text                                                [T1-T6, R1-R4]
  script: { isLetter(ch); runs(text); isWritable(ch); punctuation: RegExp; joiner: '' | ' ' }
  analyser: { covers(text, known): boolean; segment(text, known): string[]; tokens?(phrase) }   // createSegmenter | forms+tokens
  reading: { id; label; formats: Format[]; defaultFormat; format(text, fmt); parse(text); matcher(query); input: 'typed' | 'none'; gradeTyped? }
  matching: { key(text); optional: string[]; equivalences: Equivalence[]; extraRules?: Rule[] }   // grade.ts T4

  // exercises                                           [E1-E11]
  exercises: { forms: Form[]; presets: Preset[]; builders: Partial<Record<Form, Builder>>; graders: Partial<Record<Form, Grader>> }
  // zh: today's 16 forms (no conjugate, form-pick); ja/ko: + conjugate, form-pick; dataset forms only when dataset present

  // writing and characters                              [W1-W6]
  writing?: { folder: string; index; loadPage(page); components?: ComponentsApi; recogniser?: Recogniser }

  // speech                                              [S1-S5]
  speech: { voiceFilter(voice): boolean; edgeVoices: { female; male }; warmup: string; timing: { unitMs(text): number; referenceRate: number }; frames: HandsfreeFrames }

  // model prompts and their validators                  [P1-P17]
  prompts: { conversation; shadow; explain; exercises; reply; check; names; drills; sudoku; bookTranslation; mediaEntries; mediaTranslation }
  schemas: { exercise; practicePhrase; wovenToken; sourceEntry }   // script test and field names from the pack

  // games                                               [G1-G6]
  games: { faces: Face[]; defenderDirections: Direction[]; joiner: '' | ' ' }

  // switches                                            [C4, W3, W4, R3, M1, S4, U5]
  features: { legacyWords; curriculumPage; components; handwriting; typedReading; mediaCompounds; practiceChain; hearByCharacter }

  // settings                                            [section 3]
  settings: { defaults: Partial<Preferences>; languageSpecific: (keyof Preferences)[] }

  // build                                               [B1]
  checks: string[]                                       // npm scripts that must pass for this pack
}
```

**What the Chinese pack points at in today's code** (so building it is a move, not a rewrite):

| Pack field | Today's code |
|---|---|
| `catalog`, `bands` | `study/catalog.ts` (`bandLoaders`, `catalogBands`), `data/v2/*`, `unitTitle/unitPronunciation/unitMeaning` |
| `labelOf` | `scripts/readable-labels.mjs` `numberedPinyin` + v2 `lb` |
| `functionWords` | `session/function-characters.ts` |
| `script` | the 57 `\p{Script=Han}` / `\u3400-\u9fff` tests (T1), `characters/contracts.ts:4` |
| `analyser` | `study/exercises.ts:createSegmenter` (+ the copy in `scripts/build-phrase-bank.mjs`) |
| `reading` | `core/pinyin.ts`, `pinyin/phrase.ts`, `dictionary-search.ts`, `grade.ts` (`gradePinyin`, `typedTones`, `previewPinyin`), `pinyin-context.ts` |
| `matching` | `session/grade.ts` (`OPTIONAL_WORDS`, `EQUIVALENT_WORDS`, `diffWords`, `asMa`), `phrases/key.ts` |
| `exercises` | `session/{types,plan,presets,bank-forms,dataset-source}.ts`, `study/local-exercises.ts` |
| `phraseBank`, `dataset` | `core/phrases`, `core/practice-data`, `src/data/phrases`, `src/data/practice` |
| `writing` | `core/characters/{assets,geometry,components,recognize,handwriting*}.ts`, `public/characters/chinese` |
| `speech` | `assistant/{speech,speaker-voices,speech-capture,speech-assessment,edge-speech}.ts`, `handsfree/script.ts` (`syllables`, `ZH_SYLLABLE_MS`, frames) |
| `prompts`, `schemas` | `settings/system-prompts/*.md`, `ai/provider.ts REPLY_INSTRUCTIONS`, the in-code `SYSTEM` strings (P5–P14), `study/contracts.ts`, `practice-data/contracts.ts` |
| `games` | `game-vocabulary.ts`, `shared/defender-engine.ts`, `potions.ts` |
| `legacy` | `data/mandarin.ts`, `curriculum*.ts`, `learning*.ts`, `Curriculum/Lessons/Reading` pages |
| `features` | all true for `zh` except `typedReading` semantics (tones) which is zh-specific |
| `checks` | `curriculum:check`, `curriculum:v2:app:check`, `characters:check` |

**Where the sketch is thin.** The *analyser* is the least certain piece: it must serve exercise generation (`covers`), tiles (`segment`), phrase tagging for the bank, media segmentation and the Assistant chain's units; Chinese needs only the first two. `docs/languages.md` §4.3 lists three options for the non-Chinese side (generated form table, off-line tagging, AI batch tagging); the ja/ko track has chosen the first for lessons and none for free text.

---

## 6. Stages

Order chosen so that nothing a stage does can change what Chinese shows or stores; each stage ends with the checks in the last column. Sizes: **S** ≈ half a session, **M** one session, **L** needs splitting (the split is given). "Files" are counts from this inventory. **Stage 0 builds the instruments the later checks rely on; the repo has none of them today** (no stored-format golden files, no prompt-hash test, no storage-name test).

| # | Stage | Rows | Size (files) | Chinese stays identical because | Mechanical check |
|---|---|---|---|---|---|
| 0 | **Baseline and guards**: (a) a seeded fixture profile (a few hundred knowledge items, sessions, character states, a conversation, a media item) exported with today's code as backup JSON, profile YAML and `settings.yaml`, committed as golden files; (b) a test that lists every IndexedDB/localStorage/sessionStorage/cache/channel/lock name (section 3.3); (c) hash tests of the 17 prompt strings; (d) record test counts and the 2 skipped tests | C11, 3.3, P | S (3 new test files) | adds tests only | the new tests pass on unchanged code; `npm run test:pages` count recorded |
| 1 | **Build constant and storage names** (the other session's work, plus the three things it may not cover: the SW eviction rule, bare localStorage keys, `profiles/<id>/` in the backup repo) with the default pack `zh` = today's names | 3.3, C9, C11 | M | the `zh` build keeps every name byte-for-byte | stage-0 name test unchanged for `zh`; a second build value shows only prefixed names |
| 2 | **Pack skeleton**: `LanguagePack` type, `zhPack` object assembled from today's constants (bands, function words, tags, names), `getPack()`; no call site changes | §5 | S (4 files) | nothing consumes it yet | type-check; a test pins `zhPack` fields to the current constants |
| 3 | **Script primitives**: replace the 57 Han tests (43 files) and the 24-character function set with `pack.script`/`pack.functionWords`; add an ESLint rule forbidding `Script=Han` and `\\u3400-\\u9fff` outside the `zh` pack | T1, T3, L4 | L → 3a core+session+study (≈15 files), 3b media/assistant/games/phrases (≈18), 3c pages/components (≈10) | the `zh` functions are the same regexes | lint rule passes; `test:pages` unchanged; stage-0 goldens unchanged |
| 4 | **Reading**: `pack.reading` for the 18 `core/pinyin` importers, `<Pinyin>` (28 files), dictionary-search, grade; stored key stays `pinyin`/`pinyinFormat` | R1–R5 | L → 4a engine+search+grade, 4b components/pages | `zhPack.reading` delegates to `pinyin.ts` | pinyin/grade/dictionary-search tests unchanged; goldens unchanged |
| 5 | **Interface text**: bands labels, language and reading names, HSK/Mandarin/pinyin strings (U1–U4); Chinese-only pages behind `features` | U1–U6 | M (≈40 files, mostly one-line) | the `zh` strings are the same strings | text-snapshot test of Overview, Lessons, Practice, Settings, Dictionary before/after; page tests unchanged |
| 6 | **Speech**: `pack.speech`, one language-tag adapter (`zh-Hans` ↔ `zh-CN` ↔ `zh`), voice filter, Edge defaults, Hands-free timing and frames; stored `speechVoices` key unchanged | S1–S3, S5 | M (≈15 files) | tags and strings equal | speech/hands-free tests unchanged; golden `settings.yaml` unchanged |
| 7 | **Prompts**: prompts and their validators from `pack.prompts/schemas`; the Chinese ones are the current files/strings | P1–P14 | M (≈14 files) | the strings are the same | stage-0 hash test; AI-exercise tests unchanged |
| 8 | **Analyser**: `pack.analyser`, wrap `createSegmenter` (5 files); the build script copy imports the same module | T2 | M (≈10 files) | adapter = current function | segmenter, exercises, drills-content and phrase-bank tests unchanged; `curriculum:check` unchanged |
| 9 | **Matching and exercise lists**: `pack.matching`, `pack.exercises` (forms, presets, builders), fold the 3 exercise systems' type lists | T4, E1–E9 | L → 9a matching/grade, 9b planner/forms/presets, 9c drills + AI-session schemas (script test from pack) | the `zh` lists are today's | session/study/drills tests unchanged; goldens unchanged |
| 10 | **Neutral accessors for records**: `text/reading/gloss` accessors over `ch/pr/ds`, `zh/py/en`, `pinyin` — **in memory only, stored names untouched** (the cheap branch of Q1) | C2, C5, C6, R2, E2 | L → 10a catalog+study, 10b phrases+session+drills, 10c components+pages (≈50+44+87 files in total; many overlap) | no stored shape changes | `tsc -b`; goldens byte-identical |
| 11 | **Writing**: `pack.writing`, `characterSchema` from `pack.script`, single loader for zh/ja/ko data; components and handwriting stay behind `features` | W1–W6 | M (≈20 files) | zh index and loader unchanged | `characters:check`; writing tests unchanged; golden `characterStates` unchanged |
| 12 | **Games**: faces, directions, joiner from the pack; remove `getWord`/`data/mandarin` from game vocabulary and the Assistant context tool (they read v2 knowledge only) | G1–G5, C4 | M (≈12 files) | same lists for Chinese (the legacy words are a subset of v2? **not verified**; see Q12) | game tests unchanged; Chinese Sudoku/Memory word lists compared before/after on the fixture |
| 13 | **Fence the legacy Word system** behind `features.legacyWords`; `backup-codec` validates words/lessons/readings only when it is on | C4, C11 | M (≈14 files) | on for `zh` | backup goldens (validation still accepts them); legacy page tests unchanged |
| 14 | **Generator parameters**: `generate-v2-app-data`, `generate-app-curriculum`, phrase-bank and dataset builders take a pack descriptor (language, prompts, segmenter, reading); `--check` per pack | C1, C5, C6, P15, P16, B1 | L → 14a catalog/curriculum generators, 14b phrase/dataset builders | the Chinese descriptor reproduces the same text | `curriculum:check`, `curriculum:v2:app:check`, `characters:check` (the ZIP hash unchanged because `package.json` is untouched; if it is touched, regenerate it as `AGENTS.md` says) |
| 15 | **Remove the parallel tracks**: delete `Parallel*`, `tracks`, `LanguageSwitch`, the `ja:/ko:` ref filters and prefs; keep the ja/ko *data* and functions as the seed of the first non-Chinese pack (section 4) | §4.3 | L → 15a screens+prefs (≈30 files), 15b refs/filters/backup code (≈12 files). A Chinese learner has no `startedTracks`, so nothing changes; a profile that has them is the Q-risk in §7 | the `zh` build never rendered them for a Chinese-only profile (prior audit) | goldens unchanged; tests for the removed files deleted with them |
| 16 | **Settings split**: global/language-specific/device classes (section 3); interim copy-across tool between builds | §3 | M | the `zh` build keeps its own copy | settings round-trip golden |
| 17 | **First non-Chinese pack** (Japanese or Korean as the learner chooses): own catalog and order, pack functions from §4.2, prompts, dataset plan | — | XL (several sessions; content-bound, see §1 finding 3) | outside the Chinese build | its own `checks` |

**What can be checked mechanically throughout:** (1) the stage-0 golden exports of the seeded profile (backup JSON, profile YAML, `settings.yaml`, journal segment) byte-identical; (2) the storage-name test; (3) the 17-prompt hash test; (4) `npm run curriculum:check`, `curriculum:v2:app:check`, `characters:check` (they compare regenerated text to the files, so "Chinese data unchanged" is already a check); (5) `git diff --stat -- src/data public/characters public/curriculum` empty on every stage except 14; (6) `tsc -b`, `npm run lint` (plus the stage-3 rule) and the Chinese test suite; (7) a before/after list of the built `dist` file names, ignoring content hashes. A byte comparison of `dist` JS is not useful (the SW version is `Date.now()`, hashed bundle names change with any code move).

**Rough total for the Chinese-neutral part (stages 0–16):** about 10 M-sized sessions (counting the two S stages as one) plus 6 L stages split into 15 more, i.e. **≈25 sessions** — and it does not deliver a single new-language screen that works with real content; stage 17 does. I would not state it as less.

---

## 7. Risks and open questions

### 7.1 What I could not settle by reading

1. **Whether the real profile holds `ja:`/`ko:` rows, `startedTracks`, `ja:lesson:N` lesson rows or Japanese/Korean journal events.** The repo cannot say. Stage 15 and any "remove parallel" claim depend on it; the other session's backup fix touches the same rows.
2. **Which persisted shapes hold the engine's `SessionExercise` plan** (`drillSets` with `engine`? `exerciseSessions`?). I traced the AI-session exercise schema (`study/contracts.ts`) and the drill-set item schema (`drills/contracts.ts`), not the persistence of engine plans in `drills/store.ts` (381 lines, not fully read). If plans are persisted, E2–E5's enum values (`zh-to-en`, `zh-py`) are stored too, and Q1's cost grows.
3. **Whether the legacy Word vocabulary used by the games is a subset of the v2 knowledge set** (stage 12 assumes the games can read v2 only; `sudokuKnownWords` also adds `workspace.words`).
4. **The other session's storage-name design** and how Stable/Lab values reach `pwa.ts`, `profiles/store.ts`, `backup/*`; I did not read it.
5. **Whether Medusa (the external subtitle helper) serves non-Chinese subtitles** with the same job protocol (`helper.ts` hard-codes the Chinese list; the URL scheme is `intent://…;scheme=medusa`).
6. **Handwriting recognition for ja/ko**: the built-in recogniser's data is Chinese (`recognition.generated.json`); the `chrome`/`google` engines are language-tagged but I did not read how.
7. **UI strings**: I counted and sampled the visible ones (U-rows); I did not read all 26 pages' text. The count of strings that say "Chinese" in message text is a lower bound.
8. **Bundle and load cost** of per-build data (Chinese ships ≈17 MB of stroke data and ≈20 MB of generated JSON); only noted.
9. **Test counts in section 2.13** are file-level greps, not an analysis of which tests would need pack fixtures.
10. I did not verify that any stage's check passes; the repo has no `node_modules` here and I ran nothing.

### 7.2 Decisions that belong to the learner

| # | Question | Why it matters / options |
|---|---|---|
| Q1 | **Persisted names**: keep `zh`, `py`, `pinyin`, `'zh-Hans'`, `'zh-to-en'`, `zh-py` in stored data for Chinese and let other packs reuse them, or write neutral names (`text`, `reading`, `language`, `target-to-en`) with read-both? | Reuse = zero stored change and zero risk for Chinese, but a Japanese backup would contain keys called `zh`/`pinyin` (the cross-pollution the learner complained about, just in files). Neutral = a stored-format change in the Chinese build (read-both, write-new): older builds cannot read newer exports (a rollback cost for Stable/Lab). My recommendation: neutral names for **new** persisted shapes and for every in-memory type now; decide the Chinese rewrite later, behind a version bump. |
| Q2 | **Refs in a pack build**: unprefixed `vocabulary:`/`grammar:` for every language (the plan above), with a new `form:` kind for irregular-form items? Or keep a language prefix in every ref (safer for a later merge of two languages' data)? | Prefixes make the later "integration" cheaper; no prefix keeps Chinese refs identical. |
| Q3 | **Cloud backup**: one repo with a language segment (`profiles/<id>/` → `<lang>/profiles/<id>/`), one repo per language, or the same path with distinct profile ids? | Today two builds write the same files. Also whether restore may cross languages (it must not, today). |
| Q4 | **Which features each pack switches off at first** (Hands-free, games, handwriting, Assistant practice chain, media, library, Hear by character): per-pack list. | "off, not replaced" per the brief; I count 7 candidate switches (§5 `features`). |
| Q5 | **Japanese kanji and Chinese components**: reuse the Han component table (and the parts font) for kanji, or none for Japanese? Hangul jamo breakdown as a new feature? | W4 is the largest Chinese-only asset (1.4 MB + font + 533-line generator). |
| Q6 | **Curriculum for ja/ko**: keep the lessons anchored on the Chinese HSK 1 groups, or write each language's own order (JLPT N5 first)? How many levels before the pack counts as usable? | Decides L2; 87 lessons are about 6% of Chinese. |
| Q7 | **Settings split** (section 3): which of the "G" keys the learner wants truly global (speech rate? daily counts? auto-play?), and which of "L" per language. | |
| Q8 | **Names and look**: app name/icon/colour per build (`manifest` name, `<title>`), and the build's address. | U6 |
| Q9 | **Assistant practice chain for Japanese**: the per-character unit model fits Chinese and Hangul, not kanji with okurigana. Off until redesigned, or redesign now? | S4 |
| Q10 | **Learner language**: English only for all packs (assumed here)? The prompts and the English-side grader (T5) depend on it. | |
| Q11 | **Bands**: stored `band` is 1–6. JLPT has 5 levels, TOPIK 6, Chinese HSK 6 (+7–9 not in the app). Map into 1–6 (assumed) or widen the stored enum? | C3 |
| Q12 | **Legacy Word system** (starter words, 30-level path, HSK readiness page, stories): retire it for everyone, or keep Chinese-only? | It blocks stage 13 and keeps backup validation tied to old ids. |
| Q13 | **Typed-reading exercise for Japanese**: a kana-typing counterpart to "Type the pinyin" — wanted, or not? | R3 |

### 7.3 Where this can go wrong

- **A "parameter" label hides content work.** Rows marked parameter (prompts, matching, function words, frames, voices) are code-cheap but each needs a native-quality artefact per language (e.g. P5's 51-line rule set was written for Chinese failure modes: 都/也/了, measure words). Budget that as content, not as stage 7.
- **Mechanical renames touch data you cannot see in review**: stage 10 changes ~100 files; without the stage-0 goldens it can alter exports without a test noticing.
- **The service-worker eviction and shared-origin storage are active hazards today for any two builds**, independent of language (section 1).
- **Prior-audit numbers** (the "55 files" and the pattern counts) are used only where I re-counted; the revert analysis in its Part A was not needed here and not checked.
