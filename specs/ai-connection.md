# OpenAI-Compatible Connection Specification

## 1. Purpose

The static MVP lets a learner supply an OpenAI-compatible API endpoint, key, and model. The configuration belongs to the local browser workspace and is used only through the curated operations in [the AI operations specification](ai-operations.md).

The application is deployed on GitHub Pages and has no backend. Provider calls therefore originate in the browser for the MVP. A future server adapter will implement the same operation contracts and move credentials and calls off the client.

## 2. Settings

Settings MUST provide:

- API base URL
- API key
- Model identifier
- Save
- Test connection
- Replace or clear key
- Disable connection

The UI MUST show this warning before persistence:

> This app runs entirely in your browser. Your API key will be stored in this browser and can be accessed by code running on this site. Use a restricted key with spending limits, and clear it when using a shared device.

The learner MUST explicitly acknowledge the warning before saving a key.

## 3. Local persistence

- The connection MUST be stored in IndexedDB, never localStorage or a build-time environment variable.
- The key MUST be omitted from logs, analytics, error reports, URL state, service-worker caches, clipboard operations, and default backup exports.
- The key field MUST be masked after save.
- Clearing application data or selecting “clear key” MUST remove the credential.
- The application MUST NOT claim that client-side encryption makes the key secure; code able to run the app can also obtain any decryption material.
- A backup MAY include the key only through a separate explicit secrets-export flow that is deferred from the MVP.

The stored connection has a configuration version so in-progress operations can detect changes.

## 4. OpenAI compatibility

The browser adapter targets:

```text
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

The model identifier is sent unchanged. A trailing slash on the base URL is normalized without altering its path. Settings SHOULD show `https://api.openai.com/v1` as an example.

The adapter MUST support:

- Text system and user messages
- Temperature and token limits
- JSON-object output
- JSON-schema structured output when supported
- Standard usage metadata when returned
- Timeouts, cancellation, bounded retries, and rate-limit handling

If structured output is unavailable, an operation MAY use JSON-object mode with local schema validation and bounded repair attempts. Invalid output MUST fail explicitly.

## 5. Browser and CORS constraints

- The base URL MUST be absolute HTTPS.
- Embedded credentials, fragments, and unsupported schemes MUST be rejected.
- The provider must allow requests from the GitHub Pages origin through CORS, including the `Authorization` and `Content-Type` headers.
- Mixed-content requests are not supported.
- The connection test MUST distinguish CORS or network blocking from authentication, model, rate-limit, timeout, and response-compatibility failures where browser APIs make that distinction possible.
- The UI MUST explain that some OpenAI-compatible providers prohibit direct browser access.

The browser cannot provide server-grade SSRF, DNS, redirect, or secret protections. Those controls are requirements of the future server transport, not claims of the static MVP.

## 6. Connection test

Testing MUST:

1. Validate the URL locally.
2. Send a minimal synthetic prompt containing no library, Dictionary, or conversation content.
3. Use the configured model.
4. Verify a parseable response.
5. Probe required output capabilities with a small request.
6. Store only non-secret status, capability, latency, and timestamp data.

Saving and testing are separate. A failed test MUST NOT erase a previously saved configuration unless the learner explicitly replaces it.

## 7. Request execution

- Only the core browser provider adapter may read the key.
- Modules call typed AI operations and MUST NOT access the connection repository or construct authenticated provider requests.
- The core applies operation-specific limits, cancellation, timeouts, and safe retries.
- An operation captures the connection configuration version and model used.
- If the configuration changes during an operation, the result MUST fail or identify its original version rather than silently appearing to use the new configuration.
- Before sending imported or conversational content, the UI MUST disclose that the configured provider receives it.

## 8. Future server migration

The connection repository and operation dispatcher MUST be interfaces with browser implementations. The future server release replaces them with:

- Authenticated account-scoped connection storage
- Server-side authenticated encryption and key rotation
- Server-side provider calls
- SSRF, DNS-rebinding, redirect, and response-size protections
- Server-enforced rate, cost, and authorization policy

Modules and operation input/output schemas MUST NOT change solely because transport moves to the server.

## 9. Acceptance criteria

1. A learner can save and test a URL, key, and model after acknowledging the warning.
2. The configuration persists across reloads in the same browser.
3. The key is absent from localStorage, URLs, logs, caches, and default exports.
4. A synthetic test reports actionable CORS, authentication, model, timeout, and compatibility failures where distinguishable.
5. Modules call typed operations without receiving the key.
6. Clearing the key or all local data removes it.
7. A provider that does not permit browser CORS fails with an explanatory message.
8. The browser adapter can later be replaced by a server adapter without changing module contracts.
