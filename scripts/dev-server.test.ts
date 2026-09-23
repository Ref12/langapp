// @vitest-environment node
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { expect, it } from 'vitest'
import { LOCAL_TTS_HEADER, LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH } from '../src/core/local-tts-contracts'

it('serves the production app, separate mockups, and transformed v1 dependencies from one origin', async () => {
  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, hmr: false },
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
    expect(server.config.define?.['import.meta.env.DEV_LOCAL_TTS']).toBe(JSON.stringify('true'))
    const blockedCatalog = await fetch(base + LOCAL_TTS_VOICES_PATH)
    expect(blockedCatalog.status).toBe(403)
    const invalidCatalogMethod = await fetch(base + LOCAL_TTS_VOICES_PATH, {
      method: 'POST', headers: { [LOCAL_TTS_HEADER]: '1', Origin: base },
    })
    expect(invalidCatalogMethod.status).toBe(405)
    expect(invalidCatalogMethod.headers.get('Allow')).toBe('GET')
    const blockedTts = await fetch(base + LOCAL_TTS_PATH, { method: 'POST' })
    expect(blockedTts.status).toBe(403)
    const invalidTts = await fetch(base + LOCAL_TTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [LOCAL_TTS_HEADER]: '1', Origin: base },
      body: '{}',
    })
    expect(invalidTts.status).toBe(400)
    expect(await invalidTts.json()).toHaveProperty('error')
    expect(await fetch(base + '/index.html').then(response => response.text())).toContain('src="/src/main.tsx"')
    expect(await fetch(base + '/preview.html').then(response => response.text())).toContain('id="prototype-frame"')
    const redirect = await fetch(base + '/dev?review=lessons', { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/dev/?review=lessons')
    const devicePreview = await fetch(base + '/dev/').then(response => response.text())
    expect(devicePreview).toContain('Live Mandarin learning app')
    expect(devicePreview).toContain('data-device="mobile"')
    expect(await fetch(base + '/dev/preview.js').then(response => response.text())).toContain("new URL('../index.html', location.href)")
    expect(await fetch(base + '/device-preview.js').then(response => response.text())).toContain('ResizeObserver')
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
