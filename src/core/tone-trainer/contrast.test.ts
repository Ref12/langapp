// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { contrastPlan } from './contrast'
import type { ToneManifest, ToneManifestItem } from './manifest'

const single = (id: string, voices: string[]): ToneManifestItem => ({ id, kind: 'single', chars: id, pinyin: id.slice(2), tones: [Number(id.slice(-1))], clips: Object.fromEntries(voices.map(v => [v, { file: v + '/' + id + '.mp3', chars: id }])) })
const manifest = (...items: ToneManifestItem[]): ToneManifest => ({ version: 1, voices: [], items })

describe('contrastPlan', () => {
  it('pairs the right clip with the chosen tone on the same base and voice', () => {
    const m = manifest(single('s-ma4', ['a', 'b']), single('s-ma3', ['a', 'b']))
    expect(contrastPlan(m, m.items[0], 'b', 3)).toEqual({ voice: 'b', voiceChanged: false, heard: { file: 'b/s-ma4.mp3', label: 'mà' }, picked: { file: 'b/s-ma3.mp3', label: 'mǎ' } })
  })
  it('switches to a voice that has both', () => {
    const m = manifest(single('s-ma4', ['a', 'b']), single('s-ma3', ['b']))
    expect(contrastPlan(m, m.items[0], 'a', 3)).toMatchObject({ voice: 'b', voiceChanged: true, picked: { file: 'b/s-ma3.mp3' } })
  })
  it('keeps only the right clip when no voice has the chosen one, and gives nothing for pairs or the same tone', () => {
    const m = manifest(single('s-ma4', ['a', 'b']), single('s-ma2', ['a']))
    const alone = contrastPlan(m, m.items[0], 'b', 1)
    expect(alone).toMatchObject({ voice: 'b', voiceChanged: false, heard: { file: 'b/s-ma4.mp3' } })
    expect(alone?.picked).toBeUndefined()
    expect(contrastPlan(m, m.items[0], 'a', 4)).toBeUndefined()
    expect(contrastPlan(m, { ...m.items[0], kind: 'pair' }, 'a', 2)).toBeUndefined()
  })
})
