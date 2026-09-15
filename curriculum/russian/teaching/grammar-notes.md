# Russian construction coverage and dictionary gaps

The local authoring inventory contains **148 original constructions**:
136 in the core, covering every level 1–30, and three in each of four
optional branches. Every core level introduces four to seven constructions.
These are meaningful functional contrasts, not a count of every
case ending, person, spelling variant, or cell in an inflection table.

The explanations and bilingual examples in
`..\authoring\grammar.yaml` are AI-assisted original teaching work, not
copied dictionary examples or source-certified grammatical claims. They
require human Russian-language and pedagogical review. The counts describe
this authored inventory, not a learner's mastery or a complete account of
Russian grammar.

## How the progression covers Russian

| Levels | Construction emphasis and representative IDs |
| --- | --- |
| 1–4 | Polite repair, zero copula, `вы`, questions, negation, gender and possessive agreement, direct objects, location/destination, quantities, present verbs, needs, and future activity: `ru-g-present-identity`, `ru-g-place-direction-origin`, `ru-g-imperfective-future` |
| 5–8 | Possession and absence, useful six-case government, animacy, reflexives, past agreement, irregulars, motion, quantities, and roles: `ru-g-absence-genitive`, `ru-g-animate-accusative`, `ru-g-irregular-eat-give`, `ru-g-current-motion` |
| 9–13 | Narrative aspect and negation, habitual motion, feelings, negative pronouns, instructions, purpose, reported messages, relatives, comparison, and reasons: `ru-g-negated-aspect`, `ru-g-habitual-motion`, `ru-g-relative-kotory` |
| 14–18 | Needed nouns, impersonal states, negative objects, obligations, achieved outcomes, report attribution, passive/participial choices, prefixed motion, and conditionals: `ru-g-negated-object-case`, `ru-g-prefixed-motion`, `ru-g-hypothetical-by` |
| 19–24 | Uncertainty, inference, necessary conditions, formal government, nominalization, scientific explanation, concession, scope, and synthesis: `ru-g-only-if`, `ru-g-action-nominalization`, `ru-g-concession`, `ru-g-formal-conclusion` |
| 25–30 | Information focus, particles, register, idiom, ellipsis, precise scope, rhetorical interpretation, and explicit revision: `ru-g-information-focus`, `ru-g-focus-particle-scope`, `ru-g-explicit-self-repair` |

### Cases and agreement are relations, not English substitutions

Learn a noun with its useful gender, animacy, and form information when
supported by the source. A missing metadata field is unknown, not a default
inanimate or masculine value. Gender is grammatical; a learner must not infer
every noun's gender from its meaning or its final letter.

The introductory case frames cover nominative identification, accusative
objects/destinations, genitive possession/absence/origin, dative recipients
and experiencers, instrumental means/companions/roles, and prepositional
locations. Their endings vary with declension, number, adjective/pronoun
agreement, and sometimes stress. Selected raw source and morphology records
belong to `..\build\lexical-records.yaml`, approved lexical form links to
`..\build\linked-forms.yaml`, and construction-owned form support to
`..\build\grammar-forms.yaml`. They do not become extra lexical headwords
or inline expanded metadata in the normalized reference lists.

`в школе` and `в школу` contrast location with destination. `под столом`
shows that not every location uses the prepositional. `интересоваться
историей` and `отвечать за расписание` illustrate lexical government that
cannot be predicted by translating English prepositions.

Animacy changes relevant accusative patterns, not every case indiscriminately.
Negative-object genitive is also not a rule that every `не` forces genitive:
compare specific-object `Я не прочитал эту книгу` with `Я не получил ответа`.
The dedicated constructions retain these distinctions instead of making an
early simplified frame the universal rule.

### Aspect and motion need contrastive contexts

- `ru-g-narrative-aspect` distinguishes an activity or background from a
  bounded outcome without equating imperfective with “unfinished forever.”
- `ru-g-negated-aspect` distinguishes no reading activity from failure to
  complete a reading outcome. It does not infer an attempted action from
  every negative perfective.
- `ru-g-imperative-aspect` and `ru-g-negative-imperative` distinguish
  contextual instruction choices. They do not teach perfective as always
  polite or imperfective as always rude.
- `ru-g-current-motion` and `ru-g-habitual-motion` treat `идти`, `ходить`,
  `ехать`, and `ездить` as imperfective lexical verbs with direction,
  habit, transport, and contextual distinctions, not different tenses.
- `ru-g-prefixed-motion` teaches prefix meaning and aspect together.
  A source partner field may list related verbs rather than interchangeable
  aspect twins; retain the raw relation and a qualified interpretation.
- `ru-g-placement-result` includes the irregular `класть`/`положить`
  relation. No guessed regular form replaces a verified lexical partner.

Common irregular forms such as `хочу`/`хотим`, `могу`/`можете`,
`ем`/`едят`, `дам`/`дадут`, and motion past stems require direct form
attention. Their stress must come from the correct source/form record,
not analogy. Correctly using one form does not master the entire paradigm.

## Fixed forms belong to their construction

Every authoring row contains:

- A stable semantic `ru-g-*` ID, a Cyrillic construction template, and an
  unambiguous English `ds` of at most 64 characters.
- A numeric core level or declared branch ID, an approved topic, an
  explanatory English note, and normally at least two original bilingual
  examples.
- `lexical_anchors`, using lemma and intended-sense hints for genuinely
  necessary lexical prerequisites. These are resolved to exact curated
  sense IDs by the adapter, never by first-spelling or first-sense fallback.
- `fixed_forms`, literal taught forms or chunks, not regexes, morphology
  wildcards, or permission to cover an unrelated example word.
- `grammar_prerequisites`, earlier or explicitly co-taught constructions.

An empty anchor list means the construction can introduce its fixed
grammatical material without a manufactured dictionary entry. It does **not**
mean that every incidental example noun has already been learned. Teach or
gloss the other support explicitly, and substitute already understood words
when instantiating a lesson.

| Construction IDs | Fixed form or contrast and why it matters |
| --- | --- |
| `ru-g-polite-repair`, `ru-g-polite-help-imperative` | Early greetings and polite imperative chunks are usable before full imperative analysis. |
| `ru-g-present-identity` | `Меня зовут` is a naming construction, not the sum of arbitrary isolated glosses. |
| `ru-g-possessive-agreement` | `наш` and `ваш` are explicit fixed forms; the source-selection audit found no bare entries for them in the pinned primary tables. |
| `ru-g-place-direction-origin` | Interrogative `куда` is construction-owned; the primary source's selected “wherever” meaning must not be credited as the question “where to?” |
| `ru-g-possession-existence` | Existential `есть` must not borrow credit from `есть` meaning eat. |
| `ru-g-dependency-government` | Responsibility `отвечать за` is construction-owned because the pinned lexical row supplies only answer/reply/respond meanings. |
| `ru-g-permission-request`, `ru-g-dative-need`, `ru-g-needed-noun` | `можно`, impersonal `нужно`, and agreeing `нужен` have distinct functions. |
| `ru-g-joint-invitation` | Proposal `давайте` is not every lexical sense of giving. |
| `ru-g-negative-pronouns`, `ru-g-concessive-ni` | Negative-concord `ни` and concessive `ни` cannot be merged by spelling. |
| `ru-g-source-attribution`, `ru-g-inference-from-evidence` | Attributed words/data and an inference from evidence are not guarantees of truth. |
| `ru-g-despite-expectation-particle` | `всё-таки` is its own fixed particle, not an automatic “everything” sense of `всё`. |
| `ru-g-hands-time-idiom`, `ru-g-preoccupied-ne-do` | The idiomatic chunk is assessed as a construction, not literal motion or temporal `до`. |
| `ru-g-literary-kol`, `ru-g-literary-bookish-connectors` | Marked literary alternatives are read in context, not imposed on neutral conversation. |

If a correct dictionary sense or stress reading is unavailable, retain the
essential construction and report the precise lexical/reading gap. Resolve
it through a documented reviewed source or fixed-form route. Never attach
an unrelated sense merely because the spelling matches, and never grant
lexical credit for a form introduced only as grammar. Fixed-form ownership
does not authorize inventing that form's `pr` for a tourist phrase.

Keep the work scoped to the selected learning distinction. An unrelated
dictionary sense, defective unused row, or missing incidental example word
does not block authoring and teaching a sound original construction. Gloss
or replace incidental support when appropriate; preserve the intended
construction rather than choosing a worse one solely because it matches the
first source entry. Record any unresolved reading needed for an actual
compact lexical or phrase record separately. This separation permits useful
original teaching work without misrepresenting its factual provenance.

## Variants that do not become separate requirements

These remain forms or contextual choices within the named distinction:

- Masculine, feminine, neuter, and plural agreement in the same frame.
- The persons of a conjugation and regular/verified irregular case forms.
- Orthographic or stress variants of the same reviewed lexical identity.
- The placement of `бы` within an otherwise equivalent conditional.
- Optional `то` in a real conditional where the intended relation is unchanged.
- Active or explicit-clause paraphrases used to explain a passive,
  participial, nominalized, or elliptical construction.

Some contrasts are separate items because they change meaning or task
demands: direction versus habit, activity versus result under negation,
permission versus ability, attributive relative case versus antecedent
agreement, or literal content versus implied stance. Count those learning
distinctions, not generated inflection permutations.

## Tourist and branch independence

Core placement is the first introduction in the core, not a restriction on
introducing the same item earlier in an independent route. The tourist route
must introduce the exact needed senses, source-approved surface forms, and
construction dependencies by the unit that uses them. Its first five units
must close independently without assuming a later unit or completed core
level. A source reading for a dictionary lemma does not license an
unverified accusative, imperative, or other surface.

Professional and technical construction prerequisites stop at core level 18;
scientific and literary prerequisites stop at level 24. No branch depends
on another branch or on an undeclared advanced particle merely because it
appears in an illustrative sentence. Gloss incidental support. The
professional target is productive task use; the other default branch targets
are contextual understanding.

## Review gaps and limits

The inventory deliberately does not enumerate every plural exception, every
numeral declension, dates and fractions in all cases, stress alternations,
irregular comparative, lexical government alternative, prefix meaning,
colloquial motion use, participial formation restriction, or historical
construction. Introduce additional verified forms as the selected task
requires and report missing task coverage rather than claiming exhaustive
grammar from these 148 items.

Human review should especially check lexical sense selection, case and aspect
in context, idiomatic register, original example translations, phrase
readings, and the actual cumulative prerequisite load. An automated
well-formedness or graph check cannot certify any of those linguistic
judgments. Typed exercises also cannot assess actual stress, reduction,
intonation, listening, or handwriting.

The pinned OpenRussian TSV data contain documented ambiguous or dirty
entries, including `есть`, `знать`, `атлас`, `все`/`всё`, stress homographs,
and `е`/`ё` conflicts. Consult [source notices](../sources.yaml); factual
readings remain traceable source assertions, not a guarantee of correctness.
No grammar inventory, checkpoint, or stage here implies CEFR/TORFL
equivalence, examination readiness, or a calibrated proficiency score.
