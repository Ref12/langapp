# Dictionary Specification

## 1. Purpose

Dictionary is the learner's cross-module record of words, phrases, idioms, constructions, and sentence patterns they are actively learning or already know. It provides one place to inspect knowledge state regardless of which module introduced or reviewed an item.

Dictionary is a core top-level tab, not an optional learning module. Its route is `/dictionary`, and the application shell owns its navigation entry.

## 2. Membership

An item appears in Dictionary only when a `UserItemState` exists for the selected language profile.

A state is created when:

- A learning module introduces an item.
- The learner explicitly adds an item.

An analyzed candidate or unchanged source word is not tracked. It has no tier and MUST NOT appear in Dictionary merely because it occurs in imported content.

Dictionary membership is profile-specific. Learning the same item in another profile does not automatically add or tier it in the current profile.

## 3. Knowledge tiers

Dictionary exposes exactly three tracked tiers:

| Tier | Meaning |
|---|---|
| Learning | The learner still needs frequent support or has only recently started the item |
| Familiar | The learner usually recognizes the item in context |
| Mastered | The learner recalls the item reliably across time and activity types |

The visible tier is a projection of evidence and any manual override. Internal confidence and scheduling values MAY be more granular but MUST be explained through the visible tier and evidence history.

The learner MUST be able to:

- Change an item's tier manually.
- Reset an item to Learning.
- See whether the current tier was derived automatically or manually overridden.

Every change MUST create a tier-transition record.

## 4. List view

The default view MUST show the selected language profile and one row or card per tracked item.

Each entry MUST show:

- Target native form
- Romanization when applicable
- Primary English gloss
- Item type
- Current tier
- A concise confidence explanation
- Next review state

The list MUST support:

- Search by native form, romanization, and English gloss
- Filtering by tier
- Filtering by item type
- Sorting by recently added, recently practiced, alphabetical form, tier, and next review
- Switching language profiles without combining their state

The empty state MUST explain that items appear after a module introduces them or the learner explicitly adds them.

## 5. Item detail

An item detail view MUST include:

- Canonical source concept or construction
- Accepted target variants
- Native forms, scripts, romanizations, and glosses
- Current tier and internal confidence explanation
- Next review and recent review results
- Example occurrences from the learner's library
- Modules that introduced or produced evidence for the item
- Evidence and tier-transition history
- Learner corrections

Examples MUST respect library ownership and MUST link back to the relevant reading position when the source module supports it.

## 6. Actions

Dictionary MUST support:

- Manual tier change
- Reset to Learning
- Open the next due review for the item
- Open a source example
- Correct a target variant or gloss through the shared correction flow

Bulk editing and permanent removal from the learning set are deferred until their effects on evidence, review history, and module behavior are specified.

## 7. Relationship to modules

- Modules add tracked items only through the core learning-state service.
- Modules emit evidence through the core evidence service.
- Modules MAY deep-link to an item's Dictionary detail.
- Dictionary MUST show source-module provenance without depending on module-private storage.
- Modules MUST NOT maintain a separate user-visible dictionary or competing tier state.
- Disabling a module MUST NOT remove shared Dictionary items or their evidence.

## 8. Offline and future synchronization behavior

- Previously loaded Dictionary pages SHOULD remain readable offline.
- Tier changes MUST persist locally with immutable event IDs.
- Search MUST work against IndexedDB while offline.
- The data interfaces MUST preserve event IDs and record versions for future synchronization.

## 9. Accessibility

- Every tier MUST have a text label and MUST NOT rely on color alone.
- Search, filters, sorting, item actions, and profile switching MUST be keyboard accessible.
- Native form, romanization, gloss, and tier MUST have clear screen-reader labels.
- Tables and card layouts MUST preserve logical reading order at all supported viewport sizes.

## 10. Acceptance criteria

Dictionary is acceptable when:

1. An analyzed but unintroduced candidate does not appear.
2. Introducing an item creates a Learning entry.
3. The same item may have independent state in different language profiles.
4. Search finds native forms, romanizations, and English glosses.
5. Filters return only the selected tiers and item types.
6. Item detail shows variants, source examples, module provenance, evidence, and tier history.
7. Automatic and manual tier changes are distinguishable.
8. Resetting an item changes it to Learning and records the transition.
9. Disabling the module that introduced an item does not remove it.
10. Offline tier changes survive reloads and do not create duplicate events.
