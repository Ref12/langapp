# Japanese: JLPT-oriented tutor curriculum

This is a broad, reusable teaching collection, **not an official or exhaustive JLPT word/grammar specification**. Modern JLPT does not publish such a list. Official information describes receptive competence; the vocabulary placement here is an older community estimate, and grammar placement is an original pedagogical estimate. An N1 label does not make every dictionary sense an N1 requirement, nor does an N5 label make advanced senses beginner material.

## Inventory

| Directory | New vocabulary entries | Cumulative vocabulary | Grammar constructs | Original bilingual examples |
|---|---:|---:|---:|---:|
| `jlpt-n5` | 679 | 679 | 45 | 90 |
| `jlpt-n4` | 635 | 1,314 | 45 | 90 |
| `jlpt-n3` | 1,667 | 2,981 | 45 | 90 |
| `jlpt-n2` | 1,747 | 4,728 | 45 | 90 |
| `jlpt-n1` | 3,100 | 7,828 | 45 | 90 |
| **Total** | **7,828** | **7,828** | **225** | **450** |

The verified mapping contains **8,293 rows**, not 8,293 distinct new words. Deduplication removes **443 overlaps** by `(JMdict entry ID, kana reading)`, retaining the earliest N5-to-N1 placement; **22 unverifiable records** are excluded, not guessed. One source spelling is normalized to a verified compatible spelling. `import-report.yaml` records exact decisions and retained IDs. Orthographic aliases are not counted as extra words. A single entry can retain several numbered English senses. The total is deliberately below an inflated “8,000–12,000 unique words” claim: coverage is the full safely matched source selection, not a round-number target.

Each level has:

- `vocabulary.yaml`: UTF-8 YAML list, shared nine-field schema, English glosses, kana pronunciation, POS and coarse topics.
- `grammar.yaml`: a list of 45 meaningful teaching constructs, English meanings, usage notes, and two original translated examples each.
- `syllabus.md`: nine ordered thematic blocks referring to every actual grammar ID, vocabulary allocation instructions, reading/kanji progression, four-skill practice and observable exit rubrics.

## How a tutor should use the data

1. Place the learner using the previous level's exit tasks, not a self-reported word count. N5 begins without Japanese prerequisites.
2. Each vocabulary row identifies a **lexeme-reading combination**, not a flashcard for all its senses at once. Initially teach a current, common meaning suitable for the task. Add collocations and context-sensitive meanings in later reviews. Maintain sense-level progress separately.
3. `english` separates dictionary senses with ` | ` and numbers; semicolons separate glosses within a sense. Preserve restrictions, register and specialist labels. Do not concatenate senses into a single impossible translation.
4. `reading` is a JMdict-verified kana reading. Hiragana and katakana are both valid; a kana headword may repeat its reading. Only readings present in the source mapping become teaching rows. These files do **not** enumerate all pronunciation variants or provide word audio, pitch accent, furigana alignment or independent kanji readings. Homographs with different dictionary IDs/readings may remain distinct. Never infer a word's reading by combining isolated character readings.
5. `topic` is a deterministic **heuristic based on the first retained sense**, not a reviewed semantic ontology. `general-language` is a real residual bucket, not a claim that a word lacks a topic. Review all topic selections manually against English meaning and POS. Reassign lessons rather than silently modifying provenance.
6. The local rubrics assess learning, not exam scores. Speaking and writing are tutor enrichment; **JLPT assesses language knowledge, reading and listening, not speaking or writing**. No local score implies an official JLPT pass or a four-skill CEFR certification.
7. Preserve Japanese-English pairing when presenting or generating material. During recall, hide the English until the learner responds. Additional generated examples must be checked for reading, meaning, register and grammar; the supplied examples are AI-authored and await qualified human review.

## Sources and reuse obligations

See the list in `sources.yaml` for exact URLs, pins, component usage and attribution. Local notices are in `licenses`.

**Dictionary component:** English senses, readings and POS derive from **JMdict/EDICT**, copyright James William Breen and the **Electronic Dictionary Research and Development Group (EDRDG)**, used in conformance with [the Group's licence](https://www.edrdg.org/edrdg/licence.html). The underlying license is **CC-BY-SA 4.0**. Credit EDRDG and provide documentation/license access in deployed apps. EDRDG's statement requires a regular updating procedure and gives at least monthly updates for web dictionary servers as an example. A static curriculum snapshot is not a deployment refresh service.

**Level component:** Jonathan Waller's [JLPT Resources](https://www.tanos.co.uk/jlpt/) permit nonsold material under **CC BY**; Waller's sharing page does not state a version, so we do not invent one. **stephenmk/yomitan-jlpt-vocab** provides reviewed JMdict entry-ID matching and is **CC-BY-SA 4.0**. Credit both Waller and stephenmk. These estimates are neither new official lists nor guarantees about exam placement.

**Transformation component:** JSON dictionary transformation is from **scriptin/jmdict-simplified**, release `3.6.2+20260831182826`. Credit it as well as EDRDG. Its published 11,510,336-byte English archive is SHA256-verified. Only mapped entries are retained locally; no sentence corpus, paid course, audio, kanji stroke artwork or Tatoeba examples are redistributed.

**Original component:** Grammar teaching selection, original examples, syllabi and rubrics were AI-authored for this project and are supplied under CC-BY-SA 4.0 to the extent copyright applies, pending human review. They are not copied textbook passages or exam questions. The official [level summary](https://www.jlpt.jp/e/about/levelsummary.html) and [FAQ](https://www.jlpt.jp/e/faq/index.html) are linked for reference and paraphrased, not relicensed.

**Modification notice:** We joined selected source IDs/readings to the 2026-08-31 JMdict snapshot, filtered senses by spelling/reading restrictions, retained English glosses and tags, omitted Japanese-containing ancillary usage notes from learner glosses, normalized one incompatible spelling, removed overlaps/unverified records, and added IDs, approximate topics and teaching materials. Keep this notice and upstream attribution when redistributing. Share adapted vocabulary datasets under CC-BY-SA 4.0 or an allowed compatible license; do not treat a tool's permissive code license as permission to strip dictionary attribution/share-alike. Dictionary licensing does not automatically require an entire unrelated application codebase to use the data license.

The retained mapping CSVs and selected JMdict JSON under `upstream` are **provenance inputs, not lesson-ready bilingual artifacts**; they preserve upstream technical fields and historical notes. Teach from the level outputs. `licenses` contains original legal notices, not lessons.

## Rebuild and refresh

From the repository root, using Python 3.10+ and the pinned YAML dependency:

```powershell
python -m pip install -r scripts\requirements.txt
python scripts\import_japanese_curriculum.py --validate-only
python scripts\import_japanese_curriculum.py
python scripts\import_japanese_curriculum.py --download
```

After installing dependencies, `--validate-only` checks committed files without writes. Running without options rebuilds vocabulary and grammar offline from the checked-in mapping, dictionary subset and original `teaching\grammar.tsv`. `--download` retrieves **the pinned versions**, verifies source checksums, replaces only Japanese inputs/outputs and records a new retrieval timestamp. It does **not** automatically discover or upgrade to today's dictionary.

For a release refresh, review the latest English-only JMdict release and license, update `DICTIONARY_VERSION`, `DICTIONARY_URL` and `DICTIONARY_SHA256` in the importer, and explicitly review any mapping change before updating `MAPPING_COMMIT` and `MAPPING_HASHES`. Run the download and validation commands; inspect exclusions, altered senses and retained spelling-reading pairs; update counts, pins, retrieval dates and modification notes in this README and `sources.yaml`. Keep archived release provenance for deployed versions. No automated monthly refresh job is installed by this collection.

`upstream\download-lock.json` records all downloaded hashes and the selected-subset hash. The importer refuses altered inputs rather than silently accepting an unrelated archive. Rows retain upstream line-based IDs with gaps; a new mapping release can change those IDs, so migrate saved learner progress by `(JMdict ID, reading)` rather than by source line alone.

## Coverage and remaining gaps

- Broad source-backed vocabulary at all five levels, with full compatible English sense information; not a ranked frequency list or a modern official test inventory.
- 225 major constructs, not an exhaustive grammar encyclopedia. Some forms are introduced earlier here than in particular community guides. N1 includes formal/literary recognition, not a claim that those constructions are everyday speaking targets.
- Original bilingual examples and lesson procedures, but no packaged full-length graded readers, audio recordings, test bank or externally calibrated assessments. Listening requires tutor speech, authorized audio or reviewed TTS.
- Practical kana/kanji progression is supplied in the syllabi; there is no separately sourced exhaustive kanji/counter/onomatopoeia inventory. Pronunciation variants, pitch accent, collocations, dialects, honorific exceptions and specialist register need additional reviewed instruction.
- The source dictionary contains rare, archaic, sensitive and specialist senses. Preserve labels, select age-appropriate modern meanings for instruction, and never treat an old or offensive sense as neutral everyday usage.
- Data integrity is machine-validated; native-speaker accuracy, pragmatic naturalness, topic assignments and educational level placements still need human review. The collection is a substantial tutor curriculum foundation, not an endorsement or guarantee of exam readiness.

## Character-writing candidates

`characters` implements the [shared character contract](../CHARACTERS.md), not
a handwriting recognizer or production exercise. It contains an intentionally
small **34-key, six-page first batch**, all **unreviewed**. The full native scope
is **2,211 required characters/signs plus two component-only combining marks**
across 82 nonempty 256-codepoint ranges. `coverage.yaml` retains that complete
scope even while most artwork has not been imported. A successful mechanical
check is not a complete or approved release.

The first batch is:

```text
あ ぁ き ぎ さ ざ ぬ ね の ぱ ぷ つ っ シ ツ ソ ン
ヴ ゔ ヵ ヶ ー ゛ ゜ 、 。 〇 秭 一 勉 辻 鬱 U+3099 U+309A
```

The shared inventory includes every Japanese scalar in all five levels'
vocabulary target/readings and grammar patterns/example targets, with
per-field evidence and input hashes. The 2,189 literal Japanese scalars include
2,035 unified ideographs, 151 kana-block characters (including `ー`) and
`、。々`. Foundations add 24 keys. No existing word ID, spelling, reading or
meaning is changed by this importer; word readings are not split into isolated
kanji readings.

### Exact foundations and exclusions

The approved foundation is **168 letters**: 84 hiragana (U+3041..U+3096 except
`ゐゑ`) and 84 katakana (U+30A1..U+30FA except `ヰヱヷヸヹヺ`). Each script
includes 46 basic kana, 20 ordinary voiced forms, five semi-voiced forms,
`ゔ`/`ヴ`, and 12 small forms:

```text
ぁぃぅぇぉっゃゅょゎゕゖ
ァィゥェォッャュョヮヵヶ
```

The nine additional foundation keys are `、。〇゛゜・ー` and U+3099/U+309A.
`〇` is an explicitly selected modern number/date prerequisite, not an
automatic import from the English zero gloss. The composing marks are
`Inherited` components; their spacing counterparts are distinct `Common`
signs. `々` is required by actual words, not a kana or a character with one
universal reading. Multi-kana spellings such as `きゃ` and `ヴァ` are sequences,
not multi-character record keys. No automatic normalization or alias redirect
collapses precomposed/combining forms, regional forms or compatibility scalars.

Do not extend this foundation automatically to historical kana, Ainu/phonetic
extension blocks, an unrelated kanji database, or whole Unicode blocks.
Grammar-only `〜／＋` and Latin slot notation are excluded as notation.
Gloss-only `〓` is not an authoritative Japanese target.

The exact fullwidth Latin targets **`ＧＫＯｘ`** remain visible cross-script
exceptions: `Ｇパン` (ja-n1-03292), `ＯＫ` (ja-n1-03247), and `ｘ`
(ja-n2-01344). They have no drawable artwork here and are not folded to ASCII.
Do not claim all target text is covered while these exceptions remain.

### Source selection, geometry and rights

KanjiVG is primary, pinned to
`422b5538595676da918c288a4230cb5e22a1ee7e`. Its pinned inventory has 6,704 default
SVGs and 4,957 variants; it directly covers 2,208 of the 2,213 expected native
keys, including all 168 modern kana. The first batch retains 30 direct KVG
glyphs, two KVG-derived contextual marks, and two selective animCJK glyphs.
These are source-available/candidate counts, not visual approvals.

animCJK is pinned to `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6`, with 7,007
`svgsJa` and 177 `svgsJaKana` files. Only exact Japanese `秭` and `〇` supplement
KVG. Its per-file licenses differ: **`秭` is ARPHIC PUBLIC LICENSE; `〇` is
LGPL-3.0-or-later**, despite both residing in `svgsJa`. Do not infer licenses
from directory names or a tool's code license. The graphics-prefixed text
exports are not used.

All KVG derivatives remain **CC BY-SA 3.0** with Ulrich Apel/KanjiVG credit,
original notices and modification statements. Retain the unmodified ARPHIC
license and freely available derivative source for `秭`; retain FM-SH credit,
LGPL and its incorporated GPLv3 text, replaceable artwork and reproducible
source for `〇`. Sources, complete licenses and dated modification notices
are under `upstream\writing` and `licenses\writing-*`. A mixed-license page is a
collection of separately attributed records, not one blanket Japanese-data
license, and does not relicense unrelated application code.

The importer keeps original source-em proportions: KVG's 109-unit frame and
animCJK's 1024-unit frame map uniformly to the shared 100-unit y-down frame,
width 5.5 and round caps/joins. Native small kana stay reduced and offset.
It retains curved loops and continuous logical pen-downs, expands relative/
reflected SVG segments through the shared normalizer, and never applies the
Chinese prototype's short-fall/hook corrections or tight bounding-box fitting.
Matching samples derive from these same final paths using the shared sampler.

The distinction between logical strokes and SVG pieces is essential:
KVG `あ/ぬ/ね/の` have 3/2/2/1 strokes. animCJK's overlapping kana can have
duplicated clipped medians and off-frame animation helpers; those are not extra
pen lifts and are not concatenated by this adapter. The selected `秭` has nine
ordered medians and `〇` one. `〇` retains its **actual open source median**,
including its entry/exit; no unmarked closed-circle correction is applied.

U+3099 selects the two upper-right dakuten paths from KVG `が`; U+309A selects
the single upper-right handakuten path from `ぱ`, with exact source/recipe hashes.
These are contextual component samples, not a universal attachment algorithm.
Spacing `゛゜` retain their separate source placement rather than being enlarged
or silently substituted for combining marks. Donor glyphs belong in extraction
provenance and recipes: the whole `が` glyph is not a structural component of
dakuten, and is not recorded as one.

### Remaining exact-glyph blocker

**`鱝` U+9C5D** (ja-n1-00294, `えい`, JMdict:1001130) is absent from both
pinned sources. Its usual-kana label does not authorize changing its target to
kana, a simplified form, a different fish or another locale's glyph.
It remains `source_blocked`, with no fake drawable/default variant.

`recipes.yaml` describes a separate **review-only** 23-stroke proposal:
fish-left paths s1..s11 from KVG `鱗` (`09c57.svg`) followed by right-hand `賁`
paths s4..s15 from `噴` (`05674.svg`), in the original shared em box. Both
donors and the recipe are pinned and attributed. This is newly composed
CC-BY-SA-3.0 artwork, not an upstream `鱝` asset; generating its review fixture
does not close the blocker or set review flags.

### Offline generation and review

Use the existing Python 3.10+ runtime and pinned PyYAML dependency. On this
Windows environment `py -3.12` avoids the Store `python` alias:

```powershell
py -3.12 -B scripts\import_japanese_characters.py --check
py -3.12 -B scripts\import_japanese_characters.py --validate-only
py -3.12 -B scripts\test_japanese_characters.py
py -3.12 -B scripts\validate_characters.py --language japanese --check
```

Running the importer without options rebuilds **the batch recorded in the
source lock**, currently `first`, offline. `--check` regenerates expected
outputs in memory and reports stale files without writes or network access.
`--validate-only` uses the shared committed-bundle checker, including inventory,
source/recipe/license hashes and cross-script accounting.

`--download --batch first` explicitly refreshes the fixed source subset from
SHA-256-pinned archives, never from a changing branch HEAD. Only selected
original members/notices are retained, not whole archives or extra databases.
`--archive-directory <path>` may supply the two checksum-verified cached
`kanjivg-pinned.tar.gz` and `animcjk-pinned.tar.gz` files. Downloads are assembled
and verified before any source output is replaced.

`--review-directory <path>` writes a separate first-batch HTML comparison with
original-source thumbnails, numbered normalized paths, same-path animation,
candidate JSON, and copied original sources/recipes/licenses. It includes the
blocked fish fixture with independent recipe/provenance. Every new asset is
unreviewed; neither agent inspection nor a numerical pass is professional
Japanese approval.

Bulk generation requires explicit first-batch direction; the importer will not
fetch missing full-batch inputs silently. After that approval,
`--download --batch full` selects the complete required native inventory.
Unresolved `鱝`, cross-script targets, component gaps and unreviewed states still
prevent a release-ready claim. Preserve exact review evidence and regenerate
after changing sources, recipes, adapter version or shared geometry utilities.
