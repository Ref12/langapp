# AI Operations Specification

## 1. Purpose

All AI work uses a curated registry of application operations. Modules call product capabilities such as “analyze text” or “generate a conversation turn”; they never call provider adapters directly.

The MVP dispatches operations to an in-browser OpenAI-compatible adapter. A future release dispatches the same operations to authenticated server functions. This boundary keeps module contracts stable while credentials, prompts, providers, validation, and policy move server-side.

## 2. Operation contract

Every operation MUST declare:

- Stable namespaced ID and semantic version
- Runtime-validated input and output schemas
- Allowed caller capabilities
- Required provider capabilities
- Timeout, retry, concurrency, and payload-size policy
- Local retention and diagnostic policy
- Idempotency behavior
- Browser and future-server support status

Initial operations:

| Operation ID | Purpose |
|---|---|
| `language.analyzeText` | Propose contextual learning-item spans and target variants |
| `language.suggestFrequentItems` | Translate a ranked set of frequent chapter words |
| `language.translateImmersion` | Fully translate chapter text into annotated lexical units |
| `language.validateVariant` | Validate or repair a target form and romanization |
| `language.translateSelection` | Translate one learner-selected source span in context |
| `review.evaluateAnswer` | Evaluate an answer when deterministic validation is insufficient |
| `conversation.generateTurn` | Generate one assistant turn from conversation context |
| `conversation.suggestTitle` | Suggest a short thread title |

## 3. Transport-independent dispatcher

Modules receive a typed operation client. The dispatcher selects an implementation:

- `BrowserAIOperationTransport` for the GitHub Pages MVP
- `ServerAIOperationTransport` for the future hosted application

The transport is responsible for provider resolution and execution. Operation code owns input selection, system instructions, request construction, and output validation.

The build MUST reject unknown operations or modules that use undeclared operations. There MUST be no generic “send prompt” or “proxy provider request” operation.

## 4. MVP browser flow

1. Identify the calling module and verify its declared operation capability.
2. Validate and size-limit operation input.
3. Load only the required records from typed local repositories.
4. Resolve the active local AI connection.
5. Build the operation-owned system prompt and provider request.
6. Execute through the browser provider adapter with timeout and cancellation.
7. Validate and normalize output.
8. Store sanitized local operation and usage metadata.
9. Return only the typed result.

Module code MUST NOT control provider paths, authorization headers, arbitrary system prompts, tool definitions, or unbounded model parameters.

## 5. Context construction

- Each operation declares which local entities it may load.
- The operation loads private context by stable ID rather than accepting an arbitrary context dump from a module.
- Only the minimum necessary text, learning state, or history is sent.
- System instructions are operation-owned and versioned.
- Imported text and conversation content are delimited and treated as untrusted data.
- Truncation and summarization policies are versioned.
- Raw prompts and responses are excluded from diagnostics by default.

## 6. State and side effects

- AI output alone MUST NOT directly change tiers, delete data, consume a daily budget, or overwrite canonical content.
- Typed domain commands validate all mutations after AI output is accepted.
- Retryable operations and downstream mutations use immutable idempotency keys.
- Streaming operations expose pending, streaming, completed, cancelled, and failed states.
- A failed or invalid result MUST NOT produce success-shaped fallback data.

## 7. Future server transport

The future server transport additionally:

- Authenticates the account and module caller.
- Checks ownership of referenced profiles, content, conversations, and learning items.
- Resolves encrypted provider credentials server-side.
- Enforces rate, cost, timeout, retry, and authorization policy.
- Applies SSRF and network protections.
- Records sanitized server audit metadata.
- Exposes narrow server functions generated from operation contracts.

No client endpoint may forward arbitrary prompts, provider paths, request bodies, headers, or model parameters.

## 8. Future model function calling

An operation MAY later expose curated server functions to compatible models:

- Tools are registered server-side with typed argument and result schemas.
- Each operation explicitly allowlists tools.
- Arguments are authenticated and validated before execution.
- Tool loops have strict step, time, and cost limits.
- Side-effecting tools require a domain command and user confirmation where appropriate.
- Outputs are treated as untrusted context and executions are audited.

This MUST NOT become arbitrary code execution or unrestricted internal API access.

## 9. Acceptance criteria

1. A module calls a declared operation without knowing transport or provider details.
2. Unknown and undeclared operations are rejected.
3. Invalid input or output cannot cross the operation boundary.
4. Modules cannot access the API key or submit arbitrary provider requests.
5. Browser operations honor timeout, cancellation, retry, and idempotency policy.
6. Raw user content is absent from diagnostics by default.
7. Replacing browser transport with a fixture server transport requires no module changes.
8. Future server functions can expose the same operation IDs and schemas.
