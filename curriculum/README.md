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

`catalog.yaml` records the reference-level order and any separate `teaching_tracks`.
For practical Mandarin, start with the
[beginner teaching track](chinese/teaching/beginner/README.md), which selects
senses across reference levels rather than treating HSK folders as lesson order.
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

#### Character-writing assets

The shared [character asset contract](CHARACTERS.md) defines exact Unicode keys,
256-codepoint YAML chunks, locale/style variants, ordered logical stroke paths,
same-path sampling, pinned sources/recipes, and separate drawable and visual
review coverage. Language-local assets live under `characters`; they do not
change word/sense identities or reference-level assignments. This milestone is
offline assets, tooling and preview support, not a production writing activity.
The contract also documents authoritative inventory extraction, modern kana and
Hangul foundations, explicit gaps, and no-write generation/validation commands.

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
If a language has a `characters` directory, its complete manifest, chunk and
coverage set is also checked against the current expanded inventory and local
source pins. Candidate assets may be mechanically valid without being visually
approved; use `scripts\validate_characters.py --require-release` for the stricter
release gate.
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
