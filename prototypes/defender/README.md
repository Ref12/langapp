# Word Defender prototype

A standalone, in-memory game experiment. It does **not** add a Games menu item,
read profiles, store scores, modify the curriculum, or ship in the production
app build. Its small original sample deck is in `deck.ts`.

## Run

From the repository root, start the existing Vite server:

```powershell
npm run dev
```

Open `http://localhost:5173/prototypes/defender/index.html` (substitute the server's
actual port). The page uses native DOM, CSS, and TypeScript; no additional
dependencies or provider connection are needed.

Use the **Device preview** link, or open
`http://localhost:5173/prototypes/defender/preview.html?device=mobile`, for a
Desktop/Mobile switch. It reuses the repository's preview shell and resizes the
same iframe without resetting the run, scores, or typed answer. The Mobile
viewport is 390 pixels wide (or narrower if necessary), up to 844 pixels tall.
Opening the preview from the game initially loads a fresh instance.

## Play

- **Tap mode:** incoming words move right to left on desktop and fall toward
  a bottom shield at viewport widths of 600 pixels or less. Tap the leading
  word's translation in the 12-item answer bank (three columns by four rows). All 12 sample words are
  available, keeping their positions for the whole run; choices never highlight
  the right answer automatically.
- **Type mode:** type the translation and press Enter or Defend. Chinese
  IME composition is not submitted on its confirmation keystroke.
- **Direction:** choose Chinese → English, English → Chinese,
  Chinese → Pinyin, or Pinyin → Chinese. Both tap and typing support every
  direction.
- **Optional annotations:** enable **Show pinyin over Chinese words** for
  Chinese ↔ English. It annotates incoming Chinese or the Chinese answer
  bank, never the English choices. The toggle starts off and is disabled in
  pronunciation-matching modes so the answer is not printed on the character.
  Switching back to a meaning mode restores the checkbox's prior preference.
- **Pressure:** the first word is immediate. Every 20 seconds raises the wave:
  shorter spawn intervals and faster new words. Up to eight incoming words
  can coexist across four lanes; lane spacing is enforced.
  Lane progress is normalized, so device resizing changes the direction of
  travel without changing a word's remaining travel time or the game rules.
- **Defending:** only the highlighted **TARGET**, the word closest to the
  shield across all lanes, can be matched. Equal positions are ordered by
  arrival ID. Answering a later word counts as incorrect, even when it is
  visible. A hit removes exactly one leading word and promotes the next target;
  repeated copies need separate answers. Answers while no words are present
  are ignored. Correct answers earn 100 points plus a capped streak bonus.
  Incorrect answers break the streak but cost no shield.
- **Breaches:** each word crossing the line costs one of five shields.
  The run ends at zero shields and lists the missed words for review.
- **Pause:** use Pause or Escape. Hidden tabs pause automatically, and an
  interrupted animation frame pauses rather than jumping words across the line.
  Resume is explicit. End run is available while paused.
- **Replay:** Play again creates a fresh shuffled 12-word bank. Change setup
  returns to the mode, direction, and pace controls.

English answers accept only the displayed meaning and explicit alternatives in
`englishAnswers`, with Unicode normalization, case folding, whitespace
normalization, and trailing sentence-punctuation removal. No fuzzy matching,
AI grading, or inferred synonyms. Pinyin answers accept the source tone-marked
spelling (`míng tiān`, `míngtiān`) or numbered syllables (`ming2 tian1`,
`ming2tian1`), with neutral tones omitted or written `0` or `5`. Case, spacing,
and apostrophe separators are ignored; tones are not discarded. `ü`, `u:`, and
`v` are equivalent keyboard spellings for the umlaut vowel. Bare toneless
answers are not accepted for toned words. Chinese answers still require the
actual characters. Source `pinyin` in `deck.ts` must separate syllables with
spaces and use tone-marked spelling, which allows numbered answers to be
derived without guessing word boundaries. Ambiguous prompt/answer forms are
rejected. The briefing/deck is unavailable during a run.

## Spoken-mode seam

`submitTranslation(run, text)` is the common boundary used by tap and typed input.
A future speech UI can pass a reviewed transcript through that same boundary.
This prototype does not request microphone permission, record, synthesize
speech, contact speech services, or pretend voice input is implemented.

## Validation

```powershell
npm test -- prototypes\defender
npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --strict --skipLibCheck prototypes\defender\game.ts prototypes\defender\main.ts prototypes\defender\preview.ts prototypes\defender\game.test.ts prototypes\defender\main.test.ts prototypes\defender\preview.test.ts
npx eslint prototypes\defender
```

The engine tests cover both modes and all four directions, tone-aware pinyin
normalization, duplicate
targets, wrong answers, pauses, shield loss, game over, seed reproducibility,
frame-rate behavior, and multiple simultaneous words as pace ramps. Targeting
tests cover leader-only matching, tie-breaking, overtaking, breaches, and
duplicate copies in both input modes.
The DOM integration check covers both controls, pause/resume, end-of-run flow,
tab hiding, Chinese IME-safe submission, annotation rendering, and suppression
of pronunciation hints in pinyin-matching modes.

This is a mechanic prototype, not a validated learning assessment. Integration
with the real knowledge set, persistent progress, spoken input, and calibrated
difficulty are intentionally deferred.
