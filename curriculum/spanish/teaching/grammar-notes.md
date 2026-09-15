# Spanish construction authoring and assessment

This is an independent communicative progression. The constructions, English
notes, Spanish examples, translations, goals, and checkpoints are original
AI-authored instructional material requiring human Spanish-language and
pedagogy review. They are not a translated Mandarin inventory, a copied
textbook syllabus, or a certified CEFR/examination mapping.

`authoring\grammar.yaml` is the source of truth: each stable `es-g` ID names a
construction, not a dictionary entry. `level` is an integer or a declared
optional branch ID. Changing placement must not renumber an item. Dependencies
are earlier or co-taught constructions and must be taught first within a
level; branch dependencies stop at the branch's declared core threshold.
Levels otherwise build cumulatively on the preceding core levels.

The authored inventory contains **158 constructions**: 146 core constructions
and three applications in each of four branches, with 319 distinct bilingual
examples. IDs are opaque, not a sort order: `es-g0114` teaches high-frequency
negative concord at level 6, and level 16 teaches the form-building
`es-g0086` before the reported-request application `es-g0085`. The YAML list
already follows prerequisite order; an adapter must not infer levels from ID
numbers.

## What the fields do and do not claim

- `ch` is a concise Spanish construction template. Its slots and ellipses
  describe productive structure; it is not a pronounceable phrase inventory.
- `ds` is a short English function label, not an exhaustive definition.
- `note` explains the function or contrast; `examples` supply original
  Spanish with explicit English meaning support.
- `fixed_forms` lists literal forms taught under that construction, including
  inflections or grammatical chunks where needed. It never contains slots,
  invented lexical IDs, or a claim that every word in an example was taught.
- `anchors` uses only approved semantic aliases pending the Spanish adapter's
  canonical sense resolution. For example, existential `haber` and auxiliary
  `haber` are different anchors. `ser-identity` is not an all-purpose anchor
  for every adjective, time expression, or event location.
- `prerequisites` lists required constructions, not an exhaustive list of
  lexical prerequisites. Shared placement generation must preserve closure.

**Every example is explicitly English-supported.** Content words not resolved
through an anchor or taught as a construction's literal fixed forms are
example-only support, not an assertion of cumulative lexical availability.
The tutor must supply a local gloss or an already introduced canonical sense
before requiring that content in a learner task; the English sentence gives
meaning support but is not word-by-word segmentation. The adapter must not
invent a dictionary sense or silently mark every example word as mastered.
Unresolved vocabulary is a glossing/review need, not a reason to discard the
construction. Neither a blank anchor list nor a long fixed-form list grants
lexical mastery.

## Progression and important contrasts

| Placement | Instructional emphasis |
| --- | --- |
| 1–4 | Repair and relationship-sensitive address; subject omission; gender, plural and adjective agreement; `el agua fría`; possession and demonstratives; quantities; requests; `hay`, `estar`, and event `ser`; routes, times, and abilities |
| 5–8 | Regular and common irregular present patterns; routines and ongoing activity; necessity; comparisons; direct and indirect objects; personal `a`; negative concord; `por`/`para`; commands, clitic attachment and accents; recent experience and duration |
| 9–13 | Bounded events and background rather than mechanical time-word rules; earlier past; reflexive, reciprocal and pronominal meanings; adjective and change-of-state contrasts; clear clitic reference; passive/impersonal `se`; messages, relatives, wishes and belief |
| 14–18 | Future time clauses; accidental `se`; completion, progress and result; reported requests; existential versus auxiliary `haber`; realistic and imagined conditions; proposals, objections and concessions |
| 19–24 | Evidence versus conjecture; attributed conditional; reference and scope; future/conditional perfect; quantity and proportion; counterfactual time relationships; relative prepositions and `que`/`de que`; sustained cohesion |
| 25–30 | Implied stance; labelled address variants; figurative and literal readings; restrictive scope and adjective placement; narrative viewpoint; qualified synthesis and self-correction |

The division is about communicative use, not postponing all complex forms.
`Quisiera`, `podría`, and negative commands are useful early constructions
before full productive mood/tense comparisons. Success with one such chunk
does not establish its whole paradigm. Later constructions revisit forms for
new functions, not to inflate headword breadth.

### Gender, existence, and adjective meaning

Learn article, noun, and adjective together instead of guessing all gender from
an ending. Singular `el agua fría` has a feminine noun and adjective; compare
`esta agua`, `mucha agua`, `el agua limpia`, and `las aguas limpias`. The
stressed initial vowel motivates the article form; it does not make the noun
masculine and does not apply to every determiner.

`Ser`/`estar` is not a permanent/temporary opposition: a meeting can `ser` in a
room, a city `estar` in a region, and someone `estar muerto`. Presenting a
property, locating an entity, locating an event, and interpreting an adjective
are different decisions. `Hay` introduces existence or availability; `está`
locates an identified participant. Later `había`/`hubo` remain singular in the
standard existential pattern, unlike plural auxiliary `habían llegado`.

### Polysemy and argument structure

Keep identity/passive `ser`, locative/condition `estar`, existential/auxiliary
`haber`, possessive `tener`, movement `ir`, wanting `querer`, ability `poder`,
and factual/skill `saber` distinct from acquaintance `conocer`. Do not transfer a
dictionary label to a use it does not express. Wanting, affectionate
`querer`, modal requests, and preterite event readings require contextual
attention, not automatic all-sense mastery.

The available semantic anchors are kept precise:

| Construction | Supported anchor distinction |
| --- | --- |
| `es-g0019` | `estar-location` for an entity's location and `ser-occurrence` for where an event takes place |
| `es-g0023` | `saber-how` for a learned skill, not fact-only `saber-know` |
| `es-g0031` | `demasiado-degree` for excessive degree before an adjective or adverb, not every quantity use |
| `es-g0047` | Separate `saber-know`, `saber-how`, and `conocer-acquaintance` |
| `es-g0048` | `quedar-meeting` for meeting and `quedarse-stay` for staying; both retain the canonical lexical grouping |
| `es-g0056` | `estar-state` for readiness or a condition, not `estar-location` |
| `es-g0080` | `llevar-duration` for accumulated activity time, not carrying |
| `es-g0082` | `ser-passive` for the passive auxiliary and `estar-state` for the resulting condition |

Fact-oriented `saber-know` remains appropriate in `es-g0026` and `es-g0065`.
Locative `estar-location` remains appropriate in `es-g0017` and `es-g0019`.
Do not force a newly available sense into an unrelated construction:
`dejar-allow` does not cover cessation in `dejar de` (`es-g0083`);
`tomar-drink` does not cover teasing in `tomar el pelo` (`es-g0134`);
`pasar-happen` does not cover the movement instruction `pase`; and
`orden-arrangement` does not mean a command. Likewise, the staying sense is
not automatically a change-of-state sense for `se quedó callada`, and the
meeting sense does not establish every agreement use of `quedar en`.

`es-g0019` needs `ser-occurrence` at core level 4. The shared scheduler moves
that exact sense forward where required and records prerequisite adjustments;
it does not substitute `ser-identity` or assume earlier knowledge.
Similarly, `salida-departure` must not be used for the physical
exit in `la salida del museo`; `devolver-return` is not the repeat-action
construction `volver a`. Available aliases are not an obligation to add
unrelated lexical prerequisites.

Personal `a` is not an indirect-object marker. `La veo` can refer to the person
in `Veo a Ana`; `le` in `Le doy el libro a Ana` marks the recipient. When a
third-person indirect clitic precedes `lo/la/los/las`, it becomes `se`; this
`se` is not thereby reflexive. Introduce a productive direct `lo/la` and
indirect `le` model while recognizing contextually licensed regional clitic
patterns. Some masculine singular personal `le` uses are standardly accepted;
that does not make every `le`, `la`, or `lo` interchange valid.

`Se` may mark a reflexive action, reciprocity, a lexical/pronominal change,
an affected-person construction, a passive, or impersonality. Use participants,
agreement, and meaning to decide; never translate every `se` as “oneself.”
Separate senses for pronominal uses need source support; construction treatment
does not fabricate them.

### Aspect, mood, and evidence

Preterite and imperfect present events differently; “completed versus
incomplete in real life” is not a sufficient rule. An event can be bounded in
the preterite or viewed from within in the imperfect. Time expressions are
context, not automatic tense selectors. Perfect-versus-preterite preferences
vary among speakers and settings; teach the selected context rather than a
single transatlantic division.

Subjunctive is not simply “uncertain” and indicative is not a truth guarantee.
An emotional reaction can take subjunctive to a known event. Negated belief,
desired but unidentified referents, future time clauses, concessions, and
counterfactual comparisons each have their own contrast. `Aunque` can take
subjunctive when a fact is conceded as background, not only when its truth is
unknown. `A lo mejor` ordinarily uses indicative despite expressing
uncertainty. Attributed future/conditional wording changes commitment but
does not establish whether a report is true.

### Address, idioms, and lexical caution

Early productive models use `tú`, `usted`, and plural `ustedes`; singular `tú`
is accented, possessive `tu` is not. Agreement follows the chosen address
construction. `Usted` does not express one fixed degree of warmth or distance
everywhere. Teach explicit recognition and selected production of `vosotros`
and labelled voseo forms without describing them as errors. Voseo paradigms
and preferences vary; one model is not a universal `vos` table.

Regional vocabulary must retain actual source labels or an explicit authored
usage note. Alternatives such as `ordenador`/`computadora` and transport words
are recognition opportunities, not a licence to invent country tags. Verbs
such as `coger` can have sensitive regional readings; prefer an appropriate
explicit alternative such as `tomar el autobús` in broadly addressed travel
material, while recognizing that choices still vary. Idioms require context,
relationship, and a plain-language paraphrase, not compulsory performance.

### Source form-of records and authored forms

`es-g0007` teaches the literal feminine forms `profesora`, `maestra`, `tía`,
`chica`, and `novia` as gender realizations of the relevant canonical lexical
groups, not extra lemmas. The adapter owns their exact source-backed form and
sense links. Examples remain English-supported and do not award every meaning
of the corresponding masculine spelling. Preserve the source's “especially
Spain” qualifier on the selected `profesor` sense rather than making the
original gender rule itself geographically restricted.

Affirmative `sí` is a fixed form in `es-g0005`; subject `él`, `ellos`, and
their corresponding feminine forms appear in `es-g0002`. Short possessives
`mi`, `tu`, and `su` are already in `es-g0011`. Unaccented possessive `tu`
must not be confused with subject `tú`.

`Vosotros` and `vosotras` are explicit authored pronoun forms in `es-g0128`,
alongside a labelled agreement model. That pedagogical recognition of modern
usage is not a reinterpretation of an upstream record with aggregated
archaic/Philippines tags. Do not relabel those tags as evidence of current
Spain usage, exempt that source record from selection rules, or count the
authored pronouns as newly acquired dictionary lemmas.

## Optional branches and teaching load

Professional and technical applications use only core constructions through
18. Scientific and literary applications use only core through 24. No branch
requires another branch or later core. Each contains distinct applications;
their lexical modules and availability are handled separately by the adapter.
The professional target is independent use in selected tasks; the other
branches default to contextual understanding. None certifies expertise.

Modules contain at most 25 new senses, not 25 words per lesson. Start with
about 5–8 new senses and adapt. Group no more than three new constructions
in one practice block. Level and branch task prompts are assessment designs,
not observations. Record actual performance using `mastery.yaml`; require
audio for listening and spoken judgments.

## Travel key integration

The travel author's short keys resolve to existing constructions as follows.
The adapter owns the separate machine-readable key map; this table does not
mint travel-specific grammar IDs.

| Travel key | Canonical construction |
| --- | --- |
| `negative` | `es-g0005` |
| `quantity` | `es-g0016` |
| `polite` | `es-g0001` |
| `articles` | `es-g0007` |
| `prepositions` | `es-g0036` |
| `questions` | `es-g0004` |
| `clitics` | `es-g0033` |
| `possessives` | `es-g0011` |
| `demonstratives` | `es-g0012` |
| `present` | `es-g0025` |
| `requests`, `repair` | `es-g0006` |
| `wants` | `es-g0013` |
| `location` | `es-g0019` |
| `existence` | `es-g0017` |
| `commands` | `es-g0037` |
| `state`, `participles`, `property` | `es-g0009` |
| `health` | `es-g0014` |
| `experiencer` | `es-g0034` |
| `perfect` | `es-g0043` |

The selected construction's `fixed_forms` explicitly covers each grammar-only
travel form: `no`; `más`, `dos`; `por favor`; `un`, `una`, `el`, `la`; `sin`,
`a`, `en`, `con`, `al`, `para`; `dónde`, `cuánto`, `qué`, `cuándo`; `me`;
`mi`; and `este`, `esta`, `otra`. The last is an indefinite determiner, not a
demonstrative; the travel key groups ways to select an object rather than
claiming a single grammatical class.

`Lo` and `me` also appear as literal pronoun forms under `es-g0033`, but an
attached surface such as `escribirlo` or `ayudarme` still needs explicit
base-plus-clitic morphology and its own validated reading realization.
Listing a clitic never licenses an arbitrary whole word by substring.
The `state` and `participles` keys deliberately share the same construction
for `está abierto`; deduplicate that canonical ID in a phrase's grammar list.
This early agreement/state frame does not require the much later passive-
event contrast in `es-g0082`. Likewise, `no entiendo`, `más despacio`, and
`puede escribirlo` begin as explicitly supported repair frames under
`es-g0006`, not as evidence of an entire present or clitic paradigm.
Core levels remain cumulative, but construction dependencies name actual
structural prerequisites rather than every intervening topic. The standalone
route therefore need not teach future plans to introduce simple present forms.

The `present` key identifies person agreement, not mastery of every irregular
paradigm or every lexical meaning. Lexical surfaces remain vocabulary items
with explicit validated `form_id` realizations; grammar IDs belong in the
separate construction field. Expand irregular-pattern teaching with
`es-g0026` and `es-g0027` when needed rather than inventing conjugation senses.
The route must introduce its declared construction dependencies itself; these
maps never grant the learner assumed prior core knowledge.

Use sense-specific checks in addition to surface licensing. `Tengo alergia`
needs the health-expression treatment of `es-g0014`, not automatic
possession-sense mastery; `me duele` uses `es-g0034`; adjective agreement uses
`es-g0009`. Likewise, property `es grande` must not be assessed as the identity
sense of `ser`. Supported phrase performance alone does not demonstrate all
these lexical or construction distinctions.

## Reference-only checks

- [Instituto Cervantes, Plan curricular](https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/):
  reference-only orientation and gap checking, not copied inventories or
  official mappings to these thirty levels.
- [RAE/ASALE: seseo](https://www.rae.es/dpd/seseo) and
  [RAE/ASALE: yeísmo](https://www.rae.es/dpd/ye%C3%ADsmo):
  reference-only pronunciation background; see `pronunciation.md`.

These references do not attribute our examples to those institutions or imply
their approval. Human review remains required.
