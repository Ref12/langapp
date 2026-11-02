# Phrases as items, "generate more", and practice sessions

Status: idea, captured 2026-11-02. Not scheduled. Nothing here is built.

## What the user said
- Phrases met anywhere (media, lessons, the dictionary) should be studyable as phrases, not only broken into their words and grammar patterns. The breakdown stays, but the phrase itself gets practised where that makes sense, mostly in listening and read-aloud. AI-generated material can come on top.
- Grammar practice: for one grammar pattern, the AI writes many uses of it built only from the learner's current vocabulary. A small vocabulary limits how many real variations exist.
- The AI gives an initial batch, and the learner can ask for more to keep practising.
- That is a reason to keep finished practice types in the set page (done, with Redo) rather than tidying them away.
- Naming: "session" describes the practice container better than "set"; "set" feels like something inside it.
- Organisation is open: phrases might be just another item kind, addable to a study set or to a session itself, and a session might track how often each item was met and prefer the ones just added.
- Lessons should have their phrases precomputed, making each lesson a study set of sorts. Practice sessions can generate more phrases and optionally save them back into the study set.

## Current state (for contrast)
- Items are vocabulary and grammar refs (`vocabulary:<word>`, `grammar:<label>`). A practice set (`DrillSet`) has a fixed `refs` list, per-type progress, and AI content written once for the whole set (`effectiveContent`).
- Generated sentences serve the set's practice types; they are not items, are not tracked per phrase, and there is no "more".
- Study sets (collections) hold refs only.

## Proposed shape
1. **Phrase is an item kind.** `phrase:<id>` with text, translation, source (media timestamp, lesson, dictionary, generated), and its breakdown into word and grammar refs. Practising a phrase also counts as meeting its words and patterns.
2. **Captured and generated phrases are the same thing.** "Generate more" adds phrase items to the session; a phrase captured from media is added the same way. No separate generated-content mode.
3. **Sessions count encounters.** Each item in a session has a met count; exercises pick the least-met items first, so new or freshly generated phrases come up soon.
4. **Exercises that take phrases:** listening, read aloud, dictation, translate, Repeat after me, and Hands-free. Word-only exercises (Word meanings, Learn to write, Say the pinyin) keep using the breakdown.
5. **Grammar drill** = a session focused on one pattern: generate N uses from known vocabulary, then "more". The generator says when it can't make a new one, instead of us estimating capacity up front.
6. **Finished is per batch.** A finished exercise can be redone with new material, which the Done check plus Redo already supports.
7. **Lessons carry precomputed phrases.** Each lesson's phrases are computed ahead of time and shipped with the curriculum, so a lesson is a study set of sorts: its words, its patterns and its phrases. The curriculum's example sentences (`group.examples`, `exampleIndex` in `src/core/drills/items.ts`) are the starting point. A session made from a lesson starts with those phrases as items; no AI call is needed for them.
8. **Sessions generate, study sets keep.** In a practice session you can generate more phrases. They belong to the session, and you can save them back into the study set (or the lesson's set) when you want to keep them; nothing is written back without asking.

## Naming
- **Set** = a kept collection of items (study set).
- **Session** = practice on some items, made up of exercises (today's "practice set"; types are exercises).
- The rename is user-facing text first (Recent sets → Recent sessions, Practice set → Practice session); code and DB names (`DrillSet`, `drillSets`) can stay.

## Open questions
- Does a phrase added in a session also go into the knowledge set automatically, or only on Save? (Study sets: only on Save, per point 8.)
- How many generated phrases per "more", and do unsaved ones persist with the session after it ends?
- Which lesson phrases to precompute: all curriculum examples for the lesson, or a filtered few (only known or in-lesson words, a length cap, as `lessonPhrase` in Hands-free already does)?
- How does a phrase's mastery relate to its words' scores: separate card, or derived?
- Which media capture flow adds a phrase (subtitle line tap, selection)?
