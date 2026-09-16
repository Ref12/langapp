# Practical Russian

This is an independent, English-supported teaching curriculum, not a CEFR or
TORFL syllabus, official word list, or promise of examination readiness.
Vocabulary, construction, phrase and modality-specific evidence remain
separate. An inventory is not a learner's demonstrated knowledge.

The main entry point is [teaching/README.md](teaching/README.md).
Start with [Cyrillic preparation](teaching/preparation.md), then follow the
six numbered phases and thirty global levels. Individual levels live under
`teaching/phases/N-slug/levels/NN/`, not in a flat level directory.
The [tourist route](teaching/tourist/README.md) is independently usable;
its quick-start prefix requires no completed core level. Professional,
technical, scientific and literary branches are optional.

## Learning records and build inputs

Vocabulary and original phrases use exactly `{id, ch, pr, ds}`.
Constructions use exactly `{id, ch, ds}`. Each compact mapping occupies one
line. Introductions and reviews duplicate the same complete canonical
record; a review does not create another introduction or lexical headword.
`ds` is an unambiguous English hint no longer than 64 characters.

The compact views and teaching order are the learning product. Source
snapshots, retained source fields, mappings, corrections and audit reports
are separate build/provenance material. Only selected reference records and
small useful conformance fixtures are retained, not an exhaustive upstream
dictionary as curriculum.

`authoring/vocabulary.yaml` records our sense selections, English hints,
lexical identities and level/topic placement. `reference/vocabulary.yaml`
contains exactly the nine shared normalized reference fields;
`build/lexical-records.yaml` separately retains selected sense/source metadata
and morphology needed to reproduce those entries.
`authoring/grammar.yaml` contains original constructions and bilingual
examples. Generated views are not the sole authoritative place to edit a
meaning, reading or teaching decision.

`authoring/grammar-support.yaml` adds a small explicit set of essential
source-backed senses; its `s9NN` slots are reserved local support IDs, not
source numbering. `authoring/anchor-bindings.yaml` records reviewed wording
equivalences between a construction's English hint and its selected sense.
These links do not infer a different sense from matching spelling.
Travel-specific support is separately derived from explicit source/form
bindings, without counting fixed constructions or pronoun forms as words.

## Readings, identity and counting

`ch` is Cyrillic. `pr` is a source-backed Cyrillic lexical-reading aid:
source vowel-following apostrophes are represented as combining acute stress
marks, and meaningful `е`/`ё` distinctions are preserved. Monosyllables or
nonsyllabic words need not carry an acute mark. Unknown multisyllabic stress
is not filled in from a guess. See the source normalization report for
excluded source-form readings and the teaching notes for practical limits.

This is not IPA, romanization, connected-speech transcription or observed
pronunciation. Vowel reduction, palatalization, assimilation, intonation
and contextual stress need explanation and actual audio practice. A text
answer cannot demonstrate listening or spoken accuracy. Original phrase
readings assembled from documented component forms are not whole-phrase
pronunciations verified by the source.

Stable `ru-or-*` IDs identify pinned local source-table record/sense slots,
not official dictionary or examination entries. Locally authored senses
share explicit lexical identities when appropriate. Different senses of
one lexeme, inflections, duplicate source rows and accepted variants do not
inflate headword counts. Genuine homographs can share a spelling but have
distinct lexical identities and readings. Lexical aspect partners stay
distinguishable; an inflected realization is not another word.

Core, branch and tourist inventories can overlap. Do not add their totals
as unique vocabulary, equate exposure with mastery, or transfer evidence
for one sense/modality to its siblings. The approximate 5,800-6,000
headword planning target is not a quota: actual maintained counts and
coverage limitations govern what is present.

The frozen authoring inventory, including essential grammar/travel support,
contains:

| Scope | Selected senses | Lexical headwords |
| --- | ---: | ---: |
| Core authoring, levels 1-30 | 4,805 | 4,755 |
| All selected references, including optional branches | 4,997 | 4,942 |

The core is **1,045-1,245 headwords below the planning range**. This is a
bounded useful selection, not source exhaustion or an attained 5,800-word
claim. The primary author's [selection notes](authoring/vocabulary-notes.md)
exclude the eleven separately maintained support entries.
[Source accounting](normalization-report.yaml) distinguishes source spans,
spellings, readings and forms; `teaching/inventory.yaml` reports actual
scheduled routes and prerequisite adjustments. The 48,568 distinct retained
noncanonical lexical forms are reference morphology, not additional words
or separately demonstrated knowledge.

## Sources and authorship

[sources.yaml](sources.yaml) records exact source revisions, hashes, uses,
attribution, limitations and applicable notices. The selected OpenRussian
backup is an old composite dictionary, with real errors and incomplete
metadata. Source fidelity means traceability, not linguistic certification.

Our selection, English hints, teaching order, grammar explanations,
examples and travel phrases are independently AI-assisted teaching work
requiring human linguistic and pedagogical review. Source consultation
does not make original wording a source-verified quotation. Conversely,
adapting licensed dictionary data does not erase its applicable attribution
and share-alike obligations. Retain relevant notices with the material
actually redistributed; no blanket claim is made that this licenses
unrelated original content or application code.

## Reproducing selected source references

The importer verifies all four pinned table checksums before producing
references. It does not download a live mutable database or select a new
teaching order on each run.

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\import_russian_curriculum.py
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\import_russian_curriculum.py --source-directory path\to\pinned-tables --check
```

A local source directory contains `nouns.csv`, `verbs.csv`, `adjectives.csv`
and `others.csv` (or the corresponding `openrussian-`-prefixed filenames).
These are TSV despite their extensions. The old export treats quotes
literally; one known extra tab in a German field is preserved by an
explicit record-specific parser rule. No rows are reordered or silently
discarded.

The source tables are optional build inputs, not files learners must
download. Checked-in normalized references support offline teaching
generation. The importer reports unsupported source-form readings but
does not invent a reading for them or count source inflections as words.

## Generating the teaching views offline

The Russian adapter supplies its normalized vocabulary, original
constructions, explicit lexical identities and source-resolved tourist
alignments to the shared practical-program engine. It is not a fork of the
Mandarin generator.

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\russian_program_adapter.py
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\russian_program_adapter.py --check
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B -m unittest discover -s scripts -p "test_russian_*.py"
```

After changing the lexical ledger or source/form bindings, run the source
importer before generating teaching views. Changes to level placement or
original constructions require regenerated teaching views as well.
Both `--check` modes compare expected output without rewriting it.

Catalog activation is centrally managed, separately from these Russian-owned
assets. The independent registration uses no invented examination folders:

```yaml
- id: russian
  standard: Independent practical Russian inventory; not a CEFR or TORFL exam specification
  reference_inventory: reference
  teaching_program: ru-practical
```

The Russian integration suite exercises this registration in memory without
changing the catalog. After central activation,
`scripts\validate_curriculum.py --language russian` validates the registered
references and generated program together.
