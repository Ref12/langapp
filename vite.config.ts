import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}

export default defineConfig(async () => {
  const { VitePWA } = await import('vite-plugin-pwa')

  return {
    base: './',
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
        },
      }),
    ],
  }
})
