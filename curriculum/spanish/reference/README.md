# Independent Spanish reference inventory

These are expanded lexical and construction records, not a level order.
Use `../teaching/core/sequence.yaml` or a travel/branch sequence to teach them.
There are no invented CEFR, DELE, or other examination bands.

Vocabulary parents retain the shared fields `id`, `target`, `reading`,
`english`, `part_of_speech`, `topic`, `source_id`, `source_entry`, and
`level_basis`, with no unchecked inline extensions. The separate adapter-
validated `senses.yaml` retains the precise written form, reading,
English gloss/disambiguator, usage tags, lexical grouping and source identity. A parent's
combined reading or meaning is not a sense-level pronunciation or answer key.

Expanded senses include source gender/usage tags, noun/adjective inflections,
and verb headline forms, gerunds, and class annotations where supplied. These
are unmodified source facts, not complete paradigms or independently verified
normative advice. In particular, lexical IPA belongs to the lemma: it is not
automatically a pronunciation for an inflected form. Full source inflection
facts remain in the small compressed selected-record projection for auditing.

Breadth uses explicit canonical lemma/headword grouping. Distinct senses and
source part-of-speech/homograph records remain separate learning items even
where they share a breadth group. Inflection/gender grouping does not transfer
mastery between those items. Source sense IDs describe the pinned Kaikki
postprocessed extraction, not permanent or official Wiktionary IDs.

The reviewed teaching inventory is derived from the raw selections plus
`../authoring/lexical-review.yaml`. The overlay changes thematic placement and
adapted English labels, records explicit exclusions and breadth families, and
preserves every retained source identity. Primary-lemma topics do not overwrite
separate secondary or branch senses.

Grammar patterns are templates with English explanations and at least two
original translated examples. Fixed grammatical forms belong to their
construction; they do not require fabricated dictionary IDs. Example-only
support is English-glossed and does not establish prior lexical mastery.

The expanded records and ordered compact views are generated from Spanish
authoring. Preserve `../sources.yaml` and `../licenses/NOTICE.md` with derived
lexical views.
