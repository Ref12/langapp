import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}

export default defineConfig(async ({ command, isPreview }) => {
  const { VitePWA } = await import('vite-plugin-pwa')

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    cacheDir: fileURLToPath(new URL('../../node_modules/.vite/v1/', import.meta.url)),
    base: command === 'serve' && !isPreview ? '/v1/' : './',
    build: {
      outDir: '../../dist/v1',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          name: 'LinguaWeave',
          short_name: 'LinguaWeave',
          description: 'Learn languages through reading and conversation.',
          theme_color: '#173f35',
          background_color: '#f7f3e9',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          globIgnores: ['**/microsoft.cognitiveservices.speech.sdk-*.js'],
        },
      }),
    ],
  }
})
