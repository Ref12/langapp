# Diglot Weave Technique Specification

## 1. Purpose

The `diglot-weave` technique deliberately introduces a limited set of target-language words, phrases, and constructions into source-language text, then consistently weaves every validated occurrence of those meanings into current and later content.

Techniques are reusable learning strategies, not top-level application modules. They have no shell navigation or standalone routes. Modules such as Reading and Conversation consume them through the core technique contract while sharing learning state, budgets, and evidence.

The diglot weave technique MUST NOT randomly replace isolated strings. Its substitutions are contextual, persistent, explainable, and tied to the learner's shared learning state.

## 2. Technique contribution

The technique MUST be implemented as a self-contained first-party technique package and registered through a `defineLearningTechnique` contract.

Its definition MUST contribute:

- Technique ID: `diglot-weave`
- Its settings schema and defaults
- Required language-pack and analysis capabilities
- Text preparation and annotation operations
- Interaction and evidence mappings
- Review prompt generators
- Optional background jobs and data migrations

The technique MUST NOT contribute top-level navigation or routes. Consuming modules own their UI and call the technique through typed services. Core workers and event dispatchers invoke declared handlers from the generated technique registry.

Implementing this technique MUST NOT add diglot-specific behavior to core navigation, routing, shared state, review scheduling, or content storage.

## 3. Dependencies

The technique requires these core services:

- Versioned documents and stable content spans
- Language profiles
- Learning items, target variants, and occurrences
- Daily introduction budgets
- Evidence recording and tier state
- Review scheduling
- A language pack with segmentation, dictionary, romanization, normalization, and alignment support
- An analysis provider capable of proposing contextual source spans

## 4. Technique settings

Each consuming module MUST expose these profile settings where applicable:

- Default maximum new items per day
- Native-script preference
- Romanization style
- Whether romanization is initially visible for Learning items
- Whether one-day budget overrides require confirmation
- Optional content difficulty preference

Settings changes MUST affect future rendering without rewriting canonical source content.

## 5. Technique behavior

### 5.1 Candidate analysis

For every analyzed content block, the module MUST receive candidate records containing:

- Stable English source span
- Canonical source concept or construction
- Proposed target variant
- Native-script form
- Romanization
- English gloss
- Item type
- Contextual constraints
- Dictionary validation
- Confidence and provenance

A candidate is automatically eligible only when:

- Its span aligns with the source block.
- Its target form and romanization pass the active language pack.
- Its meaning is valid in context.
- Its confidence meets the configured threshold.
- It does not conflict with a learner-pinned occurrence.

Ambiguous candidates MUST remain English until corrected, approved, or reanalyzed.

### 5.2 Deliberate introduction planner

#### 5.2.1 Daily budget

- The profile's daily budget limits only learning items introduced for the first time.
- Familiar and Mastered items MUST continue to be woven and MUST NOT consume the daily budget.
- Explicitly adding an English item to the weave MUST propagate whole-word
  occurrences across all chapters and existing library items in the active
  language profile, and MUST be applied to future imports.
- The learner MAY grant a one-day budget increase.
- The learner MAY explicitly request an English span through “learn this.” If the budget is exhausted, the module MUST request a one-day override rather than silently exceeding the limit.
- Introduction accounting MUST use the learner's configured timezone and be idempotent.

#### 5.2.2 Candidate ranking

The planner MUST rank eligible candidates deterministically using:

1. Context and dictionary confidence
2. Frequency and expected coverage across the learner's library
3. General usefulness
4. Proximity to the learner's current reading position
5. Spacing from other newly introduced items
6. Item difficulty relative to current learner state

Identical inputs, settings, and planner version MUST produce identical choices.

The planner SHOULD avoid clustering multiple new substitutions in one sentence or short paragraph when less disruptive candidates are available.

#### 5.2.3 Introduction

Introducing a candidate MUST:

1. Create or reuse the canonical learning item.
2. Attach the approved target variant.
3. Set the profile item state to Learning.
4. Record the daily-budget entry.
5. Make every validated occurrence of the same meaning eligible for weaving.
6. Emit an immutable introduction event.

Existing documents MAY refresh occurrences lazily, but later visits MUST render the introduced item consistently.

### 5.3 Span and meaning rules

- Substitution MUST be based on an approved occurrence, not a case-insensitive string replacement.
- Homographs and polysemous English words MUST remain separate when their meanings differ.
- A learning item MAY cover a phrase, construction, or sentence pattern.
- When approved spans overlap, the longest span MUST render by default.
- A learner-pinned correction MUST override automatic overlap resolution.
- Inflected source or target forms MUST remain linked to the same canonical item when the language pack validates that relationship.
- Punctuation and surrounding whitespace MUST remain stable.

### 5.4 Reader rendering

#### 5.4.1 Default display by tier

| Tracking state or tier | Inline display |
|---|---|
| Untracked candidate | Original English; no tier or Dictionary entry |
| Learning | Target native form with romanization visible by default |
| Familiar | Target native form; romanization hidden |
| Mastered | Target native form; all help hidden |

The learner's profile MAY disable initially visible romanization for Learning items.

Introducing an item MUST create its `UserItemState` in the Learning tier, after which it appears in the core Dictionary. Merely analyzing a candidate MUST NOT create a learning-state record.

#### 5.4.2 Layered help

Activating a woven span MUST open help without losing reading position. The help surface MUST expose:

1. Native target form
2. Romanization
3. English gloss
4. Usage or construction details
5. Current tier and confidence explanation
6. Tier override or reset
7. Correction action

Opening romanization or English help MUST emit separate reveal evidence. Merely opening the generic help surface MUST NOT imply failure.

#### 5.4.3 “Learn this”

Activating eligible English text MUST let the learner request a learning item.

- If an approved candidate exists, the module SHOULD introduce it immediately when budget remains.
- If the candidate is ambiguous, the module MUST present the proposed meaning and target form for confirmation.
- If no candidate exists, the module MUST queue analysis and leave the source unchanged until validation succeeds.
- If the daily budget is exhausted, the module MUST show the effect of a one-day override before applying it.

### 5.5 Evidence emitted by the technique

The consuming module MUST emit immutable events through the technique service for:

- Item introduction
- Woven occurrence viewed
- Romanization revealed
- English gloss revealed
- Usage details opened
- “Learn this” requested
- Daily budget overridden
- Tier manually changed or reset
- Variant or occurrence corrected

A woven occurrence view is weak positive evidence. Romanization and English reveals are weak uncertainty signals. Reader evidence MAY adjust confidence but MUST NOT independently promote an item to Mastered.

### 5.6 Review integration

The diglot weave technique MAY generate review prompts from its approved occurrences:

- Matching prompts using target forms, romanization where appropriate, and English glosses
- Fill-in-the-blank prompts using authentic imported-text context
- Sentence-construction prompts using accepted target variants

The core review activities own answer validation and evidence emission. The module MUST NOT keep a separate review score.

### 5.7 Corrections

A learner MUST be able to report:

- Wrong source span
- Wrong meaning
- Wrong target form
- Wrong romanization
- Inappropriate substitution in this occurrence

Corrections MUST create versioned records. Removing one occurrence MUST NOT automatically delete the canonical item or valid occurrences elsewhere.

A corrected mapping SHOULD influence future analysis for that learner. Global promotion of a correction is outside the MVP.

## 6. Failure behavior

- Missing analysis MUST render original English.
- Missing or invalid AI configuration MUST leave content unchanged and link the learner to the core AI connection settings.
- Failed dictionary or romanization validation MUST render original English and expose an actionable analysis status.
- A failed event write MUST surface a retryable error; the UI MUST NOT pretend the interaction was persisted.
- Offline interactions MUST retain stable event IDs and replay safely.
- A module, technique, or language-pack version mismatch MUST fail explicitly and queue compatible reanalysis when possible.

## 7. Accessibility

- Woven and English candidate spans MUST be keyboard focusable without disrupting normal reading navigation.
- Screen-reader labels MUST identify the displayed language and availability of help without automatically announcing hidden answers.
- Native form, romanization, and English help MUST not be distinguished by color alone.
- The help surface MUST return focus to the originating span when closed.
- Font and line-height choices MUST support Han characters, kana, Hangul, and Latin romanization together.

## 8. Acceptance criteria

The technique is acceptable when:

1. A new profile introduces no more than its configured daily number of items without explicit approval.
2. Introducing one meaning causes all validated later occurrences of that meaning to be woven.
3. An identical English string with a different meaning remains unchanged.
4. An approved phrase wins over an overlapping approved word.
5. Learning items show romanization by default, while Familiar and Mastered items hide it.
6. Native form, romanization, and English can be revealed independently and produce distinct evidence.
7. “Learn this” supports approved, ambiguous, unanalyzed, and over-budget cases.
8. Mandarin, Japanese, and Korean render through their configured scripts and romanization systems.
9. Reader evidence changes confidence conservatively and cannot by itself create Mastered state.
10. Corrections preserve historical evidence and affect future rendering.
11. Offline interactions replay without duplicate introductions, evidence, or budget charges.
12. Reading and Conversation can consume the same technique without duplicating planning, substitution, or evidence logic.
13. The technique has no top-level navigation or standalone route.
