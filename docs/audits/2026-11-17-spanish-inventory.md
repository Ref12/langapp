# Spanish inventory, 2026-11-17

Data and findings only. No app code, no `src/`, `public/`, `package.json`, `.github/` or existing curriculum was touched. Everything is in `curriculum/spanish/cefr/`, plus `scripts/check_spanish_cefr_curriculum.py` and its test.

Why `cefr/`: `curriculum/spanish/` already holds an earlier Spanish "practical program" (`reference/`, `upstream/`, `authoring/`, `teaching/`, `sources.yaml`). The new CEFR inventory sits beside it in its own folder so that nothing is overwritten.

## 1. What exists, and the recommendation

I read the structure of the existing machinery, not every file.

- `practical_program_registry.py` registers six languages. `spanish` is already registered (`spanish_program_adapter`), next to French, Russian, Chinese, Japanese and Korean. There are also `generate_spanish_program.py`, `import_spanish_curriculum.py`, `spanish_sources.py`, `spanish_tourist.py` and tests. The brief names French and Russian; Spanish has its own practical program too, which I did not audit in detail.
- A practical program has phases, levels and modules with a tourist route. The registry forces new adapters to a "phase-nested, realizations, identity-aware" profile. French says in its README that it makes no CEFR claim.
- The app does not load any of it. It loads the Chinese catalog (`src/data/v2/modules.generated.json`) and the Japanese/Korean packs (`generate-pack-ja.mjs` into `src/data/packs/ja`, with `modules.generated.json`, forms and groups). `src/core/study/modules.ts` is the shape the app expects: units numbered 1..N per band, modules as `from..to` ranges of 8-12 units (last 5-12), unique titles, banned generic titles.

What the practical machinery could give Spanish:
- the sources discipline (a lock file with hashes, licence recorded per source);
- the generator pattern with one adapter per language;
- the checks style (identity-aware inventories, placement checks).

What does not fit:
- **CEFR.** Its levels are phases built from a frequency program, not A1-C2.
- **The app's shape.** It does not produce band, unit or module ranges for `modules.ts`.
- **Phrases.** It is built around validated "realizations" (sentences), which is a later session for us.
- **Glosses.** French uses Wiktionary/Lexique sources. I did not check what licence the existing Spanish reference glosses carry, and the owner wants original glosses.

**Recommendation: use a pack generator in the style of `generate-pack-ja.mjs` and `pack-shared.mjs`, fed by this `cefr/` data. Do not push it through the practical-program adapter.** The pack path is what the app already loads (units, modules, forms, shared label and gap checks). From the practical machinery, borrow only the source lock and the hash discipline. The generator is not built.

## 2. Counts per level

| Level | Words (senses) | Grammar | Functions | Verbs |
|---|---|---|---|---|
| A1 | 745 | 47 | 21 | 113 |
| A2 | 907 | 35 | 17 | 218 |
| B1 | 1,459 | 34 | 14 | 287 |
| B2 | 1,997 | 29 | 12 | 358 |
| C1 | 2,692 | 20 | 10 | 383 |
| C2 | 2,495 | 12 | 8 | 375 |
| **Total** | **10,295** | **177** | **82** | **1,734** |

- Cumulative words: A1 745, A2 1,652, B1 3,111, B2 5,108, C1 7,800, C2 10,295. A1 is slightly above the ~700 target, A2 above ~1,500, and B2 is at the top of 4,000-5,000.
- Second senses are 314 of the records; an A1 or A2 word with a second common sense places it at the next level.
- Basis of placement: no `pcic` at all. A1: 307 frequency, 438 judgement; A2: 305 and 602; B1: 714 and 745; B2: 1,270 and 727; C1: 1,487 and 1,205; C2: 929 and 1,566.
- Region notes (Spain word) on 265 records.
- C1-C2 are filled to the size target, but from frequency plus a model judgement, so they are the weakest part. They need a human pass (see section 8).

Verbs by class (a verb can have several; counts are over all 1,734):

| Class | All levels | Of which A1 |
|---|---|---|
| regular-ar | 1,058 | 53 |
| regular-er | 48 | 6 |
| regular-ir | 80 | 2 |
| stem-e-ie | 87 | 12 |
| stem-o-ue | 67 | 10 |
| stem-e-i | 33 | 5 |
| stem-u-ue | 1 (jugar) | 1 |
| spell-c-qu | 91 | 2 |
| spell-g-gu | 63 | 3 |
| spell-z-c | 86 | 3 |
| spell-g-j | 18 | 0 |
| spell-i-y | 31 | 2 |
| irregular-yo | 89 | 11 |
| irregular-preterite | 46 | 9 |
| irregular-participle | 46 | 9 |
| fully-irregular | 17 | 7 |

Regular verbs carry one `regular-*` class; an irregular verb carries only its irregularity classes and the group (`conj`) names its ending.

## 3. A1 modules (17 modules, 163 units, 792 items)

| # | Title | Units | Items |
|---|---|---|---|
| 1 | Greet and say goodbye | 12 | 63 |
| 2 | Say where you are from | 10 | 49 |
| 3 | Count and say your age | 12 | 59 |
| 4 | Talk about your family | 10 | 48 |
| 5 | Describe people and things | 8 | 37 |
| 6 | Say where things are | 12 | 58 |
| 7 | Talk about days and weather | 12 | 63 |
| 8 | Describe your daily routine | 8 | 41 |
| 9 | Name foods and drinks | 8 | 42 |
| 10 | Order at a restaurant | 11 | 53 |
| 11 | Talk about likes and hobbies | 8 | 36 |
| 12 | Name places in town | 8 | 37 |
| 13 | Ask for directions | 8 | 32 |
| 14 | Shop for clothes | 8 | 37 |
| 15 | Talk about work and school | 8 | 42 |
| 16 | Describe your body and health | 11 | 54 |
| 17 | Make plans and chat | 8 | 41 |

- Units hold 4-5 words and grammar items together. Grammar is spread through each module's unit stream, and a verb's forms only follow the grammar that teaches its present tense and class (`taught_after` in `verbs.yaml`; the check enforces it). *Ser*, *estar*, *tener* and *ir* come in modules 1-6, regular present before stem changers, and irregular *yo* verbs after the irregular-yo unit.
- Weak spot: module 1 holds a long run of function words and the first words follow frequency, so the very first units are not yet a natural lesson. Unit contents inside modules are ordered by topic then frequency, not by pedagogy; a teaching pass should reorder them.
- Modules 3 (numbers) and 7 (days, months, weather) are the largest word groups.

## 4. Forms the app will need: person × tense × mood

Today's flat list (`src/data/packs/ja/forms.generated.json`, 38 entries) has `id`, `name`, `ending`, `kinds`, `joined`, `patterns` per form, with no person, number or gender, and `src/core/forms/` addresses a form by class and form id only. Spanish needs:

| Mood / tense | Level | Cells per verb |
|---|---|---|
| Present indicative | A1 | 6 persons |
| Near future (ir a), present progressive (estar + gerund) | A1 | periphrases built on the present of ir/estar |
| Preterite | A2 | 6 |
| Imperfect | A2 | 6 |
| Present perfect | A2 | 6 (haber present + participle) |
| Simple future | A2 | 6 |
| Imperative affirmative | A2 | tú, usted, ustedes (3) |
| Conditional | B1 | 6 |
| Present subjunctive | B1 | 6 |
| Imperative negative | B1 | tú, usted, ustedes (3), from the present subjunctive |
| Past perfect, past progressive | B1 | 6 each |
| Imperfect subjunctive | B2 | 6 |
| Present perfect and pluperfect subjunctive | B2 | 6 each |
| Conditional perfect, future perfect | B2 | 6 each |
| Preterite anterior, future subjunctive, voseo | C2 | recognition only |
| Infinitive, gerund, participle | A1 / A2 | 1, 1, 4 (participle agrees: -o -a -os -as) |

- Persons: yo, tú, él/ella/usted, nosotros, ustedes, ellos. Six taught cells with the third persons merged as the brief specifies. *Vosotros* is a seventh cell, `taught: false`, for recognition only.
- Roughly 17 finite tenses × 6 persons ≈ 100 cells per full verb, against 38 flat ids in the Japanese list. Nouns and adjectives need gender × number (4 cells), and adjectives need agreement.
- **The gap:** the flat list cannot express a cell, so the forms data needs a person × number key (and gender for participles and adjectives), the class-to-rule mapping needs `stem`, `spell` and irregular overrides per cell, and grammar-point gating per tense is needed (the Japanese `grammarOf` idea, but per tense, not per form).
- Not done here: full tables. `tenses.yaml` lists tenses with level and learner name; `verbs.yaml` lists classes.

## 5. Grammar items marked `concept: true`

- A1: noun-gender, tu-usted, ser-present, estar-present, gustar, reflexive-present
- A2: preterite-vs-imperfect-intro, direct-object-pronouns, saber-conocer, por-para
- B1: present-subjunctive-forms, subjunctive-wishes, preterite-vs-imperfect
- B2: imperfect-subjunctive, si-clauses-contrary

15 items; each has its one-sentence reason in `levels/<level>/grammar.yaml`.

## 6. Latin American and Spain usage that matters at A1-A2

Recorded as a `region_note` on the Latin American word (the Spain word is the note). Notable pairs:
- carro (Spain coche), computadora (ordenador), celular (móvil), jugo (zumo), papa (patata), mesero (camarero), boleto (billete), camión (autobús), recámara (dormitorio), refrigerador (nevera), estufa (cocina), frijol (judía), playera (camiseta), chamarra (chaqueta), tenis (zapatillas), suéter (jersey), manejar (conducir), regresar (volver), pastel (tarta), departamento (piso).
- Grammar: *ustedes* (not *vosotros*) as "you all"; the preterite is preferred over the present perfect in Mexico for recent past; *coger* is vulgar in Mexico (Spain: to take), *agarrar* is used instead; diminutives (*ahorita*) are very common.
- Some Spain notes are not clean, because I did not re-check them: ustedes is annotated "Spain: vosotros (informal)", *tomate* has "Mex: jitomate", and *gripe* has a note that equals the word. These need a manual review.

## 7. Sources

See `curriculum/spanish/cefr/sources.yaml`.
- Kaikki.org Wiktionary extract (CC BY-SA 4.0 / GFDL): lemma list, part of speech, form-of links and head-line hints only. No senses or examples were copied.
- FrequencyWords es_50k, OpenSubtitles 2018 (CC BY-SA 4.0, to be confirmed): order and coverage.
- **Plan Curricular (Instituto Cervantes): not obtained.** No page was retrieved, so nothing has basis `pcic`; every placement is `frequency` or `judgement` and is marked so. Levels are the author's, not the Cervantes inventory's.
- Glosses and levels were written by a model (Claude Sonnet 5.5, via the hexad gateway), not copied from any dictionary.

## 8. Not done, and open questions

Not done:
- Placement against the Plan Curricular (no access); no review of glosses, genders or classes by a person.
- C1 and C2 are only a frequency-plus-judgement fill. Words from film subtitles that are low value for a course remain at B1-C2; so do some odd lemmas.
- Unit content order inside an A1 module is topic-then-frequency, not a taught order.
- Grammar items are named and explained in one line; no forms tables, no sentences, no concept write-ups.
- No generator, no app wiring, no forms data.

Open questions for the owner:
1. Is the Plan Curricular allowed as a reference we can fetch or be given as a file? Without it the "pcic" placements stay empty.
2. Is it right to put the CEFR inventory beside the existing Spanish practical program (`curriculum/spanish/`), or should the older Spanish program be retired?
3. Confirm "pack generator, not the practical-program adapter".
4. Voseo: recognition only at C2, or taught for some regions? Same question for *vosotros* beyond recognition.
5. Is 745 words at A1 acceptable (target ~700), or should the list be cut back?
6. Who reviews the glosses (including the ones for mexicanismos) and the Spain notes before licensing is decided?
7. Do we keep all subtitle-derived vocabulary (slang, crime words) at B1+ or filter by register?
8. Tense naming for learners: is "Past, finished / Past, ongoing" the wanted wording?
