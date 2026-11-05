import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

type Node = { c: string; s: number[]; d?: string; k?: Node[]; r?: string; u?: number }
type Char = { phoneticAlsoSemantic?: string; n: number; d?: string; k?: Node[]; t?: string; h?: string }
type Component = { cp: string; block: string; status: string; byPosition?: Record<string, { of: string }>; meaning?: { en: string; source: string }; none?: string }
const data = JSON.parse(readFileSync(join('public', 'characters', 'chinese', 'components.generated.json'), 'utf8')) as {
  characters: Record<string, Char>
  components: Record<string, Component>
  coverage: { soundDrift: { pictophoneticWithPhonetic: number; unknownPinyin: number; sameSyllableSameTone: number; sameSyllableOtherTone: number; sameInitialOnly: number; sameFinalOnly: number; different: number }; phoneticAlsoSemantic: { characters: number }; characters: number; decomposition: number; fullMapping: number; strokeCountMatches: number; strokeOrderMatches: number }
  report: { strokeCountMismatches: unknown[]; strokeOrderMismatches: unknown[]; missingFromMmah: string[] }
}

describe('generated component data', () => {
  it('breaks 妈 into 女 (strokes 0-2, meaning) and 马 (strokes 3-5, sound)', () => {
    const { d, k } = data.characters['妈']
    expect(d).toBe('⿰')
    expect(k).toEqual([{ c: '女', s: [0, 1, 2], r: 'semantic' }, { c: '马', s: [3, 4, 5], r: 'phonetic' }])
  })

  it('河 = 氵 + 可 and 想 = 相 over 心', () => {
    const he = data.characters['河']
    expect([he.d, he.k?.[0].c, he.k?.[1].c, he.k?.[0].s]).toEqual(['⿰', '氵', '可', [0, 1, 2]])
    const xiang = data.characters['想']
    expect([xiang.d, xiang.k?.[0].c, xiang.k?.[1].c, xiang.k?.[1].s]).toEqual(['⿱', '相', '心', [9, 10, 11, 12]])
    expect(xiang.k?.[0].k?.map(kid => kid.c)).toEqual(['木', '目'])
  })

  it('都 has 阝 on the right, which is 邑 (city), while on the left 阝 is 阜', () => {
    const du = data.characters['都']
    expect([du.k?.[0].c, du.k?.[1].c, du.k?.[1].s, du.k?.[1].r]).toEqual(['者', '阝', [8, 9], 'semantic'])
    expect(data.components['阝'].byPosition).toMatchObject({ left: { of: '阜' }, right: { of: '邑' } })
  })

  it('normalises components to ordinary ideographs and records unencoded ones', () => {
    expect(data.components['亻'].cp).toBe('U+4EBB')
    expect(data.components['氵'].cp).toBe('U+6C35')
    expect(data.components['⺗'].block).toBe('CJK Radicals Supplement')
    expect(Object.keys(data.components).some(c => /[\u2f00-\u2fd5]/.test(c))).toBe(false)
    expect(JSON.stringify(data.characters).includes('"u":1')).toBe(true)
  })

  it('gives meanings, with placeholders marked as having none of their own', () => {
    expect(data.components['宀'].meaning).toMatchObject({ en: 'roof', source: 'unihan-radical' })
    expect(data.components['疒'].meaning?.en).toBe('sick')
    expect(data.components['亻'].meaning).toMatchObject({ source: 'radical-variant', of: '人' })
    expect(data.components['又'].none).toBe('placeholder')
    expect(data.components['丷'].none).toBe('structural')
  })

  it('flags a phonetic part that also carries meaning only where Make Me a Hanzi says so', () => {
    expect(data.characters['娶'].phoneticAlsoSemantic).toBe('取')
    expect(data.characters['河'].phoneticAlsoSemantic).toBeUndefined()
    const flagged = Object.entries(data.characters).filter(([, c]) => c.phoneticAlsoSemantic)
    expect(flagged.length).toBe(data.coverage.phoneticAlsoSemantic.characters)
    for (const [char, c] of flagged) expect(JSON.stringify(c.k), char).toContain(`"c":"${c.phoneticAlsoSemantic}"`)
  })

  it('counts sound drift between phonetic part and character', () => {
    const d = data.coverage.soundDrift
    expect(d.sameSyllableSameTone + d.sameSyllableOtherTone + d.sameInitialOnly + d.sameFinalOnly + d.different + d.unknownPinyin).toBe(d.pictophoneticWithPhonetic)
  })

  it('has the same stroke counts and order as our shipped guides', async () => {
    expect(data.report.strokeCountMismatches).toEqual([])
    expect(data.report.strokeOrderMismatches).toEqual([])
    expect(data.coverage.strokeCountMatches).toBe(data.coverage.characters)
    const zip = await JSZip.loadAsync(readFileSync(join('public', 'characters', 'chinese', 'hanzi-writer-selected.zip')))
    for (const char of ['妈', '河', '都', '想', '一', '龍', '鬱']) {
      const file = zip.file(`data/${char}.json`)
      if (!file) continue
      expect(data.characters[char].n).toBe(JSON.parse(await file.async('string')).strokes.length)
    }
  })

  it('assigns every stroke of a fully mapped character to exactly one top-level component', () => {
    for (const [char, entry] of Object.entries(data.characters)) {
      if (!entry.k || entry.k.some(kid => kid.s.length === 0)) continue
      const strokes = entry.k.flatMap(kid => kid.s).sort((a, b) => a - b)
      if (strokes.length !== entry.n) continue
      expect(strokes, char).toEqual(Array.from({ length: entry.n }, (_, i) => i))
    }
    expect(data.coverage.fullMapping).toBeGreaterThan(2500)
  })

  it('keeps the reviewed variants table consistent with the data', () => {
    const doc = parse(readFileSync(join('curriculum', 'chinese', 'characters', 'component-variants.yaml'), 'utf8')) as { variants: { form: string; examples: string[] }[] }
    for (const row of doc.variants) {
      expect(data.components[row.form], row.form).toBeDefined()
      for (const example of row.examples) expect(JSON.stringify(data.characters[example]), `${row.form} in ${example}`).toContain(`"c":"${row.form}"`)
    }
    expect(doc.variants.map(row => row.form)).toEqual(expect.arrayContaining(['亻', '氵', '氺', '忄', '⺗', '扌', '灬', '刂', '讠', '钅', '饣', '衤', '礻', '犭', '罒', '爫', '月', '阝']))
  })
})

describe('nested groups the source leaves unnamed', () => {
  it('得 names its right-hand group 㝵 (⿱旦寸) and keeps its parts', () => {
    const right = data.characters['得'].k![1]
    expect(right.c).toBe('㝵')
    expect(right.d).toBe('⿱')
    expect(right.k!.map(kid => kid.c)).toEqual(['旦', '寸'])
    expect(data.components['㝵'].status).toBe('meaning')
    expect(data.components['㝵'].meaning?.en).toMatch(/ancient form of 得/)
  })
})
