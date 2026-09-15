# Korean for small travel tasks

This standalone route starts without core-course prerequisites. Its first five
modules form the ordered **quick start**: polite repair, food basics, finding
your way, paying, and asking for help. Continue through the remaining situations
in order; later modules explicitly reuse earlier senses and constructions.
The selection is a practical teaching judgment, not a TOPIK level, official
exam inventory, or claim of fluency.

`plan.yaml` contains 12 modules and 47 original phrase records. Each module
introduces at most nine lexical senses and three constructions. English phrase
labels describe the immediate communicative task; English component labels in
`..\..\authoring\teaching\support.yaml` distinguish the actual dictionary senses.
Common greetings and conventional requests are necessarily familiar expressions;
the route and task combinations were authored here, not copied from a phrasebook
or translated from another language's tourist list.

## Three small lessons per situation

Use each row as three short sessions, not one large memorization list. First
read the English situation and inspect the Korean components; then retrieve
one or two phrases with support; finally vary the context or review earlier
material. Reopen the sense labels whenever a word has several meanings.

| Module | Lesson 1: understand | Lesson 2: retrieve | Lesson 3: use and review |
| --- | --- | --- | --- |
| 1. Polite repair | Recognize greeting, gratitude, and apology. | Ask for repetition or slower speech. | Point to the information and ask someone to write it. |
| 2. Food basics | Distinguish a menu, water, and brewed coffee. | Order one cup; identify the counter. | Ask if water is available; respond yes/no to a positive question. |
| 3. Finding your way | Locate a restroom or station. | Contrast location with a copula question. | Recognize left/right and ask for repetition. |
| 4. Paying | Ask the price before proceeding. | Check card acceptance or request cash processing. | Confirm the amount and practice formal thanks. |
| 5. Asking for help | Request help and find a hospital. | Ask someone to call a police officer. | Report not having a passport; use written details and seek local help. |
| 6. Arrival and transport | Show a destination and request travel there. | Request a bus ticket or locate a taxi. | State where to get off and confirm the safe stop with staff. |
| 7. Lodging | State that a reservation exists. | Request a key at reception. | Locate the passport; reuse the location and give constructions. |
| 8. Shopping | Describe an object's general size. | Ask for a small one and identify a purchase. | Request a receipt; review the price and payment questions. |
| 9. Food needs | Separate a preference, allergy, and inability. | State no meat or inability to eat spicy food. | Disclose an allergy and seek qualified confirmation of specifics. |
| 10. Connection | Distinguish using something from writing. | Ask about internet use and the access password. | Find a telephone or ask staff to write the information. |
| 11. Leisure | Locate a museum before planning a visit. | Ask permission to take a photograph. | Check whether going today is possible; do not assume admission. |
| 12. Changed plans | Contrast today with tomorrow. | Ask to change the appointed time. | Apologize formally and confirm the actual revised arrangement. |

Suggested practice is recognition, English-supported recall, component
substitution, and a short role-play. A phrase exposure is not proof that every
linked word or construction is mastered. Do not automatically award mastery,
exam readiness, listening comprehension, pronunciation accuracy, or audio
assessment from completing these tasks.

## Meaning and component evidence

- IDs retain the raw bilingual source registry's parent and sense ordinals.
  Meanings were checked against both the English and Korean definitions in
  `..\..\source-senses.yaml`; semicolon-joined English is not split into
  invented senses.
- `카드` is payment card `ko-nikl-20539-s006`; `커피` is the brewed drink
  `ko-nikl-20657-s002`; `경찰` is an officer `ko-nikl-28539-s002`.
  The greeting draws on healthy/at-ease `안녕하다` sense 2. Gratitude is
  adjective `ko-nikl-26499-s001`, not the similarly spelled auditing verb.
- `계산하다` uses payment sense 3. `부르다` uses summoning sense 9, not
  calling something by a name. `내리다` uses getting out of a vehicle sense 6,
  and `찍다` uses photographing sense 8.
- The separate `쓰다` parents mean **write** (`03918-s001`) and **use**
  (`03920-s001`). Internet use must not count as writing practice.
- `있다` sense 1 supplies bare existence/availability, sense 8 location,
  and sense 2 an existing fact or phenomenon, including a reservation or an
  allergy. `없다` sense 11 in the passport phrase means not having something:
  the phrase does not specifically assert theft or loss.
- General size senses of `크다` and `작다` refer to an object's dimensions,
  not the distinct clothing-fit senses. Practice with luggage or another
  object, rather than claiming the route teaches clothing fit.
- `한` is the attributive numeral and `잔` sense 3 is a drink counter, not
  a cup as a physical container. `네` sense 2 is an affirmative response.
  Korean answers to negative questions need contextual instruction; do not
  mechanically substitute English “yes” or “no.”
- Auxiliary `주세요`, `수 있어요`, `싶어요`, `않아요`, and `돼요` are
  linked to their constructions rather than unrelated lexical senses.
  Lexical `주세요` in an item request instead links the **give** sense;
  lexical compound `도와주세요` links **help** plus the polite directive.

Each phrase's `items` contains vocabulary IDs only, and `grammar` contains
construction IDs only. Realizations contain linked orthographic words, never
whitespace-only or punctuation-only segments. Concatenated segment `ch` matches
the phrase after the shared engine removes whitespace and common punctuation;
concatenated segment `pr` matches after removing whitespace only. Phrase `ch`
retains ordinary spaces and final punctuation; phrase `pr` retains spaces but
omits punctuation. Segment link unions equal the phrase links. Inflected, contracted, grammatical,
and citation-variant readings refer to exact single-word records in
`..\..\authoring\teaching\phrase-forms.yaml`. Those records explain morphology
and sound changes and remain `review_status: unreviewed`. Every segment has
lexical or construction evidence; whole-sentence form entries are not used.

## Reading policy and limits

All phrase `pr` values are **individually authored broad Hangul readings**,
not romanization, dictionary-verified sentences, or audio-verified models.
Phrase readings preserve word boundaries but omit punctuation; each registered
form remains a single word without spaces or punctuation. Natural rhythm, intonation, speech rate, and all
possible connected-speech variants are outside this notation.

Citation readings retain the source's vowel-length marks and alternative
readings, joined with ` / `. Phrase readings omit vowel length and select one
variant explicitly in the relevant form rationale. Omitting vowel length is
a declared broad-notation choice, not a correction of the dictionary.
Source-text citation evidence does not verify an inflection or a whole phrase.

The form registry makes distinctions that copying spelling would miss:

- `감사합니다` → `감사함니다` and `죄송합니다` → `죄송함니다`:
  nasal assimilation before `ㄴ`.
- `있어요` → `이써요`, `없어요` → `업써요`, `작은` → `자근`,
  `사진을` → `사지늘`: vowel-initial endings or particles change the
  syllable boundary. A citation such as `읽다` → `익따` would not establish
  the inflected `읽어요` → `일거요`; this route does not teach that verb.
- `카드로` stays `카드로`. Citation `인터넷` has final neutralization,
  `인터넫`, whereas particle-bearing `인터넷을` is `인터네슬`.
- `갈 수` → `갈 쑤` represents construction-conditioned tensification
  across a space. In `못 먹어요`, `못` is contextually `몬` before `ㅁ`.
- `박물관이` → `방물과니` combines nasal assimilation and liaison;
  `여권이` → `여꿔니` retains the lexical tense consonant.
- `써`, `불러`, `매운`, `커요`, and `돼요` have explicit contraction
  or irregular-conjugation explanations rather than opaque phrase chunks.

These are pedagogical proposals requiring qualified Korean-language and
pronunciation review. Learners should use reliable recordings and instruction;
this route contains no recorded audio or scoring of spoken performance.

## Real-world precautions

These short phrases start a conversation; they do not guarantee an outcome.
Confirm destinations, prices, currencies, acceptance of a payment method,
booking details, opening times, and photo rules with local staff. Asking to
change a time does not change a reservation or cancel a payment.

“I have an allergy” does **not** identify the allergen, severity, ingredients,
cross-contact risk, or treatment. “I do not eat meat” does not guarantee
vegetarian ingredients, and “I cannot eat spicy food” is not an allergy
declaration. Carry professionally checked written information as appropriate,
ask qualified staff, and seek medical advice rather than relying on these
phrases to establish food safety.

Emergency and passport phrases cannot dispatch assistance, diagnose a problem,
or establish legal status. Seek local emergency services, qualified medical
professionals, accommodation staff, or the relevant consular service when
needed. This route offers language practice, not professional advice.
