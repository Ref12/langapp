# Practice by skill

Status: **draft** (2026-11-01). Not built.

## The problem

Being in the knowledge set says nothing about *how* you know a word. After a Hands-free run you have heard and said a word, but never read it. After a Write it drill you can write it, but may never have heard it. Today every graded drill feeds one FSRS card per item, in the `reading` domain (`STUDY_DOMAINS = ['reading']`), whatever the drill practised.

## Skills

There are four skills: **reading**, **listening**, **speaking** and **writing**. Each drill type counts towards one or more of them:

| Activity | Reading | Listening | Speaking | Writing |
|---|:-:|:-:|:-:|:-:|
| Intro cards, Word meanings (Chinese shown) | ✓ | | | |
| Match pairs | ✓ | | | |
| Write it | | | | ✓ |
| Say the pinyin | | | ✓ | |
| Listen drills, Hands-free (Chinese → English) | | ✓ | | |
| Hands-free (English → Chinese, repeat after) | | | ✓ | |
| Lessons, reading media | ✓ | | | |

## Practice counts

Each item keeps a record per skill: `{ count, lastAt, familiar }`.
- `count` goes up by one each time the item is practised in that skill, graded or not.
- Everything starts at zero, including what you have already learned. This is a fresh slate.
- **Familiar** is a per-skill mark ("I know this one well for reading"). It makes the item come up less in that skill: it sorts as if its count were higher by a fixed amount (+10). The mark can be undone.

## Choosing what to practise next

When you start a set, a program or Hands-free, you choose a skill and a size (10 or 20). Then you choose how the items are picked:

- **Least practised** (the default): the lowest count in that skill first. Ties go to the most recently learned item.
  - Words learned yesterday have low counts, so they come first.
  - Words learned long ago and practised often come back less and less as the knowledge set grows.
  - It works like a loose spaced repetition with no grading needed, which suits hands-free use.
- **Due** (spaced repetition): FSRS per skill. Only graded drills update it. This is the existing Reviews, split by skill.
- **Recent:** items learned in the last N days, in any skill.

## Building it in steps

1. **Counts and least practised.**
   - Add the per-skill counts and the Familiar mark.
   - Every drill and Hands-free run increments the matching skill(s).
   - Practice home and Hands-free get a "Least practised" source with a skill picker.
   - Word cards show the four counts compactly ("R 12 · L 3 · S 3 · W 0"), with the Familiar toggles.
2. **Per-skill FSRS.**
   - Graded drills update the card for their own skill. Existing cards stay `reading`.
   - Reviews gets a skill picker.
