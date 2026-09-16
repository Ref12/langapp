# Practical French

An independently selected, English-linked French curriculum: six phases, thirty
levels, optional professional/technical/scientific/literary branches, and a
standalone tourist route. This is not a CEFR inventory, examination syllabus,
professional qualification, or claim of demonstrated learner ability.

Start with [the teaching guide](teaching/README.md),
[the program](teaching/program.yaml), and [the tourist guide](teaching/tourist/README.md).
Levels are nested under numbered phases, for example
`teaching/phases/1-first-exchanges/levels/01/`.
The independent [reference inventory](reference/README.md) supplies provenance,
not official bands. The shared catalog registers this as `reference_inventory: reference`.

The roughly 5,800-6,000-headword planning scale is not a quota for generated
translations or inflections. `teaching/inventory.yaml` records actual generated
coverage; senses, conservative headword identities, readings and spellings are
reported separately. Routes overlap and must not be added together as unique
vocabulary. Source gaps and counting decisions remain explicit in
`authoring/teaching/source-gaps.yaml`, `exclusions.yaml`, and
`headword-equivalences.yaml`.

## Sources and rights

[sources.yaml](sources.yaml) and [source-lock.yaml](source-lock.yaml) identify the
bounded, hash-verified Kaikki English-Wiktionary French snapshot and Lexique 3.83.
Only selected source fields are shipped; source quotations, dictionary examples,
audio and images are excluded. `reference-senses.yaml` retains exact glosses,
source IDs/locators, lexical pronunciation alternatives and morphology separately
from compact teaching records.

Retained/adapted dictionary data carry their CC-BY-SA-4.0 attribution and
share-alike obligations. Original teaching selections, explanations, examples
and travel formulae are identified separately and explicitly offered under
CC-BY-SA-4.0 to the extent rights exist. That is not a claim that ordinary
language facts impose copyright or that the application's code inherits a
dictionary license. FreeDict and ipa-dict were investigated but are **not**
redistributed or used for this inventory.

## Review limitations

The teaching choices and concise labels are AI-assisted, not comprehensively
reviewed by a French teacher or lexicographer. Source fidelity is not proof of
pedagogical suitability, exhaustive contemporary usage, or correct performance
by a learner. High-impact homographs have explicit sense decisions; further
editorial review remains valuable, especially in specialist and literary usage.
Source register labels and relevant variants are preserved rather than erased.
See [pronunciation policy](teaching/pronunciation.md) for the France-centered
scope, contextual realizations, regional limits and absence of audio evidence.

## Maintenance

Edit maintained `authoring/teaching/` selections rather than generated views.
Full generation uses the shared practical-program runtime, including its
route-scoped branch placements; French supplies only the source adapter.
From the repository root, using the existing Python/PyYAML environment:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\french_program_adapter.py
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\french_program_adapter.py --check
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -B scripts\test_french_curriculum.py
```

Ordinary regeneration is offline. Source refresh is a separate editorial action
through `scripts/import_french_curriculum.py`; both original inputs must match
their recorded SHA-256. `--prepare` discovers explicit source choices for review,
not an automatic teaching order. Do not treat its first eligible sense as a
substitute for editorial disambiguation. Stable teaching IDs derive from retained
source sense identities; changes in meaning require an explicit changed selection.

`authoring/teaching/semantic-regressions.yaml` maintains practical meaning
expectations alongside the source overrides. These pair the intended learner
label with an exact source sense, POS and lesson placement; spelling or ordering
alone cannot establish that a numbers lesson teaches nine rather than brand new.
Reassess these expectations against retained source evidence when changing a
selection. Passing them is not a substitute for comprehensive human review.
Unavailable meanings at otherwise retained words' destinations are documented
at the top of `lemma-groups.yaml`; whole-word exclusions remain in `exclusions.yaml`.

In `sense-selections.yaml`, `primary` identifies the chosen default teaching sense
for a maintained lemma group or word anchor. It is not a claim about the most
frequent or officially primary dictionary meaning. `additional-senses.yaml`
separately preserves each later core or optional-route placement; several
destinations reuse one source reference and one canonical compact record.
The importer can regenerate normalized vocabulary and grammar without the
shared program runtime; the adapter then supplies the full course projections.
