import { defineConfig } from 'vitest/config'
import { buildDefines } from './scripts/build-channel'

// Tests that do not touch the DOM run in node, without jsdom: scripts/** and the pure-logic tests under src/core/**.
// These src/core tests need the DOM (window, document, localStorage, IndexedDB-backed profiles) and keep jsdom; the first matching glob wins.
const domInCore = [
  'src/core/appUpdate.test.ts',
  'src/core/guided-audio.test.ts',
  'src/core/ai/local-connection.test.ts',
  'src/core/ai/request-credentials.test.ts',
  'src/core/assistant/conversation-voice.test.ts',
  'src/core/assistant/edge-speech.test.ts',
  'src/core/assistant/images.test.ts',
  'src/core/assistant/practice-history.test.ts',
  'src/core/assistant/practice-playback.test.ts',
  'src/core/assistant/selection.test.ts',
  'src/core/assistant/speech-assessment.test.ts',
  'src/core/assistant/speech-capture.test.ts',
  'src/core/assistant/speech-warmup.test.ts',
  'src/core/assistant/speech.test.ts',
  'src/core/backup/diagnostics.test.ts',
  'src/core/backup/journal.test.ts',
  'src/core/backup/setup-link.test.ts',
  'src/core/backup/service.test.tsx',
  'src/core/characters/handwritingEngine.test.ts',
  'src/core/collections/collections.test.ts',
  'src/core/collections/language.test.ts',
  'src/core/handsfree/store.test.ts',
  'src/core/library/library.test.ts',
  'src/core/media/entries.test.ts',
  'src/core/media/translation.test.ts',
  'src/core/profiles/bootstrap.test.ts',
  'src/core/profiles/endpoints-profile.test.ts',
  'src/core/profiles/language-export.test.ts',
  'src/core/profiles/local-client.test.ts',
  'src/core/profiles/stable-lab.test.ts',
  'src/core/profiles/store.test.ts',
  'src/core/study/daily.test.ts',
]

export default defineConfig({
  define: buildDefines(process.env.LINGUAWEAVE_TEST_CHANNEL === 'stable' ? 'stable' : 'lab', undefined, 'all'), // LINGUAWEAVE_TEST_CHANNEL=stable runs a test file as the Stable build would
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [
      ...domInCore.map(glob => [glob, 'jsdom'] as [string, string]),
      ['scripts/**/*.test.{ts,js,mjs}', 'node'],
      ['src/core/**/*.test.{ts,js}', 'node'],
    ],
    setupFiles: './src/test/setup.ts',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
