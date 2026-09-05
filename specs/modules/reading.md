# Reading Module Specification

## 1. Purpose

The `reading` module lets learners import, organize, and read long-form content through learning techniques. Its initial technique is [diglot weave](../techniques/diglot-weave.md).

The module owns the Reading user experience. The core owns normalized content, learning items, evidence, reviews, and the user's Dictionary.

## 2. Package contribution

The module MUST be a self-contained first-party package registered through `defineLearningModule`.

Its manifest MUST contribute:

- Module ID: `reading`
- A top-level `Reading` label and icon key
- Routes beneath `/modules/reading`
- Profile and per-document settings schemas
- Required content, technique, language-pack, and AI-operation capabilities
- Reading-progress repositories and migrations
- Import, analysis, and local processing jobs
- Reader interaction event handlers

The shell, host route, worker, and event dispatcher MUST discover these contributions from the generated registry without reading-specific imports or conditionals.

## 3. Dependencies

The module requires:

- Core library and normalized-document services
- Language profiles and learning state
- Evidence and daily-introduction services
- Importer registry
- Technique registry
- Language-pack registry
- Curated AI operations through the transport-independent dispatcher
- Local immutable event persistence

The MVP requires the `diglot-weave` technique.

## 4. Routes and flows

### 4.1 Reading home

The module root MUST show:

- The selected language profile
- Recently opened texts
- Reading progress
- Import status
- Search and filters
- Actions to import or resume a text

### 4.2 Import

The module MUST support paste, plain text, Markdown, EPUB, and web URL sources through core importers. It MUST show queued, extracting, analyzing, ready, and failed states with retryable errors.

Imports MUST preserve chapter boundaries:

- EPUB spine entries become ordered chapters with extracted headings.
- Markdown level-one and level-two headings become chapter boundaries.
- Plain text recognizes explicit `Chapter`, `Part`, or `Book` headings.
- Content with no chapter markers becomes one chapter.

Each chapter keeps independent analysis state and annotations.
AI analysis accepts up to 128,000 chapter characters per operation. Chapters
over 120,000 characters MUST be split at stable sentence or paragraph
boundaries while preserving source offsets and prompt headroom. A failed
analysis message MUST report the full chapter length, chunk number, and
attempted chunk length.

Analyzing a chapter MUST:

1. Count English word occurrences locally.
2. Exclude common English stopwords and items already tracked by the profile.
3. Rank up to 25 content words by descending chapter frequency.
4. Request context-aware target forms, romanization, and glosses for those
   candidates.
5. Show the candidates with their chapter occurrence counts.
6. Require the learner to select candidates before adding anything to the
   weave or Dictionary.

Selecting more candidates than the remaining daily introduction budget MUST
require an explicit one-day override confirmation.

### 4.3 Reader

The reader MUST:

- Preserve document, section, paragraph, and heading structure.
- Restore the learner's last position.
- Provide chapter selection plus previous and next chapter navigation.
- Persist the active chapter and approximate scroll position for each book.
- Let the learner create, revisit, and delete bookmarks.
- Apply the selected learning technique to stable content spans.
- Keep canonical source content separate from derived annotations.
- Support keyboard, touch, pointer, and screen-reader interaction.
- Record reading progress and technique interactions idempotently.
- Let the learner activate any unmodified English word.

Activating an English word MUST request a context-aware target translation and
show native form, romanization, and the English contextual equivalent. The
popup MUST offer:

- Read aloud using the browser's target-language speech voice
- Replace this occurrence only
- Add the item to the ongoing weave and shared Dictionary
- Independently show or hide romanization and the English equivalent in replacements

Replacing one occurrence MUST preserve canonical chapter text. Adding to the
weave creates a Learning state and immediately substitutes every whole-word
occurrence of that English surface form in every chapter of every book in the
selected language profile. Books imported later MUST apply all tracked weave
items during import.

Tracked learning state is the rendering source of truth. Every time reading
content is shown—currently open, revisited, or newly imported—the reader MUST
overlay all globally tracked weave items even if persisted annotations are
missing or stale.

Translation requests MUST mark the exact selected occurrence and include up to
two surrounding sentences on each side so the AI translates the word's
contextual meaning.

Read aloud MUST select an installed voice matching `zh-CN`, `ja-JP`, or `ko-KR`
when the browser exposes one. Android browsers that return an empty voice list
MUST still request playback synchronously with the target language tag so the
system TTS engine can choose a voice. The popup MUST provide playback speed from
0.25× through 1.00× in 0.05 increments and show actionable Android language-pack
instructions when playback reports that the language or voice is unavailable.

### 4.4 Text settings

The learner MUST be able to choose:

- Active reading technique
- Technique-specific settings
- Font, text size, line height, and theme
- Offline availability

The initial and default technique is `diglot-weave`.

### 4.5 Immersion mode

The reader MUST offer `Weave` and `Immersion` modes per book and remember the
selected mode.

Entering Immersion mode MUST send the complete chapter text to the curated AI
operation in bounded chunks and request a structured, fully translated result.
The result MUST preserve paragraph order and provide target text,
romanization, contextual English meaning, punctuation, and spacing for every
lexical unit. Completed translations are cached on the chapter.

Proper names MUST remain in their original Latin spelling. The client supplies
detected names to the AI and defensively restores the original spelling when a
returned token's English annotation identifies one of those names.

Long translations MUST use compact tuple-based annotation JSON in bounded
chunks with at most three provider requests
in flight. Each request MUST time out, progress MUST report completed chunks,
partial translated blocks MUST persist as they complete, and the learner MUST
be able to cancel the remaining work. Common malformed model JSON MUST be
repaired locally before the chunk is treated as failed; unrecoverable errors
MUST report the response length and preserve completed chunks.
Provider tuple variations such as blank punctuation glosses or extra trailing
separator fields MUST be normalized rather than failing the entire chunk.
Transient, empty, or malformed chunk responses MUST retry up to three times.
Retrying a failed chapter MUST resume missing chunks from persisted partial
results; an explicit refresh of a completed translation MAY rebuild all chunks.

Immersion mode MUST initially show both romanization and English meaning for
each target-language unit. Activating a unit opens the standard word popup with:

- Native target form
- Romanization
- Contextual English meaning
- Exact target-form occurrence count in the translated chapter
- Read aloud and speed controls
- Independent romanization and English visibility controls
- An explicit Add to weave action when the item is not tracked

Hiding either romanization or English for an untracked unit MUST add that item
to the profile's global weave. Later changes to those display preferences MUST
apply wherever the tracked item is rendered.

## 5. Diglot weave integration

The Reading module MUST call the shared diglot weave technique rather than implement its own planner or substitution logic.

For each renderable block, Reading supplies:

- Stable document, revision, section, and block IDs
- Canonical source text and offsets
- Language profile
- Current learner-item states
- Previously approved occurrences and corrections
- Module and document technique settings

The technique returns a versioned annotation plan. Reading renders that plan, forwards interactions to the technique, and records resulting evidence through core services.

Introducing an item through Reading creates a core `UserItemState` in the Learning tier and makes the item visible in Dictionary.

## 6. Module-owned data

Reading owns:

- Per-profile and per-document reading settings
- Last position and completion state
- Offline download state
- Selected technique
- Applied annotation-plan references
- Reading-specific correction workflow state

Reading MUST NOT own a separate learning tier, Dictionary, occurrence model, or evidence ledger.

## 7. Failure behavior

- Unavailable techniques MUST leave canonical text readable and show an actionable compatibility error.
- Missing or invalid AI configuration MUST leave text unchanged and link to core AI settings.
- Import or analysis failures MUST retain the source and expose retry details.
- Failed local interaction persistence MUST surface an error rather than appearing saved.
- A document or technique version mismatch MUST trigger compatible reanalysis without discarding reading history.

## 8. Accessibility

- Reader structure MUST remain semantic.
- Technique annotations MUST not fragment screen-reader reading order.
- Interactive spans MUST be keyboard focusable and return focus after overlays close.
- Reading settings MUST support scalable text, adequate line height, contrast, and reduced motion.
- Han characters, kana, Hangul, Latin text, and romanization MUST render with appropriate fallback fonts.

## 9. Acceptance criteria

The Reading module is acceptable when:

1. Its icon, routes, jobs, settings, and migrations appear through its manifest without handwritten core feature changes.
2. A learner can import every supported source type and resume reading.
3. Canonical document content remains unchanged when techniques are applied or upgraded.
4. The shared diglot weave technique annotates reading blocks and records interactions.
5. Introduced items appear in the core Dictionary.
6. Reading position and settings persist across reloads in the same browser.
7. Cached texts remain readable offline and interactions persist without duplication.
8. Technique or AI failures degrade to readable original content.
9. EPUB and marked-up text imports preserve ordered chapter navigation.
10. Selecting an English word opens context-aware translation details.
11. Read aloud uses the appropriate Mandarin, Japanese, or Korean speech tag.
12. “Replace here” affects only the selected occurrence, while “Add to weave”
    creates a shared Learning item.
13. “Add to weave” updates matching occurrences in the current chapter, other
    chapters, all existing books, and books imported later.
14. A tracked item's popup can independently show or hide romanization and the
    English equivalent across all replacements.
15. Reopening a book restores its last chapter and approximate scroll position.
16. Bookmarks can be added, revisited, and deleted.
17. Chapter analysis presents at most 25 frequent content words with occurrence
    counts and does not add them until selected.
18. Immersion mode fully translates and annotates a chapter through a structured
    AI operation and caches the result.
19. Immersion word popups show chapter occurrence counts and add words to the
    global weave when either learning aid is hidden.
