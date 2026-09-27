# Phrase practice prototype

A standalone UI experiment for iterating before app integration. No changes to
the main app, profiles, conversation drafts, saved playlists, or learning progress.
Opening the dialog is silent. Two original, hand-segmented sample phrases are
defined in `player.ts`; arbitrary input and editing word boundaries are deferred.

## Run

Use the existing Vite server (`npm run dev`) and open
`http://localhost:5173/prototypes/phrase-practice/preview.html?device=mobile`
(substitute its actual port). Desktop/Mobile resizes the same iframe without
restarting practice. `index.html` opens the standalone dialog directly.

## Interaction

- **Word by word:** each sample word separately, in sentence order.
- **Whole phrase:** the complete phrase as one step.
- **Build from start / end:** cumulative prefixes or suffixes, preserving word order.
- **Speech speed -/+** and **Repeat pause -/+** work in every mode, including during
  playback. Speech changes apply to the next utterance; pause changes apply to the
  next response interval. Current speech and an already-started response pause
  are not interrupted. Pauses are remembered separately per mode during the visit.
- **Loop** starts on; **Auto-ramp** starts off. Each completed loop with Auto-ramp
  enabled adds 0.05x to speech speed and subtracts 0.25 seconds from the response
  pause, bounded by limits in **Practice options** (initially 1x and 0.75 seconds).
  It never slows a manually selected higher rate or lengthens a shorter pause.
  At the limits it keeps looping unchanged. Auto-ramp is inactive without Loop.
- A response countdown begins only after speech actually finishes. This is
  listen-and-repeat, not microphone detection or assessment.
- **Pause / Resume** restarts the current step. Selecting a word, changing mode,
  or using Previous/Next pauses without immediately speaking; Play is explicit.
  Changing sample or mode restarts the round. Closing, hiding the page, or
  navigating stops playback; reopening and returning do not autoplay.
- **Practice options** contains sample selection, pinyin/meaning visibility,
  acceleration limits, and explanatory/privacy text. Recording, persisted edits,
  and the main app's custom playlist editor are deliberately not in this mockup.

The isolated player reuses the existing browser speech service (including its
native cold-start protection and error handling), without reading saved voice
settings. Automatic prefers installed Mandarin voices; a browser/system voice
may be online. No microphone or AI request is made. Speed is a browser synthesis
request, not a guarantee of identical acoustic timing across voices.

## Validation

```powershell
npm test -- prototypes\phrase-practice
npx eslint prototypes\phrase-practice
npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --types vite/client --strict --skipLibCheck --allowJs prototypes\phrase-practice\main.ts prototypes\phrase-practice\preview.ts prototypes\phrase-practice\player.test.ts prototypes\phrase-practice\main.test.ts
```
