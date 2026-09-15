# Korean spelling, readings, and actual speech

`ch` is the written Korean word or original phrase. Vocabulary and phrases have
`pr`, a broad Hangul reading aid. Grammar templates have no `pr`: placeholders
and alternative endings are not a sentence to pronounce.

These are different things:

| Representation or activity | What it provides |
| --- | --- |
| Standard spelling | The conventional written form, including Korean spacing |
| Dictionary citation reading | A documented pronunciation of an isolated lexical entry |
| Authored broad-Hangul reading | An explicitly unverified teaching interpretation of a selected word or phrase |
| Pronunciation rules | An explanation of context-dependent changes, not a complete exception-free lexicon |
| Romanization | A separate transliteration convention; orthographic romanization does not capture every sound change |
| Listening or spoken assessment | Actual audio and suitable evaluation, recorded independently of reading or typing |

Do not award listening, pronunciation, or speaking mastery from a written
response, a correct romanization, or reading a displayed phrase aloud.

## Citation readings and provenance

The original January 2024 mirror has no pronunciation fields. Its retained
TOPIK vocabulary records still have empty `reading` values; they have not been
silently replaced with spelling or reclassified.

For the teaching selections, a separate official NIKL JSON archive dated
2026-08-19 supplies citation-pronunciation **text**. Its license, download,
checksum, and transformation policy are in `../sources.yaml`. The adapter
extracts citation `WordForm` records, not the inflected-form records or audio
URLs. Some feature containers repeat pronunciation alternatives; retain all
of them rather than overwrite an earlier one.

Conservative matches require the same written form and POS plus the complete
ordered Korean-definition list after whitespace normalization. Individually
reviewed crosswalks explain changed definition wording. A same-spelling first
match is not enough, especially for homographs. The official lexical ID is
additional evidence, not a replacement for the stable project sense ID.

In `pr`, multiple documented alternatives are joined by ` / ` in source order.
The expanded overlay retains the separate alternatives. Source length marks
such as `ː` are preserved: eye 눈 has [눈], while the dictionary's snow entry
has [눈ː]. Contemporary speakers do not all maintain dictionary length
distinctions. Do not turn a written mark into evidence about a learner's audio.
The display adapter trims surrounding whitespace in official citation text
(for example, the archive's baseball reading has a trailing space). It retains
the raw alternatives and records this display-only normalization in expanded
provenance; it does not change sounds, length marks, or internal spacing.

## Explicit authored readings

Some useful loanwords and other entries have no official pronunciation text.
The selected exceptions in `../authoring/teaching/reading-decisions.yaml`
have individual readings, reasons, and `review_status: unreviewed`.

For example, the authored taxi citation reading is [택씨], with post-stop
tensing, and internet is [인터넫] in isolation, with final-consonant
neutralization. Coffee [커피] and card [카드] happen to match their spelling;
each is an explicit authored decision, not a generic `reading or spelling`
fallback. An unresolved **selected** word is an error; unselected dictionary
gaps do not block an unrelated lesson.

The authored genre reading 장르 [장느] applies the nasal-liquid environment
of Standard Pronunciation Article 19, whose text was checked in the
[Tokyo University of Foreign Studies mirror](https://www.tufs.ac.jp/ts/personal/choes/korean/nanboku/bareumbeop.html).
It remains an authored rule application, not a dictionary-imported reading.
The general [NIKL language-regulations site](https://korean.go.kr/kornorms/regltn/regltnView.do?regltn_code=0002)
distinguishes pronunciation rules from word spelling.

These decisions require qualified Korean-language review. They are not
dictionary-verified pronunciations, native-speaker recordings, or evidence of
learner ability. A changed source or new approved reading must update the
canonical record and every embedded introduction and review together.

## Original phrases and morphology

Tourist phrases have individually authored broad-Hangul readings. A dictionary
citation reading of each lemma does not verify a complete phrase. Phrase
forms document their own spelling, reading, lexical senses, constructions,
and morphology in `../authoring/teaching/phrase-forms.yaml`.

The adapter checks exact licensed forms, component membership, written word
boundaries, and full surface/reading coverage. It does not pretend to prove
idiomatic usage or every phonological judgment. A form annotation licenses
one orthographic word, not an arbitrary sentence or unidentified vocabulary.
Fixed grammatical material can be learned under its construction ID without
borrowing an unrelated dictionary meaning.

Contrast isolated 읽다 [익따] with inflected 읽어요 [일거요]; simply concatenating
lemma readings would be wrong. Revisit liaison, final-consonant neutralization,
cluster behavior, nasal and liquid assimilation, aspiration, palatalization,
tensing, contraction, and phrase grouping as relevant words are introduced.
Use actual listening and production for plain/aspirated/tense consonant
contrasts. Explain register, intonation, and context as well as segmental
changes. Family-specific irregular conjugation belongs in grammar practice;
not every stem sharing a final consonant behaves alike.

No recordings are redistributed. Dictionary audio and other multimedia can
have different reuse terms from dictionary text. Neither text licensing nor
the presence of an audio URL grants a blanket multimedia license.
