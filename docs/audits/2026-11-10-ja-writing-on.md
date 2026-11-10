# Japanese: the writing area switched on (2026-11-10)

Base: `824e1c6eaf43a5725b845c966e7ca20079efcfbb` (public langapp main, "Japanese Practice, stage D: the sentence exercises ask the pack"; it contains stage E, "Japanese Practice, stage E: the Practice page and what it starts ask the pack", `dd20aa4`). Branch `langapp/ja-writing-on`, not pushed.

## The switch
`src/core/language/meta.ts`: `jaMeta.features` is `{ ...nothing, writing: true }`. Every other Japanese area and all of Korean stay off. Chinese is untouched.

## Per item
| Item | Result |
|---|---|
| Writing page (`#writing`, a character's page) | Works with Japanese stroke data (`characters/japanese/`): あ (3 strokes), 働 (13), 私 (7). There is no Writing entry in the navigation in any build (the page is reached from practice and the dictionary), so nothing to restore there. Fixed: the top bar said "Dictionary", Back defaulted to a dictionary page and the empty state said "from the dictionary", none of which exist in Japanese. They now say Practice / go back to Practice / "Open a character from a practice set" when the Dictionary area is off (`App.tsx`, `Writing.tsx`; test `Writing.ja.test.tsx`). |
| Learn to write | Works on kanji (私: intro, 7 strokes, trace, from-memory loop). **Not for kana**, see follow-ups. |
| Write it | Works: a sentence's word (勉強する) is written stroke by stroke; only `characters/japanese/index` and the character file are requested. |
| "Characters to write" | Shown on Practice once the learner knows words; Start makes an "Unwritten characters" set from the oldest known words (5 words for the default size 8). See the count below. |
| Writing settings | "Practise writing characters (yes or no)" and "Say the character" (At transitions / Every stroke / Off) show in Settings. No Chinese or pinyin wording. |
| Chinese reads in these views | `StrokeOrder.tsx` tagged characters `lang="zh-Hans"`, so a Japanese kanji drew in Chinese glyph forms; it now uses the pack's `learningTag`. |

## What the count is based on (Japanese)
`newCharacters` -> `introducedChars` -> `getPack().writing.introduces`. Japanese `introduces` is **kanji only**: the count is the distinct kanji (with a Japanese stroke guide) in the learner's known vocabulary that they have not yet written. Kana are written (Write it, the Writing page) but are neither counted nor queued as "new characters". Example: with 14 lesson words known the page showed 14, which is kanji only.

## Pins and tests changed
- `ja-practice-by-skill`, `ja-practice-ready`, `ja-settings` screen pins: additions only (the backlog row, Learn to write / Write it, the two settings). `practice-by-skill` no longer asserts there is no backlog.
- `language.test.ts`: Japanese has exactly the writing area on. `offered.test.ts`: Japanese offers learn/write; Korean still does not.
- Chinese pins and tests unchanged.

## Follow-ups (left off on purpose)
1. **Kana teaching order.** `jaWriting.introduces` stays `isHan`, so Learn to write never teaches あ, ア and so on and kana do not enter the backlog. Teaching them as characters needs a Japanese order (gojuon groups, dakuten, katakana timing, whether lessons 1-3 words like ありがとう lead to it). That is a policy decision, not wiring; the one place to change it is `introduces` in `src/core/language/writing.ts`.
2. Korean writing stays off.
3. Writing-page meanings, parts and history are Chinese-only (`characterData`); Japanese shows strokes only.
4. Some Learn-to-write/Write it strings still carry shared blurbs from `DRILL_TYPES` in Chinese-neutral wording; the Japanese build's wording comes from the pack (Write it reads "A reading sentence...").

## Screenshots (430 px, Noto CJK installed, real glyphs checked)
`docs/audits/images/2026-11-10-ja-writing-on/`: 01 Practice page, 02 set type list, 03 Practice with "Characters to write", 04 Learn to write (kanji 私), 05 kanji trace, 06 Write it, 07 Settings, 08 `#writing` empty page, 09 single kanji (働), 10 single kana (あ).
Note: there is no Learn-to-write kana shot, because Learn to write does not teach kana (follow-up 1); 10 shows kana on the Writing page.
