# Learning Module Authoring Contract

This document defines how a module specification maps to an implementation. The goal is that a request to “implement this module” can be completed inside a new module package, with the application shell automatically exposing its top-level icon and routes.

## Required specification sections

Every module specification MUST define:

1. Purpose and learner outcome
2. Manifest identity and navigation contribution
3. Required core and language-pack capabilities
4. Profile settings and defaults
5. Owned routes and user flows
6. Domain behavior and invariants
7. Core data read and write requirements
8. Module-owned data and migrations
9. Jobs, commands, and event subscriptions
10. Required curated AI operations
11. Evidence and review integration
12. Offline and synchronization behavior
13. Failure handling
14. Privacy, security, and accessibility requirements
15. Acceptance criteria

## Implementation package

A module package MUST contain:

```text
modules/<module-id>/
  index.ts
  manifest.ts
  routes/
  components/
  operations/
  jobs/
  events/
  data/
    migrations/
    repositories/
  tests/
```

Folders with no contribution MAY be omitted. `index.ts` MUST export exactly one module definition created through `defineLearningModule`.

## Manifest contract

The manifest MUST declare:

- Stable module ID
- Semantic version
- Supported core contract range
- Display label, description, and icon key
- Navigation order or group
- Route contribution
- Required capabilities and permissions
- Settings schema and defaults
- Optional jobs, commands, event subscribers, and migrations
- Required AI operation IDs

The icon MUST come from the core-approved icon catalog so the shell can render it without importing module UI code into core navigation.

## Discovery and registration

- A build step MUST discover module entry points under the designated modules directory.
- Discovery MUST generate a typed registry; runtime filesystem scanning is not required.
- The registry MUST be the only integration point used by navigation, the generic module host route, workers, commands, and event dispatch.
- Generated registry files MAY change when a module is added. Handwritten core files MUST NOT.
- Registry generation MUST be deterministic and checked in CI for drift.

## Isolation rules

- Modules MUST consume core behavior through versioned SDK services.
- Modules MUST NOT import core database clients, authentication internals, shell state, or another module's private code.
- Modules MUST NOT call AI providers directly or use a generic prompt proxy; they call declared AI operations through the active transport.
- Cross-module coordination MUST use core domain records or declared events.
- Module routes, settings keys, event names, job names, and database objects MUST be namespaced by module ID.
- Module failures MUST be isolated so one disabled or incompatible module does not prevent the core application from starting.
- A module MUST declare every privileged capability it uses. The registry validator MUST reject undeclared use where static validation is possible.

## Persistence

- Shared concepts such as the local workspace, profiles, documents, learning items, evidence, and review schedules belong to core.
- Feature-specific records belong to the module and are accessed through module-owned typed repositories.
- Module migrations MUST be ordered, reversible where practical, and tracked by module ID and version.
- Disabling a module MUST preserve its data unless the user explicitly requests deletion.
- Uninstall and data-delete behavior MUST be declared before third-party modules are supported.

## UI integration

- The shell derives the top-level label and icon from the manifest.
- All module pages live beneath `/modules/<module-id>`.
- The generic module host resolves the module and delegates route rendering; the GitHub Pages MVP places the logical route beneath the URL hash.
- Shared shell components MAY be consumed through the SDK design system.
- Modules MUST NOT alter global navigation, global styles, or shell state directly.
- Module UI MUST meet the application's accessibility and responsive-design requirements.

## Background behavior

- Jobs and event subscribers MUST be declared in the manifest.
- The core Web Worker or local dispatcher discovers handlers from the generated registry.
- Handlers MUST be idempotent and identify their module version.
- Failures MUST be observable and retryable according to the core job policy.
- A module MUST NOT start unmanaged background processes.

## Testing contract

Every module MUST pass:

- Manifest schema and compatibility validation
- Route and namespace conflict checks
- Shared module contract tests
- Migration and repository tests
- Capability and workspace-isolation tests
- Job idempotency tests
- Module-specific acceptance tests from its specification
- A shell integration test proving its top-level entry and root route load without core feature edits

## Core-change rule

Implementing a conforming module is complete only when:

- All handwritten changes are confined to the module package, its specification, and intentionally shared SDK improvements.
- Registry or migration-index changes are generated.
- The top-level icon and routes appear from the manifest.
- No module-name conditional or module-specific import is added to core feature code.

If implementation reveals a missing core capability, the change MUST be framed as a reusable SDK capability, documented in the application specification, versioned, and tested with a generic fixture module before the product module depends on it.
