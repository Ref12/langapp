# Voice conversation and pronunciation practice

## Goal and confirmed decisions

Extend LinguaWeave's existing Conversation module with a voice-tutor mode, rather than building a separate app. Ship on the current browser-only GitHub Pages deployment; design provider boundaries so a backend can replace browser credential handling later.

- Record with a tap; tap Stop to finish; review/edit the transcript before explicitly sending it.
- Provide a separate Stop reply control that cancels generation and/or speech playback.
- Use Azure Speech for transcription and scripted pronunciation assessment. Use browser speech synthesis for speaking the LLM's response.
- Keep the conversation LLM independently interchangeable through the existing OpenAI-compatible endpoint/key/model settings.
- Begin a new voice conversation in English. Thereafter choose English, the target language, or a mixture according to conversational context and learner requests, not a rigid language-matching rule.
- Support English and the active profile's Mandarin, Japanese, or Korean. Detect language changes between phrases; reliable within-sentence code switching is outside v1.
- Include optional, on-demand repeat-after-me pronunciation practice, not automatic grading of spontaneous conversation.
- Persist user recordings locally for replay, along with transcripts and assessment feedback.
- Limit conversation recordings to two minutes and pronunciation attempts to 30 seconds. Show elapsed time and a warning near the cap. The cap stops capture for review and never submits automatically.
- Defer pause-triggered stopping, stop words, automatic re-listening, and full-duplex interruption by speech. Keep capture, turn completion, and submission separate to permit these later.

## Current implementation

- React/TypeScript/Vite PWA with Dexie and Vitest; no application backend (`package.json`, `vite.config.ts`).
- `src/modules/conversation/ConversationPage.tsx` creates threads, saves text messages, invokes `conversation.generateTurn`, and subsequently applies diglot weaving. It has generation cancellation but no microphone or audio workflow.
- `src/core/ai/operations.ts` currently forces conversation responses to be primarily English. `schemas.ts` contains the typed operation inputs and outputs.
- `src/core/ai/provider.ts` loads the configured OpenAI-compatible connection. Its cancellation lifecycle needs to cover already-aborted signals and response-body consumption for reliable voice interruption.
- `src/core/speech.ts` provides read-aloud playback used elsewhere. It explicitly notes Android user-gesture requirements; additions must preserve existing Reading playback behavior.
- `src/core/domain.ts` has English source profiles and three target languages, plus existing conversation types. `database.ts` has migrations through version 5 and JSON backup version 1, without audio storage.
- `SettingsPage.tsx` handles LLM settings and explicit credential-transfer files. Normal backups currently omit the LLM connection, but export all generic settings; speech secrets must not be placed in that generic settings table.
- Specifications describe some features beyond current implementation. This change will not attempt to implement every unrelated Conversation specification item.

## Architecture

### Independent services

Keep feature components behind typed core APIs:

1. **Transcription service:** start a bounded capture session, expose partial/final transcript segments and detected locales, finish capture, or cancel. Azure is the first adapter.
2. **Conversation operation:** generate a tutor turn from bounded, profile-scoped history. Reuse the existing LLM transport; no Azure dependency in the conversational LLM contract.
3. **Playback service:** speak an ordered list of locale-tagged text segments, stop playback, expose availability and errors. Browser synthesis is the first adapter.
4. **Pronunciation service:** assess recorded audio against an explicit reference phrase and target locale. Return validated provider measurements and optional supported word/phoneme detail.

Add a small speech-provider registry with declared capabilities, not a universal provider framework. LLM, transcription, playback, and assessment remain independently selectable at the contract level. Only the confirmed implementations ship initially; native non-OpenAI LLM protocols and additional speech providers require new adapters.

Capture provider/configuration versions at operation start. Configuration changes cancel active sessions or clearly retain the original provider identity; they must never silently change an in-flight operation. Only core transports read speech credentials.

### Audio capture and turn state

Use one microphone acquisition and a shared capture pipeline so saved audio is the same audio passed to recognition. Prefer mono PCM capture via Web Audio/AudioWorklet, explicit resampling to the SDK-supported format, and WAV encoding for persistent replay and scripted assessment. Do not acquire competing microphone streams or rely on browser-specific compressed audio support. Validate actual sample rates and encoding with fixtures before wiring the full UI.

Model lifecycle explicitly:

`idle -> requesting microphone -> recording -> finalizing -> transcript review -> generating -> speaking -> idle`

Recoverable failures return to an actionable state without discarding the draft or recording. Review supports edit, replay, re-record, discard, and Send. Preserve the original recognized transcript separately from the submitted edit.

Azure recognition runs continuously: phrase-final callbacks update the transcript, but silence and phrase boundaries do not end the user's turn. Stop ends audio input, drains final recognition results with a bounded finalization timeout, and then opens review. A lost connection or service-ended session shows an interruption and preserves available audio/results; it never silently submits.

Use session/turn identifiers and AbortSignals to reject late callbacks after cancellation, thread/profile changes, unmount, or credential changes. Stop reply cancels the entire outstanding generation/playback queue. Starting a new recording first stops playback to avoid recording the tutor.

Release tracks, recognizers, AudioContexts, timers, and object URLs on all terminal paths. A microphone permission request that resolves after cancellation must immediately close its stream. Prevent concurrent practice/conversation captures and duplicate submissions.

### Language behavior and transcript review

Use Azure continuous language identification with candidates `en-US` and the active target locale. Offer an explicit English/target override for misidentification. Language identification is not a guarantee: show the transcript for correction and disclose the limitation on within-sentence switching.

Add a voice-specific typed operation rather than changing the existing English/diglot text-chat behavior. Its initial turn can have empty history and asks the tutor to greet the learner briefly in English. Later turns use conversation context, the active language profile, and explicit learner preferences.

Return validated ordered `{ text, locale }` segments limited to English and the target locale. Derive canonical display text from those segments so spoken and displayed replies agree. Keep utterances short and conversational. Unsupported/invalid output fails visibly rather than silently using the wrong language.

Voice-mode replies use their canonical bilingual content without the English-only diglot post-processing pass. Existing text-mode chat retains weaving. Typed messages remain available within voice mode and receive the same tutor behavior.

Bound history before schema validation, preserving recent completed turns and excluding pending/failed placeholders. Persist generated text before playback. Track interrupted playback separately; do not mark valid saved text as failed because synthesis failed or was stopped.

### Browser playback

Extend `src/core/speech.ts` with explicitly cancellable, locale-aware sequential playback, preserving the existing `readAloud` API.

Offer voice selection and rate controls per relevant locale. Resolve voices when the browser reports them; stop clears queued segments and suppresses stale callbacks. Never silently substitute a known wrong-language voice.

Attempt automatic reply playback after the learner has entered voice mode. Browsers may still require a fresh gesture after an asynchronous response: show a prominent Play reply action when auto-play is blocked or cannot start. Missing voices and unsupported synthesis leave the reply readable. Browser/system speech may itself use remote services; do not claim guaranteed offline synthesis.

### Repeat-after-me pronunciation practice

Let the learner choose a target-language phrase from a tutor reply, hear its model pronunciation, and record a bounded attempt. Stop opens replay/review; an explicit Assess action submits the saved audio plus reference text to Azure. Practice does not add fake user turns to chat history.

Use the known target locale, not automatic language identification. Preserve the exact reference text and assessment provider/configuration identity on each attempt.

Display accuracy, fluency, completeness, and word-level errors when returned. Show phoneme detail only for supported locales and actual returned data. Distinguish omitted words, inserted words, and pronunciation measurements.

Continuous assessment retains every phrase of the full 30-second recording, with `EnableMiscue` disabled because Azure does not support it in continuous mode. After EOF, compare recognized words against the reference using ordered text alignment: Unicode words for English/Korean, characters for unspaced Chinese/Japanese. Normalize width, case and punctuation; retain provider word/phoneme measurements only for intact recognized words. Omission/insertion labels are text-derived, can reflect recognition errors, and are not acoustic scores. Missing phrase data or excessive alignment input leaves an incomplete result rather than invented omissions or aggregate scores.

Assessment must evaluate the original audio; edited transcripts must not influence scores. No-speech, unsupported locale, incomplete results, and service failures are explicit outcomes, not zero scores or fabricated success.

Offer replay of the learner recording, replay/slow playback of the reference, and another attempt. Provide concise coaching grounded in returned errors; any LLM-generated explanation is advisory and must not invent acoustic measurements, tone diagnoses, or unsupported phoneme scores. No automatic Dictionary/mastery changes in v1.

Azure documentation currently limits prosody assessment to `en-US`. Do not promise prosody, tone scoring, or equivalent phoneme detail for Mandarin, Japanese, and Korean.

## Persistence, privacy, and settings

- Add a dedicated speech connection store with Azure region/key, acknowledgement, configuration version, and non-secret connection status.
- Add typed recording and pronunciation-attempt tables, with profile/thread/message or draft ownership, locale, duration, MIME/encoding, timestamps, and assessment references. Store audio as IndexedDB Blobs, not base64 strings in message content.
- Store conversation recordings at review so an unsent recording survives reload; allow resume or explicit discard. Retain recordings for failed transcription/generation so the learner can replay or retry without re-recording.
- Resuming a saved take over a quota-failed in-memory take requires explicit discard confirmation; declining preserves its audio and edited transcript for replay and retry-saving.
- Add optional backwards-compatible thread/message fields for voice mode, submitted/recognized transcript distinction, speech segments, cancellation, and playback metadata. Old threads default to text mode.
- Show local recording storage usage and deletion controls for individual recordings/attempts and a thread's voice data. Deletion clears linked blobs and attempts; deleting a thread removes all its voice data without deleting shared Dictionary evidence.
- Use storage estimates/persistence requests where supported. Surface quota failures before submission; keep the in-memory recording available for replay and explain that it has not been saved. Never silently evict earlier recordings.
- Normal backups include transcript/feedback metadata but exclude credentials and audio by default, with clear disclosure. Add an explicit include-recordings option using a versioned JSON representation of Blobs, and support existing version-1 imports. An omitted recording is represented as unavailable, not a broken replay button. Validate audio sizes, ownership, and references on import.
- Restored unsent metadata-only recordings (`audioUnavailable: true`) can be resumed, edited and sent without audio. Submission still requires an existing validated, owned, unsent database record; an unsaved quota-failed capture cannot bypass persistence.
- Keep LLM credential transfer behavior intact. Speech credentials remain excluded from normal backups and are re-entered on a new device in v1; never put them in generic exported settings.
- Before first microphone use, disclose that audio goes to Azure, edited/submitted conversation text goes to the configured LLM, and recordings are saved on this device. Separate microphone permission from credential-storage acknowledgement.
- Azure partial transcription can occur while recording. Transcript review prevents sending the turn to the LLM, not sending audio to Azure.
- Preserve the existing plaintext-browser-key warning. No keys, recordings, or transcript contents in logs, URL state, service-worker caches, or diagnostics.

## Implementation todos

1. **Validate browser speech integration.** Add only the Azure Speech SDK dependency, lazy-loaded for voice features. Establish a focused browser smoke path for continuous bilingual recognition, explicit stop/final-result draining, shared WAV capture, and scripted assessment. Verify HTTPS/localhost and the actual deployed Pages origin. If a browser/provider capability fails, surface that limitation before expanding the implementation; do not silently introduce a backend.
2. **Define contracts and persistence.** Add speech contracts, schemas, dedicated connection storage, audio/attempt repositories, migrations, and backwards-compatible conversation metadata. Implement ownership checks, storage-error handling, deletion, and versioned backup/import behavior.
3. **Implement capture and Azure adapters.** Build bounded recording, language identification/override, cancellation, reference-audio assessment, response validation, and actionable provider errors. Keep silence handling independent from application turn completion.
4. **Implement tutor generation and playback.** Add the voice-specific curated operation and validated locale segments, English opening behavior, bounded context, and provider-independent prompts. Correct directly coupled cancellation lifecycle gaps in the shared LLM transport. Add browser speech queues without regressing existing Reading playback.
5. **Integrate the Conversation UI.** Add voice/text thread entry, the turn state machine, timer/caps, transcript editing, recording replay, Send, Stop reply, interruption/retry handling, and lifecycle cleanup. Reset selected thread safely when changing profiles; do not allow old-profile callbacks or audio to affect the new profile.
6. **Integrate pronunciation practice and settings.** Add phrase selection, model playback, recording/review/Assess, feedback, retained attempt replay, speech configuration, voice controls, disclosures, and storage management.
7. **Cover behavior and document it.** Add targeted Vitest/React Testing Library coverage and browser acceptance checks; update conversation, AI-operation, AI-connection, data-model specifications, and README setup instructions.

Primary existing files: `src/modules/conversation/ConversationPage.tsx`, its `manifest.ts`, `src/core/ai/{operations,schemas,provider}.ts`, `src/core/speech.ts`, `src/core/domain.ts`, `src/core/database.ts`, `src/pages/SettingsPage.tsx`, and relevant styles.

New code should live under `src/core/voice/` for capture, contracts, Azure adapters, storage, and tests, with focused controls/hooks under `src/modules/conversation/`. Reuse existing core helpers rather than duplicating provider or playback behavior.

## Acceptance and validation

Use the existing Vitest and React Testing Library setup; no new test runner. Run related targeted tests together, plus the existing build/lint scripts for affected application code.

- A new voice session greets in English; subsequent prompts permit context-appropriate English/target replies, with matching validated playback segments.
- The user can switch between English and target-language phrases, stop explicitly, edit/replay the final transcript, and send exactly once. Silence and the recording cap never submit.
- The two-minute and 30-second caps work under fake timers, with warnings and recoverable review.
- Stop reply interrupts generation, response-body reading, and queued speech. Rapid Start/Stop and late SDK/LLM callbacks cannot commit stale results.
- Failed generation preserves the recording and transcript; failed playback preserves readable generated text.
- Thread/profile switching, navigation, and delayed permission grants cannot leak audio capture or attach results to the wrong owner.
- Scripted assessment uses the actual saved audio/reference/locale; unavailable scores are absent, not invented. Editing a transcript does not alter measured pronunciation.
- Recordings/attempts replay after reload, can be deleted, and have actionable quota-error behavior.
- Legacy data/backup imports remain compatible; opt-in audio backups round-trip; normal exports omit every credential.
- Existing text chat, diglot weaving, and Reading read-aloud retain their behavior.
- Real-browser checks on desktop Chrome/Edge, Android Chrome, and iOS Safari/PWA cover permission denial, background interruption, voice availability, playback gesture restrictions, and offline/error paths. Unsupported environments show an explicit capability message with text chat available.
- Live Azure and LLM validation requires user-configured credentials; do not send real learner content during synthetic connection tests or claim live integration is validated from mocks alone.

## Later backend and voice evolution

Keep backend implementation out of the first release, but preserve a concrete migration path:

- Add authenticated server-side credential storage and an Azure short-lived-token broker or speech proxy; keep long-lived keys out of browsers.
- Add account-scoped access controls, usage limits, token refresh, redacted errors, and server transport validation. GitHub Pages remains the frontend.
- Replace core credential/transport implementations without changing Conversation UI or operation schemas. Local audio stays local unless the learner explicitly enables a separate sync feature.
- Add alternative STT/TTS/assessment adapters, higher-quality cloud voices, and native LLM protocols as separate capabilities.
- Add configurable turn-end policies for pause/VAD and stop words. These produce an end-of-recording event; sending remains a separate policy decision.
- True speech-to-speech realtime/full-duplex interaction and automatic within-sentence code switching are later enhancements, not claims for this transcript-reviewed v1.

## External references checked

- Azure language identification: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-identification
  - Continuous identification supports language changes between phrases, not within a sentence.
- Azure pronunciation assessment: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
  - Assessment consumes audio with optional reference text; prosody is currently `en-US` only. Longer-than-30-second recordings require continuous-mode handling.
  - Rechecked for review fixes: continuous mode does not support `EnableMiscue`; omission/insertion labels require comparing recognized results against the reference text.
- Azure assessment language list: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment
  - Lists `zh-CN`, `ja-JP`, and `ko-KR`; individual assessment capabilities still vary.
- Browser speech synthesis: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak

## Implementation and verification status

The browser implementation now includes the Azure SDK adapter, shared AudioWorklet PCM/WAV capture, bounded explicit-review flows, locale-aware tutor/playback, scripted assessment, dedicated connection storage, recording/attempt ownership, version-2 opt-in audio backups, Settings controls and local replay/deletion.

Review-fix validation: 76 targeted tests across assessment/alignment, recording storage/submission and conversation review pass, including full 30-second multi-phrase PCM, all four alignment locales, quota-failure resume confirmation, and audio-free backup/import/submission. Production build, lint and whitespace checks pass. The existing main-chunk size warning remains; live provider/browser validation still requires configured credentials and devices.

Automated validation: **110 tests passed across 21 Vitest files**, including adapters/PCM/caps/cancellation, persistence/backup/ownership/quota behavior, voice prompts and RTL review/send/practice workflows. `npm run build`, `npm run lint` and `git diff --check` passed. The build reports a non-failing main-chunk size warning; Azure remains a separate dynamic chunk excluded from service-worker precaching. A local production-build smoke check in headless Edge used synthetic microphone audio and verified a saved 16 kHz mono WAV (1,459.9375 ms, 46,762 bytes), reload replay controls, desktop/390px layouts and absence of runtime exceptions. The design detector reported only an unchanged pre-existing accent-border warning.

Live Azure/LLM credentials and real mobile/desktop microphone/voice testing were not available for automated validation. Continuous bilingual recognition, final-result service timing, pronunciation quality and the actual deployed Pages origin remain explicit acceptance gates, not claimed successes. Follow the concrete browser checklist in README before release. Multi-phrase assessment is intentionally reported incomplete rather than inventing a whole-reference score from phrase-level measurements.
