# Bilingual teaching curricula

This collection supplies level-organized vocabulary, grammatical constructs,
bilingual examples, teaching sequences, and assessment tasks for an AI tutor.
It is a reference curriculum, not a set of copied textbooks or official exam
papers. Read each language's README for its actual coverage, standard version,
source methodology, and reuse conditions before using the data.

## Organization

| Language | Directories, in learning order | Level scheme |
| --- | --- | --- |
| Chinese | `chinese/hsk-1` through `chinese/hsk-6`, then `chinese/hsk-7-9` | HSK 3.0, 2021 educational-standard-derived; advanced 7-9 material is pooled |
| Korean | `korean/topik-1` through `korean/topik-6` | TOPIK I: grades 1-2; TOPIK II: grades 3-6 |
| Japanese | `japanese/jlpt-n5` through `japanese/jlpt-n1` | JLPT, with N5 first and N1 last |

`catalog.json` records the traversal order. Numbers in different schemes are
**not** interchangeable proficiency measures or automatic CEFR equivalents.
In particular, distinguish the Chinese 2021 educational standard from the
later revised examination syllabus; a shared HSK 3.0 label does not make their
word lists identical. Each language README identifies the version actually used.

Every level contains:

| File | Purpose |
| --- | --- |
| `vocabulary.csv` | Target forms, pronunciation where provided, English meanings, and provenance |
| `grammar.json` | Patterns with English meanings, brief notes, and translated examples |
| `syllabus.md` | Prerequisites, teaching blocks, communicative outcomes, and level-specific exit tasks |

Each language also has `sources.json`, a coverage README, and any necessary
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

Files normally introduce a level's new entries. To teach a higher level, load
the prerequisite levels as well; inspect the language notes for any source
overlap. Homographs and distinct readings/senses need not be the same learning
item. Row counts are inventory counts, not a learner's demonstrated vocabulary
size. Grammar selections and examples are teaching aids, not official lists.

All authored examples and level estimates require language-expert review before
being presented as professionally reviewed material. Structural validation
cannot establish naturalness, translation accuracy, pronunciation correctness,
or level appropriateness.

## Data contract

Files use UTF-8. Read CSV with a CSV parser, not by splitting on commas: meanings
can contain commas, quotes, and multiple senses. JSON grammar files and source
files are arrays, not newline-delimited JSON.

### Vocabulary

The CSV header is:

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
| `source_id` | Exact ID in that language's `sources.json` |
| `source_entry` | Upstream entry identifier or URL, where available |
| `level_basis` | Basis of placement: named source/version or explicit teaching estimate |

An empty optional field means the source did not provide that metadata. Do not
invent pronunciation, topics, or word classes just to fill a column. English
glosses are sense hints, not interchangeable translations in every context.
Phrases use this same format rather than requiring a separate phrase store.

### Grammar

Every entry has `id`, `pattern`, `english`, `note`, `examples`, `source_id`,
and `level_basis`. `pattern` is the target-language construction, and `english`
states its function or meaning. `examples` contains at least two objects, each
with `target` and `english`; an additional `reading` may be present.

Notation such as `N`, `V`, `A`, `S`, parentheses, slashes, and ellipses describes
slots or alternatives, not necessarily literal words to say. Use the entry's
note and instantiated examples to interpret it. Do not teach a grammar heading
as though it were a complete natural sentence.

### Sources

Each source has `id`, `title`, `url`, `license`, `usage`, `attribution`, and
`retrieved_on`. Additional fields can record revisions, checksums, or upstream
rights. A reference citation is not a grant of copying rights. Preserve the
source of each imported row; authored examples have their own source identity.

## Using the collection with an AI tutor

1. Load the language README, sources, and the selected level's syllabus. Establish
   script/reading prerequisites and diagnose the learner's actual abilities
   instead of inferring them solely from a test grade.
2. Load that level and prerequisite vocabulary/grammar. Select a coherent
   lesson of about 8-15 new words and 1-3 constructions rather than dumping an
   entire level into a prompt. For a reading-first lesson, prioritize items
   present in the learner's passage.
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
python scripts\validate_curriculum.py
python scripts\validate_curriculum.py --language japanese
```

The dependency-free validator checks required files, directory order metadata,
CSV structure, nonempty bilingual fields, IDs, source references, source dates,
and grammar examples. It prints counts by level and fails on structural errors.
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
