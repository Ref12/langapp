# LinguaWeave

A modular, local-first language-learning PWA built around shared learning
items, reading techniques, and AI conversation.

## Application versions

The original deployed application is preserved in [`versions/v1`](versions/v1).
Its source, public assets, TypeScript projects, and Vite/PWA configuration live
there. The repository root owns the shared dependency lockfile, quality gates,
and deployment assembly; run npm commands from the repository root.

The site root now serves the app-only experience mockups directly from
[`docs/mockups/app.html`](docs/mockups/app.html), with Mandarin sample content.
This second checkpoint is still an interactive prototype: its progress,
conversations, and learning interactions are illustrative and memory-only.
Reloading resets them. It does not access v1's local data or connect live AI.

The original app remains at `/v1/` (or `/langapp/v1/` on repository Pages).
The device-preview frame is available at `/preview.html`; the writing comparison
is at `/writing-comparison.html`. Both use the same mockup assets as the root app.

## Development

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/` for the mockups or
`http://localhost:5173/v1/` for the archived application. One server hosts both,
with the original v1 Vite server mounted under `/v1/`. Root mockup changes are
served directly from `docs/mockups`; no copied frontend source needs updating.
For standalone v1 development with hot module replacement, use `npm run dev:v1`.

Run the same quality gates as deployment:

```powershell
npm run lint
npm test
npm run build
```

## Deployment

Pushes to `main` run `.github/workflows/deploy-pages.yml`. The workflow
installs from the lockfile, runs lint and tests, creates the production build,
and deploys `dist` to GitHub Pages. `npm run build:v1` builds the archived app
into `dist/v1`; `npm run build` also publishes the root mockup HTML, runtime
assets, and bundled character-data license, plus the retirement worker for the
former root PWA. Mockup tests, documentation, and screenshot fixtures are not
published. `npm run preview` serves the complete `dist` site, including `/v1/`.

The app uses hash routing and relative assets so it works at a repository Pages
path such as `https://ref12.github.io/langapp/v1/`. The v1 manifest and service
worker are scoped to that subdirectory. The old root service worker is retired
when the browser discovers its update, without clearing IndexedDB or caches.

Moving to a subpath does not move browser storage: v1 retains the `linguaweave`
IndexedDB database, so existing profiles, imported content, credentials, and
progress remain available on the same origin. The root prototype registers no
service worker and uses no persistent learning database. Future production
implementation must use a separate database unless an explicit migration is
introduced.

## Voice tutor setup (v1)

1. Keep your preferred OpenAI-compatible endpoint/key/model in **Settings → AI connection**.
2. Create an Azure Speech resource, then enter its **region identifier** (for example `eastus`) and key in **Settings → Voice and pronunciation**. Acknowledge plaintext browser storage. Saving is not a live connection test. Speech credentials are separate from the LLM and excluded from every backup.
3. Use HTTPS or localhost and a current AudioWorklet-capable browser. In **Conversation → New voice conversation**, the tutor opens in English. Enable microphone recording only after reading the audio-transfer disclosure.
4. Tap **Record a turn**, then **Stop recording**. Review, edit and replay before **Send**. English plus the active Mandarin/Japanese/Korean language is detected between phrases; use the language selector when detection is wrong. Switching inside a sentence is not reliably supported. Silence never submits.
5. **Stop reply** cancels generation and speech. **Play reply** retries browser playback after a gesture restriction or missing voice. Configure locale-specific voices and rates in Settings; browser/system voices may use online services.
6. Choose a target-language phrase with **Practice**, hear the reference, record, stop and explicitly **Assess saved audio**. This evaluates the original audio against the chosen phrase, not an edited transcript. Practice does not send a chat turn or alter Dictionary mastery.

Conversation capture stops for review at 120 seconds; practice at 30 seconds, with a warning during the last 10 seconds. Phrase-final recognition does not stop capture. A service/background interruption preserves available audio for review.

Recordings and attempts live in IndexedDB as mono 16 kHz PCM WAV Blobs. Resume unsent takes under **Saved recordings and practice**; use **Save draft edit** to retain transcript edits before leaving. Individual recordings, thread voice data and complete voice conversations can be deleted there. Settings shows audio storage usage and offers a browser persistence request. If saving fails, keep the review open, free space and retry; the in-memory audio is not safe after navigation/reload.

Normal backups include transcript/feedback metadata, **not audio or credentials**. Select **Include recordings in this backup** to export bounded, versioned audio (128 MiB total limit). Version-1 backups still import. Without audio, imported recordings are explicitly unavailable. Speech keys must be re-entered; existing separate LLM credential transfer is unchanged. Voice preferences are device-local.

### Browser acceptance checks

Automated Vitest/RTL checks cover capture caps, shared PCM/WAV encoding, SDK callbacks, cancellation, transcript review/Send, storage ownership/quota/backup behavior and playback failures. A local production-build smoke check also exercised **headless Edge with synthetic microphone input**, saved a mono 16 kHz WAV, reloaded replay controls, and checked desktop/390px layout without runtime errors.

**Not live-validated:** Azure recognition/assessment, configured LLM service calls, real microphones/voices, deployed Pages behavior, Android Chrome, or iOS Safari/PWA. Before release, run these checks on desktop Chrome/Edge, Android Chrome and iOS Safari/PWA, including the actual HTTPS Pages origin:

- Use synthetic phrases: record English, pause, then speak the target language; stop and confirm the final phrase is drained. Correct the transcript, replay, Send once and verify contextual bilingual speech.
- Deny microphone access; then allow it. Cancel a pending permission request; navigate/change profile while capturing or generating. Confirm the microphone indicator clears and no result appears in another thread.
- Let the 120s/30s limits expire; confirm review without sending/assessment. Background the app and disconnect the network during capture; inspect retained audio and the interruption message.
- Interrupt generation and playback with Stop reply, test a missing target voice and a fresh-gesture playback restriction, then retry Play reply.
- Assess one short reference phrase using its saved WAV. Verify actual returned scores, omission/insertion distinctions, no-speech and service-error outcomes. Multi-phrase results can be explicitly incomplete; no prosody/tone scores are promised.
- Reload an unsent take and an assessed attempt, replay, delete and restore both default and audio-inclusive backups. Verify storage-full behavior without silent eviction.

## Specifications

- [`specs/app.md`](specs/app.md)
- [`specs/data-model.md`](specs/data-model.md)
- [`docs/implementation-plan.md`](docs/implementation-plan.md)
- [Dark-theme experience UI mockups](docs/mockups/README.md)
