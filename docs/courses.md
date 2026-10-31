# Courses

Status: **draft for discussion** (2026-10-31). Nothing here is built yet. Drills is built. A course is an ordered program of drill steps run over one item set.

## Why

Drills lets you pick any drill type in any order. That is good for practice, but it leaves the sequencing to the learner every time. After using Drills, the user put it this way: "you need maybe something I would call courses or programs, where this is an ordered set of drills".

A course encodes a learning flow once:
- introduce, then build the association, then recall;
- or review, then re-teach what was missed.

In many ways it is what a lesson tries to be, but it is built from drill steps the learner already knows.

## Concepts

- **Item set.** The words, grammar patterns and characters being worked on. It comes from the same sources as a drill set: New items, Reviews, a study set, a past lesson or drill.
- **Step.** One drill type run in one mode over a subset of the item set. A step has:
  - `drill`: the drill type (intro cards, write, meanings, match, pinyin, translate, repeat, listen, read);
  - `mode`: **teach** (the answer is shown; ungraded) or **test** (recall; graded on the first pass);
  - `style` and `format`: for example meanings `choose` or `type`; `one-at-a-time` or `quiz`;
  - `items`: which items the step covers. This is `all` by default, or a selector over earlier steps, e.g. `missedIn: "quiz"`, `new`, or `notYetWritten`.
- **Course.** A named, ordered list of steps (a template).
- **Course run.** A course applied to an item set. It is a drill set with a plan:
  - it shows on Drills home and in History like any drill set, with resume and discard;
  - its steps appear in order on the set screen;
  - the learner can still jump to any step or run a free drill on the same items.

## Teach mode vs test mode

The same drill types serve both purposes. Only what is shown, and whether it is graded, changes.

| Drill | Teach (introduce) | Test (recall) |
|---|---|---|
| Write it | Whole word, in order, never scrambled. Characters, pinyin and meaning are all visible. Guided strokes: watch, trace, then write. | Characters shuffled across words. Pinyin-only cue with the target syllable accented. Pad or Write elsewhere. |
| Word meanings | Choose (multiple choice): low load while the association forms. | Type the meaning. The auto-check verdict is pre-selected, and the learner confirms or overrides it with Got it / Needed a hint / Missed. |
| Match pairs | Consolidation across several words at once. | (Same; it is rarely a strong test.) |
| Say the pinyin | Hear and see the pinyin, then repeat it. | Type the pinyin. |

## Draft courses

### 1. Learn new items

For a new-items set: the next curriculum items, or a study set's new items.

1. **Intro cards:** see each item (characters, pinyin, meaning, audio, an example).
2. **Write it (teach):** write each word in its word context, with everything visible and guided strokes. This teaches how to write the word; it does not test.
3. **Word meanings (teach, choose, Chinese → English):** pick the meaning.
4. **Word meanings (teach, choose, English → Chinese).**
5. **Match pairs:** consolidate across the set.
6. **Word meanings (test, type):** the first real recall, graded.
7. *(Optional)* **Write it (test, whole words, pad):** the first writing recall, graded.

### 2. Review

For a reviews set: due items, or a study set's due items.

1. **Word meanings (test, type, quiz format):** all items at once.
2. **Write it (test, characters shuffled, Write elsewhere by default).**
3. **Say the pinyin (test).**
4. **Re-teach missed (`items: missedIn: [1, 2, 3]`):**
   - intro cards;
   - Write it (teach);
   - Word meanings (teach, choose).
   These are ungraded; the misses were already graded.

### 3. Review, then relearn

Like Review, but whatever is missed is fed into a **Learn new items** run of its own, with the full intro flow, instead of the short re-teach. This suits items that have clearly been forgotten, not just slipped.

## Courses as programs

Later, the AI could write a course: "do a quiz, and then the failed items from the quiz are what you do a review over".

The plan is to keep the program **declarative** (JSON steps with item selectors), not executable code:
- it can be validated, shown as a step list, resumed half-way and stored in backups;
- an AI can generate it as easily as code;
- if a real need for branching appears, add conditions to steps (`when: { missedCount: ">0" }`) before considering a script.

```json
{
  "name": "Quiz, then fix what I missed",
  "steps": [
    { "id": "quiz", "drill": "meanings", "mode": "test", "style": "type", "format": "quiz" },
    { "drill": "intro", "items": { "missedIn": "quiz" } },
    { "drill": "write", "mode": "teach", "items": { "missedIn": "quiz" } },
    { "drill": "meanings", "mode": "teach", "style": "choose", "items": { "missedIn": "quiz" } }
  ]
}
```

## Open questions

- **Gating:** must a step finish before the next one opens, or is the order only a suggestion (as in Drills today)? The draft says it's a suggestion: steps are listed in order with "Next step" emphasised, and any step can be opened.
- **Course choice:** is it picked by the learner at start ("Learn" / "Review" / "Review, then relearn"), or implied by the set's source (new items → Learn, due items → Review)? The draft implies it from the source, with a picker to change.
- **Relation to lessons:** Learn new items covers most of what a lesson does. If it works, lessons may become one course among others. Not decided.
- **Characters as their own track:** characters are a separate set even though they belong to words. Does Learn need a characters-only course for characters that recur across many words?
- **User-made courses:** editing the step list in the UI, versus AI-generated only, versus fixed templates first. The draft says fixed templates first.
