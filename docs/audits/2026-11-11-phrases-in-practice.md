# Phrases in the normal Practice experience: design

Written 2026-11-11 on public main at `cdac8ef`. Read-only: no source file was changed, nothing was built and no test was run. Everything below is from reading the code; where I assumed something I say so. It follows `docs/audits/2026-11-11-phrases-plan.md` (sections 1 and 4) and replaces that plan's recommendation of "a Practice page of its own" with the owner's direction: phrases are something you pick in the normal Practice experience, next to vocabulary and grammar items, in all three apps.

## 0. In one page

- **Today** Practice is built on *items* (words and grammar points). A session is planned from a list of items; phrases appear only inside it as *carriers*: the planner picks a sentence that contains the item, and only the item is credited. Nothing can practise a phrase for its own sake.
- **What makes this cheap**: the planner already has an item kind `phrase` (a learner's own saved phrase is its own sentence: `ownPhrase` in `src/core/session/plan.ts`); every sentence form already builds itself from a sentence; and the recording call already writes a per-item practice count without needing a review card. So a bank phrase becomes an item by giving it a stable reference and teaching three places about it: the picker, the loader that shows items, and the planner's choice of forms. No new exercise form and no new page.
- **Recommended**: a third choice in the Practice home's "What to practise" group, beside *New items* and *Reviews*: **Phrases**. It uses the same "Learning from" picker, count, presets, Short/Standard/Long, set, Start screen, run, summary and Recent sessions. It records a history line and a count per phrase and, by default, does not touch word knowledge. A later stage lets one set hold items and phrases together.
- **Same in all three apps**: the phrase list, the sentence key and the tokens come from the language pack. Section 3 lists the places that need a pack-driven value instead of a Chinese one.
- Five small stages, two of which can run side by side. Three questions for the owner (section 5).

## 1. How Practice works today

### 1.1 The screens and their pickers

The real Practice page is `src/pages/drills/Drills.tsx` (route `practice`, label `DRILLS_LABEL`). The older `src/pages/Practice.tsx` is the classic word-card review, reached only through the "classic" links on that home (`classicLinks` in Drills.tsx). I did not run the app; the layout is read from `DrillsHome` (Drills.tsx 323 to 465).

```
Practice home (DrillsHome)
 |- "What you'll practise"                          Drills.tsx 413-424
 |    Learning from  [ <language> curriculum | one of your collections | "origin" ]
 |    [ New items | Reviews ]     segmented group "What to practise"
 |    count (New items per set / Reviews per set / "All due"); View items
 |- Programs (only where area handsFree is on: Chinese today)       425-432
 |    Start Hands-free; "Least practised (listening)"
 |- Start a set                                     433-445
 |    Start practice session  -> the selection above
 |    Practise by skill  [Skill][Set size][Strategy] -> items, least practised or recent
 |    Unwritten characters (only where the pack counts characters)
 '- Recent sessions (unfinished first, then the last finished)       448-
```

- **Learning from** is the scope: the curriculum, a collection (a study set the learner built from reading, media or the assistant), or an "origin" (the items of a past lesson or session, arriving as `practice?from=lesson:<id>`).
- **New items / Reviews** is the kind of selection. New items takes the next whole lessons' items the learner does not know yet (`fillByItems`; they join the knowledge set only when the set is finished: `addOnFinish`). Reviews takes the items whose study card is due, then those coming up (`pickReviews`).
- **Skill** (reading, listening, speaking, writing) and **Strategy** (least practised, recent) pick items by per-item skill counts (`rankItems` in `src/core/study/skills.ts`).
- **Presets** are not on the home: they are chosen on the set's Start screen (`src/pages/drills/EngineSet.tsx`, `setEngineChoice`) with the length (Short, Standard, Long). Built in: Default, Reading, Writing, Listening, Speaking, plus the learner's own from the advanced builder (`src/core/session/presets.ts`, `custom-preset.ts`).

### 1.2 What a set is

One row of the `drillSets` table (`drillSetSchema`, `src/core/drills/contracts.ts`):

```
DrillSet
  id, title ("New items · 30 Oct"), source: new | review | study-set | lesson | drill
  refs[1..200]       the items (vocabulary:, grammar:, phrase:, source:, ja:w:, ko:g: ...)
  status, createdAt, updatedAt, discarded, removedAt
  engine?            preset, length, seed, recorded["ref|skill"], correct/total,
                     answers[] (resume), done/planned, lastRun, finishedAt
  handsfree?, handsfreeRecall?   the Hands-free activities and where they stopped
  addOnFinish?, addedRefs?       new items added to knowledge when the set is finished
  content, progress              older drill types (AI-written sentences, per-type results)
  emphasis?, unwritten?, shortcut?
```

Creation is `createDrillSet(source)` (`src/core/drills/store.ts`; the `DrillSource` union: new, review, study-set, skill, unwritten, refs). A set of the practice engine carries `engine` and replaces the old drill-type list with a Start screen (`SetScreen` / `EngineSet.tsx`).

### 1.3 How a session is planned from items

```
set.refs --loadItems--> ItemInfo[] (kind vocabulary|grammar|phrase|source)       core/drills/items.ts
   |
   +- planSetSession (core/session/set-plan.ts)
   |    allowed = knowledge set + the set's refs
   |    loadSessionBank (sources.ts): per item a list of candidate sentences + the whole usable bank
   |        vocabulary: loadBank | grammar: grammarPhrases | pickSentences (lesson examples first)
   |        shipped bands filtered by usableFor(phrase, allowed): every word known, grammar known
   |        plus phrases with exactly ONE unknown word (recognise/reading/listening only, shown flagged)
   |    offeredPreset(resolvePreset(..), pack)  drops forms the pack has no material for
   |    dataset source (Chinese only today)
   '- planSession (plan.ts), pure for a seed
        stages Introduce, Recognise, Recall, Produce, Use (types.ts STAGES)
        rounds per stage from preset x length (stageRounds)
        per round every item once, forms rotated from the preset's list for that stage
        SentencePool.take(item, strict): one phrase per exercise, never the same sentence twice
        builders (bank-forms.ts): buildTranslate, buildTiles, buildGap, buildListenPick, buildDictation, buildRepeat
        dataset exercises first; pack word forms (conjugate, form-pick) open a stage
        -> SessionPlan { stages[{stage, exercises[]}], uncovered[], total }
```

The run (`core/session/runner.ts`) plays the stages in order; a miss goes to the end of its stage and returns up to two more rounds; only the first attempt is graded. Forms and the skills they practise are in `types.ts` (`FORMS`, `FORM_SKILLS`: translate to English reads, translate into the language writes, listen-pick listens, dictation listens and writes, repeat speaks; `PHRASE_FORMS` are the seven that need a sentence). Rules that matter here: **producing the language needs a fully known sentence** (`needsKnownSentence`: translate into the language, tiles, dictation, and the whole Produce stage); reading and listening may carry one unknown word; a new item never types the language, it gets tiles.

### 1.4 Phrases today: carriers, never the thing practised

- Every exercise has `refs`: "the items this exercise practises (the ones whose results it records)". For a word exercise that is `[item.ref]`; the carrier sentence's other words are **not** in it. Practising "water" through "I drink water" credits water and nothing else.
- The bank is each pack's shipped `phrases-band-*.json` (Chinese bands 1 to 6, about 15,100; Japanese 822 and Korean 905 lesson sentences, band 1) plus the catalog's authored examples, sentences older drills wrote, and the learner's own (`userPhrases`). `BankPhrase` carries text, reading, English, word and grammar refs, source, `checked`, `readyAt` and (Japanese, Korean) `tokens` (`src/core/phrases/contracts.ts`).
- A phrase's identity today is its **text**, through the pack's `phraseKey(text)` (`core/phrases/key.ts`; punctuation and spaces dropped), used for "no sentence twice" and the heard log. A shipped phrase has no item ref. The `phrase:` refs that exist belong to *study-set* items (a `collectionItems` row with its own text and translation).
- A `PlanItem` already has kind `phrase`, and `ownPhrase` makes it its own sentence; today that serves study-set phrases only.

### 1.5 What is recorded per item

| Record | Where | Per | Written by | Notes |
|---|---|---|---|---|
| Knowledge set | `knowledge` (key ref) | item | finishing a New items set (`addOnFinish`), lessons | "known" gates everything (`allowed` in the planner) |
| Study card (FSRS) | `studyCards` | item | lessons, and `reviewItem` inside `recordEngineResult` (Got = Good, hint = Hard, Missed = Again) | `reviewItem` does nothing when the item **has no card** |
| Journal | `journal` | review event | the same, only when the item is in knowledge | |
| Skill practice | `skillPractice` (key [ref, skill]) | item x skill | `recordSkillPractice` (engine, drills, Hands-free) | `count`, `lastAt`, `familiar`; in backups; drives "least practised" |
| Engine record | the set's `engine` | set | `recordEngineResult`, `saveEngineAnswer`, `finishEngineRun` | "ref\|skill" pairs recorded once; first-try score; last run |
| Heard log | `phraseHeard` (key text) | phrase | Hands-free | plays per phrase, least heard first |

The engine records only the first graded attempt of each (item, skill) pair per set, so a replay or resume adds nothing.

### 1.6 Hands-free and the dataset questions

- **Hands-free** is an activity of a set (`set.handsfree` Introduction, `set.handsfreeRecall` Recall), built from the set's *items*, picking per word the least-heard usable phrases (`core/handsfree/store.ts`). It is on for Chinese only (area `handsFree` in `language/areas.ts`; `features.handsFree` false for ja and ko) and its speech locales are hard-coded for Chinese (the Japanese speech work is separate).
- **Dataset questions** (`dataset-source.ts`: exchange-pick, exchange-reply, which-correct, conversation) come from the Chinese practice dataset, are matched to a set's items through the words and grammar they touch, and exist only for a pack that ships a dataset (`hasDataset` in `offered.ts`). A phrase item touches none of them; that is right, they are about items.

## 2. What "a phrase as an item" means

### 2.1 Identity (per language)

A phrase item needs a **reference** that fits the ref grammar and cannot collide with a word's. The regex (`unitRefSchema` in `src/core/study/contracts.ts`) takes a prefix and an ASCII slug, so Han text cannot be the ref. The stable handle is the phrase's **band and id in its shipped band file** (ids are never reused, plan section 1.1):

| App | Ref | Example |
|---|---|---|
| Chinese | `sentence:<band>-<id>` | `sentence:b3-1207` |
| Japanese | `ja:s:<band>-<id>` | `ja:s:b1-45` |
| Korean | `ko:s:<band>-<id>` | `ko:s:b1-45` |

The ja/ko shape follows the existing `ja:w:` / `ko:g:` refs; `sentence:` is new so it cannot be confused with study-set `phrase:` refs. The regex, `isLanguageRef` and the backup schemas widen by one alternative. `phraseKey(text)` stays the sentence-level key for "no sentence twice" and the heard log; a resolver maps ref to `BankPhrase` and from it to the key, so the two never need to agree. A learner's own and study-set phrases keep their `phrase:` refs and are outside the first stages (they could use the same selector later).

If a bank were regenerated with new ids, old refs would dangle: practice rows survive and the resolver shows nothing for them, like a removed word. Stage 1 adds a test that a shipped id never disappears between releases.

### 2.2 What is recorded when you practise one

Recommended: **a count and a date per phrase and skill, plus the usual set record; no schedule, no card.** This needs no new table, because the engine's recording call already does the right thing for a ref without a card:

- `recordEngineResult` writes the set's `engine.recorded` pair and score (the history line: the set shows in Recent sessions and History with its score);
- `reviewItem` finds no study card and does nothing: **no scheduling**;
- `recordSkillPractice` writes `skillPractice[ref, skill]`: seen count and last time, in backups; this is also what "least seen" reads.

Not given: a right/wrong count per phrase (only the set's score) and a "missed lately" order. If the owner wants those, add optional `missed` and `lastMissedAt` to `skillPractice` (optional, so old backups load; small change in `skill-map.ts` and `recordEngineResult`). Scheduling phrases like words (an FSRS card each, due phrases in Reviews) is possible; I do not recommend it: 15,000 Chinese phrases would flood Reviews, and the owner said this is not a review of particular items. See question 1.

### 2.3 How a phrase relates to its words

Three levels; the owner chooses (question 2); the recommended is the first.

1. **Independent (recommended).** The exercise's `refs` is `[phrase ref]`. The words inside are untouched: no card, no knowledge change, no skill count. This mirrors how word practice treats its carrier sentence today.
2. **Counts as practice, not review.** The words' skill counts go up by one, their cards and knowledge do not change. Mechanically, the recorder also calls `recordSkillPractice` for the phrase's `words` refs. Visible only in "least practised" and the skill counts.
3. **Counts like a review.** A right answer is a Good review on each word that has a card; a miss is Again. Not the default: one hard sentence would make easy words look forgotten, and the owner's wording points the other way.

Whatever is chosen, a phrase is offered only when its words are known (2.5), so practising it can never teach a word.

### 2.4 Exercise forms

All seven sentence forms already exist and run for the three languages (Japanese and Korean already run on their lesson sentences; grading is changing in another session, and this design needs only "the forms grade a sentence"):

| Form | Direction | Skill | Applies | Notes |
|---|---|---|---|---|
| translate to English | read | reading | yes | self-marked or typed |
| translate into the language | write | writing | yes | needs a fully known phrase: always true here |
| tiles (word order) | write | writing | yes | needs `tokens` in ja/ko (shipped); Chinese segments by the pack |
| gap | read | reading | yes, with a small rule | today it asks about an *item*; for a phrase the gapped word is chosen from the phrase and no item is credited |
| listen-pick | hear | listening | yes | distractors from the same bank |
| dictation | hear, write | listening + writing | yes | |
| repeat | say | speaking | yes | not graded, counts as speaking; Japanese speech work decides how well it works in ja |
| spoken translate | say | speaking | yes | the Speaking preset already forces spoken answers |

Word-only forms (choice, match, recall, pinyin, conjugate, form-pick) and the dataset forms do not apply to a phrase item. A phrase gets **no Introduce stage** (nothing to teach; its words are known). The rule in the planner is one line: **for a phrase item, take the stage's forms and keep only the sentence forms; if none remain use translate, then listen-pick.** The existing presets then apply unchanged (Reading: translate, gap; Writing: tiles, translate, dictation; Listening: listen-pick, dictation; Speaking: repeat, spoken translate), and so do the learner's own presets.

### 2.5 How phrases are chosen

A pure function over the pack's phrase list, the knowledge set, the skill counts and a seed (a set is repeatable and testable like the others):

1. **Candidates**: bank phrases that are checked (Chinese about 13,400 of 15,100, Japanese 817 of 822, Korean 801 of 905), that the learner can read (`usableFor(phrase, known)`: every word known, grammar known for non-authored phrases) and whose `readyAt` is at most the lesson reached (`reachedLesson`). That is "the phrases of the lessons reached". Phrases with one unknown word are **not** offered: practising a phrase should not be a hidden vocabulary lesson.
2. **Scope** (the "Learning from" picker): the curriculum means every candidate; a collection means phrases whose words are in it; an origin (a past lesson or session) means phrases made of that origin's items. A free pick by band or lesson number is not needed at first: "reached" is the level.
3. **Order**, a small choice next to the count: **Least seen** (default: lowest total of `skillPractice` counts, ties by seed), **Newest lessons first** (highest `readyAt`, then least seen), **Random**. Never the same sentence twice in a set (the pool already guarantees it).
4. **Count**: the existing count picker, default 10 (a phrase round is quicker than a new-item round); exercises per phrase follow the preset and length (Standard: 4).
5. **Skill** and **Strategy** of "Practise by skill" work on phrases the same way once phrases are a kind.

Early lessons have few candidates (Japanese about 9 per lesson, Korean about 10; Chinese many more): when fewer than the count are ready the set is that many, and the home says "Only 6 phrases are ready yet".

## 3. Where the selector lives

All options use the same set, Start screen, run and summary; they differ in where the learner says "phrases".

### Option A (recommended): "Phrases" beside New items and Reviews

The learner sees: the group "What to practise" on the Practice home becomes **New items | Reviews | Phrases**. With Phrases chosen, "Learning from" stays; the count reads "Phrases per set"; a small order picker appears (Least seen, Newest lessons, Random); the summary says "10 phrases from lessons 1 to 14, 6 not seen yet"; View items lists them. Start makes a set titled "Phrases · 11 Nov" that behaves like any set: Start screen with preset and length, resume, summary, Recent sessions. "Practise by skill" follows the same choice.

Planner changes:
- `DrillSource` gains `{ kind: 'phrases'; from?; count; order; refs? }` (the "items the picker showed" rule of New items); `DrillSet.source` gains `'phrases'`; `originLabel` too.
- New `src/core/session/phrase-pick.ts` (the picker of 2.5) and a resolver that `loadItems` calls for the new refs.
- `planSession`: the rule of 2.4 for items of kind `phrase`; `ownPhrase` takes the bank phrase when the ref resolves to one (so words, grammar and ja/ko `tokens` come along; the synthetic one drops them); `loadSessionBank` puts a phrase item's own phrase first in its list.
- `recordEngineResult` needs no change for level 1 of 2.3.

Cost: the smallest of the three. Core: one new file and about five edited (contracts, store, items, plan, sources). UI: one segment, one picker, a summary string in `Drills.tsx`, and the item list on the Start screen.

Fit with the owner's words: "a particular selector on the normal experience" and "phrases ... in there as well": yes, in the place where the learner already chooses what to practise.

### Option B: "items / phrases / both" on the set's Start screen

The home is unchanged and still builds a set of items; on the Start screen (next to preset and length) a choice **Words and grammar | Phrases | Both**. "Phrases" swaps the items for phrases that use them; "Both" adds them.

It needs the same mixed-kind sets as A, plus rebuilding the list at Start and a rule for "phrases that use these items". That is a review of particular items again, the thing the owner does not want, and it does not give "just practise phrases". More work than A for less.

### Option C: a preset called "Phrases"

A sixth preset on the Start screen. A preset only changes forms, not the material: with word items it would still pick a carrier sentence per word, so the exercise stays about the word. It cannot practise a phrase for itself. Rejected: a preset is a recipe of forms, not a choice of material.

### Recommendation

**Option A.** B's "both" arrives as stage 4 (a set may hold items and phrases), because A's data model (a set of refs of mixed kinds) already allows it.

### Language as data

Places that assume Chinese and become pack-driven:
1. `loadSessionBank` reads bands 1 to 6 by the catalog's band numbers; the phrase list should come from `pack.phrases.bands` (already per pack: Japanese and Korean list band 1).
2. The words on screen ("phrases", the language tag of the shown text) come from the pack's `practiceWording` and `learningTag`.
3. `phraseKey` is already the pack's; ordering by `readyAt` needs the lesson number, and all three packs carry lessons 1 to 87 there.

Japanese and Korean have no practice dataset and no Hands-free yet: the Phrases choice shows in both, and the Hands-free shortcut stays hidden where the area is off.

## 4. Staged plan

Each stage is publishable on its own; the learner sees nothing until stage 2.

| Stage | What | Files | Tests | The learner sees |
|---|---|---|---|---|
| **1. Phrase items in the engine** | Ref shape and resolver for the three languages; `loadItems` resolves them; planner rule for phrase items (sentence forms only, no Introduce, the bank phrase itself); the pure picker with its orders | `core/study/contracts.ts` (regex, `isLanguageRef`), `core/drills/items.ts`, new `core/session/phrase-pick.ts`, `plan.ts`, `sources.ts`, `bank-forms.ts` (gap without an item) | new `phrase-pick.test.ts` (candidates, lesson reached, checked only, orders, seed repeatable, fewer than the count); `plan.test.ts` (phrase item plans only sentence forms, no intro, no sentence twice, each preset); copies in `ja-practice.test.ts` and `ko-practice.test.ts` for tokens and tiles; data test that shipped ids are stable | nothing |
| **2. The Phrases choice on the Practice home** | Third segment, order picker, summary line, View items, creating the set; Start screen, summary and Recent sessions show phrases | `pages/drills/Drills.tsx`, `EngineSet.tsx`, `core/drills/store.ts`, `contracts.ts` (source, title), `core/study/skill-pick.ts` | `Drills.test.tsx`, `EngineSet.test.tsx`: choose Phrases, start, answer, see score, `skillPractice` count rise and no `studyCards` change; the same in `japanese-screens.test.tsx` and `korean-screens.test.tsx`; round trip in `backup.test.ts` | **Practice, Phrases, Start**: a set of phrases in all three apps |
| **3. What is remembered** | "seen N times" and last time in the picker summary and as a column in the Dictionary's Phrases section (the other session's work); if the owner chooses it, the missed count and a "missed lately" order; if the owner chooses level 2 of 2.3, the word counts | `core/study/skill-map.ts` (optional `missed`), `recordEngineResult`, `phrase-pick.ts`, `pages/Dictionary.tsx` | store tests for the new fields and old backups loading; picker order test | counts beside phrases |
| **4. Items and phrases in one set** | An "Also add phrases" choice for New items and Reviews (a few per set); the planner mixes kinds (rotation already per item); dataset forms keep matching only item refs | `Drills.tsx`, `store.ts`, `plan.ts` | `plan.test.ts` mixed set: items keep their forms, phrases get sentence forms, no sentence twice | words and phrases in one session |
| **5. Hands-free for phrases, speaking** | Hands-free built from a set's phrase refs (least-heard rule over them); a speaking mode for phrases; for ja/ko only when that area is on | `core/handsfree/store.ts`, `script.ts`, `pages/drills/HandsFree.tsx`, `EngineQuestion.tsx` | existing Hands-free and speak-mode tests per language | listening to and saying phrases |

**In parallel**: 1 first (core only, no UI; the grading session works in `grade.ts`, so rebase and do not edit it). After 1, **2 and 3 can run at the same time** (2 owns `Drills.tsx`, `EngineSet.tsx`, `store.ts`; 3 owns `skill-map.ts`, the Dictionary column and the picker's counts; 3's second half waits for the owner's answers). 4 needs 2. 5 needs 2 and the Japanese speech work.

**What I could not check**: I did not run the app or any test, so I did not see how `Drills.tsx` lays out three segments on a phone; `EngineSet.tsx`'s item list may assume a word or grammar item in its cards (`IntroCards` already shows `item.kind`, which suggests it copes); the gap form for a phrase item needs the rule in 2.4; and the refs of a regenerated bank must stay stable (2.1).

## 5. Questions for the owner

1. **When you practise a phrase, what should the app remember about it?** Options: (a) **only that you did it, how many times and when, plus the score of that session, with no schedule (recommended: enough to offer the ones you have seen least, and it never floods your reviews)**; (b) also how often you got it wrong, so it can offer the phrases you missed lately; (c) schedule each phrase for review like a word, so some come due again each day.
2. **Should practising a phrase change what the app thinks you know about the words in it?** Options: (a) **no: the phrase is remembered on its own and its words are left alone (recommended; phrases are only offered when you already know their words)**; (b) the words are counted as practised once more, which affects the "least practised" lists but not when a word is due; (c) a right answer counts as a review of each word and a wrong one as a miss.
3. **Where should the choice of phrases sit on the Practice page?** Options: (a) **as a third choice next to "New items" and "Reviews" (recommended: it is where you already choose what to practise)**; (b) as a switch on the start screen of each session ("words and grammar / phrases / both"); (c) as a separate card on the page, apart from the existing choices.
