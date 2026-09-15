# Practical Japanese

This is an independent, Japanese-authored teaching progression, not a repackaging of
the five reference bands as five courses. Start with the [beginner route](beginner/README.md),
or use the independent [tourist route](tourist/README.md). Neither requires completing
a kana course first. [Preparation](preparation.yaml) can run alongside meaningful
exchanges; pointing to a phrase is a legitimate initial support.

## Thirty levels, six phases

The names, observable goals, and fresh-material checkpoints are in
[program.yaml](program.yaml). The shared generator supplies the numbered nested
views under `phases/1-first-exchanges/levels/01` through
`phases/6-nuance-interpretation/levels/30`.

| Phase | Levels | Practical focus |
|---|---|---|
| First exchanges | 1–4 | Contact, belongings, polite predicates, quantities, requests |
| Everyday life | 5–8 | Living arrangements, food, care, journeys, study and social plans |
| Stories and conversations | 9–13 | Events, perspective, conditions, reports, qualified choices |
| Explanation and problem-solving | 14–18 | Unfamiliar problems, respectful cooperation, public information |
| Analysis and argument | 19–24 | Evidence, institutions, uncertainty, values, synthesis |
| Nuance and interpretation | 25–30 | Stance, register, imagery, precision, interpretation, projects |

The phase headword budgets are planning aims, **not quotas or measured learner
knowledge**. The generated inventory reports actual distinct JMdict identities,
senses, readings, and cumulative introductions. A different reading, spelling,
or additional sense does not inflate lemma breadth.

The current core selects **6,031 sense-and-reading learning items representing
5,913 distinct JMdict entries**. They cover 5,992 distinct raw source senses,
5,450 kana-reading strings, and 5,883 written-form strings. The reading and
spelling counts are distinct strings, not additional lemmas or mastery claims.
New identities by phase are **253 / 714 / 1,008 / 1,052 / 1,309 /
1,577**: later phases introduce more breadth, but the approximate 5,800-6,000
lemma planning range is not a quota. The core has 210 constructions, with 14 more in
optional extensions and one original reference-only variant documented in
`grammar-notes.md`.

Relative to their own prerequisite prefixes, the extensions introduce 60
professional, 31 technical, 44 scientific, and 54 literary senses. Explicit
selections already in the prefix remain review material, and all four branches
include targeted construction retrieval. Later-core material can be introduced
locally in an earlier-access branch using the same canonical ID; core coverage
is not removed to avoid overlap. Route inventories must not be summed as unique
headwords.

The independent tourist route contains twelve situations, 59 learning senses,
23 constructions, and 38 original utterances. Its closed five-situation quick
start contains 24 senses, 11 constructions, and 17 utterances.

These are inventory observations, not evidence of learner mastery or human expert
approval. [Coverage notes](../authoring/teaching/coverage.yaml) record source
mapping decisions, inflection prerequisites, and review limitations; the generated
`inventory.yaml` remains the machine-readable inventory.

## How to teach a topic pool

1. Begin with the level's communicative goal and a concrete situation. Choose
   roughly 5–8 relevant senses and one construction, not an entire 25-sense module.
2. Establish the intended meanings with a contrast or short exchange. Check
   the displayed sense, not merely the English headword or the kanji.
3. Teach the prerequisite form explicitly. For example, demonstrate the verb
   group and sound change before requiring a new te-form request.
4. Change a detail: recipient, location, quantity, reason, time, or source.
   Move from supported production toward a response without an answer model.
5. Retrieve fragile earlier items after a delay. In a later lesson, contrast
   an applicable second sense or reading in a new context.

The later pools deliberately widen domains. A tutor selects a coherent small
lesson for the learner's project; source-index order is not a drill, and alphabetic
dictionary chunks are not lesson goals. The editable placements are explicit in
`authoring/teaching/vocabulary.yaml` and `grammar.yaml`, not recalculated from
frequency scores, reference bands, or alphabetical slices at runtime.

## Senses, forms, and prerequisites

See [grammar-notes.md](grammar-notes.md) and
`authoring/teaching/coverage.yaml`. Important contrasts include:

- Hearing, listening, and asking are distinct selected senses of **聞く**.
- Wearing glasses, making a call, and spending resources are distinct senses
  of **かける**. Knowing one does not establish the others.
- A **本** meaning a book and **本** as a counter are different learning items.
- Food **肉**, getting off a vehicle, summoning a doctor, a brief **ちょっと**,
  and locative **ある** use their actual raw senses rather than reusing flesh,
  descending, calling out, degree, or mere existence indiscriminately.
- **円** meaning yen and **すみません** for attention or apology occur early,
  regardless of their preserved N3 source labels.
- **今日／こんにち** “nowadays” does not authorize that meaning under
  **今日／きょう**. The same restriction matters for **明日／あす** versus
  **明日／あした**.
- Essential particles and copular forms are licensed by the existing original
  construction IDs. They are not fabricated dictionary entries.

The raw-sense ordinal in `-sNNN` is one-based in the pinned JMdict array **before**
restriction filtering. These are local snapshot-scoped IDs, not official JMdict
sense identifiers. Validated teaching spellings can differ from a preserved
search-only source target; the original parent metadata remains unchanged.

## Mastery and optional extensions

[mastery.yaml](mastery.yaml) separates recognition, contextual understanding,
supported use, and independent use **within each modality**. Reading, listening,
typed production, spoken production, and handwriting require separate evidence.
These files contain no learner progress or fabricated assessment results.
Text cannot establish listening, timing, pitch accent, or pronunciation.

Professional and technical extensions are optional after level 18; scientific
and literary extensions are optional after level 24. They are not “all remaining
dictionary entries,” prerequisites for the core, or professional qualifications.
Use the specified contextual understanding or production target, not a universal
requirement to say every literary or technical item aloud.

## Provenance and review status

The underlying vocabulary remains derived from the retained JMdict subset and
the Waller/stephenmk entry mappings. Preserve **all** notices in
[sources.yaml](../sources.yaml) and `licenses/`: EDRDG/JMdict CC BY-SA 4.0,
scriptin's JSON transformation credit, stephenmk's CC BY-SA 4.0 mapping credit,
and Waller's CC BY attribution with version unspecified by Waller.
Existing references and original grammar examples have not been rewritten.
The source lock covers the fixed 28 original curriculum inputs; additional
writing assets or their license notices do not expand or weaken that lock.

The placements, tasks, kana preparation, and tourist utterances are original
AI-authored contributions with an explicit first-pass source audit. **Qualified
Japanese-language pedagogy and native-speaker review remain pending.** They are
not copied textbook or phrasebook content, an official JLPT specification, a
validated frequency-ranked syllabus, or a promise of examination success.

The optional `scripts/build_japanese_teaching_data.py` records the original
explicit thematic selections and closed utterances. Rebuilding it overwrites
these authored inputs, so review the diff and reconcile later editorial changes
first. It is not another scheduling engine and does not download a corpus.

From the repository root, `python -B scripts\generate_japanese_program.py`
regenerates the expanded references and teaching views from authored YAML.
Add `--check` to check them without writing. The normal generator does not run
the optional authoring helper or replace manually edited selections.
