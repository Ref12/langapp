// @vitest-environment node
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { expect, it } from 'vitest'

it('serves the mockups and transformed v1 dependencies from the same development origin', async () => {
  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Missing development server address')
    const base = `http://127.0.0.1:${address.port}`
    const root = await fetch(base + '/').then(response => response.text())
    expect(root).toContain('id="overview"')
    expect(root).not.toContain('<iframe')
    expect(await fetch(base + '/index.html').then(response => response.text())).toContain('id="overview"')
    expect(await fetch(base + '/preview.html').then(response => response.text())).toContain('id="prototype-frame"')

    const legacy = await fetch(base + '/v1/').then(response => response.text())
    expect(legacy).toContain('id="root"')
    expect(legacy).toContain('src="/v1/src/main.tsx"')
    const main = await fetch(base + '/v1/src/main.tsx').then(response => response.text())
    const dependencies = [...main.matchAll(/from "(\/v1\/[^"]+\/deps\/[^"]+)"/g)].map(match => match[1])
    expect(dependencies.length).toBeGreaterThan(0)
    for (const path of dependencies) {
      expect(path).toContain('/node_modules/.vite/v1/deps/')
      const response = await fetch(base + path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('javascript')
      expect(await response.text()).toContain('export')
    }
  } finally {
    await server.close()
  }
}, 30_000)
