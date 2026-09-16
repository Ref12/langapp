# Practical Spanish

Start with the [teaching program](teaching/README.md), or use the independent
[travel route](teaching/tourist/README.md). The product is the ordered,
English-supported vocabulary and grammar, not a source downloader.

There are six phases and thirty globally numbered levels. This is an original
communicative progression, not a DELE syllabus, CEFR conversion, or promise of
general proficiency. Spanish has an independent `reference` inventory rather
than invented examination-band folders.

## What is taught

The useful core is planned around 5,800-6,000 lemma/headword groups. Actual
coverage belongs in `teaching/inventory.yaml`; additional senses deepen common
words without creating new headwords. Inflections are usage forms, not new
vocabulary breadth. Do not sum core, branch, and travel totals: routes overlap.
Distinguish an introduced item from demonstrated understanding or independent
use in a particular modality.

Common polysemy is sense-specific: wanting is not loving; existential `haber`
is not the perfect auxiliary; coffee is not the color brown; a bill is not a
tally; a restroom is not a bath. Expanded records keep the selected source
sense, full gloss, grammatical tags and pronunciation. The 64-character English
hint is a selection aid, not an exhaustive dictionary definition.

Grammar supports gender/plural agreement, articles and pronouns, subject
omission, clitics, ser/estar/hay, tense/aspect and irregular verbs,
reflexive/pronominal uses, por/para, mood contrasts, politeness, and regional
variation. Conjugation patterns and original examples support actual inflected
usage without treating each conjugation as a new lemma.

## Files for tutors

| Path | Use |
| --- | --- |
| `teaching/core/sequence.yaml` | Full ordered phase/level/module hierarchy |
| `teaching/phases/N-slug/levels/NN/sequence.yaml` | One visible level, goals, prerequisites and checkpoint |
| `teaching/**/vocabulary.min.yaml` | Ordered sense introductions |
| `teaching/**/grammar.min.yaml` | Ordered construction introductions |
| `teaching/extensions/` | Four optional branches with explicit prerequisites |
| `teaching/tourist/quick-start/` | Self-contained essential travel prefix |
| `reference/vocabulary.yaml` | Shared nine-field headword reference records |
| `reference/senses.yaml` | Adapter-validated sense meanings, readings and provenance |
| `reference/grammar.yaml` | Original grammar notes and translated examples |

Vocabulary and original phrase entries are `{id, ch, pr, ds}`; grammar entries
are `{id, ch, ds}`. Each compact entry is one mapping per line. `ch` means the
Spanish written form; it is not a Chinese-only field. Introductions and reviews
embed the same complete compact records.

Read [pronunciation policy](teaching/pronunciation.md) before interpreting IPA.
Lexical entries preserve sourced broad IPA variants, including stress.
Unlabelled source variants have unspecified regional scope. Original travel
phrase readings use a separately labelled wordwise seseo/yeismo teaching
convention, not a universal Latin American accent or a recording.

## Authoring and rebuilding

`authoring/vocabulary.yaml` is the explicit editable sense selection and
placement table. Local IDs derive once from identifiers in the pinned source;
they remain stable when labels or teaching order change. A source upgrade
requires reviewed identity migration, not reseeding over existing selections.
`authoring/lexical-review.yaml` applies explicit thematic/sense corrections,
exclusions, and breadth grouping without rewriting those source identities.
Common secondary senses are resolved explicitly rather than selected by their
current level or the dictionary's first entry.
The grammatical and travel authoring files are original project material.
The small source projection exists only to retain attribution and permit
repeatable offline derivation; the large original dump is not checked in.

From the repository root:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\import_spanish_curriculum.py
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\generate_spanish_program.py
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\import_spanish_curriculum.py --check
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\generate_spanish_program.py --check
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B -m unittest discover -s scripts -p "test_spanish*.py"
```

Ordinary builds are offline. The optional importer bootstrap is an intermediate
authoring operation, never a tutor input or automatic replacement for reviewed
placements. It requires the exact locked source/frequency files and refuses
to overwrite an existing selection table. Explicit extra source senses are
listed in `authoring/lexical-additions.yaml`.

## Provenance and limitations

The lexical source is the **Kaikki postprocessed English-Wiktionary Spanish
snapshot**, not the Spanish Wiktionary edition and not an official course.
The export is deprecated and can contain editorial or extraction errors.
Source hashes and selected-field fidelity do not establish idiomatic language,
perfect pronunciation, or pedagogical completeness.

The selection began with explicit task words and source-assisted candidate
ordering, followed by authoring corrections. Frequency estimates came from
subtitle surface forms; they do not establish lemma frequency or difficulty.
The original goals, grammar, labels and phrases are AI-assisted authoring,
not professionally reviewed language teaching. All require suitable human
linguistic/pedagogical review before being described as reviewed material.

No audio or learner observations are included. A text-only interaction cannot
establish listening, speech, pronunciation, or handwriting performance.
Travel examples are communication aids, not medical/legal advice or assurances
of safety, accepted payments, dietary safety, accessible facilities, or recovery
of lost belongings.

Preserve [sources](sources.yaml) and the [rights notice](licenses/NOTICE.md).
Extracted/adapted lexical data carries CC BY-SA 4.0 obligations. Original
project authoring and reference-only citations are distinguished from copied
or adapted lexical data; no blanket license overrides source rights.
