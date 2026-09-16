# Russian for a short visit

This is a standalone, English-supported route, not a fluency promise or a
requirement to finish the core curriculum first. There are **12 authored
situation units and 60 original phrases**. The first five units, containing
25 phrases, are the explicit quick-start prefix:

1. `polite-repair`: make contact and ask again.
2. `food-basics`: ask for water and a simple meal.
3. `finding-your-way`: locate a place and check a direction.
4. `paying`: ask about price, quantity, and payment.
5. `asking-for-help`: request help and a way to contact someone.

Later units cover transport, accommodation, food restrictions, shops and
services, ordinary health needs, timing, and social contact. Use
`quick-start\sequence.yaml` for the independently closed prefix, then
`sequence.yaml` for the relevant later situations in their declared order.
Phrase counts are authored content counts, not independently mastered words.

## Work in small situations

Introduce a few useful phrases at a time, supported by the intended English
meaning and any new Cyrillic or inflected forms. Practise recognizing a
request, producing one with changed details, understanding a likely response,
and repairing an unexpected reply. A prompt that displays the entire answer
is a scaffold, not evidence of independent recall.

Change a food, destination, time, or quantity only when the replacement and
its required form are understood. `вода` and the requested object `воду`
must be linked to the same intended water sense with the correct approved
form. `на карте` means on a **map** in its phrase; `Вы принимаете карты?`
asks whether payment **cards** are accepted. Shared spelling does not permit a
wrong-sense match.

Common question words and repair chunks need explicit support even when
there is no suitable independent dictionary sense. A construction can teach
its own fixed chunk; it cannot silently cover arbitrary unknown words or
grant unrelated lexical mastery.

## Exact records and source-backed readings

Both full and quick-start derived routes provide:

- `vocabulary.min.yaml`: exactly `{id, ch, pr, ds}`.
- `grammar.min.yaml`: exactly `{id, ch, ds}`.
- `phrases.min.yaml`: exactly `{id, ch, pr, ds}`.
- `sequence.yaml`: ordered introductions, earlier-only reviews, and exact
  phrase-to-sense/form/construction relationships in the expanded route data.

Each compact mapping occupies one line. Introductions and reviews repeat the
**same full canonical records**, not ID-only substitutes. English `ds`
values are unambiguous and no longer than 64 characters. IDs stay shared
across core and tourist routes; original phrases use `ru-tourist-pNNN`.

`ch` is ordinary Cyrillic. `pr` uses source-approved Cyrillic lexical stress:
the adapter converts the source's vowel-following apostrophe to a combining
acute and preserves meaningful `ё`. It is not romanization, IPA, a phonetic
transcription, or an audio recording.

Phrase readings are an **authored assembly of documented lexical and
inflected-form readings**. They are not source-supplied whole phrases or a
guarantee of connected-speech stress, reduction, palatalization, assimilation,
or intonation. Unknown multisyllabic stress must be reported and resolved,
never guessed from an infinitive, an English translation, or a similar word.
The original local draft deliberately has no invented `pr` fields.

## Independent closure and separate evidence

The Russian adapter must resolve every meaningful phrase span to the correct
introduced sense and approved surface form, or to an explicitly introduced
construction-owned fixed form. Required grammar dependencies must be
introduced earlier or co-taught before use. A later core level number is
not a hidden prerequisite for a tourist: the route introduces its needed
subset itself.

The five-unit prefix must pass closure on its **own**, without borrowing
vocabulary, readings, constructions, or review entries from later tourist
units. Full-route success cannot substitute for a quick-start closure check.
Source/form gaps remain explicit integration work until resolved.

Apply [the item mastery rubric](../mastery.yaml) to actual observations.
The default phrase goal is supported use. Reading, listening, typed
production, spoken production, and handwriting remain separate:

- A memorized phrase does not make every component word independently mastered.
- Reading a stress aid is not evidence of hearing or producing the stress.
- Audio and suitable evaluation are required for listening or spoken claims.
- Typing Cyrillic is not handwriting.
- Success on this route does not complete a whole numbered core level.

Evidence for an exact shared item and modality can remain useful in the core
later, without granting mastery of related senses, paradigms, or the entire
route. Retrieve fragile items in later sessions, recording assistance instead
of assigning blanket competence from completion.

## Practical limits, especially health and allergies

These phrases are learning material, not medical, legal, travel, or emergency
advice. They make **no guarantee** about safety, understanding by others,
service availability, accessible facilities, payment acceptance, or the
accuracy of a reply. No current visa rules, emergency numbers, currency
availability, or geopolitical assumptions are supplied. Confirm actual
arrangements through appropriate current local sources.

**For consequential medical or allergy communication, use a professionally
verified written explanation and qualified human assistance.** A short
phrase cannot reliably convey severity, cross-contact risk, full medical
history, treatment needs, urgency, or medication suitability. Asking
“Is there milk in this?” or “Please check” does not establish dietary safety.
Do not test a real health decision by relying on a memorized learning phrase.

All phrases, translations, grammar links, and situation sequencing are
original AI-assisted instructional work requiring human Russian-language
and pedagogical review. A source-backed stress reading is traceable to
dictionary data, not certified as correct for every contextual use.

## Authoring and handoff

The product is the normalized phrase, vocabulary, and construction records
in a useful situation order, not the ingestion ledger. Keep source snapshots
and detailed audit work separate from the learner route, retaining useful
provenance for the actual selected meanings and readings. Unrelated source
gaps must not displace useful original situations or force first-sense
matches; an unresolved reading for a phrase actually selected here still
needs resolution before that phrase's `pr` can be published.

Edit `..\..\authoring\tourist-draft.yaml` for the original unit/phrase intent.
Its optional `sense_hints` disambiguate surfaces such as a hotel `номер`,
door `ключ`, map `карте`, payment `карты`, and cost `стоит`.
`..\..\authoring\tourist-bindings.yaml` explicitly selects each token's
source record and form column, intended lexical sense or fixed construction.
Referential `это` uses attested neuter forms of the existing `этот` sense,
not an extra headword; the present-identity fixed frame remains separate.
The adapter resolves these authored inputs into canonical `plan.yaml` with stable sense/form IDs,
construction dependencies, and documented reading assembly. It must not
pick the first matching spelling or manufacture a lexical ID for a missing
fixed grammar sense.

Canonical normalized reference lists and resolved route metadata define the
selected records and order. The vocabulary reference has exactly the nine
standard fields, not inline expanded source or morphology data. Separate
`..\..\build\lexical-records.yaml`, `..\..\build\linked-forms.yaml`, and
`..\..\build\grammar-forms.yaml` retain the selected source/sense records,
lexical form links, and construction-form evidence used for verification.
Derived compact or sequence files are not the sole place to repair a meaning
or reading. Validate unresolved anchors, exact surface coverage,
quick-start prefix order, dependency closure, and canonical equality before
claiming a complete generated route. Follow the registered regeneration
commands in the [main teaching guide](../README.md), not an invented or
copied Mandarin generator.

Retain [source attribution](../../sources.yaml), the Russian README, and
applicable license notices with redistributed dictionary-derived entries.
The pinned primary source is OpenRussian's composite TSV backup, including
its contributors and upstream Wiktionary material. Original phrases are not
copied phrasebook text and are not attributed as quotations from that source.
