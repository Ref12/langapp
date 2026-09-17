# LinguaWeave

A local-first Mandarin learning workspace built around stories, useful lessons,
and shared vocabulary progress. The original multilingual PWA remains available
as v1.

## Application versions

The original deployed application is preserved in [`versions/v1`](versions/v1).
Its source, public assets, TypeScript projects, and Vite/PWA configuration live
there. The repository root owns the shared dependency lockfile, quality gates,
and deployment assembly; run npm commands from the repository root.

The site root serves the new React/TypeScript application in [`src`](src), using
the mockups' blue/slate design and shared theme tokens. It has a real, isolated
Mandarin workspace with no seeded progress or accounts. Assistant can use your
own AI connection after explicit configuration; no credentials are preloaded.

The original app remains at `/v1/` (or `/langapp/v1/` on repository Pages).
Use `/dev/` for the real app with **Desktop / Mobile** preview controls.
The controls resize the same app without resetting drafts or saved progress;
the preview follows its route and theme. `/dev` redirects to `/dev/`.
The mockup device-preview frame is available at `/preview.html`; the writing comparison
is at `/writing-comparison.html`. `/app.html` opens the original app-only mockup.
Those design artifacts remain memory-only and never access either app's database.

## Mandarin foundation

- Overview centers on the next curriculum lesson, beginner lesson progress, and
  practice. Stories and their saved reading positions remain in the Library.
- Read two original stories in English, annotated Mandarin, or a weave that
  substitutes only words you have added. Passage completion and reading position
  are saved explicitly; simply opening a page does not count as reading it.
- Explore the real six-phase, thirty-level Practical Mandarin course map.
  Levels 1-4 are playable: twelve modules, 205 canonical vocabulary senses, and
  25 grammar references. Later levels expose goals, prerequisites, module
  outlines, and checkpoint tasks, but cannot be practiced or completed yet.
- Beginner modules are divided, in source order, into parts of 5-8 new senses
  and at most one new construction. Each practice session starts with up to
  three already-introduced senses selected from the authored earlier reviews
  and earlier parts of the module, prioritizing the earliest due dates.
  The original starter lessons have been removed. The two stories and 14 local
  example items remain available, with their existing vocabulary progress.
  Old lesson backups retain saved answers, and unfinished sessions can continue
  as vocabulary practice without restoring the removed lessons or their links.
- Practice character-to-meaning and meaning-to-character recognition. Questions,
  answer choices, revealed answers, and feedback survive reload. Each checked
  answer is recorded once, before advancing.
- A new word is **Introduced**; a checked answer makes it **Practicing**.
  **Learned** requires unaided correct reading answers on three distinct local
  calendar days, with both question directions since the last miss or assisted
  answer. Same-day repetition does not create spaced evidence. Successful days
  schedule reviews after 1, 3, and 7 days; misses and revealed answers return
  after 5 minutes. No automatic **Mastered** status is awarded.
- Hearing, speaking, and writing remain **Not studied**. Lesson completion records
  practice, not mastery or an official HSK result. This is the new mockup-based
  reading-state policy, separate from v1's Learning/Familiar/Mastered model.
  Curriculum contextual understanding, productive use, grammar evidence, and
  communicative checkpoints remain **unassessed**. A full recognition queue
  does not pass a level's goals. Prerequisites are guidance, not enforced gates.
- Save appearance and reading preferences; download or explicitly restore a
  versioned backup in Settings. Restore replaces only the new workspace, inside
  one transaction. Backups include Assistant conversations but exclude device
  credentials, are bounded to 5 MiB, and are not compatible with v1.
  Content version 2 adds curriculum references; previous content-version-1
  starter backups remain readable without rewriting their IDs or saved answers.

The starter content in `src/data/mandarin.ts` is original material adapted from
the design examples. Its local `zh:*` IDs and historical progress remain separate
from the imported curriculum's canonical sense IDs, even when spelling matches.
No heuristic migration awards curriculum evidence. The cup object (`杯子`) and
cupful measure word (`杯`), and the greeting, approval, and adjective senses of
`好`, remain distinct. New practice choices exclude duplicate written forms and
shared English gloss alternatives; recognition still does not assess use in context.

Not connected in this checkpoint: personal imports, playable levels 5-30,
tourist or specialist routes, contextual and productive exercises or level assessment,
microphone/voice conversation, generated stories/lessons/exercises, audio or
handwriting assessment, other target
languages, synchronization, and installation/offline shell caching for the new
app. The Library links to the original v1 import tools rather than simulating
imports. V1's voice tutor remains available independently.

## Assistant

Assistant provides persistent English/Mandarin text conversations and **Shadow**
practice. Configure an OpenAI-compatible API protocol, base URL, key, and model in
**Settings -> Assistant AI connection**. Saving is local and does not send a
request. **Test connection** sends a synthetic request with the selected
capabilities; it does not send your conversations or learning data.

Choose **Chat Completions** or **Responses API** to match your endpoint.
Existing connections without an `apiType` continue to use Chat Completions.
Both protocols use the same bounded tutor loop and validated teaching blocks;
protocol selection never silently falls back to a different API.
Provider transport is kept separate from the tutor loop so a future central
service can replace the direct provider calls. No central service is used today.

Enable native tool calling or strict JSON-schema responses only if your endpoint
supports them. Without schema support, the app requests JSON and validates the
response locally. Unsupported responses fail visibly rather than switching
protocols or displaying a simulated conversation. HTTPS is required except for
localhost, and the endpoint must permit browser CORS requests.

**Send** shares bounded conversation history, relevant learning context, and
any selected source text with your configured provider; provider charges may
apply. Optional native tools retrieve known words, lessons, and reading evidence.
They cannot modify learning progress or save generated content. Responses are
validated text and locale-tagged speech blocks, not executable code. Ordinary
Markdown examples never dispatch app operations.

Each conversation keeps its own draft, source context, mode, romanization
preference, and Mandarin playback speed. New conversations are named after the
first sent message. Failed draft saves are visibly reported, and the unsaved
text remains in memory across in-app navigation so you can retry; it is not safe
to close or reload until saved. Switching Conversation/Shadow affects subsequent turns and
preserves previous messages. Shadow supports a new phrase, repeat-after-me practice,
and **Explain more** without treating text repetition as pronunciation scoring.
**Stop reply** cancels generation; retry is explicit. Reloading never sends an
AI request. Interrupted work can be stopped and retried.

**Ask** stays in the current conversation when used inside a chat,
appending to the existing draft without sending or replacing its text. Elsewhere,
it starts a new conversation with an editable draft and exact source context.
Each Mandarin speech snippet in an Assistant reply has its own **Hear / Ask / Practice**
buttons; ordinary explanation blocks do not. Word cards have one action row.
**Practice** selects that phrase for repetition in Shadow mode and focuses the
composer, preserving the current draft without sending a message. It is available
on phrases from either mode, and the selected practice phrase survives reload.
A small **Copy full message** button below each
message copies its complete text, including speech, romanization, and meanings.
Neither action adds learning evidence. Selected text offers contextual actions;
**Alt+Enter** focuses
them and Escape dismisses them. Source context excludes pronunciation annotations
and controls. During recognition practice, help is available only after checking
or revealing the answer, so it cannot bypass the existing assistance policy.

**Hear** uses the Mandarin and English selections in **Settings -> Hear voices**.
Selections save automatically, survive reload, and apply to every Hear button.
The default **Automatic (local first)** prefers a matching installed local voice.
After a brief discovery window, it uses a matching online browser voice if no
local voice is available. The discovered voice is cached for the page session,
so later Hear clicks reuse it without another discovery wait. Cached voices are
checked against the current browser list before reuse. Changed selections,
playback failures, and **Refresh voice list** invalidate cached choices.
An explicitly selected available voice plays without the discovery wait.
A missing saved voice remains selected and is labeled unavailable: choose another
voice or Automatic, or enable the saved voice and refresh. It never silently
switches from a selected local voice to an online voice.
Online playback sends the chosen text to the browser's speech service; the
settings and playback status identify online voices. Viewing or changing voice
settings never starts playback or sends an AI request. Hear never requests
microphone access or falls back to a wrong-language voice. Missing voices and
playback failures are reported visibly. Discovery handles delayed and partial
lists. Mandarin locale aliases and Taiwanese Mandarin are supported, with
Simplified/mainland voices preferred in Automatic mode.
English plays at normal speed;
Mandarin phrases in a conversation use that conversation's chosen rate.
Navigation, page hiding, and Escape stop playback.

AI keys are plaintext device settings accessible to code on the same origin;
use a restricted key. They are excluded from every workspace backup. New
version-2 backups include conversations, drafts, and recoverable run state.
Version-1 root-app backups remain readable and restore with no conversations.
Restoring replaces learning and conversation data, preserves the device's AI
connection, and never resumes a request automatically. V1 data and settings
remain isolated.

### Assistant system prompts

Mode instructions live in `settings/system-prompts/conversation.md` and
`settings/system-prompts/shadow.md`. The `repeat.md` and `explain.md` files add
instructions for those explicit turn intents. Edit these ordinary Markdown files
to tune teaching behavior; the selected mode and intent are assembled anew for
each turn, not saved as historical system messages.

These are tracked, public application files, bundled into development and
production builds with no runtime settings fetch. Rebuild/redeploy to publish
prompt changes; do not put credentials or private information in them. They are
independent of the ignored `app.settings.jsonc` connection settings. Mandatory
response-format, read-only-tool, and untrusted-data rules remain app-owned in
TypeScript, and replies and tool calls are still validated regardless of prompts.

## Curriculum source integration

`scripts/generate-app-curriculum.mjs` creates the deterministic
`src/data/curriculum.generated.json` projection from the checked-in Chinese
teaching program, HSK readiness plan, and reference grammar. No external service
or runtime YAML parser is required. The app adapter is `src/data/curriculum.ts`.
Canonical sense/construction IDs, disambiguators, pinyin, authored order, and
review dependencies are retained. Small lesson IDs identify a level, module,
and part; their introduction boundaries must remain stable in future revisions
or receive an explicit content migration.

Grammar notes and bilingual reference examples are displayed, not assessed.
Examples can contain additional supporting vocabulary, with English translations;
viewing them never introduces those words or awards grammar progress. The app
does not fabricate vocabulary examples, parts of speech, or grammar pinyin.
The six-phase progression is independently authored; reference HSK numbers are
provenance, not teaching priorities or examination claims. The separate
`curriculum/chinese/teaching/hsk-readiness.yaml` overlay maps the thirty course
levels into HSK 1-6 preparation sections with skill work and mock-test cycles.
It does not convert course progress into an official HSK result. The companion
`hsk-audit.yaml`, checked by `scripts/audit_hsk_readiness.py`, verifies complete
cumulative headword coverage for all 5,400 official July 2026 vocabulary rows
and recognized legacy-list vocabulary in ten hash-pinned papers per level.
The pass claim remains unsupported until the official grammar crosswalk and
external timed listening, reading, and writing performance gates are complete.
No copyrighted paper or transcript is checked in.
HSK 7-9 is orientation-only until translation, speaking, source-based writing,
and an audited current-syllabus split are supported.

```powershell
npm run curriculum:generate
npm run curriculum:check
python scripts\audit_hsk_readiness.py --check
```

Edit the original curriculum authoring sources and regenerate their source views
using the existing curriculum tools before generating this projection. Do not
repair generated app JSON or copied notices in isolation. The app generator
operates offline; its check mode and source-integrity tests reject stale output.
Production builds check the projection before bundling.

The learning interface has no curriculum-sources page or attribution navigation.
Exact source notices and CC-BY-SA/MIT license texts are generated into
`public/curriculum/chinese` and shipped with the app.
Adapted dictionary material retains its CC-BY-SA obligations; MIT wrapper notices
do not supersede them. See `curriculum/chinese/sources.yaml` for pinned versions
and limitations.

## Development

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/` for the Mandarin workspace or
`http://localhost:5173/v1/` for the archived application. One server hosts both,
with the original v1 Vite server mounted under `/v1/`. Each app has its own
dependency-optimization cache. Design previews are served directly from
`docs/mockups`, not from copies connected to production storage.
For standalone v1 development with hot module replacement, use `npm run dev:v1`.
Open `http://localhost:5173/dev/#lessons` to review the real curriculum in desktop
and phone-sized layouts. The same `/dev/` route is included in the built site
and works beneath a Pages prefix such as `/langapp/dev/`.

### Local app settings

To avoid entering the connection again in each fresh browser profile, copy the
commented template into the git-ignored JSONC file in the `settings` directory:

```powershell
Copy-Item settings\app.settings.template.jsonc settings\app.settings.jsonc
```

Both files use the `app.settings` prefix and the `.jsonc` format extension.
If `settings\app.settings.jsonc` already exists, edit it rather than replacing it.
Existing plain JSON settings can be renamed from `.json` to `.jsonc` unchanged.

Settings are grouped by section so other app settings can be added later.
Currently, the optional `aiConnection` section is supported. Within it, fill in
`baseUrl`, `apiKey`, and `model`. Choose `"apiType": "responses"` or
`"apiType": "chat-completions"`; omitting it retains Chat Completions.
The template explains every field. Set `nativeTools` and
`structuredOutput` to `true` only when supported. Set
`"storageAcknowledged": true` to opt into saving the key in plaintext browser
storage. These flags are JSON booleans, not strings. Use a restricted development
key; never commit `settings\app.settings.jsonc` or put it in `public`.
The file must be valid JSONC, no larger than 32 KiB. Line/block comments and
trailing commas are supported; malformed syntax is rejected, not repaired.
The earlier `.env.local` /
`ASSISTANT_AI_` shortcut is no longer read.

During `npm run dev`, the app automatically queries a localhost-only endpoint
on startup **only when no AI connection is already saved**. It validates and
saves `aiConnection`, then makes it available in Settings and Assistant.
Loading configuration does not test the provider, send a message, or alter
learning progress. Missing configuration is optional; invalid configuration
shows an error and leaves manual setup available.

Saved settings always win, including a save in another tab while the file is
loading. To apply changes to the file, remove the saved connection in Settings
and reload. To leave AI unconfigured, also remove `aiConnection` from the local
JSONC file (an empty `{}` is valid), or remove the file altogether. Only this
file is read; environment variables do not override its settings.

This shortcut is unavailable on LAN addresses, in `npm run preview`, and in
production. Credentials are not embedded in bundles, cached by the endpoint,
or included in workspace backups. The dev endpoint accepts only same-origin
app requests on localhost, and both development servers block direct access to
the credential file.
Normal browser-to-provider CORS requirements still apply.

### Standalone structured-output probe

`scripts\Test-StructuredOutput.ps1` requires PowerShell 7 and sends **one
potentially billable synthetic request**. Supply the URL, model, and API key
(or set `OPENAI_API_KEY`). Use a variable for the key rather than entering a
literal secret in shell history:

```powershell
.\scripts\Test-StructuredOutput.ps1 -Url $url -ApiKey $key -Model $model -ApiType responses
.\scripts\Test-StructuredOutput.ps1 -Url $url -ApiKey $key -Model $model -ApiType chat-completions
```

The URL can be an API root or a full operation URL. A full URL selects its
protocol; a root defaults to Responses unless `-ApiType` is supplied.
The probe asks for plain text but supplies a strict schema containing a random
proof value **only in the schema**. It checks actual field names, types, enum
values, and additional properties rather than treating HTTP 200 as success.
Passing demonstrates observed compliance, not a universal enforcement guarantee.

It prints a JSON report and exits with **0** for a conforming reply, **1** for
a completed but nonconforming reply, or **2** for inconclusive results such as
authentication/quota errors, refusal, truncation, or timeout. Use
`-MaxOutputTokens` or `-TimeoutSeconds` to adjust the limits. It never retries,
follows redirects, switches protocols, or changes the app's settings. Unlike the
browser app, this script does not test browser CORS permissions.

Run the same quality gates as deployment:

```powershell
npm run lint
npm test
npm run build
```

## Deployment

Pushes to `main` run `.github/workflows/deploy-pages.yml`. The workflow
installs from the lockfile, runs lint and tests, creates the production build,
and deploys `dist` to GitHub Pages. `npm run build` first builds the new app
(`build:next`), then the archived app (`build:v1`) into `dist/v1`, and finally
publishes the separate design previews, runtime assets, and character-data
license. Preview assembly never overwrites the production `index.html`.
The retirement worker for the former root PWA is retained. Mockup tests,
documentation, and screenshot fixtures are not published. `npm run preview`
serves the complete `dist` site, including `/v1/`.

The app uses hash routing and relative assets so it works at a repository Pages
path such as `https://ref12.github.io/langapp/v1/`. The v1 manifest and service
worker are scoped to that subdirectory. The old root service worker is retired
when the browser discovers its update, without clearing IndexedDB or caches.

Moving to a subpath does not move browser storage: v1 retains the `linguaweave`
IndexedDB database, so existing profiles, imported content, credentials, and
progress remain available on the same origin. The new root app uses
`linguaweave-next` (schema version 2), with its own preferences, word states,
reading positions, lesson completion, practice sessions, immutable attempts,
Assistant conversations/runs, and separate device AI settings. Existing
schema-version-1 workspaces migrate without rewriting learning evidence.
It does not open, migrate, or restore the v1 database. No new root service worker
is registered yet.

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
