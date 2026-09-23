# Curriculum v2

This is the living description of the v2 curriculum scheme. Extend it as new
content types and teaching structures are introduced. Chinese v2 has vocabulary
and grammar inventories for all seven HSK bands, with an examples-first authoring
contract and dependency-aware lesson tooling. Complete teaching projections are
generated only when every required authored example and coverage gate passes.
Their presence is not a claim of reviewed linguistic quality or assessment readiness.

The v2 files are maintained separately from the existing curriculum outside
this folder. They are not generated compact copies of that curriculum, and
they are not currently connected to the app's lesson projection.

## Organization

Content is grouped by language. The current Chinese reference material is
organized by examination-alignment band:

```text
curriculum\v2\
  README.md
  chinese\
    grammar-vocabulary.yaml
    hsk-1\vocabulary.yaml
    hsk-1\grammar.yaml
    hsk-2\vocabulary.yaml
    hsk-2\grammar.yaml
    hsk-3\vocabulary.yaml
    hsk-3\grammar.yaml
    hsk-4\vocabulary.yaml
    hsk-4\grammar.yaml
    hsk-5\vocabulary.yaml
    hsk-5\grammar.yaml
    hsk-6\vocabulary.yaml
    hsk-6\grammar.yaml
    hsk-7-9\vocabulary.yaml
    hsk-7-9\grammar.yaml
    hsk-1\components.yaml
    hsk-1\component-vocabulary.yaml
    hsk-1\component-candidates.yaml
    hsk-1\vocabulary-components.yaml
    hsk-*\examples.yaml
    hsk-*\ordered-vocabulary.yaml
    hsk-*\ordered-grammar.yaml
    lessons\hsk-*.yaml
```

Chinese alignment follows the **November 2025 HSK examination syllabus,
effective July 2026**, not the 2021 educational-standard inventory or legacy
HSK 2.0. The examination syllabus publishes shared advanced vocabulary and
grammar inventories labelled **7-9**, without separate inventory cutoffs for
levels 7, 8, and 9.
The combined directory reflects that source inventory; it does not collapse
the three proficiency levels or require a single advanced teaching level.

The canonical HSK files describe reference membership, not a lesson sequence.
The separate `lessons` directory organizes teaching without moving inventory
entries. Generated `ordered-*.yaml` projections copy complete records into
lesson-introduction order for consumers that need a linear vocabulary or
grammar stream; they are not canonical authoring sources.

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
| `id` | Stable canonical identifier for the selected sense. Used for identity and provenance; lesson YAML resolves readable `lb` references to it. |
| `ch` | Written target form; simplified Chinese in the current files. |
| `pr` | Pronunciation; syllable-separated citation pinyin with tone marks for Chinese. |
| `ds` | Concise English description of the selected meaning or use. |
| `lb` | Human-readable identifier used by lesson YAML to reference the sense. It is not learner-facing text. |

A spelling is not necessarily a single learning item. Distinct meanings,
readings, or grammatical uses can need separate entries, while closely related
synonymous glosses can share one entry. Numbered syllabus rows, written forms,
readings, and selected senses are therefore different counts.

Keep one mapping per line, keep records sorted by `lb`, and quote values when
YAML requires it. Use `npm run curriculum:v2:order` rather than reordering
records manually. Use UTF-8 without a byte-order mark and LF line endings.
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

Within each canonical file, records are sorted by `lb`. This produces a stable,
reviewable authoring order after entries are added or moved. It is not a claim
that label order is pedagogically optimal. The ordered lesson projections are
generated separately alongside `lessons\hsk-*.yaml`. Existing source/editorial
comments are retained during sorting but do not define contiguous ranges in an
`lb`-sorted file.

Grammar prerequisites are part of the teaching inventory too. A fixed word,
bound morpheme, or grammatical sense needed by a band's grammar must occur in
that band's vocabulary or an earlier band's file. Place additions and senses
brought forward from later vocabulary bands in the commented grammar-prerequisite
block at the end of the receiving file. Do not keep a duplicate in the later
file. Comments retain the original vocabulary placement where applicable;
teaching something earlier does not change the official numbered vocabulary
cutoff or claim it was an official vocabulary entry at the earlier band.

## Vocabulary identifiers, labels, and pronunciation

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

For a grammar-supported lexical sense without a matching existing identity or
numbered vocabulary row, use `zh-grammar-NNNNN-sNNN`. This is a separate local
allocation, not a fabricated official row number. Keep allocations unique across
all bands, retain them if the entry moves, and do not repurpose existing senses.

Chinese labels combine lowercase numbered citation syllables, joined with
hyphens, then `--` and a concise English discriminator: `wo3--me`.
Tone `5` denotes a neutral syllable, `v` represents `ü`, and an erhua suffix
uses a separate `r5` syllable. The pronunciation portion must agree with `pr`.

Use citation pronunciation rather than contextual tone sandhi, while retaining
genuinely lexical neutral syllables. A different lexical reading is not merely
a formatting correction. Keep disagreements between the syllabus and dictionary
explicit rather than silently changing a source identity or inventing a use.

## Grammar files

`grammar.yaml` uses an ordered YAML list with one field per line and a blank
line between entries. Its first five fields match vocabulary except that `pt`
(pattern) replaces `ch`; every record also requires a structured `ex` object.
Vocabulary retains its compact five-field one-line format.
Each Chinese band, from `hsk-1` through `hsk-6` and the combined `hsk-7-9`,
has its own `grammar.yaml`.

```yaml
- id: zh-hsk1-g001
  pt: <subject> + 是 + <noun>
  pr: <subject> + shì + <noun>
  ds: Identify or classify with a noun.
  lb: s-shi4-n--identity
  ex:
    segments:
      - {word: wo3--me}
      - {word: shi4--identity}
      - {word: xue2-sheng5--student}
      - {punctuation: 。}
    translation: I am a student.
    grammar: [s-shi4-n--identity]
```

Each entry has exactly these fields in this order. Preserve the canonical first
five fields when authoring examples:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier for a grammatical construction or use. |
| `pt` | Chinese pattern with angle-bracketed English names for replaceable slots. |
| `pr` | The same template, with fixed Chinese text replaced by citation pinyin. |
| `ds` | A concise English meaning cue, retaining essential distinctions or restrictions. |
| `lb` | A compact pattern identifier used by lesson YAML, with numbered pinyin followed by `--` and a short meaning discriminator. |
| `ex` | One original contextual example with exactly `segments`, `translation`, and `grammar`; no ID or explanatory prose. |

Grammar is intended for AI interpretation. Keep descriptions brief rather than
repeating the visible pattern or writing a full teaching explanation. Authored
examples must preserve the intended meaning, restrictions, and cumulative
knowledge cutoff; a description is not a substitute for an example.

Slots such as `<subject>`, `<noun>`, or `<verb phrase>` are placeholders, not
Chinese text to pronounce. A predicate is the part saying what the subject
does or is. Purely structural patterns have identical `pt` and `pr`.
`+` joins successive parts; `/` separates alternatives, with parentheses
grouping alternatives where needed. These templates are not direct speech
playback inputs or substitutes for worked sentence examples.

Angle-bracketed slots allow unquoted YAML strings even at the start of a value.
Omit unnecessary value quotes, but retain them when YAML syntax requires them,
such as a literal colon followed by a space. Square or curly braces at the
start of a value instead introduce YAML collections.

Grammar labels are compact handles, not full copies of the templates. Retain
slot order and fixed numbered pinyin, but **never include slot delimiters**.
Use short grammatical names rather than repeating long slot descriptions:

| Short form | Meaning |
| --- | --- |
| `s`, `pred`, `stmt` | subject, predicate, statement |
| `n`, `np`, `pron` | noun, noun phrase or nominal, pronoun |
| `v`, `vp`, `adj`, `adjp` | verb, verb phrase, adjective, adjective phrase |
| `num`, `mw`, `qty` | number, measure word, quantity phrase |
| `obj`, `prep`, `p`, `loc` | object, preposition, person, place |
| `pre`, `post` | material before or after an answer slot |

Use brief role names such as `owner`, `age`, or `day` where clearer. Qualifiers
such as "optional", "same", or "skill" stay in `pt`/`pr` rather than being
repeated in the label; for example, `<skill verb phrase>` becomes `vp`.
The full templates remain authoritative.

Keep `or` between alternatives; omit joining signs, grouping parentheses and
sentence punctuation. Append a short `--meaning` suffix that distinguishes
the use, without repeating phrases such as "question" or "construction".
For example:

```text
<subject> + 是 + <noun>           -> s-shi4-n--identity
<statement> + 吗？               -> stmt-ma5--yes-no
<number> + <measure word> + <noun> -> num-mw-n--count
```

The same tone conventions apply as in vocabulary: neutral `5`, `v` for
umlaut-u, and `r5` for erhua. Different functions can share a surface pattern
but have distinct IDs and label suffixes. For example, a short question ending
in `呢` can ask a follow-up question or ask where something is.

Reuse an existing grammar ID when the construction matches, even when its old
HSK prefix differs from the new examination placement. New grammar references
use `zh-hsk2026-gNNN`, with unique, persistent authoring allocations across
Chinese v2. The numeric suffix has at least three digits and continues
naturally into `g1000` and beyond. Allocations may have gaps; do not renumber
records or restart numbering per band. These are not official syllabus item
numbers or file positions.
The new pattern-based grammar labels intentionally replace older function-only
labels in v2; the existing curriculum outside v2 remains unchanged.

Grammar records are sorted by `lb`; comments retain source-family context. One source
category may require several teaching patterns, while one pattern may cover
several related categories. Record counts are not official grammar-item counts.
The drafts follow these pages of the pinned examination syllabus, including
constructions placed differently in the older local curriculum:

| Band | Printed pages | PDF pages |
| --- | --- | --- |
| HSK 1 | 383-385 | 386-388 |
| HSK 2 | 386-388 | 389-391 |
| HSK 3 | 389-391 | 392-394 |
| HSK 4 | 392-394 | 395-397 |
| HSK 5 | 395-397 | 398-400 |
| HSK 6 | 398-399 | 401-402 |
| HSK 7-9 | 400-403 | 403-406 |

Grammar is incremental too: combine the current band's file with every earlier
band. Do not repeat a construction simply because the source lists it again
or an inherited ID has a later HSK prefix. A newly taught realization or
distinct function can receive its own record; a changed source sense numeral
alone is not evidence of a new function. If an older identity bundles uses
now taught separately, allocate narrower identities rather than silently
repurposing it. Source-family comments identify lexical extensions that use
an earlier construction without adding another record.

Fixed words in `pt` must have matching vocabulary at or before the grammar's
band, including the relevant meaning and reading. A container noun is not
sufficient evidence for its measure-word use: `杯子` does not cover `杯`, and
a dictionary entry for a bowl does not itself teach a bowlful. Likewise,
common verb readings do not cover different classifier readings.
Grammar explanations do not substitute for missing lexical entries.

`chinese\grammar-vocabulary.yaml` pins selected grammatical senses by grammar
and vocabulary **`lb` identifiers**, especially where the same written form
also has an unrelated noun or verb sense. These are lexical prerequisite
bindings, not a claim that the full grammar/skills crosswalk has received
independent review. Vocabulary remains five-field; grammar retains those five
canonical fields and adds the required `ex` object.

### Maintaining grammar-vocabulary bindings

The file is an authored YAML list. Each mapping contains one grammar `lb` in
`grammar` and a nonempty list of vocabulary `lb` identifiers in `vocabulary`:

```yaml
- {grammar: num-bei1-drink--cups, vocabulary: [bei1--cupfuls]}
```

Do not copy word definitions into this file or replace the labels with canonical
IDs. Keep at most one mapping per grammar label, with no repeated vocabulary
labels in that mapping. Each pinned sense must match a fixed form and reading
in the pattern and be available at its cumulative band cutoff.

Update bindings in the same change as an affected label, pronunciation, sense,
or grammar pattern. Add explicit bindings where automatic spelling/reading
matches cannot distinguish the required grammatical sense. Do not delete a
binding merely to make a missing prerequisite pass, and do not generate
speculative sense bindings for every spelling match. The automatic scan still
covers patterns without an explicit binding.

Start with the automated check, then investigate its reported gaps and any
ambiguous meaning changes. A fresh manual audit of all bands is not required
for routine maintenance.

`scripts\v2-grammar-vocabulary.mjs` checks every grammar pattern across all seven
bands. It excludes replaceable slots, aligns fixed Chinese text with pinyin,
and segments literal runs using matching vocabulary forms and readings. It
prefers a complete known lexical entry over shorter decompositions, checks its
earliest availability, and separately enforces the pinned sense bindings.
It rejects duplicate identities and labels, missing words, later prerequisites,
and bindings that do not occur in the pattern. Run the regression check with:

```text
npm test -- scripts/v2-grammar-vocabulary.test.ts
```

String and pronunciation matching cannot prove semantic correctness: reviewing
the relevant sense, idiomatic combinations, and new grammar remains necessary.
Reviewed contextual examples pin emphatic refusal with `才` to the competing-
judgement correction sense and surprise/dismissal with `还` to its emphasis
sense; the constructions and discourse context supply the particular
pragmatics. Decimal `点` has a precise separator sense, and transitive `急`
uses `ji2--attend-urgently` in the empathetic construction. These narrow
decisions do not establish a complete semantic crosswalk. The `愣` example
selects the unexpected-achievement alternative with `leng4--unexpectedly`;
dismissive `爱` uses a separate choice-marker sense, not affection. These
example-specific decisions do not certify every alternative or pragmatic use.
Literal coverage alone never resolves uncertain semantic mappings.
Bound morphemes need constrained descriptions, not an implication that they
are freely usable words. Grammar prerequisites establish a band-level inventory,
not a learner's knowledge; lesson authoring must still introduce the words and
constructions before complete examples or exercises use them.

The source outline does not define every numbered sense or schematic frame.
Keep constrained editorial interpretations and pronunciation uncertainty
explicit. Reviewed-but-unresolved material must not be filled with an invented
rule: current examples include HSK 4's unspecified double-negative and compact
clause functions, HSK 5's `不是……，还/还是……`, HSK 6's unspecified `(没)有`
continuation after `X了就X了`, and advanced `动词+得个`. Some repeated entries,
including advanced `我`, also leave their intended additional scope unclear.
File comments preserve these limits; presence of a band file does not mean
every source interpretation has been resolved.

## Ordered lexical-unit lessons

Each band's canonical grammar examples and optional `examples.yaml` list are
the authoring inputs. The latter is a YAML list of original
`{id, segments, translation, grammar}` examples, with stable slug IDs unique
within that band. Together they must demonstrate every current-band vocabulary
sense. A segment is exactly `{word: <vocabulary lb>}` or
`{punctuation: <Chinese punctuation>}`; there are no literals, placeholders,
external-vocabulary escapes, or component-reference segments.
Supported punctuation is `，。？！、：；…“”‘’（）《》〈〉「」『』—·`,
including quotation, dialogue, and multiple sentences. Translation is natural
English, not a construction explanation. The `grammar` list includes every
actually used supporting construction; a canonical grammar `ex` must include
its own target label. All references are current-band or earlier.

Coverage is exact-sense reference coverage, not a claim that arbitrary text is
good language teaching. Do not substitute isolated dictionary words, quoted
targets, definition restatements, or automatically fabricated filler.
Genuinely standalone greetings/interjections and well-formed short phrases can
be legitimate. Authors still review meaning, pronunciation, natural context,
and accurate grammar annotations.

Review supporting vocabulary as carefully as the target. Even a unique
spelling/reading match can be the wrong sense: resultative `成` is not
one-tenth, course-classifier `门` is not a physical door, rice `米` is not a
meter, and night `晚` is not lateness. Likewise, a longest-match tokenizer must
not turn ordinary `只` + `有` into conditional `只有`. Use accurate sense
identities or an already-known reformulation; never let a convenient lookup
manufacture contextual coverage. Newly required senses keep their original
identity where available and enter no later than their first actual use.

`chinese\lessons\hsk-1.yaml` through `hsk-6.yaml` and `hsk-7-9.yaml` are generated
`schemaVersion: 3` sequences. Every sequence has exactly `schemaVersion`,
`language: chinese`, `alignment`, `status: draft`, and `lessons`. Each lesson has
exactly `id`, `units`, and `examples`; each unit has only `kind` and `ref`.
There are no titles, objectives, notes, introductions, pronunciation explanations,
or other explanatory prose in lesson files. English example translations remain.
For example, a lesson's content has this shape:

```yaml
units:
  - {kind: vocabulary, ref: wo3--me}
  - {kind: vocabulary, ref: shi4--identity}
  - {kind: vocabulary, ref: xue2-sheng5--student}
  - {kind: grammar, ref: s-shi4-n--identity}
examples:
  - id: grammar-zh-hsk1-g001
    segments:
      - word: wo3--me
      - word: shi4--identity
      - word: xue2-sheng5--student
      - punctuation: 。
    translation: I am a student.
    grammar: [s-shi4-n--identity]
```

The generator synthesizes grammar-example IDs as `grammar-<canonical grammar id>`.
Supplemental IDs become `usage-hsk-<band>-<authored id>` in lessons, avoiding
cross-band collisions without renaming authored slugs. Examples must match their
authored candidates, not generated replacements.

Every canonical unit appears exactly once at its own band, in a lesson of four
to six new units, normally about five. Tail groups are rebalanced rather than
emitting a tiny final lesson. A lexical unit is one exact vocabulary or grammar
`lb` reference; previews do not count.
The validator derives unit-to-example associations: a vocabulary unit is covered
when its exact `word` label occurs in an example, and a grammar unit is covered
when its label occurs in the example's `grammar` list. Every introduced unit
must be covered. Every example must demonstrate at least one unit introduced in
that lesson. A newly introduced grammar includes its own canonical `ex`.
All word and grammar references must have been introduced in the current or an
earlier lesson. Known state crosses band boundaries; validation does not reset
the learner at HSK 2 or assume an arbitrary list of pre-known words.

Grammar prerequisites are not limited to the manually pinned
`grammar-vocabulary.yaml` bindings. The grammar audit also exposes vocabulary
matched from every construction's fixed Chinese form and reading. A grammar
unit cannot be placed until all of those lexical units have appeared in the same
or an earlier lesson. Move supporting vocabulary earlier in the teaching order
when necessary; do not move it between HSK band inventories merely to change
lesson order.

### Vocabulary component prerequisites

Multi-character **HSK 1** vocabulary has an ordered binding in
`hsk-1\vocabulary-components.yaml`. Separate a component's reusable meaning
from its role in a particular word. A character, a meaningful morpheme, and an
independently usable word are not necessarily the same unit. Some written
positions do not contribute a separate meaning at all.
This complete coverage requirement remains scoped to HSK 1. Higher-band lessons
neither require nor pretend to have component decomposition inventories.

`hsk-1\component-candidates.yaml` is generated from the complete HSK 1
vocabulary inventory. It is a compact map from character to an array of word
usages, each containing only the whole word's `ch` and sense label `lb`:

```yaml
爸: [{ch: 爸爸, lb: ba4-ba5--dad}]
读: [{ch: 读书, lb: du2-shu1--read}, {ch: 读书, lb: du2-shu1--study}]
```

A repeated character appears once per word sense in this index; its positions
are recoverable from the whole word. Distinct senses remain separate even when
their written words are identical. Meanings, pronunciations, and possible source
senses are looked up in the vocabulary inventories rather than copied into
every usage. Keys sort by character code point and usages by `lb`.
This is an exhaustive review index, not an authoring file or a semantic analysis.
`vocabulary-components.yaml` must contain a reviewed decision for every indexed
word and every position within it; the ordering check rejects omissions.

Meaningful positions reference a reusable sense:

- `vocabulary` reuses the complete `id`, `ch`, `pr`, `ds`, and `lb` record from
  any canonical v2 vocabulary band when its reading and meaning fit the word.
  When the suitable retained source sense is not selected in a canonical v2
  band, the same stable identity and meaning are preserved in
  `hsk-1\component-vocabulary.yaml` for component preview use.
- `morpheme` resolves a reusable sense in `hsk-1\components.yaml` when no
  existing vocabulary sense is accurate. Its `ds` is a concise English
  definition, not "the element in this word." Do not repeat the parent word,
  explain a compound metaphor, or describe contextual pronunciation in `ds`.
  These records have the vocabulary fields `id`, `ch`, `pr`, `ds`, `lb`, plus
  a required `usage` field:

| `usage` | Meaning of the selected sense |
| --- | --- |
| `free` | Independently usable as a word. |
| `bound` | A lexical meaning normally used inside larger words. |
| `grammatical` | An affix or grammatical function rather than an ordinary lexical meaning. |

For example, "rice; uncooked rice", "brain", and "noon; midday" are reusable
meanings. The electric-brain metaphor explaining `电脑` belongs to the word
binding, not to a computer-specific definition of `脑`. A bound sense such as
"teacher; master; specialist" remains meaningful without claiming that the
character is the usual standalone way to say "teacher."

Every word binding declares its `formation`. This describes the teaching
analysis, not a claim to have established the word's historical etymology:

| `formation` | Meaning |
| --- | --- |
| `transparent` | Referenced meanings or grammatical functions directly explain the combination. |
| `lexicalized` | Meaningful elements help, but the conventional or metaphorical whole-word meaning needs separate explanation. |
| `opaque` | At least one position has no independently assigned meaning in this word. |
| `phonetic` | At least one position represents sound rather than a semantic contribution, as in a transliteration. |

All formations except `transparent` require a word-level `note`. Meaningful
positions retain `kind: vocabulary` or `kind: morpheme` and a `ref`; an optional
position-level `note` explains that sense's role in this word.
Reuse ordinary meanings with an explicit metaphor or conventional-use note
rather than inventing a new sense for every compound.

Nonsemantic positions use `kind: opaque` or `kind: phonetic`, their written
`ch`, and actual word-position `pr`. They have no `ref`, invented definition,
or standalone learning identity. They may have a contextual `note`.
For example:

```yaml
- vocabulary: dong1-xi5--thing
  formation: opaque
  note: The east and west meanings do not explain the modern word for thing.
  components:
    - {kind: opaque, ch: 东, pr: dōng}
    - {kind: opaque, ch: 西, pr: xi}
```

This does not deny that `东` and `西` have meanings elsewhere; it declines to
assign those meanings to positions in this word. Never invent definitions
solely to make every character position look like a meaningful prerequisite.
Transparent and lexicalized bindings contain only meaningful references.
Opaque and phonetic bindings must include their respective nonsemantic kind
and must not mix the two kinds; they can also contain meaningful references.

Component-sense exposure is a preview. It does not introduce that
entry as an independently usable lexical unit, satisfy its later example
coverage, or add it to the cumulative vocabulary cutoff. The validator requires
all position forms and readings, including opaque and phonetic positions, to
concatenate exactly to the parent vocabulary record. The ordering check requires
every multi-character HSK 1 record to have a binding (currently 176 records and
373 positions). Structural coverage does not by itself prove semantic accuracy.

`lessonComponentIntroductions` returns first-exposure `components` as clean
`kind`/`ref` identities. Separately, its `words` array preserves the full binding
of every multi-character word introduced in that lesson, including formation,
notes, and occurrence pronunciations. Nonsemantic positions never become
invented reusable senses. Later uses of an already seen sense still retain
their own word-specific explanations and pronunciation.

A component has one citation pronunciation. When a word gives that component a
contextual neutral tone, its binding uses `surface_pr` rather than creating a
second component identity. Thus `谢谢` references the same `谢 xiè` sense
twice and marks only the second occurrence with `surface_pr: xie`. This is a
lexical/prosodic property of the word, not a general rule changing a fourth tone
to neutral after another fourth tone; ordinary combinations such as `再见`
retain both fourth tones. Redundant overrides, including capitalization-only
differences, are rejected. An override cannot substitute a different base
syllable for a lexical reading; use the correct sense identity instead.
Opaque and phonetic positions state their actual `pr` directly because they
do not reference a citation sense.

`scripts\v2-component-schema.mjs` provides the shared record, formation,
identity, and position-alignment validation used by both lessons and ordering.

### Canonical and teaching order

Canonical `vocabulary.yaml` and `grammar.yaml` files are sorted by `lb`, not by
lesson order. Do not reorder them manually. Run:

```text
npm run curriculum:v2:order
```

The script validates all authored inputs before writing anything. It sorts every
canonical v2 vocabulary and grammar inventory, plus the reviewed component
inventories, by `lb`. It generates all seven lesson files and separate
`ordered-vocabulary.yaml` and `ordered-grammar.yaml` projections beside every
band's canonical files, preserving the complete grammar `ex`. It refreshes the
HSK 1 `component-candidates.yaml` review input. Component order is
already determined by each vocabulary record's ordered component binding, so
there is no separate ordered-component projection. The generated files contain
complete records in lesson-introduction order. Never edit them directly.
`npm run curriculum:v2:order:check` fails when a canonical file is unsorted or
a generated projection is stale, or when required authoring inputs are missing.

The deterministic planner uses stable-ID order from
`curriculum\chinese\teaching\levels\*\sequence.yaml` as a starting hint only.
Unmatched units use supplemental example source order, then canonical
grammar-example ID order; canonical alphabetical `lb` order is not the teaching
policy. Candidate selection closes over the examples' words, supporting grammar,
every introduced grammar's own example, and all fixed-form/pinned lexical
prerequisites, including alternatives not realized in that one example.
Multiple examples can jointly evidence a lesson. Small mutual dependencies are
grouped together; tail search can repartition recent lessons. Unresolved
dependencies, missing coverage, or exhaustion of the bounded search produce
actionable errors, not relaxed knowledge gates or a giant bootstrap lesson.
Content authors can supply natural smaller examples where needed.

V1 teaching order is not an authority for HSK readiness. Neither deterministic
ordering nor successful structural coverage proves pedagogical or linguistic
correctness.

### Authoring and integration checks

For the current authoring band, without requiring unfinished siblings:

```text
npm run curriculum:v2:examples:check -- --band 1
node scripts\v2-audit-examples.mjs --band 1 --root AUTHOR_PATH --catalog-root APPROVED_CATALOG_PATH
```

The optional catalog root supplies only vocabulary and prerequisite bindings;
grammar metadata and examples remain from the author's root. It is allowed only
for scoped auditing. Scoped results explicitly do not certify other bands,
lesson sequencing, or semantic correctness.
`preflightBandLessons` in `scripts\v2-generate-lessons.mjs` can diagnose one
band's ordering while explicitly assuming all earlier-band units are already
taught; it is not the full cumulative validation gate.

The complete authoring and generated-data gates are:

```text
npm run curriculum:v2:examples:check
npm test -- scripts\v2-grammar-vocabulary.test.ts scripts\v2-curriculum.integration.test.ts scripts\v2-all-bands.integration.test.ts
npm run curriculum:v2:order:check
```

Missing grammar `ex` objects or uncovered senses are reported as missing
authoring inputs; there is no legacy five-field grammar or partial-lesson
bypass. Generation waits for the complete corpus rather than manufacturing
examples. Existing generated files must not be presented as current until these
gates pass.

The focused structural checks are:

```text
npm test -- scripts\v2-example-schema.test.ts scripts\v2-audit-examples.test.ts scripts\v2-component-schema.test.ts scripts\v2-lesson-schema.test.ts scripts\v2-generate-lessons.test.ts scripts\v2-order-curriculum.test.ts
```

These checks do not replace linguistic review. Authors must still verify that
examples use the declared constructions correctly, meanings are accurate, and
the sequence teaches practical skills. Introduced or viewed content is not
demonstrated mastery or examination readiness.

## Sources and limits

Preserve each file's source URLs, edition, retrieval information, hashes,
attribution, and licensing notices. Existing Chinese source records and legal
notices remain in `curriculum\chinese\sources.yaml` and
`curriculum\chinese\licenses\`. Do not redistribute protected exam papers or
transcripts as curriculum content.

These are AI-assisted editorial vocabulary, grammar, and lesson drafts, not an
official English sense list or independently proofread teaching material. Unresolved
readings, parts of speech, and source ambiguities remain explicit.

Vocabulary and grammar inventory coverage is **not exam readiness**. Claims of
certification or examination readiness must follow the evidence policy in the root
`AGENTS.md`, including cumulative knowledge cutoffs, grammar and skill coverage,
representative practice exams, and non-language performance gates such as
timing, scoring, listening conditions, writing review, and unseen mocks.
Those gates are not established by the presence of these reference files.
