# Japanese for a short visit

Use [plan.yaml](plan.yaml) in order. There is **no required core level or kana
course**. A learner can begin by pointing to the written phrase and meaning.
For speech or listening practice, use a reliable human or audio model; the kana
readings do not supply pitch accent or assess pronunciation.

## Self-contained quick start

The first five modules form an ordered prefix:

1. Polite contact and repair.
2. Food and water.
3. Finding a destination.
4. Payment and quantities.
5. Asking for help.

Each introduces its actual phrase words, constructions, and construction
prerequisites. Verbs that merely illustrate a core paradigm are not prerequisite
vocabulary here. The te-form and polite-negative scaffolds are taught locally,
not hidden in another course. The remaining modules extend transport, accommodation, shops,
dietary clarification, health assistance, changed arrangements, and courtesy.

## Practice without overclaiming

- Choose a small useful set rather than memorize the whole route at once.
- First recognize the situation; then change a destination, quantity, time,
  or item with explicit help. A memorized phrase is not proof that its components
  can be used independently.
- Retrieve the listed earlier items and anything fragile after a delay.
  Adjust the suggested intervals to observed performance.
- Keep reading, listening, spoken production, and typed production separate.
  This route does not test handwriting.

The phrases are original authored learning examples, not copied phrasebook
entries. Every phrase is segmented into exact canonical words, bounded
construction chunks, or an inflected **single lexeme**. No sentence-sized
whitelist or zero-word “fixed sentence” substitutes for component coverage.
Canonical segments use verified full-word spelling and reading; their
pronunciation is not inferred from individual kanji. Noncanonical segments
reference reusable entries in
[`forms.yaml`](../../authoring/teaching/forms.yaml). The expanded generated view
preserves this mapping; the compact view remains suitable for practice.

For example, `水をお願いします` is `水` + `を` + `お願いします`;
`ゆっくり話してください` is `ゆっくり` + the single-verb request
`話してください`; and `また会いましょう` is `また` + `会いましょう`.
Each declared inflection retains one lexical sense and genuine construction
licenses. The three `あります` annotations distinguish existence, possession,
and location senses; similarly, nominal and i-adjective `です` have distinct
licenses despite identical surface forms.

`部屋は静かですか` uses the nominal copular predicate (`ja-n5-g001`).
It does not claim noun-modification credit for `ja-n5-g021`; that construction
would require a form such as `静かな部屋`.

`入っています` uses `ja-n5-00487-s003` with **ja-n4-g042 resulting state**.
The ongoing-action construction is a locally introduced prerequisite, not the
asserted meaning of this ingredient-inclusion phrase. `変えたいです` separates
the desiderative word `変えたい` from polite i-adjectival `です`.

The courtesy formulas need no exceptional sentence rule:
`ありがとうございます` uses canonical `ありがとう` (`ja-n3-00043-s001`)
and canonical `ございます` (`ja-n1-01142-s001`);
`ごちそうさまでした` uses canonical `ごちそうさま` (`ja-n2-00555-s001`)
and the bounded past-copula `でした` (`ja-n5-g022`). This conventional meal
closing does not imply that every interjection freely takes the past copula.

The repair phrase is written `わかりません` and the symptom phrase
`お腹が痛いです`, matching the already-selected canonical spellings without
altering core entries. All 38 communicative meanings are retained.

## Raw-sense audit

Every phrase's lexical components were compared with the actual retained raw
JMdict glosses, usage information, readings, and restrictions—not just the
parent spelling, a short English label, or a compatible verb class. This
identified the following precise tourist selections:

| Phrase | Selected sense | Raw meaning and decision |
|---|---|---|
| p007, p027 | `ja-n5-00467-s002` | Meat as food; raw sense 1 is flesh. |
| p010 | `ja-n5-00039-s003` | Be located; distinguish location from existence in p031 and possession in p021. |
| p019 | `ja-n5-00133-s002` | Alight, get off, disembark; raw sense 1 is descend. Raw usage information especially associates sense 2 with the verified spelling `降りる`. |
| p032 | `ja-n5-00652-s002` | Summon a doctor; raw sense 1 is calling out. |
| p035 | `ja-n5-00385-s002` | For a moment, briefly; not raw sense 1's degree or quantity. |

These distinctions also occur explicitly in the core: food meat at level 1,
location at level 2, alighting and brief duration at level 4, and summoning
at level 6. The tourist route still teaches them locally, without requiring
those levels. The location sense uses verified common kana `ある`; no
alternate reading or unattested spelling is inferred.

The audit also confirmed `ja-n5-00050-s001` as the price question “how much”
(JMdict 1219980, `幾ら／いくら`), not salmon roe; `ja-n5-00463-s001` as “what”
with its own mapped `何／なん` reading (JMdict 2846738); and
`ja-n3-00170-s001` as yen, not a circle. Payment uses
`ja-n3-00234-s004` (credit/debit card), and inclusion uses
`ja-n5-00487-s003`, not physical entry. `魚／さかな` has a single raw fish
sense in its retained entry, so no separate food sense was invented.

This internal source-sense audit does not replace native-speaker or pedagogy
review of the original phrases.

## Exact atomic form registry

Form names below have prefix `ja-form-`. Construction shorthand `5:004` means
`ja-n5-g004`; `4:042` and `2:042` mean `ja-n4-g042` and `ja-n2-g042`.
An em dash means an empty lexical-items list, not an unknown word.
Every row credits `original-ja-practical`; exact notes and fully expanded IDs
are in the linked YAML registry.

| Form name | Surface | Kana | Lexical sense | Constructions |
|---|---|---|---|---|
| wa-topic | は | わ | — | 5:004 |
| ga-subject | が | が | — | 5:005 |
| o-object | を | お | — | 5:006 |
| no-modifier | の | の | — | 5:007 |
| ni-existence | に | に | — | 5:010 |
| ni-destination | に | に | — | 5:012 |
| de-location | で | で | — | 5:009 |
| de-means | で | で | — | 5:013 |
| desu-copula | です | です | — | 5:001 |
| desu-adjective | です | です | — | 5:020 |
| ka-question | か | か | — | 5:003 |
| nuki-de | 抜きで | ぬきで | — | 2:042 |
| deshita-copula | でした | でした | — | 5:022 |
| wakarimasen | わかりません | わかりません | ja-n5-00676-s001 | 5:023, 5:024 |
| hanashite-kudasai | 話してください | はなしてください | ja-n5-00507-s001 | 5:041, 5:026 |
| tabemasen | 食べません | たべません | ja-n5-00369-s001 | 5:023, 5:024 |
| arimasu-existence | あります | あります | ja-n5-00039-s001 | 5:010, 5:023 |
| arimasu-possession | あります | あります | ja-n5-00039-s002 | 5:010, 5:023 |
| arimasu-location | あります | あります | ja-n5-00039-s003 | 5:010, 5:023 |
| tetsudatte-kudasai | 手伝ってください | てつだってください | ja-n4-00419-s001 | 5:041, 5:026 |
| ikimasu | 行きます | いきます | ja-n5-00048-s001 | 5:023 |
| orimasu | 降ります | おります | ja-n5-00133-s002 | 5:023 |
| kakimasu | 書きます | かきます | ja-n5-00148-s001 | 5:023 |
| misete-kudasai | 見せてください | みせてください | ja-n5-00602-s001 | 5:041, 5:026 |
| haitteimasu-state | 入っています | はいっています | ja-n5-00487-s003 | 5:041, 4:042 |
| yonde-kudasai | 呼んでください | よんでください | ja-n5-00652-s002 | 5:041, 5:026 |
| kaetai | 変えたい | かえたい | ja-n4-00117-s001 | 5:023, 5:031 |
| kimasu | 来ます | きます | ja-n5-00217-s001 | 5:023 |
| matte-kudasai | 待ってください | まってください | ja-n5-00589-s001 | 5:041, 5:026 |
| aimashou | 会いましょう | あいましょう | ja-n5-00001-s001 | 5:023, 5:034 |

For an intentional tourist-only authoring rebuild from the repository root, use
`python -B scripts\build_japanese_teaching_data.py --tourist-only`. It leaves core
placements, beginner modules, grammar coverage, and generated views untouched.

Particle **は／へ／を** is pronounced **わ／え／お** when used in the
corresponding construction. A word's reading is not guessed from its kanji.
The “yen” and “attention/apology” senses are used even though their preserved
reference labels are N3. The misleading mapped interjections **これ／それ**
are not used as demonstratives; the valid mapped pronoun entries are used instead.

These are communication aids, **not guarantees** of payment acceptance,
accessible transport, dietary or allergy safety, available medication, current
emergency procedures, or legal/medical accuracy. Check arrangements with an
appropriate person and seek qualified human help for health or safety concerns.
Japanese-language pedagogy and native-speaker review of the original content
remain pending.
