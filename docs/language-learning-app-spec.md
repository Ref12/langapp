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
- Search and select a Wikipedia article
- Search and select a Project Gutenberg book or chapter
- Select a chapter, paragraph, passage, or sentence range
- Resume from a saved reading position

The original source text and its document structure must be preserved.

Content integrations should support both dynamically retrieved content and curated
static content. Static collections can provide quality control, reliable
translation preparation, and a simple first-run experience, but they must not be
the only way to access content. Each source should retain attribution, title,
author, and a link back to the original content where applicable.

The app should distinguish between:

- **Dynamic sources**: The user searches for and retrieves a Wikipedia article,
  Project Gutenberg work, or another supported source at the time of use.
- **Curated sources**: The app provides a prepared library of texts with reviewed
  segmentation, translations, audio, or learning metadata.
- **User content**: The user pastes or imports text and the app analyzes it on
  demand.

All three source types should use the same reading modes, learning-item states,
and review system.

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

## 3. Free sample content

The app should provide a set of freely accessible samples so users can try the
complete workflow before importing their own content or creating an account. The
library should range from a few sentences to substantial reading, allowing users
to evaluate both a quick exercise and the long-form book workflow.

Sample length tiers should include:

- **Micro**: one to three sentences for an immediate demonstration
- **Short**: 100 to 500 words, finishable in one session
- **Medium**: 500 to 2,000 words, suitable for a focused reading session
- **Long-form**: multiple sections or chapters for sustained reading and progress
  tracking

Sample categories should appeal to a broad audience:

- Travel and practical everyday situations
- Food, recipes, and local culture
- Nature, animals, and space
- Science and technology explained simply
- History and biographies
- Short public-domain fiction and folklore
- Conversations and common social interactions
- Religious and spiritual texts, available as an opt-in category

Religious and spiritual samples may include selected Bible passages and other
widely read texts from multiple traditions. They should be presented neutrally as
reading material, with tradition, work, edition, translator, and source clearly
identified. The app should avoid implying that any single tradition is the
default or representative of all users.

Samples should be either original app content, public-domain content, or content
used under a clear license. Translation rights must be checked independently from
the rights to the original work; many modern Bible translations and other
religious-text translations remain copyrighted even when the underlying work is
public domain. Every sample should display its attribution, edition, translator,
and source license where applicable.

Each sample should include enough prepared metadata to make the first experience
fast:

- Sentence segmentation
- Target translation
- Candidate vocabulary and phrases
- Audio where available
- Suggested learning percentage
- One-click access to every reading mode

The sample browser should support filtering by language pair, topic, difficulty,
length, tradition where applicable, and content type. A user should be able to
start a sample immediately from the landing page and later save progress or
import additional content.

## 4. Reading modes

The same learned vocabulary and review state should work across multiple reading
modes. Users can switch modes without losing progress.

### 3.1 Dynamic diglot mode

The app progressively substitutes learned target-language words and phrases into
the source text. The user controls the substitution density, and the app can
increase it as learning improves.

### 3.2 Tap-to-translate weave mode

This mode provides a LangSplice-like experience: the passage is displayed in the
target language, and the user taps a word or phrase to see its source-language
equivalent, definition, pronunciation, or example.

Unlike a static content catalog, the mode must work on text the user just pasted,
selected from Wikipedia or Project Gutenberg, or imported from a document. Taps
should contribute to the item's learning history and optionally add it to a
future lesson or review queue.

### 3.3 Source-first assisted reading

The source text remains intact. Tapping a word or phrase opens the target-language
translation and related learning actions without changing the displayed text.
This is useful for users who want comprehension support before enabling weaving.

### 3.4 Target-first reading

The target translation is shown as the primary text, with source-language
equivalents available on demand. This mode is intended for review after the user
has already learned much of the passage.

## 5. Mixed-language reading

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

## 6. Learning item states

Every vocabulary item, phrase, and sentence has an independent learning state:

- **Unseen**: No lesson has been started
- **Introduced**: The translation is available and the item has been presented
- **Practicing**: The item is included in active exercises
- **Learned**: The item may appear in mixed-language reading
- **Mastered**: The item has been retained across delayed reviews

An incorrect answer, repeated hint use, or a long period without review may lower
the state or increase the review priority.

## 7. Spaced repetition

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

## 8. Book and document model

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

## 9. Video learning mode (v2)

The app should eventually apply the same progressive learning approach to videos
with subtitles. A video session should align the audio, subtitle text, source
translation, and learned items at the sentence level.

### 9.1 Video sources and setup

The user should be able to:

- Import a video with subtitle files
- Select an available subtitle track
- Paste or edit subtitle text when alignment needs correction
- Choose source and target languages
- Configure whether target-language subtitles, source-language subtitles, or both
  are initially visible

The app should preserve subtitle timing and support sentence-level playback.
Content rights and platform terms must be respected for imported and streamed
video.

### 9.2 Video learning modes

- **Watch normally**: Play the video with optional tap-to-translate subtitles.
- **Preteach then watch**: Teach selected words, phrases, and sentences before
  playing the corresponding clip.
- **Pause-and-test**: Stop after a sentence or short segment and quiz the user
  before continuing.
- **Progressive subtitle weave**: Show a mixture of source and target-language
  subtitles based on learned items and the selected difficulty.
- **Listening-first**: Hide subtitles initially, then reveal target or source
  text after the user attempts comprehension.

The preteaching requirement should be configurable. Beginner modes may teach all
selected vocabulary before playback, while advanced modes may introduce only
high-priority items and rely more on contextual listening.

### 9.3 Listening exercises

After a sentence or clip, the app should be able to ask:

- What did the speaker say?
- Which target-language word did you hear?
- Select the words that appeared, even without translating the full sentence
- Identify the missing word in the subtitle
- Arrange heard words into the correct order
- Choose the meaning of the sentence
- Type or speak a translation

Word-identification exercises should award partial progress when the user
recognizes words or phrases but cannot yet produce a complete translation. The
app should distinguish listening recognition from translation and speaking
production in the review history.

### 9.4 Playback controls

Video practice should support:

- Replay of the current sentence or clip
- Slower playback
- Looping
- A-B segment replay
- Optional word-level highlighting synchronized to audio
- Separate controls for source and target subtitles
- Reveal, hint, and continue actions

## 10. AI lesson generation (vNext)

The app should support scanning or importing pages from textbooks, workbooks, and
other lessons, then using AI to turn the material into structured practice.

### 10.1 Scan and extract

The user should be able to:

- Capture one or more pages with a camera
- Import page images or PDFs
- Review and correct OCR output
- Identify headings, dialogues, examples, exercises, and answer keys
- Select which sections should become lessons

The original page image and extracted text should remain linked so the user can
verify generated lessons against the source.

### 10.2 Generate structured lessons

From extracted material, the app may generate:

- Word-to-word matching
- Phrase matching
- Sentence matching
- Fill-in-the-blank exercises
- Sentence ordering
- Translation recall
- Listening or pronunciation prompts when audio is available
- Grammar-focused drills

Generated exercises should identify the source passage and allow the user to edit,
reject, or regenerate individual questions before they affect learning progress.

### 10.3 Generate stories

The app may generate short stories, dialogues, or scenarios using:

- Vocabulary from the scanned lesson
- Phrases the user is currently learning
- A selected difficulty and length
- A chosen topic or setting
- Previously mastered items for spaced reinforcement

Generated stories should prioritize natural language and meaningful repetition
over mechanically inserting every vocabulary item. The app should show which
learning items were intentionally reinforced and clearly label generated content
as AI-created.

### 10.4 Reliability, privacy, and rights

OCR and generated lessons require user review because recognition and language
models may introduce errors. The app should preserve confidence indicators,
surface uncertain text, and never silently replace the user's source material.

Scanned textbook pages may contain copyrighted content. The feature should make
clear that the user is responsible for having the right to scan and process the
material. By default, page images and extracted text should remain local unless
the user explicitly enables cloud processing or synchronization.

## 11. MVP scope

The first usable version should support:

1. Free sample browser with several short, rights-safe samples
2. Pasting text
3. Selecting source and target languages
4. Sentence segmentation and translation
5. Choosing a study percentage
6. Vocabulary and phrase lessons
7. Word-pair matching
8. Sentence ordering
9. Fill-in-the-blank exercises
10. Mixed-language reading
11. Tap-to-translate weave reading mode
12. Persistent learning states
13. Basic spaced-repetition review

The first content integrations should support pasted text plus dynamically selected
Wikipedia articles. Project Gutenberg, curated static lessons, and plain-text book
import should follow closely, with EPUB, PDF, web pages, and OCR added later.

## 12. Future enhancements

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
- Video import with subtitle alignment and sentence-level playback
- Listening recognition and partial word-identification exercises
- Speech recognition for spoken answers
- Audio-only review sessions
- Textbook and lesson scanning with OCR
- AI-generated structured exercises
- AI-generated stories and dialogues

## 13. Product principles

- Use meaningful user-selected content as the primary curriculum.
- Prefer natural translations while retaining source-to-target traceability.
- Introduce target-language content gradually rather than replacing everything at
  once.
- Test active recall, not only recognition.
- Preserve user control over translations, substitutions, and study scope.
- Keep learned knowledge available across documents and future reading sessions.
- Treat curated content as an accelerator, not a restriction on what users can read.
