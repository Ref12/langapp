// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { formsEngine } from '../forms'
import { kindOfWord } from '../forms/display'
import { buildKoPack, gapsMarkdown, segmentsWithSpaces, REGISTRY_FILE, SEALED_FILE } from '../../../scripts/generate-pack-ko.mjs'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, renderExample, resetCatalogCache, type BandData } from '../study/catalog'
import { unitRef } from '../study/contracts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const onDisk = (path: string) => readFileSync(root + path, 'utf8').replace(/\r\n/g, '\n')
const pack = buildKoPack(root)
const band = pack.band as BandData

afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the Korean pack generator', () => {
  it('equals the committed files and the gap report', () => {
    for (const [path, text] of pack.files) expect(onDisk(path) === text, path).toBe(true)
    expect(gapsMarkdown(pack)).toBe(onDisk('docs/audits/2026-11-10-korean-lesson-content-gaps.md'))
  })
  it('has the exact counts', () => {
    expect(band.groups.length).toBe(87)
    expect(band.vocabulary.length).toBe(300)
    expect(band.grammar.length).toBe(133)
    expect(pack.phrases.length).toBe(905)
    expect(pack.formsTable.length).toBe(30)
  })
  it('classifies every lesson verb and adjective and tags the forms the sentences use', () => {
    const engine = formsEngine('ko')
    const inflecting = band.vocabulary.filter(item => item.ps === 'verb' || item.ps === 'adjective').filter(item => item.ch.endsWith('다'))
    expect(inflecting.length).toBe(79) // 80 verbs and adjectives in the lessons; 비가 와요 is a whole sentence, kept as a phrase without a class
    for (const item of inflecting) expect(engine.rules.classes[item.cl ?? ''], item.ch + ' has a class').toBeTruthy()
    const classes = new Set(band.vocabulary.flatMap(item => item.cl ? [item.cl] : []))
    for (const need of ['regular-vowel', 'regular-consonant', 'hada', 'b-irregular', 'd-irregular', 'reu-irregular', 'l-stem', 'eu-stem']) expect(classes.has(need), need).toBe(true)
    // a verb-only form is never built for an adjective
    for (const row of pack.formsTable) expect(row.joined).toEqual(row.kinds)
    expect(pack.formsTable.find(row => row.id === 'wish')?.kinds).toEqual(['verb'])
    const byLabel = new Map(band.vocabulary.map(item => [item.lb, item]))
    let tagged = 0
    for (const phrase of pack.phrases) for (const token of phrase.tokens as { word?: string; form?: string; text?: string }[]) {
      if (!token.form) continue
      tagged++
      const item = byLabel.get(token.word!)!
      expect(item.cl, item.ch).toBeTruthy()
      expect(engine.formIds(item.cl!, kindOfWord(item)).includes(token.form), item.ch + ' ' + token.form).toBe(true)
    }
    expect(tagged).toBeGreaterThan(700)
    expect(pack.mismatches).toEqual([])
  })
  it('resolves every sentence token and renders it', async () => {
    setBuildLanguageForTests('ko')
    const catalog = await loadCatalog()
    for (const group of band.groups) for (const ex of group.examples) {
      for (const s of ex.segments) {
        if (s.word) expect(catalog.units.has(unitRef('vocabulary', s.word))).toBe(true)
        if (s.grammar) expect(catalog.units.has(unitRef('grammar', s.grammar))).toBe(true)
      }
      expect(renderExample(catalog, ex).text.length).toBeGreaterThan(0)
    }
    for (const p of pack.phrases) for (const s of p.tokens) {
      if (s.word) expect(catalog.units.has(unitRef('vocabulary', s.word))).toBe(true)
      if (s.grammar) expect(catalog.units.has(unitRef('grammar', s.grammar))).toBe(true)
    }
  })
  it('renders each phrase segments to its text, with distinct keys (no repeated sentence)', () => {
    const seen = new Map<string, number>()
    for (const p of pack.phrases) {
      const text = p.tokens.map((s: { punctuation?: string; text?: string; word?: string; grammar?: string }) => s.punctuation ?? s.text ?? (s.word ? band.vocabulary.find(v => v.lb === s.word)!.ch : band.grammar.find(g => g.lb === s.grammar)!.pt)).join('')
      expect(text.replace(/\s/g, '')).toBe(p.zh.replace(/\s/g, ''))
      seen.set(p.zh, (seen.get(p.zh) ?? 0) + 1)
    }
    expect(new Set(pack.phrases.map((p: { id: number }) => p.id)).size).toBe(905)
    expect([...seen].filter(([, n]) => n > 1).map(([t]) => t)).toEqual([])
  })
  it('keeps ids stable and sealed, labels unique, homographs apart', () => {
    const registry = JSON.parse(onDisk(REGISTRY_FILE)), sealed = JSON.parse(onDisk(SEALED_FILE))
    for (const kind of ['vocabulary', 'grammar']) for (const [id, label] of Object.entries(sealed[kind])) expect(registry[kind][id]).toBe(label)
    const labels = band.vocabulary.map(v => v.lb)
    expect(new Set(labels).size).toBe(labels.length)
    for (const l of ['cha--tea', 'cha--vehicle', 'gae--general', 'gae--dog', 'il--one', 'il--day', 'il--work']) expect(labels).toContain(l)
    for (const v of band.vocabulary) expect(v.ps).toMatch(/^[a-z]+$/)
  })
  it('segments with spaces and rejects mismatched tokens', () => {
    const seg = (_t: { t: string }, w: string) => ({ text: w })
    expect(segmentsWithSpaces({ id: 1, text: '안녕히 가세요.', tokens: [{ t: '안녕히가세요' }, { t: '.' }] }, seg)).toEqual([{ text: '안녕히 가세요' }, { text: '.' }])
    expect(() => segmentsWithSpaces({ id: 2, text: '가요', tokens: [{ t: '나요' }] }, seg)).toThrow()
  })
})
