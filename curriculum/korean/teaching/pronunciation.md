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

The US-currency noun and counting-unit entries for 달러 both use the explicit
authored aid [달러]. Neither the pinned learner-dictionary records nor the
actual consulted Standard Dictionary record supplies pronunciation text.
This is an unreviewed loanword decision, not a verified import or permission
to infer length or the colloquial form 딸라.

The source-listed compounds 주민 등록증 and 외국인 등록증 remain unselected.
Their learner-dictionary records have no whole-term citation text; the
consulted Standard Dictionary resident-ID entry also lacks it, and the
bounded foreign-ID searches found no entry. Do not silently join isolated
component readings to claim a verified compound realization or length.
The governance support notes preserve the exact entries and evidence limits.

The proposed greenhouse-gas item 온실가스 (`ko-nikl-48419-s001`) is excluded
from active teaching pending qualified review of plain ㄱ versus compound
tensing at 실-가. Neither the pinned learner-dictionary entry nor the
consulted Standard Korean Dictionary entry provides pronunciation text.
Its exact source meaning, proposed placement, and both entry locators remain
in `../authoring/teaching/community-notes.yaml`. This is a documented gap,
not permission to choose a guess as the canonical reading.

The authored genre reading 장르 [장느] applies the nasal-liquid environment
of Standard Pronunciation Article 19, whose text was checked in the
[Tokyo University of Foreign Studies mirror](https://www.tufs.ac.jp/ts/personal/choes/korean/nanboku/bareumbeop.html).
It remains an authored rule application, not a dictionary-imported reading.
The general [NIKL language-regulations site](https://korean.go.kr/kornorms/regltn/regltnView.do?regltn_code=0002)
distinguishes pronunciation rules from word spelling.

The authored download reading 다운로드 [다운로드] deliberately retains the
loanword's ㄴ+ㄹ boundary; it is **not** an automatic copy of spelling.
[Heo Cheol-gu's 2016 linguistic commentary](https://www.hankookilbo.com/news/article/201606091433486974)
reports that consonant-preserving variant and discusses competing assimilated
forms. The selected reading remains provisional: the pinned official entry
has no pronunciation text, and the commentary does not establish a unique
current standard. Do not reject a learner's different realization solely
because it differs from this unreviewed teaching aid.

The gas-pipe term 가스관 and joint-housing term 공동 주택 are also outside
active teaching. Actual learner-dictionary and Standard Dictionary records
lack citation text. Their compound consonants and word-length realization
remain unresolved; isolated component readings are not a verified reading
of the whole term. The infrastructure support notes retain their source IDs,
proposals, and exact dictionary locators.

These decisions require qualified Korean-language review. They are not
dictionary-verified pronunciations, native-speaker recordings, or evidence of
learner ability. A changed source or new approved reading must update the
canonical record and every embedded introduction and review together.

The goal-frame reading 골대 [골때] additionally consults
[Wiktionary revision 90347175](https://en.wiktionary.org/w/index.php?title=%EA%B3%A8%EB%8C%80&oldid=90347175).
Its raw entry explicitly sets the pronunciation template's `com=1` parameter;
the [template documentation](https://en.wiktionary.org/wiki/Template:ko-IPA/documentation)
identifies that parameter as an editor-supplied tensing instruction. This is
not an inference from spelling alone, but neither the annotation nor generated
IPA is NIKL verification or observed audio. The reading remains authored and
unreviewed; source attribution and licensing limits are in `../sources.yaml`.

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
