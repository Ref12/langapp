# Programs

Status: **draft** (2026-11-01). Hands-free is the first program to be built. The other programs below are still ideas.

A program is an ordered flow over one item set. It may use the Practice drill types, or it may be its own kind of screen, as Hands-free is. Practice (formerly Drills) stays as it is: free choice of any drill type, in any order. Programs are a layer on top.

"Programs" replaces the earlier working name "courses", which reads as a teaching course. The user's plan is to build the programs they would use first, and generalise later.

## Item set

The words, grammar patterns and characters a program works on. It comes from the same sources as a practice set:
- New items or Reviews (with Learning from). The **What you'll practise** panel at the top of Practice home is the one place this is chosen: source, New items / Reviews, how many, a live summary of the actual selection ("7 items · 5 words, 2 grammar · 1 lesson · 4 new characters", or "10 of 22 due") and **View items** (a dialog with the lesson intro cards and the list). Start (practice set) and Start (Hands-free) both use exactly that selection. **New items** counts items, words and grammar patterns together, as a minimum: whole curriculum lessons are added in order until at least N items are held, and a lesson is never split (so the set can run over N). Chips 5/10/15/20, typed 1–20, default 5. **Reviews** caps the due items at N (default 10). Each mode remembers its own count. Practice by skill keeps its own skill, size and strategy and is separate from the selection;
- a study set;
- a past lesson or practice set from History.

Anything said here about introducing new items applies to review items too. Only the defaults differ.

## 1. Hands-free (built first)

A listen-and-answer audio program for when your hands and eyes are busy: walking, commuting, phone in the pocket. It works like the old-style audio courses. There is no reading or writing; those belong to sit-down programs.

The pattern is always the same: **prompt → pause (you answer aloud) → the answer is spoken → pause (you repeat it)**. Nothing is tapped or graded. You hear the answer whether or not you got it.

### Flow

A run opens on the **intro cards** (the same cards a lesson uses for new items) with a compact list of every item, then **Start listening**, which is always visible. A run that has already started goes straight to the player, with an **Items** button to see the cards again.

**Settings** is a button inside the player (next to Pocket mode) that opens a sheet on phones and a popover on desktop with every Hands-free setting. A changed setting applies from the **next prompt** of the run in progress: the script is rebuilt, the current prompt is found again in it by phase, item and direction, and playback carries on from there with the new script. Settings → Hands-free keeps the defaults for new runs.

**Section introductions** (a setting, on by default): at the start of each section the frame voice says what is coming and what you do ("In the following section you will hear the English meaning followed by its Mandarin equivalent. Repeat the Mandarin, building up to the full phrase."), and the same text shows on screen as the header until the first prompt.

**Explain each item** (a setting, on by default): the wording around each item. Off, the intro is the gloss then the Mandarin structure, recall is just the gloss, and Chinese → English is just the Chinese. Descriptive items keep their explanation sentence. Nothing that has no letters or Chinese characters is ever spoken (no "?" or ":" read aloud).

The English key word is split from its frame so it stands out: "This is how you say" (frame voice) → short gap (300 ms) → **the gloss** (emphasis voice, slower) → gap → "in Mandarin" (punctuation is trimmed off the frame pieces, so "?" and ":" are never read out). Recall is "How do you say" → **gloss**. Descriptive explanations ("It's a sentence ending for…") use the emphasis voice too.

Every word and sentence is repeated the same way: **the whole phrase → pause; the build-up from the end (only for 3+ syllables), each step → pause; then the whole phrase again at normal speed**, until the **Repeats** setting is reached (whole-phrase repeat-afters in total, the first included; 1–5, default 3).

1. **Introduce each word, in order**, with the structure above. After each new word, recall the previous one once: "And how do you say *work*?" → pause → answer. (The user liked this; keep it.)
2. **Recall in order.**
   - English → Chinese for every word: "How do you say *rest*?" → pause → answer → pause to repeat.
3. **Recall scrambled, both directions.**
   - English → Chinese and Chinese → English, mixed, in random order.
   - A word comes back after 1, then 3, then 6 other prompts, so recall is spaced out.
4. **Grammar pattern** (when the set has one).
   - "This is how you say *I'm resting at home* in Mandarin:", then the sentence with the same whole, build-up, repeats structure.
   - Then it is recalled like a word: "How do you say *I'm resting at home*?"
   - Sentences come from the catalog examples for the pattern. AI-made substitution prompts ("Now say *I'm working at home*") are a later step.
5. **Mixed round.** Words and sentences together, scrambled, both directions. This ends the run.

When a run whose source was New items (or a study set's new items) **reaches the end**, its items join the knowledge set, as a lesson's do, and the finish screen says "Added 5 words and 1 grammar pattern to your knowledge set". An abandoned run adds nothing, and **Again** on a completed run adds nothing twice.

### Pauses

Each pause is sized to the text you have to say, in syllables for Chinese and words for English: about **2× the spoken length plus a gap**. At Normal and Chinese speed 0.85 that is about 3.5 s for a two-syllable word and 7.5 s for a six-syllable sentence (500 ms per syllable, 1.5 s gap); at the default half speed it is about 4.9 s and 10.7 s. The estimate is slower-aware: slower Chinese speech gets longer pauses. After model text, the player also times how long it actually took to speak and waits whichever is longer, that time × 2 or the estimate. Short, Normal and Long scale the 2× part by 0.7, 1 and 1.4 and use gaps of 0.8 s, 1.5 s and 2.6 s.

### Settings

- **Pause length:** Short, Normal or Long (above).
- **Repeats** of each word and sentence: 1 to 5, default 3.
- **Include grammar:** on or off.
- **Section introductions** and **Explain each item** (above), on the Hands-free page and in Settings.
- **Frame voice** (English), **Emphasis voice** (English; by default a different English voice from the frame voice, where the device has one), **Emphasis speed** (default 0.8×), **Chinese voice** and **Chinese speed** (default **0.5**, half speed; the whole phrase, the build-up and the repeats all use it as set, and pauses lengthen with it). An unset voice follows the saved voice for its language (Settings → Voices). They are shown on the Hands-free page and in Settings → Hands-free (the defaults a new run starts with), using the same pickers as Settings → Voices.

### Screen

- A player screen with:
  - play/pause, back and skip;
  - progress ("Introducing 3 of 8", "Recall 12 of 30");
  - the current prompt in large text, for a glance. The answer is not shown early: the question and your pause show only the prompt (English for English → Chinese, characters for Chinese → English). When a Chinese segment starts, its **characters are shown large with pinyin under them**; when the English answer to a Chinese prompt starts, the English appears.
- **Pocket mode** is the same display full screen on a dark background. It keeps the screen awake and ignores taps. **Hold anywhere for 3 seconds to exit**: a ring fills round a 3 → 2 → 1 count, and letting go early cancels it. The first version keeps the screen on, because browser speech is likely to stop when the screen locks. Real screen-off playback would need the run rendered to audio ahead of time; that is a later step.
- The run gets a History entry (its word list) with **Again** to replay it. An unfinished run shows under **Unfinished sets** on Practice home in the same row pattern as practice sets: title and a meta line ("Hands-free · 6 items · stopped at prompt 5") on the left, a → Resume icon button (at the saved prompt) and a trash icon button on the right. Discard asks on its own line under the meta ("Discard this set?" with Discard and Keep).

### Grading

None in the first version: answers are spoken aloud and nothing hears them. Grading options for later:
- speech recognition of the answer;
- a headset button that marks the last prompt as missed (needs rendered audio for media-session controls);
- a short tap-through after the run ("which did you miss?").

## Sit-down programs (ideas, not built)

These use the Practice drill types in order. Each step is one drill type in **teach** mode (answer shown, ungraded) or **test** mode (recall, graded on the first pass).

- **Learn new items:** intro cards → Write it (teach: whole word in context, characters, pinyin and meaning visible, guided strokes) → Word meanings (choose, both directions) → Match pairs → Word meanings (type, graded) → optional Write it (test).
- **Review:** Word meanings (type, quiz) → Write it (test, characters shuffled) → Say the pinyin → re-teach whatever was missed.
- **Review, then relearn:** like Review, but misses go into a Learn new items run of their own.

A program can be declarative JSON: steps with item selectors such as `missedIn`. That way it can be validated, resumed, backed up and generated by the AI.

```json
{
  "name": "Quiz, then fix what I missed",
  "steps": [
    { "id": "quiz", "drill": "meanings", "mode": "test", "style": "type", "format": "quiz" },
    { "drill": "intro", "items": { "missedIn": "quiz" } },
    { "drill": "write", "mode": "teach", "items": { "missedIn": "quiz" } }
  ]
}
```

## Open questions

- **Quiz as a top-level thing.** The user sees quiz as a thing of its own rather than a mode of the drill types. Where it lives is not decided.
- **Relation to lessons.** Programs, together with History practice, may replace lessons. Not decided.
- **Screen-off audio.** This decides whether Hands-free needs rendered audio (a TTS service) instead of browser speech.
