import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeParts, formsOf, loadComponentData, resetComponentData, strokeParts, type ComponentData, type PartGlyphs } from './components'

const data = JSON.parse(readFileSync('public/characters/chinese/components.generated.json', 'utf8')) as ComponentData
const glyphs = JSON.parse(readFileSync('src/data/characters/part-glyphs.generated.json', 'utf8')) as PartGlyphs
const parts = (character: string) => describeParts(data, character, glyphs)

describe('describeParts', () => {
  it('河 = 氵 + 可: a meaning part in a variant form and a sound part', () => {
    const [water, sound] = parts('河')
    expect(water).toMatchObject({ glyph: '氵', role: 'meaning', bound: true, form: { of: '水', place: 'left' } })
    expect(water.link).toBeUndefined()
    expect(sound).toMatchObject({ glyph: '可', role: 'sound', link: '可' })
    expect(sound.children.map(kid => kid.glyph)).toEqual(['丁', '口'])
  })
  it('想 = 相 + 心 with 心 linking, and 相 opening into 木 and 目', () => {
    const [look, heart] = parts('想')
    expect(look).toMatchObject({ glyph: '相', role: 'sound', link: '相' })
    expect(look.children.map(kid => kid.glyph)).toEqual(['木', '目'])
    expect(heart).toMatchObject({ glyph: '心', role: 'meaning', link: '心' })
    expect(heart.form).toBeUndefined()
  })
  it('the bottom form of 心 in 恭 comes from the data, not the position', () => {
    const [, heart] = parts('恭')
    expect(heart).toMatchObject({ glyph: '⺗', bound: true, form: { of: '心', place: 'bottom' } })
    expect(heart.link).toBeUndefined()
    expect(parts('想')[1].form).toBeUndefined()
  })
  it('都 = 者 + 阝, with 阝 the form of 邑 on the right', () => {
    const [who, city] = parts('都')
    expect(who).toMatchObject({ glyph: '者', role: 'sound' })
    expect(city).toMatchObject({ glyph: '阝', role: 'meaning', bound: true, form: { of: '邑', place: 'right' } })
    expect(city.meaning).toMatch(/area/)
  })
  it('娶 shows 取 as sound + meaning, and an ideographic compound shows every part as meaning', () => {
    expect(parts('娶')[0]).toMatchObject({ glyph: '取', role: 'both', link: '取' })
    expect(parts('明').map(part => part.role)).toEqual(['meaning', 'meaning'])
  })
  it('pictographic and atomic characters show no roles', () => {
    expect(parts('女')).toEqual([])
    for (const character of ['日', '木']) expect(parts(character).every(part => part.role === undefined)).toBe(true)
  })
  it('汉 has a part with no meaning that is not linked', () => {
    const part = parts('汉')[1]
    expect(part).toMatchObject({ glyph: '又', noMeaning: true })
    expect(part.link).toBeUndefined()
    expect(part.meaning).toBeUndefined()
  })
  it('春 has a part with no font character, drawn from the strokes in the parts font', () => {
    const top = parts('春')[0]
    expect(top.drawn).toBe(true)
    expect(top.link).toBeUndefined()
    expect(top.glyph).toBeDefined()
    expect(top.glyph!.codePointAt(0)).toBeGreaterThanOrEqual(0xe000)
    expect(top.strokes).toEqual([0, 1, 2, 3, 4])
  })
  it('only a full character with a Dictionary entry links', () => {
    for (const character of ['河', '想', '都', '恭', '汉', '春', '娶']) {
      for (const part of parts(character)) {
        if (part.link) { expect(part.bound || part.drawn || part.noMeaning).toBe(false); expect(data.components[part.link].standalone).toBe(true) }
        else expect(part.bound || part.drawn || part.noMeaning || !data.components[part.glyph ?? '']?.standalone).toBe(true)
      }
    }
  })
  it('lists the forms of 水 from the data', () => {
    const forms = formsOf(data, '水')
    expect(forms.map(row => row.form)).toEqual(expect.arrayContaining(['水', '氵', '氺']))
    expect(forms.find(row => row.form === '氵')?.examples.length).toBeGreaterThan(0)
  })
})

describe('strokeParts', () => {
  it.each(['妈', '河', '想', '都'])('%s: every stroke belongs to exactly one top-level part', character => {
    const count = data.characters[character].n
    const owners = strokeParts(data, character, count)
    expect(owners).toHaveLength(count)
    expect(owners.every(owner => owner !== undefined)).toBe(true)
    const top = data.characters[character].k!
    owners.forEach((owner, stroke) => expect(top[owner!].s).toContain(stroke))
    expect(new Set(owners).size).toBe(top.length)
  })
  it('colours the unmapped strokes of a part with no font character with that part', () => {
    expect(strokeParts(data, '春', 9).every(owner => owner !== undefined)).toBe(true)
  })
})

describe('loadComponentData', () => {
  beforeEach(() => { resetComponentData(); vi.restoreAllMocks() })
  it('fetches the file once and caches it for the session', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ characters: {}, components: {} })))
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([loadComponentData(), loadComponentData()])
    await loadComponentData()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String((fetcher.mock.calls as unknown as unknown[][])[0][0])).toContain('characters/chinese/components.generated.json')
    vi.unstubAllGlobals()
  })
  it('tries again after a failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValue(new Response(JSON.stringify({ characters: {}, components: {} })))
    vi.stubGlobal('fetch', fetcher)
    await expect(loadComponentData()).rejects.toThrow(/could not be loaded/)
    await expect(loadComponentData()).resolves.toBeDefined()
    vi.unstubAllGlobals()
  })
})
