import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import levels from './fixtures/clip-levels.json'
import { isClearClip, isClearExample } from './clear'
import type { ToneManifest } from './manifest'
import type { LevelCurve } from './pitch'

const through = (...points: number[]): LevelCurve => Array.from({ length: 20 }, (_, i) => {
  const at = (i / 19) * (points.length - 1), a = Math.floor(at), b = Math.min(points.length - 1, a + 1)
  return Math.round((points[a] + (points[b] - points[a]) * (at - a)) * 10)
})
const root = fileURLToPath(new URL('../../../public/audio/tones/', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(root + 'manifest.json', 'utf8')) as ToneManifest

describe('a clear example of a tone', () => {
  it('tone 1 is high and level', () => {
    expect(isClearExample(through(4.3, 4.6), 1)).toBe(true)
    expect(isClearExample(through(3.7, 2.3), 1)).toBe(false)   // sags
    expect(isClearExample(through(2.7, 2.7), 1)).toBe(false)   // flat but not high
  })
  it('tone 2 rises by 1.5 levels and ends high', () => {
    expect(isClearExample(through(2, 4.2), 2)).toBe(true)
    expect(isClearExample(through(1.6, 2.3), 2)).toBe(false)   // 1.6 to 2.3 is too little
    expect(isClearExample(through(2.4, 1.2, 3), 2)).toBe(false) // the low point is late
  })
  it('tone 3 is low, with or without the final rise, and a low fall counts', () => {
    expect(isClearExample(through(2.2, 1, 1.2), 3)).toBe(true); expect(isClearExample(through(2.2, 1, 3.5), 3)).toBe(true); expect(isClearExample(through(2.4, 1), 3)).toBe(true)
    expect(isClearExample(through(2.7, 2.7), 3)).toBe(false)
  })
  it('tone 4 starts high and falls by 2 levels', () => {
    expect(isClearExample(through(5, 2.5), 4)).toBe(true)
    expect(isClearExample(through(4.5, 3.4), 4)).toBe(false)
    expect(isClearExample(through(3, 1), 4)).toBe(false)
  })
  it('a syllable in a word may move a little less (tones 2 and 4 only)', () => {
    expect(isClearExample(through(2, 3.3), 2)).toBe(false); expect(isClearExample(through(2, 3.3), 2, true)).toBe(true)
    expect(isClearExample(through(4.6, 2.9), 4)).toBe(false); expect(isClearExample(through(4.6, 2.7), 4, true)).toBe(true)
    expect(isClearExample(through(2.7, 2.7), 1, true)).toBe(false)
  })
  it('no pitch is never clear', () => { expect(isClearExample(null, 1)).toBe(false); expect(isClearClip([through(4, 4), null], [1, 4])).toBe(false) })
})

describe('the shipped clips', () => {
  it('every one is a clear example of its tone (tracked as the app tracks it, on the voice ranges of pitch.ts)', () => {
    expect(levels.length).toBeGreaterThan(500)
    const bad = (levels as { id: string; voice: string; tones: number[]; levels: (number | null)[][] }[]).filter(clip => !isClearClip(clip.levels, clip.tones))
    expect(bad.map(clip => clip.id + '/' + clip.voice)).toEqual([])
  })
  it('the manifest and the files agree: every clip exists, every item has two voices or more', () => {
    for (const item of manifest.items) {
      expect(Object.keys(item.clips).length, item.id).toBeGreaterThanOrEqual(2)
      for (const clip of Object.values(item.clips)) expect(fs.existsSync(root + clip.file), clip.file).toBe(true)
    }
    const files = fs.readdirSync(root, { recursive: true }).filter(name => String(name).endsWith('.mp3')).map(String).map(name => name.replace(/\\/g, '/'))
    const listed = new Set(manifest.items.flatMap(item => Object.values(item.clips).map(clip => clip.file)))
    expect(files.filter(file => !listed.has(file))).toEqual([])
  })
  it('a single base keeps all four tones, and a word group holds at most 12 words', () => {
    const singles = manifest.items.filter(item => item.kind === 'single')
    const bases = new Map<string, Set<number>>()
    for (const item of singles) bases.set(item.id.slice(2, -1), (bases.get(item.id.slice(2, -1)) ?? new Set()).add(item.tones[0]))
    for (const [base, tones] of bases) expect([...tones].sort(), base).toEqual([1, 2, 3, 4])
    const groups = new Map<string, number>()
    for (const item of manifest.items.filter(i => i.kind === 'pair')) groups.set(item.tones.join(''), (groups.get(item.tones.join('')) ?? 0) + 1)
    for (const [group, count] of groups) expect(count, group).toBeLessThanOrEqual(12)
  })
})
