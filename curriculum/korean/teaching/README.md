# Practical Korean

This is a curated communicative teaching path, not an official TOPIK syllabus,
a CEFR mapping, or a guarantee of general proficiency. Reference bands describe
source provenance, not teaching placement. Phase, level, module, and item
mastery are different things.

**Implementation status:** the independent tourist views and current
coverage/provenance reports are available. Generated core, phase, level, and
branch views await the coordinated shared-scheduler integration; their paths
below describe the intended layout. Vocabulary expansion remains in progress.

## Choose a route

Start with the [Hangul preparation guidance](preparation.md) as needed, then
use `core/sequence.yaml` for the complete ordered path. Numbered levels live
inside their numbered phase folders:
`phases/1-first-exchanges/levels/01/sequence.yaml` through
`phases/6-nuance-interpretation/levels/30/sequence.yaml`.

The independent [tourist route](tourist/README.md) has a self-contained quick
start. It does not require any core level. Optional professional, technical,
scientific, and literary branches are under `extensions/`; they declare
their core prerequisites rather than forming a mandatory seventh phase.

| Phase | Global levels | Focus |
| --- | --- | --- |
| First exchanges | 1-4 | Polite first contact, particles, requests, counters, and repair |
| Everyday life | 5-8 | Home, services, travel, cooperation, and social relationships |
| Stories and conversations | 9-13 | Connected events, experiences, procedures, and reported information |
| Explanation and problem-solving | 14-18 | Less predictable problems, public information, and negotiation |
| Analysis and argument | 19-24 | Evidence, qualified claims, institutions, and formal synthesis |
| Nuance and interpretation | 25-30 | Stance, speech levels, written register, precision, and interpretation |

The planning scale is roughly 5,800-6,000 useful core headwords/lemmas, not a
quota or a count of demonstrated learner knowledge. Consult `inventory.yaml`
and `coverage.yaml` for actual selections and distinct counting measures.
The current vocabulary selection remains substantially below that scale.
Later phases require more actual material and modules, not merely longer
goals; phase titles and targets do not demonstrate that this expansion is
complete.

Every level has two to four observable goals and a checkpoint with those goals
as criteria. Use new combinations of already taught material, keep answer keys
separate, and record assistance and modality. A completed module or a memorized
phrase does not establish every level goal.

## Small lessons and item evidence

A themed module spans several adaptive lessons. Start with about 5-8 new
senses and one construction per lesson, reduce the load when retrieval is
fragile, and retrieve earlier material before introducing more. Source
examples can contain untaught words; adapt or explicitly gloss them rather
than silently adding all of their vocabulary to a requirement.

`mastery.yaml` defines recognition and contextual understanding for receptive
evidence, and supported and independent use for productive evidence. Keep
reading, listening, typed production, spoken production, and handwriting
separate. Record the exact vocabulary sense, construction, or original phrase.
Do not infer sibling senses or all earlier stages from one successful task.

Checkpoints assess the named goals, not perfect mastery of every introduced
word. Carry fragile items into later review and revisit a judgment when
contradictory evidence appears. Listed reviews are earlier-only retrieval
seeds, not a complete or personalized spaced-review schedule.

Hangul recognition, keyboard input, and syllable decoding precede full
sentences as necessary. Character/stroke assets are a separate resource, not
duplicated here. See [pronunciation.md](pronunciation.md) for spelling,
citation readings, authored phrase readings, and the requirement for actual
audio assessment. See [grammar-notes.md](grammar-notes.md) for particles,
speech levels, honorifics, predicate endings, and conjugation families.

## Curated entries and separate reference evidence

Vocabulary and original phrases use exactly `{id, ch, pr, ds}`; constructions
use `{id, ch, ds}`. Each compact mapping is one line. `ch` is native written
form, `pr` is the documented broad-Hangul reading, and `ds` is an English
disambiguator of at most 64 characters. Introductions and reviews embed the
same complete records as the canonical compact entries.

`ko-nikl-NNNNN-sNNN` is a **project** sense locator: the original pinned CSV
record ordinal followed by its original definition-list position. It is not
an official NIKL sense ID. Common words can have several selected meanings
at different levels without moving or renumbering their source records.
Equal English translations do not necessarily identify the same Korean sense.
Original phrase IDs and supplementary grammar IDs do not masquerade as
dictionary entries.

Source processing is intermediate, not the learner's course:

| Location | Purpose |
| --- | --- |
| `../topik-*` | Preserved original heuristic-band reference inventory |
| `../source-senses.yaml` | Original bilingual source positions, outside compact teaching entries |
| `../reading-overlay.yaml` | Official pronunciation matches and unresolved reference candidates |
| `../authoring/teaching/` | Curated placements, labels, lexical identities, exceptions, and phrase forms |
| `source-provenance.yaml` | Per-item source meanings/bands, reading methods, correction evidence, and phrase authorship |
| `program.yaml`, `mastery.yaml`, `tourist/plan.yaml` | Authored teaching structure and task/evidence policies |
| `core/`, `phases/`, `extensions/`, `tourist/` | Generated normalized course views |

Only selected senses become requirements. Unselected dictionary records or
readings are not hidden advanced content. Necessary unbanded support stays
explicitly unbanded and outside the original TOPIK folders.

Counts distinguish dictionary parent entries, source positions, selected
senses, distinct spellings, spelling/POS pairs, and curated lexical identities.
`coverage.yaml` additionally separates free lemmas from bound forms and
function items and reports reading methods. The shared inventory's `headwords`
measure refers to lexical identities, not solely free content-word lemmas.
Phrases and inflections do not manufacture extra lexical breadth. Routes
overlap; do not sum their totals as a unique learner vocabulary.
The explicit category decisions, homograph comparisons, provisional grouping
limits, and unfilled domains are documented in
`../authoring/teaching/selection-notes.yaml`, without stale count snapshots.
Phase `new_free_lemmas` counts a lexical identity only at its first core
introduction; another sense in a later phase does not count as a new lemma.
The coverage report exposes the gap to the lower planning guide and marks
lexical-identity judgments as awaiting qualified review.
`source-provenance.yaml` retains raw official reading alternatives alongside
any display normalization. Authored source corrections keep the original
bilingual text and their unreviewed interpretation separate; phrase reading
metadata never inherits a dictionary-verified label from its component words.

## Regeneration

Normal generation is offline and uses the shared neutral engine through the
Korean adapter, without downloading sources:

```powershell
python -B scripts\korean_program_adapter.py
python -B scripts\korean_program_adapter.py --check
python -B scripts\validate_curriculum.py --language korean
python -B -m unittest discover -s scripts -p "test_korean*.py"
```

`--check` writes nothing. Unknown senses, unsupported selected readings,
incorrect lexical identities, unresolved prerequisites, unlicensed phrase
forms, and stale views are errors, not silent success-shaped fallbacks.
Edit the authored sources rather than generated views alone.

`../authoring/teaching/selection-files.yaml` declares ordered vocabulary and
lexical-identity files; undeclared files are not discovered automatically.
The base files come first. Additional identity fragments contain only new
sense members, retain the same lemma and category, and state their own
grouping rationale. Composition merges their source-parent evidence without
counting an existing identity again. Missing files, repeated members, and
conflicting identity decisions fail rather than silently replacing a selection.

The separate `scripts\korean_sources.py` import command verifies both pinned
sources before deriving registry/reading overlays. It takes an explicit
`--official-archive` path and optional `--source-file` for the original CSV.
No archive, source usage sentences, or multimedia belongs in the course.
Source refreshes require explicit checksum, identity, and licensing review.

## Limitations and attribution

Goals, selections, concise English labels, construction additions, source
corrections, and original phrases are AI-assisted teaching material requiring
qualified Korean-language review. Structural consistency cannot prove
idiomatic language, sociolinguistic appropriateness, pronunciation accuracy,
completeness, or learner ability.

Dictionary-derived text retains CC BY-SA 2.0 Korea obligations. Keep
`../sources.yaml`, the Korean README, and `../licenses/NOTICE.md` with
redistributed derived entries. Do not substitute the unofficial mirror's
MIT metadata for the underlying NIKL license. Authored readings are explicitly
unverified; neither official citation text nor an original phrase constitutes
an audio assessment or institutional endorsement.
