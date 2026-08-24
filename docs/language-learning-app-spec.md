# Language Learning App Specification

## 1. Product vision

This is a reading-first language learning app. A user imports or selects meaningful
source text, translates it into a target language, and progressively learns the
vocabulary, phrases, and sentence patterns needed to understand that text.

The imported text is the curriculum rather than a disconnected collection of
flashcards. As the user learns, more of the reading can be presented in the target
language while unfamiliar content remains in the source language.

## 2. Core workflow

### 2.1 Import or select text

The user can:

- Paste text directly
- Import a book or document
- Select a chapter, paragraph, passage, or sentence range
- Resume from a saved reading position

The original source text and its document structure must be preserved.

### 2.2 Configure a learning session

The user chooses:

- Source language
- Target language
- The percentage of sentences to study
- Whether to prioritize new, difficult, frequent, or user-selected words
- Whether learning should follow reading order or focus on selected passages

The percentage controls which sentences receive an initial lesson. For example,
25% means that approximately one quarter of the selected sentences are actively
taught, while the rest remain available as reading context.

### 2.3 Translate and analyze

The app splits the selection into sentences and useful phrases, then generates:

- A target-language translation
- Word-level alignment where possible
- Candidate vocabulary items
- Multi-word expressions
- Reusable sentence patterns
- Relevant grammar or usage notes

Users can edit translations and dismiss items that should not be taught, such as
names or already-known expressions.

### 2.4 Teach vocabulary

Vocabulary lessons should include:

- Source word
- Target word or words
- Pronunciation and audio
- Part of speech
- Inflections or other relevant morphology
- An example from the imported text
- Familiarity status

### 2.5 Teach phrases and sentences

Phrase and sentence lessons should include:

- Natural translation
- Literal translation when it clarifies meaning
- Audio
- Usage notes
- Sentence structure
- A grammar explanation when useful
- The original location in the imported text

### 2.6 Practice and test

The initial exercise progression is:

1. Recognize a translation
2. Pair source words with target words
3. Choose a missing word or phrase
4. Reorder target-language words into a sentence
5. Construct a translation with hints
6. Type a translation without hints
7. Read the sentence in context

The app should support both source-to-target and target-to-source recall. Scoring
should distinguish an unaided answer from an answer submitted after a hint or
revealing the solution.

## 3. Mixed-language reading

The reading view progressively substitutes learned target-language items into the
source text. Unlearned content remains in the source language.

For example:

> The cat se sento on the mat.

The app should prefer the longest matching learned phrase before matching
individual words. This prevents a learned phrase from being incorrectly fragmented
into separate substitutions.

Users can:

- Toggle mixed-language mode
- Adjust how aggressively learned items are substituted
- Reveal one item, one sentence, or the entire passage
- Reset or downgrade an item
- Exclude names, idioms, or other unwanted substitutions

Occurrences of a learned word or phrase elsewhere in the imported text should be
recognized automatically. The user may configure whether those occurrences appear
in the target language immediately or only after additional practice.

## 4. Learning item states

Every vocabulary item, phrase, and sentence has an independent learning state:

- **Unseen**: No lesson has been started
- **Introduced**: The translation is available and the item has been presented
- **Practicing**: The item is included in active exercises
- **Learned**: The item may appear in mixed-language reading
- **Mastered**: The item has been retained across delayed reviews

An incorrect answer, repeated hint use, or a long period without review may lower
the state or increase the review priority.

## 5. Spaced repetition

Learned items are stored independently of the source document so they can be
reviewed later and reused in other books or passages.

The review queue should record:

- Item type: word, phrase, or sentence
- Source and target forms
- Related text locations
- Review attempts
- Answer quality
- Hint or reveal usage
- Last reviewed timestamp
- Next scheduled review
- Current learning state

Reviews should eventually use varied contexts rather than always showing the
original sentence.

## 6. Book and document model

For an imported book, the app should retain:

- Book metadata
- Chapters or sections
- Paragraphs and sentences
- Reading position
- Sentence-level learning status
- Vocabulary encountered by section
- Overall completion and comprehension progress

The user should be able to learn sequentially, select specific chapters, or focus
on sentences chosen by difficulty or vocabulary criteria.

## 7. MVP scope

The first usable version should support:

1. Pasting text
2. Selecting source and target languages
3. Sentence segmentation and translation
4. Choosing a study percentage
5. Vocabulary and phrase lessons
6. Word-pair matching
7. Sentence ordering
8. Fill-in-the-blank exercises
9. Mixed-language reading
10. Persistent learning states
11. Basic spaced-repetition review

Book and document import can initially be limited to plain text, with EPUB, PDF,
web pages, and OCR added later.

## 8. Future enhancements

- EPUB, PDF, web-page, and ebook-reader imports
- OCR for scanned books
- Text-to-speech and pronunciation scoring
- Adaptive difficulty
- User-editable alternative translations
- Synonyms and inflection-aware matching
- More detailed grammar explanations
- Cross-book vocabulary tracking
- Offline reading and review
- Export to Anki or similar tools
- Progress and comprehension analytics

## 9. Product principles

- Use meaningful user-selected content as the primary curriculum.
- Prefer natural translations while retaining source-to-target traceability.
- Introduce target-language content gradually rather than replacing everything at
  once.
- Test active recall, not only recognition.
- Preserve user control over translations, substitutions, and study scope.
- Keep learned knowledge available across documents and future reading sessions.
