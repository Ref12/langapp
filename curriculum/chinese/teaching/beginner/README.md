# Practical Mandarin beginner

This is an independently authored **teaching track**, not an HSK level or an
exam syllabus. Its twelve ordered modules introduce useful meanings in coherent
situations. A module spans several lessons; it is not a demand to learn its
entire vocabulary list in one sitting. The track selects **205 vocabulary
senses and 25 grammar constructs**, with 15-20 new senses per module.

## Reference level is not teaching order

The `hsk-*` folders remain the unchanged reference inventory, with their
original headword IDs, source assignments, full dictionary meanings, and
provenance. This track selects **sense IDs**, not entire headwords:

- Coffee, `zh-hsk3-00396-s001`, is introduced with drinks in the second module.
  Its reference assignment remains `new-3`.
- White, black, red, yellow, blue, and green are introduced by the fourth
  module, along with the word for color. The higher reference assignments of
  several colors do not delay their practical use.
- Selecting white does not select the surname, political, or other meanings
  of the same written form. An unselected sense remains available in the
  reference inventory but is **not a beginner requirement**.

Neither absence from this track nor a late reference level proves that a sense
is advanced. It may be useful earlier for a particular learner. Such additions
should be deliberate sense-level choices, not automatic promotion of every
meaning of the headword.

## Files

| File | Role |
| --- | --- |
| `sequence.yaml` | Authored order, communicative outcomes, new vocabulary/grammar IDs, and review selections |
| `vocabulary.min.yaml` | Generated `[sense_id, word(pinyin)/disambiguator]` pairs, in introduction order |
| `grammar.min.yaml` | Generated `[grammar_id, construct/disambiguator]` pairs, in introduction order |

An ID is introduced once. Review lists refer only to introductions in earlier
modules and do not duplicate entries in the compact inventory. The sequence,
not the spelling of an ID or its position in a reference file, determines
teaching priority. Vocabulary and grammar introductions are ordered separately
within each module; interleave them as needed during lessons.

The source records for HSK-1 senses remain in `../../hsk-1/vocabulary.yaml`.
`../../reference-senses.yaml` supplies selected addressable meanings from other
bands, using the same expanded headword/senses schema. It preserves each
headword's original metadata exactly; the original HSK file is not moved or
reclassified. The underlying dictionaries still retain their other meanings.
Grammar notes and bilingual examples are in the referenced HSK grammar files.

## Teaching and review

Begin with pinyin, tones, basic word boundaries, and the learner's preferred
input method. Pronunciation assessment requires audio; a text response alone
is not evidence of spoken accuracy.

Use roughly 5-8 new vocabulary senses and one construction per lesson, reducing
the load if retrieval is weak. Start with a short review, model a useful
interaction with English support, practice substitutions, and finish with an
unseen request or response. The module's `outcome` is the communicative task,
not a claim that reciting the inventory constitutes mastery.

The explicit review lists are starting points, not the complete due queue.
Also revisit anything the learner found fragile. Review after the lesson and
again on later days, using the intervals in `review_policy` as adjustable
defaults. Keep recognition, comprehension, and production evidence separate.

Use only the intended sense when generating exercises. Reference examples may
contain untaught supporting words; adapt them to the cumulative introduced
inventory or identify and gloss the additional material explicitly. Do not
silently turn every dictionary sense or every word in a reference example into
a new learning requirement. Model greetings and other productive combinations
as phrases even when the inventory stores their component words separately.

After each module, assess its stated outcome with a fresh combination of taught
material, then require a corrected retry for errors. The final modules should
combine introductions, preferences, ordering, quantities, descriptions, time,
and directions in new interactions. Record which senses and constructions were
actually used, with hints and skill-specific evidence. Do not infer mastery of
sibling senses or report an official HSK result.

## Authoring and generation

Edit `sequence.yaml` to change teaching priorities. Keep its stable unit IDs.
Each unit has `id`, `title`, `outcome`, `vocabulary`, `grammar`,
`review_vocabulary`, and `review_grammar`. Introductions use existing canonical
sense IDs and grammar IDs; a bare vocabulary headword ID is not sufficient.

To address a meaning from a reference band that has not yet been split into
sense records, add its source-derived ID and disambiguator to
`../../authoring/reference-senses.yaml`, then run the Chinese importer.
This is an incremental sense-reference extension, not a full migration of every
higher-level vocabulary record. Never invent an ID, rename it to imply an easier
HSK level, or copy a word to a different reference folder.

From the repository root:

```powershell
python scripts\generate_teaching_track.py
python scripts\generate_teaching_track.py --check
python scripts\validate_curriculum.py --language chinese
```

The track generator works offline from checked-in expanded references and the
sequence. The Chinese importer also regenerates these views from its pinned
source. Unknown IDs, mismatched source metadata, duplicate introductions,
forward review references, and stale generated views are errors.

This is an AI-authored starting track, requiring human linguistic and teaching
review rather than claiming professional certification. The existing Chinese
source attribution and CC-BY-SA obligations apply to its derived vocabulary;
keep `../../sources.yaml`, the Chinese README, and the applicable license
notices when redistributing the compact views.
