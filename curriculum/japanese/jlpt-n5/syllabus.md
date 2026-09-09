# JLPT N5-oriented syllabus: foundations for everyday interaction

## Standard and scope

**Official reference:** [JLPT competence summary](https://www.jlpt.jp/e/about/levelsummary.html), interpreted here as understanding simple familiar written messages and short, slowly delivered everyday speech. The [official FAQ](https://www.jlpt.jp/e/faq/index.html) explains why exhaustive modern vocabulary/kanji/grammar specifications are not published.

**This curriculum:** 679 incremental lexeme-reading entries and 45 original teaching constructs. Vocabulary bands are Waller community estimates; grammar bands, lesson order, kanji goals and assessment thresholds are local teaching decisions. Neither the inventory nor the assessment is official exam material. All prerequisite grammar is introduced here.

## Prerequisites and diagnostic

No Japanese is required. Ask about literacy, hearing/vision access, goals and previous exposure. Check the learner's ability to distinguish long vowels, short pauses and similar consonants after a model; do not make prior kana knowledge an admission requirement.

Use an initial 10-minute diagnostic: recognize up to ten familiar words, copy five unfamiliar kana after demonstration, follow a two-step instruction with visuals, and identify the main purpose of a short greeting exchange. Save the result to plan scaffolding, not to assign an official test level.

## Observable outcomes

By the local exit assessment, the learner can:

- Read hiragana and katakana in familiar words, identify long vowels and doubled consonants, and connect a verified kana reading to its word and English meaning.
- Obtain names, times, prices and locations from short original notices, schedules and messages of roughly 80–150 Japanese characters with selective reading support.
- Follow the main purpose and at least three details in a 30–60-second, clearly spoken familiar exchange.
- Understand affirmative, negative and past statements; requests, rules, invitations, elementary sequencing and comparisons.
- As **productive enrichment**, exchange personal information and practical requests for 1–2 minutes, and compose a 5–8-sentence message or routine description. These are not JLPT-tested skills.

Lengths and percentages below are local calibration aids, not official standards.

## Script and pronunciation progression

1. Before and during blocks 1–2, teach the basic hiragana inventory in usable words, then voiced marks, small-y combinations, doubled consonants and long vowels. Teach particle spelling/pronunciation distinctions using the grammar notes.
2. During blocks 3–4, teach katakana through familiar loanwords, names and signs; compare small characters and visually similar forms. Move from recognition to reading aloud, then supported typing.
3. Across blocks 2–9, select approximately **80–120 high-utility kanji** from actual target words: numbers, dates, people, places and everyday actions. This is a planning range, not a claimed JLPT character list. Teach each within its verified word reading and English meaning, with stroke-order support from a separately authorized source if needed.
4. Fade full kana support to support only new words; retain optional readings for accessibility. Do not require all dictionary readings of a character. Assess common inflected word recognition, not isolated character-name trivia.

## Vocabulary allocation and coverage

Use all 679 rows as the level's coverage queue, but **one appropriate current sense per row first**. Advanced dictionary senses are reference material and may be deferred; document the selected sense number. Introduce about 6–10 new rows per short session only if delayed recall remains stable.

Suggested first-pass row budgets across blocks: **75, 75, 75, 75, 75, 75, 75, 75, 79**. Budgets are pacing guides, not topic quotas. For each block:

1. Filter `vocabulary.yaml` by the named topic buckets; inspect the actual English gloss and POS.
2. Choose previously unintroduced rows supporting the task; pair kana-only forms with suitable kanji words.
3. Include approximately one quarter of the allocation from `general-language`, prioritizing useful verbs, adjectives, question words and connectors.
4. Carry over unsuitable rows to a later block. Fill short buckets with appropriate unintroduced rows from other topics. At block 9, audit every ID as introduced, previously known, or explicitly deferred with a reason; schedule a catch-up cycle for deferred core senses.

Review earlier words during later blocks rather than duplicating them as new vocabulary.

## Ordered thematic lesson blocks

Each block comprises several micro-lessons, not one oversized class. Teach roughly two constructions per micro-lesson; recycle all five in the block task. Grammar IDs link to entries in `grammar.yaml`.

| Block | Focus and actual grammar IDs | Vocabulary selection | Task and evidence |
|---|---|---|---|
| 1 | Identity, questions and information focus: `ja-n5-g001`, `ja-n5-g002`, `ja-n5-g003`, `ja-n5-g004`, `ja-n5-g005` | `people-and-relationships`, `study-work-and-communication`; names, occupations, pronouns and question words from `general-language` | Interpret two short introductions; ask and answer five information questions; identify topic versus newly supplied person without requiring terminology. |
| 2 | Belongings and the home: `ja-n5-g006`, `ja-n5-g007`, `ja-n5-g008`, `ja-n5-g009`, `ja-n5-g010` | `home-and-daily-life`, `study-work-and-communication`; everyday objects and action verbs | Match descriptions to a room diagram; locate five objects and state ownership; distinguish action location from existence location in four contrasts. |
| 3 | People, transport and time: `ja-n5-g011`, `ja-n5-g012`, `ja-n5-g013`, `ja-n5-g014`, `ja-n5-g015` | `travel-and-places`, `time-and-quantity`, `people-and-relationships` | Read a simple timetable; identify a person at a location and choose a route; give a start time and end time with the transport method. |
| 4 | Shopping and describing things: `ja-n5-g016`, `ja-n5-g017`, `ja-n5-g018`, `ja-n5-g019`, `ja-n5-g020` | `food-and-dining`, `home-and-daily-life`; demonstratives and adjectives in `general-language` | Build an exhaustive shopping list and a non-exhaustive suggestions list; identify near/far objects from a shared scene; describe price and size. |
| 5 | Daily routines and yesterday: `ja-n5-g021`, `ja-n5-g022`, `ja-n5-g023`, `ja-n5-g024`, `ja-n5-g025` | `time-and-quantity`, `study-work-and-communication`, `health-and-body` | Compare a routine with yesterday's diary; order six events; produce affirmative, negative and past contrasts without changing the intended meaning. |
| 6 | Requests, ongoing activities and rules: `ja-n5-g026`, `ja-n5-g027`, `ja-n5-g028`, `ja-n5-g029`, `ja-n5-g030` | `home-and-daily-life`, `health-and-body`, `travel-and-places` | Follow a short set of room rules; ask permission, make a request and identify what a person is doing; distinguish permission from ability. |
| 7 | Wants, invitations and reasons: `ja-n5-g031`, `ja-n5-g032`, `ja-n5-g033`, `ja-n5-g034`, `ja-n5-g035` | `food-and-dining`, `thought-and-feeling`, `travel-and-places` | Negotiate a simple weekend plan with two choices; accept or decline an invitation and give a short reason; distinguish wanting a thing from wanting an action. |
| 8 | Planning sequences and comparisons: `ja-n5-g036`, `ja-n5-g037`, `ja-n5-g038`, `ja-n5-g039`, `ja-n5-g040` | `time-and-quantity`, `travel-and-places`, `society-and-economy`; comparative adjectives | Choose a shop or route from three options; state one contrast, one comparison and a before/after sequence; explain the choice with data from the prompt. |
| 9 | A day in town and cumulative review: `ja-n5-g041`, `ja-n5-g042`, `ja-n5-g043`, `ja-n5-g044`, `ja-n5-g045` | Remaining unintroduced IDs from every topic, especially counters, preferences, purpose verbs and `general-language` | Complete a shopping-and-meeting scenario: quantities, purpose of movement, action order and listener awareness; create a translated mini-itinerary and check all remaining vocabulary IDs. |

## Micro-lesson procedure and four-skill practice

- **Retrieve, 5 minutes:** six previously learned vocabulary/sense prompts plus two grammar contrasts. Mix reading-to-meaning and English-to-Japanese recall; keep production results distinct.
- **Notice, 5–8 minutes:** present the entry's two original bilingual examples. Ask what meaning changes if one particle, tense or adjective form changes.
- **Practise, 10 minutes:** use matching, sentence ordering, error correction and a short original reading. Pair every new Japanese sentence with an accurate English translation, hidden during recall.
- **Listen, 5–8 minutes:** a tutor or reviewed TTS reads an original short dialogue first without text. Ask for purpose, then details; supply the transcript and English only after the response. Do not treat silent reading as a listening score.
- **Use, 5–10 minutes:** role-play one practical exchange and type or handwrite two connected sentences. Correct one high-value error at a time; have the learner repair it.
- **Exit ticket:** recognize two new words in changed context, interpret one construction and perform one new transfer item.

Revisit material approximately 1, 3, 7, 14 and 30 days after first study; adapt to performance. Below 80% delayed recognition, halve new-item load and contrast confused forms. After two successful sessions, change context before increasing speed. Every third block includes a cumulative review using at least half older material.

## Local level-exit tasks

Use unseen, tutor-authored material containing mostly taught core senses. Reserve two parallel forms so immediate repetition does not masquerade as mastery.

1. **Lexical/script retrieval:** 40 randomly sampled current-level rows, stratified across topics, with kana/kanji recognition and English meaning; add ten counter/time combinations.
2. **Grammar interpretation:** 20 fresh items covering at least 15 of the 45 IDs, including question/topic/object distinctions, tense, requests, permission/prohibition and sequence.
3. **Reading:** three 80–150-character practical texts; ask ten purpose/detail questions, including timetable and location retrieval.
4. **Listening:** three 30–60-second dialogues, at most two plays; ask ten purpose/detail questions. Record speaker speed and support.
5. **Speaking enrichment:** a 1–2-minute introduction and a two-person shopping/invitation role-play, with one repair request.
6. **Writing enrichment:** a 5–8-sentence personal message containing a past event, a plan, a request and a reason; provide an English version to verify intended meaning.

## Observable rubric and advancement

| Dimension | 0–1: needs instruction | 2: developing | 3: independent at this task | 4: robust transfer |
|---|---|---|---|---|
| Vocabulary and script | Below 50%, or cannot decode basic kana even with a model | 50–79% correct with some reading prompts | At least 80%; distinguishes the selected reading and core English sense | At least 90% in a new context and after a delayed check |
| Grammar meaning | Below 50%; reverses basic roles, polarity or time | 50–79%; succeeds with examples nearby | At least 80% on unseen items; no repeated permission/prohibition reversal | At least 90%; explains key contrasts in English and transfers to new words |
| Reading | Fewer than half of purpose/details identified | 5–7 of ten, with selective support | At least 8 of ten without answer-revealing support | At least 9 of ten on a second text set |
| Listening | Fewer than half understood after two plays | 5–7 of ten after two plays | At least 8 of ten after at most two plays | At least 9 of ten with one play, at the documented teaching pace |
| Speaking enrichment | Message mostly unrecoverable; 0 if no attempt | Completes the core purpose with prompts or repair | Completes four of five communicative requirements; errors do not block meaning | Completes all five and independently repairs misunderstanding |
| Writing enrichment | Intended message mostly absent or unreadable | Connected message with several prompted repairs | At least four required functions expressed intelligibly, with controlled basic tense | All functions clear; independently checks spelling, tense and intended English meaning |

Advance the **receptive curriculum** when vocabulary/script, grammar, reading and listening each reach 3 on two checks at least seven days apart. A missing audio assessment remains “not assessed,” not a pass. Productive skills are separately reported enrichment; use their gaps to plan parallel practice without inventing official speaking/writing marks.

Record date, task version, vocabulary and grammar IDs sampled, sense numbers, number of plays, reading support, raw correct/total, rubric rating, recurring errors and next review date. These records are local learning evidence, not scaled JLPT scores.
