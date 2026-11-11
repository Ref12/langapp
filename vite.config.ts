import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type UserConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mockupFiles } from './scripts/mockup-files.mjs'
import { localSettings } from './scripts/local-settings'
import { localProfiles } from './scripts/local-profiles'
import { localTts } from './scripts/local-tts'
import { languageCharacters } from './scripts/language-characters'
import { pwa } from './scripts/pwa'
import { buildDefines, languageFromEnv } from './scripts/build-channel'

/** Which build this is: main is Lab; the Stable branch says 'stable' here. */
const BUILD_CHANNEL = 'lab' as const
/** Which language this build is for: LANGAPP_LANGUAGE (zh, ja, ko; default zh). */
const BUILD_LANGUAGE = languageFromEnv(BUILD_CHANNEL)

function mountDevicePreview(server: Pick<ViteDevServer, 'config' | 'middlewares'>) {
  const base = server.config.base.startsWith('/') ? server.config.base : '/'
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/dev' || url.pathname === `${base}dev`) {
      response.writeHead(302, { Location: `${base}dev/${url.search}` })
      response.end()
      return
    }
    if (url.pathname === '/dev/' || url.pathname === `${base}dev/`) {
      request.url = `${url.pathname}index.html${url.search}`
    }
    next()
  })
}

function devSite(mockups: Set<string>): Plugin {
  return {
    name: 'dev-site',
    configureServer(server) {
      mountDevicePreview(server)
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const pathname = url.pathname

        // The design previews retain their original relative URLs, on a separate page.
        const filename = pathname === '/preview.html' ? 'index.html' : pathname.slice(1)
        if (pathname !== '/index.html' && mockups.has(filename)) {
          request.url = `/docs/mockups/${filename}${url.search}`
        }
        next()
      })
    },
    configurePreviewServer(server) {
      mountDevicePreview(server)
    },
  }
}

export default defineConfig(async (): Promise<UserConfig> => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./node_modules/.vite/next/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  base: './',
  define: buildDefines(BUILD_CHANNEL, BUILD_LANGUAGE),
  appType: 'mpa',
  plugins: [react(), localSettings(), localProfiles(), localTts(), devSite(new Set(await mockupFiles())), languageCharacters(BUILD_LANGUAGE), pwa(BUILD_CHANNEL, BUILD_LANGUAGE)],
  // public/ is copied by languageCharacters, which leaves out the other languages' stroke data.
  build: { outDir: 'dist', copyPublicDir: false },
}))
