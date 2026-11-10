# Japanese Practice, stage D follow-up: four small faults

Branch `langapp/ja-stage-d-fixes`, from public main `824e1c6e`.

## 1. Double full stop
The two places that join the notes of a result into a sentence (`EngineQuestion.tsx`, the "Not the model answer." line and the "Differences:" line) added a full stop after notes that already end in one.
They now use `joinNotes` (`src/core/language/note-text.ts`): one stop at the end, for every language. Pinned in `note-text.test.ts` and, on the screen text of a real wrong-particle answer, in `EngineJapanese.test.tsx`.

## 2. Fill the gap: options of mixed kinds
**Cause.** The pack's `blank` took wrong options "of the same kind", and the kind of a word is its conjugation class. Nouns, pronouns and set phrases all have no class in the Japanese data, so ありがとう, 大丈夫です and すみません were the same "no-class" kind as 先生 and 中国語. Nothing told a whole expression from a word, and the ordering only looked at level band and length.
**Fix.** The bank marks a word as a *set phrase* when some bank sentence consists of that word alone (ありがとう, 大丈夫です, すみません, さようなら, どういたしまして). `blankJapanese` (Japanese and Korean share it) ranks the candidates by `gapTier`: the answer's own kind first, then the nearest kinds (a word with no class counts as a noun or pronoun; then na-adjectives, i-adjectives, verbs), a set phrase last for a single-word gap and a single word last for a set-phrase gap. A word with a conjugation class keeps the old rule (same kind, same form). Tests on real lesson 1 to 4 data for both sentences, on eleven shuffle seeds.

## 3. Word order: the wrong reason
When the placed tiles are exactly the answer's tiles in another order, the note is now "All the words are there, but the order is different." (`ORDER_NOTE` in `tiles-grade.ts`, which replaces the older "The words are right but the order is not."). The particle note is only for a particle that is missing, extra or swapped for another. Chinese does not use `gradeTiles`, so its output is unchanged. Tests: reversed order, another order, swapped particle (は for が), missing particle.

## 4. Do the kind boxes narrow a set?
Yes, but with one rule, the same for Chinese and Japanese (`presetFromCustom` and `planSession` in `src/core/session`, no pack involved): a form is used only in the stages it suits, and an item the learner does **not know yet** never gets a Dictation or an English-to-target question: `plan.ts` turns every form that produces the learned language into Word order for a new item. So ticking only Dictation or only Translate on a new-items set gives Word order, in both languages. Pinned for zh and ja in `preset-kinds.test.ts` (new items: Word order; known items: Dictation / typed question).
**How a learner reaches them.** On items already known: Dictation ("Type what you hear") is in the Produce and Use stages of Practice sets for words they know (a set made from the Reading skill, from a lesson, or a review set), and in the Writing, Listening skill presets. The typed English-to-Japanese question ("Translate into Japanese") is in the Produce stage of the Default preset and of Writing, in Use, and in Writing and Speaking. A new-items set only ever teaches them as Word order. Nothing changed.

## Screenshots
`images/2026-11-10-ja-stage-d-fixes/`, 430 px, `fonts-noto-cjk` installed (the Japanese is real glyphs, not boxes).
- `dictation-before.png`: a Dictation question ("Type what you hear") reached in a set of known words (Practice, set from the Reading skill, Produce stage).
- `dictation-after.png`: the answer typed in kana. **Not the wanted shot**: the sentence is drawn at random and the kana I typed were those of another sentence from an earlier attempt, so this shows the wrong-answer feedback ("Closest answer: あなたは"), not the right-answer result with the sentence as written. After three attempts I stopped, as asked. The kana-accepted result with the sentence as written is covered by the tests in `ja-sentence-forms.test.ts`.
- The headless browser cannot play speech ("System speech could not be played"), so the sentence could not be heard to type it.
