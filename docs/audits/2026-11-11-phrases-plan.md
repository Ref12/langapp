# Phrases for Japanese and Korean, subject omission, and a free phrase practice: plan

Written 2026-11-11 on public main at `d36c01a`. Read-only: no source file was changed and no test suite was run. Counts below come from small scripts over the shipped JSON and from reading the code; model cost and time figures are estimates and are marked as such.

## 0. In one page

- The Chinese bank is a **flat list of 15,108 phrases** (13,389 marked checked), not the 12,925 in the brief (see 1.1). It is used by Practice (every phrase-based exercise form), the Dictionary's Phrases section, Hands-free, the Assistant's "add to phrase bank" and the games. **Hands-free is on for Chinese only**: for Japanese and Korean the whole `handsFree` area is off, and so are games, collections, library, media and the assistant. Only Writing and Dictionary are on beside Lessons, Practice, Overview, Settings.
- Japanese and Korean already ship a **bank of 822 and 905 phrases**: the lesson sentences, in the same file format as Chinese (`phrases-band-1.json`, with tokens). Practice already uses them. Switching the Dictionary's Phrases tab on today would list those sentences, but the table headers say "Chinese" and "Pinyin", the cells are tagged `lang=zh-Hans`, and the Play button speaks Chinese; so it needs a small language pass first (stage 1).
- A real bank per app: **about 2,300 phrases each** (the 822/905 lesson sentences plus about 1,500 new), none using anything taught after lesson 87, written by the Chinese pipeline generalised to take a language (batched calls only). Estimated 2 to 4 model-hours of wall time with concurrency, a few tens of dollars at most per language.
- Subject omission: phrases are written as natural Japanese/Korean (subject dropped where a native speaker would drop it). Their English always has a subject (English needs one), the most natural for the situation, plus a flag for "open subject" phrases with a short list of equally right English wordings. **Today Japanese has no rule for a dropped 私は** (Korean has one for 저는), and 163 of 613 subject-less Japanese phrases carry an English that picks "I" or "You" arbitrarily. Details in section 3.
- Free phrase practice: recommended as **its own Practice page "Phrases" (all three apps)**, a plain flip-card/type/speak loop over the bank, both directions, history written but **no review scheduling**, and Hands-free left as the listening mode of the same picker. Section 4.
- Five stages, three of which can run at the same time. Section 5. Questions for the owner: section 6.

## 1. The Chinese phrase bank

### 1.1 What it holds

Shipped as `src/data/phrases/hsk-1.json` to `hsk-6.json` plus `index.json` (per band: phrase count and, per word, how many phrases use it). A band file is `{ schemaVersion: 2, band, phrases: [...] }`; the pack points at it through `phrases.bands` / `phrases.index` (`src/core/language/data/zh.ts`, contract in `src/core/phrases/contracts.ts`).

| Band | Phrases | Checked | Look-ahead | With grammar tags | Mean length (Han characters) |
|---|---|---|---|---|---|
| HSK 1 | 1,240 | 1,220 | 178 | 1,216 | 7.2 |
| HSK 2 | 1,032 | 913 | 170 | 954 | 7.4 |
| HSK 3 | 2,126 | 1,899 | 397 | 1,105 | 8.1 |
| HSK 4 | 2,269 | 1,784 | 984 | 695 | 7.7 |
| HSK 5 | 3,909 | 3,582 | 1,949 | 760 | 7.4 |
| HSK 6 | 4,532 | 3,991 | 2,556 | 710 | 7.0 |
| **All** | **15,108** (15,108 distinct by Han text) | **13,389** | 6,234 | 5,440 | |

The brief's 12,925 does not match any count I can reproduce: it is neither the total (15,108) nor the checked count (13,389). It may be an older figure, or the count of phrases ready after some filter; worth knowing before anyone quotes it. Every phrase has source `ai` (the schema also allows `book`, `media`, `user` for later imports and the learner's own phrases).

A phrase: `{ id, zh, py, en, words: [word refs], grammar: [grammar refs], source, checked, lookahead, readyAt }` (Japanese and Korean add `tokens`: the sentence cut into word / grammar / punctuation pieces, so tiles and typed answers can be matched by token). `id` counts within a band and is never reused. `words`/`grammar` list every word and grammar point the phrase uses, so a phrase is filed under each. `readyAt` is the highest lesson (curriculum group) among them, and `lookahead` the generation pass (0 = strict: only what its own lesson teaches; larger numbers allowed words up to that many lessons later). The app shows a phrase as ready only when the learner knows `readyAt`'s words (and for ai phrases the grammar).

### 1.2 How it was made

`scripts/build-phrase-bank.mjs` (1,077 lines; helpers `phrase-bank-files.mjs`, `phrase-bank-load.mjs`; tests `build-phrase-bank*.test.ts`; `retag-phrase-compounds.mjs` fixes compound tags afterwards). Authored YAML under `curriculum/chinese/authoring/phrases/hsk-N.yaml` is the source; the JSON is generated from it (`npm run curriculum:generate` makes the same JSON). Run offline by hand, never in the app build. All batched, no agent loop:

1. **Targets**: every word and grammar point with fewer than 3 strict phrases (authored examples plus phrases in hand whose every word is taught by the target's own lesson). Look-ahead phrases never count towards 3; later passes top up to 1 each.
2. **Look-ahead passes** 0,2,4,8,16 lessons: only targets still short are worked on.
3. **Credit**: phrases in hand count for every word and grammar point they use before anything is written; the writer is told what each target already has.
4. **Plan** (optional): a strong model gives a short spec per phrase.
5. **Write**: a cheap model writes the phrases for a batch (default 20 targets, mixing same or adjacent lessons; the window's vocabulary and grammar listed by lesson, newest first, capped at 300 words) and tags the grammar it really used.
6. **Code validates**: has English, short (at most 12 syllables), only window words plus the always-allowed function characters (`FUNCTION_CHARACTERS`), grammar tags real and in the window; pinyin is set by code (`pinyin-pro`).
7. **Check**: a strong model judges natural Chinese, English that matches, and the grammar tags; a phrase is dropped only when the checker says failed **and** gives a reason; failures are rewritten once and re-checked; if the check call itself fails the phrase is kept with `checked: false` (`--recheck` reruns). That explains the 1,719 unchecked ones.
8. Files are rewritten after every batch; state in `build/phrase-bank/state-v2.json` so a run is resumable. Models and endpoint are options (the header suggests a writer called luna on the Responses API and a checker called sonnet on chat completions, through hexad's gateway), concurrency 32 by default, one session id for the whole run.

"Reviewers verify" (from the brief) is not in the repository as a step; I found no reviewer tooling, only the checker model. I did not look at the earlier runs' logs, so how much human review there was is unknown to me.

### 1.3 Where the app uses it

| Place | What it does with the bank | Chinese only today? |
|---|---|---|
| Dictionary, Phrases section (`pages/Dictionary.tsx`, `components/phrases/PhraseTable.tsx`, `core/phrases/dictionary.ts`) | Table of every phrase: Chinese, pinyin, English, words, grammar, source, ready / pending state ("needs 喝, 水"), heard count, play, "practice this", remove for the learner's own. Scopes all / ready / pending / mine; band filter; search | Headers and cell language are Chinese; the section is switched off for ja/ko (`sections.phrases: false` in `language/dictionary.ts`) |
| Practice sessions (`core/session/sources.ts`, `sentences.ts`, `bank-forms.ts`, `plan.ts`, `word-form-plan.ts`) | Every phrase-based exercise: translate both ways, word-order tiles, gap, listen-and-pick, dictation, repeat. The planner picks, per item, a usable phrase (shortest, all words known), and takes other bank phrases as accepted alternatives and distractors | **No: ja and ko already run on their lesson sentences** |
| Drills content, write queue (`core/drills/content.ts`, `write-queue.ts`) | Sentences for the older drill types and writing practice | Language-neutral |
| Hands-free (`pages/drills/HandsFree.tsx`, `core/handsfree/*`) | See 1.4 | Chinese only |
| Assistant (`components/assistant/AddToPhraseBank.tsx`, `core/phrases/user.ts`, practice chain/playback) | "Add to phrase bank" stores a learner phrase (words split as Learn does, grammar by the matcher, no AI); practice playlists take phrases | Off for ja/ko (assistant area off) |
| Collections, Reading/Library, Media | Phrases gathered from books and shows; "practice this snippet"; practice counts | Off for ja/ko |
| Games (`core/games/potions-phrases.ts`, `sudoku-phrases.ts`, Memory, Mahjong) | Levels dealt from phrases the learner already knows (Potions sorts scrambled words into phrases) | Off for ja/ko |
| Knowledge / study / history (`core/study/*`, `core/ai/check.ts`) | Phrase refs counted in practice history; AI check and local exercises use phrase text | Neutral |
| Heard log (`phraseHeard` table, `recordHeard`, `leastHeard` in `phrases/bank.ts`) | Counts how often each phrase was played, keyed by the Chinese text, so Hands-free rotates least-heard first | Chinese text is the key |

### 1.4 Hands-free today

Hands-free is an **activity of a practice set** (the old `#practice/handsfree/<id>` links redirect to `practice/set/<id>/handsfree`). Two kinds: an **Introduction** (the set's words, a spoken test on them, their bank phrases, a spoken test on the phrases, a mixed review) and a **Recall** (one scrambled pool; each card comes round again 1, 3 and 6 prompts later). A prompt is an English frame spoken by one English voice, then the Chinese, a pause (timed from the measured speech length), then the answer; directions are `toEnglish` and `toChinese` (`core/handsfree/script.ts`, speech locales hard-coded `'en-US' | 'zh-Hans'`). Phrases per word are chosen least-heard first from the usable bank (`core/handsfree/store.ts`). It reports practice counts per item (listening or speaking) but it **belongs to items**: it is built from a set of words and grammar points the learner picked, and cannot be pointed at "phrases in general". It is on for Chinese only (`features.handsFree` is `false` for Japanese and Korean in `language/meta.ts`); turning it on for them needs the locale to stop being hard-coded, which is the Japanese-speech work another session is doing now.

## 2. Japanese and Korean phrases

### 2.1 What exists

| | Japanese | Korean |
|---|---|---|
| Shipped bank | `src/data/packs/ja/phrases-band-1.json`: 822 phrases, 817 checked | `ko/phrases-band-1.json`: 905 phrases, 801 checked |
| Words / grammar points in the pack | 292 / 115 | 300 / 133 |
| Lessons | 87, every lesson has 3 to 21 phrases | 87, 3 to 20 phrases |
| `readyAt` | 1 to 87 | 1 to 87 |
| Source tag | all `ai` (lesson sentences, some added or rewritten by the content gap work: `curriculum/japanese/authoring/pack-added-phrases.json`, `generate-pack-ja.mjs`) | all `ai` |
| Without grammar tags | 12 | 10 |
| Per-word index | 292 words, no grammar index | 300 words |
| Mean length | 11.7 characters | 12.6 characters |
| Starting with a subject pronoun (私は, 저는 ...) | 130 (about 16%) | 80 (about 9%) |
| Questions | 87 | 91 |

The old deleted data: `src/data/parallel/ja.json`, `ko.json` and `glosses.json` (removed in 2c6fd07 with the old parallel screens; `scripts/build-parallel-lessons.mjs` and `curriculum/{japanese,korean}/parallel/` remain). They were the same lesson sentences mapped to the Chinese lessons, so they add no new sentences; I would not bring them back. The lesson sentences are the bank today.

### 2.2 What a Phrases section would show if switched on today

`sections.phrases: true` would list the 822 / 905 lesson sentences with their kana/Hangul reading in the Pinyin column, their words, the grammar tags and ready / pending state by lesson. Things that are wrong or thin:

- Column headers "Chinese" and "Pinyin", `lang=zh-Hans` on the cell (wrong font and reading hints), the Play button and "Play ..." labels speak Chinese. The pack should supply the column names ("Japanese", "Reading"; "Korean", "Pronunciation" or nothing), the language tag and the speech locale.
- Band filter shows HSK bands; the packs have one band ("1") of 87 lessons: it should filter by lesson ranges instead.
- Only about 9 to 10 sentences per lesson, average 3 uses per word: a browsing list, not a bank. 822 sentences for 292 words is under 3 phrases per word, which is the Chinese target for strict phrases alone.
- The reading column of the Korean bank repeats the Hangul (`py` equals `zh`): the reading column should be hidden or show a romanisation.
- Search matches Chinese / toneless pinyin / English; Japanese and Korean search is the pack's own (`searchUnits`, kana and romaji folding) and the phrase search would need to use the same folding.

### 2.3 Proposal: a real bank per app

**Size.** Match the Chinese rule (3 strict phrases per word and grammar point, plus 1 look-ahead) and then check variety per lesson:

- targets: Japanese 292 + 115 = 407; Korean 300 + 133 = 433. Three strict phrases each is about 1,200 to 1,300, of which the lesson sentences already cover part (credit step).
- aim: **about 25 phrases per lesson in total**, i.e. roughly 2,200 (Japanese) and 2,200 (Korean), meaning about **1,400 new for Japanese and 1,300 for Korean** after the existing 822 / 905. Lessons with no new grammar still get 15 to 20, because they carry the practice of earlier grammar. Cap at 18 characters (Japanese) / 6 words (Korean).
- **hard ceiling: lesson 87.** A phrase's `readyAt` must be at most 87. The Chinese pipeline's look-ahead passes (up to 16 lessons later) are set to 0 only for ja/ko: no look-ahead phrases at all; a word taught in lesson 87 can be used with words from 1 to 87. Anything that cannot be written inside the window stays out. A guard in the generator and a data test (every phrase's words and grammar are in lessons <= 87; the same check `generate-pack-ja.mjs` already makes for added phrases) keep it true when the owner later extends past 87.

**Pipeline: reuse, do not copy.** `build-phrase-bank.mjs` has four Chinese-specific parts: pinyin-pro for readings, the Han-character checks (`phraseKey`, `hanCount`, syllable limit), `FUNCTION_CHARACTERS` and the YAML location. Make those a per-language adapter selected with `--language zh|ja|ko`:

| Part | Chinese | Japanese | Korean |
|---|---|---|---|
| Catalog (words, grammar, lessons) | `src/data/v2` | `src/data/packs/ja/band-1.generated.json` (292 words, 115 grammar, 87 groups) | same for ko |
| Window check: every word of the phrase is in the window | Han segmentation against window forms | segment with the pack's tokeniser (`japanese-sentence.ts`, `spellTokens`) against window surface forms and conjugations (`forms.generated.json`) | same, Hangul, particles as tiles (`koSentence`) |
| Free words | function characters | particles and polite endings (`jaPage.functionWords`) | `koPage.functionWords` |
| Reading | pinyin-pro | from tokens' readings (the data already stores a reading per token) | none or revised romanisation |
| Identity (no sentence twice) | Han characters only | `phrase-identity.ts`'s letters-and-numbers rule (the Han rule makes ありがとう and すみません the same sentence, noted in the Japanese practice audit) | same |
| Output | YAML + JSON | `curriculum/japanese/authoring/phrases-band-1.yaml` (new) → the existing `phrases-band-1.json` format with `tokens` | same |
| Calls | 20 targets per call | 20 per call | 20 per call |

The model returns each phrase as a sentence plus its word list and grammar tags; code builds `tokens` from the words (a phrase whose tokens do not cover the sentence is rejected before the checker sees it). The existing Japanese pack generator already works from this format (`generate-pack-ja.mjs` lines 152 to 374 read lesson phrases, check `readyAt` and write the JSON and index), so the new generated phrases should join as another input file there, like `pack-added-phrases.json` does now, and not as a second writer of the same JSON.

**Writer/checker prompts** are language-specific and must say: natural, polite-style sentence at the level of the window; drop the subject where a native speaker would; give the English with a subject; flag an open subject (section 3); do not use words not in the list; mark the grammar tags. The checker is told to fail unnatural subject use (a 私は in every sentence) and English that contradicts the dropped subject.

**Cost and time (estimates).** A batch is 20 targets and the writer returns about 3 phrases per target, so about 60 phrases (3,000 output tokens, 8,000 input with the window list). Japanese needs about 407 / 20 = 21 batches per pass, about 3 effective passes (target 3, top-up to fill 25 per lesson, retries) = about 65 writer calls; the checker takes about 40 phrases per call: about 1,400 / 40 = 35 calls plus about 15 re-checks; so **about 120 calls and well under 2 million tokens per language**, at the gateway's cheap-writer / strong-checker prices a few dollars to low tens of dollars. At concurrency 32 the wall time is minutes per pass; budget 1 to 2 hours per language including a rerun for `--recheck` and reading the report. Korean is the same, plus a Korean spacing check. Real figures should be read from the first pilot run (one lesson range, 1-10) before the full run.

**Human review.** Before shipping, a native-speaker sample is worth more than any model check: 100 random phrases per language, plus every phrase that has a flagged open subject. This is a question for the owner (section 6).

## 3. Subject omission

### 3.1 What the code does today

**Data.** The lesson sentences are already written natural-style. Of the 822 Japanese phrases only 209 contain any subject pronoun (私, あなた, 彼 ...) and 130 begin with one; Korean 221 contain one, 80 begin with one. The English always has a subject, and the writer chose one: for 613 Japanese phrases with no pronoun, 163 English lines still open with I, You, They ... (I 114, They 15, You 13). Same pair in the data: 私は勉強します = "I study." and 勉強します = "You study."; 学生です = "You are a student."; 友達がいます = "They have friends."; Korean 집에 있어요 = "They are at home." and 조금 추워요 = "I feel a little cold." beside 저는 조금 추워요 = the same English. Another subject for the same words is chosen by chance, not by a rule.

**English to Japanese / Korean (typed, tiles, spoken).**
- Korean: `koSentence.optionalWords` (`language/sentence-forms.ts`) marks a leading 저, 나, 제, 내 plus a topic/subject particle as droppable; `gradeJapaneseSentence` then accepts the sentence without it ("Right: 저는 may be left out. The full sentence:"). It only works for a first token that is one of those four, and **only when the sentence in the data has it**: typing 저는 when the data sentence is 학생이에요 is a difference (the extra tokens are not optional).
- Japanese: `jaSentence` has **no** `optionalWords`. So for 私は学生です。 (English "I am a student."), typing 学生です。 is graded wrong, and if the data sentence is 学生です。 typing 私は学生です。 is wrong. Nothing in the Japanese path knows 私は is optional.
- Both: other accepted wordings come from other bank phrases with the same English and word set (`acceptedAnswers` in `session/grade.ts`); with the pairs above the English differs (I / You) so that rescue does not fire.
- Word-order tiles: the tiles are the tokens of the one stored sentence; a dropped or added 私 / 저는 is not offered or accepted as an alternative order, and a stored sentence with 私は gives the learner an extra tile to place that a native speaker would have dropped.
- Dictation: the learner hears the sentence and types what they heard; the subject is audible, so nothing is optional (correct).

**Japanese / Korean to English.** `gradeMeaning` compares the normalised text with the accepted English wordings (the stored English plus other phrases' English for the same sentence); an exact match is correct, a one-edit match is "near", sharing a content word is **self-marked** and anything else is wrong. So for 勉強します (stored "You study.") typing "I study." shares "study" and is sent to self-marking; typing "He studies" is also self-marked. Correct-but-different pronouns never count as right by themselves, and the learner is asked to judge. There is no pronoun equivalence rule for Japanese or Korean (Chinese has `EQUIVALENT_WORDS` for 他 / 她 / 它 and 你 / 您, in `session/grade.ts`).

**Other uses.** The Gap form blanks a word (not the subject by default); Listen-and-pick uses other phrases' English as distractors, so a phrase with "You study." and another "I study." can appear as a near-identical pair of choices; Hands-free reads the stored English, so "You study." is what the learner hears for a subject-less sentence.

### 3.2 Decisions

1. **Write the sentences as a native speaker would.** Keep the subject only when it matters (introductions, contrast, `は`/`는` topics with a point, a person other than the obvious one). No "私は" filler to make the English line up. Expect the bank to be about 80% subject-less for statements; that is the language.
2. **English always has a subject, chosen by the situation the phrase is written for**, not arbitrarily: first person for statements of own action, feeling, wish or plan; second person for questions to the listener and polite invitations; imperative or "Let's" where the Japanese is one. The writer must pick this in its output as a field, `subject`: `speaker | listener | other | open` (open: the sentence is equally right for I, you, he, she, we, they, e.g. 勉強します).
3. **Open phrases carry the extra English.** For an `open` phrase the generator also writes up to three alternative English wordings with other subjects ("I study.", "You study.", "She studies.") and the checker confirms them. That list goes in the data (`enAlt`) and into the accepted English of that phrase; it is exactly the way a bank phrase's English alternatives already work. A phrase that is not open ("私は学生です" in a self-introduction) accepts only its own subject. Do not try to inflect English pronoun swaps by code (verb agreement: study / studies, am / are / is makes it brittle); the model writes them once.
4. **English → Japanese/Korean grading.** Add to `jaSentence` what `koSentence` has and make both general: a subject phrase (a pronoun or a name from the pack's list plus は / が / も; 저/나/제/내 plus 는/은/가/이/도) may be **dropped when typed** (right, with the note "a subject can be left out"), and, when the English prompt names one (I / we), the matching one may be **added at the front** (私は, 私が, わたしは; 저는, 제가, 나는). Added subjects that the English does not support (あなたは for "I am a student.") are a difference and show the closest answer. The set (私 / わたし / 僕 / あなた / 彼 / 彼女 / 私たち; 저 / 나 / 제 / 내 / 우리 / 당신) is a pack table (the same shape as `PARTICLES`), not hard-coded in the grader. Dropping applies to the typed or spoken answer only; tiles keep exactly the stored tiles but, for a phrase that begins with a subject, the leading subject tiles are marked "optional" and are not required (leaving them out is accepted). For consistency with Practice, the Korean rule extends from "first token only" to "first subject phrase".
5. **Japanese / Korean → English grading.** For an `open` phrase the accepted English is its `en` plus `enAlt`; other pronouns are a difference and the closest answer is shown (as a self-mark option, as now). For a non-open phrase the stored English is the one answer, and the self-mark fallback stays for everything else. Add a note under an open phrase's English in all displays: "no subject in Japanese: I / you / he / she / we / they all fit".
6. **Dedupe.** Two phrases that differ only by a leading 私は / 저는 are one sentence for "no sentence twice" and for the Dictionary list (the identity rule should strip the optional subject phrase); when both exist (6 Japanese pairs and 2 Korean pairs today) keep the subject-less one only if its English is open, else keep the explicit one.
7. **Listening and dictation** keep the sentence exactly as written. Hands-free (if later turned on for ja/ko) speaks the English of the stored phrase; for an open phrase speak the first English only.

Existing data fix-up (part of stage 3): the 613 / 684 subject-less phrases get a `subject` classification by one batched model call (about 30 calls of 40 phrases each), the 163 / 200 whose English opens with a pronoun are reviewed first, and the pairs listed above are corrected by hand.

## 4. A free phrase practice

### 4.1 What it should do (plain terms)

The learner opens it, picks a direction (the target language to English, English to the target language, or mixed), and gets one phrase at a time from the bank. They see the prompt, answer, see the right answer and the explanation, and go on. No items to choose, nothing to finish, no list to complete; it can run until they stop. It writes a short history line (how many phrases, how many right, which phrases), and it does **not** schedule reviews, add items to the knowledge set, or change item strengths (the practice counts for the phrase's words are an open question, see 6).

### 4.2 Choices

**How phrases are picked** (a small settings strip above the card, remembered per app):
- *Range*: "everything I have reached" (default: phrases whose words and grammar the learner knows, `usableFor`), a level or a range of lessons, or "only this lesson".
- *Order*: random (default), least-seen first (same idea as the heard log), newest first.
- *Length*: short, medium, long, or any (by the phrase's token count).
- Never repeat the same phrase within a session; a seed for the session keeps it stable on reload (the same way sessions seed their planner).

**How answers are checked** (per card, the learner can change the mode like the existing type / speak / write switch):
- *Self-marked* (default, no typing): see the prompt, press "Show", mark Got it / Missed. Works everywhere, including with open-subject phrases.
- *Typed and graded*: English to target: the existing sentence grading (`gradeSentence` with the subject rules of section 3); target to English: `gradeMeaning` with `enAlt`; "self" results fall through to self-marking.
- *Spoken*: the existing speak mode (speech recognition) where the app already has it for that language.

**What it records.** One history line per run through the existing history and practice-count paths, and a per-phrase "seen / last seen / marked missed count" row, just like the heard log, keyed by the sentence identity of the language (a new small table; the existing `phraseHeard` table is keyed by the Chinese text and would need the language in the key). Nothing is scheduled.

### 4.3 Options

**Option A: its own page, "Phrases" in the Practice area (recommended).** A route `practice/phrases` with a card UI built on the existing exercise components (the same question views the planner feeds, via `buildTranslate` for both directions, so grading, tiles, the speak mode and the accepted-wording logic are shared). A new small planner source "bank at large" feeds it one phrase at a time. All three languages; the page lists in Practice's top section beside the sets. *Build cost*: about 5 to 6 days: a picker (reuses `loadSessionBank`, `usableFor`), a single-card runner using the existing `EngineQuestion`, settings strip, history row, tests.

**Option B: an exercise type inside Practice sets.** A set already has types (translate, tiles, gap ...). Add "Phrases (free)" as a type of every set, drawing from the whole bank instead of the set's items. *Pros*: nothing new to find; one place. *Cons*: sets are built around items and review (marks per item, "done" when every item is done), which is exactly what the owner does not want here; the progress model would need a special case ("a type with no items"); the planner assumes a phrase belongs to a set's item. About 4 to 5 days but more risk.

**Option C: extend Hands-free to take "no items".** Add a third Hands-free kind, "Phrases", that scripts random bank phrases in both directions (spoken English frame, then target, pause, answer), as it already does for the Introduction's phrase sections. *Pros*: it is the listening experience the owner mentioned; the script generator already knows two directions and the bank. *Cons*: Chinese only today, hard-coded speech locales (the Japanese speech work in flight), no typing or marking, so not a "practice" in the graded sense. About 3 days after the speech locale is language-aware, and it can only start then.

**Recommendation: Option A**, with Option C as a later button on the same page ("Listen" mode: the same picker feeding the Hands-free player) once Japanese and Korean speech settles. The page's picker and the card are what B needs anyway, and A does not disturb the set / review model. Hands-free stays what it is: an item-based spoken run.

## 5. Staged plan

Stages are small and each can be published. Dependencies: 1 needs nothing; 2 needs 1 only for display; 3 can start now; 4 needs the Option A engine and benefits from 2 and 3.

| Stage | What a learner sees | Files | Tests | Parallel |
|---|---|---|---|---|
| **1. Phrases section for ja and ko on the lesson sentences** | Dictionary has a Phrases tab: Japanese / Korean sentence, reading, English, words, grammar, ready or pending by lesson, filter by lesson range, search with kana/romaji folding, play in the right language (once speech settles) | `language/dictionary.ts` (`sections.phrases: true` for ja, ko; column labels, language tag, band filter from the pack), `components/phrases/PhraseTable.tsx`, `pages/Dictionary.tsx`, `core/phrases/dictionary.ts` (search and filter), `DictionaryPhrases.test.tsx` | the Dictionary phrase tests run per language (rows, headers, lang tag, search, scope), pack-ja / pack-ko tests | **Yes** (with 3) |
| **2. Phrase generator for ja and ko** | Nothing yet; the data pipeline: a pilot of lessons 1-10 reviewed by a person, then the full run adds about 1,400 phrases (ja) and 1,300 (ko), all ready at or before lesson 87 | `scripts/build-phrase-bank.mjs` (language adapter, `--language`), `phrase-bank-files.mjs`, new authoring YAML under `curriculum/{japanese,korean}/authoring/`, `generate-pack-ja.mjs` / `generate-pack-ko.mjs` read the new phrases, pack data tests | generator unit tests per language (window check, tokens cover the sentence, 87 ceiling, identity), data tests on the shipped JSON (every phrase readyAt <= 87, no duplicate identity, tokens match sentence), a count report | **Yes** (with 1; the content depends on 3's field, so write the field into the schema first) |
| **3. Subject rules** | In Practice, typing 学生です or 私は学生です both pass for "I am a student."; the Japanese-to-English side accepts the pronouns an open phrase allows; the English of subject-less sentences stops flipping between I and You | `language/sentence-forms.ts` (Japanese `optionalWords`, added-subject rule, pack table of subject words), `language/japanese-sentence.ts` (`withoutLeading` generalised, added-subject acceptance), `session/bank-forms.ts` (accepted English from `enAlt`), `phrases/contracts.ts` (`subject`, `enAlt` optional fields), `phrase-identity.ts`, a batch script to classify the existing phrases and fix the pairs | grading unit tests for each combination (drop, add, wrong subject, open phrase, Korean first-token cases), `practice-wording` tests for the notes, a data test that every `open` phrase has at least one alternative | **Yes** (the schema fields are agreed first) |
| **4a. Free phrase practice: page and engine** | A "Phrases" card in Practice for all three apps: both directions, self-marked or typed, range and order choices, history line | `pages/Practice.tsx` / `pages/drills/*` (new `PhraseRun.tsx`), `core/session/*` (bank-at-large source), `core/phrases/seen.ts` (new table + migration in `database.ts`, backup), routing, `areas.ts` | picker tests (range, order, no repeat, usable only), page tests per language, a history test (line written, no review item created), backup round-trip | after 1 and 3 (needs their data and grading); can start with Chinese |
| **4b. Free phrase practice: speak and listen** | Speak-the-answer and (with Hands-free for ja/ko) a "Listen" mode | `EngineQuestion.tsx` speak mode, `core/handsfree/*` | existing speak-mode tests per language | after 4a and the Japanese speech work lands |

**What can run at once**: 1, 2 and 3 are independent (each touches different files; 2 and 3 agree the two new data fields first). 4a follows once 3 has landed and some of 2's data exists. 4b is last.

## 6. Questions for the owner

1. **How many phrases should each app have, and how much should they repeat?** Options: (a) about 1,000 in all, a few per word, quick to produce and review; (b) **about 2,200 each, around 25 per lesson, the same depth the Chinese levels have for their early lessons (recommended)**; (c) around 4,000, closer to Chinese's 15,000 in proportion. Bigger banks mean more review time for you and more storage in the app.
2. **Should the English of a phrase with no subject in Japanese or Korean pick one subject, or accept several?** Options: (a) always one subject and only that is right; (b) **the stored English picks the most natural subject, and phrases that really fit any subject also accept "I / you / he / she / we / they" (recommended)**; (c) accept any subject for every phrase without one. (b) is stricter than (c) for phrases like 私は学生です, which is plainly "I".
3. **When the learner translates English into Japanese or Korean, should a typed 私は or 저는 be accepted when it is not in the stored sentence, and a missing one accepted when it is?** Options: (a) only what is stored, as for Japanese today; (b) **either way is right when the English names the subject, with a small note saying the subject can be left out (recommended: it matches Korean's current rule and what a teacher would say)**; (c) the missing subject is right but an added one is a mistake, to teach that dropping is normal.
4. **Is a native-speaker check wanted before the new phrases ship?** Options: (a) none, rely on the two model passes; (b) **a person reads about 100 random phrases plus the open-subject ones per language and we fix what they find (recommended)**; (c) a person reads every phrase. (b) is about two to three hours per language; (c) is days.
5. **Should the free practice be a page of its own, or a type inside every practice set?** Options: (a) **a page of its own, for all three apps (recommended)**; (b) a type inside sets; (c) a new kind of Hands-free that only listens. (a) does not touch review; (c) can follow later as a Listen button.
6. **Should free practice change how well the learner knows the words in the phrases?** Options: (a) **no: it only writes a history line and counts, nothing else (recommended, it is what you described)**; (b) a miss lowers the strength of that phrase's words a little; (c) a hit and a miss both count like normal practice. (b) and (c) blur the idea of "review of particular items".
7. **Should the Japanese and Korean Phrases section open before the bigger bank is made?** Options: (a) **yes, with the 822 / 905 lesson sentences now, so the tab exists and grows as phrases are added (recommended)**; (b) wait until the bigger bank is ready, one release for the whole thing. (a) shows a short list at first.

## 7. Surprises and things I could not check

- The bank holds 15,108 phrases, not 12,925; 1,719 of them are unchecked (the checker call failed and `--recheck` has not been run on them).
- Hands-free is on for Chinese only, and so are games, the assistant and collections; the brief's "used elsewhere" is mostly Chinese-only.
- Japanese has no rule to drop 私は, though Korean has one for 저는; and the same words carry I / You / They in the English of the same data.
- I did not run the app or any test suite, so the "what a Phrases section would show" description is from reading the code and data, and should be confirmed with a real build in stage 1.
- I found no tooling for "reviewers verify" in the repository; I took the pipeline from the script and its header.
