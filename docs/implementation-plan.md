# Language Learning App Implementation Plan

This plan implements the product requirements in [the application specification](../specs/app.md), [the top-level data model](../specs/data-model.md), [the AI operations specification](../specs/ai-operations.md), [the AI connection specification](../specs/ai-connection.md), [the core Dictionary specification](../specs/dictionary.md), and the initial [Reading](../specs/modules/reading.md) and [Conversation](../specs/modules/conversation.md) module specifications.

## Technical baseline

- Vite, React, and TypeScript single-page application
- Static GitHub Pages deployment and installable PWA
- IndexedDB persistence through typed repositories
- Browser Web Workers and a durable local job queue for extraction and analysis
- Hash routing so deep links work without server rewrites
- Build-time discovered first-party module packages and language packs for the MVP

The core application owns the local workspace, library, learner profiles, learning items, progress evidence, review scheduling, AI operation boundary, and module SDK. Learning modules consume those services without placing module-specific behavior in the core. A new module contributes its manifest, navigation icon, routes, settings, jobs, storage migrations, and tests from its own package. The host discovers those contributions at build time, so adding a module requires no handwritten feature changes to the core.

The MVP is entirely client-side. Repositories, jobs, AI operations, identity, and synchronization use transport-independent interfaces so later server implementations can replace local adapters without rewriting modules.

## Implementation phases

### 1. Platform foundation

- Scaffold the Vite React TypeScript PWA and establish formatting, linting, type-checking, and test commands.
- Add hash routing, GitHub Pages base-path handling, a web manifest, service worker, and automated Pages deployment.
- Add IndexedDB schema versioning, typed repositories, backup export/import, and local reset.
- Build a local-workspace application shell with onboarding, navigation, and error handling.

### 2. Core domain and extension contracts

- Define the relational model for users, language profiles, content, learning items, variants, occurrences, evidence, reviews, and module state.
- Define typed contracts and registries for:
  - `LearningModule`
  - `LanguagePack`
  - `ContentImporter`
  - `AnalysisProvider`
  - `ReviewActivity`
- Build a `defineLearningModule` SDK, manifest schema, module test harness, and module scaffold.
- Build a non-navigable `defineLearningTechnique` contract and generated technique registry for reusable strategies such as diglot weave.
- Generate the first-party module registry from module entry points during the build.
- Add one generic `/modules/[moduleId]/[[...path]]` host route and derive top-level navigation from each module manifest.
- Let modules contribute namespaced settings, jobs, migrations, commands, and event handlers without editing core feature code.
- Reject duplicate IDs, incompatible contract versions, undeclared capabilities, route conflicts, and invalid icons during the build.
- Add immutable interaction and evidence events with idempotency keys.
- Add versioning for documents, analyses, modules, and language packs.
- Define a curated AI operation registry with typed inputs, typed outputs, caller capabilities, usage policy, and audit metadata.
- Put transport behind the operation dispatcher: direct browser execution for the MVP and a future authenticated server-function transport.

### 3. Initial language packs

- Implement a Mandarin pack with Simplified Chinese, pinyin with tone marks, word segmentation, and dictionary-backed sense validation.
- Implement a Japanese pack with kanji/kana, Hepburn romanization, morphological tokenization, and inflection-aware dictionary validation.
- Implement a Korean pack with Hangul, Revised Romanization, morphological tokenization, and lemma-aware dictionary validation.
- Add versioned golden corpora covering segmentation, alignment, romanization, punctuation, and overlapping phrases.

### 4. Library import pipeline

- Support pasted text, `.txt`, `.md`, EPUB, and web-article URLs.
- Normalize all formats into documents, sections, and semantic blocks with stable source offsets.
- Preserve originals or source URLs and create versioned derived content.
- Process imports in browser workers with queued, extracting, analyzing, ready, and failed states.
- Sanitize rendered content and document that URL import works only when the source permits browser CORS; provide paste or upload as fallback.

### 5. Language analysis pipeline

- Add a Settings form for an OpenAI-compatible API base URL, masked API key, and model.
- Persist the connection in IndexedDB with a warning that browser storage cannot securely protect a key from code running on the same origin.
- Implement HTTPS URL validation, browser-CORS diagnostics, and a synthetic connection test.
- Implement the browser OpenAI-compatible adapter behind the AI operation gateway so modules never access credentials or arbitrary provider requests.
- Implement initial operations for contextual text analysis, target-variant proposal, answer evaluation, and conversational turn generation.
- Generate context-aware source spans and target-language variants through schema-validated AI output.
- Validate generated forms, romanization, and senses through the active language pack and dictionary sources.
- Persist confidence, provenance, analysis version, and validation results.
- Keep ambiguous or unsupported candidates out of automatic weaving.
- Support user corrections and versioned reanalysis.

### 6. Shared diglot weave technique

- Implement diglot weave as a reusable, non-navigable technique package.
- Add deterministic candidate ranking, daily introduction budgets, one-day overrides, explicit “learn this” actions, meaning-aware substitution, overlap rules, layered help, and evidence mappings.
- Prove the technique contract against module-neutral text fixtures.

### 7. Reading module

- Implement the Reading module as a self-contained package according to its module specification and the shared module authoring contract.
- Register its top-level icon, route tree, settings, background jobs, migrations, and event handlers through its manifest.
- Consume diglot weave as the module's initial reading technique.
- Build the library, import, reader, reading-progress, text-settings, and offline-reading surfaces.
- Preserve chapter structure from EPUB, Markdown, and explicit text headings, with per-chapter analysis and navigation.
- Support context-aware English word selection with read aloud, one-occurrence replacement, and explicit addition to the ongoing weave.
- Reuse introduced items in all validated later occurrences, including lazily refreshed existing documents.

### 8. Conversation module

- Implement the Conversation module as a self-contained package with top-level navigation and routes.
- Build locally persisted chat threads and messages with streaming or progressive response status, retry, edit-and-resend, and deletion.
- Generate assistant turns through the curated `conversation.generateTurn` AI operation.
- Preserve canonical assistant text and apply the shared diglot weave technique as a versioned presentation plan.
- Use the same daily introduction budget, learning state, Dictionary, and evidence services as Reading.
- Expose only approved, bounded AI operations to the module.

### 9. Reviews and progress

- Implement matching, fill-in-the-blank, and constrained sentence-construction activities.
- Add scheduling that balances recognition and production.
- Derive internal confidence and the visible Learning, Familiar, and Mastered tiers from immutable evidence.
- Require evidence over time and across review modes before Mastered.
- Add the core Dictionary tab for searching and filtering the user's tracked learning items, inspecting variants and history, and changing tiers.
- Add manual tier changes, resets, progress summaries, due counts, and item history.

### 10. PWA and end-to-end flows

- Cache the application shell and explicitly opened or downloaded reading content.
- Persist interactions locally by immutable event ID.
- Keep imported and generated content available offline; AI calls and URL imports require connectivity.
- Complete onboarding, library, reader, review, progress, and settings flows.

### 11. Production hardening

- Complete local-data privacy, API-key warning, upload, CORS failure, and content-sanitization reviews.
- Add accessibility coverage for reader interactions and review activities.
- Add local diagnostics, job status, and AI usage summaries without retaining prompt content.
- Add backup import/export, local data deletion, schema recovery, and GitHub Pages deployment procedures.

## Dependency order

1. Platform foundation precedes persisted feature work.
2. Core contracts and the domain model precede language packs, imports, analysis, the reader, and reviews.
3. The module and technique SDKs, generated registries, and generic host route precede implementation of any learning module.
4. The transport-independent AI operation gateway precedes any module AI calls.
5. Language packs and normalized imports both precede AI-assisted analysis.
6. Analysis and learner-item state precede the shared diglot weave technique.
7. The diglot weave technique precedes Reading and Conversation integration.
8. Stable module interactions and evidence precede final review scheduling and progress reporting.
9. Future synchronization contracts are proven against immutable local interaction events.
10. Hardening is continuous, followed by a focused pass over the complete end-to-end system.

## Initial data boundaries

The complete logical model and ownership rules are defined in [the top-level data model](../specs/data-model.md).

- Workspace: local workspace identity, preferences, schema version, and future synchronization metadata.
- Learning: language profiles, learning items, target variants, user-item state, tier history, evidence events, review schedules, and attempts.
- Content: library items, source files or URLs, document revisions, sections, blocks, analysis jobs, occurrences, and corrections.
- Modularity: module manifests and versions, profile-module settings, language-pack versions, and typed module state.
- Operations: idempotent jobs, import failures, AI usage and cost metadata, and audit timestamps.

All private data is scoped to the local workspace ID. Repository constraints must protect span and state integrity. Browser jobs and event replay must be idempotent.

## Verification strategy

- Unit tests for tier transitions, evidence weighting, daily caps and overrides, candidate ranking, sense disambiguation, span overlap, display toggles, and idempotent replay.
- Golden language tests for Mandarin segmentation and pinyin, Japanese inflection and romanization, Korean morphology and romanization, punctuation, and mixed-script display.
- Contract tests for every language pack, importer, analysis provider, module, and review activity.
- Integration tests for all import formats, workspace isolation, job retries, corrections, versioning, backup restore, and schema migration.
- End-to-end tests for onboarding, import, first weave, reveals, “learn this,” cap overrides, later substitutions, all review types, tier movement, and offline replay.
- Accessibility checks for keyboard use, screen readers, focus, reduced motion, contrast, and non-color state cues.

## MVP boundaries

Included:

- English source texts
- One target language per profile and text
- Mandarin, Japanese, and Korean language packs
- Local browser profiles and progress in IndexedDB
- A locally persisted OpenAI-compatible API URL, key, and model with an explicit browser-storage warning
- Curated, typed AI operations with a replaceable future server transport
- Paste, text/Markdown, EPUB, and URL imports
- Deliberate diglot weaving
- Reading and Conversation modules that share the diglot weave technique
- Three visible tiers for tracked items, with unintroduced candidates excluded from the user's learning set
- A core Dictionary tab for the user's tracked words, phrases, and constructions
- Matching, fill-in-the-blank, and sentence-construction reviews
- Installable PWA with limited offline reading

Deferred:

- Native mobile applications
- Arbitrary source languages
- Speech recognition and pronunciation grading
- Social and classroom features
- A community content marketplace
- Arbitrary third-party runtime plugins
- Full free-form essay grading
- Redistribution of imported copyrighted texts

## Principal risks

| Risk | Mitigation |
|---|---|
| Incorrect one-to-one translation | Contextual spans, construction-level items, dictionary validation, confidence gates, and user corrections |
| Romanization becoming a crutch | Show it by default only while Learning, then keep it available on demand |
| Too many substitutions harming comprehension | Daily budgets, spacing rules, deterministic planning, and explicit overrides |
| AI inconsistency or cost | Versioned structured output, caching, validation, explicit failures, and provider budgets |
| Browser-stored API key exposure | IndexedDB instead of localStorage, prominent warning, strict CSP, dependency review, no logs or default exports, and an easy clear-key action |
| Opaque automatic mastery | Visible tiers, evidence history, conservative promotion, and manual overrides |
| Browser CORS restrictions | Connection diagnostics and paste/file fallback when an AI endpoint or article source disallows browser access |
| Local data loss | Versioned IndexedDB migrations plus explicit backup export/import |
| Import security or ownership issues | Sanitization, size limits, source attribution, and a private local library |
