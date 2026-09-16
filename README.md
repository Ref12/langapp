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
Mandarin workspace: no seeded progress, accounts, credentials, or live AI calls.

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
  one transaction. Backups are bounded to 5 MiB and are not compatible with v1.
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
live Assistant/voice services, audio or handwriting assessment, other target
languages, synchronization, and installation/offline shell caching for the new
app. The Assistant and Library pages link to the original v1 tools rather than
simulating those features.

## Curriculum source integration

`scripts/generate-app-curriculum.mjs` creates the deterministic
`src/data/curriculum.generated.json` projection from the checked-in Chinese
teaching program and reference grammar. No external service or runtime YAML
parser is required. The app adapter is `src/data/curriculum.ts`.
Canonical sense/construction IDs, disambiguators, pinyin, authored order, and
review dependencies are retained. Small lesson IDs identify a level, module,
and part; their introduction boundaries must remain stable in future revisions
or receive an explicit content migration.

Grammar notes and bilingual reference examples are displayed, not assessed.
Examples can contain additional supporting vocabulary, with English translations;
viewing them never introduces those words or awards grammar progress. The app
does not fabricate vocabulary examples, parts of speech, or grammar pinyin.
The six-phase progression is independently authored; reference HSK numbers are
provenance, not teaching priorities or examination claims.

```powershell
npm run curriculum:generate
npm run curriculum:check
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
`linguaweave-next` (schema version 1), with its own preferences, word states,
reading positions, lesson completion, practice sessions, and immutable attempts.
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
