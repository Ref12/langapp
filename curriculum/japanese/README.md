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

The verified mapping contains **8,293 rows**, not 8,293 distinct new words. Deduplication removes **443 overlaps** by `(JMdict entry ID, kana reading)`, retaining the earliest N5-to-N1 placement; **22 unverifiable records** are excluded, not guessed. One source spelling is normalized to a verified compatible spelling. `import-report.json` records exact decisions and retained IDs. Orthographic aliases are not counted as extra words. A single entry can retain several numbered English senses. The total is deliberately below an inflated “8,000–12,000 unique words” claim: coverage is the full safely matched source selection, not a round-number target.

Each level has:

- `vocabulary.csv`: UTF-8, shared nine-column schema, English glosses, kana pronunciation, POS and coarse topics.
- `grammar.json`: an array of 45 meaningful teaching constructs, English meanings, usage notes, and two original translated examples each.
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

See the array in `sources.json` for exact URLs, pins, component usage and attribution. Local notices are in `licenses`.

**Dictionary component:** English senses, readings and POS derive from **JMdict/EDICT**, copyright James William Breen and the **Electronic Dictionary Research and Development Group (EDRDG)**, used in conformance with [the Group's licence](https://www.edrdg.org/edrdg/licence.html). The underlying license is **CC-BY-SA 4.0**. Credit EDRDG and provide documentation/license access in deployed apps. EDRDG's statement requires a regular updating procedure and gives at least monthly updates for web dictionary servers as an example. A static curriculum snapshot is not a deployment refresh service.

**Level component:** Jonathan Waller's [JLPT Resources](https://www.tanos.co.uk/jlpt/) permit nonsold material under **CC BY**; Waller's sharing page does not state a version, so we do not invent one. **stephenmk/yomitan-jlpt-vocab** provides reviewed JMdict entry-ID matching and is **CC-BY-SA 4.0**. Credit both Waller and stephenmk. These estimates are neither new official lists nor guarantees about exam placement.

**Transformation component:** JSON dictionary transformation is from **scriptin/jmdict-simplified**, release `3.6.2+20260831182826`. Credit it as well as EDRDG. Its published 11,510,336-byte English archive is SHA256-verified. Only mapped entries are retained locally; no sentence corpus, paid course, audio, kanji stroke artwork or Tatoeba examples are redistributed.

**Original component:** Grammar teaching selection, original examples, syllabi and rubrics were AI-authored for this project and are supplied under CC-BY-SA 4.0 to the extent copyright applies, pending human review. They are not copied textbook passages or exam questions. The official [level summary](https://www.jlpt.jp/e/about/levelsummary.html) and [FAQ](https://www.jlpt.jp/e/faq/index.html) are linked for reference and paraphrased, not relicensed.

**Modification notice:** We joined selected source IDs/readings to the 2026-08-31 JMdict snapshot, filtered senses by spelling/reading restrictions, retained English glosses and tags, omitted Japanese-containing ancillary usage notes from learner glosses, normalized one incompatible spelling, removed overlaps/unverified records, and added IDs, approximate topics and teaching materials. Keep this notice and upstream attribution when redistributing. Share adapted vocabulary datasets under CC-BY-SA 4.0 or an allowed compatible license; do not treat a tool's permissive code license as permission to strip dictionary attribution/share-alike. Dictionary licensing does not automatically require an entire unrelated application codebase to use the data license.

The retained mapping CSVs and selected JMdict JSON under `upstream` are **provenance inputs, not lesson-ready bilingual artifacts**; they preserve upstream technical fields and historical notes. Teach from the level outputs. `licenses` contains original legal notices, not lessons.

## Rebuild and refresh

From the repository root, using Python 3.10+ and the standard library:

```powershell
python scripts\import_japanese_curriculum.py --validate-only
python scripts\import_japanese_curriculum.py
python scripts\import_japanese_curriculum.py --download
```

The first command checks committed files without writes. The second rebuilds vocabulary and grammar offline from the checked-in mapping, dictionary subset and original `teaching\grammar.tsv`. The third retrieves **the pinned versions**, verifies source checksums, replaces only Japanese inputs/outputs and records a new retrieval timestamp. It does **not** automatically discover or upgrade to today's dictionary.

For a release refresh, review the latest English-only JMdict release and license, update `DICTIONARY_VERSION`, `DICTIONARY_URL` and `DICTIONARY_SHA256` in the importer, and explicitly review any mapping change before updating `MAPPING_COMMIT` and `MAPPING_HASHES`. Run the download and validation commands; inspect exclusions, altered senses and retained spelling-reading pairs; update counts, pins, retrieval dates and modification notes in this README and `sources.json`. Keep archived release provenance for deployed versions. No automated monthly refresh job is installed by this collection.

`upstream\download-lock.json` records all downloaded hashes and the selected-subset hash. The importer refuses altered inputs rather than silently accepting an unrelated archive. Rows retain upstream line-based IDs with gaps; a new mapping release can change those IDs, so migrate saved learner progress by `(JMdict ID, reading)` rather than by source line alone.

## Coverage and remaining gaps

- Broad source-backed vocabulary at all five levels, with full compatible English sense information; not a ranked frequency list or a modern official test inventory.
- 225 major constructs, not an exhaustive grammar encyclopedia. Some forms are introduced earlier here than in particular community guides. N1 includes formal/literary recognition, not a claim that those constructions are everyday speaking targets.
- Original bilingual examples and lesson procedures, but no packaged full-length graded readers, audio recordings, test bank or externally calibrated assessments. Listening requires tutor speech, authorized audio or reviewed TTS.
- Practical kana/kanji progression is supplied in the syllabi; there is no separately sourced exhaustive kanji/counter/onomatopoeia inventory. Pronunciation variants, pitch accent, collocations, dialects, honorific exceptions and specialist register need additional reviewed instruction.
- The source dictionary contains rare, archaic, sensitive and specialist senses. Preserve labels, select age-appropriate modern meanings for instruction, and never treat an old or offensive sense as neutral everyday usage.
- Data integrity is machine-validated; native-speaker accuracy, pragmatic naturalness, topic assignments and educational level placements still need human review. The collection is a substantial tutor curriculum foundation, not an endorsement or guarantee of exam readiness.
