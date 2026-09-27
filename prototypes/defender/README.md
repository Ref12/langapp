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

## Play

- **Tap mode:** incoming words move from right to left. Tap the matching
  translation in the six-word answer bank. Choices keep their positions for
  the whole run and never highlight the right answer automatically.
- **Type mode:** type the translation and press Enter or Defend. Chinese
  IME composition is not submitted on its confirmation keystroke.
- **Direction:** Chinese prompts require English answers; English prompts
  require Chinese characters. Pinyin is reference information, not an answer.
- **Pressure:** the first word is immediate. Every 20 seconds raises the wave:
  shorter spawn intervals and faster new words. Up to eight incoming words
  can coexist across four lanes; lane spacing is enforced.
- **Defending:** an answer clears the matching word nearest the shield.
  Repeated copies need separate answers. Correct answers earn 100 points plus
  a capped streak bonus. Incorrect answers break the streak but cost no shield.
- **Breaches:** each word crossing the line costs one of five shields.
  The run ends at zero shields and lists the missed words for review.
- **Pause:** use Pause or Escape. Hidden tabs pause automatically, and an
  interrupted animation frame pauses rather than jumping words across the line.
  Resume is explicit. End run is available while paused.
- **Replay:** Play again creates a fresh shuffled six-word deck. Change setup
  returns to the mode, direction, and pace controls.

English answers accept only the displayed meaning and explicit alternatives in
`englishAnswers`, with Unicode normalization, case folding, whitespace
normalization, and trailing sentence-punctuation removal. No fuzzy matching,
AI grading, or inferred synonyms. The briefing/deck is unavailable during a run.

## Spoken-mode seam

`submitTranslation(run, text)` is the common boundary used by tap and typed input.
A future speech UI can pass a reviewed transcript through that same boundary.
This prototype does not request microphone permission, record, synthesize
speech, contact speech services, or pretend voice input is implemented.

## Validation

```powershell
npm test -- prototypes\defender
npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --strict --skipLibCheck prototypes\defender\game.ts prototypes\defender\main.ts prototypes\defender\game.test.ts prototypes\defender\main.test.ts
npx eslint prototypes\defender
```

The engine tests cover both modes and directions, answer normalization, duplicate
targets, wrong answers, pauses, shield loss, game over, seed reproducibility,
frame-rate behavior, and multiple simultaneous words as pace ramps.
The DOM integration check covers both controls, pause/resume, end-of-run flow,
tab hiding, and Chinese IME-safe submission.

This is a mechanic prototype, not a validated learning assessment. Integration
with the real knowledge set, persistent progress, spoken input, and calibrated
difficulty are intentionally deferred.
