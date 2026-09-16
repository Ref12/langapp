# Independent French reference inventory

This directory has no official CEFR/exam bands. `vocabulary.yaml` contains the
nine shared reference fields: `id`, `target`, `reading`, `english`,
`part_of_speech`, `topic`, `source_id`, and `source_entry`, plus `level_basis`.
`grammar.yaml` contains original construction explanations and at least two
original bilingual examples per construction.

Expanded lexical records live in `../reference-senses.yaml`. Exact source glosses
are not silently replaced by short English labels: compact `ds` is separately
identified as the selected teaching disambiguator. Source identifiers and
snapshot/record/sense locators are retained, including non-official Kaikki
`en-...` IDs. Article/history links support contributor attribution; the locked
snapshot, not a mutable live article, is the reproducible source content.

An ID represents a selected sense. Homographs are conservatively grouped by
canonical headword for breadth; named, source-attested gender/number equivalences
are also counted once without merging their sense or pronunciation evidence.
Other source forms are metadata, not automatically introduced vocabulary.
For example, holiday usage teaches **vacances**, retains the source headword
**vacance** and plural-only sense, and does not add a second lemma for the plural.
**Une** is taught as a form of **un**, not by awarding the unrelated newspaper
front-page sense. A complete conjugation table in source metadata awards no
additional headwords or mastery.

Lexical IPA and strict Lexique phonetic-code conversions are distinguished in
expanded provenance. Original contextual travel readings have their own
realization provenance and must not be represented as source-verified lexical
pronunciations or evidence that a learner understands speech.
