# Chinese: nine-band teaching collection

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
learning a higher band requires all earlier folders. The source merges readings
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

- `vocabulary.yaml`: UTF-8 YAML list, exact shared nine-field schema; stable per-revision
  IDs, simplified target, tone-marked pinyin, English definitions and provenance.
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
application. `--check` compares all 15 generated files without modifying them
(14 level assets plus the normalization report) and runs normalizer regressions;
syllabi and metadata are authored separately. Changing the revision requires a
fresh license/provenance check, count reconciliation and ID migration review.
