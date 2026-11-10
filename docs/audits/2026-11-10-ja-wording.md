# Japanese wording and data faults (step 3.4a)

Branch `langapp/pack-3-4a-japanese-wording`, base `5387a4e2ce1a3a18ec9e4044cf5320316962e919`. Only the Japanese data, its generator and the one shared code path that reads them changed. Chinese output is untouched (see "What did not change").

## How the data carries it

- **Short text.** `st` on each Japanese grammar record in `band-1.generated.json` (`GrammarRecord.st`, optional; Chinese records have none). `scripts/pack-ja-names.mjs` `shortTextRule(name)` derives it from the pattern name: the fixed written part with placeholders dropped, alternatives kept without their brackets. 20 patterns the rule cannot trust (fixed words split by a placeholder, or a group of alternatives between them) are in `curriculum/japanese/authoring/pack-pattern-short-texts.json`; a name made only of a form's placeholder takes the form's name from `pack-forms.json` ("potential form"); a name of placeholders only and no form (`<number> + <counter>`) shows its words without the angle brackets. Read by `grammarLabel(pattern, label, shortText?)` in `src/data/tracks.ts`, called from `useBandRows` in `src/components/useGroupRows.ts`: a record's short text plus "(gr.)" when it has one, else the old rule. Chinese rows are byte-identical (the golden and Chinese screen pins pass untouched).
- **Plain explanations.** `curriculum/japanese/authoring/pack-pattern-explanations.json` (pattern id to text), applied by the generator as `ds`. A pattern the file does not list keeps the old wording as the fallback, and `node scripts/generate-pack-ja.mjs --check` fails (and a test fails) when a Japanese pattern has none.
- **Form break points.** `apart` in `pack-forms.json`, generated into `forms.generated.json` (`PackForm.apart`: kind of word to the words split off the end of the form's reading, in order; absent where the ending is one word). The one romaji path with `parts` (`readingParts` in `src/core/forms/display.ts`, used for する compounds) now takes those break points too and still cuts a する compound after its noun. It is read in the forms section (`formRows`), the headword reading (`headwordFor`, via `useHeadword`) and example sentences (`exampleReadingTokens`, via `ExampleLine`). Kana readings do not change.
- **Phrase corrections.** `curriculum/japanese/authoring/pack-phrase-corrections.json`, applied by the generator (`applyCorrections`) before anything is derived. `src/data/parallel`, `src/data/tracks`, `curriculum/japanese/parallel` are not edited: faults 135, 781, 412, 593 and the three writings come from `curriculum/japanese/parallel/zh-lessons.yaml`, so they are corrected through this file.

## 1. Short text of every pattern (108)

| # | Pattern name | Short text | Source |
|---|---|---|---|
| 1 | <noun> + です | です | rule |
| 2 | <noun> + は | は | rule |
| 3 | <noun> + が | が | rule |
| 4 | <verb> + ます | ます | rule |
| 5 | <sentence> + か | か | rule |
| 6 | <noun> + ではありません | ではありません | rule |
| 7 | <noun> + を | を | rule |
| 8 | <noun> + の + <noun> | の | rule |
| 9 | <verb> + ません | ません | rule |
| 10 | <noun> + は？ | は？ | rule |
| 11 | ありがとう + ございます | ありがとうございます | rule |
| 12 | <verb> + てください | てください | rule |
| 13 | <verb> + ましょう | ましょう | rule |
| 14 | <noun> + はみんな + <predicate> | はみんな | rule |
| 15 | <い-adjective> + です | です | rule |
| 16 | とても + <adjective> | とても | rule |
| 17 | <sentence> + (ね / よ) | ね / よ | rule |
| 18 | ちょっと + <adjective> | ちょっと | rule |
| 19 | <time> + に | に | rule |
| 20 | <number> + <counter> | number + counter | name / form |
| 21 | <time expression> + <subject> + <verb> | time expression + subject + verb | name / form |
| 22 | <noun> + たち | たち | rule |
| 23 | <place> + に着きます | に着きます | rule |
| 24 | <length of time> + <verb> + ます | ます | rule |
| 25 | <noun> + も | も | rule |
| 26 | <noun> + と + <noun> | と | rule |
| 27 | <noun> + が + (好き / 上手) | が好き / 上手 | override |
| 28 | <noun> + が欲しい | が欲しい | rule |
| 29 | <い-adjective> + くないです | くないです | rule |
| 30 | (これ / それ / あれ) | これ / それ / あれ | rule |
| 31 | (この / その / あの) + <noun> | この / その / あの | rule |
| 32 | <verb> + ています | ています | rule |
| 33 | <noun> + (を / が) + 少し | を / が少し | override |
| 34 | <な-adjective> + です | です | rule |
| 35 | <verb> + て + <verb> | て | rule |
| 36 | <noun> + の前に | の前に | rule |
| 37 | <noun> + が + (あります / います) | があります / います | override |
| 38 | <verb> + (ました / ませんでした) | ました / ませんでした | rule |
| 39 | <noun> + をください | をください | rule |
| 40 | <number> + 杯 | 杯 | rule |
| 41 | <place> + で | で | rule |
| 42 | <place> + に + <noun> + があります | に〜があります | override |
| 43 | <place> + に + <noun> + がいます | に〜がいます | override |
| 44 | <number> + (号室 / 番) | 号室 / 番 | rule |
| 45 | <place> + にいます | にいます | rule |
| 46 | <time> + 半 | 半 | rule |
| 47 | <number> + 歳 + (です) | 歳 | override |
| 48 | <verb> + ている | ている | rule |
| 49 | <noun 1> + は + <noun 2> + に + <noun 3> + を + (あげます / くれます) | あげます / くれます | override |
| 50 | 十 + <ones digit> | 十 | rule |
| 51 | <noun> + の + (後ろ / 前 / 隣) + に | 後ろ / 前 / 隣 | override |
| 52 | <sentence with question word> + か | か | rule |
| 53 | <question word> + <sentence> + か | か | rule |
| 54 | <place> + (に / へ) + 行きます | に / へ行きます | override |
| 55 | <verb stem> + に行く | に行く | rule |
| 56 | <verb stem> + に来ます | に来ます | rule |
| 57 | <な-adjective> + な + <noun> | な | rule |
| 58 | <い-adjective> + <noun> | い-adjective + noun | name / form |
| 59 | <verb ない-form> + <noun> | verb ない-form + noun | name / form |
| 60 | <verb> + たい | たい | rule |
| 61 | <place> + に + (住みます / 住んでいます) | に住みます / 住んでいます | override |
| 62 | <verb ない-form> + くて | くて | rule |
| 63 | <person> + に言う | に言う | rule |
| 64 | <quotation> + と言います | と言います | rule |
| 65 | <い-adjective> + くありません | くありません | rule |
| 66 | <plain form> + ので | ので | rule |
| 67 | <verb> + なければならない | なければならない | rule |
| 68 | <verb dictionary form> + ことができる | ことができる | rule |
| 69 | <verb potential form> | potential form | name / form |
| 70 | <い-adjective stem> + すぎます | すぎます | rule |
| 71 | <verb> + (こと / の) | こと / の | rule |
| 72 | <noun> + に親切です | に親切です | rule |
| 73 | <verb> + ないでください | ないでください | rule |
| 74 | <verb> + てくる | てくる | rule |
| 75 | もう + <negative> | もう | rule |
| 76 | <noun> + ができました | ができました | rule |
| 77 | <place> + に + <verb> | に | rule |
| 78 | 本当に + <adjective> + です | 本当に〜です | override |
| 79 | <verb> + てもいい | てもいい | rule |
| 80 | <noun> + で大丈夫です | で大丈夫です | rule |
| 81 | <noun> + から + (出る / 降りる) | から出る / 降りる | override |
| 82 | また + <verb> + ます | また〜ます | override |
| 83 | <noun> + がありません | がありません | rule |
| 84 | <day name> + 曜日 | 曜日 | rule |
| 85 | <number> + 百 + <remaining number> | 百 | rule |
| 86 | <number> + 千 + <remaining number> | 千 | rule |
| 87 | (午前 / 午後) + <number> + 時 + (<number> + 分) | 午前 / 午後〜時〜分 | override |
| 88 | <noun> + で | で | rule |
| 89 | <person> + と + <verb> | と | rule |
| 90 | <number> + つ | つ | rule |
| 91 | <noun A> + は + <noun B> + より + <adjective> | は〜より | override |
| 92 | <vehicle> + に乗ります | に乗ります | rule |
| 93 | どの + <noun> | どの | rule |
| 94 | <い-adjective stem> + く + <verb> | く | rule |
| 95 | <verb> + てから | てから | rule |
| 96 | <noun> + の + (上 / 下 / 中 / 外) + (に) | 上 / 下 / 中 / 外 | override |
| 97 | どうやって + <verb> + ますか | どうやって〜ますか | override |
| 98 | <number> + 年 + <number> + 月 + <number> + 日 | 年〜月〜日 | override |
| 99 | <noun> + はどうですか | はどうですか | rule |
| 100 | <verb> + ませんか | ませんか | rule |
| 101 | <vehicle> + に乗る | に乗る | rule |
| 102 | <noun> + に電話が来る | に電話が来る | rule |
| 103 | <noun> + について | について | rule |
| 104 | <number> + <counter> + 目 + の + <noun> | 目の | rule |
| 105 | <number> + 日目 | 日目 | rule |
| 106 | 千 + <ones digit> | 千 | rule |
| 107 | <noun> + を + <container> + 半分 + <verb> | 半分 | override |
| 108 | <noun> + に会う | に会う | rule |

## 2. Explanations, old and new (108)

| # | Pattern name | Old explanation | New explanation |
|---|---|---|---|
| 1 | <noun> + です | be a noun; polite identification | says what something is (polite) |
| 2 | <noun> + は | topic; as for a noun | marks what you are talking about |
| 3 | <noun> + が | subject; newly identified information | marks who or what does it, when that is the news |
| 4 | <verb> + ます | polite nonpast verb | polite: do, or will do |
| 5 | <sentence> + か | polite question | turns a sentence into a question |
| 6 | <noun> + ではありません | not be a noun; polite negation | polite: is not |
| 7 | <noun> + を | direct object | marks the thing the action is done to |
| 8 | <noun> + の + <noun> | possession; noun modification | A's B; links two nouns |
| 9 | <verb> + ません | polite negative nonpast verb | polite: don't, won't, isn't; ませんか invites |
| 10 | <noun> + は？ | What about N?; a contextual follow-up question | asks 'what about …?' after something was said |
| 11 | ありがとう + ございます | polite form of “thank you” | polite: thank you |
| 12 | <verb> + てください | please do something | please do it |
| 13 | <verb> + ましょう | let's do; a polite proposal | let's do it |
| 14 | <noun> + はみんな + <predicate> | everyone in a group shares the predicate | says everyone in the group does it or is it |
| 15 | <い-adjective> + です | polite i-adjective predicate | polite: is, with an adjective ending in い |
| 16 | とても + <adjective> | very; an intensifier placed before an adjective | very; goes before an adjective |
| 17 | <sentence> + (ね / よ) | seeking agreement; presenting information | ends a sentence: ね checks or softens, よ tells news |
| 18 | ちょっと + <adjective> | a little; somewhat, placed before an adjective | a little; goes before an adjective |
| 19 | <time> + に | at a specific time | marks when, or where you are or sit |
| 20 | <number> + <counter> | number plus counter | says how many or how much, with a counting word |
| 21 | <time expression> + <subject> + <verb> | Put a time expression before the action, either before or after the subject. | says when it happens, before the verb |
| 22 | <noun> + たち | Add たち to a person or animal noun to refer to a group. | adds たち: more than one person or animal |
| 23 | <place> + に着きます | Arrive at a place | polite: arrive at a place |
| 24 | <length of time> + <verb> + ます | Put a length of time before the verb. | says how long you do it, before the verb |
| 25 | <noun> + も | also; too | means also, or too |
| 26 | <noun> + と + <noun> | and; an exhaustive noun list | means and: joins two nouns |
| 27 | <noun> + が + (好き / 上手) | like a thing; be good at a thing | says what you like (or are good at) |
| 28 | <noun> + が欲しい | want a thing | says what thing you want, or don't want |
| 29 | <い-adjective> + くないです | Make an い-adjective politely negative. | polite: is not, with an adjective (くないです) |
| 30 | (これ / それ / あれ) | this; that; that over there | this one, that one, that one over there |
| 31 | (この / その / あの) + <noun> | this noun; that noun; that noun over there | this, that, that over there, before a noun |
| 32 | <verb> + ています | be doing; an ongoing action | polite: is doing it, or is in that state |
| 33 | <noun> + (を / が) + 少し | a small amount of a noun | a little of something, before the verb |
| 34 | <な-adjective> + です | Polite predicate with a na-adjective | polite: is, with an adjective like 好き or きれい |
| 35 | <verb> + て + <verb> | do something and then do something | joins two actions: do this, then do that |
| 36 | <noun> + の前に | before a noun or event | means before something |
| 37 | <noun> + が + (あります / います) | There is/are; have something or someone. | says something is there, or you have it |
| 38 | <verb> + (ました / ませんでした) | polite past verb; polite negative past verb | polite past: did, or did not |
| 39 | <noun> + をください | Please give me N. | asks for something: please give me |
| 40 | <number> + 杯 | number of cups or glasses | counts cups or glasses of a drink |
| 41 | <place> + で | at a place where an action happens | marks where something happens |
| 42 | <place> + に + <noun> + があります | an inanimate thing exists at a place | says where a thing is |
| 43 | <place> + に + <noun> + がいます | a person or animal exists at a place | says where a person or animal is |
| 44 | <number> + (号室 / 番) | Use a number with 号室 for a numbered room, or 番 for a numbered label. | gives a room number (号室) or a number (番) |
| 45 | <place> + にいます | be at a place | says where someone is |
| 46 | <time> + 半 | half past the stated hour | means half past: 八時半 |
| 47 | <number> + 歳 + (です) | State someone's age in years. | says an age: 九歳 |
| 48 | <verb> + ている | resulting state; continuing habit | polite: is doing it, or is in a lasting state |
| 49 | <noun 1> + は + <noun 2> + に + <noun 3> + を + (あげます / くれます) | give something to someone; use くれます when the recipient is the speaker or the speaker's group | gives something to someone (あげます, くれます) |
| 50 | 十 + <ones digit> | form numbers from 11 to 19 by combining ten and the ones digit; larger tens follow the same pattern | makes numbers with 十: 十五, 二十, 二十二 |
| 51 | <noun> + の + (後ろ / 前 / 隣) + に | describe a location as behind, in front of, or beside a noun | says where: behind, in front of or beside it |
| 52 | <sentence with question word> + か | Ask an open question with a question word such as who, what, where, or when. | asks who, what or where (question word + か) |
| 53 | <question word> + <sentence> + か | Ask a question by putting a question word in the answer position; do not add a separate yes-no question marker. | asks who, what or where, with the question word first |
| 54 | <place> + (に / へ) + 行きます | go to; move toward a destination | go, come or return to a place |
| 55 | <verb stem> + に行く | go in order to do something | go somewhere to do something |
| 56 | <verb stem> + に来ます | Come somewhere in order to do something. | polite: come somewhere to do something |
| 57 | <な-adjective> + な + <noun> | na-adjective modifying a noun | joins an adjective like 好き to a noun, with な |
| 58 | <い-adjective> + <noun> | An i-adjective directly modifies a noun. | an adjective ending in い goes right before a noun |
| 59 | <verb ない-form> + <noun> | A plain negative verb modifies a noun. | describes a noun with a verb in the negative form |
| 60 | <verb> + たい | want to do something | says what you want to do |
| 61 | <place> + に + (住みます / 住んでいます) | Live or stay at a place; mark the place with に. | says where you live or stay |
| 62 | <verb ない-form> + くて | Connect a negative verb form to a following description or feeling. | because it is not so: gives the reason for a feeling |
| 63 | <person> + に言う | say something to someone | says something to someone |
| 64 | <quotation> + と言います | Put と after a quoted word or phrase before 言います. | says what someone says, with と |
| 65 | <い-adjective> + くありません | Polite negative form of an い-adjective | polite: is not, with an adjective (くありません) |
| 66 | <plain form> + ので | because; explanatory reason | means because; gives the reason |
| 67 | <verb> + なければならない | must do; obligation | must do it |
| 68 | <verb dictionary form> + ことができる | be able to do something | says you can do it (ことができる) |
| 69 | <verb potential form> | potential verb form; can do | says you can do it (potential form) |
| 70 | <い-adjective stem> + すぎます | too; excessively | too much: adjective + すぎます |
| 71 | <verb> + (こと / の) | nominalizing an action or event | turns a verb into a noun, like 'reading' |
| 72 | <noun> + に親切です | be kind to someone | says someone is kind to someone |
| 73 | <verb> + ないでください | please do not do something | please don't do it |
| 74 | <verb> + てくる | change up to now; movement toward | says it has started to happen |
| 75 | もう + <negative> | no longer; not anymore | no longer; goes with a negative |
| 76 | <noun> + ができました | N is ready | says something is ready |
| 77 | <place> + に + <verb> | Mark the place where an action or posture happens with に. | marks the place you sit or stay |
| 78 | 本当に + <adjective> + です | Emphasize an adjective with “really.” | really; goes before an adjective |
| 79 | <verb> + てもいい | may do; it is acceptable to do | may do it: asks or gives permission |
| 80 | <noun> + で大丈夫です | Say that something is acceptable or will do using Nで大丈夫です. | says something will do or is all right |
| 81 | <noun> + から + (出る / 降りる) | leave or get off N | leave or get off a place |
| 82 | また + <verb> + ます | do something again at a later time | again: do it once more later |
| 83 | <noun> + がありません | there is not; do not have | polite: there isn't, or you don't have it |
| 84 | <day name> + 曜日 | Form weekday names with 曜日. | names the day of the week: 月曜日 |
| 85 | <number> + 百 + <remaining number> | Make a number in the hundreds by putting the remaining number after 百. | makes hundreds: number + 百 |
| 86 | <number> + 千 + <remaining number> | Make a number in the thousands by putting the remaining number after 千. | makes thousands: number + 千 |
| 87 | (午前 / 午後) + <number> + 時 + (<number> + 分) | Tell the time using the hour and, when needed, the minutes. | says the time: 午前七時四十分 |
| 88 | <noun> + で | by; using a means or instrument | means by or with: 車で |
| 89 | <person> + と + <verb> | Do an action with someone. | means with someone |
| 90 | <number> + つ | Use つ as a general counter for things. | counts things: 二つ |
| 91 | <noun A> + は + <noun B> + より + <adjective> | A is more adjective than B | compares: one is more … than the other |
| 92 | <vehicle> + に乗ります | Get on or take a vehicle; mark the vehicle with に. | polite: get on or ride a vehicle |
| 93 | どの + <noun> | which one or ones; which + noun | asks which one, before a noun |
| 94 | <い-adjective stem> + く + <verb> | Use an い-adjective adverbially before a verb. | turns an adjective into how you do it: 早く |
| 95 | <verb> + てから | after doing; first do and then | means after doing it |
| 96 | <noun> + の + (上 / 下 / 中 / 外) + (に) | describe a location relative to N1 | says where: on, under, in or outside it |
| 97 | どうやって + <verb> + ますか | Ask how to do something | asks how to do something |
| 98 | <number> + 年 + <number> + 月 + <number> + 日 | Give a date in year-month-day order, putting each number before 年, 月, or 日. | says a date: year, month, day |
| 99 | <noun> + はどうですか | Ask how something is or what it is like. | asks how something is, or what it is like |
| 100 | <verb> + ませんか | would you like to do; invitation | polite: would you like to do it? |
| 101 | <vehicle> + に乗る | Get on or board a vehicle; mark the vehicle with に. | get on or ride a vehicle (any form) |
| 102 | <noun> + に電話が来る | A call comes in for someone. | says a call is coming for someone |
| 103 | <noun> + について | about; concerning a topic | means about; names the topic |
| 104 | <number> + <counter> + 目 + の + <noun> | Ordinal number before a noun, formed with a number, counter, and 目 | says first, second, third: 二冊目の本 |
| 105 | <number> + 日目 | A numbered day; the nth day. | says which day: 三日目 |
| 106 | 千 + <ones digit> | In Japanese, a number such as 1,008 is read 千八, omitting the zero places. | says 1,008 as 千八: skips the zeros |
| 107 | <noun> + を + <container> + 半分 + <verb> | Put 半分 after a container to say half a container of something. | says half a cup (or box) of something |
| 108 | <noun> + に会う | Meet someone; に marks the person you meet. | means meet someone |

Note on the rule's wording: where a pattern's name is a group of alternatives (`(ね / よ)`), the short text keeps both with a slash. 〜 in an override marks where a placeholder was.

Rows that still show English words (20, 21, 58, 59: names made only of placeholders with no form) cannot show Japanese: they have none. Left as decided in the table; a later step could give them a Japanese example word.

## 3. Data corrections

Every changed phrase or token (generator output is regenerated; the sources are not edited):

| Phrase | Before | After |
|---|---|---|
| 135 | token 今日 (word 今日, kyou--today), reading ことし | token 今年 (word 今年, kotoshi--this-year); word list follows |
| 781 | token お母さん pointing at お父さん (otousan--dad) | points at 母 (haha--mother), like phrases 345, 347, 348, 352 (they write お母さん for it) |
| 412 | token 人 (にん) pointing at the word ひと (hito--person) | grammar token 人 of the number + counter pattern (as in 99, 217, 222); the word is no longer listed |
| 593 | 八 (は) + 百 (っぴゃく) in two tokens | one token 八百, word 百 (hyaku--hundred), reading はっぴゃく |
| 197, 198, 199, 200, 535, 537 | 猫 in the sentence, ねこ as headword | ねこ (the headword's writing) |
| 482, 483, 484, 485, 486, 447, 531 | 犬 in the sentence, いぬ as headword | いぬ |
| 341, 815, 628, 634, 651, 780, 788, 692, 696 | 人 in the sentence, ひと as headword | ひと |

Phrase text, reading and English follow the tokens; the reading lines were already right. The headword is the writing kept (ねこ, いぬ, ひと): the headwords are kana because the generator shows a word that is normally written in kana in kana. The "Headword check" line now reports 30 tokens (was 53).

Other faults found while reading the sentences for part 2 and fixed: none beyond the above. Faults met and **not** fixed (not plain faults of the same kind, or a decision for the content step):

- The tag `<time> + に` is on sentences where に marks a place or a person after a verb (そこに座って, 家にいます, 王さんに会います) and `<verb> + ている` (ja-n4-g042) is tagged on phrases with no pattern token. The explanations are written to be true of every tagged sentence ("marks when, or where you are or sit"), which is less sharp than the name. A retag belongs to the content-gaps step.
- `<noun> + で` (ja-n5-g013) is tagged only on 車で / タクシーで; the lesson's other で (place) is ja-n5-g009.
- Reading splits over two tokens that are the same kind of fault as 593 (a counter or date reading cut across tokens): 二 ふ + 日 (66, 70, 71), 二 ふ + 人 (99, 101, 223), 一 ひ + 人 (100), 四 よ + 人 (217, 219, 224), 三 み + 日目 (778), 十 じ + 分 ゅっぷん (494 to 500), 八 よ + 日 (659, 661), 九 こ + 日 (662), 十 と + 日 (663), 日 うか / このか / おか (659, 661, 662, 663), 一 い + 杯 (138, 144), 九 く + 時 / 月 (96, 97, 495, 657), 千 ぜん + 円 (594), 匹 びき (797). They only matter for romaji spacing (the word reading still joins up) and need a retoken per number: a content step.

### Tokens left as they are (written differently from the headword, no form involved)

| Token (headword) | Phrases | Why left, and what a fix would need |
|---|---|---|
| 彼女 (headword 彼女たち) | 162, 172 | 彼女 + たち are two tokens: the pack's word is 彼女たち, the pattern たち is the second token. Needs the word 彼女 (kanojo--she, exists) in place of the compound, as a retoken. |
| 大丈夫 (大丈夫です) | 168, 170, 176, 432 | the word is listed as 大丈夫です (daijoubudesu--okay); sentences have 大丈夫 + です. A fix needs a new word 大丈夫 and a new label; labels are sealed, so it waits. |
| お母さん (母) | 345, 347, 348, 352, 781 | 母 (haha--mother) is the plain word for my mother; the sentences are about someone else's, so お母さん is the right writing. A fix needs a word お母さん (ja-n5-00098 exists in the source, not in a lesson) added to a lesson: new word, a content step. |
| 八百 (百) | 593 | the new one-token 八百 stands on the word 百 with its own reading. It is correct; the check lists it as a differently written token. |
| 受け (授業を受ける), 電話 and かけ (電話をかける), 雨 (雨が降る), 運転 and 料理 (運転する, 料理する) | 568 to 578, 522 to 530, 602, 652, 768 | pieces of a compound headword; not faults. |

## 4. Where a label's text still reaches a screen

None of the visible text of the Overview and Lessons screens contains a label's words any more (the Japanese pins have no `--` label). It still reaches a screen or the page here:

- the `data-unit` attribute of every study card (`UnitCardShell`), not visible;
- the unit's ref in knowledge entries, saved cards and exports (`grammar:ja:...` style refs), not shown;
- the Assistant's tool results and the Dictionary search fields use the label as a search key (`src/core/assistant/tools.ts`, `unit.record.lb`), and the Dictionary is not in Japanese yet;
- `grammarLabel` itself still falls back to the label's words for a record with no short text: no Japanese record is in that case (a test says so).

## 5. Screen pins

`src/pages/__screens__/ja-*.txt` regenerated with `-u`; no other pin touched.

- `ja-lessons-list.txt`: every pattern in a row's title is now its short text ("です (gr.)", "は (gr.)", "てください (gr.)", "が欲しい (gr.)") instead of label words ("noun (gr.)", "topic (gr.)", "please (gr.)", "欲 (gr.)").
- `ja-lesson.txt`, `ja-lesson-dictionary-form.txt`: the explanations of the two patterns shown (てください, ましょう) read "please do it" and "let's do it".
- `ja-lesson-romaji.txt`: the explanations of です, は, が and ます in plain words.
- `ja-overview.txt`, `ja-settings.txt`: unchanged.

## 6. Tests

New: `scripts/pack-ja-names.test.ts` (the short-text rule on a table of names); in `src/core/language/pack-ja.test.ts` (every pattern has a short text, a plain explanation within 60 characters, no banned term, and rows show the short text; the phrase corrections); in `src/core/forms/display.test.ts` the romaji cases of part 4 ("shitai desu", "shinakereba narimasen", "shinaide kudasai", "shite kudasai", "shite imasu", "shite imasen", "shite iru", "shite kimashita", "samukunai desu", "samuku arimasen", "samuku arimasen deshita", "samukatta desu", "samukunakatta desu"; "dekimasu", "shimashita", "shimasen" stay one word, "shimasen deshita" is two).

## 7. Screenshots (docs/audits/images/2026-11-10-ja-wording/)

Font check: `fonts-noto-cjk` installed, the first screenshot shows real kana and kanji. Japanese build (`LANGAPP_LANGUAGE=ja`), `vite preview`, headless Chromium, 430 px wide.

- 01-lessons-list.png: All lessons. Rows read "私 · 学生 · 勉強します · です (gr.…", "あなた · 先生 · か (gr.)", "お茶 · 二 · 好き · 一日 · も (gr.)", "三 · 家 · 部屋 · 番号 · で (gr.)": the pattern's own Japanese, no English label words.
- 02-lesson-1.png: lesson 1 with the new explanations ("says what something is (polite)", "marks what you are talking about", "polite: do, or will do").
- 10-verb-card-forms-open-romaji.png: 勉強する with Forms open and Readings on romaji: "benkyou shitai desu", "benkyou shinakereba narimasen", "benkyou shinaide kudasai", "benkyou shite kudasai", "benkyou shite imasu", "benkyou shite imasen", "benkyou shite iru", "benkyou shite kimashita", "benkyou shimasen deshita"; "benkyou dekimasu", "benkyou shimashita", "benkyou shimasen" stay one word. (Taken from the New items intro: the full card, tall viewport so the bottom bar does not cover it.)
- 11-lesson-12.png: lesson 12 (欲しい): the pattern card "<noun> + が欲しい", "says what thing you want, or don't want", and "<い-adjective> + くないです" "polite: is not, with an adjective (くないです)".
- 12-samui-forms-open-romaji.png: 寒い Forms open in romaji: "samui desu", "samukunai desu", "samuku arimasen", "samukatta desu", "samukunakatta desu", "samuku arimasen deshita".

## 9. How a correction to a lesson's sentence or list is made

The sources (`curriculum/japanese/parallel/zh-lessons.yaml`, written by `scripts/build-parallel-lessons.mjs`, and `src/data/parallel`) are not edited: a rerun of the build script would undo an edit there. A correction goes in `curriculum/japanese/authoring/pack-phrase-corrections.json`, which `scripts/generate-pack-ja.mjs` applies in memory (`applyCorrections`) right after reading the lessons and before readability, forms analysis, readings, tokens, labels, examples or the report are derived. So everything downstream (the pack files, the content-gaps report, the checks) sees the corrected data.

1. Edit `pack-phrase-corrections.json`. Under `phrases`, key = the phrase id (a string), value an object (`why` is a free note):
   - `tokens: [{ at, t, w | g }]`: replaces the token at index `at` (0-based, counting punctuation tokens) with `{ t, w }` (a word entry id such as `ja-n5-00246`) or `{ t, g }` (a grammar entry id). The phrase text is rebuilt from the tokens.
   - `merge: { at, count, t, w | g }`: makes `count` tokens from `at` one token; it throws unless their texts join to `t`.
   - `words: { oldEntry: newEntry | null }`: changes the phrase's word list (the tags that decide which words the phrase counts for); `null` drops the entry. Change `words` whenever a token's word changes. The phrase's grammar list is not touched by this file yet.
   Under `writings`, key = a word entry id, value = `{ "written in sentences": "the headword's writing" }`: every token of that word written the first way is rewritten the second way, in every phrase.
2. Run `node scripts/generate-pack-ja.mjs`. It throws, naming the phrase, when a correction refers to a phrase, token or word that is not there or does not match. It then writes `src/data/packs/ja/*`. Then `node scripts/generate-pack-ja.mjs --report docs/audits/2026-11-10-japanese-lesson-content-gaps.md` for the report, and `node scripts/generate-pack-ja.mjs --check` to confirm nothing is stale. The test `src/core/language/pack-ja.test.ts` fails when the committed files are not what the generator makes.
3. The phrase's reading is the source's `reading` (or `pack-phrase-readings.json` for a lost kana): a token change that changes the reading needs an entry there too, since the reading is split over the tokens and the split throws when it cannot match.
4. **Not yet in the mechanism** (3.4b would add them to `applyCorrections`, in the same file, and to the audit note): moving a pattern or a word to another lesson (a lesson's `words`, `grammar_taught`, `grammar_intro` lists), adding a phrase, and changing a phrase's `grammar` list or its English. `grammar_taught` is derived from the phrases by `refreshReadability` in `scripts/parallel-lessons-files.mjs`, so what is listed where follows the phrases; a lesson's `words` list is its own and is the place a word is moved. A new word or pattern is a new entry (`curriculum/japanese/parallel/entries.yaml` through the build script, or a new overlay) and a new label that must be appended to the registry and sealed (`--seal`); never rename a sealed label.
5. Labels, the registry and the sealed file are not part of corrections: `--check` fails when a label would change or disappear.

## 8. What did not change

(filled in by the final run, see below)
