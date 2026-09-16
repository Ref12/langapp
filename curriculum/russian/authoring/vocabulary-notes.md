# Russian vocabulary selection notes

## Status and actual coverage

This is an AI-assisted, explicitly authored selection for all thirty core
levels and four optional branches. It is not a frequency list, examination
list, proficiency calibration, or a claim of human linguistic review.
Source traceability does not establish that every dictionary assertion,
English hint, stress marking, or teaching placement is correct.

The following counts cover the primary `authoring\vocabulary.yaml` only.
They exclude the eleven separately maintained support entries in
`authoring\grammar-support.yaml` and `authoring\support-vocabulary.yaml`;
combined integration totals are reported separately.

| Inventory | Selected senses | Lexical identities | Canonical spellings | Source records |
| --- | ---: | ---: | ---: | ---: |
| Core, levels 1–30 | 4,794 | 4,747 | 4,743 | 4,745 |
| Core and optional branches, set union | 4,986 | 4,934 | 4,930 | 4,932 |

The **5,800–6,000 core-headword planning target is not met**. The actual
core is 1,053–1,253 headwords below that range. This is a bounded selection,
not a claim that the source tables are exhausted or that no further useful
headwords exist. Expansion should add individually justified words and
senses, not relax reading checks, count grammatical forms, or fill a quota
with obscure derivatives.

New identities are credited only at their first core occurrence:

| Phase | Levels | Selected senses | New core identities | Cumulative core identities |
| --- | --- | ---: | ---: | ---: |
| First exchanges | 1–4 | 212 | 210 | 210 |
| Everyday life | 5–8 | 597 | 594 | 804 |
| Stories and conversations | 9–13 | 747 | 744 | 1,548 |
| Explanation and problems | 14–18 | 831 | 824 | 2,372 |
| Analysis and argument | 19–24 | 1,047 | 1,031 | 3,403 |
| Nuance and interpretation | 25–30 | 1,360 | 1,344 | 4,747 |

Every level is populated. Level totals are not lesson sizes: the program
must divide these inventories into coherent small modules and adaptive
lessons rather than present a whole level as one memorization assignment.
The later phases introduce materially more vocabulary than the earlier
phases, without requiring each successive individual level to be larger.

| Optional branch | Senses / identities within branch | Identities already in core | Additional identities beyond core |
| --- | ---: | ---: | ---: |
| Professional | 59 / 59 | 2 | 57 |
| Technical | 51 / 51 | 3 | 48 |
| Scientific | 43 / 43 | 0 | 43 |
| Literary | 39 / 39 | 0 | 39 |

Thus the branches add **187**, not 192, headwords beyond the core. For
example, a branch can introduce a new sense of an already encountered
word. Route totals must continue to use identity sets; they are not evidence
that a learner can independently use every introduced word.

There are no authored spelling aliases or reading overrides in this ledger.
It does not enumerate conjugated or declined surface forms, constructions,
or tourist phrases. The separate importer retains the source morphology;
those forms must not be added to the headword counts above.

## Selection method and pedagogical decisions

The product is our normalized vocabulary, learner-facing English labels,
and teaching order, not a repackaged dictionary dump. This document and the
record locators are editor-facing material. Full snapshots, raw source
fields and parse audits are ingestion inputs, not extra lesson content;
they should remain separate from compact learner lists. Provenance helps
maintain and attribute a selection, but does not override an explicitly
authored English correction.

The parent-generated output boundary is explicit. Paths below are relative
to `curriculum\russian`:

| Output | Contract |
| --- | --- |
| `reference\vocabulary.yaml` | Independent normalized vocabulary records with exactly nine standard fields; no inline expanded source payload. |
| `build\lexical-records.yaml` | Selected raw-source, sense-selection, morphology and provenance data, kept separately from the normalized reference. |
| `build\linked-forms.yaml` | Source-backed links between lexical forms and their canonical entries. |
| `build\grammar-forms.yaml` | Source-backed grammar/construction form records. |

This separation does not change the authoring schema or the existing
source-derived compact shapes. The authoring helper does not write these
parent-owned outputs.

`vocabulary.yaml` is the explicit record/slot/level/topic/POS/meaning ledger.
`scripts\author_russian_vocabulary.py` makes that selection repeatable from
the four pinned source tables. Its inputs are authored Russian headword
blocks with named communicative topics and exact chosen English spans.
It does not scan source rows until a desired count is reached.

The helper uses `russian_source.load_tables(source_dir)` to hash all four
local tables and apply their shared strict parser. Quotes are literal TSV
characters (`csv.QUOTE_NONE`), not CSV field delimiters: for example, noun
data record 9658 retains the German opening `"blinder" Gehorsam`. The one
precisely identified pinned exception is others data record 2676,
`переборот`, whose extra unescaped tab is retained inside its final German
field. No data record is skipped or reordered, and English quotes remain
faithful source text for exact `source_gloss` extraction.

The helper uses `source_reading(marked, target=bare)` as its reading gate. Every selected
row also passes the public `validate_selection` and `expanded_selection`
APIs before the helper writes or checks YAML. Local and source-module pins
must agree. Expansion is an intermediate validation/provenance step, not
the schema of the normalized reference list. Word-boundary rules match the
source API, including hyphens and
apostrophes: a fragment such as “almond” inside “almond-tree” is not accepted
as the selected span. The corresponding selections use complete spans
such as “almonds”, “conjecture”, and “land-improvement”. These refinements do
not renumber IDs or change inventory counts.

The progression was designed by communicative purpose:

- Introductions, repair, identity, simple locations, food, routine, quantities,
  directions and help come first. English instructions remain available.
- Household needs, transactions, care, transport and work/study add practical
  breadth before extended narration and opinions.
- Intermediate additions include prefixed motion and delivery verbs,
  service failures, cooperation, news, institutions, technology and proposals.
- Evidence, economic processes, scientific and historical change, ethics
  and source-based synthesis motivate the next phase.
- Stance, register, ordinary figurative language, precise description,
  interpretation and independent projects motivate the final phase.
- Branch words were selected for their declared domains. These are modest
  optional additions, not comprehensive professional dictionaries or
  qualifications to practise a profession.

Practical first-use decisions put `слышать`, `повторять`, and `значить`
into first-level repair, `помогать` into level-four help, `давать` into
household sharing, `брать` into transactions, and `записать` / `записывать`
and `произношение` into level-eight study.
`телевизор` belongs with the home before later discussion of broadcasting;
`сила` is introduced for ordinary strength/force before social analysis.
Rescheduling preserves existing IDs and adds no lexical credit.
Other practical choices include early `понять`, `английский`, `иностранец`,
`ноль`, `куда`, and `переводчик`; travel `граница` and `иностранный`;
practical `пробовать`; general `зависимость`; and financial `приобрести` /
`приобретать`. Their choices and placements are explicit declarations.

Quantity, price and time coverage is compositional rather than a list of
every possible numeric phrase. Level three introduces zero through ten,
counting, half, hours, minutes and seconds. Level six adds source-supported
teens, tens, each hundred from 100 to 900, and 1,000 alongside prices,
roubles, kopecks, bills and change; it also introduces a quarter. The
exception is `тринадцать` (others record 664), whose unmarked multisyllabic
reading remains deferred rather than invented. Million and billion belong
to level-twenty economic discussion. Numeric phrases and case forms do not
add headwords. `считать` “count” is intentionally introduced before its
level-thirteen “consider” sense, with one shared lexical identity.

Blocks preserve authored order within a level. The helper performs only a
stable final ordering by level and branch, not alphabetical ordering or
sorting by a source record number. Source order has **no documented frequency
field** and is not represented as a frequency rank. Usefulness and sequencing
are author judgments, not corpus-frequency measurements.

The helper's `SHORT_GLOSSES` ledger explicitly narrows otherwise ambiguous
short translation fields. A missing explicit selection never triggers a
“take the first dictionary meaning” rule. Remaining complete short fields
are retained only as selected groups of closely related English equivalents,
such as “thanks, thank you”.

Examples of deliberately selected non-first source spans include
`квартира` → “apartment”, `сотрудник` → “employee”, `преподаватель` →
“instructor”, `зеркало` → “mirror”, `взгляд` → “opinion”, and
`налево` → “to the left”. Early `кухня` does not teach the same source
field's “machinations”; `полка` does not teach “weeding”; `лампа` does not
introduce an electronic valve; `метр` does not introduce a “master”.

English hints may normalize spelling, wording or grammatical presentation,
or qualify the intended meaning. For example, “coryza” is presented as
“runny nose”, a source “tried to” can be rendered as an infinitival attempt,
and `лёгкий` receives “easy (not difficult)” and “light (not heavy)”.
Such English adaptations are **authored hints, not independently
source-verified definitions**. Their exact underlying `source_gloss`
remains available separately. No Russian stress correction is inferred
from an English adaptation.

Some legacy English fields are defective or too narrow for the intended
common meaning. The explicit `LABEL_ADAPTATIONS` ledger and each affected
row's `sense_note` distinguish our AI-authored labels from that legacy text:

| Headword | Retained source span | Normalized learner label | Authorship decision |
| --- | --- | --- | --- |
| `куда` | wherever | where to? | Authored interrogative direction meaning, not verified by “wherever”. |
| `граница` | abroad | border | Authored correction of an incorrect English noun gloss. |
| `пробовать` | tried to | try or sample (imperfective) | Authored infinitival wording instead of a past-tense English fragment. |
| `зависимость` | addiction | dependence | Authored general meaning rather than only the narrower addiction sense. |
| `сила` | power | strength or force | Authored ordinary meaning, not a source-verified technical definition. |

The exact legacy span remains an auditable source locator; it is not
presented as proof of the corrected meaning. The source Russian spelling
and marked reading are unchanged. All five normalized outputs were checked
to expose the authored label rather than the legacy source gloss. This
distinction permits useful content without treating unrelated dictionary
English defects as a curriculum blocker, while keeping human review visible.

Rejected draft candidates are explicit in `EXCLUDED_REVISITS` and
`DEFERRED`. The former prevents a new context from masquerading as a new
sense. The latter records missing/mismatched source support, unresolved
readings, transparent grammatical forms, or unsuitable candidate choices.
These sets are a selection audit trail, not a list of words that Russian
learners must never encounter.

## Identity and common polysemy

Entry IDs are **local**, not official OpenRussian identifiers:

`ru-or-{n|v|a|o}{five-digit data-record ordinal}-s{three-digit local slot}`

The ordinal counts parsed TSV data records from one; the header is not a
record. Tables are pinned, so an ID does not change merely because teaching
order changes. Sense slots are explicitly named where a word is revisited;
they are not allocated from current file order. Subsequent source refreshes
or semantic regrouping need an explicit migration decision rather than
silent renumbering.

The default identity is `ru-lex-or-{table prefix}{record ordinal}`. Multiple
selected senses share it unless an explicit homograph decision says otherwise.
Important examples:

| Selection | Decision |
| --- | --- |
| `язык`: language / tongue | Two selected spans, one identity. |
| `считать`: count / consider | Different common meanings, one identity; counting is introduced first without renumbering the pre-existing sense slot. |
| `лёгкий`: easy / light in weight | Two adjective senses, one identity; the source's noun “lung” is excluded. |
| `пожалуйста`: please / you are welcome / here you go | Three explicitly selected pragmatic senses, one identity. |
| `опыт`: experience / experiment | One identity, different introduction contexts. |
| `предложение`: sentence / offer | One identity, different selected meanings. |
| `пособие`: allowance / textbook | One identity; financial and study meanings remain separate senses. |
| `мир`: world / peace | Separate local homograph identities with `-world` and `-peace` suffixes. |
| `среда`: weekday / environment | Separate `-weekday` and `-environment` identities. |
| `пол`: floor / sex | Separate `-floor` and `-sex` identities. |
| `замок`: castle / lock | Different source records and marked readings, separate identities. |
| `мука`: torment / flour | Different source records and marked readings, separate identities. |
| `она` alongside `он` | Retained as a taught gender realization but linked to `ru-lex-or-o00004`; no extra headword credit. |

Perfective and imperfective lexical verbs remain distinct headwords, as do
genuine prefixed motion verbs. This does not imply that every exported
`partner` string is an interchangeable aspect partner for the selected
sense. Source English can support only one meaning of a polysemous partner.
For example, an entry selected for enduring something must not silently
serve as an independently verified transport meaning.

Comparatives and spelling/infinitive variants are not used to inflate
coverage: examples excluded from additional credit include `раньше`,
`позже`, the `прочесть` alternative to selected `прочитать`, and
`достигнуть` alongside selected `достичь`. Transparent participial candidates
were also deferred. Lexicalized adjective meanings such as `занятый`
“busy”, `следующий` “next”, and `сжатый` “concise” are treated as dictionary
adjective uses rather than a list of generated verb forms. This boundary,
like the rest of the POS/lemma analysis, still requires human review.

Plural-only or lexicalized plural nouns with their own dictionary meaning,
such as `часы` “watch”, `ножницы` “scissors”, and `брюки` “trousers”,
are not counted as ordinary plural realizations of another selected noun.
In particular, the watch meaning of `часы` is distinct from the inflected
plural of `час` “hour”. Case forms and agreement variants receive no
additional credit.

The canonical quantifying determiner `весь` uses adjective record **11866**
at level six, selecting “all, the whole of”. Its source `decl_n_nom` and
`decl_n_acc` supply `всё`; `decl_pl_nom` supplies `все`. The ledger does
not turn those surface forms into additional words.

The helper's explicit `PRONOUN_FORM_RECORDS` guard rejects these known
others-table forms as vocabulary introductions. The right-hand column
identifies the source canonical entry, not a new lexical identity:

| Excluded form records | Canonical source record |
| --- | --- |
| `o04978` `все` | `a11866` `весь` |
| `o04980` `меня`, `o04984` `мне` | `o00006` `я` |
| `o04981` `тебя`, `o04985` `тебе` | `o00020` `ты` |
| `o04982` `нас`, `o04988` `нам` | `o00018` `мы` |
| `o04983` `вас`, `o04989` `вам` | `o00021` `вы` |
| `o04986` `ему` | `o00004` `он` |
| `o04987` `ей` | `o00011` `она` |
| `o04990` `им` | `o00014` `они` |

None of these twelve form records is selected as an independent headword.
The separate source-backed form-link metadata can teach them under their
canonical entries. `она` retains the conservative shared identity with
`он` described above. The guard is a bounded source-record decision, not
a rule rejecting all pronouns with non-nominative-looking dictionary forms:
the reflexive dictionary lemma `себя`, for example, remains a distinct
lexical entry.

## Source defects, exclusions and reading limits

The helper verifies all four complete source checksums before selecting or
writing anything. It requires unchanged `bare` spelling after removing the
source stress apostrophe. Each selected word has a source vowel-following
stress apostrophe, a usable retained `ё`, or a monosyllabic/clitic reading.
For hyphenated pronouns such as `кто-то`, each component is checked; the
source-marked stem and monosyllabic clitic are not replaced with invented
compound stress.

Neither this YAML nor its helper authors `ch` or `pr`. Canonical Cyrillic
and mechanical conversion of the source apostrophe to a stress aid belong
to the importer. These are lexical-stress aids, not IPA, audio, vowel
reduction, connected-speech transcription, or pronunciation certification.

Specific decisions include:

- `ru-or-v00004-s001` selects only “know” for `знать`, not the verb row's
  “aristocracy”, “nobility”, or “evidently”.
- `ru-or-v00006-s001` is eating `есть`. Existential `есть` from the others
  table is not credited as a new lemma here; `ru-g-possession-existence`
  handles it as a `быть` construction/form and distinguishes it from eating.
- Others record 1967 `всё` supplies adverb senses, not evidence for a
  pronoun “everything” entry. The pronominal form belongs to canonical
  adjective record 11866 `весь` and its declension, not to a relabeled
  adverb record. Neither `все` nor `всё` adds independent headword credit.
- `атлас` uses noun record **7799**, selecting only “atlas”. The duplicate
  record 26421 and the mixed “satin” meaning are not additional selections.
  In particular, the atlas reading is never assigned to satin.
- `замок` uses records 26428/26429; `мука` uses 1154/26432. Missing noun
  metadata in a homograph row is not filled in by this authoring ledger.
- Ambiguous duplicate-stress rows require an explicit record choice.
  Examples include `ужин`, `лекарство`, `правило`, `вина`, `провод`,
  `кредит`, `отзыв`, and `ледник`. An unselected duplicate is not counted
  as another spelling or lemma. The glacier selection does not introduce
  the ice-house reading of `ледник`.
- Table membership is not POS verification. Examples explicitly reclassified
  include `как` from the adjective table as an adverb, `привет` from the
  noun table as an interjection, and `учёный` from the adjective table for
  the noun meaning “scientist”. Numerals and pronouns are likewise authored
  by their selected use, not by the filename.
- Export contamination is not copied wholesale into beginner hints:
  `говорить` selects “speak”, and English spans are separated from unrelated
  POS meanings or non-English material elsewhere in a raw field.
- The source's `сила` “power” is retained separately from the authored
  “strength or force” label described above; neither is claimed to be a
  verified technical definition. `колебаться` is selected for hesitation,
  not supplied as source-verified oscillation.
- Bare/accented `е`/`ё` conflicts are rejected, including audited examples
  such as `жёлчный` / `же'лчный` and `насторожённый` / `насторо'женный`.
  No pronunciation or spelling override was invented.

The primary source lacks rows for `наш` and `ваш`, but these are already
taught as fixed forms in `ru-g-possessive-agreement`. They do not require
fabricated vocabulary records and are not missing curriculum prerequisites.

Interrogative `куда` is also construction-owned in
`ru-g-place-direction-origin`. Its independently authored lexical label
“where to?” is not verified by the retained source gloss “wherever”;
that legacy gloss must not establish the construction's meaning.
Instructional ownership and source provenance are distinct: fixed-form
and phrase readings require their own provenance checks.

Remaining source-reading gaps include the unmarked multisyllables
`тринадцать` and `родители`.
The previously audited `зачем` and
`установить` also lack an acceptable marked reading. Fixed constructions or
properly attributed supplementary records may cover such gaps elsewhere;
this ledger does not falsely mark them as primary-source-backed. These are
bounded editorial follow-ups, not prerequisites for using the existing
normalized learning content.

The snapshot also has no usable English field for many requested modern
technical candidates, including `принтер`, `сканер`, `интерфейс`, and
`процессор`. This ledger's exact-nonempty-source-span contract does not
represent such empty fields. That is an ingestion-contract limitation,
not a prohibition on independently authoring their English meanings in an
appropriate supported record. The optional technical/scientific additions
remain limited and uneven, not comprehensive contemporary domain coverage.

## Attribution and redistribution

The dictionary-derived data is adapted from **OpenRussian and its
contributors**, including upstream sources identified by OpenRussian such
as **Wiktionary contributors**, through the public
[Badestrand/russian-dictionary repository](https://github.com/Badestrand/russian-dictionary).
The exact snapshot is commit
`50e210c4803237779cb562bc1abcea529066031c`.

- [Pinned source README](https://raw.githubusercontent.com/Badestrand/russian-dictionary/50e210c4803237779cb562bc1abcea529066031c/README.md)
- [Pinned source data license](https://raw.githubusercontent.com/Badestrand/russian-dictionary/50e210c4803237779cb562bc1abcea529066031c/LICENSE)
- [OpenRussian](https://en.openrussian.org/)
- [Creative Commons Attribution–ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)

The four `.csv` filenames contain TSV data. Their retained pins are:

| File | SHA-256 |
| --- | --- |
| `nouns.csv` | `c388f9e6dde51932832be8d7e9afdbe9f0acee72fcf70677f0fe25ea61293c84` |
| `verbs.csv` | `8659de6799b949fb35f080b08088fb7d347ed300490954ebb380a31642646e1d` |
| `adjectives.csv` | `89ab5d10dcd2f21f6b485de704aef372f32251468e3aa96f18b21e259f26b80a` |
| `others.csv` | `9f22a16b17fc9a564298112168b667fced11aafb254ccebf5b7544fc37cdaa92` |

Selection, source-span grouping, English simplification, POS/identity
decisions and teaching placement are adaptations. Retain attribution,
source and license notices, indicate these changes, and observe the
CC-BY-SA-4.0 share-alike requirements when redistributing adapted dictionary
data, including derived compact views. The old composite export does not
identify an exact upstream Wiktionary revision; none is asserted here.
This data attribution is not a claim that dictionary content has the
software code's license, nor does it relicense unrelated application code
under CC-BY-SA.

No full source tables were downloaded again for this authoring task.
Regeneration uses the already obtained, checksum-verified local files.
No quotations, literary passages, audio or media were imported.

## Repeating and checking this authoring pass

From the repository root, with the four pinned files in an existing local
directory (`openrussian-nouns.csv` etc., or the original unprefixed names):

```powershell
$env:PYTHONIOENCODING = "utf-8"
$python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$sources = "Q:\path\to\pinned-tables"
& $python -B scripts\author_russian_vocabulary.py --sources $sources
& $python -B scripts\author_russian_vocabulary.py --sources $sources --check
```

Replace the example `$sources` value with the existing local source directory.
`--audit` reports unresolved selection problems without writing;
`--lookup <lemma> ...` displays relevant exact records for author review.
`--check` is nonwriting and compares deterministic serialization using the
existing `curriculum_yaml` module. It does not regenerate the parent's
reference, grammar, phrase, or teaching-output files.

Validation performed for this ledger includes all required keys, valid
local IDs and record ordinals, unique entry IDs, exact source substrings,
English hints within 64 characters, supported source readings, all thirty
levels and four branches, identity-aware counts, YAML round-trip equality,
and repeatable generation. Focused checks also reject a changed source
checksum, unresolved stress, an `е`/`ё` conflict, satin under the atlas
reading, noun meanings in the knowing verb, “lung” as an adjective,
unsupported pronoun `всё`, and extra existential-`есть` headword credit.
Explicit negative checks exercised all twelve known pronoun-form records
and confirmed that rejection leaves the selected inventory unchanged.
Castle/lock and torment/flour remain separate identities. `--check` was
verified to preserve both the YAML content hash and modification time.
Every expanded selection was also passed through `normalized_reference`,
checking that its learner-facing English equals the authored `ds`, including
the explicitly corrected legacy-gloss cases.
The longest current hint is 36 characters.
These checks cannot certify idiomaticity, source correctness, pedagogy,
clinical phrasing, productive command, or examination readiness.
