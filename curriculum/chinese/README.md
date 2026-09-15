# Chinese reference inventory and teaching tracks

For everyday beginner learning, use the separate
[Practical Mandarin beginner track](teaching/beginner/README.md).
The HSK folders below are reference assignments, **not a mandatory teaching
order or a requirement to learn every dictionary sense**. The beginner track
introduces practical senses such as coffee and basic colors early without
changing their source levels or IDs.

## Version boundary: read this first

This collection follows the **2021 educational framework GF0025-2021**,
not legacy HSK 2.0 and **not a claimed transcription of the 2025/2026 HSK
examination syllabus**. The Ministry of Education announcement directly confirms
the three-stage/nine-band framework and its effective date, July 1, 2021.
It covers listening, speaking, reading, writing and translation as broad language
capabilities. A proficiency framework is not an exam blueprint.

Folders `hsk-1` through `hsk-6` correspond to the first six educational bands;
`hsk-7-9` holds the shared advanced inventory. There are no fabricated separate
word assignments for bands 7, 8 and 9. Their teaching challenges differ in
depth, independence, register and precision, as described in the advanced syllabus.

**Important mapping limitation:** imported `new-*` labels in the pinned
Complete HSK Vocabulary source trace to elkmovie's OCR of the 2021 standard.
The same file also contains distinct `old-*` and `newest-*` labels. Neither is
imported. The `newest-*` subset has only 10,057 entries in this revision, with
incomplete exam coverage and no completed audit here; its existence must not
silently change the meaning of `new-*`. Consult the directly verified
[official exam syllabus page](https://www.chinesetest.cn/syllabus) for a learner's
specific examination. We assert no worldwide rollout date or score equivalence.

## What is actually present

| Folder | New vocabulary rows | Cumulative rows | Authored grammar constructs | Bilingual examples |
|---|---:|---:|---:|---:|
| hsk-1 | 506 | 506 | 25 | 50 |
| hsk-2 | 750 | 1,256 | 25 | 50 |
| hsk-3 | 953 | 2,209 | 25 | 50 |
| hsk-4 | 972 | 3,181 | 25 | 50 |
| hsk-5 | 1,059 | 4,240 | 25 | 50 |
| hsk-6 | 1,123 | 5,363 | 25 | 50 |
| hsk-7-9 | 5,606 | 10,969 | 35 | 70 |
| **Total** | **10,969** | **10,969** | **185** | **370** |

Vocabulary is the **entire normalized `new-*` headword subset of the pinned
source**, not a representative sample. Each headword occurs in only one folder;
cumulative reference coverage of a band includes the earlier folders too.
This is not a requirement to teach all their dictionary senses. The source merges readings
and some variants, removes duplicates, and has OCR/editorial limitations.
Consequently these counts differ from the 2021 standard's cumulative vocabulary
slot benchmarks: 500, 1,272, 2,245, 3,245, 4,315, 5,456 and 11,092.
The 123-row net difference at the top is **not** a verified list of exactly 123
missing words: segmentation, variant merging, duplicated source slots, extras
and omissions require a headword-by-headword reconciliation. We do not claim
complete official coverage.

Grammar is an **original teaching selection**, not the standard's exhaustive
official grammar inventory or a tested exam-level mapping. Every construct has
an English functional equivalent, a brief usage distinction and two original
Chinese/English examples. Examples may include necessary supporting vocabulary
from another band; gloss it before practice and do not silently alter the word
inventory. Human review by an experienced Mandarin teacher remains necessary.

Not supplied: audio recordings, licensed exam questions, a complete character/
stroke-order or syllable inventory, full official grammar-table mapping,
individually verified translations of every dictionary sense, and a complete
2025/2026 examination-wordlist migration. This is a substantial teachable text
corpus, not an assertion that those omissions have been solved.

## Files and tutor use

Every level has:

- `vocabulary.yaml`: UTF-8 YAML list, shared nine-field base schema; stable per-revision
  IDs, simplified target, tone-marked pinyin, English definitions and provenance.
  HSK-1 additionally has explicit sense records, described below.
- `grammar.yaml`: a list with `id`, `pattern`, `english`, `note`, `examples`,
  `source_id`, and `level_basis`. Bracketed letters such as S are English
  metalinguistic placeholders, not words to pronounce.
- `syllabus.md`: prerequisites, ordered recurring thematic blocks, grammar IDs,
  vocabulary retrieval rules, practice/review and observable exit tasks.

`sources.yaml` supplies attribution and version metadata.
`normalization-report.yaml` records corpus-wide sense filtering and repair counts.
`authoring/grammar.psv`
is the editable original grammar source; the importer regenerates YAML from it.
Do not edit generated vocabulary or grammar YAML as the sole record of a repair.
Edit the source or importer, regenerate and review the resulting change.

### Independent teaching tracks

`teaching/beginner/sequence.yaml` assigns introductions and reviews to twelve
practical modules using 205 selected vocabulary senses and 25 grammar constructs.
It does not select an
entire headword merely because one meaning is useful. Its generated
`vocabulary.min.yaml` and `grammar.min.yaml` use one-line entry mappings and
follow teaching order rather than source order:

```yaml
- {id: zh-hsk1-00384-s001, ch: 我, pr: wǒ, ds: 'I, me, my'}
- {id: zh-hsk1-g020, ch: S+会+V, ds: learned ability}
```

The first example is vocabulary; the second is grammar. `ch` is the word or
construction, `pr` is sense-specific pinyin, and `ds` is the existing English
disambiguator. Grammar templates omit `pr`. Version 2 of the beginner sequence
duplicates these full mappings in both introduction and review lists. Their
fields come directly from expanded references, without parsing a combined
token string. The generator refreshes the duplicated fields by ID while
preserving the authored teaching order and metadata.

This change is scoped to the beginner teaching files. The HSK-1 reference
compact views described below still use `[id, token]` pairs.

The original HSK files remain unchanged. `reference-senses.yaml` adds eleven
selected sense records for useful vocabulary in other bands: understanding,
permission, basic colors, coffee, apple, and needing something. These records
are generated from `authoring/reference-senses.yaml` and the same pinned
dictionary source. Their parent metadata is identical to the original HSK
record. This is a small extension of addressable senses, not a claim that all
higher-level entries have been sense-normalized.

For example, `zh-hsk3-00396-s001` still identifies the reference HSK-3 coffee
entry even when introduced in the beginner drinks module. Do not migrate an
ID to `hsk1` to express teaching priority. Unselected meanings remain available
for later or personalized teaching; they are not silently marked mastered,
advanced, or required.

`catalog.yaml` declares the beginner track separately from the reference
`levels`. Regenerate its ordered compact views offline with:

```powershell
python scripts\generate_teaching_track.py
python scripts\generate_teaching_track.py --check
```

### Compact HSK-1 pilot

`hsk-1/vocabulary.min.yaml` contains **1,644 `[sense_id, token]` pairs** for
canonical senses derived from all normalized dictionary meanings of the 506 headwords.
`hsk-1/grammar.min.yaml` contains **25 `[grammar_id, token]` pairs**.
Each pair occupies one line, with no repeated field names:

```yaml
- [zh-hsk1-00001-s001, 爱(ài)/to love]
- [zh-hsk1-00001-s002, 爱(ài)/affection]
- [zh-hsk1-g020, S+会+V/learned ability]
```

The first two examples belong to the vocabulary file; the last to grammar.
The source headword ID remains unchanged as the parent `id` in expanded YAML.
Its `senses` records each contain:

```yaml
id: zh-hsk1-00001-s001
reading: ài
english: to love; to be fond of; to like
source_sense_ids: [zh-hsk1-00001-s001]
disambiguator: to love
```

Vocabulary tokens are exactly `headword.target(sense.reading)/sense.disambiguator`.
The parentheses contain the individual sense's tone-marked pinyin, preserving
syllable spacing and neutral tones rather than using the headword's combined
reading list.
Grammar retains its existing teaching fields and adds `token_form` and
`disambiguator`; its tokens are exactly `token_form/disambiguator`.
No gloss truncation, dictionary lookup, or AI inference happens when generating
the compact files. Disambiguators are explicitly authored, at most 64 characters,
and retain distinctions needed to identify the intended sense. A slash is the
single separator, never part of either component.

Grammar notation: `S` = subject (or statement in `S+吗`), `N` = noun phrase,
`V` = verb, `VP` = verb phrase, `Adj` = adjective, `P` = predicate,
`Num` = number, `Cl` = classifier, `Place` = location, `Time` = time expression.
`+` joins slots, `|` marks alternatives, and parentheses group alternatives.
For the A-not-A construction, predicate morphology follows the expanded
examples; slots are not a requirement to repeat an entire long phrase.

**Sense scope:** this pilot intentionally retains all usable dictionary senses,
including surnames, uncommon readings, archaic uses, and specialized meanings.
It is not a claim that every sense belongs in a beginner course or an official
HSK inventory. Source reference-only fragments still follow the existing
normalization policy. Upstream `meanings` entries first become source definitions;
synonyms inside one entry stay together. Explicit authored groups also combine
synonyms stored in separate entries, such as "father", "dad", "pa", and "papa"
for 爸. Do not mistake the source's array boundaries for linguistic sense
boundaries. Grouping is restricted to the same headword and reading; different
meanings and functions remain separate. All merged glosses and their
`source_sense_ids` are retained. Identical `(reading, normalized meaning)` pairs
across script variants are deduplicated. Existing headword-level gloss
corrections remain authoritative replacement meanings.
For this pinned HSK-1 input, 2,130 raw meaning occurrences yield 2,046 usable
occurrences after those existing normalization/correction rules, then 2,025
unique reading/gloss pairs after deduplication. Thirteen of those glosses are
pronunciation-only annotations (such as "also pr."), not dictionary meanings.
Excluding those leaves **2,012 source definitions**, all represented in the
canonical learning senses after synonym grouping. The original headword-level
reference gloss remains unchanged; meaning-bearing entries with pronunciation
notes are still retained.
The 368 explicit synonym aliases yield **1,644 canonical learning senses**.
Grouping is conservative where the source does not establish equivalence;
related but potentially distinct meanings remain separate.

One token explicitly repairs a misleading source hint: `zh-hsk1-00045-s001`
uses `车上(chē shàng)/in or on a vehicle`; its source gloss "Car" is preserved in the
expanded `english` field for provenance, not endorsed as an accurate translation.

Source-definition IDs append `-sNNN` in first-source-occurrence order to the
original headword ID, keeping gaps for excluded pronunciation-annotation slots.
A canonical sense keeps its group's earliest source-definition ID; each
`source_sense_ids` list starts with that canonical ID. These IDs are stable for
the pinned revision and current normalization/grouping,
not a promise across source changes. Never renumber to alphabetize labels.
The nested parent record provides the complete old-ID-to-new-IDs mapping;
prior progress on a headword does **not** imply mastery of all child senses.
Track new learning evidence by sense ID and retain old evidence at the parent
unless its practiced sense is known.

**Authoring and regeneration:** `authoring/hsk-1/vocabulary.yaml` maps each
canonical sense ID to its curated disambiguator.
`authoring/hsk-1/vocabulary-groups.yaml` explicitly maps synonymous source IDs
to their earlier canonical ID. Self-aliases, alias chains, and cross-headword
or cross-reading merges are rejected. Label edits never implicitly regroup
senses or change IDs.
`authoring/hsk-1/grammar.yaml` maps existing grammar IDs to their two token fields.
The importer requires exact canonical-label coverage and valid source references,
so missing or stale IDs cannot silently
fall back to guessed labels. Edit these files for permanent token changes;
grammar teaching content still comes from `authoring/grammar.psv`.
The importer produces both expanded and compact files together.

To regenerate only the compact views from checked-in expanded YAML, offline:

```powershell
python scripts\generate_curriculum_tokens.py
python scripts\generate_curriculum_tokens.py --check
```

An optional level-directory argument is supported, but other levels must first
be authored with this explicit token schema. `--check` never writes and fails
if either compact file is absent or differs. The shared curriculum validator
also detects stale compact outputs, duplicate IDs/tokens, malformed senses,
and ambiguous separators. Structural checks do not certify linguistic quality;
the new AI-authored disambiguators require human linguistic review.

These compact views share the expanded vocabulary's attribution and
CC-BY-SA-4.0 redistribution requirements. Ship them with this README,
`sources.yaml`, and the applicable license notices, even though each pair omits
provenance to save space.

### Pronunciation, senses and variants

The normal script is simplified Chinese. Pinyin retains upstream lexical tone
marks, spaces and neutral-tone syllables; neutral tone need not have an accent.
The source sometimes represents the rhotic suffix as a separate `r`. Treat it
as a rhoticized ending, not a freestanding syllable. Surface tone changes,
third-tone sandhi, neutral-tone variation and the tone changes of the words for
"one" and "not" need contextual instruction and reviewed audio, not mechanical
letter substitution. Grammar examples have English translations but no embedded
pinyin; the tutor can obtain reviewed pronunciations separately.

Multiple readings are separated by ` / `; corresponding sense groups in
`english` are prefixed by their pinyin in brackets. Do not teach every reading
as interchangeable. This is a general dictionary and retains some proper-name,
regional, dated and specialized senses. Start with the contextually relevant
modern mainland-Mandarin sense; review before presenting a sensitive or obscure
usage. No traditional-character inventory is redistributed.

The importer processes **all 32,430 upstream senses** belonging to the imported
headwords, not just rows that lack an English-looking field. It removes balanced
reference annotations, including nested parentheses, and strips reference-
dependent example/alias clauses as units rather than leaving their grammatical
fragments behind. Chinese-only references introduced by phrases such as "used
in", "short for", "same as", "equivalent of" and abbreviation labels are not
English senses. A source form—and its reading, if no other usable form supports
that reading—is omitted when no standalone sense remains. Meaningful English
usage descriptions and relational definitions remain: for example, "equivalent
to" is a legitimate translation of a word meaning equivalence, but not the
remnant of a deleted reference. Standalone English definitions after reference
labels are preserved along with region/domain tags when available.

This revision excludes 592 source senses before applying headword overrides,
omits 336 unusable source forms and removes 69 distinct headword/reading options;
**no vocabulary headword or stable ID is removed**. Seventeen headword-level
gloss repairs and seventeen explicit sense-rewrite rules are recorded separately
in `GLOSS_CORRECTIONS` and `SENSE_CORRECTIONS`. The latter repair reference-
dependent particle descriptions, traditional-unit definitions and similar
cases where blind deletion would destroy meaning. The generated normalization
report records these counts, and importer regression checks test both fragment
removal and preservation of valid English senses.

These operations also remove some nonsemantic reference detail, dictionary
examples, alias annotations and purely classificatory metadata; they do not
constitute an independent lexicographic audit of every surviving sense.
The upstream dictionary revision behind the composite source is unknown.

POS is deliberately blank rather than copying mixed-provenance POS analyses or
guessing. `topic` is a **heuristic English-gloss keyword classification**, not
official curriculum metadata. Multiple topics use semicolons; unmatched entries
use `general-and-abstract`. False positives are possible because dictionary
senses can be broad.

### Full-inventory scheduling

The five thematic blocks in each syllabus are recurring modules, **not a claim
that five lessons teach thousands of words**. Search both the named topics and
the suggested English gloss terms; then select useful unlearned entries.
Maintain a per-ID queue for **every row**, including the general/abstract
remainder. After thematic passes, sort remaining unseen IDs and assign each to
the best-fitting recurring module. Never silently leave the untagged tail out.
Revisit earlier bands as prerequisites. Track unseen, introduced, receptive,
productive and fragile states separately, along with the sense practiced.

Each tutorial cycle: retrieve due items; model meaning and pronunciation;
contrast one confusable form; do controlled practice; perform an information-gap
task; give targeted bilingual feedback; require a corrected retry. Reveal English
after a retrieval attempt, but keep it available. New tutor-generated target-
language material must also receive a checked English equivalent. Do not invent
official status, audio observations or exam outcomes.

## Licenses and redistribution

- **Headword/transcription wrapper:** Complete HSK Vocabulary's MIT notice and
  its Pleco/elkmovie source's MIT notice are both preserved in `licenses`.
  They do not relicense the underlying dictionary or official PDFs.
- **Adapted vocabulary:** CC-CEDICT attribution/share-alike obligations remain.
  Redistribute these adapted vocabulary files under **CC-BY-SA-4.0**, retain the source
  attribution and license links, and identify changes. The live MDBG download
  page directly links 4.0. Historic 3.0 and current 4.0 legal texts are both
  retained; 3.0 permits an adaptation under a later same-elements license.
  No assertion is made that the composite source recorded the dictionary's
  exact historical licensing transition.
- **Original grammar, examples, syllabi and gloss repairs:** original
  AI-assisted work, offered under CC-BY-SA-4.0 to the extent rights exist;
  not copied textbook examples, not official exam material, and requiring
  human linguistic review. Ordinary language facts are not claimed as property.
- **Official reference links:** metadata and links only. No open license is
  asserted over official standard/exam publications and no protected example
  collection is bundled. The source repositories' claims do not imply official
  endorsement.

Preserve `sources.yaml`, this attribution explanation, both MIT notices and the
applicable CC license when shipping the data. Share-alike applies to adapted
licensed material; this does not by itself assert a license for an entire
application that merely uses the collection.

## Reproduce and validate

From the repository root, using Python 3.10+ and the pinned YAML dependency:

```powershell
python -m pip install -r scripts\requirements.txt
python scripts\import_chinese_curriculum.py
python scripts\import_chinese_curriculum.py --check
```

The importer downloads the pinned source and refuses a SHA-256 mismatch:

`c869a0ce353279c9333d9b42c31fc3549785e8b40673dab57ee42bc99cd14131`

Revision: `7ac65bf1a6387d35f1ade478906172a19311c7f9`.
For offline reproduction, supply `--source` with a local copy of that exact
`complete.json`. It is not necessary to retain the entire upstream file in the
application. `--check` compares all 21 generated or synchronized files without modifying them
(14 expanded level assets, two HSK-1 compact views, the additional reference
senses, the beginner sequence and its two compact views, and the normalization report)
and runs normalizer regressions;
syllabi and metadata are authored separately. Changing the revision requires a
fresh license/provenance check, count reconciliation and ID migration review.
