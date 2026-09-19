# Curriculum v2

This is the living description of the v2 curriculum scheme. Extend it as new
content types and teaching structures are introduced. For now, v2 contains
Chinese vocabulary inventories; it does not yet define sections, modules,
lessons, grammar files, or assessments.

The v2 files are maintained separately from the existing curriculum outside
this folder. They are not generated compact copies of that curriculum, and
they are not currently connected to the app's lesson projection.

## Organization

Content is grouped by language. The current Chinese vocabulary is organized
by examination-alignment band:

```text
curriculum\v2\
  README.md
  chinese\
    hsk-1\vocabulary.yaml
    hsk-2\vocabulary.yaml
    hsk-3\vocabulary.yaml
    hsk-4\vocabulary.yaml
    hsk-5\vocabulary.yaml
    hsk-6\vocabulary.yaml
    hsk-7-9\vocabulary.yaml
```

Chinese alignment follows the **November 2025 HSK examination syllabus,
effective July 2026**, not the 2021 educational-standard inventory or legacy
HSK 2.0. The examination syllabus publishes a shared advanced vocabulary band
labelled **7-9**, without separate word-list cutoffs for levels 7, 8, and 9.
The combined directory reflects that source inventory; it does not collapse
the three proficiency levels or require a single advanced teaching level.

These directories describe reference membership, not a lesson sequence.
Teaching progression can later organize the vocabulary into smaller sections,
modules, and lessons without changing its source identities.

## Vocabulary files

Each `vocabulary.yaml` is an ordered YAML list with one compact mapping per
selected sense. Compact formatting is the normal authoring format; it does not
require a `.min` filename or a separate expanded copy.

```yaml
- {id: zh-hsk1-00384-s001, ch: 我, pr: wǒ, ds: 'I, me, my', lb: wo3--me}
```

Every entry has exactly these five nonempty string fields, in this order:

| Field | Meaning |
| --- | --- |
| `id` | Stable canonical identifier for the selected sense. Use it for references between curriculum records. |
| `ch` | Written target form; simplified Chinese in the current files. |
| `pr` | Pronunciation; syllable-separated citation pinyin with tone marks for Chinese. |
| `ds` | Concise English description of the selected meaning or use. |
| `lb` | Human-readable authoring label that distinguishes the sense. It is not learner-facing text. |

A spelling is not necessarily a single learning item. Distinct meanings,
readings, or grammatical uses can need separate entries, while closely related
synonymous glosses can share one entry. Numbered syllabus rows, written forms,
readings, and selected senses are therefore different counts.

Keep one mapping per line, preserve entry order, and quote values when YAML
requires it. Use UTF-8 without a byte-order mark and LF line endings.
File-header comments retain scope, attribution, and source caveats; they are
not additional entry fields. This five-field format is specific to v2 and
should not be confused with other `vocabulary.yaml` formats outside this folder.

## Incremental coverage and ordering

Each Chinese band file contains its additions, not a standalone cumulative
inventory. HSK 1 is the starting inventory; HSK 2 builds on it, and so on.
The advanced band builds on HSK 1 through HSK 6.

To obtain cumulative vocabulary for a band, combine its file with all earlier
band files. A later file can introduce a new sense of a spelling encountered
earlier, but must not repeat an already included sense. A repeated official row
may instead be accounted for by an existing entry.

Within each file, new numbered syllabus rows come first in official order,
with selected senses for a row adjacent. Newly assigned uses of earlier
headwords follow, in their original row order. This preserves the reference
ordering; it is not a claim that the same order is pedagogically optimal.

## Identifiers, labels, and pronunciation

Preserve matching canonical IDs and established labels. Both must be unique
across the Chinese v2 inventory. Do not deduplicate solely by `ch`, derive IDs
from file position, or repurpose an existing ID for a different meaning.
Renaming a file or moving a sense to a teaching unit does not change its ID.

An inherited `zh-hskN-...` ID records its original source inventory, not its
current examination band. New references use the allocated
`zh-hsk2026-ROW-sNNN` namespace, anchored to the original syllabus row.
Such a reference can identify an additional dictionary-backed sense or an
independently authored missing meaning; a new ID does not itself establish
which kind it is.

Chinese labels combine lowercase numbered citation syllables, joined with
hyphens, then `--` and a concise English discriminator: `wo3--me`.
Tone `5` denotes a neutral syllable, `v` represents `ü`, and an erhua suffix
uses a separate `r5` syllable. The pronunciation portion must agree with `pr`.

Use citation pronunciation rather than contextual tone sandhi, while retaining
genuinely lexical neutral syllables. A different lexical reading is not merely
a formatting correction. Keep disagreements between the syllabus and dictionary
explicit rather than silently changing a source identity or inventing a use.

## Sources and limits

Preserve each file's source URLs, edition, retrieval information, hashes,
attribution, and licensing notices. Existing Chinese source records and legal
notices remain in `curriculum\chinese\sources.yaml` and
`curriculum\chinese\licenses\`. Do not redistribute protected exam papers or
transcripts as curriculum content.

These are AI-assisted editorial vocabulary drafts, not an official English
sense list or independently proofread teaching material. Unresolved readings,
parts of speech, and source ambiguities remain explicit.

Vocabulary inventory coverage is **not exam readiness**. Claims of certification
or examination readiness must follow the evidence policy in the root
`AGENTS.md`, including cumulative knowledge cutoffs, grammar and skill coverage,
representative practice exams, and non-language performance gates such as
timing, scoring, listening conditions, writing review, and unseen mocks.
Those gates are not established by the presence of these vocabulary files.
