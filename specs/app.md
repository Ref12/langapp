# Language Learning App Specification

## 1. Purpose

The application helps self-directed learners acquire a target language while reading material they already find meaningful. It maintains a shared model of what each learner has encountered, is learning, recognizes, and can recall. Learning modules use that model to deliver different experiences without duplicating progress data.

The first release is a static, client-side web PWA for English readers learning Mandarin, Japanese, or Korean. It is deployed on GitHub Pages, stores data in the browser, and uses one target language per language profile.

The normative top-level entities, ownership boundaries, and relationships are defined in [the data model](data-model.md). The core learner-facing view of tracked items is defined in [the Dictionary specification](dictionary.md). User-supplied AI provider behavior is defined in [the AI connection specification](ai-connection.md), and all application AI calls follow [the transport-independent operation contract](ai-operations.md).

## 2. Requirement language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** express requirement strength.

## 3. Core concepts

### 3.1 Language profile

A language profile binds a user to:

- One source language
- One target language
- Script and romanization preferences
- A default daily new-item budget
- Enabled learning modules and their settings

A user MAY own multiple language profiles. Progress MUST NOT leak between profiles unless a future explicit migration or sharing feature is introduced.

### 3.2 Learning item

A learning item represents a source concept or construction rather than a raw character sequence. It MAY be:

- A single word
- A multi-word expression
- An idiom
- A grammatical construction
- A sentence pattern

Each item MUST have a stable identity, an English source representation, one or more context-aware target variants, provenance, and a target-language pack version.

### 3.3 Target variant

A target variant contains:

- Native-script form
- Romanization when applicable
- English gloss
- Language and script
- Lexical or construction metadata
- Dictionary and analysis provenance
- Accepted contextual constraints

The system MUST support multiple variants for one learning item. It MUST NOT assume one-to-one correspondence between English and the target language.

### 3.4 Occurrence

An occurrence links a learning item and target variant to a stable span in a versioned content block. Occurrences MUST be meaning-aware. Matching source text alone is insufficient to approve a substitution.

When approved occurrences overlap, the longest approved span MUST win unless the learner has explicitly pinned a different choice.

### 3.5 Learning state

An analyzed or eligible item is not part of a user's learning set until a module introduces it or the user explicitly adds it. Untracked candidates have no `UserItemState`, no tier, and no Dictionary entry.

For tracked items, the application exposes three tiers:

| Tier | Definition |
|---|---|
| Learning | Introduced and still dependent on frequent support |
| Familiar | Usually recognized in context |
| Mastered | Reliably recalled across time and task types |

The application MUST also maintain internal confidence and scheduling data. Tier thresholds MUST be centrally configurable.

Evidence strength increases in this order:

1. Reading exposure
2. Help reveal behavior
3. Matching recall
4. Fill-in-the-blank recall
5. Sentence construction

Revealing help indicates uncertainty and MAY reduce confidence slightly. Passive exposure MUST NOT by itself promote an item to Mastered. Mastered MUST require evidence across time and more than one activity type.

Users MUST be able to change a tracked item's tier or reset it to Learning. Automatic and manual changes MUST be auditable.

## 4. Functional requirements

### 4.1 Local workspace and portability

- The MVP MUST work without an account or application server.
- Libraries, language profiles, settings, progress, review history, conversations, and jobs MUST persist in IndexedDB.
- All data MUST be scoped to one stable local workspace ID.
- Users MUST be able to export a complete versioned backup, import a compatible backup, and delete all local application data.
- Cross-device synchronization and authentication are deferred.
- Repository and event interfaces MUST carry stable IDs and versions so a future synchronized server implementation can replace local adapters.

### 4.2 Onboarding

Onboarding MUST collect:

- Target language
- Script and romanization preferences
- Default daily new-item budget
- Enabled starter module

Onboarding SHOULD offer a starter text but MUST allow the learner to continue without one.

### 4.3 Library

The library MUST support:

- Pasted text
- Plain text files
- Markdown files
- EPUB files
- Web-article URLs

Imports MUST be normalized into versioned documents, sections, and semantic blocks. The original input or source URL MUST be retained for provenance.

Import processing MUST expose queued, extracting, analyzing, ready, and failed states. Failures MUST provide an actionable message and retry path.

The library MUST support search, reading progress, language-profile filtering, and analysis status.

### 4.4 Reader

- The reader MUST render original content without losing paragraph and chapter structure.
- Learning modules MUST be able to annotate stable spans without rewriting the stored source.
- Interactive spans MUST support keyboard, touch, pointer, and screen-reader interaction.
- Reader interactions MUST be captured as immutable, idempotent events.
- A learner MUST be able to inspect and correct the learning item associated with an annotated span.

### 4.5 Reviews

The MVP MUST provide:

- Bidirectional word or phrase matching
- Fill-in-the-blank using imported-text context
- Constrained sentence construction from a supplied English meaning

Review activities MUST use shared learning items and MUST emit evidence through the core API. They MUST NOT maintain independent mastery models.

AI MAY provide feedback on constructed answers, but uncertain AI judgments MUST NOT independently promote an item.

### 4.6 Dictionary

The application shell MUST expose a top-level Dictionary tab. Dictionary is a core surface rather than a learning module because it presents shared learning state produced by every module.

Dictionary MUST:

- Show only items with a `UserItemState` for the selected language profile.
- Support words, phrases, idioms, constructions, and sentence patterns.
- Display native form, romanization, English gloss, item type, current tier, confidence explanation, and next review.
- Support search and filters for tier and item type.
- Provide item details with accepted variants, examples, source modules, evidence history, tier history, and corrections.
- Let the learner change a tier or reset an item to Learning.

Eligible or analyzed content candidates MUST NOT appear until introduced or explicitly added.

The complete Dictionary behavior is defined in [the Dictionary specification](dictionary.md).

### 4.7 Progress

The progress surface MUST show:

- Item counts by visible tier
- Reviews due
- Daily new-item budget used and remaining
- Recent tier changes
- Per-item history and corrections

The system SHOULD explain why an item changed tiers. It MUST NOT reduce all progress to a single opaque score.

### 4.8 AI connection

The Settings surface MUST let each local workspace configure an OpenAI-compatible API base URL, API key, and model. The connection persists in IndexedDB on that browser.

The application MUST warn that a static browser application cannot securely protect a persisted API key from malicious code executing on the same origin. It MUST provide an explicit connection test that uses synthetic content. AI-backed features use the connection through the core AI operation gateway; modules MUST NOT access the key directly.

The complete behavior is defined in [the AI connection specification](ai-connection.md).

The client and modules MUST call named, schema-validated AI operations. The MVP executes them in the browser; a future release will move the same contracts to curated server functions. Modules MUST NOT call the provider adapter directly. The complete operation contract is defined in [the AI operations specification](ai-operations.md).

### 4.9 Offline behavior

- The PWA MUST cache the application shell.
- A learner MUST be able to explicitly cache opened or selected reading content.
- Reader interactions performed offline MUST persist immediately with immutable IDs.
- Importing, editing imported content, and AI analysis MAY require connectivity in the MVP.

### 4.10 Deployment

- The production MVP MUST be a static GitHub Pages deployment.
- Client routing MUST work beneath a repository base path without server rewrites.
- Build artifacts MUST contain no API keys or user-specific configuration.
- The deployment MUST use HTTPS, a restrictive Content Security Policy where GitHub Pages permits it, pinned dependencies, and no third-party scripts that can read application storage.

## 5. Modular architecture

### 5.1 Learning modules

A `LearningModule` MUST declare:

- Stable ID and semantic version
- Display metadata, including its top-level label and icon key
- Supported core contract version
- Required language-pack capabilities
- Profile setup and settings schema
- A namespaced route tree
- Document preparation hooks
- Reader annotation and interaction handlers
- Optional review generators
- Required AI operation IDs
- Optional background jobs, commands, and event subscribers
- Module-owned migrations and typed repositories
- Data migration hooks for module-owned state

The core MUST expose content, learner state, daily budgets, evidence recording, and review scheduling through typed services. It MUST NOT depend on module-specific UI or selection rules.

The Dictionary is part of the core shell and MUST read the shared learning-state model. Modules add items and evidence through core services; they MUST NOT create private user dictionaries.

The application MUST provide a `defineLearningModule` SDK and a common contract test harness. A module implementation MUST be self-contained under its module package and MUST access core state only through the SDK.

The build MUST discover first-party module entry points and generate a validated registry. The application shell MUST derive top-level module navigation from that registry. A generic module host route MUST dispatch the logical `/modules/{moduleId}/...` path to the module's route contribution. The GitHub Pages MVP represents these routes beneath the URL hash.

Adding a conforming first-party module MUST require only:

1. Its specification under `specs/modules/`
2. Its implementation package under the designated modules directory
3. Generated registry and migration artifacts

It MUST NOT require handwritten edits to core navigation, routing, shared state reducers, background workers, or feature-specific database repositories. If a requested module needs a capability that the SDK does not expose, that capability MUST be added as a general, versioned core contract rather than as a module-specific exception.

Module IDs, routes, settings, jobs, events, and persisted data MUST be namespaced. The build MUST reject duplicate IDs, incompatible contract versions, route conflicts, invalid icon keys, and undeclared capability use.

The MVP supports compiled first-party modules. Loading arbitrary third-party executable code is out of scope.

### 5.2 Learning techniques

A learning technique is a reusable, non-navigable strategy consumed by one or more modules. It MUST declare a stable ID, semantic version, settings schema, required capabilities, transformation operations, interaction mappings, and evidence mappings.

Techniques MUST NOT contribute top-level navigation or standalone routes. The build discovers them into a typed registry in the same manner as modules. The shared `diglot-weave` technique is consumed by both Reading and Conversation.

### 5.3 Language packs

A `LanguagePack` MUST provide:

- Language and script metadata
- Text normalization
- Tokenization or morphological segmentation
- Dictionary lookup
- Romanization
- Target-form validation
- Source-to-target alignment validation
- Display rules

Language-pack output MUST be versioned. Reprocessing with a new version MUST preserve prior reading and evidence history.

### 5.4 Importers

A `ContentImporter` MUST normalize one supported source type into the common document model. It MUST preserve stable source offsets and return explicit validation or extraction errors.

### 5.5 Analysis providers

An `AnalysisProvider` MUST return schema-validated contextual proposals. Provider-specific APIs, prompts, limits, and billing MUST remain behind adapters.

Generated output MUST retain provider and model provenance. Unsupported or low-confidence output MUST be rejected or flagged rather than silently accepted.

The initial provider MUST use the local workspace's active OpenAI-compatible connection. MVP requests execute in the browser behind the operation gateway. Modules receive typed operations and MUST NOT access connection details.

### 5.6 AI operations

The core MUST expose a curated registry of named AI operations with typed input/output schemas, caller capability rules, provider capability requirements, usage limits, timeouts, and audit policy.

Clients and modules MUST call these operations rather than the provider adapter directly. The MVP uses a browser transport. A future server transport MUST implement the same contracts.

### 5.7 Review activities

A `ReviewActivity` MUST define:

- Supported learning item types
- Prompt generation
- Answer normalization and validation
- Evidence strength
- Accessible rendering metadata

## 6. Initial language support

| Language | Initial script | Initial romanization | Required language behavior |
|---|---|---|---|
| Mandarin | Simplified Chinese | Pinyin with tone marks | Segmentation and contextual sense validation |
| Japanese | Kanji and kana | Hepburn | Morphological tokenization and inflection handling |
| Korean | Hangul | Revised Romanization | Morphological tokenization and lemma handling |

Script and romanization preferences MUST live on the language profile so later alternatives do not require a new learning-item model.

## 7. Processing and data integrity

1. Importers extract normalized blocks with stable offsets.
2. Analysis providers propose contextual source spans and target variants.
3. Language packs and dictionary sources validate forms, romanization, and alignment.
4. Low-confidence proposals are rejected or queued for review.
5. Approved occurrences become available to modules.
6. User corrections create a new version; they MUST NOT mutate historical evidence.

Jobs MUST be idempotent and retryable. Derived records MUST identify the document, analysis, module, and language-pack versions that produced them.

## 8. Security, privacy, and accessibility

- Imported libraries MUST be private by default.
- Rendered content MUST be sanitized.
- URL imports MUST require HTTPS, obey browser CORS, sanitize extracted content, and enforce response-size and timeout limits where browser APIs permit.
- Uploads MUST enforce allowed types and size limits.
- Sending content to an AI provider MUST follow explicit privacy settings and retain auditable provider usage.
- User-supplied AI keys MUST use IndexedDB rather than localStorage, remain inaccessible through module APIs, and be excluded from logs and default exports.
- The UI MUST explicitly state that browser persistence is not a secure secret store.
- AI endpoints and web imports are subject to browser CORS and mixed-content policy.
- Interactive learning content MUST meet WCAG 2.2 AA expectations for keyboard access, focus, labels, contrast, reduced motion, and non-color state cues.

## 9. Module index

- [Reading](modules/reading.md) — reading imported material with pluggable reading techniques; the initial technique is deliberate diglot weaving.
- [Conversation](modules/conversation.md) — locally persisted AI conversations whose assistant messages can use the shared diglot weave technique.

## 10. MVP exclusions

- Native mobile clients
- Non-English source languages
- Speech recognition and pronunciation scoring
- Classroom, teacher, and social features
- Community content distribution
- Runtime installation of third-party modules
- Unconstrained essay grading
- Redistribution of imported copyrighted material

## 11. System acceptance criteria

The MVP is acceptable when a learner can:

1. Create separate Mandarin, Japanese, or Korean profiles.
2. Import content through every supported source type.
3. Read normalized content through an enabled learning module.
4. Open Dictionary and see only the selected profile's tracked items with their Learning, Familiar, or Mastered tier.
5. Save and test an OpenAI-compatible API URL, key, and model after acknowledging the browser-storage warning.
6. Start an AI conversation and receive an assistant response with eligible target-language items woven into it.
7. Complete all three review activities and see explainable tier changes.
8. Use reading content and prior conversations offline while online-only actions remain clearly disabled.
9. Correct an analyzed item without losing historical evidence.
10. Export a backup, restore it into a clean local workspace, and delete all local data.
