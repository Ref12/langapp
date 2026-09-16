# Practical Spanish teaching order

Use `core/sequence.yaml` for the complete route. Each phase contains its own
globally numbered `levels/NN` directories, so a level's phase membership is
visible on disk as well as in the sequence. The separate
[travel route](tourist/README.md) starts without any core prerequisite.

| Phase | Levels | Focus |
| --- | --- | --- |
| 1. First exchanges | 1-4 | Introductions, repair, immediate needs and simple plans |
| 2. Everyday life | 5-8 | Home, services, routines, journeys and shared activities |
| 3. Stories and conversations | 9-13 | Narration, relationships, processes and choices |
| 4. Explanation and problem-solving | 14-18 | Less predictable problems, news and proposals |
| 5. Analysis and argument | 19-24 | Evidence, institutions, qualifications and synthesis |
| 6. Nuance and interpretation | 25-30 | Implication, register, imagery, precision and projects |

`program.yaml` gives each level observable goals and a fresh-transfer
checkpoint. Introduced material is grouped by theme into modules; a module is
not a single lesson. Begin with about 5-8 new senses per lesson, use relevant
earlier constructions, and adjust to actual retrieval and task performance.
Later phases contain more vocabulary and modules rather than only different
labels. Compact inventories contain local introductions, not all prerequisites.

The generated inventory separates breadth groups, learning senses, source
senses, and written forms. Its `readings` counter counts distinct compact
reading strings, including a string's retained source variants; it is not a
count of individual IPA variants or pronunciation skills. Inflections shown
in expanded records do not inflate headword breadth.

Select a vocabulary sense or grammar ID, then resolve its expanded record for
meaning, usage and source. Give English support for examples and corrections.
Contrast ordinary polysemous meanings and actual inflected usage. Do not use a
headword's combined dictionary gloss as a single translation or transfer an
answer about one sense to its unrelated meanings.

`mastery.yaml` separates receptive recognition/contextual understanding from
supported/independent production. Record task, modality, assistance and later
retrieval. Reading, listening, typed production, spoken production and
handwriting remain distinct. No curriculum position or module completion
automatically establishes mastery; no fabricated observations are supplied.

Each checkpoint uses fresh combinations of taught material and assesses the
named goals. The tutor can advance while carrying fragile items into review,
rather than demanding perfection in every introduced sense. The generated
review entries are retrieval seeds, not a personalized spaced-review schedule.

## Optional branches

Professional and technical branches require the core through level 18.
Scientific and literary branches require the core through level 24.
Branches are independent, not a mandatory seventh phase or prerequisites for
one another. Professional tasks target independent use; the other branches
default to contextual understanding. None is a professional qualification.

## Compact format and regional use

Vocabulary/phrase: `{id, ch, pr, ds}`. Grammar: `{id, ch, ds}`.
Each mapping occupies one line, and reviews duplicate the complete canonical
record. `ds` is sufficient English of at most 64 characters. It is a hint,
not a license to substitute the word in every possible context.

Preserve Spanish accents and meaningful reading variants. Read
[grammar notes](grammar-notes.md) and [pronunciation policy](pronunciation.md)
for article/clitic/tense contrasts, regional scope, and text-versus-audio
limitations. A formal address form, a regional pronoun, and a familiar pronoun
are not interchangeable social choices.

The original pedagogy, examples and phrases are AI-authored and need human
review. Source dictionary information has its own limitations. This program
does not guarantee CEFR/exam results or mastery of every Spanish situation.
