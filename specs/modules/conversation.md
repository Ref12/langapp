# Conversation Module Specification

## 1. Purpose

The `conversation` module provides familiar AI chat threads while applying shared language-learning techniques to assistant responses. In the MVP, assistant responses are generated from an English base and rendered with the shared [diglot weave technique](../techniques/diglot-weave.md).

**Implemented voice extension:** New voice threads use `conversation.generateVoiceTurn`, not the English/weaving operation. The sections below also describe longer-term text-chat requirements; they are not a claim that every specification item is implemented.

## Voice conversation (browser implementation)

- Thread `mode` is optional; absent means legacy text chat. Voice replies are validated ordered `{text, locale}` segments, English plus the current profile locale. Canonical displayed text is the same content spoken, without diglot post-processing.
- New voice threads request an English greeting. Later replies use context and learner preferences rather than mechanically matching the last spoken language. Typed turns use the same tutor operation.
- Recording is explicit: request permission → record → finalize → save/review → Send → generate → optional speak. Partial/final phrase recognition only updates the transcript; silence and the 120-second cap never send. Practice is separately bounded to 30 seconds and requires explicit Assess.
- Review offers edit, original transcript, detected phrase locales, replay, save edit, re-record (retain saved take), discard and Send. Recordings are persisted at review; unsent takes can be resumed after reload. Quota failures block sending the attached take and retain in-memory replay with a not-saved warning.
- Stop reply aborts generation and sequential browser playback. Generated text is saved before playback; playback failure or interruption is independent metadata and leaves the reply readable.
- Capture and async callbacks are cancelled on unmount/profile/thread changes or connection-version changes. SDK finalization is bounded to five seconds; service ending/background interruption produces review and an explanatory message. Late microphone permission grants release their streams.
- Choose a target-language segment for repeat-after-me practice. Its exact reference/locale is saved atomically with the recording's review attempt. Assess uses the saved WAV, not an editable transcript. Accuracy, fluency, completeness, word errors and phonemes are shown only when returned. No-speech/incomplete outcomes are explicit, and multi-phrase scores are not fabricated by averaging.
- Saved audio/feedback is available in the thread's recording list. Deleting a recording removes its attempts; deleting a voice thread removes messages/audio/attempts but keeps shared Dictionary evidence.
- Speech and LLM credentials are independent. Audio goes to Azure during conversation recording; only submitted conversation text goes to the LLM. Practice audio goes to Azure upon Assess. Local audio and all keys are excluded from default backups.
- Real-device/live-provider acceptance remains a release check; see [README](../../README.md#browser-acceptance-checks).

Conversation shares the learner's core Dictionary, tiers, daily introduction budget, evidence, language packs, and AI connection with other modules.

## 2. Package contribution

The module MUST be a self-contained first-party package registered through `defineLearningModule`.

Its manifest MUST contribute:

- Module ID: `conversation`
- A top-level `Conversation` label and icon key
- Routes beneath `/modules/conversation`
- Conversation and profile settings schemas
- Required technique and language-pack capabilities
- Required AI operations
- Thread and message IndexedDB repositories and migrations
- Generation jobs and event handlers

The shell and generic module host MUST discover these contributions without conversation-specific core imports or conditionals.

## 3. AI operation dependencies

The module MUST use these curated operations:

- `conversation.generateTurn`
- `conversation.suggestTitle`

It MAY use approved language-analysis operations through the diglot weave technique. It MUST NOT call the provider adapter, read the key, or submit arbitrary provider requests.

The operation implementation builds the system prompt, loads history and profile context through typed repositories, resolves the active AI connection through its transport, applies limits, and validates the result.

## 4. Conversation model

A conversation contains:

- Stable thread ID
- Owning workspace and language profile
- Title
- Ordered messages
- Active technique and settings
- Created, updated, and archived timestamps

A message contains:

- Stable message ID
- Role
- Canonical content
- Generation status
- Parent or retry relationship
- AI operation invocation reference when generated
- Versioned technique annotation plan
- Created and completed timestamps

User messages MUST be stored and displayed verbatim. Assistant messages MUST preserve canonical generated text separately from their woven presentation.

## 5. Chat experience

The module MUST support:

- Create, rename, archive, and delete threads
- Send a user message
- Generate one assistant response
- Pending, generating, completed, cancelled, and failed states
- Cancel generation
- Retry a failed assistant response
- Edit a prior user message and resend as a new branch or truncating continuation
- Locally persisted history
- Clear, actionable provider and model errors

The MVP MAY serialize generation within one thread. Duplicate submission MUST be prevented with idempotency keys.

## 6. Diglot weave integration

### 6.1 Processing

For each completed assistant turn:

1. Preserve the canonical assistant text.
2. Pass stable message blocks, the language profile, current learner state, and conversation technique settings to the shared diglot weave service.
3. Receive and store a versioned annotation plan.
4. Render woven spans and layered help.
5. Forward interactions and resulting evidence through core services.

User messages remain verbatim in the MVP. Future display techniques MAY annotate them without modifying canonical content.

### 6.2 Persistence

The woven presentation for a delivered assistant message MUST be stable. Newly introduced items affect future assistant messages by default. A learner MAY explicitly refresh an older message, which creates a new annotation-plan version without changing canonical content or prior evidence.

### 6.3 Learning behavior

- Existing Learning, Familiar, and Mastered items are eligible for weaving.
- The technique MAY introduce new items subject to the same profile-wide daily budget used by Reading.
- A new item introduced in Conversation creates a core `UserItemState` in Learning and appears in Dictionary.
- A daily-budget charge MUST occur only once even if a message is retried or replayed.
- Taps, reveals, corrections, and tier overrides behave consistently with Reading.

## 7. Context and privacy

- The operation MUST load only the referenced local thread and language profile.
- Context sent to the provider MUST be limited to what is needed for the next turn.
- Long threads MUST use a versioned truncation or summarization policy.
- The UI MUST disclose that conversation messages are sent to the configured provider.
- Conversation content MUST be excluded from logs by default.
- Deleting a thread MUST delete its messages and annotation plans without deleting shared Dictionary evidence.

## 8. Offline behavior

- Previously loaded threads SHOULD remain readable offline.
- Composing a draft MAY work offline.
- Sending a message and generating an assistant response require connectivity in the MVP.
- Technique interactions on cached completed messages MAY queue offline and replay idempotently.

## 9. Failure behavior

- Missing or invalid AI configuration MUST show a setup action linking to core Settings.
- Provider authentication, model, rate-limit, timeout, and compatibility errors MUST remain distinguishable.
- A failed generation MUST not create a completed assistant message or consume a new-item budget.
- A successful canonical response with failed weave processing MUST remain readable and expose a retry for the presentation step.
- Invalid structured output MUST not create learning items or approved occurrences.

## 10. Accessibility

- Thread navigation, message actions, composer, generation controls, and woven spans MUST be keyboard accessible.
- Streaming or generation status MUST use non-disruptive live-region announcements.
- Message role and state MUST be exposed to assistive technology.
- Focus MUST remain predictable when sending, cancelling, retrying, and opening woven help.

## 11. Acceptance criteria

The Conversation module is acceptable when:

1. Its icon, routes, settings, jobs, and migrations appear through its manifest without handwritten core feature changes.
2. A learner can create a thread, send a message, receive a response, retry failures, and retain history across reloads.
3. All generation runs through `conversation.generateTurn` using the browser transport.
4. Module code never receives the provider API key or a generic provider proxy.
5. Canonical user and assistant messages remain separate from technique annotations.
6. Eligible words, phrases, and constructions are woven into assistant responses through the shared technique.
7. Items introduced in Conversation appear in the core Dictionary and use the shared daily budget.
8. Reading and Conversation produce compatible evidence for the same learning item.
9. Provider success followed by weave failure still leaves readable canonical assistant content.
10. Conversation content is absent from diagnostics by default and scoped to the local workspace.
