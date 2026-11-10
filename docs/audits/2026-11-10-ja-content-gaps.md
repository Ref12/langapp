# Japanese lessons, step 3.4b: the content gaps closed

Base `15299ee`. Every change goes through the lesson source corrections (`docs/audits/2026-11-10-ja-wording.md` section 9, extended in this step); nothing under `src/data/packs/ja/` was edited by hand, `src/data/parallel` and the lesson YAML were not touched.

Result: `node scripts/generate-pack-ja.mjs --report` has **0 in all five totals**; the accepted-gaps list (`curriculum/japanese/authoring/pack-accepted-gaps.json`) is empty. `--check` now fails for a gap that is neither closed nor accepted with a reason.

## The table

| Lesson | The gap | What was done |
|---|---|---|
| 2 | word あなた (`ja-n5-00027`) used by none | sentence added: 818 |
| 8 | pattern `ja-par-g005` と感じます; word 感じる | sentence rewritten: 117 (both closed; the pattern is real, see the nine) |
| 11 | form `adj-polite` (phrases 65, 67, 68) uses `ja-par-g022`, taught later | listing moved: `ja-par-g022` listed in lesson 11 (out of lesson 35's list); 65, 67, 68 tagged with it |
| 13 | pattern `ja-n5-g018` (これ / それ / あれ) | listing moved to lesson 28 (first use, 265) |
| 13 | pattern `ja-par-g010` <noun> + を/が + 少し | retagged: 155, 162 (ご飯が少し…) already say it |
| 13 | word これ | listing moved to lesson 34 (first use, 281) |
| 14 | pattern `ja-n5-g041` 動詞て、動詞 | sentence rewritten: 163 |
| 14 | word 出勤する | sentence rewritten: 167 |
| 15 | word 授業を受ける | listing moved to lesson 66 (first use, 568) |
| 16 | pattern `ja-n5-g025` ました / ませんでした; its forms `mashita`, `masendeshita` listed, not used | listing moved to lesson 37 (first use, 307); both lines closed |
| 18 | patterns `ja-n5-g010`, `ja-n5-g011` (there is / there are) | listings moved to lesson 21 (first use, 104, 105) |
| 20 | pattern `ja-par-g014` <place> + にいます | listing moved to lesson 18 (first use, 148) |
| 23 | pattern `ja-par-g017` 十 + ones digit | retagged: 188 (十五) |
| 23 | pattern `ja-par-g018` 何 + counter / どれくらい | retagged: 187, 190, 196 (何冊), 195, 813 (どれくらい) |
| 24 | pattern `ja-par-g019` Nの後ろ / 前 / 隣に | retagged: 197 to 204 |
| 27 | word いつ | listing moved to lesson 31 (first use, 213) |
| 32 | word ひと | listing moved to lesson 41 (first use, 341); lesson 32 counts people with 人 |
| 37 | pattern `ja-n5-g012` <place> + に/へ + 行きます | listing moved to lesson 27 (first use, 256) |
| 38 | pattern `ja-n5-g027` ています; forms `teimasen`, `teimasu` listed, not used | listing moved to lesson 13 (first use, 156); both lines closed |
| 39 | pattern `ja-n4-g011` ことができる | listing moved to lesson 41 (first use, 344) |
| 40 | pattern `ja-n4-g037` 動詞語幹すぎる | sentence added: 819 |
| 43 | pattern `ja-n4-g012` potential; forms `potential`, `potential-masu` listed, not used | listing moved to lesson 39 (first use, 323); both lines closed |
| 47 | pattern `ja-par-g024` 変化を表す文 | removed from the list (too vague, see the nine) |
| 47 | word いくつか | listing moved to lesson 48 (first use, 401) |
| 53 | pattern `ja-n4-g040` 普通形と思う | sentence rewritten: 480 (new word 思う, `ja-n4-00101`, added to the lesson's words) |
| 56 | word 見る | listing moved to lesson 57 (first use, 463) |
| 57 | pattern `ja-par-g028` <noun> + がありません | listing moved to lesson 60 (first use, 596) |
| 59 | word 円 | listing moved to lesson 60 (first use, 587) |
| 63 | word 早い | listing moved to lesson 67 (first use, 598) |
| 65 | pattern `ja-par-g035` どのくらい + adjective + ですか | sentence added: 820 |
| 65 | word 乗る | listing moved to lesson 66 (first use, 570) |
| 66 | pattern `ja-par-g036` NをVます／NをVました | removed from the list (repeats を and ます, see the nine) |
| 68 | pattern `ja-par-g039` plain-form verb + N | sentence added: 821 |
| 70 | pattern `ja-par-g040` Nの後に | retagged: 522 to 527 |
| 71 | pattern `ja-par-g041` N1の上/下/中/外 | retagged: 531 to 541 |
| 75 | form `teiru` of `ja-n4-g042` listed, not used | sentence added: 822 (and see 1b) |

## Counts

Of the 24 patterns taught but unused: 10 listings **moved** (`ja-n5-g018`, `g025`, `g010`, `g011`, `g012`, `g027`, `ja-par-g014`, `ja-par-g028`, `ja-n4-g011`, `ja-n4-g012`), 6 **retagged** on sentences that already said it (`ja-par-g010`, `g017`, `g018`, `g019`, `g040`, `g041`), 3 closed by a **rewritten sentence** (`ja-par-g005`, `ja-n5-g041`, `ja-n4-g040`), 3 by an **added sentence** (`ja-n4-g037`, `ja-par-g035`, `ja-par-g039`), 2 **removed from the list** (`ja-par-g024`, `ja-par-g036`).
The 1 form used before its pattern is taught: 1 listing moved (`ja-par-g022`, to lesson 11). The 4 listed forms no sentence uses: 3 closed by moving the pattern (`ja-n5-g025` to 37, `g027` to 13, `ja-n4-g012` to 39), 1 by an added sentence (822).
The 12 words (the report counted 12; the brief said 13): 9 listings **moved**, 2 closed by a **rewritten sentence** (感じる, 出勤する), 1 by an **added sentence** (あなた). 1 word **added** to a lesson (思う).
Sentences: **4 rewritten** (117, 163, 167, 480), **5 added** (818 to 822, Japanese-only, `extra: true`), 0 accepted.

"Retagged" is a fourth kind that the brief did not list under 1.1 to 1.3: the sentences already said the pattern (the lesson's own 後ろ / 前 sentences are the pattern Nの後ろ／前／隣に), only the pattern's tag was missing. It is a change of the phrase's grammar list, the same kind of tag correction as 1b, and it changes no sentence.

## Rewritten sentences (Japanese before; the English and the Chinese reference stay)

| Phrase | Lesson | Before | After | Reading | English |
|---|---|---|---|---|---|
| 117 | 8 | 私はちょっと寒いです。 | 私はちょっと寒いと感じます。 | わたしはちょっとさむいとかんじます。 | I feel a little cold. |
| 163 | 14 | 昼間は働きます。夜は休みます。 | 昼間は働いて、夜は休みます。 | ひるまははたらいて、よるはやすみます。 | I work during the day and rest in the evening. |
| 167 | 14 | 今日は働きます。 | 今日は出勤します。 | きょうはしゅっきんします。 | I go to work today. |
| 480 | 53 | 私はこの本が面白いです。 | 私はこの本が面白いと思います。 | わたしはこのほんがおもしろいとおもいます。 | I think this book is enjoyable. |

## Added Japanese-only sentences (ids 818 to 822, `extra: true` in `pack-added-phrases.json`, no zh, no zh_ref)

| Phrase | Lesson | Japanese | Reading | English |
|---|---|---|---|---|
| 818 | 2 | あなたは先生ですか。 | あなたはせんせいですか。 | (Asking someone you don't know) Are you a teacher? |
| 819 | 40 | お茶を飲みすぎます。 | おちゃをのみすぎます。 | I drink too much tea. |
| 820 | 65 | この店はどのくらい大きいですか。 | このみせはどのくらいおおきいですか。 | How big is this shop? |
| 821 | 68 | 質問がある人はいますか。 (shown ひと, the pack's writing of the word) | しつもんがあるひとはいますか。 | Is there anyone who has a question? |
| 822 | 75 | 彼はその人を知っていると思います。 (shown ひと) | かれはそのひとをしっているとおもいます。 | I think he knows that person. |

The generator throws when an added or rewritten sentence uses something taught only after its lesson (`readyAt` later than the lesson): all nine pass.

## The nine patterns no sentence used

| Pattern | Decision | Reason |
|---|---|---|
| `ja-n4-g037` 動詞語幹すぎる | real: name `<verb stem> + すぎます`, label `v-stem-sugimasu--do`, sentence 819 | the verb version beside the adjective one (`ja-par-g058`) |
| `ja-n4-g040` 普通形と思う | real: `<sentence> + と + 思います`, label `s-to-omoimasu--think`, sentence 480 (and 822) | opinion with と; needs the word 思う, a new word and label `omou--think` |
| `ja-par-g005` 形容詞＋と感じます | real: `<adjective> + と + 感じます`, label `adj-to-kanjimasu--feel`, sentence 117 | a different verb of feeling, adjective + と |
| `ja-par-g018` 何＋助数詞＋N… | real: `(何 + <counter> / どれくらい)`, label `nan-counter-dorekurai--ask`, sentences 187, 190, 195, 196, 813 retagged | lesson 23's own questions say it |
| `ja-par-g024` 変化を表す文＋… | **removed** from lesson 47's list | too vague to name; the sentence 雨が降ってきました is the pattern <verb> + てきました (`ja-n3-g045`), which the lesson already has |
| `ja-par-g035` どのくらい＋形容詞ですか | real: `どのくらい + <adjective> + ですか`, label `donokurai-adj-desuka--ask`, sentence 820 | how big, how far |
| `ja-par-g036` NをVます／NをVました | **removed** from lesson 66's list | repeats を (`ja-n5-g006`) with ます / ました (`ja-n5-g023`, `g025`), taught already |
| `ja-par-g039` plain-form verb＋N | real: `<plain-form verb> + <noun>`, label `plain-form-v-n--plain`, sentence 821 | a verb before a noun (ある人) |
| `ja-par-g040` Nの後に | real: `<noun> + の後に`, label `n-noatoni--after`, retagged 522 to 527 (their に token is now the pattern's, as in 前に) | the sentences of lesson 70 say it |

Each real one has a name (`pack-pattern-names.json`), a short text (`pack-pattern-short-texts.json` where the rule cannot make one), a plain explanation under 3.4a's rules, and a label appended to the registry and sealed (7 patterns and 1 word; no sealed label changed, the sealed file only gained 8 lines). The patterns' own listing in a lesson was already there, so only 思う needed an addition to a lesson's words.

## 1b. The wrong tags of 3.4a

- `<time> + に` (`ja-n5-g014`) on に that is not a time: 151, 153 (家に / 部屋にいます) are now `ja-par-g014` <place> + にいます; 430, 438 (ここに座って…) and 687 (この部屋には住めます) are `ja-par-g061` <place> + に + <verb>; 174 (授業の前に) is `ja-par-g011` Nの前に, and 522 to 527 (授業の後に) `ja-par-g040`. 755 (土曜日に王さんに会います) already had `ja-par-g067` for the person; its time に stays. I scanned every に of `ja-n5-g014` by the word before it: the others follow a time word. The explanation of `<time> + に` is now "marks the time something happens: at, on, in".
- `<verb> + ている` (`ja-n4-g042`): decision: **it is a pattern of its own beside ています**: the plain form, which appears inside a polite sentence (知っていると思います). All 23 sentences tagged with it had the polite ています (`ja-n5-g027`, form `teimasu`); they are retagged (token and list), and the pattern is demonstrated by the new sentence 822 (form `teiru`). It could not be removed: it is in the pack and its label is sealed. Name and explanation now agree: "is doing it, or is in a lasting state (plain form)".

## Screen pins

Only `src/pages/__screens__/ja-lessons-list.txt` changed (26 lines: the rows show five units each, so a unit that moved leaves one row and appears in another, and a newly used pattern pushes the last one off the end): lesson 13 loses これ and shows この / その / あの; 15 loses 授業を受けます and shows の前に; 18 shows に〜があります / に〜がいます; 23 shows 何〜 / どれくらい; 27 loses いつ and shows に / へ行きます; 28 gains これ / それ / あれ; 31 gains いつ; 32 loses ひと; 34 gains これ; 37 gains ました / ませんでした; 39 shows the potential form for ことができる; 41 gains ひと and ことができる; 47 loses いくつか; 48 gains it; 53 gains 思います; 56 loses 見ます; 57 gains it and loses がありません; 59 loses 円; 60 gains 円 and がありません; 63 loses 早い; 65 loses 乗ります and gains どのくらい〜ですか; 66 gains 授業を受けます and 乗ります; 67 gains 早い; 68 gains plain-form verb + noun; 70 gains の後に; 75 gains ている. No other pin changed (`ja-overview`, `ja-settings`, `ja-lesson*`, `ja-lesson-romaji` unchanged).

## The independent reading

I could not start a helper session with the tools of this session (there is no call that starts a session with a prompt), so the reading was **one batch in one call to a different model** (`gpt-6.1-sol`, no tools, given the nine sentences with reading, English, tokens and the form names; it did not write any of them). It said OK for eight sentences and CHANGE for one: 163, English "rest in the evening" should be "at night" (夜). I did not change it: the English is the Chinese lesson's and stays by the brief; 夜 is glossed "evening; night" in lesson 14. It added two remarks on OK sentences: 818 あなた to a stranger is "not generally recommended" and 先生ですか is often more natural (the brief asked for exactly this sentence for あなた, kept, with the context in the English); 167 出勤します means going to work rather than simply working (what the English says). Nothing was fixed after the reading. It checked the conjugated tokens (働いて te, 飲み masu-stem + すぎます, 知っている teiru, the masu tokens) and found them right.

## Tests and checks

- `npm run lint`: 0 errors, 12 warnings (react-refresh, none in a file of this step). `npx tsc -b`: clean. `npm run build` for zh and once with `LANGAPP_LANGUAGE=ja`: built.
- `curriculum:check`, `curriculum:v2:app:check`, `characters:check` and `node scripts/generate-pack-ja.mjs --check` pass.
- New tests: `scripts/pack-ja-gaps.test.ts` (6: the gap check fails on a fixture lesson with an unlisted gap and passes with the accepted list, fails on a stale or reasonless entry, finds a later-taught form and an unused form; every corrections operation and each of its errors); two tests in `src/core/language/pack-ja.test.ts` (the gaps are closed or accepted; the lesson-list corrections show in the pack), and its counts (292 words, 115 patterns, 822 phrases, 536 merged tokens, 55 verbs).
- One full `npm run test:pages` on the commit that holds all code and data of this step: **296 files passed, 4918 tests passed, 19 skipped, 0 failed** (269 s). Nothing I did not touch failed or timed out. The commits after it change this note only.
- Golden exports, prompt pins and Chinese screen pins pass **untouched** (also on the base `15299ee`, checked in a clean worktree before I started); no pin file other than `ja-lessons-list.txt` changed. `git diff --stat 15299ee..HEAD -- src/data/v2 src/data/phrases src/data/practice src/data/parallel src/data/tracks src/data/forms public package.json .github` is empty. No phrase, word or pattern id changed; the sealed labels file gained 8 lines (7 patterns, 1 word), nothing else.

## Screenshots (`docs/audits/images/2026-11-10-ja-content-gaps/`)

Font check first: `fonts-noto-cjk` installed (`fc-list` shows 30 Noto CJK faces); the first Lessons screenshot shows real kanji and kana (私, 学生, 勉強します), not boxes. Japanese build (`LANGAPP_LANGUAGE=ja`), `vite preview`, headless Chromium, 430 px wide. I looked at each.

- `01-lessons-list.png`: All lessons. Rows 1 to 18 in Japanese with their units; row 2 reads あなた · 先生 · か (gr.); row 14 昼間 · 夜 · 出勤します · 退勤し…; row 16 ゼロ · 六 · 今年 · 年 · 十 (the past tense is no longer listed here).
- `02-lesson-13.png` (**moved listing**): lesson 13 has 少し, ご飯, 文字, 知ります and the patterns この / その / あの, <verb> + ています (example あなたを知っています) and <noun> + (を / が) + 少し (ご飯が少しほしいです); これ and (これ / それ / あれ) have gone to lessons 34 and 28.
- `03-lesson-8.png` (**rewritten sentence**): lesson 8 shows 感じます (to feel) as a word and the pattern <adjective> + と + 感じます, "polite: feel that it is so; goes after an adjective", with the example 私はちょっと寒いと感じます。 (わたしはちょっとさむいとかんじます。 / I feel a little cold.), and the same sentence in Examples.
- `04-lesson-40.png` (**added sentence**): lesson 40 shows <verb stem> + すぎます, "too much: verb + すぎます", with the example お茶を飲みすぎます。 (おちゃをのみすぎます。 / I drink too much tea.) beside the adjective pattern with 今は遅すぎます。

## What I decided that the brief did not settle

- Retagging (grammar list) as a fourth way to close a gap, for patterns the sentences already say (see above).
- Moves go to the lesson whose sentences first use the item, in the `grammar_intro` / `words` lists; `ja-par-g022` was listed in lesson 35, not 13 (the report said "taught in 13" because lesson 13's sentences use it); I moved it from 35 to 11.
- `ja-n4-g042` is kept as the plain-form pattern, since a pattern in the pack with a sealed label cannot be removed.
- 118 phrase tags changed in all (the 23 `ja-n4-g042`, 6 patterns retagged, the に tags); the list is in `pack-phrase-corrections.json` with a `why` each.
- Added phrases carry `source: ai` and `checked: false` (the independent reading was a model call, not a human check). Rewritten phrases keep `checked: true` from the source; I did not change it.
- The independent reader is a model call, not a session (see above).
- A word added to a lesson (思う) is marked `extra: true` as the build script marks Japanese-only items.

