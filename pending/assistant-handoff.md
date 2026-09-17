# Assistant and browser voices: continuation handoff

Snapshot: 2026-09-16, updated after the UI agent finished and final integration
was confirmed.

## Start here

The latest implementation request was:

> It should cache the found voice. Also, maybe have a dropdown in the settings.

The user then requested this pending folder and a discoverable handoff. The
cache, preference contracts, persistence, app wiring, and voice-settings UI are
now complete. The parent retrieved and reviewed the UI agent's final result and
confirmed the combined integration. Settings -> Hear voices contains the Mandarin
and English selectors. The user subsequently authorized committing this completed
change set. This handoff accompanies the implementation; use Git log and status
for the current commit state. No push was requested.

### Immediate continuation

1. Check current Git status before starting any newly requested follow-up.
2. There is no unfinished voice-cache or selector implementation to resume.
   Do not repeat the completed UI-agent work.
3. Use the focused commands below for relevant subsequent changes, and update
   this file and `pending\README.md` when the state changes.
4. The user authorized this implementation commit, not a push or additional
   future commits. Capability discovery and other deferred ideas below are
   context, not new implementation assignments.

## Working tree and coordination

- Repository: `Ref12/langapp`; local checkout: `Q:\src\langapp`.
- This is the user's in-place checkout on `main`, not an isolated worktree.
- Baseline commit before these additions:
  `97ae933 Implement persistent learning Assistant`.
  This committed the first usable Assistant.
- The subsequent settings, Responses API, prompt, UI, speech, and handoff changes
  are included together in the user-authorized implementation commit. Nothing
  was pushed by this work. Check Git status before any follow-up.
- Do not reset, stash, switch branches, or discard changes to simplify continuing.
- Use Windows filesystem paths. Use `apply_patch` for manual edits.
- No dependencies were added for the voice-cache/settings change.

### Voice-settings UI agent

- Agent ID: `f7bc81da-c5d5-48fa-99a1-742cc06ae013`.
- Name: `voice-settings-ui`; started using the background `task` tool.
- Final state: idle; all six response turns retrieved. The agent reports no
  remaining work, and its final changes have been reviewed by the parent.
- Worked only on:
  - `src\components\assistant\VoiceSettings.tsx`
  - `src\components\assistant\VoiceSettings.test.tsx`
  - `src\pages\Settings.tsx`
  - directly relevant `README.md` updates
- Nine UI tests passed, including persistence, actual App/Hear integration,
  unavailable selections, cleanup, failure handling, and stale-snapshot safety.
- The parent subsequently replaced a silent stale-choice return with a visible
  error through the existing action runner.
- The agent did not commit or edit this pending folder.
- Agent handles may not be accessible from a different session. The repository
  files and an updated handoff are the durable source of continuation state.

## Voice cache and selector design

### Implemented by the parent

`src\core\assistant\speech.ts` now provides:

- `browserVoiceKey(voice)`: identity from URI, name, language, and local/online
  classification. Metadata is compared, not object identity.
- `browserVoiceMatches(voice, locale)`: language-safe matching for both known
  local and online voices. Existing `localVoiceMatches` remains available.
- `clearVoiceCache()`: clears positive automatic-selection cache entries.
- `setSpeechVoicePreferences(preferences?)`: validates and applies saved choices.
  Actual preference changes clear cached choices and stop active speech.
  Equivalent metadata does not interrupt playback or clear the cache.
- `watchBrowserVoices(listener)`: observes the browser list without playing
  audio. Emits `{ voices, loading, error? }`, immediately reads the list,
  handles `voiceschanged`, polls at 100 ms for at most three seconds, and
  continues listening for later list changes until its cleanup function runs.
  Repeated identical snapshots are suppressed. API failures are visible.

Playback cache behavior:

- Cache is in memory for the current page session, scoped by the browser
  `SpeechSynthesis` instance and requested language.
- Automatic mode reuses a discovered matching voice without repeating the
  three-second local-discovery wait, including between different Hear buttons.
- Each playback revalidates the identity against the current native voice list.
  It does not keep using removed native objects.
- Newly available matching local voices take precedence over cached online
  fallback voices.
- Missing entries, playback failures/timeouts, explicit refresh, and preference
  changes cause rediscovery. Missing voices are not negatively cached.
- Navigation/Stop cancels playback but does not discard a healthy cache.
- Cache is not persisted across a full page reload. Explicit selected voices are
  persisted and can be used immediately once exposed by the browser.

Explicit selection behavior:

- A selected voice overrides automatic ranking, including a deliberately chosen
  online voice when a local voice also exists.
- An available selected voice starts without the automatic fallback delay.
- An unavailable selected voice gets up to three seconds for discovery, then
  produces a visible instruction to choose another voice or Automatic.
- Do not silently replace an unavailable selected local voice with an online
  voice, and never substitute a wrong-language voice.
- Changing settings does not automatically speak or send an AI request.

### Persistence and app wiring

- `src\core\assistant\contracts.ts` defines:
  - `BrowserVoicePreference`: `{ voiceURI, name, lang, localService }`.
  - `SpeechVoicePreferences`: optional `zh-Hans` and `en-US` selections.
  - strict Zod schemas for both.
- `src\core\model.ts`: optional `Preferences.speechVoices`; omission means
  Automatic. No database version change is required for this unindexed field.
- Never persist native `SpeechSynthesisVoice` instances or their extra fields
  such as `default`; save only the four metadata fields.
- `src\core\learning.ts`: `savePreferences` validates voice metadata and merges
  supplied language keys against saved preferences inside the transaction.
- UI must save ONLY the edited key:
  `savePreferences({ speechVoices: { [locale]: selectedMetadataOrUndefined } })`.
  Do not spread a stale UI snapshot of the other language into the update.
- An explicit undefined value for a language restores Automatic while preserving
  the other language. An undefined whole `speechVoices` field clears all choices.
- `src\App.tsx`: an effect applies workspace voice preferences to the speech
  engine. All existing Hear controls use that shared engine.
- `src\core\backup.ts`: the optional field round-trips in workspace backups.
  Old backups remain readable and restore Automatic. Voice metadata is not audio
  or a credential; native availability still has to be checked after restore.
- Parent also changed the Hear tooltip, composer footnote, and discovery status
  to account for explicit voice choice. Status now says "Looking for a voice..."
  instead of always claiming to be looking for a local voice.
- The Assistant settings popup links to "Voices, AI connection, and appearance"
  in workspace Settings rather than adding a second independent voice preference.

### Completed voice-settings UI

- Add a Speech voices section to workspace Settings.
- Provide separate Mandarin and English dropdowns with Automatic as default.
- List only matching voices, labeled with name, language, and Local/Online.
- Save on change using the existing `run`, `busy`, and `savePreferences` patterns.
- Keep an unavailable saved choice visible rather than displaying Automatic as
  if it had been selected. Explain the recovery choices.
- Handle delayed voice lists and an explicit refresh with proper cleanup.
- Explain saved selections, page-session caching, and online text sharing.
- Do not auto-play samples, invoke the AI provider, add microphone input, or add
  a new speech backend.
- Add focused component/integration tests using the real App where useful.

## Validation already performed

Final combined results after the UI agent's integration:

- `speech.test.ts`: 135 cases passed, including cache reuse, per-language and
  per-browser scoping, fresh native objects, local promotion, invalidation,
  selected voices, unavailable/local-to-online protection, and bounded observers.
- `learning.test.ts`: 16 cases passed, including validation and concurrent
  per-language preference updates.
- `backup.test.ts`: 21 cases passed, including voice-preference round trips and
  old-backup compatibility.
- `SnippetActions.test.tsx`: five cases passed, including the two-button
  cached-playback regression.
- `VoiceSettings.test.tsx`: nine cases passed.
- `Assistant.test.tsx`: 15 cases passed.
- `App.test.tsx`: eight cases passed.
- `Curriculum.test.tsx`: four cases passed.
- The final combined run passed all 213 cases across those eight files.
- The initial integration run exposed a test that assumed Settings contained
  only one alert. Voice support is absent in that test browser, so the new
  section correctly adds its own alert. The AI-import assertion now targets its
  actual message and still verifies alert semantics and absence of secrets.
- Focused ESLint passed.
- `npm run build:next`, including TypeScript checks, passed after final changes.
  The pre-existing large-bundle warning remains.
- `git diff --check` passed apart from Git's existing LF/CRLF advisory.
- No live paid AI call was made to validate this voice feature.
- A further pre-commit run passed 397 cases across 16 files covering the
  accumulated AI providers, Assistant core, local settings, mock structured-output
  probe, and dev-server integration. The broad path selectors also matched four
  V1 AI test files. Dev-server testing reported the existing HMR port 24678 in
  use, but its integration test passed; no existing process was stopped.

Focused revalidation commands from the repository root:

```powershell
npm test -- src\core\assistant\speech.test.ts src\core\learning.test.ts src\core\backup.test.ts src\components\assistant\SnippetActions.test.tsx src\components\assistant\VoiceSettings.test.tsx src\pages\Assistant.test.tsx src\App.test.tsx src\pages\Curriculum.test.tsx
npx tsc -b --pretty false
npx eslint src\core\assistant\speech.ts src\core\assistant\speech.test.ts src\core\assistant\contracts.ts src\core\model.ts src\core\learning.ts src\core\learning.test.ts src\core\backup.ts src\core\backup.test.ts src\App.tsx src\components\assistant\SnippetActions.tsx src\components\assistant\SnippetActions.test.tsx src\components\assistant\VoiceSettings.tsx src\components\assistant\VoiceSettings.test.tsx src\pages\Assistant.tsx src\pages\Assistant.test.tsx src\pages\Settings.tsx
npm run build:next
git --no-pager diff --check
git check-ignore settings\app.settings.jsonc
```

Use existing tooling; do not install dependencies unless a relevant command
fails because something is missing. Documentation-only edits do not need builds.

## Earlier implemented decisions to preserve

### Assistant architecture

- Root app: React, TypeScript, Dexie, Vite, Vitest; database `linguaweave-next`.
  The original V1 app and its `linguaweave` database remain separate.
- Persistent conversations and per-conversation drafts, source references,
  Conversation/Shadow modes, cancellation, retry, and compatible backups exist.
- Tutor loop: explicit learner event, bounded context, bounded read-only tool
  rounds, persist reply, then yield to the learner.
- Teaching blocks currently support only text Markdown and speech
  `{ type, text, locale, romanization?, meaning? }`.
- Markdown/code fences are inert, not app commands. Runnable exercise blocks,
  generated activity players, microphone input, and pronunciation scoring are
  not implemented.
- Native read-only tools are `lookup_words`, `lookup_lessons`, and
  `get_learning_context`.
- Cancellation, changed connection revisions, deletion, and restored/expired
  runs prevent stale replies from being published.
- Important files: `src\core\assistant\contracts.ts`, `runtime.ts`, `store.ts`,
  `tools.ts`, and `src\pages\Assistant.tsx`.

### Phrase actions and draft safety

- Visible label is **Ask**, not "Ask Assistant".
- Inside a chat, Ask appends to that chat's existing draft without sending.
  Elsewhere it creates a new conversation. Do not restore the abandoned
  most-recent-conversation behavior.
- Draft appends preserve pending keystrokes, whitespace, and context. Overflow
  fails visibly without truncation or replacement. Deleted conversations are
  not silently replaced.
- User chose **Practice** as the button name, not Repeat.
- Practice means repeat-after-me practice, not replaying audio.
- Every Mandarin speech block in an Assistant reply has Hear / Ask / Practice.
  English speech blocks have Hear. Ordinary explanatory text does not acquire a
  persistent action row; selected text can still use contextual actions.
- Practice selects the exact phrase in the current conversation, enters Shadow
  with `shadowIntent: 'repeat'`, preserves the draft, and focuses the composer.
  It does not send, start a microphone, or award evidence.
- The old Shadow-only "Repeat after me" control was replaced, not duplicated.
- A single small Copy button below each message copies the complete message,
  including all speech, romanization, meanings, and raw Markdown.
- Key files: `SnippetActions.tsx`, `MessageActions.tsx`, `message-text.ts`,
  `draft-actions.ts`, `drafts.ts`, and `Assistant.tsx`.

### Browser speech

- Public playback API is `playBrowserSpeech` / `stopBrowserSpeech`, not the old
  local-only names.
- Automatic playback prefers local matching voices, waits briefly for delayed
  discovery, then uses online voices if needed. Online fallback was explicitly
  authorized by the user; no separate opt-in toggle was requested.
- Mandarin matching handles script/region variants, Taiwanese Mandarin, and
  explicit `cmn` tags. Do not treat unqualified HK/MO Chinese or Cantonese as
  Mandarin fallback. English remains English.
- Mandarin respects its conversation's playback rate; English uses rate 1.
- Discovery, starting, and speaking are separate states. Speaking is only
  reported after the native utterance's start event. Stop/Escape/navigation/
  hiding/unmount invalidate stale callbacks and timers.
- Prior actual Chrome inspection found local English voices but only online
  Google Mandarin voices. The user was given Windows voice-installation
  instructions; no Windows voices were installed by the agent.

### Local AI settings and protocols

- `settings\app.settings.jsonc` is the user's ignored live settings file and
  contains credentials. Never print, copy into this folder, or commit its contents.
- Tracked template: `settings\app.settings.template.jsonc`; JSONC comments
  explain the fields. Preserve the user-approved filenames.
- Startup imports the local file only when no saved connection exists.
- Dev-only endpoint: `/__dev/app-settings`, with the required
  `x-linguaweave-local-settings: 1` header and loopback/same-origin protections.
  Saved settings win, import does not invoke AI, and direct private-file serving
  is denied. Root and V1 protections are covered by tests.
- Import previously failed because an old Vite process had stale configuration.
  Restarting the verified process fixed it; do not clear learning data to repair
  an import issue.
- Both Chat Completions and Responses are implemented. Existing records with no
  `apiType` keep Chat Completions behavior.
- `createAssistantModelClient` hides provider-specific per-turn continuation.
  Calls are non-streaming, bounded, and use `store: false`.
- `scripts\Test-StructuredOutput.ps1` is the URL/key/model probe with mock tests.
  A real run can be billable; do not run it against the user's provider casually.
- `/models` capability discovery/cache and automatic capability inference were
  discussed but NOT implemented. Responses availability was associated with
  `supported_endpoints`; do not conflate it with schema-output support.
- Delegating the agent loop to a future central service is not implemented.

### System prompts

- Tracked files under `settings\system-prompts`:
  `conversation.md`, `shadow.md`, `repeat.md`, and `explain.md`.
- Conversation/Shadow are modes; Repeat/Explain add turn-intent instructions.
- Files are imported using Vite `?raw` and bundled in production.
- Mandatory protocol, untrusted-data, and read-only-tool constraints stay in
  TypeScript. Empty selected prompt files fail before making a provider call.
- Prompt files are public application assets, not a place for secrets.
- Provider instructions request each Mandarin phrase/example as its own speech
  block so controls can be attached. Existing prose-only replies are not
  automatically rewritten or mined for individual Chinese snippets.

## Local runtime and optional historical context

- A dev server was previously started with:
  `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
  Tool handle at launch: `langapp-dev-server`. Recheck its actual state before
  starting another server or trying to stop it.
- Use `127.0.0.1` for scripted HTTP probes; this Node setup can resolve
  `localhost` to IPv6 while the server listens only on IPv4.
- Browser canvas is named `browser:assistant-refinements`. Its prior automation
  interface did not provide the required page handle; do not invent handles.
- Actual Chrome interaction was possible through computer-use tools. Re-read
  the current windows/UI before acting; historical element indices are stale.
- Do not clear browser databases or user conversations as a troubleshooting step.
- Original session ID: `e16bd454-80a5-4663-b943-7662375f6801`.
  A longer original plan may still exist at
  `%USERPROFILE%\.copilot\session-state\e16bd454-80a5-4663-b943-7662375f6801\plan.md`.
  This handoff is intended to stand alone without that session's files.
