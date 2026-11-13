// @vitest-environment node
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, type Browser } from 'playwright-core'

/**
 * Layout guard: Learn to write (intro step and canvas step) and Write it must never be wider than the phone.
 * Runs a real Chromium against the dev server; skipped where no Chromium is installed (set CHROME_PATH to point at one).
 */
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path))
let server: ViteDevServer, browser: Browser, base = ''
beforeAll(async () => {
  if (!chrome) return
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  await server.listen()
  base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/`
  browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] })
}, 60_000)
afterAll(async () => { await browser?.close(); await server?.close() })

describe.skipIf(!chrome)('writing screens fit the viewport', () => {
  for (const width of [320, 390]) for (const type of ['Learn to write', 'Write it']) {
    it(`${type} at ${width}px: scrollWidth <= innerWidth on every step`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: 'dark' })
      const page = await context.newPage()
      const fits = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
      await page.goto(`${base}#practice`)
      // 吧: a long meaning ("sentence ending for a suggestion, tentative judgement or seeking confirmation") and the full toolbar.
      await page.evaluate("import('/src/core/study/knowledge.ts').then(knowledge => knowledge.addToKnowledge(['vocabulary:ba5--suggestion', 'vocabulary:wo3-men5--we', 'vocabulary:xiu1-xi5--rest', 'vocabulary:wu3--five', 'vocabulary:fen1-zhong1--minute']))")
      await page.reload()
      await page.getByRole('button', { name: 'Start unwritten characters' }).click()
      await page.getByText('Start practicing').first().click()
      await page.locator(`[aria-label="Start ${type}"]`).click()
      await page.getByRole('button', { name: 'Learn to write it' }).or(page.getByRole('button', { name: 'Start writing' })).or(page.getByRole('button', { name: 'Check answer' })).or(page.getByRole('button', { name: 'Give up' })).first().waitFor()
      let seen = 0
      for (let step = 0; step < 3; step++) {
        const { scroll, inner } = await fits()
        expect(scroll, `step ${step}`).toBeLessThanOrEqual(inner)
        seen++
        const next = page.getByRole('button', { name: 'Learn to write it' }).or(page.getByRole('button', { name: 'Start writing' }))
        if (!await next.count()) break
        await next.first().click()
        await page.waitForTimeout(800)
      }
      expect(seen).toBeGreaterThan(0)
      await context.close()
    }, 60_000)
  }
})
