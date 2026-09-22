# Curriculum v2

This is the living description of the v2 curriculum scheme. Extend it as new
content types and teaching structures are introduced. For now, v2 contains
Chinese vocabulary inventories and grammar drafts for all HSK bands, plus a
first declarative lesson pilot. The full teaching path and assessments are not
yet defined.

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
    lessons\001-greetings-and-identity.yaml
```

Chinese alignment follows the **November 2025 HSK examination syllabus,
effective July 2026**, not the 2021 educational-standard inventory or legacy
HSK 2.0. The examination syllabus publishes shared advanced vocabulary and
grammar inventories labelled **7-9**, without separate inventory cutoffs for
levels 7, 8, and 9.
The combined directory reflects that source inventory; it does not collapse
the three proficiency levels or require a single advanced teaching level.

The HSK directories describe reference membership, not a lesson sequence.
The separate `lessons` directory organizes teaching without moving or copying
inventory entries. Teaching progression can organize references into smaller
sections, modules, and lessons without changing their source identities.

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
line between entries. Its five fields match vocabulary except that `pt`
(pattern) replaces `ch`; vocabulary retains its compact one-line format.
Each Chinese band, from `hsk-1` through `hsk-6` and the combined `hsk-7-9`,
has its own `grammar.yaml`.

```yaml
- id: zh-hsk1-g001
  pt: <subject> + 是 + <noun>
  pr: <subject> + shì + <noun>
  ds: Identify or classify with a noun.
  lb: s-shi4-n--identity
```

Each entry has exactly five nonempty strings in this order:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier for a grammatical construction or use. |
| `pt` | Chinese pattern with angle-bracketed English names for replaceable slots. |
| `pr` | The same template, with fixed Chinese text replaced by citation pinyin. |
| `ds` | A concise English meaning cue, retaining essential distinctions or restrictions. |
| `lb` | A compact pattern identifier used by lesson YAML, with numbered pinyin followed by `--` and a short meaning discriminator. |

Grammar is intended for AI interpretation. Keep descriptions brief rather than
repeating the visible pattern or writing a full teaching explanation. The AI
can expand a cue into explanations and examples, while preserving its intended
meaning, restrictions, and the learner's cumulative knowledge limits.

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

Grammar records follow source families rather than lesson order. One source
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
independent review. The five-field vocabulary and grammar record shapes stay
unchanged.

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
In particular, the selected-sense mappings for emphatic refusal with `才`,
surprise/dismissal with `还`, decimal `点`, and advanced pragmatic uses of
`愣`, `爱`, and `急` remain editorial review questions. Literal coverage does
not resolve them; uncertain mappings are not asserted as confirmed bindings.
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

## Declarative lesson pilot

`chinese\lessons\001-greetings-and-identity.yaml` starts from v1's **First contact**
level and **Greetings and student identity** lesson. V1 provides a pedagogical
starting point, not a fixed allocation of words, constructions, or lesson counts.
Reconcile each reference against v2 rather than copying v1's inventory or
mechanically placed supplemental vocabulary.

This pilot teaches six senses (hello, I, you, the noun-identity linking word,
student, and teacher) and one identity construction across 17 explicit pages.
It begins with what pinyin represents, syllables and initials/finals, pitch
versus loudness, and a same-syllable tone comparison before any word cards.
It uses v2's whole-word
hello sense rather than v1's retired greeting sense of the second character.
Names and formal address are deferred; teacher provides a useful substitution
within the construction being taught. No existing vocabulary or grammar record
is changed by lesson placement.

### Lesson and page contract

The executable data/template definitions are in
`scripts\v2-lesson-schema.mjs`, using the existing Zod dependency. They are
authoring definitions, **not implemented UI components**. The app, routes,
generated content, and existing lessons remain unchanged.

`schemaVersion: 1` versions this new lesson contract, not the curriculum.
Lesson metadata includes a stable `id`, language, title, draft status, teaching
placement, HSK alignment band, original-content provenance, prerequisite lesson
IDs, and learner-facing objectives. `placement.level` is a teaching level;
it is **not** an HSK level. The pilot's `first-exchanges` module is provisional
placement, not a completed module or a declaration of the entire course path.
`alignment` identifies the intended examination band, not a readiness verdict.

Each lesson explicitly declares its ordered `pages`. Each page has exactly
`id`, `template`, `title`, `requires`, and `data`. Its stable ID is local to the
lesson; its position in the array is the display order. `requires` lists earlier
page IDs in the same lesson. There is no implicit expansion from word lists
or sections, and no automatically inserted overview or practice page.
An overview must appear first and a summary last, with neither repeated.

The predefined template set is deliberately small:

| Template | `data` fields | Intended template behavior |
| --- | --- | --- |
| `overview` | `introduction` | Show the lesson introduction and objectives from lesson metadata. |
| `vocabulary` | `word`, `role`, `note` | Resolve one vocabulary `lb`; show its Chinese, citation pinyin, meaning, and the lesson-specific note. |
| `concept` | `body`, `examples` | Explain pronunciation or other supporting knowledge; examples may be empty for an initial orientation. |
| `tone-comparison` | `syllable`, `introduction`, `examples`, `neutralContext`, `practice` | Compare one syllable across the four main tones; explain neutral tone with a contextual example. |
| `grammar` | `grammar`, `role`, `explanation`, `examples` | Resolve one construction's `lb`; show its pattern alongside a learner-facing explanation and grounded examples. |
| `dialogue` | `setting`, `speakers`, `turns` | Present the exchange in authored order; each turn names a declared speaker and contains an utterance. |
| `recall` | `prompt`, `answer`, `explanation` | Show the prompt first; hide the model answer and explanation until the learner explicitly reveals them. This is an unscored self-check. |
| `summary` | `reflection`, `limitation` | Show reflection prompts and the explicit limits of the lesson's evidence. |

`role` is `new` or `review`. A vocabulary or grammar page is the introduction
point; merely using a reference elsewhere does not introduce it. Review means
previously introduced, not mastered. Concept-page IDs serve as local handles
for dependencies; this pilot does not establish a separate global concept
inventory.

Narration is English prose with the existing safe Markdown subset, not raw
HTML, JSX, scripts, component paths, or custom layout instructions. Template
code, when implemented, owns layout and interaction. No runtime AI generation
is required to supply missing lesson content. Grammar placeholder patterns
are displayed as patterns, never pronounced as complete utterances.

### Grounded utterances and knowledge cutoffs

Examples, dialogue turns, and model answers use the same structure:

```yaml
segments:
  - word: wo3--me
  - word: shi4--identity
  - word: xue2-sheng5--student
  - punctuation: 。
translation: I am a student.
grammar: [s-shi4-n--identity]
```

Lesson vocabulary and grammar references use the inventory's **`lb` identifier**,
not opaque canonical IDs. Resolve each label directly against the v2 inventory
to obtain its stable `id` and content. Do not add a second label registry or
copy `ch`, `pr`, or `ds` into lesson records. Unknown or duplicate labels are
errors. If an inventory label is intentionally renamed, update its lesson
references in the same change; its underlying canonical ID remains unchanged.
Lesson IDs, page IDs, speaker IDs, and their dependencies keep their own IDs.
Resolve characters and citation pinyin from vocabulary; concatenate the
characters and punctuation in segment order. An entry such as the whole-word
greeting does not automatically introduce its component senses. Pinyin remains
citation pinyin even when concept prose explains contextual pronunciation.

`grammar` explicitly declares the constructions needed by the utterance.
An empty list is appropriate for the lexicalized greeting, not a way to bypass
the cutoff for an untaught sentence pattern. Speaker IDs and display names are
metadata, not spoken target-language vocabulary.

`validateLessonSequence` accepts lessons in explicit teaching order and the
canonical vocabulary/grammar inventories. It checks template-specific shapes,
unique IDs and inventory labels, backward prerequisites, introduction/review roles, dialogue speakers,
and reference availability **at each page**, including hidden model answers.
A grammar page introduces its construction before its own examples. Vocabulary
from elsewhere in the HSK band is not considered known until taught.
The cumulative prefix is introduced content, not evidence of learner mastery.

### Pronunciation demonstrations

`tone-comparison` uses structured **phonetic examples**, not lexical utterances.
The pilot holds the syllable `ma` constant: `mā`, `má`, `mǎ`, `mà`, then unmarked
`ma`. Each row contains `tone`, `pinyin`, `name`, `contour`, and `instruction`.
The first four rows demonstrate isolated citation tones, with the third-tone
explanation explicitly distinguishing connected-speech low tone from an
isolated dip and rise.

Tone `5` is an authoring convention for **neutral tone**, not a fifth fixed
pitch contour. `neutralContext` supplies a pinyin `syllables` array, a one-based
`focus`, and an `explanation`. The pilot uses `[mā, ma]` with focus `2`, so the
learner can compare a full first tone with the shorter, lighter syllable after
it. The context must put the unmarked comparison syllable after a full-tone
syllable. Validation also requires all five rows in order, matching tone marks
and the same base syllable, using the existing pinyin conversion helper.

These sound demonstrations do not create vocabulary senses, introduce the
constituent characters, or satisfy later lexical cutoffs. They have no word
references or translations; any lexical use in an example, dialogue, or answer
still needs a separately introduced vocabulary `lb`. Naming the word for mom
in the explanatory note is exposure, not permission to require it in recall.
The future template must distinguish sound practice from vocabulary cards.
It must not send raw pinyin to ordinary Chinese text-to-speech and assume the
tones will be correct; reviewed pronunciation audio is not supplied by this
data-only pilot.

The focused pilot check is:

```text
npm test -- scripts/v2-lesson-schema.test.ts
```

This is structural/reference validation, not automated linguistic review: an
author must still check that declared constructions are sufficient and used
correctly, that explanations and translations are accurate, and that practical
skills have been taught. The pilot has no scored listening or pronunciation
assessment, reviewed audio assets, handwriting tasks, or retention evidence.
Page completion, answer reveal, and model repetition must not award mastery
or establish examination readiness.

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
