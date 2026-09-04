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

### 4.3 Reader

The reader MUST:

- Preserve document, section, paragraph, and heading structure.
- Restore the learner's last position.
- Apply the selected learning technique to stable content spans.
- Keep canonical source content separate from derived annotations.
- Support keyboard, touch, pointer, and screen-reader interaction.
- Record reading progress and technique interactions idempotently.

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
