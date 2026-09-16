# Korean: six-stage TOPIK-oriented teaching collection

Version: **2026-09-07**, placement method `semantic-band-heuristic-v1`.
This is a substantial **teaching inventory**, not an official exhaustive TOPIK
word list, an official grammar syllabus, or a guarantee of an exam result.

The separate [practical Korean program](teaching/README.md) curates precise
meanings into thirty levels nested under six numbered phases, with a standalone
tourist route and optional branches. The reference inventory below is preserved;
its heuristic TOPIK folders are not the new course's teaching order. New
per-item, per-modality evidence policies are in `teaching/mastery.yaml`, and
the official-text/authored-reading distinction is in
`teaching/pronunciation.md`. The original source's empty readings remain empty.

## Standards and what the labels mean

- **TOPIK I awards levels 1–2**; **TOPIK II awards levels 3–6**.
  NIIED's official overview distinguishes paper-based and internet-based formats.
  TOPIK I assesses listening and reading; TOPIK II adds writing. TOPIK Speaking
  is separate. **This curriculum teaches listening, speaking, reading, and
  writing at every stage**, including pronunciation and interpersonal pragmatics.
  Speaking outcomes below are teaching outcomes, not claims about the ordinary
  TOPIK I/II test.
- Capability anchors are paraphrases of **NIKL's Standard Curriculum for Korean
  Language, Proclamation 2020-54 (effective 2020-11-27), English edition posted
  2021-01-29**, Table 2, printed pages 11–12 and the four-skill appendix.
  This general educational framework is **not TOPIK's test-scoring rubric**.
  The official Sejong curriculum independently organizes an introduction and
  beginner/intermediate/advanced courses around six educational stages.
- No score thresholds are reproduced: PBT and IBT have distinct scales and
  structures that must be checked at the official site before test preparation.
  No CEFR equivalence or native-speaker equivalence is asserted.

| Folder | New dictionary entries | Grammar constructs | Original translated examples | NIKL capability anchor, paraphrased |
|---|---:|---:|---:|---|
| `topik-1` | 1,055 | 36 | 72 | Brief everyday exchanges, introductions, simple messages and familiar objects |
| `topik-2` | 887 | 36 | 72 | Routine public situations, questions, requests, permission and everyday messages |
| `topik-3` | 1,482 | 36 | 72 | Familiar social situations, recommendations, advice, explanations and information exchange |
| `topik-4` | 2,499 | 36 | 72 | Familiar social/abstract topics and basic workplace discourse; agreement, disagreement and reports |
| `topik-5` | 1,973 | 36 | 72 | General social and work/study discourse; systematic information, discussion and supported opinions |
| `topik-6` | 3,132 | 36 | 72 | Professional/academic discourse; sociocultural interpretation, persuasion and logical argument |
| **Total** | **11,028** | **216** | **432** | |

There are **10,020 distinct target spellings** and **10,579 target/POS pairs**.
Counts measure dictionary entries, not 11,028 distinct words. Different senses,
homographs, and parts of speech retain separate source records. Therefore some
spellings recur within or across levels; **442 spellings appear in more than
one level** because source entries/senses are retained. No cumulative copying of earlier
vocabulary files is performed. Learners must retain earlier knowledge.

## Provenance and responsible placement

All **11,028 banded records** in the pinned January 2024 NIKL dictionary mirror
are present: **1,942 beginner, 3,981 intermediate, 5,105 advanced**. The mirror's
**42,144 unbanded records are excluded from those TOPIK reference folders**,
not silently marked advanced. The independent practical program narrowly
retains selected essential unbanded parents in `source-senses.yaml`, under
`authoring/teaching/support-parents.yaml`; it does not change the reference totals.
The mirror is an unofficial historical extraction of 53,172 records; it is not
the latest official export and lacks official sense IDs and pronunciation fields.

The source's labels are 초급 (beginner), 중급 (intermediate), and 고급 (advanced).
They are dictionary teaching bands, **not official TOPIK grades**. Every
`level_basis` preserves the source band and identifies a project heuristic:

1. Beginner records are split between stages 1 and 2. Stage 1 prioritizes a
   manually selected core spelling set, basic daily-life semantic categories,
   pronouns, numerals and interjections. Other beginner entries go to stage 2.
2. Intermediate records in concrete daily/social categories go to stage 3.
   Abstract, economic, political, religious, academic and selected discourse
   categories, form-building POS classes, and source-uncategorized records
   go to stage 4.
3. Advanced professional/social categories go to stage 5. Specialist, abstract,
   selected academic/cultural categories, form-building POS classes, and
   source-uncategorized records go to stage 6.

These are deterministic **semantic-band scheduling rules, not frequency
rankings or measured item difficulty**. Uncategorized placement is explicitly
a fallback, not evidence of higher difficulty. The uneven counts are intentional;
no alphabetical blocks or arbitrary equal quotas are presented as an official
list. Rules and core spellings are visible in the importer. Teachers should
promote or defer individual senses after a diagnostic task; the source band
must remain visible when local schedules change.

English cells are genuine dictionary **definitions**, often longer than a
flashcard gloss; multiple senses from one source record are joined with ` / `.
Do not mechanically use every definition as an interchangeable translation.
Sixteen glosses containing Korean/Hanja metalinguistic expressions were replaced by
self-contained original English equivalents; the patch mapping is in the
importer. There are no empty English cells or dummy translation placeholders.

The importer translates source semantic labels into English topic paths.
`general / source uncategorized` is an honest missing-category marker, not a
teaching topic. Syllabi instruct the tutor to search those records' English
definitions and POS, then confirm the intended sense. It is not permission to
discard this large part of the inventory.

## File contract and stable identity

- `vocabulary.yaml`: UTF-8 YAML list, exact shared nine-field schema. IDs `ko-nikl-NNNNN`
  derive from the pinned source data-record ordinal and do not change merely
  because a teaching grade changes. `source_entry` is the pinned download plus
  `#record=N`: a documented row locator, **not a fabricated official entry ID**.
- `grammar.yaml`: YAML list, 36 constructs per stage, at least two newly
  authored bilingual examples each. `N` means noun, `V` action verb, `A`
  descriptive verb/adjective; slashes mark alternative forms, parentheses mark
  conditioned segments, and hyphens indicate affix attachment. English meaning
  and inflection/register notes accompany every pattern.
- `grammar-authoring.tsv`: maintainable bilingual authoring source for the YAML.
  Grammar IDs follow its order; append new rows rather than inserting ahead of
  existing rows unless intentionally revising all syllabus references.
- `syllabus.md`: ordered lesson blocks, vocabulary retrieval instructions,
  grammar IDs, four-skill practice and observable exit criteria.
- `sources.yaml`, `licenses/NOTICE.md`, `import-report.yaml`: provenance,
  component-specific obligations, checksum and counts.

## Hangul, pronunciation and pragmatic prerequisites

Begin with Hangul block composition, vowel/consonant recognition, keyboard input
and syllable segmentation. The introductory study stage is **not an extra TOPIK
grade**. Contrast plain, aspirated and tense consonants through listening and
production; explain articulatory differences briefly rather than relying on
English spelling. Introduce final consonants and their reduced release before
asking learners to decode full beginner sentences.

The vocabulary `reading` field is deliberately empty: the pinned mirror does not
provide pronunciations. Do not mistake unchanged spelling or romanization for
verified audio. Target orthography is standard Hangul; bracketed Hangul below
represents a **broad pedagogical pronunciation**, not a replacement spelling.
No audio files or a verified comprehensive pronunciation lexicon are included.

Use these original bilingual mini-contrasts progressively:

| Process | Original teaching examples with English |
|---|---|
| Linking across a vowel-initial particle | 밥 (cooked rice) → 밥이 [바비] (cooked rice + subject marker) |
| Final obstruent neutralization and release | 옷 [옫] (clothing), 옷이 [오시] (clothing + subject marker) |
| Nasal assimilation | 한국말 [한궁말] (Korean speech) |
| Liquid assimilation | 신라 [실라] (Silla, a historical Korean kingdom) |
| Aspiration with the breath consonant | 좋다 [조타] (be good) |
| Palatalization in the appropriate boundary | 같이 [가치] (together) |
| Consonant tensing | 학교 [학꾜] (school) |
| Final cluster before a vowel ending | 읽어요 [일거요] (read; polite) |

Revisit vowel contraction, spacing, irregular stems, natural phrase grouping,
question intonation, focus and discourse prosody in every stage. Teach
irregular conjugations using a checked verb family and contrasting examples,
not a claim that every stem with the same final consonant behaves alike.
Regional pronunciation and acceptable variants need qualified review.

Separate **listener politeness, subject honorification, humble reference,
familiar speech and written formality**. Informal does not mean rude, and formal
does not automatically mean socially appropriate. Ask who is speaking, to whom,
about whom, in which setting. Do not force learners to share real personal
information for role-play; fictional identities are sufficient.

## AI tutor delivery and review

Each syllabus has 12 ordered blocks; a block is a **mastery unit**, not a single
lesson or a fixed number of study hours. Expand it into enough sessions for the
learner's pace. This is a large receptive/production bank, not an instruction to
memorize 3,000 words in twelve meetings.

1. Diagnose earlier-stage comprehension, Hangul fluency and social register.
2. Retrieve a small sense-specific set (roughly 8–15 new active items), checking
   English meaning, POS and source band. Include additional receptive words only
   when needed for a comprehensible text.
3. Show the pattern and both translated examples. Ask the learner to infer the
   contrast; give one short explanation and a counterexample if needed.
4. Move through listening identification, reading, constrained substitution,
   information-gap speaking and short writing. Original/generated Korean
   prompts, model answers and corrections must always carry English equivalents
   in tutor materials; hide them temporarily during retrieval, then reveal.
5. Track each **entry/sense ID** and grammar ID as introduced, recognized,
   recalled, used with support, or transferred independently. Topic membership
   or a checked box is not evidence of mastery.
6. Retrieve after about 1, 3, 7, 14 and 30 days, adjusting after errors. Mix
   current and earlier entries; contrast near-synonyms and easily confused forms.
7. After each three blocks, use a new task with different names, settings and
   lexical combinations. Keep error notes on meaning, form, sound and register.

For dictionary omissions or unreviewed pronunciation, explicitly say what is
unknown; never fabricate official translations, word frequency, examination
appearance rates, score conversion, or sources for invented statistics.

## Assessment interpretation

The syllabi's task lengths, pass rules and rubric are **original teaching
criteria**, not official TOPIK marking scales. Assess all four skill domains
separately. A strong reading score cannot erase an inability to interact.
Allow accessibility adaptations and alternative recording/input methods while
keeping the communicative target observable.

Each exit task receives 0–4 on task fulfillment, comprehension/meaning,
language control, organization/fluency, and pragmatic appropriateness. Common
anchors: **0** no assessable evidence; **1** fragments with frequent breakdown;
**2** partial completion with substantial support; **3** independent completion
with minor nonblocking errors; **4** effective transfer to an unfamiliar
variation with precise, appropriate expression. Level-specific evidence is in
each syllabus. Require at least 3 in each dimension on each skill task, then
repeat a parallel task at least a week later. This rule supports teaching
decisions; it does not predict an official score or demand zero errors.

## Licensing, gaps and updates

**Dictionary data is CC BY-SA 2.0 Korea**, not MIT: credit NIKL and contributors,
credit binjang's extraction, link the source/license, indicate adaptations,
and preserve share-alike. The official English and Korean policies were checked
directly. Original grammar, syllabi and importer are CC0 to the extent rights
apply. Official NIIED/Sejong resources are reference-only; NIKL's standard
publication is marked KOGL Type 1. See `licenses/NOTICE.md` before distribution.

This collection covers every banded source entry and a broad major-construct
selection, **not every Korean word, suffix, idiom or grammar pattern**. Gaps:
the unbanded source pool beyond narrowly selected practical support;
post-January-2024 lexical updates; complete
pronunciation/audio; detailed dialect, historical language and specialist
terminology; official exam items; professionally moderated learner assessments.
Affixes and bound nouns remain lexical entries and do not substitute for
explicit grammar instruction. AI-authored examples and heuristic grade
placement require Korean-teacher review before production use.

From the repository root, using Python 3.10+ and the pinned YAML dependency:

```powershell
python -m pip install -r scripts\requirements.txt
python scripts\import_korean_curriculum.py
python scripts\import_korean_curriculum.py --grammar-only
python scripts\import_korean_curriculum.py --source-file path\to\2024_01.csv
```

The importer downloads a **pinned revision**, verifies its SHA-256, and keeps no
raw third-party usages on disk. `--source-file` enforces the same checksum.
Regeneration is deterministic. A new upstream version requires an explicit
revision/checksum review, renewed license check, source-row identity migration,
translation audit and updated counts—not a silent replacement with `main`.

## Original character-writing pilot

The separate `characters/` bundle is a **bounded, original AI-assisted,
unreviewed monoline pilot**, not a licensed import of Hangul stroke paths or
a production handwriting activity. Its current output has **174 candidates**:
118 exact modern-jamo foundation representations, 54 explicitly selected
curriculum syllables, and the two Common-script literal signs `.` and `?`.
Every generated variant has `reviewed: false`; `release_ready` remains false.
No vocabulary targets, empty readings, grammar entries, or learning IDs change.

The [review preview](characters/pilot-preview.html) displays exact final paths,
stroke order/direction annotations, replay, matching-sample overlays, component
extents, and conservative density/contact warnings. It supports scalar search
and a flagged-only filter; `?characters=가값흰` selects a small comparison.
`?view=overview` shows a compact contact sheet without annotation clutter.
Direction labels are off initially; **Next stroke** isolates individual
pen-downs so coincident start labels cannot hide their order.
Ordinary font labels identify Unicode characters but are not the stroke
geometry. The same path strings produce completed artwork, replay and samples.
Small circles/arrows/numbers are annotations, not additional pen strokes.

### Coverage and deliberate limits

All six expanded levels contribute **1,156 syllables and four standalone
compatibility jamo**. Modern foundations are exactly 51 compatibility forms
U+3131..U+3163 and 67 positional conjoining forms: 19 initials U+1100..U+1112,
21 vowels U+1161..U+1175, and 27 finals U+11A8..U+11C2. The four observed jamo
overlap foundations, giving a structured-plus-foundation union of **1,274**.
Two explicitly cited phonetic-display-support glyphs from the prerequisite
table above, U+AF9C and U+C62B, bring the Hangul scope to **1,276**:
**1,209 required plus 67 component-only**. These supplements support existing
pronunciation displays; they are not replacement spellings for school or
clothing and do not supply vocabulary pronunciations.

Only 54 of the 1,158 required syllables are authored in this first batch.
The other **1,104 Hangul keys remain explicitly unavailable/source-blocked**,
including the two supplemental syllables. All 118 modern foundation identities
are present, including the final RIEUL-SIOS cluster absent from curriculum
syllables. Positional/conjoining and compatibility keys remain distinct;
aliases describe relationships and never silently normalize or redirect keys.
No archaic jamo, fillers, halfwidth forms, Hanja expansion, or full 11,172-block
dump is included. The two literal signs are separate from Hangul counts;
grammar-slot letters, punctuation syntax, spaces, and affix hyphens are not
silently treated as Korean handwriting lessons.

The 54-syllable batch covers all observed initials, vowels, finals and broad
layout/final-kind families, but only **102 of 196 observed contextual
assignments**. `characters/pilot-review.yaml` explicitly lists the **94
unexercised assignments**; qualified reviewed assignments are zero. Review of
every implemented family, missing context case, logical stroke sequence and
flagged exception is required before scaling. The composer rejects the
unrepresented mixed-vowel/final-cluster family rather than implying broad
reviewed support. The inventory remains authoritative even when artwork is
missing; neither structural validity nor zero warnings implies readability.

### Original geometry, source evidence, and ownership

`characters/recipes/original-jamo.yaml` contains 24 core letter masters with
explicit isolated/side/wide contextual forms, 16 composite alphabet recipes,
11 final-cluster recipes and two sign candidates. Named HIEUH context forms
preserve its bar and loop in dense blocks. Narrow paired forms retain height
when consonants are doubled or clustered.
`original-layouts.yaml` defines six layout families, uniform placements,
component-specific contextual selection and the fixed 54-syllable list.
The composer uses named original em-box forms, not independent bounding-box
stretching. All parts share width 5.5 and round caps/joins in the 100-unit
y-down frame. Pen lifts stay explicit, including closed loops as one stroke.

The [source assessment](upstream/writing/source-assessment.yaml) explains why
the assessed external sources do **not** supply import-ready centerlines.
Adam Stone's 35 diagram SVGs contain whole-letter outlines and separate arrow
polygons; animCJK's Korean directory is Hanja, not Hangul. No UnPen tracing,
unlicensed neural model output, fonts, SVG diagrams or private recordings are
bundled. Only the unchanged licensed reference README and license are retained.
These are source-gap evidence, **not the provenance of original geometry**.

Original artwork and processing have their own source record and
[CC0 pilot notice](licenses/ORIGINAL-WRITING-PILOT.md).
The retained reference text keeps [CC BY-SA 4.0 attribution](licenses/WRITING-NOTICE.md);
existing dictionary rights remain unchanged. There is no professional Korean
handwriting approval or legal certification.

### Offline generation and checking

Use Python 3.10+ with the existing pinned PyYAML dependency. On this Windows
installation, `py -3.12` selects the installed runtime instead of the Store
alias. Ordinary generation and check commands never download resources.

```powershell
py -3.12 scripts\import_korean_characters.py
py -3.12 scripts\import_korean_characters.py --check
py -3.12 scripts\test_korean_characters.py
py -3.12 scripts\validate_characters.py --language korean --check
py -3.12 scripts\validate_curriculum.py --language korean
```

`--check` reports stale bytes without writing or deleting anything.
`validate_characters.py --require-release` intentionally rejects this
incomplete, unreviewed pilot. Generated shards use exact-character UTF-8 YAML
keys and the shared 256-codepoint naming convention; only drawable records are
written. Manifest and coverage are separate. Source/reference hashes, authored
recipe hashes, original notices, shared tooling versions and curriculum input
hashes are pinned; the review report also hashes Korean adapter modules.
Changing paths or recipes requires a new reviewed version, not inherited
approval. A source refresh is an explicit revision/license/checksum operation.
Do not edit generated shards or extend the 54-syllable list to bypass review.

### Handwriting correction, recipe revision 2

The first pilot's mechanical checks missed handwriting defects: disconnected
AE/YAE crossbars, the middle-bar order in THIEUTH, misplaced SIOS/JIEUJ branch
joins, half-height doubled letters, and incorrect mixed-vowel bar relationships.
Revision 2 corrects the root templates and regenerates every affected identity
and pilot syllable. It also selects the user-requested vertical-tick
HIEUH/CHIEUCH style; horizontal-cap variants exist and are not universally
incorrect.

The [reference comparison](upstream/writing/handwriting-review.yaml) cites
actual public King Sejong Institute Foundation teaching diagrams and records
the corrections and limits. No textbook artwork or font coordinates are
imported. This corrective self-review is **not qualified Korean approval**;
all candidate and release gates above remain in force.
