// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'
import { makeStrokeGuide, matchesStroke } from './geometry'

it('accepts exact default paths across the reviewed and representative Chinese batch', () => {
  const characters = '\u8336\u96e8\u676f\u4eba\u4e00\u4e09\u5341\u5c0f\u4e86\u4e01\u6c34\u5fc3\u6587\u6728\u6c38\u6211\u53ef\u53e3\u65e5\u56fd\u56de\u5668\u8b66\u85cf\u8d62\u4e4b\u6bcb\u98ce\u4e5d\u56ca'
  const pages = new Map<string, Record<string, { default_variant: string; variants: { id: string; strokes: { path: string }[] }[] }>>()
  for (const character of characters) {
    const page = `u${(character.codePointAt(0)! >> 8).toString(16).padStart(4, '0')}.yaml`
    if (!pages.has(page)) pages.set(page, parse(readFileSync(join('curriculum', 'chinese', 'characters', page), 'utf8')))
    const record = pages.get(page)![character]
    const variant = record.variants.find(variant => variant.id === record.default_variant)!
    for (const [index, stroke] of variant.strokes.entries()) {
      const guide = makeStrokeGuide(stroke.path)
      expect(matchesStroke(guide.points, guide), `${character} stroke ${index + 1}`).toBe(true)
      expect(matchesStroke([...guide.points].reverse(), guide), `${character} reversed stroke ${index + 1}`).toBe(false)
    }
  }
}, 30_000)

it('can trace every shipped default guide without getting stuck on an exact stroke', () => {
  const root = join('public', 'characters', 'chinese')
  let characters = 0
  for (const file of readdirSync(root).filter(name => /^u[0-9a-f]{4}\.generated\.json$/.test(name))) {
    const page: { characters: { character: string; paths: string[] }[] } = JSON.parse(readFileSync(join(root, file), 'utf8'))
    for (const character of page.characters) {
      characters++
      for (const [index, path] of character.paths.entries()) {
        const guide = makeStrokeGuide(path)
        expect(matchesStroke(guide.points, guide), `${character.character} stroke ${index + 1}`).toBe(true)
      }
    }
  }
  const index: { characters: unknown[] } = JSON.parse(readFileSync(join('src', 'data', 'characters', 'index.generated.json'), 'utf8'))
  expect(characters).toBe(index.characters.length)
  expect(characters).toBeGreaterThan(0)
}, 30_000)
