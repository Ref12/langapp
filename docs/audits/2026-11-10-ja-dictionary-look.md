# Japanese Dictionary switched on: what happens (2026-11-10)

Base 2bfdec09. Local change tried and reverted: `jaMeta.features.dictionary: true` in `src/core/language/meta.ts`. Build `LANGAPP_LANGUAGE=ja npx vite build`, `vite preview`, headless Google Chrome at 430 px (playwright-core). Fonts: fonts-noto-cjk installed, screenshot of 食べる たべます 日本語 showed real glyphs. 7 page screenshots taken (of 12 allowed); the rest was read as page text.

## Short answer

- **It renders.** No console or page error on any tab. `Dictionary.tsx` reads `languageInUse(preferences)`, which in the ja build is `ja`, so it goes straight into the old "Other*" path (hypothesis confirmed). The switch alone gives a working but old-shaped Japanese page.
- **Works as it is:** search by kana, kanji and English; the forms table (24 rows for 食べる); lesson phrases; writing sheet from a kana/kanji; Hear.
- **Wrong:** reading is romaji (ignores the "Readings" setting); verbs always dictionary form (ignores "Show verbs as"); romaji (taberu) and polite form (食べます) find nothing; knowledge always 0 (reads `ja:w:` refs the Japanese app never writes); no way to add a word to study; lesson links go to the old `#lessons/ja/15`, a Chinese-app page ("JAPANESE / HSK 1 WITH CHINESE", Chinese translations); the data is 7,890 JMdict-style words of which only 292 are lessons words; Phrases tab shows old-app phrases with Chinese originals.

## What I saw (screenshots in the sandbox scratch only, not committed)

1. `#dictionary`: tabs Vocabulary (7,890), Grammar (117), Characters (0 until opened, then 2,207), Phrases, Full list, My knowledge set (0), In study sets (0), Draw; Band filter N5-N1. Cards "VOCABULARY / N5", reading in **romaji** ("au"), meaning with senses joined by "; " and cut at two, a POS line from JMdict (e.g. "Ichidan verb; transitive verb"). Heading "Every JLPT N5-N1 word and grammar point in the curriculum" (a claim about 7,890 words that is not the Japanese app's curriculum). No pinyin, HSK, Mandarin or tone wording found on Vocabulary, Grammar, Characters, Draw. Phrases tab: "Japanese and Korean lesson phrases", a 日 tag on each row and "Chinese" mentioned (817 phrases).
2. Search (counts as shown by the page): たべ 2 (食べ物, 食べる); 食 20; **taberu 0**; eat 376 (食べる first); **食べます 0**; 食べる 1.
3. 食べる opened: reading たべる shown as "taberu"; meaning "to eat; to live on (e.g. a salary)..."; N5; "Ichidan verb"; "Taught in lesson 15"; 3 lesson phrases; forms table of 24 rows, from `core/parallel/conjugate` (the **old** table, not `core/forms/conjugate.ts`). The lesson link goes to `#lessons/ja/15`: an old Japanese-in-the-Chinese-app lesson page with Chinese translations (中 对不起), five words, two grammar points.
4. Grammar tab: 117 cards, examples and "Taught in lesson N" (old numbering) shown without a click.
5. Characters: 2,207 (hiragana incl. small ぁ, katakana, kanji, 々, 〇), script filter All/Hiragana/Katakana/Kanji, 48 per page. "Write" is inside the "Phrase actions" menu and opens the **writing sheet over the Dictionary** (route stays `#dictionary/characters/all`); it does not go to the Writing page. Browser Back then went to `#dictionary` (Vocabulary tab), not to the Characters tab. `#writing` for a character without a guide: "This stroke guide is not available".
6. Draw opens "Draw a character", recognizer "built-in matcher · Chrome handwriting not available" with Auto/Chrome/Google/Built-in. Not tried with a stroke.
7. Filters: Band N5-N1 (means something: dictionary levels, but they are JMdict/Waller levels, not the pack's lesson bands); scopes "My knowledge set" and "In study sets" are always 0 / empty.

## Trace (one row per thing on the page)

| Thing | What the learner sees | Code and data | Verdict | Should read |
|---|---|---|---|---|
| Page gate | Page appears | `isAreaOn(pack,'dictionary')` (`areas.ts`, `App.tsx:88` message) | switch only | same |
| Which language | Japanese | `Dictionary.tsx:43-47` `languageInUse` -> `lang`, `others`, `showZh`, `multi`; `scope.ts` | Chinese-shaped seam (page tests language) | page asks pack; no `showZh`/`multi` |
| Word list | 7,890 words | `core/dictionary/other.ts` `loadDictionary`, `src/data/dictionary/ja.json` (1.25 MB; 7,890 words, 117 grammar, 2,065 word classes) | wrong size; own data not used | pack catalog words (292) first |
| Entries vs catalog | -- | all 292 catalog vocabulary ids (`ja-n5-00369`) exist in ja.json (id match, 292/292); 115/115 catalog grammar ids exist, 2 dictionary grammar outside; 7,598 words outside lessons (62 of the 292 are old `ja-par-` words with no level) | join key exists: dict id = catalog `id`, pack ref uses `lb` (`taberu--eat`) | map dict id -> `vocabulary:<lb>` through catalog |
| One entry per meaning | senses merged with " | " in one entry, cut at 2 | `OtherWordCard` `meaningList` | wrong vs decision | one entry per meaning |
| Reading | romaji "taberu" | `ParallelForm.Form` -> `useReadingSettings().japanese` (`pinyin-context.ts`, default romaji) | wrong: ignores `readingStyle` | `ReadingText`/`useHeadword` (`display-context.tsx`), kana default |
| Verb shown | always dictionary form | `word.form` direct | wrong: ignores `displayForm` | `useHeadword(record)` (polite default) |
| Search | kana/kanji/English ok; romaji and polite form 0 | `makeOtherMatcher` (`other.ts`): fold form, reading, hanja, English only | wrong | match display form, both forms (from forms table), kana, romaji (`kanaToRomaji`), English |
| Forms table | 24 rows | `OtherEntries.WordForms` -> `core/parallel/conjugate.wordFormsTable` | right content, **old module** | `core/forms/conjugate.ts wordFormsTable` (the pack's `forms.generated.json`) |
| Lesson link | "Taught in lesson 15" -> `#lessons/ja/15` | `links.ts lessonsTeaching` over `core/parallel/data` (`data/parallel/ja.json`) | wrong (old track, Chinese translations) | `#lessons/group/ja-lesson-0001` from catalog groups |
| Lesson phrases | 3 phrases | `phrasesUsing`, `DictPhrase` | old data | pack examples of the lesson |
| Known/learning/new | "In your knowledge set" tag; counts 0 | `Dictionary.tsx:131-132` `otherKnown` = `db.knowledge` refs passing `isParallelRef` (`ja:w:`); compared with `word.ref=ja:w:<id>` (`other.ts`) | wrong: Japanese app writes `vocabulary:<lb>`, so always "new" | pack refs; learning state from `studyCards` as Chinese cards do |
| Add to study | no button at all | `OtherWordCard` has none; `UnitCard` (Chinese) has | missing; nothing is written | pack `UnitCard`-style add writing `vocabulary:<lb>` |
| Scopes | My knowledge (0), In study sets (0) | `otherTotal`, `inOtherScope` use `ja:w:` prefix and `collected` | wrong | pack refs |
| Grammar tab | 117 | `dict.grammar`, `OtherGrammarCard`, lessons from parallel data | wrong refs/links; grammar of N-levels beyond the 115 lessons | pack grammar |
| Characters tab | 2,207 | `loadLanguageIndex` (`characters/otherLanguages`), `other-list.ts` `isListed`, `OtherCharacterCard` -> `openWritingSheet(character,{language,remember:false})` | works; sheet not page; scope note "not tied to a knowledge set" | pack `writing` (jaWriting) character list |
| Draw | opens | `HandwritingPad`, `drawable` from `otherChars` | works, untried | same |
| Phrases | 817 old phrases with 日 tag and Chinese original | `otherPhrases` from `loadParallel` | wrong (parallel/Chinese) | pack phrase bank (`phrases-band-1.json`) or hidden |
| Band filter | N5-N1 | `word.level` from ja.json | ok for dictionary levels, not lesson bands | pack band wording ("Level {n}") |
| Heading and footnotes | "Every JLPT N5-N1 word..."; "Japanese words: JMdict/EDICT... Waller's" | inline in `Dictionary.tsx:278,345` (`lang === 'ja' ? ...`) | language test in page | pack wording |

Places that test language or use the old paths: `Dictionary.tsx` lines 30-34, 42-47, 74, 104-108, 131-132, 140-157, 165, 191-210, 248, 278, 286, 293, 296, 316-345 (`showZh`, `multi`, `lang ===`); `OtherEntries.tsx` (`core/parallel/conjugate`, `parallel/data`, `parallel/progress`, `ParallelForm`, `ParallelHear`, `ParallelStrokes`, `#lessons/<lang>/<n>`); `OtherCharacterCard.tsx` (`parallel/data`, `ParallelForm`); `core/dictionary/other.ts` (`ja:w:`/`ja:g:` refs, `'ja'|'ko'` unions); `links.ts` (parallel data); `core/parallel/refs.ts` (`isParallelRef`).

## Build in stages (one session each; every stage ends with Chinese pins unchanged)

Chinese guard for all stages: `src/pages/Dictionary.test.tsx`, `DictionaryCharacters.test.tsx`, `DictionaryPhrases.test.tsx`, `DictionarySave.test.tsx`, `DictionaryLanguages.test.tsx`, the Dictionary screens in `src/pages/__screens__` (via `chinese-screens.test.tsx`), `src/core/language/language.test.ts` and `App.language.test.tsx` (the "Not available" test changes only when the switch goes on).

1. **Lesson words, own data, both forms.** Pack: `dictionary` feature on in `jaMeta`, a pack seam for the Dictionary (entries from the catalog: 292 words with their forms table from `core/forms`, search keys display-form/both forms/kana/romaji/English). Page: Dictionary.tsx takes entries and wording from the pack; for Japanese only Vocabulary tab shown (no Grammar, Characters, Phrases, Draw, scopes). Moves: `wordFormsTable` from `core/forms`, headword/reading from `display-context`. Learner sees: search 食べます, 食べる, たべ, taberu, eat all land on one entry; polite shown by default; reading kana or romaji by setting; lesson link to `#lessons/group/ja-lesson-0001`. Proof: guard tests above unchanged; new Japanese pin in `japanese-screens.test.tsx` (Dictionary opens, six queries find 食べる, forms table, link href, setting flips) plus a pack test that every catalog word has an entry.
2. **Grammar and what I know.** 115 catalog grammar points, "known/learning/new" from `vocabulary:`/`grammar:` refs and study cards, add-to-study writing pack refs, My knowledge set / In study sets scopes. Pin: add a word, it shows as learning, it appears in Practice.
3. **Characters and Draw.** Character list and writing sheet from the pack's `writing` (jaWriting); Back returns to the Characters tab. Pin: kana opens the sheet; Draw finds a kana.
4. **Pack phrases and neutral names.** Rename `Other*` to neutral names, remove `showZh/multi/lang===` and parallel imports from Dictionary.tsx, Phrases tab from the pack's phrase bank. Pin: DictionaryLanguages.test.tsx updated only by renames.
5. **Beyond the lessons (only if the owner says yes, see Q1).** The other 7,598 JMdict words as a pack dictionary file with one entry per meaning; entries outside the lessons are look-up only.

Old entry point: while these stages run, the Chinese app's language switch + `OtherEntries`/`other.ts`/`links.ts`/`ja.json` stay in place and unchanged (stage 4 only renames, keeping it working); the separate step removes it after stage 4.

## Questions for the owner

1. **The 7,598 non-lesson words (JMdict N5-N1)?** (a) Lesson words only: small and clean, learner cannot look up "kuu". (b) Also all JMdict words, look-up only: bigger bundle (1.25 MB file) and needs one-entry-per-meaning reshaping (stage 5). (c) JMdict words and add-to-study for them: needs study content for each, large.
2. **Can the learner add a non-lesson word to study?** Only matters for (b)/(c); yes costs new records and forms for every word; no means look-up only.
3. **Characters tab: all 2,207 or only kana and kanji from the lessons?** All is complete but long (includes small ぁ, 々, 〇); lessons-only is short but hides characters from searches.
4. **The 817 old phrases (Chinese originals)?** Drop (recommended: they belong to the old track) or rebuild from the Japanese app's examples.
