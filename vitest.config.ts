import { defineConfig } from 'vitest/config'
import { buildDefines } from './scripts/build-channel'

export default defineConfig({
  define: buildDefines(process.env.LINGUAWEAVE_TEST_CHANNEL === 'stable' ? 'stable' : 'lab', undefined, 'all'), // LINGUAWEAVE_TEST_CHANNEL=stable runs a test file as the Stable build would
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
