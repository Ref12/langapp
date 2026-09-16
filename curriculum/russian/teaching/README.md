# Practical Russian: teaching route and evidence

This is an original, English-supported practical curriculum, not a Mandarin
translation, an official word list, a CEFR/TORFL syllabus, or a promise of
examination readiness. **Phase, level, module, and item mastery are different
things.** The inventory describes teaching material, not a learner's ability.

## What the product is

The deliverable is **our normalized vocabulary and grammar lists, original
practice material, and authored teaching order**. Learners use the compact
records and ordered routes; an upstream dictionary export is not the course.
Select an intended sense for a practical purpose and place it by its goals
and prerequisites, not by source row position, an arbitrary frequency proxy,
or the first available English gloss.

Ingestion tables, source snapshots, and audit details are separate supporting
material. Retain the useful provenance needed to explain identities, selected
senses, stress/form readings, adaptations, and applicable rights; do not turn
unrelated dictionary cleanup into a prerequisite for publishing meaningful
teaching content. Original English labels and examples can be independently
authored with honest AI-assisted status. They must not be presented as source
quotations or as source-verified merely because the lemma has a citation.
The source-backed stress policy still applies to every published `pr`.

## Start and choose a route

Begin with [Cyrillic preparation](preparation.md). It introduces the writing
system and the limits of the stress-reading aid without creating a thirty-first
level. Then use `core\sequence.yaml` or the individual level sequences below
`phases\N-slug\levels\NN\`. Global level numbers run from `01` through `30`;
they do not restart at each phase. There is no prerequisite Mandarin course
or imported Mandarin beginner seed.

The [tourist route](tourist/README.md) is independently usable. Its first five
units form a self-contained quick start, not an invitation to skip unstated
core prerequisites. Four optional extensions can be taken after their
declared core prerequisites without completing any other extension.

## Six phases and thirty levels

| Directory | Global levels | Planned new lexical headwords | Practical emphasis |
| --- | --- | ---: | --- |
| `1-first-exchanges` | 01–04 | 200 | Contact, repair, objects, meals, directions, and help |
| `2-everyday-life` | 05–08 | 500 | Household needs, transactions, care, travel, and coordination |
| `3-stories-conversations` | 09–13 | 800 | Events, perspectives, instructions, messages, and choices |
| `4-explanation-problems` | 14–18 | 1,100 | Unpredictable problems, cooperation, reports, systems, and proposals |
| `5-analysis-argument` | 19–24 | 1,400 | Evidence, institutions, scientific explanation, qualification, and synthesis |
| `6-nuance-interpretation` | 25–30 | 1,800 | Focus, register, implication, precision, interpretation, and projects |

The semantic phase IDs omit the directory's numeric prefix. The targets sum
to **5,800**, but are planning guides, not hard quotas or claims of achieved
breadth. Use the maintained generated `inventory.yaml` for actual counts and
prerequisite adjustments. A later phase needs useful additional material,
not padding made from inflections or unreviewed first dictionary meanings.

`program.yaml` gives each level an original title, two to four observable
goals, and a fresh checkpoint. The core progresses in order; each level after
level 1 depends on the preceding cumulative core material, expressed through
the generated level prerequisites. Construction-specific dependencies can be
earlier or co-taught within a level, never silently later. Level 1 begins after
orientation, with no hidden course-level requirement.

Early case work is organized by **meaningful governed frames**: a thing wanted,
a location, a destination, possession, absence, a recipient, and a means.
Gender, animacy, agreement, and verified irregular forms support these tasks.
Aspect and motion receive their own contrasts rather than being reduced to
English tense labels. Later work broadens both topic range and discourse
demands; it is not merely a longer list of inflection endings.

## Run a lesson, not an inventory dump

1. Choose a level goal and a named thematic module. A module introduces at
   most about 25 new senses or three new constructions and spans several
   lessons. Begin with roughly 5–8 new senses, fewer for difficult case,
   stress, agreement, or confusable-sense work.
2. Establish the intended meaning with English support, a useful case frame,
   and verified form readings where available. Teach necessary vocabulary
   before its new construction practice; an explicit fixed chunk can be
   introduced by the construction itself.
3. Contrast a meaningful alternative: location versus destination, animate
   versus inanimate object, activity versus achieved result, or polite versus
   familiar address. Do not turn every cell of a paradigm into a new item.
4. Ask for an original response with changed details, then reduce support.
   Gloss incidental example words and distractors instead of assuming that
   appearing in a reference example makes them prerequisites already learned.
5. Retrieve relevant earlier and fragile items on later days. Generated
   reviews are starting points for tutor selection, not a personalized
   spaced-repetition schedule.

Instantiate checkpoints with new combinations of taught material and keep
answer keys separate. Record the actual task, response, assistance, and
modality. For example, a changed destination should test a destination frame,
not whether the learner remembers a single entire directions sentence.
Advancement can follow demonstrated named goals while fragile items continue
in review; it does not permanently certify every introduced item.

## Mastery is per item and per modality

`mastery.yaml` retains the shared evidence architecture:

| Stage | Evidence sought |
| --- | --- |
| `recognize` | Distinguish the intended form and sense from plausible alternatives |
| `understand` | Interpret a new context, a relevant contrast, and later retrieval |
| `supported-use` | Produce an original appropriate response with recorded assistance |
| `independent-use` | Select and adapt the item without an item-specific cue, including later retrieval |

Unassessed means suitable evidence is absent, not a failing score. Recognition
and understanding are receptive; supported and independent use are productive.
Track reading, listening, typed production, spoken production, and handwriting
separately. A core productive goal does not assign a productive stage to a
reading answer.

Typed Cyrillic is not evidence of listening, stress placement in speech,
pronunciation, or handwriting. Those modalities require actual audio or
handwritten evidence and suitable evaluation. A correct fixed phrase does not
establish control of its whole case paradigm, every meaning of its words, or
all stages of mastery. Revisit judgments when later evidence disagrees,
retaining the earlier observations rather than fabricating a smooth progress
history. Inventory files contain no learner observations.

## Optional branches

| Branch | Declared cumulative core prerequisite | Default goal |
| --- | --- | --- |
| `professional` | Through level 18 | Independent productive use in selected requests, updates, and agreements |
| `technical` | Through level 18 | Contextual understanding of system descriptions and instructions |
| `scientific` | Through level 24 | Contextual understanding of assumptions, methods, and qualified findings |
| `literary` | Through level 24 | Contextual reading of literary or older expressions, with neutral paraphrase |

Each branch has its own nonempty construction inventory and source-selected
lexical support. It must introduce branch-local requirements without forcing
another branch or undeclared later core content. These routes establish no
occupational, engineering, scientific, clinical, or literary qualification.
Literary examples are original, not excerpts copied from protected works.

## Authored inputs and derived views

| Path relative to this directory | Responsibility |
| --- | --- |
| `program.yaml` | Authored model, level goals, checkpoints, topics, and branch declarations |
| `mastery.yaml` | Evidence rubric; no invented learner state |
| `preparation.md`, `grammar-notes.md` | Orientation and Russian-specific teaching limits |
| `..\authoring\grammar.yaml` | Original construction notes, bilingual examples, anchors, fixed forms, and dependencies |
| `..\authoring\tourist-draft.yaml` | Original situation units and phrases before source/form alignment |
| `..\reference\vocabulary.yaml` | Canonical normalized vocabulary list using exactly the nine standard fields, without inline source or morphology payloads |
| `..\reference\grammar.yaml` | Canonical normalized construction list produced from the original authoring |
| `..\build\lexical-records.yaml` | Separate selected raw source, sense, and morphology records supporting the normalized vocabulary |
| `..\build\linked-forms.yaml` | Separate approved lexical surface-form links and their verification data |
| `..\build\grammar-forms.yaml` | Separate construction-owned form support and reading provenance |
| `core\sequence.yaml`, `core\*.min.yaml` | Generated complete core route and introduction inventories |
| `phases\N-slug\levels\NN\sequence.yaml` | Generated global level with explicit prerequisites |
| `phases\N-slug\levels\NN\*.min.yaml` | New local introductions, not every inherited prerequisite |
| `extensions\<branch>\*` | Generated optional branch views |
| `tourist\plan.yaml` | Resolved canonical travel plan with source/sense/form alignment |
| `tourist\sequence.yaml`, `tourist\*.min.yaml` | Generated full route |
| `tourist\quick-start\*` | Generated independently closed five-unit prefix |
| `inventory.yaml` | Actual set-based counts and declared prerequisite adjustments |

The exact compact shapes remain **vocabulary/phrases `{id, ch, pr, ds}`**
and **grammar `{id, ch, ds}`**, one mapping per line using the shared
serializer. Introductions and reviews embed the same full canonical records,
not ID-only references or abbreviated substitutes. The English `ds` is
unambiguous and at most 64 characters; expanded authoring fields stay outside
the compact mappings. Construction templates intentionally have no `pr`.

Normalized references are our standard learning lists, not containers for
inline expanded source metadata. The `build` files retain the useful evidence
needed to validate selected identities, senses, forms, and readings. They are
kept separate from both normalized references and learner-facing compact
views; moving provenance there does not change the local authoring schemas.

`pr` is a source-backed Cyrillic **lexical-stress reading aid**, not pinyin,
romanization, IPA, audio, or connected-speech transcription. The adapter
mechanically changes a source vowel-following apostrophe to a combining acute
and preserves meaningful `ё`. It must not guess unresolved stress. Phrase
readings are documented assemblies of approved source/form readings, not
whole-phrase pronunciation supplied or verified by the dictionary.

Lexical identities, vocabulary senses, spellings, inflected forms, variants,
constructions, and phrases are counted separately. Additional senses,
inflections, aliases, and duplicate source rows add no lexical headwords.
True homographs can have distinct identities despite a shared spelling.
Aspectual lexical partners remain distinguishable; a conjugated form is not
another lemma. Core, tourist, and branch routes can overlap, so their totals
must not be added as unique breadth.

## Validation, sources, and honest limits

Edit original authoring inputs, not normalized references or compact views alone.
The Russian adapter resolves anchor lemmas to exact curated senses, checks
inflected surfaces and readings against the separate build records, and
provides normalized inputs to the neutral shared engine. Do not copy a
Mandarin generator or silently relax its validation
to make Russian appear complete. Use the Russian commands documented in
the [language README](../README.md), and run the existing local suite:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\russian_program_adapter.py --check
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B -m unittest discover -s scripts -p "test_russian_*.py"
```

The registered Russian adapter uses the shared generator. Its consistency
check is nonwriting and deterministic. Missing source stress or a correct sense is an
explicit dependency to resolve, not permission to invent a reading, assign
an unrelated sense, or delete essential fixed grammar.

The pinned OpenRussian TSV backup is the primary lexical source. It is an old
composite dataset with documented defects; source-backed means traceable,
not correct by guarantee. Retain OpenRussian/contributor and upstream
Wiktionary attribution, [source notices](../sources.yaml), and applicable
CC-BY-SA obligations with adapted dictionary views.
Those notices describe the material actually derived from the source; they
are not a blanket licensing statement about unrelated application code.

The instructional selections, English explanations, construction templates,
examples, phrases, and sequencing are original AI-assisted teaching work.
They are not copied source wording or source-certified teaching. Human
Russian-language and pedagogical review remains required. Structural tests
cannot certify idiom, every situation's coverage, a learner's ability, or
the quality of actual listening and speech.
