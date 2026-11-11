# Korean app, final screenshot pass (2026-11-10)

Base 2371f543 plus the build-size change. Korean build (`LANGAPP_LANGUAGE=ko`, served by `vite` dev on 127.0.0.1 so the learner could be written into the app's own database), headless Google Chrome at 390 px, `fonts-noto-cjk` installed (the first shot, the Hangul guide, already showed real Hangul: 1 attempt). The learner has the first ten lessons' items known (56 items, 34 due). Nothing was fixed. Shots are in `docs/audits/images/2026-11-10-korean-final/`.

## The shots

- `01-overview.png`: Overview: "Make the language yours.", next step "Level 1, group 11 of 87" (4 new items), 10 / 87 groups added, 34 items to review. The 中 日 한 switch is in the header with 한 selected.
- `02-lessons.png`: Lessons: the next group (11): 차 cha tea, 좋아해요 joahaeyo to like, 이틀 iteul two days, and the pattern `<noun> + 하고 / <noun> + 과/와`. A notice asks for a model to be connected before a session.
- `03-lesson.png`: Lesson 11 page (full page): three word cards with readings, the grammar card with its example 차와 물은 다 좋아요, and two examples with romanization and English.
- `04-practice-start.png`: Practice start: "Korean curriculum", New items / Reviews, 5 new items per set, "9 items · 7 words, 2 grammar · 2 lessons", View items, Start.
- `05-word-order.png`: A Word order question: "They drink water and also drink milk." with seven Hangul tiles (우유 물 도 를 마시고 을 마셔요) and Check answer.
- `06-dictionary-search.png`: Dictionary searched for 학생: Vocabulary (300) / Grammar (133), Lesson words (300) / All words (10,128), 11 items, 학생 haksaeng student first, "Due now".
- `07-writing-list.png`: Writing list: "1179 guides", Basic consonants (14), Basic vowels (10), Doubled (5), Combined vowels (11), Paired final consonants (11), then Syllables starting with ㄱ (94) and on.
- `08-verb-card-forms.png`: A verb card (일해요, searched as 일하다) with its Forms table open: 27 forms with word, reading and the lesson that teaches each.
- `09-settings.png`: Settings, Reading and appearance: "Show verbs as: Polite form (공부해요)" and "Readings: Hangul with romanization (공부해요 gon…)".
- `10-hangul-guide.png`: `guides/hangul.html` at 390 px: "Learn to read and write 한글 (Hangul)", section chips, "How Hangul works" cards.

## What looks wrong or still says Chinese / Mandarin / pinyin / HSK

I read the text of Overview, Lessons, Lessons list, a lesson, Practice, Dictionary (vocabulary and grammar), Writing, Settings and the guide for Mandarin, Chinese, pinyin, HSK, tone, hanzi.

- No page chrome says any of them. The only hits are lesson content: the word "Chinese language" and the grammar examples "Chinese + teacher", "I am a Chinese-language teacher.", "I am learning Chinese." (Dictionary, Grammar).
- The Writing page's header title reads "Dictionary", not "Writing" (07).
- Writing has no eyebrow line, unlike the other pages, and its content is flush to the left edge (22 px against 34 px elsewhere).
- Settings: the Readings select is cut off at 390 px ("gon…"), so the choice cannot be read in full (09).
- Forms table (08): the "Lesson" column is empty for dictionary form, future modifier and formal polite form; the Lesson numbers run up to 78, well beyond the learner's lesson 10, with no sign of which forms are already taught.
- The Forms table is cramped at 390 px: Hangul words wrap inside a syllable ("일할 거예 / 요", "일하고 싶 / 어요").
- The Dictionary's search result shows 일해요 for a search of 일하다 (follows "Show verbs as: Polite form"); the dictionary form is only in the table.
- Lessons (02) and Overview show a "Connect a model in Settings" prompt in place of a session: expected without a model, but a learner with no model sees nothing to do.

## What to try first

1. Open Lessons and tap Start on lesson 11: confirm the model notice is the only thing in the way, and what a learner without a model can still do.
2. In Practice, run Word order and Conjugate and look at what "Hide readings" does there.
3. Search the Dictionary for 일하다, open Forms, and check the empty Lesson cells and the wrapped Hangul.
4. Open Writing from Dictionary and from the Writing area link, and check the header title.
5. In Settings, switch Readings to "Hangul only" and look at a lesson page and a Practice question again.
6. Open the Hangul guide from Lessons ("New to Hangul?") and tap a letter in the writing section.
