# French pronunciation: lexical references and connected speech

Pronunciation text is a reference aid, not an audio recording or evidence
that a learner can understand or produce spoken French. Listening and
spoken-production judgments require actual audio and suitable evaluation.

## Reference convention

The teaching reference is broadly phonemic and centered on contemporary
French as used in France. It does not prescribe one universal accent.
Retain explicitly sourced regional alternatives and their labels in expanded
records rather than silently merging them into one reading. This program
does not claim comprehensive pronunciation coverage for Quebec, Belgium,
Switzerland, African varieties, or all regional varieties within France.

A compact vocabulary record's `pr` belongs to its selected lexical sense.
Its source and any conversion or editorial choice belong in the expanded
record. Matching an orthographic string alone is insufficient: `fils` can
correspond to a son or to threads, and `est` can be a direction or an
inflected verb.

Where a reading is selected from Lexique 3.83, retain the original `phon`
field and its lemma, part of speech, and morphological context. That field
uses the dataset's phonetic code, not IPA. A conversion to IPA must have a
documented symbol mapping, reject unrecognized symbols, and be labeled as a
deterministic transcription conversion. It is not a newly observed or
human-verified pronunciation.

Where a dictionary gives conflicting alternatives or insufficient context,
an explicit authored choice or source-supported correction is required.
Preserve the original alternatives and the reason for selection. Preparation
proposes the first eligible unmarked or France-tagged lexical reading, then
records an explicit maintained sound index. This disclosed discovery default
is not comprehensive phonological review. A jointly France/other-region label
may be used; an exclusively out-of-scope regional or historical reading is not
silently substituted. Do not drop an inconvenient symbol.

The implemented Lexique conversion keeps ordinary code letters, with these
documented replacements: `E → ɛ`, `O → ɔ`, `S → ʃ`, `Z → ʒ`, `R → ʁ`,
`N → ɲ`, `G → ŋ`, `2 → ø`, `9 → œ`, `8 → ɥ`, `5 → ɛ̃`, `1 → œ̃`,
`@ → ɑ̃`, `§ → ɔ̃`, `° → ə`, historical `3 → ə`, and `g → ɡ`.
The code `x` remains `x`. Unknown symbols fail rather than being deleted.
Selected reading counts do not count every unselected source alternative.

## What a lexical transcription cannot determine

French spelling often contains letters that are not pronounced in an
isolated word. This does not justify deleting them from the written form.
Practice contrasts involving silent endings, nasal and oral vowels, rounded
vowels, and common schwa or vowel-quality variation using relevant examples.

Liaison, enchaînement, and elision concern connected language. Distinguish
required, optional, and forbidden liaison in the relevant construction.
An optional liaison can be register-sensitive; it is not uniformly an error
to omit it. Enchaînement resyllabifies an already pronounced consonant and
is not the same operation as realizing a liaison consonant.

Mute `h` and aspirated `h` are lexical distinctions affecting elision and
liaison even when neither is an ordinary pronounced consonant in the
reference variety. A bare IPA spelling without an explicit lexical marker
cannot always supply this information. Schwa deletion also depends on
context and variety rather than a blanket removal rule.

Common forms such as `plus` and number words have context-sensitive
pronunciations. A single dictionary string is not a universal sentence
rule. Treat the relevant meaning and following context explicitly.

## Tourist phrases

A tourist phrase's `pr` is a segmented reading guide, not a continuous narrow
connected-speech transcription. It places independently sourced lexical chunks
beside explicitly original contextual/formula chunks; spaces between them mark
teaching segmentation, not mandatory pauses. Relevant liaison and elision must
be handled in an explicit contextual form. The complete guide is not labeled
source-verified or treated as a recording.

Phrase realization records link each written and pronunciation segment
to its taught lexical or construction identity, including explicitly
identified inflected or fixed forms. Full coverage and exact reconstruction
can expose missing or mismatched components, but do not prove that the
phrase sounds natural or that its intonation fits every situation.

No audio corpus is bundled by this pronunciation policy. An upstream audio
link, if retained as metadata, does not establish permission to redistribute
the recording or its suitability for an assessment.

## Review limitations

Source transcriptions can contain errors, restricted varieties, or
historically machine-generated material. Original teaching choices and
sentence transcriptions are AI-assisted and need human phonological and
pedagogical review. Do not convert the presence of a `pr` field into a
claim that such review or spoken practice has occurred.
