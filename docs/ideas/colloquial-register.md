# Colloquial ways of saying it

Status: idea, captured 2026-11-19. Not scheduled. Nothing here is built.

## The suggestion
Someone suggested they would like to learn more of the colloquial, modern way of saying things, rather than only the formal version a course teaches.

## The owner's thought (2026-11-19)
- The dataset could say not just "this is how you say it", but also "this is how you might say it more casually, the way a modern person would actually say it in conversation".
- That can be a separate piece of data. It doesn't have to be embedded in the standard course data.

## Shape (a sketch, not decided)
- **A separate layer.** A colloquial dataset keyed to existing items: a word, a grammar pattern or a phrase (curriculum example sentences, the phrase bank). The course data stays as it is, and the layer can be built, reviewed and shipped on its own, per language.
- **Each entry links a standard form to one or more casual ones,** with:
  - the casual text, its reading and a translation;
  - what changes: contraction, a dropped particle or subject, slang, a different word, a sentence-final particle, a plainer verb form;
  - register and setting: with friends, online, among younger people; and whether it would sound rude or odd in a formal setting;
  - region or variety where it matters (for example mainland vs Taiwan Chinese, Spain vs Latin American Spanish);
  - a note on when not to use it.
- **Shown alongside, not instead.** A card or sentence could show "Casually: …" under the standard form, behind a setting or a tap. Practice could add a "say it casually" or "which is more casual?" exercise later.
- **Where it relates to existing work:**
  - Japanese already separates polite and plain forms, with the polite form shown by default and a setting to change it. Colloquial Japanese goes further than plain form (contractions such as ちゃう and じゃん, dropped particles), so it is a separate layer, not another setting value.
  - Phrases as items ([phrases-and-generation.md](phrases-and-generation.md)): a casual variant could itself be a phrase item that counts as meeting its words and patterns.
- **Building it:** AI-written in batches at build time, with reviewer passes like the phrase bank, not generated while learning.

## Open questions
- Which items get variants first: everyday phrases and greetings, or every example sentence?
- Is a variant something to practise, or only to recognise?
- How should slang that dates quickly be marked or refreshed?
- Per-language scope: start with one language, or define the layer's format for all of them from the start?
