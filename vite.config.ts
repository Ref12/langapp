import { fileURLToPath } from 'node:url'
import { createServer, defineConfig, type Plugin, type ViteDevServer } from 'vite'

function versionedSite(): Plugin {
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
        const [pathname, query] = (request.url ?? '/').split('?')
        if (pathname === '/v1' || pathname.startsWith('/v1/')) {
          legacy.middlewares(request, response, next)
          return
        }

        // Keep app-only navigation at root and the device frame at /preview.html.
        const entry = pathname === '/' || pathname === '/index.html'
          ? '/app.html'
          : pathname === '/preview.html' ? '/index.html' : undefined
        if (entry) request.url = entry + (query === undefined ? '' : `?${query}`)
        next()
      })
    },
    async closeBundle() {
      await v1?.close()
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./docs/mockups/', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./node_modules/.vite/mockups/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  base: './',
  appType: 'mpa',
  plugins: [versionedSite()],
  build: { outDir: '../../dist' },
})
