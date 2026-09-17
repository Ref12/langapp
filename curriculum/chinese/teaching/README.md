# Practical Mandarin: progression and understanding

This is a curated teaching path, not an examination syllabus or a promise of
general proficiency. **Phase, level, module, and item mastery are different
things.** Reference HSK labels remain source provenance only.

## Choose a route

Use `core/sequence.yaml` for the complete ordered path, or start with the
numbered level documents under `levels/`. For a short trip, use the independent
[tourist route](tourist/README.md); its quick-start subset does not require
completion of the core curriculum. Optional specialist branches are under
`extensions/`, with explicit core prerequisites.

For examination preparation, `hsk-readiness.yaml` overlays six HSK 1-6
readiness sections on the existing phases. Each section contains four modules,
eight lesson outlines, an explicit skill crosswalk, and external performance
gates. The mapping is preparation scaffolding, not a claim that course level
numbers are official HSK bands.

The authored `../../authoring/teaching/hsk-vocabulary.yaml` overlay moves or
adds evidence-required words without changing upstream IDs or source bands.
Its 2,762 entries make vocabulary cumulative at each HSK cutoff. The 390
canonical senses absent from the imported 2021-standard bands are recorded in
`../../authoring/hsk-reference-vocabulary.yaml`; 237 come from the pinned
Complete HSK Vocabulary source and 153 are attributed CC-CEDICT adaptations.

The checked-in `hsk-audit.yaml` now verifies all 5,400 official July 2026
vocabulary rows and all recognized legacy-list headwords in ten papers per
level at their mapped cutoffs. It still records the pass claim as unsupported:
the 459-item official grammar crosswalk is not reviewed, and no curriculum
inventory can establish timed learner performance.
HSK 7-9 remains orientation-only because the app cannot assess translation,
speaking, or source-faithful timed writing and the reference inventory is not
audited into separate levels 7, 8, and 9.

| HSK | Mapped course levels | Cumulative headwords | Official 2026 rows | Ten legacy papers: observed list words |
| --- | --- | ---: | ---: | ---: |
| 1 | 1-4 | 352 | 300/300 (100%) | 150/150 (100%) |
| 2 | 5-8 | 941 | 500/500 (100%) | 295/295 (100%) |
| 3 | 9-13 | 1,854 | 1,000/1,000 (100%) | 593/593 (100%) |
| 4 | 14-18 | 3,299 | 2,000/2,000 (100%) | 1,178/1,178 (100%) |
| 5 | 19-24 | 5,423 | 3,600/3,600 (100%) | 2,220/2,220 (100%) |
| 6 | 25-30 | 8,104 | 5,400/5,400 (100%) | 3,449/3,449 (100%) |

The official extraction uses PDF coordinates and verifies the numbered row
sequence and published incremental counts. Practice percentages cover only
legacy-list headwords recognized by deterministic longest matching; they are
not whole-paper comprehension scores. The 60 external papers and transcripts
are not redistributed because no open license was identified. The audit keeps
only URLs, retrieval dates, hashes, format/section metadata, and aggregate
non-substitutive coverage results.

The original [beginner track](beginner/README.md) remains available unchanged
as its standalone source. Its twelve modules form levels 1-4 in their original
order; the HSK overlay appends required vocabulary to those modules in the
generated core. No reference headword has been moved to another HSK folder or
renumbered.

## Level 1 whole-lesson model pilot

`content/level-01.yaml` defines the **whole lesson**, not a practice supplement.
Its thirteen lessons cover the three course-level-1 units, not the entire HSK 1
band. Each lesson has a readable label, unit and part number, title, Markdown
description, learning objectives, and an ordered list of sections. The app uses
these definitions for lesson titles, descriptions, content, and both views.
The source remains `reviewStatus: draft`; some supplemental vocabulary has
inventory instruction but not yet rich contextual examples.

Sections contain **vocabulary**, **grammar**, or reusable instructional models.
Vocabulary sections list readable word labels and distinguish `new` from
`review`. Grammar sections reference a readable construction label, give an
authored explanation, and supply grounded examples rather than importing
reference examples that may contain future vocabulary. Model sections reference
**concepts**, **phrases**, **conversations**, and **exercises** in teaching order.
Concepts cover sound-system knowledge, pragmatics, culture, and learning
strategies outside ordinary lexical senses and grammatical constructions.

### Readable labels, stable internal identity

`content/labels.yaml` is the registry connecting readable labels to existing
canonical sense and grammar IDs. **Readable labels are authoring references,
not learner-facing text. Opaque IDs belong in this registry, not in lesson
authoring.** Vocabulary cards and lesson, grammar, and concept details display
natural titles, Chinese, pinyin, and meanings rather than either identifier.
Existing IDs continue to key
progress, backups, and source attribution; adding a label does not create a new
word or migrate evidence. Vocabulary labels are also searchable in the
dictionary and Assistant catalog.

Use `syllableTone-syllableTone--sense` for vocabulary, for example:
`ni3--you`, `xue2-sheng5--student`, `hao3--greeting`, and `hao3--acceptance`.
Keep the disambiguator to one meaningful word where practical; use hyphens only
when needed to distinguish senses. Choose it deliberately, not by truncating
the first dictionary definition or appending an opaque sequence number.
Treat published labels as stable authoring references; do not silently rename
them when an English explanation changes or reassign them to another sense.

Pronunciation follows the **canonical dictionary form**, not tone sandhi.
Numbers 1-4 mark tones; 5 marks an unmarked/neutral source segment. Use lowercase
ASCII, `v` for the umlaut vowel, and a hyphen between source pinyin segments.
The source's isolated rhotic `r` is represented as `r5` (for example
`na4-r5--there`); this encodes the source segmentation, not an instruction to
pronounce a separate neutral-tone syllable. The generator verifies the
pronunciation portion against the canonical sense. The sense disambiguator
still needs human review. Grammar, lesson, concept, and other content labels
use meaningful kebab-case names, not pinyin.

Mandarin utterances contain `{ word: readable-label }` segments, punctuation,
and an English translation. Characters and dictionary pinyin are resolved from
the registry, so display and audio use the same sense. A schematic phrase entry
looks like this (its `lesson` must match a real lesson label):

```yaml
label: greeting-example
kind: phrase
lesson: first-introductions
title: A greeting
description: Address someone and greet them.
requires:
  grammar: []
  concepts: []
utterance:
  segments:
    - word: ni3--you
    - word: hao3--greeting
    - punctuation: "!"
  translation: Hello!
```

The enclosing version-2 source contains `level: 1`, `title`, `source: original-zh`,
`reviewStatus: draft`, `lessons`, and `models`. Author English explanations using
the safe Markdown subset: paragraphs, headings, unordered lists, emphasis, and
inline/fenced code. Raw HTML is not supported. Keep Mandarin in referenced
utterances instead of untracked prose.

### One definition, different views

**Visual lesson** and **Guided audio lesson** are selected near the top.
The visual view is paginated from the same whole-lesson model: an opening
description, goals, and linked outline; one vocabulary item per page; a grammar
explanation followed by one example per page; then one concept, phrase,
conversation, or exercise per page, always following the authored section order.
Numbered lesson URLs support previous/next navigation, direct links, and reload
without awarding progress. Reading practice has a separate final page.
The audio view narrates the same
description, goals, vocabulary meanings, grammar explanations and examples,
concepts, conversations, response gaps, and model answers in the same order.
Readable labels are references, not words to pronounce, so audio does not read
them aloud. The separate reading-recognition session remains available below
the lesson and is not the lesson definition.

Guided audio uses the existing saved English/Mandarin browser voices and offers
Start, Pause/Resume, Stop, Repeat section, and Next segment controls. No reading
is required during playback. Resume repeats the current segment. Online browser
voices may send spoken text to their provider. **Interactive audio** remains a
separate planned mode: microphone capture, privacy, and feedback semantics need
an explicit design before implementation.

`src/core/learning-content-schema.mjs` shares the strict authoring/runtime schema.
`scripts/generate-learning-content.mjs` verifies label uniqueness, canonical
resolution, pronunciation, all thirteen lessons in order, and exact preservation
of each lesson's new vocabulary/grammar inventory. Review material must be
earlier, all utterances must respect cumulative lesson cutoffs, and every model
must occur in its introduction lesson. Concepts must appear before dependent
models, including within the same lesson. Authors still need to review grammar
completeness, sense choice, idiomatic usage, translations, and teaching quality.
Definition order in the reusable model library does not establish teaching order;
the lesson's ordered sections do. Mechanical containment does not establish
these qualities or predict an exam pass.

Run `npm run curriculum:generate` to create
`src/data/learning-content.generated.json`; `npm run curriculum:check` verifies
it alongside the unchanged curriculum projection. Do not edit generated JSON.
Viewing, listening, or revealing an exercise answer does not award progress.
Explicit **Add to learning set** and the separate reading-practice controls keep
their existing behavior and canonical IDs. No pilot view marks concepts mastered,
assesses speech, or changes the HSK readiness verdict.

## Six phases, thirty visible levels

| Phase | Levels | Planned new headwords | Focus |
| --- | --- | ---: | --- |
| First exchanges | 1-4 | 200 | Short practical interactions |
| Everyday life | 5-8 | 500 | Broader participation in familiar situations |
| Stories and conversations | 9-13 | 800 | Connected accounts, explanations, and exchanges |
| Explanation and problem-solving | 14-18 | 1,100 | Less predictable problems and broader topics |
| Analysis and argument | 19-24 | 1,400 | Evidence, qualifications, and structured arguments |
| Nuance and interpretation | 25-30 | 1,800 | Precision, implication, register, and synthesis |

These are planning targets, not quotas or earned competencies. Actual counts
are generated in `inventory.yaml`. A headword counts once for breadth, even
when several of its senses are taught. Additional meanings deepen the
curriculum without inflating the number of distinct headwords.
Routes can overlap, so do not sum their inventories as unique learner vocabulary.
Phase folders use numeric ordering prefixes, from `1-first-exchanges` through
`6-nuance-interpretation`. Their semantic phase IDs remain unchanged.

Every level has a name, two to four observable goals, prerequisites, and a
checkpoint task. The checkpoint's criteria are those specific goals. The tutor
instantiates the task with fresh combinations of taught material, keeps answer
keys separate, and records the learner's assistance and modality. A completed
module alone is not evidence that the level goals have been demonstrated.

Later phases contain more material and therefore more modules. Newly selected
vocabulary is grouped by authored level and topic, with at most 25 new senses
per module; grammar practice groups contain at most three new constructs.
These are multi-lesson modules, not demands to learn 25 words in one sitting.
Start with about 5-8 new senses per lesson and adjust to retrieval performance.
Within a level, vocabulary modules precede the new grammar practice they support.
Earlier grammar remains available throughout the vocabulary work.

## Understanding is per item and per modality

`mastery.yaml` defines four evidence-based stages:

| Stage | Observable goal |
| --- | --- |
| Recognition | Distinguish the intended form and meaning from plausible alternatives |
| Contextual understanding | Interpret an unfamiliar use and a relevant contrast |
| Supported use | Produce an original, appropriate response with task support |
| Independent use | Select and use the item without an item-specific cue, including later retrieval |

Unassessed is not a failing or passing score; it means suitable evidence is
absent. Track reading, listening, typed production, spoken production, and
handwriting separately. Text cannot establish listening or pronunciation.
Keep evidence about the precise vocabulary sense, construction, or phrase ID.
Do not transfer it to every meaning of a headword or automatically award every
earlier stage after one successful answer.

Recognition and contextual understanding apply to receptive evidence; supported
and independent use apply to productive evidence. A core level's default
`independent-use` target is a productive goal, not an instruction to assign a
production stage to reading or listening. Receptive evidence can demonstrate
contextual understanding independently of productive control.

A learner-facing progress display can show the current numbered level, named
goals demonstrated, headword breadth, sense/construction stages, and later
retention. Distinguish **introduced**, **understood**, and **independently used**.
The generated inventory is not a learner progress file and contains no
fabricated observations or mastery scores.

Advancement need not wait for perfect mastery of every introduced item.
Demonstrate the named goals, sample essential prerequisites in fresh tasks,
and carry fragile items into review. Revisit a judgment when later evidence
contradicts it. This is an authored teaching rubric, not a psychometric scale,
an exam-score crosswalk, or a conversion from the shared tutor rubric's numbers.

## Optional extensions

| Branch | Core prerequisite | Default item goal |
| --- | --- | --- |
| Professional and organizational language | Through level 18 | Independent use in selected tasks |
| Digital and technical terminology | Through level 18 | Contextual understanding |
| Scientific terminology | Through level 24 | Contextual understanding |
| Literary and historical language | Through level 24 | Contextual understanding |

These are independent branches, not a mandatory seventh phase. They do not
establish professional, engineering, scientific, or clinical qualification.
An unselected dictionary meaning remains reference material, not a hidden
course requirement or an automatic assignment to an advanced tier.

## Data layout and entry format

| Path | Role |
| --- | --- |
| `program.yaml` | Authored phases, level goals, checkpoint tasks, topics, and branch prerequisites |
| `hsk-readiness.yaml` | HSK 1-6 sections, skill modules, lesson objectives, official format links, and mock-test sequence |
| `hsk-audit.yaml` | Hash-pinned official/legacy vocabulary and practice-paper comparison, verdict, and limitations |
| `hsk-grammar-crosswalk.yaml` | Official grammar counts, reviewed mapping status, and conservative coverage policy |
| `mastery.yaml` | Item-level evidence rubric and modality boundaries |
| `core/sequence.yaml` | Generated phase/level/module hierarchy |
| `levels/01/sequence.yaml` through `levels/30/sequence.yaml` | Individual levels with goals and prerequisites |
| `core/*.min.yaml`, `levels/*/*.min.yaml`, `phases/*/*.min.yaml` | Ordered introduction inventories |
| `extensions/*/sequence.yaml` and compact files | Optional branch material |
| `tourist/plan.yaml` | Authored route selections and original phrase components |
| `tourist/sequence.yaml` and compact files | Full travel route |
| `tourist/quick-start/` | Self-contained essential prefix of the travel route |
| `inventory.yaml` | Coverage counts and explicit lexical-prerequisite adjustments |

Vocabulary entries have exactly `{id, ch, pr, ds}`; grammar entries have
`{id, ch, ds}`. Original tourist phrases also use `{id, ch, pr, ds}`, with a
separate component-ID mapping in their expanded route. Each compact mapping
occupies one line. Embedded introduction and review entries contain the same
fields and values as their canonical compact entries. `pr` is the individual
sense's pinyin, never a headword's combined readings. Grammar templates omit
pronunciation.

Generated program, level, extension, and route containers use
`schema_version: 3` and an explicit `kind`. Levels and branches name their
prerequisite level IDs; their compact files contain new local introductions,
not a copy of every prerequisite. The preserved beginner sequence remains
version 2. Both use the same entry mappings. The separate HSK-1 reference
compact files still use the older `[id, token]` representation.

Shared IDs carry across routes. A tourist may encounter a sense before its
core level; evidence about that same sense and modality remains useful later.
This does not mark a whole core level completed or establish mastery of
related constructions.

## Authoring and regeneration

`../authoring/teaching/vocabulary.yaml` contains explicit sense selections:
`id`, `level`, `topic`, and `ds`. A numeric destination selects a core level;
a branch name selects an optional extension. These are authored pedagogical
placements, not translations of upstream HSK numbers.

`../authoring/teaching/hsk-vocabulary.yaml` is a second authored placement
layer used only where current official or practice evidence requires an item by
an earlier HSK cutoff. `../authoring/hsk-reference-vocabulary.yaml` supplies
the small set of canonical senses absent from the imported reference bands.
These files do not rewrite or relabel upstream HSK assignments.

`../authoring/teaching/grammar.yaml` adds `ch` and `anchors` to the same
placement fields. Anchors are precise vocabulary sense IDs needed for the
construction, not every incidental word in its reference examples.
They are not an exhaustive segmentation of fixed grammatical forms. Where
the dictionary lacks a suitable sense, the existing grammar item can introduce
the form itself without a counterfeit vocabulary ID; see
[grammar coverage notes](grammar-notes.md).
`../authoring/teaching/support.yaml` supplies labels for any additional
tourist or grammar-support senses.

The importer extends `../reference-senses.yaml` with the selected meanings
from the pinned dictionary source. Existing canonical sense labels and all
original parent metadata remain authoritative. New grammar annotations enrich
the program's in-memory reference index; they do not rewrite HSK grammar files.
Do not edit generated views as the sole record of a change.

Lexical dependencies can require an authored vocabulary placement earlier
than originally selected. Such moves, or added support senses, are recorded
under `prerequisite_adjustments` in `inventory.yaml`; the IDs and source bands
do not change. An optional branch can introduce a needed shared sense without
requiring an unrelated branch. Reviews use only already introduced material.
Generated same-topic review selections are seeds for the tutor, not a complete
or personalized spaced-review schedule.

From the repository root:

```powershell
python scripts\import_chinese_curriculum.py
python scripts\generate_chinese_program.py
python scripts\generate_chinese_program.py --check
python scripts\audit_hsk_readiness.py --check
python scripts\validate_curriculum.py --language chinese
python -m unittest discover -s scripts -p "test_*.py"
```

To reproduce the external-material portion, install the pinned Python
requirements and Xpdf/Poppler's `pdftotext`, then
run `python scripts\audit_hsk_readiness.py --refresh --materials-dir <folder>
--download`. Add `--write` only after reviewing source hashes, extraction
warnings, and the generated differences. The command downloads source files to
the supplied folder; copyrighted practice papers are never committed.

The full importer verifies its pinned source before producing any output.
The program-only generator works offline from checked-in references and
authored selections. `--check` never writes. Unknown IDs, conflicting labels,
invalid prerequisites, empty levels/branches, missing phrase components, and
stale views are errors rather than success-shaped fallbacks.

## Limitations and attribution

The selection, level goals, grammar annotations, and travel phrases are
AI-authored teaching material requiring human linguistic and pedagogical
review. Source dictionary glosses and pronunciations retain known editorial
limitations. Structural consistency cannot establish idiomatic usage, a
learner's ability, or completeness for every situation.

Reference grammar examples can contain supporting words not yet taught in
this route. Adapt them to the learner's cumulative vocabulary or gloss the
support explicitly. A lesson, including its new examples, corrections, and
distractors, must retain English support and must not imply an audio assessment
when only text was observed.

The Chinese source attribution and applicable CC-BY-SA obligations remain.
Redistribute derived compact views with `../sources.yaml`, the Chinese README,
and the relevant license notices. Original phrase IDs use the `zh-tourist-p`
namespace and are not fabricated dictionary or official syllabus entries.
