# Mandarin for a short trip

This is a standalone route for practical vacation preparation, not a promise
of fluency or a requirement to complete the main curriculum first.

Start with `quick-start/sequence.yaml` for the essential, self-contained prefix.
Use the full `sequence.yaml` for the remaining situations relevant to your
trip. The route's `quick_start` list identifies the essential modules explicitly.
Every phrase in that subset uses vocabulary introduced within the subset.

## What to practice

Use short scenarios: get someone's attention, repair a misunderstanding,
ask for a destination or item, recognize a likely response, and confirm a
critical detail. Practice both recognizing a phrase and recalling it when
the situation makes it useful; reading a phrase aloud from a screen is not
the same as retrieving it independently.

The original phrases include Chinese, pinyin, and English. They are useful
chunks, not evidence that every component is independently understood.
`phrase_components` links each phrase to its vocabulary senses. Both the
route and its quick-start subset provide:

- `vocabulary.min.yaml`: `{id, ch, pr, ds}` sense entries.
- `grammar.min.yaml`: `{id, ch, ds}` construction entries.
- `phrases.min.yaml`: `{id, ch, pr, ds}` original phrase entries.
- `sequence.yaml`: ordered modules with duplicated entries and phrase components.

Introduce a few phrases at a time, replace details only with understood
alternatives, and practice an unexpected response or repair. Pinyin is a
reading aid, not an audio recording. Listening and pronunciation judgments
require actual audio and appropriate evaluation.

## Shared progress, separate goals

The route reuses the core inventory's stable sense and construction IDs.
Prior evidence for the same item and modality can carry into the main path.
A memorized phrase does not establish mastery of every word in it, and
tourist-route completion does not complete an entire numbered core level.
The default route goal is supported use; apply `../mastery.yaml` to the
individual evidence rather than assigning blanket competence.

## Practical limits

These are AI-authored language-learning phrases requiring human linguistic
review. They do not guarantee understanding by others, accessibility of a
service or payment method, or safety in an emergency. For important medical
or allergy information, carry a professionally verified written explanation
and use qualified local assistance. Do not substitute a memorized travel
phrase for medical, legal, or emergency advice.

No current visa rules, payment availability, emergency numbers, or other
location-specific travel requirements are asserted by this curriculum.
Choose practice scenarios relevant to the actual destination.

## Authoring

Edit `plan.yaml`, not the generated route. Keep selections and phrase
component IDs exact; introduce each vocabulary sense or construction once,
then use earlier-only review lists. The quick-start list must be an ordered
prefix so it remains usable without hidden later prerequisites.

Regenerate with `python scripts\generate_chinese_program.py` from the
repository root after updating the expanded references when needed.
Use `--check` for a read-only consistency check.

Keep the Chinese source attribution, README, and license notices when
redistributing the derived entries. Tourist phrases are original teaching
material, not copied phrasebook text or official syllabus entries.
