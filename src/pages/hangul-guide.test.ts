// @vitest-environment node
// public/guides/hangul.html: a plain static page. It exists, has a title and lang attributes on its Korean text, and every link
// and the stroke data it loads resolve to files of the build (public/) or to routes of the Korean app (../ and ../#...).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const pageFile = root + 'public/guides/hangul.html'
const html = existsSync(pageFile) ? readFileSync(pageFile, 'utf8') : ''

describe('the Hangul guide page', () => {
  it('exists and has a title and an English language', () => {
    expect(existsSync(pageFile)).toBe(true)
    expect(html).toMatch(/<html lang="en">/)
    expect(html).toMatch(/<title>[^<]+<\/title>/)
  })
  it('puts a lang on every run of Hangul text', () => {
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    // text nodes with Hangul whose nearest element has no lang="ko" on itself or on a parent span
    const bare: string[] = []
    const stack: boolean[] = []
    for (const token of body.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue }
      if (token.startsWith('<')) {
        if (/^<(meta|br|link|img|hr|input|!)/.test(token) || token.endsWith('/>')) continue
        stack.push(/lang="ko"/.test(token) || (stack.length > 0 && stack[stack.length - 1]))
        continue
      }
      if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(token) && !stack[stack.length - 1]) bare.push(token.trim().slice(0, 40))
    }
    expect(bare).toEqual([])
  })
  it('has its tables and its sections', () => {
    for (const id of ['how', 'letters', 'writing', 'sounds', 'next', 'refs']) expect(html).toContain(`id="${id}"`)
    expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(10)
  })
  it('links resolve to files of the build or to the app', () => {
    const dir = dirname(pageFile)
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
    expect(hrefs.length).toBeGreaterThan(10)
    for (const href of hrefs) {
      if (/^https:\/\//.test(href)) continue
      if (href.startsWith('#')) { expect(html, href).toContain(`id="${href.slice(1)}"`); continue }
      const [path, hash] = href.split('#')
      if (path === '../') { expect(hash === undefined || /^(lessons|writing)/.test(hash), href).toBe(true); continue }
      expect(existsSync(resolve(dir, path)), href).toBe(true)
    }
    expect(html).toContain('href="../#lessons"')
    expect(html).toContain('href="../#writing"')
  })
  it('loads stroke data that exists and covers the basic letters', () => {
    const url = /fetch\('([^']+)' \+ pageName \+ '([^']+)'\)/.exec(html)
    expect(url).not.toBeNull()
    const file = resolve(dirname(pageFile), url![1] + 'u0031' + url![2])
    expect(existsSync(file)).toBe(true)
    const data = JSON.parse(readFileSync(file, 'utf8')) as { characters: { character: string; paths: string[] }[] }
    const have = new Map(data.characters.map(entry => [entry.character, entry.paths.length]))
    const basic = JSON.parse(/var BASIC = (\[[^\]]+\])/.exec(html)![1]) as string[]
    expect(basic).toHaveLength(24)
    for (const letter of basic) expect(have.get(letter), letter).toBeGreaterThan(0)
  })
})
