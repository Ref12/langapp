import { fileURLToPath } from 'node:url'
import { createServer, defineConfig, type Plugin, type UserConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mockupFiles } from './scripts/mockup-files.mjs'

function versionedSite(mockups: Set<string>): Plugin {
  let v1: ViteDevServer | undefined

  return {
    name: 'versioned-site',
    async configureServer(server) {
      v1 = await createServer({
        configFile: fileURLToPath(new URL('./versions/v1/vite.config.ts', import.meta.url)),
        server: { middlewareMode: true, hmr: false, watch: null },
      })
      const legacy = v1
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const pathname = url.pathname
        if (pathname === '/v1' || pathname.startsWith('/v1/')) {
          legacy.middlewares(request, response, next)
          return
        }

        // The design previews retain their original relative URLs, on a separate page.
        const filename = pathname === '/preview.html' ? 'index.html' : pathname.slice(1)
        if (pathname !== '/index.html' && mockups.has(filename)) {
          request.url = `/docs/mockups/${filename}${url.search}`
        }
        next()
      })
    },
    async closeBundle() {
      await v1?.close()
    },
  }
}

export default defineConfig(async (): Promise<UserConfig> => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./node_modules/.vite/next/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  base: './',
  appType: 'mpa',
  plugins: [react(), versionedSite(new Set(await mockupFiles()))],
  build: { outDir: 'dist' },
}))
