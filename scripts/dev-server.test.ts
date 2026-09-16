// @vitest-environment node
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { expect, it } from 'vitest'

it('serves the production app, separate mockups, and transformed v1 dependencies from one origin', async () => {
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
    expect(root).toContain('src="/src/main.tsx"')
    expect(root).not.toContain('<iframe')
    expect(await fetch(base + '/index.html').then(response => response.text())).toContain('src="/src/main.tsx"')
    expect(await fetch(base + '/preview.html').then(response => response.text())).toContain('id="prototype-frame"')
    expect(await fetch(base + '/app.html').then(response => response.text())).toContain('id="overview"')
    expect(await fetch(base + '/exercise-cafe.svg').then(response => response.text())).toContain('<svg')
    for (const path of ['sources.yaml', 'licenses/CC-BY-SA-4.0.txt', 'licenses/complete-hsk-MIT.txt']) {
      const response = await fetch(`${base}/curriculum/chinese/${path}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(await readFile(resolve('curriculum', 'chinese', path), 'utf8'))
    }

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
