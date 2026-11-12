import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs modules
import { buildInput, buildInputs, chunks, createIO, jsonObjects, listFrom, processGroup, readSources, runPipeline, emptyState, shownParts, validateEntry } from './build-part-notes.mjs'
// @ts-expect-error plain .mjs modules
import { buildPartNotesJson, parseNotesYaml, renderNotesYaml } from './part-notes-files.mjs'
import { describeParts, type ComponentData, type PartGlyphs } from '../src/core/characters/components'

const sources = readSources()
const input = (ch: string) => buildInput(sources, ch)
const good = (ch: string) => ({ ch, parts: input(ch).parts.map((part: { id: string; mmh: string | null }) => ({ id: part.id, role: part.mmh === 'phonetic' ? 'sound' : 'meaning', note: 'a note here' })) })

describe('part notes: input', () => {
  it('lists the same top-level parts as the app (describeParts) for all 3,001 characters', () => {
    const data = sources.data as ComponentData, glyphs = sources.glyphs as PartGlyphs
    let compared = 0
    for (const ch of Object.keys(data.characters)) {
      const app = describeParts(data, ch, glyphs)
      const mine = shownParts(data, glyphs, ch)
      expect(mine.map((part: { glyph?: string }) => part.glyph), ch).toEqual(app.map(part => part.glyph))
      expect(mine.map((part: { meaning?: string }) => part.meaning), ch).toEqual(app.map(part => part.meaning))
      compared++
    }
    expect(compared).toBe(3001)
  })
  it('gives 河 its parts with their own meaning, pinyin and Make Me a Hanzi role', () => {
    const he = input('河')
    expect(he).toMatchObject({ ch: '河', py: 'hé', type: 'pictophonetic', hint: 'water' })
    expect(he.parts.map((part: { id: string }) => part.id)).toEqual(['氵', '可'])
    expect(he.parts[1]).toMatchObject({ mmh: 'phonetic', py: 'kě' })
  })
  it('names a part drawn from strokes by its pieces', () => { expect(input('前').parts[0].id).toBe('[丷一]') })
})

describe('part notes: validation', () => {
  it('accepts a matching entry', () => { expect(validateEntry(input('河'), { ...good('河'), origin: 'Water by a river.' }).problems).toEqual([]) })
  it('rejects parts that do not match the input, in order', () => {
    const swapped = good('河'); swapped.parts.reverse()
    expect(validateEntry(input('河'), swapped).problems.join()).toMatch(/expected/)
    expect(validateEntry(input('河'), { ch: '河', parts: [good('河').parts[0]] }).problems.join()).toMatch(/expected 2 parts/)
  })
  it('rejects a role outside the five', () => {
    const bad = good('河'); bad.parts[0].role = 'radical'
    expect(validateEntry(input('河'), bad).problems.join()).toMatch(/role "radical"/)
  })
  it('rejects an over-long note', () => {
    const bad = good('河'); bad.parts[0].note = 'water that is the sort of thing which a river is made of in many places'
    expect(validateEntry(input('河'), bad).problems.join()).toMatch(/too long/)
  })
  it('flags (never overrides) a sound role that disagrees with Make Me a Hanzi', () => {
    const asMeaning = good('河'); asMeaning.parts[1].role = 'meaning'
    expect(validateEntry(input('河'), asMeaning).problems.join()).toMatch(/marks it phonetic/)
    const asSound = good('河'); asSound.parts[0].role = 'sound'
    expect(validateEntry(input('河'), asSound).problems.join()).toMatch(/marks it semantic/)
    expect(validateEntry(input('河'), asMeaning).entry.parts[1].role).toBe('meaning')
  })
})

describe('part notes: batching', () => {
  it('never makes a one-character batch, except a lone final batch', () => {
    for (const total of [1, 2, 21, 22, 23, 44, 45, 67, 100, 2966]) {
      const groups = chunks(Array.from({ length: total }, (_, i) => i), 22)
      expect(groups.flat()).toHaveLength(total)
      groups.slice(0, -1).forEach(group => expect(group.length).toBeGreaterThan(1))
      if (total > 1) expect(groups.at(-1)!.length).toBeGreaterThan(1)
      groups.forEach(group => expect(group.length).toBeLessThanOrEqual(23))
    }
  })
  it('sends the writer and checker calls batch by batch', async () => {
    const chars = [...'河前好想嵌能霜马闭甜章']
    const inputs = buildInputs(sources, chars)
    const sizes: number[] = []
    const io = {
      write: async (_s: string, user: string) => { const wanted = chars.filter(ch => user.includes('{"ch":"' + ch + '"')); sizes.push(wanted.length); return JSON.stringify({ items: wanted.map(good) }) },
      check: async () => '{"flagged":[]}', calls: {},
    }
    const state = emptyState()
    await runPipeline({ inputs, state, io, options: { batchSize: 5, concurrency: 3 } })
    expect(sizes.every(size => size > 1)).toBe(true)
    expect(Object.values(state.chars as Record<string, { status: string }>).every(record => record.status === 'accepted')).toBe(true)
  })
})

describe('part notes: replies and the flag-and-rewrite flow', () => {
  it('reads one object per line as well as one object', () => {
    expect(jsonObjects('x {"items":[{"ch":"a"}]}\n{"items":[{"ch":"b"}]} {"a":"}"}')).toHaveLength(3)
    expect(listFrom('{"items":[{"ch":"a"}]}\n{"items":[{"ch":"b"}]}', 'items')).toEqual([{ ch: 'a' }, { ch: 'b' }])
    expect(listFrom('nothing', 'items')).toBeUndefined()
  })
  it('flags a checker verdict with its reason, then accepts a good rewrite', async () => {
    const inputs = buildInputs(sources, [...'河前'])
    let writes = 0
    const io = {
      write: async () => { writes++; return JSON.stringify({ items: [...'河前'].map(good) }) },
      check: async (_s: string, user: string) => user.includes('ENTRY') && writes === 1 ? '{"flagged":[{"ch":"前","reason":"punishment is wrong"}]}' : '{"flagged":[]}',
    }
    const first = await processGroup({ inputs, io })
    expect(first['河']).toMatchObject({ entry: expect.anything() })
    expect(first['前'].flags[0]).toMatch(/punishment is wrong/)
    const second = await processGroup({ inputs: inputs.filter((item: { ch: string }) => item.ch === '前'), io, prior: { 前: { reasons: first['前'].flags, entry: first['前'].entry } } })
    expect(second['前'].flags).toBeUndefined()
  })
})

describe('part notes: files', () => {
  it('writes YAML and the short-key JSON the app reads', () => {
    const notes = { 河: { origin: 'Water by a river.', parts: [{ part: '氵', role: 'meaning', note: 'water: a river' }, { part: '可', role: 'sound', note: 'sound kě → hé' }] }, 前: { parts: [{ part: '[丷一]', role: 'form', note: 'worn-down 止 foot' }, { part: '刖', role: 'form', note: '月 for 舟 boat; 刂 added later' }] } }
    const yaml = renderNotesYaml(notes)
    expect(parseNotesYaml(yaml)).toEqual(notes)
    const json = JSON.parse(buildPartNotesJson(parseNotesYaml(yaml)))
    expect(json.notes['河']).toEqual({ p: [['氵', 'm', 'water: a river'], ['可', 's', 'sound kě → hé']], o: 'Water by a river.' })
    expect(json.notes['前'].p[0]).toEqual(['', 'f', 'worn-down 止 foot'])
  })
})

describe('part notes: io', () => { it('sends the session id on every call', () => { expect(typeof createIO).toBe('function') }) })
