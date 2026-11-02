# Adding languages: lemmas, forms, rules and multi-word items

Status: design only, no app code changed. Base: `langapp/main-for-rebase` @ 4e8907f. Author's hypothesis is tested in §3–§5.

## 0. Conclusions in short

1. The hypothesis holds, with one correction: the gap is not only "slots carry features". Three things are missing and they are separable: **(a)** a *lexeme → forms* layer, **(b)** *rules/paradigms over features*, **(c)** *multi-word / discontinuous items*. Per-word facts (gender, measure word, government) are just typed fields on the lexeme.
2. The central design choice is **what a knowledge unit is**. Recommendation: the unit stays the existing `ref` (`vocabulary:<lb>`, `grammar:<lb>`); a lexeme is a `vocabulary:` ref, a *paradigm rule* and a *multi-word construction* are `grammar:` refs. **Forms are not units**; a form is "known" when its lexeme, its rule and (if irregular) its irregular-form item are all known. Irregulars become small `vocabulary:` items of their own (`vocabulary:es-ir--fue`).
3. Cards (FSRS) stay per ref. We add one optional dimension: practice of a *form* is credited to lexeme + rule (+ irregular item) rather than to a new card. No schema break for Chinese.
4. The "only known words" check generalises from "Han run is a concatenation of known strings" to "every token of the sentence analyses to a lexeme+features that are all known". Segmentation becomes a per-language **analyser** behind an interface; Chinese keeps today's greedy longest-match.
5. Off-the-shelf analysers (spaCy/Stanza) cannot run in the browser app cheaply; for Spanish a **generated form table** (lemma × features → surface, built offline) gives exact, offline, deterministic analysis for the closed vocabulary we teach. AI tagging stays batched and is only for free text (media, user phrases).
6. Smallest proof step: Spanish *present tense of 10 verbs + 10 nouns*, with a new "conjugate" exercise type, behind a language switch. About 3 PRs.
7. Chinese-only today and needing a per-language switch: pinyin/tones, Han script regexes in schemas, stroke writing, character dictionary, `FUNCTION_CHARACTERS`, `token_form`-style labels with tone numbers, `zh/py` field names in drill/conversation JSON.

## 1. The model today (read from the code)

| Layer | Where | What it is |
|---|---|---|
| Authoring source | `curriculum/chinese/hsk-N/{vocabulary,grammar}.yaml`, `authoring/` | Vocabulary: `id, target, reading, english, part_of_speech, topic, senses[]`. Grammar: `id, pattern ("S + 很 + adjective"), english, note, examples[{target, english}], token_form ("S+很+Adj"), disambiguator`. |
| Generated catalog | `src/data/v2/hsk-N.generated.json`, loaded lazily by `study/catalog.ts` | `VocabularyRecord{id, ch, pr, ds, lb}`, `GrammarRecord{id, pt, pr, ds, lb, ex}`, `StudyGroup{units[], examples[]}`. Authored examples are *sequences of vocabulary labels* (`segments:[{word:lb}|{punctuation}]`); `renderExample` joins `ch` with no spaces and `pr` with spaces. |
| Identity | `study/contracts.ts` | A unit is `ref = kind:lb`, kind ∈ vocabulary, grammar, plus `phrase:` (collection free phrases) and `source:` (media entries) which have no curriculum record. `lb` is a slug that currently embeds numbered pinyin (`ba4-ba5--dad`). |
| Knowledge set | `knowledge.ts`, `db.knowledge` | `KnowledgeEntry{ref, kind, lb, band, addedAt, source}`. Membership = "known". Groups (`nextGroup`) feed lessons; band is 1–6 (HSK). |
| Cards | `StudyCard{id = ref:domain, due, stability, difficulty, state…}` | FSRS (`fsrs.ts`), one card per ref, a single domain `reading`. |
| Skills | `skill-map.ts`, `skills.ts`, `db.skillPractice` | Counter per (ref, skill) with skills reading/listening/speaking/writing; used to rank "least practised / recent" for drills. Not FSRS. |
| Exercises | `exercises.ts` | AI writes *choice* and *tiles* exercises from the prompt; code builds *match* (zh-en, zh-py, py-en). `validateProposal` rejects anything whose Han text is not covered by `createSegmenter(allowed forms)`. Generation is batched (`generateBatched`, `splitCount`). |
| "Only known words" | `createSegmenter(forms)` | `covers(text)`: every Han run is a concatenation (DP over lengths ≤ longest form) of allowed strings; `segment(text)`: greedy longest match. Allowed = known vocabulary `ch` + phrase forms + `FUNCTION_CHARACTERS` ("的了吗呢吧是不…") + each character of the drill's own items. Also used in `drills/content.ts`, `local-exercises.ts`, sudoku phrases. |
| AI content | `drills/content.ts` | Catalog example first; AI fills gaps in batches of 15 items per request plus one conversation request per set; output validated against the segmenter. |
| Chinese-specific | see §7 | pinyin, tones, Han regexes in zod schemas (`chineseTile` must contain Han; `englishText` must not), stroke writing/handwriting recognition (`core/characters`), character dictionary, media readings/compounds, speech assessment. |

Properties worth preserving: units are *closed, curated and reviewable*; the knowledge set is a set of refs; a lesson's text is checkable by code, not by trusting the AI; AI calls are batched.

Why Chinese fits: a word has exactly one surface form, so *vocabulary item = surface string = segmentation token = knowledge unit = card*. Grammar is a slot pattern over word classes (`S + 很 + Adj`). Every one of those equalities breaks in Spanish.

## 2. Proposed core change

Three new record kinds, all in the existing `ref` namespace, plus typed fields. Language is a prefix of the label (`es-…`) and a `lang` field on the catalog; refs stay globally unique so one knowledge table serves every language.

### 2.1 Lexeme (`vocabulary:`)

```yaml
# curriculum/spanish/a1/vocabulary.yaml
- id: es-a1-0007
  lb: es-hablar--speak            # ref = vocabulary:es-hablar--speak
  lemma: hablar
  pos: verb
  gloss: to speak, talk
  features: { conj: ar }          # selects paradigm es.verb.ar
  paradigm: es.verb.ar            # rule set (see 2.2)
  irregular: []                   # none -> all forms regular
  government: { prep: [con, de, sobre] }   # per-word fact
- id: es-a1-0012
  lb: es-ir--go
  lemma: ir
  pos: verb
  gloss: to go
  paradigm: es.verb.suppletive    # no regular rule applies
  irregular:                      # each is its own small item (2.3)
    - { form: voy,  features: [pres, 1sg] }
    - { form: vas,  features: [pres, 2sg] }
    - { form: va,   features: [pres, 3sg] }
    - { form: fui,  features: [pret, 1sg] }
    - { form: iba,  features: [impf, 1sg] }
- id: es-a1-0031
  lb: es-casa--house
  lemma: casa
  pos: noun
  gloss: house
  features: { gender: f }         # learned WITH the word
  paradigm: es.noun.s             # plural +s / +es
- id: es-a1-0044
  lb: es-rojo--red
  lemma: rojo
  pos: adj
  gloss: red
  paradigm: es.adj.4              # rojo/roja/rojos/rojas
```

Chinese stays as is. A Chinese noun gains an optional `features: { classifier: [个, 本] }` (see §6).

### 2.2 Paradigm (rule over features) (`grammar:`)

A paradigm *group* is what a learner studies ("-ar present"); it is a grammar unit.

```yaml
# curriculum/spanish/a1/grammar.yaml
- id: es-a1-g001
  lb: es-pres-ar
  kind: paradigm
  title: Present tense, -ar verbs
  applies: { pos: verb, conj: ar }
  produces: { tense: pres }
  rule:                                  # stem = lemma minus "ar"
    1sg: "{stem}o"   2sg: "{stem}as"  3sg: "{stem}a"
    1pl: "{stem}amos" 2pl: "{stem}áis" 3pl: "{stem}an"
  note: Same endings for every regular -ar verb; stem-changers are irregular items.
  examples:
    - { es: "Yo hablo español.", en: "I speak Spanish." }
- id: es-a1-g003
  lb: es-pret-regular
  kind: paradigm
  title: Preterite, regular -ar / -er/-ir
  applies: { pos: verb, conj: [ar, er, ir] }
  produces: { tense: pret }
  rule:
    ar: { 1sg: "{stem}é", 2sg: "{stem}aste", 3sg: "{stem}ó", 1pl: "{stem}amos", 3pl: "{stem}aron" }
    er/ir: { 1sg: "{stem}í", 2sg: "{stem}iste", 3sg: "{stem}ió", 1pl: "{stem}imos", 3pl: "{stem}ieron" }
```

The rule table is data, so the form generator, the "conjugate" exercise and the checker all read the same source.

### 2.3 Irregular form (`vocabulary:`, derived)

Each irregular entry in 2.1 is also materialised as a tiny item so it can be learned, reviewed and marked known separately:

```json
{ "lb": "es-ir--fue", "ref": "vocabulary:es-ir--fue", "kind": "form",
  "lexeme": "vocabulary:es-ir--go", "form": "fue", "features": ["pret","3sg"],
  "overrides": "grammar:es-pret-regular" }
```

Why items: "knowing lemma + rule = knowing the form" is true *only* when the rule applies. An irregular form needs its own memory; the override relationship tells the checker "ir + pret rule is **not** enough for *fue*; require `vocabulary:es-ir--fue`". One hard-to-forget rule: a form that is irregular gets a card; a regular form never gets one.

### 2.4 Construction (`grammar:`): templates with features in slots

```yaml
- id: es-a1-g007
  lb: es-ir-a-inf
  kind: construction
  title: Near future, ir a + infinitive
  template: "<subj?> <ir:pres/agree> a <verb:inf>"
  slots:
    ir:   { lexeme: vocabulary:es-ir--go, features: [pres, agree-subj] }
    verb: { pos: verb, features: [inf] }
  examples:
    - { es: "Voy a comer.", en: "I'm going to eat.", analysis: [ir:1sg, a, comer:inf] }
- id: es-a1-g008
  lb: es-reflexive
  kind: construction
  title: Reflexive verbs
  template: "<refl:agree-subj> <verb:agree-subj>"
  slots:
    refl: { closed: [me, te, se, nos, os, se] }
    verb: { pos: verb, lexeme-flag: reflexive }
  note: Pronoun sits before the finite verb, may attach to an infinitive (quiero lavarme).
```

Existing Chinese patterns are the degenerate case: slots with `pos` only and no `features`. `token_form` ("S+很+Adj") already is a template string; the new part is the `:feature` annotation and `agree` links between slots.

### 2.5 Multi-word items

```yaml
- id: es-a1-x001
  lb: es-tener-que
  kind: phrasal            # fixed-ish: lemma tener + que + inf
  template: "<tener:agree-subj> que <verb:inf>"
  gloss: have to (obligation)
  gap: [subj]
- id: en-x-give-up
  lb: en-give-up
  kind: phrasal
  template: "give <obj> up | give up <obj>"   # discontinuous
  forms: { give: [give, gives, gave, given, giving] }
  gloss: stop trying; surrender
  separable: true
```

Idioms with no open slot are just `phrase`-like fixed strings with a lemma-level analysis (`es: "dar igual"` = to not matter, `dar` still inflects: *me da igual*, *les daba igual*).

## 3. Spanish on paper

### 3.1 About 50 words

| Group | Items (lexeme lb → notes) |
|---|---|
| Regular -ar verbs (6) | hablar, trabajar, estudiar, comprar, necesitar, caminar |
| Regular -er/-ir verbs (6) | comer, beber, leer, vivir, escribir, abrir |
| Irregular verbs (10) | ser, estar, ir, tener, hacer, querer, poder, decir, ver, dar (each carries 3–6 irregular items; *poder/querer* stem change, *tener/hacer/decir* 1sg *-go/hago/digo*) |
| Reflexive (3) | llamarse, levantarse, lavarse (flag `reflexive`) |
| Nouns (14) | casa(f), libro(m), mesa(f), agua(f, takes *el*), amigo/amiga(m/f pair), día(m, irregular gender), mano(f, irregular), problema(m), ciudad(f), comida(f), trabajo(m), tiempo(m), persona(f), hombre(m) |
| Adjectives (8) | rojo (4 forms), grande (2 forms), bueno (apocope *buen*), inteligente, fácil, nuevo, español (4 forms, *-ol*), feliz (plural *felices*) |
| Closed class (3+) | el/la/los/las, un/una, mi/mis (article/possessive forms are tiny paradigms of their own: `paradigm: es.det.art`) |

Each `gender` is a field on the lexeme (§2.1), asked at learning time (`el/la ___ casa`), not a separate unit.

### 3.2 About 10 grammar points

| # | lb | kind | One-line content |
|---|---|---|---|
| 1 | es-pres-ar | paradigm | -o -as -a -amos -áis -an |
| 2 | es-pres-er-ir | paradigm | -o -es -e -emos -éis -en; -imos/-ís for -ir |
| 3 | es-pret-regular | paradigm | see §2.2 |
| 4 | es-ser-estar | construction + contrast | ser: identity/origin/time; estar: location/state; both `suppletive`, forms are irregular items |
| 5 | es-gender-agree | agreement | art + noun + adj share gender; adj ends `-o/-a` |
| 6 | es-number-agree | agreement | +s/+es on all three |
| 7 | es-reflexive | construction | §2.4 |
| 8 | es-ir-a-inf | construction | §2.4 |
| 9 | es-tener-que | phrasal | §2.5 |
| 10 | es-dar-igual | phrasal/idiom | indirect-object pronoun + dar + igual (*me da igual*) |

### 3.3 How a sentence is analysed

"Mis amigas se levantan temprano." →

```json
{ "text": "Mis amigas se levantan temprano.",
  "tokens": [
    { "s": "Mis",      "lex": "vocabulary:es-mi--my",        "f": ["pl","poss"],       "needs": ["vocabulary:es-mi--my"] },
    { "s": "amigas",   "lex": "vocabulary:es-amigo--friend", "f": ["f","pl"],          "needs": ["vocabulary:es-amigo--friend","grammar:es-number-agree","grammar:es-gender-agree"] },
    { "s": "se",       "lex": "grammar:es-reflexive",        "f": ["3pl"],             "needs": ["grammar:es-reflexive"] },
    { "s": "levantan", "lex": "vocabulary:es-levantarse--get-up", "f": ["pres","3pl"], "needs": ["vocabulary:es-levantarse--get-up","grammar:es-pres-ar"] },
    { "s": "temprano", "lex": "vocabulary:es-temprano--early", "f": [],               "needs": ["vocabulary:es-temprano--early"] } ],
  "constructions": ["grammar:es-reflexive"] }
```

`needs` = the *knowledge units that must be in the knowledge set* for the sentence to be "known". A form of an *irregular* verb adds that form's item; a *regular* form adds the lexeme and the rule only. The union over tokens is the sentence's requirement set; "only known words" = requirement set ⊆ knowledge set.

### 3.4 English tenses in the same notation

```yaml
- lb: en-pres-perfect         # kind: construction
  template: "<subj> <have:pres/agree> <verb:pp>"      # I have gone / she has gone
- lb: en-pres-continuous
  template: "<subj> <be:pres/agree> <verb:ing>"       # they are going
- lb: en-future-will
  template: "<subj> will <verb:inf>"                  # we will go
- lb: en-past-simple          # kind: paradigm
  rule: { regular: "{lemma}ed" }; irregulars: go→went, see→saw, have→had   # irregulars are items: vocabulary:en-go--went
- lb: en-give-up              # kind: phrasal, discontinuous (see §2.5)
```

Same machinery, no new concept: *go/goes/went/gone/going* are the forms of one lexeme; *went* and *gone* are irregular items; *have gone* teaches `en-pres-perfect` + the form *gone*.

## 4. Gap by gap

| Gap | Handled? | Cost | What breaks |
|---|---|---|---|
| 1 One word, many forms | Yes: lexeme + features; forms generated from lexeme + paradigm | A form generator (pure function over rule tables; ~200 lines + data). One catalog field. | `createSegmenter` (strings only) and all code assuming `record.ch` *is* the text. |
| 2 Rules over features | Yes: paradigm = `grammar:` unit with data rules; irregular forms are items (§2.3) | Authoring effort grows with irregulars (about 10 per core verb in Spanish) | "Known" can no longer be a flat ref lookup per token; needs the `needs` derivation. |
| 3 Per-word facts | Yes: typed `features` on the lexeme; asked as exercises ("el or la?") | Per-language feature schemas; small | Nothing structural. Chinese classifiers use the same field. |
| 4 Multi-word / discontinuous | Mostly: `phrasal` constructions with `template`; analyser must match a template, not a contiguous string | Matching needs token analysis first; AI tagging for free text is the realistic option | Contiguous-string logic (greedy longest match) cannot see `give it up`; `phrase:` refs (whole sentences) are the only multi-word unit now. |

### 4.1 Knowledge granularity: lemma vs form vs rule

| Option | Units | Pros | Cons |
|---|---|---|---|
| A. Form = unit | hablo, hablas… each a ref | trivial, "known" is a lookup | ~50 cards per verb, unbounded growth, no transfer between verbs, reviews are tedious |
| B. Lemma only | hablar | smallest, matches Chinese | cannot say *hablé* is unknown; conjugation never tracked |
| **C. Lemma + rule (+ irregular items)** | lexeme, paradigm, irregular forms | matches how learners think; regular forms cost nothing extra; irregulars tracked where memory is needed | needs the derivation of `needs` (§3.3); cards on irregular items only |

**Recommendation: C.** FSRS stays per ref (no schema change). When a conjugation exercise on *hablé* is answered, credit goes to `vocabulary:es-hablar--speak` and `grammar:es-pret-regular` (via the existing `recordSkillPractice`-style counters; FSRS review is applied to the *weaker* of the two to avoid double counting — open question Q4).

**What "known" means for a form:** all of its `needs` are in the knowledge set. Known lexeme + unknown rule ⇒ the lexeme's *citation form* is known, inflected forms are not. This also gives a natural curriculum order: `es-pres-ar` unlocks present forms of every known -ar verb at once.

### 4.2 The "only known words" check

```ts
interface Analyser { lang: string; analyse(text: string): Token[] }     // Token = { s, lex, features, needs[] }
interface KnownCheck { covers(text: string): boolean; missing(text: string): string[] }
```

- Chinese: the existing `createSegmenter` wrapped as an analyser; `needs` = the vocabulary ref of each matched string; **no behaviour change**.
- Spanish/English: look each whitespace/punctuation token up in a *form index* (surface string → [lexeme, features, needs]). It is a hash map built from the catalog at load time; ambiguity (*fue* = ser or ir) returns all candidates and "known" means *any* analysis is known (keeps the check permissive; the AI is told to avoid ambiguity if the tutor needs it).
- Discontinuous constructions are detected after token analysis by matching templates over the token list.
- Unknown tokens (names, numbers) go through the language's allowed list, replacing `FUNCTION_CHARACTERS`.

### 4.3 Segmentation and lemmatisation: three options

| Option | Fits where | Notes |
|---|---|---|
| Generated form table (offline) | **Taught vocabulary, in-app, offline** | Exact for the ~few thousand lexemes we author; trivial for Spanish/English tokenisation. Cost: paradigm data. Recommended primary. |
| spaCy / Stanza (build time or server) | Analysing media transcripts and user text; bootstrapping data | Spanish models are good; Python, tens-hundreds of MB, not usable in the browser app; run in a batch job and store results (cache by text hash). Do **not** call per line at runtime. |
| Batched AI tagging | Free text where no table covers it | One request per batch of lines returning `[{s, lemma, features}]`; validate lemma against the catalog; never per word (project rule). Slowest/costliest, needed for rare forms and multi-word spans. |

**Recommendation:** table first; spaCy/Stanza offline to *seed* paradigm data and to pre-analyse media; batched AI only as fallback, with results validated by looking up the returned lemma+features in the table.

### 4.4 Exercise types enabled

| New | Built by | Check |
|---|---|---|
| Conjugate ("yo ___ (hablar)") | code, from paradigm tables (no AI) | exact match on generated form (accept accent-insensitive as "almost") |
| Agreement ("la casa ___ (rojo)") | code from gender + paradigm | exact match |
| Gender pick (el / la casa) | code from lexeme field | choice |
| Form → features ("fue" is pret of ?) | code, irregular items | choice |
| Tiles with inflected tiles | existing tiles type, tile = surface form; `acceptedAnswers` covers pro-drop (*Hablo* / *Yo hablo*) | existing |
| Fill the construction slot | template + slots | exact |

Existing `match` modes (zh-en, zh-py, py-en) become *source text – gloss* and, for Spanish, *form – features*. `choice`/`tiles` need language-neutral names (`direction: 'zh-to-en'` → `'target-to-en'`) and a script-agnostic refine (see §7).

## 5. What breaks, by area (summary)

1. `exerciseSchema`: `chineseTile`/`englishText` use Han tests ⇒ replace with per-language validators (`lang` in the session).
2. `createSegmenter` consumers (4 call sites) ⇒ switch to the `Analyser` interface; Chinese adapter keeps behaviour.
3. `describeUnit`, `renderExample`, `allowedVocabulary` read `ch/pr`; need a per-language *display* accessor (`text`, optional `reading`).
4. Knowledge/cards: no schema change. `KnowledgeEntry.kind` gets values 'form' only if irregular items are stored under `vocabulary:` ⇒ keep them as `vocabulary:` kind, mark `form` in the catalog only.
5. Groups: Spanish groups mix lexemes + paradigm; `nextGroup` works unchanged if a group's `units` lists them.
6. Bands: `bandSchema` is '1'–'6' (HSK). Use CEFR A1–C2 mapped to 1–6, with `lang` selecting the label. Open question Q2.

## 6. Migration for Chinese

- **Zero-change path (recommended first):** add `lang: 'zh'` to catalog index and nothing else. Records, refs, knowledge, cards all remain valid. Backups (`studyBackupSchema`) are unchanged.
- **Measure words as a per-word fact:** add `features.classifier` to nouns in `curriculum/chinese/*/vocabulary.yaml` (optional, generated into `VocabularyRecord.fe`). New exercise: "三 ___ 书" (choice of 个/本/张). The measure word itself stays an ordinary vocabulary item. Chinese then uses `features` without paradigms.
- Chinese aspect particles (了, 过, 着) and 把/被 stay slot patterns; `token_form` is the existing template and can adopt `:feature` marks later.
- Label scheme: `lb` for Spanish has no tone numbers; the slug regex in `unitLabelSchema` already allows it.
- The knowledge table, `skillPractice` and drills do not need migration; `ref` is global.

## 7. Chinese-only features and the per-language switch

| Feature | Where | Switch |
|---|---|---|
| Pinyin (`pr`, `pinyin.ts`, match modes `zh-py`/`py-en`) | study, drills, media, pages | `langConfig.reading: 'pinyin' \| null`; Spanish has none (show IPA/audio only on request) |
| Tones | pinyin labels, tone drills, speech assessment | `langConfig.tones` |
| Han script regexes | `study/contracts.ts`, `drills/content.ts`, `exercises.ts` | per-language script check |
| Stroke writing, handwriting recognition, character dictionary | `core/characters`, `components/characters`, writing drills | `langConfig.writing: 'strokes' \| 'typed'`; Spanish writing = typing (accents matter) |
| `FUNCTION_CHARACTERS` | `drills/content.ts` | per-language function-word list |
| Media readings / compounds | `core/media/*` | Chinese only until analyser exists |
| `zh/py/en` fields in drill and conversation JSON | `drills/contracts.ts` | rename to `text/reading/en` with migration, or read both |
| Speech (Mandarin TTS/STT config, assessment) | `assistant/speech*` | language-tagged voices |
| Tutor prompts (`exercisePrompt`, `SYSTEM`) | `exercises.ts`, `content.ts` | per-language prompt files |

A single `LangConfig` (script, reading system, writing mode, function words, analyser, prompt pack) selected by the active course is the switch; no scattered `if (lang === …)`.

## 8. Staged plan

| Stage | Scope | Proves |
|---|---|---|
| 0 | Add `lang` to the catalog index and a `LangConfig` for zh with current behaviour; wrap `createSegmenter` as an `Analyser`. Pure refactor, tests unchanged. | Chinese unaffected |
| 1 (**smallest proof**) | Spanish present tense: 10 lexemes (6 regular -ar/-er/-ir, *ser*, *ir*, *tener*, *querer*), 10 nouns with gender, `es-pres-ar`, `es-pres-er-ir`, `es-gender-agree`. Form generator, form index, conjugate and gender exercises (code-built, no AI). | lexeme → forms, rules, irregular items as units, per-word facts, known-check on forms |
| 2 | Tiles/choice exercises for Spanish via AI with the new check; adjectives + number agreement; `ser/estar`; preterite | AI generation stays within known forms |
| 3 | Constructions: `ir a + inf`, reflexives, `tener que`; template matching | multi-word items |
| 4 | English (tenses, phrasal verbs), batched analysis of media text (spaCy offline or batched AI) | second language of this kind; discontinuous items |
| 5 | Chinese measure-word feature | per-word facts in Chinese |

Stage 1 touches: curriculum source + generator, `catalog.ts`, new `core/lang/*`, exercises. It does not touch cards, FSRS, or backups.

## 9. Open questions (for the user)

- **Q1. Display of forms in lessons.** Teach a verb as *hablar* only, or as a conjugation table at first meeting? (Product choice; affects stage 1 UI.)
- **Q2. Level scheme.** CEFR A1–C2 mapped onto the existing six bands, or per-language band names? (Recommend CEFR → bands 1–6.)
- **Q3. Is a Spanish course separate from Chinese in the UI** (course switcher, separate knowledge) or mixed in one set? (Recommendation: one knowledge table, per-course views, since refs are already language-prefixed.)
- **Q4. FSRS on forms.** Credit one card (lexeme or rule, whichever is weaker) or both? (Technical; recommend the weaker one, and a rule card only reviewed through forms.)
- **Q5. Strictness for irregular forms.** Should a sentence with an unknown irregular form but known lexeme count as "unknown"? (Recommend yes for lesson text, no for free media reading.)
- **Q6. Accents.** Is *esta* accepted for *está*? (Recommend "almost", not wrong, in early levels.)
- **Q7. Source of authoring data.** Hand-authored YAML vs seed from a licensed Spanish dictionary + spaCy. Licence and effort decision.
- **Q8. Target audience languages.** English-speaker learning Spanish only, or other native languages (affects glosses and prompts)?

## 10. Recommendations (technical, no decision needed)

- Keep `ref` = `kind:lb` and the knowledge/card/skill tables as they are.
- Forms are never units unless irregular; irregulars are `vocabulary:` items linked to a lexeme.
- Paradigm tables are data and drive generation, checking and exercises; the AI never writes a conjugation.
- Analysers are per language behind one interface; Chinese keeps its segmenter.
- AI tagging is batched, validated against the catalog and cached; spaCy/Stanza only offline.
