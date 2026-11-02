# Programs

Status: **draft** (2026-11-01). Hands-free is the first program to be built, and is now an **activity of a practice set** (see "Practice sets" below). The other programs below are still ideas.

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

The Hands-free button on Practice home creates a practice set from the current selection (a **Hands-free-only set**, `shortcut: 'handsfree'`) and opens it straight on its Hands-free activity at `#practice/set/<id>/handsfree`. Any other set reaches the same activity from its own page. A run opens on the **intro cards** (the same cards a lesson uses for new items) under a count heading ("6 items"), with no separate list of every item above them, then **Start listening**, which is always visible. A run that has already started goes straight to the player, with an **Items** button to see the cards again.

**Settings** is a button inside the player (next to Pocket mode) that opens a sheet on phones and a popover on desktop with every Hands-free setting. A changed setting applies from the **next prompt** of the run in progress: the script is rebuilt, the current prompt is found again in it by phase, item and direction, and playback carries on from there with the new script. Settings → Hands-free keeps the defaults for new runs.

**Section introductions** (Full, Header only or Off; default Full): the start of each section has a short header of 2 to 4 words: "Introducing new words", "Recall in order", "Mixed-order recall", "Grammar patterns", "Final mix". Full speaks the header and then what the section contains and what you do ("You'll hear the English, then the Mandarin. Repeat the Mandarin, building up to the full phrase."); Header only speaks just the header; Off says nothing. The screen always shows the short header until the first prompt, with the description under it in Full. A saved preference such as Header only is simply remembered like any other setting.

**Wording around each item** (Full, Abridged or Off; default Full). Full: "This is how you say, rest. As in, let's rest. In Mandarin." (one utterance), then the Chinese. The "as in" example is the shortest English translation of a curriculum example that uses the word (every vocabulary word is in at least one), preferring an example in the word's own group and then any group; it is left out when there is none or it is longer than 8 words. Abridged: "English, rest. Mandarin.", then the Chinese; recall is "English, rest."; Chinese → English is the Chinese alone; descriptive items are "Here's" the Chinese and the first clause of the explanation. Off: the bare gloss, then the Chinese; descriptive items keep their explanation sentence. Abridged and Off never add an example, recall prompts and grammar sentences never do either. Nothing that has no letters or Chinese characters is ever spoken (no "?" or ":" read aloud). Saved Explain and Section introductions switches become Full (on) or Off.

**One utterance per frame.** Browser speech cannot change speed or volume inside one utterance and SSML is not reliable (Chrome ignores it, some Android engines read the tags aloud), and each separate utterance makes the voice wind up again, which sounds unnatural. So the frame and the English word are one utterance, "This is how you say, rest. In Mandarin." or "How do you say, rest?", in the one English voice, and the commas and full stops make the pauses that bring the word out. (Commas and full stops give a clear, short pause in Chrome; an ellipsis is read inconsistently, and a lone "?" or ":" piece is read aloud, so there are none.) **Emphasise the English word** (a setting) has two choices: **Pauses only** (default), or **Slower and louder**, which speaks the word as its own utterance in the same voice, at the Emphasis speed (default 0.8×) and full volume while the frame around it is at about 0.8; this adds a short start-up delay for each item. The English answer to a Chinese prompt and descriptive explanations are spoken the same way. There is no separate emphasis voice; an old saved one is ignored.

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

When the Hands-free activity **reaches the end** it is done, and the set's New items join the knowledge set if no other activity of the set has introduced them yet (see below); the finish screen says "Added 5 words and 1 grammar pattern to your knowledge set". A Hands-free-only set is also finished by it; in a regular set the set stays open for its other activities. Stopping part-way leaves the set unfinished at its saved prompt. **Play again** restarts the activity in a new order and adds nothing twice. A discarded set adds nothing.

### Pauses

Each pause is sized to the text you have to say, in syllables for Chinese and words for English: about **2× the spoken length plus a gap**. At Normal and Chinese speed 0.85 that is about 3.5 s for a two-syllable word and 7.5 s for a six-syllable sentence (500 ms per syllable, 1.5 s gap); at the default half speed it is about 4.9 s and 10.7 s. The estimate is slower-aware: slower Chinese speech gets longer pauses. After model text, the player also times how long it actually took to speak and waits whichever is longer, that time × 2 or the estimate. Short, Normal and Long scale the 2× part by 0.7, 1 and 1.4 and use gaps of 0.8 s, 1.5 s and 2.6 s.

### Settings

- **Pause length:** Short, Normal or Long (above).
- **Repeats** of each word and sentence: 1 to 5, default 3.
- **Wording around each item**, **Section introductions** and **Emphasise the English word** (above), on the Hands-free page and in Settings. Grammar is not a setting: the lesson decides. Grammar patterns in the set are always included, and the Grammar section runs whenever the set has a pattern with a catalog example sentence. A stored old grammar flag is ignored.
- **English voice** (the frame and the English word; unset follows the saved English voice, Settings → Voices), **Emphasis speed** (default 0.8×; shown only for Slower and louder), **Chinese voice** and **Chinese speed** (default **0.5**, half speed; the whole phrase, the build-up and the repeats all use it as set, and pauses lengthen with it). An unset voice follows the saved voice for its language (Settings → Voices). They are shown on the Hands-free page and in Settings → Hands-free (the defaults a new run starts with), using the same pickers as Settings → Voices.

### Screen

- A player screen with:
  - play/pause, back and skip;
  - progress ("Introducing 3 of 8", "Recall 12 of 30");
  - the current prompt in large text, for a glance. The answer is not shown early: the question and your pause show only the prompt (English for English → Chinese, characters for Chinese → English). When a Chinese segment starts, its **characters are shown large with pinyin under them**; when the English answer to a Chinese prompt starts, the English appears.
- **Pocket mode** is the same display full screen on a dark background. It keeps the screen awake and ignores taps. **Hold anywhere for 3 seconds to exit**: a ring fills round a 3 → 2 → 1 count, and letting go early cancels it. The first version keeps the screen on, because browser speech is likely to stop when the screen locks. Real screen-off playback would need the run rendered to audio ahead of time; that is a later step.
- The set gets a History entry (its word list, chip Hands-free for a Hands-free-only set, Stopped while part-way) with Resume at the saved prompt. An old link `#practice/handsfree/<run id>` redirects to `#practice/set/<id>/handsfree`; runs saved before keep their id (see Migration).

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

## Practice sets: activities, introduced on first finish, Recent sets, revoking

- **A set holds items and activities.** The drill types and Hands-free are activities of a set. Hands-free is stored as the set's `handsfree` activity (seed, settings, started, position, done), not as a table of its own. The top-level Hands-free shortcut makes a Hands-free-only set from the selection and opens it directly.
- **New items join the knowledge set when the first activity of the set is finished**, not when it is created or started: a drill type with every item answered, or Hands-free reaching its end (or Finish set, if nothing else did). Lessons work the same way: a New lesson records `addOnFinish` and adds its items when the lesson is completed; the next group is still chosen past the items of lessons under way. The set records its items (`addOnFinish`; `promote` for a study set's items) and the introduction adds them once, recording what it really added in `addedRefs` (items already known are never in it). A discarded or set-aside set adds nothing; a second activity finishing adds nothing twice. Reviews and the other set kinds never add. Lessons from before the rule (no `addOnFinish`) added at their start and are left as they were.
- **Remove from knowledge set** (`removeRunFromKnowledge` in `core/study/knowledge.ts`) takes back what one lesson or set added, never what was known before it, in one transaction: the knowledge entries and their study cards go, and a journal `remove` event is written per item. Attempts, History and skill counts stay. For runs without `addedRefs` the added items are worked out from the knowledge entries within a few seconds of the run's start (old lessons, sets) or completion (lessons under the finish rule). An unfinished lesson or set has added nothing yet.
- **Migration.** Database version 23 turns each saved Hands-free run into a set with the **same id**, carrying its settings, seed, position, completion, `practiced` pairs and `addedRefs`: a completed run is a completed set, one stopped part-way is an unfinished set that resumes at its saved prompt, one set aside or never started stays out of Unfinished (and a never-started one out of History). Backups from before (a `handsfreeRuns` list) are converted the same way when restored, and new backups carry the sets only.
- **Recent sets** is the one list on Practice home (there is no separate Unfinished sets list). It holds **every unfinished set plus the last 10 finished ones**, ordered by last activity (`updatedAt`), in one row layout: title (with a small **In progress** tag when unfinished) and a meta line on the left; on the right the main icon button, **Save to study set**, and a **⋯** menu. Unfinished rows show their progress in the meta ("3 of 9 types done", Hands-free counted as a type, or "Hands-free · 6 words · stopped at prompt 5") and the main button is **Resume** (→, at the saved prompt; a Hands-free-only set resumes in its Hands-free activity). Finished rows show "Practice set · 6 items · 2 of 9 types done · 30 Oct" and the main button is **Open**, which lands on the set page (heading "Finished", a **Summary** button to the summary route; every type, Hands-free included, can still be started; results record as usual without reopening the set or adding to the knowledge set again). Hands-free is the first row of "Pick a practice type" (Start / Continue at prompt N); when done it sits in Done as "Played to the end" with **Play again** The ⋯ menu holds **Discard** on an unfinished row (a ConfirmDialog: "Discard this set?", Cancel and Discard, focus on Cancel) or **Remove from knowledge set** on a finished one that added something (a ConfirmDialog). The cap of 8 unfinished sets stays, with its note: starting another sets the oldest untouched one aside.
- The Remove from knowledge set action also sits on lesson and set rows in History. It asks first: "Remove 5 words and 1 grammar pattern from your knowledge set? Their reviews go too; your practice history stays." It is hidden when the run added nothing or all of it is already removed.

## History (pagination, removal, practising from a row)

- History is paged, 30 rows a page, newest first, grouped under Today / Yesterday / dates. The filter and page live in the hash (`#history?f=lessons&p=3`), so Back returns to the same page.
- **Remove from history** (the ⋯ menu, or Select mode with checkboxes) is a soft delete: `removedAt` is stamped on the practiceHistory entry, exercise session, drill set (a Hands-free-only set included). It never touches the knowledge set, cards, review schedule, practice counts or attempts. Undo clears it. `removedAt` is part of backups. Removed sets also leave Recent sets.
- Lesson rows offer Open, Practice and Save to study set (the Save menu, with every ref of the row); set rows (Hands-free-only sets too) offer Practice and Save to study set, plus Resume while unfinished. Lesson and set rows that added items also offer Remove from knowledge set (with a confirmation dialog); History's own soft remove has Undo and needs none.
- **Practice** goes to Practice home with the panel pre-filled, not to a set: `#practice?from=lesson:<id>` (or `drill:<id>`; an old `handsfree:<id>` still resolves). "Learning from" shows "Lesson · 30 Oct" while it applies, mode is Reviews, and the count has an All chip (default). Start and Hands-free Start then use exactly those items.
