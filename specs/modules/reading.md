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

### 4.3 Reader

The reader MUST:

- Preserve document, section, paragraph, and heading structure.
- Restore the learner's last position.
- Provide chapter selection plus previous and next chapter navigation.
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

Replacing one occurrence MUST preserve canonical chapter text. Adding to the
weave creates a Learning state and immediately substitutes every whole-word
occurrence of that English surface form in every chapter of every book in the
selected language profile. Books imported later MUST apply all tracked weave
items during import.

Translation requests MUST mark the exact selected occurrence and include up to
two surrounding sentences on each side so the AI translates the word's
contextual meaning.

Read aloud MUST select an installed voice matching `zh-CN`, `ja-JP`, or `ko-KR`
and surface an actionable error when no matching voice is available. The popup
MUST provide playback speed from 0.25× through 1.00× in 0.05 increments.

### 4.4 Text settings

The learner MUST be able to choose:

- Active reading technique
- Technique-specific settings
- Font, text size, line height, and theme
- Offline availability

The initial and default technique is `diglot-weave`.

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
