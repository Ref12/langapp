# Assistant and browser voices: continuation handoff

Snapshot: 2026-09-17. The 2026-09-16 foundation was committed as `eaa0b75`.
The latest section supersedes older Practice/Shadow behavior described later.

## Latest refinement: reference playback and recording cue (complete)

User: Practice should say the phrase first and have an indicator sound marking
the start of recording. The user authorized committing this refinement on
2026-09-17; it is included in the accompanying commit. No push was requested.
The preceding work was committed as `1272492`.

Parent implementation:

- `playBrowserSpeechToEnd` reports completed/cancelled/error outcomes from the
  real speech lifecycle, retaining the existing fire-and-forget Hear API.
- Inline Practice now plays the phrase before activating either microphone
  engine, using the existing selected voice and per-conversation speech speed.
  No-recording practice plays the phrase without preparing a cue or microphone.
- `PhrasePractice` has concise Listen/Get ready/Listening phases; Submit stays
  disabled during the lead-in and permission/startup wait. Cancel handles the
  entire sequence. Stale completion and cue errors cannot restart recording.
- Browser recognition cues on its actual listening callback. Azure accepts
  a gesture-prepared AudioContext and an async `beforeListening` hook, which
  completes the cue before microphone nodes are connected or PCM is captured.
- Shadow Practice previews its phrase; its Start speaking sequence also plays
  the phrase then sounds the cue. Mount/reload never starts either sequence.
- README and Settings describe the behavior.

Agent `740aef39-e3f2-4dec-856f-6703d3316b9e` completed new `recording-cue.ts`
and its tests. API: `prepareRecordingCue()` synchronously prepares
AudioContext/resume without sound, returns `play(): Promise<void>`,
`cancel(): Promise<void>`, and `takeContext(): AudioContext` for Azure ownership.
The helper closes only contexts it still owns, bounds failure paths, waits
for real oscillator completion, and suppresses late/cancelled tones.
The cue is a gentle 880 Hz sine tone, 140 ms long, with an attack/release envelope.
Resume, missing-end and cleanup timeouts are 5 s, 1.5 s and 1 s respectively.
Both agent responses were retrieved; it is idle with no remaining work.

Final verification: **455 tests across 11 targeted files passed**, including
41 cue-helper tests, core speech/completion, Azure lifecycle, actual browser TTS
end/cancel events connected to App, and both practice modes. UI tests cover
phrase/tone gating, permission readiness, cancellation, stale completion,
errors, no-recording and storage-only retry. Existing Hear/voice settings,
native recognition, persistence and tutor-privacy regressions also pass.
Root production build, TypeScript, scoped ESLint and whitespace checks passed.
The existing large-bundle warning remains. No actual microphone, paid provider
call, or real audio playback was performed; tests use controlled browser APIs.
Parent reviewed the helper and stabilized cleanup hook callbacks. A cue is
stopped before cancelling an Azure session that owns its shared context.

No implementation remains pending. The unrelated MobileNavigation.test.tsx edit
and private app.settings.jsonc are excluded from this commit and preserved.

## Previous refinement: inline practice and JSON speaking speed (complete)

The user refined Conversation practice: no new message or separate panel. The
selected phrase's **Hear / Ask / Practice** row becomes **Submit / Cancel**, with
less explanatory text. They explicitly confirmed that Practice starts recording
immediately when **Listen and record** is selected; Submit finishes capture and
shows inline feedback. The no-recording default remains microphone-free.
Shadow retains the separate panel and automatic result-message flow below.

Implemented inline behavior:

- `PhrasePractice.tsx` starts capture only from the explicit click, never from
  mount, reload, or settings changes. Only one phrase is active at a time.
  Recognition ending on its own retains an unsent attempt until Submit.
  Cancel, Escape, navigation, hidden pages, playback, new AI turns, and relevant
  settings/provider changes discard active attempts and ignore late callbacks.
- `startAzurePracticeCapture(..., { automaticAssessment: false })` releases the
  microphone at the 30-second limit and enters `ready`, retaining bounded PCM
  only in memory. Submit uploads it; Cancel discards it. Default adapter behavior
  is still automatic for Shadow. Repeated Stop cannot submit twice.
- Optional `AssistantMessage.practiceResults` holds the latest feedback per
  exact speech-block index on a completed assistant reply. The saver validates
  thread/message ownership and an unchanged phrase, replaces just that block's
  feedback, and adds no message, sequence, run, or learning evidence.
- `PracticeFeedback.tsx` is shared between compact inline feedback and existing
  standalone practice bubbles. Explanations and word details are collapsed.
- Inline feedback survives backups/reload and appears in full-message Copy.
  The original assistant blocks remain in tutor history, but transcripts and
  result metadata are excluded from Chat Completions and Responses payloads.
- Submit retries a failed storage write without another recording or assessment.
  Keep the attempt open until saved. No audio survives navigation or reload.
- Switching modes/settings away and back cannot reopen a stale attempt; keyed
  component cleanup clears its active-row identity without closing another row.
  The history does not scroll to the bottom merely because feedback was saved.

The user then requested a default speaking speed definable in app settings JSON.
Implementation agent `0f1e12bd-f296-45e2-9685-ab9fcc4d5b19` completed that work:
optional top-level `defaultSpeechRate`, allowed values `0.5/0.75/1/1.25`,
workspace preference persistence, new-conversation default, Mandarin Hear
fallback, strict JSONC import and template. Explicit JSON values reapply on
startup; omitted keys preserve preferences. Existing per-chat rates and saved
AI/speech credentials are never overwritten; English remains normal speed.
The agent also completed a contracts refinement rejecting inline metadata
(including an empty array) on anything but a completed assistant reply.
All four agent responses were retrieved; it is idle with no remaining work.

Final integration and verification:

- **581 tests passed across 15 targeted files**: settings server/import,
  default speed, browser voices, store/backups, local result ownership, root
  App/inline/Shadow UI, Azure/browser capture, runtime and tutor context.
- Root production build, TypeScript, scoped ESLint and whitespace checks passed.
  Only the existing large-chunk build warning remains. No new shared/V1 changes
  were needed for this refinement.
- Parent removed the forced `rate = 1` defaults in both HearButton and
  SnippetActions. App applies saved preferences through `setDefaultSpeechRate`.
  Explicit conversation rates still take precedence, and English stays at `1`.
- Verified actual pre-existing fallback in the source is `1`, NOT `0.75`.
  With no saved/configured default, both new chats and other Hear use `1`.
  The tracked template explicitly demonstrates `defaultSpeechRate: 0.75`.
- Startup reports an independent default-speed status through
  `LocalSpeechRateSetupContext`; errors appear in Settings -> Hear voices, even
  when both saved connections already exist. Provider wraps the whole workspace
  so the sidebar and selection controls also see configuration loading.
  New conversation creation waits for configuration; Ask in an existing chat
  remains available and does not create a new conversation.
- Initial integration caught a sidebar outside the startup provider; moving the
  provider to the ready workspace boundary resolved the default-import race.
  No lessons are blocked while local settings load.
- The tracked template already had storageAcknowledged set true before this
  refinement. It was preserved. The template test now accepts its existing
  boolean and separately proves that false is rejected for credential import.
- The visible dev terminal `practice-dev-server` remains responsive at
  `http://localhost:5173/`; browser canvas `linguaweave-app` is already open.
  No real microphone, paid LLM/Azure, or private-settings tool request was made.

No implementation remains pending in this refinement. The private JSONC file
was not edited: add or change its top-level `defaultSpeechRate` and reload the
development app to apply it. Later imports update only the default, not existing
conversation overrides. Omitting the key preserves the saved default.

The user authorized committing the completed Assistant refinements on 2026-09-17;
they are included in the accompanying commit. No push was requested. Unrelated
`src/components/MobileNavigation.test.tsx` changes and the private JSONC file
are excluded and preserved. Older uncommitted-state notes below are historical.

## Previous refinement: automatic recorded-practice results (complete, uncommitted)

The user rejected manual **Send for feedback**. **Listen and record** must
automatically assess actual audio with a configured speech provider; if no
provider is configured or the conversation's **Speech feedback** toggle is off,
compare the recognized transcript with the expected translation locally.
Results are saved as conversation bubbles but must NOT reach the LLM, including
in future conversation history. The user confirmed **Azure Speech** and adding
its connection to the automatic JSONC settings import. The existing LLM
`aiConnection` section is retained, not replaced.

Implemented behavior:

- Root `speech-contracts.ts` defines independent Azure credentials and bounded,
  honest assessment metrics. Credentials never belong in practice messages.
- Conversation `speechFeedback` defaults true; recording still defaults OFF
  (`practiceInput: listen-repeat`). The old `spoken-feedback` stored value now
  displays as **Listen and record** for compatibility.
- New local-only message role `practice`, strict discriminated result metadata,
  and `practice-results.ts` for transactional, idempotent persistence. No AI run,
  source/draft replacement, mode change, or learning evidence is created.
- `transcript-diff.ts` uses bounded, character-level Hirschberg alignment with
  Unicode compatibility normalization and punctuation/space/case handling.
  It does not claim to assess pronunciation.
- `PhrasePractice.tsx` automatically publishes completion/error results,
  suppresses cancelled/stale callbacks, and offers storage-only result retry.
  `PracticeResultBubble.tsx` renders expected/recognized text, the diff or
  actual Azure metrics, Hear, and full-message Copy. No raw audio is persisted.
- `speech-capture.ts` now marks cancellation explicitly, including native
  failures after a cancellation, so cancelled attempts cannot auto-publish.
- Runtime rejects the obsolete LLM repetition path; tutor history excludes
  new result bubbles and legacy repetition/feedback turns. Legacy records and
  optional practice drafts remain readable in backups, but are not resubmitted.
- `repeat.md` is reserved, no longer loaded by the tutor. README, Settings
  privacy text, template instructions, and this handoff describe the new behavior.

Implementation agents:

- `1cd30e78-5650-4e20-88e4-5962328e6e70` / `azure-practice-assessment`:
  root `speech-assessment.ts` and tests, plus necessary pure shared PCM,
  assessment/alignment helpers and narrow V1 refactors. Implements
  `azureSpeechCaptureSupported()` and synchronous
  `startAzurePracticeCapture(connection, referenceText, listener)` returning
  `{ stop, cancel }`. State includes an `assessing` phase, actual transcript,
  optional assessment, visible errors, and `cancelled: true` on cancellation.
  Records bounded real audio locally, then sends to Azure automatically.
  Completed and idle; all four responses retrieved. Parent reviewed the full
  adapter, shared PCM/parser/alignment/worklet files, and narrow V1 changes.
  Shared modules contain no V1 database, profile, or runtime imports.
  Transcript extraction precedes reference alignment; omissions never become
  invented recognized text. Multi-utterance results remain incomplete rather
  than averaging acoustic metrics. Parent tightened transcript bounds to match
  the 8,000-character persistence schema, including separator characters.
- `73c820a8-9219-4037-adca-55a80ea1ca07` / `speech-connection-settings`:
  schema-3 speech credential table; `speech-connection.ts`; speech settings UI;
  independent AI/speech JSONC import and startup status contexts; template and
  local-server tests. Saved connections independently win over imported ones.
  Completed and idle; all three responses retrieved. Parent reviewed the new
  schema/storage/import/context/form/template/server files after completion.
  Agent's 89 focused tests and owned-file lint passed. Settings prose now explains
  audio/reference transfer and preserved speech credentials on backup restore.

There is no unfinished implementation or active agent in this refinement.
No new provider credential was supplied or inserted into the private settings
file. Fill the optional Azure section in local JSONC, or use Settings ->
Practice speech connection, to enable real provider assessment. Without a
connection, Listen and record uses the browser transcript comparison.

Final integration:

- **540 tests passed across 20 targeted files**, including 56 Azure adapter
  cases, 33 V1 speech regressions, native capture, App/practice/settings UI,
  independent import, schema migration, backups, and existing Hear controls.
- Actual Chat Completions and Responses request-body tests confirm that local
  results and legacy practice transcripts/replies never enter LLM context.
- Root and V1 production builds, TypeScript, scoped ESLint, and whitespace
  checks passed. The existing large-chunk warnings remain.
- Initial UI integration exposed a loading-phase remount; root now avoids
  unnecessary remounts while still cancelling on provider revision changes.
  Start stays disabled until startup speech configuration loading finishes.
- The existing voice-list test now waits for populated async voice options.
  Cancellation fixture updates explicitly assert `cancelled`, including native
  errors after cancellation.
- Unicode-normalization expansion is bounded before local alignment. Azure
  transcript length is bounded before successful result publication, so a
  too-large provider response cannot become a permanently unsavable result.
- No live Azure/LLM call or real microphone recording was made. The SDK,
  microphone, worklet lifecycle, and service responses are simulated in tests;
  the actual worklet processor is executed in an isolated test VM.
- Storage failures retain the result in the current practice panel with a
  storage-only retry. Keep that panel open until saved; unsaved results are not
  guaranteed across navigation or reload. Recording itself never resumes.

Preserve unrelated `src/components/MobileNavigation.test.tsx` edits. No new
commit or push is authorized. Never read or print the private
`settings/app.settings.jsonc` contents or perform live paid provider calls.

## Previous refinement: translation practice (manual feedback superseded)

User clarified that Shadow is the full flow: express a thought in the native
language, receive a Mandarin translation and explanation, then practice the
translation. Practice is ONLY the translation-practice step, not a mode switch.
The user requested a per-conversation setting and selected listen-and-repeat
without recording as the default. Optional capturing of a spoken attempt for
feedback is the other setting.

Current uncommitted implementation:

- `AssistantThread.practiceInput`: optional `listen-repeat` or `spoken-feedback`.
  New threads explicitly default to `listen-repeat`; older threads use the same
  fallback without a migration or database version change.
- `practicePhrase` and `practiceDraft` are independent of conversation mode and
  the normal composer draft. Store helpers `selectPracticePhrase` and
  `savePracticeDraft` protect against late writes to another selected phrase.
- `PhrasePractice.tsx` renders Hear plus self-paced repetition by default,
  with no microphone or provider calls. Capture mode requires explicit Start,
  Stop, transcript review, and Send for feedback.
- Speech recognition is browser-provided, may send audio to its service, and
  never saves raw audio. General native-language dictation in Shadow's composer
  is not part of this slice; that composer still accepts typed English.
- Repeat feedback requests carry an immutable `practice` snapshot with the
  selected phrase and `input: speech-transcript`, separate from source context.
  Retry uses the original snapshot, not a subsequently selected phrase.
- Normal composer intent is Conversation/message or Shadow/shadow, never an
  implicit repetition just because Practice is open.
- Repeat feedback compares only reviewed wording, acknowledges recognition
  errors, and must never score pronunciation, tones, fluency, or mastery.
- Legacy `shadowIntent: repeat` references reopen as no-recording practice.
  Selecting/closing a new practice target clears that legacy pending intent
  without changing mode or rewriting previous history.
- Practice configuration/drafts/attempt targets round-trip through optional
  strict backup fields.
- Root README and Shadow/Repeat system prompt files were updated.

Completed state at this snapshot:

- Final combined run: 341 tests passed across ten files, including 64 speech
  capture cases, nine practice UI cases, 19 Assistant cases, 100 core
  store/runtime/tools/backup cases, and existing Hear/voice-selection coverage.
- One fixture initially collided with the existing unique message-sequence
  index after creating a Shadow mode marker. Its reply now uses the next
  sequence; no production persistence behavior was weakened.
- Focused ESLint, TypeScript, and `npm run build:next` passed. The existing
  large-bundle warning remains. No real microphone or paid AI call was used.
- Parent reviewed the capture module and validated the real capture module
  connected to App/pane lifecycle with mocked native recognition callbacks,
  in addition to isolated module and UI tests.
- Speech capture agent `ef51dcb9-5e95-45c9-ad9a-51db2790f581`
  (`practice-speech-capture`) completed ONLY new
  `src\core\assistant\speech-capture.ts` and its test file. It was asked to
  inspect V1 speech patterns but did not modify/import the V1 runtime. Its final
  result was retrieved; it is idle with no remaining work.
- Its APIs: `speechCaptureSupported()`, `startSpeechCapture(listener)`
  returning `{ stop, cancel }`; state contains phase
  starting/listening/stopping/finished/error, transcript, and optional error.
  Capture language is Mandarin `zh-CN`; it is bounded, explicit, cancellable,
  and cannot auto-send or auto-restart.
- There is no unfinished implementation in this refinement. Preserve unrelated
  changes since `eaa0b75`;
  `86741e4` introduced mobile/pagination improvements before this work.
- This new refinement is NOT authorized for commit or push.

Focused practice command:

```powershell
npm test -- src\core\assistant\speech-capture.test.ts src\components\assistant\PhrasePractice.test.tsx src\pages\Assistant.test.tsx src\core\assistant\store.test.ts src\core\assistant\runtime.test.ts src\core\assistant\tools.test.ts src\core\backup.test.ts src\core\assistant\speech.test.ts src\components\assistant\SnippetActions.test.tsx src\components\assistant\VoiceSettings.test.tsx
```

## Completed foundation (2026-09-16)

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
