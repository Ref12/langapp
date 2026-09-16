# Japanese construction progression

The original 225 records in `teaching/grammar.tsv` and `jlpt-n*/grammar.yaml`
remain the reference. The teaching overlay retains their IDs and adds concise
forms, task placements, lexical anchors, and explicit construction prerequisites.
One negative-connective variant, `ja-n1-g020`, is documented reference-only:
compare it with selected `ja-n1-g019` in context rather than count it as an
additional compulsory productive target.

## Before productive inflection

Teach a form as an explicit contrast, not as a suffix added to an arbitrary
dictionary spelling. Use the named construction and the actual verb groups.
These original examples explain the progression; their presence is not a
learner mastery record.

| Predicate | Nonpast | Negative | Past | Negative past |
|---|---|---|---|---|
| Polite verb | 食べます | 食べません | 食べました | 食べませんでした |
| Plain verb | 食べる | 食べない | 食べた | 食べなかった |
| i-adjective | 高い | 高くない | 高かった | 高くなかった |
| Polite noun | 学生です | 学生ではありません | 学生でした | 学生ではありませんでした |
| Plain noun | 学生だ | 学生ではない | 学生だった | 学生ではなかった |

For conversational noun negatives, contrast **じゃない** and **ではない**
explicitly rather than treating contraction as a different meaning.
Na-adjectives use **な** before a modified noun, but not immediately before
**です**: **静かな部屋**, **静かです**, not *静かなです*.
I-adjectives do not take a plain copula after their nonpast form.
The **いい／よい** paradigm needs separate practice: **よくない**,
**よかった**, **よくなかった**.

`ja-n5-g023`, `g024`, and `g025` teach the polite contrasts early.
Dictionary-form lookup and verb-group identification belong with `g023`.
Plain-style `ja-n4-g001` is deliberately moved into the final beginner seed,
**before `ja-n5-g030` in that same module**. The module first teaches the plain
negative and only then the negative request. A polite negative such as
**食べません** is not the base for **食べないでください**.
Plain forms also support embedding; their use inside a polite sentence does
not imply that blunt plain speech is appropriate with every listener.

## Te-form comes before its dependent constructions

`ja-n5-g041` explicitly precedes requests, ongoing aspect, permission,
prohibition, and sequencing (`g026`–`g029`, `g038`). Introduce a small set of
actual changes and retrieve them in new contexts:

| Group or ending | Example |
|---|---|
| Ichidan | 食べる → 食べて |
| Godan う／つ／る | 買う → 買って; 待つ → 待って; 帰る → 帰って |
| Godan む／ぶ／ぬ | 読む → 読んで; 呼ぶ → 呼んで; 死ぬ → 死んで |
| Godan く／ぐ | 書く → 書いて; 泳ぐ → 泳いで |
| Godan す | 話す → 話して |
| Important exceptions | 行く → 行って; する → して; 来る → 来て |

The associated plain past uses the corresponding **た／だ** ending.
Do not decide the verb group from final **る** alone: **帰る** is not
conjugated like **食べる**. Plain negatives of godan verbs use the appropriate
a-row stem; **買う → 買わない**, not *買あない*. Teach **する → しない**
and **来る → 来ない（こない）** explicitly.

The tourist quick start supplies a small local te-form scaffold and the verb
senses its phrases actually use. It does not silently require the core beginner
course or mastery of every paradigm. Memorizing **話してください** alone does
not award productive control of every verb's te-form.

`coverage.yaml` keeps the illustrative verb families in
`core_illustrative_lexemes`, alongside their explicit core selections. They are
not universal lexical `anchors`: learning to request slow speech does not first
require learning the eating, writing, or doing examples. Actual phrase senses,
source-backed inflections, and construction prerequisites remain required.

## Particles are functions, not manufactured vocabulary

- **は** (`g004`) marks the topic and is pronounced **わ**.
  **が** (`g005`) can identify new information or an existence subject.
- **を** (`g006`) is pronounced **お** and marks the direct object in the
  taught ordinary transitive uses.
- **で** distinguishes action location (`g009`) from means (`g013`).
  **に** marks existence location (`g010`, `g011`) and other separately taught
  functions. Do not translate every location as the same particle.
- Destination **に／へ** belongs to `g012`; **へ** is pronounced **え**.
  Specific time **に** is a different function (`g014`).
- Possessive or classifying **の** (`g007`) differs from action
  nominalization (`ja-n4-g002`).

Recoverable subjects or topics can be omitted. This is not permission to omit
an essential meaning from a phrase's declared source components. Closed tourist
realizations name their actual lexical items and constructions.

## Counters and useful polysemy

`ja-n5-g042` begins with useful quantities, not every counter in the dictionary.
Contrast **一つ／二つ**, **一人／二人**, and number-plus-unit patterns in
real purchases and descriptions. Teach pronunciations such as **一本
（いっぽん）**, **三本（さんぼん）**, and **六本（ろっぽん）** as actual
combinations; a base reading **ほん** is not a complete sound-change algorithm.
The selected book, long-thin-object counter, and phone-call/email counter senses
of **本** remain distinct. Currency **円** is introduced before its geometrical
circle sense, without treating those as two lemmas.

Standalone readings cannot license a compound by concatenation. The adapter
checks adjacent numeral/counter components as a whole, including numeral
combinations such as **三百** or **六百**. Unsupported combinations are rejected,
not assigned a guessed reading. The documented **一本／三本／六本** readings
can be represented by an explicitly licensed whole-word form linking the
number and the intended counter sense under `ja-n5-g042`. **千円／せんえん**
is an explicitly checked route example; dictionary-backed whole words such
as **二つ／ふたつ** remain canonical. These examples are a bounded inventory,
not a general Japanese number-pronunciation algorithm.
Counter surfaces are identified from all compatible counter senses in the
retained dictionary, not only the caller's selected sense. Substituting the
ordinary book sense of **本** therefore cannot license **一本／いちほん** or
claim counter credit for **いっぽん**. Ordinary noun phrases such as **この本**
and explicitly punctuated word lists are not quantity compounds.

## Connected speech and viewpoint

The next phases contrast:

- Ongoing action (`ja-n5-g027`) with resulting state or continuing habit
  (`ja-n4-g042`) and deliberately prepared state (`g043`).
- Permission with explicit ability (`ja-n4-g011`) and inflected potential
  (`g012`). A potential form does not grant permission.
- Representative activities, chronological sequences, and interval relations.
- Predictable **と**, completed-event **たら**, conditional **ば**, and
  a supplied premise with **なら**.
- Appearance, inference, and hearsay. State the source when a claim is relayed.
- **あげる／くれる／もらう** perspective and the actor of an action.
  Causative and causative-passive practice must distinguish permission from
  coercion instead of translating both as a neutral “let.”

## Register, argument, and interpretation

Polite style begins early. Respectful **お／ご～になる**
(`ja-n4-g045`) describes the respected person's action; humble
**お／ご～する** (`ja-n3-g003`) positions the speaker's action relative to
its recipient. They are not interchangeable upgrades to “more polite.”
Special lexical respectful/humble verbs must be learned with their own meanings,
readings, and audience conditions. Avoid praising oneself with a form chosen
only because it looked formal.

Later work contrasts possibility, inference, obligation, limitation, concession,
and the strength of an assertion. A correlation expression does not establish
causation; a strong conviction expression does not make its claim true.
Critical or blaming expressions are interpreted in fictional or clearly
appropriate contexts, not rehearsed as default interpersonal advice.

The literary extension includes marked temporal, formal-purpose, and older
written constructions. Its default is contextual understanding and paraphrase,
not making every archaic expression a requirement for ordinary modern speech.
All examples and decisions here are original AI-authored guidance with human
language-pedagogy review pending.
