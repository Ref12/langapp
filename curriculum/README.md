# Bilingual teaching curricula

This collection supplies level-organized vocabulary, grammatical constructs,
bilingual examples, teaching sequences, and assessment tasks for an AI tutor.
It is a reference curriculum, not a set of copied textbooks or official exam
papers. Read each language's README for its actual coverage, standard version,
source methodology, and reuse conditions before using the data.

## Organization

| Language | Reference directories, in level order | Level scheme |
| --- | --- | --- |
| Chinese | `chinese/hsk-1` through `chinese/hsk-6`, then `chinese/hsk-7-9` | HSK 3.0, 2021 educational-standard-derived; advanced 7-9 material is pooled |
| Korean | `korean/topik-1` through `korean/topik-6` | TOPIK I: grades 1-2; TOPIK II: grades 3-6 |
| Japanese | `japanese/jlpt-n5` through `japanese/jlpt-n1` | JLPT, with N5 first and N1 last |

`catalog.yaml` records reference-level order, separate `teaching_tracks`, and
the Chinese `teaching_program`. For practical Mandarin, use the
[six-phase, thirty-level program](chinese/teaching/README.md) or the
[standalone tourist route](chinese/teaching/tourist/README.md). These select
senses across reference levels rather than treating HSK folders as lesson order.
The original beginner track is preserved as the program's first four levels.
Numbers in different schemes are
**not** interchangeable proficiency measures or automatic CEFR equivalents.
In particular, distinguish the Chinese 2021 educational standard from the
later revised examination syllabus; a shared HSK 3.0 label does not make their
word lists identical. Each language README identifies the version actually used.

Every level contains:

| File | Purpose |
| --- | --- |
| `vocabulary.yaml` | Target forms, pronunciation where provided, English meanings, and provenance |
| `grammar.yaml` | Patterns with English meanings, brief notes, and translated examples |
| `syllabus.md` | Prerequisites, teaching blocks, communicative outcomes, and level-specific exit tasks |

The Chinese HSK-1 pilot also has `vocabulary.min.yaml` and `grammar.min.yaml`:
derived lists of `[id, token]` pairs for compact presentation and AI selection.
They do not replace the expanded teaching data or its attribution.

Each language also has `sources.yaml`, a coverage README, and any necessary
license notices. Sources distinguish imported material, reference-only official
descriptors, and original AI-authored teaching material.

Some languages retain `upstream` inputs, import reports, or editable authoring
tables for reproducibility. Raw source inputs and unmodified legal notices are
not lesson-ready material and may contain untranslated technical annotations.
Use the bilingual level files, not the provenance files, as tutor lesson inputs.

## Inventory snapshot

| Collection | Vocabulary entries | Grammar constructs | Translated examples | Level syllabi |
| --- | ---: | ---: | ---: | ---: |
| [Chinese](chinese/README.md) | 10,969 | 185 | 370 | 7 |
| [Korean](korean/README.md) | 11,028 | 216 | 432 | 6 |
| [Japanese](japanese/README.md) | 7,828 | 225 | 450 | 5 |
| **Total** | **29,825** | **626** | **1,252** | **18** |

These are inventory entries, not necessarily distinct spellings: Korean retains
separate dictionary records and Japanese distinguishes lexeme-reading pairs.
All instructional vocabulary has English meanings; every grammar construct has
an English functional equivalent and at least two original translated examples.
See the language READMEs for source-specific deduplication and exclusions.

## Coverage and authority

Vocabulary inventories are broader than the authored grammar teaching sequences.
The presence of every level directory does **not** imply that every possible
word, construction, sense, or exam topic is represented.

Modern JLPT does not publish an exhaustive official vocabulary/grammar syllabus.
Treat community JLPT lists as study-level estimates, not guaranteed exam scope.
Likewise, TOPIK grade descriptors do not establish an official grade-by-grade
lexical inventory; any estimated placement must remain visible to the tutor.
Do not convert source difficulty bands into purported official test levels.

Files normally introduce a level's new entries. To assemble a higher level's
cumulative reference inventory, load earlier levels as well; inspect the language notes for any source
overlap. Homographs and distinct readings/senses need not be the same learning
item. Row counts are inventory counts, not a learner's demonstrated vocabulary
size. Grammar selections and examples are teaching aids, not official lists.

Reference-level membership is not a recommendation to teach every sense of a
headword at that stage. The Mandarin beginner track separately specifies
introduction order and review by sense ID. Coffee and basic colors can appear
early without rewriting their original reference assignments; unselected rare
meanings remain reference data, not course requirements.

All authored examples and level estimates require language-expert review before
being presented as professionally reviewed material. Structural validation
cannot establish naturalness, translation accuracy, pronunciation correctness,
or level appropriateness.

## Data contract

Maintained data files use UTF-8 YAML with `.yaml` extensions. Vocabulary, grammar,
and sources are lists of mappings; the catalog and reports retain their existing
mapping/list structures. Preserve entry order and IDs. Use a safe YAML parser;
the shared Python loader rejects duplicate mapping keys.

Vocabulary fields are strings, including empty optional values (`''`). Keep dates
and numeric-looking text quoted when they are strings; report counts and catalog
versions remain numbers. Do not infer types from a field's spelling. The shared
writer handles quoting and emits Unicode, block-style YAML in stable field order.

Upstream snapshots, download locks, TSV/PSV authoring inputs, and license files
remain in their original formats. Historical filenames in preserved notices
refer to the corresponding YAML outputs after this format-only migration.

### Vocabulary

Each vocabulary mapping contains these nine base fields:

```text
id,target,reading,english,part_of_speech,topic,source_id,source_entry,level_basis
```

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier within the language collection |
| `target` | Word or lexicalized phrase in the target language |
| `reading` | Pronunciation: Chinese pinyin or Japanese kana; optional for Korean |
| `english` | English equivalent or sense gloss; multiple senses can be retained |
| `part_of_speech` | Source label, where available; blank does not mean "noun" |
| `topic` | Teaching domain, where available; blank means unclassified |
| `source_id` | Exact ID in that language's `sources.yaml` |
| `source_entry` | Upstream entry identifier or URL, where available |
| `level_basis` | Basis of placement: named source/version or explicit teaching estimate |

An empty optional field means the source did not provide that metadata. Do not
invent pronunciation, topics, or word classes just to fill a field. English
glosses are sense hints, not interchangeable translations in every context.
Phrases use this same format rather than requiring a separate phrase store.

#### HSK-1 sense-level pilot

Chinese `hsk-1/vocabulary.yaml` retains its 506 headword records and their original
IDs and adds a `senses` list to each. Each sense has `id`, `reading`, `english`,
`source_sense_ids`, and a curated `disambiguator`. Its **1,644 canonical senses**
represent all **2,012 usable source definitions**, including proper names, rare
uses, and specialized meanings, not just beginner-relevant uses. Explicit groups combine synonymous
English renderings of the same word and reading into one learning sense: for
example, the source's "father", "dad", "pa", and "papa" for 爸 are one sense, not
four. Grouped glosses and their source-derived IDs are preserved in expanded YAML.
Exact duplicate reading/meaning pairs from script variants are emitted only once.
Pronunciation annotations such as "also pr." are not separate learning items.

Tokens are derived without inference:
`target + "(" + sense.reading + ")/" + sense.disambiguator`.
Pronunciation is the individual sense's pinyin, not the headword's combined
list of readings.
For example, the headword ID `zh-hsk1-00001` groups these distinct learning items:

```yaml
- [zh-hsk1-00001-s001, 爱(ài)/to love]
- [zh-hsk1-00001-s002, 爱(ài)/affection]
```

Each HSK-1 reference compact file is a YAML sequence of two-string arrays, one pair per line:
`[id, token]`. There are no headers, examples, or provenance fields in these
derived views. Resolve a selected ID against the expanded file for its full
meaning, examples where available, and source. A token is an identifier
with an English sense hint, not necessarily a complete translation.

The explicit disambiguator is trimmed, single-line English of at most 64
characters; `/` is reserved for the sole form/meaning separator. Tokens must be
unique within the level, including distinctions between otherwise identical
meanings with different readings. Labels can change without changing IDs.
Existing headword IDs remain grouping/reference IDs; do not transfer old
headword mastery to every child sense. Record new evidence by sense ID.

Only HSK-1 uses this extension; other levels retain the nine-field schema.
Chinese `reference-senses.yaml` incrementally adds selected sense-addressable
records from other bands without modifying their original HSK files. These
records use the same expanded schema and must exactly preserve their source
headword metadata. Teaching tracks resolve both sources of sense IDs.
See the [Chinese README](chinese/README.md#compact-hsk-1-pilot) for authoring,
generation, and source-revision constraints.

#### Beginner teaching entries

The separate Mandarin beginner track uses one-line mappings instead of combined
tokens: vocabulary has `{id, ch, pr, ds}` and grammar has `{id, ch, ds}`.
`ch` contains the Chinese form or construction, `pr` contains sense-specific
pinyin, and `ds` contains the English disambiguator. Abstract grammar templates
omit pronunciation. The version-2 sequence embeds identical mappings for both
introductions and reviews. Its IDs, order, and instructional metadata are
authored; the other entry fields are synchronized from expanded references.
`generate_teaching_track.py` updates the sequence and compact files together,
and `--check` detects stale entries without modifying any files.

The complete practical Mandarin program uses those same entry mappings in
version-3 program, level, extension, and tourist-route containers. Each
numbered level has observable goals and a checkpoint; per-item recognition,
understanding, supported use, and independent use are specified separately in
`chinese/teaching/mastery.yaml`. Coverage counts are not learner mastery or
competency scores. Use `generate_chinese_program.py` for the complete program
and its generated inventories, including the tourist quick-start subset.

### Source-neutral practical programs

`scripts\generate_practical_program.py` supplies the common scheduling and
view generation. The Mandarin compatibility wrapper retains its existing
entry points, beginner order, inventory format, and flat level paths.
New language profiles use `teaching\phases\N-slug\levels\NN`, with global
level numbers 01-30. The six phase ranges are 1-4, 5-8, 9-13, 14-18,
19-24, and 25-30.

The learner-facing product remains the normalized vocabulary/construction
lists, meaningful teaching order, and generated views. Expanded provenance,
source snapshots, form annotations, and crosswalks are separate authoring or
build inputs, not extra compact fields or a requirement to ship an exhaustive
dictionary mirror.

Language adapters export `ADAPTER` from their registered module:
`japanese_program_adapter`, `korean_program_adapter`,
`french_program_adapter`, `russian_program_adapter`, or
`spanish_program_adapter`. The small static allowlist is in
`scripts\practical_program_registry.py`; catalog YAML cannot import code.
These registrations do not enable unfinished languages or programs.

The types in `scripts\practical_program_types.py` define the build contract:

| Type or method | Contract |
| --- | --- |
| `ProgramProfile(language, prefix, level_layout, phrase_mode, inventory_schema)` | New profiles default to `phase-nested`, `realizations`, and `identity-aware`; the Chinese wrapper retains its explicit legacy settings |
| `ReferenceBundle(vocabulary, grammar, lexical_identity, provenance, source_sense_identity, reading_identity, spelling_identity)` | Canonical dictionaries and explicit counting/provenance identities |
| `SeedUnit(level, topic, unit)` | An explicitly assigned, canonical-entry beginner module; seeds form an ordered initial level prefix |
| `ProgramData(inputs, references, seeds=(), construction_dependencies={}, source_outputs={})` | Authored program data, validated indexes, optional seeds, construction prerequisites, and additional deterministic build artifacts |
| `adapter.load(root)` | Return `ProgramData` after validating selected source records, readings, forms, and provenance |
| `adapter.validate_phrase(phrase, context)` | Return a strict `PhraseAnalysis`; validate language-specific surface forms and their licensing, or raise `ValueError` |
| `program_outputs(root, data, adapter)` | Build and validate the complete path-to-text output mapping without writing |
| `generate(root, adapter, check=False)` | Generate views, or reject stale/missing views without writes when `check=True` |

`inputs` has `program`, `mastery`, `vocabulary`, `grammar`, `support`, and
`tourist` members, following the authored Mandarin model's field shapes but
using the language's own IDs, content, and ordering. The optional `load_inputs`
helper reads these conventional files. Empty seeds permit placements at every
level from 1 through 30; no language must imitate twelve Mandarin modules.
Adapters using seeds can include their beginner sequence/compact views in
`source_outputs`, using `generate_teaching_track.teaching_outputs` with
explicit `language` and `prefix` keyword arguments. All extra output paths
must remain within the language root and cannot collide with generated views.

Vocabulary values contain exactly `{id, ch, pr, ds}` and construction values
exactly `{id, ch, ds}`. Dictionary keys must equal embedded IDs. `ds` is a
trimmed, one-line English hint of at most 64 characters, not an automatically
truncated first gloss. Introductions and reviews embed identical full entries.
Stable local IDs need not resemble an upstream identifier or end in `-sNNN`.
Mandarin's existing stricter source-ID format remains local to its adapter.

Each vocabulary ID has explicit lexical, source-sense, reading, and spelling
identities. Headword breadth uses lexical identities, not ID parsing, written
form strings, senses, or inflections. Identical spelling identities may span
distinct homographs; identical reading identities must resolve to the same
reading text. A source-sense identity belongs to one lexical identity.
New inventories report the four measures separately; their interpretation
depends on the adapter's documented identity policy, not an implied learner
word count. Source-specific extra audits can be emitted via `source_outputs`
without expanding this common schema.

Expanded `provenance` covers every vocabulary and construction ID. Its records
include nonempty `source_id` and `source_entry` fields and retain any needed
source-specific locators, restrictions, or authoring notices. These locators
are distinct from the stable local ID. The adapter validates them against its
selected retained inputs; the engine does not parse dictionary glosses or
invent sense boundaries. Original authored labels/constructions must be
identified honestly, and copied/adapted content retains its applicable notices.

`construction_dependencies` maps a construction ID to earlier or explicitly
co-taught prerequisite IDs. The graph must have known IDs and no cycles.
Lexical `anchors` and construction prerequisites are checked for the core,
optional branches, and tourist route. No later or unrelated branch can satisfy
a prerequisite. A construction may teach a fixed marker absent from the
dictionary without fabricating lexical credit.

#### Inflected phrases and fixed constructions

New-language authored phrases retain the four compact fields plus `items`
(vocabulary sense IDs), `grammar` (construction IDs), and ordered
`realizations`. Each realization contains `ch`, `pr`, `items`, `grammar`, and,
when not a canonical lexical form, an explicit adapter-validated `form_id`.
An arbitrary string is not an approved inflection or grammatical fixed form.
The adapter must resolve each `form_id` against its source-backed or honestly
authored form annotations, check the intended sense and construction, and
reject unlicensed forms. It owns morphology, lexical stress/IPA/kana policy,
elision, contractions, and meaningful language-specific word boundaries.

`PhraseContext` supplies `profile`, `references`, `introduced_vocabulary`,
and `introduced_grammar`. Return
`PhraseAnalysis(items, grammar, realizations)`, using tuples and
`SurfaceSegment(ch, pr, items, grammar, form_id=None)`. The result must agree
with the authored component IDs and realizations. The engine always invokes
the adapter checker and independently checks introduction closure, exact
component-link coverage, and complete phrase reconstruction. Returning `True`,
`None`, or an empty successful-looking analysis cannot disable validation.

Written reconstruction normalizes Unicode to NFC and ignores whitespace and
ordinary sentence punctuation, but preserves apostrophes, hyphens and accents.
Reading reconstruction normalizes NFC and ignores whitespace only; it does not
strip lexical stress, IPA marks, or other pronunciation distinctions.
Adapters must additionally reject language-specific boundary changes that this
basic written normalization cannot distinguish. Grammar-only segments require
licensed `form_id` links. The generated expanded `phrase_components` retain
vocabulary IDs, grammar IDs, and realizations; the compact phrase stays four
fields. Mandarin continues using its existing literal vocabulary validator.

#### Independent reference inventories and activation

Existing Chinese, Korean, and Japanese reference bands remain unchanged.
A new independent language uses `reference_inventory: reference` rather than
inventing exam bands, for example:

```yaml
- id: french
  standard: Independent practical teaching inventory; not an exam specification
  reference_inventory: reference
  teaching_program: fr-practical
```

This is a schema example, not a declaration that the French program is enabled.
Its `reference` directory contains bilingual `vocabulary.yaml`,
`grammar.yaml`, and an explanatory `README.md`, not an artificial exam-level
syllabus. Vocabulary uses the shared reference fields; optional expanded
`senses` are checked by the language adapter rather than Mandarin's sense-ID
parser. Source notices remain in the language's `sources.yaml`.

The shared owner activates catalog entries only when their artifacts are
present. Default validation visits active catalog languages. Explicitly
requesting an inactive language fails, as does an enabled program with a
missing adapter or stale/missing views; neither case passes an empty inventory.

### Grammar

Every entry has `id`, `pattern`, `english`, `note`, `examples`, `source_id`,
and `level_basis`. `pattern` is the target-language construction, and `english`
states its function or meaning. `examples` contains at least two objects, each
with `target` and `english`; an additional `reading` may be present.

Notation such as `N`, `V`, `A`, `S`, parentheses, slashes, and ellipses describes
slots or alternatives, not necessarily literal words to say. Use the entry's
note and instantiated examples to interpret it. Do not teach a grammar heading
as though it were a complete natural sentence.

The HSK-1 pilot also adds `token_form` (concise construction notation) and
`disambiguator`. Its token is `token_form + "/" + disambiguator`; its existing
grammar IDs are unchanged. The expanded `pattern`, notes, and examples remain
the teaching reference.

### Sources

Each source has `id`, `title`, `url`, `license`, `usage`, `attribution`, and
`retrieved_on`. Additional fields can record revisions, checksums, or upstream
rights. A reference citation is not a grant of copying rights. Preserve the
source of each imported row; authored examples have their own source identity.

## Using the collection with an AI tutor

1. Load the language README, sources, and the selected level's syllabus. Establish
   script/reading prerequisites and diagnose the learner's actual abilities
   instead of inferring them solely from a test grade.
   For a declared teaching track, use its README and `sequence.yaml` instead of
   interpreting a reference-level syllabus as the teaching order.
2. Load that level and prerequisite vocabulary/grammar. Select a coherent
   lesson of about 8-15 new words and 1-3 constructions rather than dumping an
   entire level into a prompt. For a reading-first lesson, prioritize items
   present in the learner's passage.
   For HSK-1, the compact files can be used for selection first; resolve selected
   sense/grammar IDs in the expanded files before teaching.
3. Teach the example's intended sense and register. Show the target and English
   together initially, then conceal the English during recall. When generating
   extra phrases, sentences, explanations with target-language fragments, or
   distractors, retain an English equivalent for **every** such fragment.
4. Progress from comprehension and matching to cloze, ordering, translation,
   role-play, and a short unseen passage. Model more than one context and
   contrast easily confused constructions; do not simply memorize the supplied
   example pair.
5. Track learning by item ID, sense, skill, hints used, and next review date.
   Revisit material after a delay and in new contexts. Recognition, reading,
   listening, writing, and speaking are separate evidence.
6. Use the level's exit tasks and the shared rubric in `TUTOR_GUIDE.md`. Advance
   based on unaided transfer, not on seeing every row or repeating an answer.

Do not invent official exam equivalence, audio, pronunciation scores, or human
review status. Audio is not bundled: listening and speaking tasks need a suitable
recording, validated text-to-speech, or an instructor. A text-only session cannot
certify auditory comprehension or pronunciation.

## Inspecting and maintaining the collection

From the repository root, with Python 3.10 or newer:

```powershell
python -m pip install -r scripts\requirements.txt
python scripts\validate_curriculum.py
python scripts\validate_curriculum.py --language japanese
python scripts\test_curriculum_yaml.py
python scripts\generate_curriculum_tokens.py --check
python scripts\generate_teaching_track.py --check
```

The validator uses the pinned PyYAML dependency and checks required files,
directory order metadata, YAML record structure, nonempty bilingual fields, IDs,
source references, source dates,
and grammar examples. It prints counts by level and fails on structural errors.
For HSK-1 it also checks sense identities, token ambiguity, and exact agreement
between expanded and compact files.
Declared teaching tracks are also checked for valid sense references,
introduction/review ordering, unchanged source metadata, and current compact views.
It does not make a pedagogical or licensing certification.

Language-specific READMEs document any reproducible import command and its
pinned inputs. Inspect source and license changes before updating; an importer
can overwrite vocabulary outputs. Keep item IDs stable for the same source
revision, and explicitly migrate saved learner progress when IDs or senses
change. Do not renumber existing learning items merely to sort them.

## Rights

There is no blanket license that overrides upstream rights. Follow each
language's README, source records, and bundled notices, including attribution
and share-alike requirements for relevant imported data. An upstream code
license does not automatically license that repository's third-party dictionary
or course content. Reference-only sources are linked, not republished as
textbooks, syllabi, or examination papers.
